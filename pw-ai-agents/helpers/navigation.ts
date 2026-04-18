import type { Page } from '@playwright/test';

/**
 * Navigate to a path relative to baseURL and wait for the page to be fully loaded.
 */
export async function gotoAndWait(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for a CSS selector to be visible on the page.
 */
export async function waitForVisible(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible' });
}

/**
 * Click an element and wait for navigation to complete.
 */
export async function clickAndNavigate(page: Page, selector: string): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click(selector),
  ]);
}

/**
 * Scroll to the bottom of the page.
 */
export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}
