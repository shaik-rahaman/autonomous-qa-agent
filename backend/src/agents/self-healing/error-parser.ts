// Error Parser - Extract structured information from Playwright errors
// Focus: Extract actual selectors and strict mode candidates from error messages
/**
 * Error Parser - Extract structured information from Playwright errors
 * Focus: Extract actual selectors and strict mode candidates from error messages
 * 
 * CRITICAL: Extract the ACTUAL failed locator that Playwright reports
 * NOT unrelated locators from error context
 */

export interface StrictModeCandidate {
  selector: string;
  role?: string;
  score: number;
}

export class LocatorExtractionBug extends Error {
  constructor(message?: string) {
    super(message || 'LocatorExtractionBug');
    this.name = 'LocatorExtractionBug';
  }
}

/**
 * Extract the actual failed locator from Playwright error message or error object
 * Supports: locator.fill, locator.click, locator.type, locator.check, locator.selectOption, locator.hover
 * 
 * PRIORITY (TASK 2 - FIXED):
 * 1. Playwright step params.selector
 * 2. "waiting for locator(...)" pattern from error (MOST RELIABLE)
 * 3. Direct locator() patterns
 * 4. getByRole/getByText patterns (ONLY from immediate context, not general error)
 * 5. Locator: pattern
 * 
 * CRITICAL: Do NOT match Dashboard unless it's the ACTUAL failed locator
 * 
 * Examples:
 *   params.selector: "[name=\"asdfdpassword\"]" → "[name=\"asdfdpassword\"]"
 *   
 *   "waiting for locator('[name=\"asdfdpassword\"]') locator.fill timeout"
 *   → "[name=\"asdfdpassword\"]"
 *   
 *   "waiting for getByText(/Dashboard/i) locator.click timeout"
 *   → "getByText(/Dashboard/i)" (ONLY if this is the actual failed line)
 */
export function extractFailedLocator(errorInput: any, errorObject?: any): string | null {
  if (!errorInput && !errorObject) return null;

  console.log(`[ERROR-PARSER] TASK 1: Finding actual failed locator from error`);
  // Show full object for deep inspection when object provided
  try {
    if (typeof errorInput === 'object' && errorInput !== null) {
      console.log('[ERROR-PARSER] Full error object passed to extractFailedLocator:');
      // eslint-disable-next-line no-console
      console.dir(errorInput, { depth: 20 });
    }
  } catch (e) {
    // ignore
  }
  // TASK 1: print symbol keys for debugging (Playwright uses Symbol(step))
  try {
    if (typeof errorInput === 'object' && errorInput !== null) {
      const syms = Object.getOwnPropertySymbols(errorInput || {}).map((s) => s.toString());
      console.log('[ERROR-PARSER] SYMBOL KEYS (errorInput):', syms);
    }
    if (typeof errorObject === 'object' && errorObject !== null) {
      const syms2 = Object.getOwnPropertySymbols(errorObject || {}).map((s) => s.toString());
      console.log('[ERROR-PARSER] SYMBOL KEYS (errorObject):', syms2);
    }
  } catch (e) {
    // ignore
  }

  // Prepare cleaned message if input is a string
  const cleanedMessage = String(errorInput || errorObject || '').replace(/\x1B\[[0-9;]*m/g, '');

  // PRIORITY 0b: If the textual error contains a params.selector assignment, prefer it
  const paramsTextMatch = cleanedMessage.match(/params\.selector\s*[=:]\s*['"]([^'"]+)['"]/);
  if (paramsTextMatch && paramsTextMatch[1]) {
    const selector = paramsTextMatch[1].trim();
    if (isValidSelector(selector)) {
      console.log(`[ERROR-PARSER] ✓ PRIORITY 0b - Extracted from params.selector text: ${selector}`);
      console.log(`[ERROR-PARSER] Selector source: params.selector`);
      return selector;
    } else {
      throw new LocatorExtractionBug('params.selector present in logs but invalid');
    }
  }

  // Utility: deep search for key named 'selector' and return path
  function findSelectorDeep(obj: any, path: (string | number)[] = []): { value: any; path: (string | number)[] } | null {
    if (obj == null) return null;
    if (typeof obj !== 'object') return null;

    // Arrays
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const res = findSelectorDeep(obj[i], path.concat(i));
        if (res) return res;
      }
      return null;
    }

    // Objects (including Symbols)
    // check own property 'selector' first
    if (Object.prototype.hasOwnProperty.call(obj, 'selector')) {
      return { value: obj['selector'], path: path.concat('selector') };
    }

    for (const key of Object.getOwnPropertyNames(obj)) {
      try {
        const val = (obj as any)[key];
        if (key === 'params' && val && typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, 'selector')) {
          return { value: val.selector, path: path.concat(key, 'selector') };
        }
        const res = findSelectorDeep(val, path.concat(key));
        if (res) return res;
      } catch (e) {
        // ignore property access errors
      }
    }

    // Also check symbol properties (e.g., Symbol(step))
    const symbols = Object.getOwnPropertySymbols(obj);
    for (const sym of symbols) {
      try {
        const val = (obj as any)[sym];
        if (val && typeof val === 'object') {
          // If this symbol object has params.selector
          if (val.params && Object.prototype.hasOwnProperty.call(val.params, 'selector')) {
            return { value: val.params.selector, path: path.concat(sym.toString(), 'params', 'selector') };
          }
          const res = findSelectorDeep(val, path.concat(sym.toString()));
          if (res) return res;
        }
      } catch (e) {
        // ignore
      }
    }

    return null;
  }

  // PRIORITY 0: If an object provided, search deeply for selector
  const candidateFromObject = findSelectorDeep(errorInput) || findSelectorDeep(errorObject);
  if (candidateFromObject && candidateFromObject.value) {
    const selector = String(candidateFromObject.value).trim();
    if (isValidSelector(selector)) {
      console.log(`[ERROR-PARSER] ✓ PRIORITY 0 - Extracted from object path: ${candidateFromObject.path.join('.')}`);
      console.log(`[ERROR-PARSER] Found selector: ${selector}`);
      console.log(`[ERROR-PARSER] Selector source: ${candidateFromObject.path.join('.')}`);
      return selector;
    }
    // If selector key exists but invalid, throw LocatorExtractionBug as requested
    if (candidateFromObject) {
      throw new LocatorExtractionBug('selector found in object but invalid');
    }
  }

  // PRIORITY 1: CRITICAL - Extract from "waiting for locator(..." pattern (TASK 2)
  // This is the ACTUAL locator that failed, NOT context locators
  // Examples:
  //   "waiting for locator('[name=\"asdfdpassword\"]') locator.fill timeout"
  //   "waiting for getByRole('button') locator.click"
  // Support both single and double quotes, and square bracket notation
  // PRIORITY 1: CRITICAL - Extract from "waiting for ...(..." patterns (robust to brackets and quotes)
  // Use a permissive capture for the content inside the parentheses, then strip outer quotes
  const waitingForRegex = /waiting for\s+(?:locator|getBy\w+)?\s*\(\s*([^)]+)\)/i;
  const waitingForMatch = cleanedMessage.match(waitingForRegex);
  if (waitingForMatch && waitingForMatch[1]) {
    let extracted = waitingForMatch[1].trim();
    if ((extracted.startsWith('"') && extracted.endsWith('"')) || (extracted.startsWith('\'') && extracted.endsWith('\''))) {
      extracted = extracted.slice(1, -1);
    }
    extracted = extracted.trim();
    if (isValidSelector(extracted)) {
      console.log(`[ERROR-PARSER] ✓ PRIORITY 1 - Extracted from waiting-for pattern: ${extracted}`);
      return extracted;
    }
  }

  // PRIORITY 2: Extract direct locator() patterns (TASK 2)
  // locator('[name="password"]')
  const locatorDirectMatch = cleanedMessage.match(/locator\s*\(([^)]+)\)/i);
  if (locatorDirectMatch && locatorDirectMatch[1]) {
    let extracted = locatorDirectMatch[1].trim();
    if ((extracted.startsWith('"') && extracted.endsWith('"')) || (extracted.startsWith('\'') && extracted.endsWith('\''))) {
      extracted = extracted.slice(1, -1);
    }
    extracted = extracted.trim();
    if (isValidSelector(extracted)) {
      console.log(`[ERROR-PARSER] ✓ PRIORITY 2 - Extracted from locator pattern: ${extracted}`);
      return extracted;
    }
  }

  // PRIORITY 3: Extract getByRole/getByText/etc patterns ONLY from immediate error context (TASK 2)
  // CRITICAL: Only match if it's in the "at" stack trace line (the actual failed assertion)
  // NOT from context about other elements
  const atMatch = cleanedMessage.match(/at\s+.+?getBy(Role|Text|Label|Placeholder|TestId)\s*\([^)]+\)/i);
  if (atMatch && atMatch[0]) {
    const getByMatch = atMatch[0].match(/getBy(Role|Text|Label|Placeholder|TestId)\s*\(([^)]+)\)/);
    if (getByMatch && getByMatch[0]) {
      if (isValidSelector(getByMatch[0])) {
        console.log(`[ERROR-PARSER] ✓ PRIORITY 3 - Extracted from getBy pattern (at context): ${getByMatch[0]}`);
        return getByMatch[0];
      }
    }
  }

  // FALLBACK: match getBy anywhere (less strict) - useful for many error formats
  const anyGetByMatch = cleanedMessage.match(/getBy(Role|Text|Label|Placeholder|TestId)\s*\([^)]+\)/);
  if (anyGetByMatch && anyGetByMatch[0]) {
    const selector = anyGetByMatch[0].trim();
    if (isValidSelector(selector)) {
      console.log(`[ERROR-PARSER] ✓ FALLBACK - Extracted getBy pattern anywhere: ${selector}`);
      return selector;
    }
  }

  // PRIORITY 4: Extract "Locator:" pattern lines (TASK 2)
  // Some error messages have: "Locator: getByRole('heading', { name: 'Dashboard' })"
  // But only if it's marked as the failed locator, not a suggestion
  const locatorLineMatch = cleanedMessage.match(/Locator:\s*([\[\{].*?[\]\}]|getBy\w+\([^)]+\))/i);
  if (locatorLineMatch && locatorLineMatch[1]) {
    const extracted = locatorLineMatch[1].trim();
    // CRITICAL: Only accept if it looks like ACTUAL selector syntax
    if (isValidSelector(extracted)) {
      console.log(`[ERROR-PARSER] ✓ PRIORITY 4 - Extracted from Locator: line: ${extracted}`);
      return extracted;
    }
  }

  // FALLBACK: match `selector "..." not found` patterns
  const plainSelectorMatch = cleanedMessage.match(/selector\s+['"]([^'"]+)['"]/i);
  if (plainSelectorMatch && plainSelectorMatch[1]) {
    const sel = plainSelectorMatch[1].trim();
    if (isValidSelector(sel)) {
      console.log(`[ERROR-PARSER] ✓ FALLBACK - Extracted CSS selector pattern: ${sel}`);
      return sel;
    }
  }

  // Return null - no valid locator found
  console.warn(`[ERROR-PARSER] ❌ FAILED to extract locator from error\n${String(errorInput).substring(0, 200)}`);
  console.warn(`[ERROR-PARSER] ❌ FAILED to extract locator from error\n${cleanedMessage.substring(0, 200)}`);
  return null;
}

/**
 * Legacy function - use extractFailedLocator instead
 * Kept for compatibility
 */
export function extractFailedSelector(errorMessage: string): string | null {
  return extractFailedLocator(errorMessage);
}

/**
 * Extract all candidates from strict mode violation errors
 * Format: "getByText(...) resolved to 2 elements: [getByRole(...), getByRole(...)]"
 */
export function extractStrictModeCandidates(errorMessage: string): StrictModeCandidate[] {
  const candidates: StrictModeCandidate[] = [];

  // Extract all getByRole/getByText/etc patterns
  const selectorPattern = /getBy(Role|Text|Label|Placeholder|TestId)\([^)]+\)/g;
  const matches = errorMessage.match(selectorPattern) || [];

  // Remove duplicates and score them
  const uniqueSelectors = [...new Set(matches)];

  uniqueSelectors.forEach((selector, index) => {
    const candidate: StrictModeCandidate = {
      selector,
      role: extractRole(selector),
      score: calculateSelectorScore(selector),
    };
    candidates.push(candidate);
  });

  // Sort by score descending
  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Extract role from getByRole selector
 * Example: getByRole('button', { name: /Submit/i }) → 'button'
 */
function extractRole(selector: string): string | undefined {
  const roleMatch = selector.match(/getByRole\(['"](\w+)['"]/);
  return roleMatch ? roleMatch[1] : undefined;
}

/**
 * Calculate selector score for strict mode violation resolution
 * Higher score = better choice
 */
function calculateSelectorScore(selector: string): number {
  // heading, h1-h6
  if (/getByRole\(['"]heading['"]|getByRole\(['"]h[1-6]['"]/i.test(selector)) {
    return 100;
  }
  // button
  if (/getByRole\(['"]button['"]/i.test(selector)) {
    return 95;
  }
  // textbox, searchbox, combobox
  if (/getByRole\(['"](?:textbox|searchbox|combobox)['"]/i.test(selector)) {
    return 95;
  }
  // link
  if (/getByRole\(['"]link['"]/i.test(selector)) {
    return 90;
  }
  // text-based
  if (/getByText|getByLabel|getByPlaceholder/i.test(selector)) {
    return 70;
  }
  // CSS selector
  if (/^[.#\w]/i.test(selector) && !selector.includes('(')) {
    return 50;
  }
  // unknown
  return 30;
}

/**
 * Validate selector is not a placeholder or obviously invalid
 * 
 * BLOCKER 3: REJECT :visible PERMANENTLY
 * :visible is NOT valid Playwright syntax and should NEVER appear in healed selectors
 */
export function isValidSelector(selector?: string): boolean {
  if (!selector) return false;
  if (selector === 'unknown_selector') return false;
  
  // BLOCKER 3: CRITICAL - REJECT :visible ABSOLUTELY
  if (/:visible/i.test(selector)) {
    console.error(`[ERROR-PARSER] ❌ INVALID: Selector contains :visible (invalid Playwright syntax): ${selector}`);
    return false;
  }
  
  // Reject other invalid patterns
  if (/\bunknown_selector\b/.test(selector)) return false;
  if (/\bplaceholder\b/i.test(selector)) return false;
  if (selector.trim().length < 3) return false;
  // Reject if it looks like partial/incomplete
  if (selector.includes('..') || selector.includes('>>>')) return false;
  
  return true;
}

/**
 * Pick best candidate from strict mode violations
 * Returns the highest scoring selector
 */
export function pickBestCandidate(candidates: StrictModeCandidate[]): StrictModeCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  return candidates[0]; // Already sorted by score
}
