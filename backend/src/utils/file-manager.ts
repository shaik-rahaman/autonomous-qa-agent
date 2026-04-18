/**
 * File Manager
 * Handles both Gherkin (.feature) and Playwright (.spec.ts) files with automatic overwriting
 * (No versioning - files are overwritten if they already exist)
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { FileMetadata } from '../types';
import { CodeValidator } from './code-validator';

// Path to generated tests in pw-ai-agents/tests/ui/generated
const GENERATED_TESTS_DIR = path.join(
  process.cwd(),
  '..',
  'pw-ai-agents',
  'tests',
  'ui',
  'generated'
);

// Subdirectories for organized file storage
const GHERKIN_DIR = path.join(GENERATED_TESTS_DIR, 'gherkin');
const SCRIPTS_DIR = path.join(GENERATED_TESTS_DIR, 'scripts');

interface FileVersion {
  metadata: FileMetadata;
  code: string;
}

export class FileManager {
  /**
   * Ensure all required directories exist
   */
  static ensureDirectoriesExist(): void {
    const directories = [GENERATED_TESTS_DIR, GHERKIN_DIR, SCRIPTS_DIR];
    
    directories.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
      }
    });
  }

  /**
   * Get next version number (always returns 1, files will be overwritten)
   * Kept for API compatibility but not actively used
   */
  static getNextVersion(baseName: string): number {
    return 1;
  }

  /**
   * Save Gherkin file (overwrites if exists)
   */
  static saveGherkinFile(fileName: string, gherkinContent: string): { fileName: string; filePath: string; version: number } {
    // Ensure directories exist
    this.ensureDirectoriesExist();

    const baseName = fileName.replace(/\.spec\.ts$/, '');
    const gherkinFileName = `${baseName}.feature`;
    const filePath = path.join(GHERKIN_DIR, gherkinFileName);

    // Save file with UTF-8 encoding (will overwrite if exists)
    fs.writeFileSync(filePath, gherkinContent.trim(), 'utf-8');
    logger.success(`Gherkin file saved (overwritten if existed)`, gherkinFileName);

    return {
      fileName: gherkinFileName,
      filePath: path.relative(process.cwd(), filePath),
      version: 1,
    };
  }

  /**
   * Save generated test script (overwrites if exists)
   * CRITICAL: Validates code before saving to ensure it's valid Playwright
   */
  static saveTestScript(
    fileName: string,
    code: string,
    testSteps: string,
    url: string
  ): FileMetadata & { scriptPath: string; code: string } {
    // Ensure directories exist
    this.ensureDirectoriesExist();

    logger.info('📝 Saving test script with validation...');

    // CRITICAL: Validate code before saving
    const validation = CodeValidator.validate(code);
    
    if (!validation.valid) {
      logger.error('❌ Code validation failed before saving:', {
        errors: validation.errors,
      });
      
      // Use fallback if validation fails
      logger.info('🔄 Using fallback Playwright test...');
      code = CodeValidator.generateFallbackTest(testSteps, url);
      logger.success('✓ Generated fallback test');
    } else if (validation.normalized) {
      // Use normalized version if available
      code = validation.normalized;
      logger.info('✓ Using normalized code');
    }

    // Clean code: Remove markdown code fences if present
    let cleanCode = code.trim();
    // Remove markdown code block fences (```ts, ```javascript, ```)
    cleanCode = cleanCode.replace(/^```(?:ts|tsx|typescript|javascript|js)?\n/, '');
    cleanCode = cleanCode.replace(/\n```$/, '');

    // Format code: Normalize quotes and syntax
    cleanCode = this.formatCode(cleanCode);
    
    // Get base name without extension
    const baseName = fileName.replace(/\.spec\.ts$/, '');
    const now = new Date().toISOString();

    // Create file name without version suffix
    const actualFileName = `${baseName}.spec.ts`;
    const filePath = path.join(SCRIPTS_DIR, actualFileName);

    // Save file with cleaned code (will overwrite if exists)
    // Normalize test code: unwrap top-level `test.describe` blocks to avoid Playwright runner issues
    if (cleanCode.includes('test.describe')) {
      try {
        const importBlockMatch = cleanCode.match(/^(?:import[^\n]*\n)+/);
        const importBlock = importBlockMatch ? importBlockMatch[0] : '';

        const describeStart = cleanCode.indexOf('test.describe');
        const firstBrace = cleanCode.indexOf('{', describeStart);
        const lastClose = cleanCode.lastIndexOf('});');

        if (describeStart !== -1 && firstBrace !== -1 && lastClose !== -1 && lastClose > firstBrace) {
          const inner = cleanCode.substring(firstBrace + 1, lastClose).trim();
          cleanCode = `${importBlock}\n${inner}`;
          logger.info('Normalized test code: unwrapped test.describe block');
        }
      } catch (e) {
        logger.warn('Failed to normalize test.describe block, saving raw code');
      }
    }

    // FINAL VALIDATION: Ensure the file we're about to write is valid
    const finalValidation = CodeValidator.validate(cleanCode);
    if (!finalValidation.valid) {
      logger.error('❌ Final validation failed, cannot save:', {
        errors: finalValidation.errors,
      });
      throw new Error(`Cannot save invalid Playwright test: ${finalValidation.errors.join('; ')}`);
    }

    fs.writeFileSync(filePath, cleanCode, 'utf-8');
    logger.success(`Test script saved (overwritten if existed)`, actualFileName);

    // Return file metadata WITH the cleaned code that was actually saved
    const metadata: FileMetadata & { scriptPath: string; code: string } = {
      fileName: actualFileName,
      version: 1,
      timestamp: now,
      testSteps,
      url,
      scriptPath: path.relative(process.cwd(), filePath),
      code: cleanCode, // Return the validated and normalized code
    };

    return metadata;
  }

  /**
   * Format code to ensure proper Playwright syntax
   * Converts deprecated methods and fixes selector quoting issues
   */
  private static formatCode(code: string): string {
    try {
      let formatted = code;

      // STEP 1: Remove any remaining Gherkin keywords
      const gherkinKeywords = ['Feature:', 'Scenario:', 'Given ', 'When ', 'Then ', 'And ', 'But '];
      gherkinKeywords.forEach((keyword) => {
        if (formatted.includes(keyword)) {
          logger.warn(`⚠️  Removing Gherkin keyword "${keyword}" from code`);
          formatted = formatted.split('\n').filter((line) => !line.includes(keyword)).join('\n');
        }
      });

      // STEP 2: Ensure proper line endings with semicolons (SIMPLIFIED & RELIABLE)
      const lines = formatted.split('\n');
      const formattedLines = lines.map((line) => {
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
      formatted = formattedLines.join('\n');

      // STEP 3: Fix deprecated methods
      // Convert page.click("selector") to page.locator("selector").click()
      formatted = formatted.replace(
        /await\s+page\.click\("([^"]+)"\)/g,
        (match, selector) => {
          const unescaped = selector.replace(/\\"/g, '"');
          return `await page.locator("${unescaped}").click()`;
        }
      );

      // Convert page.fill("selector", "value") to page.locator("selector").fill("value")
      formatted = formatted.replace(
        /await\s+page\.fill\("([^"]+)",\s*"([^"]*)"\)/g,
        (match, selector, value) => {
          const unescapedSelector = selector.replace(/\\"/g, '"');
          const unescapedValue = value.replace(/\\"/g, '"');
          return `await page.locator("${unescapedSelector}").fill("${unescapedValue}")`;
        }
      );

      // STEP 4: Normalize string quotes to be consistent
      // Use double quotes for strings (Playwright standard)
      // But keep single quotes for object properties in selectors
      formatted = formatted.replace(/\bpage\.locator\('([^']*)'\)/g, 'page.locator("$1")');

      // STEP 5: Handle common quote escaping issues
      // Fix double-escaped quotes
      formatted = formatted.replace(/\\\\"/g, '\\"');

      // STEP 6: Ensure imports are at top
      const importLines = formatted.split('\n').filter((line) => line.trim().startsWith('import'));
      const nonImportLines = formatted.split('\n').filter((line) => !line.trim().startsWith('import'));
      if (importLines.length > 0) {
        formatted = importLines.join('\n') + '\n\n' + nonImportLines.join('\n');
      }

      logger.debug('Code formatting applied - syntax normalized, Gherkin removed');
      return formatted;
    } catch (error) {
      logger.warn('Failed to format code, returning original', error);
      return code;
    }
  }

  /**
   * Generate a meaningful test name from test steps
   */
  /**
   * List all generated tests
   */
  static listGeneratedTests(): FileVersion[] {
    if (!fs.existsSync(SCRIPTS_DIR)) {
      return [];
    }

    const specFiles = fs
      .readdirSync(SCRIPTS_DIR)
      .filter((f) => f.endsWith('.spec.ts'));

    return specFiles.map((fileName) => {
      const filePath = path.join(SCRIPTS_DIR, fileName);
      const code = fs.readFileSync(filePath, 'utf-8');
      
      // Create basic metadata from file info
      const metadata: FileMetadata = {
        fileName,
        version: 1,
        timestamp: fs.statSync(filePath).mtime.toISOString(),
        testSteps: '',
        url: '',
      };

      return { metadata, code };
    });
  }

  /**
   * Get specific test file
   */
  static getTestFile(fileName: string): FileVersion | null {
    const filePath = path.join(SCRIPTS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const code = fs.readFileSync(filePath, 'utf-8');
    
    // Create basic metadata from file info
    const metadata: FileMetadata = {
      fileName,
      version: 1,
      timestamp: fs.statSync(filePath).mtime.toISOString(),
      testSteps: '',
      url: '',
    };

    return { metadata, code };
  }
}
