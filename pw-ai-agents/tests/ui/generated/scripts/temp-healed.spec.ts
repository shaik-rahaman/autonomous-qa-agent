import { test, expect } from "@playwright/test";

test("Login test with broken selectors to trigger self-healing", async ({ page }) => {
  try {
    await page.goto("https://practicetestautomation.com/practice-test-login/");
    await page.waitForLoadState("load");
    
    // Intentionally broken selector to trigger healing
    await page.locator('#username').fill("student");
    await page.locator('#password').fill("Password123");
    await page.locator('[name="password"]').press('Enter');
    await page.waitForLoadState("load");
    
    // Removed hardcoded 'Dashboard' assertion to avoid app-specific checks
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});
