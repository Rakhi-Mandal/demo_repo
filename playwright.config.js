const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '**/*.js',
  testIgnore: '**/healed/**',
  timeout: 120000,           
  expect: {
    timeout: 1200000         
  },
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/report.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
  ],
  use: {
    actionTimeout: 60000,     
    navigationTimeout: 60000,
    headless: process.env.HEADLESS !== 'false',
    screenshot: 'only-on-failure',
    slowMo: 30000,
    // slowMo REMOVED — was adding 60s pause before every action
    trace: 'on',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'msedge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
