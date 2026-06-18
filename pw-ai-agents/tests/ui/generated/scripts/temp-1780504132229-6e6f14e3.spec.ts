import { test, expect } from '@playwright/test';

test('quick-nav', async ({ page }) => { await page.goto('about:blank');
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }); await expect(1).toBe(1); });