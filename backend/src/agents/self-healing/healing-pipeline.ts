/**
 * Self-Healing Agent (Enhanced with robust healing pipeline)
 * Detects and heals Playwright selector failures with error classification, strategy selection, and telemetry.
 */

import { FixRecommender } from './recommender';
import { 
  isAssertionFailure, 
  findAlternativeAssertion, 
  generateAssertionReplacement,
  AssertionFailure,
  AssertionHealingResult 
} from './assertion-healer';

export interface TestFailure {
  error: string;
  selector?: string;
  testFile: string;
  testName: string;
  stackTrace?: string;
}

export interface HealFailureInput {
  step: string;
  error: string;
  selector: string;
  url: string;
}

export interface HealFailureOutput {
  fixed: boolean;
  newSelector?: string;
  reason: string;
}

export type HealingCategory =
  | 'ELEMENT_NOT_FOUND'
  | 'STRICT_MODE_VIOLATION'
  | 'ELEMENT_NOT_VISIBLE'
  | 'TIMEOUT_WAITING'
  | 'TIMING_FAILURE'
  | 'ASSERTION_FAILURE'
  | 'NAVIGATION_IN_PROGRESS'
  | 'ENVIRONMENT_FAILURE'
  | 'FRAME_CONTEXT_MISMATCH'
  | 'UNKNOWN';

export function classifyPlaywrightError(error: any): HealingCategory {
  const msg = (typeof error === 'string') ? error.toLowerCase() : (error && typeof (error as any).message === 'string') ? (error as any).message.toLowerCase() : String(error || '').toLowerCase();
  
  // Check for assertion failures first
  if (isAssertionFailure(msg)) return 'ASSERTION_FAILURE';
  
  // Then check other categories
  if (/strict mode violation/.test(msg)) return 'STRICT_MODE_VIOLATION';
  if (/element not found|unable to find|no node found|queryselector returned null|failed to find element|locator not found/.test(msg)) return 'ELEMENT_NOT_FOUND';
  if (/not visible|element is not visible|tobevisible/.test(msg)) return 'ELEMENT_NOT_VISIBLE';
  // Treat explicit navigation failures and network/DNS/SSL errors as environment failures
  if (/navigation|auth\/validate|waiting for navigation|page is navigating|page\.goto/.test(msg)) return 'NAVIGATION_IN_PROGRESS';
  // Generic timeout detection (after navigation checks)
  if (/timeout|waiting for|exceeded|timed out/.test(msg)) return 'TIMEOUT_WAITING';
  if (/net::err|net::error|ec(o|n)refused|dns|name not resolved|ssl_error|ssl3_alert/.test(msg)) return 'ENVIRONMENT_FAILURE';
  if (/frame context|detached|stale element|frame was detached/.test(msg)) return 'FRAME_CONTEXT_MISMATCH';
  return 'UNKNOWN';
}

export interface HealingTelemetry {
  healingCategory: HealingCategory;
  originalLocator: string;
  healedLocator?: string;
  confidence?: number;
  retryCount: number;
  executionTime: number;
  reason?: string;
}

export async function healFailure(input: HealFailureInput): Promise<HealFailureOutput & { telemetry: HealingTelemetry }> {
  const start = Date.now();
  console.log('HEALING_ENTRY: healFailure', { step: input.step, selector: input.selector, url: input.url });
  const recommender = new FixRecommender();
  const healingCategory = classifyPlaywrightError(input.error);
  const actualAPI = detectPlaywrightAPI(input.error || '');
  const reachedLocatorFailure = healingCategory === 'ELEMENT_NOT_FOUND' && (!!actualAPI && (/^locator|locator\.|expect/.test(actualAPI)));
  console.log(`[HEALING-PIPELINE] Reached Locator Failure: ${reachedLocatorFailure ? 'YES' : 'NO'}`);
  let retryCount = 0;
  let healedLocator: string | undefined = undefined;
  let confidence: number | undefined = undefined;
  let reason = '';
  let fixed = false;

  // Step 0: Assertion healing (highest priority for non-locator failures)
  if (healingCategory === 'ASSERTION_FAILURE') {
    console.log(`[HEALING-PIPELINE] ✓ Assertion failure detected - attempting assertion healing`);
    try {
      const assertionFailure: AssertionFailure = {
        errorMessage: String(input.error),
        failedAssertion: 'toBeVisible', // Default, can be overridden
        testFile: input.step,
        url: input.url,
      };
      const assertionResult = await findAlternativeAssertion(null, assertionFailure);
      
      if (assertionResult.fixed && assertionResult.alternativeAssertion) {
        console.log(`[HEALING-PIPELINE] ✓ Assertion healed: ${assertionResult.reason}`);
        fixed = true;
        healedLocator = assertionResult.alternativeAssertion;
        reason = assertionResult.reason;
        confidence = assertionResult.confidence || 80;
        retryCount = 1;
      } else {
        console.log(`[HEALING-PIPELINE] ✗ Assertion healing failed: ${assertionResult.reason}`);
        reason = assertionResult.reason;
        confidence = 0;
        fixed = false;
        retryCount = 0;
      }
    } catch (e) {
      console.log(`[HEALING-PIPELINE] ✗ Assertion healing error: ${String(e)}`);
      reason = `Assertion healing error: ${String(e)}`;
      confidence = 0;
      fixed = false;
      retryCount = 0;
    }
  }
  // Step 1: Timing healer (optional - for page stabilization issues)
  else if (healingCategory === 'TIMING_FAILURE') {
    console.log(`[HEALING-PIPELINE] ✓ Timing failure detected - adding waits and retrying`);
    reason = 'Added page stabilization waits (networkidle, timeout)';
    confidence = 75;
    fixed = true;
    retryCount = 1;
    healedLocator = input.selector; // Same selector with timing fixes applied
  }
  // Step 2: Strict mode healing
  else if (healingCategory === 'STRICT_MODE_VIOLATION') {
    console.log('[HEALING-PIPELINE] CALLING_RECOMMENDER (STRICT_MODE_VIOLATION) selector=%s', input.selector);
    console.log('HEALING_LOG: invoking suggestAlternativeSelector (STRICT_MODE_VIOLATION)');
    const fix = await recommender.suggestAlternativeSelector(
      input.error,
      input.selector,
      input.url,
      input.step
    );
    fixed = fix.fixed;
    healedLocator = fix.newSelector;
    reason = fix.reason;
    confidence = 95;
    retryCount = 1;
  }
  // Step 3: Navigation-related failures should be treated as environment issues and skipped
  else if (healingCategory === 'NAVIGATION_IN_PROGRESS') {
    reason = 'Environment/navigation failure — skipping locator healing';
    confidence = 0;
    fixed = false;
    retryCount = 0;
  }
  // Step 4: Timeout waiting (non-navigation) — attempt healing
  else if (healingCategory === 'TIMEOUT_WAITING') {
    console.log('[HEALING-PIPELINE] CALLING_RECOMMENDER (TIMEOUT_WAITING) selector=%s', input.selector);
    console.log('HEALING_LOG: invoking suggestAlternativeSelector (TIMEOUT_WAITING)');
    const fix = await recommender.suggestAlternativeSelector(
      input.error,
      input.selector,
      input.url,
      input.step
    );
    fixed = fix.fixed;
    healedLocator = fix.newSelector;
    reason = fix.reason;
    confidence = 80;
    retryCount = 1;
  }
  // Environment failures: do not attempt selector healing
  else if (healingCategory === 'ENVIRONMENT_FAILURE') {
    reason = 'Environment/network/navigation failure — skipping locator healing';
    confidence = 0;
    fixed = false;
    retryCount = 0;
  }
  // Step 5: Visibility healing
  else if (healingCategory === 'ELEMENT_NOT_VISIBLE') {
    console.log('[HEALING-PIPELINE] CALLING_RECOMMENDER (ELEMENT_NOT_VISIBLE) selector=%s', input.selector);
    console.log('HEALING_LOG: invoking suggestAlternativeSelector (ELEMENT_NOT_VISIBLE)');
    const fix = await recommender.suggestAlternativeSelector(
      input.error,
      input.selector,
      input.url,
      input.step
    );
    fixed = fix.fixed;
    healedLocator = fix.newSelector;
    reason = fix.reason;
    confidence = 70;
    retryCount = 1;
  }
  // Step 6: Locator discovery
  else if (healingCategory === 'ELEMENT_NOT_FOUND') {
    if (!reachedLocatorFailure) {
      reason = 'Element not found but failure did not reach a locator API — skipping healing';
      fixed = false;
      confidence = 0;
      retryCount = 0;
      } else {
      console.log('[HEALING-PIPELINE] CALLING_RECOMMENDER (ELEMENT_NOT_FOUND) selector=%s', input.selector);
      console.log('HEALING_LOG: invoking suggestAlternativeSelector (ELEMENT_NOT_FOUND)');
      const fix = await recommender.suggestAlternativeSelector(
        input.error,
        input.selector,
        input.url,
        input.step
      );
      fixed = fix.fixed;
      healedLocator = fix.newSelector;
      reason = fix.reason;
      confidence = 60;
      retryCount = 1;
    }
  }
  // Step 7: Frame context mismatch
  else if (healingCategory === 'FRAME_CONTEXT_MISMATCH') {
    console.log('[HEALING-PIPELINE] CALLING_RECOMMENDER (FRAME_CONTEXT_MISMATCH) selector=%s', input.selector);
    console.log('HEALING_LOG: invoking suggestAlternativeSelector (FRAME_CONTEXT_MISMATCH)');
    const fix = await recommender.suggestAlternativeSelector(
      input.error,
      input.selector,
      input.url,
      input.step
    );
    fixed = fix.fixed;
    healedLocator = fix.newSelector;
    reason = fix.reason;
    confidence = 50;
    retryCount = 1;
  }
  // Step 8: Unknown
  else {
    console.log('[HEALING-PIPELINE] CALLING_RECOMMENDER (UNKNOWN) selector=%s', input.selector);
    console.log('HEALING_LOG: invoking suggestAlternativeSelector (UNKNOWN)');
    const fix = await recommender.suggestAlternativeSelector(
      input.error,
      input.selector,
      input.url,
      input.step
    );
    fixed = fix.fixed;
    healedLocator = fix.newSelector;
    reason = fix.reason;
    confidence = 40;
    retryCount = 1;
  }

  console.log('HEALING_EXIT: healFailure returning', { fixed, healedLocator, reason, telemetry: { healingCategory, confidence, retryCount } });

  const executionTime = Date.now() - start;
  const telemetry: HealingTelemetry = {
    healingCategory,
    originalLocator: input.selector,
    healedLocator,
    confidence,
    retryCount,
    executionTime,
    reason,
  };
  return {
    fixed,
    newSelector: healedLocator,
    reason,
    telemetry,
  };
}

export { FixRecommender };

/**
 * Detect Playwright API referenced by an error message and return a simple label
 */
export function detectPlaywrightAPI(error: string | undefined | null): string | null {
  if (!error) return null;
  const e = String(error).toLowerCase();
  if (/page\.goto/.test(e) || /waitforurl/.test(e) || /waitfornavigation/.test(e)) return 'page.goto/waitForURL';
  if (/locator\.(fill|click|type|check|selectoption|hover)/.test(e)) {
    const m = e.match(/locator\.(fill|click|type|check|selectoption|hover)/);
    return m ? `locator.${m[1]}` : 'locator.*';
  }
  if (/locator\(/.test(e) || /page\.locator/.test(e)) return 'locator';
  if (/expect\.(toBeVisible|toHaveText|toBeHidden)/.test(e)) return 'expect.*';
  return null;
}

/**
 * Convenience predicate used by the UI/backend to indicate whether the failure reached a locator API
 */
export function reachedLocatorFailureFromError(error: string | undefined | null): boolean {
  const api = detectPlaywrightAPI(error || '');
  return !!api && (/^locator|locator\.|expect/.test(api));
}
