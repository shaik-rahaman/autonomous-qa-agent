"use strict";
/**
 * Fix Recommender - Enhanced with MCP + LLM for Intelligent Selector Discovery
 * Uses real DOM analysis and AI to suggest better selectors for failed element lookups
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const path = require('path');
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixRecommender = void 0;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
// Lazy import of MCPClient - only when needed to avoid circular dependencies
let mcpClientInstance = null;
async function getMCPClient() {
    if (!mcpClientInstance) {
        const candidates = [
            '../../../backend/src/mcp/client',
            '../../mcp/client',
            path.resolve(process.cwd(), 'backend', 'src', 'mcp', 'client'),
            path.resolve(process.cwd(), 'pw-ai-agents', 'src', 'mcp', 'client'),
        ];
        for (const p of candidates) {
            try {
                const mod = await Promise.resolve().then(() => __importStar(require(p)));
                if (mod.mcpClient) { mcpClientInstance = mod.mcpClient; console.log('MCP CLIENT LOADED'); return mcpClientInstance; }
                if (mod.MCPClient) { mcpClientInstance = new mod.MCPClient(process.env.MCP_SERVER_URL); console.log('MCP CLIENT LOADED'); return mcpClientInstance; }
            }
            catch (error) {
                try {
                    const req = require(p);
                    if (req.mcpClient) { mcpClientInstance = req.mcpClient; console.log('MCP CLIENT LOADED'); return mcpClientInstance; }
                    if (req.MCPClient) { mcpClientInstance = new req.MCPClient(process.env.MCP_SERVER_URL); console.log('MCP CLIENT LOADED'); return mcpClientInstance; }
                }
                catch (e) {
                    // continue
                }
            }
        }
        console.warn('MCP client could not be loaded; continuing without MCP (heuristics only)');
        return null;
    }
    return mcpClientInstance;
}
// Lazily create Groq client only when GROQ_API_KEY is available
let groqClient = null;
function getGroqClient() {
    if (groqClient) return groqClient;
    if (!process.env.GROQ_API_KEY) return null;
    groqClient = new groq_sdk_1.default({ apiKey: process.env.GROQ_API_KEY });
    return groqClient;
}
class FixRecommender {
    /**
     * Generate alternative selector for failed locator with MCP + LLM intelligence
     * Tries MCP + LLM approach first, falls back to heuristics if needed
     */
    async suggestAlternativeSelector(error, originalSelector, url, step) {
        // Always attempt MCP + LLM approach for any Playwright UI failure
        try {
            logger && logger.info && logger.info('🧠 Forcing MCP + LLM analysis for failure');
        }
        catch (e) { }

        // Extract full selector pattern from error if present (e.g., getByRole(...))
        try {
            const text = typeof error === 'string' ? error : (error && error.message) ? error.message : JSON.stringify(error);
            const selectorMatch = text.match(/getByRole\([^)]*\)/);
            if (selectorMatch && selectorMatch[0]) {
                originalSelector = originalSelector || selectorMatch[0];
                console.log(`🔍 Extracted selector from error: ${originalSelector}`);
            }
        }
        catch (e) { }

        // Try MCP + LLM approach (prefer this for any UI failure)
        if (url) {
            try {
                console.log('🧠 Attempting intelligent selector discovery via MCP + LLM...');
                const llmFix = await this.suggestViaLLMWithDOM(error, originalSelector, url, step || 'unknown');
                console.log('🧠 LLM/MCP returned:', llmFix);
                if (llmFix && llmFix.fixed) {
                    // debug prints
                    console.log('FAILED:');
                    console.log(originalSelector);
                    console.log('CANDIDATES:');
                    // best-effort candidates list unavailable in this JS file, print diagnostics if present
                    console.log('SELECTED:');
                    console.log(llmFix.newSelector);
                    console.log('CONFIDENCE: LLM');
                    return llmFix;
                }
            }
            catch (llmError) {
                console.warn('⚠️ LLM approach failed, falling back to heuristics:', llmError);
            }
        }
        // Fallback to heuristic approach
        console.log('📋 Using heuristic-based selector generation...');
        const alternative = this.generateAlternativeHeuristic(error, originalSelector);
        if (alternative) {
            return {
                fixed: true,
                newSelector: alternative,
                reason: `Generated heuristic-based selector: ${alternative}`,
            };
        }
        return {
            fixed: false,
            reason: 'Could not generate alternative selector',
        };
    }
    /**
     * Use MCP + LLM for intelligent selector discovery
     * Opens URL, fetches DOM, queries LLM to suggest better selector
     */
    async suggestViaLLMWithDOM(error, originalSelector, url, step) {
        try {
            // Get MCP client
            const mcpClient = await getMCPClient();
            // Ensure page is opened via MCP, then fetch real DOM from target page
            try {
                console.log(`📄 Opening URL in MCP browser: ${url}...`);
                if (mcpClient.executeTool) {
                    await mcpClient.executeTool('open_url', { url });
                }
                else if (mcpClient.openUrl) {
                    await mcpClient.openUrl(url);
                }
            }
            catch (openErr) {
                console.warn('⚠️ MCP open_url failed (continuing to get_dom_json):', openErr);
            }

            console.log(`📄 Fetching real DOM from ${url}...`);
            let domResponse;
            if (mcpClient.executeTool) {
                domResponse = await mcpClient.executeTool('get_dom_json', { url });
            }
            else {
                domResponse = await mcpClient.getDomJson(url);
            }
            if (!domResponse || !domResponse.elements || domResponse.elements.length === 0) {
                console.warn('⚠️ No DOM elements found from MCP');
                throw new Error('Empty DOM response');
            }
            console.log(`✓ Found ${domResponse.elements.length} interactive elements`);
            // Format DOM elements for LLM context
            const domElementsContext = this.formatDOMForLLM(domResponse.elements);
            // Call Groq LLM to analyze error + DOM and suggest selector
            console.log('🤖 Querying LLM for intelligent selector suggestion...');
            const suggestion = await this.queryLLMForSelector(error, originalSelector, step, domElementsContext, domResponse.title || 'Unknown');
            if (suggestion && suggestion.length > 0) {
                console.log(`✓ LLM suggested selector: ${suggestion}`);
                return {
                    fixed: true,
                    newSelector: suggestion,
                    reason: `LLM-recommended selector based on real DOM analysis: ${suggestion}`,
                };
            }
            throw new Error('LLM did not provide a valid selector suggestion');
        }
        catch (error) {
            console.error('LLM approach failed:', error);
            throw error;
        }
    }
    /**
     * Query Groq LLM for selector suggestion based on failure + DOM
     */
    async queryLLMForSelector(errorMessage, failedSelector, stepDescription, domElements, pageTitle) {
        const systemPrompt = `You are an expert QA automation engineer specializing in element locator strategies. Your task is to analyze a failed selector and suggest the best stable alternative selector based on the available DOM elements.

RULES FOR SELECTOR SUGGESTION:
1. Prefer accessible selectors: getByRole, getByLabel, getByPlaceholder, getByText
2. Use Playwright locator syntax
3. Return ONLY the selector string, nothing else - no explanation, no code blocks
4. For buttons: use button:has-text("text") or [role="button"]
5. For inputs: use [placeholder="..."], [name="..."], or input[type="..."]
6. For links: use a:has-text("text") or [role="link"]
7. Avoid brittle selectors like nth-child, class names that change frequently
8. Make sure the selector will find exactly the element that should be interacted with in the step

NEVER:
- Include markdown code blocks
- Provide explanations
- Return null or "null"
- Return multiple selectors`;
        const userMessage = `FAILED SELECTOR ANALYSIS:
Test Step: ${stepDescription}
Page Title: ${pageTitle}
Original Failed Selector: ${failedSelector}
Error Message: ${errorMessage}

AVAILABLE DOM ELEMENTS:
${domElements}

Please analyze the error and suggest a single, stable selector that should work for this test step. Return ONLY the selector string.`;
        try {
            const client = getGroqClient();
            if (!client)
                throw new Error('GROQ_API_KEY not configured - LLM disabled');
            const response = await client.chat.completions.create({
                model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: userMessage,
                    },
                ],
                temperature: 0.3, // Lower temperature for more deterministic results
                max_tokens: 100, // Keep response short - just a selector
            });
            const suggestionText = (response.choices[0].message.content || '').trim();
            // Extract selector from response (remove any markdown code blocks if present)
            const cleanedSelector = suggestionText
                .replace(/```[\w]*\n?/g, '') // Remove markdown code blocks
                .replace(/\n/g, '') // Remove newlines
                .trim();
            // Validate that we got a reasonable selector
            if (cleanedSelector && cleanedSelector.length > 0 && !cleanedSelector.includes('undefined') && cleanedSelector !== 'null') {
                return cleanedSelector;
            }
            return null;
        }
        catch (error) {
            console.error('LLM request failed:', error);
            throw error;
        }
    }
    /**
     * Format DOM elements for LLM context
     */
    formatDOMForLLM(elements) {
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
    /**
     * Check if error is a selector/locator problem
     */
    isSelectorError(error) {
        const selectorErrors = [
            'locator not found',
            'failed to find element',
            'element does not exist',
            'querySelector returned null',
            'Unable to find element',
            'not visible',
            'detached from DOM',
            'stale element',
        ];
        // TASK 2: Safe error text conversion
        const errorText = typeof error === 'string' ? error : (error && error.message ? error.message : JSON.stringify(error));
        return selectorErrors.some(keyword => errorText.toLowerCase().includes(keyword.toLowerCase()));
    }
    /**
     * Fallback: Generate alternative selector patterns using heuristics
     */
    generateAlternativeHeuristic(error, originalSelector) {
        // TASK 2: Safe error text conversion
        const errorText = typeof error === 'string' ? error : (error && error.message ? error.message : JSON.stringify(error));
        const errorLower = errorText.toLowerCase();
        
        // TASK 3: Debug print failed selector with type and value
        console.log('FAILED SELECTOR:');
        console.log(originalSelector || 'undefined');
        console.log('TYPE:');
        console.log(typeof originalSelector);
        console.log('VALUE:');
        console.log(originalSelector);
        
        // Extract potential element info from error message
        const text = errorText;
        const textMatch = text.match(/(?:text|button|input|field|link)[\s:=]*['"`]([^'"`]+)['"`]/i);
        const textContent = textMatch?.[1];
        
        // Try different selector strategies in order
        const attempts = [];
        const candidates = [];
        
        // TASK 4: Add deterministic fallback for password/username
        if (originalSelector && originalSelector.includes('password')) {
            candidates.push('[name="password"]', 'input[name="password"]', 'input[type="password"]');
        }
        if (originalSelector && originalSelector.includes('username')) {
            candidates.push('[name="username"]', 'input[name="username"]', '#username');
        }
        
        // 1. Try role-based if we can infer the element type
        if (errorLower.includes('button')) {
            attempts.push(`button:has-text("${textContent || 'Login'}")`);
            attempts.push(`[role="button"]`);
        }
        // 2. Try by visible text
        if (textContent) {
            attempts.push(`text=${textContent}`);
            attempts.push(`//*[contains(text(), "${textContent}")]`);
            attempts.push(`:text("${textContent}")`);
        }
        // 3. Try input field strategies
        if (errorLower.includes('input')) {
            attempts.push(`input[type="text"]`);
            attempts.push(`input[placeholder*=""]`);
            attempts.push(`[role="textbox"]`);
        }
        // 4. Generic fallbacks
        if (originalSelector) {
            attempts.push(`${originalSelector}:visible`);
        }
        // 5. Common retry patterns
        attempts.push(`[class*="btn"]`);
        attempts.push(`[class*="button"]`);
        attempts.push(`[id*="btn"]`);
        
        // Combine candidates with attempts
        const allCandidates = [...new Set([...candidates, ...attempts])];
        
        // TASK 5: Print healing candidates
        console.log('HEALING CANDIDATES:');
        allCandidates.forEach((candidate, idx) => {
            console.log(`${idx + 1}. ${candidate}`);
        });
        
        // TASK 6: Select highest confidence candidate (first one after deduplication)
        if (allCandidates.length > 0) {
            console.log('SELECTED:');
            console.log(allCandidates[0]);
            return allCandidates[0];
        }
        
        // Return first viable alternative
        return attempts.length > 0 ? attempts[0] : null;
    }
}
exports.FixRecommender = FixRecommender;
