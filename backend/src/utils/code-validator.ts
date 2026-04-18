/**
 * Code Validator - Ensures generated Playwright test code is valid and executable
 */

import { logger } from './logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized?: string;
}

export class CodeValidator {
  /**
   * Validate and normalize Playwright test code
   * CRITICAL: Must enforce strict Playwright TypeScript structure
   */
  static validate(code: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let normalized = code.trim();

    logger.debug('🔍 Validating generated Playwright code...');

    // 1. CRITICAL: Extract code from markdown if present
    const markdownMatch = normalized.match(/```(?:ts|tsx|typescript|javascript|js)?\n([\s\S]*?)\n```/);
    if (markdownMatch) {
      logger.debug('  ✓ Found markdown code block, extracting...');
      normalized = markdownMatch[1].trim();
    }

    // 2. CRITICAL: Check for Gherkin keywords leaking into output
    // Look for actual Gherkin patterns, not just single characters
    const gherkinPatterns = [
      /^\s*Feature:/m,        // Feature: at start of line
      /^\s*Scenario:/m,       // Scenario: at start of line
      /^\s*Given\s+/m,        // Given followed by space at start of line
      /^\s*When\s+/m,         // When followed by space at start of line
      /^\s*Then\s+/m,         // Then followed by space at start of line
      /^\s*And\s+/m,          // And followed by space at start of line
      /^\s*But\s+/m,          // But followed by space at start of line
      /^\s*@(?!playwright)/m,  // @ at start of line but NOT @playwright (import)
    ];

    for (const pattern of gherkinPatterns) {
      if (pattern.test(normalized)) {
        // Extract what keyword was found for error message
        const keyword = pattern.source.replace(/[\\^$|()[\]{}*.+?]/g, '').trim();
        errors.push(`Found Gherkin keyword pattern in output - Gherkin must not leak into Playwright code`);
        break; // Only report once
      }
    }

    // 3. CRITICAL: Check for required imports
    if (!normalized.includes('import') || !normalized.includes('test') || !normalized.includes('expect')) {
      errors.push(
        'Missing required imports: must include "import { test, expect } from \'@playwright/test\'"'
      );
    }

    if (!normalized.includes('@playwright/test')) {
      errors.push('Must import from "@playwright/test"');
    }

    // 4. CRITICAL: Check for test() block
    if (!normalized.includes('test(')) {
      errors.push('No test() block found - code must have at least one test() function');
    }

    // 5. Check for async page parameter
    if (!normalized.includes('async') || !normalized.includes('page')) {
      warnings.push('Code may be missing async/await or page parameter pattern');
    }

    // 6. Check for basic Playwright methods
    const hasPlaywrightMethods =
      normalized.includes('page.goto') ||
      normalized.includes('page.locator') ||
      normalized.includes('page.getBy') ||
      normalized.includes('page.fill') ||
      normalized.includes('page.click') ||
      normalized.includes('page.waitFor');

    if (!hasPlaywrightMethods) {
      errors.push('No Playwright methods detected - code should use page.goto(), page.locator(), etc.');
    }

    // 7. Check for unclosed brackets/quotes
    const openBraces = (normalized.match(/\{/g) || []).length;
    const closeBraces = (normalized.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Mismatched braces: ${openBraces} open, ${closeBraces} close`);
    }

    const openParens = (normalized.match(/\(/g) || []).length;
    const closeParens = (normalized.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push(`Mismatched parentheses: ${openParens} open, ${closeParens} close`);
    }

    // 8. Check for common syntax issues
    if (normalized.includes('""""""') || normalized.includes("''''''")) {
      errors.push('Found triple-quoted strings - likely quote escaping issue');
    }

    // 9. Normalize the code
    normalized = this.normalizeCode(normalized);

    // 10. Validate normalized code doesn't have syntax errors
    const syntaxErrors = this.checkSyntaxErrors(normalized);
    if (syntaxErrors.length > 0) {
      errors.push(...syntaxErrors);
    }

    const valid = errors.length === 0;

    if (valid) {
      logger.success('✅ Code validation passed');
    } else {
      logger.error('❌ Code validation failed:');
      errors.forEach((err) => logger.error(`   - ${err}`));
    }

    if (warnings.length > 0) {
      logger.warn('⚠️  Code warnings:');
      warnings.forEach((warn) => logger.warn(`   - ${warn}`));
    }

    return {
      valid,
      errors,
      warnings,
      normalized: valid ? normalized : undefined,
    };
  }

  /**
   * Normalize code to ensure proper Playwright structure
   */
  private static normalizeCode(code: string): string {
    let normalized = code;

    // 1. Ensure each statement ends with semicolon (SIMPLIFIED & RELIABLE)
    const lines = normalized.split('\n');
    const normalizedLines = lines.map((line) => {
      const trimmed = line.trim();
      
      // Skip empty lines, comments, and docstring markers
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) {
        return line;
      }
      
      // Skip closing braces/brackets on their own line
      if (/^[\}\)\]];?$/.test(trimmed)) {
        return line;
      }
      
      // Line already has semicolon - do nothing
      if (trimmed.endsWith(';')) {
        return line;
      }
      
      // Skip structural line endings that should NOT have semicolons
      if (trimmed.endsWith('{') || trimmed.endsWith(',') || trimmed.endsWith('=>')) {
        return line;
      }
      
      // Skip lines that are opening brackets/parens (continuation)
      if (trimmed.endsWith('(') || trimmed.endsWith('[')) {
        return line;
      }
      
      // Skip closing brackets that close other lines
      if (trimmed.startsWith('}') || trimmed.startsWith(']') || trimmed.startsWith(')')) {
        return line;
      }
      
      // For method/function calls: ends with closing paren, needs semicolon
      // This covers: await func(), page.method(), expect().toBeVisible()
      if (trimmed.endsWith(')') && !trimmed.startsWith('if') && !trimmed.startsWith('while') && !trimmed.startsWith('for')) {
        return line + ';';
      }
      
      // For statements starting with keywords that always need semicolon
      if (/^(await|const|let|var|return|throw|break|continue|export|import)/.test(trimmed)) {
        return line + ';';
      }
      
      // For array/object indexing: ends with ]
      if (trimmed.endsWith(']')) {
        return line + ';';
      }
      
      return line;
    });

    normalized = normalizedLines.join('\n');

    // 2. Ensure imports are at the top
    const importLines = normalized.split('\n').filter((line) => line.trim().startsWith('import'));
    const nonImportLines = normalized.split('\n').filter((line) => !line.trim().startsWith('import'));

    if (importLines.length > 0) {
      normalized = importLines.join('\n') + '\n\n' + nonImportLines.join('\n');
    }

    // 3. Ensure at least one test() block exists
    if (!normalized.includes('test(')) {
      logger.warn('No test() block found in normalized code');
    }

    // 4. Fix common quote issues
    // Replace single quotes in import statements with actual imports
    if (normalized.includes("import {") && !normalized.includes('from')) {
      logger.warn('Possible import statement issue');
    }

    // 5. Ensure no top-level await outside test()
    const testBlockMatch = normalized.match(/test\([^{]*\{[\s\S]*\}\);/);
    const outsideTest = normalized.replace(/test\([^{]*\{[\s\S]*\}\);?/g, '');
    const hasTopLevelAwait = outsideTest.match(/^\s*await\s+/m);
    if (hasTopLevelAwait && !hasTopLevelAwait[0].includes('async')) {
      logger.warn('Detected potential top-level await outside async context');
    }

    return normalized;
  }

  /**
   * Check for basic syntax errors
   */
  private static checkSyntaxErrors(code: string): string[] {
    const errors: string[] = [];

    // Check for unmatched quotes
    const doubleQuotes = (code.match(/"/g) || []).length;
    if (doubleQuotes % 2 !== 0) {
      errors.push('Unmatched double quotes');
    }

    const singleQuotes = (code.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) {
      errors.push('Unmatched single quotes');
    }

    // Check for incomplete async/await
    const asyncPattern = /async\s*\(|async\s*\{/g;
    const asyncCount = (code.match(asyncPattern) || []).length;
    const arrowPattern = /=>/g;
    const arrowCount = (code.match(arrowPattern) || []).length;

    if (asyncCount !== arrowCount && asyncCount > 0) {
      // Allow some variance as not all async needs =>
      logger.debug(`  Async/await pattern check: ${asyncCount} async, ${arrowCount} arrows`);
    }

    // Check for console errors that indicate syntax issues
    if (code.includes('Unexpected token') || code.includes('SyntaxError')) {
      errors.push('Code contains error messages');
    }

    return errors;
  }

  /**
   * Generate fallback valid Playwright test if code is invalid
   * This ensures we always have a syntactically valid test
   */
  static generateFallbackTest(testSteps: string, url: string): string {
    logger.warn('🔄 Generating fallback Playwright test due to validation failure');

    // Create a safe, minimal test
    const safeName = testSteps
      .substring(0, 50)
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s/g, ' ')
      .toLowerCase();

    return `import { test, expect } from "@playwright/test";

test("${safeName || 'Generated test'}", async ({ page }) => {
  try {
    await page.goto("${url}");
    await page.waitForLoadState("load");
    
    // Test steps from: ${testSteps.substring(0, 100)}
    // TODO: Add specific test assertions
    
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});
`;
  }

  /**
   * Extract test name from code or steps
   */
  static extractTestName(code: string, testSteps: string): string {
    // Try to find test name from code
    const testMatch = code.match(/test\s*\(\s*["']([^"']+)["']/);
    if (testMatch && testMatch[1]) {
      return testMatch[1];
    }

    // Fallback: derive from test steps
    return testSteps
      .substring(0, 50)
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }
}
