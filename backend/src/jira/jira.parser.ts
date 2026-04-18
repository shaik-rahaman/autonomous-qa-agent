/**
 * Jira Content Parser
 * Handles extraction and parsing of different content formats found in Jira issues
 */

import { logger } from '../utils/logger';

export class JiraParser {
  /**
   * Parse raw Jira content into structured steps
   * Handles multiple formats: bullet points, numbers, paragraphs, mixed
   */
  static parseSteps(rawContent: string): string {
    logger.debug('   📖 Parsing Jira content...');

    // Clean HTML tags and special formatting
    let cleaned = this.stripHtmlTags(rawContent);
    cleaned = this.normalizeWhitespace(cleaned);

    // Handle different content formats
    let steps: string[] = [];

    // Try numbered list format first (1. 2. 3.)
    if (this.hasNumberedFormat(cleaned)) {
      steps = this.parseNumberedSteps(cleaned);
    }
    // Try bullet point format (* - + •)
    else if (this.hasBulletFormat(cleaned)) {
      steps = this.parseBulletSteps(cleaned);
    }
    // Try acceptance criteria format (Given/When/Then or As a...)
    else if (this.hasAcceptanceCriteriaFormat(cleaned)) {
      steps = this.parseAcceptanceCriteria(cleaned);
    }
    // Fallback: split by sentence and extract actionable phrases
    else {
      steps = this.parseParagraphFormat(cleaned);
    }

    // Clean and normalize the extracted steps
    steps = this.cleanSteps(steps);
    steps = this.deduplicateSteps(steps);
    steps = this.truncateLongSteps(steps);

    // Format into numbered steps
    const formatted = steps
      .map((step, index) => `${index + 1}. ${step}`)
      .join('\n');

    logger.debug(`   ✓ Parsed ${steps.length} steps`);
    return formatted;
  }

  /**
   * Strip HTML tags from content
   */
  private static stripHtmlTags(text: string): string {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /**
   * Normalize whitespace
   */
  private static normalizeWhitespace(text: string): string {
    return text
      .replace(/\n\n+/g, '\n') // Remove multiple blank lines
      .replace(/[ \t]+/g, ' ') // Collapse multiple spaces
      .trim();
  }

  /**
   * Check if content has numbered list format
   */
  private static hasNumberedFormat(text: string): boolean {
    return /^\s*\d+[\.\)]\s+/m.test(text);
  }

  /**
   * Check if content has bullet point format
   */
  private static hasBulletFormat(text: string): boolean {
    return /^\s*[*\-+•]\s+/m.test(text);
  }

  /**
   * Check if content has Gherkin/Acceptance criteria format
   */
  private static hasAcceptanceCriteriaFormat(text: string): boolean {
    return /^\s*(Given|When|Then|As\s+a|Scenario|Background)/mi.test(text);
  }

  /**
   * Parse numbered list format (1. 2. etc.)
   */
  private static parseNumberedSteps(text: string): string[] {
    const lines = text.split('\n');
    const steps: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\s*\d+[\.\)]\s*(.+?)$/);
      if (match && match[1]) {
        steps.push(match[1].trim());
      }
    }

    return steps.length > 0 ? steps : [];
  }

  /**
   * Parse bullet point format (* - + •)
   */
  private static parseBulletSteps(text: string): string[] {
    const lines = text.split('\n');
    const steps: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\s*[*\-+•]\s*(.+?)$/);
      if (match && match[1]) {
        steps.push(match[1].trim());
      }
    }

    return steps.length > 0 ? steps : [];
  }

  /**
   * Parse Gherkin/Acceptance criteria format
   */
  private static parseAcceptanceCriteria(text: string): string[] {
    const steps: string[] = [];

    // Handle Gherkin format (Given/When/Then)
    const gherkinRegex = /^\s*(Given|When|Then|And|But)\s+(.+?)$/gm;
    let match;

    while ((match = gherkinRegex.exec(text)) !== null) {
      if (match[2]) {
        steps.push(match[2].trim());
      }
    }

    // Handle "As a user..." format
    const asARegex = /As\s+a\s+(.+?)\s+(?:I\s+)?(?:want|should)?\s+(.+?)(?:\n|$)/gi;
    while ((match = asARegex.exec(text)) !== null) {
      if (match[2]) {
        steps.push(match[2].trim());
      }
    }

    return steps.length > 0 ? steps : [];
  }

  /**
   * Parse paragraph format (fallback for unstructured text)
   */
  private static parseParagraphFormat(text: string): string[] {
    // Break into sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    const steps: string[] = sentences
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => this.extractActionFromSentence(s))
      .filter((s): s is string => s !== null);

    return steps;
  }

  /**
   * Extract actionable step from a sentence
   * Identifies key verbs: Open, Click, Enter, Select, Verify, Wait, etc.
   */
  private static extractActionFromSentence(sentence: string): string | null {
    const trimmed = sentence.replace(/[.!?]*$/, '').trim();

    // Filter out non-actionable content
    if (
      trimmed.length < 3 ||
      /^(the|a|an|and|or|but|in|on|at|to|from|with|without|for)$/i.test(trimmed)
    ) {
      return null;
    }

    // Extract main clause if too long
    if (trimmed.length > 200) {
      // Try to find key clauses
      const clauses = trimmed.split(/;|,(?=\s+(?:then|after|before|if))/);
      return clauses[0].trim();
    }

    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Clean and normalize extracted steps
   */
  private static cleanSteps(steps: string[]): string[] {
    return steps
      .map(step => {
        let cleaned = step
          .replace(/^[\s\-*+•.]\s*/, '') // Remove leading bullets/numbers
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();

        // Remove common filler words
        cleaned = cleaned
          .replace(/^(i\.e\.|e\.g\.|etc\.)/i, '')
          .replace(/\s+$/, '')
          .trim();

        return cleaned;
      })
      .filter(step => step.length > 2 && !this.isFillerText(step));
  }

  /**
   * Check if text is filler/metadata
   */
  private static isFillerText(text: string): boolean {
    const fillerPatterns = [
      /^(note|note:|notes:|remark:|please|important:|warning:)/i,
      /^(contact|call|email|refer|reference)/i,
      /^(see also|also see|link|url)/i,
      /^(jira|qa|test|scenario)/i,
    ];

    return fillerPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Remove duplicate steps (case-insensitive)
   */
  private static deduplicateSteps(steps: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const step of steps) {
      const normalized = step.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(step);
      }
    }

    return result;
  }

  /**
   * Truncate excessively long steps (likely are paragraphs, not steps)
   */
  private static truncateLongSteps(steps: string[]): string[] {
    const maxStepLength = 200;

    return steps.map(step => {
      if (step.length > maxStepLength) {
        // Find the first sentence break
        const match = step.match(/^(.{1,200}[.!?])/);
        return match ? match[1] : step.substring(0, maxStepLength) + '...';
      }
      return step;
    });
  }
}
