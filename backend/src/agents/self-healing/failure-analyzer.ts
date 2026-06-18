import { extractFailedLocator } from './error-parser';
import { ErrorClassifier } from './error-classifier';

export interface FailureAnalysisOutput {
  failureType: 'ELEMENT_NOT_FOUND' | 'STRICT_MODE' | 'TIMEOUT' | 'VISIBILITY' | 'NAVIGATION_TIMEOUT' | 'ENVIRONMENT_FAILURE' | 'UNKNOWN';
  failedSelector: string | null;
  source: 'params.selector' | 'error_message' | 'fallback' | 'none';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Simple FailureAnalyzer: deterministic mapping from classifier + parser
 * PHASE 2: Do NOT perform any healing here. Just analyze and return structured diagnostics.
 */
export class FailureAnalyzer {
  analyze(errorMessageOrObject: any, providedSelector?: string | undefined | null): FailureAnalysisOutput {
    const extracted = extractFailedLocator(errorMessageOrObject, undefined) || null;

    // Use classifier to determine type (classifier expects a string message)
    const messageForClassification = typeof errorMessageOrObject === 'string' ? errorMessageOrObject : String(errorMessageOrObject);
    const classified = ErrorClassifier.classify(messageForClassification, extracted || providedSelector || undefined);

    // Map classifier types to requested enum
    let failureType: FailureAnalysisOutput['failureType'] = 'UNKNOWN';
    switch (classified.type) {
      case 'element_not_found':
        failureType = 'ELEMENT_NOT_FOUND';
        break;
      case 'strict_mode_violation':
        failureType = 'STRICT_MODE';
        break;
      case 'playwright_configuration_error':
        // Treat Playwright configuration/module/CLI issues as environment failures to avoid healing
        failureType = 'ENVIRONMENT_FAILURE';
        break;
      case 'playwright_environment_error':
        // Missing CLI/module or filesystem errors are environment failures
        failureType = 'ENVIRONMENT_FAILURE';
        break;
      case 'timeout':
        failureType = 'TIMEOUT';
        break;
      case 'navigation_failure':
        // Treat navigation failures as environment-level failures to avoid healing
        failureType = 'ENVIRONMENT_FAILURE';
        break;
      case 'syntax_error':
        failureType = 'UNKNOWN';
        break;
      default:
        failureType = 'UNKNOWN';
    }

    const failedSelector = extracted || providedSelector || null;

    // Confidence: high if params.selector or extracted exists and classifier is element_not_found/strict
    let confidence: FailureAnalysisOutput['confidence'] = 'low';
    if (failedSelector && (failureType === 'ELEMENT_NOT_FOUND' || failureType === 'STRICT_MODE')) {
      confidence = 'high';
    } else if (failureType === 'TIMEOUT' || failureType === 'ENVIRONMENT_FAILURE') {
      confidence = 'medium';
    }

    const source: FailureAnalysisOutput['source'] = extracted ? 'error_message' : (providedSelector ? 'fallback' : 'none');

    return {
      failureType,
      failedSelector,
      source,
      confidence,
    };
  }
}

export default FailureAnalyzer;
