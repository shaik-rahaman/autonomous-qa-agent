# Postman API Collections & Environments

Complete Postman API collections for testing the Autonomous QA Agent Backend.

## 📦 Files Included

### Collections
- **`Autonomous_QA_Agent.postman_collection.json`** - Complete API collection with all endpoints and examples

### Environments
- **`Autonomous_QA_Agent_Development.postman_environment.json`** - Development environment (localhost:3000)
- **`Autonomous_QA_Agent_Production.postman_environment.json`** - Production environment template

## 📥 How to Import in Postman

### Step 1: Open Postman
- Launch Postman application or go to https://web.postman.co/

### Step 2: Import Collection
1. Click **Import** button (top left)
2. Select the **Files** tab
3. Choose `Autonomous_QA_Agent.postman_collection.json`
4. Click **Import**

### Step 3: Import Environment
1. Click **Import** button again
2. Select the **Files** tab
3. Choose `Autonomous_QA_Agent_Development.postman_environment.json` (or Production)
4. Click **Import**

### Step 4: Select Environment
1. In the top right, find the environment dropdown
2. Select **"Autonomous QA Agent - Development"**
3. Now all requests will use variables from the environment

## 🔌 API Endpoints Included

### Health & Info
- **GET** `/` - Root endpoint with API info
- **GET** `/api/health` - Health check

### Test Generation
- **POST** `/api/generate-test` - Generate test from English description
  - Example 1: Login workflow
  - Example 2: Dashboard/Shopping workflow
  - Example 3: Form submission workflow

### Test Management
- **GET** `/api/tests` - List all generated tests
- **GET** `/api/tests/:fileName` - Get specific test file

## 🧪 Quick Start Testing

### 1. Start the Backend Server
```bash
cd backend
npm install  (if not already done)
npm run dev
```

### 2. Import Collection and Environment in Postman

### 3. Test Health Check
1. Go to **Health & Info** folder
2. Click **Health Check** request
3. Press **Send**
4. Should see status 200 with `"status": "ok"`

### 4. Generate Your First Test
1. Go to **Test Generation** folder
2. Click **Generate Test - Login Example**
3. Press **Send**
4. You should get back a generated Playwright test script

### 5. List Generated Tests
1. Go to **Test Management** folder
2. Click **List All Generated Tests**
3. Press **Send**
4. See all tests that were generated

## 📝 Request Examples

### Generate Test Request
```json
{
  "testSteps": "1. Open login page 2. Enter username 3. Enter password 4. Click login",
  "url": "http://example.com/login",
  "context": {}
}
```

### Generate Test Response
```json
{
  "fileName": "open-login-page_v1.spec.ts",
  "code": "import { test, expect } from '@playwright/test';\n...",
  "timestamp": "2026-04-14T08:00:00.000Z",
  "version": 1
}
```

## 🔧 Environment Variables

### Development Environment
- `baseUrl`: http://localhost:3000
- `api_key`: mock_key_for_development
- `port`: 3000
- `protocol`: http
- `host`: localhost

### Production Environment
- `baseUrl`: https://api.autonomous-qa.example.com
- `api_key`: {{PROD_API_KEY}} (replace with actual key)
- `port`: 443
- `protocol`: https
- `host`: api.autonomous-qa.example.com

## 📊 Test Scripts Included

Pre-built test scripts for validation:
- ✅ Response status checks
- ✅ Required fields validation
- ✅ Content verification
- ✅ Data type checks

## 💡 Tips for Using the Collection

### Using Variables
- Use `{{baseUrl}}` in any URL to reference the environment variable
- Add more variables in the Environment settings

### Creating New Requests
1. Right-click on a folder
2. Select "Add Request"
3. Fill in method, URL, headers, body
4. Save and test

### Saving Responses
1. After running a request, view the response
2. Click **Save Response** to save as an example
3. Useful for documentation

### Using Pre-request Scripts
1. Go to request **Pre-request Script** tab
2. Add setup code that runs before request
3. Useful for generating tokens, timestamps, etc.

### Creating Test Scripts
1. Go to request **Tests** tab
2. Add assertions
3. Run request and check test results

## 🚀 Advanced Features

### Collections for Different Scenarios

#### Scenario 1: Test a Login Workflow
1. Use "Generate Test - Login Example"
2. Modify test steps in the request body
3. Send and get generated code

#### Scenario 2: Batch Test Generation
1. Generate multiple tests in sequence
2. Use "List All Generated Tests" to verify
3. Use "Get Specific Test File" to retrieve any test

#### Scenario 3: CI/CD Integration
1. Export collection and environment
2. Use Newman CLI: `newman run collection.json -e environment.json`
3. Generate HTML reports: `newman run collection.json -r html`

## 📋 Request Headers

All POST requests include:
- `Content-Type: application/json`

## ✅ Testing Checklist

- [ ] Import collection successfully
- [ ] Import environment successfully
- [ ] Test root endpoint (GET /)
- [ ] Test health check (GET /api/health)
- [ ] Test generate test endpoint (POST /api/generate-test)
- [ ] Test list tests endpoint (GET /api/tests)
- [ ] Test get specific test (GET /api/tests/:fileName)
- [ ] Verify generated test file location: `backend/data/tests/ui/generated/`

## 🐛 Troubleshooting

### Collection Won't Import
- Ensure file is valid JSON
- Check file path is correct
- Try downloading latest version of Postman

### Requests Failing
- Verify backend server is running
- Check environment is selected
- Look at response details for error message
- Check console (Cmd+Alt+C on Mac)

### Variables Not Showing
- Ensure environment is imported
- Check environment is selected in dropdown
- Verify variable names match `{{variableName}}`

### CORS Issues
- Backend should handle CORS
- Check browser console for errors
- Verify API allows requests from Postman

## 📞 Support

For issues or questions:
1. Check BACKEND_README.md in parent folder
2. Review API_EXAMPLES.sh for curl examples
3. Check server logs in terminal running `npm run dev`

## 📄 Files Location

```
backend/
├── Autonomous_QA_Agent.postman_collection.json
├── Autonomous_QA_Agent_Development.postman_environment.json
├── Autonomous_QA_Agent_Production.postman_environment.json
└── POSTMAN_README.md (this file)
```

---

**Collection Version**: 1.0.0  
**API Version**: v1.0  
**Updated**: April 14, 2026  

Happy Testing! 🚀
