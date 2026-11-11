const { test, expect } = require('../../../fixtures/walker_fixture.js');
import testData from '../../../test-data.json';

test("Test case id: TC-104 - sign in with email button click  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

});

test("Test case id: TC-105 - sign in with email button and focus password input  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const passwordInput = page.locator("xpath=//input[@name='password']");
  await expect(passwordInput).toBeEnabled();
  await passwordInput.click();

});

test("Test case id: TC-106 - sign in with email button double click  @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const signInWithEmailButtonAfterFirstClick = page.getByRole('button', { name: 'Sign in with Email' });
  await expect(signInWithEmailButtonAfterFirstClick).toBeEnabled();
  await signInWithEmailButtonAfterFirstClick.click();

});
