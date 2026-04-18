/**
 * LLM Service - Using Groq API for Fast LLM Inference
 */

import { logger } from '../utils/logger';
import { LLMResponse, ToolCall, DOMResponse } from '../types';
import Groq from 'groq-sdk';

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert Playwright TypeScript code generator. Your ONLY job is to output VALID, EXECUTABLE Playwright test code.

!!!CRITICAL OUTPUT RULES (NON-NEGOTIABLE)!!!
1. OUTPUT ONLY PURE PLAYWRIGHT TYPESCRIPT CODE - NOTHING ELSE
2. NO MARKDOWN - Do NOT wrap code in \`\`\` markers
3. NO GHERKIN - Do NOT include Feature:, Scenario:, Given, When, Then, And, But, @
4. NO EXPLANATIONS - No comments, no "Here's the code:", no prose
5. NO MULTIPLE TESTS - Output exactly ONE test() block
6. NO TOP-LEVEL CODE - All code MUST be inside the test() function
7. NO RELATIVE PATHS - Use EXACT URLs provided
8. CODE MUST COMPILE AND RUN - No syntax errors allowed

!!!SEMICOLON RULE (CRITICAL)!!!
EVERY STATEMENT MUST END WITH A SEMICOLON. Without exception:
- await page.goto("url");
- await page.locator("#id").fill("value");
- await page.click("selector");
- await expect(element).toBeVisible();
- const value = "something";
- return something;
- throw error;
Lines that DON'T need semicolons:
- Lines ending with { or =>
- Empty lines
- Comment lines
If unsure, ADD THE SEMICOLON. Semicolons are always safer.

!!!MANDATORY STRUCTURE (COPY THIS EXACTLY)!!!
Your output MUST follow this EXACT format:
---START---
import { test, expect } from "@playwright/test";

test("GENERATE_MEANINGFUL_TEST_NAME_HERE", async ({ page }) => {
  await page.goto("URL_HERE");
  // Your test steps here
});
---END---

CRITICAL: Replace "GENERATE_MEANINGFUL_TEST_NAME_HERE" with a descriptive name based on what the test does
Examples of good test names:
- "Login to LeafTaps and verify CRM link"
- "Fill order form and submit"
- "Search for product and add to cart"

Do NOT use placeholder names like "Test name here", "Test", "My test", etc.
Do NOT add anything before "import" or after "});".
Do NOT add markdown backticks.
Do NOT add any other text.

!!!STRICT PLAYWRIGHT RULES!!!
1. USE DOUBLE QUOTES ONLY: import, test, goto, locator, expect - ALL use double quotes
2. USE ASYNC/AWAIT: "async ({ page }) => { await page..." - do NOT use .then()
3. USE MODERN METHODS: page.getByRole(), page.locator(), page.getByText() - NEVER deprecated click()/fill()
4. CHAIN METHODS: await page.locator("#id").fill("value").click() chained
5. WAIT FOR LOAD: Use await page.waitForLoadState("load") after goto
6. VERIFY WITH EXPECT: await expect(element).toBeVisible() - NEVER check URLs
7. USE TRY/CATCH: Wrap in try/catch for error handling
8. EVERY STATEMENT MUST END WITH SEMICOLON

!!!EXTRACTION FROM TEST STEPS!!!
- Usernames/passwords: Extract exact values in quotes
- URLs: Use EXACTLY what's provided - do NOT modify
- Button text: Extract from "Click X button" 
- Field names: Extract from "Enter Y in X field"
- Verification text: Extract from "Verify X is visible"

!!!SELECTOR STRATEGIES!!!
For input fields: #username, [name="username"], [type="text"], [placeholder="Username"]
For buttons: button:has-text("Login"), [role="button"], getByRole("button", { name: /login/i })
For links: a:has-text("CRM"), [role="link"], getByRole("link", { name: /crm/i })
For text: page.getByText(/exact text/i)

!!!FINAL CHECKLIST BEFORE OUTPUT!!!
Before generating code, verify EACH of these:
✓ Import statement has "@playwright/test"
✓ One test() block with descriptive name
✓ All statements inside test() function
✓ EVERY LINE that is a statement ends with ;
✓ No markdown backticks
✓ No Gherkin keywords
✓ No comments or explanations
✓ Double quotes everywhere (not single quotes)
✓ await keyword for all async operations
✓ try/catch block for error handling

!!!EXAMPLE CORRECT OUTPUT!!!
import { test, expect } from "@playwright/test";

test("Login to leaftap and verify success", async ({ page }) => {
  try {
    await page.goto("http://leaftaps.com/opentaps/control/main");
    await page.waitForLoadState("load");
    
    await page.locator("#username").fill("demosalesmanager");
    await page.locator("#password").fill("crmsfa");
    await page.getByRole("button", { name: /login/i }).click();
    
    await expect(page.getByRole("link", { name: /CRM/i })).toBeVisible();
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
});

!!!WHAT NOT TO DO!!!
❌ Do NOT include markdown: \`\`\`ts ... \`\`\`
❌ Do NOT include Gherkin: Feature:, Scenario:, Given, When, Then
❌ Do NOT include explanations or comments outside code
❌ Do NOT use single quotes: 'import' or 'test' (use double quotes "import")
❌ Do NOT have code before "import" or after "});"
❌ Do NOT use deprecated methods: page.click("selector"), page.fill("selector", "value")
❌ Do NOT use .then() chains - use async/await only
❌ Do NOT verify by URL - use element visibility checks instead
❌ Do NOT output multiple test() blocks

OUTPUT ONLY THE CODE. NOTHING ELSE.`;




export class LLMService {
  /**
   * Process test steps using Groq API - Direct Code Generation with URL
   */
  static async processTestSteps(testSteps: string, url?: string): Promise<LLMResponse> {
    logger.info('🤖 LLM (Groq): Generating test code from steps');
    if (url) {
      logger.info(`   Target URL: ${url}`);
    }

    try {
      // Build user message with URL information
      let userMessage = `TEST STEPS TO CONVERT:
${testSteps}

TARGET WEBSITE URL (MUST USE EXACTLY):
${url || 'Not provided - use values from test steps'}

INSTRUCTIONS:
1. Extract exact values from test steps (usernames, passwords, URLs)
2. Use page.goto('${url || 'THE_EXACT_URL'}') - this is the WEBSITE to test
3. Generate Playwright code that will run against this URL
4. Use realistic selectors for login forms
5. Include the extracted credentials in the code`;

      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      });

      const responseText = response.choices[0].message.content || '';
      logger.debug('LLM generated code:', responseText.substring(0, 200));
      logger.success('✓ LLM: Test code generation successful');

      return {
        message: responseText,
        toolCalls: [],
        stop: true, // Stop iteration - we have the code
      };
    } catch (error) {
      logger.error('Groq API error:', error);
      throw error;
    }
  }

  /**
   * Process test steps with real DOM elements from MCP
   * This uses actual page analysis to provide precise selectors
   */
  static async processTestStepsWithDOM(
    testSteps: string,
    url: string,
    domResponse?: DOMResponse
  ): Promise<LLMResponse> {
    logger.info('🤖 LLM (Groq): Generating test code with real DOM elements');
    logger.info(`   Target URL: ${url}`);

    try {
      // Build DOM elements reference for LLM
      let domElementsContext = '';
      if (domResponse && domResponse.elements && domResponse.elements.length > 0) {
        logger.debug(`   Using ${domResponse.elements.length} real DOM elements from MCP`);
        domElementsContext = `
AVAILABLE PAGE ELEMENTS (from real DOM analysis):
Page Title: ${domResponse.title}
Page Type: ${domResponse.pageType}

Interactive Elements Found:
${domResponse.elements
  .map(
    (el, idx) =>
      `${idx + 1}. ${el.name || el.role}
   - Selector: ${el.selector}
   - Type: ${el.type || 'button/link'}
   - Role: ${el.role}
   ${el.placeholder ? `- Placeholder: ${el.placeholder}` : ''}`
  )
  .join('\n')}

INSTRUCTIONS FOR USING REAL SELECTORS:
1. Use the EXACT selectors provided above from the real DOM analysis
2. These selectors have been tested on the actual website
3. Follow the selector format exactly for maximum compatibility
4. If a selector seems generic (like [type="text"]), use additional context to make it specific
5. Prefer selectors with IDs or data attributes when available
`;
      } else {
        logger.debug('   No real DOM elements available, using generic selectors');
        domElementsContext = `
NOTE: Real DOM analysis was not available. Generate sensible selectors based on common web patterns.
Use standard selectors like [type="text"], button:has-text("text"), [placeholder="..."], etc.
`;
      }

      // Build user message with URL and DOM information
      // CRITICAL: Do NOT ask for markdown - we want pure code only
      const userMessage = `TEST STEPS:
${testSteps}

TARGET URL (USE EXACTLY):
${url}
${domElementsContext}

GENERATE PLAYWRIGHT TEST CODE NOW (PURE CODE ONLY, NO MARKDOWN, NO EXPLANATIONS):`;

      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.6, // Slightly lower for more consistent selector usage
        max_tokens: 2500, // Slightly higher for more complete code
      });

      const responseText = response.choices[0].message.content || '';
      logger.debug('LLM generated code with real DOM:', responseText.substring(0, 200));
      logger.success('✓ LLM: Test code generation with real DOM elements successful');

      return {
        message: responseText,
        toolCalls: [],
        stop: true,
      };
    } catch (error) {
      logger.error('Groq API error:', error);
      throw error;
    }
  }

  /**
   * Continue conversation with Groq
   */
  static async continueConversation(messages: any[]): Promise<LLMResponse> {
    logger.info('🤖 LLM (Groq): Continuing code generation');

    try {
      // Convert messages to Groq format
      const groqMessages = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: groqMessages,
        temperature: 0.7,
        max_tokens: 2048,
      });

      const responseText = response.choices[0].message.content || '';
      logger.debug('LLM continued response:', responseText.substring(0, 200));

      return {
        message: responseText,
        toolCalls: [],
        stop: true,
      };
    } catch (error) {
      logger.error('Groq API error:', error);
      throw error;
    }
  }

  /**
   * Parse tool calls from Groq response
   */
  private static parseToolCalls(text: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const matches = text.match(/\[TOOL_CALL\](.*?)\[\/TOOL_CALL\]/gs);

    if (matches) {
      matches.forEach((match) => {
        try {
          const json = match.replace('[TOOL_CALL]', '').replace('[/TOOL_CALL]', '').trim();
          const parsed = JSON.parse(json);
          toolCalls.push({
            name: parsed.toolName,
            args: parsed.args,
          });
          logger.debug(`Parsed tool call: ${parsed.toolName}`);
        } catch (e) {
          logger.debug('Could not parse tool call:', match);
        }
      });
    }

    return toolCalls;
  }

  /**
   * Generate final Playwright code using Groq
   */
  static async generatePlaywrightCode(
    testSteps: string,
    domElements?: DOMResponse
  ): Promise<string> {
    logger.info('📝 LLM (Groq): Generating Playwright code');

    try {
      const elementList = domElements?.elements
        ?.map((el) => `- ${el.name} (${el.role}): ${el.selector}`)
        .join('\n') || 'Use standard Playwright selectors';

      const prompt = `Generate production-ready Playwright TypeScript test code for these steps:

Test Steps:
${testSteps}

Available Page Elements:
${elementList}

Page Type: ${domElements?.pageType || 'generic'}

Requirements:
- Use exact selectors provided above
- Include proper error handling
- Add meaningful assertions
- Use realistic test data
- Import from '../helpers' for common operations
- Make code follow Playwright best practices
- Generate the complete test file with imports and all hooks

Format the response as a complete, runnable Playwright test file starting with imports.`;

      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content:
              'You are a Playwright test code expert. Generate production-ready, complete test files.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 2000,
      });

      const code = response.choices[0].message.content || '';
      logger.success('✓ Groq code generation complete');
      return code;
    } catch (error) {
      logger.error('Groq code generation error:', error);
      throw error;
    }
  }

  /**
   * Parse test steps into structured actions
   * Handles both numbered (1. 2. 3.) and newline-separated formats
   */
  private static parseTestSteps(testSteps: string): string[] {
    let steps: string[] = [];

    // Try numbered format first (1. Step one, 2. Step two)
    if (testSteps.includes('.')) {
      steps = testSteps.split(/\d+\.\s+/).filter((s) => s.trim());
    }

    // If no numbered steps found, try newline separation
    if (steps.length === 0) {
      steps = testSteps.split('\n').map((s) => s.replace(/^[-*•]\s+/, '').trim()).filter((s) => s.length > 0);
    }

    // Fallback: treat entire string as one step
    if (steps.length === 0) {
      steps = [testSteps.trim()];
    }

    logger.debug(`LLM: Parsed ${steps.length} test step(s)`);
    return steps;
  }

  /**
   * Build Playwright test code using LLM intelligence and MCP DOM data
   */
  private static buildPlaywrightCode(steps: string[], domElements?: DOMResponse): string {
    logger.info('Building code with MCP DOM data and LLM logic');

    // Generate steps with smart selector matching
    const stepCode = this.generateStepCode(steps, domElements);

    const code = `import { test, expect, Page } from '@playwright/test';
import { navigateTo, login, fillForm } from '../helpers';

test.describe('Generated Test Suite', () => {
  let page: Page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
  });

  test('should complete the user workflow', async () => {
    // Test steps:
${steps.map((step, idx) => `    // Step ${idx + 1}: ${step.trim()}`).join('\n')}

    // Navigation
    await navigateTo(page, 'http://example.com');

    // Interactions (Generated using MCP DOM analysis + LLM logic)
${stepCode}

    // Assertions
    await expect(page).toHaveTitle(/Expected Title/);
  });
});`;

    return code;
  }

  /**
   * Generate code for test steps using MCP DOM data and LLM reasoning
   */
  private static generateStepCode(steps: string[], domElements?: DOMResponse): string {
    const codeLines: string[] = [];

    steps.forEach((step, idx) => {
      const trimmed = step.toLowerCase().trim();

      // Use MCP DOM data to find matching elements and generate accurate selectors
      const selector = this.findSelectorForStep(trimmed, domElements);

      // LLM-like reasoning on what action to take
      codeLines.push(`    // Step ${idx + 1}: ${step.trim()}`);

      // Login/Authentication
      if (trimmed.includes('login') || (trimmed.includes('enter') && trimmed.includes('username'))) {
        const usernameSelector = this.findElementSelector('username', domElements);
        const passwordSelector = this.findElementSelector('password', domElements);
        const buttonSelector = this.findElementSelector('login', domElements);
        
        codeLines.push(`    // LLM: Detected login flow - using MCP DOM data`);
        if (usernameSelector) {
          codeLines.push(`    await page.fill('${usernameSelector}', 'testuser@example.com');`);
        }
        if (passwordSelector) {
          codeLines.push(`    await page.fill('${passwordSelector}', 'password123');`);
        }
        if (buttonSelector) {
          codeLines.push(`    await page.click('${buttonSelector}');`);
        }
        codeLines.push(`    await page.waitForNavigation();`);
      }
      // Fill text/input fields
      else if (trimmed.includes('enter') || trimmed.includes('fill')) {
        if (selector) {
          const value = this.extractValueFromStep(trimmed);
          codeLines.push(`    // LLM: Matched element using MCP DOM`);
          codeLines.push(`    await page.fill('${selector}', '${value}');`);
        } else {
          codeLines.push(`    await page.fill('input[type="text"]', 'sample data');`);
        }
      }
      // Click actions
      else if (trimmed.includes('click')) {
        if (selector) {
          codeLines.push(`    // LLM: Using MCP-found selector`);
          codeLines.push(`    await page.click('${selector}');`);
        } else {
          const buttonName = trimmed.match(/click\s+(?:on\s+)?(?:the\s+)?([a-zA-Z\s]+)/)?.[1] || 'button';
          codeLines.push(`    await page.click('button:has-text("${buttonName}")');\n`);
        }
      }
      // Search/Navigate
      else if (trimmed.includes('search') || trimmed.includes('navigate')) {
        const searchSelector = this.findElementSelector('search', domElements);
        if (searchSelector) {
          codeLines.push(`    // LLM: Using MCP-detected search element`);
          const searchValue = this.extractValueFromStep(trimmed);
          codeLines.push(`    await page.fill('${searchSelector}', '${searchValue}');`);
          codeLines.push(`    await page.press('${searchSelector}', 'Enter');`);
        }
      }
      // Add to cart / Shopping
      else if (trimmed.includes('add') && trimmed.includes('cart')) {
        const cartSelector = this.findElementSelector('add to cart', domElements);
        if (cartSelector) {
          codeLines.push(`    // LLM: Using MCP-found add-to-cart element`);
          codeLines.push(`    await page.click('${cartSelector}');`);
          codeLines.push(`    await expect(page.locator('text=Added to cart')).toBeVisible();`);
        }
      }
      // Checkout
      else if (trimmed.includes('checkout')) {
        const checkoutSelector = this.findElementSelector('checkout', domElements);
        if (checkoutSelector) {
          codeLines.push(`    // LLM: Using MCP-detected checkout button`);
          codeLines.push(`    await page.click('${checkoutSelector}');`);
          codeLines.push(`    await page.waitForURL(/checkout/);`);
        }
      }
      // Wait for elements
      else if (trimmed.includes('wait')) {
        codeLines.push(`    // LLM: Adding wait with MCP context`);
        codeLines.push(`    await page.waitForLoadState('networkidle');`);
      }
      // Accept/Submit forms
      else if (trimmed.includes('accept') || trimmed.includes('confirm')) {
        codeLines.push(`    // LLM: Detected form acceptance - using MCP`);
        codeLines.push(`    const buttons = await page.locator('button').all();`);
        codeLines.push(`    for (const btn of buttons) {`);
        codeLines.push(`      const text = await btn.textContent();`);
        codeLines.push(`      if (text?.toLowerCase().includes('confirm') || text?.toLowerCase().includes('accept') || text?.toLowerCase().includes('submit')) {`);
        codeLines.push(`        await btn.click();`);
        codeLines.push(`        break;`);
        codeLines.push(`      }`);
        codeLines.push(`    }`);
      }
      // Verify/Assert
      else if (trimmed.includes('verify') || trimmed.includes('assert')) {
        codeLines.push(`    // LLM: Generated assertion using MCP analysis`);
        if (trimmed.includes('success') || trimmed.includes('confirmation')) {
          codeLines.push(`    await expect(page.locator('text=success :ignore-case, text=confirmation :ignore-case')).toBeVisible({ timeout: 5000 });`);
        } else {
          codeLines.push(`    await expect(page).toHaveURL(/confirmation|success/);`);
        }
      }

      codeLines.push('');
    });

    return codeLines.join('\n');
  }

  /**
   * Find selector for a step using MCP DOM data
   * LLM-like matching algorithm
   */
  private static findSelectorForStep(step: string, domElements?: DOMResponse): string | null {
    if (!domElements || !domElements.elements) {
      logger.debug('No MCP DOM data available');
      return null;
    }

    // Extract keywords from step
    const keywords = step.split(/\s+/).filter(w => w.length > 3);
    
    // Find best matching element
    for (const element of domElements.elements) {
      const elementName = (element.name || '').toLowerCase();
      const elementRole = (element.role || '').toLowerCase();
      
      // Score each element based on keyword matches
      let score = 0;
      for (const keyword of keywords) {
        if (elementName.includes(keyword) || elementRole.includes(keyword)) {
          score += 2;
        }
        if (element.placeholder?.toLowerCase().includes(keyword)) {
          score += 1;
        }
      }

      // Return best match
      if (score > 0) {
        logger.debug(`LLM: Matched "${step}" to element "${element.name}" (score: ${score})`);
        return element.selector;
      }
    }

    return null;
  }

  /**
   * Find element by name/role using MCP data
   */
  private static findElementSelector(keyword: string, domElements?: DOMResponse): string | null {
    if (!domElements || !domElements.elements) {
      return null;
    }

    const lowerKeyword = keyword.toLowerCase();
    
    for (const element of domElements.elements) {
      const name = (element.name || '').toLowerCase();
      const role = (element.role || '').toLowerCase();
      const placeholder = (element.placeholder || '').toLowerCase();

      if (name.includes(lowerKeyword) || role.includes(lowerKeyword) || placeholder.includes(lowerKeyword)) {
        logger.debug(`LLM: Found "${keyword}" using MCP: ${element.selector}`);
        return element.selector;
      }
    }

    return null;
  }

  /**
   * Extract value from test step
   */
  private static extractValueFromStep(step: string): string {
    // Look for email patterns
    const emailMatch = step.match(/[\w\.-]+@[\w\.-]+\.\w+/);
    if (emailMatch) return emailMatch[0];

    // Look for quoted values
    const quotedMatch = step.match(/'([^']*)'/);
    if (quotedMatch) return quotedMatch[1];

    // Default values
    if (step.includes('password')) return 'password123';
    if (step.includes('name')) return 'John Doe';
    if (step.includes('phone')) return '555-1234';
    
    return 'sample data';
  }

  /**
   * Normalize raw text using LLM
   * Used by Jira mapper to structure unclean content
   */
  static async normalizeText(prompt: string): Promise<LLMResponse> {
    logger.info('🤖 LLM (Groq): Normalizing text content');

    try {
      const response = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          {
            role: 'system',
            content:
              'You are a QA automation expert. Normalize and structure raw content as requested.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5, // Lower temp for more consistent structuring
        max_tokens: 1500,
      });

      const responseText = response.choices[0].message.content || '';
      logger.success('✓ LLM: Text normalization successful');

      return {
        message: responseText,
        toolCalls: [],
        stop: true,
      };
    } catch (error) {
      logger.error('Groq API error during text normalization:', error);
      throw error;
    }
  }
}
