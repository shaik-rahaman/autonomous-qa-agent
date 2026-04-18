import { useTestAgent } from '@/hooks/useTestAgent';

interface TestStatusSummaryProps {
  isLoading?: boolean;
}

export const TestStatusSummary = ({ isLoading = false }: TestStatusSummaryProps) => {
  const { executionStatus, executionResults } = useTestAgent();

  const hasResults = executionStatus && executionStatus !== 'idle';

  if (!hasResults || isLoading) {
    return null;
  }

  return (
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
  );
};
