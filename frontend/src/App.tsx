import { useState, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { useTestAgent } from '@/hooks/useTestAgent';
import { apiService } from '@/utils/api-client';
import { MCPStatusIndicator } from '@/components/MCPStatusIndicator';
import { JiraConnectionStatus } from '@/components/JiraConnectionStatus';
import { TestCaseInput } from '@/components/TestCaseInput';
import { ScriptEditor } from '@/components/ScriptEditor';
import { ExecutionPanel } from '@/components/ExecutionPanel';
import { LogsViewer } from '@/components/LogsViewer';
import { JiraIntegration } from '@/components/JiraIntegration';
import { TestStatusSummary } from '@/components/TestStatusSummary';
import { TestReportHeader } from '@/components/TestReportHeader';

type TabType = 'logs' | 'report';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  const {
    testSteps,
    testUrl,
    script,
    isLoading,
    setIsLoading,
    error,
    setError,
    setScript,
    setExecutionStatus,
    setExecutionId,
    appendLog,
    setExecutionResults,
    executionId,
    clearLogs,
    setReportUrl,
    setHealed,
    setReused,
    setRetryCount,
    setHealedSteps,
    setHealingDetails,
    setTimeline,
  } = useTestAgent();

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  const handleGenerateTest = async () => {
    if (!testSteps.trim() || !testUrl.trim()) {
      toast.error('Please enter test steps and URL');
      return;
    }

    setIsLoading(true);
    setError(null);
    clearLogs();

    try {
      appendLog('[INFO] Generating test script with Gherkin BDD...');
      const response = await apiService.generateTest({
        testSteps,
        url: testUrl,
      });

      // Debug logging for API response
      console.log('🔍 API Response Full:', response);
      console.log('🔍 API Response Debug:', {
        hasGherkin: !!response.gherkin,
        gherkinLength: response.gherkin?.length || 0,
        hasScript: !!response.code,
        scriptLength: response.code?.length || 0,
        fileName: response.fileName,
        version: response.version,
      });

      setScript(response.code, response.fileName, response.version, response.gherkin);
      
      console.log('🔍 After setScript, state should have gherkin:', {
        gherkin: response.gherkin?.substring(0, 50) || 'EMPTY',
      });

      appendLog(`[SUCCESS] Test script generated: ${response.fileName} (v${response.version})`);
      if (response.gherkin) {
        appendLog(`[INFO] Gherkin BDD format created (${response.gherkin.length} chars)`);
      } else {
        appendLog(`[WARNING] Gherkin format not generated`);
      }
      setActiveTab('logs');
      toast.success('Test script generated with Gherkin!');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate test';
      setError(errorMsg);
      appendLog(`[ERROR] ${errorMsg}`);
      toast.error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const pollExecutionResult = (id: string) => {
    let pollCount = 0;
    const maxPolls = 120; // 2 minutes max
    let isCompleted = false;

    const poll = async () => {
      // Stop polling if test has already completed
      if (isCompleted) return;

      try {
        pollCount++;
        const result = await apiService.getExecutionResult(id);

        appendLog(`[POLL] Status: ${result.status}`);

        if (result.status === 'passed' || result.status === 'failed') {
          isCompleted = true;
          setExecutionStatus(result.status);
          setExecutionResults(result.results);
          
          // Set healing information
          if (result.healed !== undefined) {
            setHealed(result.healed);
            appendLog(`[HEALING] Self-healing ${result.healed ? 'APPLIED' : 'NOT APPLIED'}`);
          }
          
          if (result.reused !== undefined) {
            setReused(result.reused);
            if (result.reused) {
              appendLog(`[REUSE] Previously healed selector was reused`);
            }
          }
          
          if (result.retryCount !== undefined) {
            setRetryCount(result.retryCount);
            appendLog(`[RETRIES] Retry count: ${result.retryCount}`);
          }
          
          if (result.healedSteps && result.healedSteps.length > 0) {
            setHealedSteps(result.healedSteps);
            appendLog(`[HEALING] ${result.healedSteps.length} steps were healed`);
          }
          
          if (result.healingDetails) {
            setHealingDetails(result.healingDetails);
            appendLog(`[HEALING] Healed with selector: ${result.healingDetails.newSelector}`);
          }
          
          if (result.timeline && result.timeline.length > 0) {
            setTimeline(result.timeline);
            appendLog(`[INFO] Timeline with ${result.timeline.length} events captured`);
          }
          
          appendLog(`[COMPLETE] Test ${result.status} - Duration: ${result.duration}ms`);

          // Set report URL if provided by backend
          if (result.reportUrl) {
            setReportUrl(result.reportUrl);
            appendLog(`[INFO] Report available at: ${result.reportUrl}`);
          }

          // Stop polling and clear interval
          if (pollInterval) clearInterval(pollInterval);
          setPollInterval(null);

          // Auto-switch to report tab when test completes
          setActiveTab('report');

          if (result.status === 'passed') {
            toast.success('Test passed!');
          } else {
            toast.error(`Test failed: ${result.errors.join(', ')}`);
            appendLog(`[ERRORS] ${result.errors.join('\n')}`);
          }

          setIsLoading(false);
        } else if (pollCount > maxPolls) {
          isCompleted = true;
          setExecutionStatus('error');
          appendLog('[ERROR] Execution timeout (exceeded 2 minutes)');
          if (pollInterval) clearInterval(pollInterval);
          setPollInterval(null);
          setIsLoading(false);
          toast.error('Test execution timeout');
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch result';
        appendLog(`[ERROR] ${errorMsg}`);
      }
    };

    // Initial poll
    poll();

    // Set interval for subsequent polls - increased from 1000ms to 2000ms to reduce server load
    const interval = setInterval(poll, 2000);
    setPollInterval(interval);
  };

  const handleExecuteTest = async () => {
    if (!script) {
      toast.error('Please generate a test script first');
      return;
    }

    // Use the actual generated file name from the test agent state
    const { scriptFileName } = useTestAgent.getState();
    
    if (!scriptFileName) {
      toast.error('Test file name not found. Please regenerate the test.');
      return;
    }

    setIsLoading(true);
    setError(null);
    clearLogs();
    setExecutionStatus('running');
    
    // Reset healing information
    setHealed(false);
    setReused(false);
    setRetryCount(0);
    setHealedSteps([]);
    setHealingDetails(null);
    setTimeline([]);
    
    setActiveTab('logs');

    try {
      appendLog('[INFO] Executing test...');
      const response = await apiService.executeTest({
        fileName: scriptFileName, // Use actual generated file name
      });

      setExecutionId(response.id);
      appendLog(`[INFO] Execution ID: ${response.id}`);
      appendLog(`[INFO] Test File: ${scriptFileName}`);

      // Start polling for results
      pollExecutionResult(response.id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to execute test';
      setError(errorMsg);
      setExecutionStatus('error');
      appendLog(`[ERROR] ${errorMsg}`);
      toast.error(errorMsg);
      setIsLoading(false);
    }
  };

  const handleRetryTest = async () => {
    if (!executionId) {
      toast.error('No previous execution found');
      return;
    }
    await handleExecuteTest();
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-gray-900 text-gray-200 overflow-hidden">
      <Toaster position="top-right" />

      {/* Enhanced Top Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-7 py-5 flex items-center justify-between flex-shrink-0 shadow-lg">
        <div className="flex items-center gap-4">
          {/* Logo and Title */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center font-bold text-white shadow-lg">
              <span className="text-lg">⚡</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-white tracking-tight">Autonomous QA Agent</h1>
              <p className="text-xs text-gray-400 font-medium">Enterprise Test Orchestration Platform</p>
            </div>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-3">
          <JiraConnectionStatus />
          <MCPStatusIndicator />
        </div>
      </header>

      {/* Main Content Area - 3-Column Layout */}
      <div className="flex-1 flex overflow-hidden gap-4 p-6" style={{ backgroundColor: '#111827' }}>
        {/* LEFT COLUMN: Inputs & Integration - Hidden in Report tab but stays in layout */}
        <div className={`w-96 flex flex-col gap-5 overflow-y-auto pr-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent ${activeTab === 'report' ? 'hidden' : ''}`}>
          {/* Jira Integration Card */}
          <div className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 rounded-2xl shadow-md border-2 border-purple-500/40 p-5 flex-shrink-0 min-h-0">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-6 h-6 rounded-lg bg-purple-600/30 flex items-center justify-center text-purple-300 text-lg font-bold flex-shrink-0">🔗</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white tracking-wide break-words">Jira Integration</h2>
                <p className="text-xs text-purple-300/60 font-medium mt-0.5 break-words">Fetch & transform issues</p>
              </div>
            </div>
            <div className="border-t border-purple-500/30 pt-4 overflow-hidden">
              <JiraIntegration />
            </div>
          </div>

          {/* Test Input Card */}
          <div className="bg-gray-800 rounded-2xl shadow-md border border-gray-700 p-5 flex-shrink-0">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-5 h-5 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-400">📝</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white break-words">Test Input</h2>
                <p className="text-xs text-gray-400 font-medium mt-0.5 break-words">Define test steps & URL</p>
              </div>
            </div>
            <TestCaseInput onGenerate={handleGenerateTest} isLoading={isLoading} />
          </div>

          {/* Execution Control Card */}
          <div className="bg-gradient-to-br from-green-900/40 to-green-800/20 rounded-2xl shadow-md border-2 border-green-500/40 p-5 flex-shrink-0">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-lg bg-green-600/30 flex items-center justify-center text-green-300 text-lg flex-shrink-0">▶️</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white break-words">Execute Test</h2>
                <p className="text-xs text-green-300/60 font-medium mt-0.5 break-words">Run & monitor execution</p>
              </div>
            </div>
            <div className="border-t border-green-500/30 pt-4">
              <ExecutionPanel
                onExecute={handleExecuteTest}
                onRetry={handleRetryTest}
                isLoading={isLoading}
              />
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: Code Editor Panel - Hidden in Report tab but stays in layout */}
        <div className={`flex-1 flex flex-col gap-6 min-w-0 ${activeTab === 'report' ? 'hidden' : ''}`}>
          {/* Code Panel Header */}
          <div className="bg-gray-800 rounded-2xl shadow-md border border-gray-700 overflow-hidden flex flex-col flex-1 min-h-0">
            {/* Panel Title */}
            <div className="bg-gray-900/80 border-b border-gray-700 px-6 py-3 flex-shrink-0">
              <h2 className="text-sm font-bold text-white">Code</h2>
            </div>
            {/* Script Editor with Tabs */}
            <ScriptEditor isLoading={isLoading} />
          </div>
        </div>

        {/* RIGHT COLUMN: Logs & Report - Always visible, fixed width container */}
        <div className="w-96 flex-shrink-0 flex flex-col gap-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent pl-3 max-w-96 min-w-96">
          {/* Tabs Navigation */}
          <div className="bg-gray-800 rounded-2xl shadow-md border border-gray-700 overflow-hidden flex-shrink-0 w-96">
            <div className="flex gap-2 p-2 bg-gray-900/50">
              {(['logs', 'report'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as TabType)}
                  className={`flex-1 px-3 py-2.5 text-sm font-bold rounded-lg transition-all duration-200 whitespace-nowrap text-center ${
                    activeTab === tab
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-transparent text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                  }`}
                  title={`View ${tab}`}
                >
                  {activeTab === tab && <span className="mr-1">●</span>}
                  {tab === 'logs' && '📋 Logs'}
                  {tab === 'report' && '📊 Report'}
                </button>
              ))}
            </div>
          </div>

          {/* Content Display - Only content changes, not the container */}
          <div className="bg-gray-800 rounded-2xl shadow-md border border-gray-700 overflow-hidden flex flex-col flex-1 min-h-0 w-full">
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto w-full">
              {activeTab === 'logs' && <LogsViewer isLoading={isLoading} />}
              {activeTab === 'report' && (
                <div className="flex flex-col w-full h-full overflow-hidden">
                  <TestStatusSummary isLoading={isLoading} />
                  <TestReportHeader isLoading={isLoading} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Bar */}
      {error && (
        <div className="bg-red-900/30 border-t border-red-700 px-7 py-3 text-red-300 text-sm font-medium backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
