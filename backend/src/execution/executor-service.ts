/**
 * Execution Service - Runs generated Playwright tests with Chrome browser
 * Captures results and logs for API consumption
 */

import { exec, execSync } from 'child_process';
import { join } from 'path';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import validatePlaywrightEnvironment, { PLAYWRIGHT_ENVIRONMENT_ERROR, PLAYWRIGHT_NOT_INSTALLED } from './PlaywrightEnvironmentValidator';
import { chromium, Browser, Page } from 'playwright';
import { scriptExecutor } from '../services/script-executor';

const execAsync = promisify(exec);

/**
 * Execution result structure
 */
export interface ExecutionResult {
  id: string;
  testFile: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  passed: number;
  failed: number;
  skipped: number;
  totalTests: number;
  stdout: string;
  stderr: string;
  errors: string[];
  lastReachedLocator?: string;  // FIX 4: Populated from execution output for healing
  healingDetails?: {
    originalSelector: string;
    newSelector: string;
    strategy?: string;
  };
}

/**
 * Execution Store - In-memory store of recent executions
 */
class ExecutionStore {
  private executions: Map<string, ExecutionResult> = new Map();

  store(id: string, result: ExecutionResult): void {
    this.executions.set(id, result);
    // Keep only last 50 executions
    if (this.executions.size > 50) {
      const firstKey = this.executions.keys().next().value as string;
      this.executions.delete(firstKey);
    }
  }

  get(id: string): ExecutionResult | undefined {
    return this.executions.get(id);
  }

  list(): ExecutionResult[] {
    return Array.from(this.executions.values()).sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  clear(): void {
    this.executions.clear();
  }
}

/**
 * Executor Service
 */
export class ExecutorService {
  private store = new ExecutionStore();
  private projectRoot: string = '.';
  private testFilesPath: string;
  private repoRoot: string;

  constructor(projectRoot?: string) {
    if (projectRoot) {
      this.projectRoot = projectRoot;
    }
    // Resolve repository root explicitly and use it for all pw-ai-agents paths.
    // Servers may be started from `backend` (cwd=backend) so prefer to discover
    // the repo root by locating the `pw-ai-agents` folder in nearby ancestor paths.
    // Discover repository root by walking up from this file's directory until we find `pw-ai-agents`.
    const findRepoRoot = (startDir: string): string => {
      let dir = path.resolve(startDir);
      const root = path.parse(dir).root;
      let firstFound: string | null = null;
      while (true) {
        try {
          if (fs.existsSync(path.join(dir, 'pw-ai-agents'))) {
            // record first found, but keep walking up to prefer the highest-level repo
            if (!firstFound) firstFound = dir;
          }
          // Prefer directory that looks like a monorepo root: contains both 'backend' and 'pw-ai-agents'
          if (fs.existsSync(path.join(dir, 'pw-ai-agents')) && fs.existsSync(path.join(dir, 'backend'))) {
            return dir;
          }
        } catch (e) {
          // ignore
        }
        if (dir === root) break;
        dir = path.dirname(dir);
      }
      if (firstFound) return firstFound;
      // fallback to process.cwd()
      return process.cwd();
    };

    const repoRoot = findRepoRoot(__dirname);
    this.repoRoot = repoRoot;
    // Path to generated test scripts: <repoRoot>/pw-ai-agents/tests/ui/generated/scripts
    this.testFilesPath = join(this.repoRoot, 'pw-ai-agents', 'tests', 'ui', 'generated', 'scripts');
    logger.info(`🎯 Execution: Test files path: ${this.testFilesPath}`);
    logger.info(`🎯 Execution: Resolved repo root: ${repoRoot}`);

    // STARTUP VALIDATION: Detect multiple @playwright/test installations and fail fast
    try {
      // Always resolve pw-ai-agents from discovered repository root
      const pwAiAgentsDir = join(this.repoRoot, 'pw-ai-agents');
      let backendPlaywrightPath: string | null = null;
      let pwAgentsPlaywrightPath: string | null = null;

      try {
        backendPlaywrightPath = require.resolve('@playwright/test');
      } catch (e) {
        backendPlaywrightPath = null;
      }

      try {
        // Resolve from pw-ai-agents node_modules explicitly
        pwAgentsPlaywrightPath = require.resolve('@playwright/test', { paths: [path.join(pwAiAgentsDir, 'node_modules')] });
      } catch (e) {
        pwAgentsPlaywrightPath = null;
      }

      // Extra fallback: directly check filesystem for pw-ai-agents installation
      try {
        const candidate = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'index.js');
        if (!pwAgentsPlaywrightPath && fs.existsSync(candidate)) {
          pwAgentsPlaywrightPath = candidate;
        }
      } catch (e) {
        // ignore
      }

      const backendPkgDir = backendPlaywrightPath ? path.dirname(backendPlaywrightPath) : null;
      const pwAgentsPkgDir = pwAgentsPlaywrightPath ? path.dirname(pwAgentsPlaywrightPath) : null;

      logger.info('PLAYWRIGHT_CLI_PATH (backend):', backendPlaywrightPath || 'not found');
      logger.info('PLAYWRIGHT_CLI_PATH (pw-ai-agents):', pwAgentsPlaywrightPath || 'not found');
      logger.info('PLAYWRIGHT_PACKAGE_PATH (backend):', backendPkgDir || 'not found');
      logger.info('PLAYWRIGHT_PACKAGE_PATH (pw-ai-agents):', pwAgentsPkgDir || 'not found');

      if (backendPkgDir && pwAgentsPkgDir && backendPkgDir !== pwAgentsPkgDir) {
        // Multiple installations detected - fail fast to avoid mixed runtime contexts
        const msg = 'Multiple Playwright installations detected';
        logger.error(msg);
        logger.error(`backend: ${backendPkgDir}`);
        logger.error(`pw-ai-agents: ${pwAgentsPkgDir}`);
        throw new Error(msg);
      }
    } catch (err) {
      // Re-throw startup validation errors so server fails early
      if (err instanceof Error && err.message === 'Multiple Playwright installations detected') {
        throw err;
      }
      // otherwise ignore resolution errors (no playwright installed anywhere)
    }
  }

  /**
   * Execute a test file using Playwright with Chrome browser
   */
  async executeTest(testFile: string, options?: { overrideSelector?: string; failedLocator?: string }): Promise<ExecutionResult> {
    const executionId = this.generateId();
    const result: ExecutionResult = {
      id: executionId,
      testFile,
      status: 'running',
      startTime: new Date(),
      passed: 0,
      failed: 0,
      skipped: 0,
      totalTests: 0,
      stdout: '',
      stderr: '',
      errors: [],
    };

    this.store.store(executionId, result);
    logger.info(`▶️ Execution: Starting test execution for ${testFile} (ID: ${executionId})`);

    let browser: Browser | null = null;
    try {
      // ===== TASK 1/2/3: Validate Playwright environment before any execution =====
      // Use the repo root discovered in the constructor; do NOT recompute using process.cwd()
      const pwAiAgentsDir = join(this.repoRoot, 'pw-ai-agents');

      // Diagnostic logging to help debug environment resolution issues
      logger.info(`Resolved repoRoot: ${this.repoRoot}`);
      logger.info(`Resolved pwAiAgentsDir: ${pwAiAgentsDir}`);
      logger.info(`Exists: ${fs.existsSync(pwAiAgentsDir)}`);
      logger.info(`Package Exists: ${fs.existsSync(path.join(pwAiAgentsDir, 'package.json'))}`);
      logger.info(`Node Modules Exists: ${fs.existsSync(path.join(pwAiAgentsDir, 'node_modules'))}`);

      // Run validator
      let validation: any = null;
      try {
        validation = validatePlaywrightEnvironment(pwAiAgentsDir, this.repoRoot);

        // TASK 2: Print diagnostics
        logger.info('PLAYWRIGHT DIAGNOSTICS:');
        logger.info(`Execution Root: ${pwAiAgentsDir}`);
        logger.info(`Playwright CLI Path: ${validation.playwrightCliPath || 'not found'}`);
        logger.info(`@playwright/test Path: ${validation.playwrightPackagePath || 'not found'}`);
        logger.info(`node_modules Path: ${validation.nodeModulesPath || 'not found'}`);

        // TASK 6: Startup health output for this execution
        logger.info('PLAYWRIGHT HEALTH');
        logger.info(`CLI FOUND: ${validation.cliFound ? 'YES' : 'NO'}`);
        logger.info(`PACKAGE FOUND: ${validation.packageFound ? 'YES' : 'NO'}`);
        const versionInfo = validation.versions || {};
        logger.info(`VERSIONS: ${JSON.stringify(versionInfo)}`);
        logger.info(`PACKAGE PATH: ${validation.playwrightPackagePath || 'N/A'}`);

        if (!validation.ok) {
          // Fail fast - environment not suitable for running Playwright
          const reason = validation.error || 'Playwright environment validation failed';
          logger.error('PLAYWRIGHT ENVIRONMENT CHECK FAILED:', reason);
          result.status = 'error';
          result.stderr = reason;
          result.errors = [PLAYWRIGHT_ENVIRONMENT_ERROR + ': ' + reason];
          result.endTime = new Date();
          result.duration = result.endTime.getTime() - result.startTime.getTime();
          this.store.store(executionId, result);
          return result;
        }
      } catch (valErr) {
        logger.error('Error during Playwright environment validation', valErr instanceof Error ? valErr.message : String(valErr));
        result.status = 'error';
        result.stderr = String(valErr instanceof Error ? valErr.message : valErr);
        result.errors = [PLAYWRIGHT_ENVIRONMENT_ERROR + ': validation error'];
        result.endTime = new Date();
        result.duration = result.endTime.getTime() - result.startTime.getTime();
        this.store.store(executionId, result);
        return result;
      }
      // Resolve canonical test path using ScriptExecutor (single source of truth)
      let testPath: string;
      try {
        testPath = scriptExecutor.resolveGeneratedTestPath(testFile);
      } catch (e) {
        logger.warn(`Test file not found via scriptExecutor for ${testFile}: ${String(e)}`);
        // Legacy fallback: scan directory for recent temp files
        try {
          const allFiles = fs.existsSync(this.testFilesPath) ? fs.readdirSync(this.testFilesPath).filter(f => f.endsWith('.spec.ts')) : [];
          if (allFiles.length > 0) {
            const tempFiles = allFiles.filter(f => f.startsWith('temp-'));
            const candidates = tempFiles.length > 0 ? tempFiles : allFiles;
            let newest: string | null = null;
            let newestMtime = 0;
            for (const c of candidates) {
              try {
                const s = fs.statSync(join(this.testFilesPath, c));
                const m = s.mtime.getTime();
                if (m > newestMtime) {
                  newestMtime = m;
                  newest = c;
                }
              } catch (e) {}
            }
            if (newest) {
              testPath = join(this.testFilesPath, newest);
              logger.info(`Fallback selected test file: ${testPath}`);
            } else {
              throw new Error(`No candidate test files found in ${this.testFilesPath}`);
            }
          } else {
            throw new Error(`No test files found in ${this.testFilesPath}`);
          }
        } catch (fallbackErr) {
          throw new Error(`Test file not found: ${testFile}`);
        }
      }
      // Record actual filename chosen on disk (may differ from requested name)
      const actualTestFileName = path.basename(testPath);
      // Update the result to reflect the actual file being executed so callers can read the correct file
      result.testFile = actualTestFileName;

      logger.info(`📂 Execution: Found test file: ${testPath}`);

      // ========== TASK 7: PRINT AND SYNTAX-CHECK GENERATED SCRIPT BEFORE EXECUTION ==========
      logger.section(`\n${'='.repeat(80)}`);
      logger.info(`📝 [PRE-EXECUTION VALIDATION] Reading generated test script...`);
      
      let scriptContent = '';
      try {
        scriptContent = fs.readFileSync(testPath, 'utf-8');
        logger.info(`\n📋 [GENERATED SCRIPT CONTENT] Length: ${scriptContent.length} chars`);
        logger.info(`${'='.repeat(80)}\n`);
        logger.info(scriptContent);
        logger.info(`\n${'='.repeat(80)}\n`);
      } catch (readErr) {
        logger.error(`❌ Could not read test file: ${readErr}`);
        result.status = 'error';
        result.stderr = `Failed to read test file: ${String(readErr)}`;
        result.errors = [String(readErr)];
        result.endTime = new Date();
        result.duration = new Date().getTime() - result.startTime.getTime();
        this.store.store(executionId, result);
        return result;
      }
      
      // SYNTAX CHECK: Basic TypeScript/JavaScript validation
      logger.info(`🔍 [SYNTAX CHECK] Validating TypeScript syntax...`);
      
      const syntaxIssues = [];
      
      // Check for common syntax errors
      if (scriptContent.includes('SyntaxError')) {
        syntaxIssues.push('Script content contains "SyntaxError" string');
      }
      
      if (scriptContent.match(/[\{\}]\s*[\{\}]/)) {
        syntaxIssues.push('Possible double braces or brackets');
      }
      
      if (scriptContent.match(/[^{}\[\]]\}[^}\]];?\s*$/m)) {
        // Check for mismatched braces
        const openBraces = (scriptContent.match(/{/g) || []).length;
        const closeBraces = (scriptContent.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
          syntaxIssues.push(`Brace mismatch: {${openBraces} vs }${closeBraces}`);
        }
      }
      
      if (syntaxIssues.length > 0) {
        logger.error(`❌ [SYNTAX CHECK] Found ${syntaxIssues.length} potential syntax issue(s):`);
        syntaxIssues.forEach((issue, i) => {
          logger.error(`   ${i + 1}. ${issue}`);
        });
        logger.error(`\n⚠️  WARNING: Script may have syntax errors. Proceeding with execution...`);
      } else {
        logger.success(`✅ [SYNTAX CHECK] No obvious syntax errors detected`);
      }

      // Note: Runtime injection is disabled - it was causing test syntax errors
      // Instead, use the healed selectors through direct test modifications if needed
      // For now, run tests as-is without selector overrides during execution

      // Note: Do not launch a browser here - npx playwright test will launch its own browsers
      // This was causing multiple browser windows to open
      logger.info(`🎭 Execution: Playwright will launch its own browser instances for testing`);

      // Execute test file using Playwright CLI from pw-ai-agents directory (where playwright.config.ts exists)
      const tempReportDir = join(this.projectRoot, '.report-temp');
      if (!fs.existsSync(tempReportDir)) fs.mkdirSync(tempReportDir, { recursive: true });
      
      const reportJsonFile = join(tempReportDir, `report-${executionId}.json`);
      const reportLogFile = `${reportJsonFile}.log`;
      
      // Path to pw-ai-agents directory (resolve from repo root for determinism)
      // (pwAiAgentsDir is derived earlier during validation)

      // Relative path from pw-ai-agents to the test file (no disk patching)
      // Use the actual file name that exists on disk (handles fallback selection)
      const chosenTestFile = actualTestFileName || testFile;
      const relativeTestPath = join('tests', 'ui', 'generated', 'scripts', chosenTestFile);

      // Command for headed mode execution with explicit config and output handling
      // --headed: Force browser to be visible
      // --workers=1: Single worker for better visibility of browser window
      // --reporter=list: Console output
      // --reporter=html: HTML report for debugging
      // Don't use shell redirection - capture output programmatically for better error handling
      const command = `npx playwright test "${relativeTestPath}" --headed --workers=1 --reporter=list --reporter=html`;

      logger.info(`📝 Execution: Running Playwright test from pw-ai-agents: ${relativeTestPath}`);

      // Ensure Playwright browsers are installed to avoid interactive prompts during npx execution
        try {
        logger.info('🔧 Ensuring Playwright browsers are installed (using local playwright CLI)');
        // Prefer invoking the Playwright CLI JS directly via the active Node executable
        const localPlaywrightCli = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');
        if (fs.existsSync(localPlaywrightCli)) {
          const installCmd = `${process.execPath} "${localPlaywrightCli}" install --with-deps`;
          await execAsync(installCmd, {
            cwd: pwAiAgentsDir,
            maxBuffer: 50 * 1024 * 1024,
            timeout: 120000,
            env: { ...process.env },
            shell: '/bin/bash',
          });
        } else {
          // Fallback to npx in case local CLI not present
          await execAsync('npx playwright install --with-deps', {
            cwd: pwAiAgentsDir,
            maxBuffer: 50 * 1024 * 1024,
            timeout: 120000,
            env: { ...process.env },
          });
        }
        logger.info('🔧 Playwright browsers installed');
      } catch (installErr) {
        logger.warn('Could not auto-install Playwright browsers', installErr);
      }

      try {
        // Prepare child environment with proper headed mode settings
        let childEnv = { 
          ...process.env,
          PWDEBUG: '0',        // Disable Playwright debug mode (cleaner output)
          HEADLESS: 'false',   // Ensure headed mode in config
          DEBUG: '',           // Clear any debug flags that might hide browser
        } as NodeJS.ProcessEnv;

        // Ensure child process resolves modules from pw-ai-agents node_modules first
        try {
          const nodeModulesPath = (validation && validation.nodeModulesPath) ? validation.nodeModulesPath : path.join(pwAiAgentsDir, 'node_modules');
          // Prepend NODE_PATH so Node attempts to resolve modules from pw-ai-agents first
          const existingNodePath = childEnv.NODE_PATH ? `${childEnv.NODE_PATH}${path.delimiter}` : '';
          childEnv.NODE_PATH = `${nodeModulesPath}${path.delimiter}${existingNodePath}`;
          // Also ensure PATH contains pw-ai-agents local .bin to pick up wrapper scripts
          const binPath = path.join(pwAiAgentsDir, 'node_modules', '.bin');
          childEnv.PATH = `${binPath}${path.delimiter}${childEnv.PATH || ''}`;
          logger.debug(`🛠️  Child env NODE_PATH set to ${childEnv.NODE_PATH}`);
          logger.debug(`🛠️  Child env PATH set to ${childEnv.PATH.substring(0,200)}`);
        } catch (e) {
          // ignore
        }

        // On Linux/X11 systems, ensure display is set for browser visibility
        if (!childEnv.DISPLAY && process.platform === 'linux') {
          childEnv.DISPLAY = ':0';  // Default X11 display
          logger.debug(`🖥️  Set DISPLAY=${childEnv.DISPLAY} for X11 browser rendering`);
        }

        // If override selector is provided, create a patched copy of the test file
        // PHASE 6: Do NOT use runtime monkey-patching (NODE_OPTIONS). Instead create a healed temp file.
        let chosenTestFileToRun = relativeTestPath;
        let healingSuccessful = false;  // TASK 7: Track healing success
        if (options?.overrideSelector) {
          logger.info(`🔧 Preparing healed test file instead of runtime injection`);
          const failedLocator = options.failedLocator || '';
          const healedLocator = options.overrideSelector;

          // PHASE 5: Reject any healed selector that contains :visible
          if (/:visible/.test(String(healedLocator))) {
            throw new Error('Invalid healing output: :visible suffix not allowed');
          }

          try {
            // Read original script content
            const origScriptPath = join(this.testFilesPath, testFile);
            const origContent = fs.readFileSync(origScriptPath, 'utf-8');

            // TASK 2: Validation - Log old and new selectors before replacement
            console.log(`[HEALING] ==========================================`);
            console.log(`[HEALING] OLD SELECTOR:`);
            console.log(`[HEALING] ${failedLocator}`);
            console.log(`[HEALING] NEW SELECTOR:`);
            console.log(`[HEALING] ${healedLocator}`);
            console.log(`[HEALING] ==========================================`);

            let healedContent = origContent;
            let replacementCount = 0;
            
            // TASK 3: Replace all exact matches - Handle escaped quotes and all variants
            if (!failedLocator) {
              logger.error('❌ No failedLocator provided for replacement');
              console.error(`[HEALING] ERROR: failedLocator is empty or undefined`);
              throw new Error('HEALING_NO_FAILED_LOCATOR: failedLocator is empty or undefined');
            }

            // FIX: Normalize the selectors to handle both escaped and unescaped quotes
            const normalizedFailed = failedLocator.replace(/\\"/g, '"').trim();
            const normalizedHealed = healedLocator.replace(/\\"/g, '"').trim();
            
            // Generate ALL possible variants of the selector
            const failedVariants = [
              // Unescaped quotes (base form)
              normalizedFailed,
              // Escaped quotes in string literal
              normalizedFailed.replace(/"/g, '\\"'),
              // With single quotes around whole selector
              `'${normalizedFailed}'`,
              `'${normalizedFailed.replace(/"/g, '\\"')}'`,
              // With double quotes around whole selector
              `"${normalizedFailed}"`,
              `"${normalizedFailed.replace(/"/g, '\\"')}"`,
              // With backticks
              `\`${normalizedFailed}\``,
              `\`${normalizedFailed.replace(/"/g, '\\"')}\``,
            ];
            
            const healedVariants = [
              normalizedHealed,
              normalizedHealed.replace(/"/g, '\\"'),
              `'${normalizedHealed}'`,
              `'${normalizedHealed.replace(/"/g, '\\"')}'`,
              `"${normalizedHealed}"`,
              `"${normalizedHealed.replace(/"/g, '\\"')}"`,
              `\`${normalizedHealed}\``,
              `\`${normalizedHealed.replace(/"/g, '\\"')}\``,
            ];

            let variantsChecked = 0;
            let matchesFound = 0;
            const variantsAttempted: Array<{ variant: string; matches: number }> = [];

            console.log(`[HEALING] FAILED_SELECTOR: ${failedLocator}`);
            console.log(`[HEALING] HEALED_SELECTOR: ${healedLocator}`);
            console.log(`[HEALING] VARIANTS_CHECKED:`);

            // Try each variant pair
            for (let i = 0; i < failedVariants.length; i++) {
              const failedVariant = failedVariants[i];
              const healedVariant = healedVariants[i];
              variantsChecked++;
              
              // Count how many times this variant appears in ORIGINAL content
              const variantMatches = origContent.split(failedVariant).length - 1;
              variantsAttempted.push({ variant: failedVariant, matches: variantMatches });
              
              if (variantMatches > 0) {
                console.log(`[HEALING]   Variant ${variantsChecked}: "${failedVariant}"`);
                console.log(`[HEALING]   ↳ Found ${variantMatches} match(es)`);
                healedContent = healedContent.replaceAll(failedVariant, healedVariant);
                matchesFound += variantMatches;
                replacementCount += variantMatches;
              } else {
                console.log(`[HEALING]   Variant ${variantsChecked}: "${failedVariant}"`);
                console.log(`[HEALING]   ↳ No matches`);
              }
            }
            
            console.log(`[HEALING] MATCHES_FOUND: ${matchesFound}`);
            console.log(`[HEALING] REPLACEMENT_COUNT: ${replacementCount}`);

            // TASK 4: Validate replacement success
            if (replacementCount === 0) {
              const errorMsg = 'HEALING_NO_REPLACEMENTS: Could not locate failed selector in test file';
              logger.error(`❌ ${errorMsg}`);
              console.error(`[HEALING] ERROR: ${errorMsg}`);
              console.error(`[HEALING] Variants checked: ${variantsAttempted.length}`);
              variantsAttempted.forEach((v, idx) => {
                console.error(`[HEALING]   ${idx + 1}. "${v.variant}" (${v.matches} matches)`);
              });
              throw new Error(errorMsg);
            }

            // Extract the core value without quotes for validation
            const coreValue = normalizedFailed.replace(/[\[\]'"`=]/g, '');
            
            // Check if old selector still exists in ANY form
            let oldValueStillPresent = false;
            const checkPatterns = [
              normalizedFailed,
              normalizedFailed.replace(/"/g, '\\"'),
              `'${normalizedFailed}'`,
              `"${normalizedFailed}"`,
              `\`${normalizedFailed}\``,
            ];
            
            for (const pattern of checkPatterns) {
              if (healedContent.includes(pattern)) {
                oldValueStillPresent = true;
                console.warn(`[HEALING] WARNING: Old selector still present: "${pattern}"`);
              }
            }

            // Ensure new selector exists
            let newSelectorFound = false;
            const newCheckPatterns = [
              normalizedHealed,
              normalizedHealed.replace(/"/g, '\\"'),
              `'${normalizedHealed}'`,
              `"${normalizedHealed}"`,
              `\`${normalizedHealed}\``,
            ];
            
            for (const pattern of newCheckPatterns) {
              if (healedContent.includes(pattern)) {
                newSelectorFound = true;
                break;
              }
            }

            if (!newSelectorFound) {
              const errorMsg = 'HEALING_REPLACEMENT_FAILED: New selector not found in healed content after replacement';
              logger.error(`❌ ${errorMsg}`);
              console.error(`[HEALING] ERROR: ${errorMsg}`);
              throw new Error(errorMsg);
            }

            console.log(`[HEALING] ✓ Replacement validation passed`);

            // Write healed temp file into pw-ai-agents/tests/ui/generated/scripts
            const tmpDir = join(pwAiAgentsDir, 'tests', 'ui', 'generated', 'scripts');
            const healedFileName = `temp-healed-${executionId}-${path.basename(testFile)}`;
            const healedPath = join(tmpDir, healedFileName);
            fs.writeFileSync(healedPath, healedContent, 'utf-8');
            logger.info(`📝 Healed test written: ${healedPath}`);

            // TASK 1: Read healed file and log preview
            const verifyContent = fs.readFileSync(healedPath, 'utf-8');
            const contentPreview = verifyContent.substring(0, 500);
            console.log(`[HEALING] HEALED FILE CONTENT PREVIEW:`);
            console.log(contentPreview);
            console.log(`[HEALING] ...`);

            // TASK 4: Create utility function to check selector in file with all variants
            const selectorExistsInFile = (content: string, selector: string): boolean => {
              // Normalize selector by removing escape characters
              const normalized = selector.replace(/\\"/g, '"').trim();
              
              // Generate all possible variants that might appear in the file
              const variants = [
                // Unescaped form
                normalized,
                // Escaped form (as in string literals)
                normalized.replace(/"/g, '\\"'),
                // With locator() wrapper - unescaped
                `locator("${normalized}")`,
                // With locator() wrapper - escaped
                `locator("[${normalized.substring(1, normalized.length - 1)}]")`,
                // Single quotes with locator()
                `locator('${normalized}')`,
                // Escaped in locator
                `locator('${normalized.replace(/"/g, '\\"')}')`,
                // Direct string forms
                `'${normalized}'`,
                `"${normalized}"`,
                `\`${normalized}\``,
              ];
              
              // Check if ANY variant exists
              for (const variant of variants) {
                if (content.includes(variant)) {
                  console.log(`[HEALING]   ✓ Found: "${variant}"`);
                  return true;
                }
              }
              return false;
            };

            // TASK 5: Log verification variants being checked
            console.log(`[HEALING] VERIFICATION VARIANTS:`);
            console.log(`[HEALING]   Variant A: ${normalizedHealed}`);
            console.log(`[HEALING]   Variant B: ${normalizedHealed.replace(/"/g, '\\"')}`);
            console.log(`[HEALING]   Variant C: locator("${normalizedHealed}")`);
            console.log(`[HEALING]   Variant D: locator('${normalizedHealed}')`);

            // TASK 6: Verify based on replacement success
            // If replacementCount > 0 AND old selector no longer exists, verification passes
            let verificationPassed = false;
            
            if (replacementCount > 0) {
              // Check if old selector still exists
              const oldSelectorExists = selectorExistsInFile(verifyContent, normalizedFailed);
              
              if (!oldSelectorExists) {
                // Old selector is gone, verification passes
                verificationPassed = true;
                console.log(`[HEALING] ✓ Old selector successfully removed`);
              } else {
                console.log(`[HEALING] ⚠️  Old selector still present in file`);
              }
            } else {
              console.log(`[HEALING] ⚠️  No replacements were made (replacementCount = 0)`);
            }

            // Verify new selector exists
            const newSelectorExists = selectorExistsInFile(verifyContent, normalizedHealed);
            if (!newSelectorExists) {
              const errorMsg = `HEALING_FILE_VERIFICATION_FAILED: New selector not found in healed file`;
              logger.error(errorMsg);
              console.error(`[HEALING] ERROR: ${errorMsg}`);
              console.error(`[HEALING] Searched for: ${normalizedHealed}`);
              throw new Error(errorMsg);
            }

            console.log(`[HEALING] ✓ New selector found in healed file`);
            
            if (verificationPassed && newSelectorExists) {
              console.log(`[HEALING] ✓ HEALED FILE VERIFIED: Old selector removed, new selector present`);
            } else {
              const warnMsg = `⚠️  Verification completed with warnings`;
              logger.warn(warnMsg);
              console.warn(`[HEALING] ${warnMsg}`);
            }

            console.log(`[HEALING] HEALED FILE: CREATED`);
            console.log(`[HEALING] HEALED PATH: ${healedPath}`);

            // Update the path to run the healed file
            chosenTestFileToRun = join('tests', 'ui', 'generated', 'scripts', healedFileName);
            healingSuccessful = true;  // TASK 7: Mark healing as successful
          } catch (err) {
            // TASK 7: Do NOT proceed with retry if healing failed
            logger.error('❌ Healing preparation failed - aborting retry execution', err);
            console.error(`[HEALING] CRITICAL: Healing failed, aborting retry`);
            console.error(`[HEALING] ERROR: ${err instanceof Error ? err.message : String(err)}`);
            // Don't proceed - healing failed, so retry should not execute
            // Return early with failure status
            const healingError = err instanceof Error ? err.message : String(err);
            return {
              id: executionId,
              testFile,
              status: 'failed',
              startTime: result.startTime,
              duration: Date.now() - result.startTime.getTime(),
              passed: 0,
              failed: 1,
              skipped: 0,
              totalTests: 1,
              stdout: '',
              stderr: healingError,
              errors: [`Healing preparation failed: ${healingError}`],
            };
          }
        }

        // Prefer invoking the local playwright binary directly (node_modules/.bin/playwright)
        // Invoke the local playwright binary explicitly via a relative path from the pw-ai-agents directory.
        // This avoids npm/npx indirection and ensures the local devDependency @playwright/test is resolved.
        // Run the Playwright CLI JS directly with the node executable to avoid shebang/env resolution issues
        // Prefer the Playwright CLI installed in the pw-ai-agents project first
        // Use the validator's canonical Playwright CLI path when available and do not attempt to mix installations.
        let chosenCli: string | null = null;
        try {
          if (validation && validation.playwrightCliPath) {
            chosenCli = validation.playwrightCliPath;
          } else {
            const explicitPwCli = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');
            if (fs.existsSync(explicitPwCli)) chosenCli = explicitPwCli;
          }
        } catch (e) {
          logger.debug('Playwright CLI selection failed; proceeding with best-effort local path', e instanceof Error ? e.message : String(e));
        }

        let commandToRun: string;
        // Prefer the local pw-ai-agents wrapper binary if present (ensures proper module context)
        try {
          const wrapperBin = path.join(pwAiAgentsDir, 'node_modules', '.bin', 'playwright');
          const explicitCliNow = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');
          logger.info('🛠️ pw-ai-agents dir:', pwAiAgentsDir);
          logger.info('🛠️ explicit pw-ai-agents CLI exists:', fs.existsSync(explicitCliNow));
          if (fs.existsSync(wrapperBin)) {
            commandToRun = `./node_modules/.bin/playwright test "${chosenTestFileToRun}" --headed --workers=1 --reporter=list --reporter=html`;
            logger.info('🛠️ Execution: Using pw-ai-agents local playwright wrapper binary');
          } else if (fs.existsSync(explicitCliNow)) {
            // Force using the pw-ai-agents CLI JS directly to guarantee correct module context
            commandToRun = `${process.execPath} "${explicitCliNow}" test "${chosenTestFileToRun}" --headed --workers=1 --reporter=list --reporter=html`;
            logger.info(`🛠️ Execution: Forcing pw-ai-agents CLI: ${explicitCliNow}`);
          } else if (chosenCli) {
            commandToRun = `${process.execPath} "${chosenCli}" test "${chosenTestFileToRun}" --headed --workers=1 --reporter=list --reporter=html`;
            logger.info(`🛠️ Execution: Will run Playwright via node + CLI: ${chosenCli}`);
          } else {
            commandToRun = `./node_modules/.bin/playwright test "${chosenTestFileToRun}" --headed --workers=1 --reporter=list --reporter=html`;
            logger.info('🛠️ Execution: Playwright CLI JS not found - falling back to ./node_modules/.bin/playwright');
          }
        } catch (e) {
          // fallback to chosenCli or generic wrapper
          if (chosenCli) {
            commandToRun = `${process.execPath} "${chosenCli}" test "${chosenTestFileToRun}" --headed --workers=1 --reporter=list --reporter=html`;
            logger.info(`🛠️ Execution: Will run Playwright via node + CLI: ${chosenCli}`);
          } else {
            commandToRun = `./node_modules/.bin/playwright test "${chosenTestFileToRun}" --headed --workers=1 --reporter=list --reporter=html`;
            logger.info('🛠️ Execution: Playwright CLI JS not found - falling back to ./node_modules/.bin/playwright');
          }
        }
        logger.info(`🛠️ Execution: Command to run: ${commandToRun}`);

        // DIAGNOSTIC: Check how Node resolves @playwright/test and print environment details
        try {
          const diagCmd = `node -e "console.log('CWD:'+process.cwd()); console.log('NODE:', process.execPath); try{console.log('RESOLVE:@playwright/test:'+require.resolve('@playwright/test'))}catch(e){console.error('RESOLVE_ERROR:'+e.message)}; console.log('ENV_PATH:'+process.env.PATH);"`;
          logger.info('🔎 Diagnostic: resolving @playwright/test from pw-ai-agents directory');
          const diag = await execAsync(diagCmd, { cwd: pwAiAgentsDir, env: childEnv, timeout: 20000, shell: '/bin/bash' });
          logger.info('🔎 Diagnostic stdout:', diag.stdout ? diag.stdout.toString().substring(0, 2000) : '(none)');
          if (diag.stderr) logger.warn('🔎 Diagnostic stderr:', diag.stderr.toString().substring(0, 2000));
        } catch (diagErr: any) {
          logger.warn('🔎 Diagnostic failed to resolve @playwright/test', diagErr?.message || String(diagErr));
        }

        const result_output = await execAsync(commandToRun, {
          // Run from pw-ai-agents directory where playwright.config.ts exists
          cwd: pwAiAgentsDir,
          maxBuffer: 50 * 1024 * 1024,
          timeout: 120000,
          env: childEnv,
          shell: '/bin/bash',
        });

        logger.info(`🌐 Headed mode browser execution completed`);
        logger.debug(`📋 Command: ${commandToRun}`);
        logger.debug(`🖥️  Environment: HEADLESS=${childEnv.HEADLESS}, DISPLAY=${childEnv.DISPLAY || 'not set'}`);

        result.stdout = result_output.stdout;
        result.stderr = result_output.stderr;
        logger.debug(`Execution stdout: ${result.stdout?.substring(0, 200)}`);
        
        // Save output to report file for debugging
        if (result.stdout) {
          fs.writeFileSync(reportLogFile, `STDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr || 'none'}`);
        }

        // Parse JSON from file produced by Playwright JSON reporter
        const jsonPath = join(pwAiAgentsDir, 'playwright-report', 'index.json');
        if (fs.existsSync(jsonPath)) {
          try {
            const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            this.parseResultsFromJson(result, '', jsonOutput);
          } catch (parseErr) {
            logger.warn('Could not parse playwright JSON report', parseErr);
            this.parseFromStdout(result);
          }
        } else {
          // Fallback: try to extract from playwright-report HTML if exists
          this.parseFromStdout(result);
        }
        
        result.status = result.failed === 0 ? 'passed' : 'failed';
        
        // Clean up temp files
        if (fs.existsSync(reportLogFile)) fs.unlinkSync(reportLogFile);
        
        logger.success(
          `✓ Execution: Test completed (${result.passed} passed, ${result.failed} failed)`
        );
      
          // Attempt to extract a concise Playwright error summary for downstream consumers
          try {
            (result as any).playwrightError = this.extractActualPlaywrightError(result);
            if ((result as any).playwrightError) logger.info('Playwright extracted error:', (result as any).playwrightError.substring(0, 400));
            // Extract last reached locator from stdout logs (instrumented by healing-lab)
            try {
              (result as any).lastReachedLocator = this.extractLastReachedLocator(String(result.stdout || '') + '\n' + String(result.stderr || ''));
              if ((result as any).lastReachedLocator) logger.info('Playwright lastReachedLocator:', (result as any).lastReachedLocator);
            } catch (e) {
              // ignore
            }
          } catch (e) {
            logger.debug('Could not extract playwright error', e instanceof Error ? e.message : String(e));
          }
      } catch (error: any) {
        logger.debug(`Execution error: ${error.message}`);
        result.stdout = error.stdout || '';
        result.stderr = error.stderr || '';
        
        // Save error output to report file for debugging
        fs.writeFileSync(reportLogFile, `COMMAND_ERROR:\n${error.message}\n\nSTDOUT:\n${error.stdout || 'none'}\n\nSTDERR:\n${error.stderr || 'none'}`);

        // Try to parse JSON from playwright report directory even when command fails
        const jsonPath = join(pwAiAgentsDir, 'playwright-report', 'index.json');
        if (fs.existsSync(jsonPath)) {
          try {
            const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            this.parseResultsFromJson(result, '', jsonOutput);
          } catch (parseErr) {
            logger.warn('Could not parse playwright JSON report on error', parseErr);
          }
        }

        // If parse did not populate errors, include CLI stdout/stderr snippets for diagnosis
        if (!result.errors || result.errors.length === 0) {
          const stdoutSnippet = (result.stdout || '').split('\n').slice(-10).join('\n').trim();
          const stderrSnippet = (result.stderr || '').split('\n').slice(-10).join('\n').trim();
          if (stderrSnippet) result.errors.push(`stderr:\n${stderrSnippet}`);
          if (stdoutSnippet) result.errors.push(`stdout:\n${stdoutSnippet}`);
        }

        // If still empty, include the error message for visibility
        if (!result.errors || result.errors.length === 0) {
          if (error?.message) result.errors.push(`error: ${error.message}`);
          if (error?.stack) result.errors.push(`stack: ${error.stack.split('\n').slice(0,5).join('\n')}`);
        }

        result.status = result.failed > 0 ? 'failed' : 'error';

        if (error?.killed) {
          result.errors.push('Test execution timeout (exceeded 2 minutes)');
          result.status = 'error';
        }

        // Clean up temp files
        if (fs.existsSync(reportLogFile)) fs.unlinkSync(reportLogFile);

        logger.warn(`⚠️ Execution: Test completed with status: ${result.status}`);
      }

      // Note: Browser cleanup code removed - we don't launch a browser ourselves
      // Playwright test runner handles its own browser lifecycle

    } catch (error: any) {
      logger.error('✗ Execution: Failed to execute test', error);
      result.status = 'error';
      result.errors.push(error.message || 'Unknown error during execution');
      result.stderr = error.message;
    } finally {
      // No browser to close - Playwright test runner manages its own lifecycle
      logger.debug('✓ Execution: Test execution cleanup complete');
    }

    result.endTime = new Date();
    result.duration = result.endTime.getTime() - result.startTime.getTime();
    // Always attempt to extract last reached locator from outputs (even on error)
    try {
      (result as any).lastReachedLocator = this.extractLastReachedLocator(String(result.stdout || '') + '\n' + String(result.stderr || ''));
      if ((result as any).lastReachedLocator) logger.info('Execution: extracted lastReachedLocator', (result as any).lastReachedLocator);
    } catch (e) {
      logger.debug('Could not extract lastReachedLocator', e instanceof Error ? e.message : String(e));
    }

    logger.success(
      `✓ Execution: Completed in ${result.duration}ms (${result.passed} passed, ${result.failed} failed)`
    );

    this.store.store(executionId, result);
    return result;
  }

  /**
   * Parse Playwright test results from JSON file
   */
  private parseResultsFromJson(result: ExecutionResult, jsonFilePath: string, jsonObject?: any): void {
    try {
      let jsonReport = jsonObject;
      
      if (!jsonReport && jsonFilePath && fs.existsSync(jsonFilePath)) {
        jsonReport = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
      }
      
      if (jsonReport && jsonReport.stats) {
        // Playwright stats format:
        // expected: number of tests that passed (when expected to pass)
        // unexpected: number of tests that failed unexpectedly
        // skipped: number of tests that were skipped
        result.passed = jsonReport.stats.expected || 0;
        result.failed = jsonReport.stats.unexpected || 0;
        result.skipped = jsonReport.stats.skipped || 0;
        result.totalTests = (result.passed + result.failed + result.skipped) || 0;

        // If Playwright reports top-level errors (configuration/transform errors), capture them
        if (Array.isArray(jsonReport.errors) && jsonReport.errors.length > 0) {
          jsonReport.errors.forEach((e: any) => {
            if (e && e.message) result.errors.push(e.message);
            else result.errors.push(String(e));
          });
        }

        // Extract error messages from failed tests
        if (jsonReport.suites) {
          jsonReport.suites.forEach((suite: any) => {
            if (suite.specs) {
              suite.specs.forEach((spec: any) => {
                if (!spec.ok && spec.tests && Array.isArray(spec.tests)) {
                  spec.tests.forEach((test: any) => {
                    if (test.results && Array.isArray(test.results)) {
                      test.results.forEach((res: any) => {
                        if (res.status === 'failed' && res.error) {
                          result.errors.push(`${spec.title}: ${res.error.message?.split('\n')[0] || res.error}`);
                        }
                      });
                    }
                  });
                }
              });
            }
          });
        }
      } else if (jsonReport && jsonReport.suites) {
        // Alternative Playwright format: count tests from suites directly
        let passed = 0;
        let failed = 0;
        let skipped = 0;

        jsonReport.suites.forEach((suite: any) => {
          if (suite.specs) {
            suite.specs.forEach((spec: any) => {
              if (spec.tests && Array.isArray(spec.tests)) {
                spec.tests.forEach((test: any) => {
                  if (test.results && Array.isArray(test.results)) {
                    const lastResult = test.results[test.results.length - 1];
                    if (lastResult.status === 'passed') {
                      passed++;
                    } else if (lastResult.status === 'failed') {
                      failed++;
                    } else if (lastResult.status === 'skipped') {
                      skipped++;
                    }
                  }
                });
              }
            });
          }
        });

        result.passed = passed;
        result.failed = failed;
        result.skipped = skipped;
        result.totalTests = passed + failed + skipped;
      } else {
        // Fallback parsing from stdout
        this.parseFromStdout(result);
      }
    } catch (error: any) {
      logger.debug('Could not parse JSON report', error);
      // Fallback parsing from stdout
      this.parseFromStdout(result);
    }
  }

  /**
   * [DEPRECATED] Parse Playwright test results - kept for compatibility
   */
  private parseResults(result: ExecutionResult, reportDir: string): void {
    logger.debug('parseResults called (deprecated) - using parseResultsFromJson instead');
  }

  /**
   * Fallback parsing from stdout
   */
  private parseFromStdout(result: ExecutionResult): void {
    const output = result.stdout + result.stderr;

    // Look for summary line like: "1 passed, 2 failed in 5.23s" or "1 passed (1.2s)"
    // Try multiple patterns to handle different Playwright output formats
    
    // Pattern 1: "X passed, Y failed, Z skipped"
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    if (passedMatch) result.passed = parseInt(passedMatch[1], 10);
    if (failedMatch) result.failed = parseInt(failedMatch[1], 10);
    if (skippedMatch) result.skipped = parseInt(skippedMatch[1], 10);

    // Pattern 2: Look for test count indicators in brackets like "[1/3]" 
    // or explicit test counts in the output
    if (!passedMatch && !failedMatch) {
      // Try to find "1 test" or similar patterns
      const testCountMatch = output.match(/passing|pass|✓|✔/gi);
      const failCountMatch = output.match(/failing|fail|✗|✘/gi);
      
      // If we found pass/fail keywords but no numbers, mark the test as complete with proper count
      if (testCountMatch && testCountMatch.length > 0 && (!failedMatch || failedMatch[1] === '0')) {
        // This appears to be a passing test
        if (!result.passed) result.passed = 1;
      }
      if (failCountMatch && failCountMatch.length > 0) {
        // This appears to be a failing test
        if (!result.failed) result.failed = 1;
      }
    }

    // Ensure we have at least counted the test if we got this far
    if (result.passed === 0 && result.failed === 0 && result.skipped === 0) {
      // Check if there's any indication the test ran at all
      const hasTestIndicators = /passed|failed|skipped|✓|✗|test/i.test(output);
      if (hasTestIndicators && output.length > 10) {
        // Empty result but test seems to have run - mark as 1 test with unknown status
        // Try to determine if it was successful or not
        if (/pass|ok|success/i.test(output) && !/fail|error|false/i.test(output)) {
          result.passed = 1;
        } else if (/fail|error/i.test(output)) {
          result.failed = 1;
        }
      }
    }

    result.totalTests = result.passed + result.failed + result.skipped;

    // Extract error messages
    const errorLines = output.split('\n').filter((line) => line.includes('Error') || line.includes('FAILED'));
    result.errors = errorLines.slice(0, 10); // Limit to 10 errors
  }

  /**
   * Extract a concise Playwright error message from stdout/stderr/result.errors
   */
  private extractActualPlaywrightError(result: ExecutionResult): string {
    const combined = `${result.stderr || ''}\n${result.stdout || ''}`.replace(/\x1B\[[0-9;]*m/g, '\n');
    // Prefer stderr if it contains a recognizable Playwright error
    if (result.stderr && /locator|page\.goto|waitForURL|timeout|Timeout|navigation|waiting for locator|params\.selector/i.test(result.stderr)) {
      return result.stderr.trim();
    }
    // Fallback to stdout
    if (result.stdout && /locator|page\.goto|waitForURL|timeout|Timeout|navigation|waiting for locator|params\.selector/i.test(result.stdout)) {
      return result.stdout.trim();
    }
    // Otherwise, return first non-empty error from result.errors
    if (result.errors && result.errors.length > 0) return String(result.errors[0]);
    // Last resort: return combined output trimmed
    return combined.trim();
  }

  /**
   * Extract last reached locator log entry from combined output
   */
  private extractLastReachedLocator(output: string): string | null {
    if (!output) return null;
    // Robustly strip ANSI CSI sequences (covers sequences like \u001b[1A, \u001b[2K, colors, etc.)
    const clean = output.replace(/(?:\u001b|\x1B)\[[0-9;?]*[ -\/]*[@-~]/g, '');
    const re = /\[HEALING LAB\] REACHED LOCATOR:\s*(.*)/g;
    let match: RegExpExecArray | null;
    let last: string | null = null;
    while ((match = re.exec(clean)) !== null) {
      if (match[1]) {
        // Normalize by removing escape remnants and backslashes used in JSON quoting
        last = String(match[1]).replace(/\\/g, '').trim();
      } else last = null;
    }
    return last;
  }

  /**
   * Get execution result
   */
  getExecution(id: string): ExecutionResult | undefined {
    return this.store.get(id);
  }

  /**
   * List all executions
   */
  listExecutions(): ExecutionResult[] {
    return this.store.list();
  }

  /**
   * Get execution logs (same as result but formatted)
   */
  getExecutionLogs(id: string): { logs: string; errors: string[] } | undefined {
    const result = this.store.get(id);
    if (!result) return undefined;

    let logs = `Execution ID: ${result.id}\n`;
    logs += `Test File: ${result.testFile}\n`;
    logs += `Status: ${result.status}\n`;
    logs += `Duration: ${result.duration}ms\n`;
    logs += `Results: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped\n`;
    logs += `\n--- STDOUT ---\n${result.stdout}\n`;
    logs += `\n--- STDERR ---\n${result.stderr}\n`;

    return {
      logs,
      errors: result.errors,
    };
  }

  /**
   * Generate unique execution ID
   */
  private generateId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear execution history
   */
  clearHistory(): void {
    this.store.clear();
    logger.info('Execution: Cleared execution history');
  }

  /**
   * Save execution result to store (for storing orchestration results)
   */
  saveExecution(id: string, result: ExecutionResult): void {
    this.store.store(id, result);
    logger.debug(`Execution: Saved result for ID: ${id}`);
  }

  /**
   * Return the repository root discovered during construction
   */
  getRepoRoot(): string {
    return this.repoRoot;
  }

  /**
   * Execute and stream results (for long-running tests)
   * This can be used with WebSockets for real-time updates
   */
  async executeTestAndCapture(testFile: string): Promise<ExecutionResult> {
    return this.executeTest(testFile);
  }
}

// Export singleton instance
// Instantiate ExecutorService with explicit backend project root to ensure
// paths like pw-ai-agents are resolved relative to the repository layout.
export const executorService = new ExecutorService(process.cwd());
