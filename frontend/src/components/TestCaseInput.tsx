import { useTestAgent } from '@/hooks/useTestAgent';

interface TestCaseInputProps {
  onGenerate: () => void;
  isLoading?: boolean;
}

export const TestCaseInput = ({ onGenerate, isLoading = false }: TestCaseInputProps) => {
  const { testSteps, setTestSteps, testUrl, setTestUrl } = useTestAgent();

  const handleClear = () => {
    setTestSteps('');
    setTestUrl('');
  };

  const isValid = testSteps.trim().length > 0 && testUrl.trim().length > 0;

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Test Steps Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-bold text-white">Test Steps</label>
          <span className="text-xs text-gray-400 font-medium">{testSteps.length} chars</span>
        </div>
        <textarea
          value={testSteps}
          onChange={(e) => setTestSteps(e.target.value)}
          placeholder="1. Navigate to login page&#10;2. Enter username and password&#10;3. Click login button&#10;4. Verify dashboard appears"
          className="w-full h-32 p-4 bg-gray-900 border border-gray-700 rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 resize-none font-mono text-sm leading-relaxed transition-all duration-200 hover:border-gray-600"
        />
        <p className="text-xs text-gray-500">Enter test steps in natural language</p>
      </div>

      {/* Target URL Section */}
      <div className="flex flex-col gap-3">
        <label className="text-sm font-bold text-white">Target URL</label>
        <input
          type="url"
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
          placeholder="https://example.com/login"
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 font-mono text-sm transition-all duration-200 hover:border-gray-600"
        />
        <p className="text-xs text-gray-500">Full URL to test application</p>
      </div>

      {/* Buttons Section */}
      <div className="flex gap-3 flex-shrink-0 pt-2">
        <button
          onClick={onGenerate}
          disabled={!isValid || isLoading}
          className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-blue-600/50 disabled:shadow-none transform hover:scale-105 disabled:hover:scale-100"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </span>
          ) : (
            '✨ Generate Script'
          )}
        </button>
        <button
          onClick={handleClear}
          disabled={!isValid || isLoading}
          className="px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-gray-200 font-bold rounded-xl transition-all duration-200 border border-gray-600 hover:border-gray-500"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
