import React, { useState } from 'react';
import { useTestAgent } from '@/hooks/useTestAgent';
import { Copy, Download } from 'lucide-react';
import toast from 'react-hot-toast';

interface ScriptEditorProps {
  isLoading?: boolean;
}

type EditorTab = 'gherkin' | 'script';

export const ScriptEditor = ({ isLoading = false }: ScriptEditorProps) => {
  const { script, gherkin, scriptFileName, scriptVersion } = useTestAgent();
  const [activeTab, setActiveTab] = useState<EditorTab>('gherkin');

  // Debug logging
  React.useEffect(() => {
    console.log('ScriptEditor Debug:', {
      hasGherkin: !!gherkin,
      hasScript: !!script,
      gherkinLength: gherkin?.length || 0,
      scriptLength: script?.length || 0,
      fileName: scriptFileName,
      version: scriptVersion,
    });
  }, [gherkin, script, scriptFileName, scriptVersion]);

  const handleCopy = (content: string, label: string) => {
    navigator.clipboard.writeText(content);
    toast.success(`${label} copied to clipboard!`, { duration: 2000 });
  };

  const handleDownload = (content: string, fileName: string) => {
    const element = document.createElement('a');
    const file = new Blob([content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = fileName;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success('File downloaded!', { duration: 2000 });
  };

  if (!script && !gherkin) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900/50">
        <div className="text-center space-y-3">
          <div className="text-5xl">📄</div>
          <p className="text-gray-300 font-medium">No script generated yet</p>
          <p className="text-gray-500 text-sm">Enter test steps and click "Generate Script" to begin</p>
        </div>
      </div>
    );
  }

  const displayContent = activeTab === 'gherkin' ? gherkin : script;
  const displayFileName = activeTab === 'gherkin' ? `${scriptFileName?.replace('.spec.ts', '')}.feature` : scriptFileName;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sticky Header */}
      <div className="bg-gray-900/80 border-b border-gray-700 px-6 py-4 flex items-center justify-between flex-shrink-0 sticky top-0 backdrop-blur-sm z-10">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{displayFileName}</p>
          {scriptVersion > 0 && (
            <p className="text-xs text-gray-400 mt-1">Version {scriptVersion}</p>
          )}
        </div>
        <div className="flex gap-2 ml-4 flex-shrink-0">
          <button
            onClick={() => handleCopy(displayContent, activeTab === 'gherkin' ? 'Gherkin' : 'Script')}
            disabled={isLoading || !displayContent}
            className="p-2.5 hover:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-gray-400 hover:text-blue-400 disabled:opacity-50"
            title="Copy to clipboard"
          >
            <Copy className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleDownload(displayContent, displayFileName || 'output.txt')}
            disabled={isLoading || !displayContent}
            className="p-2.5 hover:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-gray-400 hover:text-green-400 disabled:opacity-50"
            title="Download file"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tab Navigation - Always show both tabs */}
      <div className="flex gap-2 bg-gray-900/50 border-b border-gray-700 px-6 py-3 flex-shrink-0">
        <button
          onClick={() => setActiveTab('gherkin')}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-all duration-200 ${
            activeTab === 'gherkin'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
              : 'bg-transparent text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
          disabled={!gherkin}
        >
          📝 Gherkin
        </button>
        <button
          onClick={() => setActiveTab('script')}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-all duration-200 ${
            activeTab === 'script'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'bg-transparent text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
          disabled={!script}
        >
          ▶️ Playwright
        </button>
      </div>

      {/* Code Editor - Show content based on active tab */}
      <div className="flex-1 min-h-0 overflow-hidden bg-gray-950 p-6">
        {activeTab === 'gherkin' ? (
          gherkin ? (
            <pre className="font-mono text-sm text-green-400 whitespace-pre-wrap break-words overflow-auto h-full leading-relaxed">
              <code>{gherkin}</code>
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p>Gherkin format not yet generated</p>
            </div>
          )
        ) : (
          // Playwright tab
          script ? (
            <pre className="font-mono text-sm text-blue-400 whitespace-pre-wrap break-words overflow-auto h-full leading-relaxed">
              <code>{script}</code>
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p>Playwright script not yet generated</p>
            </div>
          )
        )}
      </div>
    </div>
  );
};
