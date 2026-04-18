/**
 * File Manager with Versioning Support
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { FileMetadata } from '../types';

// Save generated tests into the repository tests folder so ExecutionService can run them
const GENERATED_TESTS_DIR = path.join(process.cwd(), 'tests/ui/generated');

interface FileVersion {
  metadata: FileMetadata;
  code: string;
}

export class FileManager {
  /**
   * Save generated test script (no versioning - overwrites if exists)
   */
  static saveTestScript(
    fileName: string,
    code: string,
    testSteps: string,
    url: string
  ): FileMetadata {
    // Ensure directory exists
    if (!fs.existsSync(GENERATED_TESTS_DIR)) {
      fs.mkdirSync(GENERATED_TESTS_DIR, { recursive: true });
      logger.info('Created generated tests directory', GENERATED_TESTS_DIR);
    }

    // Format code before saving
    const formattedCode = this.formatCode(code);

    const now = new Date().toISOString();

    // Ensure fileName ends with .spec.ts
    const finalFileName = fileName.endsWith('.spec.ts') ? fileName : `${fileName}.spec.ts`;
    const filePath = path.join(GENERATED_TESTS_DIR, finalFileName);

    // Save file (overwrites if exists)
    fs.writeFileSync(filePath, formattedCode, 'utf-8');
    logger.success(`Test script saved`, finalFileName);

    // Create metadata
    const metadata: FileMetadata = {
      fileName: finalFileName,
      version: 1,
      timestamp: now,
      testSteps,
      url,
    };

    // Save metadata
    this.saveMetadata(finalFileName, metadata);

    return metadata;
  }

  /**
   * Format code to ensure proper Playwright syntax
   * Uses single quotes for locators with attribute selectors to avoid nested quote issues
   */
  private static formatCode(code: string): string {
    try {
      let formatted = code;

      // CRITICAL: Convert locator calls to use single quotes
      // This prevents: page.locator("input[name=\"USERNAME\"]") syntax issues
      // Instead use: page.locator('input[name="USERNAME"]')
      
      // Use better regex pattern that handles escaped quotes: ([^"\\]|\\.)*
      // This matches strings with optional escapes like \"
      
      // Fix page.locator() calls with double quotes - convert to single quotes
      formatted = formatted.replace(
        /page\.locator\("([^"\\]|\\.)*"\)/g,
        (match) => {
          // Extract the selector content between quotes
          const selectorMatch = match.match(/page\.locator\("(.*)"\)/);
          if (!selectorMatch) return match;
          
          const selector = selectorMatch[1];
          // Unescape the selector content (remove backslashes before quotes)
          const unescaped = selector.replace(/\\"/g, '"');
          return `page.locator('${unescaped}')`;
        }
      );

      // Fix any other locator patterns
      formatted = formatted.replace(
        /\.locator\("([^"\\]|\\.)*"\)/g,
        (match) => {
          const selectorMatch = match.match(/\.locator\("(.*)"\)/);
          if (!selectorMatch) return match;
          
          const selector = selectorMatch[1];
          const unescaped = selector.replace(/\\"/g, '"');
          return `.locator('${unescaped}')`;
        }
      );

      // Convert getByRole and similar - keep them as double quotes since they have object parameters
      // But fix any escaped quotes within the name property
      formatted = formatted.replace(
        /name:\s*"([^"]*)"/g,
        (match, text) => {
          // Keep as double quotes
          return `name: "${text}"`;
        }
      );

      // Fix any regex patterns in name property (convert from string to regex)
      formatted = formatted.replace(
        /name:\s*"([^"]*\/[^"]*)"/g,
        (match, pattern) => {
          // Convert string patterns containing "/" to regex
          if (!pattern.includes('/')) return match;
          return `name: /${pattern}/i`;
        }
      );

      // CRITICAL: Ensure proper line endings with semicolons (COMPREHENSIVE)
      const lines = formatted.split('\n');
      const formattedLines = lines.map((line) => {
        const trimmed = line.trim();
        
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
          return line;
        }
        
        // Skip lines that are just braces/brackets
        if (/^[\}\)\]];?$/.test(trimmed)) {
          return line;
        }
        
        // Line already has semicolon
        if (trimmed.endsWith(';')) {
          return line;
        }
        
        // Skip structural line endings
        if (trimmed.endsWith('{') || trimmed.endsWith(',') || trimmed.endsWith('=>')) {
          return line;
        }
        
        // Skip continuation markers
        if (trimmed.endsWith('(') || trimmed.endsWith('[') || trimmed.endsWith('\\')) {
          return line;
        }
        
        // Check if this IS a statement that needs semicolon
        const needsSemicolon =
          // Explicit statement keywords
          /^(await|const|let|var|return|throw|break|continue|export)/.test(trimmed) ||
          // Method/function calls with parentheses at end
          (/\)$/.test(trimmed) && !trimmed.startsWith('}')) ||
          // Array access/indexing at end
          /\]$/.test(trimmed) ||
          // Identifiers or property access
          (/^[a-zA-Z_$]/.test(trimmed) && /[;\)\]\}a-zA-Z0-9_$]$/.test(trimmed) && !trimmed.includes('{') && !trimmed.endsWith('=>'));
        
        if (needsSemicolon) {
          return line + ';';
        }
        
        return line;
      });
      formatted = formattedLines.join('\n');

      logger.debug('Code formatting applied - locators use single quotes, semicolons normalized');
      return formatted;
    } catch (error) {
      logger.warn('Failed to format code, returning original', error);
      return code;
    }
  }

  /**
   * Get next version number for a file
   */
  private static getNextVersion(baseFileName: string): number {
    const baseName = baseFileName.replace(/\.spec\.ts$/, '');

    // List all files in the directory
    if (!fs.existsSync(GENERATED_TESTS_DIR)) {
      return 1;
    }

    const files = fs.readdirSync(GENERATED_TESTS_DIR);
    const versions = files
      .filter((f) => f.startsWith(baseName) && f.endsWith('.spec.ts'))
      .map((f) => {
        const match = f.match(/_v(\d+)\.spec\.ts$/);
        return match ? parseInt(match[1], 10) : 1;
      });

    return versions.length === 0 ? 1 : Math.max(...versions) + 1;
  }

  /**
   * Create versioned file name
   */
  private static createVersionedFileName(baseFileName: string, version: number): string {
    const name = baseFileName.replace(/\.spec\.ts$/, '');
    return `${name}_v${version}.spec.ts`;
  }

  /**
   * Save file metadata
   */
  private static saveMetadata(fileName: string, metadata: FileMetadata): void {
    const metadataFile = `${fileName}.meta.json`;
    const metadataPath = path.join(GENERATED_TESTS_DIR, metadataFile);

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    logger.debug('Metadata saved', metadataFile);
  }

  /**
   * List all generated tests
   */
  static listGeneratedTests(): FileVersion[] {
    if (!fs.existsSync(GENERATED_TESTS_DIR)) {
      return [];
    }

    const specFiles = fs
      .readdirSync(GENERATED_TESTS_DIR)
      .filter((f) => f.endsWith('.spec.ts'));

    return specFiles.map((fileName) => {
      const filePath = path.join(GENERATED_TESTS_DIR, fileName);
      const metadataPath = path.join(GENERATED_TESTS_DIR, `${fileName}.meta.json`);

      const code = fs.readFileSync(filePath, 'utf-8');
      const metadata: FileMetadata = fs.existsSync(metadataPath)
        ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        : {
            fileName,
            version: 1,
            timestamp: new Date().toISOString(),
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
    const filePath = path.join(GENERATED_TESTS_DIR, fileName);
    const metadataPath = path.join(GENERATED_TESTS_DIR, `${fileName}.meta.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const code = fs.readFileSync(filePath, 'utf-8');
    const metadata: FileMetadata = fs.existsSync(metadataPath)
      ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      : {
          fileName,
          version: 1,
          timestamp: new Date().toISOString(),
          testSteps: '',
          url: '',
        };

    return { metadata, code };
  }
}
