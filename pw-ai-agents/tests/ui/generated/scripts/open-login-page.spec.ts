import { test, expect } from "@playwright/test";




test("Login to Practice Test Automation and verify success message", async ({ page }) => {
  try {
    await page.goto("https://practicetestautomation.com/practice-test-login/");
    await page.waitForLoadState("load");
    await page.locator("#username").fill("student");
    await page.locator("#password").fill("Password123");
    await page.locator("#submit").click();
    await expect(page.getByText(/Congratulations student. You successfully logged in/i)).toBeVisible();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});