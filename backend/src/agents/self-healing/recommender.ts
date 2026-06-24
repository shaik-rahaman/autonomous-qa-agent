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
  // PHASE 2B OPTIMIZATION: DOM Response Cache with 60-second TTL
  private static domCache: Map<string, { response: any; timestamp: number }> = new Map();
  private static DOM_CACHE_TTL = 60 * 1000; // 60 seconds

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
    console.log('SUGGEST_ALT_ENTRY: suggestAlternativeSelector', { originalSelector, url, step });
    console.log('RECOMMENDER_VERSION=2026-06-23-V4');
    try { console.log('__filename=', __filename); } catch (e) { /* ignore */ }
    console.log(`[RECOMMENDER] Playwright Error: ${String(message).substring(0, 300)}`);
    console.log(`[RECOMMENDER] Original Selector: ${originalSelector || 'none'}`);

    // Determine operation type (fill, click, etc.) from error text or structured error
    let operationType = 'unknown';
    try {
      const lowMsg = String(message).toLowerCase();
      if (
        lowMsg.includes('locator.fill') || lowMsg.includes('fill("') || (error && (error.apiName === 'locator.fill' || error.apiName === 'fill'))
      ) {
        operationType = 'fill';
      } else if (
        lowMsg.includes('locator.click') || lowMsg.includes('click(') || (error && (error.apiName === 'locator.click' || error.apiName === 'click'))
      ) {
        operationType = 'click';
      } else if (
        lowMsg.includes('locator.check') || lowMsg.includes('check(') || (error && (error.apiName === 'locator.check' || error.apiName === 'check'))
      ) {
        operationType = 'check';
      } else if (
        lowMsg.includes('selectoption') || lowMsg.includes('selectoption(') || (error && (error.apiName === 'locator.selectOption' || error.apiName === 'selectOption'))
      ) {
        operationType = 'select';
      }
    } catch (e) {
      operationType = 'unknown';
    }
    console.log('HEALING_OPERATION_TYPE:', operationType);

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
      // Operation-aware strict-mode filtering: do not select button-like roles for `fill` operations
      this.updateDiagnostics('healingCandidates', strictCandidates.map(c => ({ selector: c.selector, score: c.score })));
      console.log(`[RECOMMENDER] HEALING CANDIDATES: ${strictCandidates.map(c => c.selector).join(', ')}`);
      let strictToConsider = strictCandidates;
      try {
        if (operationType === 'fill') {
          strictToConsider = strictCandidates.filter((c: any) => {
            const role = String(c.role || '').toLowerCase();
            // reject obvious button/link roles for fill operations
            if (!role) return true;
            if (role === 'button' || role === 'link') return false;
            return true;
          });
          if (strictToConsider.length === 0) {
            console.log('STRICT_MODE_CANDIDATES_REJECTED_FOR_OPERATION: no fill-compatible strict candidates');
          }
        }
      } catch (e) { /* ignore */ }
      const best = pickBestCandidate(strictToConsider);
      if (best && isValidSelector(best.selector)) {
        console.log('HEALING_SELECTED_CANDIDATE:', best.selector);
        console.log('HEALING_ELEMENT_ROLE:', (best.selector.match(/(^input|textarea|^button|\[contenteditable|type="password"|type="email")/i) || ['unknown'])[0]);
        console.log(`[RECOMMENDER] SELECTED: ${best.selector}`);
        this.updateDiagnostics('selectedCandidate', best.selector);
        this.updateDiagnostics('injectionSuccess', true);
        this.updateDiagnostics('injectionDetails', `Strict mode candidate selected (score: ${best.score})`);
        console.log('FINAL_SELECTED_SELECTOR:', best.selector);
        console.log('FINAL_SELECTED_REASON:', `strict_mode(score:${best.score})`);
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
        const llmFix = await this.suggestViaLLMWithDOM(message, extractedLocator || originalSelector, url, step || 'unknown', operationType);
        console.log('SUGGEST_ALT: suggestViaLLMWithDOM returned', { fixed: llmFix && llmFix.fixed, selector: llmFix && llmFix.newSelector });
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
        // If LLM/MCP returned a special reason indicating MCP had candidates but no valid selection,
        // avoid falling back to heuristic-generated button selectors.
        if (llmFix && !llmFix.fixed && llmFix.reason === 'MCP_CANDIDATES_PRESENT_NO_VALID') {
          console.log('SUGGEST_ALT_EXIT_BEFORE_HEURISTICS: MCP candidates present but no valid selection; aborting heuristics');
          return { fixed: false, reason: 'NO_SUGGESTION' };
        }
      } catch (e) {
        console.warn('⚠️ LLM+MCP approach failed or skipped, falling back to heuristics:', e);
        console.log('SUGGEST_ALT_EXIT_BEFORE_LLM:', { reason: String(e).substring(0,200), stack: new Error().stack?.split('\n').slice(0,3).join('\n') });
      }
    }

    // Fallback heuristics
    console.log('📋 Using heuristic-based selector generation...');
    const alt = this.generateAlternativeHeuristic(message, extractedLocator || originalSelector || undefined, operationType);
    if (alt) {
      console.log('HEALING_FILTERED_CANDIDATES:', alt);
      console.log('HEALING_SELECTED_CANDIDATE:', alt);
      console.log('HEALING_ELEMENT_ROLE:', (alt.match(/(^input|textarea|^button|\[contenteditable|type=\"password\"|type=\"email\")/i) || ['unknown'])[0]);
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
      console.log('FINAL_SELECTED_SELECTOR:', alt);
      console.log('FINAL_SELECTED_REASON:', 'heuristic-generated');
      console.log('CONFIDENCE:');
      console.log('heuristic');
      return { fixed: true, newSelector: alt, reason: `Generated heuristic-based selector: ${alt}` };
    }

    console.log('SUGGEST_ALT_EXIT: no selector found', { reason: 'Could not generate alternative selector' });
    return { fixed: false, reason: 'Could not generate alternative selector' };
  }

  /** Use MCP + LLM to analyze DOM and propose selector */
  private async suggestViaLLMWithDOM(error: string, originalSelector: string | undefined, url: string, step: string, operationType: string): Promise<LocatorFix> {
    console.log('SUGGEST_VIA_LLM_ENTRY:', { originalSelector, url, step, operationType });
    try {
      // PHASE 2B OPTIMIZATION: Check DOM cache first (60-second TTL)
      const cacheKey = url;
      const now = Date.now();
      const cached = FixRecommender.domCache.get(cacheKey);
      
      let domResponse: any;
      if (cached && (now - cached.timestamp) < FixRecommender.DOM_CACHE_TTL) {
        domResponse = cached.response;
        console.log(`[PHASE-2B-OPT] 🚀 Using cached DOM response (age: ${now - cached.timestamp}ms)`);
      } else {
        // PHASE 2B OPTIMIZATION: Parallelize open_url and get_dom_json with 2-second timeout
        const mcp = await getMCPClient();
        
        const mcpTimeout = 15000; // 15-second timeout for MCP calls (increased to avoid premature disconnects)
        const mcpStart = Date.now();
        try { console.log('MCP_START_TIME', new Date(mcpStart).toISOString()); } catch (e) {}
        
        // Parallel execution of open_url and get_dom_json
        const results = await Promise.allSettled([
          this.executeWithTimeout(async () => {
            if (typeof mcp.executeTool === 'function') await mcp.executeTool('open_url', { url });
            else if (typeof mcp.openUrl === 'function') await mcp.openUrl(url);
          }, mcpTimeout, 'open_url'),
          this.executeWithTimeout(async () => {
            if (typeof mcp.executeTool === 'function') domResponse = await mcp.executeTool('get_dom_json', { url });
            else domResponse = await mcp.getDomJson(url);
            return domResponse;
          }, mcpTimeout, 'get_dom_json'),
        ]);

        // Handle parallel results
        const openResult = results[0];
        const domResult = results[1];

        const mcpEnd = Date.now();
        try { console.log('MCP_END_TIME', new Date(mcpEnd).toISOString()); } catch (e) {}
        try { console.log('MCP_DURATION_MS', mcpEnd - mcpStart); } catch (e) {}

        // Determine phase of any timeout/failure
        const openStatus = openResult.status;
        const domStatus = domResult.status;
        const openReason = openResult.status === 'rejected' ? String(openResult.reason || '') : '';
        const domReason = domResult.status === 'rejected' ? String(domResult.reason || '') : '';
        let mcpPhase = 'unknown';
        if (openStatus === 'rejected' && domStatus === 'rejected') {
          if (/could not launch|failed to launch|browser/i.test(openReason + domReason)) mcpPhase = 'before_browser_launch';
          else if (/timeout/i.test(openReason) && /timeout/i.test(domReason)) mcpPhase = 'navigation_and_dom';
          else mcpPhase = 'both_failed';
        } else if (openStatus === 'rejected') {
          mcpPhase = 'navigation';
        } else if (domStatus === 'rejected') {
          mcpPhase = 'dom_extraction';
        } else {
          mcpPhase = 'success';
        }

        try { console.log('MCP_PHASE', mcpPhase); } catch (e) {}
        try { console.log('MCP_OPEN_RESULT', openStatus); } catch (e) {}
        try { console.log('MCP_OPEN_REASON', openReason.substring(0, 1000)); } catch (e) {}
        try { console.log('MCP_DOM_RESULT', domStatus); } catch (e) {}
        try { console.log('MCP_DOM_REASON', domReason.substring(0, 1000)); } catch (e) {}

        if (openResult.status === 'rejected') {
          console.warn('[PHASE-2B-OPT] ⏱️ MCP open_url timeout/failed (continuing)');
        }

        if (domResult.status === 'rejected') {
          console.warn('[PHASE-2B-OPT] ⏱️ MCP get_dom_json timeout/failed');
          throw new Error('DOM fetch failed: ' + domResult.reason);
        }

        domResponse = domResult.value;

        // Cache the DOM response
        FixRecommender.domCache.set(cacheKey, { response: domResponse, timestamp: now });
        console.log('[PHASE-2B-OPT] 📦 Cached DOM response for 60 seconds');
      }

      if (!domResponse?.elements?.length) throw new Error('Empty DOM response from MCP');

      // Build structured candidate list from MCP elements
      const elems = domResponse.elements || [];
      let candidates = elems.map((el: any) => ({
        selector: el.selector || null,
        tag: el.tag || null,
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        placeholder: el.placeholder || null,
        role: el.role || null,
        text: el.text || null,
      }));

      try { console.log('MCP_CANDIDATES_RAW:', JSON.stringify(candidates, null, 2)); } catch (e) {}

      // Operation-aware MCP candidate filtering BEFORE LLM invocation
      console.log('HEALING_OPERATION_TYPE:', operationType || 'unknown');
      let filteredCandidates = candidates.slice();
      if (operationType === 'fill') {
        filteredCandidates = candidates.filter((c: any) => {
          const tag = String(c.tag || '').toLowerCase();
          const role = String(c.role || '').toLowerCase();
          const type = String(c.type || '').toLowerCase();
          const sel = String(c.selector || '').toLowerCase();

          // allow only input-like elements
          const allowTag = tag === 'input' || tag === 'textarea';
          const allowContentEditable = sel.includes('contenteditable') || (c.attributes && c.attributes.contenteditable);
          const allowRoleInput = role === 'textbox' || role === 'input' || role === 'searchbox';
          const allowType = ['text', 'password', 'email', 'search'].includes(type);

          const isAllowed = allowTag || allowContentEditable || allowRoleInput || allowType || Boolean(c.name) || Boolean(c.placeholder);

          // reject obvious non-editable targets
          const isButtonish = role === 'button' || sel.includes('button') || type === 'submit' || sel.includes('type="submit"') || sel.includes('type=submit');
          const isLinkish = tag === 'a' || role === 'link' || sel.includes('href=') || sel.includes('anchor');
          const isCheckboxRadio = role === 'checkbox' || role === 'radio' || type === 'checkbox' || type === 'radio';

          if (isButtonish || isLinkish || isCheckboxRadio) return false;
          return isAllowed;
        });
      }

      try { console.log('MCP_CANDIDATES_FILTERED:', JSON.stringify(filteredCandidates.map((c: any) => c.selector), null, 2)); } catch (e) {}
      if (operationType === 'fill' && (!filteredCandidates || filteredCandidates.length === 0)) {
        console.log('MCP_CANDIDATES_FILTERED=EMPTY - NO_SUGGESTION for fill operation');
        console.log('FINAL_SELECTED_SELECTOR:', null);
        console.log('FINAL_SELECTED_REASON:', 'NO_SUGGESTION - no MCP candidates compatible with fill');
        return { fixed: false, reason: 'NO_SUGGESTION' };
      }

      // Use the filtered list as the candidates provided to the LLM
      const candidatesForLLM = filteredCandidates;
      // Also make deterministic ranking operate on the same filtered set
      candidates = candidatesForLLM.slice();

      // HARD GUARD: if MCP returned exactly one compatible fill candidate, auto-select it
      if (operationType === 'fill' && candidatesForLLM.length === 1) {
        const single = candidatesForLLM[0];
        const sel = single && single.selector ? String(single.selector) : null;
        if (sel && isValidSelector(sel)) {
          console.log('MCP_SINGLE_COMPATIBLE_FILL_CANDIDATE:', sel);
          console.log('FINAL_SELECTED_SELECTOR:', sel);
          console.log('FINAL_SELECTED_REASON:', 'MCP_SINGLE_COMPATIBLE_FILL_CANDIDATE');
          return { fixed: true, newSelector: sel, reason: 'MCP_SINGLE_COMPATIBLE_FILL_CANDIDATE' };
        }
      }

      // Additional auto-select: if there is exactly one password-like candidate, pick it immediately
      if (operationType === 'fill') {
        const passwordLike = candidatesForLLM.filter((c: any) => {
          const sel = String(c.selector || '').toLowerCase();
          const type = String(c.type || '').toLowerCase();
          const name = String(c.name || '').toLowerCase();
          const id = String(c.id || '').toLowerCase();
          return type === 'password' || /pass(word)?|pwd/.test(sel + ' ' + name + ' ' + id);
        });
        if (passwordLike.length === 1) {
          const sel = String(passwordLike[0].selector || passwordLike[0].name || passwordLike[0].id);
          if (sel && isValidSelector(sel)) {
            console.log('MCP_SINGLE_PASSWORD_CANDIDATE_AUTOPICK:', sel);
            console.log('FINAL_SELECTED_SELECTOR:', sel);
            console.log('FINAL_SELECTED_REASON:', 'MCP_SINGLE_PASSWORD_CANDIDATE_AUTOPICK');
            return { fixed: true, newSelector: sel, reason: 'MCP_SINGLE_PASSWORD_CANDIDATE_AUTOPICK' };
          }
        }
      }

      // Diagnostics for LLM input
      try {
        console.log('LLM_ENTRY');
        console.log('LLM_INPUT_CANDIDATES (count):', candidatesForLLM.length);
        console.log('LLM_INPUT_CANDIDATES:', JSON.stringify(candidatesForLLM.slice(0, 200), null, 2));
      } catch (e) { /* ignore logging errors */ }
      console.log('LLM_OPERATION_TYPE:', operationType || 'unknown');
      console.log('SUGGEST_VIA_LLM_BEFORE_QUERY:', { operationType, candidateCount: (typeof candidatesForLLM !== 'undefined' ? candidatesForLLM.length : candidates.length) });

      const domContext = this.formatDOMForLLM(domResponse.elements);
      const llmResult = await this.queryLLMForSelector(error, originalSelector || '', step, domContext, domResponse.title || 'Unknown', candidatesForLLM, operationType);

      // llmResult: { suggestion: string|null, raw: any }
      const suggestion = llmResult && (llmResult.suggestion || null);
      const rawResponse = llmResult && (llmResult.raw || null);
      console.log('LLM_RESPONSE_RAW=', rawResponse);
      console.log('LLM_SELECTED_SELECTOR=', suggestion);

      // If LLM returns a selector that exactly matches one of the MCP candidates, accept it.
      let selected: string | null = null;
      try {
        if (suggestion) {
          const lower = String(suggestion).trim();
          const match = candidates.find((c: any) => {
            if (!c.selector) return false;
            return String(c.selector).trim() === lower || String(c.selector).trim() === lower.replace(/\n/g, '') || String(c.selector).trim().toLowerCase() === lower.toLowerCase();
          });
          if (match && match.selector) {
              selected = match.selector;
              console.log('LLM_SELECTED_SELECTOR:', selected);
              console.log('LLM_CONFIDENCE:', 'llm');
              // Validate: for fill operations, do not accept button/link/submit-like selectors
              const selLow = String(selected).toLowerCase();
              const roleLow = String(match.role || '').toLowerCase();
              const typeLow = String(match.type || '').toLowerCase();
              const isButtonish = roleLow === 'button' || selLow.includes('button') || selLow.includes('role="button"') || selLow.includes('submit') || /submit|button/.test(typeLow);
              const isLinkish = roleLow === 'link' || selLow.includes('href=') || selLow.includes('anchor');
              if (operationType === 'fill' && (isButtonish || isLinkish)) {
                console.warn('INVALID_FILL_CANDIDATE_REJECTED', selected);
                // continue to deterministic ranking/fallback
              } else {
                if (selected && isValidSelector(selected)) {
                  console.log('SUGGEST_VIA_LLM_EXIT: LLM-selected', selected);
                  console.log('FINAL_SELECTED_SELECTOR:', selected);
                  console.log('FINAL_SELECTED_REASON:', 'LLM-selected from MCP candidates');
                  return { fixed: true, newSelector: selected, reason: 'LLM-selected from MCP candidates' };
                }
              }
            }
        }
      } catch (e) { /* continue to fallback */ }

      // If we reached here, LLM did not provide a valid selection. If MCP had filtered candidates,
      // avoid falling back to heuristics that may pick buttons. Indicate MCP presence so caller can decide.
      const mcpHadFiltered = Array.isArray(filteredCandidates) && filteredCandidates.length > 0;
      if (mcpHadFiltered) {
        console.log('SUGGEST_VIA_LLM_EXIT: MCP candidates present but LLM/deterministic did not yield a valid selector');
        return { fixed: false, reason: 'MCP_CANDIDATES_PRESENT_NO_VALID' };
      }

      // Operation-aware filtering: for fill operations, prefer input-like candidates and drop buttons
      if (operationType === 'fill') {
        const filtered = candidates.filter((c: any) =>
          (c.role && String(c.role).toLowerCase().includes('input')) ||
          (c.type && ['text','password','email'].includes(String(c.type).toLowerCase())) ||
          (c.selector && String(c.selector).toLowerCase().includes('input')) ||
          (c.selector && String(c.selector).toLowerCase().includes('name='))
        );
        try { console.log('HEALING_FILTERED_CANDIDATES=', JSON.stringify(filtered, null, 2)); } catch (e) {}
        if (filtered.length > 0) {
          candidates.splice(0, candidates.length, ...filtered);
        } else {
          console.log('HEALING_FILTERED_CANDIDATES= (no candidates passed filter)');
        }
      }

      // Deterministic ranking fallback: score candidates by similarity + role/operation compatibility
      // helper: simple Levenshtein distance
      const levenshtein = (a: string, b: string) => {
        if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
        const m = a.length, n = b.length;
        const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) d[i][0] = i;
        for (let j = 0; j <= n; j++) d[0][j] = j;
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
          }
        }
        return d[m][n];
      };

      const extractAttributeToken = (s: string | undefined) => {
        if (!s) return '';
        try {
          // match [name="password"] or id="password" or name=password
          const m = String(s).match(/\[?\s*(?:name|id|placeholder|aria-label)\s*=\s*(?:\"|\')?([^\]"'\s]+)(?:\"|\')?\]?/i);
          if (m && m[1]) return m[1].toLowerCase();
        } catch (e) { /* noop */ }
        // fallback: strip non-alphanum
        return String(s).replace(/[^a-z0-9]/gi, ' ').split(/\s+/).filter(Boolean)[0]?.toLowerCase() || '';
      };

      const scoreCandidate = (c: any) => {
        let score = 0;
        try {
          const candSel = String(c.selector || '').toLowerCase();
          const orig = String(originalSelector || '').toLowerCase();
          if (!candSel) return -9999;
          if (candSel === orig && orig) score += 100;
          if (orig && candSel.includes(orig)) score += 20;
          if (orig && orig.includes(candSel)) score += 15;
          // token overlap
          const tok = candSel.split(/[^a-z0-9]+/).filter(Boolean);
          const otok = orig.split(/[^a-z0-9]+/).filter(Boolean);
          const common = tok.filter((t: string) => otok.includes(t)).length;
          score += common * 4;
          // semantic similarity: compare attribute tokens (e.g., passwod -> password)
          const origToken = extractAttributeToken(originalSelector);
          const candToken = extractAttributeToken(c.selector || c.name || c.id || '');
          if (origToken && candToken) {
            const dist = levenshtein(origToken, candToken);
            const maxLen = Math.max(origToken.length, candToken.length, 1);
            const similarity = 1 - dist / maxLen; // 0..1
            score += Math.round(similarity * 50); // add up to +50
          }
          // Avoid selecting username-like when original indicates password intent
          const origIndicatesPassword = /pass|pwd|password/.test(orig);
          const candLooksUsername = /(user|username|login|email)/.test(candSel + ' ' + String(c.name || '') + ' ' + String(c.id || ''));
          if (origIndicatesPassword && candLooksUsername) {
            // heavy penalty and log rejection
            console.log('HEURISTIC_REJECTED_REASON', { candidate: c.selector, reason: 'username-like when original suggests password' });
            score -= 1000;
          }
          // operation compatibility
          const tag = String(c.tag || '').toLowerCase();
          const type = String(c.type || '').toLowerCase();
          const role = String(c.role || '').toLowerCase();
          const isInputLike = tag === 'input' || tag === 'textarea' || /password|email|text/.test(type) || role === 'textbox' || Boolean(c.placeholder) || Boolean(c.name);
          const isButtonLike = tag === 'button' || role === 'button' || /submit|button/.test(type) || (c.selector && String(c.selector).toLowerCase().includes('button'));
          if (operationType === 'fill' && isInputLike) score += 30;
          if (operationType === 'fill' && isButtonLike) score -= 50;
          if (operationType === 'click' && isButtonLike) score += 30;
          // small boost for having id/name
          if (c.id) score += 3;
          if (c.name) score += 3;
        } catch (e) { /* noop */ }
        return score;
      };

      let best: any = null;
      let bestScore = -Infinity;
      for (const c of candidates) {
        const s = scoreCandidate(c);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (best && best.selector) {
        // Validate candidate is not a button for fill operations
        const selLow = String(best.selector).toLowerCase();
        const roleLow = String(best.role || '').toLowerCase();
        const typeLow = String(best.type || '').toLowerCase();
        const isButtonish = roleLow === 'button' || selLow.includes('button') || selLow.includes('role="button"') || selLow.includes('submit') || /submit|button/.test(typeLow);
        if (operationType === 'fill' && isButtonish) {
          console.warn('Invalid healing candidate skipped for fill operation (button-like):', best.selector);
          console.log('INVALID_FILL_CANDIDATE_REJECTED:', best.selector);
          // pick next-best non-button candidate
          let secondBest: any = null;
          let secondScore = -Infinity;
          for (const c of candidates) {
            const s = scoreCandidate(c);
            const cs = String(c.selector || '').toLowerCase();
            const cr = String(c.role || '').toLowerCase();
            const ct = String(c.type || '').toLowerCase();
            const cIsButton = cr === 'button' || cs.includes('button') || cs.includes('role="button"') || cs.includes('submit') || /submit|button/.test(ct);
            if (!cIsButton && s > secondScore) { secondScore = s; secondBest = c; }
          }
          if (secondBest && secondBest.selector) {
            console.log('LLM_SELECTED_SELECTOR:', secondBest.selector);
            console.log('LLM_CONFIDENCE:', `deterministic(${secondScore})`);
            console.log('FINAL_SELECTED_SELECTOR:', secondBest.selector);
            console.log('FINAL_SELECTED_REASON:', `deterministic-second-best(score:${secondScore})`);
            if (isValidSelector(secondBest.selector)) {
              console.log('SUGGEST_VIA_LLM_EXIT: deterministic second-best selected', secondBest.selector);
              return { fixed: true, newSelector: secondBest.selector, reason: `Deterministic-ranked selector (score: ${secondScore})` };
            }
          }
          // fallthrough to fail
        } else {
          console.log('LLM_SELECTED_SELECTOR:', best.selector);
          console.log('LLM_CONFIDENCE:', `deterministic(${bestScore})`);
          console.log('FINAL_SELECTED_SELECTOR:', best.selector);
          console.log('FINAL_SELECTED_REASON:', `deterministic-best(score:${bestScore})`);
          if (isValidSelector(best.selector)) {
            console.log('SUGGEST_VIA_LLM_EXIT: deterministic best selected', best.selector);
            return { fixed: true, newSelector: best.selector, reason: `Deterministic-ranked selector (score: ${bestScore})` };
          }
        }
      }

      return { fixed: false, reason: 'LLM did not return a valid selector and deterministic fallback failed' };
    } catch (err) {
      console.error('LLM+MCP failed:', err);
      throw err;
    }
  }

  /**
   * Execute promise with timeout wrapper
   */
  private executeWithTimeout<T>(promise: () => Promise<T>, timeout: number, label: string): Promise<T> {
    return Promise.race([
      promise(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`[PHASE-2B-OPT] ⏱️ ${label} timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  private async queryLLMForSelector(
    errorMessage: string,
    failedSelector: string,
    stepDescription: string,
    domElements: string,
    pageTitle: string | undefined,
    candidates: any[],
    operationType: string
  ): Promise<{ suggestion: string | null; raw: any }> {
    const systemPrompt = `You are an expert QA automation engineer specializing in element locator strategies. YOU MUST CHOOSE ONE selector FROM THE PROVIDED CANDIDATES. Do NOT invent new selectors. Return ONLY a single selector string that EXACTLY matches one of the provided candidate selectors. If none are suitable, return NO_SUGGESTION.`;
    const userMessage = `FAILED SELECTOR ANALYSIS:\nTest Step: ${stepDescription}\nPage Title: ${pageTitle}\nOriginal Failed Selector: ${failedSelector}\nError Message: ${errorMessage}\n\nOPERATION_TYPE: ${operationType}\n\nCANDIDATES_JSON:\n${JSON.stringify(candidates.slice(0, 200), null, 2)}\n\nAVAILABLE_DOM_ELEMENTS_SUMMARY:\n${domElements}\n`;

    console.log('QUERY_LLM_ENTRY', { failedSelector, stepDescription, operationType, candidateCount: candidates.length });
    try { console.log('LLM_PROMPT (truncated):', userMessage.substring(0, 2000)); } catch (e) { }

    try {
      const client = getGroqClient();
      console.log('LLM_CLIENT_STATUS', { available: !!client, modelEnv: process.env.LLM_MODEL || null, groqApiKeySet: !!process.env.GROQ_API_KEY });
      if (!client) {
        console.log('QUERY_LLM_EXIT: LLM disabled (no GROQ_API_KEY)');
        console.log('LLM_FAILURE_REASON', 'NO_GROQ_API_KEY');
        return { suggestion: null, raw: null };
      }

      const requestPayload = {
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userMessage } ],
        temperature: 0.0,
        max_tokens: 150,
      };

      try { console.log('LLM_REQUEST_SENT', { model: requestPayload.model, candidateCount: candidates.length }); } catch (e) {}

      const llmPromise = client.chat.completions.create(requestPayload);

      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('LLM_TIMEOUT: Response exceeded 5 seconds')), 5000)
      );

      let response: any;
      try {
        response = await Promise.race([llmPromise, timeoutPromise]);
        try { console.log('LLM_RESPONSE_RAW', JSON.stringify(response).slice(0, 2000)); } catch (e) { console.log('LLM_RESPONSE_RAW (non-json)'); }
      } catch (err) {
        console.warn('QUERY_LLM_ERROR: LLM request failed or timed out', String(err).substring(0,200));
        console.log('LLM_FAILURE_REASON', String(err).substring(0,200));
        return { suggestion: null, raw: err };
      }

      try {
        const suggestionText = (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) ? String(response.choices[0].message.content) : '';
        const suggestionTextTrim = suggestionText.trim();
        if (!suggestionTextTrim) {
          console.log('LLM_PARSE_RESULT', { parsed: null, reason: 'empty_content' });
          console.log('QUERY_LLM_EXIT: no suggestion text in response');
          return { suggestion: null, raw: response };
        }
        const cleaned = suggestionTextTrim.replace(/```[\w]*\n?/g, '').split('\n')[0].trim();
        if (!cleaned || cleaned.toUpperCase() === 'NO_SUGGESTION' || cleaned === 'NULL') {
          console.log('LLM_PARSE_RESULT', { parsed: null, reason: 'NO_SUGGESTION_OR_NULL', rawSample: String(suggestionTextTrim).substring(0,200) });
          console.log('QUERY_LLM_EXIT: LLM returned NO_SUGGESTION or null', { raw: response });
          return { suggestion: null, raw: response };
        }
        console.log('LLM_PARSE_RESULT', { parsed: cleaned });
        return { suggestion: cleaned, raw: response };
      } catch (err) {
        console.warn('QUERY_LLM_EXIT: failed to parse LLM response', err);
        return { suggestion: null, raw: response };
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('LLM_TIMEOUT')) {
        console.warn('[PHASE-1-OPT] ⏱️ LLM call timeout - falling back to heuristics');
        return { suggestion: null, raw: err };
      }
      console.error('QUERY_LLM_ERROR: LLM request failed (unexpected)', err);
      return { suggestion: null, raw: err };
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
  private generateAlternativeHeuristic(error: string, originalSelector?: string, operationType: string = 'unknown'): string | null {
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

      // Filter based on operation type (e.g. for fill operations prefer input-like elements and never rank buttons)
      const isButtonPattern = /(^button|role\s*=\s*\"?button\b|:has-text\(|input\[type=\"submit\"\]|input\[type=\"button\"\]|button:has-text\()/i;
      const isInputLike = /(^input\b|^textarea\b|\[contenteditable\b|type=\"password\"|type=\"email\"|\[name=\"[^\"]+\"|:text\(|\[placeholder=\")/i;

      let candidatesToConsider = uniq.slice();
      if (operationType === 'fill') {
        // remove button-like selectors entirely for fill operations
        candidatesToConsider = candidatesToConsider.filter(c => !isButtonPattern.test(c));
        console.log('HEALING_FILTERED_CANDIDATES:', candidatesToConsider.join(', '));
        if (candidatesToConsider.length === 0) {
          // If nothing matches the input-like constraints, give up on heuristics
          return null;
        }
        // Prefer explicit input-like selectors first
        const inputLike = candidatesToConsider.filter(c => isInputLike.test(c));
        if (inputLike.length > 0) candidatesToConsider = inputLike.concat(candidatesToConsider.filter(c => !inputLike.includes(c)));
      } else {
        console.log('HEALING_FILTERED_CANDIDATES (no-op for operation):', candidatesToConsider.join(', '));
      }

      // Return the first valid selector from the filtered list
      for (const cand of candidatesToConsider) {
        if (isValidSelector(cand)) return cand;
      }
    } catch (e) { /* noop */ }
    return null;
  }
}

export default FixRecommender;
