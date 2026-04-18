import { useEffect } from 'react';
import { useTestAgent } from '@/hooks/useTestAgent';
import { apiService } from '@/utils/api-client';
import { Circle } from 'lucide-react';

export const MCPStatusIndicator = () => {
  const { mcpStatus, setMcpStatus } = useTestAgent();

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await apiService.checkMcpHealth();
        setMcpStatus('connected');
      } catch {
        setMcpStatus('disconnected');
      }
    };

    // Initial check
    checkHealth();

    // Auto-check every 10 seconds
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [setMcpStatus]);

  const isConnected = mcpStatus === 'connected';
  const statusColor = isConnected ? 'text-cyan-400' : 'text-orange-400';
  const statusText = isConnected ? '✅ MCP Connected' : '⚠️ MCP Disconnected';
  const bgColor = isConnected ? 'bg-cyan-600/10 border-cyan-500/40' : 'bg-orange-600/10 border-orange-500/40';
  const dotColor = isConnected ? 'bg-cyan-500 shadow-lg shadow-cyan-500/50' : 'bg-orange-500 shadow-lg shadow-orange-500/50';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all duration-300 ${bgColor}`}>
      <div
        className={`w-3.5 h-3.5 rounded-full transition-all duration-300 flex-shrink-0 ${dotColor}`}
      />
      <span className={`text-sm font-bold ${statusColor} transition-colors duration-300`}>{statusText}</span>
    </div>
  );
};
