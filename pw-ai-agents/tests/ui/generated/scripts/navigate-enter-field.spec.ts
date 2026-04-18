import { test, expect } from "@playwright/test";

test("Login to LeafTaps and verify CRM link visibility", async ({ page }) => {
  // 1. Navigate to the exact target URL
  await page.goto("http://leaftaps.com/opentaps/control/main");

  // 2. Enter username
  await page.locator('#username').fill("demosalesmanager");

  // 3. Enter password
  await page.locator('#password').fill("crmsfa");

  // 4. Click the Login button
  await page.getByRole("button", { name: /login/i }).click();

  // 5. Verify the CRM link is visible after successful login
  const crmLink = page.getByRole("link", { name: /crm/i });
  await expect(crmLink).toBeVisible();
});