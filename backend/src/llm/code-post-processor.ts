/**
 * Code Post-Processor for Playwright Test Generation
 * Ensures generated code uses strong selectors and not weak getByText() patterns
 * Acts as safety net to fix generation issues before code is saved
 */

export interface PostProcessResult {
  code: string;
  modified: boolean;
  fixes: string[];
}

/**
 * Post-process generated Playwright code to enforce strong selectors
 * CRITICAL: Replaces weak selectors with strong role-based ones
 */
export function postProcessGeneratedCode(code: string): PostProcessResult {
  const fixes: string[] = [];
  let modified = false;
  let processedCode = code;

  // FIX 1: Replace weak Dashboard text selectors with strong heading selector
  const dashboardWeakPatterns = [
    /page\.getByText\s*\(\s*\/Dashboard\/i\s*\)/g,
    /page\.getByText\s*\(\s*["']Dashboard["']\s*\)/g,
    /getByText\s*\(\s*\/Dashboard\/i\s*\)/g,
    /getByText\s*\(\s*["']Dashboard["']\s*\)/g,
  ];

  for (const pattern of dashboardWeakPatterns) {
    if (pattern.test(processedCode)) {
      const match = processedCode.match(pattern);
      if (match) {
        fixes.push(`Replaced weak selector: ${match[0]} → page.getByRole("heading", { name: "Dashboard" })`);
        processedCode = processedCode.replace(
          pattern,
          'page.getByRole("heading", { name: "Dashboard" })'
        );
        modified = true;
      }
    }
  }

  // FIX 2: Fix incomplete variable assignments for Dashboard
  // Before: const dashboard = page.getByText(/Dashboard/i);
  // After: removed and use direct expect
  const varAssignmentPattern = /const\s+\w+\s*=\s*page\.getByText\s*\(\s*\/Dashboard\/i\s*\)\s*;\s*\n\s*await\s+expect\s*\(\s*\w+\s*\)\.toBeVisible\(\)\s*;/g;
  if (varAssignmentPattern.test(processedCode)) {
    fixes.push(`Replaced variable assignment pattern with direct strong selector`);
    processedCode = processedCode.replace(
      varAssignmentPattern,
      'await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });'
    );
    modified = true;
  }

  // FIX 3: Ensure post-login validation uses proper pattern
  // If code has login click but missing waitForURL pattern, add it
  if (
    processedCode.includes('page.locator') &&
    processedCode.includes('.click()') &&
    !processedCode.includes('waitForURL')
  ) {
    // Check if this looks like a login flow
    if (
      (processedCode.includes('username') || processedCode.includes('password')) &&
      processedCode.includes('Dashboard')
    ) {
      // Look for getByText(/Dashboard/i) and replace with proper pattern
      const dashboardCheckPattern = /await\s+expect\s*\(\s*page\.getByText\s*\(\s*\/Dashboard\/i\s*\)\s*\)\.toBeVisible\s*\(\s*\)\s*;/;
      if (dashboardCheckPattern.test(processedCode)) {
        const replacement = `await page.waitForURL(/dashboard/i);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });`;
        
        processedCode = processedCode.replace(dashboardCheckPattern, replacement);
        fixes.push(`Added proper post-login validation pattern (waitForURL + networkidle + strong selector)`);
        modified = true;
      }
    }
  }

  // FIX 4: Replace weak text selectors for common OrangeHRM elements
  const orangehrmWeakPatterns: { pattern: RegExp; replacement: string; description: string }[] = [
    {
      pattern: /page\.getByText\s*\(\s*\/Login\/i\s*\)/g,
      replacement: 'page.getByRole("button", { name: /login/i })',
      description: 'Login button (weak text → role)',
    },
    {
      pattern: /page\.getByText\s*\(\s*\/Submit\/i\s*\)/g,
      replacement: 'page.getByRole("button", { name: /submit/i })',
      description: 'Submit button (weak text → role)',
    },
    {
      pattern: /page\.getByText\s*\(\s*\/Employee\s+List\/i\s*\)/g,
      replacement: 'page.getByRole("link", { name: /employee list/i })',
      description: 'Employee List link (weak text → role)',
    },
  ];

  for (const { pattern, replacement, description } of orangehrmWeakPatterns) {
    if (pattern.test(processedCode)) {
      processedCode = processedCode.replace(pattern, replacement);
      fixes.push(`Fixed ${description}`);
      modified = true;
    }
  }

  return {
    code: processedCode,
    modified,
    fixes,
  };
}

/**
 * Validate generated code has no weak selectors
 * Returns validation errors if code has prohibited patterns
 */
export function validateGeneratedCode(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for weak Dashboard selectors
  if (/getByText\s*\(\s*\/Dashboard\/i\s*\)/.test(code)) {
    errors.push('CRITICAL: Found weak selector getByText(/Dashboard/i) - must use getByRole("heading", { name: "Dashboard" })');
  }

  if (/getByText\s*\(\s*["']Dashboard["']\s*\)/.test(code)) {
    errors.push('CRITICAL: Found weak selector getByText("Dashboard") - must use getByRole("heading", { name: "Dashboard" })');
  }

  // Check for weak Login selectors
  if (/getByText\s*\(\s*["']Login["']\s*\)/.test(code) && code.includes('expect')) {
    errors.push('WARNING: Found potential weak Login selector - verify it\'s a verification, not a button click');
  }

  // Check for missing networkidle after goto
  if (code.includes('page.goto') && !code.includes('waitForLoadState("networkidle")')) {
    errors.push('WARNING: page.goto() missing waitForLoadState("networkidle") - may cause race conditions');
  }

  // Check for old-style waitForLoadState("load")
  if (/waitForLoadState\s*\(\s*["']load["']\s*\)/.test(code)) {
    errors.push('WARNING: Using waitForLoadState("load") - prefer "domcontentloaded" with "networkidle"');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
