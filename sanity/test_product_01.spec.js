import testData from '../test-data.json';
import { test, expect } from '@playwright/test';
 
test('create product @sanity', async ({ page }) => {
  await page.goto(testData.url);
  await page.waitForLoadState('domcontentloaded');
 
  await expect(page.getByRole('button', { name: 'Sign in with Email' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in with Email' }).click();
 
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
 
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('button').filter({ hasText: 'Customer' })).toBeEnabled();
  await page.getByRole('button').filter({ hasText: 'Customer' }).click();
 
  await expect(page.getByRole('button').filter({ hasText: 'Items' })).toBeEnabled();
  await page.getByRole('button').filter({ hasText: 'Items' }).click();
 
  await expect(page.getByRole('link', { name: 'Product Items' })).toBeEnabled();
  await page.getByRole('link', { name: 'Product Items' }).click();
 
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('link', { name: 'New Product Item' })).toBeEnabled();
  await page.getByRole('link', { name: 'New Product Item' }).click();
 
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('button', { name: 'Select Customer' })).toBeEnabled();
  await page.getByRole('button', { name: 'Select Customer' }).click();
 
  await expect(page.locator('xpath=//input[@placeholder="Quick Search"]')).toBeEnabled();
  await page.locator('xpath=//input[@placeholder="Quick Search"]').click();
  await expect(page.locator('xpath=//input[@placeholder="Quick Search"]')).toBeEditable();
  await page.locator('xpath=//input[@placeholder="Quick Search"]').fill(testData.search);
 
  await page.locator('xpath=//tr//td//label').first().check();
 
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue' }).click();
 
  await expect(page.getByRole('textbox', { name: 'Select a Product Class' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Select a Product Class' }).click();
  await expect(page.getByText('Blank Label')).toBeEnabled();
  await page.getByText('Blank Label').click();
 
  await expect(page.getByRole('textbox', { name: 'Customer Part Number' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Customer Part Number' }).click();
  await expect(page.getByRole('textbox', { name: 'Customer Part Number' })).toBeEditable();
  await page.getByRole('textbox', { name: 'Customer Part Number' }).fill(testData.patnumber);
 
  await expect(page.getByRole('textbox', { name: 'Brand Name' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Brand Name' }).click();
  await expect(page.getByRole('textbox', { name: 'Brand Name' })).toBeEditable();
  await page.getByRole('textbox', { name: 'Brand Name' }).fill(testData.brandname);
 
  await expect(page.getByRole('spinbutton', { name: 'Max OD (inches)' })).toBeEnabled();
  await page.getByRole('spinbutton', { name: 'Max OD (inches)' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Max OD (inches)' })).toBeEditable();
  await page.getByRole('spinbutton', { name: 'Max OD (inches)' }).fill(testData.od);
 
  await page.locator('xpath=//input[@placeholder="Enter substrate"]').fill(testData.search);
  await expect(page.locator('xpath=//input[@placeholder="Enter substrate"]')).toBeEditable();
  await page.locator('xpath=//input[@placeholder="Enter substrate"]').click();
  await page.locator('xpath=//input[@placeholder="Enter substrate"]').fill(testData.substrate);
 
  await expect(page.locator('xpath=//input[@placeholder="Enter Coating"]')).toBeEnabled();
  await page.locator('xpath=//input[@placeholder="Enter Coating"]').click();
  await expect(page.getByText('Cold Foil')).toBeEnabled();
  await page.getByText('Cold Foil').click();
 
  await expect(page.getByRole('textbox', { name: 'Select a Core Diameter' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Select a Core Diameter' }).click();
  await expect(page.getByRole('list').getByText('1', { exact: true })).toBeEnabled();
  await page.getByRole('list').getByText('1', { exact: true }).click();
 
  await expect(page.getByRole('textbox', { name: 'Select an Unwind' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Select an Unwind' }).click();
  await expect(page.getByText('- Print out, Head first.')).toBeEnabled();
  await page.getByText('- Print out, Head first.').click();
 
  await expect(page.getByRole('textbox', { name: 'Select a Sales Unit' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Select a Sales Unit' }).click();
  await expect(page.getByText('Meters')).toBeEnabled();
  await page.getByText('Meters').click();
 
  await expect(page.getByRole('spinbutton', { name: 'Quantity in Sales UOM' })).toBeEnabled();
  await page.getByRole('spinbutton', { name: 'Quantity in Sales UOM' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantity in Sales UOM' })).toBeEditable();
  await page.getByRole('spinbutton', { name: 'Quantity in Sales UOM' }).fill(testData.oumnumber);
 
  await expect(page.getByRole('textbox', { name: 'Description' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Description' }).click();
  await expect(page.getByRole('textbox', { name: 'Description' })).toBeEditable();
  await page.getByRole('textbox', { name: 'Description' }).fill(testData.desc);
 
  await page.getByRole('checkbox', { name: 'C of C Required' }).first().check();
 
  await expect(page.getByRole('textbox', { name: 'Select a category' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Select a category' }).click();
  await expect(page.getByText('Film', { exact: true }).first()).toBeEnabled();
  await page.getByText('Film', { exact: true }).first().click();
 
  await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create' }).click();
 
  await expect(page.getByText('Ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Links' })).toBeEnabled();
  await page.getByRole('button', { name: 'Links' }).click();
});