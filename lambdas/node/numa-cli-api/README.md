# numa-cli-api

Backend Lambda for the Numa CLI (`/numa-cli/`). Receives authenticated requests
from the CLI, translates them, and (Phase 3+) invokes `workspace-chat-tools`
for tool execution.

## Routes

### `POST /api/cli/bootstrap` (also accepts `GET`)

Returns the consolidated settings the CLI caches at
`~/.config/numa/context-<account>.json` so it can render meaningful `--help`
and pre-flight obvious errors locally.

**Response (v1, lean):**

```json
{
  "user": {
    "sub": "f4088468-...",
    "email": "nathan@arcanum.ai",
    "name": "Nathan Douglas",
    "groups": ["admin"]
  },
  "client_name": "nd-labs",
  "feature_flags": {
    "NUMA_OPS": true,
    "PIPEDREAM_INTEGRATIONS": true,
    "DATA_CONNECTORS_ENABLED": true,
    "AGENTS": true,
    "NUMA_WORKSPACE_CHAT": true,
    "KNOWLEDGE_BASES": true,
    "SECRETS_VAULT_ENABLED": true
  },
  "cli_min_version": "0.1.0",
  "fetched_at": "2026-05-15T11:30:00Z"
}
```

The response will grow as concrete CLI commands need more aggregated data
(enabled integrations + admin policies, accessible KBs, agent list, etc.).
Kept lean in v1 to ship the auth chain + Lambda scaffold without overscoping.

### `POST /api/cli/tools/invoke` (Phase 3)

Translates a CLI command into a `workspace-chat-tools` event and invokes it.

### `POST /api/cli/tools/confirm` (Phase 3)

Submits a HITL approval decision (writes to the existing `<client>-integrations-approval`
table on the user's behalf, then invokes `workspace-chat-tools`).

## Auth

Requests come through CloudFront → API Gateway → existing custom authorizer
(`api-gateway-authorizer`). The authorizer validates the Cognito access token
and the CloudFront secret. We re-decode the JWT in the handler for convenience
(same pattern as `agents` lambda) — re-decoding is safe because the bytes were
already verified upstream.

## What this Lambda does NOT do

By design, all of the following stay in `workspace-chat-tools`:

- Per-tool permission enforcement
- Approval mode evaluation
- HITL DynamoDB coordination (pending/decided records)
- Tool execution itself

This Lambda is just a thin router + (eventual) command-to-event translator.
Keeps blast radius small and lets the dispatcher's existing logic stay
authoritative.

## Build / bundle

```
yarn install
yarn build         # esbuild → dist/index.mjs
yarn bundle        # zip for Lambda deployment
yarn lint
```

Wired into infra via `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts`.
