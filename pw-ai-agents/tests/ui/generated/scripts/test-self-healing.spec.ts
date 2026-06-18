import { test, expect } from "@playwright/test";

// Increase test timeout to handle slower navigation on external demo site
test.setTimeout(120000);


test("Login to OrangeHRM and verify dashboard", async ({ page }) => {
  try {
    await page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    await page.locator("[name=\"username\"]").fill("Admin");
    await page.locator('[name="password"]').fill("admin123");
    await page.locator(".oxd-button.oxd-button--medium.oxd-button--main").click();
    await page.waitForURL(/dashboard/i);
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});
