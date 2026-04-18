import { test, expect } from '@playwright/test';
import { login, logout, isLoggedIn } from '../../helpers/auth';
import users from '../../data/users.json';

const LOGIN_URL = 'http://leaftaps.com/opentaps/control/main';

test.describe('UI — Leaftaps Login', () => {
  test('login page loads and shows the login form', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="USERNAME"]').fill('demosalesmanager');
    await page.locator('input[name="PASSWORD"]').fill('crmsfa');
    await page.locator('input[type="submit"]').click();
  });

  
});
