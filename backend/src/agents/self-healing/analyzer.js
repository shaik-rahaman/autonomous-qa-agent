"use strict";
/**
 * Failure Analyzer
 * Analyzes root causes and context of test failures
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FailureAnalyzer = void 0;
class FailureAnalyzer {
    /**
     * Analyze failure details using LLM (Groq)
     */
    async analyzeFailure(failure, pattern) {
        // For now, return pattern-based analysis
        // In production, this would call Groq LLM for deeper analysis
        const rootCauseMap = {
            selector_not_found: 'Element selector has changed or element is not rendered',
            timeout: 'Page element takes longer to load than expected',
            stale_element: 'Element was removed from DOM before interaction',
            navigation_error: 'Network issue or page server error',
            assertion_failed: 'Test assertion logic needs update',
            unknown: 'Unable to determine failure root cause',
        };
        const affectedElements = this.extractElementsFromError(failure.error);
        const possibleReasons = this.generateReasons(pattern.type, failure);
        return {
            rootCause: rootCauseMap[pattern.type] || rootCauseMap.unknown,
            severity: this.calculateSeverity(pattern.type),
            affectedElements,
            possibleReasons,
        };
    }
    /**
     * Extract element selectors/names from error message
     */
    extractElementsFromError(error) {
        const elements = [];
        // Extract common selectors
        const selectorPattern = /(?:selector|locator|element|id|class|xpath)[\s:=]*['""`]([^'""`]+)['""`]/gi;
        let match;
        while ((match = selectorPattern.exec(error)) !== null) {
            elements.push(match[1]);
        }
        // Extract text references
        const textPattern = /(?:text|button|input|field)[\s:=]*['""`]([^'""`]+)['""`]/gi;
        while ((match = textPattern.exec(error)) !== null) {
            elements.push(match[1]);
        }
        return [...new Set(elements)]; // Remove duplicates
    }
    /**
     * Generate possible reasons for the failure
     */
    generateReasons(failureType, failure) {
        const reasons = [];
        switch (failureType) {
            case 'selector_not_found':
                reasons.push('DOM structure changed', 'Element is hidden or behind overlay', 'Selector uses outdated locator', 'Element rendered dynamically');
                break;
            case 'timeout':
                reasons.push('Page is slow to load', 'Server taking longer to respond', 'Network latency', 'Wait timeout is too short');
                break;
            case 'stale_element':
                reasons.push('Page reloaded during test', 'DOM re-rendered', 'Element was replaced in DOM tree', 'Component state changed');
                break;
            case 'navigation_error':
                reasons.push('Server is down', 'Network connectivity issue', 'Invalid URL or endpoint', 'CORS or authentication error');
                break;
            case 'assertion_failed':
                reasons.push('Expected value changed', 'Test logic is incorrect', 'Data has changed', 'UI behavior altered');
                break;
        }
        return reasons;
    }
    /**
     * Calculate severity based on failure type
     */
    calculateSeverity(failureType) {
        const severityMap = {
            navigation_error: 'critical',
            timeout: 'high',
            selector_not_found: 'high',
            stale_element: 'medium',
            assertion_failed: 'medium',
            unknown: 'low',
        };
        return severityMap[failureType] || 'low';
    }
}
exports.FailureAnalyzer = FailureAnalyzer;
