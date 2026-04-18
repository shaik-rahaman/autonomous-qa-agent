"use strict";
/**
 * Failure Detector
 * Identifies failure patterns from test errors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FailureDetector = void 0;
class FailureDetector {
    failurePatterns = {
        selector_not_found: [
            'locator not found',
            'failed to find element',
            'element does not exist',
            'querySelector returned null',
            'Unable to find element',
        ],
        timeout: [
            'timeout',
            'exceeded',
            'time out',
            'waiting for',
            'wait for timeout',
        ],
        stale_element: [
            'stale element reference',
            'element is no longer attached',
            'detached from DOM',
            'element reference is stale',
        ],
        navigation_error: [
            'navigation failed',
            'ERR_CONNECTION_REFUSED',
            'net::ERR_',
            'Failed to navigate',
            'page crash',
        ],
        assertion_failed: [
            'assertion failed',
            'expect(',
            'to be visible',
            'to contain',
            'not equal',
        ],
    };
    /**
     * Detect failure pattern from test error
     */
    detectFailurePattern(failure) {
        const errorText = `${failure.error} ${failure.stackTrace}`.toLowerCase();
        for (const [patternType, keywords] of Object.entries(this.failurePatterns)) {
            const matches = keywords.filter(keyword => errorText.includes(keyword.toLowerCase()));
            if (matches.length > 0) {
                return {
                    type: patternType,
                    confidence: Math.min(100, matches.length * 20),
                    indicators: matches,
                };
            }
        }
        return {
            type: 'unknown',
            confidence: 0,
            indicators: [],
        };
    }
    /**
     * Check if error is a common known issue
     */
    isKnownIssue(error) {
        return Object.values(this.failurePatterns)
            .flat()
            .some(keyword => error.toLowerCase().includes(keyword));
    }
}
exports.FailureDetector = FailureDetector;
