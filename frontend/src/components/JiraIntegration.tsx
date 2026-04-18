import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useTestAgent } from '@/hooks/useTestAgent';

interface JiraIssue {
  key: string;
  summary: string;
}

interface TransformedSteps {
  rawContent: string;
  normalizedSteps: string[];
  contentSource: string;
  complexityScore: number;
  usedLLMNormalization: boolean;
  processingTime: number;
}

export const JiraIntegration = () => {
  const [issueKey, setIssueKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fetchedIssue, setFetchedIssue] = useState<JiraIssue | null>(null);
  const [transformedSteps, setTransformedSteps] = useState<TransformedSteps | null>(null);
  const { setTestSteps, testSteps } = useTestAgent();

  const handleFetchIssue = async () => {
    if (!issueKey.trim()) {
      toast.error('Please enter a Jira issue key');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/jira/fetch-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueKey }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch issue');
      }

      const data = await response.json();
      console.log('📥 Fetch response:', data);
      
      // Extract issue data
      const issue = data.issue || {};
      const transformed = data.transformed || {};
      
      // Normalize normalizedSteps - handle both string and array formats
      let normalizedStepsArray: string[] = [];
      if (typeof transformed.normalizedSteps === 'string') {
        // If it's a string, split by newlines and filter empty
        normalizedStepsArray = transformed.normalizedSteps
          .split('\n')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
      } else if (Array.isArray(transformed.normalizedSteps)) {
        // If it's already an array, use it as-is
        normalizedStepsArray = transformed.normalizedSteps;
      }
      
      console.log('✅ Normalized steps:', normalizedStepsArray);

      setFetchedIssue({
        key: issue.key || '',
        summary: issue.summary || '',
      });
      
      setTransformedSteps({
        rawContent: transformed.rawContent || '',
        normalizedSteps: normalizedStepsArray,
        contentSource: transformed.contentSource || 'Parsed',
        complexityScore: transformed.complexityScore || normalizedStepsArray.length,
        usedLLMNormalization: transformed.usedLLMNormalization || false,
        processingTime: transformed.processingTime || 0,
      });
      
      toast.success(`✅ Issue ${issueKey} fetched successfully`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch issue';
      toast.error(`❌ ${errorMsg}`);
      console.error('Jira fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseSteps = () => {
    if (!transformedSteps?.normalizedSteps) {
      toast.error('No steps to use');
      return;
    }

    const stepsText = transformedSteps.normalizedSteps.join('\n');
    setTestSteps(stepsText);
    toast.success('✅ Steps added to test case');
  };

  const handleClear = () => {
    setIssueKey('');
    setFetchedIssue(null);
    setTransformedSteps(null);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Input Section */}
      <div className="flex flex-col gap-3">
        <label className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
          <span className="text-lg">🔗</span>
          Jira Issue Key
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={issueKey}
            onChange={(e) => setIssueKey(e.target.value.toUpperCase())}
            onKeyPress={(e) => e.key === 'Enter' && handleFetchIssue()}
            placeholder="e.g., QA-101, PROJ-456"
            className="flex-1 px-4 py-3 bg-gray-900 border-2 border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 font-mono text-sm transition-all duration-200"
          />
          <button
            onClick={handleFetchIssue}
            disabled={isLoading || !issueKey.trim()}
            className="px-5 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 whitespace-nowrap transform hover:scale-105 disabled:hover:scale-100"
          >
            {isLoading ? '⏳' : '🔍'}
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="p-5 bg-gradient-to-r from-blue-600/20 to-blue-500/20 border-2 border-blue-500/50 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="animate-spin text-2xl">⟳</div>
            <p className="text-sm font-bold text-blue-400">Fetching Jira issue...</p>
          </div>
        </div>
      )}

      {/* Fetched Issue Details */}
      {!isLoading && fetchedIssue && (
        <div className="p-5 bg-gradient-to-r from-purple-600/20 to-purple-500/20 border-2 border-purple-500/50 rounded-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="text-xs font-bold text-purple-400 uppercase tracking-wide">📌 Fetched Issue</p>
              <p className="text-base font-mono text-purple-300 font-bold mt-1">{fetchedIssue.key}</p>
              <p className="text-sm text-gray-300 mt-2">{fetchedIssue.summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Transformed Steps */}
      {!isLoading && transformedSteps && transformedSteps.normalizedSteps.length > 0 && (
        <div className="flex flex-col gap-3 border-t-2 border-gray-700 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
              <span className="text-lg">✨</span>
              Transformed Steps
              <span className="px-3 py-1 bg-blue-600/30 border border-blue-500/50 rounded-full text-xs font-bold text-blue-400">
                {transformedSteps.normalizedSteps.length}
              </span>
            </p>
            <div className="flex gap-2">
              {transformedSteps.usedLLMNormalization && (
                <span className="px-3 py-1.5 bg-gradient-to-r from-purple-600/30 to-purple-500/30 border border-purple-500/50 rounded-lg text-xs font-bold text-purple-400">
                  🤖 LLM Enhanced
                </span>
              )}
              {!transformedSteps.usedLLMNormalization && (
                <span className="px-3 py-1.5 bg-gradient-to-r from-blue-600/30 to-blue-500/30 border border-blue-500/50 rounded-lg text-xs font-bold text-blue-400">
                  📊 Parsed
                </span>
              )}
              <span className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs font-bold text-gray-400">
                {transformedSteps.processingTime}ms
              </span>
            </div>
          </div>

          {/* Steps List */}
          <div className="overflow-y-auto bg-gray-950 border-2 border-gray-700 rounded-xl p-4 max-h-96 flex-1">
            {transformedSteps.normalizedSteps.length > 0 ? (
              <ol className="space-y-3 list-none">
                {transformedSteps.normalizedSteps.map((step, idx) => {
                  // Check if step already starts with a number pattern (e.g., "1. ", "2. ")
                  const hasNumberPrefix = /^\d+\.\s/.test(step);
                  return (
                    <li key={idx} className="text-xs text-gray-300 font-mono leading-relaxed flex gap-3 hover:bg-gray-900/50 p-2 rounded-lg transition-colors duration-200">
                      {!hasNumberPrefix && (
                        <span className="text-blue-400 font-bold flex-shrink-0">{idx + 1}.</span>
                      )}
                      <span className="text-gray-300">{step}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-xs text-gray-500 italic">No steps extracted</p>
            )}
          </div>

          {/* Raw Content Info */}
          <div className="text-xs text-gray-500 border-t-2 border-gray-700 pt-3 space-y-1 font-mono">
            <p>📝 <span className="text-gray-600">{transformedSteps.rawContent.substring(0, 80)}...</span></p>
            <p>📌 <span className="text-gray-400">Source:</span> <span className="text-cyan-400 font-bold">{transformedSteps.contentSource}</span></p>
          </div>
        </div>
      )}

      {/* No Steps Message */}
      {!isLoading && fetchedIssue && transformedSteps && transformedSteps.normalizedSteps.length === 0 && (
        <div className="p-4 bg-yellow-600/20 border-2 border-yellow-500/50 rounded-xl">
          <p className="text-xs font-bold text-yellow-400">⚠️ No steps could be extracted from this issue.</p>
          <p className="text-xs text-gray-500 mt-2">Raw content: <code className="text-yellow-600">{transformedSteps.rawContent}</code></p>
        </div>
      )}

      {/* Action Buttons */}
      {fetchedIssue && transformedSteps && (
        <div className="flex gap-3 pt-3 border-t-2 border-gray-700">
          <button
            onClick={handleUseSteps}
            disabled={!transformedSteps?.normalizedSteps?.length || isLoading}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 transform hover:scale-105 disabled:hover:scale-100"
          >
            ✅ Use These Steps
          </button>
          <button
            onClick={handleClear}
            disabled={isLoading}
            className="px-4 py-3 bg-gray-800 border-2 border-gray-700 hover:bg-gray-700 disabled:cursor-not-allowed text-gray-300 font-bold rounded-xl transition-all duration-200"
          >
            🗑️ Clear
          </button>
        </div>
      )}

      {/* Info Text */}
      <div className="text-xs text-gray-500 space-y-2 mt-auto pt-3 border-t-2 border-gray-700 font-mono">
        <p>💡 Enter a Jira issue key to fetch and transform it into test steps</p>
        <p>🤖 Complex content will be enhanced with LLM for better structure</p>
      </div>
    </div>
  );
};
