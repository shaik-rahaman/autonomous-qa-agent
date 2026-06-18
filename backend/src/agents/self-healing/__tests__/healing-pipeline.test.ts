import { healFailure } from '../../self-healing/healing-pipeline';
import { FixRecommender } from '../../self-healing/recommender';

jest.mock('../../self-healing/recommender', () => ({
  FixRecommender: jest.fn().mockImplementation(() => ({
    suggestAlternativeSelector: jest.fn().mockResolvedValue({ fixed: true, newSelector: '[name="fixed"]', reason: 'mocked' }),
  })),
}));

describe('healing-pipeline gating', () => {
  test('skips healing for environment/navigation failures', async () => {
    const input = {
      step: 'goto',
      error: 'page.goto: Test timeout of 30000ms exceeded',
      selector: '[name="password"]',
      url: 'https://example.com',
    } as any;

    const res = await healFailure(input);
    expect(res.fixed).toBe(false);
    expect(res.telemetry.reason).toMatch(/Environment/);
    expect(res.telemetry.confidence).toBe(0);
  });

  test('runs healing when locator failure reached', async () => {
    const input = {
      step: 'fill',
      error: "waiting for locator('[name=\"x\"]') to be visible timeout",
      selector: '[name="x"]',
      url: 'https://example.com',
    } as any;

    const res = await healFailure(input);
    expect(res.fixed).toBe(true);
    expect(res.newSelector).toBe('[name="fixed"]');
  });
});
