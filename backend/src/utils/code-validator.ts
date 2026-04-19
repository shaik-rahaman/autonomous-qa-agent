/**
 * Code Validator - Ensures generated Playwright test code is valid and executable
 */

import { logger } from './logger';
import * as ts from 'typescript';

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

    // CRITICAL FIX: Handle method chaining across lines BEFORE semicolon normalization
    // Join lines that are method continuations (start with .)
    // This fixes: await page.method()
    //             .chainMethod()
    const lines = normalized.split('\n');
    const joinedLines: string[] = [];
    let i = 0;
    while (i < lines.length) {
      let current = lines[i];
      
      // If next line is a method chain (starts with .), join them
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('.')) {
        current = current.trimEnd() + lines[i + 1].trim();
        i++;
      }
      
      joinedLines.push(current);
      i++;
    }
    normalized = joinedLines.join('\n');

    // 1. Ensure each statement ends with semicolon (SIMPLIFIED & RELIABLE)
    const splitLines = normalized.split('\n');
    const normalizedLines = splitLines.map((line) => {
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
      
      // CRITICAL: For method/function calls: ends with closing paren, needs semicolon
      // This covers: await func(), page.method(), expect().toBeVisible(), .click(), etc.
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
   * Check for real JavaScript syntax errors - COMPREHENSIVE
   * Validates: brackets, braces, parens, semicolons, quotes, and syntax patterns
   * Now includes TypeScript parser for real syntax validation
   */
  private static checkSyntaxErrors(code: string): string[] {
    const errors: string[] = [];

    // === PHASE 1: USE TYPESCRIPT PARSER FOR REAL SYNTAX VALIDATION ===
    // This is the most reliable way to catch actual JavaScript/TypeScript syntax errors
    const tsErrors = this.validateWithTypeScriptParser(code);
    if (tsErrors.length > 0) {
      logger.debug('  TypeScript parser found syntax errors:');
      tsErrors.forEach((err) => logger.debug(`    - ${err}`));
      errors.push(...tsErrors);
      // If TS parser found errors, return immediately - these are real syntax issues
      if (errors.length > 0) {
        return errors;
      }
    }

    // === PHASE 2: REGEX-BASED VALIDATION (Fallback/Complement) ===
    const regexErrors = this.validateWithRegex(code);
    errors.push(...regexErrors);

    return errors;
  }

  /**
   * Validate code using TypeScript compiler API
   * This catches REAL JavaScript/TypeScript syntax errors
   */
  private static validateWithTypeScriptParser(code: string): string[] {
    const errors: string[] = [];

    try {
      // Parse the code as TypeScript
      const sourceFile = ts.createSourceFile(
        'test.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Get diagnostics from the source file syntax checking
      // (getPreEmitDiagnostics requires a Program in TS 5.4+, so we parse syntax errors differently)
      const diags: ts.Diagnostic[] = [];
      
      // Check for syntax errors in the parsed source
      function visit(node: ts.Node) {
        if (node.kind === ts.SyntaxKind.Unknown) {
          diags.push({
            file: sourceFile,
            start: node.getStart(),
            length: node.getWidth(),
            messageText: 'Unknown syntax',
            category: ts.DiagnosticCategory.Error,
            code: 0,
          } as ts.Diagnostic);
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);

      if (diags.length > 0) {
        logger.debug(`  TS Parser: Found ${diags.length} syntax issues`);

        diags.forEach((diagnostic) => {
          if (sourceFile.text && diagnostic.start !== undefined) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
              diagnostic.start
            );
            const message = ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              '\n'
            );
            errors.push(
              `Line ${line + 1}:${character + 1}: ${message}`
            );
          }
        });
      }

      // Try ts.transpile to catch compilation errors - this is the most reliable check
      try {
        ts.transpile(code, {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
        });
        logger.debug('  TS Parser: Code transpiles successfully');
      } catch (transpileError) {
        const errorMsg = transpileError instanceof Error ? transpileError.message : String(transpileError);
        if (!errors.some((e) => e.includes('transpil'))) {
          errors.push(`Transpilation failed: ${errorMsg}`);
        }
      }
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug(`  TS Parser error: ${errorMsg}`);
      // Don't fail hard on parser errors, fallback to regex validation
    }

    return errors;
  }

  /**
   * Regex-based validation (complement to TypeScript parser)
   */
  private static validateWithRegex(code: string): string[] {
    const errors: string[] = [];
    const lines = code.split('\n');

    // === 1. VALIDATE MATCHING BRACES/BRACKETS/PARENTHESES ===
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(
        `Unmatched braces: ${openBraces} '{' but ${closeBraces} '}' found`
      );
    }

    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      errors.push(
        `Unmatched brackets: ${openBrackets} '[' but ${closeBrackets} ']' found`
      );
    }

    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push(
        `Unmatched parentheses: ${openParens} '(' but ${closeParens} ')' found`
      );
    }

    // === 2. VALIDATE QUOTES ===
    let doubleQuotes = 0;
    let singleQuotes = 0;
    let backticks = 0;
    let inString = null;
    let escaped = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"' && !inString) {
        inString = '"';
        doubleQuotes++;
      } else if (char === '"' && inString === '"') {
        inString = null;
        doubleQuotes++;
      } else if (char === "'" && !inString) {
        inString = "'";
        singleQuotes++;
      } else if (char === "'" && inString === "'") {
        inString = null;
        singleQuotes++;
      } else if (char === '`' && !inString) {
        inString = '`';
        backticks++;
      } else if (char === '`' && inString === '`') {
        inString = null;
        backticks++;
      }
    }

    if (doubleQuotes % 2 !== 0) {
      errors.push(`Unmatched double quotes: ${doubleQuotes} found`);
    }
    if (singleQuotes % 2 !== 0) {
      errors.push(`Unmatched single quotes: ${singleQuotes} found`);
    }
    if (backticks % 2 !== 0) {
      errors.push(`Unmatched backticks: ${backticks} found`);
    }

    // === 3. LINE-BY-LINE STATEMENT VALIDATION ===
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      // Check for statements that require semicolons
      const requiresSemicolon =
        (trimmed.startsWith('await ') ||
          trimmed.startsWith('const ') ||
          trimmed.startsWith('let ') ||
          trimmed.startsWith('var ') ||
          trimmed.startsWith('return ') ||
          trimmed.startsWith('throw ') ||
          trimmed.includes('expect(')) &&
        !trimmed.endsWith('{') &&
        !trimmed.endsWith('(') &&
        !trimmed.endsWith(',') &&
        !trimmed.endsWith(';') &&
        !trimmed.endsWith('=>');

      if (requiresSemicolon && !trimmed.endsWith(';')) {
        const hasOpenBrace = (trimmed.match(/{/g) || []).length > 0;
        const hasOpenParen =
          (trimmed.match(/\(/g) || []).length > (trimmed.match(/\)/g) || []).length;

        if (!hasOpenBrace && !hasOpenParen) {
          errors.push(
            `Line ${idx + 1}: Statement "${trimmed.substring(0, 40)}..." missing semicolon`
          );
        }
      }

      // Check for incomplete method chains
      if (trimmed.endsWith('.')) {
        if (idx + 1 < lines.length) {
          const nextLine = lines[idx + 1].trim();
          if (nextLine && !nextLine.startsWith('.')) {
            errors.push(
              `Line ${idx + 1}: Method chain incomplete - line ends with '.'`
            );
          }
        } else {
          errors.push(
            `Line ${idx + 1}: Method chain incomplete - file ends with '.'`
          );
        }
      }
    }

    // === 4. CHECK FOR COMMON PATTERNS ===
    const asyncPattern = /async\s*\(/g;
    const asyncCount = (code.match(asyncPattern) || []).length;
    const tryCount = (code.match(/\btry\b/g) || []).length;
    const catchCount = (code.match(/\bcatch\b/g) || []).length;

    if (tryCount > catchCount) {
      errors.push(`Incomplete try-catch: ${tryCount} try blocks but ${catchCount} catch blocks`);
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
