import { TimelineEvent } from '@/types/api';
import { PlayCircle, AlertCircle, Zap, RefreshCw, CheckCircle2 } from 'lucide-react';

interface ExecutionTimelineProps {
  timeline?: TimelineEvent[];
}

export const ExecutionTimeline = ({ timeline }: ExecutionTimelineProps) => {
  if (!timeline || timeline.length === 0) {
    return (
      <div className="text-xs text-gray-500 text-center py-8">
        📭 No execution data available
      </div>
    );
  }

  const getStageConfig = (stage: string) => {
    switch (stage) {
      case 'run':
        return {
          icon: PlayCircle,
          color: 'from-blue-500 to-blue-600',
          bgColor: 'bg-blue-600/20',
          borderColor: 'border-blue-500/50',
          textColor: 'text-blue-400',
          lightBg: 'from-blue-600/10 to-blue-600/5',
          label: '▶ Run',
          emoji: '🏃',
        };
      case 'fail':
        return {
          icon: AlertCircle,
          color: 'from-red-500 to-red-600',
          bgColor: 'bg-red-600/20',
          borderColor: 'border-red-500/50',
          textColor: 'text-red-400',
          lightBg: 'from-red-600/10 to-red-600/5',
          label: '❌ Fail',
          emoji: '❌',
        };
      case 'heal':
        return {
          icon: Zap,
          color: 'from-yellow-500 to-yellow-600',
          bgColor: 'bg-yellow-600/20',
          borderColor: 'border-yellow-500/50',
          textColor: 'text-yellow-400',
          lightBg: 'from-yellow-600/10 to-yellow-600/5',
          label: '🔧 Heal',
          emoji: '⚡',
        };
      case 'retry':
        return {
          icon: RefreshCw,
          color: 'from-purple-500 to-purple-600',
          bgColor: 'bg-purple-600/20',
          borderColor: 'border-purple-500/50',
          textColor: 'text-purple-400',
          lightBg: 'from-purple-600/10 to-purple-600/5',
          label: '🔄 Retry',
          emoji: '🔄',
        };
      case 'success':
        return {
          icon: CheckCircle2,
          color: 'from-green-500 to-green-600',
          bgColor: 'bg-green-600/20',
          borderColor: 'border-green-500/50',
          textColor: 'text-green-400',
          lightBg: 'from-green-600/10 to-green-600/5',
          label: '✅ Success',
          emoji: '✅',
        };
      default:
        return {
          icon: PlayCircle,
          color: 'from-gray-500 to-gray-600',
          bgColor: 'bg-gray-600/20',
          borderColor: 'border-gray-500/50',
          textColor: 'text-gray-400',
          lightBg: 'from-gray-600/10 to-gray-600/5',
          label: stage.toUpperCase(),
          emoji: '•',
        };
    }
  };

  const getRelativeTime = (timestamp: number, baseTime?: number) => {
    const base = baseTime || timeline[0]?.timestamp || 0;
    const diff = timestamp - base;
    const seconds = Math.floor(diff / 1000);
    const ms = diff % 1000;
    
    if (seconds === 0) {
      return `${ms}ms`;
    }
    return `${seconds}.${Math.floor(ms / 100)}s`;
  };

  const baseTime = timeline[0]?.timestamp;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-b from-gray-800 to-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-lg">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-900/80 border-b border-gray-700 flex items-center gap-3 flex-shrink-0 backdrop-blur-sm">
        <div className="w-4 h-4 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 animate-pulse" />
        <p className="text-sm font-bold text-white">⏱️ Execution Timeline</p>
        <span className="ml-auto px-3 py-1 text-xs font-bold bg-gray-700 text-gray-300 rounded-full">{timeline.length} events</span>
      </div>

      {/* Timeline Container */}
      <div className="flex-1 overflow-auto px-6 py-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        <div className="relative space-y-4">
          {/* Vertical Line */}
          <div className="absolute left-5 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500/60 via-purple-500/60 to-green-500/60 rounded-full opacity-60" />

          {/* Timeline Events */}
          {timeline.map((event, index) => {
            const config = getStageConfig(event.stage);
            const Icon = config.icon;
            const relativeTime = getRelativeTime(event.timestamp, baseTime);

            return (
              <div key={index} className="relative flex gap-4 items-start pl-2">
                {/* Icon Dot */}
                <div className={`relative z-10 mt-1 flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${config.lightBg} border-2 ${config.borderColor} flex items-center justify-center shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-110`}>
                  <div className="text-lg">{config.emoji}</div>
                </div>

                {/* Content Card */}
                <div className={`flex-1 min-w-0 mt-1 px-4 py-3 rounded-xl border-2 ${config.borderColor} bg-gradient-to-br ${config.lightBg} hover:shadow-md transition-all duration-200 transform hover:scale-102 group`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold ${config.textColor} uppercase tracking-wider`}>
                        {config.label}
                      </p>
                      <p className="text-sm text-gray-300 mt-2 break-words leading-relaxed group-hover:text-gray-200 transition-colors duration-200">
                        {event.message}
                      </p>
                    </div>
                    <span className={`text-xs font-mono font-bold whitespace-nowrap flex-shrink-0 ${config.textColor} px-2 py-1 rounded-lg bg-gray-900/40`}>
                      +{relativeTime}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
