const { defineConfig } = require('@playwright/test');
const os = require('os');

module.exports = defineConfig({
  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          Project: 'Playwright Automation',
          Environment: process.env.TEST_ENV || 'QA',
          Browser: 'Chromium',
          OS: `${os.platform()} ${os.release()}`,
          NodeVersion: process.version,
        },
      },
    ],
  ],

  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});