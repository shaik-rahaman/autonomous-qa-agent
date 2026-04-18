/**
 * Agent Executor - Orchestrates the LLM loop with tool execution
 */

import { logger } from '../utils/logger';
import { LLMService } from '../llm/llm-service';
import { mcpClient } from '../mcp/client';
import { AgentState, LLMMessage, ToolCall } from '../types';

const MAX_ITERATIONS = 10;

export class AgentExecutor {
  private state: AgentState;
  private targetUrl: string;
  private testSteps: string;

  constructor(testSteps: string, url: string) {
    this.testSteps = testSteps;
    this.targetUrl = url;
    this.state = {
      steps: [
        {
          role: 'system',
          content: `Convert the following test steps into Playwright TypeScript code using target URL: ${url}\n\nTest steps: ${testSteps}`,
        },
      ],
      iteration: 0,
    };
    logger.section(`Agent Executor Started for: ${testSteps}`);
  }

  /**
   * Execute the agent loop
   */
  async execute(): Promise<string> {
    logger.info('Starting agent execution loop');

    while (this.state.iteration < MAX_ITERATIONS) {
      this.state.iteration++;
      logger.info(`Iteration ${this.state.iteration}/${MAX_ITERATIONS}`);

      try {
        // Get LLM response
        const llmResponse = await this.getLLMResponse();

        // If there are tool calls, execute them
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          logger.debug(
            `Tool calls detected: ${llmResponse.toolCalls.map((t) => t.name).join(', ')}`
          );

          const toolResults = await this.executeTools(llmResponse.toolCalls);
          this.addToolResultsToState(toolResults);
        }

        // Add assistant message
        this.state.steps.push({
          role: 'assistant',
          content: llmResponse.message,
        });

        // Check if we should stop
        if (llmResponse.stop) {
          logger.info('Agent finished - stop signal received');
          break;
        }
      } catch (error) {
        logger.error(`Error in iteration ${this.state.iteration}`, error);
        throw error;
      }
    }

    // Generate final code
    const code = await this.generateFinalCode();
    logger.success('Agent execution completed');

    return code;
  }

  /**
   * Get LLM response
   */
  private async getLLMResponse() {
    logger.debug('Getting LLM response');

    // First interaction - process test steps with URL
    if (this.state.iteration === 1) {
      return await LLMService.processTestSteps(this.testSteps, this.targetUrl);
    }

    // Subsequent calls
    return await LLMService.continueConversation(this.state.steps);
  }

  /**
   * Execute tool calls
   */
  private async executeTools(
    toolCalls: ToolCall[]
  ): Promise<Record<string, unknown>[]> {
    logger.debug(`Executing ${toolCalls.length} tools`);

    const results: Record<string, unknown>[] = [];

    for (const toolCall of toolCalls) {
      logger.info(`Executing tool: ${toolCall.name}`);

      try {
        const result = await mcpClient.executeTool(toolCall.name, toolCall.args);
        results.push({ tool: toolCall.name, result, success: true });
        logger.success(`Tool executed: ${toolCall.name}`);

        // Store DOM data if it's a get_dom_json call
        if (toolCall.name === 'get_dom_json' && result) {
          this.state.domData = result as typeof this.state.domData;
        }
      } catch (error) {
        logger.error(`Tool failed: ${toolCall.name}`, error);
        results.push({ tool: toolCall.name, error: String(error), success: false });
      }
    }

    return results;
  }

  /**
   * Add tool results to state
   */
  private addToolResultsToState(toolResults: Record<string, unknown>[]): void {
    const resultsText = toolResults
      .map((r) => `${r.tool}: ${JSON.stringify(r.result || r.error)}`)
      .join('\n');

    this.state.steps.push({
      role: 'user',
      content: `Tool results:\n${resultsText}`,
    });
  }

  /**
   * Generate final Playwright code
   */
  private async generateFinalCode(): Promise<string> {
    logger.debug('Generating final code');

    // Generate code with LLM
    const code = await LLMService.generatePlaywrightCode(this.testSteps, this.targetUrl, this.state.domData);

    this.state.generatedCode = code;
    return code;
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.state;
  }
}
