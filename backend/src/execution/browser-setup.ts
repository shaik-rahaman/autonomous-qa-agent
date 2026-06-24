/**
 * Browser Setup Service
 * Initializes Playwright browsers once at server startup
 * Avoids 120-second installation check on every test execution
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

let browserInitialized = false;
let initializationInProgress = false;

/**
 * Initialize Playwright browsers at server startup
 * Returns immediately if already initialized
 */
export async function initializePlaywrightBrowsers(): Promise<void> {
  // Return early if already initialized
  if (browserInitialized) {
    logger.info('✓ Playwright browsers already initialized');
    return;
  }

  // Return early if initialization is in progress (avoid duplicate work)
  if (initializationInProgress) {
    logger.info('⏳ Browser initialization already in progress, waiting...');
    // Wait for in-progress initialization
    while (initializationInProgress) {
      await new Promise(r => setTimeout(r, 100));
    }
    return;
  }

  initializationInProgress = true;
  const startTime = Date.now();

  try {
    // Discover pw-ai-agents directory from repo root
    const repoRoot = path.resolve(__dirname, '../../..');
    const pwAiAgentsDir = path.join(repoRoot, 'pw-ai-agents');

    logger.info(`🔧 Browser Initialization: Starting...`);
    logger.info(`   Repository Root: ${repoRoot}`);
    logger.info(`   PW-AI-Agents Dir: ${pwAiAgentsDir}`);

    // Verify directory exists
    if (!fs.existsSync(pwAiAgentsDir)) {
      logger.warn(`⚠️ Browser Init: pw-ai-agents directory not found at ${pwAiAgentsDir}`);
      initializationInProgress = false;
      return;
    }

    // Find Playwright CLI
    const localPlaywrightCli = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');

    if (!fs.existsSync(localPlaywrightCli)) {
      logger.warn(`⚠️ Browser Init: Playwright CLI not found at ${localPlaywrightCli}`);
      logger.warn(`   Make sure to run: npm install in pw-ai-agents/`);
      initializationInProgress = false;
      return;
    }

    // Step 1: Check if browsers are already installed (fast - 100-200ms)
    logger.info(`🔍 Browser Init: Checking for existing installation...`);
    const checkStartTime = Date.now();

    try {
      execSync(`${process.execPath} "${localPlaywrightCli}" install --check`, {
        cwd: pwAiAgentsDir,
        timeout: 5000,
        stdio: 'pipe', // Suppress output
      });

      const checkTime = Date.now() - checkStartTime;
      logger.success(`✅ Browser Init: Browsers already installed (checked in ${checkTime}ms)`);
      browserInitialized = true;
      initializationInProgress = false;
      return;
    } catch (checkErr) {
      // Not installed, proceed with full installation
      logger.info(`📦 Browser Init: Browsers not installed, proceeding with installation...`);
    }

    // Step 2: Full browser installation (can take 30-120 seconds)
    logger.info(`⏳ Browser Init: Installing Playwright browsers (this may take 30-120 seconds)...`);
    const installStartTime = Date.now();

    try {
      execSync(`${process.execPath} "${localPlaywrightCli}" install --with-deps`, {
        cwd: pwAiAgentsDir,
        timeout: 180000, // 3 minutes max
        stdio: 'pipe', // Suppress output during setup
      });

      const installTime = Date.now() - installStartTime;
      logger.success(`✅ Browser Init: Playwright browsers installed in ${installTime}ms`);
      browserInitialized = true;
    } catch (installErr) {
      logger.error(`❌ Browser Init: Installation failed`, installErr);
      logger.warn(`⚠️ Browser Init: Browsers not available at startup, will retry on first test execution`);
      // Don't set browserInitialized = true; let executor retry
    }
  } catch (err) {
    logger.error(`❌ Browser Init: Unexpected error during initialization`, err);
    logger.warn(`⚠️ Browser Init: Falling back to on-demand installation`);
  } finally {
    initializationInProgress = false;
    const totalTime = Date.now() - startTime;
    logger.info(`🔧 Browser Init: Completed in ${totalTime}ms`);
  }
}

/**
 * Get current browser initialization status
 */
export function getBrowserStatus(): {
  initialized: boolean;
  inProgress: boolean;
} {
  return {
    initialized: browserInitialized,
    inProgress: initializationInProgress,
  };
}

/**
 * Reset browser status (for testing purposes)
 */
export function resetBrowserStatus(): void {
  browserInitialized = false;
  initializationInProgress = false;
  logger.info('🔄 Browser status reset');
}
