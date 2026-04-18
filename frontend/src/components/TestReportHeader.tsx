import { Maximize2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface TestReportHeaderProps {
  isLoading?: boolean;
  onRefresh?: () => void;
  onFullscreen?: () => void;
}

export const TestReportHeader = ({ 
  isLoading = false, 
  onRefresh, 
  onFullscreen 
}: TestReportHeaderProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleFullscreen = () => {
    onFullscreen?.();
  };

  return (
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
          onClick={handleFullscreen}
          disabled={isLoading}
          className="p-2.5 hover:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-gray-400 hover:text-green-400 disabled:opacity-50"
          title="Fullscreen"
        >
          <Maximize2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
