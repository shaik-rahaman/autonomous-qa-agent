/**
 * Unit Tests - Deterministic Playwright Self-Healing System
 * 
 * Tests for:
 * 1. ErrorClassifier
 * 2. StrictModeHealer
 * 3. ElementNotFoundHealer
 * 4. TimingHealer
 * 5. DeterministicHealer orchestrator
 */

import { ErrorClassifier } from '../error-classifier';
import { StrictModeHealer, type StrictModeCandidate } from '../strict-mode-healer';
import { ElementNotFoundHealer } from '../element-not-found-healer';
import { TimingHealer } from '../timing-healer';
import { DeterministicHealer } from '../deterministic-healer';

describe('Deterministic Playwright Self-Healing', () => {
  
  // ============================================================================
  // TEST SUITE 1: ErrorClassifier
  // ============================================================================
  describe('ErrorClassifier', () => {
    
    test('TASK: Classify strict mode violation', () => {
      const error = `getByText(/Dashboard/i) resolved to 2 elements:
        1. getByRole('link', { name: 'Dashboard' })
        2. getByRole('heading', { name: 'Dashboard' })`;
      
      const classified = ErrorClassifier.classify(error, 'getByText(/Dashboard/i)');
      
      expect(classified.type).toBe('strict_mode_violation');
      expect(classified.severity).toBe('high');
      expect(classified.isHealable).toBe(true);
      expect(classified.candidates).toBeDefined();
      expect(classified.candidates!.length).toBeGreaterThan(0);
      
      console.log('✅ PASS: Strict mode violation classified correctly');
    });
    
    test('TASK: Classify element not found', () => {
      const error = `Locator did not resolve to any DOM elements`;
      
      const classified = ErrorClassifier.classify(error, 'getByRole("button", { name: "Submit" })');
      
      expect(classified.type).toBe('element_not_found');
      expect(classified.isHealable).toBe(true);
      
      console.log('✅ PASS: Element not found classified correctly');
    });
    
    test('TASK: Classify timeout error', () => {
      const error = `Timeout waiting for selector`;
      
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.type).toBe('timeout');
      expect(classified.isHealable).toBe(true);
      
      console.log('✅ PASS: Timeout error classified correctly');
    });
    
    test('TASK: Classify syntax error (not healable)', () => {
      const error = `SyntaxError: Unexpected token '}'`;
      
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.type).toBe('syntax_error');
      expect(classified.isHealable).toBe(false);
      
      console.log('✅ PASS: Syntax error identified as not healable');
    });
  });
  
  // ============================================================================
  // TEST SUITE 2: StrictModeHealer
  // ============================================================================
  describe('StrictModeHealer', () => {
    
    test('TASK: Heal strict mode by selecting heading role', () => {
      const originalSelector = 'getByText(/Dashboard/i)';
      const candidates: StrictModeCandidate[] = [
        {
          selector: "getByRole('link', { name: 'Dashboard' })",
          type: 'role',
          score: 60,
        },
        {
          selector: "getByRole('heading', { name: 'Dashboard' })",
          type: 'role',
          score: 100,
        },
      ];
      
      const result = StrictModeHealer.heal(originalSelector, candidates);
      
      expect(result.healed).toBe(true);
      if (result.healed) {
        expect(result.newSelector).toContain('heading');
        expect(result.newSelector).not.toEqual(originalSelector);
        console.log(`✅ PASS: Healed strict mode: ${originalSelector} → ${result.newSelector}`);
      }
    });
    
    test('TASK: Pick best candidate using priority', () => {
      const candidates: StrictModeCandidate[] = [
        { selector: "getByRole('link', { name: 'Login' })", type: 'role', score: 0 },
        { selector: "getByRole('button', { name: 'Login' })", type: 'role', score: 0 },
        { selector: "getByRole('heading', { name: 'Login' })", type: 'role', score: 0 },
      ];
      
      const best = StrictModeHealer.pickBest(candidates);
      
      expect(best).not.toBeNull();
      expect(best!.selector).toContain('heading');
      
      console.log(`✅ PASS: Selected best candidate: ${best!.selector}`);
    });
    
    test('TASK: Validate healing is different and valid', () => {
      const original = 'getByText(/Dashboard/i)';
      const healed = "getByRole('heading', { name: 'Dashboard' })";
      
      const validation = StrictModeHealer.validate(original, healed);
      
      expect(validation.valid).toBe(true);
      
      console.log('✅ PASS: Healing validation passed');
    });
    
    test('Reject healing that is same as original', () => {
      const original = "getByRole('heading', { name: 'Dashboard' })";
      const healed = "getByRole('heading', { name: 'Dashboard' })";
      
      const validation = StrictModeHealer.validate(original, healed);
      
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.reason).toContain('same as original');
      }
      
      console.log('✅ PASS: Rejected same selector');
    });
  });
  
  // ============================================================================
  // TEST SUITE 3: ElementNotFoundHealer
  // ============================================================================
  describe('ElementNotFoundHealer', () => {
    
    test('TASK: Generate healing attempt - remove :visible', () => {
      const failedSelector = "getByRole('button'):visible";
      
      const heals = ElementNotFoundHealer.generateHeals(failedSelector);
      
      expect(heals.length).toBeGreaterThan(0);
      const firstHeal = heals[0];
      expect(firstHeal.selector).not.toContain(':visible');
      expect(firstHeal.strategy).toContain('visible');
      
      console.log(`✅ PASS: Generated healing: ${firstHeal.selector}`);
    });
    
    test('TASK: Generate fallback strategies', () => {
      const failedSelector = "getByRole('button', { name: 'Login' })";
      
      const heals = ElementNotFoundHealer.generateHeals(failedSelector);
      
      expect(heals.length).toBeGreaterThan(0);
      const strategies = heals.map((h: any) => h.strategy);
      
      // Should have multiple fallback levels
      expect(strategies.some((s: any) => s.includes('relax'))).toBe(true);
      
      console.log(`✅ PASS: Generated ${heals.length} fallback strategies`);
    });
  });
  
  // ============================================================================
  // TEST SUITE 4: TimingHealer
  // ============================================================================
  describe('TimingHealer', () => {
    
    test('TASK: Detect timing-related error', () => {
      const error = 'Locator did not resolve to any DOM elements';
      
      const isTimer = TimingHealer.isTimingIssue(error);
      
      expect(isTimer).toBe(true);
      
      console.log('✅ PASS: Timing issue detected');
    });
    
    test('TASK: Get retry strategy with proper waits', () => {
      const strategy = TimingHealer.getRetryStrategy();
      
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.waitCommands.length).toBeGreaterThan(0);
      expect(strategy.waitCommands[0]).toContain('networkidle');
      
      console.log(`✅ PASS: Retry strategy includes: ${strategy.waitCommands.join(', ')}`);
    });
    
    test('TASK: Retry after page load - return original selector', () => {
      const original = "getByRole('button', { name: 'Submit' })";
      const withWaits = `
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        ${original}
      `;
      
      const validation = TimingHealer.validate(original, withWaits);
      
      expect(validation.valid).toBe(true);
      
      console.log('✅ PASS: Timing heal validation passed');
    });
    
    test('TASK: Check for proper waits in test code', () => {
      const codeWithWaits = `
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        await expect(page.getByRole('button')).toBeVisible();
      `;
      
      const hasWaits = TimingHealer.hasProperWaits(codeWithWaits);
      
      expect(hasWaits).toBe(true);
      
      console.log('✅ PASS: Detected proper waits in code');
    });
  });
  
  // ============================================================================
  // TEST SUITE 5: DeterministicHealer Orchestrator
  // ============================================================================
  describe('DeterministicHealer Orchestrator', () => {
    
    test('TASK: Heal strict mode violation end-to-end', () => {
      const error = `getByText(/Dashboard/i) resolved to 2 elements:
        1. getByRole('link', { name: 'Dashboard' })
        2. getByRole('heading', { name: 'Dashboard' })`;
      const originalSelector = 'getByText(/Dashboard/i)';
      
      const result = DeterministicHealer.heal(error, originalSelector);
      
      expect(result.healed).toBe(true);
      expect(result.newSelector).toBeDefined();
      expect(result.newSelector).toContain('heading');
      expect(result.strategy).toBe('strict_mode_healing');
      expect(result.confidence).toBe('high');
      
      console.log(`✅ PASS: Healed strict mode: ${result.newSelector}`);
    });
    
    test('TASK: Heal element not found with timing', () => {
      const error = 'Locator did not resolve to any DOM elements';
      const originalSelector = "getByRole('button', { name: 'Submit' })";
      
      const result = DeterministicHealer.heal(error, originalSelector);
      
      expect(result.healed).toBe(true);
      expect(result.strategy).toBe('timing_retry');
      expect(result.confidence).toBe('medium');
      
      console.log(`✅ PASS: Healed with timing retry`);
    });
    
    test('TASK: Skip healing for syntax error', () => {
      const error = 'SyntaxError: Unexpected token }';
      const originalSelector = 'getByText("Login")';
      
      const result = DeterministicHealer.heal(error, originalSelector);
      
      expect(result.healed).toBe(false);
      expect(result.reason).toContain('not healable');
      
      console.log(`✅ PASS: Syntax error correctly marked as not healable`);
    });
    
    test('TASK: Remove weak selectors', () => {
      const code = `
        const selector = unknown_selector;
        const selectorWithVisible = unknown_selector:visible;
        const concatenated = selector + ':visible';
      `;
      
      const { code: cleaned, removed } = DeterministicHealer.removeWeakSelectors(code);
      
      expect(cleaned).not.toContain('unknown_selector');
      expect(removed.length).toBeGreaterThan(0);
      
      console.log(`✅ PASS: Removed ${removed.length} weak selector patterns`);
    });
    
    test('TASK: Validate healing success criteria', () => {
      const original = 'getByText(/Dashboard/i)';
      const newSelector = "getByRole('heading', { name: 'Dashboard' })";
      const replacementCount = 1;
      
      const validation = DeterministicHealer.validateHealing(
        original,
        newSelector,
        replacementCount
      );
      
      expect(validation.valid).toBe(true);
      
      console.log('✅ PASS: Healing success criteria met');
    });
    
    test('TASK: Reject healing with no replacements', () => {
      const original = 'getByText(/Dashboard/i)';
      const newSelector = "getByRole('heading', { name: 'Dashboard' })";
      const replacementCount = 0; // No replacements made
      
      const validation = DeterministicHealer.validateHealing(
        original,
        newSelector,
        replacementCount
      );
      
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.reason).toContain('No replacements');
      }
      
      console.log('✅ PASS: Rejected healing with zero replacements');
    });
  });
  
  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================
  describe('Integration Tests', () => {
    
    test('Full flow: OrangeHRM Dashboard strict mode failure', () => {
      // Simulate real OrangeHRM test failure
      const error = `getByText(/Dashboard/i) resolved to 2 elements:
        1. getByRole('link', { name: 'Dashboard' })
        2. getByRole('heading', { name: 'Dashboard' })
      Strict mode does not allow more than 1 element.`;
      
      const original = 'getByText(/Dashboard/i)';
      
      // Heal
      const healed = DeterministicHealer.heal(error, original);
      
      // Validate
      const validation = DeterministicHealer.validateHealing(
        original,
        healed.newSelector || original,
        healed.healed ? 1 : 0
      );
      
      expect(healed.healed).toBe(true);
      expect(validation.valid).toBe(true);
      expect(healed.confidence).toBe('high');
      
      console.log(`\n✅ INTEGRATION TEST PASSED`);
      console.log(`   Error: Strict mode violation`);
      console.log(`   Original: ${original}`);
      console.log(`   Healed: ${healed.newSelector}`);
      console.log(`   Confidence: ${healed.confidence}`);
    });
    
    test('Full flow: Element not found with timing', () => {
      const error = 'Locator "getByRole(\'button\', { name: \'Login\' })" did not resolve to any DOM elements.';
      const original = "getByRole('button', { name: 'Login' })";
      
      const healed = DeterministicHealer.heal(error, original);
      
      expect(healed.healed).toBe(true);
      expect(healed.strategy).toContain('timing');
      
      console.log(`\n✅ INTEGRATION TEST PASSED`);
      console.log(`   Error: Element not found`);
      console.log(`   Strategy: ${healed.strategy}`);
      console.log(`   Confidence: ${healed.confidence}`);
    });
  });
});
