import { test, expect } from '@playwright/test';


// Set default test timeout for generated scripts
test.setTimeout(120000);

test('Login Test with Injected Failure', async ({ page }) => {
  await page.goto('https://practice.expandtesting.com/login', { timeout: 120000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 120000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 120000 });
  await (console.log('[HEALING LAB] REACHED LOCATOR:', "[name='username']"), (console.log('[HEALING LAB] REACHED LOCATOR:', "[name="asdfusername"]"), page.locator("[name="asdfusername"]"))).fill('Admin');
  await (console.log('[HEALING LAB] REACHED LOCATOR:', "[name='asdfdpassword']"), (console.log('[HEALING LAB] REACHED LOCATOR:', "[name='asdfdpassword']"), page.locator("[name='asdfdpassword']"))).fill('admin123');
  await (console.log('[HEALING LAB] REACHED LOCATOR:', "[type='submit']"), page.locator("[type='submit']")).click();
  await expect(page).toHaveURL(/.*dashboard/);
});