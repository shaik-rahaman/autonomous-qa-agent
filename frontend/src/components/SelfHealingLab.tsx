import React, { useState, useEffect } from 'react';
import { apiService } from '@/utils/api-client';
import healingService from '@/services/healingService';
import { Play, AlertCircle, CheckCircle, Zap, Brain, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

type FailureType = 'STRICT_MODE' | 'ELEMENT_NOT_FOUND' | 'TIMEOUT' | 'NONE';

interface SelfHealingLabProps {
  onExecutionComplete?: (result: any) => void;
}

const FAILURE_DESCRIPTIONS: Record<FailureType, string> = {
  STRICT_MODE: 'Replace role-based selectors with weak text selectors to trigger strict mode violations',
  ELEMENT_NOT_FOUND: 'Change selector names to invalid ones to trigger element not found errors',
  TIMEOUT: 'Reduce visibility timeout to 100ms to trigger timeout errors',
  NONE: 'Execute script as-is without intentional failures',
};

// localStorage keys
const STORAGE_KEYS = {
  SCRIPT: 'healing-lab-script',
  URL: 'healing-lab-url',
  FAILURE_TYPE: 'healing-lab-failure-type',
  RESULTS: 'healing-lab-results',
  LOGS: 'healing-lab-logs',
};

export const SelfHealingLab = ({ onExecutionComplete }: SelfHealingLabProps) => {
  const [script, setScript] = useState('');
  const [url, setUrl] = useState('');
  const [failureType, setFailureType] = useState<FailureType>('STRICT_MODE');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      console.log('Restoring Healing Lab content from localStorage...');
      const savedScript = localStorage.getItem(STORAGE_KEYS.SCRIPT);
      const savedUrl = localStorage.getItem(STORAGE_KEYS.URL);
      const savedFailureType = localStorage.getItem(STORAGE_KEYS.FAILURE_TYPE) as FailureType;
      const savedResults = localStorage.getItem(STORAGE_KEYS.RESULTS);
      const savedLogs = localStorage.getItem(STORAGE_KEYS.LOGS);

      if (savedScript) {
        console.log('[HealingLab] Restoring script');
        setScript(savedScript);
      }
      if (savedUrl) {
        console.log('[HealingLab] Restoring URL');
        setUrl(savedUrl);
      }
      if (savedFailureType) {
        console.log('[HealingLab] Restoring failure type');
        setFailureType(savedFailureType);
      }
      if (savedResults) {
        console.log('[HealingLab] Restoring results');
        setResult(JSON.parse(savedResults));
      }
      if (savedLogs) {
        console.log('[HealingLab] Restoring logs');
        setLogs(JSON.parse(savedLogs));
      }
    } catch (err) {
      console.error('Failed to restore Healing Lab state from localStorage:', err);
    }
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SCRIPT, script);
    } catch (err) {
      console.error('Failed to save script to localStorage:', err);
    }
  }, [script]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.URL, url);
    } catch (err) {
      console.error('Failed to save URL to localStorage:', err);
    }
  }, [url]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.FAILURE_TYPE, failureType);
    } catch (err) {
      console.error('Failed to save failureType to localStorage:', err);
    }
  }, [failureType]);

  useEffect(() => {
    try {
      if (result) {
        localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(result));
      }
    } catch (err) {
      console.error('Failed to save results to localStorage:', err);
    }
  }, [result]);

  useEffect(() => {
    try {
      if (logs.length > 0) {
        console.log('[HealingLab] Saving logs to localStorage');
        localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
      }
    } catch (err) {
      console.error('Failed to save logs to localStorage:', err);
    }
  }, [logs]);

  const handleExecute = async () => {
    if (!script.trim()) {
      toast.error('Please paste a Playwright script');
      return;
    }

    if (!url.trim()) {
      toast.error('Please enter the target URL');
      return;
    }

    setIsExecuting(true);
    setError(''); // Clear previous errors
    setResult(null); // Clear previous results
    const executionLogs: string[] = [];

    try {
      executionLogs.push(`[START] Starting Healing Lab with failure type: ${failureType}`);
      setLogs([...logs, ...executionLogs]);

      // Run healing with extended timeout and progress tracking
      const response = await healingService.runHealingLab(
        {
          script,
          failureType,
          url,
        },
        (update) => {
          // Handle progress updates
          console.log('[HEALING-LAB] Progress update:', update);
          if (update.message) {
            executionLogs.push(`[PROGRESS] ${update.message}`);
            setLogs((prevLogs) => [...prevLogs, `[PROGRESS] ${update.message}`]);
          }
        }
      );

      // ✅ Validate response structure
      if (!response) {
        throw new Error('Empty response from healing lab');
      }

      // ✅ Check explicit success state: status === 'passed' && healed === true
      if (response.status === 'passed' && response.healed === true) {
        const successMsg = `Healing Lab completed: HEALING SUCCESS`;
        executionLogs.push(`[SUCCESS] ${successMsg}`);
        setLogs((prevLogs) => [...prevLogs, ...executionLogs]);
        
        setResult(response);
        toast.success(successMsg);
        onExecutionComplete?.(response);
      } else if (response.status === 'failed') {
        const failMsg = `Healing Lab completed: HEALING FAILED - ${response.reason || 'Unknown reason'}`;
        executionLogs.push(`[FAILED] ${failMsg}`);
        setLogs((prevLogs) => [...prevLogs, ...executionLogs]);
        
        setResult(response);
        toast.error(failMsg);
        onExecutionComplete?.(response);
      } else {
        const errorMsg = `Unexpected response status: ${response.status}`;
        executionLogs.push(`[ERROR] ${errorMsg}`);
        setLogs((prevLogs) => [...prevLogs, ...executionLogs]);
        
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const fullErrorMsg = `[ERROR] ${errorMsg}`;
      executionLogs.push(fullErrorMsg);
      setLogs((prevLogs) => [...prevLogs, ...executionLogs]);

      console.error('[HEALING-LAB] Execution error:', err);
      setError(errorMsg);
      toast.error(`Execution failed: ${errorMsg}`);
    } finally {
      // Always clear loading state
      setIsExecuting(false);
    }
  };

  const handleClearResults = () => {
    console.log('[HealingLab] Clearing results');
    setResult(null);
    setError('');
    // Keep logs unless user explicitly clears them
    try {
      localStorage.removeItem(STORAGE_KEYS.RESULTS);
    } catch (err) {
      console.error('Failed to clear results from localStorage:', err);
    }
    toast.success('Results cleared');
  };

  const handleClearLogs = () => {
    console.log('[HealingLab] Clearing logs');
    setLogs([]);
    try {
      localStorage.removeItem(STORAGE_KEYS.LOGS);
    } catch (err) {
      console.error('Failed to clear logs from localStorage:', err);
    }
    toast.success('Logs cleared');
  };

  const handleClearAll = () => {
    if (confirm('Clear all saved data? This cannot be undone.')) {
      console.log('[HealingLab] Clearing all saved data');
      setScript('');
      setUrl('');
      setFailureType('STRICT_MODE');
      setResult(null);
      setError('');
      setLogs([]);
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
      toast.success('All data cleared');
    }
  };

  const handlePasteOrangeHRMExample = () => {
    const example = `import { test, expect } from '@playwright/test';

test('OrangeHRM Login & Dashboard', async ({ page }) => {
  // Navigate to OrangeHRM
  await page.goto('https://opensource-demo.orangehrm.com/');
  
  // Wait for load
  await page.waitForLoadState('networkidle');
  
  // Fill credentials
  await page.locator('input[name="username"]').fill('Admin');
  await page.locator('input[name="password"]').fill('admin123');
  
  // Click login
  await page.getByRole('button', { name: /login/i }).click();
  
  // Wait for navigation
  await page.waitForURL(/dashboard/i);
  await page.waitForLoadState('networkidle');
  
  // Verify dashboard
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  
  // Verify some dashboard elements
  await expect(page.getByText(/Quick Launch/i)).toBeVisible();
});`;
    setScript(example);
    toast.success('OrangeHRM example script pasted!');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      default:
        return <AlertCircle className="w-5 h-5 text-yellow-400" />;
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'HIGH':
        return 'bg-green-900/30 text-green-400 border-green-600';
      case 'MEDIUM':
        return 'bg-yellow-900/30 text-yellow-400 border-yellow-600';
      case 'LOW':
        return 'bg-red-900/30 text-red-400 border-red-600';
      default:
        return 'bg-gray-900/30 text-gray-400 border-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Section A: Script Editor */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">📝 Section A: Script Editor</h3>
          <button
            onClick={handleClearAll}
            className="text-sm text-gray-400 hover:text-red-400 flex items-center gap-1"
            title="Clear all saved data"
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </button>
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={isExecuting}
          placeholder="Paste your Playwright test script here..."
          className="w-full h-48 bg-gray-900 border border-gray-700 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <div className="flex gap-2">
          <button
            onClick={handlePasteOrangeHRMExample}
            disabled={isExecuting}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            📋 Paste OrangeHRM Example
          </button>
          <span className="text-xs text-gray-500 ml-auto">
            {script.length} characters • Auto-saved
          </span>
        </div>
      </div>

      {/* Section B: Configuration */}
      <div className="grid grid-cols-2 gap-6 bg-gray-900/50 border border-gray-700 rounded-lg p-6">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold text-white mb-2">
              🎯 Section B: Failure Type
            </label>
            <select
              value={failureType}
              onChange={(e) => setFailureType(e.target.value as FailureType)}
              disabled={isExecuting}
              className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="NONE">None (Normal execution)</option>
              <option value="STRICT_MODE">Strict Mode Violation</option>
              <option value="ELEMENT_NOT_FOUND">Element Not Found</option>
              <option value="TIMEOUT">Timeout/Visibility</option>
            </select>
            <p className="text-xs text-gray-400 mt-2">{FAILURE_DESCRIPTIONS[failureType]}</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-bold text-white">
            🌐 Target URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isExecuting}
            placeholder="https://opensource-demo.orangehrm.com"
            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <p className="text-xs text-gray-500">Auto-saved</p>
        </div>
      </div>

      {/* Section C: Execute Button */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white">⚡ Section C: Execute With Healing</h3>
        <button
          onClick={handleExecute}
          disabled={isExecuting || !script.trim() || !url.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
        >
          <Zap className="w-5 h-5" />
          {isExecuting ? 'Executing & Healing...' : 'Execute With Healing'}
        </button>

        {error && !result && (
          <div className="bg-red-900/20 border border-red-600 rounded-lg p-3 text-red-300 text-sm">
            <p className="font-bold mb-1">❌ Error</p>
            <p>{error}</p>
          </div>
        )}
      </div>

      {/* Execution Logs Panel - Always visible */}
      {logs.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              📋 Healing Lab Logs ({logs.length})
            </h3>
            <button
              onClick={handleClearLogs}
              className="text-sm text-gray-400 hover:text-red-400 flex items-center gap-1"
              title="Clear all logs"
            >
              <Trash2 className="w-4 h-4" />
              Clear Logs
            </button>
          </div>

          {/* Scrollable Logs Container */}
          <div className="bg-gray-800 rounded p-4 space-y-3">
            <div className="space-y-2 max-h-80 overflow-y-auto bg-gray-900 p-3 rounded border border-gray-700 font-mono text-xs">
              {logs.map((log: string, idx: number) => {
                // Color-code log entries based on type
                let logColor = 'text-gray-300';
                if (log.includes('[ERROR]')) logColor = 'text-red-400';
                else if (log.includes('[SUCCESS]')) logColor = 'text-green-400';
                else if (log.includes('[START]')) logColor = 'text-blue-400';
                else if (log.includes('[WARNING]')) logColor = 'text-yellow-400';

                return (
                  <div key={idx} className={`${logColor}`}>
                    <span className="text-gray-600">[{idx + 1}]</span> {log}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Healing Diagnostics Panel */}
      {result && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-400" />
              <h3 className="text-lg font-bold text-white">🔬 Healing Diagnostics Panel</h3>
            </div>
            <button
              onClick={handleClearResults}
              className="text-sm text-gray-400 hover:text-red-400 flex items-center gap-1"
              title="Clear results"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-4">
            {/* Failure Type */}
            <div className="bg-gray-800 rounded p-4">
              <p className="text-gray-400 text-xs uppercase mb-1">Failure Type</p>
              <p className="text-white font-bold text-lg">
                {result.healingDiagnostics?.failureInjected || 'NONE'}
              </p>
            </div>

            {/* Status */}
            <div className="bg-gray-800 rounded p-4 flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs uppercase mb-1">Status</p>
                <p className="text-white font-bold">{result.status.toUpperCase()}</p>
              </div>
              {getStatusIcon(result.status)}
            </div>

            {/* Healing Applied */}
            <div className="bg-gray-800 rounded p-4">
              <p className="text-gray-400 text-xs uppercase mb-1">Healing</p>
              <p className="text-2xl font-bold">
                {result.healed ? (
                  <span className="text-green-400">✓ YES</span>
                ) : (
                  <span className="text-red-400">✗ NO</span>
                )}
              </p>
            </div>

            {/* Confidence */}
            <div className="bg-gray-800 rounded p-4">
              <p className="text-gray-400 text-xs uppercase mb-1">Confidence</p>
              <div className={`font-bold px-2 py-1 rounded text-sm inline-block border ${getConfidenceColor(
                result.healingDiagnostics?.confidence || 'UNKNOWN'
              )}`}>
                {result.healingDiagnostics?.confidence || 'UNKNOWN'}
              </div>
            </div>
          </div>

          {/* Locator Information - Main Healing Details */}
          <div className="bg-gray-800 rounded p-4 space-y-4 border-l-4 border-blue-500">
            <p className="font-bold text-white mb-3">📍 Failed & Healed Locators</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-xs uppercase mb-2">❌ Original (Failed)</p>
                <code className="block bg-gray-900 p-3 rounded text-yellow-400 text-xs font-mono break-words border border-yellow-600/30">
                  {result.healingDiagnostics?.originalSelector || result.healingDetails?.originalSelector || 'N/A'}
                </code>
              </div>

              {result.healed && (
                <div>
                  <p className="text-gray-400 text-xs uppercase mb-2">✅ Healed (New)</p>
                  <code className="block bg-gray-900 p-3 rounded text-green-400 text-xs font-mono break-words border border-green-600/30">
                    {result.healingDiagnostics?.healedSelector || result.healingDetails?.newSelector || 'N/A'}
                  </code>
                </div>
              )}
            </div>

            {result.healed && (
              <div>
                <p className="text-gray-400 text-xs uppercase mb-2">🔧 Healing Strategy</p>
                <p className="text-white font-mono text-sm bg-gray-900 p-2 rounded">
                  {result.healingDetails?.strategy || 'Automatic healing applied'}
                </p>
              </div>
            )}
          </div>

          {/* Healing Candidate Selectors (if available) */}
          {result.healingDiagnostics?.candidateSelectors && result.healingDiagnostics.candidateSelectors.length > 0 && (
            <div className="bg-gray-800 rounded p-4 space-y-3">
              <p className="font-bold text-white mb-2">🎯 Alternative Candidates Considered</p>
              <div className="space-y-2">
                {result.healingDiagnostics.candidateSelectors.map((candidate: any, idx: number) => (
                  <div key={idx} className="bg-gray-900 p-3 rounded border border-gray-700 text-xs">
                    <div className="flex justify-between items-start gap-2">
                      <code className="text-blue-400 font-mono break-all flex-1">
                        {candidate.selector}
                      </code>
                      {candidate.confidence && (
                        <span className={`whitespace-nowrap px-2 py-1 rounded text-xs font-bold ${
                          candidate.confidence > 80 ? 'bg-green-900/30 text-green-400' :
                          candidate.confidence > 50 ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-gray-900/30 text-gray-400'
                        }`}>
                          {candidate.confidence}%
                        </span>
                      )}
                    </div>
                    {candidate.strategy && (
                      <p className="text-gray-400 mt-1">Strategy: {candidate.strategy}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Test Results Summary */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-green-900/20 rounded p-3 border border-green-600">
              <p className="text-green-400 text-xs uppercase mb-1">Passed</p>
              <p className="text-2xl font-bold text-green-400">{result.results?.passed || 0}</p>
            </div>
            <div className="bg-red-900/20 rounded p-3 border border-red-600">
              <p className="text-red-400 text-xs uppercase mb-1">Failed</p>
              <p className="text-2xl font-bold text-red-400">{result.results?.failed || 0}</p>
            </div>
            <div className="bg-blue-900/20 rounded p-3 border border-blue-600">
              <p className="text-blue-400 text-xs uppercase mb-1">Duration</p>
              <p className="text-2xl font-bold text-blue-400">{result.duration}ms</p>
            </div>
            <div className="bg-purple-900/20 rounded p-3 border border-purple-600">
              <p className="text-purple-400 text-xs uppercase mb-1">Retries</p>
              <p className="text-2xl font-bold text-purple-400">{result.retryCount || 0}</p>
            </div>
          </div>

          {/* Execution Timeline / Logs */}
          {result.timeline && result.timeline.length > 0 && (
            <div className="bg-gray-800 rounded p-4 space-y-3">
              <p className="font-bold text-white mb-3">📝 Execution Timeline</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {result.timeline.map((event: any, idx: number) => (
                  <div key={idx} className="bg-gray-900 p-2 rounded text-xs border-l-4" style={{
                    borderColor: event.stage === 'success' ? '#10b981' :
                                 event.stage === 'heal' ? '#f59e0b' :
                                 event.stage === 'fail' ? '#ef4444' : '#6b7280'
                  }}>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-bold text-gray-400">[{event.stage.toUpperCase()}]</span>
                      <span className="text-gray-500">{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-gray-300 mt-1">{event.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {result.errors && result.errors.length > 0 && (
            <div className="bg-red-900/20 border border-red-600 rounded p-4">
              <p className="font-bold text-red-300 mb-2">❌ Execution Errors</p>
              {result.errors.map((err: string, idx: number) => (
                <p key={idx} className="text-sm text-red-200 mb-1 font-mono">• {err}</p>
              ))}
            </div>
          )}

          {/* Report Link */}
          {result.reportUrl && (
            <div className="pt-4 border-t border-gray-700">
              <a
                href={result.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-blue-400 hover:text-blue-300 underline text-sm font-bold"
              >
                📊 View Full Playwright Report →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
