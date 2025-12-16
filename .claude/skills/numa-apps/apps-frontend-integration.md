# Numa Apps: Frontend Integration

This document explains how the Numa frontend integrates with apps, including the React components, services, and state management patterns.

---

## 1. Frontend Pages for Apps

### Main App Pages

- `/numa-frontend/src/Pages/AppDetail.tsx` - Main entry point for viewing a single app
  - Loads app manifest data from `manifestService.fetchAppById(appId)`
  - Handles app metadata display (name, description, category, tags, status)
  - Renders either PolicyBuilderDetail, PolicyReviewerDetail, or the generic AppWizard
  - Manages job history visibility and job naming toggle
  - Uses `useNumaApp()` context for state management

- `/numa-frontend/src/Pages/Dash.tsx` - Dashboard listing all available apps
  - Shows app cards with available actions
  - Filters by category and status

---

## 2. Key Services for App Interaction

### A. jobsApi.tsx - Job Lifecycle Management

The core service for app job operations:

```typescript
// Create a new job run
createJob(numaAppData, taskInputs, status = 'PROCESSING', options?)
    → POST /api/{appId}/jobs
    → Returns job object with jobId, status, startedAt, etc.

// Update job after completion
updateJob(numaAppData, jobId, results, inputs?, status?, options?)
    → PUT /api/{appId}/jobs/{jobId}
    → Updates results, status, inputs, lastUpdated

// Retrieve all jobs for an app
getJobsByAppId(appId, nextToken?)
    → GET /api/{appId}/jobs?limit=50&userId={userId}&nextToken={token}
    → Returns paginated list with nextToken for pagination

// Get single job details (including results and events)
getJobById(numaAppId, jobId)
    → GET /api/{numaAppId}/jobs/{jobId}?userId={userId}
    → Full job state with events array
```

### B. manifestService.ts - App Definitions

**Important:** The manifest is static - generated at deploy time, not fetched from an API at runtime.

```typescript
fetchAppsFromManifest(forceRefresh?)
    → Cached read of /manifest.json
    → Returns all app definitions

fetchAppById(appId)
    → Filters manifest for single app by ID
```

### C. NumaRequest Context - HTTP client with authentication

- `numaGet()`, `numaPost()`, `numaPut()` - All include Cognito auth + CloudFront secret header

---

## 3. Typical Flow: Start → Poll → Display Results

```
User navigates to /app/{appId}
    ↓
AppDetail loads app manifest via manifestService
    ↓
Sets numaAppData in context
    ↓
Renders AppWizard with app manifest
    ↓
User completes input tasks (file uploads, text inputs, etc.)
    ↓
User clicks "Run" button
    ↓
AppWizard.runApp()
    ↓
NumaAppProvider.handleRunButtonClick()
    ↓
1. createJob() - POST /api/{appId}/jobs
    - Status: PROCESSING
    - Inputs: taskInputValues
    - Optional: jobName if job naming enabled
    ↓
2. pollJobStatus() - Loop with 10s intervals, max 30 min
    - GET /api/{appId}/jobs/{jobId}
    - Extract jobEvents array
    - Check status: PROCESSING vs SUCCESS/completed
    ↓
3. Once status === 'SUCCESS' or 'completed':
    - Extract results from job
    - Transition UI to "Results" tab
    - Set hasRun = true
    - Display outputs via ResultsRenderer
    ↓
4. User can click job history to load previous runs
    - JobHistorySidebar calls loadAppJobs()
    - Gets paginated list with nextToken
    - User clicks "View Results" on specific job
    - loadJobResults(jobId) triggers same polling/display
```

---

## 4. App-Specific Components

### Input Modules (Pre-run Tasks)

| Component | Purpose | Value Type |
|-----------|---------|------------|
| `S3UploadModule.tsx` | File uploads | `FileResult[]` with `{id, name, s3_key}` |
| `TextInputModule.tsx` | Text entry | `string` |
| `DropdownModule.tsx` | Single select | Selection value |
| `DropdownTableModule.tsx` | Table-based data | Object |

### Output Modules (Post-run Tasks)

| Component | Purpose |
|-----------|---------|
| `TextOutputModule.tsx` | Static text display |
| `ResultsRenderer.tsx` | Renders `job.results` array with content_type handling |

### Navigation & Status

| Component | Purpose |
|-----------|---------|
| `WizardNavigation.tsx` | Step bar with pre-run (inputs) and post-run (results) sections |
| `JobHistorySidebar.tsx` | Offcanvas sidebar with paginated job list |
| `EventStreamViewer.tsx` | Real-time event log display |

---

## 5. Data Flow & State Management

### Central Context: NumaAppContext

The `NumaAppProvider` manages all app state:

```typescript
// App metadata
numaAppData: NumaApp | null           // Current app definition
numaAppId: string | null              // Current app ID
numaApps: NumaApp[]                   // All available apps

// Job execution
job: Job | null                       // Current job (loaded or running)
currentJobId: string | null           // Currently selected job ID
jobEvents: JobEvent[]                 // Real-time events array

// User inputs (before run)
taskInputValues: Record<string, unknown>
taskCompletionStatus: Record<string, boolean>

// Execution state
appRunning: boolean                   // True while polling
hasRun: boolean                       // True once job completes
activeStep: number                    // Current displayed step

// Job naming
isJobNamingEnabled: boolean           // User preference (localStorage)
runName: string                       // Name for current run

// Progress tracking
processingProgress: number            // 0-100 for indeterminate UI
processingStatus: string              // "Running step 2 of 5", etc.
jobEvents: JobEvent[]                 // Array of {timestamp, message}
```

### Loading Results

```typescript
loadJobResults(jobId) {
    1. setLoadingJobId(jobId)
    2. Calls pollJobStatus with initialState
    3. Updates job state with results
    4. Sets URL query param: ?jobId={jobId}
    5. Displays in "Results" tab
}

// Auto-reload on URL param change:
useEffect(() => {
    const jobIdParam = new URLSearchParams(window.location.search).get('jobId')
    if (jobIdParam && numaAppId && numaAppData) {
        loadJobResults(jobIdParam)  // Auto-loads on page load
    }
})
```

---

## 6. Key Implementation Details

### Job Structure (DynamoDB)

```typescript
{
    jobId: string                          // UUID
    appId: string                          // App identifier
    appName: string
    appType: string
    status: 'PROCESSING' | 'SUCCESS' | 'FAILED'
    inputs: Record<string, unknown>        // User task values
    results: JobResult[] | null            // Post-run outputs
    events: JobEvent[]                     // Real-time events
    startedAt: ISO8601
    lastUpdated: ISO8601
    name: string                           // User-assigned run name
    manifest: string                       // JSON serialized app manifest
}
```

### Task Manifest Format

```typescript
{
    id: string
    type: 'text-input' | 's3-upload' | 'dropdown' | 'dropdown-table' | 'text-output'
    title?: string
    required?: boolean
    hidden?: boolean
    defaultContent?: string
    minFiles?: number
    parameters?: {minFiles?, maxFiles?, userMessage?, ...}
}
```

### Result Output Format

```typescript
{
    title?: string
    content_type: 'text/markdown' | 'text/plain' | 'text/html' | 'text/csv' | 'application/json'
    data: unknown
}
```

---

## 7. File Locations Summary

| File Path | Purpose |
|-----------|---------|
| `/numa-frontend/src/Pages/AppDetail.tsx` | Main app page (loads manifest, renders wizard) |
| `/numa-frontend/src/Services/jobsApi.tsx` | Job CRUD operations |
| `/numa-frontend/src/Services/manifestService.ts` | App catalog (cached JSON) |
| `/numa-frontend/src/Components/Apps/AppWizard.tsx` | Multi-step form with run button logic |
| `/numa-frontend/src/Modules/S3UploadModule.tsx` | File upload input |
| `/numa-frontend/src/Modules/TextInputModule.tsx` | Text input |
| `/numa-frontend/src/Components/Renderers/ResultsRenderer.tsx` | Output rendering |
| `/numa-frontend/src/Components/WizardNavigation.tsx` | Step indicator & run button UI |
| `/numa-frontend/src/Components/JobHistorySidebar.tsx` | Job history list with pagination |
| `/numa-frontend/src/Components/EventStreamViewer.tsx` | Real-time event log display |
| `/numa-frontend/src/Providers/NumaAppContext.tsx` | Context definition |
| `/numa-frontend/src/Providers/NumaAppProvider.tsx` | State management & polling logic |
| `/numa-frontend/src/types/apps.ts` | TypeScript interfaces |

---

## 8. Key Insights

1. **Jobs are first-class resources**: Created immediately on file upload/input submission, not session-based
2. **Polling-based completion**: 10-second intervals, up to 30-minute timeout
3. **Event streaming**: Backend sends optional events array that accumulates during polling
4. **URL-driven state**: Query param `?jobId={id}` auto-loads results on page load
5. **Pagination support**: Job history uses nextToken for efficient pagination
6. **Flexible outputs**: Results can be markdown, JSON, CSV, HTML, or plaintext
7. **UI guards**: Output steps disabled until `hasRun=true`
8. **localStorage persistence**: Job naming preference persists across sessions

---

## 9. Common Patterns

### Starting a Job

```typescript
// In NumaAppProvider
const handleRunButtonClick = async () => {
  setAppRunning(true);

  // Create job record
  const jobResponse = await jobsApi.createJob(
    numaAppData,
    taskInputValues,
    runName || undefined
  );

  setCurrentJobId(jobResponse.jobId);

  // Start polling
  const { status, result } = await pollJobStatus({
    jobId: jobResponse.jobId,
    pollInterval: 10000,
    maxPollingTime: 1800000
  });

  if (status === 'completed') {
    setJob(result);
    setHasRun(true);
  }

  setAppRunning(false);
};
```

### Displaying Events

```typescript
// In WizardNavigation or similar
const { jobEvents, appRunning } = useNumaApp();

{jobEvents && jobEvents.length > 0 ? (
  <EventStreamViewer events={jobEvents} isRunning={appRunning} />
) : (
  <Preloader smallscreen={false} overlayParent={false} />
)}
```

### Loading Job History

```typescript
const loadAppJobs = async () => {
  const { items, nextToken } = await jobsApi.getJobsByAppId(
    numaAppData.id,
    { limit: 20, sortOrder: 'desc' }
  );
  setJobHistory(items);
  setHasMoreJobs(!!nextToken);
};
```

---

## 10. Adding a New Input Module

To add a new input type:

1. **Create the module** in `/numa-frontend/src/Modules/`:
   ```typescript
   // MyNewInputModule.tsx
   interface MyNewInputModuleProps {
     task: TaskDefinition;
     value: MyValueType;
     onChange: (value: MyValueType) => void;
   }

   export const MyNewInputModule: React.FC<MyNewInputModuleProps> = ({
     task, value, onChange
   }) => {
     // Render your input UI
     return <div>...</div>;
   };
   ```

2. **Register in AppWizard** task renderer:
   ```typescript
   // In AppWizard.tsx or task renderer
   case 'my-new-input':
     return <MyNewInputModule task={task} value={value} onChange={handleChange} />;
   ```

3. **Add type constant** in `/infra/constructs/types.ts`:
   ```typescript
   export const MY_NEW_INPUT_TASK = 'my-new-input';
   ```

4. **Use in manifest** in your app construct:
   ```typescript
   tasks: [
     {
       id: 'my-task',
       type: MY_NEW_INPUT_TASK,
       title: 'My Input',
       required: true,
       order: 1,
     }
   ]
   ```
