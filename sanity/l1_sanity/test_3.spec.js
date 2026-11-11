import { test, expect } from '@playwright/test';
import testData from '../../test-data.json';

test("Test case id: TC-108 - sign in and navigate sidebar sections  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const emailInput = page.locator("xpath=//input[@type='email']");
  await expect(emailInput).toBeEditable();
  await emailInput.fill(testData.email);

  const passwordInput = page.locator("xpath=//input[@name='password']");
  await expect(passwordInput).toBeEditable();
  await passwordInput.fill(testData.password);

  const signInWithEmailButtonAfterFill = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButtonAfterFill).toBeEnabled();
  await signInWithEmailButtonAfterFill.click();

  const estimatingPricingButton = page.locator("xpath=//nav[@data-cy='sidebarDesktop']//button[contains(concat(' ', normalize-space(@class), ' '), ' overflow-hidden ') and normalize-space(.)='Estimating & Pricing']");
  await expect(estimatingPricingButton).toBeEnabled();
  await estimatingPricingButton.click();

  const itemsButton = page.locator("xpath=//nav[@data-cy='sidebarDesktop']//button[contains(concat(' ', normalize-space(@class), ' '), ' overflow-hidden ') and normalize-space(.)='Items']");
  await expect(itemsButton).toBeEnabled();
  await itemsButton.click();

  const materialsSuppliesButton = page.locator("xpath=//nav[@data-cy='sidebarDesktop']//button[contains(concat(' ', normalize-space(@class), ' '), ' overflow-hidden ') and normalize-space(.)='Materials & Supplies']");
  await expect(materialsSuppliesButton).toBeEnabled();
  await materialsSuppliesButton.click();

  const unitTemplatesButton = page.locator("xpath=//nav[@data-cy='sidebarDesktop']//button[contains(concat(' ', normalize-space(@class), ' '), ' overflow-hidden ') and normalize-space(.)='Unit Templates']");
  await expect(unitTemplatesButton).toBeEnabled();
  await unitTemplatesButton.click();

});
