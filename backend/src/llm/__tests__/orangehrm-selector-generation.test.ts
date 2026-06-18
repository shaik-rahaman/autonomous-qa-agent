/**
 * Test to ensure LLM generation never produces weak selectors for OrangeHRM Dashboard
 * CRITICAL: This test enforces that generated selectors are strong and production-ready
 */

import { LLMService } from '../llm-service';

describe('OrangeHRM Dashboard Selector Generation', () => {
  /**
   * CRITICAL TEST: Ensure Dashboard selector is NEVER weak
   */
  it('should NEVER generate getByText(/Dashboard/i) - this fails in strict mode', async () => {
    const testSteps = `
    Test Steps:
    1. Login to OrangeHRM at https://opensource-demo.orangehrmlive.com/web/index.php/auth/login
    2. Enter username: Admin
    3. Enter password: admin123
    4. Click login button
    5. Verify Dashboard page has loaded
    6. Verify Dashboard heading is visible
    `;

    const result = await LLMService.processTestSteps(testSteps, 
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // CRITICAL ASSERTION: Must NOT contain weak Dashboard selector
    expect(code).not.toMatch(/getByText\s*\(\s*\/Dashboard\/i\s*\)/);
    expect(code).not.toMatch(/getByText\s*\(\s*['"]Dashboard['"]\s*\)/);
    expect(code).not.toContain('getByText(/Dashboard/i)');
    expect(code).not.toContain("getByText('Dashboard')");
    expect(code).not.toContain('getByText("Dashboard")');
  }, 60000);

  /**
   * CRITICAL TEST: Ensure Dashboard selector IS strong
   */
  it('should generate strong getByRole("heading", { name: "Dashboard" }) selector', async () => {
    const testSteps = `
    Test Steps:
    1. Login to OrangeHRM at https://opensource-demo.orangehrmlive.com/web/index.php/auth/login
    2. Enter username: Admin
    3. Enter password: admin123
    4. Click login button
    5. Verify Dashboard page has loaded
    6. Verify Dashboard heading is visible
    `;

    const result = await LLMService.processTestSteps(testSteps,
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // CRITICAL ASSERTION: Must contain strong Dashboard selector
    expect(code).toMatch(/getByRole\s*\(\s*["']heading["']\s*,\s*\{\s*name\s*:\s*["']Dashboard["']\s*\}\s*\)/);
  }, 60000);

  /**
   * CRITICAL TEST: Ensure page.goto uses domcontentloaded + 60s, NOT load with 30s
   */
  it('should use waitUntil: "domcontentloaded" with 60000ms timeout, NOT "load"', async () => {
    const testSteps = `
    Test Steps:
    1. Navigate to OrangeHRM login page
    2. Enter credentials
    3. Click login
    4. Verify dashboard
    `;

    const result = await LLMService.processTestSteps(testSteps,
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // CRITICAL: Must NOT use waitUntil: "load"
    expect(code).not.toMatch(/waitUntil\s*:\s*["']load["']/);
    
    // CRITICAL: Must use waitUntil: "domcontentloaded" 
    expect(code).toMatch(/waitUntil\s*:\s*["']domcontentloaded["']/);
    
    // CRITICAL: Must use 60000 timeout
    expect(code).toMatch(/timeout\s*:\s*60000/);
  }, 60000);

  /**
   * CRITICAL TEST: Ensure networkidle wait after navigation
   */
  it('should wait for networkidle after page.goto', async () => {
    const testSteps = `
    Test Steps:
    1. Login to OrangeHRM
    2. Verify dashboard loads
    `;

    const result = await LLMService.processTestSteps(testSteps,
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // CRITICAL: Must wait for networkidle after navigation
    expect(code).toMatch(/waitForLoadState\s*\(\s*["']networkidle["']\s*\)/);
  }, 60000);

  /**
   * CRITICAL TEST: Never use :visible suffix in any healing code
   */
  it('should NEVER append :visible suffix to any selector', async () => {
    const testSteps = `
    Test Steps:
    1. Navigate and verify Dashboard
    `;

    const result = await LLMService.processTestSteps(testSteps,
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // CRITICAL: Never use :visible
    expect(code).not.toContain(':visible');
    expect(code).not.toMatch(/:visible\s*[`"']/);
  }, 60000);

  /**
   * TEST: Ensure expect().toBeVisible() uses timeout
   */
  it('should use extended timeout in expect().toBeVisible() calls', async () => {
    const testSteps = `
    Test Steps:
    1. Login and verify dashboard is visible
    `;

    const result = await LLMService.processTestSteps(testSteps,
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // Should have timeout in visibility check
    expect(code).toMatch(/toBeVisible\s*\(\s*\{\s*timeout\s*:\s*\d+\s*\}/);
  }, 60000);

  /**
   * TEST: Ensure waitForURL is called for dashboard navigation
   */
  it('should use waitForURL after login to verify dashboard navigation', async () => {
    const testSteps = `
    Test Steps:
    1. Login to OrangeHRM
    2. Verify Dashboard loads
    `;

    const result = await LLMService.processTestSteps(testSteps,
      'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');

    const code = result.message;
    console.log('Generated Code:', code);
    
    // Should wait for dashboard URL
    expect(code).toMatch(/waitForURL\s*\(/);
  }, 60000);
});
