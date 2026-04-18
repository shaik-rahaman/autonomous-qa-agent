import { useEffect, useRef } from 'react';
import { useTestAgent } from '@/hooks/useTestAgent';
import { Trash2 } from 'lucide-react';

interface LogsViewerProps {
  isLoading?: boolean;
}

export const LogsViewer = ({ isLoading = false }: LogsViewerProps) => {
  const { logs, clearLogs } = useTestAgent();
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleClear = () => {
    clearLogs();
  };

  const isHealingLog = (log: string): boolean => {
    const healingKeywords = [
      'healing',
      'healed',
      'heal',
      'self-healing',
      'MCP:',
      'suggest',
      'alternative selector',
      'Using healed selector',
      'Retried',
      'HEALING',
    ];
    return healingKeywords.some(keyword => log.toLowerCase().includes(keyword.toLowerCase()));
  };

  const getLogColor = (log: string) => {
    if (log.includes('[ERROR]')) return 'text-red-400';
    if (log.includes('[SUCCESS]')) return 'text-green-400';
    if (log.includes('[WARNING]')) return 'text-yellow-400';
    if (log.includes('[INFO]')) return 'text-blue-400';
    if (log.includes('[HEALING]')) return 'text-cyan-400';
    if (isHealingLog(log)) return 'text-cyan-300';
    if (log.includes('[POLL]')) return 'text-purple-400';
    if (log.includes('[COMPLETE]')) return 'text-green-500 font-semibold';
    return 'text-gray-300';
  };

  const getLogIcon = (log: string) => {
    if (log.includes('[ERROR]')) return '❌';
    if (log.includes('[SUCCESS]')) return '✅';
    if (log.includes('[WARNING]')) return '⚠️';
    if (log.includes('[INFO]')) return 'ℹ️';
    if (log.includes('[HEALING]') || isHealingLog(log)) return '🔧';
    if (log.includes('[POLL]')) return '🔄';
    if (log.includes('[COMPLETE]')) return '✨';
    return '▸';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gray-900/80 border-b border-gray-700 px-6 py-4 flex items-center justify-between flex-shrink-0 sticky top-0 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-400 text-xs">📋</div>
          <p className="text-sm font-bold text-white">Execution Logs</p>
          <span className="ml-2 px-3 py-1 text-xs font-bold bg-gray-700 text-gray-300 rounded-full">{logs.length}</span>
        </div>
        <button
          onClick={handleClear}
          disabled={logs.length === 0 || isLoading}
          className="p-2.5 hover:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-gray-400 hover:text-red-400 disabled:opacity-50"
          title="Clear logs"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {/* Logs Container */}
      <div className="flex-1 min-h-0 overflow-auto bg-gray-950 px-6 py-4 font-mono text-xs space-y-1.5 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-500 text-sm">No logs yet. Execute a test to see logs.</p>
          </div>
        ) : (
          <div>
            {logs.map((log, index) => {
              const isHealing = isHealingLog(log);
              return (
                <div 
                  key={index} 
                  className={`flex gap-3 py-1.5 px-3 rounded-lg transition-all duration-150 hover:bg-gray-900/50 ${isHealing ? 'bg-cyan-600/10 border-l-2 border-cyan-500/50' : 'hover:bg-gray-900/30'}`}
                >
                  <span className="text-gray-600 select-none whitespace-nowrap flex-shrink-0 font-bold">[{String(index + 1).padStart(3, '0')}]</span>
                  <span className="text-xl flex-shrink-0">{getLogIcon(log)}</span>
                  <span className={`break-words flex-1 ${getLogColor(log)} leading-relaxed`}>
                    {log}
                  </span>
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
