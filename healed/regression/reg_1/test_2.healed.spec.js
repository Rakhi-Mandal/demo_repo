const { test, expect } = require('../../../fixtures/walker_fixture.js');
import testData from '../../../test-data.json';

test("sign in with email button and password input click [test_case_key: TC-0095] @regression", async ({ page }) => {
  await page.goto(testData.url);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

});
