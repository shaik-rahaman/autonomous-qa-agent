import React, { useState, useEffect } from 'react';
import { apiService } from '@/utils/api-client';
import { Play, Copy, AlertCircle, CheckCircle, Clock, Zap, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ExecuteScriptPanelProps {
  onExecutionComplete?: (result: any) => void;
}

// localStorage keys for persistence
const STORAGE_KEYS = {
  SCRIPT: 'execute-script-content',
  URL: 'execute-script-url',
  RESULTS: 'execute-script-results',
  LOGS: 'execute-script-logs',
};

export const ExecuteScriptPanel = ({ onExecutionComplete }: ExecuteScriptPanelProps) => {
  const [script, setScript] = useState('');
  const [url, setUrl] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      console.log('Restoring Execute Script content from localStorage...');
      const savedScript = localStorage.getItem(STORAGE_KEYS.SCRIPT);
      const savedUrl = localStorage.getItem(STORAGE_KEYS.URL);
      const savedResults = localStorage.getItem(STORAGE_KEYS.RESULTS);
      const savedLogs = localStorage.getItem(STORAGE_KEYS.LOGS);

      if (savedScript) {
        console.log('[ExecuteScript] Restoring script:', savedScript.substring(0, 50) + '...');
        setScript(savedScript);
      }
      if (savedUrl) {
        console.log('[ExecuteScript] Restoring URL:', savedUrl);
        setUrl(savedUrl);
      }
      if (savedResults) {
        console.log('[ExecuteScript] Restoring results');
        setResult(JSON.parse(savedResults));
      }
      if (savedLogs) {
        console.log('[ExecuteScript] Restoring logs');
        setLogs(JSON.parse(savedLogs));
      }
    } catch (err) {
      console.error('Failed to restore Execute Script state from localStorage:', err);
    }
  }, []);

  // Save script to localStorage whenever it changes
  useEffect(() => {
    try {
      console.log('[ExecuteScript] Saving script content to localStorage');
      localStorage.setItem(STORAGE_KEYS.SCRIPT, script);
    } catch (err) {
      console.error('Failed to save script to localStorage:', err);
    }
  }, [script]);

  // Save URL to localStorage whenever it changes
  useEffect(() => {
    try {
      console.log('[ExecuteScript] Saving URL to localStorage');
      localStorage.setItem(STORAGE_KEYS.URL, url);
    } catch (err) {
      console.error('Failed to save URL to localStorage:', err);
    }
  }, [url]);

  // Save results to localStorage whenever they change
  useEffect(() => {
    try {
      if (result) {
        console.log('[ExecuteScript] Saving results to localStorage');
        localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(result));
      }
    } catch (err) {
      console.error('Failed to save results to localStorage:', err);
    }
  }, [result]);

  // Save logs to localStorage whenever they change
  useEffect(() => {
    try {
      if (logs.length > 0) {
        console.log('[ExecuteScript] Saving logs to localStorage');
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
    setError('');
    const executionLogs: string[] = [];

    try {
      executionLogs.push('[START] Executing script...');
      setLogs([...logs, ...executionLogs]);

      const response = await apiService.post<any>('/scripts/execute', {
        script,
        url,
      });

      executionLogs.push('[SUCCESS] Script executed successfully');
      setLogs((prevLogs) => [...prevLogs, ...executionLogs]);

      setResult(response);
      toast.success('Script executed successfully!');
      onExecutionComplete?.(response);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      executionLogs.push(`[ERROR] ${errorMsg}`);
      setLogs((prevLogs) => [...prevLogs, ...executionLogs]);

      setError(errorMsg);
      toast.error(`Execution failed: ${errorMsg}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClearResults = () => {
    console.log('[ExecuteScript] Clearing results');
    setResult(null);
    setError('');
    // Keep logs unless user explicitly clears them
    try {
      localStorage.removeItem(STORAGE_KEYS.RESULTS);
    } catch (err) {
      console.error('Failed to clear results from localStorage:', err);
    }
    toast.success('Results cleared!');
  };

  const handleClearLogs = () => {
    console.log('[ExecuteScript] Clearing logs');
    setLogs([]);
    try {
      localStorage.removeItem(STORAGE_KEYS.LOGS);
    } catch (err) {
      console.error('Failed to clear logs from localStorage:', err);
    }
    toast.success('Logs cleared!');
  };

  const handlePasteExample = () => {
    const example = `import { test, expect } from '@playwright/test';

test('example test', async ({ page }) => {
  // Navigate to application
  await page.goto('https://example.com');
  
  // Wait for load
  await page.waitForLoadState('networkidle');
  
  // Interact with element
  await page.fill('input[name="search"]', 'test');
  await page.click('button[type="submit"]');
  
  // Assert result
  await expect(page.locator('.result')).toBeVisible();
});`;
    setScript(example);
    toast.success('Example script pasted!');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Script Input Section */}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="block text-sm font-bold text-white">
            📝 Playwright Script
          </label>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            disabled={isExecuting}
            placeholder="Paste your Playwright test script here..."
            className="w-full h-64 bg-gray-900 border border-gray-700 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handlePasteExample}
            disabled={isExecuting}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            📋 Paste Example
          </button>
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
            placeholder="https://example.com"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />

          {/* Execution Button */}
          <button
            onClick={handleExecute}
            disabled={isExecuting || !script.trim() || !url.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 mt-8"
          >
            <Play className="w-5 h-5" />
            {isExecuting ? 'Executing...' : 'Execute Script'}
          </button>

          {error && (
            <div className="bg-red-900/20 border border-red-600 rounded-lg p-3 text-red-300 text-sm">
              <p className="font-bold mb-1">❌ Error</p>
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Execution Logs Panel - Always visible */}
      {logs.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              📋 Execution Logs ({logs.length})
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

      {/* Results Section */}
      {result && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              {getStatusIcon(result.status)}
              Execution Results
            </h3>
            <button
              onClick={handleClearResults}
              className="text-sm text-gray-400 hover:text-red-400 flex items-center gap-1"
              title="Clear results"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              result.status === 'passed' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
            }`}>
              {result.status.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded p-3">
              <p className="text-gray-400 text-xs mb-1">PASSED</p>
              <p className="text-2xl font-bold text-green-400">{result.results?.passed || 0}</p>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <p className="text-gray-400 text-xs mb-1">FAILED</p>
              <p className="text-2xl font-bold text-red-400">{result.results?.failed || 0}</p>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <p className="text-gray-400 text-xs mb-1">DURATION</p>
              <p className="text-2xl font-bold text-yellow-400">{result.duration}ms</p>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <p className="text-gray-400 text-xs mb-1">HEALED</p>
              <p className="text-2xl font-bold text-blue-400">{result.healed ? '✓' : '✗'}</p>
            </div>
          </div>

          {result.healingDetails && (
            <div className="bg-blue-900/20 border border-blue-600 rounded p-3 space-y-2">
              <p className="font-bold text-blue-300">⚡ Healing Applied</p>
              <p className="text-sm text-blue-200">
                <span className="font-bold">Original:</span> {result.healingDetails.originalSelector}
              </p>
              <p className="text-sm text-blue-200">
                <span className="font-bold">Healed:</span> {result.healingDetails.newSelector}
              </p>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="bg-red-900/20 border border-red-600 rounded p-3">
              <p className="font-bold text-red-300 mb-2">Errors</p>
              {result.errors.map((err: string, idx: number) => (
                <p key={idx} className="text-sm text-red-200 mb-1">{err}</p>
              ))}
            </div>
          )}

          {result.reportUrl && (
            <a
              href={result.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-blue-400 hover:text-blue-300 underline text-sm"
            >
              📊 View Playwright Report →
            </a>
          )}
        </div>
      )}
    </div>
  );
};
