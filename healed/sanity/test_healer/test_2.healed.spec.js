// Create a Product Item from Estimate show, then add a route to that item
import testData from '../../../test-data.json';
import { test, expect } from '@playwright/test';
// const { prepareSession } = require('../../helpers/sessionData');

test('Create Product Item from Estimate @regression @set1 @mainflow', async ({ page }) => {
//   const session = prepareSession({ force: true });
//   Object.assign(testData, session);
//   console.log(`[data] Creation override → nameRequired: ${session.nameRequired}`);

  await page.goto(testData.url);
  await page.waitForLoadState('domcontentloaded');

  const signInWithEmailButton = page.locator('[data-cy="btnLoginVisible"]');
  await expect(signInWithEmailButton).toBeEnabled();
  await signInWithEmailButton.click();

  const emailInput = page.locator('input[name="email"][type="email"]');
  await expect(emailInput).toBeVisible();
  await expect(emailInput).toBeEditable();
  await emailInput.fill(testData.email);

  const passwordInput = page.locator('input[name="password"][type="password"]');
  await expect(passwordInput).toBeVisible();
  await expect(passwordInput).toBeEditable();
  await passwordInput.fill(testData.password);

  const signInConfirmButton = page.locator('[data-cy="btnLoginConfirm"]');
  await expect(signInConfirmButton).toBeEnabled();
  await signInConfirmButton.click();

  const estimateMenuLink = page.locator('(//button[normalize-space()="Estimating & Pricing"])[1]');
  await expect(estimateMenuLink).toBeVisible();
  await estimateMenuLink.click();

  const estimatesQuotesLink = page.getByRole('link', {
    name: 'Estimates/Quotes',
    exact: true
  });
  await expect(estimatesQuotesLink).toBeVisible();
  await expect(estimatesQuotesLink).toBeEnabled();
  await estimatesQuotesLink.click();

  await page.waitForLoadState('domcontentloaded');

  const newEstimateLink = page.getByRole('link', { name: 'New Estimate', exact: true });
  await expect(newEstimateLink).toBeVisible();

  const filtersButton = page.getByRole('button', { name: 'Filters 0', exact: true });
  await expect(filtersButton).toBeEnabled();
  await filtersButton.click();

  const columnSelect = page.locator('select[data-flux-select-native][x-model="selection.column"]').first();
  await columnSelect.selectOption('status');

  const operatorSelect = page.locator("xpath=//div[normalize-space(.)='Operator is equal tocontains']//select");
  await operatorSelect.selectOption('is equal to');

  const valueSelect = page.locator("xpath=//option[normalize-space(.)='Value']/ancestor::select");
  await valueSelect.selectOption('draft');

  const applyButton = page.getByRole('button', { name: 'Apply', exact: true });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  await expect(page.getByRole('button', { name: 'Filters 1', exact: true })).toBeVisible();

  const firstEstimateCell = page.locator('//tbody//tr[1]//td[2]');
  await expect(firstEstimateCell).toBeVisible();
  await expect(firstEstimateCell).toContainText(/EST\d+/);
  const cellText = (await firstEstimateCell.textContent()) || '';
  const estimateNumber = cellText.match(/EST\d+/)[0];
  console.log(`[data] estimateNumber: ${estimateNumber}`);
  await firstEstimateCell.click();
  await page.waitForTimeout(2000);

  const estimateHeading = page.locator('span').filter({ hasText: `${estimateNumber} - Estimate` }).first();
  await expect(estimateHeading).toBeVisible();

  const linksTabButton = page.locator('[data-cy="hub-tab-links"]');
  await expect(linksTabButton).toBeVisible();
  await expect(linksTabButton).toBeEnabled();
  await linksTabButton.click();

  const createProductItemButton = page.locator('button[x-tooltip="Create Product Item"]');
  await expect(createProductItemButton).toBeVisible();
  await expect(createProductItemButton).toBeEnabled();
  await createProductItemButton.click();

  const createNewProductItemOption = page.locator('div').filter({ hasText: 'Create new Product Item Create a brand new product item with workflow from this estimate' }).first();
  await expect(createNewProductItemOption).toBeVisible();
  await expect(createNewProductItemOption).toBeEnabled();
  await createNewProductItemOption.click();

  const createNewProductItemDesc = page.locator('p').filter({ hasText: 'Create a brand new product item with workflow from this estimate' }).first();
  await expect(createNewProductItemDesc).toBeVisible();
  await expect(createNewProductItemDesc).toBeEnabled();
  await createNewProductItemDesc.click();

  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  const modelCodeDiv = page.locator('div').filter({ hasText: `Model Code: ${estimateNumber}` }).first();
  await expect(modelCodeDiv).toBeVisible();

  const createProductItemFinalButton = page.getByRole('button', { name: 'Create Product Item', exact: true });
  await expect(createProductItemFinalButton).toBeEnabled();
  await createProductItemFinalButton.click();

  const productItemHeading = page.locator('//div[contains(text(),"-Product Item")]').first();
  await expect(productItemHeading).toBeVisible();
  const productItemText = (await productItemHeading.innerText()).trim();
  const productItemCode = productItemText.split('-')[0].trim();
  console.log(`[data] productItemCode: ${productItemCode}`);

  const estimateLinked = page.locator('//div[contains(text(),"Price Estimate")]//following-sibling::div');
  await expect(estimateLinked).toBeVisible();
  await estimateLinked.click();
  await page.waitForTimeout(2000);

  await expect(estimateHeading).toBeVisible();
  await expect(estimateHeading).toContainText(estimateNumber);

  await expect(createProductItemButton).toBeVisible();
  await expect(createProductItemButton).toBeEnabled();
  await createProductItemButton.click();

  const addRouteOption = page.locator('div').filter({ hasText: 'Add Route to Existing Product Item Add specifications as a new route to an existing product item' }).first();
  await expect(addRouteOption).toBeVisible();
  await expect(addRouteOption).toBeEnabled();
  await addRouteOption.click();

  const addRouteDesc = page.locator('p').filter({ hasText: 'Add specifications as a new route to an existing product item' }).first();
  await expect(addRouteDesc).toBeVisible();
  await addRouteDesc.click();

  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  const productItemSearchInput = page.locator('input[name="productItemSearch"][type="text"]');
  await expect(productItemSearchInput).toBeVisible();
  await expect(productItemSearchInput).toBeEditable();
  await productItemSearchInput.fill('H6YTEMVV');

  const productResult = page.locator('//div[contains(text(),"temp")]').first();
  await expect(productResult).toBeVisible();
  const productResultText = (await productResult.innerText()).trim();
  console.log(`[data] productResultText: ${productResultText}`);
  await productResult.click();
  await page.waitForTimeout(2000);

  const continueToDuplicateCheckButton = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueToDuplicateCheckButton).toBeEnabled();
  await continueToDuplicateCheckButton.click();

  const newRouteHeading = page.locator('h4').filter({ hasText: 'New Route will be added to:' }).first();
  await expect(newRouteHeading).toBeVisible();

  const routeProductHeading = page.locator('span').filter({ hasText: productResultText }).first();
  await expect(routeProductHeading).toBeVisible();

  const addRouteButton = page.getByRole('button', { name: 'Add Route', exact: true });
  await expect(addRouteButton).toBeEnabled();
  await addRouteButton.click();

  await expect(productItemHeading).toBeVisible();
});
 