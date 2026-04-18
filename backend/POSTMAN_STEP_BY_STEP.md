# 🧪 Postman Testing Guide - Step by Step

Complete guide to test the Autonomous QA Agent Backend API using Postman.

---

## 📋 Prerequisites

1. **Postman installed** - Download from https://www.postman.com/downloads/
2. **Backend server running** - Need to start npm dev server
3. **Collection & Environment files** - Already created in backend folder

---

## 🚀 STEP 1: Start the Backend Server

### Open Terminal and Run:

```bash
cd backend
npm run dev
```

**Expected Output:**
```
[QA-Agent] [DEBUG] MCPClient initialized http://localhost:4000
[QA-Agent] [SUCCESS] Server running on http://localhost:3000
[QA-Agent] [INFO] Available endpoints:
[QA-Agent] [INFO]   GET  /                  - API info
[QA-Agent] [INFO]   GET  /api/health        - Health check
[QA-Agent] [INFO]   POST /api/generate-test - Generate test
[QA-Agent] [INFO]   GET  /api/tests         - List tests
[QA-Agent] [INFO]   GET  /api/tests/:file   - Get test
```

✅ **Server is now running on http://localhost:3000**

---

## 📥 STEP 2: Import Collection

### 2A. Open Postman

Launch Postman Desktop Application (or go to https://web.postman.co/)

### 2B. Click Import Button

- Look for **Import** button in top-left area
- Or use keyboard shortcut: **Ctrl+O** (Windows) / **Cmd+O** (Mac)

### 2C. Select Files Tab

When import dialog opens:
- Click on **Files** tab
- Click **Choose Files** button

### 2D. Select Collection File

Navigate to your project:
```
backend/Autonomous_QA_Agent.postman_collection.json
```

- Select this file
- Click **Open**

### 2E. Import

Click the **Import** button in the dialog

**✅ Collection imported successfully!**

You should see in left sidebar:
- **Autonomous QA Agent Backend API** collection

---

## 🌍 STEP 3: Import Environment

### 3A. Click Import Again

- Click **Import** button (or **Ctrl+O** / **Cmd+O**)

### 3B. Select Files Tab

Click on **Files** tab again

### 3C. Select Environment File

Navigate to:
```
backend/Autonomous_QA_Agent_Development.postman_environment.json
```

- Select this file
- Click **Open**

### 3D. Import

Click **Import** button

**✅ Environment imported successfully!**

You should see:
- **Environments** in left sidebar
- New environment listed

---

## ⚙️ STEP 4: Select Environment

### 4A. Environment Dropdown

Look at **top-right** of Postman window:
- Find dropdown that says **"No Environment"** or similar

### 4B. Click Dropdown

Click it to see available environments

### 4C. Select Development Environment

Choose: **"Autonomous QA Agent - Development"**

**✅ Environment is now active!**

All variables are now ready:
- `baseUrl`: http://localhost:3000
- `port`: 3000
- etc.

---

## 🧪 STEP 5: Test Health Check (Simplest Test)

### 5A. Navigate to Request

In **left sidebar**, expand collection:
- **Autonomous QA Agent Backend API**
  - **Health & Info**
    - Click **Health Check**

### 5B. Review Request

You should see:
- **Method**: GET
- **URL**: http://localhost:3000/api/health

### 5C. Send Request

Click **Send** button (blue button on right side)

### 5D. View Response

Bottom panel shows response:
```json
{
  "status": "ok",
  "timestamp": "2026-04-14T08:00:00.000Z"
}
```

**✅ Status should be 200 OK**

---

## 📝 STEP 6: Test Root Endpoint

### 6A. Navigate to Request

In left sidebar:
- **Health & Info**
  - Click **Root Endpoint**

### 6B. Review Request

- **Method**: GET
- **URL**: http://localhost:3000/

### 6C. Send Request

Click **Send** button

### 6D. View Response

You should see:
```json
{
  "name": "Autonomous QA Agent Backend",
  "version": "1.0.0",
  "description": "Convert English test cases to Playwright TypeScript scripts",
  "endpoints": {
    "health": "GET /api/health",
    "generateTest": "POST /api/generate-test",
    "listTests": "GET /api/tests",
    "getTest": "GET /api/tests/:fileName"
  }
}
```

**✅ Shows all available endpoints**

---

## 🎯 STEP 7: Generate Your First Test (Login Example)

### 7A. Navigate to Request

In left sidebar:
- **Test Generation**
  - Click **Generate Test - Login Example**

### 7B. Review Request

You should see:
- **Method**: POST
- **URL**: http://localhost:3000/api/generate-test
- **Body** contains test steps (already filled in)

**Body preview:**
```json
{
  "testSteps": "1. Open login page 2. Enter username testuser@example.com 3. Enter password TestPassword123 4. Click login button 5. Wait for dashboard to load",
  "url": "http://example.com/login",
  "context": {}
}
```

### 7C. Send Request

Click **Send** button

### 7D. View Response

Response should contain:
- `fileName`: "open-login-page_v1.spec.ts"
- `code`: Complete Playwright test script
- `timestamp`: When it was generated
- `version`: 1

**✅ Test generated successfully!**

The response will include the full Playwright code.

---

## 🛒 STEP 8: Test Dashboard/Shopping Example

### 8A. Navigate to Request

In left sidebar:
- **Test Generation**
  - Click **Generate Test - Dashboard Example**

### 8B. Review Request

Body contains:
```json
{
  "testSteps": "1. Navigate to dashboard 2. Search for laptop 3. Click on first result 4. Add to cart 5. Proceed to checkout 6. Verify order summary",
  "url": "http://example.com/dashboard",
  "context": {}
}
```

### 8C. Send Request

Click **Send** button

### 8D. View Response

Should return generated test with:
- `fileName`: "navigate-to-dashboard_v1.spec.ts"
- Full Playwright code for dashboard testing

---

## 📋 STEP 9: Test Form Submission Example

### 9A. Navigate to Request

In left sidebar:
- **Test Generation**
  - Click **Generate Test - Form Submission Example**

### 9B. Review Request

Body contains registration form steps:
```json
{
  "testSteps": "1. Open registration form 2. Enter first name John 3. Enter last name Doe 4. Enter email john@example.com 5. Fill phone number 6. Accept terms 7. Click submit 8. Verify success message",
  "url": "http://example.com/register",
  "context": {
    "userType": "premium"
  }
}
```

### 9C. Send Request

Click **Send** button

### 9D. View Response

Returns generated test for form submission workflow

---

## 📊 STEP 10: List All Generated Tests

### 10A. Navigate to Request

In left sidebar:
- **Test Management**
  - Click **List All Generated Tests**

### 10B. Review Request

- **Method**: GET
- **URL**: http://localhost:3000/api/tests

### 10C. Send Request

Click **Send** button

### 10D. View Response

You'll see all tests generated so far:
```json
{
  "count": 3,
  "tests": [
    {
      "fileName": "open-login-page_v1.spec.ts",
      "version": 1,
      "timestamp": "2026-04-14T08:00:00.000Z",
      "url": "http://example.com/login"
    },
    {
      "fileName": "navigate-to-dashboard_v1.spec.ts",
      "version": 1,
      "timestamp": "2026-04-14T08:15:00.000Z",
      "url": "http://example.com/dashboard"
    },
    ...
  ]
}
```

**✅ Shows all generated tests with metadata**

---

## 🔍 STEP 11: Get Specific Test File

### 11A. Navigate to Request

In left sidebar:
- **Test Management**
  - Click **Get Specific Test File**

### 11B. Review Request

- **Method**: GET
- **URL**: http://localhost:3000/api/tests/open-login-page_v1.spec.ts

### 11C. Send Request

Click **Send** button

### 11D. View Response

Returns the complete test file with code:
```json
{
  "fileName": "open-login-page_v1.spec.ts",
  "version": 1,
  "timestamp": "2026-04-14T08:00:00.000Z",
  "url": "http://example.com/login",
  "code": "import { test, expect, Page } from '@playwright/test';\n..."
}
```

**✅ Shows full Playwright test code**

---

## 🔧 STEP 12: Create Your Own Test Step (Optional)

### 12A. Add New Test

Right-click on **Test Generation** folder:
- Click **Add Request**

### 12B. Set Up Request

- **Name**: My Custom Test
- **Method**: POST
- **URL**: {{baseUrl}}/api/generate-test

### 12C. Add Body

Click **Body** tab, select **raw** JSON:

```json
{
  "testSteps": "1. Open product page 2. Click add to cart 3. Fill address 4. Confirm payment 5. Verify order confirmation",
  "url": "http://example.com/products",
  "context": {
    "productId": "12345"
  }
}
```

### 12D. Send Request

Click **Send** button

### 12E. View Response

Your custom test will be generated!

---

## ✅ STEP 13: Verification Checklist

Done with all tests? Verify everything:

- [ ] ✅ Health Check returned 200 OK
- [ ] ✅ Root Endpoint showed all endpoints
- [ ] ✅ Login test generated successfully
- [ ] ✅ Dashboard test generated successfully
- [ ] ✅ Form test generated successfully
- [ ] ✅ List tests showed 3+ tests
- [ ] ✅ Get specific test returned full code

**If all checked: 🎉 All tests passing!**

---

## 📂 Where Are Files Saved?

Generated test files are saved in:
```
backend/data/tests/ui/generated/
```

Check in terminal/file explorer:
- `open-login-page_v1.spec.ts`
- `navigate-to-dashboard_v1.spec.ts`
- `open-registration-form_v1.spec.ts`
- Corresponding `.meta.json` files

---

## 🐛 Troubleshooting

### "Cannot GET /" Error
**Problem**: Server not running
**Solution**: 
1. Open new terminal
2. Run `cd backend && npm run dev`
3. Wait for success message
4. Try request again

### "No Environment" Selected
**Problem**: Tests using variables fail
**Solution**:
1. Top-right dropdown
2. Select "Autonomous QA Agent - Development"
3. Retry request

### Collection Not Importing
**Problem**: File not found
**Solution**:
1. Check file location: `backend/Autonomous_QA_Agent.postman_collection.json`
2. Ensure it's valid JSON
3. Try importing again

### Request body not showing
**Problem**: May not be in Body tab
**Solution**:
1. Click **Body** tab
2. Click **raw** radio button
3. Select **JSON** format
4. Body will appear

### Response is Error 404
**Problem**: Endpoint not found
**Solution**:
1. Check URL spelling
2. Ensure baseUrl is correct
3. Check environment is selected
4. Verify server is running

---

## 💡 Pro Tips

### 1. Save Responses
After getting response:
- Click **Save Response**
- Creates example for documentation

### 2. Use Collections for CI/CD
Export and use with Newman:
```bash
newman run Autonomous_QA_Agent.postman_collection.json \
  -e Autonomous_QA_Agent_Development.postman_environment.json
```

### 3. Pre-populate Variables
Before running request:
1. Click **Pre-request Script** tab
2. Add setup code
3. Runs automatically before request

### 4. Test Assertions
After running request:
1. Click **Tests** tab
2. See test results
3. Validate response data

### 5. View History
In left sidebar:
- **History** shows all recent requests
- Useful for retrying requests

---

## 🎯 Typical Testing Workflow

```
1. Start server (npm run dev)
   ↓
2. Import collection
   ↓
3. Import environment
   ↓
4. Select development environment
   ↓
5. Test Health Check (confirm server alive)
   ↓
6. Generate test (POST /api/generate-test)
   ↓
7. List tests (GET /api/tests)
   ↓
8. Get specific test (GET /api/tests/:file)
   ↓
9. Check generated files in backend/data/tests/ui/generated/
```

---

## 📖 Additional Resources

In backend folder:
- `README_BACKEND.md` - API documentation
- `BACKEND_README.md` - Technical details
- `POSTMAN_README.md` - Postman setup
- `API_EXAMPLES.sh` - cURL examples

---

## 🚀 Next Steps

After testing all endpoints:
1. Modify test steps for your use cases
2. Generate tests automatically
3. Integrate into CI/CD pipeline
4. Export and share with team

---

**Happy Testing! 🎉**

If you get stuck, check the troubleshooting section or review backend logs in terminal.
