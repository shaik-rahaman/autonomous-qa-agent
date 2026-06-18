/**
 * Unit tests for code post-processor
 * Ensures generated code is fixed before saving
 */

import { postProcessGeneratedCode, validateGeneratedCode } from '../code-post-processor';

describe('Code Post-Processor - Locator Priority Enforcement', () => {
  describe('Dashboard Selector Fixes', () => {
    it('should replace weak getByText(/Dashboard/i) with strong heading selector', () => {
      const weakCode = `
await expect(page.getByText(/Dashboard/i)).toBeVisible();
`;
      const result = postProcessGeneratedCode(weakCode);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('getByRole("heading", { name: "Dashboard" })');
      expect(result.code).not.toContain('getByText(/Dashboard/i)');
      expect(result.fixes.length).toBeGreaterThan(0);
      expect(result.fixes[0]).toContain('Replaced weak selector');
    });

    it('should replace getByText("Dashboard") with strong heading selector', () => {
      const weakCode = `const dashboard = page.getByText("Dashboard");
await expect(dashboard).toBeVisible();`;
      
      const result = postProcessGeneratedCode(weakCode);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('getByRole("heading", { name: "Dashboard" })');
      expect(result.code).not.toContain('getByText("Dashboard")');
    });

    it('should replace variable assignment pattern for Dashboard', () => {
      const weakCode = `const dashboard = page.getByText(/Dashboard/i);
    await expect(dashboard).toBeVisible();`;
      
      const result = postProcessGeneratedCode(weakCode);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('getByRole("heading", { name: "Dashboard" })');
      expect(result.code).toContain('await expect');
      expect(result.fixes.some(f => f.includes('variable assignment'))).toBe(true);
    });
  });

  describe('Post-Login Validation Pattern', () => {
    it('should fix weak Dashboard check in login flow with proper waits', () => {
      const loginFlowCode = `
await page.locator('[name="username"]').fill("Admin");
await page.locator('[name="password"]').fill("admin123");
await page.locator("button").click();

await expect(page.getByText(/Dashboard/i)).toBeVisible();
`;
      
      const result = postProcessGeneratedCode(loginFlowCode);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('waitForURL');
      expect(result.code).toContain('waitForLoadState("networkidle")');
      expect(result.code).toContain('getByRole("heading", { name: "Dashboard" })');
      expect(result.code).not.toContain('getByText(/Dashboard/i)');
    });
  });

  describe('OrangeHRM Element Fixes', () => {
    it('should replace weak Login button selectors', () => {
      const weakCode = `await page.getByText(/Login/i).click();`;
      
      const result = postProcessGeneratedCode(weakCode);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('getByRole("button", { name: /login/i })');
      expect(result.code).not.toContain('getByText(/Login/i)');
    });

    it('should handle employee list links', () => {
      const weakCode = `await page.getByText(/Employee List/i).click();`;
      
      const result = postProcessGeneratedCode(weakCode);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('getByRole("link", { name: /employee list/i })');
    });
  });

  describe('Code Validation', () => {
    it('should flag critical Dashboard weak selector', () => {
      const invalidCode = `await expect(page.getByText(/Dashboard/i)).toBeVisible();`;
      
      const validation = validateGeneratedCode(invalidCode);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain('CRITICAL');
      expect(validation.errors[0]).toContain('getByText(/Dashboard/i)');
    });

    it('should validate strong Dashboard selector as correct', () => {
      const validCode = `await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();`;
      
      const validation = validateGeneratedCode(validCode);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should warn about missing networkidle wait', () => {
      const missingWaitCode = `await page.goto("https://example.com");
await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();`;
      
      const validation = validateGeneratedCode(missingWaitCode);
      
      expect(validation.errors.some(e => e.includes('networkidle'))).toBe(true);
    });

    it('should warn about old-style load wait', () => {
      const oldWaitCode = `await page.waitForLoadState("load");`;
      
      const validation = validateGeneratedCode(oldWaitCode);
      
      expect(validation.errors.some(e => e.includes('waitForLoadState("load")'))).toBe(true);
    });
  });

  describe('Complete Generated Script Validation', () => {
    it('should fix entire weak OrangeHRM login script', () => {
      const weakScript = `import { test, expect } from "@playwright/test";

test("Login to OrangeHRM and verify dashboard loads", async ({ page }) => {
  try {
    await page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login");
    await page.waitForLoadState("load");
    
    await page.locator('[name="username"]').fill("Admin");
    await page.locator('[name="password"]').fill("admin123");
    await page.locator(".oxd-button.oxd-button--medium.oxd-button--main").click();
    
    const dashboard = page.getByText(/Dashboard/i);
    await expect(dashboard).toBeVisible();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});`;

      const result = postProcessGeneratedCode(weakScript);
      
      expect(result.modified).toBe(true);
      expect(result.code).toContain('getByRole("heading", { name: "Dashboard" })');
      expect(result.code).not.toContain('getByText(/Dashboard/i)');
      expect(result.code).not.toContain('const dashboard = page');
      
      // Should have proper waits
      expect(result.code).toContain('waitForURL(/dashboard/i)');
      expect(result.code).toContain('waitForLoadState("networkidle")');
    });

    it('should preserve correct strong selector script unchanged', () => {
      const strongScript = `import { test, expect } from "@playwright/test";

test("Login to OrangeHRM and verify dashboard", async ({ page }) => {
  try {
    await page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle");
    
    await page.locator('[name="username"]').fill("Admin");
    await page.locator('[name="password"]').fill("admin123");
    await page.locator(".oxd-button.oxd-button--main").click();
    
    await page.waitForURL(/dashboard/i);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});`;

      const result = postProcessGeneratedCode(strongScript);
      
      expect(result.modified).toBe(false);
      expect(result.code).toBe(strongScript);
      expect(result.fixes.length).toBe(0);
    });
  });

  describe('Safety Net Effectiveness', () => {
    it('should always fix weak selectors even if LLM ignores prompt', () => {
      // Simulating LLM ignoring the locator priority prompt
      const ignorantLLMOutput = `import { test, expect } from "@playwright/test";

test("Login and verify", async ({ page }) => {
  await page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login");
  await page.locator('[name="username"]').fill("Admin");
  await page.locator('[name="password"]').fill("admin123");
  await page.click("button:has-text('Login')");
  
  // LLM chose weak selector despite instructions
  await expect(page.getByText(/Dashboard/i)).toBeVisible();
});`;

      const result = postProcessGeneratedCode(ignorantLLMOutput);
      
      expect(result.modified).toBe(true);
      expect(result.fixes.length).toBeGreaterThan(0);
      expect(result.code).toContain('getByRole("heading"');
      expect(result.code).not.toContain('getByText(/Dashboard/i)');
    });
  });
});
