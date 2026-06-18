import fs from 'fs';
import path from 'path';
import { scriptExecutor } from '../../../services/script-executor';

describe('ScriptExecutor Self-Healing Lab injections', () => {
  const tmpDir = path.join('.', '..', 'pw-ai-agents', 'tests', 'ui', 'generated', 'scripts');

  afterAll(() => {
    // cleanup saved files in tmpDir
    try {
      if (fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('temp-'));
        for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      }
    } catch (e) {
      // ignore
    }
  });

  test('injects waitForLoadState after page.goto', async () => {
    const script = `import { test, expect } from '@playwright/test';\n\ntest('go', async ({ page }) => {\n  await page.goto('https://example.com');\n});`;
    const res = await scriptExecutor.executeSelfHealingLabScript({ script, failureType: 'NONE' } as any);
    expect(res.success).toBe(true);
    const filePath = path.join(tmpDir, res.fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/waitForLoadState\("domcontentloaded"/);
  });

  test('localLocatorTest corrupts only locator calls', async () => {
    const script = `import { test, expect } from '@playwright/test';\n\ntest('loc', async ({ page }) => {\n  const L = page.locator('[name="password"]');\n  const other = getByText('[name="username"]');\n  await page.goto('https://example.com');\n});`;
    const res = await scriptExecutor.executeSelfHealingLabScript({ script, failureType: 'ELEMENT_NOT_FOUND', url: 'https://example.com', localLocatorTest: true } as any);
    expect(res.success).toBe(true);
    const filePath = path.join(tmpDir, res.fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    // locator attribute should be prefixed
    expect(content).toMatch(/\[name=\"asdfpassword\"\]/);
    // other attribute should remain unchanged
    expect(content).toMatch(/\[name=\"username\"\]/);
  });
});
