import { test, expect } from '@playwright/test';
import testData from '../../test-data.json';

test("Test case id: TC-0099 - sign in with email button click  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.locator("xpath=//button[@data-cy='btnLoginVisible']");
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

    await expect(page.locator('input[name="email"]')).toBeEnabled();
    await page.locator('input[name="email"]').click();
    await expect(page.locator('input[name="email"]')).toBeEditable();
    await page.locator('input[name="email"]').fill(testData.email);
   
    await expect(page.locator('input[name="password"]')).toBeEnabled();
    await page.locator('input[name="password"]').click();
    await expect(page.locator('input[name="password"]')).toBeEditable();
    await page.locator('input[name="password"]').fill(testData.password);
   
    await expect(page.getByRole('button', { name: 'Sign in with Email' })).toBeEnabled();
    await page.getByRole('button', { name: 'Sign in with Email' }).click();

});
