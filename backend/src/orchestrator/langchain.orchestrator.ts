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
import { extractFailedLocator, isValidSelector } from "../agents/self-healing/error-parser";
import { fastPathHeal } from "../agents/self-healing/fast-path-healer";
import { findSelectorFix, saveSelectorFix } from "../self-healing/selector-store";
import { scriptExecutor } from "../services/script-executor";
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
          const execResult = await executorService.executeTest(input.testFile, input.overrideSelector ? { overrideSelector: input.overrideSelector } : undefined);
          return JSON.stringify({
            status: execResult.status,
            passed: execResult.status === "passed",
            errors: execResult.errors || [],
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
        errorObject: z.any().optional().describe("Optional structured error object from Playwright"),
      }),
      func: async (input: { testFile: string; errorMessage: string; failedSelector: string; targetUrl: string; errorObject?: any }) => {
        try {
          logger.info(`🏥 [Tool] Healing test failure`);

          const healInput: HealFailureInput = {
            step: input.testFile,
            error: input.errorMessage,
            selector: input.failedSelector,
            url: input.targetUrl || "unknown",
          };
          // If a structured error object was provided by the orchestrator, attach it to the input
          if ((input as any).errorObject) {
            // Overwrite the `error` field to pass the structured object through
            healInput.error = (input as any).errorObject;
          }

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

    // FIX 2: Use centralized path resolution - resolved by scriptExecutor
    // This ensures consistent path regardless of where server is started from
    const testFilesPath = scriptExecutor.getGeneratedScriptsDirectory();

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
    let result: ExecutionResult | null = null;
    let healed = false;
    let reused = false;

    // Step 1: Run test for the first time (NO reuse of selectors on first run to avoid corrupted data)
    logger.info(`🧪 Step 1: Running test for first time...`);
    result = await executorService.executeTest(testFile);
    logger.info(`[Agent Decision] run_test returned: status=${result.status}, passed=${result.status === "passed"}`);

    if (result.status === "passed") {
      logger.success(`✅ [Agent] Test passed on first attempt!`);
      return createResult(result, healed, reused);
    }

    // Step 2: Test failed or errored, CHECK FOR SYNTAX ERROR FIRST
    if (result && (result.status === "failed" || result.status === "error")) {
      logger.error(`❌ [LangChain] Test FAILED: ${result.status}`);
      
      const errorOutput = (result.stderr || result.stdout || "").substring(0, 500);
      logger.info(`🔍 Error output: ${errorOutput}`);
      
      // ⚠️  CHECK FOR SYNTAX ERROR - DO NOT HEAL SYNTAX ERRORS
      if (errorOutput.includes("SyntaxError")) {
        logger.error(`❌ CRITICAL: Generated script contains SyntaxError`);
        logger.error(`⏹️  Skipping healing - syntax error cannot be healed by selector replacement`);
        logger.error(`📝 Syntax errors require generation fix, not healing`);
        
        // Return immediately without attempting healing
        return {
          ...result,
          healed: false,
          reused: false,
        };
      }
      
      // FIX 3-5: Use lastReachedLocator from execution instead of file read
      // This is more reliable and doesn't require file system access
      let failedSelector = '';
      
      // TASK 1: Comprehensive error and selector logging
      console.log(`\n[ORCHESTRATOR] Healing Pipeline Initiated`);
      console.log(`[ORCHESTRATOR] Playwright Error:\n${result.stderr || result.stdout || '(no error captured)'}`);
      console.log(`[ORCHESTRATOR] lastReachedLocator from execution: ${(result as any).lastReachedLocator || 'N/A'}`);
      
      try {
        // TASK 3: Check for navigation timeout
        const isNavigationTimeout = /page\.goto.*timeout|waitForURL.*timeout|navigation.*timeout/i.test(
          result.stderr + result.stdout
        );
        
        if (isNavigationTimeout) {
          console.log(`[ORCHESTRATOR] ⚠️  NAVIGATION TIMEOUT DETECTED`);
          console.log(`[ORCHESTRATOR] Classification: NAVIGATION_TIMEOUT`);
          console.log(`[ORCHESTRATOR] Action: SKIP HEALING - navigation failures are not locator issues`);

            // Diagnostics requested: provide fuller context before early return
            try {
              console.log('NAV_TIMEOUT_DETECTED=true');
              console.log('NAV_TIMEOUT_ERROR=', String(result.stderr || result.stdout || '(no error captured)'));
              console.log('NAV_TIMEOUT_LAST_REACHED_LOCATOR=', (result as any).lastReachedLocator || 'N/A');
              console.log('NAV_TIMEOUT_TEST_FILE=', testFile || 'unknown');
              // Heuristic: would healing have run if this were not a navigation timeout?
              const combinedForHealCheck = String(result.stderr || '') + '\n' + String(result.stdout || '');
              const wouldHeal = /waiting for\s+locator|params\.selector|locator\s*\(/i.test(combinedForHealCheck);
              console.log('NAV_TIMEOUT_HEALING_WOULD_HAVE_RUN=', wouldHeal ? 'true' : 'false');
              console.log('EXECUTION_PHASE=', healed ? 'HEALED_RETRY' : 'INITIAL');
            } catch (diagErr) {
              console.warn('Failed to emit NAV timeout diagnostics', String(diagErr));
            }
          
          // TASK 4: Skip healing for navigation timeouts
          logger.info(`⏭️  Navigation timeout detected - skipping locator healing`);
          return {
            ...result,
            healed: false,
            reused: false,
          };
        }
        
        // PRIORITY 1: Playwright "waiting for locator('...')" pattern in stderr/stdout
        const combinedOutput = String(result.stderr || '') + '\n' + String(result.stdout || '');
        const cleanedErrorText = combinedOutput.replace(/\x1B\[[0-9;]*m/g, '');

        const waitingForMatch = cleanedErrorText.match(/waiting for\s+locator\s*\(\s*(["'`])([^\)]+?)\1\s*\)/i);
        if (waitingForMatch && waitingForMatch[2]) {
          const candidate = waitingForMatch[2].trim();
          if (isValidSelector(candidate)) {
            failedSelector = candidate;
            console.log(`ACTUAL_FAILED_SELECTOR=${failedSelector}`);
            console.log(`FAILED_SELECTOR_SOURCE=playwright_error`);
            console.log(`[ORCHESTRATOR] ✓ PRIORITY 1 - waiting-for locator pattern: ${failedSelector}`);
          }
        }

        // PRIORITY 2: params.selector in error object/text
        if (!failedSelector) {
          const paramsSelectorMatch = cleanedErrorText.match(/params\.selector\s*[=:]\s*['"]([^'"\n]+?)['"]/i);
          if (paramsSelectorMatch && paramsSelectorMatch[1] && isValidSelector(paramsSelectorMatch[1])) {
            failedSelector = paramsSelectorMatch[1].trim();
            console.log(`ACTUAL_FAILED_SELECTOR=${failedSelector}`);
            console.log(`FAILED_SELECTOR_SOURCE=params.selector`);
            console.log(`[ORCHESTRATOR] ✓ PRIORITY 2 - params.selector: ${failedSelector}`);
          }
        }

        // PRIORITY 3: step title or any locator('...') occurrences (conservative)
        if (!failedSelector) {
          const titleLocatorMatch = cleanedErrorText.match(/locator\s*\(\s*(["'`])([^\)]+?)\1\s*\)/i);
          if (titleLocatorMatch && titleLocatorMatch[2] && isValidSelector(titleLocatorMatch[2])) {
            failedSelector = titleLocatorMatch[2].trim();
            console.log(`ACTUAL_FAILED_SELECTOR=${failedSelector}`);
            console.log(`FAILED_SELECTOR_SOURCE=step_title_locator`);
            console.log(`[ORCHESTRATOR] ✓ PRIORITY 3 - step title locator: ${failedSelector}`);
          }
        }

        // PRIORITY 4: lastReachedLocator from execution - only as last resort
        if (!failedSelector) {
          const lastReached = (result as any).lastReachedLocator;
          if (lastReached && isValidSelector(lastReached)) {
            failedSelector = lastReached;
            console.log(`ACTUAL_FAILED_SELECTOR=${failedSelector}`);
            console.log(`FAILED_SELECTOR_SOURCE=execution_lastReachedLocator`);
            console.log(`[ORCHESTRATOR] ✓ PRIORITY 4 - execution lastReachedLocator (fallback): ${failedSelector}`);
          }
        }
        
        // CRITICAL: If no selector found, this is a non-locator failure - don't attempt healing
        if (!failedSelector) {
          console.log(`[ORCHESTRATOR] ❌ EXTRACTED_FAILED_LOCATOR: NOT FOUND`);
          console.log(`[ORCHESTRATOR] Reason: No locator info in execution output or error`);
          console.log(`[ORCHESTRATOR] Action: SKIP HEALING - not a locator failure`);
          console.log(`[ORCHESTRATOR] lastReachedLocator: ${(result as any).lastReachedLocator || 'N/A'}`);
          logger.warn(`No locator found - skipping healing`);
          return {
            ...result,
            healed: false,
            reused: false,
          };
        }
        
        console.log(`[ORCHESTRATOR] EXTRACTED_FAILED_LOCATOR: ${failedSelector}`);
        
        // Validate selector format
        if (!failedSelector || typeof failedSelector !== 'string' || failedSelector.length < 2) {
          logger.error('❌ Invalid selector format');
          console.error(`[ORCHESTRATOR] ❌ Selector validation failed: ${failedSelector}`);
          return createResult(result, healed, reused);
        }
        
        // FIX 6: Add detailed healing logs
        console.log(`[ORCHESTRATOR] ==========================================`);
        console.log(`[ORCHESTRATOR] HEALING PHASE INITIATED`);
        console.log(`[ORCHESTRATOR] FAILED SELECTOR: ${failedSelector}`);
        console.log(`[ORCHESTRATOR] HEALING_CANDIDATES: (pending LLM evaluation)`);
        console.log(`[ORCHESTRATOR] ==========================================`);
      } catch (readErr) {
        // FIX 5: Continue healing even if file read fails (not needed for selector extraction anymore)
        logger.debug(`Selector extraction note: ${readErr}`);
      }
      
      // Prepare error message
      const errorMessage = [
        result.stderr,
        result.stdout,
        (result.errors || []).join('\n')
      ].filter(e => e).join('\n');

      logger.info(`🏥 Step 2: Triggering heal_test tool...`);
      logger.info(`   - Test: ${testFile}`);
      logger.info(`   - Failed Selector: ${failedSelector}`);
      logger.info(`   - Target URL: ${targetUrl}`);
      
      console.log(`[ORCHESTRATOR] Calling heal_test with:`);
      console.log(`  - Failed Selector: ${failedSelector}`);
      console.log(`  - Target URL: ${targetUrl}`);

      // Diagnostic: surface the selector being used by the healing pipeline
      console.log(`[ORCHESTRATOR] HEALING_PIPELINE_SELECTOR: ${failedSelector}`);

      // Call heal_test tool (TASK 1: Pass correct failed selector)
      console.log(`[ORCHESTRATOR] ========== CALLING heal_test ==========`);
      console.log(`[ORCHESTRATOR] ORIGINAL_SELECTOR: ${failedSelector}`);
      console.log(`[ORCHESTRATOR] TARGET_URL: ${targetUrl}`);
      console.log(`[ORCHESTRATOR] ERROR_SUMMARY: ${errorMessage.substring(0, 150)}`);
      console.log(`[ORCHESTRATOR] ==========================================`);

      // FAST PATH attempt: try deterministic healing quickly (no MCP/LLM)
      const tHealStart = Date.now();
      let mcpTime = 0;
      let llmTime = 0;
      let retryTime = 0;
      let fastPathCandidate: { selector: string; confidence: number } | null = null;
      try {
        const simpleSelectorPattern = /^(?:\[[^=]+=['"][^'"]+['"]\]|#[\w\-]+|\.[\w\-\.]+)$/;
        if (failedSelector && simpleSelectorPattern.test(failedSelector)) {
          fastPathCandidate = await fastPathHeal(failedSelector, targetUrl || 'about:blank');
          if (fastPathCandidate) console.log(`[ORCHESTRATOR] FastPath candidate: ${fastPathCandidate.selector} (confidence=${fastPathCandidate.confidence})`);
          else console.log('[ORCHESTRATOR] FastPath: no candidate found');
        }
      } catch (e) {
        console.warn('[ORCHESTRATOR] FastPath error', e);
        fastPathCandidate = null;
      }

      // If fast path found a candidate, short-circuit without MCP/LLM
      let healData: any = null;
      if (fastPathCandidate && fastPathCandidate.selector) {
        healData = { fixed: true, newSelector: fastPathCandidate.selector, action: 'fast_path', confidence: fastPathCandidate.confidence };
        logger.info('[ORCHESTRATOR] FastPath success - skipping MCP/LLM');
      } else {
        const tMcpStart = Date.now();
        const healResult = await tools[2].func({
          testFile,
          errorMessage: errorMessage.substring(0, 500), // Limit error message
          failedSelector: failedSelector,
          targetUrl: targetUrl,
          errorObject: result, // Pass the full execution result object for deep extraction
        });
        const tMcpEnd = Date.now();
        mcpTime = tMcpEnd - tMcpStart;
        healData = JSON.parse(healResult as string);
        logger.info(`[Agent Decision] heal_test returned: ${JSON.stringify(healData)}`);
        console.log(`[ORCHESTRATOR] heal_test duration: ${mcpTime}ms`);
      }

      // TASK 1: Console logging for result handling
      console.log(`[ORCHESTRATOR] Heal Result:`, JSON.stringify(healData, null, 2));

      // TASK 4: If healing failed (not healable or MCP unavailable), stop and don't attempt retry
      if (!healData.fixed) {
        logger.warn(`❌ [Agent] Healing failed: ${healData.reason || 'unknown reason'}`);
        logger.info(`⏭️  [Agent] Skipping retry - healing unavailable`);
        console.log(`[ORCHESTRATOR] ⏭️  Healing skipped - reason: ${healData.reason}`);
        // FIX 6: Log failed selection
        console.log(`[ORCHESTRATOR] HEALING_FAILURE: No candidates found or MCP unavailable`);
        healed = false;
        // Metrics
        try {
          const tNow = Date.now();
          const total = tNow - tHealStart;
          console.log(`[ORCHESTRATOR] METRICS HEALING_TOTAL_MS=${total} MCP_TIME_MS=${mcpTime} LLM_TIME_MS=${llmTime} RETRY_TIME_MS=${retryTime}`);
        } catch (e) {
          /* ignore */
        }
        return createResult(result, healed, reused);
      }

      if (healData.fixed && healData.newSelector) {
        logger.success(`✅ [Agent] Healing generated fix (${healData.action || healData.reason})`);
        logger.info(`   Failed selector: ${failedSelector}`);
        logger.info(`   Healed selector: ${healData.newSelector}`);
        
        // FIX 6: Log healing candidate selection
        console.log(`[ORCHESTRATOR] ==========================================`);
        console.log(`[ORCHESTRATOR] HEALING CANDIDATES EVALUATED`);
        console.log(`[ORCHESTRATOR] SELECTED: ${healData.newSelector}`);
        console.log(`[ORCHESTRATOR] STRATEGY: ${healData.action || healData.reason}`);
        console.log(`[ORCHESTRATOR] ==========================================`);
        
        console.log(`[ORCHESTRATOR] ✅ Healing generated fix`);
        console.log(`[ORCHESTRATOR]   - Failed: ${failedSelector}`);
        console.log(`[ORCHESTRATOR]   - Healed: ${healData.newSelector}`);

        // Step 3: Retry test with healed selector/strategy
        logger.info(`🔄 Step 3: Retrying test with healed selector...`);
        
        // TASK 8: Log healed selector and retry execution
        console.log(`[HEALING] ==========================================`);
        console.log(`[HEALING] HEALED SELECTOR:`);
        console.log(`[HEALING] ${healData.newSelector}`);
        console.log(`[HEALING] ==========================================`);
        console.log(`[HEALING] RETRYING TEST...`);
        
        // FIX 6: Log retry execution
        console.log(`[ORCHESTRATOR] ==========================================`);
        console.log(`[ORCHESTRATOR] RETRY EXECUTED WITH HEALED SELECTOR`);
        console.log(`[ORCHESTRATOR] HEALING SELECTOR: ${healData.newSelector}`);
        console.log(`[ORCHESTRATOR] ==========================================`);
        
        const tRetryStart = Date.now();
        result = await executorService.executeTest(testFile, { 
          overrideSelector: healData.newSelector,
          failedLocator: failedSelector,  // Pass the actual failed locator
        });
        const tRetryEnd = Date.now();
        retryTime = tRetryEnd - tRetryStart;
        logger.info(`[Agent Decision] run_test (retry) returned: status=${result.status}`);
        
        console.log(`[ORCHESTRATOR] Retry result: ${result.status}`);

        // FIXED: Only mark as healed if RETRY PASSED
        if (result.status === "passed") {
          logger.success(`✅ [Agent] Test PASSED after healing and retry!`);
          logger.info(`   ✓ Healing validation: selector valid, retry executed, test passed`);
          console.log(`[ORCHESTRATOR] ✅ RETRY PASSED - Healing successful`);
          // FIX 6: Log passing result
          console.log(`[ORCHESTRATOR] ==========================================`);
          console.log(`[ORCHESTRATOR] HEALING COMPLETE - TEST PASSED`);
          console.log(`[ORCHESTRATOR] FAILED_SELECTOR: ${failedSelector}`);
          console.log(`[ORCHESTRATOR] HEALED_SELECTOR: ${healData.newSelector}`);
          console.log(`[ORCHESTRATOR] ==========================================`);
          healed = true;  // Only set to true here if retry actually passed
          
          // Populate healingDetails with failed and healed locators
          const healedResult: LangChainOrchestrationResult = {
            ...result,
            healed,
            reused,
            healingDetails: {
              originalSelector: failedSelector,
              newSelector: healData.newSelector,
              strategy: healData.action || 'automatic_healing',
            },
          };
          // Metrics logging
          try {
            const tNow = Date.now();
            const total = tNow - tHealStart;
            console.log(`[ORCHESTRATOR] METRICS HEALING_TOTAL_MS=${total} MCP_TIME_MS=${mcpTime} LLM_TIME_MS=${llmTime} RETRY_TIME_MS=${retryTime}`);
          } catch (e) {
            /* ignore */
          }
          return healedResult;
        } else {
          logger.warn(`⚠️ [Agent] Test still failing after healing attempt`);
          logger.warn(`   Healing was attempted but retry did not pass`);
          console.warn(`[ORCHESTRATOR] ⚠️  Retry failed after healing - healing did not help`);
          healed = false;  // Healing failed because retry did not pass
            // Metrics logging for failed retry
            try {
              const tNow = Date.now();
              const total = tNow - tHealStart;
              console.log(`[ORCHESTRATOR] METRICS HEALING_TOTAL_MS=${total} MCP_TIME_MS=${mcpTime} LLM_TIME_MS=${llmTime} RETRY_TIME_MS=${retryTime}`);
            } catch (e) { /* ignore */ }
            return createResult(result, healed, reused);
        }
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
