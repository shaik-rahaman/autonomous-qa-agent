/**
 * Repository Path Utilities (pw-ai-agents local copy)
 * Resolves canonical paths for generated tests
 */

import path from 'path';
import fs from 'fs';

/**
 * Find repository root by walking up directory tree
 * Returns the directory containing both 'backend' and 'pw-ai-agents' folders
 */
export function resolveRepoRootFrom(callerDir: string): string {
  let dir = path.resolve(callerDir);
  const root = path.parse(dir).root;
  let firstFound: string | null = null;

  while (true) {
    try {
      if (fs.existsSync(path.join(dir, 'pw-ai-agents'))) {
        // Record first found, but keep walking up to prefer highest-level repo
        if (!firstFound) firstFound = dir;
      }
      // Prefer directory that looks like monorepo root: contains both 'backend' and 'pw-ai-agents'
      if (fs.existsSync(path.join(dir, 'pw-ai-agents')) && 
          fs.existsSync(path.join(dir, 'backend'))) {
        return dir;
      }
    } catch (e) {
      // ignore
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }

  if (firstFound) return firstFound;
  // Fallback to current working directory
  return process.cwd();
}

/**
 * Resolve canonical path for generated test files
 * Returns: <repoRoot>/pw-ai-agents/tests/ui/generated
 */
export function resolvePwAiAgentsGeneratedDir(callerDir: string): string {
  const repoRoot = resolveRepoRootFrom(callerDir);
  return path.join(repoRoot, 'pw-ai-agents', 'tests', 'ui', 'generated');
}
