/**
 * Type definitions for the Autonomous QA Agent
 */

export interface GenerateTestRequest {
  testSteps: string;
  url: string;
  context?: Record<string, unknown>;
}

export interface GenerateTestResponse {
  fileName: string;
  code: string;
  timestamp: string;
  version: number;
}

export interface DOMElement {
  role: string;
  name: string;
  selector: string;
  placeholder?: string;
  type?: string;
}

export interface DOMResponse {
  elements: DOMElement[];
  url: string;
  title?: string;
  pageType?: string;
  timestamp?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  message: string;
  toolCalls?: ToolCall[];
  stop?: boolean;
}

export interface AgentState {
  steps: LLMMessage[];
  domData?: DOMResponse;
  generatedCode?: string;
  iteration: number;
}

export interface FileMetadata {
  fileName: string;
  version: number;
  timestamp: string;
  testSteps: string;
  url: string;
}

export interface ExecuteTestRequest {
  fileName: string;
  browsers?: string[]; // e.g., ['chromium', 'firefox', 'webkit']
}

export interface ExecutionResult {
  executionId: string;
  fileName: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  reportUrl?: string;
  logs: string[];
  error?: string;
  timestamp: string;
}

export interface ExecutionResponse {
  executionId: string;
  fileName: string;
  status: 'started' | 'processing';
  message: string;
}
