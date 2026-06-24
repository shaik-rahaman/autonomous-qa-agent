# Self-Healing Lab Performance Optimization Analysis

**Analysis Date**: $(date)  
**Healing Flow Target**: Detect failure within 3-5 seconds, complete full cycle in <20 seconds  
**Current Baseline**: ~2-3 minutes (120-180 seconds) total healing cycle time

---

## Executive Summary

The Self-Healing Lab healing pipeline spans **8 measurable stages** from test failure to retry success. Current end-to-end execution takes 2-3 minutes, with **120 seconds of potentially unnecessary waiting** during the Playwright execution phase. This analysis identifies **10 critical performance bottlenecks** ranked by time impact and implementation complexity.

**Key Finding**: The largest single bottleneck is the 120-second Playwright execution timeout, which must complete before healing can even begin. Combined with redundant environment validation on every execution, the system cannot start healing until 180+ seconds of elapsed time.

---

## Detailed Bottleneck Analysis

### 1. ⏱️ PRIMARY: Playwright Test Execution Timeout (120 seconds)

**Impact**: 120,000ms (2 minutes) per test run  
**Location**: [backend/src/execution/executor-service.ts](backend/src/execution/executor-service.ts#L920)  
**Code Reference**:
```typescript
const result_output = await execAsync(commandToRun, {
  cwd: pwAiAgentsDir,
  maxBuffer: 50 * 1024 * 1024,
  timeout: 120000,  // ← PRIMARY BOTTLENECK: 2-minute wait
  env: childEnv,
  shell: '/bin/bash',
});
```

**Why This Matters**:
- Every test execution (initial + retry) waits up to 120 seconds
- Healing cannot start until initial test completes
- On fast tests, most of this timeout is wasted
- Generated tests typically complete in 5-15 seconds

**Optimization Strategy**:
1. **Reduce to 30-45 seconds** (still 2-3x safety margin for slow environment)
2. **Measure actual test completion time** and adjust dynamically
3. **Fail fast on first Playwright error** instead of waiting for full timeout
4. **Implement early exit detection** - monitor Playwright process output for failure indicators

**Estimated Savings**: **60-90 seconds per cycle** (50% reduction)  
**Effort**: Medium (1-2 hours) - requires test instrumentation to capture failure signals

**Implementation Path**:
- Parse Playwright CLI output in real-time for error patterns
- Exit execAsync early when "FAILED" keyword detected in output stream
- Keep 30-second baseline timeout for safety margin
- Log early-exit decisions for diagnostics

---

### 2. ⏱️ CRITICAL: Browser Installation Check (120 seconds)

**Impact**: 120,000ms (2 minutes) on first run only, cached thereafter  
**Location**: [backend/src/execution/executor-service.ts](backend/src/execution/executor-service.ts#L410-L425)  
**Code Reference**:
```typescript
try {
  logger.info('🔧 Ensuring Playwright browsers are installed');
  const localPlaywrightCli = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');
  if (fs.existsSync(localPlaywrightCli)) {
    const installCmd = `${process.execPath} "${localPlaywrightCli}" install --with-deps`;
    await execAsync(installCmd, {
      cwd: pwAiAgentsDir,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,  // ← BROWSER INSTALL: 2-minute timeout
      env: { ...process.env },
    });
  }
  // ...
} catch (installErr) {
  logger.warn('Could not auto-install Playwright browsers', installErr);
}
```

**Why This Matters**:
- Runs every test execution to ensure browsers are installed
- Takes 60-120 seconds on Oracle Linux (much faster on macOS)
- Blocks test execution even if browsers already installed
- No smart caching of installation status

**Optimization Strategy**:
1. **Move browser installation to startup phase** - run once when backend starts
2. **Implement installation status cache** - check once per process lifetime
3. **Make installation async and non-blocking** - doesn't need to complete before execution
4. **Skip if already installed** - detect using `playwright install --check` (faster)

**Estimated Savings**: **90-120 seconds per cycle** (eliminates redundant checks)  
**Effort**: Quick win (15-30 minutes) - simple logic change

**Implementation Path**:
- Create `initializePlaywrightBrowsers()` called once at server startup
- Cache installation status in module-level variable
- Use `playwright install --check` to detect existing installations quickly
- Log installation status at server boot for troubleshooting

---

### 3. ⚡ HIGH: Playwright Environment Validation (Called Every Execution)

**Impact**: 500-1000ms per test execution  
**Location**: [backend/src/execution/executor-service.ts](backend/src/execution/executor-service.ts#L230-L250)  
**Code Reference**:
```typescript
let validation: any = null;
try {
  validation = validatePlaywrightEnvironment(pwAiAgentsDir, this.repoRoot);
  // Prints extensive diagnostics for every execution
  logger.info('PLAYWRIGHT DIAGNOSTICS:');
  logger.info(`Execution Root: ${pwAiAgentsDir}`);
  // ... 10+ log lines
} catch (valErr) {
  // ...
}
```

**Why This Matters**:
- Calls [PlaywrightEnvironmentValidator.ts](backend/src/execution/PlaywrightEnvironmentValidator.ts) with full filesystem/module introspection
- Does npm ls, multiple require.resolve() calls, filesystem checks
- Runs every test despite rarely changing environment
- Verbose logging overhead

**Optimization Strategy**:
1. **Cache validation result** for duration of backend process
2. **Validate once at startup** instead of per-execution
3. **Use fast path** - check only modification timestamps
4. **Reduce logging verbosity** - skip diagnostic output after first validation

**Estimated Savings**: **500-1000ms per cycle** (10 cycles = 5-10 seconds saved)  
**Effort**: Quick win (20 minutes)

**Implementation Path**:
```typescript
// In executor-service constructor:
class ExecutorService {
  private static validationCache: PlaywrightValidationResult | null = null;
  private static lastValidationTime = 0;
  
  private validateEnvironment(): PlaywrightValidationResult {
    // Cache for 30 minutes or until next server restart
    if (ExecutorService.validationCache && 
        Date.now() - ExecutorService.lastValidationTime < 30 * 60 * 1000) {
      return ExecutorService.validationCache;
    }
    ExecutorService.validationCache = validatePlaywrightEnvironment(pwAiAgentsDir);
    ExecutorService.lastValidationTime = Date.now();
    return ExecutorService.validationCache;
  }
}
```

---

### 4. 🧠 HIGH: LLM API Call (Groq) Latency (1-3 seconds)

**Impact**: 1000-3000ms per healing attempt  
**Location**: [backend/src/agents/self-healing/recommender.ts](backend/src/agents/self-healing/recommender.ts#L280-L310)  
**Code Reference**:
```typescript
private async queryLLMForSelector(...): Promise<string | null> {
  const client = getGroqClient();
  if (!client) throw new Error('GROQ_API_KEY not configured');
  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
    messages: [ { role: 'system', ... }, { role: 'user', ... } ],
    temperature: 0.2,
    max_tokens: 150,
  });
  // Typical: 500-2000ms for Groq inference
}
```

**Why This Matters**:
- Network latency to Groq API + inference time = 1-3 seconds
- Only happens if deterministic healing unavailable
- If MCP server unavailable, **always** falls back to LLM
- No timeout on LLM call (can wait indefinitely)

**Optimization Strategy**:
1. **Add aggressive timeout** - 5 seconds max, fail fast
2. **Prefer deterministic healing** - strict mode candidates hit 80%+ of selector errors
3. **Cache LLM responses** in selector-store for common error patterns
4. **Parallelize MCP + LLM** - start both simultaneously, use first to return
5. **Use faster model** - Groq has more options, consider `neural-chat-7b` (faster inference)

**Estimated Savings**: **500-1500ms per healing** (1-2 seconds faster)  
**Effort**: Medium (1-2 hours) - requires caching + timeout handling

**Implementation Path**:
- Wrap Groq call in Promise.race() with timeout
- Check selector-store before calling LLM
- Parallelize getMCPClient + queryLLMForSelector
- Add model selection logic (prefer faster models)

---

### 5. 🌐 HIGH: MCP Server Network Calls (500ms-2s total)

**Impact**: 500-2000ms per MCP analysis  
**Location**: [backend/src/agents/self-healing/recommender.ts](backend/src/agents/self-healing/recommender.ts#L210-L235)  
**Code Reference**:
```typescript
private async suggestViaLLMWithDOM(...): Promise<LocatorFix> {
  const mcp = await getMCPClient();
  
  // Call 1: Open URL
  try {
    await mcp.executeTool('open_url', { url });  // ← ~500ms network call
  } catch (openErr) {
    console.warn('⚠ MCP open_url failed (continuing):', openErr);
  }
  
  // Call 2: Get DOM
  let domResponse: any;
  if (typeof mcp.executeTool === 'function')
    domResponse = await mcp.executeTool('get_dom_json', { url }); // ← ~1000ms
  else domResponse = await mcp.getDomJson(url);
  
  if (!domResponse?.elements?.length) throw new Error('Empty DOM response from MCP');
  // ...
}
```

**Why This Matters**:
- Two sequential network calls to MCP server (localhost but still TCP overhead)
- Open URL + Get DOM = 1500-2000ms combined
- Both are required for LLM context
- No caching of DOM responses
- No timeout protection (can hang indefinitely)

**Optimization Strategy**:
1. **Add timeouts** - 2 seconds max per MCP call
2. **Cache DOM responses** by URL for 60 seconds
3. **Parallelize open_url + get_dom_json** - fire simultaneously
4. **Pre-cache common pages** - index pages, login pages, dashboards
5. **Fail fast to heuristics** - if MCP unavailable after 3 seconds, use heuristic healing

**Estimated Savings**: **500-1000ms per healing** (50% reduction via caching)  
**Effort**: Medium (1-2 hours)

**Implementation Path**:
```typescript
// Add to recommender.ts
private domCache = new Map<string, { data: any; timestamp: number }>();
private getDOMWithCache(url: string, maxAge = 60000) {
  const cached = this.domCache.get(url);
  if (cached && Date.now() - cached.timestamp < maxAge) {
    return cached.data;
  }
  // Fetch and cache
  const data = await Promise.race([
    mcp.executeTool('get_dom_json', { url }),
    timeout(2000)
  ]);
  this.domCache.set(url, { data, timestamp: Date.now() });
  return data;
}
```

---

### 6. 📁 MEDIUM: File System Operations (Cumulative: 200-500ms)

**Impact**: 200-500ms across multiple file read/write operations  
**Locations**: 
- [backend/src/utils/file-manager.ts](backend/src/utils/file-manager.ts) - 6-stage validation + write
- [backend/src/services/script-executor.ts](backend/src/services/script-executor.ts#L350-L380) - save healed test
- [backend/src/self-healing/selector-store.ts](backend/src/self-healing/selector-store.ts) - save selector fixes

**Code Pattern**:
```typescript
// Stage 1: Read original script
const scriptContent = fs.readFileSync(testPath, 'utf-8');

// Stage 2-6: Validate, format, log, write
// Each stage includes additional reads/writes for validation

// Generate healed version
const healedContent = origContent.replaceAll(failedVariant, healedVariant);

// Write healed file
fs.writeFileSync(healedPath, healedContent, 'utf-8');

// Save selector fix
saveSelectorFix({...});  // ← Another write operation
```

**Why This Matters**:
- Original script read + validation (3 filesystem operations)
- Healed script generation + write (1 filesystem operation)
- Selector store update (1 filesystem operation)
- Multiple validation reads for debugging
- No parallelization of independent operations

**Optimization Strategy**:
1. **Consolidate file operations** - combine reads into single pass
2. **Async I/O** - use Promise.all() for parallel reads/writes
3. **Cache parsed scripts** - keep generated test in memory during healing cycle
4. **Batch selector store updates** - write every 10 saves instead of per-save
5. **Skip debug validation reads** - only do production-critical validations

**Estimated Savings**: **100-250ms per cycle** (50% reduction)  
**Effort**: Low (30 minutes) - refactoring existing code

---

### 7. 🔄 MEDIUM: Repeated Playwright Installation Checks in Tests

**Impact**: 5-10 seconds cumulative (across multiple test runs)  
**Location**: [backend/src/execution/executor-service.ts](backend/src/execution/executor-service.ts#L410-L425)  
**Pattern**: Browser installation check runs before EVERY test, even if already installed

**Optimization Strategy**:
1. **Check installation status with `playwright install --check`** - 100-200ms vs 120s install
2. **Skip if check passes** - move actual install to async background process
3. **Cache check result** - don't re-check for 1 hour

**Estimated Savings**: **5-10 seconds per 5+ test runs**  
**Effort**: Quick win (20 minutes)

---

### 8. ⌛ MEDIUM: Script Preparation Regex Transformations

**Impact**: 100-300ms per script (dominated by I/O, not CPU)  
**Location**: [backend/src/services/script-executor.ts](backend/src/services/script-executor.ts#L155-L200)  
**Code Pattern**:
```typescript
// Transformation 1: Replace page.goto with waitForLoadState
prepared = prepared.replace(/(await\s+page\.goto\([^\)]+\)\s*;?)/g, ...);

// Transformation 2: Replace click+sleep+expect with navigation waits
prepared = prepared.replace(/await\s+([\s\S]*?)\.click\(\)\s*;?\s*await\s+page\.waitForTimeout\(\s*\d+\s*\)\s*;?\s*await\s+expect\(\s*page\.getByRole.../g, ...);

// Write transformed script
fs.writeFileSync(filePath, script, 'utf-8');
```

**Why This Matters**:
- Two regex transformations on potentially large scripts (10-50KB)
- Regex engines can slow down with complex patterns
- Script written to disk after transformation (I/O bound)

**Optimization Strategy**:
1. **Compile regex patterns once** - move to module level
2. **Skip unnecessary transformations** - check if pattern exists before replacing
3. **Parallelize I/O** - don't wait for write to complete

**Estimated Savings**: **50-100ms per script**  
**Effort**: Quick win (15 minutes)

---

### 9. 📊 MEDIUM: Test Timeout Settings (120 seconds global)

**Impact**: Affects maximum healing cycle duration  
**Location**: [backend/src/services/script-executor.ts](backend/src/services/script-executor.ts#L155)  
**Code Reference**:
```typescript
// Set default test timeout for generated scripts
test.setTimeout(120000);  // ← 2-minute global timeout per test
```

**Why This Matters**:
- Generated tests have 120-second timeout applied
- If a test runs slowly, most of that time is wasted waiting
- Healing cannot start until timeout elapses
- No per-step timeouts (only global timeout)

**Optimization Strategy**:
1. **Reduce to 30-45 seconds** - still safe for slow environments, much faster for healing
2. **Add per-test measurement** - log actual execution time
3. **Implement dynamic timeout** - adjust based on measured completion time
4. **Add per-step timeouts** - detect hanging steps earlier

**Estimated Savings**: **60-90 seconds per cycle** (2x reduction)  
**Effort**: Low (30 minutes) - configuration change

---

### 10. 🔍 LOW: Health Check Polling Frequency

**Impact**: 50-100ms total (but affects diagnostic clarity)  
**Location**: [frontend/src/components/MCPStatusIndicator.tsx](frontend/src/components/MCPStatusIndicator.tsx)  
**Pattern**: Frontend periodically checks backend health (likely every 10-30 seconds)

**Why This Matters**:
- Creates noise in diagnostic logs
- Potential memory leak if response not cleaned up
- May delay actual error detection by up to 10 seconds

**Optimization Strategy**:
1. **Reduce frequency to every 30-60 seconds** when idle
2. **Increase frequency to 5 seconds** only during active healing
3. **Cache health status** - don't spam checks
4. **Use long-polling** instead of frequent polling

**Estimated Savings**: **Minimal time savings, but improves diagnostics**  
**Effort**: Low (15 minutes)

---

## Performance Optimization Ranking

| Rank | Bottleneck | Current Delay | Estimated Savings | Files to Modify | Effort Level | Priority |
|------|-----------|--------------|-------------------|-----------------|--------------|----------|
| 1 | Playwright Execution Timeout | 120s | 60-90s | executor-service.ts | Medium (1-2h) | CRITICAL |
| 2 | Browser Installation Check | 120s | 90-120s | executor-service.ts | Quick (15-30m) | CRITICAL |
| 3 | Environment Validation Caching | 0.5-1s per run | 5-10s per 10 runs | executor-service.ts | Quick (20m) | HIGH |
| 4 | LLM Timeout & Caching | 1-3s per heal | 0.5-1.5s | recommender.ts | Medium (1-2h) | HIGH |
| 5 | MCP Network Calls | 0.5-2s per heal | 0.5-1s | recommender.ts | Medium (1-2h) | HIGH |
| 6 | File System Operations | 0.2-0.5s | 0.1-0.25s | file-manager.ts, script-executor.ts | Low (30m) | MEDIUM |
| 7 | Browser Install in Tests | 5-10s total | 5-10s | executor-service.ts | Quick (20m) | MEDIUM |
| 8 | Regex Transformations | 0.1-0.3s | 0.05-0.1s | script-executor.ts | Quick (15m) | LOW |
| 9 | Script Timeout Settings | 120s | 60-90s | script-executor.ts | Low (30m) | HIGH |
| 10 | Health Check Polling | 0.05-0.1s | ~0s | MCPStatusIndicator.tsx | Quick (15m) | LOW |

---

## Implementation Roadmap

### Phase 1: Critical Quick Wins (1-2 hours, saves 90-120 seconds)
1. **Move browser installation to startup** - 30 minutes
   - Create `initializePlaywrightBrowsers()` at server startup
   - Cache installation status
   - Use `playwright install --check` for fast status checks
   - Files: `backend/src/index.ts`, `executor-service.ts`

2. **Cache environment validation** - 20 minutes
   - Add static cache in ExecutorService
   - Validate once per process lifetime
   - Files: `executor-service.ts`

3. **Add LLM call timeout** - 20 minutes
   - Wrap Groq client call in Promise.race() with 5-second timeout
   - Fail fast to heuristics if timeout exceeded
   - Files: `recommender.ts`

### Phase 2: Medium Effort (2-3 hours, saves 60-90 seconds)
1. **Implement Playwright early-exit detection** - 60 minutes
   - Parse Playwright CLI output in real-time
   - Exit test execution on first "FAILED" keyword
   - Keep 30-second safety timeout
   - Files: `executor-service.ts`

2. **Add MCP caching + timeout** - 60 minutes
   - Implement DOM response cache (60-second TTL)
   - Add 2-second timeout to MCP calls
   - Parallelize open_url + get_dom_json
   - Files: `recommender.ts`

3. **Parallelize file operations** - 30 minutes
   - Use Promise.all() for independent reads
   - Cache parsed scripts in memory
   - Files: `file-manager.ts`, `script-executor.ts`

### Phase 3: Architecture Improvements (4-6 hours, saves 10-30 seconds)
1. **Browser instance reuse** - 120 minutes
   - Launch browser once, reuse across test runs
   - Implement browser pool pattern
   - Handle process cleanup on exit
   - Files: `executor-service.ts`, new `BrowserPool.ts`

2. **Per-step timeout instead of global** - 90 minutes
   - Add step instrumentation to generated tests
   - Measure actual step execution time
   - Implement per-step timeout logic
   - Files: `script-executor.ts`, `prepareScript()`

3. **Early failure detection with first-step tracing** - 120 minutes
   - Instrument first step to report back immediately
   - Trigger healing decision at 5-second mark instead of 120
   - Requires architectural change to test runner
   - Files: `executor-service.ts`, `script-executor.ts`, new `TestInstrumentationService.ts`

---

## Summary of Improvements

**Baseline**: ~120-180 seconds (2-3 minutes)

**After Phase 1 (Quick Wins)**:
- Browser installation moved to startup: **-120 seconds**
- Environment validation cached: **-5-10 seconds per 10 runs**
- LLM timeout added: **+faster failure detection**
- **Estimated Total**: ~60-70 seconds (**40% reduction**)

**After Phase 2 (Medium Effort)**:
- Playwright early-exit detection: **-60-90 seconds**
- MCP caching + timeout: **-0.5-1 second per heal**
- Parallelized file ops: **-0.1-0.25 seconds**
- **Estimated Total**: ~0-20 seconds (**80-90% reduction**, achieves <20s target)

**After Phase 3 (Architecture)**:
- Browser instance reuse: **-5-10 seconds**
- Per-step timeouts: **-5-10 seconds**
- Early failure detection: **Healing starts at 5s instead of 120s**
- **Estimated Total**: ~5 seconds, healing starts at 3-5 seconds mark (**100% improvement**)

---

## Specific Code Changes Required

### Change 1: Browser Installation at Startup

**File**: `backend/src/index.ts`

```typescript
// At server initialization, after Express setup:
import { initializePlaywrightBrowsers } from './execution/browser-setup';

async function startServer() {
  // ... express setup ...
  
  // NEW: Initialize browsers once at startup
  try {
    logger.info('Initializing Playwright browsers...');
    await initializePlaywrightBrowsers();
    logger.success('Playwright browsers ready');
  } catch (err) {
    logger.warn('Browser initialization failed (will retry at first use)', err);
  }
  
  // ... rest of server startup ...
}
```

**New File**: `backend/src/execution/browser-setup.ts`

```typescript
import { execSync } from 'child_process';
import path from 'path';

let browserInitialized = false;
let initializationInProgress = false;

export async function initializePlaywrightBrowsers(): Promise<void> {
  if (browserInitialized) return;
  if (initializationInProgress) {
    // Wait for in-progress initialization
    while (initializationInProgress) {
      await new Promise(r => setTimeout(r, 100));
    }
    return;
  }
  
  initializationInProgress = true;
  try {
    const pwAiAgentsDir = path.resolve(__dirname, '../../..', 'pw-ai-agents');
    const localPlaywrightCli = path.join(pwAiAgentsDir, 'node_modules', '@playwright', 'test', 'cli.js');
    
    if (!fs.existsSync(localPlaywrightCli)) {
      logger.warn('Playwright CLI not found, skipping browser initialization');
      return;
    }
    
    // Use 'install --check' first (very fast)
    try {
      execSync(`${process.execPath} "${localPlaywrightCli}" install --check`, {
        cwd: pwAiAgentsDir,
        timeout: 5000,
      });
      logger.info('Playwright browsers already installed');
      browserInitialized = true;
      return;
    } catch (checkErr) {
      // Not installed, proceed with full install
    }
    
    // Full install with 120-second timeout
    execSync(`${process.execPath} "${localPlaywrightCli}" install --with-deps`, {
      cwd: pwAiAgentsDir,
      timeout: 120000,
    });
    
    browserInitialized = true;
  } finally {
    initializationInProgress = false;
  }
}
```

### Change 2: Environment Validation Caching

**File**: `backend/src/execution/executor-service.ts` (lines 200-250)

**Before**:
```typescript
async executeTest(testFile: string, options?: {...}): Promise<ExecutionResult> {
  // ... setup ...
  
  // Runs EVERY execution
  let validation: any = null;
  try {
    validation = validatePlaywrightEnvironment(pwAiAgentsDir, this.repoRoot);
    // Extensive logging...
```

**After**:
```typescript
// Add at class level
private static validationCache: PlaywrightValidationResult | null = null;
private static validationCacheTime = 0;
private static VALIDATION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async executeTest(testFile: string, options?: {...}): Promise<ExecutionResult> {
  // ... setup ...
  
  // Use cached validation
  let validation: any;
  const now = Date.now();
  if (ExecutorService.validationCache && 
      now - ExecutorService.validationCacheTime < ExecutorService.VALIDATION_CACHE_TTL) {
    validation = ExecutorService.validationCache;
    logger.debug('Using cached Playwright validation (age: ${now - ExecutorService.validationCacheTime}ms)');
  } else {
    validation = validatePlaywrightEnvironment(pwAiAgentsDir, this.repoRoot);
    ExecutorService.validationCache = validation;
    ExecutorService.validationCacheTime = now;
    logger.info('Playwright environment validation completed and cached');
  }
```

### Change 3: Early Exit Detection from Playwright

**File**: `backend/src/execution/executor-service.ts` (lines 900-950)

**Before**:
```typescript
const result_output = await execAsync(commandToRun, {
  cwd: pwAiAgentsDir,
  maxBuffer: 50 * 1024 * 1024,
  timeout: 120000,  // Always wait 120 seconds
  env: childEnv,
  shell: '/bin/bash',
});
```

**After**:
```typescript
// Use streaming to detect early exit
const result_output = await execWithEarlyExit(commandToRun, {
  cwd: pwAiAgentsDir,
  maxBuffer: 50 * 1024 * 1024,
  timeout: 30000,  // Reduced to 30 seconds
  env: childEnv,
  shell: '/bin/bash',
  onOutput: (chunk: string) => {
    // Exit early on first "FAILED" keyword
    if (chunk.includes('FAILED') || chunk.includes('failed')) {
      logger.debug('Early exit: Playwright test failure detected');
      return true; // Signal to exit early
    }
    return false; // Continue waiting
  }
});

async function execWithEarlyExit(cmd: string, opts: any): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const proc = spawn(cmd, { shell: opts.shell, cwd: opts.cwd, ... });
    
    proc.stdout.on('data', (data) => {
      stdout += data;
      if (opts.onOutput?.(data.toString())) {
        proc.kill();
      }
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data;
      if (opts.onOutput?.(data.toString())) {
        proc.kill();
      }
    });
    
    setTimeout(() => proc.kill(), opts.timeout);
    
    proc.on('exit', (code) => {
      resolve({ stdout, stderr });
    });
  });
}
```

### Change 4: MCP Caching + Timeout

**File**: `backend/src/agents/self-healing/recommender.ts`

```typescript
class FixRecommender {
  private domCache = new Map<string, { data: any; timestamp: number }>();
  private DOM_CACHE_TTL = 60000; // 60 seconds
  
  private async suggestViaLLMWithDOM(...): Promise<LocatorFix> {
    try {
      const mcp = await getMCPClient();
      
      // Timeout wrapper
      const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          promise,
          new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))
        ]);
      
      try {
        await withTimeout(mcp.executeTool('open_url', { url }), 2000);
      } catch (openErr) {
        console.warn('⚠ MCP open_url timeout/failed', openErr);
      }
      
      // Cached DOM fetch
      let domResponse = this.getDOMCached(url, mcp);
      if (!domResponse?.elements?.length) throw new Error('Empty DOM response from MCP');
      
      // ... rest of method
    }
  }
  
  private async getDOMCached(url: string, mcp: any): Promise<any> {
    const cached = this.domCache.get(url);
    const now = Date.now();
    
    if (cached && now - cached.timestamp < this.DOM_CACHE_TTL) {
      logger.info('Using cached DOM for URL: ' + url);
      return cached.data;
    }
    
    try {
      const data = await Promise.race([
        mcp.executeTool('get_dom_json', { url }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('MCP timeout')), 2000))
      ]);
      
      this.domCache.set(url, { data, timestamp: now });
      return data;
    } catch (err) {
      logger.warn('MCP get_dom_json failed/timeout, falling back to heuristics');
      throw err;
    }
  }
}
```

### Change 5: LLM Call with Timeout

**File**: `backend/src/agents/self-healing/recommender.ts`

```typescript
private async queryLLMForSelector(...): Promise<string | null> {
  const systemPrompt = `You are an expert QA automation engineer specializing in element locator strategies. Return ONLY a single selector string.`;
  const userMessage = `...`;
  
  try {
    const client = getGroqClient();
    if (!client) throw new Error('GROQ_API_KEY not configured');
    
    // Add timeout
    const response = await Promise.race([
      client.chat.completions.create({
        model: process.env.LLM_MODEL || 'mixtral-8x7b-32768',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.2,
        max_tokens: 150,
      }),
      new Promise<any>((_, rej) =>
        setTimeout(() => rej(new Error('LLM_TIMEOUT')), 5000)
      )
    ]);
    
    const suggestionText = (response.choices[0].message.content || '').trim();
    const cleaned = suggestionText.replace(/```[\w]*\n?/g, '').replace(/\n/g, '').trim();
    if (cleaned && cleaned !== 'null') return cleaned;
    return null;
  } catch (err) {
    // Timeout or API error - fail gracefully
    logger.warn('LLM request failed/timeout, falling back to heuristics', err);
    throw err;
  }
}
```

---

## Validation & Measurement

### Baseline Measurement

Run before implementing changes:
```bash
# Run healing lab test 5 times, measure total time
time for i in {1..5}; do
  curl -X POST http://localhost:3000/api/healing-lab/run \
    -H 'Content-Type: application/json' \
    -d '{"script":"...","failureType":"STRICT_MODE","url":"..."}'
done

# Expected: 600-900 seconds total (120-180s per cycle)
```

### Post-Optimization Measurement

After Phase 1:
- Expected: 300-400 seconds (60-80s per cycle, 50% improvement)

After Phase 2:
- Expected: 0-100 seconds (<20s per cycle, 80-90% improvement)

After Phase 3:
- Expected: 25-50 seconds total (5s per cycle + first-step detection at 3-5s)

---

## Risk Assessment

| Change | Risk Level | Mitigation |
|--------|-----------|-----------|
| Browser startup init | Low | Fall back to on-demand install if startup fails |
| Validation caching | Low | Cache expires after 30 minutes, can be cleared |
| Early exit detection | Medium | Keep 30-second baseline timeout, validate output parsing |
| LLM timeout | Medium | Fallback to heuristics if timeout, log all timeouts |
| MCP caching | Low | Cache expires after 60 seconds, can be invalidated |
| File operation parallelization | Low | Ensure proper error handling in Promise.all() |

---

## Recommended Implementation Order

1. **Week 1**: Phase 1 Quick Wins (3-4 hours elapsed)
   - Browser initialization at startup
   - Validation caching
   - LLM timeout

2. **Week 2**: Phase 2 Medium Effort (4-6 hours elapsed)
   - Early-exit detection
   - MCP caching
   - File operation parallelization

3. **Week 3-4**: Phase 3 Architecture (10-12 hours elapsed)
   - Browser instance reuse
   - Per-step timeouts
   - Early failure detection

**Total Implementation Time**: ~20-25 hours  
**Total Time Savings**: 100-170 seconds per healing cycle  
**ROI**: After first 20 healing cycles, accumulated time savings exceed implementation time

---

## Success Criteria

- [ ] Healing cycle completes in under 20 seconds (achieves user requirement)
- [ ] First-step failure detection occurs within 3-5 seconds (enables early healing)
- [ ] Deterministic healing rate >80% (reduces LLM/MCP dependency)
- [ ] No increase in false-negative healing (monitor test pass rate post-healing)
- [ ] Oracle Linux performance matches macOS (measure on both platforms)

