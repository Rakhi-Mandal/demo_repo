// Before every step of every spec: wait until the page and its element are ready (fixtures/stability.cjs; STABILITY=off switches it off).
try { require('./fixtures/stability.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const { defineConfig } = require('@playwright/test');

 module.exports = defineConfig({
  testDir: '.',
  // Tests: the healed copies in healed/, and the spec files playwright.config.js runs (sanity/, regression/,
  // General), so a run with both finds them all. Helper files - fixtures/ and the rest - never count as tests.
  testMatch: new RegExp('^' + require('path').resolve(__dirname).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + String.raw`[\\/](?:(?:healed|sanity|regression|tests)[\\/].+\.js|[^\\/]+\.spec\.js)$`, 'i'),
  timeout: 120000,           
  expect: {
    timeout: 1200000         
  },
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/report.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
    ['./fixtures/allure_html_reporter.js', { resultsDir: 'allure-results', outputFolder: 'allure-report' }],
  ], 
  use: {
    actionTimeout: 60000,     
    navigationTimeout: 60000,
    headless: process.env.HEADLESS !== 'false',
    screenshot: 'only-on-failure',
    slowMo: 30000,
    trace: 'on',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'msedge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
