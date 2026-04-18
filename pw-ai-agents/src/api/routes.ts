/**
 * Routes for Test Generation API
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { GenerateTestRequest, GenerateTestResponse, ExecuteTestRequest, ExecutionResponse } from '../types';
import { AgentExecutor } from '../agent/executor';
import { FileManager } from '../utils/file-manager';
import { ExecutionService } from '../utils/execution-service';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * POST /generate-test
 * Generate Playwright test from English description
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

    // Execute agent
    const agent = new AgentExecutor(testSteps, url);
    const generatedCode = await agent.execute();

    // Generate file name from test steps
    const fileName = generateFileName(testSteps);

    // Save to file system with versioning
    const fileMetadata = FileManager.saveTestScript(fileName, generatedCode, testSteps, url);

    logger.success('Test generation completed', fileMetadata.fileName);

    const response: GenerateTestResponse = {
      fileName: fileMetadata.fileName,
      code: generatedCode,
      timestamp: fileMetadata.timestamp,
      version: fileMetadata.version,
    };

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
 * POST /execute
 * Execute a generated test file
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    logger.section('POST /execute');

    const { fileName, browsers } = req.body as ExecuteTestRequest;

    // Validate request
    if (!fileName) {
      logger.warn('Missing fileName');
      return res.status(400).json({
        error: 'Missing required field: fileName',
      });
    }

    logger.info('Execute request received', { fileName, browsers });

    // Start test execution
    const result = await ExecutionService.executeTest(fileName, browsers);

    const response: ExecutionResponse & { id?: string } = {
      id: result.executionId,
      executionId: result.executionId,
      fileName: result.fileName,
      status: 'started',
      message: `Test execution started for ${fileName}`,
    };

    logger.success('Test execution started', response.executionId);
    res.json(response);
  } catch (error) {
    logger.error('Failed to execute test', error);
    res.status(500).json({
      error: 'Failed to execute test',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /execution/:executionId
 * Get execution result
 */
router.get('/execution/:executionId', (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    logger.info('Get execution result', executionId);

    const result = ExecutionService.getExecutionResult(executionId);

    if (!result) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    res.json(result);
  } catch (error) {
    logger.error('Failed to get execution result', error);
    res.status(500).json({ error: 'Failed to get execution result' });
  }
});

/**
 * GET /execution/:executionId/logs
 * Get execution logs
 */
router.get('/execution/:executionId/logs', (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    logger.info('Get execution logs', executionId);

    const logs = ExecutionService.getExecutionLogs(executionId);

    res.json({
      executionId,
      logs,
      count: logs.length,
    });
  } catch (error) {
    logger.error('Failed to get execution logs', error);
    res.status(500).json({ error: 'Failed to get execution logs' });
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
 * GET /report/:executionId
 * Serve the Playwright HTML report for an execution
 */
router.get('/report/:executionId', (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const reportPath = path.join(__dirname, '../../playwright-report/index.html');
    
    logger.info('Retrieving report', { executionId, reportPath });

    if (!fs.existsSync(reportPath)) {
      logger.warn('Report not found', reportPath);
      return res.status(404).json({ error: 'Report not found', path: reportPath });
    }

    // Send the HTML report file
    res.sendFile(reportPath);
  } catch (error) {
    logger.error('Failed to retrieve report', error);
    res.status(500).json({ error: 'Failed to retrieve report' });
  }
});

/**
 * Generate file name from test steps
 */
function generateFileName(testSteps: string): string {
  // Extract first meaningful phrase
  const words = testSteps.toLowerCase().match(/\b\w+\b/g);
  const name = (words || ['test']).slice(0, 3).join('-');
  return `${name}.spec.ts`;
}

export default router;
