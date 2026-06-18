import { isValidSelector } from '../error-parser';

describe('Selector Validation', () => {
  it('should reject unknown_selector', () => {
    expect(isValidSelector('unknown_selector')).toBe(false);
  });
  it('should reject :visible selectors', () => {
    expect(isValidSelector('button:visible')).toBe(false);
  });
  it('should reject empty or short selectors', () => {
    expect(isValidSelector('')).toBe(false);
    expect(isValidSelector('a')).toBe(false);
  });
  it('should accept valid getByRole selector', () => {
    expect(isValidSelector("getByRole('button', { name: /login/i })")).toBe(true);
  });
  it('should accept valid CSS selector', () => {
    expect(isValidSelector('.submit-btn')).toBe(true);
  });
});
