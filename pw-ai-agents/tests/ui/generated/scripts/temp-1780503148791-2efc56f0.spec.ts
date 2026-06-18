import { test, expect } from "@playwright/test";




test("Login to OrangeHRM and verify dashboard", async ({ page }) => {
  try {
    await page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
    await page.waitForLoadState("networkidle");
    await page.locator("[name=\"username\"]").fill("Admin");
    await page.locator("[name=\"asdfdpassword\"]").fill("admin123");
    await page.locator(".oxd-button.oxd-button--medium.oxd-button--main").click();
    await page.waitForURL(/dashboard/i);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});