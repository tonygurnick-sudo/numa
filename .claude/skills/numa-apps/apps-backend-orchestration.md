# Numa Apps: Jobs, Status, and Orchestration

## Overview

Numa apps are serverless, Step Function-orchestrated workflows that follow a consistent pattern: input → process → output. This document explains how apps are started, tracked, and monitored across the frontend and backend infrastructure.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Storage Patterns: S3 vs DynamoDB](#storage-patterns-s3-vs-dynamodb)
3. [App Lifecycle](#app-lifecycle)
4. [Jobs System](#jobs-system)
5. [Status Polling Mechanism](#status-polling-mechanism)
6. [Event Streaming](#event-streaming)
7. [Frontend-Backend Orchestration](#frontend-backend-orchestration)
8. [API Endpoints](#api-endpoints)
9. [Code Examples](#code-examples)

---

## Architecture Overview

```
┌─────────────┐
│  Frontend   │
│  (React)    │
└──────┬──────┘
       │ POST /api/{app-id}/main (start)
       │ GET  /api/{app-id}/jobs/{job-id} (status)
       │ GET  /api/{app-id}/status?jobId=... (legacy S3)
       ▼
┌─────────────────────────────────────────┐
│         API Gateway                      │
│  (Custom authorizer + CloudFront secret) │
└──────────┬──────────────────────────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌──────────┐  ┌──────────┐
│  Start   │  │  Status  │
│  Lambda  │  │  Lambda  │
└────┬─────┘  └────┬─────┘
     │             │
     │             │ (reads from)
     ▼             ▼
┌────────────┐  ┌──────────┐  ┌──────────┐
│   Step     │  │ DynamoDB │  │    S3    │
│  Function  │  │  Jobs    │  │ Outputs  │
└────┬───────┘  │  Table   │  │  Bucket  │
     │          └──────────┘  └──────────┘
     │                │              │
     │ invokes        │ writes to    │ writes to
     ▼                ▼              ▼
┌──────────────────────────────────────┐
│      Application Lambdas             │
│  (business logic, Claude agents,     │
│   content extraction, etc.)          │
└──────────────────────────────────────┘
```

---

## Storage Patterns: S3 vs DynamoDB

Numa supports two storage patterns for app runs, controlled by the `enableJobs` flag in the app construct.

### Pattern 1: S3-Only (Legacy, `enableJobs: false`)

**Status:** Legacy pattern, maintained for backwards compatibility only.

**When to use:**
- ⚠️ **NOT recommended for new apps** - use DynamoDB pattern instead
- Legacy apps that haven't been migrated yet (Document Summariser, Policy Builder, etc.)

**Storage locations:**
- **Status**: `s3://{bucket}/{app-id}/{user-id}/{job-id}/status.json`
- **Outputs**: `s3://{bucket}/{app-id}/{user-id}/{job-id}/outputs/`
- **Artifacts**: `s3://{bucket}/{app-id}/{user-id}/{job-id}/`

**Status file structure:**
```json
{
  "status": "PROCESSING | SUCCESS | FAILURE",
  "message": "Optional error message",
  "results": {...},
  "events": [
    {"timestamp": "2025-11-13T23:55:43Z", "message": "Starting analysis..."}
  ]
}
```

**Characteristics:**
- ✅ Simple, no DynamoDB table needed
- ✅ Status persists indefinitely in S3
- ❌ No job history UI
- ❌ No queryable job metadata
- ❌ Slower status checks (S3 GetObject)
- ❌ No efficient user filtering

---

### Pattern 2: DynamoDB Jobs (Current, `enableJobs: true`)

**Status:** ✅ **Current standard - use this for all new apps.**

**When to use:**
- ✅ **All new apps should use this pattern**
- Apps with job history requirements
- Apps needing user-scoped job queries
- Apps using event streaming

**Storage locations:**
- **Job metadata**: DynamoDB `{client}-{app-id}-recent-jobs` table
- **Outputs**: `s3://{bucket}/{app-id}/{user-id}/{job-id}/outputs/`
- **Artifacts**: `s3://{bucket}/{app-id}/{user-id}/{job-id}/`

**DynamoDB record structure:**
```typescript
{
  jobId: string;              // Primary key
  userId: string;             // GSI: user-date-index
  dateTime: string;           // ISO timestamp, GSI range key
  appName: string;
  appType: "numa-app";
  status: "PROCESSING" | "SUCCESS" | "FAILURE";
  startedAt: string;          // ISO timestamp
  lastUpdated: string;        // ISO timestamp
  createdAt: string;          // ISO timestamp

  // Optional fields
  name?: string;              // User-provided run name
  inputs?: Record<string, any>;
  results?: string;           // JSON-encoded results
  manifest?: string;          // JSON-encoded app manifest
  message?: string;           // Error message for failures
  events?: Array<{            // Real-time event log
    timestamp: string;
    message: string;
  }>;
}
```

**DynamoDB indexes:**
- **Primary key**: `jobId`
- **GSI: date-time-index**: Partition key = `dateTime`, for chronological queries
- **GSI: user-date-index**: Partition key = `userId`, Range key = `dateTime`, for user-scoped queries

**Characteristics:**
- ✅ Fast status checks (DynamoDB GetItem ~10ms)
- ✅ Job history UI with user filtering
- ✅ Queryable metadata (date range, user, status)
- ✅ Real-time event streaming support
- ✅ Automatic TTL cleanup (optional)

---

## App Lifecycle

### 1. Start Phase

**Frontend initiates:**
```typescript
// User clicks "Run" button
const response = await numaPost(`/api/${appId}/main`, {
  payload: {
    prompt: userPrompt,
    uploaded_files: s3Keys,
    // ... app-specific inputs
  }
});
const { job_id } = response;
```

**step-function-start Lambda:**
```python
def handler(event: APIGatewayProxyEvent, context: LambdaContext):
    app_id, job_id, payload = helpers.get_api_gateway_parameters(event)
    user_id = helpers.extract_user_id_from_token(event)

    # Start Step Function execution
    response = step_functions_client.start_execution(
        stateMachineArn=STEP_FUNCTION_ARN,
        name=job_id,  # Execution name = job_id for idempotency
        input=json.dumps({
            "app_id": app_id,
            "job_id": job_id,
            "user_id": user_id,
            **payload
        })
    )

    return {"statusCode": 200, "body": json.dumps({"job_id": job_id})}
```

**Step Function begins:**
```json
{
  "StartAt": "WriteProcessingStatus",
  "States": {
    "WriteProcessingStatus": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "{client}-{app-id}-recent-jobs",
        "Key": {"jobId": {"S.$": "$$.Execution.Input.job_id"}},
        "UpdateExpression": "SET #status = :status, ...",
        "ExpressionAttributeValues": {":status": {"S": "PROCESSING"}}
      },
      "Next": "Initialize"
    },
    "Initialize": {...},
    "RunBusinessLogic": {...},
    "WriteSuccessStatus": {...}
  }
}
```

---

### 2. Processing Phase

During processing, application Lambdas:
1. **Execute business logic** (analysis, generation, extraction)
2. **Optionally emit events** for real-time progress updates
3. **Write outputs to S3** under `{app-id}/{user-id}/{job-id}/outputs/`
4. **Write artifacts to S3** (trace files, session data, intermediate results)

**Event streaming (optional):**
```python
# In application Lambda
helpers.append_event(
    message="Reading file: input.csv",
    job_id=job_id,
    user_id=user_id,
    app_id=app_id,
    use_dynamodb=bool(os.environ.get("DYNAMODB_TABLE")),
    bucket=bucket
)
```

---

### 3. Completion Phase

**Step Function final state (Success):**
```json
{
  "WriteSuccessStatus": {
    "Type": "Task",
    "Resource": "arn:aws:states:::dynamodb:updateItem",
    "Parameters": {
      "UpdateExpression": "SET #status = :status, #results = :results, ...",
      "ExpressionAttributeValues": {
        ":status": {"S": "SUCCESS"},
        ":results": {"S.$": "States.JsonToString($.results)"}
      }
    },
    "Next": "Success"
  }
}
```

**Failure:**
```json
{
  "WriteFailureStatus": {
    "Type": "Task",
    "Resource": "arn:aws:states:::dynamodb:updateItem",
    "Parameters": {
      "UpdateExpression": "SET #status = :status, #message = :message, ...",
      "ExpressionAttributeValues": {
        ":status": {"S": "FAILURE"},
        ":message": {"S.$": "States.Format('{}: {}', $.Error, $.Cause)"}
      }
    },
    "Next": "Failure"
  }
}
```

---

## Jobs System

The Jobs system (enabled via `enableJobs: true`) provides a complete job lifecycle API.

### Infrastructure Setup

**In app construct:**
```typescript
export class DataAnalysis extends BaseNumaApp {
  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, {
      ...props,
      appId: 'data-analysis',
      enableJobs: true  // ← Enables DynamoDB jobs table
    });

    // Jobs table is automatically created: {client}-data-analysis-recent-jobs
    // Jobs API routes are automatically created: /jobs, /jobs/{jobId}
  }
}
```

**What gets created:**
1. **DynamoDB table** with GSIs for querying
2. **Four Lambda endpoints:**
   - `POST /jobs` - Create job (createJob)
   - `GET /jobs` - List jobs with filters (listJobs)
   - `GET /jobs/{jobId}` - Get specific job (getJob)
   - `PUT /jobs/{jobId}` - Update job metadata (updateJob)
3. **Step Function integration** - Writes status directly to DynamoDB

### API Operations

#### Create Job
```typescript
const jobResponse = await jobsApi.createJob(numaAppData, taskInputs, runName);
// Returns: { jobId: "uuid", status: "PROCESSING", ... }
```

#### List Jobs
```typescript
const { items, nextToken } = await jobsApi.getJobsByAppId(appId, {
  userId: currentUserId,
  limit: 20,
  nextToken: previousToken,
  sortOrder: 'desc'  // Newest first
});
```

#### Get Job Status
```typescript
const job = await jobsApi.getJobById(appId, jobId);
// Returns full job object with events, results, status
```

---

## Status Polling Mechanism

### Frontend Polling Loop

**Location:** `/numa-frontend/src/Providers/NumaAppProvider.tsx`

```typescript
const pollJobStatus = async ({ jobId, pollInterval = 10000, maxPollingTime = 1800000 }) => {
  const startTime = Date.now();

  while (true) {
    // 1. Fetch current job status
    const job = await jobsApi.getJobById(numaAppData.id, jobId);

    // 2. Extract events for real-time display
    if (job.events && Array.isArray(job.events)) {
      setJobEvents(job.events);
    }

    // 3. Check completion
    if (job.status === 'SUCCESS' || job.status === 'FAILURE') {
      return { status: 'completed', result: job };
    }

    // 4. Check timeout
    if (Date.now() - startTime > maxPollingTime) {
      return { status: 'incomplete', result: job };
    }

    // 5. Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
};
```

### Backend Status Endpoints

#### DynamoDB-backed (enableJobs=true)

**Lambda:** `/lambdas/python/numa-recent-jobs/get_job.py`

```python
def handler(event, context):
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    job_id = event["pathParameters"]["jobId"]

    response = table.get_item(Key={"jobId": job_id})
    item = response.get("Item")

    return {"statusCode": 200, "body": json.dumps(item)}
```

**Characteristics:**
- ⚡ Fast: ~10ms GetItem operation
- ✅ Includes events array automatically

#### S3-backed (enableJobs=false)

**Lambda:** `/lambdas/python/step-function-status/lambda_function.py`

```python
def handler(event: APIGatewayProxyEvent, context: LambdaContext):
    app_id, job_id, payload = helpers.get_api_gateway_parameters(event)
    user_id = helpers.extract_user_id_from_token(event)
    bucket = os.environ["BUCKET"]

    key = f"{app_id}/{user_id}/{job_id}/status.json"
    s3_file = s3_client.get_object(Bucket=bucket, Key=key)
    status_json = s3_file["Body"].read().decode("utf-8")

    return {"statusCode": 200, "body": status_json}
```

**Characteristics:**
- 🐌 Slower: ~50-200ms S3 GetObject

---

## Event Streaming

Event streaming allows apps to emit progress updates in real-time during execution.

### Backend Implementation

**Lambda emits events:**
```python
def handler(event: Dict[str, Any], context: LambdaContext):
    use_dynamodb = bool(os.environ.get("DYNAMODB_TABLE"))

    # Emit progress events
    helpers.append_event(
        message="Starting analysis...",
        job_id=job_id,
        user_id=user_id,
        app_id=app_id,
        use_dynamodb=use_dynamodb,
        bucket=bucket
    )

    # ... during processing ...
    helpers.append_event(message="Reading file: data.csv", ...)
    helpers.append_event(message="Running model inference...", ...)
    helpers.append_event(message="Analysis complete", ...)
```

**Events stored in DynamoDB:**
```python
table.update_item(
    Key={"jobId": job_id},
    UpdateExpression="SET events = list_append(if_not_exists(events, :empty_list), :new_event)",
    ExpressionAttributeValues={
        ":new_event": [{"timestamp": "2025-11-13T23:55:43Z", "message": "Reading file"}],
        ":empty_list": []
    }
)
```

### Frontend Display

**Component:** `/numa-frontend/src/Components/EventStreamViewer.tsx`

```typescript
const EventStreamViewer: React.FC<{events: JobEvent[], isRunning: boolean}> = ({ events, isRunning }) => {
  return (
    <div className="event-stream-card">
      <div className="event-stream-header">
        {isRunning && <span className="live-indicator">● LIVE</span>}
        <span>Activity Log ({events.length} events)</span>
      </div>
      <div className="event-stream-body">
        {events.map((event, idx) => (
          <div key={idx} className="event-item">
            <span className="event-time">{formatTime(event.timestamp)}</span>
            <span className="event-message">{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## API Endpoints

### App-Specific Routes

All routes are prefixed with `/api/{app-id}/`

#### Start Execution
- **Path:** `/main`
- **Method:** `POST`
- **Handler:** `/lambdas/python/step-function-start/lambda_function.py`
- **Request:**
  ```json
  {
    "payload": {
      "prompt": "User's prompt",
      "uploaded_files": [...]
    }
  }
  ```
- **Response:**
  ```json
  {"job_id": "821ffa40-813e-457a-86cf-8364740f03fa"}
  ```

#### Get Status (S3-backed apps)
- **Path:** `/status`
- **Method:** `GET`
- **Handler:** `/lambdas/python/step-function-status/lambda_function.py`
- **Query params:** `?jobId={job-id}`

### Jobs API Routes (DynamoDB-backed apps only)

#### Create Job
- **Path:** `/jobs`
- **Method:** `POST`
- **Handler:** `/lambdas/python/numa-recent-jobs/create_job.py`

#### Get Job
- **Path:** `/jobs/{jobId}`
- **Method:** `GET`
- **Handler:** `/lambdas/python/numa-recent-jobs/get_job.py`

#### List Jobs
- **Path:** `/jobs?userId={user-id}&limit=20&nextToken=...`
- **Method:** `GET`
- **Handler:** `/lambdas/python/numa-recent-jobs/list_jobs.py`

#### Update Job
- **Path:** `/jobs/{jobId}`
- **Method:** `PUT`
- **Handler:** `/lambdas/python/numa-recent-jobs/update_job.py`

---

## Best Practices

### 1. When to Enable Jobs

✅ **Use `enableJobs: true` for:**
- ✅ **ALL NEW APPS (recommended)**
- Apps with job history UI requirements
- Apps needing user-scoped queries
- Apps using event streaming

❌ **Use `enableJobs: false` only for:**
- ⚠️ Legacy apps already in production (to avoid breaking changes)

### 2. Event Streaming Best Practices

✅ **Do:**
- Emit meaningful progress updates (file names, stages, counts)
- Use consistent event patterns across apps
- Handle append_event failures gracefully

❌ **Don't:**
- Emit every single line of output (too verbose)
- Include sensitive data in event messages
- Emit events in tight loops without throttling

### 3. Status Polling Best Practices

✅ **Do:**
- Use 10-second intervals (balance between UX and API costs)
- Implement exponential backoff for errors
- Show timeout warnings after 5-10 minutes

❌ **Don't:**
- Poll faster than 5 seconds (wastes resources)
- Poll indefinitely (implement max timeout)

---

## Troubleshooting

### Job Not Found (404)

**Causes:**
1. Job not created yet (race condition)
2. Wrong storage pattern (using jobs API on S3-only app)
3. User ID mismatch

**Solutions:**
- Add retry logic with exponential backoff
- Verify `enableJobs: true` in app construct
- Check Lambda logs for user ID extraction

### Events Not Appearing

**Causes:**
1. Lambda not calling `helpers.append_event()`
2. `DYNAMODB_TABLE` env var not set
3. Lambda lacks DynamoDB UpdateItem permission

**Solutions:**
- Verify Lambda is calling `helpers.append_event()`
- Check Lambda environment variables
- Review IAM policies on Lambda execution role

### Step Function Execution Failed

**Causes:**
1. Application Lambda threw unhandled exception
2. Lambda timeout (15 min max)
3. Step Function didn't write final status

**Solutions:**
- Check Step Function execution logs in AWS Console
- Check application Lambda CloudWatch logs
- Add retry and catch policies to Step Function states

---

## Key Files Reference

- `/infra/constructs/apps/base-numa-app-construct.ts` - Base app infrastructure
- `/lib/helpers/helpers/__init__.py` - Event streaming helpers
- `/numa-frontend/src/Providers/NumaAppProvider.tsx` - Frontend polling logic
- `/numa-frontend/src/Components/EventStreamViewer.tsx` - Event display component
- `/lambdas/python/step-function-start/` - Start endpoint
- `/lambdas/python/step-function-status/` - Status endpoint (S3)
- `/lambdas/python/numa-recent-jobs/` - Jobs API (DynamoDB)
