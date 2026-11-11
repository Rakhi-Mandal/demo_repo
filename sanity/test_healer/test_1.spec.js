import { test, expect } from '@playwright/test';
import testData from '../../test-data.json';

test("sign in with email button and focus password input [test_case_key: TC-102] @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.locator("xpath=//button[@data-cy='btnLoginVisible']");
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const passwordInput = page.locator("xpath=//input[@name='password']");
  await expect(passwordInput).toBeEnabled();
  await passwordInput.click();

});

