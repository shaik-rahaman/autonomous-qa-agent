# Testing Guide - New Features

## Pre-Test Setup

### 1. Start Backend
```bash
cd backend
npm install  # if not done
npm run build
npm start
```
Expected: Server running on http://localhost:3000

### 2. Start Frontend
```bash
cd frontend
npm install  # if not done
npm run build
npm run dev
```
Expected: Frontend running on http://localhost:5173

### 3. Verify Both Are Running
- Backend: POST requests should go to http://localhost:3000
- Frontend: Should display all 3 feature buttons in header

---

## Test 1: Feature Switcher Works

### Steps
1. Open frontend on localhost:5173
2. Verify 3 buttons in header:
   - 🔗 Jira Integration
   - ▶️ Execute Script
   - 🧪 Healing Lab
3. Click each button
4. Verify:
   - Left panel changes
   - Center panel changes
   - Right panel hidden for new features

### Expected Results
```
🔗 Jira:
  ├─ Left: JiraIntegration, TestCaseInput, ExecutionPanel
  ├─ Center: ScriptEditor
  └─ Right: Logs/Report tabs

▶️ Execute Script:
  ├─ Left: Info card (hidden controls)
  ├─ Center: ExecuteScriptPanel
  └─ Right: Hidden

🧪 Healing Lab:
  ├─ Left: Info card (hidden controls)
  ├─ Center: SelfHealingLab
  └─ Right: Hidden
```

---

## Test 2: Execute Script - Basic Flow

### Setup
Before running this test, you need a test website. Options:
- Use `https://example.com` (basic test)
- Use `https://opensource-demo.orangehrm.com` (real app)
- Use local test server

### Step-by-Step

**Step 1: Navigate to Execute Script**
```
Click ▶️ Execute Script button
```
Expected: Center panel shows ExecuteScriptPanel

**Step 2: Enter Target URL**
```
Input Field "Target URL":
https://example.com
```
Expected: URL accepted in input field

**Step 3: Enter Test Script**
```
Click "📋 Paste Example" button
```
Expected: Sample script populated in textarea:
```typescript
import { test, expect } from '@playwright/test';

test('verify example.com loads', async ({ page }) => {
  await page.goto('https://example.com');
  expect(page.url()).toContain('example.com');
});
```

**Step 4: Execute Script**
```
Click ▶️ Execute Script button
```
Expected:
- Button shows "Executing..." state
- UI shows loading spinner
- Backend processes script

**Step 5: View Results**
Expected results display:
```
Status: PASSED ✓
Duration: 2345ms
PASSED: 1  FAILED: 0  SKIPPED: 0
Healed: NO
```

### Success Criteria
✅ Script executed without errors
✅ Results displayed
✅ Duration shows real milliseconds
✅ No JavaScript console errors

---

## Test 3: Execute Script - With OrangeHRM

### Setup
Assuming OrangeHRM demo is running at:
`https://opensource-demo.orangehrm.com`

Credentials:
- Username: Admin
- Password: admin123

### Steps

**Step 1: Navigate to Execute Script**
```
Click ▶️ Execute Script
```

**Step 2: Enter URL**
```
Target URL: https://opensource-demo.orangehrm.com
```

**Step 3: Paste OrangeHRM Test**
```
Script:
import { test, expect } from '@playwright/test';

test('orangehrm login and verify dashboard', async ({ page }) => {
  await page.goto('https://opensource-demo.orangehrm.com');
  
  // Login
  await page.fill('[placeholder="Username"]', 'Admin');
  await page.fill('[placeholder="Password"]', 'admin123');
  await page.click('button[type="submit"]');
  
  // Wait for dashboard
  await page.waitForURL('**/dashboard');
  
  // Verify dashboard heading
  const heading = page.locator('h6:has-text("Dashboard")');
  await expect(heading).toBeVisible();
});
```

**Step 4: Execute**
```
Click ▶️ Execute Script
```

**Step 5: View Results**
Expected:
```
Status: PASSED ✓
Duration: 5000-8000ms (depending on network)
PASSED: 1  FAILED: 0  SKIPPED: 0
Healed: NO (if all selectors worked)
```

### Success Criteria
✅ Test completes successfully
✅ Correct login flow executed
✅ Dashboard verified
✅ Results show passed

---

## Test 4: Self-Healing Lab - Strict Mode

### Setup
Same as Test 3. OrangeHRM should be running.

### Steps

**Step 1: Navigate to Healing Lab**
```
Click 🧪 Healing Lab
```
Expected: Center panel shows SelfHealingLab

**Step 2: Paste Test Script**
```
Click "📋 Paste OrangeHRM Example" button
```
Expected: Full OrangeHRM test populates

**Step 3: Select Failure Type**
```
Failure Type Dropdown: Select "Strict Mode Violation"
Target URL: https://opensource-demo.orangehrm.com
```

**Step 4: Execute With Healing**
```
Click ⚡ Execute With Healing button
```
Expected:
- Button shows "Executing & Healing..."
- Backend:
  1. Validates script
  2. Injects Strict Mode failure (replaces getByText with weak selector)
  3. Executes modified script
  4. Error detected (Strict Mode)
  5. Healing applied
  6. Test retried with proper selector
  7. Results returned

**Step 5: View Healing Diagnostics**
Expected diagnostics panel shows:
```
📊 Healing Diagnostics

Failure Type:      STRICT_MODE ⚠️
Status:            PASSED ✓
Healing Applied:   YES ✓
Confidence:        HIGH

📍 Locator Information
Original: getByText(/Dashboard/i)
Healed: getByRole('heading', { name: 'Dashboard' })

📈 Test Results
PASSED: 1  FAILED: 0
Duration: 6234ms
Retries: 1

Errors: None
```

### Success Criteria
✅ Strict mode error injected
✅ Healing detected error
✅ Healing applied successfully
✅ Test passed after healing
✅ Confidence shows HIGH
✅ Diagnostics display correctly
✅ Original → Healed selectors shown

---

## Test 5: Self-Healing Lab - Element Not Found

### Steps

**Step 1: Navigate to Healing Lab**
```
Click 🧪 Healing Lab
```

**Step 2: Paste Test**
```
Script:
import { test, expect } from '@playwright/test';

test('with valid selectors', async ({ page }) => {
  await page.goto('https://opensource-demo.orangehrm.com');
  
  // These selectors are valid in OrangeHRM
  const username = page.locator('[placeholder="Username"]');
  await username.fill('Admin');
  
  const password = page.locator('[placeholder="Password"]');
  await password.fill('admin123');
  
  const submit = page.locator('button[type="submit"]');
  await submit.click();
  
  await page.waitForURL('**/dashboard');
  await expect(page.locator('h6:has-text("Dashboard")')).toBeVisible();
});
```

**Step 3: Select Failure Type**
```
Failure Type: "Element Not Found"
Target URL: https://opensource-demo.orangehrm.com
```

**Step 4: Execute**
```
Click ⚡ Execute With Healing
```

**Step 5: Expected Flow**
```
1. Injection replaces [placeholder="Username"] 
   with [placeholder="InvalidUsername"]
   
2. Execution tries to fill invalid field
   
3. Error: Element not found
   
4. ErrorClassifier recognizes error type
   
5. ElementNotFoundHealer activates:
   - Try without :visible
   - Try parent container
   - Try CSS fallback
   - OR TimingHealer retries with wait
   
6. If healing succeeds, test passes
```

**Step 6: View Results**
Expected:
```
Status: PASSED ✓ or FAILED ❌
Healing Applied: YES
Confidence: HIGH or MEDIUM
Original: [placeholder="Username"]
Healed: [type="text"] (if fallback used)
```

### Success Criteria
✅ Element not found error injected
✅ Healing applied via fallback or retry
✅ Either passes (healing worked) or fails (expected)
✅ Confidence level appropriate

---

## Test 6: Self-Healing Lab - Timeout

### Steps

**Step 1: Navigate to Healing Lab**
```
Click 🧪 Healing Lab
```

**Step 2: Paste Test**
```
Script:
import { test, expect } from '@playwright/test';

test('slow element', async ({ page }) => {
  await page.goto('https://opensource-demo.orangehrm.com');
  
  const heading = page.locator('h6:has-text("Dashboard")');
  await expect(heading).toBeVisible({ timeout: 10000 });
});
```

**Step 3: Select Failure Type**
```
Failure Type: "Timeout"
Target URL: https://opensource-demo.orangehrm.com
```

**Step 4: Execute**
```
Click ⚡ Execute With Healing
```

**Step 5: Expected Flow**
```
1. Injection reduces timeout from 10000ms to 100ms
   
2. Element likely won't appear in 100ms
   
3. Timeout error occurs
   
4. ErrorClassifier recognizes timeout
   
5. TimingHealer activates:
   - Wait for networkidle
   - Wait additional 2 seconds
   - Retry with original selector
   
6. Now element is visible, test passes
```

**Step 6: View Results**
Expected:
```
Status: PASSED ✓
Healing Applied: YES
Confidence: HIGH
Original Selector: h6:has-text("Dashboard")
Healed: h6:has-text("Dashboard") (same, but with wait)
```

### Success Criteria
✅ Timeout error injected (100ms)
✅ Timing healer activates
✅ Test passes after healing
✅ Confidence shows HIGH

---

## Test 7: Self-Healing Lab - No Failure

### Steps

**Step 1: Navigate to Healing Lab**

**Step 2: Paste Valid Test**

**Step 3: Select Failure Type**
```
Failure Type: "None"
```

**Step 4: Execute**
```
Click ⚡ Execute With Healing
```

**Step 5: Expected Results**
```
Status: PASSED ✓
Healing Applied: NO
Confidence: N/A (no healing needed)
```

### Success Criteria
✅ No failure injected
✅ Test runs normally
✅ Healing not applied
✅ Results show clean pass

---

## Test 8: Script Validation

### Invalid Script Test 1: Missing imports
```
Script (Invalid):
test('no imports', async ({ page }) => {
  await page.goto('https://example.com');
});
```

Expected Error:
```
Error: Script must contain import statements for @playwright/test
```

### Invalid Script Test 2: Missing test function
```
Script (Invalid):
import { test, expect } from '@playwright/test';

await page.goto('https://example.com');
```

Expected Error:
```
Error: Script must contain test() or it() function
```

### Invalid Script Test 3: Brace mismatch
```
Script (Invalid):
import { test, expect } from '@playwright/test';

test('missing brace', async ({ page }) => {
  await page.goto('https://example.com');
  // Missing closing brace
```

Expected Error:
```
Error: Script has unmatched braces
```

### Success Criteria
✅ All validation errors caught
✅ Clear error messages shown
✅ User can fix and retry

---

## Test 9: Report Generation

### Steps

**Step 1: Execute any test**
```
Execute any passing or failing test
```

**Step 2: Look for Report Link**
Expected: "📈 View Full Report" link appears

**Step 3: Click Report Link**
```
Click report link
```

**Step 4: View HTML Report**
Expected: Playwright HTML report opens with:
- Test summary
- Trace view (if available)
- Screenshot on failure
- Video on failure

### Success Criteria
✅ Report link present
✅ Report opens
✅ Report contains test info

---

## Test 10: Error Handling

### Test API Call Failure

**Setup**: Stop backend server

**Step 1: Try Execute Script**
```
Click ▶️ Execute Script
Paste script
Click Execute
```

**Expected**: Error message shown
```
Error: Cannot reach server
Please check backend is running
```

**Step 2: Restart Backend**
```
npm start (in backend folder)
```

**Step 3: Retry**
```
Click Execute again
```

**Expected**: Now succeeds

### Success Criteria
✅ Error handled gracefully
✅ User-friendly message shown
✅ Can retry after fix

---

## Test 11: UI Responsiveness

### Steps

**Step 1: Enter very long script**
```
Paste a 500-line Playwright test
```

**Step 2: Click Execute**
```
Don't wait for result, click other buttons
```

**Expected**:
- UI remains responsive
- Can switch features
- Cancel button (if available) works

### Success Criteria
✅ UI doesn't freeze
✅ Can interact during execution
✅ Real-time updates shown

---

## Test 12: Cross-Browser Compatibility

Test in multiple browsers (if applicable):
- Chrome
- Firefox
- Safari
- Edge

### For each browser, verify:
✅ Feature buttons work
✅ TextArea input works
✅ Dropdown selection works
✅ Results display correctly
✅ Report links work

---

## Checklist

### Functionality
- [ ] Feature switcher works (3 buttons)
- [ ] Execute Script executes
- [ ] Healing Lab executes
- [ ] Results display correctly
- [ ] Healing diagnostics show
- [ ] Reports generate
- [ ] Error handling works

### UI/UX
- [ ] Buttons are clickable
- [ ] Text is readable
- [ ] Colors are consistent
- [ ] Responsive on different sizes
- [ ] Loading states clear
- [ ] Errors clearly displayed

### Backend
- [ ] /scripts/execute endpoint works
- [ ] /healing-lab/run endpoint works
- [ ] Validation works
- [ ] Failure injection works
- [ ] Orchestrator called correctly
- [ ] Results formatted correctly

### Healing
- [ ] Strict Mode healing works
- [ ] Element Not Found healing works
- [ ] Timeout healing works
- [ ] Confidence levels accurate
- [ ] Original → Healed selectors shown

### Build
- [ ] Backend builds: `npm run build` ✅
- [ ] Frontend builds: `npm run build` ✅
- [ ] No TypeScript errors
- [ ] No console errors

---

## Quick Validation Script

Run this for quick validation:

```bash
# Terminal 1: Backend
cd backend
npm run build && npm start

# Terminal 2: Frontend
cd frontend  
npm run build && npm run dev

# Browser (localhost:5173)
# 1. Verify 3 buttons in header
# 2. Click ▶️ Execute Script
# 3. Paste example
# 4. Click Execute
# 5. Verify results show
# 6. Click 🧪 Healing Lab
# 7. Select "Strict Mode"
# 8. Click Execute
# 9. Verify healing diagnostics
```

Expected time: ~2 minutes
Expected result: All features work

---

## Performance Baseline

Record these for comparison:

| Operation | Expected Time | Actual Time |
|-----------|---------------|-------------|
| Script validation | <50ms | ____ |
| Script execution | 5-30s | ____ |
| Healing (if needed) | 5-10s | ____ |
| Total e2e (success) | 5-30s | ____ |
| Total e2e (heal) | 10-40s | ____ |

---

## Troubleshooting

### Issue: "Cannot connect to backend"
**Solution**: 
1. Ensure backend running: `cd backend && npm start`
2. Check port 3000 available
3. Check no firewall blocking

### Issue: "Script validation always fails"
**Solution**:
1. Ensure imports are present
2. Ensure test function exists
3. Check braces match

### Issue: "Healing not applying"
**Solution**:
1. Check error type matches selector
2. Try simpler test first
3. Check browser console for errors

### Issue: "Results not displaying"
**Solution**:
1. Check backend response format
2. Check API response in browser Network tab
3. Check browser console for errors

---

## Sign-Off

Date tested: __________
Tester: __________
Build: ✅ Backend / ✅ Frontend
Features: ✅ Execute Script / ✅ Healing Lab
All tests: ✅ PASS / ❌ FAIL

Notes: ___________________________________
