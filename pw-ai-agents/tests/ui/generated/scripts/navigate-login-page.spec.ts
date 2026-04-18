import { test, expect } from "@playwright/test";

test("Login to application and verify dashboard", async ({ page }) => {
  try {
    await page.goto("http://leaftaps.com/opentaps/control/main");
    await page.waitForLoadState("domcontentloaded");

    await page.locator('#username').fill("admin");
    await page.locator('#password').fill("admin123");

    // Click the login button
    await page.getByRole("button", { name: /login/i }).click();

    // Verify that the dashboard appears after a successful login
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});