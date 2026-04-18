import { useTestAgent } from '@/hooks/useTestAgent';
import { Maximize2, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface ReportViewerProps {
  isLoading?: boolean;
}

export const ReportViewer = ({ isLoading = false }: ReportViewerProps) => {
  const { reportUrl, executionStatus, executionResults, executionId } = useTestAgent();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const hasResults = executionStatus && executionStatus !== 'idle';

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Force iframe reload by changing key
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  if (!hasResults && !reportUrl) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950/50">
        <div className="text-center space-y-3">
          <div className="text-5xl">📊</div>
          <p className="text-gray-300 font-medium">No report available yet</p>
          <p className="text-gray-500 text-sm">Run a test to generate a detailed report</p>
        </div>
      </div>
    );
  }

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
        {/* Header with status */}
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-400 text-lg">📊</div>
              <p className="text-lg font-bold text-white">Test Report</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-200 flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={() => setIsFullscreen(false)}
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-lg transition-all duration-200"
              >
                Exit
              </button>
            </div>
          </div>
          {hasResults && (
            <div className="flex items-center gap-4 pt-4 border-t border-gray-700">
              {executionStatus === 'passed' ? (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-600/20 flex items-center justify-center text-green-400 text-xl">✅</div>
                  <div>
                    <p className="font-bold text-white capitalize">Test Passed</p>
                    {executionResults && (
                      <p className="text-sm text-gray-400">
                        {executionResults.passed} passed · {executionResults.failed} failed · {executionResults.skipped} skipped
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center text-red-400 text-xl">❌</div>
                  <div>
                    <p className="font-bold text-white capitalize">Test Failed</p>
                    {executionResults && (
                      <p className="text-sm text-gray-400">
                        {executionResults.passed} passed · {executionResults.failed} failed · {executionResults.skipped} skipped
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {reportUrl ? (
            <iframe
              key={`fullscreen-${reportUrl}-${iframeKey}`}
              src={reportUrl}
              className="w-full h-full border-none"
              title="Test Report"
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-400">
                <p className="text-lg">No report available</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0 overflow-hidden">
      {/* Status Summary */}
      {hasResults && (
        <div className={`px-6 py-4 border-b-2 flex-shrink-0 overflow-hidden ${executionStatus === 'passed' ? 'bg-green-600/20 border-green-500/50' : 'bg-red-600/20 border-red-500/50'}`}>
          <div className="flex items-center gap-4 w-full">
            <div className={`text-3xl flex-shrink-0 ${executionStatus === 'passed' ? 'text-green-400' : 'text-red-400'}`}>
              {executionStatus === 'passed' ? '✅' : '❌'}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold text-lg break-words ${executionStatus === 'passed' ? 'text-green-400' : 'text-red-400'} uppercase tracking-wider`}>
                Test {executionStatus}
              </p>
              {executionResults && (
                <p className="text-sm text-gray-300 mt-1 break-words">
                  <span className="text-green-400 font-bold">{executionResults.passed}</span> passed · 
                  <span className="text-red-400 font-bold ml-1">{executionResults.failed}</span> failed · 
                  <span className="text-yellow-400 font-bold ml-1">{executionResults.skipped}</span> skipped
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Report Header */}
      <div className="bg-gray-900/80 border-b border-gray-700 px-6 py-4 flex items-center justify-between flex-shrink-0 backdrop-blur-sm w-full min-w-0 overflow-hidden">
        <p className="text-sm font-bold text-white truncate">📊 Test Report</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            className="p-2.5 hover:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-gray-400 hover:text-blue-400 disabled:opacity-50"
            title="Refresh report"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsFullscreen(true)}
            disabled={isLoading}
            className="p-2.5 hover:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-gray-400 hover:text-green-400 disabled:opacity-50"
            title="Fullscreen"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Report Content */}
      <div className="flex-1 min-h-0 overflow-hidden bg-gray-950 flex flex-col w-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-full w-full">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full inline-block animate-spin"></div>
              <p className="text-sm text-gray-400 font-medium">Loading report...</p>
            </div>
          </div>
        ) : reportUrl ? (
          <iframe
            key={`${reportUrl}-${iframeKey}`}
            src={reportUrl}
            className="flex-1 w-full h-full border-none bg-white"
            title="Test Report"
            sandbox="allow-same-origin allow-scripts allow-forms"
            onLoad={() => console.log('Report loaded from:', reportUrl)}
            onError={(e) => console.error('Report iframe error:', e)}
          />
        ) : hasResults ? (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 w-full p-6">
            <div className="space-y-3 flex-shrink-0">
              <div className="text-5xl text-center">📄</div>
              <h3 className="text-base font-bold text-gray-300 text-center">No HTML Report Generated</h3>
              <p className="text-xs text-gray-500 text-center">Test execution completed</p>
            </div>
            {executionResults && (
              <div className="bg-gray-800 rounded-lg p-4 space-y-1.5 text-xs text-gray-300 flex-shrink-0">
                <p className="break-words"><span className="text-gray-400">ID:</span> <code className="text-gray-500 break-all text-xs">{executionId}</code></p>
                <p className="break-words"><span className="text-gray-400">Status:</span> <span className={executionStatus === 'passed' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{executionStatus.toUpperCase()}</span></p>
                <p className="break-words"><span className="text-gray-400">Passed:</span> <span className="text-green-400 font-bold">{executionResults.passed}</span></p>
                <p className="break-words"><span className="text-gray-400">Failed:</span> <span className="text-red-400 font-bold">{executionResults.failed}</span></p>
                <p className="break-words"><span className="text-gray-400">Skipped:</span> <span className="text-yellow-400 font-bold">{executionResults.skipped}</span></p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center w-full h-full">
            <div className="text-center space-y-3 px-6">
              <div className="text-5xl">⏳</div>
              <p className="text-xs text-gray-400 break-words">No report data available</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
