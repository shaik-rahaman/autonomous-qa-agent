/**
 * Shared Types
 * Common types used across agents
 */

export interface TestCase {
  id: string;
  name: string;
  steps: string[];
  url: string;
  expectedResult?: string;
  tags?: string[];
}

export interface TestExecution {
  id: string;
  testId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  duration?: number;
  error?: string;
  screenshot?: string;
}

export interface TestResult {
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  failureType?: string;
}

export interface HealingResult {
  testName: string;
  originalStatus: string;
  healedStatus: string;
  fixApplied?: string;
  confidence: number;
}
