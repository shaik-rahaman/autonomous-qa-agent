/**
 * Timing Healer - Retry original selector after page load completion
 * 
 * Many element-not-found errors are actually timing issues.
 * Strategy: Before healing, retry original selector after proper waits:
 * 
 * 1. await page.waitForLoadState('networkidle')
 * 2. await page.waitForTimeout(2000)
 * 3. Retry original selector
 * 
 * If retry succeeds: Return original selector (no change needed)
 * If retry fails: Proceed to other healers
 */

export interface TimingRetryResult {
  shouldRetry: boolean;
  waitCommands: string[];
  reason: string;
}

export interface TimingHealResult {
  retried: boolean;
  retrySucceeded?: boolean;
  originalSelector: string;
  waitTime: number;
}

/**
 * Heal timing-related failures by retrying after proper waits
 */
export class TimingHealer {
  
  /**
   * Determine if error is timing-related
   * 
   * Signs of timing issues:
   * - Element not found (might not be loaded yet)
   * - Timeout errors
   * - Random flakiness
   */
  static isTimingIssue(errorMessage: string): boolean {
    const patterns = [
      /did not resolve to any/i,
      /no element found/i,
      /timeout/i,
      /not visible/i,
      /not attached/i,
    ];
    
    return patterns.some(p => p.test(errorMessage));
  }
  
  /**
   * Get retry strategy for a timing issue
   */
  static getRetryStrategy(): TimingRetryResult {
    return {
      shouldRetry: true,
      waitCommands: [
        'await page.waitForLoadState("networkidle")',
        'await page.waitForTimeout(2000)',
      ],
      reason: 'Timing issue detected - retrying after page load + delay',
    };
  }
  
  /**
   * Build the retry code block as a string
   * This will be inserted before the failed assertion in the test
   */
  static buildRetryBlock(): string {
    return `
    // ===== TIMING HEAL: Retry after page load =====
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    // ===== TIMING HEAL: End retry block =====
    `.trim();
  }
  
  /**
   * Check if test code already has proper waits
   */
  static hasProperWaits(testCode: string): boolean {
    const hasNetworkIdle = /waitForLoadState\s*\(\s*['"]networkidle['"]/.test(testCode);
    const hasDelay = /waitForTimeout\s*\(\s*\d+/.test(testCode);
    const hasURLWait = /waitForURL/.test(testCode);
    
    return hasNetworkIdle && (hasDelay || hasURLWait);
  }
  
  /**
   * Generate healing attempts that add waits before assertions
   */
  static generateHeals(failedSelector: string): Array<{
    selector: string;
    strategy: string;
    healType: 'prepend_wait' | 'no_heal';
  }> {
    return [
      {
        selector: failedSelector,
        strategy: 'retry_after_waits',
        healType: 'prepend_wait',
      },
    ];
  }
  
  /**
   * Validate timing heal - original selector stays same,
   * but waits are added before it
   */
  static validate(original: string, withWaits: string): { valid: true } | { valid: false; reason: string } {
    // The selector should stay the same, only waits are prepended
    if (!withWaits.includes(original)) {
      return { valid: false, reason: 'Original selector not found in retry code' };
    }
    
    if (!withWaits.includes('waitForLoadState')) {
      return { valid: false, reason: 'Missing waitForLoadState in retry block' };
    }
    
    return { valid: true };
  }
  
  /**
   * Calculate wait time
   */
  static getTotalWaitTime(): number {
    // networkidle: depends on implementation, usually 500ms-2000ms
    // waitForTimeout(2000): explicit 2 second wait
    // Total: conservative estimate of 3000ms
    return 3000;
  }
}
