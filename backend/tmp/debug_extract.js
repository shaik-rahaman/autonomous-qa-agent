const rawError = `Error: locator.fill: Test timeout of 30000ms exceeded.\nCall log:\n  - waiting for locator('[name="asdfdpassword"]')\n`;

function stripAnsi(s){ return String(s).replace(/\x1B\[[0-9;]*m/g,''); }
const cleaned = stripAnsi(rawError);
console.log('CLEANED:\n', cleaned);

// Try params.selector
let m = cleaned.match(/params\.selector\s*[=:]\s*['"]([^'\"]+)['"]/);
console.log('params.selector match:', m ? m[1] : null);

// waiting for locator bracket pattern
m = cleaned.match(/waiting for\s+locator\s*\(\s*['"]([\[\{][^'\"]*)['"]\s*\)/i);
console.log('bracketMatch:', m ? m[1] : null);

// waiting for locator quoted
m = cleaned.match(/waiting for\s+locator\s*\(\s*['"]([^'\"]+)['"]\s*\)/i);
console.log('quotedMatch:', m ? m[1] : null);

// direct locator()
m = cleaned.match(/locator\s*\(\s*['"]([^'\"]+)['"]\s*\)/i);
console.log('direct locator:', m ? m[1] : null);

// getBy patterns
m = cleaned.match(/getBy(Role|Text|Label|Placeholder|TestId)\s*\(([^)]+)\)/i);
console.log('getBy match:', m ? m[0] : null);

console.log('done');

// Additional simple checks
console.log('contains "waiting for locator" via includes:', cleaned.includes('waiting for locator'));
console.log('simple regex /waiting for\\s+locator/ match:', !!cleaned.match(/waiting for\s+locator/));

// Inspect character codes around the locator occurrence
const idx = cleaned.indexOf('locator');
if (idx !== -1) {
	const snippet = cleaned.substring(Math.max(0, idx-10), idx+40);
	console.log('locator snippet:', snippet);
	console.log('char codes:', Array.from(snippet).map(c => c.charCodeAt(0)).join(' '));
}

// Direct test on the isolated line
const line = "  - waiting for locator('[name=\"asdfdpassword\"]')\n";
console.log('isolated line test strict:', line.match(/waiting for\s+locator\s*\(\s*['"]([^'\"]+)['"]\s*\)/i));
console.log('isolated line test permissive:', line.match(/locator\s*\(([^)]+)\)/i));

const idx2 = cleaned.indexOf('waiting for');
if (idx2 !== -1) {
	const snippet2 = cleaned.substring(Math.max(0, idx2-10), idx2+80);
	console.log('waiting snippet:', snippet2);
	console.log('waiting char codes:', Array.from(snippet2).map(c => c.charCodeAt(0)).join(' '));
}
