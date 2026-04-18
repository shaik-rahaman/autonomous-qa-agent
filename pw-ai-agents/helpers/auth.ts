import type { Page } from '@playwright/test';

export interface Credentials {
  username: string;
  password: string;
}

/**
 * Log in to opentaps (leaftaps.com) using the standard login form.
 */
export async function login(page: Page, credentials: Credentials): Promise<void> {
  await page.fill('input[name="USERNAME"]', credentials.username);
  await page.fill('input[name="PASSWORD"]', credentials.password);
  await page.click('input[type="submit"]');
  await page.waitForLoadState('networkidle');
}

/**
 * Log out by navigating to the logout control endpoint.
 */
export async function logout(page: Page): Promise<void> {
  await page.goto('http://leaftaps.com/opentaps/control/logout');
  await page.waitForLoadState('networkidle');
}

/**
 * Returns true when the page shows a logout link, indicating an active session.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  return page.isVisible('a[href*="logout"]');
}
