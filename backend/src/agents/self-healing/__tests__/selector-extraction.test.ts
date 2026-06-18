import { FixRecommender } from '../recommender';

describe('Selector Extraction and Healing', () => {
  const recommender = new FixRecommender();

  it('should extract getByRole selector from error message', async () => {
    const error = "Error: getByRole('button', { name: /login/i }) not found";
    const originalSelector = "getByRole('button', { name: /login/i })";
    const result = await recommender.suggestAlternativeSelector(error, originalSelector);
    expect(result.fixed).toBeDefined();
    expect(result.reason).toContain('LLM');
  });

  it('should fallback to original selector if pattern not found', async () => {
    const error = "Timeout: waiting for selector .submit-btn to be visible";
    const originalSelector = ".submit-btn";
    const result = await recommender.suggestAlternativeSelector(error, originalSelector);
    expect(result.fixed).toBeDefined();
    expect(result.reason).toContain('LLM');
  });

  it('should handle missing DOM context gracefully', async () => {
    const error = "Error: getByRole('textbox', { name: /email/i }) not found";
    const originalSelector = "getByRole('textbox', { name: /email/i })";
    const result = await recommender.suggestAlternativeSelector(error, originalSelector, undefined);
    expect(result.fixed).toBeDefined();
  });
});
