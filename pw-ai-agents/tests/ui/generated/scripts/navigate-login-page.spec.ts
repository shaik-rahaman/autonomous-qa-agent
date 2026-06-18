import { test, expect } from "@playwright/test";




test("Login to Practice Test Automation and verify dashboard", async ({ page }) => {
  try {
    await page.goto("https://practicetestautomation.com/practice-test-login/");
    await page.waitForLoadState("load");
    
    await page.locator("#username").fill("practicetestautomation");
    await page.locator("#password").fill("practicetestautomation");
    await page.locator("#submit").click();
    await page.waitForLoadState("load");
    
    await expect(page.getByText(/Practice Test Automation/i)).toBeVisible();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});