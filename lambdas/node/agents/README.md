Agents API (Node)
=================

Company and personal AI agents CRUD with policy enforcement.

Endpoints
---------

- GET `/api/agents` – list agents
  - Query `scope=owned|public|all` (default `owned`)
- GET `/api/agents/{agentId}` – get one
- POST `/api/agents` – create personal or public
- PUT `/api/agents/{agentId}` – update
- DELETE `/api/agents/{agentId}` – delete
- POST `/api/agents/{agentId}/duplicate` – duplicate a public agent to personal

Request/Response Shapes
-----------------------

- Visibility: `personal` (user-scoped) or `public` (workspace-scoped)
- Types mirror the frontend `AgentPayload`/`AgentSummary` (see `numa-frontend/src/types/agents.ts`).

Environment
-----------

- `CLIENT_NAME` – Numa client identifier
- `WORKSPACE_AGENTS_TABLE` – DynamoDB table for workspace (public) agents
- `USER_AGENTS_TABLE` – DynamoDB table for personal agents
- `OUTPUTS_BUCKET_NAME` – S3 bucket for agent icon images
- `AGENTS_SETTINGS_TABLE_NAME` – DynamoDB table for company-wide policy (see below)

Tables
------

- Workspace: `${client}-agents` (PK: `tenant_id`, SK: `agent_id`, GSIs: by `agent_id`, by `created_by_user_id`)
- Users: `${client}-user-agents` (PK: `user_id`, SK: `agent_id`, GSI: by `agent_id`)
- Settings: `${client}-agents-settings` (PK: `setting`, item `{ setting: 'policy', mode: 'off'|'personal_only'|'full' }`)

Policy Enforcement
------------------

The API reads the company-wide policy from the `agents-settings` table on each request:

- Mode `off`
  - List returns empty; create/update/duplicate return 403
- Mode `personal_only`
  - List filters to user-scoped agents; no company marketplace
  - Create/Update reject `visibility=public` with 403
  - Duplicate from public to personal remains allowed, but the UI hides public discovery
- Mode `full`
  - No restrictions

This policy is controlled by the Admin Agents Settings API:
- GET/PUT `/api/settings/agents` (see `lambdas/node/admin-agents-settings`)

IAM
---

- Read/Write to workspace and user tables
- Read `GetItem` from `${client}-agents-settings` (for policy)
- S3 `GetObject/PutObject/DeleteObject` on `numa-chat/agent-icons/*` for icon normalization and cleanup

Build
-----

- `yarn lint`
- `yarn bundle`
- Output: `dist/*` and `lambda_function.zip`

Notes
-----

- Public agent icon images are normalized into a shared public prefix under the outputs bucket.
- Duplicate copies the icon image into the requesting user’s namespace when present.
