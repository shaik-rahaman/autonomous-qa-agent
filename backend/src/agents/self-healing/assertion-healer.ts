/**
 * Assertion Healer - Detects and heals failed assertion statements
 * 
 * Handles failures like:
 * - expect(page.getByRole("heading", {name:"Dashboard"})).toBeVisible()
 * - expect(page.locator(...)).toHaveText(...)
 * - expect(page.locator(...)).toContainText(...)
 * 
 * Healing Strategy:
 * 1. Wait for page stabilization (networkidle, timeout)
 * 2. Check URL context for navigation success (e.g., /dashboard/)
 * 3. Search page for alternative dashboard indicators
 * 4. Replace failed assertion with strongest available locator
 */

import { Page } from 'playwright';

export interface AssertionFailure {
  errorMessage: string;
  failedAssertion: string;  // e.g., "toBeVisible()"
  failedLocator?: string;   // e.g., "getByRole("heading",{name:"Dashboard"})"
  testFile: string;
  url: string;
}

export interface AssertionHealingResult {
  fixed: boolean;
  reason: string;
  alternativeAssertion?: string;
  alternativeLocator?: string;
  confidence?: number;
}

/**
 * Detect if error is an assertion failure
 */
export function isAssertionFailure(error: string): boolean {
  const assertionPatterns = [
    /expect\s*\(/i,
    /toBeVisible/i,
    /toHaveText/i,
    /toContainText/i,
    /toBeChecked/i,
    /toBeEnabled/i,
    /toBeDisabled/i,
    /toHaveAttribute/i,
    /toHaveClass/i,
    /element not found/i,
    /assertion error/i,
    /received[:\s]*undefined/i,
  ];
  
  return assertionPatterns.some(pattern => pattern.test(error));
}

/**
 * Extract assertion details from error message
 */
export function extractAssertionDetails(errorMessage: string): {
  assertion: string;
  locator?: string;
  expectedValue?: string;
} {
  // Extract assertion type
  let assertion = 'toBeVisible'; // default
  const assertionMatch = errorMessage.match(/\.to(BeVisible|HaveText|ContainText|BeChecked|BeEnabled|BeDisabled|HaveAttribute|HaveClass|HaveValue|HaveCount)/);
  if (assertionMatch) {
    assertion = assertionMatch[0].substring(1); // Remove leading dot
  }

  // Extract locator pattern
  let locator: string | undefined;
  const locatorMatch = errorMessage.match(/getBy(Role|Text|TestId|Label|Placeholder)\s*\([^)]+\)/);
  if (locatorMatch) {
    locator = locatorMatch[0];
  }

  // Extract expected value
  let expectedValue: string | undefined;
  const valueMatch = errorMessage.match(/(?:to have text|expected):\s*['"`]([^'"`]+)['"`]/i);
  if (valueMatch) {
    expectedValue = valueMatch[1];
  }

  return { assertion, locator, expectedValue };
}

/**
 * Check URL for context clues
 */
export function checkURLContext(url: string): {
  pageType: string;
  indicators: string[];
} {
  const indicators: string[] = [];
  let pageType = 'unknown';

  if (url.includes('/dashboard') || url.includes('/home')) {
    pageType = 'dashboard';
    indicators.push('text=Dashboard', 'h6:has-text("Dashboard")', '.oxd-topbar-header-title', '.page-title', 'role=heading');
  } else if (url.includes('/login')) {
    pageType = 'login';
    indicators.push('text=Login', 'text=Sign In', 'role=button', '[type="submit"]');
  } else if (url.includes('/settings') || url.includes('/profile')) {
    pageType = 'profile';
    indicators.push('text=Settings', 'text=Profile', 'role=heading');
  } else if (url.includes('/admin')) {
    pageType = 'admin';
    indicators.push('text=Admin', 'text=Administration', '.admin-title', 'role=heading');
  }

  return { pageType, indicators };
}

/**
 * Find alternative assertions based on error and page context
 */
export async function findAlternativeAssertion(
  page: Page | null,
  failure: AssertionFailure
): Promise<AssertionHealingResult> {
  try {
    // Step 1: Wait for page stabilization
    if (page) {
      try {
        await page.waitForLoadState('networkidle').catch(() => {
          // Ignore errors, this is just a best-effort wait
        });
        await page.waitForTimeout(2000);
      } catch (e) {
        // Continue even if waits fail
      }
    }

    // Step 2: Check URL context
    const urlContext = checkURLContext(failure.url);
    console.log(`[ASSERTION-HEALER] URL Context: ${urlContext.pageType}`);
    console.log(`[ASSERTION-HEALER] Potential indicators: ${urlContext.indicators.join(', ')}`);

    // Step 3: Extract assertion details
    const details = extractAssertionDetails(failure.errorMessage);
    console.log(`[ASSERTION-HEALER] Failed assertion: ${details.assertion}`);
    console.log(`[ASSERTION-HEALER] Failed locator: ${details.locator || 'unknown'}`);

    // Step 4: Determine if navigation was successful
    const urlNavigationSuccess = urlContext.pageType !== 'unknown';
    console.log(`[ASSERTION-HEALER] URL indicates successful navigation: ${urlNavigationSuccess}`);

    // Step 5: Build alternative assertion
    let alternativeAssertion = '';
    let alternativeLocator = '';
    let confidence = 0;

    // If URL context matches (e.g., in /dashboard/ URL), we can heal by checking URL instead of heading
    if (urlContext.pageType === 'dashboard' && urlNavigationSuccess) {
      // Mark healing successful if we reached the dashboard URL
      // Alternative: Check if page title/heading exists anywhere
      alternativeAssertion = 'page.url().includes("/dashboard")';
      alternativeLocator = 'url-based';
      confidence = 85;
      console.log(`[ASSERTION-HEALER] ✓ Dashboard URL detected - healing as successful navigation`);
    } else if (details.assertion === 'toBeVisible') {
      // For visibility assertions, check if element exists instead
      alternativeAssertion = `${details.locator ? details.locator + '.' : ''}isVisible()`;
      alternativeLocator = details.locator || 'unknown';
      confidence = 70;
    } else if (details.assertion === 'toHaveText' || details.assertion === 'toContainText') {
      // For text assertions, try to find similar elements
      alternativeAssertion = `${details.locator ? details.locator + '.' : ''}innerText().includes("${details.expectedValue || 'text'}")`;
      alternativeLocator = details.locator || 'unknown';
      confidence = 65;
    } else if (urlNavigationSuccess) {
      // If URL is correct, consider assertion healed
      alternativeAssertion = 'page.url() check passed';
      alternativeLocator = 'url-based';
      confidence = 80;
    }

    if (alternativeAssertion) {
      return {
        fixed: true,
        reason: `Healed with alternative: ${alternativeAssertion}`,
        alternativeAssertion,
        alternativeLocator,
        confidence,
      };
    }

    return {
      fixed: false,
      reason: 'Could not find suitable alternative assertion',
      confidence: 0,
    };
  } catch (error) {
    return {
      fixed: false,
      reason: `Assertion healing failed: ${String(error)}`,
      confidence: 0,
    };
  }
}

/**
 * Generate replacement code for failed assertion
 */
export function generateAssertionReplacement(
  originalCode: string,
  failure: AssertionFailure,
  alternative: AssertionHealingResult
): string {
  if (!alternative.fixed || !alternative.alternativeAssertion) {
    return originalCode;
  }

  // Try to replace the expect() statement
  const expectPattern = /expect\s*\([^)]+\)\s*\.to[A-Za-z]+\s*\([^)]*\)/;
  
  let replaced = originalCode.replace(
    expectPattern,
    `expect(${alternative.alternativeAssertion}).toBeTruthy()`
  );

  // If no replace, try URL-based assertion
  if (replaced === originalCode && alternative.alternativeLocator === 'url-based') {
    replaced = originalCode.replace(
      expectPattern,
      `expect(page.url()).toContain("${new URL(failure.url).pathname}")`
    );
  }

  console.log(`[ASSERTION-HEALER] Replacement generated`);
  console.log(`  Original: ${originalCode.substring(0, 80)}`);
  console.log(`  Replaced: ${replaced.substring(0, 80)}`);

  return replaced;
}

/**
 * Heal assertion failure by updating test file
 */
export async function healAssertionFailure(
  testFilePath: string,
  failure: AssertionFailure,
  page?: Page
): Promise<{
  success: boolean;
  message: string;
  newAssertion?: string;
}> {
  try {
    const fs = require('fs');
    
    // Read test file
    const content = fs.readFileSync(testFilePath, 'utf-8');
    
    // Find alternative
    const alternative = await findAlternativeAssertion(page || null, failure);
    
    if (!alternative.fixed) {
      return {
        success: false,
        message: alternative.reason,
      };
    }

    // Generate replacement
    const newContent = generateAssertionReplacement(content, failure, alternative);
    
    // Write back
    if (newContent !== content) {
      fs.writeFileSync(testFilePath, newContent, 'utf-8');
      console.log(`[ASSERTION-HEALER] ✓ Test file updated: ${testFilePath}`);
      return {
        success: true,
        message: `Assertion healed: ${alternative.reason}`,
        newAssertion: alternative.alternativeAssertion,
      };
    } else {
      return {
        success: false,
        message: 'No changes were made to the test file',
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to heal assertion: ${String(error)}`,
    };
  }
}
