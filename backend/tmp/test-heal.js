(async ()=>{
  const hf = require('../dist/agents/self-healing/index.js').healFailure;

  const scenarios = [
    {
      name: 'ELEMENT_NOT_FOUND - bracket selector',
      input: {
        step: 'test-1',
        error: 'waiting for locator(\'[name="asdfdpassword"]\') locator.fill timeout',
        selector: '[name="asdfdpassword"]',
        url: 'http://example.com'
      }
    },
    {
      name: 'STRICT_MODE_VIOLATION',
      input: {
        step: 'test-2',
        error: `getByText("Dashboard") resolved to 2 elements:\n  getByRole('link', { name: 'Dashboard' })\n  getByRole('heading', { name: 'Dashboard' })`,
        selector: 'getByText("Dashboard")',
        url: 'http://example.com'
      }
    },
    {
      name: 'NAVIGATION_TIMEOUT',
      input: {
        step: 'test-3',
        error: 'page.goto: Test timeout of 30000ms exceeded',
        selector: '',
        url: 'http://example.com'
      }
    }
    ,
    {
      name: 'VISIBILITY_TIMEOUT',
      input: {
        step: 'test-4',
        error: "waiting for locator('[data-test=\"submit\"]') to be visible, timeout 30000ms",
        selector: '[data-test="submit"]',
        url: 'http://example.com'
      }
    },
    {
      name: 'UNKNOWN_ERROR',
      input: {
        step: 'test-5',
        error: 'Some unexpected runtime error: foo bar baz',
        selector: '',
        url: 'http://example.com'
      }
    }
  ];

  for (const s of scenarios) {
    console.log('--- SCENARIO:', s.name);
    const r = await hf(s.input);
    console.log(JSON.stringify(r, null, 2));
    // Display persisted diagnostics file (latest)
    try {
      const diag = require('../dist/agents/self-healing/failure-store.js').failureStore.read();
      console.log('Persisted diagnostics:', JSON.stringify(diag, null, 2));
    } catch (e) {
      console.log('Could not read persisted diagnostics', String(e));
    }
    console.log('\n');
  }
})();
