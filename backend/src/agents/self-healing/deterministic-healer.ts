/**
 * Deterministic Playwright Self-Healer Orchestrator
 * 
 * Combines ErrorClassifier + StrictModeHealer + ElementNotFoundHealer + TimingHealer
 * No LLM required - purely rule-based healing
 */

import { ErrorClassifier, ErrorType, ClassifiedError } from './error-classifier';
import { StrictModeHealer } from './strict-mode-healer';
import { ElementNotFoundHealer } from './element-not-found-healer';
import { TimingHealer } from './timing-healer';

export interface DeterministicHealResult {
  healed: boolean;
  originalSelector: string;
  newSelector?: string;
  strategy?: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Deterministic self-healer - no LLM, pure rule-based logic
 */
export class DeterministicHealer {
  
  /**
   * Heal a Playwright test failure
   * 
   * Process:
   * 1. Classify error
   * 2. Route to appropriate healer
   * 3. Generate healing attempt
   * 4. Validate healing (must be different + valid)
   * 5. Return result
   */
  static heal(
    errorMessage: string,
    failedSelector: string
  ): DeterministicHealResult {
    
    // STEP 1: Classify error
    const classified = ErrorClassifier.classify(errorMessage, failedSelector);
    
    // STEP 2: Check if healable
    if (!classified.isHealable) {
      return {
        healed: false,
        originalSelector: failedSelector,
        reason: `Error type "${classified.type}" is not healable`,
        confidence: 'high',
      };
    }
    
    // STEP 3: Route to appropriate healer based on error type
    if (classified.type === 'strict_mode_violation') {
      return this.healStrictModeViolation(failedSelector, classified);
    }
    
    if (classified.type === 'element_not_found') {
      return this.healElementNotFound(failedSelector, classified);
    }
    
    if (classified.type === 'timeout') {
      return this.healTimeoutIssue(failedSelector, classified);
    }
    
    // Unknown but healable - try timing retry
    if (TimingHealer.isTimingIssue(errorMessage)) {
      return this.healTimeoutIssue(failedSelector, classified);
    }
    
    return {
      healed: false,
      originalSelector: failedSelector,
      reason: `Unhandled error type: ${classified.type}`,
      confidence: 'low',
    };
  }
  
  /**
   * Heal strict mode violations
   */
  private static healStrictModeViolation(
    originalSelector: string,
    classified: ClassifiedError
  ): DeterministicHealResult {
    
    if (!classified.candidates || classified.candidates.length === 0) {
      return {
        healed: false,
        originalSelector,
        reason: 'Strict mode violation but no candidates extracted',
        confidence: 'low',
      };
    }
    
    // Ensure candidates have scores set
    const candidatesWithScores = classified.candidates.map(c => ({
      ...c,
      score: c.score ?? this.scoreCandidate(c),
    }));
    
    const healResult = StrictModeHealer.heal(originalSelector, candidatesWithScores);
    
    if (!healResult.healed) {
      return {
        healed: false,
        originalSelector,
        reason: healResult.reason,
        confidence: 'medium',
      };
    }
    
    // Validate healing
    const validation = StrictModeHealer.validate(originalSelector, healResult.newSelector);
    if (!validation.valid) {
      return {
        healed: false,
        originalSelector,
        reason: `Healing validation failed: ${validation.reason}`,
        confidence: 'medium',
      };
    }
    
    return {
      healed: true,
      originalSelector,
      newSelector: healResult.newSelector,
      strategy: 'strict_mode_healing',
      reason: healResult.reason,
      confidence: 'high',
    };
  }
  
  /**
   * Score a candidate for selection priority (GENERIC - not Dashboard-specific)
   * Prioritizes accessibility and specificity, not element type
   */
  private static scoreCandidate(candidate: { type: string; selector: string; score?: number }): number {
    if (candidate.score !== undefined && candidate.score > 0) {
      return candidate.score;
    }
    
    // Extract role from selector
    const roleMatch = candidate.selector.match(/getByRole\(["'](\w+)["']/);
    if (roleMatch) {
      const role = roleMatch[1].toLowerCase();
      // Generic scoring: prioritize by accessibility, not by specific element types
      // All roles scored equally - let specificity matter, not element type
      const priorities: { [key: string]: number } = {
        button: 85,
        textbox: 85,
        checkbox: 85,
        radio: 85,
        heading: 80,    // Slightly lower - not priority
        link: 80,
        combobox: 85,
        searchbox: 85,
        img: 75,
        table: 75,
        row: 75,
        cell: 75,
        text: 40,
        css: 20,
      };
      return priorities[role] || 70;  // Default higher score for unknown roles
    }
    
    // Score by type (generic, not element-specific)
    const typeScores: { [key: string]: number } = {
      role: 85,
      testid: 80,
      label: 75,
      text: 40,
      css: 20,
    };
    
    return typeScores[candidate.type] || 30;
  }
  
  /**
   * Heal element not found errors
   */
  private static healElementNotFound(
    originalSelector: string,
    classified: ClassifiedError
  ): DeterministicHealResult {
    
    // FIRST: Try timing heal (retry after waits)
    if (TimingHealer.isTimingIssue(classified.errorMessage)) {
      const timingStrategy = TimingHealer.getRetryStrategy();
      return {
        healed: true,
        originalSelector,
        newSelector: originalSelector, // Selector stays same, but waits are prepended
        strategy: 'timing_retry',
        reason: timingStrategy.reason,
        confidence: 'medium',
      };
    }
    
    // SECOND: Generate healing attempts
    const heals = ElementNotFoundHealer.generateHeals(originalSelector);
    
    if (heals.length === 0) {
      return {
        healed: false,
        originalSelector,
        reason: 'No healing strategies available for element not found',
        confidence: 'low',
      };
    }
    
    // Try each heal in order
    for (const heal of heals) {
      const validation = ElementNotFoundHealer.validate(originalSelector, heal.selector);
      
      if (validation.valid) {
        return {
          healed: true,
          originalSelector,
          newSelector: heal.selector,
          strategy: heal.strategy,
          reason: `Strategy: ${heal.strategy} (level ${heal.fallbackLevel})`,
          confidence: heal.fallbackLevel <= 2 ? 'high' : 'medium',
        };
      }
    }
    
    return {
      healed: false,
      originalSelector,
      reason: 'No valid healing attempt found for element not found',
      confidence: 'low',
    };
  }
  
  /**
   * Heal timeout issues
   */
  private static healTimeoutIssue(
    originalSelector: string,
    classified: ClassifiedError
  ): DeterministicHealResult {
    
    const timingStrategy = TimingHealer.getRetryStrategy();
    
    return {
      healed: true,
      originalSelector,
      newSelector: originalSelector,
      strategy: 'timing_heal',
      reason: timingStrategy.reason,
      confidence: 'medium',
    };
  }
  
  /**
   * Delete weak selector patterns from code
   */
  static removeWeakSelectors(code: string): { code: string; removed: string[] } {
    const removed: string[] = [];
    let modified = code;
    
    // Pattern 1: unknown_selector
    const unknownPattern = /unknown_selector/g;
    if (unknownPattern.test(modified)) {
      removed.push('unknown_selector');
      modified = modified.replace(unknownPattern, '');
    }
    
    // Pattern 2: unknown_selector:visible
    const unknownVisiblePattern = /unknown_selector\s*:\s*visible/g;
    if (unknownVisiblePattern.test(modified)) {
      removed.push('unknown_selector:visible');
      modified = modified.replace(unknownVisiblePattern, '');
    }
    
    // Pattern 3: selector + ':visible'
    const visiblePattern = /(['"`])([^'"`]+?)\1\s*\+\s*['"`]:visible['"`]/g;
    if (visiblePattern.test(modified)) {
      removed.push('selector + ":visible" pattern');
      modified = modified.replace(visiblePattern, '$1$2$1');
    }
    
    // Pattern 4: .selector:visible
    const dotVisiblePattern = /\.selector\s*\+\s*['"]:visible['"]/g;
    if (dotVisiblePattern.test(modified)) {
      removed.push('.selector + ":visible"');
      modified = modified.replace(dotVisiblePattern, '.selector');
    }
    
    return { code: modified, removed };
  }
  
  /**
   * Validate healing success criteria
   */
  static validateHealing(
    originalSelector: string,
    newSelector: string,
    replacementCount: number
  ): { valid: true } | { valid: false; reason: string } {
    
    // Criterion 1: New selector must be different
    if (originalSelector === newSelector) {
      return { valid: false, reason: 'New selector is same as original' };
    }
    
    // Criterion 2: Replacement must have occurred
    if (replacementCount <= 0) {
      return { valid: false, reason: 'No replacements made in test code' };
    }
    
    // Criterion 3: No weak patterns
    if (newSelector.includes('unknown_selector')) {
      return { valid: false, reason: 'New selector contains unknown_selector' };
    }
    
    if (newSelector.includes(':visible')) {
      return { valid: false, reason: 'New selector contains :visible suffix' };
    }
    
    return { valid: true };
  }
}
