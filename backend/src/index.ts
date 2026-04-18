/**
 * Main Express application entry point
 */

import 'dotenv/config';
import express, { Express } from 'express';
import routes from './api/routes';
import jiraRoutes from './api/jira-routes';
import { executorService } from './execution/executor-service';
import { logger } from './utils/logger';
import * as path from 'path';
import * as fs from 'fs';

const app: Express = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Report endpoint - serve Playwright test reports
app.get('/report/:id', (req, res) => {
  try {
    const { id } = req.params;
    const execution = executorService.getExecution(id);

    // Serve the Playwright HTML report from pw-ai-agents/playwright-report/index.html
    const reportPath = path.join(process.cwd(), 'pw-ai-agents', 'playwright-report', 'index.html');
    
    if (execution && fs.existsSync(reportPath)) {
      logger.debug(`Serving Playwright report from: ${reportPath}`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const content = fs.readFileSync(reportPath, 'utf-8');
      res.send(content);
    } else {
      // Return placeholder HTML when execution not found or report file not ready
      if (!execution) {
        logger.warn('Report not found for execution', id);
      } else {
        logger.warn(`Report file not found at: ${reportPath}`);
      }
      // Return a placeholder HTML with execution summary instead of spinning placeholder
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Test Report - Execution ${id}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; 
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              color: #e0e0e0;
              min-height: 100vh;
              padding: 40px 20px;
            }
            .container { max-width: 800px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; }
            h1 { font-size: 28px; margin-bottom: 10px; color: #fff; }
            .status-section { 
              background: rgba(30, 41, 59, 0.8);
              border: 1px solid #0f172a;
              border-radius: 8px;
              padding: 30px;
              margin-bottom: 30px;
            }
            .status-row { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              padding: 15px 0;
              border-bottom: 1px solid rgba(15, 23, 42, 0.5);
            }
            .status-row:last-child { border-bottom: none; }
            .label { font-weight: 600; color: #94a3b8; }
            .value { 
              font-weight: 500; 
              font-family: 'Monaco', 'Courier New', monospace;
              color: #e0e0e0;
            }
            .status-badge { 
              display: inline-block;
              padding: 6px 12px;
              border-radius: 4px;
              font-weight: 600;
              font-size: 13px;
            }
            .status-passed { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
            .status-failed { background: rgba(239, 68, 68, 0.2); color: #f87171; }
            .status-generating { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
            .results-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 12px;
              margin-top: 20px;
            }
            .result-card {
              background: rgba(15, 23, 42, 0.5);
              border: 1px solid rgba(51, 65, 85, 0.5);
              border-radius: 6px;
              padding: 15px;
              text-align: center;
            }
            .result-number { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
            .result-label { font-size: 12px; color: #94a3b8; }
            .info-text {
              background: rgba(30, 58, 138, 0.2);
              border-left: 3px solid #3b82f6;
              padding: 15px;
              border-radius: 4px;
              font-size: 14px;
              line-height: 1.5;
              margin-top: 20px;
            }
            .refresh-hint {
              text-align: center;
              margin-top: 20px;
              font-size: 13px;
              color: #64748b;
            }
            .refresh-button {
              background: #3b82f6;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
              margin-top: 20px;
              transition: background 0.2s;
            }
            .refresh-button:hover {
              background: #2563eb;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Test Execution Report</h1>
              <p style="color: #94a3b8;">Execution ID: <code style="background: rgba(15,23,42,0.8); padding: 4px 8px; border-radius: 3px;">${id}</code></p>
            </div>

            <div class="status-section">
              <div class="status-row">
                <span class="label">Status</span>
                <span class="status-badge status-generating">${execution ? 'GENERATING REPORT' : 'PENDING EXECUTION'}</span>
              </div>
              <div class="status-row">
                <span class="label">Execution ID</span>
                <span class="value">${id}</span>
              </div>
              ${execution ? `
              <div class="status-row">
                <span class="label">Test Status</span>
                <span class="value">${execution.status.toUpperCase()}</span>
              </div>
              <div class="status-row">
                <span class="label">Execution Time</span>
                <span class="value">${execution.endTime ? new Date(execution.endTime).toLocaleString() : 'In progress'}</span>
              </div>

              <div class="results-grid">
                <div class="result-card">
                  <div class="result-number" style="color: #4ade80;">${execution.passed}</div>
                  <div class="result-label">PASSED</div>
                </div>
                <div class="result-card">
                  <div class="result-number" style="color: #f87171;">${execution.failed}</div>
                  <div class="result-label">FAILED</div>
                </div>
                <div class="result-card">
                  <div class="result-number" style="color: #facc15;">${execution.skipped}</div>
                  <div class="result-label">SKIPPED</div>
                </div>
                <div class="result-card">
                  <div class="result-number" style="color: #60a5fa;">${execution.passed + execution.failed + execution.skipped}</div>
                  <div class="result-label">TOTAL</div>
                </div>
              </div>
              ` : ''}
            </div>

            <div class="info-text">
              <strong>${execution ? '📊 Report Generation in Progress' : '⏳ Waiting for Test Execution'}</strong><br>
              ${execution ? 'The detailed HTML report is being generated. Use the refresh button to check for updates.' : 'The test execution has not started yet or the execution ID is invalid. Please run a test first.'}
            </div>

            ${!execution ? '<div class="refresh-hint"><button class="refresh-button" onclick="location.reload()">🔄 Refresh Report</button></div>' : ''}
          </div>
        </body>
        </html>
      `);
    }
  } catch (error) {
    logger.error('Failed to retrieve report', error);
    res.status(500).json({ error: 'Failed to retrieve report' });
  }
});

// Routes
app.use('/api', routes);
app.use('/api', jiraRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Autonomous QA Agent Backend',
    version: '1.0.0',
    description: 'Convert English test cases to Playwright TypeScript scripts with execution',
    endpoints: {
      health: 'GET /api/health',
      generateTest: 'POST /api/generate-test',
      listTests: 'GET /api/tests',
      getTest: 'GET /api/tests/:fileName',
      executeTest: 'POST /api/execute',
      getExecution: 'GET /api/execution/:id',
      getExecutionLogs: 'GET /api/execution/:id/logs',
      listExecutions: 'GET /api/executions',
      jiraTestConnection: 'POST /api/jira/test-connection',
      jiraFetchIssue: 'POST /api/jira/fetch-issue',
      jiraFetchIssues: 'POST /api/jira/fetch-issues',
      jiraSearch: 'POST /api/jira/search',
      jiraTransform: 'POST /api/jira/transform',
      jiraHealth: 'GET /api/jira/health',
    },
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// Start server
app.listen(PORT, () => {
  logger.success(`Server running on http://localhost:${PORT}`);
  logger.info('Available endpoints:');
  logger.info('  GET  /                  - API info');
  logger.info('  GET  /api/health        - Health check');
  logger.info('  POST /api/generate-test - Generate test from English');
  logger.info('  GET  /api/tests         - List all generated tests');
  logger.info('  GET  /api/tests/:file   - Get specific test');
  logger.info('  POST /api/execute       - Execute a test file');
  logger.info('  GET  /api/execution/:id - Get execution result');
  logger.info('  GET  /api/execution/:id/logs - Get execution logs');
  logger.info('  GET  /api/executions    - List recent executions');
});

export default app;

// Global error handlers to prevent the server from exiting on unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection at process:', reason instanceof Error ? reason.message : String(reason));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown:', err instanceof Error ? err.stack || err.message : String(err));
});
