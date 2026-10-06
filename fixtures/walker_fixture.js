// backend/tests/fixtures/walker_fixture.js
//
// Drop-in Playwright fixture for .healed.spec files under healed/sanity or healed/regression. Every locator
// action is attempted normally first. Only a real failure enters the numbered
// visual-healing path implemented by inline_healer.js.

const fs = require('fs');
const path = require('path');
const { beginHealedSpecRun } = require('./prepare_healed_spec');

// Fixture diagnostics are intentionally silent. Successful locator changes
// are reported by inline_healer.js and nothing else is printed by this layer.
const console = Object.freeze({ log() {}, warn() {}, error() {} });

function resolveProjectPlaywright() {
  const searchRoots = [process.cwd(), __dirname];
  for (const root of searchRoots) {
    let current = path.resolve(root);
    for (let index = 0; index < 12; index += 1) {
      try {
        const resolved = require.resolve('@playwright/test', { paths: [current] });
        return require(resolved);
      } catch (_) {}
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return require('@playwright/test');
}

function findUp(relativeCandidates) {
  for (const start of [__dirname, process.cwd()]) {
    let current = path.resolve(start);
    for (let index = 0; index < 12; index += 1) {
      for (const relativeCandidate of relativeCandidates) {
        const candidate = path.resolve(current, relativeCandidate);
        if (fs.existsSync(candidate)) return candidate;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

const projectPlaywright = resolveProjectPlaywright();
const { test: base, expect: baseExpect } = projectPlaywright;
Object.assign(exports, projectPlaywright);
const healerPath = findUp([
  'inline_healer.js',
  path.join('fixtures', 'inline_healer.js'),
  path.join('tests', 'fixtures', 'inline_healer.js'),
]);
if (!healerPath) throw new Error('walker_fixture.js could not find inline_healer.js');

const {
  createHealingPage,
  createHealingExpect,
  RAW_PAGE,
} = require(healerPath);

const browserScriptPath = findUp([
  'browser_script.js',
  path.join('src', 'healing', 'browser_script.js'),
  path.join('backend', 'src', 'healing', 'browser_script.js'),
]);

function loadBrowserScript() {
  if (!browserScriptPath) return '';
  try { return fs.readFileSync(browserScriptPath, 'utf8'); } catch (_) { return ''; }
}

async function framePath(frame) {
  const result = [];
  let current = frame;
  while (current) {
    if (!current.parentFrame()) {
      result.push('main');
    } else {
      let label = 'iframe';
      try {
        const handle = await current.frameElement();
        const identity = await handle.evaluate(element => ({
          id: element.id || '',
          name: element.getAttribute('name') || '',
          testid: element.getAttribute('data-testid') || '',
          src: element.getAttribute('src') || '',
        }));
        await handle.dispose();
        if (identity.id) label = `iframe#${identity.id}`;
        else if (identity.name) label = `iframe[name=${identity.name}]`;
        else if (identity.testid) label = `iframe[data-testid=${identity.testid}]`;
        else if (identity.src) label = `iframe[src=${identity.src.slice(0, 80)}]`;
      } catch (_) {}
      result.push(label);
    }
    current = current.parentFrame();
  }
  return result.reverse();
}

async function catalogPage(page, browserScript, pageIndex) {
  const pageResult = {
    page_index: pageIndex,
    url: page.url(),
    title: '',
    frames: [],
  };
  try { pageResult.title = await page.title(); } catch (_) {}
  for (const frame of page.frames()) {
    let data = { elements: [], error: null };
    try {
      await frame.evaluate(() => {
        window.__PW_HEAL_SCAN_OPTIONS__ = {
          action: 'visible',
          maxCandidates: 300,
          mappingRules: [],
        };
      });
      data = await frame.evaluate(browserScript);
    } catch (error) {
      data = { elements: [], error: String(error.message || error) };
    }
    pageResult.frames.push({
      frame_path: await framePath(frame),
      url: frame.url(),
      elements: data.elements || [],
      error: data.error || null,
    });
  }
  return pageResult;
}

async function writeCatalog(rootPage, testInfo) {
  const rawRoot = rootPage && rootPage[RAW_PAGE] ? rootPage[RAW_PAGE] : rootPage;
  if (!rawRoot) return;
  const browserScript = loadBrowserScript();
  if (!browserScript) {
    console.warn('[walker-fixture] browser_script.js missing; final DOM catalog skipped');
    return;
  }
  let pages = [];
  try { pages = rawRoot.context().pages().filter(page => !page.isClosed()); } catch (_) {}
  if (!pages.length && !rawRoot.isClosed()) pages = [rawRoot];
  const catalog = {
    captured_at: new Date().toISOString(),
    test_title: testInfo.title,
    test_status: testInfo.status || 'unknown',
    test_file: testInfo.file || '',
    pages: [],
  };
  for (let index = 0; index < pages.length; index += 1) {
    catalog.pages.push(await catalogPage(pages[index], browserScript, index + 1));
  }
  const outputDirectory = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const title = String(testInfo.title || 'test').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 70);
  const outputPath = path.join(outputDirectory, `dom_catalog_insession_${stamp}_${title}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`[walker-fixture] wrote ${path.relative(process.cwd(), outputPath)}`);
}

// Latest healed-run evidence. When a healed spec test heals (passed or
// failed), <framework>/codegen-output/latest-healed-run/ is cleared and then
// holds exactly that test's labelled screenshots - every numbered-candidate
// PNG the healer took, one per try - with its trace and run-info.json. A heal
// that stopped before it could take any labelled screenshot brings Playwright's
// failure screenshot instead, and run-info.json says why it stopped. A test
// without a heal leaves the folder alone.
// Nothing is added to the project. fixtures/framework_location.json, written
// whenever the framework copies these fixtures, says where the framework is.
// Playwright finishes trace.zip only after every fixture has torn down, so the
// copy runs once the test is completely over: when the next test starts in
// this worker, or when the worker exits. HEAL_LATEST_EVIDENCE=false turns it
// off; the screenshots come from the heal evidence, so HEAL_TRACE_EVIDENCE=false
// leaves none to copy.
const LATEST_EVIDENCE_FOLDER = 'latest-healed-run';
const LATEST_EVIDENCE_REPLACE_ATTEMPTS = 25;
const LABELLED_SCREENSHOT_ATTACHMENT = /^heal (\d+) - (.*numbered-candidates\.png)$/i;
let pendingLatestEvidence = null;

function isHealedSpecTest(testInfo) {
  const root = (testInfo.project && testInfo.project.testDir) || process.cwd();
  const relative = path.relative(root, String(testInfo.file || '')).replace(/\\/g, '/');
  return relative.startsWith('healed/') || /\.healed\.spec\.[cm]?[jt]sx?$/i.test(relative);
}

function latestEvidenceDirectory() {
  if (/^(0|false|off|no)$/i.test(String(process.env.HEAL_LATEST_EVIDENCE || '').trim())) return null;
  const override = String(process.env.HEAL_LATEST_EVIDENCE_DIR || '').trim();
  if (override) return path.resolve(override);
  try {
    const location = JSON.parse(fs.readFileSync(path.join(__dirname, 'framework_location.json'), 'utf8'));
    const codegenOutput = location && location.codegenOutputDir;
    // Only a framework that exists on this machine; never create one elsewhere.
    if (codegenOutput && fs.statSync(codegenOutput).isDirectory()) {
      return path.join(codegenOutput, LATEST_EVIDENCE_FOLDER);
    }
  } catch (_) {}
  return null;
}

function rememberLatestEvidence(testInfo) {
  try {
    if (!isHealedSpecTest(testInfo) || !latestEvidenceDirectory()) return;
    pendingLatestEvidence = { testInfo, endedAt: new Date().toISOString() };
  } catch (_) {}
}

// Why a heal stopped, in the healer's own terms only. The raw reason is not
// copied: when the model declined, it carries the model's words.
const HEAL_STOP_EXPLANATIONS = {
  HEAL_CAPTURE_INCOMPLETE: 'Part of the page was still cut off by a scrolling panel, so the healer refused to send an incomplete picture.',
  HEAL_DOM_UNSTABLE: 'The page kept changing and never settled long enough to be captured.',
  HEAL_CAPTURE_STALE: 'The page changed while the healer was capturing it.',
  HEAL_CAPTURE_GEOMETRY: 'The page kept changing size or position during the capture.',
  HEAL_CAPTURE_RESTORE: 'The page layout could not be restored after the capture.',
  HEAL_SCAN_FAILED: 'The scan for candidate elements could not finish.',
  HEAL_NO_SUITABLE_TARGET: 'The AI did not pick any element with enough confidence.',
};
// When the AI DID pick, but the healer refused the pick (more exact than the code).
const HEAL_STOP_DETAILS = {
  'exact-name-different': 'The AI picked an element, but the step asks for an exact name (exact: true) and the picked element has a different name, so the healer refused it.',
  'exact-name-ambiguous': 'The AI picked an element whose name is a shortened form of the exact name the step asks for, but more than one element on the page has such a name, so the healer refused to guess.',
  'exact-name-shortened-not-accepted': 'The AI picked an element whose name is a shortened form of the exact name the step asks for; that is accepted only when it is the single such element of the requested kind, which could not be confirmed here.',
};

// Every heal in this test, numbered 1, 2, ... in the order it happened (the
// healer's own counter runs on across tests), with its labelled screenshots
// in the order they were taken and its outcome from its summary.
function healEvidenceOf(testInfo) {
  const attachments = Array.isArray(testInfo.attachments) ? testInfo.attachments : [];
  const healOrder = [];
  const healNumberOf = original => {
    if (!healOrder.includes(original)) healOrder.push(original);
    return healOrder.indexOf(original) + 1;
  };
  const summaries = new Map();
  const shots = [];
  for (const item of attachments) {
    const name = String((item && item.name) || '');
    const healMatch = /^heal (\d+) - /i.exec(name);
    if (!healMatch) continue;
    const heal = healNumberOf(healMatch[1]);
    if (/ - summary$/i.test(name) && item.body) {
      try {
        const summary = JSON.parse(Buffer.from(item.body).toString('utf8'));
        const outcome = summary.outcome || {};
        summaries.set(heal, {
          heal,
          step: summary.step || null,
          healResult: outcome.status || null,
          stopCode: outcome.status === 'healed' ? null : (outcome.code || null),
          stopDetail: outcome.status === 'healed' ? null : (outcome.detail || null),
          // The step's exact name, and the shortened name it was found under.
          renamed: outcome.name_check && outcome.name_check.rule === 'shortened-exact-name'
            ? { from: String(outcome.name_check.exact_name || ''), to: String(outcome.name_check.chosen_name || '') } : null,
          partialPicture: Boolean(summary.capture && summary.capture.partial_picture),
          // Counts only: how many hidden elements the model asked to see, and
          // how many the close-up could show (the close-up is a labelled try).
          closeUps: (Array.isArray(summary.close_up) ? summary.close_up : []).map(look => ({
            askedToSee: Array.isArray(look.asked_to_see) ? look.asked_to_see.length : 0,
            shown: (Array.isArray(look.tiles) ? look.tiles : []).filter(tile => tile.kind === 'hidden' && tile.status === 'shown').length,
          })),
        });
      } catch (_) {}
      continue;
    }
    const shotMatch = LABELLED_SCREENSHOT_ATTACHMENT.exec(name);
    if (!shotMatch || !(item.body || item.path)) continue;
    const tryNumber = shots.filter(shot => shot.heal === heal).length + 1;
    shots.push({ heal, try: tryNumber, file: `heal-${heal}-try-${tryNumber}.png`, shot: shotMatch[2], body: item.body || null, path: item.path || null });
  }
  for (const shot of shots) {
    const summary = summaries.get(shot.heal) || {};
    shot.step = summary.step || null;
    shot.healResult = summary.healResult || null;
  }
  const heals = [...summaries.values()].sort((a, b) => a.heal - b.heal).map(summary => ({
    ...summary,
    labelledScreenshots: shots.filter(shot => shot.heal === summary.heal).length,
    whyItStopped: summary.stopCode
      ? (HEAL_STOP_DETAILS[summary.stopDetail] || HEAL_STOP_EXPLANATIONS[summary.stopCode] || 'See the heal summary in the trace for details.') : null,
  }));
  return { shots, heals };
}

function sleepSync(milliseconds) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); } catch (_) {}
}

// Moves the staged file into place (or removes the file when there is no
// staged one), retrying while a viewer or OneDrive briefly holds it.
function replaceLatestFile(directory, name, stagedFile) {
  const finalFile = path.join(directory, name);
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (stagedFile) fs.renameSync(stagedFile, finalFile);
      else fs.rmSync(finalFile, { force: true });
      return null;
    } catch (error) {
      if (attempt >= LATEST_EVIDENCE_REPLACE_ATTEMPTS) {
        if (stagedFile) { try { fs.rmSync(stagedFile, { force: true }); } catch (_) {} }
        return `${name} could not be ${stagedFile ? 'replaced' : 'removed'} (${error.code || error.message}); is it open somewhere?`;
      }
      sleepSync(200);
    }
  }
}

// Synchronous, so it also works from the worker's 'exit' event.
function publishLatestEvidence() {
  const evidence = pendingLatestEvidence;
  pendingLatestEvidence = null;
  if (!evidence) return;
  try {
    const { testInfo } = evidence;
    const { shots, heals } = healEvidenceOf(testInfo);
    // No heal in this test: nothing new comes over, the folder stays as it is.
    if (!shots.length && !heals.length) return;
    const directory = latestEvidenceDirectory();
    if (!directory) return;
    fs.mkdirSync(directory, { recursive: true });
    const stamp = `${process.pid}-${Date.now()}`;
    const staged = {};
    const problems = [];
    const stage = (name, write) => {
      const file = path.join(directory, `${name}.staging-${stamp}`);
      try {
        write(file);
        staged[name] = file;
      } catch (error) {
        problems.push(`${name} could not be saved (${error.code || error.message})`);
        try { fs.rmSync(file, { force: true }); } catch (_) {}
      }
    };
    const existingFile = file => {
      try { return file && fs.statSync(file).isFile() ? file : null; } catch (_) { return null; }
    };
    const attachments = Array.isArray(testInfo.attachments) ? testInfo.attachments : [];
    const lastAttachmentPath = name => attachments.filter(item => item && item.name === name && item.path).map(item => item.path).pop();
    const traceFile = existingFile(lastAttachmentPath('trace')) || existingFile(path.join(testInfo.outputDir || '', 'trace.zip'));
    for (const shot of shots) {
      stage(shot.file, file => (shot.body
        ? fs.writeFileSync(file, Buffer.isBuffer(shot.body) ? shot.body : Buffer.from(shot.body))
        : fs.copyFileSync(shot.path, file)));
    }
    // A heal that stopped before any labelled screenshot - the only heal, or
    // one after others that did take theirs: Playwright's own picture of the
    // page when the test failed (one per open tab).
    const stoppedWithoutPicture = heals.filter(heal => heal.labelledScreenshots === 0 && heal.healResult !== 'healed');
    const failureScreenshots = shots.length && !stoppedWithoutPicture.length ? [] : attachments
      .filter(item => item && item.name === 'screenshot' && existingFile(item.path))
      .map((item, index, all) => ({ source: item.path, file: all.length === 1 ? 'failure-screenshot.png' : `failure-screenshot-${index + 1}.png` }));
    for (const shot of failureScreenshots) stage(shot.file, file => fs.copyFileSync(shot.source, file));
    if (traceFile) stage('trace.zip', file => fs.copyFileSync(traceFile, file));
    // Clear everything the previous test left - its screenshots, trace and
    // info - then move this test's set in.
    // (Types come from the listing itself: a file a viewer holds open cannot
    // always be stat'ed, and it must be reported, not silently kept.)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith(`.staging-${stamp}`)) continue;
      const problem = replaceLatestFile(directory, entry.name, null);
      if (problem) problems.push(problem);
    }
    for (const name of Object.keys(staged)) {
      const problem = replaceLatestFile(directory, name, staged[name]);
      if (problem) problems.push(problem);
    }
    const saved = name => Boolean(staged[name]) && !problems.some(item => item.startsWith(`${name} `));
    const root = (testInfo.project && testInfo.project.testDir) || process.cwd();
    const info = {
      spec: path.relative(root, String(testInfo.file || '')).replace(/\\/g, '/'),
      test: testInfo.title,
      browser: (testInfo.project && testInfo.project.name) || null,
      status: testInfo.status || 'unknown',
      retry: testInfo.retry || 0,
      endedAt: evidence.endedAt,
      projectFolder: root,
      heals,
      labelledScreenshots: shots.filter(shot => saved(shot.file)).map(shot => ({
        file: shot.file, heal: shot.heal, try: shot.try, step: shot.step, healResult: shot.healResult, shot: shot.shot,
      })),
      failureScreenshots: failureScreenshots.filter(shot => saved(shot.file)).map(shot => shot.file),
      note: !stoppedWithoutPicture.length ? null : !shots.length
        ? 'The heal stopped before it could take a labelled screenshot, so this is Playwright\'s screenshot of the page when the test failed.'
        : `Heal ${stoppedWithoutPicture.map(heal => heal.heal).join(', ')} stopped before it could take a labelled screenshot; the failure screenshot is Playwright's picture of the page when the test failed.`,
      trace: saved('trace.zip') ? 'trace.zip' : null,
      problems,
    };
    stage('run-info.json', file => fs.writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`, 'utf8'));
    replaceLatestFile(directory, 'run-info.json', staged['run-info.json'] || null);
  } catch (_) {}
}

process.on('exit', publishLatestEvidence);

exports.test = base.extend({
  page: async ({ page, testIdAttribute }, use, testInfo) => {
    // The previous test in this worker is completely over by now.
    publishLatestEvidence();
    beginHealedSpecRun(testInfo.file);
    const healingPage = createHealingPage(page, testInfo, { testIdAttribute });
    // This catalog was diagnostic-only and persisted page data after the test.
    // Visual healing performs its own live DOM scan only when recovery is needed.
    await use(healingPage);
    rememberLatestEvidence(testInfo);
  },
});

exports.expect = createHealingExpect(baseExpect);

