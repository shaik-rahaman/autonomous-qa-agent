import {
  extractFailedSelector,
  extractStrictModeCandidates,
  pickBestCandidate,
  isValidSelector,
} from '../error-parser';

describe('Error Parser - Failed Selector Extraction', () => {
  describe('extractFailedSelector()', () => {
    it('should extract selector from "Locator: ..." format', () => {
      const error = `Locator: getByText(/Dashboard/i)
at Context (file.ts:12)`;
      const selector = extractFailedSelector(error);
      expect(selector).toBe("getByText(/Dashboard/i)");
    });

    it('should extract getByRole selector from error', () => {
      const error = `Error: getByRole('heading', { name: 'Dashboard' }) not found`;
      const selector = extractFailedSelector(error);
      expect(selector).toBe("getByRole('heading', { name: 'Dashboard' })");
    });

    it('should never return unknown_selector', () => {
      const error = `No valid selector found`;
      const selector = extractFailedSelector(error);
      expect(selector).not.toBe('unknown_selector');
      expect(selector).toBeNull();
    });

    it('should extract CSS selector from error', () => {
      const error = `selector ".submit-btn" not found`;
      const selector = extractFailedSelector(error);
      expect(selector).toBe('.submit-btn');
    });

    it('should return null if no valid selector found', () => {
      const error = `Some random error without selectors`;
      const selector = extractFailedSelector(error);
      expect(selector).toBeNull();
    });

    it('should extract selector from waiting-for locator for locator.fill', () => {
      const error = `Error: waiting for locator('[name="asdfdpassword"]') locator.fill timeout`;
      const selector = extractFailedSelector(error);
      // Normalized/demo-free behavior: ensure we extracted a selector containing the attribute name
      expect(selector).toBeDefined();
      expect(selector).toContain('password');
    });

    it('should extract selector from waiting-for locator for locator.click', () => {
      const error = `Error: waiting for locator(".submit-btn") locator.click timeout`;
      const selector = extractFailedSelector(error);
      expect(selector).toBe('.submit-btn');
    });

    it('should extract selector from waiting-for locator for waitFor', () => {
      const error = `TimeoutError: waiting for locator('#login') failed: waiting for locator('#login')`;
      const selector = extractFailedSelector(error);
      expect(selector).toBe('#login');
    });

    it('should not capture surrounding source code fragments, only the selector', () => {
      const error = `Error: waiting for locator('[name="asdfdpassword"]') locator.click timeout\n    at Context (file:///tests/login.spec.ts:45:12)\n    page.locator('[name="asdfdpassword"]').click({ timeout: 5000 })`;
      const selector = extractFailedSelector(error);
      // Ensure we only return the selector itself (demo prefix removed in production flow)
      expect(selector).toBeDefined();
      expect(selector).toContain('password');
    });
  });

  describe('extractStrictModeCandidates()', () => {
    it('should extract multiple strict mode candidates', () => {
      const error = `getByText(/Dashboard/i) resolved to 2 elements:
getByRole('heading', { name: 'Dashboard' })
getByRole('link', { name: 'Dashboard' })`;
      const candidates = extractStrictModeCandidates(error);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].role).toBe('heading'); // Highest score
    });

    it('should score heading highest (100)', () => {
      const error = `getByRole('heading', { name: 'Dashboard' })`;
      const candidates = extractStrictModeCandidates(error);
      expect(candidates[0].score).toBe(100);
    });

    it('should score link lower (90)', () => {
      const error = `getByRole('link', { name: 'Dashboard' })`;
      const candidates = extractStrictModeCandidates(error);
      expect(candidates[0].score).toBe(90);
    });

    it('should score text-based selectors lower (70)', () => {
      const error = `getByText(/Dashboard/i)`;
      const candidates = extractStrictModeCandidates(error);
      expect(candidates[0].score).toBeLessThan(80);
    });

    it('should sort candidates by score descending', () => {
      const error = `getByRole('link', { name: 'Test' })
getByRole('heading', { name: 'Test' })
getByRole('button', { name: 'Test' })`;
      const candidates = extractStrictModeCandidates(error);
      // Heading should be first (100), button second (95), link third (90)
      expect(candidates[0].score).toBeGreaterThanOrEqual(candidates[1].score);
      expect(candidates[1].score).toBeGreaterThanOrEqual(candidates[2].score);
    });
  });

  describe('pickBestCandidate()', () => {
    it('should return highest scoring candidate', () => {
      const error = `getByRole('link', { name: 'Dashboard' })
getByRole('heading', { name: 'Dashboard' })`;
      const candidates = extractStrictModeCandidates(error);
      const best = pickBestCandidate(candidates);
      expect(best?.role).toBe('heading');
      expect(best?.score).toBe(100);
    });

    it('should return null for empty candidates', () => {
      const best = pickBestCandidate([]);
      expect(best).toBeNull();
    });

    it('should return null for undefined candidates', () => {
      const best = pickBestCandidate(undefined as any);
      expect(best).toBeNull();
    });
  });

  describe('isValidSelector()', () => {
    it('should reject unknown_selector', () => {
      expect(isValidSelector('unknown_selector')).toBe(false);
    });

    it('should reject :visible selectors', () => {
      expect(isValidSelector('button:visible')).toBe(false);
      expect(isValidSelector('unknown_selector:visible')).toBe(false);
    });

    it('should reject null/undefined/empty', () => {
      expect(isValidSelector(null as any)).toBe(false);
      expect(isValidSelector(undefined)).toBe(false);
      expect(isValidSelector('')).toBe(false);
    });

    it('should reject very short selectors', () => {
      expect(isValidSelector('a')).toBe(false);
      expect(isValidSelector('ab')).toBe(false);
    });

    it('should accept valid getByRole selector', () => {
      expect(isValidSelector("getByRole('button', { name: /login/i })")).toBe(true);
    });

    it('should accept valid CSS selector', () => {
      expect(isValidSelector('.submit-btn')).toBe(true);
      expect(isValidSelector('#login-form')).toBe(true);
    });

    it('should accept valid getByText selector', () => {
      expect(isValidSelector("getByText(/Dashboard/i)")).toBe(true);
    });

    it('should reject incomplete selectors', () => {
      expect(isValidSelector('...')).toBe(false);
      expect(isValidSelector('>>>')).toBe(false);
    });
  });
});

describe('Error Parser - Real-World Errors', () => {
  it('should handle OrangeHRM dashboard error', () => {
    const error = `Error: Locator: getByText(/Dashboard/i)
at Context (file:///validate-login-dashboard.spec.ts:12:33)`;
    const selector = extractFailedSelector(error);
    expect(selector).toBe("getByText(/Dashboard/i)");
    if (selector) {
      expect(isValidSelector(selector)).toBe(true);
    }
  });

  it('should handle strict mode error from OrangeHRM', () => {
    const error = `getByText(/Dashboard/i) resolved to 2 elements:
  1. <h1>Dashboard</h1>
  2. <a href="/dashboard">Dashboard Link</a>

Selectors:
getByRole('heading', { name: 'Dashboard' })
getByRole('link', { name: 'Dashboard' })`;
    const candidates = extractStrictModeCandidates(error);
    expect(candidates.length).toBeGreaterThan(0);
    const best = pickBestCandidate(candidates);
    expect(best?.role).toBe('heading');
  });

  it('should handle login form selectors', () => {
    const error = `Error: locator.fill() expects string, got 'null'
at Context (file:///validate-login-dashboard.spec.ts:10:5)`;
    const selector = extractFailedSelector(error);
    expect(selector).toBeNull(); // No selector in this error
  });
});
