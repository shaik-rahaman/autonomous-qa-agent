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
import { chromium, Browser, Page } from 'playwright';

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

  constructor(projectRoot?: string) {
    if (projectRoot) {
      this.projectRoot = projectRoot;
    }
    // Path to generated test scripts: pw-ai-agents/tests/ui/generated/scripts
    this.testFilesPath = join(this.projectRoot, '..', 'pw-ai-agents', 'tests', 'ui', 'generated', 'scripts');
    logger.info(`🎯 Execution: Test files path: ${this.testFilesPath}`);
  }

  /**
   * Execute a test file using Playwright with Chrome browser
   */
  async executeTest(testFile: string, options?: { overrideSelector?: string }): Promise<ExecutionResult> {
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
      // Verify test file exists and optionally prepare patched test when override provided
      const testPath = join(this.testFilesPath, testFile);
      if (!fs.existsSync(testPath)) {
        throw new Error(`Test file not found: ${testPath}`);
      }

      logger.info(`📂 Execution: Found test file: ${testPath}`);

      // Handle optional override: use runtime-injection to avoid writing patched files
      // We'll instruct the child Node process to require a small injector module
      // (backend/dist/execution/runtime-injector.js) via NODE_OPTIONS and provide
      // a mapping in PW_OVERRIDE_MAP so the injector can replace selectors when
      // the test file is loaded.
      let useRuntimeInject = false;
      let childEnvOverrides: NodeJS.ProcessEnv | undefined = undefined;
      if (options?.overrideSelector) {
        try {
          useRuntimeInject = true;
        } catch (err) {
          logger.warn('🔧 Execution: Failed to prepare runtime injection', err as any);
          useRuntimeInject = false;
        }
      }

      // Note: Do not launch a browser here - npx playwright test will launch its own browsers
      // This was causing multiple browser windows to open
      logger.info(`🎭 Execution: Playwright will launch its own browser instances for testing`);

      // Execute test file using Playwright CLI from pw-ai-agents directory (where playwright.config.ts exists)
      const tempReportDir = join(this.projectRoot, '.report-temp');
      if (!fs.existsSync(tempReportDir)) fs.mkdirSync(tempReportDir, { recursive: true });
      
      const reportJsonFile = join(tempReportDir, `report-${executionId}.json`);
      
      // Path to pw-ai-agents directory
      const pwAiAgentsDir = join(this.projectRoot, '..', 'pw-ai-agents');

      // Relative path from pw-ai-agents to the test file (no disk patching)
      const chosenTestFile = testFile;
      const relativeTestPath = join('tests', 'ui', 'generated', 'scripts', chosenTestFile);

      // Use multiple reporters: HTML for visual report, JSON for data, list for console output
      const command = `npx playwright test "${relativeTestPath}" --reporter=html --reporter=json --reporter=list 2>&1 | tee "${reportJsonFile}.log"`;

      logger.info(`📝 Execution: Running Playwright test from pw-ai-agents: ${relativeTestPath}`);

      // Ensure Playwright browsers are installed to avoid interactive prompts during npx execution
      try {
        logger.info('🔧 Ensuring Playwright browsers are installed');
        await execAsync('npx playwright install --with-deps', {
          cwd: pwAiAgentsDir,
          maxBuffer: 50 * 1024 * 1024,
          timeout: 120000,
          env: { ...process.env },
        });
        logger.info('🔧 Playwright browsers installed');
      } catch (installErr) {
        logger.warn('Could not auto-install Playwright browsers', installErr);
      }

      try {
        // Prepare child environment. If runtime injection is requested, set
        // NODE_OPTIONS to require the runtime injector and provide PW_OVERRIDE_MAP.
        let childEnv = { ...process.env, PWDEBUG: '0' } as NodeJS.ProcessEnv;
        if (useRuntimeInject && options?.overrideSelector) {
          try {
            const injectorPath = path.resolve(this.projectRoot, 'dist', 'execution', 'runtime-injector.js');
            const overrideKey = join('tests', 'ui', 'generated', 'scripts', chosenTestFile).split(path.sep).join('/');
            const map = { [overrideKey]: options.overrideSelector, [path.basename(chosenTestFile)]: options.overrideSelector };
            childEnv = {
              ...childEnv,
              PW_OVERRIDE_MAP: JSON.stringify(map),
              NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${injectorPath}`.trim(),
            };
            logger.info(`🔁 Execution: Using runtime injection for ${chosenTestFile}`);
          } catch (e) {
            logger.warn('🔁 Execution: Failed to configure runtime injector', e as any);
          }
        }

        const result_output = await execAsync(command, {
          // Run from pw-ai-agents directory where playwright.config.ts exists
          cwd: pwAiAgentsDir,
          maxBuffer: 50 * 1024 * 1024,
          timeout: 120000,
          env: childEnv,
          shell: '/bin/bash',
        });

        result.stdout = result_output.stdout;
        result.stderr = result_output.stderr;
        logger.debug(`Execution stdout: ${result.stdout?.substring(0, 200)}`);

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
        if (fs.existsSync(`${reportJsonFile}.log`)) fs.unlinkSync(`${reportJsonFile}.log`);
        
        logger.success(
          `✓ Execution: Test completed (${result.passed} passed, ${result.failed} failed)`
        );
      } catch (error: any) {
        result.stdout = error.stdout || '';
        result.stderr = error.stderr || '';

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
        if (fs.existsSync(`${reportJsonFile}.log`)) fs.unlinkSync(`${reportJsonFile}.log`);

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
   * Execute and stream results (for long-running tests)
   * This can be used with WebSockets for real-time updates
   */
  async executeTestAndCapture(testFile: string): Promise<ExecutionResult> {
    return this.executeTest(testFile);
  }
}

// Export singleton instance
export const executorService = new ExecutorService((process.cwd?.()) || '.');
