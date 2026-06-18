import { extractFailedLocator } from '../error-parser';

describe('Deep selector extraction', () => {
  it('finds selector nested under Symbol(step).params.selector', () => {
    const stepSym = Symbol('step');
    const errObj: any = {};
    errObj[stepSym] = { params: { selector: '[name="asdfdpassword"]' } };

    const result = extractFailedLocator(errObj);
    expect(result).toBe('[name="asdfdpassword"]');
  });

  it('throws LocatorExtractionBug when selector key present but invalid', () => {
    const stepSym = Symbol('step');
    const errObj: any = {};
    errObj[stepSym] = { params: { selector: ':visible' } };

    expect(() => extractFailedLocator(errObj)).toThrow(/LocatorExtractionBug/);
  });
});
