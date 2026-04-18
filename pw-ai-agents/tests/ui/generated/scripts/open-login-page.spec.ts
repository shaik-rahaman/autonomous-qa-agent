import { test, expect } from "@playwright/test";




test("Login to leaftaps and verify CRM link", async ({ page }) => {
  try {
    await page.goto("http://leaftaps.com/opentaps/control/main");
    await page.waitForLoadState("load");
    
    await page.locator("#username").fill("demosalesmanager");
    await page.locator("#password").fill("crmsfa");
    await page.getByRole("button", { name: /login/i }).click();
    
    await expect(page.getByRole("link", { name: /CRM/i })).toBeVisible();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});