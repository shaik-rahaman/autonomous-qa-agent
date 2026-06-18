import path from 'path';
import fs from 'fs';

/**
 * Resolve the repository root and canonical pw-ai-agents generated tests directory.
 * Uses the caller directory to reliably compute the repo root even when the process
 * was started from inside `backend` or any other subfolder.
 */
export function resolveRepoRootFrom(callerDir: string = __dirname): string {
  // If this file is inside backend/src, repo root is three levels up
  try {
    const normalized = path.resolve(callerDir);
    if (normalized.includes(path.join('backend', 'src'))) {
      return path.resolve(callerDir, '..', '..', '..');
    }

    // Otherwise, walk up until we find both 'backend' and 'pw-ai-agents' siblings
    let dir = normalized;
    const root = path.parse(dir).root;
    while (true) {
      try {
        if (fs.existsSync(path.join(dir, 'pw-ai-agents')) && fs.existsSync(path.join(dir, 'backend'))) {
          return dir;
        }
      } catch (e) {
        // ignore
      }
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  } catch (e) {
    // ignore and fallback
  }

  // Fallback to process.cwd()
  return process.cwd();
}

export function resolvePwAiAgentsGeneratedDir(callerDir: string = __dirname): string {
  const repoRoot = resolveRepoRootFrom(callerDir);
  return path.join(repoRoot, 'pw-ai-agents', 'tests', 'ui', 'generated');
}
