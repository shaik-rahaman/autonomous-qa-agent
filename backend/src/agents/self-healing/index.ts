/**
 * Self-Healing Agent (Simplified with MCP + LLM)
 * Detects selector failures and suggests intelligent alternative locators
 * Now uses real DOM analysis and AI-powered selector discovery
 */

import { FixRecommender, LocatorFix } from './recommender';

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
  error: string;        // Error message
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
  const recommender = new FixRecommender();

  // Now handles async MCP + LLM approach automatically
  const fix = await recommender.suggestAlternativeSelector(
    input.error, 
    input.selector,
    input.url,              // Pass URL for MCP analysis
    input.step              // Pass step description for context
  );

  return {
    fixed: fix.fixed,
    newSelector: fix.newSelector,
    reason: fix.reason,
  };
}

export { FixRecommender };

