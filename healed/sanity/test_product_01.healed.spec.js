import testData from '../../test-data.json';
const { test, expect } = require('../../fixtures/walker_fixture.js');
const { heal } = require('../../fixtures/inline_healer.js');

test('create product @sanity', async ({ page }) => {
  await page.goto(testData.url);
  await page.waitForLoadState('domcontentloaded');

  // Login
  await heal(
    page,
    'Sign in with Email button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Sign in with Email', exact: true })
  );

  await heal(
    page,
    'Sign in with Email button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Sign in with Email', exact: true })
  );

  await heal(
    page,
    'email input',
    'visible',
    null,
    () => page.locator('input[name="email"]')
  );

  await heal(
    page,
    'email input',
    'click',
    null,
    () => page.locator('input[name="email"]')
  );

  await heal(
    page,
    'email input',
    'fill',
    testData.email,
    () => page.locator('input[name="email"]')
  );

  await heal(
    page,
    'password input',
    'visible',
    null,
    () => page.locator('input[name="password"]')
  );

  await heal(
    page,
    'password input',
    'click',
    null,
    () => page.locator('input[name="password"]')
  );

  await heal(
    page,
    'password input',
    'fill',
    testData.password,
    () => page.locator('input[name="password"]')
  );

  await heal(
    page,
    'Sign in with Email button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Sign in with Email', exact: true })
  );

  await heal(
    page,
    'Sign in with Email button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Sign in with Email', exact: true })
  );

  await page.waitForLoadState('domcontentloaded');

  // Customer
  await heal(
    page,
    'Customer button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Customer', exact: true })
  );

  await heal(
    page,
    'Customer button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Customer', exact: true })
  );

  // Items
  await heal(
    page,
    'Items button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Items', exact: true })
  );

  await heal(
    page,
    'Items button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Items', exact: true })
  );

  // Product Items
  await heal(
    page,
    'Product Items link',
    'visible',
    null,
    () => page.getByRole('link', { name: 'Product Items', exact: true })
  );

  await heal(
    page,
    'Product Items link',
    'click',
    null,
    () => page.getByRole('link', { name: 'Product Items', exact: true })
  );

  await page.waitForLoadState('domcontentloaded');

  // New Product Item
  await heal(
    page,
    'New Product Item link',
    'visible',
    null,
    () => page.getByRole('link', { name: 'New Product Item', exact: true })
  );

  await heal(
    page,
    'New Product Item link',
    'click',
    null,
    () => page.getByRole('link', { name: 'New Product Item', exact: true })
  );

  await page.waitForLoadState('domcontentloaded');

  // Select Customer
  await heal(
    page,
    'Select Customer button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Select Customer', exact: true })
  );

  await heal(
    page,
    'Select Customer button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Select Customer', exact: true })
  );

  // Customer search
  await heal(
    page,
    'Quick Search input',
    'visible',
    null,
    () => page.locator('input[placeholder="Quick Search"]')
  );

  await heal(
    page,
    'Quick Search input',
    'click',
    null,
    () => page.locator('input[placeholder="Quick Search"]')
  );

  await heal(
    page,
    'Quick Search input',
    'fill',
    testData.search,
    () => page.locator('input[placeholder="Quick Search"]')
  );

  await heal(
    page,
    'Customer search result checkbox',
    'click',
    null,
    () => page.locator('xpath=//tr//td//label').first()
  );

  await heal(
    page,
    'Continue button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Continue', exact: true })
  );

  await heal(
    page,
    'Continue button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Continue', exact: true })
  );

  // Product Class
  await heal(
    page,
    'Select a Product Class textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Select a Product Class', exact: true })
  );

  await heal(
    page,
    'Select a Product Class textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Select a Product Class', exact: true })
  );

  await heal(
    page,
    'Blank Label option',
    'visible',
    null,
    () => page.getByText('Blank Label', { exact: true })
  );

  await heal(
    page,
    'Blank Label option',
    'click',
    null,
    () => page.getByText('Blank Label', { exact: true })
  );

  // Customer Part Number
  await heal(
    page,
    'Customer Part Number textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Customer Part Number', exact: true })
  );

  await heal(
    page,
    'Customer Part Number textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Customer Part Number', exact: true })
  );

  await heal(
    page,
    'Customer Part Number textbox',
    'fill',
    testData.patnumber,
    () => page.getByRole('textbox', { name: 'Customer Part Number', exact: true })
  );

  // Brand Name
  await heal(
    page,
    'Brand Name textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Brand Name', exact: true })
  );

  await heal(
    page,
    'Brand Name textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Brand Name', exact: true })
  );

  await heal(
    page,
    'Brand Name textbox',
    'fill',
    testData.brandname,
    () => page.getByRole('textbox', { name: 'Brand Name', exact: true })
  );

  // Max OD
  await heal(
    page,
    'Max OD inches spinbutton',
    'visible',
    null,
    () => page.getByRole('spinbutton', { name: 'Max OD (inches)', exact: true })
  );

  await heal(
    page,
    'Max OD inches spinbutton',
    'click',
    null,
    () => page.getByRole('spinbutton', { name: 'Max OD (inches)', exact: true })
  );

  await heal(
    page,
    'Max OD inches spinbutton',
    'fill',
    testData.od,
    () => page.getByRole('spinbutton', { name: 'Max OD (inches)', exact: true })
  );

  // Substrate
  await heal(
    page,
    'Enter substrate input',
    'visible',
    null,
    () => page.locator('input[placeholder="Enter substrate"]')
  );

  await heal(
    page,
    'Enter substrate input',
    'click',
    null,
    () => page.locator('input[placeholder="Enter substrate"]')
  );

  await heal(
    page,
    'Enter substrate input',
    'fill',
    testData.substrate,
    () => page.locator('input[placeholder="Enter substrate"]')
  );

  // Coating
  await heal(
    page,
    'Enter Coating input',
    'visible',
    null,
    () => page.locator('input[placeholder="Enter Coating"]')
  );

  await heal(
    page,
    'Enter Coating input',
    'click',
    null,
    () => page.locator('input[placeholder="Enter Coating"]')
  );

  await heal(
    page,
    'Cold Foil option',
    'visible',
    null,
    () => page.getByText('Cold Foil', { exact: true })
  );

  await heal(
    page,
    'Cold Foil option',
    'click',
    null,
    () => page.getByText('Cold Foil', { exact: true })
  );

  // Core Diameter
  await heal(
    page,
    'Select a Core Diameter textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Select a Core Diameter', exact: true })
  );

  await heal(
    page,
    'Select a Core Diameter textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Select a Core Diameter', exact: true })
  );

  await heal(
    page,
    'Core Diameter 1 option',
    'visible',
    null,
    () => page.getByRole('list').getByText('1', { exact: true })
  );

  await heal(
    page,
    'Core Diameter 1 option',
    'click',
    null,
    () => page.getByRole('list').getByText('1', { exact: true })
  );

  // Unwind
  await heal(
    page,
    'Select an Unwind textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Select an Unwind', exact: true })
  );

  await heal(
    page,
    'Select an Unwind textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Select an Unwind', exact: true })
  );

  await heal(
    page,
    'Print out Head first option',
    'visible',
    null,
    () => page.getByText('- Print out, Head first.', { exact: true })
  );

  await heal(
    page,
    'Print out Head first option',
    'click',
    null,
    () => page.getByText('- Print out, Head first.', { exact: true })
  );

  // Sales Unit
  await heal(
    page,
    'Select a Sales Unit textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Select a Sales Unit', exact: true })
  );

  await heal(
    page,
    'Select a Sales Unit textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Select a Sales Unit', exact: true })
  );

  await heal(
    page,
    'Meters option',
    'visible',
    null,
    () => page.getByText('Meters', { exact: true })
  );

  await heal(
    page,
    'Meters option',
    'click',
    null,
    () => page.getByText('Meters', { exact: true })
  );

  // Quantity
  await heal(
    page,
    'Quantity in Sales UOM spinbutton',
    'visible',
    null,
    () => page.getByRole('spinbutton', { name: 'Quantity in Sales UOM', exact: true })
  );

  await heal(
    page,
    'Quantity in Sales UOM spinbutton',
    'click',
    null,
    () => page.getByRole('spinbutton', { name: 'Quantity in Sales UOM', exact: true })
  );

  await heal(
    page,
    'Quantity in Sales UOM spinbutton',
    'fill',
    testData.oumnumber,
    () => page.getByRole('spinbutton', { name: 'Quantity in Sales UOM', exact: true })
  );

  // Description
  await heal(
    page,
    'Description textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Description', exact: true })
  );

  await heal(
    page,
    'Description textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Description', exact: true })
  );

  await heal(
    page,
    'Description textbox',
    'fill',
    testData.desc,
    () => page.getByRole('textbox', { name: 'Description', exact: true })
  );

  // C of C Required
  await heal(
    page,
    'C of C Required checkbox',
    'visible',
    null,
    () => page.getByRole('checkbox', { name: 'C of C Required' }).first()
  );

  await heal(
    page,
    'C of C Required checkbox',
    'click',
    null,
    () => page.getByRole('checkbox', { name: 'C of C Required' }).first()
  );

  // Category
  await heal(
    page,
    'Select a category textbox',
    'visible',
    null,
    () => page.getByRole('textbox', { name: 'Select a category', exact: true })
  );

  await heal(
    page,
    'Select a category textbox',
    'click',
    null,
    () => page.getByRole('textbox', { name: 'Select a category', exact: true })
  );

  await heal(
    page,
    'Film category option',
    'visible',
    null,
    () => page.getByText('Film', { exact: true }).first()
  );

  await heal(
    page,
    'Film category option',
    'click',
    null,
    () => page.getByText('Film', { exact: true }).first()
  );

  // Create
  await heal(
    page,
    'Create button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Create', exact: true })
  );

  await heal(
    page,
    'Create button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Create', exact: true })
  );

  // Post-create validation
  await heal(
    page,
    'Ready status',
    'visible',
    null,
    () => page.getByText('Ready', { exact: true })
  );

  await heal(
    page,
    'Links button',
    'visible',
    null,
    () => page.getByRole('button', { name: 'Links', exact: true })
  );

  await heal(
    page,
    'Links button',
    'click',
    null,
    () => page.getByRole('button', { name: 'Links', exact: true })
  );
});