import { test, expect } from '@playwright/test';

test('hello', async ({ page }) => {
  await page.goto('about:blank');
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
  expect(1).toBe(1);
});