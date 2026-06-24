import { chromium } from 'playwright';

interface FastPathResult {
  selector: string;
  confidence: number; // 0-1
}

// Simple Levenshtein distance (returns 0-100 similarity)
function getLevenshteinDistance(s1: string, s2: string): number {
  const a = s1 || '';
  const b = s2 || '';
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const matrix: number[][] = Array.from({ length: al + 1 }, (_, i) => Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) matrix[i][0] = i;
  for (let j = 0; j <= bl; j++) matrix[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[al][bl];
}

function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  const dist = getLevenshteinDistance(longer, shorter);
  return Math.max(0, Math.min(1, (longer.length - dist) / longer.length));
}

export async function fastPathHeal(failedSelector: string, targetUrl: string, timeoutMs = 3000): Promise<FastPathResult | null> {
  // Only handle simple selector forms
  const attrMatch = failedSelector.match(/^\[([a-zA-Z0-9\-]+)=['"]([^'\"]+)['"]\]$/);
  const idMatch = failedSelector.match(/^#([a-zA-Z0-9_\-]+)$/);
  const classMatch = failedSelector.match(/^\.([a-zA-Z0-9_\-\.]+)$/);
  if (!attrMatch && !idMatch && !classMatch) return null;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.max(5000, timeoutMs) });
    // Collect candidate elements
    const candidates = await page.$$eval('input,textarea,select,button,[data-testid]', (els) => {
      return els.map((el: any) => ({
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '',
        testid: el.getAttribute('data-testid') || '',
        classes: el.className || '',
      }));
    });

    let best: { selector: string; score: number } | null = null;

    if (attrMatch) {
      const attr = attrMatch[1];
      const value = attrMatch[2];
      for (const c of candidates) {
        const attrValue = (c as any)[attr] || '';
        const score = similarityScore(String(value).toLowerCase(), String(attrValue).toLowerCase());
        if (!best || score > best.score) best = { selector: `[${attr}="${attrValue}"]`, score };
      }
    } else if (idMatch) {
      const value = idMatch[1];
      for (const c of candidates) {
        const score = similarityScore(value.toLowerCase(), String(c.id || '').toLowerCase());
        if (!best || score > best.score) best = { selector: `#${c.id}`, score };
      }
    } else if (classMatch) {
      const value = classMatch[1];
      for (const c of candidates) {
        const score = similarityScore(value.toLowerCase(), String(c.classes || '').toLowerCase());
        if (!best || score > best.score) best = { selector: `.${c.classes.split(' ')[0] || ''}`, score };
      }
    }

    if (best && best.score >= 0.8) {
      return { selector: best.selector, confidence: Math.round(best.score * 100) / 100 };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    try { await page.close(); } catch (e) {}
    try { await browser.close(); } catch (e) {}
  }
}
