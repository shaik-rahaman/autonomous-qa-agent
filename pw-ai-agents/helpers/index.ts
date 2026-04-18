/**
 * Common Playwright test helpers
 * Used by generated tests
 */

import type { Page, TestInfo } from '@playwright/test';

/**
 * Navigate to a URL
 */
export async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/**
 * Log a test step
 */
export async function logStep(description: string): Promise<void> {
  console.log(`  ➜ ${description}`);
}

/**
 * Capture a screenshot
 */
export async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string
): Promise<string> {
  const newPath = testInfo.snapshotPath(name);
  await page.screenshot({ path: newPath });
  return newPath;
}

/**
 * Login helper
 */
export async function login(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  const emailInput = page.locator('input[type="email"]').or(page.locator('input[type="text"]'));
  const passwordInput = page.locator('input[type="password"]');
  
  await emailInput.fill(email);
  await passwordInput.fill(password);
  
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();
  
  await page.waitForLoadState('networkidle');
}

/**
 * Fill a form by labels
 */
export async function fillForm(
  page: Page,
  data: Record<string, string>
): Promise<void> {
  for (const [field, value] of Object.entries(data)) {
    const input = page.locator(`input[name="${field}"], input[placeholder*="${field}"]`);
    await input.fill(value);
  }
}

/**
 * Wait for element visibility
 */
export async function waitForVisible(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
}

/**
 * Get element text
 */
export async function getElementText(page: Page, selector: string): Promise<string> {
  return await page.locator(selector).textContent() || '';
}

/**
 * Click and wait for navigation
 */
export async function clickAndWait(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click();
  await page.waitForLoadState('networkidle');
}
