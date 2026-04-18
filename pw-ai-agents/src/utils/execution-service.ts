/**
 * Execution Service - Manages test execution and tracking
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { ExecutionResult } from '../types';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const execPromise = promisify(exec);

interface ExecutionState {
  status: 'running' | 'passed' | 'failed' | 'error';
  logs: string[];
  passed: number;
  failed: number;
  skipped: number;
  error?: string;
  reportUrl?: string;
}

// Store executions in memory (in production, use a database)
const executions = new Map<string, ExecutionState>();

export class ExecutionService {
  /**
   * Execute a test file
   */
  static async executeTest(
    fileName: string,
    browsers?: string[]
  ): Promise<ExecutionResult> {
    const executionId = this.generateExecutionId();
    const testPath = path.join(
      __dirname,
      '../../tests/ui/generated/scripts',
      fileName
    );

    logger.section(`Executing test: ${fileName}`);
    logger.info(`Test path: ${testPath}`);

    // Check if file exists
    if (!fs.existsSync(testPath)) {
      logger.error(`Test file not found: ${testPath}`);
      const error: ExecutionState = {
        status: 'error',
        logs: [`[ERROR] Test file not found: ${fileName}`],
        passed: 0,
        failed: 0,
        skipped: 0,
        error: `File not found: ${fileName}`,
      };
      executions.set(executionId, error);
      return this.buildResult(executionId, fileName, error);
    }

    // Initialize execution state
    const state: ExecutionState = {
      status: 'running',
      logs: [
        `[INFO] Starting execution of ${fileName}`,
        `[INFO] Execution ID: ${executionId}`,
      ],
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    executions.set(executionId, state);

    // Run test asynchronously and update state
    this.runTest(fileName, executionId, testPath, browsers, state).catch(
      (error) => {
        logger.error('Test execution error', error);
        state.status = 'error';
        state.error = error instanceof Error ? error.message : 'Unknown error';
        state.logs.push(
          `[ERROR] Execution failed: ${state.error}`
        );
      }
    );

    // Return initial response
    return this.buildResult(executionId, fileName, state);
  }

  /**
   * Run test in background
   */
  private static async runTest(
    fileName: string,
    executionId: string,
    testPath: string,
    browsers: string[] | undefined,
    state: ExecutionState
  ): Promise<void> {
    // Build playwright command
    let command = `npx playwright test "${testPath}"`;
    
    if (browsers && browsers.length > 0) {
      command += ` --project=${browsers.join(',')};`;
    }

    // Generate both JSON (for parsing results) and HTML (for report viewing)
    command += ' --reporter=json --reporter=html';

    logger.debug(`Executing command: ${command}`);
    state.logs.push(`[INFO] Command: ${command}`);

    const workspaceRoot = path.join(__dirname, '../..');
    logger.info(`Working directory: ${workspaceRoot}`);
    state.logs.push(`[INFO] Working directory: ${workspaceRoot}`);

    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 300000, // 5 minutes timeout
        shell: '/bin/bash',
      });

      // If we reach here, command succeeded (exit code 0)
      const output = stdout + (stderr ? `\n${stderr}` : '');
      logger.debug('Test output (success path)', output.substring(0, 300));
      
      state.logs.push(`[INFO] Command succeeded with output`);
      this.parseTestOutput(output, state);

      // Set report URL - Playwright generates HTML report at playwright-report/index.html
      state.reportUrl = `/api/report/${executionId}`;
      logger.debug(`Report URL set to: ${state.reportUrl}`);

      // Determine final status
      if (state.failed > 0) {
        state.status = 'failed';
      } else if (state.passed > 0) {
        state.status = 'passed';
      } else {
        state.status = 'passed'; // Default to passed if no test count found
      }

      logger.success('Test execution completed', {
        passed: state.passed,
        failed: state.failed,
        skipped: state.skipped,
      });

      state.logs.push(
        `[INFO] Test completed - Passed: ${state.passed}, Failed: ${state.failed}, Skipped: ${state.skipped}`
      );
      state.logs.push(`[INFO] Report URL: ${state.reportUrl}`);

      // Forward final execution result to main backend for central persistence
      try {
        const result = this.buildResult(executionId, fileName, state);
        await this.forwardExecutionResult(result);
        logger.info('Forwarded execution result to main backend', { executionId });
      } catch (err) {
        logger.warn('Failed to forward execution result', err instanceof Error ? err.message : err);
      }
    } catch (error) {
      // Command exited with non-zero code
      // This could be test failures OR actual execution error
      let stdout = '';
      let stderr = '';

      if (error instanceof Error && 'stdout' in error) {
        stdout = (error as any).stdout || '';
        stderr = (error as any).stderr || '';
      }

      const output = stdout + (stderr ? `\n${stderr}` : '');
      logger.warn('Test execution exited with error', {
        message: error instanceof Error ? error.message : String(error),
        hasOutput: output.length > 0,
      });

      state.logs.push(`[WARN] Command exited with non-zero code`);
      state.logs.push(`[OUTPUT] ${output}`);

      // Set report URL even for failed tests - Playwright still generates report
      state.reportUrl = `/api/report/${executionId}`;
      logger.debug(`Report URL set to: ${state.reportUrl}`);

      // Try to parse output to see if it contains test results
      if (output.length > 0) {
        this.parseTestOutput(output, state);

        // If we found test results in the output, it's a test failure, not an execution error
        if (state.passed > 0 || state.failed > 0) {
          logger.info('Parsed test results from error output', {
            passed: state.passed,
            failed: state.failed,
          });

          // Determine status based on parsed results
          if (state.failed > 0) {
            state.status = 'failed';
          } else if (state.passed > 0) {
            state.status = 'passed';
          } else {
            state.status = 'failed'; // Since exit code was non-zero
          }

          state.logs.push(
            `[INFO] Test completed - Passed: ${state.passed}, Failed: ${state.failed}, Skipped: ${state.skipped}`
          );

          logger.success('Identified test failure via output parsing', {
            status: state.status,
            passed: state.passed,
            failed: state.failed,
          });
        } else {
          // No test results found - likely a true execution error
          state.status = 'error';
          state.error = error instanceof Error ? error.message : 'Unknown error';
          state.logs.push(
            `[ERROR] Failed to parse test results. Exit error: ${state.error}`
          );

          logger.error('No test results found in output, treating as execution error');
        }
      } else {
        // No output at all - execution crashed
        state.status = 'error';
        state.error = error instanceof Error ? error.message : 'Unknown error';
        state.logs.push(`[ERROR] Command failed with no output: ${state.error}`);

        logger.error('Execution crashed with no output', state.error);
      }

      // Forward result (whether test failure or execution error)
      try {
        const result = this.buildResult(executionId, fileName, state);
        await this.forwardExecutionResult(result);
        logger.info('Forwarded execution result to main backend', { executionId, status: state.status });
      } catch (err) {
        logger.warn('Failed to forward execution result', err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Parse test output to extract results
   * Handles both text and JSON reporter formats
   */
  private static parseTestOutput(output: string, state: ExecutionState): void {
    // First, try to parse as JSON (if --reporter=json was used)
    try {
      // Look for JSON output in the text
      const jsonMatch = output.match(/\{[\s\S]*"stats"[\s\S]*\}/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[0]);
        if (jsonData.stats) {
          state.passed = jsonData.stats.expected || 0;
          state.failed = jsonData.stats.unexpected || 0;
          state.skipped = jsonData.stats.skipped || 0;
          logger.debug('Parsed JSON reporter output', jsonData.stats);
          return;
        }
      }
    } catch (e) {
      // JSON parse failed, fall through to text parsing
      logger.debug('JSON parsing failed, trying text parsing');
    }

    // Fall back to text parsing
    const lines = output.split('\n');

    lines.forEach((line) => {
      // Log all lines
      if (line.trim()) {
        state.logs.push(`[OUTPUT] ${line}`);
      }

      // Count passed tests - look for patterns like "1 passed" or "1 passed in 2.5s"
      if (line.includes('passed')) {
        const match = line.match(/(\d+)\s+passed/);
        if (match && state.passed === 0) {
          state.passed = parseInt(match[1], 10);
        }
      }

      // Count failed tests - look for patterns like "1 failed" or "1 failed in 2.5s"
      if (line.includes('failed')) {
        const match = line.match(/(\d+)\s+failed/);
        if (match && state.failed === 0) {
          state.failed = parseInt(match[1], 10);
        }
      }

      // Count skipped tests
      if (line.includes('skipped')) {
        const match = line.match(/(\d+)\s+skipped/);
        if (match && state.skipped === 0) {
          state.skipped = parseInt(match[1], 10);
        }
      }

      // Detect report URL
      if (line.includes('test report') || line.includes('report')) {
        const urlMatch = line.match(/(https?:\/\/[^\s]+|file:\/\/[^\s]+)/);
        if (urlMatch) {
          state.reportUrl = urlMatch[1];
        }
      }

      // Track if test ran successfully (presence of test output)
      if (line.includes('✓') || line.includes('✔') || line.includes('×') || line.includes('✘')) {
        // Test results were found
        if (state.passed === 0 && state.failed === 0 && state.skipped === 0) {
          state.passed = 1; // At least one test ran
        }
      }
    });
  }

  /**
   * Get execution result
   */
  static getExecutionResult(executionId: string): ExecutionResult | null {
    const state = executions.get(executionId);
    if (!state) {
      return null;
    }

    // Return result (this would normally come from the state)
    return {
      executionId,
      fileName: 'unknown', // We don't store fileName, so we'll use a placeholder
      status: state.status,
      passed: state.passed,
      failed: state.failed,
      skipped: state.skipped,
      total: state.passed + state.failed + state.skipped,
      logs: state.logs,
      error: state.error,
      reportUrl: state.reportUrl,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get execution logs
   */
  static getExecutionLogs(executionId: string): string[] {
    const state = executions.get(executionId);
    return state ? state.logs : [];
  }

  /**
   * Build execution result
   */
  private static buildResult(
    executionId: string,
    fileName: string,
    state: ExecutionState
  ): ExecutionResult {
    return {
      executionId,
      fileName,
      status: state.status,
      passed: state.passed,
      failed: state.failed,
      skipped: state.skipped,
      total: state.passed + state.failed + state.skipped,
      logs: state.logs,
      error: state.error,
      reportUrl: state.reportUrl,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Forward execution result to main backend for central persistence.
   */
  private static async forwardExecutionResult(result: ExecutionResult): Promise<void> {
    const backendUrl = process.env.MAIN_BACKEND_EXECUTIONS_URL || 'http://localhost:3000/api/executions';
    try {
      await axios.post(backendUrl, result, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
    } catch (err) {
      // Rethrow to allow caller to log
      throw err;
    }
  }

  /**
   * Generate unique execution ID
   */
  private static generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
