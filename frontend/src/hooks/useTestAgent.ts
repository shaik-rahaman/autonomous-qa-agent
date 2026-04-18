import { create } from 'zustand';
import { ExecutionStatus, MCPStatus, HealedStep, HealingDetails, TimelineEvent } from '@/types/api';

export interface TestAgentState {
  // Test case input
  testSteps: string;
  testUrl: string;
  setTestSteps: (steps: string) => void;
  setTestUrl: (url: string) => void;

  // Generated script
  script: string;
  gherkin: string;
  scriptFileName: string;
  scriptVersion: number;
  setScript: (code: string, fileName: string, version: number, gherkin?: string) => void;

  // Execution state
  executionStatus: ExecutionStatus;
  executionId: string;
  executionResults: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  } | null;
  setExecutionStatus: (status: ExecutionStatus) => void;
  setExecutionResults: (results: TestAgentState['executionResults']) => void;
  setExecutionId: (id: string) => void;

  // Healing state
  healed: boolean;
  reused: boolean;
  retryCount: number;
  healedSteps: HealedStep[];
  healingDetails: HealingDetails | null;
  timeline: TimelineEvent[];
  setHealed: (healed: boolean) => void;
  setReused: (reused: boolean) => void;
  setRetryCount: (count: number) => void;
  setHealedSteps: (steps: HealedStep[]) => void;
  setHealingDetails: (details: HealingDetails | null) => void;
  setTimeline: (events: TimelineEvent[]) => void;

  // Execution logs
  logs: string[];
  appendLog: (log: string) => void;
  clearLogs: () => void;

  // Report URL
  reportUrl: string;
  setReportUrl: (url: string) => void;

  // MCP status
  mcpStatus: MCPStatus;
  setMcpStatus: (status: MCPStatus) => void;

  // Loading and error states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;

  // Utility
  reset: () => void;
}

export const useTestAgent = create<TestAgentState>((set) => ({
  // Test case input
  testSteps: '',
  testUrl: '',
  setTestSteps: (steps) => set({ testSteps: steps }),
  setTestUrl: (url) => set({ testUrl: url }),

  // Generated script
  script: '',
  gherkin: '',
  scriptFileName: '',
  scriptVersion: 0,
  setScript: (code, fileName, version, gherkin = '') =>
    set({ script: code, scriptFileName: fileName, scriptVersion: version, gherkin }),

  // Execution state
  executionStatus: 'idle',
  executionId: '',
  executionResults: null,
  setExecutionStatus: (status) => set({ executionStatus: status }),
  setExecutionResults: (results) => set({ executionResults: results }),
  setExecutionId: (id) => set({ executionId: id }),

  // Healing state
  healed: false,
  reused: false,
  retryCount: 0,
  healedSteps: [],
  healingDetails: null,
  timeline: [],
  setHealed: (healed) => set({ healed }),
  setReused: (reused) => set({ reused }),
  setRetryCount: (count) => set({ retryCount: count }),
  setHealedSteps: (steps) => set({ healedSteps: steps }),
  setHealingDetails: (details) => set({ healingDetails: details }),
  setTimeline: (events) => set({ timeline: events }),

  // Execution logs
  logs: [],
  appendLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),

  // Report URL
  reportUrl: '',
  setReportUrl: (url) => set({ reportUrl: url }),

  // MCP status
  mcpStatus: 'checking',
  setMcpStatus: (status) => set({ mcpStatus: status }),

  // Loading and error states
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  error: null,
  setError: (error) => set({ error }),

  // Utility
  reset: () =>
    set({
      testSteps: '',
      testUrl: '',
      script: '',
      gherkin: '',
      scriptFileName: '',
      scriptVersion: 0,
      executionStatus: 'idle',
      executionId: '',
      executionResults: null,
      healed: false,
      reused: false,
      retryCount: 0,
      healedSteps: [],
      healingDetails: null,
      timeline: [],
      logs: [],
      reportUrl: '',
      error: null,
    }),
}));
