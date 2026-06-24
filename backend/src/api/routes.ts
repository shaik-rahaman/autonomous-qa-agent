/**
 * Routes for Test Generation API
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { GenerateTestRequest, GenerateTestResponse } from '../types';
import { AgentExecutor } from '../agent/executor';
import { FileManager } from '../utils/file-manager';
import { executorService } from '../execution/executor-service';
import path from 'path';
import fs from 'fs';
import { runWithLangChain } from '../orchestrator/langchain.orchestrator';
import { scriptExecutor, ExecuteScriptRequest, SelfHealingLabRequest } from '../services/script-executor';

const router = Router();

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
 * GET /tests/map/:fileName
 * Return the saved mapping for a temporary script file (if present)
 */
router.get('/tests/map/:fileName', (req: Request, res: Response) => {
  try {
    const { fileName } = req.params;
    if (!fileName) return res.status(400).json({ error: 'Missing fileName' });

    const savedPath = scriptExecutor.getSavedScriptPath(fileName);
    if (!savedPath) return res.status(404).json({ error: 'Mapping not found' });

    res.json({ fileName, path: savedPath });
  } catch (error) {
    logger.error('Failed to retrieve script map entry', error);
    res.status(500).json({ error: 'Failed to retrieve mapping' });
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
    const projectRootPath = path.join(process.cwd(), 'backend');
    const result = await runWithLangChain({ testFile: fileName, targetUrl: url, projectRoot: projectRootPath });

    // Store the result in executorService so it can be retrieved later via GET /api/execution/:id
    executorService.saveExecution(result.id, result);

    logger.success('Test execution completed', {
      id: result.id,
      testFile: result.testFile,
      status: result.status,
      healed: result.healed,
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
 * DEBUG: GET /debug/error-object
 * Returns keys and symbol property names for a stored execution error object
 * Query: ?id=<executionId>
 */
router.get('/debug/error-object', (req: Request, res: Response) => {
  try {
    const { id } = req.query as any;
    if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

    const exec = executorService.getExecution(id);
    if (!exec) return res.status(404).json({ error: 'Execution not found' });

    const target: any = exec || {};
    const keys = Object.keys(target);
    const symbols = (Object.getOwnPropertySymbols(target) || []).map((s) => s.toString());

    res.json({ id, keys, symbols, sampleStdout: String(target.stdout || '').substring(0, 500) });
  } catch (e) {
    logger.error('Failed to return debug error object', e);
    res.status(500).json({ error: 'Failed to return debug info' });
  }
});

  /**
   * GET /debug/env
   * Return presence/status of critical environment variables used by healing
   */
  router.get('/debug/env', (req: Request, res: Response) => {
    try {
      const env = {
        HEALING_ENABLED: process.env.HEALING_ENABLED === 'true',
        HEALING_AUTO_VERIFY: process.env.HEALING_AUTO_VERIFY === 'true',
        GROQ_API_KEY_present: !!process.env.GROQ_API_KEY,
        MCP_SERVER_URL_present: !!process.env.MCP_SERVER_URL,
        MCP_SERVER_URL: process.env.MCP_SERVER_URL || null,
        NODE_ENV: process.env.NODE_ENV || null,
        PORT: process.env.PORT || null,
      };

      logger.info('GET /debug/env', env);

            // (debug/env returns environment info only)
    } catch (e) {
      logger.error('Failed to read env for /debug/env', e);
      res.status(500).json({ success: false, error: 'Failed to read env' });
    }
  });

/**
 * GET /playwright-health
 * Run Playwright environment validation and return structured diagnostics
 */
router.get('/playwright-health', (req: Request, res: Response) => {
  try {
    const { validatePlaywrightEnvironment } = require('../execution/PlaywrightEnvironmentValidator');
    // Robustly determine repo root by walking up from this file's directory
    const fs = require('fs');
    const path = require('path');
    const findRepoRoot = (startDir: string) => {
      let dir = path.resolve(startDir);
      const root = path.parse(dir).root;
      let firstFound = null;
      while (true) {
        try {
          if (fs.existsSync(path.join(dir, 'pw-ai-agents'))) {
            if (!firstFound) firstFound = dir;
          }
          if (fs.existsSync(path.join(dir, 'pw-ai-agents')) && fs.existsSync(path.join(dir, 'backend'))) {
            return dir;
          }
        } catch (e) {
          // ignore
        }
        if (dir === root) break;
        dir = path.dirname(dir);
      }
      return firstFound || process.cwd();
    };
    const repoRoot = findRepoRoot(__dirname);
    const pwDir = path.join(repoRoot, 'pw-ai-agents');
    logger.info('playwright-health: resolved repoRoot:', repoRoot);
    logger.info('playwright-health: pw-ai-agents dir exists:', fs.existsSync(pwDir));
    logger.info('playwright-health: pw-ai-agents path:', pwDir);
    const result = validatePlaywrightEnvironment(pwDir, repoRoot);
    res.json({ success: true, details: result });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
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

/**
 * POST /scripts/execute
 * Execute a custom/inline Playwright script with self-healing support
 */
router.post('/scripts/execute', async (req: Request, res: Response) => {
  try {
    logger.section('POST /scripts/execute');

    const { script, url } = req.body as ExecuteScriptRequest;

    if (!script) {
      logger.warn('Missing script in request');
      return res.status(400).json({
        error: 'Missing required field: script',
      });
    }

    logger.info('Executing inline script', {
      scriptLength: script.length,
      hasUrl: !!url,
    });

    // Prepare and save script
    const prepResult = await scriptExecutor.executeScript({ script, url });

    if (!prepResult.success) {
      logger.warn('Script preparation failed', prepResult.error);
      return res.status(400).json({
        error: 'Script preparation failed',
        message: prepResult.error,
      });
    }

    const fileName = prepResult.fileName;

    // Execute the script with self-healing support using existing orchestrator
    const result = await runWithLangChain({ testFile: fileName, targetUrl: url, projectRoot: '.' });

    // Store the result
    executorService.saveExecution(result.id, result);

    logger.success('Inline script execution completed', {
      id: result.id,
      status: result.status,
      healed: result.healed,
    });

    // Construct report URL
    const reportUrl = `/report/${result.id}`;

    // Return execution result
    res.json({
      id: result.id,
      status: result.status,
      duration: result.duration,
      healed: result.healed,
      reused: result.reused,
      results: {
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.totalTests,
      },
      errors: result.errors,
      reportUrl,
      healingDetails: result.healingDetails,
      savedFileName: fileName,
      message: `Script execution completed. Status: ${result.status}${result.healed ? ' (with self-healing)' : ''}`,
    });
  } catch (error) {
    logger.error('Failed to execute inline script', error);
    res.status(500).json({
      error: 'Failed to execute script',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /healing-lab/run
 * Execute a script in self-healing lab mode with intentional failures
 */
router.post('/healing-lab/run', async (req: Request, res: Response) => {
  console.log('HEALING_ROUTE_ENTERED_99999');
  try {
    logger.section('POST /healing-lab/run');

    const { script, failureType = 'NONE', url, localLocatorTest = false } = req.body as SelfHealingLabRequest;

    if (!script) {
      logger.warn('Missing script in request');
      return res.status(400).json({
        error: 'Missing required field: script',
      });
    }

    if (!['STRICT_MODE', 'ELEMENT_NOT_FOUND', 'TIMEOUT', 'NONE'].includes(failureType)) {
      logger.warn('Invalid failureType', failureType);
      return res.status(400).json({
        error: 'Invalid failureType. Must be one of: STRICT_MODE, ELEMENT_NOT_FOUND, TIMEOUT, NONE',
      });
    }

    logger.info('Self-Healing Lab: Executing script', {
      scriptLength: script.length,
      failureType,
      hasUrl: !!url,
    });

    // Debug: surface presence of critical environment variables used by healing
    const configuredHealing = process.env.HEALING_ENABLED === 'true';
    const envStatus = {
      configuredHEALING_ENABLED: configuredHealing,
      GROQ_API_KEY_present: !!process.env.GROQ_API_KEY,
      MCP_SERVER_URL_present: !!process.env.MCP_SERVER_URL,
      MCP_SERVER_URL: process.env.MCP_SERVER_URL || null,
    };
    logger.info('Self-Healing Lab env status', envStatus);

    // Force healing enabled for Self-Healing Lab runs (temporary override)
    const prevHealingEnv = process.env.HEALING_ENABLED;
    process.env.HEALING_ENABLED = 'true';
    logger.info(`HEALING ACTIVE: TRUE (overridden, configured=${configuredHealing})`);

    // Prepare script with intentional failure injection
    const prepResult = await scriptExecutor.executeSelfHealingLabScript({ script, failureType, url, localLocatorTest });

    if (!prepResult.success) {
      logger.warn('Self-healing lab script preparation failed', prepResult.error);
      return res.status(400).json({
        error: 'Script preparation failed',
        message: prepResult.error,
      });
    }

    const fileName = prepResult.fileName;

    // Resolve created file path for diagnostics
    let createdFilePath: string | null = null;
    try {
      createdFilePath = scriptExecutor.getSavedScriptPath(fileName) || null;
    } catch (e) {
      createdFilePath = null;
    }

    // Run a first-pass execution to capture the actual Playwright failure and validate whether healing should proceed
    let initialResult: any = null;
    try {
      logger.info('Self-Healing Lab: Running initial test execution to capture real error');
      // Print the exact generated temp file contents immediately before execution for diagnostics
      try {
        const genPath = scriptExecutor.resolveGeneratedScriptPath(fileName);
        if (fs.existsSync(genPath)) {
          const genContent = fs.readFileSync(genPath, 'utf-8');
          console.log('[HEALING-LAB] GENERATED SCRIPT CONTENTS BEFORE EXECUTION:\n' + genContent);
        } else {
          console.log('[HEALING-LAB] GENERATED SCRIPT PATH NOT FOUND: ' + genPath);
        }
      } catch (e) {
        logger.debug('Could not read generated script before execution', e instanceof Error ? e.message : String(e));
      }
      console.log('BEFORE_EXECUTE_TEST_66666');
      initialResult = await executorService.executeTest(fileName);
      console.log('AFTER_EXECUTE_TEST_66666');
      console.log('AFTER_EXECUTION_RETURN_77777');

      // Diagnostic tracing: surface execution return and healing flags
      try {
        logger.info('AFTER_EXECUTION_RETURN', {
          id: initialResult?.id,
          status: initialResult?.status,
          failed: initialResult?.failed,
          totalTests: initialResult?.totalTests,
          exitCode: (initialResult as any)?.exitCode || null,
          lastReachedLocator: (initialResult as any)?.lastReachedLocator || null,
        });
      } catch (e) {}

      logger.info('ENTER_HEALING_ROUTE', {
        configuredHEALING_ENABLED: configuredHealing,
        HEALING_ENABLED_env: process.env.HEALING_ENABLED,
        prevHealingEnv: prevHealingEnv,
      });

      logger.info('Self-Healing Lab: Initial execution completed', { id: initialResult.id, status: initialResult.status });
    } catch (execErr) {
      logger.warn('Self-Healing Lab: Initial execution failed', execErr instanceof Error ? execErr.message : String(execErr));
    }

    // Determine actual playwright error summary
    const actualPlaywrightError = (initialResult && (initialResult as any).playwrightError) || (initialResult && (initialResult.stderr || initialResult.stdout)) || null;

    // Will be populated with any failed locators extracted from Playwright output
    let detectedFailedLocators: string[] | null = null;

    // Validate failure type: for ELEMENT_NOT_FOUND, ensure the healing-lab run reached the injected locator
    // If the injected locator was not reached before the failure, mark as PRE_LOCATOR_FAILURE and skip healing
    let invalidHealingScenario: false | 'PRE_LOCATOR_FAILURE' = false;
    try {
      let injectedSelector = (prepResult as any).injectedSelector || null;
      // If not returned from prepResult, attempt to read the saved file to determine injected selector
      if (!injectedSelector && createdFilePath && fs.existsSync(createdFilePath)) {
        try {
          // TASK 2: Log actual file path before reading
          logger.info(`ACTUAL FILE PATH (healing-lab): ${createdFilePath}`);
          logger.info(`FILE EXISTS: ${fs.existsSync(createdFilePath)}`);
          const fileContent = fs.readFileSync(createdFilePath, 'utf-8');
          const m = fileContent.match(/REACHED LOCATOR:\'\,\s*(["'`][\s\S]*?["'`])/) || fileContent.match(/REACHED LOCATOR:\',\s*(["'`][\s\S]*?["'`])/) || fileContent.match(/REACHED LOCATOR:\s*,\s*(["'`][\s\S]*?["'`])/) ;
          if (m && m[1]) {
            injectedSelector = m[1].replace(/^(["'`])|(["'`])$/g, '').replace(/\\/g, '');
            logger.info('Inferred injectedSelector from saved file', { injectedSelector });
          }
        } catch (e) {
          logger.debug('Could not infer injected selector from file', e instanceof Error ? e.message : String(e));
        }
      }
      const actualOutput = String(initialResult?.stdout || '') + '\n' + String(initialResult?.stderr || '');
    console.log('BEFORE_PLAYWRIGHT_ERROR_BLOCK_88888');

      console.log('[HEALING-LAB] PLAYWRIGHT_ERROR_START');
      console.log('BACKEND_ROUTES_TS_MARKER_12345');
console.log(actualPlaywrightError);
console.log('[HEALING-LAB] PLAYWRIGHT_ERROR_END');

      console.log('[HEALING-LAB] OUTPUT_CONTAINS_WAITING_FOR_LOCATOR:',
  actualOutput.includes('waiting for locator'));

      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/gi, '');
      const normalize = (s: any) => {
        if (!s) return null;
        return String(s).replace(/\\/g, '').replace(/\s+/g, ' ').trim();
      };

      if (failureType === 'ELEMENT_NOT_FOUND') {
        if (!injectedSelector) {
          // Guard against empty selector - this is a true pre-locator failure
          invalidHealingScenario = 'PRE_LOCATOR_FAILURE';
          logger.warn('PRE_LOCATOR_FAILURE: No injected selector found in prepared script');
          console.error('[HEALING-LAB] SelectorExtractionBug: injectedSelector is empty after script preparation');
          console.error('[HEALING-LAB] Diagnostic: prepResult.injectedSelector=%o, createdFilePath=%s, fileExists=%s', 
            (prepResult as any).injectedSelector || 'undefined', createdFilePath, 
            createdFilePath ? fs.existsSync(createdFilePath) : 'N/A');
        } else {
          // FIX: Rewrite locator failure detection to NOT rely on REACHED LOCATOR logs
          // REACHED LOCATOR logs fire BEFORE Playwright tries to find the element, so they
          // cannot be used as evidence of successful locator operations.
          // Instead, look for Playwright's "waiting for locator" error which indicates
          // the locator operation actually failed.
          console.log('[HEALING-LAB] FAILED SELECTOR: ' + injectedSelector);
          
          // Prefer Playwright's extracted error as primary analysis source (falls back to stdout/stderr)
          const locatorAnalysisSource = String(actualPlaywrightError || actualOutput || '');
          try {
            logger.info('LOCATOR_ANALYSIS_SOURCE', { sourcePreview: locatorAnalysisSource.substring(0, 1000) });
            const containsWaiting = /waiting for\s+locator/i.test(locatorAnalysisSource);
            logger.info('LOCATOR_ANALYSIS_CONTAINS_WAITING', { containsWaiting });
            console.log('[HEALING-LAB] LOCATOR_ANALYSIS_CONTAINS_WAITING:', containsWaiting);
          } catch (e) {}
          // Strip ANSI escape sequences to clean the chosen analysis source
          const cleanOut = locatorAnalysisSource.replace(/(?:\\u001b|\\x1B|\u001b|\x1B)\[[0-9;?]*[ -\/]*[@-~]/g, '');
          const normInjected = normalize(injectedSelector);
          
          if (!normInjected) {
            invalidHealingScenario = 'PRE_LOCATOR_FAILURE';
            console.error('[HEALING-LAB] SelectorExtractionBug: normInjected is empty after normalization');
            console.error('[HEALING-LAB] Diagnostic: injectedSelector=%s', injectedSelector);
          } else {
            // Step 1: Extract all REACHED LOCATOR logs (for diagnostics only - do NOT use for decisions)
            const reachedLocatorPattern = /\[HEALING LAB\]\s*REACHED LOCATOR:\s*(.*)/g;
            let m: RegExpExecArray | null;
            const reachedList: string[] = [];
            while ((m = reachedLocatorPattern.exec(cleanOut)) !== null) {
              if (m[1]) {
                const entry = String(m[1]).replace(/\\/g, '').trim().replace(/^("|'|`)|("|'|`)$/g, '');
                reachedList.push(entry);
                logger.info('LOCATOR_REACHED_STATEMENT', { statement: entry });
              }
            }
            
            // Step 2: Check if we found any REACHED LOCATOR logs
            const didReachLocatorStatement = reachedList.length > 0;
            
            // Step 3: Look for Playwright's "waiting for locator" error pattern
            // Use the explicit Playwright error text as the primary source for extraction
            const failedLocatorRegex = /waiting for\s+locator\(\s*["'`]?([^"'`\)]+)["'`]?\s*\)/gi;
            // Use actualPlaywrightError as the source per request (fallback not used for extraction)
            const failedLocatorInputRaw = String(actualPlaywrightError || '');
            // Diagnostic: show exact input used for locator extraction (trim to reasonable length)
            console.log('[HEALING-LAB] FAILED_LOCATOR_EXTRACTION_INPUT:', failedLocatorInputRaw.substring(0, 2000));

            // Strip ANSI escape sequences for matching
            const failedLocatorInput = failedLocatorInputRaw.replace(/(?:\\u001b|\\x1B|\u001b|\x1B)\[[0-9;?]*[ -\/]*[@-~]/g, '');

            const failedLocators: string[] = [];
            const failedLocatorMatches: string[] = [];
            let failMatch: RegExpExecArray | null;
            while ((failMatch = failedLocatorRegex.exec(failedLocatorInput)) !== null) {
              if (failMatch[1]) {
                const raw = String(failMatch[1]);
                const failedSelector = normalize(raw);
                failedLocators.push(failedSelector || raw);
                failedLocatorMatches.push(raw);

                // Check if this failed locator matches the injected selector
                if (failedSelector && normInjected && 
                    (failedSelector === normInjected || 
                     failedSelector.includes(normInjected) || 
                     normInjected.includes(failedSelector))) {
                  logger.info('LOCATOR_OPERATION_FAILED', { selector: failedSelector, injectedSelector });
                  console.log('[HEALING-LAB] LOCATOR_OPERATION_FAILED: ' + failedSelector);
                  console.log('[HEALING-LAB] HEALING_TRIGGER_SELECTOR: ' + normInjected);
                  // Healing SHOULD run for this selector
                  invalidHealingScenario = false;
                }
              }
            }

            // Diagnostic: surface matches array and regex used
            console.log('[HEALING-LAB] FAILED_LOCATOR_EXTRACTION_MATCHES:', JSON.stringify(failedLocatorMatches));
            console.log('[HEALING-LAB] FAILED_LOCATOR_EXTRACTION_REGEX:', failedLocatorRegex.toString());

            // persist extracted failed locators for use by fast-path retry logic later
            if (failedLocators.length > 0) detectedFailedLocators = failedLocators.slice();

            // Fallback: if we couldn't extract failed locators from the Playwright error,
            // use executor-provided lastReachedLocator as authoritative fallback.
            if ((!failedLocators || failedLocators.length === 0) && initialResult && (initialResult as any).lastReachedLocator) {
              const fb = String((initialResult as any).lastReachedLocator);
              console.log('[HEALING-LAB] FAILED_LOCATOR_FALLBACK_USED: true');
              console.log('[HEALING-LAB] FAILED_LOCATOR_FALLBACK_VALUE: ' + fb);
              try {
                const normFb = normalize(fb);
                failedLocators.push(normFb || fb);
              } catch (e) {
                failedLocators.push(fb);
              }
              detectedFailedLocators = failedLocators.slice();
            }
            
            // Step 4: Check for timeout messages
            const timeoutPattern = /timeout|timed out/i;
            if (timeoutPattern.test(cleanOut)) {
              logger.info('TIMEOUT_DETECTED_IN_OUTPUT', { injectedSelector });
              if (!invalidHealingScenario) {
                console.log('[HEALING-LAB] LOCATOR_OPERATION_FAILED: Timeout detected');
                console.log('[HEALING-LAB] HEALING_TRIGGER_SELECTOR: ' + normInjected);
              }
            }
            
            // Step 5: Determine if this is a pre-locator failure
            // Only set PRE_LOCATOR_FAILURE if:
            // - We have an injected selector, but
            // - We never reached the locator statement (no REACHED LOCATOR logs), AND
            // - We don't see "waiting for locator" pattern
            if (!didReachLocatorStatement && failedLocators.length === 0) {
              logger.warn('PRE_LOCATOR_FAILURE: injected locator was not reached before failure', 
                { injectedSelector, reachedList, failedLocators });
              invalidHealingScenario = 'PRE_LOCATOR_FAILURE';
            } else if (didReachLocatorStatement && failedLocators.length === 0) {
              // Reached the statement but no "waiting for locator" pattern found
              // This suggests the locator succeeded (no error reported)
              logger.info('LOCATOR_OPERATION_SUCCEEDED', { injectedSelector, reachedList });
              console.log('[HEALING-LAB] LOCATOR_OPERATION_SUCCEEDED: ' + injectedSelector);
              // Do NOT set invalidHealingScenario - healing can still run as fallback
            }
            
            logger.info('HEALING LAB: locator operation analysis', { 
              injectedSelector, 
              didReachLocatorStatement,
              failedLocators, 
              invalidHealingScenario 
            });
            // NEW DIAGNOSTIC LOGS: surface selector comparisons used for healing decisions
            try {
              const prepSelector = (prepResult as any)?.injectedSelector || null;
              const validationSelector = normInjected || prepSelector;
              const playFailed = failedLocators && failedLocators.length ? failedLocators : null;
              const selectorMatched = !!(playFailed && validationSelector && playFailed.some(p => p === validationSelector || p.includes(validationSelector) || validationSelector.includes(p)));

              logger.info('HEALING_VALIDATION_SELECTOR', { validationSelector });
              logger.info('PLAYWRIGHT_FAILED_SELECTOR', { failedLocators: playFailed });
              logger.info('PREP_RESULT_SELECTOR', { prepResult_injectedSelector: prepSelector });
              logger.info('SELECTOR_MATCH_RESULT', { selectorMatched });

              console.log('[HEALING-LAB] HEALING_VALIDATION_SELECTOR:', validationSelector);
              console.log('[HEALING-LAB] PLAYWRIGHT_FAILED_SELECTOR:', JSON.stringify(playFailed));
              console.log('[HEALING-LAB] PREP_RESULT_SELECTOR:', prepSelector);
              console.log('[HEALING-LAB] SELECTOR_MATCH_RESULT:', selectorMatched);
            } catch (e) {}
          }
        }
      }
    } catch (e) {
      logger.debug('Could not validate locator reachability via logs', e instanceof Error ? e.message : String(e));
    }

    let result: any;
    // Runtime diagnostic: log healing flag state and decision inputs
    try {
      logger.info('HEALING_FLAG_DEBUG', {
        raw_HEALING_ENABLED: process.env.HEALING_ENABLED,
        healingEnabled_eval: process.env.HEALING_ENABLED === 'true',
        invalidHealingScenario,
      });
    } catch (e) {}

    const healingEnabled = process.env.HEALING_ENABLED === 'true';

    if (invalidHealingScenario && !healingEnabled) {
      // Healing disabled: Skip full orchestration and return diagnostics indicating pre-locator failure
      logger.warn('PRE_LOCATOR_FAILURE_TRIGGERED', { reason: invalidHealingScenario });
      logger.warn('PRE_LOCATOR_FAILURE_REASON', 'Injected locator not found or not reached before failure and healing is disabled - skipping healing');
      result = initialResult || {
        id: `exec-${Date.now()}`,
        testFile: fileName,
        status: 'error',
        passed: 0,
        failed: 1,
        skipped: 0,
        totalTests: 1,
        stdout: initialResult?.stdout || '',
        stderr: initialResult?.stderr || actualPlaywrightError || 'No error captured',
        errors: initialResult?.errors || [ 'PRE_LOCATOR_FAILURE' ],
        healed: false,
        reused: false,
      };
    } else {
      // Either no invalid scenario, or healing is enabled and we should continue to healing
      if (invalidHealingScenario && healingEnabled) {
        logger.warn('PRE_LOCATOR_FAILURE_TRIGGERED', { reason: invalidHealingScenario });
        logger.info('PRE_LOCATOR_FAILURE_REASON', 'Injected locator not found or not reached before failure, but healing is enabled - continuing to healing');
        logger.info('CONTINUING_TO_HEALING');
      }
      // Proceed with full orchestration (healing) using LangChain orchestrator
      // NOTE: Deterministic demo fast-paths (e.g., prefix-based 'asdf' repairs) have been removed
      // to ensure the healing engine receives the actual failed locator and error context.
      try {
        logger.info('CALLING_RUN_WITH_LANGCHAIN', { testFile: fileName });

        // Determine the preferred failed selector to pass into the orchestration layer
        const preferredFailedSelector = (detectedFailedLocators && detectedFailedLocators.length)
          ? detectedFailedLocators[0]
          : ((initialResult as any)?.lastReachedLocator || (prepResult as any)?.injectedSelector || undefined);

        console.log('[HEALING-LAB] FAILED_SELECTOR_SELECTED:', preferredFailedSelector);
        console.log('[HEALING-LAB] HEALING_INPUT_SELECTOR:', { detectedFailedLocators: detectedFailedLocators ? detectedFailedLocators.slice(0,3) : null, lastReachedLocator: (initialResult as any)?.lastReachedLocator, prep_injected: (prepResult as any)?.injectedSelector });

        result = await runWithLangChain({
          testFile: fileName,
          targetUrl: url,
          projectRoot: '.',
          // forward context to the orchestration layer (preferred order: detectedFailedLocators[0] || lastReachedLocator || prep.injectedSelector)
          failedLocator: preferredFailedSelector,
          actualPlaywrightError: actualPlaywrightError,
          lastReachedLocator: (initialResult as any)?.lastReachedLocator,
        } as any);

        console.log('[HEALING-LAB] HEALING_PIPELINE_SELECTOR:', preferredFailedSelector);
      } catch (e) {
        logger.error('LangChain orchestration failed', e instanceof Error ? e.message : String(e));
        result = initialResult || { id: `exec-${Date.now()}`, testFile: fileName, status: 'error', passed: 0, failed: 1, skipped: 0, totalTests: 1, stdout: '', stderr: String(e), errors: [String(e)], healed: false, reused: false };
      }
    }

    // Restore previous HEALING_ENABLED value
    if (typeof prevHealingEnv === 'undefined') delete process.env.HEALING_ENABLED;
    else process.env.HEALING_ENABLED = prevHealingEnv;

    // Store the result (ensure it has an ID first)
    try {
      if (!result.id) {
        // Defensive: some orchestration paths may return result-like objects
        // without an `id`. Generate a stable execution id to store the result.
        result.id = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        logger.warn('Assigned fallback execution id for healing result', { id: result.id });
      }
      // Explicit console log to make save attempts visible in stdout/stderr
      console.log('[HEALING-LAB] SAVING_EXECUTION:', result.id);
      executorService.saveExecution(result.id, result);

      logger.success('Self-healing lab execution completed', {
        id: result.id,
        failureType,
        status: result.status,
        healed: result.healed,
      });
    } catch (saveErr) {
      logger.error('Failed to save self-healing execution result', saveErr instanceof Error ? saveErr.message : String(saveErr));
    }

    // Construct report URL
    const reportUrl = `/report/${result.id}`;

    // Return execution result with healing diagnostics
    res.json({
      id: result.id,
      status: result.status,
      duration: result.duration,
      healed: result.healed,
      reused: result.reused,
      failureType,
      results: {
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.totalTests,
      },
      errors: result.errors,
      reportUrl,
      healingDetails: result.healingDetails || {
        originalSelector: 'N/A',
        newSelector: 'N/A',
        strategy: 'No healing applied',
      },
      healingDiagnostics: {
        failureInjected: prepResult.failureInjected,
        originalStatus: failureType,
        healingApplied: result.healed,
        confidence: result.healed ? 'HIGH' : 'LOW',
        originalSelector: result.healingDetails?.originalSelector || 'N/A',
        healedSelector: result.healingDetails?.newSelector || 'N/A',
        strategy: result.healingDetails?.strategy || 'No healing',
        createdFilePath: createdFilePath || 'N/A',
        readFilePath: createdFilePath || 'N/A',
        actualPlaywrightError: (result && (result.playwrightError || result.stderr || result.stdout)) || 'N/A',
        extractedSelector: result.healingDetails?.originalSelector || 'N/A',
        healingCandidate: result.healingDetails?.newSelector || 'N/A',
        retryResult: { status: result.status, passed: result.passed, failed: result.failed },
        invalidHealingScenario: invalidHealingScenario || false,
        // compute reachedLocatorFailure from available error fields
        reachedLocatorFailure: (function () {
          try {
            const { reachedLocatorFailureFromError } = require('../agents/self-healing/healing-pipeline');
            const err = (result.errors && result.errors[0]) || result.stderr || result.stdout || '';
            return !!reachedLocatorFailureFromError(err);
          } catch (e) {
            return false;
          }
        })(),
        env: envStatus,
      },
      savedFileName: fileName,
      message: `Self-Healing Lab completed. Failure Type: ${failureType}. Healing: ${result.healed ? 'SUCCESS' : 'FAILED'}`,
    });
  } catch (error) {
    logger.error('Failed to execute self-healing lab', error);
    res.status(500).json({
      error: 'Failed to execute self-healing lab',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
