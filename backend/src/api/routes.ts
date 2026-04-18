/**
 * Routes for Test Generation API
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { GenerateTestRequest, GenerateTestResponse } from '../types';
import { AgentExecutor } from '../agent/executor';
import { FileManager } from '../utils/file-manager';
import { executorService } from '../execution/executor-service';
import { TestOrchestrator } from '../orchestrator/test.orchestrator';

const router = Router();
const testOrchestrator = new TestOrchestrator();

/**
 * POST /generate-test
 * Generate Playwright test from English description (with Gherkin intermediate)
 */
router.post('/generate-test', async (req: Request, res: Response) => {
  try {
    logger.section('POST /generate-test');

    const { testSteps, url, context } = req.body as GenerateTestRequest;

    // Validate request
    if (!testSteps || !url) {
      logger.warn('Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: testSteps, url',
      });
    }

    logger.info('Request received', {
      testSteps: testSteps.substring(0, 50),
      url,
    });

    // Execute agent with Gherkin generation
    const agent = new AgentExecutor(testSteps, url);
    
    logger.info('Starting test generation...');
    const result = await agent.executeWithGherkin();

    // Verify result has content
    logger.info('✓ Generation succeeded', {
      hasGherkin: !!result.gherkin,
      gherkinLength: result.gherkin?.length || 0,
      hasCode: !!result.code,
      codeLength: result.code?.length || 0,
    });

    // Generate meaningful file name from test steps based on unique keywords
    const fileName = generateFileName(testSteps);

    // Save Gherkin file (will overwrite if exists)
    const gherkinFileResult = FileManager.saveGherkinFile(fileName, result.gherkin);

    // Save test script file (will overwrite if exists) - Returns the VALIDATED code that was saved
    const scriptFileResult = FileManager.saveTestScript(fileName, result.code, testSteps, url);

    logger.success('Test generation completed', scriptFileResult.fileName);

    const response: GenerateTestResponse = {
      fileName: scriptFileResult.fileName,
      code: scriptFileResult.code, // Use the validated code from FileManager, not the original
      gherkin: result.gherkin,
      timestamp: scriptFileResult.timestamp,
      version: 1,
      files: {
        gherkinPath: gherkinFileResult.filePath,
        scriptPath: scriptFileResult.scriptPath,
      },
    };

    logger.info('📤 Sending response to client', {
      hasGherkin: !!response.gherkin,
      gherkinLength: response.gherkin?.length || 0,
      hasCode: !!response.code,
      codeLength: response.code?.length || 0,
      fileName: response.fileName,
    });

    res.json(response);
  } catch (error) {
    logger.error('Failed to generate test', error);
    res.status(500).json({
      error: 'Failed to generate test',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /tests
 * List all generated tests
 */
router.get('/tests', (req: Request, res: Response) => {
  try {
    const tests = FileManager.listGeneratedTests();
    logger.info('Listed generated tests', `${tests.length} tests found`);

    res.json({
      count: tests.length,
      tests: tests.map((t) => ({
        fileName: t.metadata.fileName,
        version: t.metadata.version,
        timestamp: t.metadata.timestamp,
        url: t.metadata.url,
      })),
    });
  } catch (error) {
    logger.error('Failed to list tests', error);
    res.status(500).json({ error: 'Failed to list tests' });
  }
});

/**
 * GET /tests/:fileName
 * Get specific test file
 */
router.get('/tests/:fileName', (req: Request, res: Response) => {
  try {
    const { fileName } = req.params;
    const fileVersion = FileManager.getTestFile(fileName);

    if (!fileVersion) {
      return res.status(404).json({ error: 'Test file not found' });
    }

    logger.info('Retrieved test file', fileName);

    res.json({
      fileName: fileVersion.metadata.fileName,
      version: fileVersion.metadata.version,
      timestamp: fileVersion.metadata.timestamp,
      url: fileVersion.metadata.url,
      code: fileVersion.code,
    });
  } catch (error) {
    logger.error('Failed to retrieve test', error);
    res.status(500).json({ error: 'Failed to retrieve test' });
  }
});

/**
 * POST /execute
 * Execute a generated test file with self-healing support
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    logger.section('POST /execute');

    const { fileName, url } = req.body;

    if (!fileName) {
      logger.warn('Missing fileName in request');
      return res.status(400).json({
        error: 'Missing required field: fileName',
      });
    }

    logger.info('Execution requested for', fileName);

    // Execute the test with self-healing support
    const result = await testOrchestrator.executeTestWithHealing(fileName, url);

    // Store the result in executorService so it can be retrieved later via GET /api/execution/:id
    executorService.saveExecution(result.id, result);

    logger.success('Test execution completed', {
      id: result.id,
      testFile: result.testFile,
      status: result.status,
      healed: result.healed,
      retryCount: result.retryCount,
    });

    // Construct report URL
    const reportUrl = `/report/${result.id}`;

    // Return execution result with healing information
    res.json({
      id: result.id,
      testFile: result.testFile,
      status: result.status,
      duration: result.duration,
      healed: result.healed,
      reused: result.reused,
      retryCount: result.retryCount,
      timeline: result.timeline,
      results: {
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.totalTests,
      },
      errors: result.errors,
      reportUrl,
      healingDetails: result.healingDetails,
      message: `Test execution completed. Status: ${result.status}${result.healed ? ' (with self-healing)' : ''}${result.reused ? ' (reused fix)' : ''}`,
    });

    // Log only after response sent
    logger.debug(`✓ execution response sent for ID: ${result.id}`);
  } catch (error) {
    logger.error('Failed to execute test', error);
    res.status(500).json({
      error: 'Failed to execute test',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /execution/:id
 * Get execution result by ID
 */
router.get('/execution/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = executorService.getExecution(id);

    if (!result) {
      logger.warn('Execution not found', id);
      // Return a "pending" state if execution not yet stored
      return res.json({
        id,
        status: 'pending',
        message: 'Test execution is being prepared',
        errors: [],
      });
    }

    logger.debug(`Retrieved execution result for ID: ${id}`, result.status);

    // Construct report URL pointing to Playwright report
    const reportUrl = `/report/${id}`;

    res.json({
      id: result.id,
      testFile: result.testFile,
      status: result.status,
      startTime: result.startTime,
      endTime: result.endTime,
      duration: result.duration,
      results: {
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.totalTests,
      },
      errors: result.errors,
      reportUrl,
    });
  } catch (error) {
    logger.error('Failed to retrieve execution', error);
    res.status(500).json({
      error: 'Failed to retrieve execution',
    });
  }
});

/**
 * GET /execution/:id/logs
 * Get detailed execution logs
 */
router.get('/execution/:id/logs', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const logs = executorService.getExecutionLogs(id);

    if (!logs) {
      logger.warn('Execution logs not found', id);
      return res.status(404).json({
        error: 'Execution not found',
      });
    }

    logger.info('Retrieved execution logs', id);

    res.json({
      id,
      logs: logs.logs,
      errors: logs.errors,
    });
  } catch (error) {
    logger.error('Failed to retrieve execution logs', error);
    res.status(500).json({
      error: 'Failed to retrieve execution logs',
    });
  }
});

/**
 * POST /executions
 * Receive forwarded execution result from pw-ai-agents service
 */
router.post('/executions', (req: Request, res: Response) => {
  try {
    const { executionId: id, fileName, status, passed, failed, skipped, total, logs, error, timestamp } = req.body;

    if (!id || !fileName) {
      logger.warn('POST /executions: Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields: executionId, fileName',
      });
    }

    logger.info('Received forwarded execution result', { id, fileName, status });

    // Convert pw-ai-agents execution format to main backend format
    const result = {
      id,
      testFile: fileName,
      status: (status as 'pending' | 'running' | 'passed' | 'failed' | 'error') || 'passed',
      startTime: new Date(timestamp || new Date()),
      endTime: new Date(),
      duration: 0, // Not provided by pw-ai-agents
      passed: passed || 0,
      failed: failed || 0,
      skipped: skipped || 0,
      totalTests: total || (passed || 0) + (failed || 0) + (skipped || 0),
      stdout: logs?.join('\n') || '',
      stderr: error || '',
      errors: error ? [error] : [],
    };

    // Store in executorService for retrieval via GET /api/execution/:id
    executorService.saveExecution(id, result);

    logger.success('Stored forwarded execution result', { id, testFile: fileName });

    res.json({
      success: true,
      id,
      message: 'Execution result received and stored',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to store forwarded execution', error);
    res.status(500).json({
      error: 'Failed to store forwarded execution',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /executions
 * List all recent executions
 */
router.get('/executions', (req: Request, res: Response) => {
  try {
    const executions = executorService.listExecutions();

    logger.info('Listed recent executions', `${executions.length} executions found`);

    res.json({
      count: executions.length,
      executions: executions.map((e) => ({
        id: e.id,
        testFile: e.testFile,
        status: e.status,
        startTime: e.startTime,
        endTime: e.endTime,
        duration: e.duration,
        results: {
          passed: e.passed,
          failed: e.failed,
          skipped: e.skipped,
          total: e.totalTests,
        },
      })),
    });
  } catch (error) {
    logger.error('Failed to list executions', error);
    res.status(500).json({
      error: 'Failed to list executions',
    });
  }
});

/**
 * Generate file name from test steps
 */
function generateFileName(testSteps: string): string {
  // Extract unique and meaningful keywords from test steps
  const text = testSteps.toLowerCase();
  
  // Define important action words and UI elements to prioritize
  const actionWords = ['navigate', 'login', 'click', 'enter', 'fill', 'submit', 'verify', 'check', 'validate', 'open', 'close', 'search', 'select', 'add', 'delete', 'update', 'create', 'edit', 'edit', 'confirm', 'cancel'];
  const elementWords = ['page', 'form', 'button', 'input', 'field', 'modal', 'dialog', 'table', 'list', 'card', 'dashboard', 'menu', 'profile', 'account', 'login', 'signup', 'settings'];
  
  const words = text.match(/\b\w+\b/g) || ['test'];
  const uniqueWords = new Set<string>();
  
  // First pass: collect prioritized words (actions and elements)
  for (const word of words) {
    if (actionWords.includes(word) || elementWords.includes(word)) {
      uniqueWords.add(word);
      if (uniqueWords.size >= 3) break;
    }
  }
  
  // If not enough prioritized words, add other meaningful words (length > 2, not common words)
  if (uniqueWords.size < 3) {
    const commonWords = new Set(['the', 'and', 'with', 'for', 'from', 'to', 'in', 'on', 'at', 'a', 'an', 'as', 'by', 'or', 'that', 'this', 'is', 'are', 'be', 'been']);
    for (const word of words) {
      if (word.length > 2 && !commonWords.has(word) && !uniqueWords.has(word)) {
        uniqueWords.add(word);
        if (uniqueWords.size >= 4) break;
      }
    }
  }
  
  const nameArray = Array.from(uniqueWords).slice(0, 4);
  const name = nameArray.length > 0 ? nameArray.join('-') : 'test';
  
  return `${name}.spec.ts`;
}

export default router;
