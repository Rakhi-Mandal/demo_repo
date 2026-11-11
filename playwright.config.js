// Before every step of every spec: wait until the page and its element are ready (fixtures/stability.cjs; STABILITY=off switches it off).
try { require('./fixtures/stability.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

const { defineConfig } = require('@playwright/test');
const os = require('node:os');

module.exports = defineConfig({
  testDir: '.',
  // Tests: the spec files in sanity/ and regression/ (child suites too) and General ones (tests/, and *.spec.js
  // directly in this folder). Helper files - fixtures/ and the rest - never count as tests.
  testMatch: new RegExp('^' + require('path').resolve(__dirname).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + String.raw`[\\/](?:(?:sanity|regression|tests)[\\/].+\.js|[^\\/]+\.spec\.js)$`, 'i'),
  testIgnore: [
    '**/node_modules/**',
    '**/healed/**',
    '**/allure-results/**',
    '**/allure-report/**',
    '**/test-results/**',
    '**/fixtures/**',
    '**/utils/**'
  ],

  timeout: 120000,

  expect: {
    timeout: 1200000
  },

  outputDir: 'test-results',

  reporter: [
    ['line'],
    ['json', {
      outputFile: 'test-results/report.json'
    }],
    ['html', {
      outputFolder: 'playwright-report',
      open: 'never'
    }],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          Project: 'Playwright Automation',
          Environment: process.env.TEST_ENV || 'QA',
          Browser: process.env.BROWSER || 'Chromium',
          OperatingSystem: `${os.platform()} ${os.release()}`,
          NodeVersion: process.version,
          BuildNumber: process.env.BUILD_NUMBER || 'Local'
        },

      }
    ],
    [
      './fixtures/allure_html_reporter.js',
      {
        resultsDir: 'allure-results',
        outputFolder: 'allure-report'
      }
    ]
  ],

  use: {
    actionTimeout: 60000,
    navigationTimeout: 60000,
    headless: process.env.HEADLESS !== 'false',
    screenshot: 'only-on-failure',
    slowMo: 30000,
    trace: 'on'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: 'chrome'
      }
    },
    {
      name: 'msedge',
      use: {
        browserName: 'chromium',
        channel: 'msedge'
      }
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox'
      }
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit'
      }
    }
  ]
});
