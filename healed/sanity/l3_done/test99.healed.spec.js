const { test, expect } = require('../../../fixtures/walker_fixture.js');
import testData from '../../../test-data.json';

test("sign in with email button and focus password input [test_case_key: TC-102] @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const passwordInput = page.locator("xpath=//input[@name='pass']");
  await expect(passwordInput).toBeEnabled();
  await passwordInput.click();

});

test("Test case id: TC-103 - sign in with email and toggle password visibility  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const togglePasswordVisibilityButton = page.getByRole('button', { name: 'Toggle password visibility' });
  await expect(togglePasswordVisibilityButton).toBeEnabled();
  await togglePasswordVisibilityButton.click();

});

test("Test case id: TC-0098 - sign in with email, toggle remember me  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const emailInput = page.locator("xpath=//input[@name='email_id']");
  await expect(emailInput).toBeEnabled();
  await emailInput.click();

  const rememberMeText = page.getByText('Remember me', { exact: true });
  await expect(rememberMeText).toBeEnabled();
  await rememberMeText.click();

  const rememberMeCheckbox = page.getByRole('checkbox', { name: 'Remember me' });
  await expect(rememberMeCheckbox).toBeEnabled();
  await rememberMeCheckbox.click();

});
