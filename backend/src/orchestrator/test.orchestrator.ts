/**
 * Test Orchestrator
 * Orchestrates test execution with self-healing support
 * 
 * Flow:
 * 1. Execute test
 * 2. If passed → return result
 * 3. If failed → analyze error
 * 4. If selector error → call healFailure to get alternative selector
 * 5. Retry once with new selector
 * 6. Return final result with healed status
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { ExecutorService, ExecutionResult } from '../execution/executor-service';
import { healFailure, HealFailureInput, HealFailureOutput } from '../agents/self-healing';
import { saveSelectorFix, findSelectorFix } from '../self-healing/selector-store';
import { runWithLangChain } from './langchain.orchestrator';

export interface TimelineEvent {
  stage: 'run' | 'fail' | 'heal' | 'retry' | 'success';
  timestamp: number;
  message: string;
}

export interface OrchestrationResult extends ExecutionResult {
  healed: boolean;
  retryCount: number;
  failureReason?: string;
  timeline: TimelineEvent[];
  reused?: boolean;
  healingDetails?: {
    originalError: string;
    originalSelector: string;
    newSelector: string;
    retryStatus: string;
  };
}

export class TestOrchestrator {
  private executorService: ExecutorService;
  private testFilesPath: string;
  private projectRoot: string;
  private maxRetries = 1; // Only one retry

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || '.';
    this.testFilesPath = path.join(this.projectRoot, '..', 'pw-ai-agents', 'tests', 'ui', 'generated', 'scripts');
    this.executorService = new ExecutorService(projectRoot);
  }

  /**
   * Execute test with self-healing support using LangChain
   */
  async executeTestWithHealing(testFile: string, targetUrl?: string): Promise<OrchestrationResult> {
    logger.section(`🎯 Test Orchestration: ${testFile}`);

    const timeline: TimelineEvent[] = [];
    const startTime = Date.now();

    // Timeline: Test execution started
    timeline.push({
      stage: 'run',
      timestamp: startTime,
      message: 'Test execution started with LangChain orchestrator',
    });

    try {
      // Use LangChain orchestrator for decision-making
      const langchainResult = await runWithLangChain({
        testFile,
        targetUrl,
        projectRoot: this.projectRoot,
      });

      const passed = langchainResult.passed || langchainResult.status === 'passed';
      const healed = langchainResult.healed || false;
      const reused = langchainResult.reused || false;

      // Add final timeline event
      if (passed) {
        timeline.push({
          stage: 'success',
          timestamp: Date.now(),
          message: reused ? 'Test passed with reused fix' : 'Test passed',
        });
      } else {
        timeline.push({
          stage: 'fail',
          timestamp: Date.now(),
          message: 'Test failed',
        });
      }

      // Return orchestration result
      return {
        ...langchainResult,
        healed,
        reused,
        retryCount: healed ? 2 : 1,
        timeline,
      };
    } catch (error) {
      logger.error(`❌ Orchestration failed: ${error}`);

      timeline.push({
        stage: 'fail',
        timestamp: Date.now(),
        message: `Orchestration error: ${error}`,
      });

      return {
        id: `error-${Date.now()}`,
        testFile,
        status: 'error',
        startTime: new Date(startTime),
        endTime: new Date(),
        duration: Date.now() - startTime,
        passed: 0,
        failed: 1,
        skipped: 0,
        totalTests: 1,
        stdout: '',
        stderr: String(error),
        errors: [String(error)],
        healed: false,
        reused: false,
        retryCount: 1,
        timeline,
      };
    }
  }

  /**
   * Check if error is related to selector/locator
   */
  private isSelectorError(error: string): boolean {
    const selectorIndicators = [
      'locator not found',
      'failed to find element',
      'element does not exist',
      'querySelector returned null',
      'unable to find element',
      'not visible',
      'detached from dom',
      'stale element',
    ];

    return selectorIndicators.some(indicator => 
      error.toLowerCase().includes(indicator)
    );
  }

  /**
   * Extract failed selector from test file and error message
   */
  private extractFailedSelector(testFile: string, error: string): string | undefined {
    try {
      const testPath = path.join(this.testFilesPath, testFile);
      const content = fs.readFileSync(testPath, 'utf-8');

      // Try to extract selector from error message
      const selectorMatch = error.match(/(?:locator|selector)[\s:=]*['""`]([^'""`]+)['""`]/i);
      if (selectorMatch) {
        return selectorMatch[1];
      }

      // If error mentions specific text, search for it in the test
      const textMatch = error.match(/text[\s:=]*['""`]([^'""`]+)['""`]/i);
      if (textMatch) {
        const text = textMatch[1];
        // Try to find selector in test that contains this text
        const pattern = new RegExp(`getByText\\(['"]${text}['"]\\)|text=['"]${text}['"]`);
        const match = content.match(pattern);
        if (match) {
          return text;
        }
      }

      return undefined;
    } catch (e) {
      logger.error(`Failed to extract selector: ${e}`);
      return undefined;
    }
  }

  /**
   * Replace old selector with new one in test content
   */
  private replaceSelector(content: string, oldSelector: string, newSelector: string): string {
    // Escape special regex characters in oldSelector
    const escapedOld = oldSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace in locator calls
    let modified = content.replace(
      new RegExp(`page\\.locator\\(['"]${escapedOld}['"]\\)`, 'g'),
      `page.locator('${newSelector}')`
    );

    // Replace in getByText calls
    modified = modified.replace(
      new RegExp(`page\\.getByText\\(['"]${escapedOld}['"]\\)`, 'g'),
      `page.getByText('${newSelector}')`
    );

    // Replace in waitForSelector calls
    modified = modified.replace(
      new RegExp(`page\\.waitForSelector\\(['"]${escapedOld}['"]\\)`, 'g'),
      `page.waitForSelector('${newSelector}')`
    );

    // Replace in $ calls
    modified = modified.replace(
      new RegExp(`page\\.\\$\\(['"]${escapedOld}['"]\\)`, 'g'),
      `page.$('${newSelector}')`
    );

    return modified;
  }

  /**
   * Attempt to heal the failure
   */
  private async attemptHealing(
    input: HealFailureInput,
    testFile: string,
    selector: string
  ): Promise<HealFailureOutput> {
    try {
      logger.info(`🏥 Calling self-healing agent...`);
      const result = await healFailure(input);
      logger.info(`Self-healing result: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      logger.error(`Self-healing failed: ${error}`);
      return {
        fixed: false,
        reason: `Self-healing error: ${error}`,
      };
    }
  }
}

export { ExecutionResult };
