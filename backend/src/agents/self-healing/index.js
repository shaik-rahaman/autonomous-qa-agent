"use strict";
/**
 * Self-Healing Agent (Simplified with MCP + LLM)
 * Detects selector failures and suggests intelligent alternative locators
 * Now uses real DOM analysis and AI-powered selector discovery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixRecommender = void 0;
exports.healFailure = healFailure;
const recommender_1 = require("./recommender");
Object.defineProperty(exports, "FixRecommender", { enumerable: true, get: function () { return recommender_1.FixRecommender; } });
/**
 * Attempt to heal a test failure by suggesting alternative selector
 * Uses MCP + LLM for intelligent discovery, falls back to heuristics
 */
async function healFailure(input) {
    const recommender = new recommender_1.FixRecommender();
    // Now handles async MCP + LLM approach automatically
    const fix = await recommender.suggestAlternativeSelector(input.error, input.selector, input.url, // Pass URL for MCP analysis
    input.step // Pass step description for context
    );
    return {
        fixed: fix.fixed,
        newSelector: fix.newSelector,
        reason: fix.reason,
    };
}
