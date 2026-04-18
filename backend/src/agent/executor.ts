/**
 * Agent Executor - LLM Code Generation with Real DOM Analysis via MCP
 */

import { logger } from '../utils/logger';
import { LLMService } from '../llm/llm-service';
import { GherkinService } from '../llm/gherkin.service';
import { MCPClient } from '../mcp/client';
import { CodeValidator } from '../utils/code-validator';

export interface GeneratedTestResult {
  gherkin: string;
  code: string;
  gherkinPath?: string;
  scriptPath?: string;
}

export class AgentExecutor {
  private testSteps: string;
  private url: string;
  private mcpClient: MCPClient;

  constructor(testSteps: string, url: string) {
    this.testSteps = testSteps;
    this.url = url;
    this.mcpClient = new MCPClient();
    logger.section(`🎯 Agent Executor: Generating test for "${testSteps.substring(0, 50)}..."\n   Target URL: ${url}`);
  }

  /**
   * Execute: Generate both Gherkin and test code
   */
  async executeWithGherkin(): Promise<GeneratedTestResult> {
    logger.section('🤖 Full Test Generation: Gherkin (BDD) + Playwright Code');

    try {
      // Step 1: Convert test steps to Gherkin (with guaranteed fallback)
      logger.info('📝 Step 1: Converting test steps to Gherkin BDD format...');
      let gherkin: string;
      try {
        gherkin = await this.withTimeout(
          GherkinService.convertToGherkin(this.testSteps),
          30000,
          'Gherkin conversion'
        );
        logger.success('✓ Gherkin BDD format generated', { length: gherkin.length });
      } catch (gherkinError) {
        const errorMsg = gherkinError instanceof Error ? gherkinError.message : String(gherkinError);
        logger.warn('⚠️ Gherkin conversion had error, but should have fallback', {
          error: errorMsg,
        });
        // GherkinService now has guaranteed sync fallback, so this shouldn't happen
        // but if it does, create a basic fallback
        gherkin = `# Test Scenario\nFeature: Test Automation\n  Scenario: Test steps\n${this.testSteps}`;
        logger.info('✓ Using basic fallback Gherkin');
      }

      // Step 2: Generate Playwright code
      logger.info('🤖 Step 2: Generating Playwright code...');
      const code = await this.execute();

      logger.success('✓ Complete test generation: Gherkin + Playwright Code');
      return { gherkin, code };
    } catch (error) {
      logger.error('✗ Failed to generate complete test', error);
      throw error;
    } finally {
      // Always cleanup resources
      await this.cleanup();
    }
  }

  /**
   * Execute: Generate test code with real DOM analysis via MCP + LLM (backward compatible)
   */
  async execute(): Promise<string> {
    logger.section('🤖 Test Code Generation: Real DOM Analysis (MCP) + LLM (Groq)');

    try {
      // Step 1: Get real DOM structure from the target URL using MCP
      logger.info('🔍 Step 1: Analyzing real DOM using Playwright MCP...');
      let domResponse;
      try {
        domResponse = await this.withTimeout(
          this.mcpClient.getDomJson(this.url),
          20000,
          'DOM analysis'
        );
        logger.success(`✓ MCP: Found ${domResponse.elements.length} real interactive elements on page`);
        logger.debug(`   Page Type: ${domResponse.pageType}, Title: ${domResponse.title}`);
      } catch (mcpError) {
        logger.warn('⚠️ MCP: Could not analyze real DOM, will proceed with generic selectors');
        logger.debug(`   MCP Error: ${mcpError instanceof Error ? mcpError.message : 'Unknown error'}`);
        domResponse = undefined;
      } finally {
        // Critical: Always close MCP browser to prevent hanging
        await this.mcpClient.close();
      }

      // Step 2: Generate test code with LLM using real DOM data
      logger.info('📝 Step 2: Generating test code with Groq LLM using real DOM elements...');
      const llmResponse = await this.withTimeout(
        LLMService.processTestStepsWithDOM(this.testSteps, this.url, domResponse),
        60000,
        'LLM code generation'
      );
      
      let code = llmResponse.message;
      logger.success('✅ LLM generated test code with real locators');
      
      // Step 3: CRITICAL - Validate and normalize the generated code
      logger.info('✅ Step 3: Validating and normalizing generated code...');
      const validation = CodeValidator.validate(code);
      
      if (!validation.valid) {
        logger.error('❌ Generated code failed validation', {
          errors: validation.errors,
        });
        
        // Use fallback generator if validation fails
        logger.info('🔄 Generating fallback valid Playwright test...');
        code = CodeValidator.generateFallbackTest(this.testSteps, this.url);
        logger.success('✓ Generated fallback test');
      } else if (validation.normalized) {
        code = validation.normalized;
        logger.success('✓ Code validation passed, using normalized version');
      }

      logger.success('✓ Test code generation complete with real DOM locators');
      return code;
    } catch (error) {
      logger.error('✗ Failed to generate test code', error);
      throw error;
    } finally {
      // Ensure cleanup
      await this.cleanup();
    }
  }

  /**
   * Execute promise with timeout protection
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${operationName} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      await this.mcpClient.close();
    } catch (error) {
      logger.debug('Error during cleanup:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
