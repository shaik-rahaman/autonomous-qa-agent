export interface GenerateTestRequest {
  testSteps: string;
  url: string;
  context?: string;
}

export interface GenerateTestResponse {
  fileName: string;
  code: string;
  gherkin: string;
  timestamp: string;
  version: number;
}

export interface ExecuteTestRequest {
  fileName: string;
}

export interface HealedStep {
  step: string;
  oldSelector: string;
  newSelector: string;
}

export interface HealingDetails {
  originalError: string;
  originalSelector: string;
  newSelector: string;
  retryStatus: string;
}

export interface TimelineEvent {
  stage: 'run' | 'fail' | 'heal' | 'retry' | 'success';
  timestamp: number;
  message: string;
}

export interface ExecuteTestResponse {
  id: string;
  testFile: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  duration: number;
  results: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
  errors: string[];
  reportUrl?: string;
  healed?: boolean;
  reused?: boolean;
  retryCount?: number;
  timeline?: TimelineEvent[];
  healedSteps?: HealedStep[];
  healingDetails?: HealingDetails;
}

export interface ExecutionLogsResponse {
  id: string;
  logs: string[];
  errors: string[];
}

export interface MCPHealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

export type ExecutionStatus = 'idle' | 'running' | 'passed' | 'failed' | 'error';
export type MCPStatus = 'connected' | 'disconnected' | 'checking';
