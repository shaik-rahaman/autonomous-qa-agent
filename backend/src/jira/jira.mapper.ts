/**
 * Jira to Test Steps Mapper
 * Transforms raw Jira issue data into structured, clean test steps
 * This layer sits between Jira issues and the Gherkin generation service
 */

import { logger } from '../utils/logger';
import { JiraIssue, TransformedTestSteps, JiraIssueWithSteps } from '../types';
import { JiraParser } from './jira.parser';
import { LLMService } from '../llm/llm-service';

export class JiraMapper {
  /**
   * Transform a single Jira issue into structured test steps
   * Priority: Acceptance Criteria → Description → Summary
   */
  static async mapJiraToTestSteps(issue: JiraIssue): Promise<TransformedTestSteps> {
    logger.info(`📋 Mapping Jira Issue: ${issue.key} - ${issue.summary}`);

    // Step 1: Extract raw content based on priority
    const rawContent = this.extractRawContent(issue);
    logger.debug(`   Raw content extracted (length: ${rawContent.length} chars)`);

    // Step 2: Parse into initial structured steps
    const structuredSteps = JiraParser.parseSteps(rawContent);
    logger.debug(`   Parsed into ${structuredSteps.split('\n').filter(s => s.trim()).length} steps`);

    // Step 3: Normalize/enhance with LLM if content is messy
    const normalizedSteps = await this.normalizeStepsWithLLM(rawContent, structuredSteps);
    logger.info(`   ✅ Issue ${issue.key} transformed successfully`);

    return {
      issueKey: issue.key,
      issueSummary: issue.summary,
      rawContent,
      structuredSteps,
      normalizedSteps,
      normalizationMethod: this.determineNormalizationMethod(rawContent),
    };
  }

  /**
   * Transform multiple Jira issues into batch test steps
   */
  static async mapJiraIssuesToTestSteps(
    issues: JiraIssue[]
  ): Promise<JiraIssueWithSteps[]> {
    logger.section(`🔄 Transforming ${issues.length} Jira Issues`);

    const results: JiraIssueWithSteps[] = [];

    for (const issue of issues) {
      try {
        const transformedSteps = await this.mapJiraToTestSteps(issue);
        results.push({ issue, transformedSteps });
      } catch (error) {
        logger.warn(
          `Failed to transform issue ${issue.key}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
        // Continue with next issue instead of failing completely
      }
    }

    logger.success(`✅ Transformed ${results.length}/${issues.length} issues`);
    return results;
  }

  /**
   * Combine multiple transformed issues into a single test case document
   */
  static combineTestSteps(transformed: JiraIssueWithSteps[]): string {
    logger.info(`📦 Combining ${transformed.length} test cases`);

    const combined = transformed
      .map((item, index) => {
        const { issue, transformedSteps } = item;
        const header = `Test Case: ${issue.key} - ${issue.summary}`;
        const separator = '─'.repeat(header.length);
        const steps = transformedSteps.normalizedSteps;

        return `${separator}\n${header}\n${separator}\n\n${steps}`;
      })
      .join('\n\n\n');

    logger.debug(`   Combined test cases (length: ${combined.length} chars)`);
    return combined;
  }

  /**
   * Extract raw content from Jira issue (priority order)
   * 1. Acceptance Criteria (custom field)
   * 2. Description
   * 3. Summary (fallback)
   */
  private static extractRawContent(issue: JiraIssue): string {
    // Try acceptance criteria first (custom field)
    if (issue.fields?.customfield_10000) {
      const criteria = issue.fields.customfield_10000;
      if (typeof criteria === 'string' && criteria.trim()) {
        logger.debug(`   ✓ Using acceptance criteria from custom field`);
        return criteria;
      }
    }

    // Try description
    if (issue.description && typeof issue.description === 'string') {
      const desc = issue.description.trim();
      if (desc) {
        logger.debug(`   ✓ Using description field`);
        return desc;
      }
    }

    // Fallback to summary
    logger.debug(`   ✓ Fallback: Using summary field`);
    return issue.summary || 'Automated test case';
  }

  /**
   * Normalize steps using LLM if content appears unstructured
   * Uses a dedicated prompt to structure raw Jira content
   */
  private static async normalizeStepsWithLLM(
    rawText: string,
    initialSteps: string
  ): Promise<string> {
    // Detect if content needs LLM normalization
    const needsNormalization = this.needsLLMNormalization(rawText, initialSteps);

    if (!needsNormalization) {
      logger.debug(`   ℹ️  Content is already well-structured, skipping LLM normalization`);
      return initialSteps;
    }

    logger.debug(`   🤖 Detecting unstructured content, using LLM for normalization`);

    try {
      const prompt = `You are a QA automation expert. Convert the following raw Jira content into clean, numbered test steps.

Rules:
- Output ONLY numbered steps (1., 2., 3., etc.)
- Each step should be a single, clear action
- Use simple, precise language
- Remove ambiguity and vague descriptions
- Do not include explanations or notes
- Remove duplicate steps
- Do not include Gherkin format (Given/When/Then)
- Do not include technical implementation details

Raw Jira Content:
${rawText}

Return ONLY the numbered steps:`;

      const response = await LLMService.normalizeText(prompt);

      if (response && response.message) {
        const normalized = response.message.trim();
        logger.debug(`   ✅ LLM normalization completed`);
        return normalized;
      }

      logger.warn(`   ⚠️  LLM normalization returned empty, using initial parsing`);
      return initialSteps;
    } catch (error) {
      logger.warn(
        `   ⚠️  LLM normalization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return initialSteps;
    }
  }

  /**
   * Determine if content needs LLM normalization
   * Checks for complexity indicators like:
   * - Excessive punctuation or special characters
   * - Very long lines (paragraph text)
   * - Mixed bullet points and numbers
   * - HTML tags
   */
  private static needsLLMNormalization(rawText: string, initialSteps: string): boolean {
    // Count indicators of unstructured content
    let complexityScore = 0;

    // Indicator 1: Long lines (paragraphs vs steps)
    const lines = rawText.split('\n').filter(l => l.trim());
    const avgLineLength = lines.reduce((sum, l) => sum + l.length, 0) / (lines.length || 1);
    if (avgLineLength > 100) complexityScore += 2;

    // Indicator 2: HTML content
    if (/<[^>]+>/.test(rawText)) complexityScore += 3;

    // Indicator 3: Excessive special characters
    const specialCharRatio =
      (rawText.match(/[!@#$%^&*(){}\[\];:<>?,.]/g) || []).length / rawText.length;
    if (specialCharRatio > 0.1) complexityScore += 1;

    // Indicator 4: Poor initial parsing (few steps generated)
    const parsedStepsCount = initialSteps.split('\n').filter(l => l.trim()).length;
    if (parsedStepsCount < 3 && rawText.length > 200) complexityScore += 2;

    // Indicator 5: Mixed formatting (both * and - bullets, numbers)
    const hasBullets = /^[\s]*([*\-+]|•)/m.test(rawText);
    const hasNumbers = /^[\s]*\d+\./m.test(rawText);
    const hasParagraphs = lines.some(l => l.length > 80);
    if ((hasBullets || hasNumbers) && hasParagraphs) complexityScore += 2;

    const needsNormalization = complexityScore >= 3;
    logger.debug(
      `   Normalization score: ${complexityScore} (threshold: 3) → ${needsNormalization ? 'YES' : 'NO'}`
    );

    return needsNormalization;
  }

  /**
   * Determine how the steps were normalized
   */
  private static determineNormalizationMethod(
    rawText: string
  ): 'parsing' | 'llm' {
    // This is set during normalization
    // For now, return parsing as default
    // Will be determined in normalizeStepsWithLLM
    return 'parsing';
  }
}
