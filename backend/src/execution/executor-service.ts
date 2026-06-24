/**
 * Execution Service - Runs generated Playwright tests with Chrome browser
 * Captures results and logs for API consumption
 */

import { exec, execSync, spawn } from 'child_process';
import { join } from 'path';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { CodeValidator } from '../utils/code-validator';
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
 * PHASE 2A: Streaming execution with early-exit detection on FAILED keyword
 * Monitors Playwright output in real-time and exits immediately when tests fail
 * Reduces timeout from 120s to 30s by detecting failures early
 */
function executeWithEarlyExit(
  command: string,
  args: string[],
  options: any
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // Avoid forcing an extra shell via the `shell` option when launching a shell command
    // The caller may already provide a shell command (e.g. '/bin/bash' with '-c').
    // Passing `shell` here causes nested shells and can alter argument parsing.
    const spawnOptions = { ...(options || {}) } as any;
    if (spawnOptions.shell) delete spawnOptions.shell;
    const process = spawn(command, args, spawnOptions);
    let stdout = '';
    let stderr = '';
    let failureDetected = false;
    const earlyExitTimeout = 30000; // 30 seconds for early exit detection
    let exitTimer: NodeJS.Timeout;

      const onData = (data: Buffer, isStderr = false) => {
      const chunk = data.toString();
      if (isStderr) stderr += chunk;
      else stdout += chunk;

      // PHASE 2A: Detect FAILED keyword for immediate exit
      if (!failureDetected && /(?:FAILED|failed|Test failed|Timeout|waiting for locator)/i.test(stdout + stderr)) {
        failureDetected = true;
        logger.info('[PHASE-2A-OPT] 🔴 Early test failure detected');
        // NOTE: Previously we terminated the child process immediately here (SIGTERM
        // followed by SIGKILL) which caused Playwright reporters/artifacts to be
        // incomplete. To restore the previous healing flow, only perform an
        // aggressive kill when the operator explicitly enables it via
        // `DISABLE_PHASE_2A=false` (default is to allow the test runner to exit
        // gracefully so reporters and artifacts can be written).
        const allowImmediateKill = String((globalThis as any).process?.env?.ENABLE_PHASE_2A_IMMEDIATE_KILL || 'false').toLowerCase() === 'true';
        if (allowImmediateKill) {
          logger.info('[PHASE-2A-OPT] 🔴 Immediate termination enabled via ENABLE_PHASE_2A_IMMEDIATE_KILL=true');
          // Kill the process immediately
          process.kill('SIGTERM');
          clearTimeout(exitTimer);
          // Exit quickly without waiting for normal completion
          exitTimer = setTimeout(() => {
            process.kill('SIGKILL');
          }, 2000);
        } else {
          logger.info('[PHASE-2A-OPT] ⚠️ Immediate termination suppressed to allow reporters/artifacts to flush');
        }
      }

      // Log significant output for debugging
      if (chunk.includes('PASSED') || chunk.includes('FAILED') || chunk.includes('Test:')) {
        logger.debug(`[PHASE-2A] Test output: ${chunk.substring(0, 150)}`);
      }
    };

    process.stdout?.on('data', (data) => onData(data, false));
    process.stderr?.on('data', (data) => onData(data, true));

    // Set early exit timeout
    exitTimer = setTimeout(() => {
      logger.warn('[PHASE-2A-OPT] ⏱️ Early exit timeout (30s) exceeded without failure detection - continuing');
      // Don't kill here, let it complete normally
    }, earlyExitTimeout);

    process.on('close', (code) => {
      clearTimeout(exitTimer);
      logger.info(`[PHASE-2A] Process exited with code ${code} (failure detected: ${failureDetected})`);
      try { logger.info('EXECUTE_TEST_EXIT_EVENT', { exitCode: code, failureDetected }); } catch(e){}
      try { logger.info('EXECUTE_TEST_BEFORE_RESOLVE', { exitCode: code, failureDetected }); } catch(e){}
      resolve({ stdout, stderr, exitCode: code || 0 });
      try { logger.info('EXECUTE_TEST_AFTER_RESOLVE', { exitCode: code, failureDetected }); } catch(e){}
    });

    process.on('error', (err) => {
      clearTimeout(exitTimer);
      try { logger.info('EXECUTE_TEST_BEFORE_REJECT', { err: String(err) }); } catch(e){}
      reject(err);
    });
  });
}

/**
 * Executor Service
 */
export class ExecutorService {
  // PHASE 1 OPTIMIZATION: Cache environment validation for 30 minutes
  private static validationCache: any = null;
  private static validationCacheTime = 0;
  private static VALIDATION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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

    this.saveExecution(executionId, result);
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

      // PHASE 1 OPTIMIZATION: Use cached validation result (30-minute TTL)
      // This saves 500-1000ms per test execution by skipping environment checks
      let validation: any = null;
      try {
        const now = Date.now();
        const cacheAge = now - ExecutorService.validationCacheTime;
        
        if (ExecutorService.validationCache && 
            cacheAge < ExecutorService.VALIDATION_CACHE_TTL) {
          validation = ExecutorService.validationCache;
          logger.debug(`🚀 [PHASE-1-OPT] Using cached Playwright validation (age: ${cacheAge}ms)`);
        } else {
          // Cache miss - perform full validation
          logger.info('🔍 [PHASE-1-OPT] Performing Playwright environment validation (not in cache)');
          validation = validatePlaywrightEnvironment(pwAiAgentsDir, this.repoRoot);
          ExecutorService.validationCache = validation;
          ExecutorService.validationCacheTime = now;

          // Print diagnostics only on cache miss
          logger.info('PLAYWRIGHT DIAGNOSTICS:');
          logger.info(`Execution Root: ${pwAiAgentsDir}`);
          logger.info(`Playwright CLI Path: ${validation.playwrightCliPath || 'not found'}`);
          logger.info(`@playwright/test Path: ${validation.playwrightPackagePath || 'not found'}`);
          logger.info(`node_modules Path: ${validation.nodeModulesPath || 'not found'}`);

          // Startup health output for this execution
          logger.info('PLAYWRIGHT HEALTH');
          logger.info(`CLI FOUND: ${validation.cliFound ? 'YES' : 'NO'}`);
          logger.info(`PACKAGE FOUND: ${validation.packageFound ? 'YES' : 'NO'}`);
          const versionInfo = validation.versions || {};
          logger.info(`VERSIONS: ${JSON.stringify(versionInfo)}`);
          logger.info(`PACKAGE PATH: ${validation.playwrightPackagePath || 'N/A'}`);
        }

        if (!validation.ok) {
          // Fail fast - environment not suitable for running Playwright
          const reason = validation.error || 'Playwright environment validation failed';
          logger.error('PLAYWRIGHT ENVIRONMENT CHECK FAILED:', reason);
          result.status = 'error';
          result.stderr = reason;
          result.errors = [PLAYWRIGHT_ENVIRONMENT_ERROR + ': ' + reason];
          result.endTime = new Date();
          result.duration = result.endTime.getTime() - result.startTime.getTime();
          this.saveExecution(executionId, result);
          return result;
        }
      } catch (valErr) {
        logger.error('Error during Playwright environment validation', valErr instanceof Error ? valErr.message : String(valErr));
        result.status = 'error';
        result.stderr = String(valErr instanceof Error ? valErr.message : valErr);
        result.errors = [PLAYWRIGHT_ENVIRONMENT_ERROR + ': validation error'];
        result.endTime = new Date();
        result.duration = result.endTime.getTime() - result.startTime.getTime();
        this.saveExecution(executionId, result);
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
        logger.info(`📋 Generated script: ${actualTestFileName} (length=${scriptContent.length} chars)`);
      } catch (readErr) {
        logger.error(`❌ Could not read test file: ${readErr}`);
        result.status = 'error';
        result.stderr = `Failed to read test file: ${String(readErr)}`;
        result.errors = [String(readErr)];
        result.endTime = new Date();
        result.duration = new Date().getTime() - result.startTime.getTime();
        this.saveExecution(executionId, result);
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

      // Command execution flags. Default to headless; include --headed only when explicitly requested.
      // --workers=1: Single worker for determinism
      // --reporter=list: Console output
      // --reporter=html: HTML report for debugging
      // Don't use shell redirection - capture output programmatically for better error handling
      const shouldForceHeaded = (process.env.FORCE_HEADED === 'true') || ((process.env.HEADLESS || '').toString().toLowerCase() === 'false');
      const headFlagForCommand = shouldForceHeaded ? '--headed' : '';
      const command = `npx playwright test "${relativeTestPath}" ${headFlagForCommand} --workers=1 --reporter=list`;

      logger.info(`📝 Execution: Running Playwright test from pw-ai-agents: ${relativeTestPath}`);

      // PHASE 1 OPTIMIZATION: Browser installation moved to server startup
      // Skip redundant installation checks - browsers initialized once when server starts
      logger.info('✅ [PHASE-1-OPT] Skipping browser install check (completed at server startup)');

      try {
        // Prepare child environment with proper headed mode settings
        // Default to headless; allow callers to set HEADLESS='false' or FORCE_HEADED='true' to force headed mode
        const requestedHeadless = (process.env.HEADLESS || 'true').toString();
        let childEnv = { 
          ...process.env,
          PWDEBUG: '0',        // Disable Playwright debug mode (cleaner output)
          HEADLESS: requestedHeadless,   // Honor caller preference; default 'true' (headless)
          DEBUG: '',           // Clear any debug flags that might hide browser
        } as NodeJS.ProcessEnv;

        // Prevent Playwright HTML reporter from auto-opening a local server
        // which blocks the process (serves report and waits for Ctrl+C).
        // Controlled by PLAYWRIGHT_HTML_OPEN (always|never|on-failure). Set to
        // 'never' to ensure the CLI exits after report generation.
        childEnv.PLAYWRIGHT_HTML_OPEN = 'never';

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

          // SAFETY: Validate failedLocator is a safe selector (must not be JS source)
          const isUnsafeFragment = /(?:page\.locator\(|\.click\(|\.fill\(|await\s+|console\.log\(|;|\{|\}|\n|\r)/i;
          if (failedLocator && isUnsafeFragment.test(failedLocator)) {
            logger.error('❌ HEALING_ABORT: failedLocator contains unsafe fragments - aborting replacement');
            logger.error(`Failed locator value: ${failedLocator}`);
            throw new Error('HEALING_ABORT_INVALID_FAILED_LOCATOR');
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

            if (!failedLocator) {
              logger.error('❌ No failedLocator provided for replacement');
              console.error(`[HEALING] ERROR: failedLocator is empty or undefined`);
              throw new Error('HEALING_NO_FAILED_LOCATOR: failedLocator is empty or undefined');
            }

            // FIX: Normalize the selectors to handle both escaped and unescaped quotes
            const normalizedFailed = failedLocator.replace(/\\"/g, '"').trim();
            const normalizedHealed = healedLocator.replace(/\\"/g, '"').trim();

            // Helper to escape regex
            const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Targeted replacement: replace only the selector argument inside page.locator(...)
            const tryTargetedReplace = (content: string, oldSel: string, newSel: string) => {
              let count = 0;
              // Match both page.locator(...) and locator(...) with any quote style
              const pattern = /(\b(?:page\.locator|locator)\(\s*(['"`]))([\s\S]*?)\2(\s*\))/g;
              content = content.replace(pattern, (m: string, p1: string, quote: string, inner: string, p4: string) => {
                try { console.log('[HEALING] REPLACEMENT_CALLBACK_INPUT:', m.length > 800 ? m.substring(0,800) + '...' : m); } catch(e){}
                // inner is the selector string as it appears in the file (may contain escaped quotes)
                // Unescape simple backslash-escaped quotes so we can compare logically
                const unescapedInner = inner.replace(/\\(["'`])/g, '$1');
                // Normalize both for comparison
                const normInner = String(unescapedInner).trim();
                const normOld = String(oldSel).trim();

                // Diagnostic logging to help track mismatches and variants
                try {
                  console.log('[HEALING] tryTargetedReplace: match found ->', {
                    prefix: p1.slice(0, 80),
                    quote,
                    innerRawPreview: inner.length > 200 ? inner.substring(0, 200) + '...' : inner,
                    unescapedInnerPreview: unescapedInner.length > 200 ? unescapedInner.substring(0, 200) + '...' : unescapedInner,
                    normInner,
                    normOld,
                  });
                  // Additional explicit diagnostics requested
                  try { console.log('[HEALING] REPLACEMENT_NORM_INNER:', normInner); } catch(e){}
                  try { console.log('[HEALING] REPLACEMENT_OLDSEL:', normOld); } catch(e){}
                  try { console.log('[HEALING] REPLACEMENT_NEWSEL:', newSel); } catch(e){}
                } catch (e) {
                  // ignore logging errors
                }

                if (normInner === normOld) {
                  // Prepare replacement that respects the original quote style
                 // Build replacementInner directly from the healed selector.
// Do NOT attempt inner.replace(unescapedInner, ...) because inner contains
// escaped quotes while unescapedInner does not, causing replacement to fail.
let replacementInner: string;

try {
  const coreNew = String(newSel).replace(/^["'`]+|["'`]+$/g, '');

  // Preserve quote escaping style used inside locator strings
  replacementInner = coreNew.replace(
    new RegExp(quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    '\\' + quote
  );

  console.log('[HEALING] HEALING_REPLACEMENT_INNER_BEFORE:', inner);
  console.log('[HEALING] HEALING_REPLACEMENT_INNER_AFTER:', replacementInner);
} catch (e) {
  replacementInner = String(newSel);
}

// Build the generated snippet preserving original structure.
const prefix = p1.endsWith(quote) ? p1.slice(0, -1) : p1;


                  const generatedSnippet = prefix + quote + replacementInner + quote + p4;
                  // Diagnostics: original match, generated snippet
                  try {
                    console.log('[HEALING] HEALING_ORIGINAL_LINE:', m.length > 500 ? m.substring(0,500) + '...' : m);
                    console.log('[HEALING] HEALING_REPLACEMENT_GENERATED:', generatedSnippet.length > 500 ? generatedSnippet.substring(0,500) + '...' : generatedSnippet);
                    // Also log callback output for tracing
                    try { console.log('[HEALING] REPLACEMENT_CALLBACK_OUTPUT:', generatedSnippet.length > 800 ? generatedSnippet.substring(0,800) + '...' : generatedSnippet); } catch(e){}
                    console.log('[HEALING] tryTargetedReplace: candidate replacement', { normInner, newSel, quote });
                  } catch (e) {}

                  // Verify generatedSnippet actually contains the new selector (escaped or raw)
                  const coreNew = String(newSel).replace(/^['"`]+|['"`]+$/g, '');
                  const escapedCore = coreNew.replace(new RegExp(quote, 'g'), '\\' + quote);
                  const containsNew = generatedSnippet.includes(coreNew) || generatedSnippet.includes(escapedCore) || generatedSnippet.includes(newSel);
                  if (!containsNew) {
                    try { console.error('[HEALING] REPLACEMENT_MISSING_NEW_SELECTOR'); } catch(e){}
                    try { console.warn('[HEALING] Replacement generated but did NOT contain new selector - skipping'); } catch(e){}
                    try { console.log('[HEALING] REPLACEMENT_CONTAINS_NEW:', containsNew); } catch(e){}
                    try { console.log('[HEALING] REPLACEMENT_CALLBACK_RETURN:', m.length > 800 ? m.substring(0,800) + '...' : m); } catch(e){}
                    return m; // return original unchanged
                  }

                  // Only count as a replacement if the callback actually returns a modified string
                  // compared to the original match. Increment count AFTER verification.
                  if (generatedSnippet !== m) {
                    try { console.log('[HEALING] REPLACEMENT_CONTAINS_NEW:', containsNew); } catch(e){}
                    try { console.log('[HEALING] REPLACEMENT_CALLBACK_RETURN:', generatedSnippet.length > 800 ? generatedSnippet.substring(0,800) + '...' : generatedSnippet); } catch(e){}
                    count++;
                    return generatedSnippet;
                  }

                  try { console.log('[HEALING] REPLACEMENT_CALLBACK_RETURN:', m.length > 800 ? m.substring(0,800) + '...' : m); } catch(e){}
                  return m;
                }

                // If not matched, log for diagnostics
                try {
                  console.log('[HEALING] tryTargetedReplace: no match for this occurrence', { normInner, normOld });
                } catch (e) {}

                try { console.log('[HEALING] REPLACEMENT_CALLBACK_RETURN:', m.length > 800 ? m.substring(0,800) + '...' : m); } catch(e){}
                return m;
              });

              return { content, count };
            };

            // Attempt targeted replacement first
            // Unit-style validation: ensure replacement generation behaves as expected for a sample input
           const sampleIn = 'page.locator("[name=\\"asdfpassword\\"]")';
const sampleOut = tryTargetedReplace(
  sampleIn,
  '[name="asdfpassword"]',
  '[name="password"]'
);

const expectedOut = 'page.locator("[name=\\"password\\"]")';

console.log('[HEALING] UNIT_TEST_INPUT:', sampleIn);
console.log('[HEALING] UNIT_TEST_OUTPUT:', sampleOut.content);
console.log('[HEALING] UNIT_TEST_EXPECTED:', expectedOut);

const unitPassed =
  sampleOut.content.trim() === expectedOut.trim();

console.log('[HEALING] UNIT_TEST_PASSED:', unitPassed);

if (!unitPassed) {
  throw new Error(
    `UNIT_TEST_FAILED expected=${expectedOut} actual=${sampleOut.content}`
  );
}

            const targeted = tryTargetedReplace(healedContent, normalizedFailed, normalizedHealed);
            healedContent = targeted.content;
            replacementCount = targeted.count;

            console.log(`[HEALING] TARGETED_REPLACEMENTS_MADE: ${replacementCount}`);

            // TASK 4: Validate replacement success
            if (replacementCount === 0) {
              const errorMsg = 'HEALING_NO_REPLACEMENTS: Could not locate failed selector inside page.locator(...) or locator(...) in test file';
              logger.error(`❌ ${errorMsg}`);
              console.error(`[HEALING] ERROR: ${errorMsg}`);
              throw new Error(errorMsg);
            }

            // Extract the core value without quotes for validation
            const coreValue = normalizedFailed.replace(/[\[\]'"`=]/g, '');

            // DIAGNOSTICS: Prepare patterns we would check and report simple matches
            const checkPatterns = [
              normalizedFailed,
              normalizedFailed.replace(/"/g, '\\"'),
              `'${normalizedFailed}'`,
              `"${normalizedFailed}"`,
              `\`${normalizedFailed}\``,
            ];

            // Diagnostics & executable-context checks are performed after the healed file is read
            // (see later) to ensure `verifyContent` and helper functions are available.

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

            // TASK 3: Diagnostics - show preview before writing healed file
            try {
              console.log('[HEALING] HEALING_REPLACEMENT_BEFORE:', origContent.substring(0, 500));
            } catch (e) {}

            // Write healed temp file into pw-ai-agents/tests/ui/generated/scripts
            const tmpDir = join(pwAiAgentsDir, 'tests', 'ui', 'generated', 'scripts');
            const healedFileName = `temp-healed-${executionId}-${path.basename(testFile)}`;
            const healedPath = join(tmpDir, healedFileName);
            fs.writeFileSync(healedPath, healedContent, 'utf-8');
            logger.info(`📝 Healed test written: ${healedPath}`);

            // TASK 1: Read healed file and log preview
            const verifyContent = fs.readFileSync(healedPath, 'utf-8');
            try {
              console.log('[HEALING] HEALING_REPLACEMENT_AFTER:', verifyContent.substring(0, 500));
            } catch (e) {}

            try {
              console.log('[HEALING] HEALING_REPLACEMENT_FINAL:', verifyContent.substring(0, 500));
            } catch (e) {}

            // Final diagnostics: log final old/new selector and the healed snippet containing the replacement
            try {
              console.log('[HEALING] HEALING_FINAL_OLD_SELECTOR:', normalizedFailed);
              console.log('[HEALING] HEALING_FINAL_NEW_SELECTOR:', normalizedHealed);
              const idx = verifyContent.indexOf(normalizedHealed);
              if (idx >= 0) {
                const before = Math.max(0, idx - 80);
                const after = Math.min(verifyContent.length, idx + normalizedHealed.length + 80);
                console.log('[HEALING] HEALING_FINAL_REPLACEMENT_TEXT:', verifyContent.substring(before, after));
              } else {
                console.error('[HEALING] HEALING_FINAL_REPLACEMENT_TEXT: <new selector not found in file>');
              }
            } catch (e) {}

            // TASK 2: Validate healed file syntax using TypeScript parser via CodeValidator
            try {
              const validation = CodeValidator.validate(verifyContent);
              if (!validation.valid) {
                // Log parser errors with file, line, column where available
                console.error('[HEALING] HEALED_FILE_SYNTAX_ERROR: validation failed for healed file', healedPath);
                if (validation.errors && validation.errors.length > 0) {
                  for (const err of validation.errors) {
                    // Try to extract Line X:Y from CodeValidator errors
                    const m = String(err).match(/Line\s*(\d+):(\d+):?\s*(.*)/i);
                    if (m) {
                      const line = Number(m[1]);
                      const col = Number(m[2]);
                      const msg = m[3] || err;
                      console.error('[HEALING] HEALED_FILE_SYNTAX_ERROR_DETAIL', { file: healedPath, line, column: col, message: msg });
                      try { result.errors.push(`HEALED_FILE_SYNTAX_ERROR: ${healedPath}:${line}:${col}: ${msg}`); } catch(e){}
                    } else {
                      console.error('[HEALING] HEALED_FILE_SYNTAX_ERROR_DETAIL', { file: healedPath, message: String(err) });
                      try { result.errors.push(`HEALED_FILE_SYNTAX_ERROR: ${healedPath}: ${String(err)}`); } catch(e){}
                    }
                  }
                }
                // Mark execution with syntax error flag
                try { (result as any).healedFileSyntaxError = true; } catch (e) {}
                // Abort retry: treat as fatal for this deterministic attempt
                throw new Error('HEALED_FILE_SYNTAX_ERROR: ' + (validation.errors || []).join('; '));
              }
            } catch (valErr) {
              // Re-throw to ensure upstream treats this as a failed retry
              throw valErr;
            }
            console.log(`[HEALING] HEALED FILE CONTENT PREVIEW:`);
            console.log(verifyContent.substring(0, 500));
            console.log(`[HEALING] ...`);

            // TASK 4: Create utility function to check selector in file with all variants
            const selectorExistsInFile = (content: string, selector: string): boolean => {
              // Helper to escape regex special chars
              const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

              // Normalize selector by removing escape characters
              const normalized = selector.replace(/\\"/g, '"').trim();
              const escaped = escapeRegExp(normalized);

              // Build regexes that only match executable locator / getBy* usages
              const ctxRegexes: RegExp[] = [
                // page.locator('...') or locator("...") exact string match
                new RegExp(`\\b(?:page\\.locator|locator)\\(\\s*['\"\\\`]${escaped}['\"\\\`]\\s*\\)`, 'g'),
                // page.getByText('...') / getByText('...') / getByRole / getByLabel
                new RegExp(`\\b(?:page\\.getByText|getByText|page\\.getByRole|getByRole|page\\.getByLabel|getByLabel)\\(\\s*['\"\\\`]${escaped}['\"\\\`]\\s*\\)`, 'g'),
                // More permissive: any locator(...) call that contains the selector text
                new RegExp(`\\b(?:page\\.locator|locator)\\([\\s\\S]*${escaped}[\\s\\S]*\\)`, 'g'),
              ];

              for (const r of ctxRegexes) {
                if (r.test(content)) {
                  console.log(`[HEALING]   ✓ Found in executable context: ${r}`);
                  return true;
                }
              }

              // No executable-context match found
              return false;
            };

            // TASK 5: Log verification variants being checked
            console.log(`[HEALING] VERIFICATION VARIANTS:`);
            console.log(`[HEALING]   Variant A: ${normalizedHealed}`);
            console.log(`[HEALING]   Variant B: ${normalizedHealed.replace(/"/g, '\\"')}`);
            console.log(`[HEALING]   Variant C: locator("${normalizedHealed}")`);
            console.log(`[HEALING]   Variant D: locator('${normalizedHealed}')`);

            // Run diagnostics & check for old selector in executable contexts
            const simpleMatches = checkPatterns.filter(p => verifyContent.includes(p));
            console.log('[HEALING] VERIFY_SOURCE: healedContent');
            console.log('[HEALING] VERIFY_PATTERN:', checkPatterns.join(' | '));
            console.log('[HEALING] VERIFY_MATCH_FOUND (simple includes):', simpleMatches);
            console.log('[HEALING] VERIFY_USING_HEALED_CONTENT:', verifyContent === healedContent);

            let oldValueStillPresent = false;
            try {
              oldValueStillPresent = selectorExistsInFile(verifyContent, normalizedFailed);
              if (oldValueStillPresent) {
                console.warn(`[HEALING] WARNING: Old selector still present in executable code: "${normalizedFailed}"`);
              } else {
                console.log('[HEALING] Old selector only found in non-executable contexts (logs/comments/strings) or removed');
              }
            } catch (e) {
              console.warn('[HEALING] VERIFY CHECK FAILED', e instanceof Error ? e.message : String(e));
              // Fall back to a simple includes-based check if selectorExistsInFile errors
              oldValueStillPresent = checkPatterns.some(p => verifyContent.includes(p));
              if (oldValueStillPresent) console.warn(`[HEALING] WARNING: Old selector still present (fallback check): "${normalizedFailed}"`);
            }

            // TASK 6: Verify based on replacement success
            // If replacementCount > 0 AND old selector no longer exists, verification passes
            let verificationPassed = false;
            
            if (replacementCount > 0) {
              // Use the refined check result computed above
              if (!oldValueStillPresent) {
                verificationPassed = true;
                console.log(`[HEALING] ✓ Old selector successfully removed`);
              } else {
                console.log(`[HEALING] ⚠️  Old selector still present in file`);
              }
            } else {
              console.log(`[HEALING] ⚠️  No replacements were made (replacementCount = 0)`);
            }

            // Verify new selector exists (multi-format includes check against healedContent)
            let matchedPattern: string | null = null;
            try {
              console.log('VERIFY_NEW_SELECTOR_RAW:', normalizedHealed);
              console.log('VERIFY_HEALED_CONTENT_PREVIEW:', healedContent.substring(0, 1000));

              const verifyPatterns = [
                normalizedHealed,
                normalizedHealed.replace(/"/g, '\\"'),
                `'${normalizedHealed}'`,
                `"${normalizedHealed}"`,
                `\`${normalizedHealed}\``,
              ];
              console.log('VERIFY_PATTERNS:', verifyPatterns);
              for (const p of verifyPatterns) {
                if (healedContent.includes(p)) {
                  matchedPattern = p;
                  break;
                }
              }

              console.log('VERIFY_MATCHED_PATTERN:', matchedPattern);

              if (!matchedPattern) {
                const errorMsg = `HEALING_FILE_VERIFICATION_FAILED: New selector not found in healed file`;
                logger.error(errorMsg);
                console.error(`[HEALING] ERROR: ${errorMsg}`);
                console.error(`[HEALING] Searched for patterns: ${verifyPatterns.join(' | ')}`);
                throw new Error(errorMsg);
              }

              console.log(`[HEALING] ✓ New selector found in healed file (matched: ${matchedPattern})`);
            } catch (vErr) {
              throw vErr;
            }
            
            if (verificationPassed && matchedPattern) {
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
        // Prefer running the binary directly using an argv array to avoid shell parsing issues
        let commandBin: string | null = null;
        let commandArgs: string[] = [];
        // Prefer the local pw-ai-agents wrapper binary if present (ensures proper module context)
        try {
          const wrapperBin = path.join(pwAiAgentsDir, 'node_modules', '.bin', 'playwright');
          const explicitCliNow = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');
          logger.info('🛠️ pw-ai-agents dir:', pwAiAgentsDir);
          logger.info('🛠️ explicit pw-ai-agents CLI exists:', fs.existsSync(explicitCliNow));
          if (fs.existsSync(wrapperBin)) {
            commandBin = path.join(pwAiAgentsDir, 'node_modules', '.bin', 'playwright');
            commandArgs = ['test', `${chosenTestFileToRun}`, ...(shouldForceHeaded ? ['--headed'] : []), '--workers=1', '--reporter=list'];
            commandToRun = `${commandBin} ${commandArgs.join(' ')}`;
            logger.info('🛠️ Execution: Using pw-ai-agents local playwright wrapper binary');
          } else if (fs.existsSync(explicitCliNow)) {
            // Force using the pw-ai-agents CLI JS directly to guarantee correct module context
            commandBin = process.execPath;
            commandArgs = [explicitCliNow, 'test', `${chosenTestFileToRun}`, ...(shouldForceHeaded ? ['--headed'] : []), '--workers=1', '--reporter=list'];
            commandToRun = `${commandBin} ${commandArgs.join(' ')}`;
            logger.info(`🛠️ Execution: Forcing pw-ai-agents CLI: ${explicitCliNow}`);
          } else if (chosenCli) {
            commandBin = process.execPath;
            commandArgs = [chosenCli, 'test', `${chosenTestFileToRun}`, ...(shouldForceHeaded ? ['--headed'] : []), '--workers=1', '--reporter=list'];
            commandToRun = `${commandBin} ${commandArgs.join(' ')}`;
            logger.info(`🛠️ Execution: Will run Playwright via node + CLI: ${chosenCli}`);
          } else {
            commandBin = path.join(pwAiAgentsDir, 'node_modules', '.bin', 'playwright');
            commandArgs = ['test', `${chosenTestFileToRun}`, ...(shouldForceHeaded ? ['--headed'] : []), '--workers=1', '--reporter=list'];
            commandToRun = `${commandBin} ${commandArgs.join(' ')}`;
            logger.info('🛠️ Execution: Playwright CLI JS not found - falling back to ./node_modules/.bin/playwright');
          }
        } catch (e) {
          // fallback to chosenCli or generic wrapper
          if (chosenCli) {
            commandToRun = `${process.execPath} "${chosenCli}" test "${chosenTestFileToRun}" ${shouldForceHeaded ? '--headed' : ''} --workers=1 --reporter=list`;
            logger.info(`🛠️ Execution: Will run Playwright via node + CLI: ${chosenCli}`);
          } else {
            commandToRun = `./node_modules/.bin/playwright test "${chosenTestFileToRun}" ${shouldForceHeaded ? '--headed' : ''} --workers=1 --reporter=list`;
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

        // Run the Playwright binary directly (avoid shell parsing by passing argv array)
        const execCommand = commandBin || '/bin/bash';
        const execArgs = commandArgs.length > 0 ? commandArgs : ['-c', commandToRun];
        try { logger.info('PLAYWRIGHT_COMMAND', { commandToRun, execCommand, execArgs: execArgs.slice(0,20) }); } catch(e){}
        try { logger.info('EXECUTE_TEST_BEFORE_AWAIT', { execCommand, execArgs: execArgs.slice(0,10) }); } catch(e){}
        const result_output = await executeWithEarlyExit(execCommand, execArgs, {
          // Run from pw-ai-agents directory where playwright.config.ts exists
          cwd: pwAiAgentsDir,
          maxBuffer: 50 * 1024 * 1024,
          env: childEnv,
        });
        try { logger.info('EXECUTE_TEST_AFTER_AWAIT', { exitCode: (result_output as any).exitCode || null }); } catch(e){}

        logger.info(`🌐 Headed mode browser execution completed`);
        logger.debug(`📋 Command: ${commandToRun}`);
        logger.debug(`🖥️  Environment: HEADLESS=${childEnv.HEADLESS}, DISPLAY=${childEnv.DISPLAY || 'not set'}`);

        result.stdout = result_output.stdout;
        result.stderr = result_output.stderr;
        const childExitCode = (result_output as any).exitCode ?? 0;
        if (childExitCode !== 0) {
          logger.warn(`Playwright CLI exited with non-zero code: ${childExitCode}`);
          result.errors.push(`Playwright CLI exited with code ${childExitCode}`);
        }
        logger.debug(`Execution stdout: ${result.stdout?.substring(0, 200)}`);
        
        // Save output to report file for debugging
        if (result.stdout) {
          fs.writeFileSync(reportLogFile, `STDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr || 'none'}`);
        }

        // Parse JSON from file produced by Playwright JSON reporter
        console.log('BEFORE_REPORT_PARSE_55555');
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
        console.log('AFTER_REPORT_PARSE_55555');
        
        // Determine final status with stricter rules:
        // Distinguish between CLI/usage errors vs test failures:
        // - If exitCode !== 0 but tests ran (totalTests > 0) -> treat as 'failed' (tests failed)
        // - If exitCode !== 0 and no tests ran -> treat as 'error'
        // - If exitCode === 0 -> passed/failed based on failure counts
        const exitCode = (result_output as any).exitCode || 0;
        // Expose exitCode to callers for diagnostics
        (result as any).exitCode = exitCode;
        if (exitCode !== 0) {
          if (result.totalTests && result.totalTests > 0) {
            // Tests executed and exit code non-zero => failing tests
            result.status = result.failed === 0 ? 'passed' : 'failed';
          } else {
            // No tests executed and non-zero exit code => execution error
            result.errors.push('No tests were executed (0 total). Playwright likely printed usage or failed to run the spec.');
            result.status = 'error';
          }
        } else {
          // Normal zero exit code: decide based on parsed counts
          if (result.totalTests === 0) {
            result.errors.push('No tests were executed (0 total). Playwright likely printed usage or failed to run the spec.');
            result.status = 'error';
          } else {
            result.status = result.failed === 0 ? 'passed' : 'failed';
          }
        }
        
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

            // Attach exitCode if available on the temporary result_output
            try {
              // Some code paths set exitCode on the result earlier
              const ec = (result as any).exitCode || undefined;
              if (typeof ec !== 'undefined') {
                logger.debug('Execution exitCode available', { exitCode: ec });
              }
            } catch (e) {}

            // ----- DIAGNOSTIC: Log execution return details for tracing -----
            try {
              logger.info('AFTER_EXECUTION_RETURN', {
                id: result.id,
                status: result.status,
                failed: result.failed,
                totalTests: result.totalTests,
                exitCode: (result as any).exitCode || null,
                lastReachedLocator: (result as any).lastReachedLocator || null,
              });
            } catch (e) {
              logger.debug('AFTER_EXECUTION_RETURN logging failed', e instanceof Error ? e.message : String(e));
            }
          } catch (e) {
            logger.debug('Could not extract playwright error', e instanceof Error ? e.message : String(e));
          }
      } catch (error: any) {
        try { logger.info('EXECUTE_TEST_BEFORE_THROW', { location: 'executeTest.execution_try', message: error?.message || String(error) }); } catch(e){}
        try { logger.warn('BEFORE_THROW', { location: 'executeTest.execution_try', message: error?.message || String(error) }); } catch(e){}
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

        // If the error was due to healed file syntax, mark as 'failed' explicitly
        if (error?.message && String(error.message).includes('HEALED_FILE_SYNTAX_ERROR')) {
          result.status = 'failed';
          // Ensure exitCode reflects failure
          try { (result as any).exitCode = (result as any).exitCode || 1; } catch(e){}
        } else {
          result.status = result.failed > 0 ? 'failed' : 'error';
        }

        if (error?.killed) {
          result.errors.push('Test execution timeout (exceeded 2 minutes)');
          result.status = 'error';
        }

        // Clean up temp files
        if (fs.existsSync(reportLogFile)) fs.unlinkSync(reportLogFile);

        logger.warn(`⚠️ Execution: Test completed with status: ${result.status}`);
        try { logger.info('EXECUTE_TEST_AFTER_CATCH', { id: executionId, status: result.status, errors: result.errors ? result.errors.slice(0,5) : [] }); } catch(e){}
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
      try { logger.info('EXECUTE_TEST_FINALLY', { id: executionId, status: result.status, exitCode: (result as any).exitCode || null }); } catch(e){}
      logger.debug('✓ Execution: Test execution cleanup complete');
    }

    result.endTime = new Date();
    result.duration = result.endTime.getTime() - result.startTime.getTime();
    // Always attempt to extract last reached locator from outputs (even on error)
    try {
      const combinedOutput = String(result.stdout || '') + '\n' + String(result.stderr || '');
      // Prefer explicit Playwright waiting-for locator pattern
      const waitingMatch = combinedOutput.match(/waiting for\s+locator\s*\(\s*(["'`])([^\)]+?)\1\s*\)/i);
      if (waitingMatch && waitingMatch[2]) {
        (result as any).lastReachedLocator = waitingMatch[2].trim();
        logger.info('Execution: extracted lastReachedLocator from "waiting for locator(...)" pattern', (result as any).lastReachedLocator);
      } else {
        (result as any).lastReachedLocator = this.extractLastReachedLocator(combinedOutput);
        if ((result as any).lastReachedLocator) logger.info('Execution: extracted lastReachedLocator', (result as any).lastReachedLocator);
      }
    } catch (e) {
      logger.debug('Could not extract lastReachedLocator', e instanceof Error ? e.message : String(e));
    }

    logger.success(
      `✓ Execution: Completed in ${result.duration}ms (${result.passed} passed, ${result.failed} failed)`
    );

    try { logger.info('EXECUTE_TEST_BEFORE_RETURN', { location: 'executeTest.final_save', id: executionId, status: result.status, exitCode: (result as any).exitCode || null }); } catch(e){}
    try { logger.info('BEFORE_RETURN', { location: 'executeTest.final_save', id: executionId, status: result.status, exitCode: (result as any).exitCode || null }); } catch(e){}
    this.saveExecution(executionId, result);
    try { logger.info('EXECUTE_TEST_AFTER_RETURN', { location: 'executeTest.final_return', id: executionId, status: result.status, failed: result.failed, totalTests: result.totalTests, exitCode: (result as any).exitCode || null }); } catch(e){}
    try { logger.info('RETURN_REASON', { location: 'executeTest.final_return', id: executionId, status: result.status, failed: result.failed, totalTests: result.totalTests, exitCode: (result as any).exitCode || null }); } catch(e){}
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
    const re = /^\[HEALING LAB\] REACHED LOCATOR:\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    let last: string | null = null;
    while ((match = re.exec(clean)) !== null) {
      if (match[1]) {
      // Normalize by removing escape remnants and backslashes used in JSON quoting
      const candidateRaw = String(match[1]).replace(/\\/g, '').trim();
        // Sanitize: reject anything that looks like JS code or contains control characters
        const isUnsafe = /\b(await|console\.log|function|=>|return|new\s|\.|;|\{|\}|\(|\)\s*;)/i;
        const containsJsCall = /(\.click\(|\.fill\(|page\.locator\(|page\.|\.waitFor|\.goto\(|await\s+)/i;
        const hasNewline = /[\r\n]/.test(candidateRaw);
        // Candidate must not include obvious JS snippets or multiple statements
        if (hasNewline || isUnsafe.test(candidateRaw) || containsJsCall.test(candidateRaw)) {
          // Try to extract inner selector-like substring if present (e.g., locator('...'))
          const inside = candidateRaw.match(/locator\s*\(\s*(["'`])([^\)]+?)\1\s*\)/i) || candidateRaw.match(/\[([a-zA-Z0-9\-]+)=['\"]([^'\"]+)['\"]\]/i);
          if (inside) {
            // prefer attribute selector capture groups
            const attrCapture = candidateRaw.match(/\[([a-zA-Z0-9\-]+)=['\"]([^'\"]+)['\"]\]/i);
            if (attrCapture) {
              last = `[${attrCapture[1]}="${attrCapture[2]}"]`;
              // final sanity check
              if (!/^[\[\].#a-zA-Z0-9\-_\(\)\s"'=\/\:\\]+$/.test(last)) last = null;
            } else if (inside[2]) {
              last = inside[2].trim();
            } else {
              last = null;
            }
          } else {
            // skip unsafe candidate
            last = null;
          }
        } else {
          // Candidate looks safe-ish; final normalization
          last = candidateRaw.split(/\r?\n/)[0].trim();
        }
        // Additional final filter: must look like a selector
        if (last) {
          const looksLikeSelector = /^(?:\[.+\]|\.[\w\-\.]+|#[\w\-]+|getBy\w+\(.+\)|locator\(.+\)|[a-zA-Z0-9_\-"'`\[\]=:\/\\\.\s]+)$/i;
          if (!looksLikeSelector.test(last)) {
            // reject and continue searching
            last = null;
          }
        }
      } else last = null;
    }
    return last;
  }

  /**
   * Get execution result
   */
  getExecution(id: string): ExecutionResult | undefined {
    const inMem = this.store.get(id);
    if (inMem) return inMem;

    // Fallback: try to read persistent dump on disk to recover executions
    try {
      const dumpPath = '/tmp/executions_store_dump.json';
      if (fs.existsSync(dumpPath)) {
        const dumpRaw = fs.readFileSync(dumpPath, 'utf-8') || '{}';
        const dump = JSON.parse(dumpRaw || '{}');
        const d = dump[id];
        if (d) {
          const reconstructed: ExecutionResult = {
            id: d.id,
            testFile: d.testFile || 'unknown',
            status: (d.status as any) || 'running',
            startTime: d.startTime ? new Date(d.startTime) : new Date(),
            endTime: d.endTime ? new Date(d.endTime) : undefined,
            duration: d.duration,
            passed: d.passed || 0,
            failed: d.failed || 0,
            skipped: d.skipped || 0,
            totalTests: d.totalTests || 0,
            stdout: d.stdout || '',
            stderr: d.stderr || '',
            errors: d.errors || [],
          };
          // Seed into in-memory store for subsequent requests
          this.store.store(id, reconstructed);
          logger.info(`Execution: Recovered execution ${id} from disk fallback`);
          return reconstructed;
        }
      }
    } catch (e) {
      logger.debug('Could not read executions dump for fallback', e instanceof Error ? e.message : String(e));
    }

    return undefined;
  }

  /**
   * List all executions
   */
  listExecutions(): ExecutionResult[] {
    const list = this.store.list();
    if (list && list.length > 0) return list;

    // Fallback: read /tmp/executions_store_dump.json and return reconstructed list
    try {
      const dumpPath = '/tmp/executions_store_dump.json';
      if (fs.existsSync(dumpPath)) {
        const dumpRaw = fs.readFileSync(dumpPath, 'utf-8') || '{}';
        const dump = JSON.parse(dumpRaw || '{}');
        const arr: ExecutionResult[] = Object.keys(dump).map((k) => {
          const d = dump[k];
          return {
            id: d.id,
            testFile: d.testFile || 'unknown',
            status: (d.status as any) || 'running',
            startTime: d.startTime ? new Date(d.startTime) : new Date(),
            endTime: d.endTime ? new Date(d.endTime) : undefined,
            duration: d.duration,
            passed: d.passed || 0,
            failed: d.failed || 0,
            skipped: d.skipped || 0,
            totalTests: d.totalTests || 0,
            stdout: d.stdout || '',
            stderr: d.stderr || '',
            errors: d.errors || [],
          } as ExecutionResult;
        });
        // Sort by startTime desc
        arr.sort((a, b) => (b.startTime?.getTime() || 0) - (a.startTime?.getTime() || 0));
        // Seed into memory for faster subsequent calls
        arr.forEach((e) => this.store.store(e.id, e));
        logger.info(`Execution: Recovered ${arr.length} executions from disk fallback`);
        return arr;
      }
    } catch (e) {
      logger.debug('Could not read executions dump for list fallback', e instanceof Error ? e.message : String(e));
    }

    return [];
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
    try {
      logger.info(`Execution: Saved result for ID: ${id} (testFile=${result.testFile}, status=${result.status})`);
      // Additionally write a persistent dump to /tmp for debugging across processes
      try {
        const dumpPath = '/tmp/executions_store_dump.json';
        let dump: any = {};
        try {
          if (fs.existsSync(dumpPath)) {
            dump = JSON.parse(fs.readFileSync(dumpPath, 'utf-8') || '{}');
          }
        } catch (e) {
          dump = {};
        }
        dump[id] = {
          id,
          testFile: result.testFile,
          status: result.status,
          startTime: result.startTime?.toString(),
          endTime: result.endTime?.toString(),
          duration: result.duration,
        };
        fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
      } catch (e) {
        logger.debug('Could not write executions dump to /tmp', e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      logger.error('Failed logging execution save', e instanceof Error ? e.message : String(e));
    }
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
