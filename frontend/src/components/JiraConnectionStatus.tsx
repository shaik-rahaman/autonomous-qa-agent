import { useState, useEffect } from 'react';
import { apiService } from '@/utils/api-client';
import { toast } from 'react-hot-toast';

export const JiraConnectionStatus = () => {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [isManualCheck, setIsManualCheck] = useState(false);

  // Check connection on mount (silent check)
  useEffect(() => {
    checkConnection(false);
  }, []);

  const checkConnection = async (showToast = false) => {
    setIsLoading(true);
    try {
      const result = await apiService.testJiraConnection();
      setIsConnected(result.success);
      setLastChecked(new Date().toLocaleTimeString());
      
      if (showToast) {
        if (result.success) {
          toast.success('✅ Jira connected successfully');
          console.log('Jira connection successful');
        } else {
          toast.error('❌ Jira connection failed - check credentials');
        }
      }
    } catch (error) {
      setIsConnected(false);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Jira connection error:', errorMsg);
      if (showToast) {
        toast.error(`❌ Failed to check Jira: ${errorMsg}`);
      }
    } finally {
      setIsLoading(false);
      setIsManualCheck(false);
    }
  };

  const handleManualCheck = () => {
    setIsManualCheck(true);
    checkConnection(true);
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all duration-300 ${
      isConnected === null
        ? 'bg-blue-600/10 border-blue-500/40'
        : isConnected
        ? 'bg-green-600/10 border-green-500/40'
        : 'bg-red-600/10 border-red-500/40'
    }`}>
      {/* Status Indicator */}
      <div
        className={`w-3.5 h-3.5 rounded-full transition-all duration-300 flex-shrink-0 ${
          isConnected === null
            ? 'bg-blue-500 animate-pulse shadow-lg shadow-blue-500/50'
            : isConnected
            ? 'bg-green-500 shadow-lg shadow-green-500/50'
            : 'bg-red-500 shadow-lg shadow-red-500/50'
        }`}
      />
      
      {/* Status Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold transition-colors duration-300 ${
          isConnected === null
            ? 'text-blue-400'
            : isConnected
            ? 'text-green-400'
            : 'text-red-400'
        }`}>
          {isConnected === null ? '⏳ Checking...' : isConnected ? '✅ Jira Connected' : '❌ Jira Disconnected'}
        </p>
        {lastChecked && (
          <p className="text-xs text-gray-500 font-mono">Last checked: {lastChecked}</p>
        )}
      </div>

      {/* Check Connection Button */}
      <button
        onClick={handleManualCheck}
        disabled={isLoading}
        title={isConnected === true ? 'Jira is connected' : isConnected === false ? 'Click to retry Jira connection' : 'Checking Jira connection...'}
        className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-all duration-200 whitespace-nowrap flex-shrink-0 transform hover:scale-105 disabled:hover:scale-100 ${
          isConnected === true
            ? 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white'
            : isConnected === false
            ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white'
            : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white'
        } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isLoading ? '⏳' : '🔄'}
      </button>
    </div>
  );
};
