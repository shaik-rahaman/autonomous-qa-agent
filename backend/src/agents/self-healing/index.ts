/**
 * Self-Healing Agent (Simplified with MCP + LLM)
 * Detects selector failures and suggests intelligent alternative locators
 * Now uses real DOM analysis and AI-powered selector discovery
 */

// Note: recommender is intentionally NOT imported at module load to avoid LLM/MCP initialization
// when healing is disabled. Import lazily only when re-enabling healing.
import { FailureAnalyzer } from './failure-analyzer';
import { failureStore } from './failure-store';

// Type definitions for other modules
export interface TestFailure {
  error: string;
  selector?: string;
  testFile: string;
  testName: string;
  stackTrace?: string;
}

export interface AnalysisResult {
  rootCause: string;
  affectedElements: string[];
  possibleReasons: string[];
  recommendedFixes?: string[];
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface RecommendedFix {
  type: 'selector-update' | 'wait-adjustment' | 'element-recovery' | 'code-modification' | 'manual-review';
  description: string;
  affectedLines: number[];
  confidence: number;
}

export interface HealFailureInput {
  step: string;         // Test step description
  error: any;           // Error message or structured error object
  selector: string;     // Failed selector/locator
  url: string;          // Target URL
}

export interface HealFailureOutput {
  fixed: boolean;
  newSelector?: string;
  reason: string;
}

/**
 * Attempt to heal a test failure by suggesting alternative selector
 * Uses MCP + LLM for intelligent discovery, falls back to heuristics
 */
export async function healFailure(input: HealFailureInput): Promise<HealFailureOutput> {
  // PHASE 1: Healing disabled. We still analyze and store diagnostics.
  // Do NOT perform any healing or LLM calls here.
  try {
    const analyzer = new FailureAnalyzer();
    const analysis = analyzer.analyze(input.error, input.selector);

    // Persist source-of-truth diagnostics for UI consumption
    failureStore.save({
      timestamp: new Date().toISOString(),
      actualPlaywrightError: input.error,
      extractedSelector: analysis.failedSelector || input.selector,
      failureType: analysis.failureType,
      confidence: analysis.confidence,
      source: analysis.source,
      step: input.step,
      url: input.url,
    });

    // If healing is explicitly enabled, attempt lazy-loaded healing
    if (process.env.HEALING_ENABLED === 'true') {
      try {
        // Delegate to the enhanced healing pipeline which returns telemetry and richer diagnostics
        try {
          const pipeline = await import('./healing-pipeline');
          if (pipeline && typeof pipeline.healFailure === 'function') {
            const pipelineResult = await pipeline.healFailure({
              step: input.step,
              error: input.error,
              selector: analysis.failedSelector || input.selector,
              url: input.url,
            } as any);

            // Persist decision into failureStore
            failureStore.save({
              timestamp: new Date().toISOString(),
              actualPlaywrightError: input.error,
              extractedSelector: analysis.failedSelector || input.selector,
              failureType: analysis.failureType,
              confidence: analysis.confidence,
              source: analysis.source,
              step: input.step,
              url: input.url,
              healedSelector: pipelineResult.newSelector,
              healedDecision: pipelineResult.fixed ? 'accepted' : 'rejected',
              telemetry: pipelineResult.telemetry,
            } as any);

            return { fixed: !!pipelineResult.fixed, newSelector: pipelineResult.newSelector, reason: pipelineResult.reason || 'healed' };
          }
          return { fixed: false, reason: 'healing_pipeline_unavailable' };
        } catch (e) {
          return { fixed: false, reason: `healing_pipeline_error: ${String(e)}` };
        }
      } catch (e: any) {
        return { fixed: false, reason: `healing_runtime_error: ${String(e)}` };
      }
    }

    return {
      fixed: false,
      reason: 'healing_disabled',
    };
  } catch (err: any) {
    return {
      fixed: false,
      reason: `healing_error: ${String(err)}`,
    };
  }
}

/**
 * Validate healed selector according to strict rules:
 * - must be non-empty
 * - must not include ':visible' suffix
 * - must differ from the original selector
 * - must match a small whitelist of allowed selector patterns
 */
function isValidHealedSelector(oldSelector: string | undefined | null, newSelector: string): boolean {
  if (!newSelector || typeof newSelector !== 'string') return false;
  const s = newSelector.trim();
  if (s.length === 0) return false;
  if (s.includes(':visible')) return false;
  if (oldSelector && oldSelector.trim() === s) return false;

  const allowed = [
    /^\[.*\]$/,
    /^#/,
    /^\./,
    /^getByRole\(/,
    /^getByText\(/,
    /^page\.locator\(/,
    /^text=.+/,
  ];

  return allowed.some((r) => r.test(s));
}

// FixRecommender intentionally not exported while healing is disabled.

