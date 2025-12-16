---
name: numa-apps
description: Create and manage Numa apps (Step Functions + Lambdas). Use when creating a new app, working with app constructs, BaseNumaApp, Step Functions, state machines, jobs, job status, polling, manifest, app wizard, or frontend app integration.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Apps

Numa apps are serverless, Step Function-orchestrated workflows that follow a consistent pattern: **input → process → output**.

## Quick Reference

### Architecture Overview

```
Frontend (React) → API Gateway → step-function-start Lambda
    → Step Functions State Machine
        → Processing Lambdas (extract, analyze, aggregate)
        → Status updates (DynamoDB or S3)
    → Frontend polls step-function-status Lambda
```

### Key Patterns

| Pattern | Description |
|---------|-------------|
| **App Construct** | TypeScript class extending `BaseNumaApp` in `/infra/constructs/apps/` |
| **Step Function** | ASL state machine orchestrating Lambda invocations |
| **Jobs (DynamoDB)** | `enableJobs: true` - recommended for new apps |
| **Jobs (S3)** | `enableJobs: false` - legacy, status in S3 bucket |
| **Manifest** | Static JSON generated at deploy time, defines UI wizard |

### Creating a New App

1. **Create construct**: `/infra/constructs/apps/{app-name}-construct.ts`
2. **Create Lambda(s)**: `/lambdas/python/{lambda-name}/`
3. **Register in stack**: Add to apps array in `numa-client-stack.ts`
4. **Deploy**: Manifest auto-generates from construct

### Storage Patterns

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

**Infrastructure:**
- `infra/constructs/apps/base-numa-app-construct.ts` - Base class
- `infra/constructs/apps/document-summariser-construct.ts` - Example app
- `infra/stacks/numa-client-stack.ts` - App registration

**Lambdas:**
- `lambdas/python/step-function-start/` - Start endpoint
- `lambdas/python/step-function-status/` - Status endpoint

**Frontend:**
- `numa-frontend/src/Pages/AppDetail.tsx` - App UI
- `numa-frontend/src/Services/jobsApi.ts` - Jobs API
- `numa-frontend/src/Providers/NumaAppProvider.tsx` - State management

## Detailed Guides

For comprehensive documentation, see supporting files:

- **[apps-creating.md](apps-creating.md)** - Step-by-step guide to creating new apps
- **[apps-backend-orchestration.md](apps-backend-orchestration.md)** - Backend: Step Functions, storage, Lambda handlers
- **[apps-frontend-integration.md](apps-frontend-integration.md)** - Frontend: React components, context, services

## Important Notes

1. **Manifest is static** - Generated at deploy time from construct's `.manifest` property, not fetched from API
2. **Use DynamoDB for new apps** - Set `enableJobs: true` for job history and faster status
3. **Polling model** - Frontend polls status endpoint every 5 seconds until completion
