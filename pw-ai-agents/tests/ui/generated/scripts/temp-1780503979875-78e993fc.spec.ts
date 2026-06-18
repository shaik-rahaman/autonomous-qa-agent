import { test, expect } from '@playwright/test';

 test('quick', async ({ page }) => { await page.goto('about:blank'); await expect(1).toBe(1); });