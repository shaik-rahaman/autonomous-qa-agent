/**
 * Error Classifier - Deterministic categorization of Playwright test failures
 * 
 * No LLM required - uses pattern matching and error message analysis
 */

export type ErrorType = 
  | 'strict_mode_violation'
  | 'element_not_found'
  | 'timeout'
  | 'navigation_failure'
  | 'syntax_error'
  | 'playwright_configuration_error'
  | 'playwright_environment_error'
  | 'assertion_failure'
  | 'unknown';

export interface ClassifiedError {
  type: ErrorType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  isHealable: boolean;
  errorMessage: string;
  extractedSelector?: string;
  candidates?: Array<{
    selector: string;
    type: 'role' | 'text' | 'testid' | 'label' | 'css';
    score?: number;
  }>;
}

/**
 * Classify Playwright test errors without LLM
 * 
 * CRITICAL FIX: Use actual locator information, not context
 */
export class ErrorClassifier {
  
  /**
   * Classify error from Playwright test failure
   * 
   * Classification rules:
   * 1. "waiting for locator" + "locator.fill/click/type/check/selectOption/hover" → ELEMENT_NOT_FOUND
   * 2. "strict mode violation" → STRICT_MODE_VIOLATION
   * 3. "toBeVisible" + timeout → VISIBILITY_TIMEOUT
   * 4. "waitForURL" → NAVIGATION_FAILURE
   * 5. Generic timeout → TIMEOUT
   */
  static classify(errorMessage: any, failedSelector?: string): ClassifiedError {
    // Prefer structured fields if a Playwright execution/result object was passed
    let message: string;
    if (typeof errorMessage === 'string') {
      message = errorMessage;
    } else if (errorMessage && typeof errorMessage === 'object') {
      // Prefer stderr/stdout/errors which contain the actual Playwright failure output
      const parts: string[] = [];
      if (typeof errorMessage.stderr === 'string') parts.push(errorMessage.stderr);
      if (typeof errorMessage.stdout === 'string') parts.push(errorMessage.stdout);
      if (Array.isArray(errorMessage.errors)) parts.push(errorMessage.errors.join('\n'));
      if (parts.length > 0) {
        message = parts.join('\n');
      } else if (typeof errorMessage.message === 'string') {
        message = errorMessage.message;
      } else {
        message = JSON.stringify(errorMessage);
      }
    } else {
      message = String(errorMessage || '');
    }
    const normalized = message.toLowerCase();
    
    console.log(`[ERROR-CLASSIFIER] Classifying: ${String(message).substring(0, 100)}`);
    
    // TASK 3: PRIORITY 0 - Playwright configuration errors (fast-fail, DO NOT heal)
    if (this.isPlaywrightConfigurationError(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: PLAYWRIGHT_CONFIGURATION_ERROR`);
      return {
        type: 'playwright_configuration_error',
        severity: 'critical',
        isHealable: false,
        errorMessage,
      };
    }

    // TASK 7: Playwright environment errors (missing binaries, filesystem issues)
    if (this.isPlaywrightEnvironmentError(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: PLAYWRIGHT_ENVIRONMENT_ERROR`);
      return {
        type: 'playwright_environment_error',
        severity: 'critical',
        isHealable: false,
        errorMessage,
      };
    }

    // PRIORITY 1a - Assertion failures (expect() statements)
    // These have unique healing strategy and should be processed separately
    if (this.isAssertionFailure(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: ASSERTION_FAILURE`);
      return {
        type: 'assertion_failure',
        severity: 'high',
        isHealable: true,
        errorMessage,
        extractedSelector: failedSelector,
      };
    }

    // PRIORITY 1 - Navigation timeout (MUST be first!)
    // "page.goto: Test timeout of 30000ms exceeded"
    // "waitForURL timeout"
    // "waitForNavigation timeout"
    if (this.isNavigationTimeout(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: NAVIGATION_TIMEOUT (not healable)`);
      return {
        type: 'navigation_failure',
        severity: 'high',
        isHealable: false,
        errorMessage,
      };
    }

    // RULE 1: Check for "waiting for locator" + specific method
    // This indicates element not found, not other timeouts
    if (this.isLocatorMethodTimeout(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: ELEMENT_NOT_FOUND (locator method)`);
      return {
        type: 'element_not_found',
        severity: 'high',
        isHealable: true,
        errorMessage,
        extractedSelector: failedSelector || this.extractSelector(errorMessage),
      };
    }

    // RULE 2: Strict Mode Violation
    // "getByText(/Dashboard/i) resolved to 2 elements"
    // Multiple elements match the locator
    if (this.isStrictModeViolation(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: STRICT_MODE_VIOLATION`);
      return {
        type: 'strict_mode_violation',
        severity: 'high',
        isHealable: true,
        errorMessage,
        extractedSelector: failedSelector || this.extractSelector(errorMessage),
        candidates: this.extractStrictModeCandidates(errorMessage),
      };
    }
    
    // RULE 3: Element Not Found
    // "Locator did not resolve to any DOM elements"
    if (this.isElementNotFound(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: ELEMENT_NOT_FOUND`);
      return {
        type: 'element_not_found',
        severity: 'high',
        isHealable: true,
        errorMessage,
        extractedSelector: failedSelector || this.extractSelector(errorMessage),
      };
    }
    
    // RULE 4: Visibility Timeout
    // "toBeVisible" timeout specifically
    if (this.isVisibilityTimeout(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: VISIBILITY_TIMEOUT`);
      return {
        type: 'timeout',
        severity: 'medium',
        isHealable: true,
        errorMessage,
        extractedSelector: failedSelector || this.extractSelector(errorMessage),
      };
    }

    // RULE 5: Generic Timeout
    // Other timeouts (but not navigation)
    if (this.isTimeoutError(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: TIMEOUT`);
      return {
        type: 'timeout',
        severity: 'medium',
        isHealable: true,
        errorMessage,
        extractedSelector: failedSelector || this.extractSelector(errorMessage),
      };
    }
    
    // PATTERN 4: Navigation Failure (legacy pattern)
    // "Navigation failed"
    // "net::ERR_"
    if (this.isNavigationFailure(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: NAVIGATION_FAILURE`);
      return {
        type: 'navigation_failure',
        severity: 'high',
        isHealable: false,
        errorMessage,
      };
    }
    
    // PATTERN 5: Syntax Error
    // "SyntaxError"
    if (this.isSyntaxError(message)) {
      console.log(`[ERROR-CLASSIFIER] ✓ Classification: SYNTAX_ERROR`);
      return {
        type: 'syntax_error',
        severity: 'critical',
        isHealable: false,
        errorMessage,
      };
    }
    
    // DEFAULT: Unknown error
    console.log(`[ERROR-CLASSIFIER] ✓ Classification: UNKNOWN`);
    return {
      type: 'unknown',
      severity: 'low',
      isHealable: false,
      errorMessage: message,
    };
  }

  /**
   * Detect Playwright configuration/runtime errors that indicate module/CLI/context issues
   * Examples:
   * - "Playwright Test did not expect test() to be called here"
   * - "No tests found"
   * - "Cannot find module '@playwright/test'"
   */
  private static isPlaywrightConfigurationError(error: string): boolean {
    const patterns = [
      /playwright test did not expect test\(\) to be called here/i,
      /no tests found/i,
      /cannot find module ['"]@playwright\/test['"]/i,
      /multiple .*@playwright\/test/i,
      /test\(\) called here/i,
    ];
    return patterns.some(p => p.test(error));
  }

  /**
   * Detect environment-level Playwright errors: missing CLI, file not found, command not found
   */
  private static isPlaywrightEnvironmentError(error: string): boolean {
    const patterns = [
      /cannot find module ['"]@playwright\/test['"]/i,
      /no such file or directory/i,
      /playwright: command not found/i,
      /ENOENT: no such file or directory/i,
    ];
    return patterns.some(p => p.test(error));
  }
  
  /**
   * CRITICAL: Detect "waiting for locator" + method call
   * "waiting for locator('[name="asdfdpassword"]') locator.fill timeout"
   * This is ELEMENT_NOT_FOUND, not a generic timeout
   */
  private static isLocatorMethodTimeout(error: string): boolean {
    const hasWaitingForLocator = /waiting for\s+(?:locator|getBy\w+)/i.test(error);
    if (!hasWaitingForLocator) return false;
    
    // Check for specific locator methods
    const methods = ['fill', 'click', 'type', 'check', 'selectOption', 'hover'];
    const hasMethod = methods.some(method => 
      new RegExp(`locator\\.${method}`, 'i').test(error)
    );
    
    return hasMethod;
  }
  
  /**
   * Detect visibility timeout specifically
   * "toBeVisible() timeout"
   */
  private static isVisibilityTimeout(error: string): boolean {
    return /toBeVisible|visibility/i.test(error) && /timeout|timed out/i.test(error);
  }
  
  /**
   * Detect navigation timeout specifically
   * "page.goto: Test timeout of 30000ms exceeded"
   * "waitForURL timeout"
   * "waitForNavigation timeout"
   * 
   * TASK 3: These are NOT locator failures - DO NOT heal
   */
  private static isNavigationTimeout(error: string): boolean {
    const patterns = [
      /page\.goto.*timeout/i,              // "page.goto: Test timeout"
      /page\.goto.*exceeded/i,             // "page.goto...ms exceeded"
      /waitForURL/i,                       // "waitForURL"
      /waitForNavigation/i,                // "waitForNavigation"
      /navigation.*timeout/i,              // "navigation timeout"
    ];
    
    return patterns.some(pattern => pattern.test(error));
  }
  
  /**
   * Detect strict mode violation pattern
   */
  private static isStrictModeViolation(error: string): boolean {
    const patterns = [
      /resolved to.*(\d+)\s+elements?/i,  // "resolved to 2 elements"
      /strict mode/i,                      // "strict mode"
      /multiple elements match/i,          // "multiple elements match"
      /expecting.*single.*element/i,       // "expecting single element"
    ];
    
    return patterns.some(pattern => pattern.test(error));
  }
  
  /**
   * Detect element not found pattern
   */
  private static isElementNotFound(error: string): boolean {
    const patterns = [
      /did not resolve to any/i,           // "did not resolve to any DOM elements"
      /no element found/i,                 // "No element found"
      /element.*not found/i,               // "Element not found"
      /unable to find/i,                   // "Unable to find"
      /locator did not find/i,             // "Locator did not find"
    ];
    
    return patterns.some(pattern => pattern.test(error));
  }
  
  /**
   * Detect timeout pattern
   */
  private static isTimeoutError(error: string): boolean {
    const patterns = [
      /timeout/i,                          // "Timeout"
      /waiting.*expired/i,                 // "waiting...expired"
      /timed out/i,                        // "timed out"
    ];
    
    return patterns.some(pattern => pattern.test(error));
  }
  
  /**
   * Detect navigation failure
   */
  private static isNavigationFailure(error: string): boolean {
    const patterns = [
      /navigation.*failed/i,               // "navigation failed"
      /net::err/i,                         // "net::ERR_"
      /target page.*crash/i,               // "Target page crashed"
    ];
    
    return patterns.some(pattern => pattern.test(error));
  }
  
  /**
   * Detect syntax error
   */
  private static isSyntaxError(error: string): boolean {
    return /syntaxerror/i.test(error);
  }

  /**
   * Detect assertion failure
   * Patterns:
   * - "expect(locator).toBeVisible()"
   * - "expect(locator).toHaveText(...)"
   * - "expect(locator).toContainText(...)"
   * - "expect(page.getByRole(...)).toBe..."
   * - Assertion errors with expect() in stack trace
   */
  private static isAssertionFailure(error: string): boolean {
    const patterns = [
      /expect\s*\(/i,                      // expect(
      /\.to(BeVisible|HaveText|ContainText|BeChecked|BeEnabled|BeDisabled|HaveAttribute|HaveClass|HaveValue|HaveCount)/i,
      /assertion error/i,                  // "assertion error"
      /expected.*to.*have.*text/i,         // "expected to have text"
      /expected.*to.*be.*visible/i,        // "expected to be visible"
      /assertion failed/i,                 // "assertion failed"
      /expect\.assertion/i,                // "expect.assertion"
    ];

    return patterns.some(pattern => pattern.test(error));
  }
  
  /**
   * Extract selector from error message
   */
  private static extractSelector(error: string): string | undefined {
    // Match patterns like: getByText(/Dashboard/i), getByRole("button"), etc.
    const patterns = [
      /getBy\w+\([^)]+\)/,                 // getByText(...), getByRole(...), etc.
      /locator\([^)]+\)/,                  // locator(...)
      /css=['"](.*?)['"]/,                 // css="..." or css='...'
    ];
    
    for (const pattern of patterns) {
      const match = error.match(pattern);
      if (match) return match[0];
    }
    
    return undefined;
  }
  
  /**
   * Extract strict mode candidates from error message
   */
  private static extractStrictModeCandidates(error: string): ClassifiedError['candidates'] {
    const candidates: ClassifiedError['candidates'] = [];
    
    // Match patterns like:
    // 1. getByRole('heading', { name: 'Dashboard' })
    // 2. getByRole('link', { name: 'Dashboard' })
    const rolePattern = /(\d+)\.\s+(getByRole\([^)]+\))/gi;
    const linkPattern = /link|href|navigation/i;
    const headingPattern = /heading|title|h\d|heading\d/i;
    const textPattern = /getByText\([^)]+\)/i;
    const testIdPattern = /getByTestId\([^)]+\)/i;
    
    let match;
    while ((match = rolePattern.exec(error)) !== null) {
      const selector = match[2];
      let type: 'role' | 'text' | 'testid' | 'label' | 'css' = 'role';
      let score = 0;
      
      // Score candidates based on semantic importance
      // Priority: heading > button > textbox > link > text > css
      if (headingPattern.test(selector)) {
        score = 100; // Highest priority
      } else if (/button/.test(selector)) {
        score = 90;
      } else if (/textbox|input/.test(selector)) {
        score = 80;
      } else if (linkPattern.test(selector)) {
        score = 70;
      } else {
        score = 50;
      }
      
      candidates.push({
        selector,
        type,
        score,
      });
    }
    
    // Also extract getByText if present
    const textMatch = error.match(textPattern);
    if (textMatch && !candidates.some(c => c.selector.includes('getByText'))) {
      candidates.push({
        selector: textMatch[0],
        type: 'text',
        score: 20,
      });
    }
    
    // Extract getByTestId if present
    const testIdMatch = error.match(testIdPattern);
    if (testIdMatch && !candidates.some(c => c.selector.includes('getByTestId'))) {
      candidates.push({
        selector: testIdMatch[0],
        type: 'testid',
        score: 85,
      });
    }
    
    // Sort by score descending
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    return candidates.length > 0 ? candidates : undefined;
  }
}
