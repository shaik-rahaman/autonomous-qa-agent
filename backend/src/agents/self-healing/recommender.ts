import Groq from 'groq-sdk';
import * as path from 'path';
import * as fs from 'fs';
import { ErrorClassifier } from './error-classifier';
import {
  extractFailedLocator,
  extractStrictModeCandidates,
  pickBestCandidate,
  isValidSelector,
} from './error-parser';

// Validate all healing dependencies are present and fail fast if not
export async function validateHealingDependencies() {
  console.log(`\n[BLOCKER-CHECK] Validating healing dependencies...`);

  if (!process.env.GROQ_API_KEY) {
    console.warn(`⚠️ GROQ_API_KEY is not set - LLM-based healing will be skipped`);
  } else {
    console.log(`✓ GROQ_API_KEY loaded`);
  }

  if (!process.env.MCP_SERVER_URL) {
    console.warn(`⚠️ MCP_SERVER_URL is not set - MCP-based healing will be skipped`);
  } else {
    console.log(`✓ MCP_SERVER_URL: ${process.env.MCP_SERVER_URL}`);
  }

  // Do not fail startup if MCP client is unavailable - heuristics should still work
  try {
    const mod = await import('../../mcp/client').catch(() => null);
    if (mod && (mod.MCPClient || mod.mcpClient)) {
      console.log('✓ MCP module import succeeded');
    } else {
      console.warn('⚠️ MCP module not available at startup - will attempt lazy load when needed');
    }
  } catch (e) {
    console.warn(`⚠️ MCP client import check failed: ${String(e)}`);
  }
}

// Lazy-load MCP client to avoid brittle relative require paths in compiled output
let _mcpClient: any = null;
async function getMCPClient(): Promise<any> {
  if (_mcpClient) return _mcpClient;
  const candidates = [
    '../../mcp/client',
    '../mcp/client',
    path.resolve(process.cwd(), 'backend', 'src', 'mcp', 'client'),
    path.resolve(process.cwd(), 'pw-ai-agents', 'src', 'mcp', 'client'),
    path.resolve(process.cwd(), 'backend', 'dist', 'mcp', 'client'),
  ];
  for (const p of candidates) {
    try {
      const mod = await import(p);
      if (mod.mcpClient) { _mcpClient = mod.mcpClient; return _mcpClient; }
      if (mod.MCPClient) { _mcpClient = new mod.MCPClient(process.env.MCP_SERVER_URL); return _mcpClient; }
    } catch (err) {
      try {
        // Try require as fallback
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const req = require(p);
        if (req.mcpClient) { _mcpClient = req.mcpClient; return _mcpClient; }
        if (req.MCPClient) { _mcpClient = new req.MCPClient(process.env.MCP_SERVER_URL); return _mcpClient; }
      } catch (e) {
        // continue
      }
    }
  }
  // Return null if MCP cannot be loaded - callers should fallback to heuristics
  return null;
}

// Lazily instantiate Groq client only when needed. If GROQ_API_KEY is not set, LLM calls will be skipped.
let groqClient: any = null;
function getGroqClient() {
  if (groqClient) return groqClient;
  if (!process.env.GROQ_API_KEY) return null;
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

export interface FailureAnalysis {
  type: 'locator_issue' | 'timeout_issue' | 'navigation_issue' | 'unknown';
  fixable: boolean;
  fix?: { selector?: string; action?: 'click' | 'fill' | 'wait' | 'navigate'; strategy?: string };
}

export interface LocatorFix { fixed: boolean; newSelector?: string; action?: string; reason: string }

export interface HealingDiagnostics {
  timestamp: string;
  playgroundError: string;
  extractedLocator: string | null;
  failureType: string;
  healingCandidates: Array<{ selector: string; score: number }>;
  selectedCandidate: string | null;
  injectionSuccess: boolean;
  injectionDetails: string;
  retryStatus: 'pending' | 'passed' | 'failed';
  retryError?: string;
}

const logger = {
  info: (..._args: any[]) => {},
  warn: (..._args: any[]) => {},
  error: (..._args: any[]) => {},
  debug: (..._args: any[]) => {},
  success: (..._args: any[]) => {},
  section: (..._args: any[]) => {},
};

export class FixRecommender {
  private diagnostics: HealingDiagnostics = {
    timestamp: new Date().toISOString(),
    playgroundError: '',
    extractedLocator: null,
    failureType: 'unknown',
    healingCandidates: [],
    selectedCandidate: null,
    injectionSuccess: false,
    injectionDetails: '',
    retryStatus: 'pending',
  };

  getDiagnostics(): HealingDiagnostics { return { ...this.diagnostics } }
  private updateDiagnostics(field: keyof HealingDiagnostics, value: any) { (this.diagnostics as any)[field] = value }

  /**
   * Main entry - try MCP+LLM then heuristics. Normalizes error inputs.
   */
  async suggestAlternativeSelector(error: any, originalSelector?: string, url?: string, step?: string): Promise<LocatorFix> {
    await validateHealingDependencies();

    const message = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
    this.updateDiagnostics('playgroundError', message);
    this.updateDiagnostics('timestamp', new Date().toISOString());

    console.log(`\n[RECOMMENDER] HEALING PIPELINE START`);
    console.log(`[RECOMMENDER] Playwright Error: ${String(message).substring(0, 300)}`);
    console.log(`[RECOMMENDER] Original Selector: ${originalSelector || 'none'}`);

    // Prefer deep extraction from original error object (to get Symbol props)
    let extractedLocator = extractFailedLocator(error, error) || extractFailedLocator(message) || originalSelector || null;
    console.log(`[RECOMMENDER] FAILED SELECTOR: ${extractedLocator}`);
    this.updateDiagnostics('extractedLocator', extractedLocator);

    if (extractedLocator && !isValidSelector(extractedLocator)) {
      // Fail-fast if selector exists but invalid
      console.error(`[RECOMMENDER] ❌ Invalid selector extracted: ${extractedLocator}`);
      this.updateDiagnostics('injectionSuccess', false);
      this.updateDiagnostics('injectionDetails', `Invalid selector: ${extractedLocator}`);
      return { fixed: false, reason: `Invalid selector extracted: ${extractedLocator}` };
    }

    // Classify
    const classification = ErrorClassifier.classify(message, extractedLocator || undefined);
    this.updateDiagnostics('failureType', classification.type);
    console.log(`[RECOMMENDER] Classification: ${classification.type}; Healable: ${classification.isHealable}`);
    if (!classification.isHealable) {
      return { fixed: false, reason: `Error type not healable: ${classification.type}` };
    }

    // Strict-mode candidates
    const strictCandidates = extractStrictModeCandidates(message || '');
    if (strictCandidates && strictCandidates.length > 0) {
      this.updateDiagnostics('healingCandidates', strictCandidates.map(c => ({ selector: c.selector, score: c.score })));
      console.log(`[RECOMMENDER] HEALING CANDIDATES: ${strictCandidates.map(c => c.selector).join(', ')}`);
      const best = pickBestCandidate(strictCandidates);
      if (best && isValidSelector(best.selector)) {
        console.log(`[RECOMMENDER] SELECTED: ${best.selector}`);
        this.updateDiagnostics('selectedCandidate', best.selector);
        this.updateDiagnostics('injectionSuccess', true);
        this.updateDiagnostics('injectionDetails', `Strict mode candidate selected (score: ${best.score})`);
        return { fixed: true, newSelector: best.selector, action: 'strict_mode_resolution', reason: `Strict mode candidate (score: ${best.score})` };
      }
    }

    // Try MCP+LLM if URL available and MCP client can be loaded
    if (url) {
      try {
        console.log('🧠 Attempting MCP+LLM selector discovery...');
        let mcp: any = null;
        try {
          mcp = await getMCPClient();
        } catch (mcpErr) {
          console.warn('⚠️ MCP unavailable (import failed):', mcpErr);
          mcp = null;
        }
        if (!mcp) {
          console.warn('⚠️ MCP client not available; skipping MCP+LLM and falling back to heuristics');
          throw new Error('MCP unavailable');
        }
        const llmFix = await this.suggestViaLLMWithDOM(message, extractedLocator || originalSelector, url, step || 'unknown');
        if (llmFix && llmFix.fixed) {
          console.log(`[RECOMMENDER] SELECTED (LLM): ${llmFix.newSelector}`);
          this.updateDiagnostics('selectedCandidate', llmFix.newSelector || null);
          this.updateDiagnostics('injectionSuccess', true);
          // Debug prints requested
          console.log('FAILED:');
          console.log(extractedLocator);
          console.log('CANDIDATES:');
          console.log(this.diagnostics.healingCandidates.map(c => c.selector).join('\n'));
          console.log('SELECTED:');
          console.log(llmFix.newSelector);
          console.log('CONFIDENCE:');
          console.log('LLM');
          return llmFix;
        }
      } catch (e) {
        console.warn('⚠️ LLM+MCP approach failed or skipped, falling back to heuristics:', e);
      }
    }

    // Fallback heuristics
    console.log('📋 Using heuristic-based selector generation...');
    const alt = this.generateAlternativeHeuristic(message, extractedLocator || originalSelector || undefined);
    if (alt) {
      console.log(`[RECOMMENDER] HEALING CANDIDATES: ${alt}`);
      console.log(`[RECOMMENDER] SELECTED: ${alt}`);
      this.updateDiagnostics('selectedCandidate', alt);
      this.updateDiagnostics('injectionSuccess', true);
      this.updateDiagnostics('injectionDetails', `Heuristic-generated selector`);
      // Debug prints requested
      console.log('FAILED:');
      console.log(extractedLocator);
      console.log('CANDIDATES:');
      console.log(alt);
      console.log('SELECTED:');
      console.log(alt);
      console.log('CONFIDENCE:');
      console.log('heuristic');
      return { fixed: true, newSelector: alt, reason: `Generated heuristic-based selector: ${alt}` };
    }

    return { fixed: false, reason: 'Could not generate alternative selector' };
  }

  /** Use MCP + LLM to analyze DOM and propose selector */
  private async suggestViaLLMWithDOM(error: string, originalSelector: string | undefined, url: string, step: string): Promise<LocatorFix> {
    try {
      const mcp = await getMCPClient();
      try {
        if (typeof mcp.executeTool === 'function') await mcp.executeTool('open_url', { url });
        else if (typeof mcp.openUrl === 'function') await mcp.openUrl(url);
      } catch (openErr) {
        console.warn('⚠ MCP open_url failed (continuing):', openErr);
      }

      let domResponse: any;
      if (typeof mcp.executeTool === 'function') domResponse = await mcp.executeTool('get_dom_json', { url });
      else domResponse = await mcp.getDomJson(url);

      if (!domResponse?.elements?.length) throw new Error('Empty DOM response from MCP');

      const domContext = this.formatDOMForLLM(domResponse.elements);
      const suggestion = await this.queryLLMForSelector(error, originalSelector || '', step, domContext, domResponse.title || 'Unknown');
      if (suggestion && isValidSelector(suggestion)) {
        return { fixed: true, newSelector: suggestion, reason: 'LLM-recommended selector' };
      }
      return { fixed: false, reason: 'LLM did not return a valid selector' };
    } catch (err) {
      console.error('LLM+MCP failed:', err);
      throw err;
    }
  }

  private async queryLLMForSelector(errorMessage: string, failedSelector: string, stepDescription: string, domElements: string, pageTitle?: string): Promise<string | null> {
    const systemPrompt = `You are an expert QA automation engineer specializing in element locator strategies. Return ONLY a single selector string.`;
    const userMessage = `FAILED SELECTOR ANALYSIS:\nTest Step: ${stepDescription}\nPage Title: ${pageTitle}\nOriginal Failed Selector: ${failedSelector}\nError Message: ${errorMessage}\n\nAVAILABLE DOM ELEMENTS:\n${domElements}\n`;
    try {
      const client = getGroqClient();
      if (!client) throw new Error('GROQ_API_KEY not configured — LLM disabled');
      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userMessage } ],
        temperature: 0.2,
        max_tokens: 150,
      });
      const suggestionText = (response.choices[0].message.content || '').trim();
      const cleaned = suggestionText.replace(/```[\w]*\n?/g, '').replace(/\n/g, '').trim();
      if (cleaned && cleaned !== 'null') return cleaned;
      return null;
    } catch (err) {
      console.error('LLM request failed:', err);
      throw err;
    }
  }

  private formatDOMForLLM(elements: any[]): string {
    if (!elements || elements.length === 0) return 'No elements found';
    return elements.slice(0, 30).map((el: any, idx: number) => {
      const role = el.role || 'unknown';
      const name = el.name || '';
      const selector = el.selector || '';
      const type = el.type ? ` (type=${el.type})` : '';
      const placeholder = el.placeholder ? ` [placeholder="${el.placeholder}"]` : '';
      return `${idx + 1}. ${name} | Role: ${role}${type}${placeholder} | Selector: ${selector}`;
    }).join('\n');
  }

  private isSelectorError(error: any): boolean {
    const selectorErrors = [ 'locator not found', 'failed to find element', 'element does not exist', 'querySelector returned null', 'not visible', 'detached from DOM', 'stale element' ];
    const msg = typeof error === 'string' ? error.toLowerCase() : (error && (error.message || '') ? String(error.message).toLowerCase() : String(error || '').toLowerCase());
    return selectorErrors.some(k => msg.includes(k));
  }

  /** Heuristic fallback generator */
  private generateAlternativeHeuristic(error: string, originalSelector?: string): string | null {
    try {
      const msg = typeof error === 'string' ? error : (error || '');
      const src = ((originalSelector || '') + ' ' + msg).trim();
      const low = src.toLowerCase();

      const candidates: string[] = [];

      // Heuristic hints from error text
      if (low.includes('password')) candidates.push('[name="password"]', '[type="password"]', 'input[type="password"]');
      if (low.includes('username')) candidates.push('[name="username"]', 'input[name="username"]', '#username');
      if (low.includes('email')) candidates.push('input[type="email"]', '[name="email"]');

      // Common submit/button fallbacks
      candidates.push('button[type="submit"]', 'input[type="submit"]', 'button:has-text("Submit")', 'button:has-text("Log in")', 'button:has-text("Login")', 'button:has-text("Sign in")');

      // If original selector is attribute-style like [name="asdfdpassword"], try variants
      const attrMatch = (originalSelector || '').match(/\[([a-zA-Z0-9_-]+)=(?:"|')([^"']+)(?:"|')\]/);
      if (attrMatch) {
        const attr = attrMatch[1];
        const val = attrMatch[2];
        // exact
        candidates.push(`[${attr}="${val}"]`);
        // trimmed suffix/prefix
        const maxTrim = Math.min(6, Math.max(0, val.length - 3));
        for (let trim = 0; trim <= maxTrim; trim++) {
          const candidateVal = val.slice(trim).trim();
          if (candidateVal.length >= 3) candidates.push(`[${attr}="${candidateVal}"]`);
        }
        for (let trim = 1; trim <= Math.min(6, val.length - 3); trim++) {
          const candidateVal = val.slice(0, val.length - trim).trim();
          if (candidateVal.length >= 3) candidates.push(`[${attr}="${candidateVal}"]`);
        }
      }

      // Try to extract id, name, placeholder, aria-label from message
      const idMatch = msg.match(/id\s*[=:]\s*['"]?([a-zA-Z0-9_-]{2,})['"]?/i);
      if (idMatch) candidates.push(`#${idMatch[1]}`);
      const nameMatch = msg.match(/name\s*[=:]\s*['"]?([a-zA-Z0-9_-]{2,})['"]?/i);
      if (nameMatch) candidates.push(`[name="${nameMatch[1]}"]`, `${nameMatch[1]}`);
      const placeholderMatch = msg.match(/placeholder\s*[=:]\s*['"]([^'"]{2,})['"]/i);
      if (placeholderMatch) candidates.push(`[placeholder="${placeholderMatch[1]}"]`, `:text("${placeholderMatch[1]}")`);
      const ariaMatch = msg.match(/aria-label\s*[=:]\s*['"]([^'"]{2,})['"]/i);
      if (ariaMatch) candidates.push(`[aria-label="${ariaMatch[1]}"]`, `:text("${ariaMatch[1]}")`);

      // Text based candidates from error or selector name
      const textHints = [] as string[];
      const words = (originalSelector || '' + ' ' + msg).match(/[A-Za-z]{3,}/g) || [];
      for (const w of words.slice(0, 6)) {
        const loww = w.toLowerCase();
        if (['login','log','submit','sign','dashboard','password','username','user'].includes(loww)) textHints.push(w);
      }
      for (const t of textHints) {
        candidates.push(`text=${t}`, `:has-text("${t}")`, `button:has-text("${t}")`);
      }

      // Generic attribute fallbacks
      candidates.push('[role="button"]', '[data-test-id]', '[data-testid]');

      // Normalize and de-duplicate candidates while preserving order
      const uniq: string[] = [];
      for (const c of candidates) {
        if (!c) continue;
        const s = c.trim();
        if (!uniq.includes(s)) uniq.push(s);
      }

      // Return the first valid selector
      for (const cand of uniq) {
        if (isValidSelector(cand)) return cand;
      }
    } catch (e) { /* noop */ }
    return null;
  }
}

export default FixRecommender;
