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
  gherkin: string;
  timestamp: string;
  version: number;
  files?: {
    gherkinPath: string;
    scriptPath: string;
  };
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
  pageType?: string;
  title?: string;
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

/**
 * Jira Integration Types
 */
export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  fields?: {
    customfield_10000?: string; // Acceptance Criteria (custom field ID may vary)
    labels?: string[];
    priority?: { name: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JiraAcceptanceCriteria {
  criteria: string[];
  rawText: string;
}

export interface TransformedTestSteps {
  issueKey: string;
  issueSummary: string;
  rawContent: string;
  structuredSteps: string;
  normalizedSteps: string;
  normalizationMethod: 'parsing' | 'llm';
}

export interface JiraIssueWithSteps {
  issue: JiraIssue;
  transformedSteps: TransformedTestSteps;
}
