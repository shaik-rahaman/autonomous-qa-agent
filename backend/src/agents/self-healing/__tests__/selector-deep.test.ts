import { extractFailedLocator } from '../error-parser';

describe('Deep selector extraction', () => {
  it('finds selector nested under Symbol(step).params.selector', () => {
    const stepSym = Symbol('step');
    const errObj: any = {};
    errObj[stepSym] = { params: { selector: '[name="asdfdpassword"]' } };

    const result = extractFailedLocator(errObj);
    // Normalized behavior: ensure locator contains the attribute name/value (password)
    expect(result).toBeDefined();
    expect(result).toContain('password');
  });

  it('throws LocatorExtractionBug when selector key present but invalid', () => {
    const stepSym = Symbol('step');
    const errObj: any = {};
    errObj[stepSym] = { params: { selector: ':visible' } };

    // The extractor throws when selector is present but invalid; match the thrown message
    expect(() => extractFailedLocator(errObj)).toThrow(/selector found in object but invalid/);
  });
});
