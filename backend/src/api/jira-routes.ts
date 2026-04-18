/**
 * Jira Integration API Routes
 * Exposes Jira issue transformation endpoints
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { JiraClient } from '../jira/jira.client';
import { JiraMapper } from '../jira/jira.mapper';
import { JiraIssue } from '../types';

const router = Router();

/**
 * POST /jira/test-connection
 * Test Jira connection and credentials
 */
router.post('/jira/test-connection', async (req: Request, res: Response) => {
  try {
    logger.section('POST /jira/test-connection');
    const connected = await JiraClient.testConnection();

    res.json({
      success: connected,
      message: connected ? 'Jira connection successful' : 'Jira connection failed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to test Jira connection', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test Jira connection',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /jira/fetch-issue
 * Fetch and transform a single Jira issue
 */
router.post('/jira/fetch-issue', async (req: Request, res: Response) => {
  try {
    logger.section('POST /jira/fetch-issue');

    const { issueKey } = req.body as { issueKey?: string };

    if (!issueKey) {
      return res.status(400).json({
        error: 'Missing required field: issueKey',
        example: 'Use format like GEN-27, QA-101, etc.',
      });
    }

    // Validate issue key format (should be PROJECT-NUMBER)
    const issueKeyPattern = /^[A-Z]+-\d+$/;
    if (!issueKeyPattern.test(issueKey.trim())) {
      return res.status(400).json({
        error: 'Invalid issue key format',
        received: issueKey,
        format: 'Expected format: PROJECT-NUMBER (e.g., GEN-27, QA-101)',
      });
    }

    logger.info(`Fetching issue: ${issueKey}`);

    // Fetch issue from Jira
    const issue = await JiraClient.getIssue(issueKey);
    if (!issue) {
      return res.status(404).json({
        success: false,
        error: `Issue ${issueKey} not found or authentication failed`,
        details: 'Check: 1) Issue key exists in JIRA, 2) JIRA_API_TOKEN is valid, 3) User has permission to see the issue',
        timestamp: new Date().toISOString(),
      });
    }

    logger.debug(`Issue data:`, {
      key: issue.key,
      summary: issue.summary,
      hasDescription: !!issue.description,
    });

    // Transform to test steps
    const transformed = await JiraMapper.mapJiraToTestSteps(issue);

    // Ensure normalizedSteps is always an array
    let normalizedStepsArray: string[] = [];
    if (typeof transformed.normalizedSteps === 'string') {
      normalizedStepsArray = transformed.normalizedSteps
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    } else if (Array.isArray(transformed.normalizedSteps)) {
      normalizedStepsArray = transformed.normalizedSteps;
    }

    // Format response for frontend
    const response_data = {
      success: true,
      issue: {
        key: issue.key,
        summary: issue.summary,
        description: issue.description,
      },
      transformed: {
        rawContent: transformed.rawContent || '',
        normalizedSteps: normalizedStepsArray,
        contentSource: transformed.normalizationMethod === 'llm' ? 'LLM Enhanced' : 'Parsed',
        complexityScore: normalizedStepsArray.length || transformed.rawContent.split('\n').length,
        usedLLMNormalization: transformed.normalizationMethod === 'llm',
        processingTime: Math.random() * 100 | 0, // Mock processing time
      },
      timestamp: new Date().toISOString(),
    };

    logger.debug(`Response prepared:`, {
      issueKey: response_data.issue.key,
      stepsCount: response_data.transformed.normalizedSteps.length,
    });

    res.json(response_data);
  } catch (error) {
    logger.error('Failed to fetch and transform Jira issue', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Jira issue',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /jira/fetch-issues
 * Fetch and transform multiple Jira issues
 */
router.post('/jira/fetch-issues', async (req: Request, res: Response) => {
  try {
    logger.section('POST /jira/fetch-issues');

    const { issueKeys } = req.body as { issueKeys?: string[] };

    if (!issueKeys || !Array.isArray(issueKeys) || issueKeys.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: issueKeys (array)',
      });
    }

    logger.info(`Fetching ${issueKeys.length} issues: ${issueKeys.join(', ')}`);

    // Fetch issues from Jira
    const issues = await JiraClient.getIssues(issueKeys);

    if (issues.length === 0) {
      return res.status(404).json({
        error: 'No issues found',
      });
    }

    // Transform all issues
    const transformed = await JiraMapper.mapJiraIssuesToTestSteps(issues);

    // Combine into single test case document
    const combinedSteps = JiraMapper.combineTestSteps(transformed);

    res.json({
      success: true,
      issuesFound: issues.length,
      issues,
      transformed,
      combinedSteps,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch and transform Jira issues', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Jira issues',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /jira/search
 * Search Jira issues using JQL
 */
router.post('/jira/search', async (req: Request, res: Response) => {
  try {
    logger.section('POST /jira/search');

    const { jql, maxResults } = req.body as { jql?: string; maxResults?: number };

    if (!jql) {
      return res.status(400).json({
        error: 'Missing required field: jql',
      });
    }

    logger.info(`Searching: ${jql}`);

    // Search issues
    const issues = await JiraClient.searchIssues(jql, maxResults);

    if (issues.length === 0) {
      return res.json({
        success: true,
        issues: [],
        message: 'No issues found matching JQL',
      });
    }

    // Transform all found issues
    const transformed = await JiraMapper.mapJiraIssuesToTestSteps(issues);

    // Combine into single test case document
    const combinedSteps = JiraMapper.combineTestSteps(transformed);

    res.json({
      success: true,
      issuesFound: issues.length,
      issues,
      transformed,
      combinedSteps,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to search Jira issues', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search Jira',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /jira/transform
 * Transform already fetched Jira issues into test steps (no Jira call)
 */
router.post('/jira/transform', async (req: Request, res: Response) => {
  try {
    logger.section('POST /jira/transform');

    const { issues } = req.body as { issues?: JiraIssue[] };

    if (!issues || !Array.isArray(issues) || issues.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: issues (array of Jira issues)',
      });
    }

    logger.info(`Transforming ${issues.length} pre-fetched issues`);

    // Transform all issues
    const transformed = await JiraMapper.mapJiraIssuesToTestSteps(issues);

    // Combine into single test case document
    const combinedSteps = JiraMapper.combineTestSteps(transformed);

    res.json({
      success: true,
      issuesTransformed: transformed.length,
      transformed,
      combinedSteps,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to transform Jira issues', error);
    res.status(500).json({
      success: false,
      error: 'Failed to transform issues',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /jira/health
 * Check Jira integration health
 */
router.get('/jira/health', async (req: Request, res: Response) => {
  try {
    const connected = await JiraClient.testConnection();
    res.json({
      status: connected ? 'healthy' : 'unavailable',
      jiraUrl: process.env.JIRA_URL || 'not configured',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
