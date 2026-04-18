/**
 * Gherkin Service - Convert Plain English to Gherkin BDD format
 */

import { logger } from '../utils/logger';
import { LLMResponse } from '../types';
import Groq from 'groq-sdk';

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const GHERKIN_SYSTEM_PROMPT = `You are an expert BDD (Behavior-Driven Development) engineer specializing in Gherkin syntax.

Your task is to convert plain English test scenarios into proper Gherkin format (Feature/Scenario/Given/When/Then).

GHERKIN RULES:
1. Start with "Feature: " followed by a feature title
2. Then add "  Scenario: " (2 spaces indentation) with scenario title
3. Use Given/When/Then statements (2 spaces indentation before each)
4. Keep statements clear and business-readable
5. One action per step
6. Use "And" to continue with additional steps of the same type

EXAMPLE:
Feature: User Login
  Scenario: Successful user login
    Given the user is on the login page
    When the user enters valid credentials
    And clicks the login button
    Then the user should be redirected to the dashboard
    And the welcome message should be displayed

CONVERSION RULES:
- "Open/Navigate to/Go to X" → Given statement
- "Enter/Fill X with Y" → When statement
- "Click X" → When statement
- "Verify/Check/Confirm X" → Then statement
- "X should be Y" → Then statement

Keep the output ONLY as Gherkin - no explanations, no code, no markdown.`;

/**
 * Sync Gherkin converter - guaranteed to always return valid Gherkin
 */
function convertToGherkinSync(testSteps: string): string {
  const lines = testSteps.split('\n').filter(l => l.trim());
  let gherkinContent = 'Feature: Automated Test Scenario\n  Scenario: Execute test steps\n';
  
  for (const line of lines) {
    const step = line.replace(/^\d+\.\s*/, '').trim();
    if (!step) continue;
    
    // Simple keyword matching
    let keyword = 'And';
    if (/^(open|navigate|go|load|visit|click.*login)/i.test(step)) {
      keyword = 'Given';
    } else if (/^(enter|fill|type|set|input|submit|click)/i.test(step)) {
      keyword = 'When';
    } else if (/^(verify|check|confirm|see|should|expect|find|assert)/i.test(step)) {
      keyword = 'Then';
    }
    
    gherkinContent += `    ${keyword} ${step}\n`;
  }
  
  return gherkinContent;
}

export class GherkinService {
  /**
   * Convert plain English test steps to Gherkin format
   * Uses Groq LLM with guaranteed sync fallback
   */
  static async convertToGherkin(testSteps: string): Promise<string> {
    logger.info('📝 Gherkin Service: Converting test steps to Gherkin BDD format');
    
    try {
      logger.debug('Using Groq Model:', process.env.LLM_MODEL || 'mixtral-8x7b-32768');

      const userMessage = `Convert these test steps into proper Gherkin BDD format:

${testSteps}

Remember:
- Start with Feature: title
- Use Scenario: with proper indentation
- Use Given/When/Then logic
- Keep it business-readable
- Output ONLY Gherkin, no other text`;

      const model = process.env.LLM_MODEL || 'mixtral-8x7b-32768';
      
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: GHERKIN_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.5,
        max_tokens: 1024,
      });

      const gherkinOutput = response.choices?.[0]?.message?.content || '';
      
      if (gherkinOutput && gherkinOutput.trim().length > 0) {
        logger.success('✓ Gherkin from Groq API', { length: gherkinOutput.length });
        return gherkinOutput.trim();
      }
      
      logger.warn('Groq returned empty response, using sync fallback');
      const syncResult = convertToGherkinSync(testSteps);
      logger.info('✓ Using sync Gherkin converter', { length: syncResult.length });
      return syncResult;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn('Groq API error, using sync fallback', { error: errorMsg });
      
      const syncResult = convertToGherkinSync(testSteps);
      logger.info('✓ Using sync Gherkin converter (fallback)', { length: syncResult.length });
      return syncResult;
    }
  }

  /**
   * Refine existing Gherkin
   */
  static async refineGherkin(gherkin: string, feedback: string): Promise<string> {
    logger.info('📝 Gherkin Service: Refining Gherkin based on feedback');

    try {
      const userMessage = `Please refine this Gherkin based on the feedback:

Current Gherkin:
${gherkin}

Feedback:
${feedback}

Make the requested improvements while maintaining Gherkin format.
Output ONLY the refined Gherkin.`;

      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content: GHERKIN_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.5,
        max_tokens: 1024,
      });

      const refinedGherkin = response.choices[0].message.content || '';
      logger.success('✓ Gherkin refinement successful');

      return refinedGherkin.trim();
    } catch (error) {
      logger.error('Gherkin refinement failed', error);
      throw error;
    }
  }
}
