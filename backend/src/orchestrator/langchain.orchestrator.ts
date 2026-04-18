/**
 * LangChain-based Test Orchestrator
 * Uses LangChain with Groq LLM for intelligent decision-making in test orchestration
 */

import { ChatGroq } from "@langchain/groq";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../utils/logger";
import { executorService, ExecutionResult } from "../execution/executor-service";
import { healFailure, HealFailureInput } from "../agents/self-healing";
import { findSelectorFix, saveSelectorFix } from "../self-healing/selector-store";
import path from "path";
import fs from "fs";

export interface LangChainOrchestrationInput {
  testFile: string;
  targetUrl?: string;
  projectRoot?: string;
}

export interface LangChainOrchestrationResult extends ExecutionResult {
  healed: boolean;
  reused: boolean;
}

/**
 * Create LangChain tools for orchestration
 */
function createOrchestrationTools(testFilesPath: string) {
  const tools = [];

  // Tool 1: run_test - Execute a Playwright test file
  tools.push(
    new DynamicStructuredTool({
      name: "run_test",
      description: "Execute a Playwright test file",
      schema: z.object({
        testFile: z.string().describe("The test file to run"),
        overrideSelector: z.string().optional().describe("Optional healed selector to apply for this run"),
      }),
      func: async (input: { testFile: string; overrideSelector?: string }) => {
        try {
          logger.info(`🧪 [Tool] Running test: ${input.testFile}`);
          const result = await executorService.executeTest(input.testFile, { overrideSelector: input.overrideSelector });
          return JSON.stringify({
            status: result.status,
            passed: result.status === "passed",
            errors: result.errors || [],
          });
        } catch (error) {
          return JSON.stringify({
            status: "error",
            passed: false,
            errors: [String(error)],
          });
        }
      },
    }) as any
  );

  // Tool 2: reuse_selector - Check for previously healed selector
  tools.push(
    new DynamicStructuredTool({
      name: "reuse_selector",
      description: "Check if a previously healed selector fix exists and return it",
      schema: z.object({
        testFile: z.string().describe("The test file name"),
        targetUrl: z.string().describe("The target URL"),
      }),
      func: async (input: { testFile: string; targetUrl: string }) => {
        try {
          logger.info(`♻️ [Tool] Checking for reused selector: ${input.testFile}`);
          const fix = findSelectorFix({
            step: input.testFile,
            url: input.targetUrl || "unknown",
          });

          if (fix) {
            logger.info(`✅ Found stored fix: ${fix.originalSelector} → ${fix.healedSelector}`);
            return JSON.stringify({
              found: true,
              originalSelector: fix.originalSelector,
              healedSelector: fix.healedSelector,
            });
          } else {
            logger.info(`❌ No stored fix found for ${input.testFile}`);
            return JSON.stringify({
              found: false,
            });
          }
        } catch (error) {
          return JSON.stringify({
            found: false,
            error: String(error),
          });
        }
      },
    }) as any
  );

  // Tool 3: heal_test - Call the self-healing agent
  tools.push(
    new DynamicStructuredTool({
      name: "heal_test",
      description: "Call the self-healing agent to find an alternative selector",
      schema: z.object({
        testFile: z.string().describe("The test file that failed"),
        errorMessage: z.string().describe("The error message from the test failure"),
        failedSelector: z.string().describe("The selector that failed"),
        targetUrl: z.string().describe("The target URL"),
      }),
      func: async (input: { testFile: string; errorMessage: string; failedSelector: string; targetUrl: string }) => {
        try {
          logger.info(`🏥 [Tool] Healing test failure`);

          const healInput: HealFailureInput = {
            step: input.testFile,
            error: input.errorMessage,
            selector: input.failedSelector,
            url: input.targetUrl || "unknown",
          };

          const healOutput = await healFailure(healInput);

          if (healOutput.fixed && healOutput.newSelector) {
            logger.info(
              `✅ Healing successful: ${input.failedSelector} → ${healOutput.newSelector}`
            );

            // Save the fix for future reuse
            try {
              saveSelectorFix({
                step: input.testFile,
                url: input.targetUrl || "unknown",
                originalSelector: input.failedSelector,
                healedSelector: healOutput.newSelector,
              });
              logger.info(`💾 Saved healed selector for future reuse`);
            } catch (saveError) {
              logger.warn(`Failed to save selector fix: ${saveError}`);
            }

            return JSON.stringify({
              fixed: true,
              newSelector: healOutput.newSelector,
            });
          } else {
            logger.warn(`❌ Healing failed: ${healOutput.reason}`);
            return JSON.stringify({
              fixed: false,
              reason: healOutput.reason || "Healing failed",
            });
          }
        } catch (error) {
          return JSON.stringify({
            fixed: false,
            error: String(error),
          });
        }
      },
    }) as any
  );

  return tools;
}

/**
 * Helper function to create a consistent result object
 */
function createResult(
  executionResult: ExecutionResult | null,
  healed: boolean,
  reused: boolean
): LangChainOrchestrationResult {
  if (!executionResult) {
    return {
      id: `result-${Date.now()}`,
      testFile: "unknown",
      status: "error",
      startTime: new Date(),
      passed: 0,
      failed: 1,
      skipped: 0,
      totalTests: 1,
      stdout: "",
      stderr: "No result available",
      errors: ["No result available"],
      healed,
      reused,
    };
  }

  return {
    ...executionResult,
    healed,
    reused,
  };
}

/**
 * Uses LangChain agent with tools for intelligent orchestration
 */
export async function runWithLangChain(
  input: LangChainOrchestrationInput
): Promise<LangChainOrchestrationResult> {
  const { testFile, targetUrl = "unknown", projectRoot = "." } = input;

  try {
    logger.section(`🤖 [LangChain] Starting orchestration with Agent for: ${testFile}`);

    // Use singleton executor service (properly configured with correct paths)
    const testFilesPath = path.join(projectRoot, "..", "pw-ai-agents", "tests", "ui", "generated", "scripts");

    // Create tools
    const tools = createOrchestrationTools(testFilesPath);
    logger.info(`📦 Created ${tools.length} orchestration tools`);

    // Initialize Groq LLM for orchestration decisions
    const llm = new ChatGroq({
      modelName: "mixtral-8x7b-32768", // Free tier Groq model
      temperature: 0,
      apiKey: process.env.GROQ_API_KEY,
    });

    // Create system prompt for the agent
    const systemPrompt = `You are an expert test orchestration agent. Your job is to:
1. Run Playwright tests using the "run_test" tool
2. Check for previously healed selectors using "reuse_selector" tool
3. If a test fails, ALWAYS attempt to heal it using "heal_test" tool with the failed selector and error details
4. After healing, retry the test with "run_test" using the new selector
5. Return detailed analysis of what happened

CRITICAL: When run_test returns status: "failed", always call heal_test BEFORE giving up.

Tools available:
- run_test: Execute a test file
- reuse_selector: Check for previously healed selectors
- heal_test: Call self-healing agent to find new selector

Always follow this sequence:
1. Call reuse_selector first
2. If found, apply and call run_test again
3. If not found, call run_test
4. If run_test fails, call heal_test with error details
5. After heal_test returns a fix, call run_test again with the new selector
6. Report final status`;

    // Create agent executor
    logger.info(`🤖 [LangChain] Creating agent executor...`);
    
    // For now, manually orchestrate since LangChain agent setup can be complex
    // But we'll implement proper agent routing for each step
    let result: ExecutionResult | null = null;
    let healed = false;
    let reused = false;

    // Step 1: Check for reused selector
    logger.info(`📋 Step 1: Checking for previously healed selector...`);
    const reuseResult = await tools[1].func({ testFile, targetUrl });
    const reuseData = JSON.parse(reuseResult as string);
    logger.info(`[Agent Decision] reuse_selector returned: ${JSON.stringify(reuseData)}`);

      if (reuseData.found) {
      logger.success(`✅ [Agent] Found previously healed selector: ${reuseData.healedSelector}`);
      reused = true;
      
      // Step 2: Run test with reused selector
      logger.info(`🔄 Step 2: Running test with reused selector...`);
        const runResult = await tools[0].func({ testFile, overrideSelector: reuseData.healedSelector });
        result = await executorService.executeTest(testFile, { overrideSelector: reuseData.healedSelector });
        result.status = JSON.parse(runResult as string).status;
      logger.info(`[Agent Decision] run_test returned: ${runResult}`);

      if (JSON.parse(runResult as string).passed) {
        logger.success(`✅ [Agent] Test passed with reused selector!`);
        return createResult(result, healed, reused);
      }
    }

    // Step 3: Run test for the first time
    if (!result) {
      logger.info(`🧪 Step 3: Running test for first time...`);
      const runResult = await tools[0].func({ testFile });
      const runData = JSON.parse(runResult as string);
      result = await executorService.executeTest(testFile);
      result.status = runData.status;
      logger.info(`[Agent Decision] run_test returned: ${runResult}`);

      if (runData.passed) {
        logger.success(`✅ [Agent] Test passed on first attempt!`);
        return createResult(result, healed, reused);
      }
    }

    // Step 4: Test failed, CALL HEAL_TEST
    if (result && result.status === "failed") {
      logger.error(`❌ [LangChain] Test FAILED: ${result.status}`);
      logger.info(`🔍 Error output: ${(result.stderr || result.stdout || "").substring(0, 200)}...`);
      
      // Read the test file to extract the failed selector
      const testFilePath = path.join(testFilesPath, testFile);
      let fileContent = '';
      let failedSelector = 'unknown_selector';
      
      try {
        fileContent = fs.readFileSync(testFilePath, 'utf-8');
        
        // Try to extract the failed selector from test file
        const selectorMatch = fileContent.match(/getByRole\('button',\s*\{\s*name:\s*\/([^/]+)\//);
        if (selectorMatch) {
          failedSelector = selectorMatch[1];
        }
      } catch (readErr) {
        logger.warn(`Could not read test file for healing: ${readErr}`);
      }
      
      // Prepare error message
      const errorMessage = [
        result.stderr,
        result.stdout,
        (result.errors || []).join('\n')
      ].filter(e => e).join('\n');

      logger.info(`🏥 Step 4: Triggering heal_test tool...`);
      logger.info(`   - Test: ${testFile}`);
      logger.info(`   - Failed Selector: ${failedSelector}`);
      logger.info(`   - Target URL: ${targetUrl}`);

      // Call heal_test tool
      const healResult = await tools[2].func({
        testFile,
        errorMessage: errorMessage.substring(0, 500), // Limit error message
        failedSelector: failedSelector,
        targetUrl: targetUrl,
      });

      const healData = JSON.parse(healResult as string);
      logger.info(`[Agent Decision] heal_test returned: ${JSON.stringify(healData)}`);

        if (healData.fixed) {
        logger.success(`✅ [Agent] Healing successful (${healData.action || healData.reason})`);
        healed = true;

        // Step 5: Retry test with healed selector/strategy
        logger.info(`🔄 Step 5: Retrying test with healed strategy...`);
          const retryResult = await tools[0].func({ testFile, overrideSelector: healData.newSelector });
          const retryData = JSON.parse(retryResult as string);
          result = await executorService.executeTest(testFile, { overrideSelector: healData.newSelector });
          result.status = retryData.status;
        logger.info(`[Agent Decision] run_test (retry) returned: ${JSON.stringify(retryData)}`);

        if (retryData.passed) {
          logger.success(`✅ [Agent] Test PASSED after healing and retry!`);
          return createResult(result, healed, reused);
        } else {
          logger.warn(`⚠️ [Agent] Test still failing after healing attempt`);
          return createResult(result, healed, reused);
        }
      } else {
        logger.warn(`❌ [Agent] Healing not possible: ${healData.reason}`);
        logger.info(`⏭️  [Agent] Skipping retry - issue not fixable`);
        return createResult(result, healed, reused);
      }
    }

    logger.success(`✅ [LangChain] Orchestration complete`);
    return createResult(result, healed, reused);
  } catch (error) {
    logger.error(`❌ [LangChain] Orchestration error: ${error}`);
    
    // Return error result
    const errorResult: LangChainOrchestrationResult = {
      id: `error-${Date.now()}`,
      testFile: input.testFile,
      status: "error",
      startTime: new Date(),
      passed: 0,
      failed: 1,
      skipped: 0,
      totalTests: 1,
      stdout: "",
      stderr: String(error),
      errors: [String(error)],
      healed: false,
      reused: false,
    };
    
    return errorResult;
  }
}
