# Creating Numa Apps

This guide provides a technical overview for creating new apps in the Numa platform.

---

## Overview

All Numa apps are **Step Function apps** - they use AWS Step Functions to orchestrate Lambda invocations. The key distinction is what type of Lambda does the processing:

| App Type             | Processing Lambda                 | Frontend Renderer        | Use Case                                                |
| -------------------- | --------------------------------- | ------------------------ | ------------------------------------------------------- |
| **Traditional Apps** | Custom Lambda per app             | Standard results display | Structured workflows (summarize, extract, analyze)      |
| **Claude Code Apps** | Shared `claude-code-agent` Lambda | Custom rich renderer     | Interactive analysis, code execution, complex reasoning |

### Traditional Apps

- Each app has its own processing Lambda(s)
- Output is typically markdown or structured JSON
- Frontend uses standard results rendering

### Claude Code Apps

- All use the shared `claude-code-agent` Lambda
- Route to different agent types via `agent_type` parameter (e.g., `data_analysis`)
- Stream events (tool use, thinking, code execution) to frontend
- Require custom frontend renderer to display rich results

---

## Part 1: Step Function Apps (Traditional Pattern)

### Architecture

```
Frontend → API Gateway → step-function-start Lambda
  → Step Functions State Machine
    → Processing Lambdas (extract, analyze, aggregate)
    → Status updates (DynamoDB or S3)
  → Frontend polls step-function-status Lambda
```

### Step 1: Create the App Construct

Create a new file in `/infra/constructs/apps/{app-name}-construct.ts`:

```typescript
import { Construct } from 'constructs';
import { BaseNumaApp, BaseNumaAppProps } from './base-numa-app-construct';
import { AppCategory, AppStatus, AppType, HTTP_REQUEST_TASK, S3_UPLOAD_TASK } from '../types';

export class MeetingAnalyser extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, {
      ...props,
      appId: 'meeting-analyser', // Unique identifier
      enableJobs: true, // Enable DynamoDB jobs table (RECOMMENDED)
    });

    // 1. Create processing Lambda
    const analyseLambda = this.addLambdaFunction(this, 'analyse', {
      lambdaDirectory: 'python/meeting-analyser',
      environment: {
        OUTPUT_BUCKET: props.outputsBucket.bucket,
        S3_KEY_PREFIX: this.s3KeyPrefix,
      },
      timeout: 300,
      memorySize: 1024,
    });

    // 2. Define the Step Function workflow
    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        ExtractContent: this.addExtractContentTaskWithArn(
          props.sharedExtractContentLambdaArn!,
          '$.input_key',
          'Analyse'
        ),
        Analyse: this.addLambdaTask(
          analyseLambda.arn,
          {
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'input_key.$': '$.output_key',
          },
          'WriteSuccessStatus'
        ),
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: { Type: 'Succeed' },
        Failure: { Type: 'Fail' },
      },
    };

    // 3. Wire up the Step Function with API endpoints
    this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });

    // 4. Define the manifest (drives the frontend UI)
    this.manifest = {
      appName: 'Meeting Analyser',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-15',
      appDescription: 'Analyse meeting recordings and generate summaries',
      tags: ['meeting', 'audio', 'transcription'],
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload meeting recording',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          params: {
            allowedFileTypes: ['.mp3', '.mp4', '.wav', '.m4a'],
            maximumFileSize: 500,
            maxFiles: 1,
          },
        },
        {
          id: 'call-step-function',
          title: 'Analyse Meeting',
          type: HTTP_REQUEST_TASK,
          endpoint: 'meeting-analyser',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
            },
          },
          order: 2,
        },
      ],
      typicalDurationMinutes: 10,
    };
  }
}
```

### Step 2: Create the Lambda Handler

Create the Lambda in `/lambdas/python/meeting-analyser/lambda_function.py`:

```python
from aws_lambda_powertools.utilities.typing import LambdaContext
from lib import helpers, s3_helpers
from lib.bedrock import invoke_model

def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

    job_id = event["job_id"]
    user_id = event["user_id"]
    input_key = event["input_key"]

    # Read extracted content from previous step
    transcript = s3_helpers.read(input_key)

    # Process with Bedrock
    result = invoke_model(
        system_prompt="You are a meeting analyst...",
        user_prompt=f"Analyse this transcript:\n\n{transcript}",
    )

    # Write output
    output_key = f"{s3_helpers.get_key_prefix()}/{user_id}/{job_id}/analysis.md"
    s3_helpers.write(output_key, result.encode("utf-8"), content_type="text/markdown")

    return {
        "output_key": output_key,
        "status": "SUCCESS",
        "results": {"analysis_key": output_key},
    }
```

### Step 3: Register in the App Library

In `/infra/stacks/numa-client-stack.ts`, add to the app library:

```typescript
import { MeetingAnalyser } from '../constructs/apps/meeting-analyser-construct';

export const appLibrary: Record<string, AppDefinition> = {
  // ... existing apps
  'meeting-analyser': { app: MeetingAnalyser, isProdApp: true },
};
```

### Step 4: Deploy

```bash
# Package the Lambda
bash package-python-lambda.sh lambdas/python/meeting-analyser

# Build frontend (manifest gets bundled)
cd numa-frontend && yarn build

# Deploy
cd ../infra && yarn cdktf deploy --auto-approve numa-client-<client-name>
```

---

## BaseNumaApp Resources

When you extend `BaseNumaApp`, you automatically get:

| Resource                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| CloudWatch Log Group    | Centralized logging for all app Lambdas           |
| S3 Key Prefix           | Isolated storage at `/{appId}/`                   |
| URL Path Prefix         | API routes at `/api/{appId}/`                     |
| Step Function Endpoints | `POST/GET /api/{appId}/main`                      |
| Jobs Table (optional)   | DynamoDB table + CRUD API when `enableJobs: true` |

### Helper Methods

| Method                           | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| `addLambdaFunction()`            | Create a Lambda with standard config              |
| `addLambdaTask()`                | Step Function Lambda task with retry/catch        |
| `addExtractContentTaskWithArn()` | Standard content extraction step                  |
| `writeProcessingStatus()`        | Write "PROCESSING" status                         |
| `writeSuccessStatus()`           | Write "SUCCESS" status with results               |
| `writeFailureStatus()`           | Write "FAILURE" status with error                 |
| `addStepFunction()`              | Wire up Step Function with start/status endpoints |

---

## The App Manifest

The manifest drives the frontend UI. **Important:** The manifest is generated at deploy time and bundled into `/manifest.json` - it's static, not fetched from an API.

```typescript
this.manifest = {
  appName: 'Document Summariser',         // Display name
  id: this.appId,                          // Must match appId
  type: AppType.NUMA,                      // 'numa-app'
  status: AppStatus.ACTIVE,                // 'Active' | 'Internal' | 'Coming Soon'
  category: AppCategory.PRODUCTIVITY,      // UI grouping
  createdDate: '2025-01-31',
  appDescription: 'Summarise documents',
  tags: ['document', 'summary'],
  tasks: [...],                            // Task definitions
  typicalDurationMinutes: 3,
};
```

### Task Types

| Type                | Purpose               | Key Params                                                    |
| ------------------- | --------------------- | ------------------------------------------------------------- |
| `S3_UPLOAD_TASK`    | File upload           | `allowedFileTypes`, `maximumFileSize`, `minFiles`, `maxFiles` |
| `TEXT_INPUT_TASK`   | Text input            | `placeholder`, `required`                                     |
| `DROPDOWN_TASK`     | Select dropdown       | `options: string[]`                                           |
| `HTTP_REQUEST_TASK` | Trigger Step Function | `endpoint`, `payload` (reference other tasks via `@task-id`)  |
| `TEXT_OUTPUT_TASK`  | Display output        | `dataRef`                                                     |

---

## Prod vs Non-Prod Apps

```typescript
export const appLibrary: Record<string, AppDefinition> = {
  'document-summariser': { app: DocumentSummariser, isProdApp: true }, // All clients
  nolia: { app: Nolia, isProdApp: false }, // Specific clients
};
```

| Flag               | Meaning                           | When Deployed                             |
| ------------------ | --------------------------------- | ----------------------------------------- |
| `isProdApp: true`  | Production-ready, general-purpose | `allProdApps: true` or `allApps: true`    |
| `isProdApp: false` | Client-specific or experimental   | Only when explicitly in `apps: {}` config |

### Client Config Examples

```json
// Deploy all production apps
{ "allProdApps": true }

// Deploy all apps (prod + non-prod)
{ "allApps": true }

// Deploy specific apps with config
{
  "apps": {
    "document-summariser": { "enableJobs": true },
    "nolia": { "senderEmail": "nolia@example.com" }
  }
}
```

---

## Common Patterns

### Pattern 1: Single-File Processing

```
Upload → Extract → Process → Output
```

**Examples:** Document Summariser, Contract Analysis

### Pattern 2: Multi-File Map Processing

```
Upload Multiple → Map over each:
  → Extract → Process
→ Aggregate → Output
```

**Examples:** Candidate Screening, Financial Analysis

### Pattern 3: Multi-Phase Processing

```
Upload → Extract → Phase 1 Analysis
→ Parallel: [Phase 2, Phase 3]
→ Final Report
```

**Examples:** Nolia, Policy Reviewer

---

## Part 2: Claude Code Apps

Claude Code apps use the shared `claude-code-agent` Lambda with different agent types. They're still Step Function apps but leverage the Claude CLI for complex reasoning and code execution.

### Architecture

```
Frontend → API Gateway → step-function-start Lambda
  → Step Functions State Machine
    → claude-code-agent Lambda (routes by agent_type)
      → Downloads Claude CLI to /tmp
      → Runs Claude with sandboxed tools
      → Streams events to DynamoDB for real-time progress
    → Status written to DynamoDB/S3
  → Frontend polls for status + renders rich results
```

### Key Differences from Traditional Apps

| Aspect     | Traditional Apps      | Claude Code Apps                                  |
| ---------- | --------------------- | ------------------------------------------------- |
| Processing | Custom Lambda per app | Shared `claude-code-agent` Lambda                 |
| Routing    | N/A                   | `agent_type` parameter                            |
| Output     | Markdown/JSON         | Rich event stream (tool use, thinking, artifacts) |
| Frontend   | Standard renderer     | Custom renderer for events                        |
| Timeout    | Typically 5-10 min    | Up to 15 min (Lambda max)                         |
| Resources  | Standard              | High memory (3GB), large ephemeral storage (4GB)  |

### Creating a New Claude Code Agent Type

1. **Create agent directory** in `/lambdas/python/claude-code-agent/your_agent/`:

```
your_agent/
├── main.py        # Entry point: run(event, context)
├── prompts.py     # SYSTEM_PROMPT definition
└── settings.py    # ENV_VARS, SETTINGS_JSON (optional)
```

2. **Define the system prompt** in `prompts.py`:

```python
SYSTEM_PROMPT = """You are a specialized assistant for [your domain].

You have access to:
- File read/write in the workspace
- Python code execution for analysis
- Web search capabilities

Always explain your reasoning and show your work."""
```

3. **Create the entry point** in `main.py`:

```python
from .prompts import SYSTEM_PROMPT

def run(event: dict, context) -> dict:
    """Called by the claude-code-agent router."""
    prompt = event.get("prompt", "")
    uploaded_files = event.get("uploaded_files", [])

    # Return config for the Claude CLI runner
    return {
        "system_prompt": SYSTEM_PROMPT,
        "prompt": prompt,
        "uploaded_files": uploaded_files,
    }
```

4. **Register in the router** (`/lambdas/python/claude-code-agent/lambda_function.py`):

```python
AVAILABLE_AGENTS = [
    "data_analysis",
    "default",
    "your_agent",  # Add here
]
```

5. **Create the app construct** extending `BaseNumaApp` (see examples in `/infra/constructs/apps/data-analysis-construct.ts`)

---

## Checklists

### Creating a Traditional App

- [ ] Create construct in `/infra/constructs/apps/{app}-construct.ts`
- [ ] Extend `BaseNumaApp` with `appId` and `enableJobs: true` (recommended)
- [ ] Define manifest with tasks
- [ ] Create processing Lambda(s) in `/lambdas/python/{app}/`
- [ ] Define Step Function workflow with your Lambda tasks
- [ ] Call `addStepFunction()` to wire endpoints
- [ ] Register in `appLibrary` with `isProdApp` flag
- [ ] Package Lambda: `bash package-python-lambda.sh lambdas/python/{app}`
- [ ] Build frontend: `cd numa-frontend && yarn build`
- [ ] Deploy: `yarn cdktf deploy`

### Creating a Claude Code App

- [ ] Create agent directory in `/lambdas/python/claude-code-agent/{agent}/`
- [ ] Define `prompts.py` with `SYSTEM_PROMPT`
- [ ] Create `main.py` entry point
- [ ] Register agent type in `AVAILABLE_AGENTS` list
- [ ] Create construct in `/infra/constructs/apps/{app}-construct.ts`
- [ ] Extend `BaseNumaApp` with `appId` and `enableJobs: true` (required for event streaming)
- [ ] Configure `claude-code-agent` Lambda with high memory/storage
- [ ] Define Step Function with `agent_type`, `stream_events`, `use_dynamodb` params
- [ ] Define manifest with tasks
- [ ] Register in `appLibrary` with `isProdApp` flag
- [ ] Implement custom frontend renderer for rich event display
- [ ] Package Lambda: `bash package-python-lambda.sh lambdas/python/claude-code-agent`
- [ ] Build frontend: `cd numa-frontend && yarn build`
- [ ] Deploy: `yarn cdktf deploy`

---

## Key Files Reference

### Infrastructure

- `/infra/constructs/apps/base-numa-app-construct.ts` - Base class for all apps
- `/infra/constructs/apps/base-numa-app-construct.ts` - Base construct + all TypeScript types for manifests, task types, enums
- `/infra/stacks/numa-client-stack.ts` - App registration (search for `appLibrary`)
- `/infra/constructs/apps/data-analysis-construct.ts` - Claude Code app example

### Lambdas

- `/lambdas/python/claude-code-agent/` - Shared Lambda for Claude Code apps
- `/lambdas/python/extract-content-from-file/` - Shared content extraction
- `/lambdas/python/step-function-start/` - Step Function starter
- `/lambdas/python/step-function-status/` - Status polling

### Frontend

- `/numa-frontend/src/Services/manifestService.ts` - Manifest loading
- `/numa-frontend/src/Pages/AppDetail.tsx` - App UI entry point
