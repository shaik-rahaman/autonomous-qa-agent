/**
 * Script Executor Service
 * Handles execution of inline/custom Playwright scripts
 * Reuses the existing Execution and Orchestration pipeline
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { FileManager } from '../utils/file-manager';

export interface ExecuteScriptRequest {
  script: string;
  url?: string;
}

export interface SelfHealingLabRequest {
  script: string;
  failureType: 'STRICT_MODE' | 'ELEMENT_NOT_FOUND' | 'TIMEOUT' | 'NONE';
  url?: string;
  localLocatorTest?: boolean;
}

export class ScriptExecutor {
  // PHASE 2C OPTIMIZATION: In-memory cache for parsed scripts
  private static scriptCache: Map<string, string> = new Map();
  private static readonly MAX_CACHE_SIZE = 100; // Keep last 100 parsed scripts

  private tempScriptDir: string;

  constructor(projectRoot: string = '.') {
    // Determine repository root reliably (relative to this file) so scripts are always
    // saved into the canonical pw-ai-agents folder at the repo root regardless of
    // where the backend process was started from.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    this.tempScriptDir = path.join(repoRoot, 'pw-ai-agents', 'tests', 'ui', 'generated', 'scripts');

    // If any scripts were previously saved under a legacy location derived from
    // process.cwd() (for example when the server was started from the backend
    // folder), migrate them into the canonical `pw-ai-agents` location to avoid
    // mismatches with the Playwright installation path.
    try {
      const legacyDir = path.join(process.cwd(), 'pw-ai-agents', 'tests', 'ui', 'generated', 'scripts');
      if (legacyDir !== this.tempScriptDir && fs.existsSync(legacyDir)) {
        // Ensure target dir exists
        if (!fs.existsSync(this.tempScriptDir)) fs.mkdirSync(this.tempScriptDir, { recursive: true });

        // Move files and update .script-map.json if present
        const legacyMapPath = path.join(legacyDir, '.script-map.json');
        const targetMapPath = path.join(this.tempScriptDir, '.script-map.json');

        // Move individual script files
        const files = fs.readdirSync(legacyDir).filter((f) => f.endsWith('.spec.ts') || f.endsWith('.spec.js'));
        for (const file of files) {
          const src = path.join(legacyDir, file);
          const dest = path.join(this.tempScriptDir, file);
          try {
            // Overwrite if exists
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            fs.renameSync(src, dest);
            logger.info(`Migrated temporary script: ${file}`);
          } catch (e) {
            logger.warn(`Failed to migrate script ${file}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Merge or move script map
        try {
          let legacyMap = {};
          if (fs.existsSync(legacyMapPath)) {
            try { legacyMap = JSON.parse(fs.readFileSync(legacyMapPath, 'utf-8') || '{}'); } catch (e) { legacyMap = {}; }
          }

          let targetMap = {};
          if (fs.existsSync(targetMapPath)) {
            try { targetMap = JSON.parse(fs.readFileSync(targetMapPath, 'utf-8') || '{}'); } catch (e) { targetMap = {}; }
          }

          // Update paths inside legacyMap to point to the new canonical directory
          for (const [k, v] of Object.entries(legacyMap)) {
            const newPath = path.join(this.tempScriptDir, path.basename((v as any).path || ''));
            (targetMap as any)[k] = { path: newPath, timestamp: (v as any).timestamp || Date.now() } as any;
          }

          fs.writeFileSync(targetMapPath, JSON.stringify(targetMap, null, 2), 'utf-8');
          // Remove legacy map if present
          try { if (fs.existsSync(legacyMapPath)) fs.unlinkSync(legacyMapPath); } catch (e) {}
        } catch (e) {
          logger.warn('Failed to migrate script map', e instanceof Error ? e.message : String(e));
        }
      }
    } catch (e) {
      logger.warn('Script migration check failed', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Generate temporary script file name
   */
  private generateTempFileName(): string {
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    return `temp-${timestamp}-${randomId}.spec.ts`;
  }

  /**
   * Validate Playwright script syntax
   */
  private validateScript(script: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for test function
    if (!script.includes('test(') && !script.includes('it(')) {
      errors.push('Script must contain test() or it() function');
    }

    // Check for syntax errors
    try {
      // Basic brace matching
      const openBraces = (script.match(/{/g) || []).length;
      const closeBraces = (script.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        errors.push(`Brace mismatch: ${openBraces} opening, ${closeBraces} closing`);
      }

      // Check for required page object
      if (!script.includes('page.') && !script.includes('test(')) {
        errors.push('Script must use page object or test framework');
      }
    } catch (e) {
      errors.push(`Syntax validation failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Prepare script for execution (fix imports, etc.)
   * PHASE 2C OPTIMIZATION: Cache parsed scripts to avoid re-parsing
   */
  private prepareScript(script: string): string {
    // PHASE 2C: Check cache first
    const cacheKey = this.getScriptCacheKey(script);
    if (ScriptExecutor.scriptCache.has(cacheKey)) {
      const cached = ScriptExecutor.scriptCache.get(cacheKey)!;
      logger.debug('[PHASE-2C-OPT] 🚀 Using cached prepared script');
      return cached;
    }

    let prepared = script;

    // Normalize existing imports: if any import or require from '@playwright/test' exists, don't add duplicate
    // Also detect CommonJS `require('@playwright/test')` and destructured require like
    // `const { test, expect } = require('@playwright/test')` to avoid mixing ESM import with CommonJS.
    const hasPlaywrightImport = /from\s+['"]@playwright\/test['"]|require\(\s*['"]@playwright\/test['"]\s*\)|const\s+\{[^}]*test[^}]*\}\s*=\s*require\(\s*['"]@playwright\/test['"]\s*\)/m.test(prepared);
    if (!hasPlaywrightImport) {
      prepared = `import { test, expect } from '@playwright/test';\n\n${prepared}`;
    }

    // Ensure a sensible global test timeout is present so generated tests don't fail fast
    const hasTestSetTimeout = /test\.setTimeout\s*\(/m.test(prepared);
    if (!hasTestSetTimeout) {
      // Insert test.setTimeout after the import block (or at file top)
      // Use 30s overall test timeout so generated tests fail fast on missing elements
      if (/^(\s*(?:import[\s\S]*?;\s*\n)+)/.test(prepared)) {
        prepared = prepared.replace(/^(\s*(?:import[\s\S]*?;\s*\n)+)/, `$1\n// Set default test timeout for generated scripts\ntest.setTimeout(30000);\n\n`);
      } else {
        prepared = `// Set default test timeout for generated scripts\ntest.setTimeout(30000);\n\n${prepared}`;
      }
    }

    // Inject a conservative waitForLoadState after any page.goto(...) that doesn't already have one
    try {
      prepared = prepared.replace(/(await\s+page\.goto\([^\)]+\)\s*;?)(\s*(?:await\s+page\.waitForLoadState\([^\)]*\)\s*;?))?/g, (match: string, gotoStmt: string, waitStmt: string) => {
        if (waitStmt && waitStmt.trim().length > 0) return match; // existing wait present
        // preserve original indentation
        const indentMatch = gotoStmt.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        return `${gotoStmt}\n${indent}await page.waitForLoadState("domcontentloaded", { timeout: 30000 });`;
      });
    } catch (e) {
      // on any regex failure, fall back silently to the original script
    }

    // Replace patterns of: click -> sleep (waitForTimeout) -> expect heading
    // with robust navigation handling: waitForURL + waitForLoadState + expect
    try {
      prepared = prepared.replace(/await\s+([\s\S]*?)\.click\(\)\s*;?\s*await\s+page\.waitForTimeout\(\s*\d+\s*\)\s*;?\s*await\s+expect\(\s*page\.getByRole\(\s*['\"]heading['\"],\s*\{\s*name:\s*['\"]([^'\"]+)['\"]\s*\}\s*\)\s*\)\.toBeVisible\(([^)]*)\)\s*;?/g, (match, clickTarget, headingName, expectArgs) => {
        // Normalize heading to use case-insensitive regex
        const heading = headingName.replace(/\//g, '').trim();
        // Ensure regex-safe heading
        const safeHeading = heading.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
        const replacement = `${clickTarget}.click({ timeout: 5000 });\n    await page.waitForURL(/${safeHeading}/i, { timeout: 30000 });\n    await page.waitForLoadState('networkidle', { timeout: 30000 });\n    await expect(page.getByRole('heading', { name: /${safeHeading}/i })).toBeVisible(${expectArgs});`;
        return replacement;
      });
    } catch (e) {
      // ignore transformation errors - keep original script
    }

    // Apply fast action timeouts to locator actions so missing elements fail fast
    try {
      prepared = this.applyFastActionTimeouts(prepared);
    } catch (e) {}

    // PHASE 2C: Cache prepared script
    if (ScriptExecutor.scriptCache.size >= ScriptExecutor.MAX_CACHE_SIZE) {
      // Remove oldest entry when cache is full
      const firstKey = ScriptExecutor.scriptCache.keys().next().value as string | undefined;
      if (firstKey) {
        ScriptExecutor.scriptCache.delete(firstKey);
      }
    }
    ScriptExecutor.scriptCache.set(cacheKey, prepared);
    logger.debug('[PHASE-2C-OPT] 📦 Cached prepared script');

    return prepared;
  }

  /**
   * Generate cache key for script
   */
  private getScriptCacheKey(script: string): string {
    // Use first 500 chars as cache key (cheaper than full hash)
    return script.substring(0, 500);
  }

  /**
   * Ensure locator actions use a short timeout so missing elements fail fast in healing lab
   */
  private applyFastActionTimeouts(script: string): string {
    let out = script;
    try {
      // Add timeout to bare `.click()` and `.fill()` calls (only when no options object present)
      out = out.replace(/(\.click)\(\s*\)/g, `.click({ timeout: 5000 })`);
      // For fill: if there's already an options object, avoid duplication. If only one arg present, add options.
      out = out.replace(/(\.fill)\(\s*([^,\)]*?)\s*\)/g, (m: string, p1: string, p2: string) => {
        if (/\{\s*timeout\s*:\s*\d+/m.test(m)) return m;
        // if second param is absent or not an options object, add options object
        // keep existing value (e.g. .fill('value') -> .fill('value', { timeout: 5000 }) )
        if (p2 && p2.trim().length > 0) return `${p1}(${p2}, { timeout: 5000 })`;
        return `${p1}({ timeout: 5000 })`;
      });
    } catch (e) {
      // noop on regex failures
    }
    return out;
  }

  /**
   * Inject intentional failures for self-healing lab (GENERIC - not Dashboard-specific)
   */
  private injectFailure(script: string, failureType: string, localLocatorTest: boolean = false): string {
    let modified = script;

    switch (failureType) {
      case 'STRICT_MODE':
        // Replace role-based selectors with weak text selectors (GENERIC)
        // Find getByRole("heading", { name: "..." }) and replace with getByText /.../ i
        // This works for ANY heading text, not just Dashboard
        modified = modified.replace(
          /getByRole\("heading",\s*{\s*name:\s*([/"][\s\S]*?[/"])\s*}\)/g,
          (match, nameArg) => {
            // Extract the text from nameArg
            // If it's a regex like /Dashboard/i, convert to getByText
            // If it's a string like "Dashboard", convert to getByText(/Dashboard/i)
            if (nameArg.startsWith('/')) {
              return `getByText(${nameArg})`;
            } else {
              const text = nameArg.replace(/^["']|["']$/g, '');
              return `getByText(/${text}/i)`;
            }
          }
        );
        
        // Also handle other role types
        modified = modified.replace(
          /getByRole\("(\w+)",\s*{\s*name:\s*([/"][\s\S]*?[/"])\s*}\)/g,
          (match, role, nameArg) => {
            // For other roles, convert to getByText
            if (nameArg.startsWith('/')) {
              return `getByText(${nameArg})`;
            } else {
              const text = nameArg.replace(/^["']|["']$/g, '');
              return `getByText(/${text}/i)`;
            }
          }
        );
        
        logger.info('✓ Injected STRICT_MODE failure: Replaced role-based selectors with weak text selectors (generic)');
        break;

      case 'ELEMENT_NOT_FOUND':
        if (localLocatorTest) {
          // Only corrupt attribute selectors inside locator(...) or page.locator(...) calls
          modified = modified.replace(/(page\.locator\(|locator\()([`"'])(\[([^\]]+)\])\2/g, (m: string, p1: string, quote: string, sel: string) => {
            const replaced = sel.replace(/\[(\w+)=(["'])([^"']+)\2\]/g, (mm: string, attrName: string, q: string, attrValue: string) => {
              return `[${attrName}="corrupt${attrValue}"]`;
            });
            return `${p1}${quote}${replaced}${quote}`;
          });
          logger.info('✓ Injected ELEMENT_NOT_FOUND failure: Prefixed attribute values inside locator(...) calls (localLocatorTest)');
        } else {
          // Make attribute selectors invalid by prefixing attribute value (GENERIC)
          modified = modified.replace(
            /\[(\w+)=['\"]([^"']+)['\"]\]/g,
            (match, attrName, attrValue) => {
              return `[${attrName}="corrupt${attrValue}"]`;
            }
          );
          logger.info('✓ Injected ELEMENT_NOT_FOUND failure: Prefixed attribute values to make selectors invalid (generic)');
        }
        break;

      case 'TIMEOUT':
        // Reduce visibility timeout dramatically (GENERIC)
        modified = modified.replace(
          /toBeVisible\(\{\s*timeout:\s*\d+\s*}\)/g,
          'toBeVisible({ timeout: 100 })'
        );
        modified = modified.replace(
          /toBeVisible\(\)/g,
          'toBeVisible({ timeout: 100 })'
        );
        logger.info('✓ Injected TIMEOUT failure: Reduced visibility timeout to 100ms (generic)');
        break;

      case 'NONE':
      default:
        // No modification
        logger.info('✓ No failure injection (NONE selected)');
        break;
    }

    return modified;
  }

  /**
   * Save temporary script to file
   */
  private saveTemporaryScript(script: string, fileName: string): { success: boolean; filePath: string; error?: string } {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.tempScriptDir)) {
        fs.mkdirSync(this.tempScriptDir, { recursive: true });
      }

      const filePath = path.join(this.tempScriptDir, fileName);
      fs.writeFileSync(filePath, script, 'utf-8');

      logger.info(`✓ Temporary script saved: ${fileName}`, { filePath });
      // Update script map for reliable lookup from UI-execute flows
      try {
        const mapPath = path.join(this.tempScriptDir, '.script-map.json');
        let map: Record<string, { path: string; timestamp: number }> = {};
        if (fs.existsSync(mapPath)) {
          try { map = JSON.parse(fs.readFileSync(mapPath, 'utf-8') || '{}'); } catch (e) { map = {}; }
        }
        map[fileName] = { path: filePath, timestamp: Date.now() };
        fs.writeFileSync(mapPath, JSON.stringify(map, null, 2), 'utf-8');
      } catch (e) {
        logger.warn('Failed to update script map', e instanceof Error ? e.message : String(e));
      }
      return { success: true, filePath };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to save temporary script: ${fileName}`, errorMsg);
      return { success: false, filePath: '', error: errorMsg };
    }
  }

  /**
   * Lookup the saved path for a temporary script fileName via the script map
   */
  getSavedScriptPath(fileName: string): string | null {
    try {
      const mapPath = path.join(this.tempScriptDir, '.script-map.json');
      if (!fs.existsSync(mapPath)) return null;
      const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8') || '{}');
      if (map && map[fileName] && map[fileName].path) return map[fileName].path;
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Resolve the canonical path for a generated test file. Throws if not found.
   */
  resolveGeneratedTestPath(fileName: string): string {
    // Prefer explicit map lookup (most reliable)
    const mapped = this.getSavedScriptPath(fileName);
    if (mapped && fs.existsSync(mapped)) return mapped;

    // Otherwise, check expected canonical directory
    const candidate = path.join(this.tempScriptDir, fileName);
    if (fs.existsSync(candidate)) return candidate;

    // Not found - throw so callers can surface TEST_FILE_NOT_FOUND
    throw new Error('TEST_FILE_NOT_FOUND');
  }

  /**
   * Execute inline script
   */
  async executeScript(req: ExecuteScriptRequest): Promise<{ fileName: string; success: boolean; error?: string }> {
    logger.section('Script Executor: Execute Inline Script');

    // Prepare script first (inject imports, timeouts, waits)
    let prepared = this.prepareScript(req.script);

    // Then validate the prepared script
    const validation = this.validateScript(prepared);
    if (!validation.valid) {
      logger.warn('Script validation failed', validation.errors);
      return {
        fileName: '',
        success: false,
        error: `Script validation failed: ${validation.errors.join(', ')}`,
      };
    }

    // Generate temp file name
    const fileName = this.generateTempFileName();

    // Ensure locator actions have short timeouts so healing lab fails fast on missing elements
    try {
      prepared = this.applyFastActionTimeouts(prepared);
    } catch (e) {}

    // Save script
    const saveResult = this.saveTemporaryScript(prepared, fileName);
    if (!saveResult.success) {
      return {
        fileName: '',
        success: false,
        error: `Failed to save script: ${saveResult.error}`,
      };
    }

    logger.success('Script prepared and saved for execution', fileName);
    return { fileName, success: true };
  }

  /**
   * Execute script with self-healing lab features
   */
  async executeSelfHealingLabScript(req: SelfHealingLabRequest): Promise<{ fileName: string; success: boolean; failureInjected?: string; injectedSelector?: string; error?: string }> {
    logger.section('Script Executor: Self-Healing Lab');
    // Prepare script first (inject imports, timeouts, waits)
    let prepared = this.prepareScript(req.script);

    // Validate script after preparation
    const validation = this.validateScript(prepared);
    if (!validation.valid) {
      logger.warn('Script validation failed', validation.errors);
      return {
        fileName: '',
        success: false,
        error: `Script validation failed: ${validation.errors.join(', ')}`,
      };
    }

    const localLocatorTest = !!req.localLocatorTest;
    // If ELEMENT_NOT_FOUND we will only corrupt the first locator after the first page.goto
    let injectedSelector: string | undefined = undefined;

    // Ensure DOM content loaded wait after navigation to avoid misclassifying navigation failures
    // For Healing Lab: use longer timeout (120s) to allow slow sites to load, then proceed to locators
    try {
      prepared = prepared.replace(/(await\s+)?page\.goto\(([^)]+)\)\s*;?/g, (m, awaitTok, args) => {
        // Replace any existing timeout with 120000, or add it if missing
        let modifiedArgs = String(args).replace(/timeout:\s*\d+/g, 'timeout: 30000');
        if (!modifiedArgs.includes('timeout:')) {
          // No timeout present, need to add it to the options object
          // Check if args has options: e.g., { waitUntil: "domcontentloaded" }
          const hasOptions = /,\s*{[^}]*}/.test(modifiedArgs);
          if (hasOptions) {
            // Replace the closing } of the options object with , timeout: 120000 }
            modifiedArgs = modifiedArgs.replace(/,\s*{([^}]*)}\s*$/, ', { $1, timeout: 120000 }');
          } else {
            // No options object, add one
            modifiedArgs = `${modifiedArgs}, { timeout: 120000 }`;
          }
        }
        return `await page.goto(${modifiedArgs});\n  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });`;
      });
    } catch (e) {
      logger.warn('Failed to inject waitForLoadState after page.goto', e instanceof Error ? e.message : String(e));
    }

    // Remove any networkidle waits (healing lab must not wait for networkidle)
    try {
      prepared = prepared.replace(/await\s+page\.waitForLoadState\(["']networkidle["']\s*\)\s*;?/g, 'await page.waitForTimeout(2000);');
    } catch (e) {
      logger.warn('Failed to replace networkidle waits', e instanceof Error ? e.message : String(e));
    }

    // For Healing Lab: skip page.waitForURL waits to fail fast on broken selectors
    // Handle regex literals like /dashboard/i by matching until semicolon
    try {
      prepared = prepared.replace(/await\s+page\.waitForURL\s*\([^;]*\)\s*;?/g, '');
    } catch (e) {
      logger.warn('Failed to remove waitForURL waits', e instanceof Error ? e.message : String(e));
    }

    // Instrument locators: insert console.log before every locator call and optionally corrupt the first locator after page.goto for ELEMENT_NOT_FOUND
    try {
      // Find position of first page.goto to limit injection target
      const gotoMatch = prepared.match(/page\.goto\([^)]*\)/);
      const gotoIndex = gotoMatch ? prepared.indexOf(gotoMatch[0]) + gotoMatch[0].length : 0;

      let firstLocatorInjected = false;
      // Replace both page.locator(...) and locator(...)
      prepared = prepared.replace(/(\b(?:page\.locator|locator)\()([`'"])([\s\S]*?)\2(\))/g, (full, prefix, quote, selector, close) => {
        // Determine if this locator occurs after the first goto
        const occurrenceIndex = prepared.indexOf(full);
        const rawSelector = selector;
        let effectiveSelector = selector;

        // If we need to inject failure into first locator after goto
        if (!firstLocatorInjected && req.failureType === 'ELEMENT_NOT_FOUND' && occurrenceIndex >= gotoIndex) {
          // Corrupt attribute selectors by prefixing attribute values
          effectiveSelector = effectiveSelector.replace(/\[(\w+)=(["'])([^"']+)\2\]/g, (m2: string, attrName: string, q2: string, attrValue: string) => {
            return `[${attrName}="asdf${attrValue}"]`;
          });
          injectedSelector = effectiveSelector;
          firstLocatorInjected = true;
        }
        // Normalize selector: unescape any escaped quotes coming from JSON payloads
        try {
          const finalSelector = String(effectiveSelector).replace(/\\"/g, '"').replace(/\\'/g, "'").trim();

          // Logging: raw, escaped (if any), and final form
          console.log('[HEALING LAB] RAW_SELECTOR:', rawSelector);
          console.log('[HEALING LAB] ESCAPED_SELECTOR:', String(effectiveSelector));
          console.log('[HEALING LAB] FINAL_SCRIPT_SELECTOR:', finalSelector);

          // Validate that we do not have double-escaped selectors
          if (finalSelector.includes('\\"')) {
            throw new Error('Double escaped selector detected');
          }

          // Use finalSelector for instrumentation and set injectedSelector only if not already set.
          // This prevents later locators from overwriting the selector we injected (the corrupted locator).
          effectiveSelector = finalSelector;
          if (!injectedSelector) injectedSelector = finalSelector;

          // Safely serialize the selector so embedded quotes do not break the generated code
          const serialized = JSON.stringify(finalSelector);
          // Build instrumentation using comma operator to preserve original expression
          const logged = `(console.log('[HEALING LAB] REACHED LOCATOR:', ${serialized}), ${prefix}${serialized}${close})`;
          return logged;
        } catch (e) {
          logger.warn('Failed to normalize selector during instrumentation', e instanceof Error ? e.message : String(e));
          const serialized = JSON.stringify(effectiveSelector);
          const logged = `(console.log('[HEALING LAB] REACHED LOCATOR:', ${serialized}), ${prefix}${serialized}${close})`;
          return logged;
        }
      });
    } catch (e) {
      logger.warn('Failed to instrument locators', e instanceof Error ? e.message : String(e));
    }

    // Generate temp file name
    const fileName = this.generateTempFileName();

    // Save script
    const saveResult = this.saveTemporaryScript(prepared, fileName);
    if (!saveResult.success) {
      return {
        fileName: '',
        success: false,
        error: `Failed to save script: ${saveResult.error}`,
      };
    }

    logger.success('Self-healing lab script prepared and saved', { fileName, failureType: req.failureType, injectedSelector });
    return { fileName, success: true, failureInjected: req.failureType, injectedSelector } as any;
  }

  /**
   * FIX 2: Get the canonical generated scripts directory
   * Single source of truth for script paths across all services
   */
  getGeneratedScriptsDirectory(): string {
    return this.tempScriptDir;
  }

  /**
   * FIX 2: Resolve absolute path for a generated script file
   * Used by healing orchestrator, executor, and retry logic
   */
  resolveGeneratedScriptPath(fileName: string): string {
    return path.join(this.tempScriptDir, fileName);
  }

  /**
   * Cleanup temporary script
   */
  cleanupScript(fileName: string): void {
    try {
      const filePath = path.join(this.tempScriptDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`✓ Cleaned up temporary script: ${fileName}`);
      }
    } catch (error) {
      logger.warn(`Failed to cleanup script: ${fileName}`, error);
    }
  }
}

// Singleton instance
export const scriptExecutor = new ScriptExecutor('.');
