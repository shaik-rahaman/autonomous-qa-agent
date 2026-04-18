/**
 * Fix Recommender - Intelligent LLM-based Failure Analysis
 * Analyzes ANY Playwright test failure type and generates intelligent fixes
 */

import Groq from 'groq-sdk';
import { logger } from '../../utils/logger';

// Lazy import of MCPClient - only when needed to avoid circular dependencies
let mcpClientInstance: any = null;

async function getMCPClient() {
  if (!mcpClientInstance) {
    try {
      // Dynamic import to avoid circular dependencies at startup
      // @ts-ignore - Dynamic import resolution
      const { MCPClient } = await import('../../mcp/client');
      mcpClientInstance = new MCPClient(process.env.MCP_SERVER_URL);
    } catch (error) {
      console.error('Failed to load MCP client:', error);
      throw new Error('MCP client initialization failed');
    }
  }
  return mcpClientInstance;
}

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export interface FailureAnalysis {
  type: 'locator_issue' | 'timeout_issue' | 'navigation_issue' | 'unknown';
  fixable: boolean;
  fix?: {
    selector?: string;
    action?: 'click' | 'fill' | 'wait' | 'navigate';
    strategy?: string;
  };
}

export interface LocatorFix {
  fixed: boolean;
  newSelector?: string;
  action?: string;
  reason: string;
}


export class FixRecommender {
  /**
   * Main entry point - ALWAYS attempt healing for ANY Playwright UI failure
   * NO blocking conditions - healing is FORCED for all errors
   */
  async suggestAlternativeSelector(error: string, originalSelector: string, url?: string, step?: string): Promise<LocatorFix> {
    try {
      logger.info(`\n========== HEALING STARTED ==========`);
      logger.info(`🏥 Healing attempt for: ${step || 'unknown'}`);
      
      // STEP 1: Extract FULL selector pattern from error (CRITICAL)
      logger.info(`[STEP 1] Extracting FULL selector from error message...`);
      let extractedSelector = originalSelector;
      try {
        // Try to extract full getByRole(...) pattern
        const fullMatch = error?.match(/getByRole\([^)]*\)/);
        if (fullMatch && fullMatch[0]) {
          extractedSelector = fullMatch[0];
          logger.info(`   ✓ Extracted full selector: ${extractedSelector}`);
        } else {
          logger.info(`   ⚠ Full pattern not found, using original: ${extractedSelector}`);
        }
      } catch (e) {
        logger.debug('Could not extract selector from error', e);
      }

      // STEP 2: Fetch DOM context via MCP (FORCED)
      logger.info(`[STEP 2] Fetching DOM context via MCP...`);
      let domContext = '';
      if (url) {
        try {
          domContext = await this.getDOMContext(url);
          logger.info(`   ✓ DOM fetched for healing`);
        } catch (err) {
          logger.warn(`   ⚠ DOM fetch failed, continuing without DOM: ${err}`);
          // NO RETURN - continue anyway
        }
      }

      // STEP 3: Call LLM for failure analysis (FORCED)
      logger.info(`[STEP 3] Calling LLM for healing analysis...`);
      const analysis = await this.analyzeFailure({
        step: step || 'unknown_step',
        error,
        selector: extractedSelector,
        url: url || 'unknown',
        domContext,
      });

      logger.info(`   ✓ LLM analysis complete`);
      logger.info(`   - Type: ${analysis.type}`);
      logger.info(`   - Fixable: ${analysis.fixable}`);

      // STEP 4: Process LLM response
      logger.info(`[STEP 4] Processing LLM response...`);
      
      if (!analysis.fixable) {
        logger.warn(`   ⚠ LLM says not fixable`);
        return {
          fixed: false,
          reason: `LLM analysis: ${analysis.type} - Not fixable`,
        };
      }

      // Extract new selector from LLM response
      if (analysis.fix?.selector) {
        logger.success(`✅ HEALING SUCCESS`);
        logger.info(`   New selector: ${analysis.fix.selector}`);
        logger.info(`   Action: ${analysis.fix.action || 'none'}`);
        return {
          fixed: true,
          newSelector: analysis.fix.selector,
          action: analysis.fix.action,
          reason: `LLM-generated fix for ${analysis.type}`,
        };
      }

      if (analysis.fix?.strategy) {
        logger.success(`✅ HEALING SUCCESS`);
        logger.info(`   Strategy: ${analysis.fix.strategy}`);
        return {
          fixed: true,
          action: analysis.fix.action,
          reason: `LLM-generated strategy: ${analysis.fix.strategy}`,
        };
      }

      logger.warn(`   ⚠ LLM had no fix to generate`);
      return {
        fixed: false,
        reason: 'LLM could not generate fix',
      };
    } catch (error) {
      logger.error(`❌ HEALING FAILED`);
      logger.error(`   Error: ${error}`);
      return {
        fixed: false,
        reason: `Healing error: ${String(error)}`,
      };
    }
  }

  /**
   * Fetch DOM context using MCP (FORCED)
   */
  private async getDOMContext(url: string): Promise<string> {
    logger.info(`   📡 Initializing MCP connection...`);
    try {
      const mcpClient = await getMCPClient();
      logger.info(`   ✓ MCP client ready`);
      logger.info(`   📄 Opening URL: ${url}`);

      // Try to open the URL in MCP's browser before fetching DOM (use executeTool when available)
      try {
        if (typeof mcpClient.executeTool === 'function') {
          await mcpClient.executeTool('open_url', { url });
        } else if (typeof mcpClient.openUrl === 'function') {
          await mcpClient.openUrl(url);
        }
        logger.info(`   ✓ URL opened in MCP browser`);
      } catch (openErr) {
        logger.warn('   ⚠ MCP open_url failed (continuing):', openErr);
      }

      logger.info(`   🌐 Fetching DOM structure...`);
      let domResponse: any;
      if (typeof mcpClient.executeTool === 'function') {
        domResponse = await mcpClient.executeTool('get_dom_json', { url });
      } else {
        domResponse = await mcpClient.getDomJson(url);
      }

      if (!domResponse?.elements?.length) {
        logger.warn(`   ⚠ No DOM elements returned`);
        return 'No DOM elements available';
      }

      logger.info(`   ✓ DOM fetched: ${domResponse.elements.length} elements found`);
      return this.formatDOMForLLM(domResponse.elements);
    } catch (err) {
      logger.warn(`   ⚠ MCP DOM fetch error: ${err}`);
      throw err;
    }
  }

  /**
   * LLM-based failure analysis - ALWAYS treat locator issues as fixable
   * NO blocking - LLM decides type, but locator issues are ALWAYS fixable
   */
  private async analyzeFailure(input: {
    step: string;
    error: string;
    selector?: string;
    url: string;
    domContext?: string;
  }): Promise<FailureAnalysis> {
    const systemPrompt = `You are a QA healing expert for Playwright tests. Your ONLY job is to fix element locator issues.

CRITICAL RULES:
1. If error contains ANY of: "not found", "not visible", "element(s) not found", "toBeVisible", "locator", "Locator", "getByRole"
   → Type is locator_issue, ALWAYS return fixable: TRUE
   
2. For locator_issue AND fixable: TRUE, MUST return:
   {
     "type": "locator_issue",
     "fixable": true,
     "fix": {
       "selector": "getByRole('button', { name: /..../i })",
       "action": "click"
     }
   }

3. For non-locator failures, only then can you return fixable: false

4. ANALYZE the error to find the intended element and suggest a BETTER selector using the DOM

5. Return ONLY valid JSON, nothing else.

Format examples:
FIXABLE:
{"type":"locator_issue","fixable":true,"fix":{"selector":"getByRole('button', { name: /login/i })","action":"click"}}

NOT FIXABLE (only for non-locator):
{"type":"timeout_issue","fixable":false}`;

    const userMessage = `HEALING REQUEST:

Step: ${input.step}
URL: ${input.url}
Original Selector: ${input.selector || 'none'}

ERROR:
${input.error}

${input.domContext ? `AVAILABLE DOM:\n${input.domContext}` : ''}

TASK: Fix this by generating a working selector or strategy. For locator_issue, ALWAYS return fixable: true.`;

    try {
      logger.info(`🤖 [LLM] Querying for failure analysis...`);
      
      const response = await groqClient.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1, // Very low temp for strict adherence
        max_tokens: 300,
      });

      const responseText = (response.choices[0].message.content || '').trim();
      logger.info(`[LLM Response] ${responseText.substring(0, 200)}...`);

      // Parse LLM response as JSON
      const analysis = this.parseLLMAnalysis(responseText);
      logger.info(`✓ [Parsed] Type: ${analysis.type}, Fixable: ${analysis.fixable}`);
      
      return analysis;
    } catch (error) {
      logger.error(`❌ [LLM] Analysis error: ${error}`);
      throw error;
    }
  }

  /**
   * Parse LLM JSON response safely
   */
  private parseLLMAnalysis(responseText: string): FailureAnalysis {
    try {
      // Try direct parse
      const analysis = JSON.parse(responseText);
      
      if (!analysis.type) analysis.type = 'unknown';
      if (analysis.fixable === undefined) analysis.fixable = false;
      
      return analysis;
    } catch (err) {
      logger.warn(`⚠️ Failed to parse LLM response as JSON: ${err}`);
      
      // Fallback: try to extract JSON from text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { }
      }
      
      // Last resort: default response
      return {
        type: 'unknown',
        fixable: false,
      };
    }
  }


  /**
   * Format DOM elements for LLM context
   */
  private formatDOMForLLM(elements: any[]): string {
    if (!elements || elements.length === 0) {
      return 'No elements found';
    }

    return elements
      .slice(0, 30) // Limit to first 30 elements for token efficiency
      .map((el, idx) => {
        const role = el.role || 'unknown';
        const name = el.name || '';
        const selector = el.selector || '';
        const type = el.type ? ` (type=${el.type})` : '';
        const placeholder = el.placeholder ? ` [placeholder="${el.placeholder}"]` : '';

        return `${idx + 1}. ${name} | Role: ${role}${type}${placeholder} | Selector: ${selector}`;
      })
      .join('\n');
  }
}

