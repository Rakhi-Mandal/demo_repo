
import testData from '../../test-data.json';
import { test, expect } from '@playwright/test';
  test('Create Estimate with note and comment @regression @set1', async ({page}) => {
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

    const taskDashboardLabel = page
      .locator('label')
      .filter({ hasText: /^Tharun\'s Task Dashboard$/ })
      .first();

    await expect(taskDashboardLabel).toBeVisible();
    await expect(taskDashboardLabel).toBeEnabled();

const btn = page.locator(
  '(//button[normalize-space()="Estimating & Pricing"])[1]'
);
await btn.click();


const estimatesQuotesLink = page.getByRole('link', {
    name: 'Estimates/Quotes',
    exact: true
  });
  await expect(estimatesQuotesLink).toBeVisible();
  await expect(estimatesQuotesLink).toBeEnabled();
  await estimatesQuotesLink.click();

  const estimatesQuotesIndexpage = page
  .locator('label')
  .filter({ hasText: 'Estimates/Quotes' })
  .first();

await expect(estimatesQuotesIndexpage).toBeVisible();
await expect(estimatesQuotesIndexpage).toBeEnabled();
await estimatesQuotesIndexpage.click();

await page.waitForLoadState('domcontentloaded');

const newEstimateLink = page.getByRole('link', { name: 'New Estimate', exact: true });
await expect(newEstimateLink).toBeVisible();
await expect(newEstimateLink).toBeEnabled();
await newEstimateLink.click();

const EstimateCreationPage_header = page.locator('//h2[normalize-space()="Estimate Information"]');
await expect(EstimateCreationPage_header).toBeVisible();

const selectCustomerButton = page.getByRole('button', {
    name: 'Select Customer',
    exact: true
  });

  await expect(selectCustomerButton).toBeEnabled();
  await selectCustomerButton.click();

  const customerQuickSearchInput = page.locator("xpath=//div[normalize-space(.)='Filters 0 Filters Reset Add a filter Apply']/preceding::input[@placeholder='Quick Search']");

  await expect(customerQuickSearchInput).toBeEnabled();
  await customerQuickSearchInput.click();
  await customerQuickSearchInput.fill(testData.quickSearch);
  await page.waitForTimeout(1500);

  // Select via radio only (avoid duplicate row-click + check)
  const customerRadioValue = String(testData.customerCode || '').replace(/\D/g, '');
  const customerRadio = page.locator(
    `input[name="datagrid-radio-selection"][type="radio"][value="${customerRadioValue}"]`
  );
  await expect(customerRadio).toBeVisible();
  await customerRadio.click({ force: true });
  await expect(customerRadio).toBeChecked();

  // Continue after customer selection
  const continueButton1 = page.getByRole('button', {
    name: 'Continue',
    exact: true
  });

  await expect(continueButton1).toBeEnabled();
  await continueButton1.click();

  // Choose Opportunity — click the <button> (wire:click), not the inner <p>
  const chooseOpportunityButton = page
    .locator('//button[.//p[normalize-space()="Choose Opportunity"]]')
    .first();
  await chooseOpportunityButton.scrollIntoViewIfNeeded();
  await expect(chooseOpportunityButton).toBeVisible();
  await expect(chooseOpportunityButton).toBeEnabled();
  await chooseOpportunityButton.click();

  const opportunityQuickSearchInput = page.locator("xpath=//div[@id='project-picker-picker-opportunity-picker']//input[@placeholder='Search Now']");
  await expect(opportunityQuickSearchInput).toBeVisible({ timeout: 15000 });
  await opportunityQuickSearchInput.click();

  const opportunityCell = page.locator("xpath=//div[@id='project-picker-picker-opportunity-picker']//tbody//tr[1]//td[2]");
  const opportunityNameCell = page.locator("xpath=//div[@id='project-picker-picker-opportunity-picker']//tbody//tr[1]//td[3]");

  await expect(opportunityCell).toBeVisible();
  await expect(opportunityCell).toBeEnabled();
  const opportunityName = (await opportunityNameCell.innerText()).trim();
  console.log(`[data] opportunityName: ${opportunityName}`);
  await opportunityCell.click();

  await page.waitForTimeout(2000);
  // Continue after opportunity selection
  const continueButton3 = page.getByRole('button', {
    name: 'Continue',
    exact: true
  });

  await page.waitForTimeout(2000);
  await continueButton3.click();

  await expect(chooseOpportunityButton).toBeHidden();
  const selectedOpportunityButton = page.getByRole('button', { name: opportunityName, exact: true });
  await expect(selectedOpportunityButton).toBeVisible();

  // Estimate quantity unit
  const quantityUnitInput = page.locator("xpath=//input[@name='deliverableItemDTO.extension_quantityUnitId']");

  await expect(quantityUnitInput).toBeEnabled();
  await quantityUnitInput.click();

  const metersOption = page.locator('li[data-label="Meters"]');

  await expect(metersOption).toBeEnabled();
  await metersOption.click();
  await expect(quantityUnitInput).toHaveValue('Meters');

  // Quantity break 1
  const quantityBreakInput = page.locator("xpath=//input[@name='deliverableItemDTO.extension.quantityBreak1']");

  await expect(quantityBreakInput).toBeEnabled();
await quantityBreakInput.click();
await quantityBreakInput.fill(testData.quantityBreak1);
await expect(quantityBreakInput).toHaveValue(testData.quantityBreak1);

// Max colors to quote
const maxColorsInput = page.locator("xpath=//input[@name='deliverableItemDTO.extension.maxColorsToQuote']");

await expect(maxColorsInput).toBeEnabled();
await maxColorsInput.click();

const colorsOption = page.locator('li[data-label="2"]');

await expect(colorsOption).toBeEnabled();
await colorsOption.click();
await expect(maxColorsInput).toHaveValue('2');

// Product class
const productClassInput = page.locator("xpath=//input[@name='deliverableItemDTO.productClassId']");

await expect(productClassInput).toBeEnabled();
await productClassInput.click();

const primeLabelOption = page.locator(
  'li[data-label="Prime Label"]'
);

await expect(primeLabelOption).toBeEnabled();
await expect(primeLabelOption).toBeVisible();
await primeLabelOption.click();

await expect(productClassInput).toHaveValue('Prime Label');

// Workflow
const workflowInput = page.locator("xpath=//input[@name='deliverableItemSpecification.workflowId']");

await expect(workflowInput).toBeEnabled();
await workflowInput.click();

const standardDigitalLabelOption = page.locator(
  'li[data-label="Standard Digital Label"]'
);

await expect(standardDigitalLabelOption).toBeEnabled();
await standardDigitalLabelOption.click();
await expect(workflowInput).toHaveValue('Standard Digital Label');

// Plant
const plantInput = page.locator("xpath=//input[@name='deliverableItemSpecification.plantId']");

await expect(plantInput).toBeEnabled();
await plantInput.click();

const fortisOption = page.locator(
  'li[data-label="Fortis (99)"]'
);

await expect(fortisOption).toBeEnabled();
await fortisOption.click();
await expect(plantInput).toHaveValue('Fortis (99)');

// Description
const descriptionInput = page.locator("xpath=//textarea[@id='deliverableItemDTO.description']");

await descriptionInput.fill(testData.descriptionRequired);
await expect(descriptionInput).toHaveValue(testData.descriptionRequired);

// Unit set
const unitSetInput = page.locator("xpath=//input[@name='deliverableItemSpecification.unitSetTypeId']");

await expect(unitSetInput).toBeEnabled();
await unitSetInput.click();

const rollsBoxedOption = page.locator(
  'li[data-label="Rolls/Boxed"]'
);

await expect(rollsBoxedOption).toBeEnabled();
await rollsBoxedOption.click();
await expect(unitSetInput).toHaveValue('Rolls/Boxed');

// Core diameter
const coreDiameterInput = page.locator("xpath=//input[@name='deliverableItemSpecification.coreDiameterId']");

await expect(coreDiameterInput).toBeEnabled();
await coreDiameterInput.click();

const coreDiameterOption = page.locator(
  '(//li[@data-label="1"])[2]'
);

await coreDiameterOption.click();
await expect(coreDiameterInput).toHaveValue('1');

// Application type
const applicationTypeInput = page.locator("xpath=//input[@name='deliverableItemSpecification.applicationType']");

await expect(applicationTypeInput).toBeEnabled();
await applicationTypeInput.click();

const handOption = page.locator('li[data-label="Hand"]');

await expect(handOption).toBeEnabled();
await handOption.click();
await expect(applicationTypeInput).toHaveValue('Hand');

// Application temp
const applicationTempInput = page.locator("xpath=//input[@name='deliverableItemSpecification.applicationTemp']");

await expect(applicationTempInput).toBeEditable();
await applicationTempInput.fill(testData.applicationTempRequired);
await expect(applicationTempInput).toHaveValue(testData.applicationTempRequired);

// Surface type
const surfaceTypeInput = page.locator("xpath=//input[@name='deliverableItemSpecification.applicationSurfaceTypeValuelistOptionId']");

await expect(surfaceTypeInput).toBeEnabled();
await surfaceTypeInput.click();

const petgOption = page.locator('li[data-label="PETg"]');

await expect(petgOption).toBeEnabled();
await petgOption.click();
await expect(surfaceTypeInput).toHaveValue('PETg');

// Surface temp after application
const surfaceTempAfterInput = page.locator("xpath=//input[@name='deliverableItemSpecification.surfaceTempAfterApplication']");

await expect(surfaceTempAfterInput).toBeEditable();
await surfaceTempAfterInput.fill(testData.surfaceTempAfter);
await expect(surfaceTempAfterInput).toHaveValue(testData.surfaceTempAfter);

// Appearance color
const appearanceColorInput = page.locator("xpath=//input[@name='deliverableItemSpecification.substrateColor']");

await expect(appearanceColorInput).toBeEditable();
await appearanceColorInput.fill(testData.appearanceColorRequired);
await expect(appearanceColorInput).toHaveValue(testData.appearanceColorRequired);

// Substrate face/facestock
const substrateFaceInput = page.locator("xpath=//input[@name='deliverableItemSpecification.substrateFace']");

await expect(substrateFaceInput).toBeEditable();
await substrateFaceInput.fill(testData.substrateFaceOrFacestock);
await expect(substrateFaceInput).toHaveValue(testData.substrateFaceOrFacestock);

// Adhesive
const adhesiveInput = page.locator("xpath=//input[@name='deliverableItemSpecification.substrateAdhesive']");

await expect(adhesiveInput).toBeEditable();
await adhesiveInput.fill(testData.adhesiveRequired);
await expect(adhesiveInput).toHaveValue(testData.adhesiveRequired);

// Liner
const linerInput = page.locator("xpath=//input[@name='deliverableItemSpecification.substrateLiner']");

await expect(linerInput).toBeEditable();
await linerInput.fill(testData.linerRequired);
await expect(linerInput).toHaveValue(testData.linerRequired);

const coating= page.locator("xpath=//input[@name='deliverableItemSpecification.coatingTypeValuelistOptionId']");
await expect(coating).toBeEnabled();
await coating.click();

const coatingOption = page.locator('li[data-label="UV Matte"]');
await expect(coatingOption).toBeEnabled();
await coatingOption.click();
await expect(coating).toHaveValue('UV Matte');

const laminate= page.locator("xpath=//input[@name='deliverableItemSpecification.laminateTypeValuelistOptionId']");
await expect(laminate).toBeEnabled();
await laminate.click();

const laminateOption = page.locator('li[data-label="Gloss Laminate"]');
await expect(laminateOption).toBeEnabled();
await laminateOption.click();
await expect(laminate).toHaveValue('Gloss Laminate');

// Wind direction
const windDirectionButton = page.getByRole('button', {
  name: '7 - Print in, Right first.',
  exact: true
});

await expect(windDirectionButton).toBeEnabled();
await windDirectionButton.click();

// Choose Unit Templates (same pattern as RFP specs — wait for picker to settle)
const chooseUnitTemplatesButton = page.getByRole('button', {
  name: 'Choose Unit Templates',
  exact: true
});

await expect(chooseUnitTemplatesButton).toBeEnabled();
await chooseUnitTemplatesButton.click();

const unitTemplatePickerHeading = page.locator('//h3[normalize-space()="Choose Unit-Template-Picker"]');
await expect(unitTemplatePickerHeading).toBeVisible();

const unitTemplateQuickSearchInput = page.locator('input[placeholder="Quick Search"][data-flux-control]');
await expect(unitTemplateQuickSearchInput).toBeVisible();
await expect(unitTemplateQuickSearchInput).toBeEditable();
await page.waitForTimeout(3000);
await unitTemplateQuickSearchInput.click();
await unitTemplateQuickSearchInput.fill(testData.unitTemplatePicker);

const unitTemplateResult = page.locator('td').filter({ hasText: testData.unitTemplatePicker }).first();
await expect(unitTemplateResult).toBeVisible();
await expect(unitTemplateResult).toBeEnabled();
await unitTemplateResult.click();

// Continue after unit template selection
const continueButton4 = page.locator(
  '//h3[normalize-space()="Choose Unit-Template-Picker"]' +
  '//ancestor::div[4]//span[normalize-space()="Continue"]'
);
await page.waitForTimeout(3000);
await continueButton4.click();
await expect(unitTemplatePickerHeading).toBeHidden();
const selectedUnitTemplateButton = page.getByRole('button', { name: new RegExp(testData.unitTemplatePicker) });
await expect(selectedUnitTemplateButton).toBeVisible();

const chooseMaterialItemButton = page.getByRole('button', { name: 'Choose Material Item', exact: true }).first();
  await expect(chooseMaterialItemButton).toBeEnabled();
  await chooseMaterialItemButton.click();

    // Confirm modal heading
    await expect(page.locator('h3').filter({ hasText: /^Choose Material Item$/ }).first()).toBeVisible();

      // --- Quick Search for Material Item 1 ---
  const MaterialItemquickSearchInput = page.locator('//h3[normalize-space()="Choose Material Item"]/following::input[@placeholder="Quick Search"]');
  await expect(MaterialItemquickSearchInput).toBeVisible();
  await expect(MaterialItemquickSearchInput).toBeEditable();
  await MaterialItemquickSearchInput.fill(testData.MaterialItemquickSearch);

   // Confirm result cell is visible
   const firstMaterialCell = page.locator('td').filter({ hasText: testData.MaterialItemquickSearch }).first();
   await expect(firstMaterialCell).toBeVisible();
   await expect(firstMaterialCell).toBeEnabled();
   await firstMaterialCell.click();

     // Confirm Unlink button is visible
  const unlinkButton = page.getByRole('button', { name: 'Unlink', exact: true });
  await expect(unlinkButton).toBeVisible();

  // Continue after selecting material
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

    const chooseMaterialItemButton_laminate = page.getByRole('button', { name: 'Choose Material Item', exact: true }).first();
  await expect(chooseMaterialItemButton_laminate).toBeEnabled();
  await chooseMaterialItemButton_laminate.click();

    // --- Quick Search for Material Item 2 ---
    const FinishMaterialquickSearchInput = page.locator("xpath=//div[normalize-space(.)='Choose Material Item']/following::input[@placeholder='Quick Search Now']");
    await expect(FinishMaterialquickSearchInput).toBeVisible();
    await FinishMaterialquickSearchInput.fill(testData.Laminate);

    const FinishMaterialCell = page.locator('td').filter({ hasText: testData.Laminate }).first();
    await expect(FinishMaterialCell).toBeVisible();
    await expect(FinishMaterialCell).toBeEnabled();
    await FinishMaterialCell.click();

    const continueButton_finsh = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(continueButton_finsh).toBeEnabled();
    await continueButton_finsh.click();

    // --- Select Rewinder/Slitter ---
    const rewinderSection = page.locator('form').filter({ hasText: 'Select a Rewinder/Slitter Class' });
    const rewinderSlitterInput = rewinderSection.locator('input[name="deliverableItemWorkflowStep.work_center_class_id"]');
    await expect(rewinderSlitterInput).toBeVisible();
    await rewinderSlitterInput.click();

    const rewinderOption = page.locator('li[data-label="Rewinder"]');
    await expect(rewinderOption).toBeVisible();
    await expect(rewinderOption).toBeEnabled();
    await rewinderOption.click();
    await expect(rewinderSlitterInput).toHaveValue('Rewinder');

      // --- Enter number of slits ---
    const numberOfSlitsInput = page.locator("xpath=//input[@name='deliverableItemWorkflowStepTool.numberOfSlits']");
    await expect(numberOfSlitsInput).toBeVisible();
    await expect(numberOfSlitsInput).toBeEditable();
    await numberOfSlitsInput.fill(testData.numberOfSlits);
    await expect(numberOfSlitsInput).toHaveValue(testData.numberOfSlits);

     // --- Select Sheeter ---
    const sheeterSection = page.locator('form').filter({ hasText: 'Select a Sheeter Class' });
    const sheeterInput = sheeterSection.locator('input[name="deliverableItemWorkflowStep.work_center_class_id"]');
    await expect(sheeterInput).toBeVisible();
    await sheeterInput.click();

    const paperCutterOption = page.locator('li[data-label="Paper Cutter"]');
    await paperCutterOption.click();
    await expect(sheeterInput).toHaveValue('Paper Cutter');

    // --- Enter step across (imposition across) ---
    const numberAcrossStepInput = page.locator("xpath=//input[@name='deliverableItemSpecification.impositionAc']");
    await expect(numberAcrossStepInput).toBeVisible();
    await numberAcrossStepInput.click();
    await numberAcrossStepInput.fill(testData.numberAcrossStep);
    await expect(numberAcrossStepInput).toHaveValue(testData.numberAcrossStep);

      // --- Enter repeat around (imposition around) ---
      const numberAroundRepeatInput = page.locator("xpath=//input[@name='deliverableItemSpecification.impositionAr']");
      await expect(numberAroundRepeatInput).toBeVisible();
      await numberAroundRepeatInput.click();
      await numberAroundRepeatInput.fill(testData.numberAroundRepeat);
      await expect(numberAroundRepeatInput).toHaveValue(testData.numberAroundRepeat);

      // --- Enter tooth count ---
      const toothCountInput = page.locator("//input[@name='deliverableItemSpecification.toothCount']");
      await expect(toothCountInput).toBeVisible();
      await toothCountInput.click();
      await toothCountInput.fill(testData.toothCount);
      await page.waitForTimeout(2000);
      await expect(toothCountInput).toHaveValue(testData.toothCount);

      const coatingMaterialsCheckbox = page.locator(
        '#inknotrequired-inknotrequired-not-required'
      );
      await coatingMaterialsCheckbox.check();
      await expect(coatingMaterialsCheckbox).toBeChecked();

  // Pre-submit gate: re-assert volatile fields before Create
  await expect(quantityBreakInput).toHaveValue(testData.quantityBreak1);
  await expect(maxColorsInput).toHaveValue('2');
  await expect(productClassInput).toHaveValue('Prime Label');
  await expect(workflowInput).toHaveValue('Standard Digital Label');
  await expect(plantInput).toHaveValue('Fortis (99)');
  await expect(surfaceTempAfterInput).toHaveValue(testData.surfaceTempAfter);
  await expect(selectedUnitTemplateButton).toBeVisible();
  await expect(numberAcrossStepInput).toHaveValue(testData.numberAcrossStep);
  await expect(numberAroundRepeatInput).toHaveValue(testData.numberAroundRepeat);
  await expect(toothCountInput).toHaveValue(testData.toothCount);

  // --- Create Estimate (first click) ---
  const createEstimateButton = page.getByRole('button', { name: 'Create Estimate', exact: true });
  await expect(createEstimateButton).toBeEnabled();
  await createEstimateButton.click();

const EstimateSuccessMessage =  page.getByText(
  'Estimate created successfully.',
  { exact: true }
);
await expect(EstimateSuccessMessage).toBeVisible({ timeout: 180000 });
await page.waitForTimeout(3000);

const estimateText = await page.locator('//div[@class="section"]//h1//span').innerText();
const estimateNumber = estimateText.replace(/\s*-\s*Estimate\s*$/, '').trim();
console.log("Estimate Number:", estimateNumber);

const draftIcon = page.locator(
    '//span[normalize-space()="Draft"]/preceding-sibling::div/span/span[normalize-space()="01"]');
  await expect(draftIcon).not.toBeVisible();
  await expect(draftIcon).toHaveCount(0);

  const statusDraftDiv = page.locator('div').filter({ hasText: 'Needs Approval' }).first();
  await expect(statusDraftDiv).toBeVisible();

  const detailsTabButton = page.locator('[data-cy="hub-tab-details"]');
  await expect(detailsTabButton).toBeVisible();
  await expect(detailsTabButton).toBeEnabled();
  await detailsTabButton.click();

  await expect(page.locator('h3').filter({ hasText: 'Notes' }).first()).toBeVisible();

  const newNoteButton = page.locator('[data-cy="new-note-button"]');
  await expect(newNoteButton).toBeEnabled();
  await newNoteButton.click();

  const quillEditor = page.locator('.ql-editor').first();
  await quillEditor.fill(testData.notesRequired);

  const saveNoteButton = page.locator('button[x-tooltip="Save"][wire\\:click="create"]');
  await expect(saveNoteButton).toBeEnabled();
  await saveNoteButton.click();

  await expect(page.getByText('Note created successfully.').first()).toBeVisible({ timeout: 180000 });

  const addedNoteDiv = page.getByText(testData.notesRequired).last();
  await expect(addedNoteDiv).toBeVisible();

  const tharunThammineediDiv = page.locator('div').filter({ hasText: 'Tharun Thammineedi' }).first();
  await expect(tharunThammineediDiv).toBeVisible();
  await expect(tharunThammineediDiv).toBeEnabled();

  const commentsCustomerFacingText = page.locator('span').filter({ hasText: 'Comments (Customer facing)' }).first();
  await expect(commentsCustomerFacingText).toBeVisible();

  const newCommentButton = page.getByRole('button', { name: 'New Comment', exact: true });
  await expect(newCommentButton).toBeEnabled();
  await newCommentButton.click();

  const commentsTextarea = page.locator('//textarea[@id="comments"]');
  await commentsTextarea.fill(testData.relatedModel);

  const saveCommentButton = page.locator('(//span[normalize-space()="Comments (Customer facing)"])[2]//button[@x-tooltip="Save"]');
  await expect(saveCommentButton).toBeEnabled();
  await saveCommentButton.scrollIntoViewIfNeeded();
  await saveCommentButton.click();

  const commentTextDiv = page.locator('div').filter({ hasText: testData.relatedModel }).first();
  await expect(commentTextDiv).toBeVisible();
  });

//   test('Create Estimate with invalid data @regression @set1', async ({page}) => {
//     const btn = page.locator(
//       '(//button[normalize-space()="Estimating & Pricing"])[1]'
//     );
//     await btn.click();

//     const estimatesQuotesLink = page.getByRole('link', {
//       name: 'Estimates/Quotes',
//       exact: true
//     });
//     await expect(estimatesQuotesLink).toBeVisible();
//     await expect(estimatesQuotesLink).toBeEnabled();
//     await estimatesQuotesLink.click();

//     const estimatesQuotesIndexpage = page
//       .locator('label')
//       .filter({ hasText: 'Estimates/Quotes' })
//       .first();

//     await expect(estimatesQuotesIndexpage).toBeVisible();
//     await expect(estimatesQuotesIndexpage).toBeEnabled();
//     await estimatesQuotesIndexpage.click();

//     await page.waitForLoadState('domcontentloaded');

//     const newEstimateLink = page.getByRole('link', { name: 'New Estimate', exact: true });
//     await expect(newEstimateLink).toBeVisible();
//     await expect(newEstimateLink).toBeEnabled();
//     await newEstimateLink.click();

//     const EstimateCreationPage_header = page.locator('//h2[normalize-space()="Estimate Information"]');
//     await expect(EstimateCreationPage_header).toBeVisible();

//     const createEstimateButton = page.getByRole('button', { name: 'Create Estimate', exact: true });
//     await expect(createEstimateButton).toBeEnabled();
//     await createEstimateButton.click();

//     const errorSummary = page.locator('p').filter({
//       hasText:
//         'There was a problem saving your estimate: The customer field is required. (and 10 more errors)'
//     }).first();

//     await expect(errorSummary).toBeVisible();

//     await page.waitForTimeout(3000);
//     await expect(page.locator('p').filter({hasText: 'The customer field is required.'}).first()).toBeVisible();
//     await expect(page.locator('p').filter({ hasText: 'The contact field is required.'}).first()).toBeVisible();
//     await expect(page.locator('p').filter({hasText: 'The opportunity field is required.'}).first()).toBeVisible();
//     await expect(page.locator('p').filter({hasText: 'The unit field is required.'}).first()).toBeVisible();
//     await expect(page.locator('p').filter({hasText: 'The Max Number of Colors to Quote field is required.'}).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The quantity break 1 field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The number of SKUs field is required." }).first()).toBeVisible();
//     await expect(page.locator('p').filter({hasText: 'The description field is required.'}).first()).toBeVisible();

//     const EstimateCreationPage_header_after_click = page.locator('//h2[normalize-space()="Estimate Information"]');
//     await expect(EstimateCreationPage_header_after_click).toBeVisible();

//     const createEstimateButton_after_click = page.getByRole('button', { name: 'Create Estimate', exact: true });
//     await expect(createEstimateButton_after_click).toBeVisible();

//     await page.reload();
//     await page.waitForLoadState('domcontentloaded');

//     const EstimateCreationPage_header_after_reload = page.locator('//h2[normalize-space()="Estimate Information"]');
//     await expect(EstimateCreationPage_header_after_reload).toBeVisible();

//     const productClassInput = page.locator('input[name="deliverableItemDTO.productClassId"][type="text"]');
//     await expect(productClassInput).toBeVisible();
//     await expect(productClassInput).toBeEnabled();
//     await productClassInput.click();
//     const rfidLabelOption = page.locator('li[data-label="Prime Label"]');
//     await expect(rfidLabelOption).toBeVisible();
//     await expect(rfidLabelOption).toBeEnabled();
//     await rfidLabelOption.click();
//     await page.waitForTimeout(2000);
//     await expect(productClassInput).toHaveValue('Prime Label');

//     const workflowInput = page.locator('input[name="deliverableItemSpecification.workflowId"][type="text"]');
//     await expect(workflowInput).toBeVisible();
//     await expect(workflowInput).toBeEnabled();
//     await workflowInput.click();
//     const rfidWorkflowOption = page.locator('li[data-label="Standard Digital Label"]');
//     await expect(rfidWorkflowOption).toBeVisible();
//     await expect(rfidWorkflowOption).toBeEnabled();
//     await rfidWorkflowOption.click();
//     await expect(workflowInput).toHaveValue('Standard Digital Label');

//     const plantInput = page.locator('input[name="deliverableItemSpecification.plantId"][type="text"]');
//     await expect(plantInput).toBeVisible();
//     await expect(plantInput).toBeEnabled();
//     await plantInput.click();

//     const fortisOption = page.locator('li[data-label="Fortis (99)"]');
//     await expect(fortisOption).toBeVisible();
//     await expect(fortisOption).toBeEnabled();
//     await fortisOption.click();
//     await expect(plantInput).toHaveValue('Fortis (99)');

//     await page.waitForTimeout(7000);
//     const createEstimateButton_after_reload = page.getByRole('button', { name: 'Create Estimate', exact: true });
//     await expect(createEstimateButton_after_reload).toBeEnabled();
//     await createEstimateButton_after_reload.click();

//     await page.waitForLoadState('domcontentloaded');
//     await page.waitForTimeout(5000);
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Number Around field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Number Across field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Material Item field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Coatings (you need to add a coating) field must be greater than 0." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Unit Template field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Finish Rewind Direction field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "Please select a Generic Coating, Generic Laminate, or mark this section as Not Required before savin" }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Appearance (Color) field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Substrate (Face) field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Adhesive field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Liner field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Application Temp field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Application Surface Type field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The Surface Temp After Application field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Application Type field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Unit Set field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The description field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The Max Number of Colors to Quote field is required." }).first()).toBeVisible();
//     await expect(page.locator('[role="alert"]').filter({ hasText: "The quantity break 1 field is required." }).first()).toBeVisible();
//     await expect(page.locator("p").filter({ hasText: "The unit field is required." }).first()).toBeVisible();
//     await expect(page.locator('p').filter({ hasText: 'The contact field is required.'}).first()).toBeVisible();
//     await expect(page.locator('p').filter({hasText: 'The customer field is required.'}).first()).toBeVisible();
//   });
