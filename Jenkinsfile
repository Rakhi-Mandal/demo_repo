// Jenkinsfile for a PRIVATE repository.
//
// Where the credentials go depends on how the job reads this file:
//
//  A) "Pipeline script from SCM" (what the Qualibrix app creates): the credentials belong
//     to the JOB (Configure > Pipeline > Credentials; the app sets them when
//     JENKINS_GIT_CREDENTIALS_ID is set). Jenkins uses them to fetch this file AND to
//     clone the workspace. Leave REPO_URL empty: the 'Checkout' stage then runs
//     'checkout scm', which reuses the job's credentials.
//
//  B) "Pipeline script" (pasted into the job), or this file loaded from a different
//     repository than the code: the job cannot clone the code for you. Fill in
//     REPO_URL, BRANCH and GIT_CREDENTIALS_ID and the 'Checkout' stage clones it with
//     that credentials entry.
//
// GIT_CREDENTIALS_ID is only the ID of an entry stored in Jenkins (Manage Jenkins >
// Credentials): "Username with password" (user + app password / personal access
// token) for an https:// address, or "SSH Username with private key" for an ssh:// or
// git@ address. No password or token is ever written in this file or in a parameter.

pipeline {
  agent any

  options {
    timestamps()
    // The 'Checkout' stage below does the clone, so it can use the credentials.
    skipDefaultCheckout(true)
  }

  parameters {
    choice(
      name: 'EXECUTION_MODE',
      choices: ['suite', 'spec'],
      description: 'suite runs sanity/regression roots; spec runs selected folders or files'
    )
    choice(
      name: 'BROWSER',
      choices: ['chromium', 'msedge', 'firefox', 'webkit'],
      description: 'Playwright project name; one browser per run'
    )
    booleanParam(
      name: 'HEADED',
      defaultValue: false,
      description: 'Run browser in headed mode'
    )
    string(
      name: 'TARGET',
      defaultValue: 'regression',
      description: 'Comma-separated suite folders, nested folders, or spec paths'
    )
    string(
      name: 'PROJECT_ID',
      defaultValue: '',
      description: 'Database project ID used to resolve dynamic test data'
    )
    string(
      name: 'QUALIBRIX_API_URL',
      defaultValue: '',
      description: 'Backend base URL for dynamic test-data preparation'
    )
    string(
      name: 'REPO_URL',
      defaultValue: '',
      description: 'Only for an inline pipeline script, or a Jenkinsfile kept apart from the code. Repository address to clone. Leave empty when the job reads this file from the repository (SCM).'
    )
    string(
      name: 'BRANCH',
      defaultValue: 'main',
      description: 'Branch to clone when REPO_URL is set'
    )
    string(
      name: 'GIT_CREDENTIALS_ID',
      defaultValue: '',
      description: 'ID of the Jenkins credentials entry for the private repository, used when REPO_URL is set'
    )
  }

  stages {
    stage('Checkout') {
      steps {
        script {
          def repoUrl = (params.REPO_URL ?: '').trim()
          if (repoUrl) {
            def credentialsId = (params.GIT_CREDENTIALS_ID ?: '').trim()
            if (!credentialsId) {
              echo 'GIT_CREDENTIALS_ID is empty: cloning without credentials, which only works for a public repository.'
            }
            def branch = (params.BRANCH ?: 'main').trim()
            checkout([
              $class: 'GitSCM',
              branches: [[name: "*/${branch}"]],
              userRemoteConfigs: [[url: repoUrl, credentialsId: credentialsId]],
              extensions: [[$class: 'CleanBeforeCheckout']]
            ])
          } else {
            // The job's own repository and credentials.
            checkout scm
          }
        }
      }
    }

    stage('Install') {
      steps {
        script {
          if (isUnix()) {
            sh 'node --version && npm --version && npm ci'
            sh "npx playwright install --with-deps ${params.BROWSER}"
          } else {
            bat 'node --version && npm --version && npm ci'
            bat "npx playwright install ${params.BROWSER}"
          }
        }
      }
    }

    stage('Prepare Dynamic Test Data') {
      steps {
        script {
          // NOTE: the embedded script intentionally contains NO backslashes,
          // so Groovy string escaping cannot alter it.
          writeFile file: '.jenkins/prepare-dynamic-test-data.cjs', text: '''\
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const projectId = process.env.PROJECT_ID || '';
  let apiBase = process.env.QUALIBRIX_API_URL || '';
  while (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1);

  if (!projectId || !apiBase) {
    console.log('Dynamic test-data preparation skipped: PROJECT_ID or QUALIBRIX_API_URL is missing.');
    return;
  }

  const ignored = new Set([
    '.git', 'node_modules', 'test-results', 'playwright-report',
    'allure-results', 'allure-report', '.jenkins'
  ]);
  const files = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) walk(path.join(directory, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.test-data.json')) {
        files.push(path.join(directory, entry.name));
      }
    }
  }

  walk(process.cwd());

  const rootPayload = path.join(process.cwd(), 'test-data.json');
  if (fs.existsSync(rootPayload)) files.push(rootPayload);

  const endpoint = apiBase + '/api/projects/dynamic-test-data';

  for (const file of [...new Set(files)]) {
    let source = fs.readFileSync(file, 'utf8');
    if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);
    const payload = JSON.parse(source);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, payload })
    });

    if (!response.ok) {
      throw new Error('Dynamic test-data API returned HTTP ' + response.status + ' for ' + file);
    }

    const result = await response.json();
    if (!Object.prototype.hasOwnProperty.call(result, 'payload')) {
      throw new Error('Dynamic test-data API response has no payload for ' + file);
    }

    fs.writeFileSync(file, JSON.stringify(result.payload, null, 2) + os.EOL, 'utf8');
    console.log('Applied DB-backed dynamic test data to ' + path.relative(process.cwd(), file));
  }

  if (!files.length) console.log('No dynamic test-data files found.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
'''
          if (isUnix()) {
            sh 'node .jenkins/prepare-dynamic-test-data.cjs'
          } else {
            bat 'node .jenkins/prepare-dynamic-test-data.cjs'
          }
        }
      }
    }

    stage('Clean Previous Reports') {
      steps {
        script {
          // Removes the previous build's Allure results and reports from a reused
          // workspace, so this build's reports show only this build's tests.
          // allure-results/history is kept: it carries the trend graphs forward.
          // NOTE: the embedded script intentionally contains NO backslashes.
          writeFile file: '.jenkins/clean-previous-reports.cjs', text: '''\
const fs = require('node:fs');

const resultsDir = 'allure-results';
let removed = 0;
if (fs.existsSync(resultsDir)) {
  for (const name of fs.readdirSync(resultsDir)) {
    if (name === 'history') continue;
    fs.rmSync(resultsDir + '/' + name, { recursive: true, force: true });
    removed += 1;
  }
}
for (const folder of ['allure-report', 'playwright-report']) {
  fs.rmSync(folder, { recursive: true, force: true });
}
console.log('Cleared ' + removed + ' old Allure result file(s); kept allure-results/history for trends.');
'''
          if (isUnix()) {
            sh 'node .jenkins/clean-previous-reports.cjs'
          } else {
            bat 'node .jenkins/clean-previous-reports.cjs'
          }
        }
      }
    }

    stage('Run Tests') {
      steps {
        script {
          def targets = (params.TARGET ?: '')
            .split(',')
            .collect { it.trim().replace('\\', '/') }
            .findAll { it }

          def browser = (params.BROWSER ?: '').trim()

          if (!targets) {
            error('TARGET must contain at least one folder or spec path.')
          }

          for (target in targets) {
            if (!target.matches('[A-Za-z0-9_./-]+') ||
                target.split('/').any { it == '..' }) {
              error("Unsupported TARGET path: ${target}")
            }
          }

          if (!(browser in ['chromium', 'msedge', 'firefox', 'webkit'])) {
            error("Unsupported Playwright browser: ${browser}")
          }

          if (params.EXECUTION_MODE == 'suite' &&
              targets.any { !(it in ['sanity', 'regression']) }) {
            error('Suite mode accepts only sanity or regression targets.')
          }

          def targetArgs = targets.collect { "\"${it}\"" }.join(' ')
          def headedArg = params.HEADED ? ' --headed' : ''
          def command = "npx playwright test ${targetArgs} --project=${browser}${headedArg}"

          // withEnv on both platforms: a Windows 'set X=never && ...' keeps the
          // space before && in the value ("never ").
          withEnv(['PLAYWRIGHT_HTML_OPEN=never']) {
            if (isUnix()) {
              sh(label: 'Run selected Playwright tests', script: command)
            } else {
              bat(label: 'Run selected Playwright tests', script: command)
            }
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts(
        artifacts: 'test-results/**,playwright-report/**,allure-results/**,allure-report/**',
        allowEmptyArchive: true
      )

      // The Run summary as plain HTML (counts, charts, per-module and per-spec tables,
      // failures). It has no script, style or stylesheet, so it shows under Jenkins's
      // DEFAULT security policy, which blocks all three.
      publishHTML([
        reportDir: 'allure-report',
        reportFiles: 'run-summary.html',
        reportName: 'Qualibrix Run Summary',
        keepAll: true,
        alwaysLinkToLastBuild: true,
        allowMissing: true
      ])

      // The full Qualibrix Allure report (Run summary menu page, modules, healed-locator
      // blocks, executor). It is built with scripts, so it stays blank until Jenkins
      // allows them (Resource Root URL or a relaxed policy).
      publishHTML([
        reportDir: 'allure-report',
        reportFiles: 'index.html',
        reportName: 'Allure Report (Qualibrix)',
        keepAll: true,
        alwaysLinkToLastBuild: true,
        allowMissing: true
      ])

      publishHTML([
        reportDir: 'playwright-report',
        reportFiles: 'index.html',
        reportName: 'Playwright HTML Report',
        keepAll: true,
        alwaysLinkToLastBuild: true,
        allowMissing: true
      ])

      // The Jenkins Allure plugin builds its report from allure-results. This writes
      // the Qualibrix customizations into that folder first: module / spec-file
      // labels (Suites and Behaviors tabs), healed-locator blocks and tags, and the
      // run + per-module counts as "Qualibrix.*" lines in the Environment panel.
      // Lines already in environment.properties are kept, and it is safe to run again.
      script {
        def customize = 'node fixtures/allure_html_reporter.js --customize-results allure-results'
        if (isUnix()) {
          sh(script: customize, returnStatus: true)
        } else {
          bat(script: customize, returnStatus: true)
        }
      }

      // The Jenkins Allure plugin's own report (needs the Allure commandline tool
      // on the agent), now with the customizations written above.
      allure([
        includeProperties: false,
        jdk: '',
        results: [[path: 'allure-results']]
      ])
    }
  }
}
