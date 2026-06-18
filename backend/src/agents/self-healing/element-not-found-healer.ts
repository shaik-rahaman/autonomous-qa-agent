/**
 * Element Not Found Healer - Deterministic recovery when element doesn't exist
 * 
 * When a selector doesn't match any element, try alternative patterns:
 * 1. Find similar attributes in failed selector
 * 2. Generate healing attempts based on similarity scoring
 * 3. Relax from strict to non-strict selectors
 * 4. Try similar role-based selectors
 * 5. Fall back to parent container selectors
 */

export interface HealingAttempt {
  selector: string;
  strategy: string;
  fallbackLevel: number;
  confidence?: number;
}

export interface SimilarCandidate {
  selector: string;
  similarity: number; // 0-100
  type: 'attribute' | 'name' | 'placeholder' | 'label' | 'role';
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns 0-100 similarity score
 */
function calculateStringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 100;
  
  const editDistance = getLevenshteinDistance(longer, shorter);
  return Math.round(((longer.length - editDistance) / longer.length) * 100);
}

/**
 * Levenshtein distance algorithm - for string similarity
 */
function getLevenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;
  const d: number[][] = [];
  
  for (let i = 0; i <= len1; i++) {
    d[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    d[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  
  return d[len1][len2];
}

/**
 * Find similar candidates from failed selector
 * Example: [name="asdfpassword"] -> [name="password"]
 */
export function findSimilarCandidates(failedSelector: string): SimilarCandidate[] {
  const candidates: SimilarCandidate[] = [];
  
  // Extract attribute name and value from selector
  const attrMatch = failedSelector.match(/\[([a-z-]+)=['"]([^'"]+)['"]\]/i);
  if (attrMatch) {
    const attrName = attrMatch[1];
    const attrValue = attrMatch[2];
    
    // CANDIDATE 1: Exact attribute name with corrected value
    // Example: [name="asdfpassword"] -> [name="password"]
    const correctedValue = correctAttributeValue(attrValue);
    if (correctedValue !== attrValue) {
      candidates.push({
        selector: `[${attrName}="${correctedValue}"]`,
        similarity: 95,
        type: 'attribute',
      });
    }
    
    // CANDIDATE 2: Similar attribute names
    // Example: [name="..."] -> [id="..."]
    const similarAttrs = ['id', 'name', 'class', 'placeholder', 'aria-label'];
    for (const similarAttr of similarAttrs) {
      if (similarAttr !== attrName) {
        candidates.push({
          selector: `[${similarAttr}="${attrValue}"]`,
          similarity: 70,
          type: 'attribute',
        });
      }
    }
    
    // CANDIDATE 3: Related selectors (e.g., input[name="..."])
    const commonPrefixes = ['input', 'button', 'a', 'div', 'span', 'textarea', 'select'];
    for (const prefix of commonPrefixes) {
      candidates.push({
        selector: `${prefix}[${attrName}="${attrValue}"]`,
        similarity: 75,
        type: 'attribute',
      });
    }
  }
  
  // CANDIDATE 4: Extract role-based selectors from failed locator
  const roleMatch = failedSelector.match(/getByRole\(["'](\w+)["'].*?name:\s*([/"][\s\S]*?[/"])/);
  if (roleMatch) {
    const role = roleMatch[1];
    const nameArg = roleMatch[2];
    
    // Extract the actual text/name from the failed selector
    let extractedName = '';
    if (nameArg.startsWith('/')) {
      // Regex pattern - extract text from /...../i
      const regexMatch = nameArg.match(/\/(.+?)\//);
      extractedName = regexMatch ? regexMatch[1] : '';
    } else {
      // String literal - extract text from "..."
      extractedName = nameArg.replace(/^["']|["']$/g, '');
    }
    
    // If we found the name, try similar variations
    if (extractedName) {
      // Try original name
      candidates.push({
        selector: `getByRole("${role}", { name: /${extractedName}/i })`,
        similarity: 100,
        type: 'role',
      });
      
      // Try corrected versions of the name (remove common typo prefixes)
      const corrected = correctAttributeValue(extractedName);
      if (corrected !== extractedName) {
        candidates.push({
          selector: `getByRole("${role}", { name: /${corrected}/i })`,
          similarity: calculateStringSimilarity(extractedName, corrected) * 0.95,
          type: 'role',
        });
      }
    }
  }
  
  // Sort by similarity descending
  return candidates.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Correct common attribute value typos
 * Example: "asdfpassword" -> "password"
 */
function correctAttributeValue(value: string): string {
  // Remove prefixes that look like typos
  const patterns = [
    { pattern: /^asdf/, replacement: '' },  // asdfpassword -> password
    { pattern: /^qwerty/, replacement: '' }, // qwertyfield -> field
    { pattern: /^test/, replacement: '' },  // testEmail -> Email
    { pattern: /^demo/, replacement: '' },  // demoUsername -> Username
    { pattern: /^tmp/, replacement: '' },   // tmpPassword -> Password
    { pattern: /^xxx/, replacement: '' },   // xxxLogin -> Login
    { pattern: /^abc/, replacement: '' },   // abcEmail -> Email
  ];
  
  for (const { pattern, replacement } of patterns) {
    if (pattern.test(value)) {
      const corrected = value.replace(pattern, replacement);
      if (corrected.length > 2) {
        return corrected;
      }
    }
  }
  
  return value;
}

/**
 * Heal element not found errors deterministically
 * 
 * Strategies (in order of preference):
 * 1. Find similar selectors based on DOM analysis
 * 2. Remove :visible suffix if present
 * 3. Try text-based selector if role failed
 * 4. Try parent container
 * 5. Try CSS-based fallback
 */
export class ElementNotFoundHealer {
  
  /**
   * Generate healing attempts without LLM
   */
  static generateHeals(failedSelector: string): HealingAttempt[] {
    const heals: HealingAttempt[] = [];
    
    // HEAL 1: Find similar candidates from failed selector
    const similarCandidates = findSimilarCandidates(failedSelector);
    for (const candidate of similarCandidates) {
      heals.push({
        selector: candidate.selector,
        strategy: `similarity_based_${candidate.type}`,
        fallbackLevel: 1,
        confidence: candidate.similarity,
      });
    }
    
    // HEAL 2: Remove :visible suffix
    if (failedSelector.endsWith(':visible')) {
      const withoutVisible = failedSelector.replace(/:visible$/, '');
      heals.push({
        selector: withoutVisible,
        strategy: 'remove_visible_suffix',
        fallbackLevel: 2,
      });
    }
    
    // HEAL 3: Extract role name and try with relaxed matching
    const roleMatch = failedSelector.match(/getByRole\(["'](\w+)["']/);
    if (roleMatch) {
      const role = roleMatch[1];
      
      // If strict role matching failed, try with just the role
      const relaxed = `getByRole("${role}")`;
      if (relaxed !== failedSelector) {
        heals.push({
          selector: relaxed,
          strategy: 'relax_role_matching',
          fallbackLevel: 3,
        });
      }
    }
    
    // HEAL 4: Try text-based matching
    const textMatch = failedSelector.match(/["'](.*?)["']/);
    if (textMatch && !failedSelector.includes('getByText')) {
      const text = textMatch[1];
      heals.push({
        selector: `getByText("${text}")`,
        strategy: 'fallback_to_text',
        fallbackLevel: 4,
      });
    }
    
    // HEAL 5: Try parent container matching
    if (failedSelector.includes('getByRole')) {
      // Try finding visible element within page
      heals.push({
        selector: 'page.locator("body")' ,
        strategy: 'fallback_to_parent',
        fallbackLevel: 5,
      });
    }
    
    // HEAL 6: Try CSS selector as last resort
    if (failedSelector.includes('getByRole')) {
      const nameMatch = failedSelector.match(/name\s*:\s*["']([^"']+)["']/);
      if (nameMatch) {
        const cssVersion = `locator("[role], [aria-label*='${nameMatch[1]}']")`;
        heals.push({
          selector: cssVersion,
          strategy: 'fallback_to_css',
          fallbackLevel: 6,
        });
      }
    }
    
    return heals;
  }
  
  /**
   * Validate healing - must produce different selector
   */
  static validate(
    original: string,
    healed: string
  ): { valid: true } | { valid: false; reason: string } {
    
    if (original === healed) {
      return { valid: false, reason: 'Healed selector is same as original' };
    }
    
    // Reject weak patterns
    if (healed.includes('unknown_selector')) {
      return { valid: false, reason: 'Healed selector contains unknown_selector' };
    }
    
    if (healed.includes(':visible')) {
      return { valid: false, reason: 'Healed selector still contains :visible' };
    }
    
    return { valid: true };
  }
  
  /**
   * Check if a selector is a valid Playwright API
   */
  static isValidPlaywrightSelector(selector: string): boolean {
    const validStarts = [
      'getByRole(',
      'getByLabel(',
      'getByPlaceholder(',
      'getByText(',
      'getByTestId(',
      'locator(',
      'page.locator(',
    ];
    
    return validStarts.some(start => selector.includes(start));
  }
}
