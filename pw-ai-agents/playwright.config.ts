import { defineConfig, devices } from '@playwright/test';

/**
 * Base URL is read from the BASE_URL environment variable.
 * Override at runtime: BASE_URL=https://myapp.com npx playwright test
 */
const BASE_URL = process.env.BASE_URL ?? 'http://leaftaps.com/opentaps';

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',

  /* Run tests in parallel by default */
  fullyParallel: true,

  /* Fail the build on CI if tests are accidentally committed as `.only` */
  forbidOnly: !!process.env.CI,

  /* Retry failed tests once on CI  */
  retries: process.env.CI ? 1 : 0,

  /* Limit workers on CI to avoid resource contention */
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,

    headless: false,

    /* Collect trace on first retry; open with: npx playwright show-trace */
    trace: 'on',

    /* Screenshot only on failure */
    screenshot: 'on',

    /* Video only on failure */
    video: 'on',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
/*     {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    }, */
  ],
});
