import { useTestAgent } from '@/hooks/useTestAgent';
import { Play, RotateCcw, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { ExecutionTimeline } from './ExecutionTimeline';

interface ExecutionPanelProps {
  onExecute: () => void;
  onRetry: () => void;
  isLoading?: boolean;
}

export const ExecutionPanel = ({
  onExecute,
  onRetry,
  isLoading = false,
}: ExecutionPanelProps) => {
  const { 
    executionStatus, 
    executionResults, 
    script,
    healed,
    reused,
    retryCount,
    healedSteps,
    healingDetails,
    timeline,
  } = useTestAgent();

  const canExecute = script.length > 0 && !isLoading;
  const canRetry = executionStatus === 'failed' && !isLoading;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'from-blue-600 to-blue-700 text-white';
      case 'passed':
        return 'from-green-600 to-green-700 text-white';
      case 'failed':
        return 'from-red-600 to-red-700 text-white';
      case 'error':
        return 'from-red-600 to-red-700 text-white';
      default:
        return 'from-gray-600 to-gray-700 text-white';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Status Badge and Actions */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Status</p>
          <div className={`px-4 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r ${getStatusColor(executionStatus)} inline-flex items-center gap-2 shadow-lg`}>
            {isLoading && executionStatus === 'running' ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                🏃 Running...
              </span>
            ) : executionStatus === 'passed' ? (
              <span className="flex items-center gap-2">
                <span>✅</span> {getStatusLabel(executionStatus)}
              </span>
            ) : executionStatus === 'failed' ? (
              <span className="flex items-center gap-2">
                <span>❌</span> {getStatusLabel(executionStatus)}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span>⏸️</span> {getStatusLabel(executionStatus)}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={onExecute}
            disabled={!canExecute}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-green-600/50 disabled:shadow-none transform hover:scale-105 disabled:hover:scale-100 text-sm"
          >
            <Play className="w-4 h-4" />
            <span className="hidden sm:inline">Execute</span>
          </button>
          {canRetry && (
            <button
              onClick={onRetry}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-orange-600/50 disabled:shadow-none transform hover:scale-105 disabled:hover:scale-100 text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">Retry</span>
            </button>
          )}
        </div>
      </div>

      {/* Healing & Retry Badges */}
      {executionStatus !== 'idle' && executionStatus !== 'running' && (
        <div className="flex gap-2 flex-wrap flex-shrink-0">
          {/* Healing Badge */}
          <div className={`px-3 py-2 rounded-full text-xs font-bold flex items-center gap-2 transition-all duration-200 ${
            healed
              ? 'from-green-600/20 to-green-500/20 text-green-400 border border-green-500/40 bg-gradient-to-r'
              : 'from-gray-600/20 to-gray-500/20 text-gray-400 border border-gray-500/30 bg-gradient-to-r'
          }`}>
            <Zap className="w-3.5 h-3.5" />
            {healed ? '🔧 Healed' : '⊘ Not Healed'}
          </div>

          {/* Reused Fix Badge */}
          {reused && (
            <div className="px-3 py-2 rounded-full text-xs font-bold flex items-center gap-2 bg-gradient-to-r from-blue-600/20 to-blue-500/20 text-blue-400 border border-blue-500/40 transition-all duration-200">
              <span className="text-base">♻️</span>
              Reused
            </div>
          )}

          {/* Retry Count Badge */}
          {retryCount > 0 && (
            <div className="px-3 py-2 rounded-full text-xs font-bold flex items-center gap-2 bg-gradient-to-r from-yellow-600/20 to-yellow-500/20 text-yellow-400 border border-yellow-500/40 transition-all duration-200">
              <RotateCcw className="w-3.5 h-3.5" />
              {retryCount} {retryCount === 1 ? 'Retry' : 'Retries'}
            </div>
          )}
        </div>
      )}

      {/* Results Summary */}
      {executionResults && (
        <div className="grid grid-cols-4 gap-2 flex-shrink-0">
          {[
            { label: 'Passed', value: executionResults.passed, color: 'text-green-400 bg-green-600/20' },
            { label: 'Failed', value: executionResults.failed, color: 'text-red-400 bg-red-600/20' },
            { label: 'Skipped', value: executionResults.skipped, color: 'text-yellow-400 bg-yellow-600/20' },
            { label: 'Total', value: executionResults.total, color: 'text-blue-400 bg-blue-600/20' },
          ].map((stat) => (
            <div key={stat.label} className={`${stat.color} rounded-lg p-3 text-center border border-gray-700 transition-all duration-200`}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color.split(' ')[0]}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Healed Steps Section */}
      {healedSteps.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-b from-green-600/10 to-green-600/5 border border-green-500/30 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-green-600/20 border-b border-green-500/30 flex items-center gap-2 flex-shrink-0">
            <Zap className="w-4 h-4 text-green-400" />
            <p className="text-xs font-bold text-green-400 uppercase tracking-wider">🔧 Healed Steps ({healedSteps.length})</p>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {healedSteps.map((step, index) => (
              <div key={index} className="text-xs bg-gray-900/60 rounded-lg p-3 border border-gray-700/50 hover:border-gray-600 transition-all duration-200">
                <div className="font-bold text-green-400 mb-2 flex items-center gap-1">
                  <span>✓</span> Step {index + 1}: {step.step}
                </div>
                <div className="space-y-1 text-gray-300 text-xs font-mono">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 flex-shrink-0">Old:</span>
                    <code className="text-red-400/70 line-through flex-1 break-all bg-red-600/10 px-2 py-1 rounded">{step.oldSelector}</code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 flex-shrink-0">New:</span>
                    <code className="text-green-400 flex-1 break-all bg-green-600/10 px-2 py-1 rounded">{step.newSelector}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Timeline */}
      {timeline.length > 0 && (
        <ExecutionTimeline timeline={timeline} />
      )}
    </div>
  );
};
