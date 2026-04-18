/**
 * Main Express application entry point
 */

import 'dotenv/config';
import express, { Express } from 'express';
import routes from './api/routes';
import { logger } from './utils/logger';

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Autonomous QA Agent Backend',
    version: '1.0.0',
    description: 'Convert English test cases to Playwright TypeScript scripts',
    endpoints: {
      health: 'GET /api/health',
      generateTest: 'POST /api/generate-test',
      listTests: 'GET /api/tests',
      getTest: 'GET /api/tests/:fileName',
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
});

export default app;
