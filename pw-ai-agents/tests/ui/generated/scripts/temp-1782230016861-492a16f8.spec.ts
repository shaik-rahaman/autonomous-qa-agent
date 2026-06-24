import { test, expect } from "@playwright/test";





// Set default test timeout for generated scripts
test.setTimeout(30000);

test("Login to OrangeHRM and verify dashboard", async ({ page }) => {
  try {
    await page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    await page.waitForTimeout(2000);
    await (console.log('[HEALING LAB] REACHED LOCATOR:', "[name=\"username\"]"), page.locator("[name=\"username\"]")).fill("Admin", { timeout: 5000 });
    await (console.log('[HEALING LAB] REACHED LOCATOR:', "[name=\"passwod\"]"), page.locator("[name=\"passwod\"]")).fill("admin123", { timeout: 5000 });
    await (console.log('[HEALING LAB] REACHED LOCATOR:', ".oxd-button.oxd-button--medium.oxd-button--main"), page.locator(".oxd-button.oxd-button--medium.oxd-button--main")).click({ timeout: 5000 });
    
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});