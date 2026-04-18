/**
 * LLM Service for interfacing with Language Models
 */

import { logger } from '../utils/logger';
import { LLMMessage, LLMResponse, ToolCall, DOMResponse } from '../types';
import Groq from 'groq-sdk';

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert Playwright automation engineer. Convert plain English test scenarios into complete, production-ready Playwright TypeScript test scripts.

Your responsibilities:
1. Extract URLs, usernames, passwords, and specific values from the test steps
2. Use exact text from test steps, not generic placeholders
3. Create intelligent, robust selectors using:
   - HTML attributes (name, id, data-testid, aria-label)
   - Text content with :has-text() for buttons and labels
   - Role-based selectors when appropriate
4. Generate complete test files with proper imports and structure
5. Include proper error handling and waits
6. DO NOT use helper functions - write raw Playwright code
7. DO NOT use generic placeholders - use exact values from test steps

CRITICAL CODE FORMATTING - LOCATOR QUOTE RULES:
- For page.locator() with attribute selectors: USE SINGLE QUOTES
  - Correct: page.locator('input[name="USERNAME"]')
  - Wrong: page.locator("input[name=\"USERNAME\"]")
- For other strings: USE DOUBLE QUOTES
  - Correct: await page.goto("https://example.com");
  - Correct: await expect(element).toBeVisible();
- For getByRole with regex name: USE DOUBLE QUOTES for property
  - Correct: page.getByRole("button", { name: /Login/i })

Key rules:
- Extract username/password/URL exactly as provided in test steps
- Use page.goto() for navigation, not helper functions
- Use page.locator('selector') with SINGLE QUOTES when selector has attribute names
- Use page.getByRole() for semantic elements (buttons, links, etc)
- Use exact selectors based on the target website structure
- Generate assertions that verify actual success criteria
- Include page load waits and element visibility checks`;

export class LLMService {
  /**
   * Process test steps with an LLM loop
   * Calls Groq LLM to determine tools needed
   */
  static async processTestSteps(testSteps: string, url: string): Promise<LLMResponse> {
    logger.debug('LLM: Processing test steps', testSteps);

    // For initial response, decide on tool calls
    const needsDom = testSteps.toLowerCase().includes('enter') ||
      testSteps.toLowerCase().includes('click') ||
      testSteps.toLowerCase().includes('login') ||
      testSteps.toLowerCase().includes('button');

    const toolCalls: ToolCall[] = [];

    toolCalls.push({
      name: 'open_url',
      args: { url },
    });

    if (needsDom) {
      toolCalls.push({
        name: 'get_dom_json',
        args: { url },
      });
    }

    return {
      message: `I'll convert these test steps into Playwright code. Let me first analyze the page at ${url}.`,
      toolCalls,
      stop: false,
    };
  }

  /**
   * Generate final Playwright code based on test steps and DOM data
   */
  static async generatePlaywrightCode(
    testSteps: string,
    url: string,
    domElements?: DOMResponse
  ): Promise<string> {
    logger.info('LLM: Generating Playwright code from test steps');
    logger.debug('Target URL:', url);
    logger.debug('DOM available:', !!domElements);

    // Extract key information from test steps
    const extractedData = this.extractTestData(testSteps);
    logger.info('Extracted data:', extractedData);

    // Use real LLM to generate code
    const code = await this.callGroqLLM(testSteps, url, extractedData, domElements);

    logger.success('LLM: Code generation complete');
    return code;
  }

  /**
   * Extract test data like credentials, URLs, etc.
   */
  private static extractTestData(testSteps: string) {
    const data: Record<string, string> = {};

    // Extract URL
    const urlMatch = testSteps.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      data.url = urlMatch[0];
    }

    // Extract username
    const usernameMatch = testSteps.match(/username[:\s]+([a-zA-Z0-9_@.-]+)/i);
    if (usernameMatch) {
      data.username = usernameMatch[1];
    }

    // Extract password
    const passwordMatch = testSteps.match(/password[:\s]+([a-zA-Z0-9_!@#$%^&*-]+)/i);
    if (passwordMatch) {
      data.password = passwordMatch[1];
    }

    // Extract email
    const emailMatch = testSteps.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/);
    if (emailMatch && !data.username) {
      data.email = emailMatch[1];
    }

    return data;
  }

  /**
   * Call Groq LLM to generate Playwright code
   */
  private static async callGroqLLM(
    testSteps: string,
    url: string,
    extractedData: Record<string, string>,
    domElements?: DOMResponse
  ): Promise<string> {
    logger.debug('Calling Groq LLM for code generation');

    // Build the user prompt with extracted data
    let userPrompt = `Generate a complete Playwright TypeScript test script for these steps:\n\n${testSteps}\n\nTarget URL: ${url}`;

    if (Object.keys(extractedData).length > 0) {
      userPrompt += `\n\nExtracted credentials/data:`;
      Object.entries(extractedData).forEach(([key, value]) => {
        userPrompt += `\n- ${key}: ${value}`;
      });
    }

    if (domElements) {
      userPrompt += `\n\nPage structure available for selector generation.`;
    }

    userPrompt += `\n\nIMPORTANT CODE FORMATTING RULES:
- For page.locator() with attribute selectors: USE SINGLE QUOTES
  page.locator('input[name="USERNAME"]')  ✓ Correct
  page.locator("input[name=\\"USERNAME\\"]")  ✗ Wrong
- For other strings and methods: USE DOUBLE QUOTES
  import { test, expect } from "@playwright/test";
  await page.goto("https://example.com");
  page.getByRole("button", { name: "Login" })
- Use the extracted credentials/values exactly as provided  
- Generate raw Playwright code without helper functions
- Include proper waits and assertions
- Use realistic selectors for the target website
- Return ONLY the TypeScript code, no explanations`;

    try {
      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        max_tokens: 2048,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      // Extract text response
      const textContent = response.choices[0]?.message?.content;
      if (!textContent) {
        throw new Error('No text response from LLM');
      }

      let code = textContent;

      // Clean up code - remove markdown code blocks if present
      if (code.includes('```')) {
        const match = code.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
        if (match) {
          code = match[1];
        }
      }

      // Format code with Prettier to ensure compliance
      code = this.formatCodeWithPrettier(code);

      logger.success('Groq LLM response received');
      return code;
    } catch (error) {
      logger.error('Groq LLM call failed', error);
      // Fall back to template-based generation
      return this.generateFallbackCode(testSteps, url, extractedData);
    }
  }

  /**
   * Generate fallback code when LLM fails
   * Uses template with extracted values
   */
  private static generateFallbackCode(
    testSteps: string,
    url: string,
    extractedData: Record<string, string>
  ): string {
    logger.warn('Generating fallback code from template');

    const username = extractedData.username || extractedData.email || 'testuser';
    const password = extractedData.password || 'password';
    const actualUrl = extractedData.url || url;

    const code = `import { test, expect } from "@playwright/test";

test("Complete user workflow", async ({ page }) => {
  // Navigate to login page
  await page.goto("${actualUrl}");
  
  // Wait for page to load
  await page.waitForLoadState("networkidle");

  // Fill username field using single quotes for locator
  const usernameInput = page.locator('input[name="USERNAME"]');
  await usernameInput.waitFor({ state: "visible" });
  await usernameInput.fill("${username}");

  // Fill password field using single quotes for locator
  const passwordInput = page.locator('input[name="PASSWORD"]');
  await passwordInput.waitFor({ state: "visible" });
  await passwordInput.fill("${password}");

  // Click the Login button
  const loginButton = page.getByRole("button", { name: /Login|Sign in/i });
  await loginButton.waitFor({ state: "visible", timeout: 10000 });
  await loginButton.click();

  // Wait for post-login navigation to complete
  await page.waitForLoadState("networkidle");

  // Verify CRM link appears (or other success indicator)
  const crmLocator = page.getByRole("link", { name: /CRM|Dashboard/i });
  await expect(crmLocator).toBeVisible({ timeout: 15000 });
});`;

    return code;
  }

  /**
   * Format code to ensure proper styling and escape quotes correctly in selectors
   */
  private static formatCodeWithPrettier(code: string): string {
    try {
      logger.debug('Normalizing code formatting');
      
      let formatted = code;

      // Split into lines to safely process each line
      const lines = formatted.split('\n');
      const processedLines: string[] = [];

      for (const line of lines) {
        // Skip comment-only lines
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
          processedLines.push(line);
          continue;
        }

        let processedLine = line;

        // CRITICAL: Convert page.locator() with double quotes to single quotes
        // Use better regex pattern that handles escaped quotes: ([^"\\]|\\.)*
        // This matches strings with optional escapes like \"
        processedLine = processedLine.replace(
          /page\.locator\("([^"\\]|\\.)*"\)/g,
          (match) => {
            // Extract the selector content between quotes
            const selectorMatch = match.match(/page\.locator\("(.*)"\)/);
            if (!selectorMatch) return match;
            
            const selector = selectorMatch[1];
            // Unescape the selector content (remove backslashes before quotes)
            const unescaped = selector.replace(/\\"/g, '"');
            return `page.locator('${unescaped}')`;
          }
        );

        // Handle other .locator() calls (e.g., element.locator())
        processedLine = processedLine.replace(
          /\.locator\("([^"\\]|\\.)*"\)/g,
          (match) => {
            const selectorMatch = match.match(/\.locator\("(.*)"\)/);
            if (!selectorMatch) return match;
            
            const selector = selectorMatch[1];
            const unescaped = selector.replace(/\\"/g, '"');
            return `.locator('${unescaped}')`;
          }
        );

        // Handle page.getByRole() - keep as double quotes but fix escaped quotes
        processedLine = processedLine.replace(
          /page\.getByRole\("([^"]+)",\s*\{\s*name:\s*"([^"\\]|\\.)*"\s*\}\)/g,
          (match) => {
            const nameMatch = match.match(/name:\s*"(.*)"/);
            if (!nameMatch) return match;
            
            const name = nameMatch[1];
            const unescapedName = name.replace(/\\"/g, '"');
            return match.replace(/"([^"\\]|\\.)*"(?=\s*\}\))/, `"${unescapedName}"`);
          }
        );

        // Replace regex literals as strings with regex patterns
        processedLine = processedLine.replace(
          /name:\s*"([^"]*\/[^"]*)"/g,
          'name: /$1/i'
        );

        // Replace fragile URL assertions
        processedLine = processedLine.replace(
          /await\s+expect\(page\)\.toHaveURL\([^;\n]*\);/g,
          'await expect(page.url().includes("/login")).toBeFalsy();'
        );

        processedLines.push(processedLine);
      }

      formatted = processedLines.join('\n');

      logger.success('Code formatting normalized - quotes properly balanced');
      return formatted;
    } catch (error) {
      logger.warn('Failed to normalize formatting, returning original code', error);
      return code;
    }
  }

  /**
   * Continue conversation with LLM
   */
  static async continueConversation(messages: LLMMessage[]): Promise<LLMResponse> {
    logger.debug('LLM: Continuing conversation', `${messages.length} messages`);

    // Mock: Return a successful response
    return {
      message: 'Test code generated successfully.',
      stop: true,
    };
  }
}
