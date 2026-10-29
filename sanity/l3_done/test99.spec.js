import { test, expect } from '@playwright/test';
import testData from '../../test-data.json';

test("Upload an Attachment in Opportunity @sanity", async ({ page }) => {
  await page.goto(testData.url_2);
  await page.waitForLoadState('domcontentloaded');

  const signInWithMicrosoftLink = page.getByRole('link', { name: 'Sign in with your Microsoft' });
  await expect(signInWithMicrosoftLink).toBeEnabled();
  await signInWithMicrosoftLink.click();

});
