---
name: numa-apps
description: Create and manage Numa apps (V1 Step Functions + Lambdas, and V2 AgentCore apps). Use when creating a new app, working with app constructs, BaseNumaApp, Step Functions, state machines, jobs, job status, polling, manifest, app wizard, V2 apps, agent types, or frontend app integration.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Apps

Numa has two app architectures:

1. **V1 Apps (Step Functions)** — The original pattern. Step Function-orchestrated Lambda workflows with a static manifest driving the frontend wizard.
2. **V2 Apps (AgentCore)** — The newer pattern. Runs on the workspace agent (AgentCore MicroVMs) via a fire-and-forget API. Uses a frontend registry instead of a deploy-time manifest.

## Quick Reference

### V1 Apps Architecture

```
Frontend (React) → API Gateway → step-function-start Lambda
    → Step Functions State Machine
        → Processing Lambdas (extract, analyze, aggregate)
        → Status updates (DynamoDB or S3)
    → Frontend polls step-function-status Lambda
```

### V2 Apps Architecture

```
Frontend (React) → API Gateway → v2-apps-api Lambda (Node)
    → DynamoDB (run tracking)
    → workspace-chat-agent-proxy Lambda → AgentCore MicroVM
        → Agent type handler (data_analysis, nolia-compliance, quoting, etc.)
        → Results written to S3 as _result.json
    → Frontend polls v2-apps-api for status
```

### Key Patterns

| Pattern                | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| **V1 App Construct**   | TypeScript class extending `BaseNumaApp` in `/infra/constructs/apps/`   |
| **V1 Step Function**   | ASL state machine orchestrating Lambda invocations                      |
| **V1 Jobs (DynamoDB)** | `enableJobs: true` - recommended for new V1 apps                        |
| **V1 Jobs (S3)**       | `enableJobs: false` - legacy, status in S3 bucket                       |
| **V1 Manifest**        | Static JSON generated at deploy time, defines UI wizard                 |
| **V2 App Registry**    | Frontend TypeScript registry in `V2AppRegistry.ts`, defines tabs/agents |
| **V2 Runs API**        | Node Lambda CRUD at `/api/v2-apps/runs`, delegates to workspace agent   |
| **V2 Agent Types**     | Python agent types in `services/numa-workspace-agent/.../agent_types/`  |

### Creating a New V1 App

1. **Create construct**: `/infra/constructs/apps/{app-name}-construct.ts`
2. **Create Lambda(s)**: `/lambdas/python/{lambda-name}/`
3. **Register in stack**: Add to `appLibrary` in `numa-client-stack.ts`
4. **Deploy**: Manifest auto-generates from construct

### Creating a New V2 App

1. **Create agent type**: `/services/numa-workspace-agent/.../agent_types/{type}.py`
2. **Register agent type**: Import in `agent_types/__init__.py`
3. **Add to frontend registry**: `/numa-frontend/src/Components/V2Apps/V2AppRegistry.ts`
4. **Add translations**: `/numa-frontend/src/locales/en/apps.json`

### V1 Storage Patterns

**DynamoDB (recommended):**

- Fast status checks (~10ms)
- Job history UI with pagination
- Real-time event streaming
- Set `enableJobs: true` in construct

**S3 (legacy):**

- Status at `s3://{bucket}/{app-id}/{user-id}/{job-id}/status.json`
- No job history UI
- Only for apps not yet migrated

### Key Files

**V1 Infrastructure:**

- `infra/constructs/apps/base-numa-app-construct.ts` - Base class + all TypeScript types (AppType, AppStatus, AppCategory, manifest interfaces, task types)
- `infra/constructs/apps/document-summariser-construct.ts` - Example traditional app
- `infra/constructs/apps/data-analysis-construct.ts` - Example Claude Code app
- `infra/stacks/numa-client-stack.ts` - App registration (`appLibrary`)

**V1 Lambdas:**

- `lambdas/python/step-function-start/` - Start endpoint
- `lambdas/python/step-function-status/` - Status endpoint
- `lambdas/python/numa-recent-jobs/` - Jobs CRUD API (DynamoDB)
- `lambdas/python/claude-code-agent/` - Shared Lambda for Claude Code apps
- `lambdas/python/extract-content-from-file/` - Shared content extraction

**V2 Infrastructure:**

- `infra/constructs/v2-apps-construct.ts` - DynamoDB tables + API Lambda
- `lambdas/node/v2-apps-api/` - CRUD + execution API

**V2 Agent Types:**

- `services/numa-workspace-agent/numa_workspace_agent/agent_types/` - All agent type implementations
- `services/numa-workspace-agent/numa_workspace_agent/agent_types/registry.py` - Agent type registry
- `services/numa-workspace-agent/numa_workspace_agent/agent_types/base.py` - AgentTypeConfig base

**V1 Frontend:**

- `numa-frontend/src/Pages/AppDetail.tsx` - V1 App UI
- `numa-frontend/src/Services/jobsApi.tsx` - Jobs API
- `numa-frontend/src/Services/manifestService.ts` - Manifest loading
- `numa-frontend/src/Providers/NumaAppProvider.tsx` - V1 app state management
- `numa-frontend/src/Providers/JobStatusProvider.tsx` - Cross-app job status polling

**V2 Frontend:**

- `numa-frontend/src/Pages/V2AppDetail.tsx` - V2 App UI
- `numa-frontend/src/Services/v2AppsService.ts` - V2 runs CRUD API
- `numa-frontend/src/Components/V2Apps/V2AppRegistry.ts` - App/agent definitions
- `numa-frontend/src/hooks/useV2AppRun.ts` - Run lifecycle hook
- `numa-frontend/src/hooks/useV2AppWorkspaceSettings.ts` - Workspace settings hook

## Detailed Guides

For comprehensive documentation, see supporting files:

- **[apps-creating.md](apps-creating.md)** - Step-by-step guide to creating new apps (V1 and V2)
- **[apps-backend-orchestration.md](apps-backend-orchestration.md)** - Backend: Step Functions, storage, Lambda handlers, V2 API
- **[apps-frontend-integration.md](apps-frontend-integration.md)** - Frontend: React components, context, services (V1 and V2)

## Important Notes

1. **V1 Manifest is static** - Generated at deploy time from construct's `.manifest` property, not fetched from API
2. **V2 Registry is frontend-only** - Defined in `V2AppRegistry.ts`, not generated at deploy time
3. **Use DynamoDB for new V1 apps** - Set `enableJobs: true` for job history and faster status
4. **V1 Polling model** - Frontend polls status endpoint every ~10 seconds until completion
5. **V2 Polling model** - `useV2AppRun` hook polls at ~4s for active run, ~6s for history
6. **All types are in base construct** - `base-numa-app-construct.ts` contains all TypeScript types (AppType, AppStatus, AppCategory, manifest types, task types). There is no separate `types.ts`.
