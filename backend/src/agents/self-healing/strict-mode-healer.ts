/**
 * Strict Mode Healer - Deterministic resolution of Playwright strict mode violations
 * 
 * When multiple elements match a selector, Playwright strict mode fails.
 * This healer picks the best candidate using priority rules.
 * 
 * Priority: heading > button > textbox > link > text > css
 */

export interface StrictModeCandidate {
  selector: string;
  type: 'role' | 'text' | 'testid' | 'label' | 'css';
  score?: number;  // Optional - will be calculated if not provided
  reason?: string;
}

/**
 * Heal strict mode violations by choosing best candidate
 */
export class StrictModeHealer {
  
  /**
   * Priority scoring - higher = better
   */
  private static PRIORITY_SCORES = {
    'heading': 100,
    'button': 90,
    'textbox': 80,
    'input': 75,
    'combobox': 70,
    'link': 60,
    'menuitem': 50,
    'text': 40,
    'css': 20,
  };
  
  /**
   * Heal strict mode violation by selecting best candidate
   */
  static heal(
    originalSelector: string,
    candidates: StrictModeCandidate[]
  ): { healed: true; newSelector: string; reason: string } | { healed: false; reason: string } {
    
    if (!candidates || candidates.length === 0) {
      return {
        healed: false,
        reason: 'No candidates found for healing',
      };
    }
    
    // If only one candidate, use it (validates it's different)
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (candidate.selector === originalSelector) {
        return {
          healed: false,
          reason: 'Only candidate is the same as original selector',
        };
      }
      return {
        healed: true,
        newSelector: candidate.selector,
        reason: `Only candidate available: ${candidate.selector}`,
      };
    }
    
    // Score all candidates
    const scored = candidates.map(candidate => ({
      ...candidate,
      score: this.scoreCandidate(candidate),
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    const bestCandidate = scored[0];
    
    // Validate best candidate is different from original
    if (bestCandidate.selector === originalSelector) {
      // If best is same as original, try second-best
      if (scored.length > 1) {
        const secondBest = scored[1];
        if (secondBest.selector !== originalSelector) {
          return {
            healed: true,
            newSelector: secondBest.selector,
            reason: `Best match same as original, using second: ${secondBest.type} (score: ${secondBest.score})`,
          };
        }
      }
      return {
        healed: false,
        reason: 'Best candidate is same as original selector',
      };
    }
    
    return {
      healed: true,
      newSelector: bestCandidate.selector,
      reason: `Selected ${bestCandidate.type} (score: ${bestCandidate.score}) over ${scored.length} candidates`,
    };
  }
  
  /**
   * Score a candidate based on semantic importance
   */
  private static scoreCandidate(candidate: StrictModeCandidate): number {
    // If score already set, use it
    if (candidate.score && candidate.score > 0) {
      return candidate.score;
    }
    
    // Extract role from selector for getByRole patterns
    // Example: getByRole("heading", { name: "Dashboard" }) → heading
    const roleMatch = candidate.selector.match(/getByRole\(["'](\w+)["']/);
    if (roleMatch) {
      const role = roleMatch[1].toLowerCase();
      const baseScore = this.PRIORITY_SCORES[role as keyof typeof this.PRIORITY_SCORES] || 30;
      
      // Boost if it contains "name" parameter (more specific)
      const hasName = /name\s*:\s*/.test(candidate.selector);
      return hasName ? baseScore + 5 : baseScore;
    }
    
    // Score by type
    if (candidate.type === 'role') return 85;
    if (candidate.type === 'testid') return 80;
    if (candidate.type === 'label') return 75;
    if (candidate.type === 'text') return 40;
    if (candidate.type === 'css') return 20;
    
    return 30; // Default
  }
  
  /**
   * Pick best candidate from a list using priority rules
   * 
   * Input: Multiple getByRole candidates from strict mode error
   * Output: Single best candidate
   */
  static pickBest(candidates: StrictModeCandidate[]): StrictModeCandidate | null {
    if (!candidates || candidates.length === 0) return null;
    
    if (candidates.length === 1) return candidates[0];
    
    // Apply priority: heading > button > textbox > link > text > css
    const priorityRoles = ['heading', 'button', 'textbox', 'input', 'link', 'text'];
    
    for (const role of priorityRoles) {
      const match = candidates.find(c => 
        c.selector.toLowerCase().includes(role) ||
        c.type === role
      );
      if (match) return match;
    }
    
    // If no priority match, return highest scored
    const scored = candidates.map(c => ({
      ...c,
      score: this.scoreCandidate(c),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }
  
  /**
   * Validate that a healed selector is different and valid
   */
  static validate(
    original: string,
    healed: string
  ): { valid: true } | { valid: false; reason: string } {
    
    // Must be different
    if (original === healed) {
      return { valid: false, reason: 'Healed selector is same as original' };
    }
    
    // Must not be weak pattern
    if (healed.includes('unknown_selector')) {
      return { valid: false, reason: 'Healed selector contains unknown_selector' };
    }
    
    if (healed.includes(':visible')) {
      return { valid: false, reason: 'Healed selector contains :visible suffix' };
    }
    
    // Must be a valid Playwright selector
    if (!this.isValidPlaywrightSelector(healed)) {
      return { valid: false, reason: `Invalid Playwright selector: ${healed}` };
    }
    
    return { valid: true };
  }
  
  /**
   * Check if selector is a valid Playwright API call
   */
  private static isValidPlaywrightSelector(selector: string): boolean {
    const validPatterns = [
      /^getByRole\(/,
      /^getByLabel\(/,
      /^getByPlaceholder\(/,
      /^getByText\(/,
      /^getByTestId\(/,
      /^locator\(/,
    ];
    
    return validPatterns.some(pattern => pattern.test(selector));
  }
}
