// Playwright reporter: builds the Allure HTML report from the results that
// 'allure-playwright' wrote during THIS run. 'allure-playwright' only writes raw
// result files; this turns them into allure-report/index.html with Allure Report 3
// (plain Node - no Java, no Jenkins plugin). List it right after it:
//   ['allure-playwright', { resultsDir: 'allure-results' }],
//   ['./fixtures/allure_html_reporter.js', { resultsDir: 'allure-results', outputFolder: 'allure-report' }],
// Like the html reporter's PLAYWRIGHT_HTML_OUTPUT_DIR, ALLURE_HTML_OUTPUT_DIR
// overrides outputFolder (the backend points it at the run's report folder).
// It never fails the test run: a problem is printed and the run's result stands.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Fetched with npx only when the project has no 'allure' package installed.
const ALLURE_VERSION = '3.20.1';
// The classic Allure 2 report (Overview, Categories, Suites, Behaviors, Graphs,
// Timeline), built by Allure 3's allure2 plugin - still no Java.
const REPORT_CONFIG = { name: 'Allure Report', plugins: { allure2: { options: {} } } };

class AllureHtmlReporter {
  constructor(options = {}) {
    this.resultsDir = path.resolve(options.resultsDir || 'allure-results');
    this.outputFolder = path.resolve(process.env.ALLURE_HTML_OUTPUT_DIR || options.outputFolder || 'allure-report');
    this.startedAt = Date.now();
  }

  onBegin() {
    this.startedAt = Date.now();
  }

  printsToStdio() {
    return false;
  }

  // Runs after 'allure-playwright' has written its last files (reporters end in
  // the order they are listed).
  async onEnd() {
    try {
      this.generate();
    } catch (error) {
      console.log(`[allure-html] Allure report not generated: ${error.message}`);
    }
  }

  // The results folder keeps every earlier run's files: report this run's only.
  freshResults() {
    if (!fs.existsSync(this.resultsDir)) return null;
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-run-'));
    let copied = 0;
    for (const name of fs.readdirSync(this.resultsDir)) {
      const file = path.join(this.resultsDir, name);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mtimeMs + 1000 < this.startedAt) continue;
      fs.copyFileSync(file, path.join(staging, name));
      copied += 1;
    }
    if (copied) return staging;
    fs.rmSync(staging, { recursive: true, force: true });
    return null;
  }

  // The project's own Allure 3 (devDependency 'allure'), else the pinned one via npx.
  generator() {
    try {
      const entry = require.resolve('allure', { paths: [process.cwd(), __dirname] });
      return { command: process.execPath, args: [path.join(path.dirname(entry), '..', 'cli.js')], shell: false };
    } catch (_) {
      return { command: 'npx', args: ['--yes', `allure@${ALLURE_VERSION}`], shell: true };
    }
  }

  generate() {
    const staging = this.freshResults();
    if (!staging) {
      console.log('[allure-html] No Allure results from this run; Allure report skipped.');
      return;
    }
    try {
      // Allure 3 has no --clean: a previous report must not leave files behind.
      fs.rmSync(this.outputFolder, { recursive: true, force: true });
      const config = path.join(staging, 'allurerc.json');
      fs.writeFileSync(config, JSON.stringify(REPORT_CONFIG));
      const { command, args, shell } = this.generator();
      const all = [...args, 'generate', staging, '-o', this.outputFolder, '--config', config];
      // Through a shell (npx), every argument is quoted: paths may contain spaces.
      const run = spawnSync(command, shell ? all.map(arg => `"${arg}"`) : all,
        { encoding: 'utf8', shell, timeout: 300000, windowsHide: true });
      const index = path.join(this.outputFolder, 'index.html');
      if (run.status === 0 && fs.existsSync(index)) {
        console.log(`[allure-html] Allure report: ${index}`);
      } else {
        const why = run.error ? run.error.message : `exit ${run.status}`;
        console.log(`[allure-html] Allure report not generated (${why}): ${String(run.stderr || run.stdout || '').trim().slice(-800)}`);
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

module.exports = AllureHtmlReporter;
