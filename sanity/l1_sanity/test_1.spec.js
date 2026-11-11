import { test, expect } from '@playwright/test';
import testData from '../../test-data.json';

test("sign in with email button and focus password input [test_case_key: TC-102] @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.locator("xpath=//button[@data-cy='btnLoginVisible']");
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const passwordInput = page.locator("xpath=//input[@name='pass']");
  await expect(passwordInput).toBeEnabled();
  await passwordInput.click();

});

test("Test case id: TC-103 - sign in with email flow  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const emailFieldContainer = page.locator("xpath=//form[@action='" + String(testData.xpathUrl1) + "']/div[1]/div[1]/div[1]/div[1]/ui-field[1]/div[2]");
  await expect(emailFieldContainer).toBeEnabled();
  await emailFieldContainer.click();

  const emailInput = page.locator("xpath=//input[@name='email']");
  await expect(emailInput).toBeEditable();
  await emailInput.fill(testData.email);

});
