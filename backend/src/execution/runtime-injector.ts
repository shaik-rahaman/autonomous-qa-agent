/**
 * Runtime Injector
 * This module is intended to be required via NODE_OPTIONS in child Node processes.
 * It reads the environment variable `PW_OVERRIDE_MAP` (JSON) which maps relative
 * test paths to selector overrides. When a test file is read by Playwright's
 * test loader, this script intercepts `fs.readFileSync` / `fs.readFile` calls
 * and replaces the first occurrence of `getByRole(...)` with the provided
 * override for that test path.
 */
import fs from 'fs';
import path from 'path';

try {
  const raw = process.env.PW_OVERRIDE_MAP || '';
  if (!raw) {
    // Nothing to do
  } else {
    const overrideMap = JSON.parse(raw);

    const originalReadFileSync = fs.readFileSync.bind(fs);
    // Patch readFileSync
    (fs as any).readFileSync = function patchedReadFileSync(p: fs.PathOrFileDescriptor, options?: any) {
      try {
        const fullPath = typeof p === 'string' ? p : String(p);
        // Determine relative path key by normalizing path separators
        const rel = path.relative(process.cwd(), fullPath).split(path.sep).join('/');
        // Try direct match first, then suffix match
        let overrideSelector: string | undefined = overrideMap[rel];
        if (!overrideSelector) {
          // Try match by file name only
          const filename = path.basename(rel);
          overrideSelector = overrideMap[filename];
        }

        const rawContent = originalReadFileSync(p, options as any) as any;
        const content = typeof rawContent === 'string' ? rawContent : String(rawContent);
        if (overrideSelector) {
          const match = content.match(/getByRole\([^)]*\)/);
          if (match) {
            const patched = content.replace(match[0], overrideSelector);
            return patched;
          }
        }
        return rawContent;
      } catch (err) {
        return originalReadFileSync(p, options as any);
      }
    };

    // Patch async readFile
    const originalReadFile = fs.readFile.bind(fs);
    (fs as any).readFile = function patchedReadFile(p: fs.PathOrFileDescriptor, options: any, cb: any) {
      if (typeof options === 'function') {
        cb = options;
        options = undefined;
      }
      originalReadFile(p, options, function (err: any, data: any) {
        if (err) return cb(err, data);
        try {
          const fullPath = typeof p === 'string' ? p : String(p);
          const rel = path.relative(process.cwd(), fullPath).split(path.sep).join('/');
          let overrideSelector: string | undefined = overrideMap[rel];
          if (!overrideSelector) {
            const filename = path.basename(rel);
            overrideSelector = overrideMap[filename];
          }
          if (overrideSelector && Buffer.isBuffer(data)) {
            const content = data.toString('utf-8');
            const match = content.match(/getByRole\([^)]*\)/);
            if (match) {
              const patched = content.replace(match[0], overrideSelector);
              return cb(null, Buffer.from(patched, 'utf-8'));
            }
          }
        } catch (e) {
          // ignore and return original data
        }
        return cb(null, data);
      });
    };
  }
} catch (e) {
  // If anything goes wrong, fail silently so child process can continue
}

export {};
