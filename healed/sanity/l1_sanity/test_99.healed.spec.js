const { test, expect } = require('../../../fixtures/walker_fixture.js');
import testData from '../../../test-data.json';

test("sign in with email button and focus inputs @sanity", async ({ page }) => {
  await page.goto(testData.url);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const emailInput = page.locator("xpath=//input[@name='email id']");
  await expect(emailInput).toBeEnabled(); 
  await emailInput.click();

  const passwordInput = page.locator("xpath=//input[@name='password now']");
  await expect(passwordInput).toBeEnabled();
  await passwordInput.click();

});
