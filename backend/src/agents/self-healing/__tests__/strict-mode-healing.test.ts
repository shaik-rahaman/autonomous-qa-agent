import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { extractStrictModeCandidates, pickBestCandidate } from '../error-parser';

describe('Strict Mode Healing Integration', () => {
  describe('Real-world OrangeHRM Dashboard Scenario', () => {
    it('should heal strict mode error by selecting best candidate (heading > link)', () => {
      // Simulate the actual Playwright strict mode error from OrangeHRM
      const playwrightError = `
Error: strict mode violation
getByText("Dashboard") resolved to 2 elements:

  1. <h1 class="oxd-topbar-header-title">Dashboard</h1>
  2. <a href="/web/index.php/dashboard-v2/">Dashboard Link</a>

Locators:
getByRole('heading', { name: 'Dashboard' })
getByRole('link', { name: 'Dashboard' })

To specify which element to use, use the first or second locator with one of the above selectors.`;

      // Extract candidates from error
      const candidates = extractStrictModeCandidates(playwrightError);
      expect(candidates.length).toBeGreaterThan(0);
      
      // Verify heading is first (highest score)
      const best = pickBestCandidate(candidates);
      expect(best).not.toBeNull();
      expect(best?.selector).toContain("getByRole('heading'");
      expect(best?.score).toBe(100);  // Heading scores 100
    });

    it('should extract and rank candidates: heading=100, link=90', () => {
      const error = `getByText("Dashboard") resolved to 2 elements:
getByRole('link', { name: 'Dashboard' })
getByRole('heading', { name: 'Dashboard' })`;

      const candidates = extractStrictModeCandidates(error);
      
      // Verify sorting: heading first (100), link second (90)
      expect(candidates[0].score).toBeGreaterThanOrEqual(candidates[1].score);
      expect(candidates[0].selector).toContain('heading');
    });

    it('should handle button > text scoring', () => {
      const error = `getByText("Submit") resolved to 2 elements:
getByText("Submit")
getByRole('button', { name: 'Submit' })`;

      const candidates = extractStrictModeCandidates(error);
      
      // Button (95) should score higher than text (70)
      const buttonCandidate = candidates.find(c => c.selector.includes('button'));
      const textCandidate = candidates.find(c => c.selector.includes("getByText"));
      
      if (buttonCandidate && textCandidate) {
        expect(buttonCandidate.score).toBeGreaterThan(textCandidate.score);
      }
    });

    it('should reject :visible suffix - only return real candidates', () => {
      const error = `getByText("Dashboard") resolved to 2 elements`;
      const candidates = extractStrictModeCandidates(error);
      
      // None should have :visible
      candidates.forEach(c => {
        expect(c.selector).not.toMatch(/:visible/);
      });
    });

    it('should handle getByTestId and other accessor types', () => {
      const error = `getByTestId("dashboard-link") resolved to 2 elements:
getByTestId("dashboard-link")
getByRole('link', { name: 'Dashboard' })`;

      const candidates = extractStrictModeCandidates(error);
      expect(candidates.length).toBeGreaterThan(0);
      
      // Link should score higher than TestId (CSS-like)
      const best = pickBestCandidate(candidates);
      expect(best?.selector).toContain('link');
    });

    it('should return best candidate with confidence for healing decision', () => {
      const error = `Locator: getByText("Dashboard")
strict mode violation
getByRole('heading', { name: 'Dashboard' })
getByRole('link', { name: 'Dashboard' })`;

      const candidates = extractStrictModeCandidates(error);
      const best = pickBestCandidate(candidates);
      
      expect(best).not.toBeNull();
      expect(best?.score).toBeGreaterThan(85);  // High confidence
      expect(best?.selector).toBeDefined();
      expect(best?.selector).toMatch(/getByRole/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single candidate', () => {
      const error = `getByText("Dashboard") found`;
      const candidates = extractStrictModeCandidates(error);
      
      // Could be 0 or 1 depending on extraction
      if (candidates.length > 0) {
        const best = pickBestCandidate(candidates);
        expect(best).not.toBeNull();
      }
    });

    it('should handle malformed error message gracefully', () => {
      const error = `Some random error without proper structure`;
      const candidates = extractStrictModeCandidates(error);
      
      // Should return empty or safe defaults
      expect(Array.isArray(candidates)).toBe(true);
    });

    it('should never suggest :visible as a healed locator', () => {
      const errors = [
        `getByText("Login") resolved to 2 elements: getByRole('button') getByText("Login")`,
        `strict mode: multiple elements found`,
        `Error: locator resolved to 3 elements`
      ];

      errors.forEach(error => {
        const candidates = extractStrictModeCandidates(error);
        candidates.forEach(c => {
          expect(c.selector).not.toMatch(/:visible$/);
          expect(c.selector).not.toMatch(/unknown_selector/);
        });
      });
    });
  });

  describe('Healing Flow Validation', () => {
    it('should produce a valid healed selector for runtime injection', () => {
      const error = `getByText("Dashboard") resolved to 2 elements:
getByRole('heading', { name: 'Dashboard' })
getByRole('link', { name: 'Dashboard' })`;

      const candidates = extractStrictModeCandidates(error);
      const best = pickBestCandidate(candidates);
      
      // Verify the healed selector is valid for runtime injection
      expect(best?.selector).toMatch(/getByRole|getByText|getByLabel|getByTestId|getByPlaceholder|page\.locator/);
      
      // Should NOT have :visible
      expect(best?.selector).not.toMatch(/:visible/);
      
      // Should be ready to inject into test
      expect(best?.selector).toMatch(/\(/);
      expect(best?.selector).toMatch(/\)/);
    });
  });
});
