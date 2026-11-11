
import { defineConfig } from 'allure';

export default defineConfig({
  name: 'Playwright Automation Dashboard',

  output: './allure-report',

  historyPath: './allure-history.jsonl',

  plugins: {
    awesome: {
      options: {
        reportName: 'QA Automation Execution Report',
        theme: 'dark',
        reportLanguage: 'en',
        singleFile: false,

        // Group using the hierarchy supplied by the adapter
        groupBy: [
          'parentSuite',
          'suite',
          'subSuite'
        ]
      }
    }
  }
});
