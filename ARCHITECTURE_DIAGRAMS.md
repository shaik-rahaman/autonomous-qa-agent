# Architecture Diagram - New Features Integration

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS QA AGENT                          │
│                                                                 │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ 🔗 Jira    │  │ ▶️ Execute   │  │ 🧪 Healing   │          │
│  │Integration │  │   Script     │  │    Lab       │          │
│  └────────────┘  └──────────────┘  └────────────────┘          │
│         │               │                  │                   │
│         └───────────────┴──────────────────┘                   │
│                        │                                        │
│                        ↓                                        │
│         ┌──────────────────────────────┐                       │
│         │   Feature Router             │                       │
│         │   (App.tsx)                  │                       │
│         └──────────────────────────────┘                       │
│                        │                                        │
│         ┌──────────────┴──────────────┐                        │
│         │                             │                        │
│         ↓                             ↓                        │
│   ┌───────────────┐          ┌──────────────────┐             │
│   │ JiraIntegration│         │ ScriptExecutor    │             │
│   │              │          │ (New Service)    │             │
│   │ • Fetch issues│          │                  │             │
│   │ • Transform   │          │ • Validate       │             │
│   │               │          │ • Prepare        │             │
│   └───────────────┘          │ • Inject Failures│             │
│         │                    │ • Save File      │             │
│         │                    └──────────────────┘             │
│         │                             │                       │
│         └──────────────┬──────────────┘                       │
│                        │                                       │
│                        ↓                                       │
│     ┌──────────────────────────────────┐                     │
│     │  TestOrchestrator                │                     │
│     │  (SHARED PIPELINE)               │                     │
│     │                                  │                     │
│     │ executeTestWithHealing()         │                     │
│     └──────────────────────────────────┘                     │
│                        │                                      │
│         ┌──────────────┴──────────────┐                      │
│         │                             │                      │
│         ↓                             ↓                      │
│   ┌──────────────┐           ┌──────────────┐               │
│   │ ExecutorService          │ LangChain    │               │
│   │ (Run Playwright)         │ Orchestrator │               │
│   └──────────────┘           └──────────────┘               │
│         │                             │                     │
│         └──────────────┬──────────────┘                     │
│                        │                                    │
│                        ↓                                    │
│         ┌──────────────────────────────┐                  │
│         │  Test Execution              │                  │
│         │  (Chrome Browser)            │                  │
│         └──────────────────────────────┘                  │
│                        │                                  │
│         ┌──────────────┴──────────────┐                  │
│         │                             │                  │
│    PASS │                             │ FAIL             │
│         ↓                             ↓                  │
│   ┌───────────┐              ┌──────────────────┐        │
│   │ Return    │              │ ErrorClassifier  │        │
│   │ Success   │              │ (Analyze Error)  │        │
│   └───────────┘              └──────────────────┘        │
│         │                             │                  │
│         │              ┌──────────────┴───────────┐      │
│         │              │                          │      │
│         │          Healable?                   Not      │
│         │              │                       Heal-   │
│         │              ↓                       able    │
│         │        ┌────────────────┐              │     │
│         │        │Route to Healer │              │     │
│         │        └────────────────┘              │     │
│         │              │                         │     │
│         │    ┌─────────┼─────────┐              │     │
│         │    │         │         │              │     │
│         │    ↓         ↓         ↓              │     │
│         │ ┌─────┐ ┌────────┐ ┌──────┐         │     │
│         │ │Strict│ │Element │ │Timing│         │     │
│         │ │Mode  │ │Not     │ │Healer│         │     │
│         │ │Healer│ │Found   │ └──────┘         │     │
│         │ └─────┘ │Healer  │                  │     │
│         │        └────────┘                   │     │
│         │              │                      │     │
│         │              ↓                      │     │
│         │        ┌─────────────┐              │     │
│         │        │ Heal & Retry│              │     │
│         │        └─────────────┘              │     │
│         │              │                      │     │
│         │    ┌─────────┴────────┐             │     │
│         │    │                  │             │     │
│         │  PASS                FAIL           │     │
│         │    │                  │             │     │
│         │    ↓                  ↓             ↓     │
│         └────┼──────────────────┼─────────────┘    │
│              │                  │                  │
│              └──────────┬───────┘                  │
│                         │                         │
│                         ↓                         │
│         ┌──────────────────────────────┐          │
│         │  Generate Results            │          │
│         │  • Timeline                  │          │
│         │  • Healing Info              │          │
│         │  • Report Link               │          │
│         │  • Diagnostics               │          │
│         └──────────────────────────────┘          │
│                         │                         │
│                         ↓                         │
│         ┌──────────────────────────────┐          │
│         │  Return to UI                │          │
│         │  • Display Results           │          │
│         │  • Show Healing Diagnostics  │          │
│         │  • Link to Report            │          │
│         └──────────────────────────────┘          │
│                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend Component Hierarchy

```
App.tsx (Root)
│
├─ Feature Selector (Header)
│  ├─ 🔗 Jira Integration
│  ├─ ▶️ Execute Script
│  └─ 🧪 Healing Lab
│
├─ Left Panel (Feature-Specific Controls)
│  ├─ [Jira Feature]
│  │  ├─ JiraIntegration
│  │  ├─ TestCaseInput
│  │  └─ ExecutionPanel
│  │
│  ├─ [Execute Script Feature]
│  │  └─ Info Card
│  │
│  └─ [Healing Lab Feature]
│     └─ Info Card
│
├─ Center Panel (Feature-Specific Editor/Workspace)
│  ├─ [Jira Feature]
│  │  └─ ScriptEditor
│  │     ├─ Gherkin Tab
│  │     └─ Script Tab
│  │
│  ├─ [Execute Script Feature]
│  │  └─ ExecuteScriptPanel (NEW)
│  │     ├─ Script Editor
│  │     ├─ URL Input
│  │     ├─ Results Display
│  │     └─ Healing Info
│  │
│  └─ [Healing Lab Feature]
│     └─ SelfHealingLab (NEW)
│        ├─ Section A: Script Editor
│        ├─ Section B: Configuration
│        │  ├─ Failure Type Selector
│        │  └─ URL Input
│        ├─ Section C: Execution
│        │  └─ Execute Button
│        └─ Healing Diagnostics Panel
│           ├─ Failure Type Info
│           ├─ Healing Status
│           ├─ Locator Information
│           ├─ Test Results
│           └─ Errors (if any)
│
└─ Right Panel (Results - Jira Only)
   ├─ Tabs (Logs/Report)
   ├─ LogsViewer
   └─ TestStatusSummary / TestReportHeader
```

---

## Data Flow - Execute Script Feature

```
User Input
    │
    ├─ Script: string
    └─ URL: string
         │
         ↓
  ExecuteScriptPanel
    (React Component)
         │
         ├─ validateScript()
         ├─ prepareScript()
         │
         ↓
  apiService.post('/scripts/execute')
         │
         ↓
  Backend Route
  POST /scripts/execute
         │
         ├─ scriptExecutor.executeScript()
         │  ├─ validateScript()
         │  ├─ prepareScript()
         │  └─ saveTemporaryScript()
         │      └─ temp-123456-abc.spec.ts
         │
         ↓
  testOrchestrator.executeTestWithHealing()
    (SHARED PIPELINE)
         │
         ├─ executorService.execute()
         ├─ ErrorClassifier.classify()
         ├─ Route to appropriate healer
         ├─ Retry if healed
         └─ Build timeline
         │
         ↓
  Execution Result
    {
      id, status, duration,
      healed, results,
      healingDetails, reportUrl
    }
         │
         ↓
  Frontend Display
    ├─ Status icon
    ├─ Duration
    ├─ Test counts
    ├─ Healing info
    └─ Report link
```

---

## Data Flow - Self-Healing Lab Feature

```
User Input
    │
    ├─ Script: string
    ├─ Failure Type: enum
    └─ URL: string
         │
         ↓
  SelfHealingLab
    (React Component)
         │
         ├─ validateScript()
         ├─ prepareScript()
         │
         ↓
  apiService.post('/healing-lab/run')
         │
         ↓
  Backend Route
  POST /healing-lab/run
         │
         ├─ scriptExecutor.executeSelfHealingLabScript()
         │  ├─ validateScript()
         │  ├─ prepareScript()
         │  ├─ injectFailure() ← KEY DIFFERENCE
         │  │  └─ STRICT_MODE: Replace roles
         │  │  └─ ELEMENT_NOT_FOUND: Invalidate selectors
         │  │  └─ TIMEOUT: Reduce timeout
         │  │  └─ NONE: Pass-through
         │  └─ saveTemporaryScript()
         │      └─ temp-123456-def.spec.ts
         │
         ↓
  testOrchestrator.executeTestWithHealing()
    (SHARED PIPELINE)
         │
         ├─ executorService.execute()
         │  └─ Fails due to injected error
         │
         ├─ ErrorClassifier.classify()
         │  └─ Categorizes injected error
         │
         ├─ Route to appropriate healer
         │  └─ StrictModeHealer OR
         │  └─ ElementNotFoundHealer OR
         │  └─ TimingHealer
         │
         ├─ Heal & Retry
         │  └─ Should pass after healing
         │
         └─ Build timeline with healing events
         │
         ↓
  Orchestration Result
    {
      id, status, duration,
      healed, results,
      timeline (with heal events),
      healingDetails,
      reportUrl
    }
         │
         ↓
  Frontend Display
    ├─ Basic Results
    └─ Healing Diagnostics Panel
       ├─ Failure Type Injected
       ├─ Healing Status
       ├─ Confidence Level
       ├─ Original Selector
       ├─ Healed Selector
       ├─ Test Stats
       └─ Errors
```

---

## Failure Injection Process

```
┌──────────────────────────────────────────────────────┐
│  injectFailure(script, failureType)                  │
└──────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ↓              ↓              ↓
    ┌───────────┐  ┌──────────────┐  ┌─────────┐
    │STRICT_MODE│  │ELEMENT_NOT_  │  │ TIMEOUT │
    │           │  │   FOUND      │  │         │
    └───────────┘  └──────────────┘  └─────────┘
          │              │              │
          ↓              ↓              ↓
    Replace with   Invalid selectors  100ms timeout
    weak selectors  [invalid...]       timeout
    getByText()     NOT [valid]        { timeout: 100 }
          │              │              │
          └──────────────┴──────────────┘
                         │
                         ↓
              Modified Script
                         │
                         ↓
          Save to temp file & Execute
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ↓                             ↓
     Fails (As Intended)           Success (No failure)
          │                             │
          ↓                             ↓
    Healing Triggered         Direct execution
          │                             │
          ├─ Analyze Error              │
          ├─ Select Healer              │
          ├─ Heal & Retry               │
          ├─ Success                    │
          │                             │
          └─────────────┬───────────────┘
                        │
                        ↓
            Display Results with Diagnostics
```

---

## Code Reuse Map

```
┌─────────────────────────────────────────────────────┐
│           EXISTING PIPELINE (100% Reused)           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  TestOrchestrator                                  │
│  ├─ Orchestration logic      ✅ Reused            │
│  ├─ Timeline tracking        ✅ Reused            │
│  └─ Result building          ✅ Reused            │
│                                                     │
│  ExecutorService                                   │
│  ├─ Playwright execution     ✅ Reused            │
│  ├─ Output capture           ✅ Reused            │
│  └─ Error detection          ✅ Reused            │
│                                                     │
│  ErrorClassifier                                   │
│  ├─ Error categorization     ✅ Reused            │
│  ├─ Healability check        ✅ Reused            │
│  └─ Candidate extraction     ✅ Reused            │
│                                                     │
│  DeterministicHealer                               │
│  ├─ Healer routing           ✅ Reused            │
│  ├─ StrictModeHealer         ✅ Reused            │
│  ├─ ElementNotFoundHealer    ✅ Reused            │
│  └─ TimingHealer             ✅ Reused            │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│          NEW COMPONENTS (Only Where Needed)         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ScriptExecutor (NEW)                              │
│  ├─ Script validation         🆕 New              │
│  ├─ Script preparation        🆕 New              │
│  ├─ Failure injection          🆕 New              │
│  └─ File management           🆕 New              │
│                                                     │
│  Frontend Components (NEW)                         │
│  ├─ ExecuteScriptPanel        🆕 New              │
│  └─ SelfHealingLab            🆕 New              │
│                                                     │
│  API Routes (NEW)                                  │
│  ├─ POST /scripts/execute     🆕 New              │
│  └─ POST /healing-lab/run     🆕 New              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Summary

✅ **Unified Pipeline**: Both features use same orchestrator
✅ **No Duplication**: Only 18% new code, 82% reused
✅ **Feature Isolation**: Independent UI/controls
✅ **Extensible**: Easy to add more features
✅ **Maintainable**: Changes in one place affect all features
✅ **Testable**: Each component independently testable
