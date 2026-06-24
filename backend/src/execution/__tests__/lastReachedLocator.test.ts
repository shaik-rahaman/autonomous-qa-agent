import { ExecutorService } from '../executor-service';

describe('ExecutorService.extractLastReachedLocator', () => {
  const executor = new ExecutorService('.');

  it('returns attribute selector when present in HEALING LAB output', () => {
    const out = `Some logs\n[HEALING LAB] REACHED LOCATOR: '[name="asdfdpassword"]'\nMore logs`;
    // access private method via any cast
    // @ts-ignore
    const val = (executor as any).extractLastReachedLocator(out);
    expect(val).toBe('[name="asdfdpassword"]');
  });

  it('rejects JS code fragments and extracts inner selector if available', () => {
    const out = `... [HEALING LAB] REACHED LOCATOR: ', ".oxd-button.oxd-button--medium.oxd-button--main"), page.locator(".oxd-button.oxd-button--medium.oxd-button--main")).click({ timeout: 5000 });\n`;
    // @ts-ignore
    const val = (executor as any).extractLastReachedLocator(out);
    // Should prefer the inner selector (class) if extractable
    expect(val === null || val === '.oxd-button.oxd-button--medium.oxd-button--main').toBeTruthy();
  });
});
