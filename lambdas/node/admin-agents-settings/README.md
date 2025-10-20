Admin Agents Settings Lambda

Purpose
- Provides a small admin API to control the global Agents policy for a Numa environment.
- Supports three modes:
  - off: Disable agents completely
  - personal_only: Allow personal agents only; hide company marketplace and block public visibility
  - full: Enable both personal and company agents

Endpoints
- GET /api/settings/agents
  - Returns: { mode: 'off' | 'personal_only' | 'full' }
  - Any authenticated user can read the current policy.

- PUT /api/settings/agents
  - Body: { mode: 'off' | 'personal_only' | 'full' }
  - Admin only. Applies company‑wide immediately.

Environment Variables
- CLIENT_NAME: The Numa client identifier.
- AGENTS_SETTINGS_TABLE_NAME: DynamoDB table name for settings (hash key: setting).

DynamoDB Schema
- Table: <client>-agents-settings
  - PK: setting (string), use fixed value 'policy'
  - Item example: { setting: 'policy', mode: 'personal_only', updatedAt: 'ISO8601' }

IAM
- Read/Write to the agents settings table (GetItem, PutItem).

Build
- yarn lint
- yarn bundle
- Output: dist/* and lambda_function.zip

Notes
- Mirrors the pattern used by admin-integration-settings for clean separation and minimal blast radius.
