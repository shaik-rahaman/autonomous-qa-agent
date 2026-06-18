(async () => {
  try {
    const { runWithLangChain } = require('../dist/orchestrator/langchain.orchestrator');
    const input = {
      testFile: 'temp-1780410093741-e0df9647.spec.ts',
      targetUrl: 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login',
      projectRoot: '.'
    };
    console.log('Invoking runWithLangChain with input:', input);
    const res = await runWithLangChain(input);
    console.log('Orchestrator result:\n', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Orchestrator invocation failed:', err);
    process.exit(1);
  }
})();
