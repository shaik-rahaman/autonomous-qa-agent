import { test, expect } from '@playwright/test';

import { test } from "@playwright/test"

test("hello", async ({ page }) => { await page.goto("https://example.com");
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }); await page.waitForSelector("h1"); });