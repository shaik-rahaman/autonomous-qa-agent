import axios, { AxiosError } from 'axios';
import {
  GenerateTestRequest,
  GenerateTestResponse,
  ExecuteTestRequest,
  ExecuteTestResponse,
  ExecutionLogsResponse,
  MCPHealthResponse,
} from '@/types/api';

// In development prefer the Vite proxy (relative `/api`) to avoid mixed localhost resolution issues.
const API_BASE_URL = import.meta.env.DEV
  ? '/api'
  : import.meta.env.VITE_API_BASE_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // Default timeout 60s for potentially long-running LLM + MCP operations
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Error handler
const handleError = (error: AxiosError) => {
  const message =
    error.response?.data instanceof Object
      ? (error.response.data as Record<string, string>).error ||
        (error.response.data as Record<string, string>).message ||
        'An error occurred'
      : error.message;

  console.error('API Error:', {
    status: error.response?.status,
    message,
    config: error.config,
  });

  return new Error(message);
};

export const apiService = {
  /**
   * Check MCP health status
   */
  async checkMcpHealth(): Promise<MCPHealthResponse> {
    try {
      const response = await apiClient.get<MCPHealthResponse>('/health');
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError);
    }
  },

  /**
   * Generate test script from test steps
   */
  async generateTest(request: GenerateTestRequest): Promise<GenerateTestResponse> {
    try {
      // Generate tests can be slow (LLM + MCP). Use extended timeout for this call.
      const response = await apiClient.post<GenerateTestResponse>('/generate-test', request, {
        timeout: 120000,
      });
      return response.data;
    } catch (error) {
      // Log full error for debugging before transforming
      console.error('generateTest error raw:', error);
      throw handleError(error as AxiosError);
    }
  },

  /**
   * Execute a test script
   */
  async executeTest(request: ExecuteTestRequest): Promise<ExecuteTestResponse> {
    try {
      const response = await apiClient.post<ExecuteTestResponse>('/execute', request);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError);
    }
  },

  /**
   * Get execution result by ID
   */
  async getExecutionResult(id: string): Promise<ExecuteTestResponse> {
    try {
      const response = await apiClient.get<ExecuteTestResponse>(`/execution/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError);
    }
  },

  /**
   * Get execution logs by ID
   */
  async getExecutionLogs(id: string): Promise<ExecutionLogsResponse> {
    try {
      const response = await apiClient.get<ExecutionLogsResponse>(`/execution/${id}/logs`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError);
    }
  },

  /**
   * Test Jira connection
   */
  async testJiraConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; message: string }>(
        '/jira/test-connection',
        {}
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError);
    }
  },
};
