# Safe Re-enable Plan for Self-Healing (PHASE 8)

Goal: Re-enable healing only after deterministic verification and strict safety contracts.

Prerequisites
- All FailureAnalyzer cases verified (element-not-found, strict-mode, timeouts, visibility, unknown).
- Failure diagnostics persisted and readable (`backend/tmp/failure-diagnostics/latest-failure.json`).
- Runtime injector removed; temp-file execution path in place.

Principles
- Lazy-load any LLM/recommender libraries at call time (do not import at module top-level).
- Require an explicit environment flag to enable healing (e.g., `HEALING_ENABLED=true`).
- Enforce selector validation: no `:visible` suffix, selector must differ from failed selector, and must match a simple whitelist of selector patterns (CSS, role/getByRole, text/getByText only when strict-mode validated).
- Persist every healing attempt and decision to `failure-store` with full audit trail.

Implementation Steps
1. Add feature flag check
   - Read `process.env.HEALING_ENABLED` inside `healFailure()`; if not `true`, return { fixed: false, reason: 'healing_disabled' } (already implemented).

2. Lazy-load recommender
   - Replace top-level `import { recommender } from './recommender'` with dynamic import inside the re-enable branch:

```ts
if (process.env.HEALING_ENABLED === 'true') {
  const { recommender } = await import('./recommender');
  // use recommender.heal(...) here
}
```

3. Enforce strict healing contract (pseudo-code)

```ts
function isValidHealedSelector(oldSelector: string | null, newSelector: string): boolean {
  if (!newSelector || newSelector.trim() === '') return false;
  if (newSelector.includes(':visible')) return false;
  if (oldSelector && newSelector === oldSelector) return false;
  // whitelist basic patterns
  const allowed = [/^\[.*\]$/, /^#/, /^\./, /^getByRole\(/, /getByText\(/, /^page\.locator\(/];
  return allowed.some((r) => r.test(newSelector));
}
```

4. Dry-run validation
- After obtaining `newSelector` from recommender, call `isValidHealedSelector()`; if it fails, persist decision and return `{ fixed: false, reason: 'invalid_healed_selector' }`.

5. Verification (optional auto-verify)
- Optionally run Playwright in a sandboxed mode against the failed step with the new selector to confirm it would succeed; only then mark `fixed: true`.
- This should be rate-limited and guarded by an extra env flag `HEALING_AUTO_VERIFY=true`.

6. Audit logging
- Persist every healing attempt with `{ timestamp, input, actualPlaywrightError, extractedSelector, newSelector, verificationResult, source }` to `failure-store`.

7. Rollout plan
- Start with `HEALING_ENABLED=false` in CI and staging.
- Enable `HEALING_ENABLED=true` and `HEALING_AUTO_VERIFY=true` for a small percentage of runs (or a dedicated branch) and review persisted audits.
- Only enable globally after 2-3 successful days of deterministic healing behavior and no regressions.

Checklist (pre-merge)
- [ ] Add unit tests for `isValidHealedSelector()`
- [ ] Add integration test that runs a healed selector in sandbox and verifies behavior
- [ ] Ensure recommender import is fully lazy and protected from missing env vars
- [ ] Add metrics/logging for healing success rate and rejection reasons

Contact
- If you'd like, I can implement the lazy-import change and the selector validation function in `backend/src/agents/self-healing/index.ts` as the next step.
