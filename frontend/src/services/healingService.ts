/**
 * Healing Lab Service - Handles API calls with extended timeout support
 * 
 * Features:
 * - 5-minute timeout (instead of default 5 seconds)
 * - Proper progress streaming
 * - Comprehensive error handling
 * - Response validation
 */

import axios, { AxiosError } from 'axios';

// Extended timeout for long-running healing operations (5 minutes)
const HEALING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Get API base URL (same as api-client.ts)
const API_BASE_URL = import.meta.env.DEV
  ? '/api'
  : import.meta.env.VITE_API_BASE_URL || '/api';

// Create a dedicated axios instance for healing operations
const healingClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: HEALING_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface HealingLabRequest {
  script: string;
  failureType: string;
  url: string;
}

export interface HealingLabResponse {
  status: 'passed' | 'failed' | 'error';
  healed: boolean;
  failedSelector?: string;
  healedSelector?: string;
  reason?: string;
  message?: string;
  results?: {
    passed: number;
    failed: number;
  };
  healingDetails?: {
    originalSelector: string;
    newSelector: string;
    strategy?: string;
  };
  healingDiagnostics?: any;
  duration?: number;
  retryCount?: number;
  timeline?: any[];
  errors?: string[];
  reportUrl?: string;
}

interface ProgressUpdate {
  progress: number;
  message: string;
  status: 'running' | 'passed' | 'failed' | 'error';
}

/**
 * Run healing lab with extended timeout and progress tracking
 */
export async function runHealingLab(
  request: HealingLabRequest,
  onProgress?: (update: ProgressUpdate) => void
): Promise<HealingLabResponse> {
  const controller = new AbortController();
  
  console.log('[HEALING-SERVICE] REQUEST_START', {
    url: request.url,
    failureType: request.failureType,
    scriptLength: request.script.length,
    timeout: HEALING_TIMEOUT_MS,
  });

  // Set up timeout handler
  const timeoutId = setTimeout(() => {
    console.error('[HEALING-SERVICE] Timeout exceeded, aborting request');
    controller.abort();
  }, HEALING_TIMEOUT_MS);

  try {
    // Track progress updates
    let lastProgressUpdate = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - lastProgressUpdate;
      if (elapsed > 30000 && onProgress) {
        // Send keepalive every 30 seconds
        onProgress({
          progress: 50, // Unknown progress
          message: `Healing in progress... (${Math.floor(elapsed / 1000)}s)`,
          status: 'running',
        });
      }
    }, 30000);

    try {
      // Make request with extended timeout and abort controller
      const response = await healingClient.post<HealingLabResponse>(
        '/healing-lab/run',
        request,
        {
          signal: controller.signal,
        }
      );

      console.log('[HEALING-SERVICE] REQUEST_END', {
        status: response.status,
        statusText: response.statusText,
      });

      const data = response.data;
      console.log('[HEALING-SERVICE] API_RESPONSE', data);

      clearTimeout(timeoutId);
      clearInterval(progressInterval);

      // Validate response structure
      if (!data) {
        throw new Error('Empty response from healing lab');
      }

      // Normalize response - check both status and healed fields
      console.log('[HEALING-SERVICE] Response validation', {
        status: data.status,
        healed: data.healed,
        hasErrors: !!data.errors && data.errors.length > 0,
      });

      // ✅ SUCCESS: Check for passed status with healed=true
      if (data.status === 'passed' && data.healed === true) {
        console.log('[HEALING-SERVICE] ✅ SUCCESS: Healing passed');
        
        onProgress?.({
          progress: 100,
          message: 'Healing completed successfully',
          status: 'passed',
        });

        return data;
      }

      // ❌ FAILURE: Check for failed status
      if (data.status === 'failed') {
        console.log('[HEALING-SERVICE] ❌ FAILED: Healing did not pass');
        
        onProgress?.({
          progress: 100,
          message: `Healing failed: ${data.reason || 'Unknown error'}`,
          status: 'failed',
        });

        return data;
      }

      // ⚠️ ERROR: Check for error status
      if (data.status === 'error') {
        console.log('[HEALING-SERVICE] ⚠️ ERROR: API error response');
        
        onProgress?.({
          progress: 100,
          message: `Error: ${data.message || 'Unknown error'}`,
          status: 'error',
        });

        return data;
      }

      // 🤔 UNKNOWN: Unexpected status
      console.warn('[HEALING-SERVICE] UNKNOWN: Unexpected status', data.status);
      
      onProgress?.({
        progress: 100,
        message: `Unexpected response status: ${data.status}`,
        status: 'error',
      });

      return data;
    } finally {
      clearInterval(progressInterval);
    }
  } catch (error: any) {
    console.error('[HEALING-SERVICE] CATCH_ERROR', {
      message: error.message,
      code: error.code,
      name: error.name,
    });

    clearTimeout(timeoutId);

    // Handle different error types
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      const errorMsg = 'Healing operation timeout: Request exceeded 5 minutes';
      console.error('[HEALING-SERVICE] Timeout error:', errorMsg);
      
      onProgress?.({
        progress: 100,
        message: errorMsg,
        status: 'error',
      });

      throw new Error(errorMsg);
    }

    if (error.response?.status === 504) {
      const errorMsg = 'Healing operation timeout on server (Gateway Timeout)';
      console.error('[HEALING-SERVICE] Server timeout:', errorMsg);
      
      onProgress?.({
        progress: 100,
        message: errorMsg,
        status: 'error',
      });

      throw new Error(errorMsg);
    }

    // Check if we have a successful response despite error
    if (error.response?.data?.status === 'passed') {
      console.log('[HEALING-SERVICE] ✅ Success despite HTTP error');
      return error.response.data;
    }

    // Network or other axios error
    const errorMsg = error.message || 'Unknown error';
    console.error('[HEALING-SERVICE] Error:', errorMsg);
    
    onProgress?.({
      progress: 100,
      message: errorMsg,
      status: 'error',
    });

    throw error;
  }
}

export default {
  runHealingLab,
};
