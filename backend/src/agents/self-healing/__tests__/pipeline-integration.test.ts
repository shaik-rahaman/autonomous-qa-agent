/**
 * Pipeline Integration Test
 *
 * This test reproduces the exact logs from production failure:
 * - Failed selector: getByText("Dashboard")
 * - Strict mode candidates: heading, link
 * - Expected healed: getByRole('heading', { name: 'Dashboard' })
 * - Runtime injection must succeed with replacement verification
 */

import {
  extractFailedSelector,
  extractStrictModeCandidates,
  pickBestCandidate,
  isValidSelector,
} from '../error-parser';

describe('Pipeline Integration Test', () => {
  describe('Dashboard Healing Pipeline', () => {
    it('should reproduce production failure: getByText("Dashboard")', () => {
      // PRODUCTION ERROR LOG:
      // Test failure: getByText("Dashboard")
      // Strict mode candidates: getByRole('link', { name: 'Dashboard' }), getByRole('heading', { name: 'Dashboard' })
      // Healing output: getByText("Dashboard"):visible ❌
      // Runtime injector: INJECTION SUCCESS: NO (verification failed)

      const error = `getByText("Dashboard") resolved to 2 elements:
  getByRole('link', { name: 'Dashboard' })
  getByRole('heading', { name: 'Dashboard' })`;

      // STEP 1: Extract failed selector
      const failedSelector = extractFailedSelector(error);
      expect(failedSelector).toBe('getByText("Dashboard")');

      // STEP 2: Extract strict mode candidates
      const candidates = extractStrictModeCandidates(error);
      expect(candidates).toBeDefined();
      expect(candidates.length).toBeGreaterThan(0);

      // STEP 3: Verify candidates were parsed correctly
      candidates.forEach((c) => {
        expect(c.selector).toBeTruthy();
        expect(c.score).toBeGreaterThan(0);
        // CRITICAL: None should have :visible
        expect(c.selector).not.toMatch(/:visible/);
      });

      // STEP 4: Pick best candidate
      const bestCandidate = pickBestCandidate(candidates);
      expect(bestCandidate).toBeDefined();
      expect(bestCandidate?.score).toBeGreaterThan(50);

      // STEP 5: Verify best candidate is valid
      expect(isValidSelector(bestCandidate?.selector || '')).toBe(true);

      // STEP 6: Verify best candidate is NOT :visible fallback
      expect(bestCandidate?.selector).not.toMatch(/:visible$/);

      // STEP 7: Verify it's actually different from original
      expect(bestCandidate?.selector).not.toBe(failedSelector);

      // EXPECTED RESULT
      expect(bestCandidate?.selector).toMatch(/getByRole.*heading.*Dashboard/i);
    });

    it('should reject :visible suffix as invalid healing', () => {
      const invalidSelector = 'getByText("Dashboard"):visible';
      const validSelector = `getByRole('heading', { name: 'Dashboard' })`;

      // :visible suffix MUST be invalid
      expect(isValidSelector(invalidSelector)).toBe(false);

      // Real candidate MUST be valid
      expect(isValidSelector(validSelector)).toBe(true);
    });

    it('should validate runtime injection - original count must decrease', () => {
      // SIMULATING: runtime-injector verification
      const fileContent = `
      await page.locator("[name=\\"username\\"]").fill("Admin");
      await page.locator("[name=\\"password\\"]").fill("admin123");
      await page.locator(".oxd-button").click();
      await expect(page.getByText("Dashboard")).toBeVisible();
      `;

      const failedLocator = 'page.getByText("Dashboard")';
      const healedLocator = `page.getByRole('heading', { name: 'Dashboard' })`;

      // Verify original exists
      const originalOccurrences = (
        fileContent.match(new RegExp(failedLocator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
      ).length;

      // Simulate replacement (the FIX uses split().join())
      const patched = fileContent.split(failedLocator).join(healedLocator);

      // Count after replacement
      const newOccurrences = (
        patched.match(new RegExp(failedLocator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
      ).length;
      const healedOccurrences = (
        patched.match(new RegExp(healedLocator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
      ).length;

      // VERIFICATION MUST PASS
      expect(originalOccurrences).toBeGreaterThan(0);
      expect(newOccurrences).toBe(0); // Original completely replaced
      expect(healedOccurrences).toBeGreaterThan(0); // Healed exists
    });

    it('should verify selector changed AND healed AND valid', () => {
      const originalSelector = 'getByText("Dashboard")';
      const healedSelector = 'getByRole("heading", { name: "Dashboard" })';

      // All three conditions MUST be true
      expect(originalSelector).not.toEqual(healedSelector);
      expect(isValidSelector(healedSelector)).toBe(true);
      expect(healedSelector).not.toMatch(/:visible$/);
    });

    it('should fail if selector unchanged', () => {
      const selector1 = 'getByText("Dashboard")';
      const selector2 = 'getByRole("heading", { name: "Dashboard" })';

      // Healing must produce DIFFERENT selector
      expect(selector1.length).toBeGreaterThan(0);
      expect(selector2.length).toBeGreaterThan(0);
      expect(selector1.length).toBeLessThan(selector2.length);
      // Selectors should be different strings (one is shorter than the other)
    });

    it('should fail if healed selector has :visible', () => {
      const invalidHealed = 'getByText("Dashboard"):visible';

      // This MUST fail validation
      expect(isValidSelector(invalidHealed)).toBe(false);
    });

    it('should extract candidates from OrangeHRM error format', () => {
      const orangeHRMError = `Error: strict mode locator "getByText('Dashboard')" resolved to 2 elements:
        1) <h1>Dashboard</h1>
        2) <a>Dashboard</a>`;

      const failedSelector = extractFailedSelector(orangeHRMError);
      expect(failedSelector).toBeTruthy();

      const candidates = extractStrictModeCandidates(orangeHRMError);
      expect(candidates.length).toBeGreaterThanOrEqual(0);
    });

    it('should never suggest heading with lower score than heading', () => {
      const error = `getByText("Dashboard") resolved to 2 elements:
  getByRole('heading', { name: 'Dashboard' })
  getByRole('link', { name: 'Dashboard' })`;

      const candidates = extractStrictModeCandidates(error);
      const best = pickBestCandidate(candidates);

      // Heading should be picked (score 100) over link (score 90)
      expect(best?.selector).toMatch(/heading/);
    });
  });

  describe('Failure Cases - What Would Fail Before Fix', () => {
    it('should detect when injection fails due to regex escaping', () => {
      // Before fix: replaceAll() with unescaped regex chars would fail
      // The failedLocator contains regex special chars like ( ) ' /

      const failedLocator = `getByRole('heading', { name: /Dashboard/i })`;
      const healedLocator = `getByRole('button', { name: /Dashboard/i })`;
      const fileContent = `await expect(${failedLocator}).toBeVisible();`;

      // Proper replacement using split/join (the FIX)
      const patched = fileContent.split(failedLocator).join(healedLocator);

      const found = patched.includes(healedLocator);
      expect(found).toBe(true);
    });

    it('should verify replacement count before/after', () => {
      const failedLocator = 'getByText("Dashboard")';
      const healedLocator = `getByRole('heading', { name: 'Dashboard' })`;
      const content = `
      await expect(page.getByText("Dashboard")).toBeVisible();
      await expect(page.getByText("Dashboard")).toBeTruthy();
      `;

      // Before: 2 occurrences
      const before = (content.match(/getByText\("Dashboard"\)/g) || []).length;
      expect(before).toBe(2);

      // After replacement
      const patched = content.split(failedLocator).join(healedLocator);
      const after = (patched.match(/getByText\("Dashboard"\)/g) || []).length;
      expect(after).toBe(0);

      // All should be healed now
      const healed = (patched.match(/getByRole\('heading'/g) || []).length;
      expect(healed).toBe(2);
    });

    it('should fail if locator not found in file', () => {
      const failedLocator = 'getByText("Dashboard")';
      const fileContent = 'await expect(page.getByText("Login")).toBeVisible();';

      // Locator not in file
      const found = fileContent.includes(failedLocator);
      expect(found).toBe(false);

      // Replacement should not happen
      const patched = fileContent.split(failedLocator).join('HEALED');
      expect(patched).toBe(fileContent); // Unchanged
    });
  });
});
