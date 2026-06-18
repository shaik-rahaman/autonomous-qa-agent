import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export const PLAYWRIGHT_NOT_INSTALLED = 'PLAYWRIGHT_NOT_INSTALLED';
export const PLAYWRIGHT_ENVIRONMENT_ERROR = 'PLAYWRIGHT_ENVIRONMENT_ERROR';

export interface PlaywrightValidationResult {
  ok: boolean;
  cliFound: boolean;
  packageFound: boolean;
  nodeModulesFound: boolean;
  playwrightPackagePath?: string | null;
  playwrightCliPath?: string | null;
  nodeModulesPath: string;
  versions: Record<string, string | null>;
  error?: string | null;
}

function safeRequireResolve(moduleName: string, cwd: string): string | null {
  try {
    return require.resolve(moduleName, { paths: [cwd] });
  } catch (e) {
    return null;
  }
}

function runNpmLs(dir: string): string | null {
  try {
    const out = execSync('npm ls @playwright/test --depth=0 --json', { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    const obj = JSON.parse(out || '{}');
    if (obj && obj.dependencies && obj.dependencies['@playwright/test'] && obj.dependencies['@playwright/test'].version) {
      return obj.dependencies['@playwright/test'].version;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function validatePlaywrightEnvironment(executionRoot: string, repoRoot?: string): PlaywrightValidationResult {
  const nodeModulesPath = path.join(executionRoot, 'node_modules');
  const nodeModulesFound = fs.existsSync(nodeModulesPath);

  // Diagnostics for debugging resolution problems
  console.log('VALIDATOR executionRoot:', executionRoot);
  console.log('VALIDATOR nodeModules:', nodeModulesPath);

  // Try to resolve @playwright/test from the execution root
  let resolvedPackage: string | null = null;
  try {
    resolvedPackage = safeRequireResolve('@playwright/test', path.join(executionRoot));
  } catch (e) {
    resolvedPackage = null;
  }

  // Fallback: If require.resolve fails, check the expected filesystem layout for @playwright/test
  try {
    const fallbackPath = path.join(executionRoot, 'node_modules', '@playwright', 'test', 'index.js');
    if (!resolvedPackage && fs.existsSync(fallbackPath)) {
      resolvedPackage = fallbackPath;
    }
  } catch (e) {
    // ignore
  }

  // Common CLI locations
  const binPlaywright = path.join(executionRoot, 'node_modules', '.bin', 'playwright');
  const pkgCli = path.join(executionRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  const cliExists = fs.existsSync(binPlaywright) || fs.existsSync(pkgCli);
  const cliPath = fs.existsSync(binPlaywright) ? binPlaywright : (fs.existsSync(pkgCli) ? pkgCli : null);

  // Check for playwright.config (ts/js/cjs/mjs)
  const configCandidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.cjs', 'playwright.config.mjs'];
  const configExists = configCandidates.some(c => fs.existsSync(path.join(executionRoot, c)));

  // Collect versions across repoRoot, backend, pw-ai-agents if repoRoot provided
  const versions: Record<string, string | null> = {};
  const rootsToCheck: Array<{ name: string; dir: string }> = [];
  if (repoRoot) {
    rootsToCheck.push({ name: 'root', dir: repoRoot });
    rootsToCheck.push({ name: 'backend', dir: path.join(repoRoot, 'backend') });
    rootsToCheck.push({ name: 'pw-ai-agents', dir: path.join(repoRoot, 'pw-ai-agents') });
  } else {
    rootsToCheck.push({ name: 'executionRoot', dir: executionRoot });
  }

  for (const r of rootsToCheck) {
    try {
      versions[r.name] = runNpmLs(r.dir);
    } catch (e) {
      versions[r.name] = null;
    }
  }

  // Determine if multiple versions exist
  const uniqueVersions = new Set(Object.values(versions).filter(v => !!v));

  const packageFound = !!resolvedPackage;

  const ok = packageFound && cliExists && nodeModulesFound;

  const result: PlaywrightValidationResult = {
    ok,
    cliFound: !!cliExists,
    packageFound,
    nodeModulesFound,
    playwrightPackagePath: resolvedPackage ? path.dirname(resolvedPackage) : null,
    playwrightCliPath: cliPath || null,
    nodeModulesPath,
    versions,
    error: null,
  };

  // Extra diagnostic logging
  console.log('VALIDATOR resolvedPackage:', resolvedPackage);
  console.log('VALIDATOR cliPath:', cliPath);
  console.log('VALIDATOR configExists:', configExists);

  if (!packageFound) {
    result.error = PLAYWRIGHT_NOT_INSTALLED;
    result.ok = false;
  }
  if (uniqueVersions.size > 1) {
    result.error = 'MULTIPLE_VERSIONS_DETECTED';
    result.ok = false;
  }

  return result;
}

export default validatePlaywrightEnvironment;
