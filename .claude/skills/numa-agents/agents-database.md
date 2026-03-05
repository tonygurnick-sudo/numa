# Numa Agents: Database Schema

## DynamoDB Tables

### 1. Workspace Agents Table

**Table Name:** `{client}-agents`
**Purpose:** Stores public/workspace-shared agents

| Attribute                      | Type   | Key | Description                                  |
| ------------------------------ | ------ | --- | -------------------------------------------- |
| `tenant_id`                    | String | PK  | Workspace/tenant identifier                  |
| `agent_id`                     | String | SK  | Agent ID (`agt_<uuid>`)                      |
| `title`                        | String |     | Display name                                 |
| `description`                  | String |     | What the agent does                          |
| `system_prompt`                | String |     | Core instructions for Claude                 |
| `user_welcome_message`         | String |     | Greeting shown at session start              |
| `visibility`                   | String |     | Always `'public'` for this table             |
| `agent_type`                   | String |     | `'task'`, `'knowledge'`, `'scheduled'`, etc. |
| `icon`                         | String |     | Bootstrap icon class                         |
| `icon_image`                   | Map    |     | `{ s3_bucket, s3_key }` for custom image     |
| `required_integrations`        | List   |     | Pipedream integration IDs                    |
| `tools_config`                 | Map    |     | Tool permissions (see below)                 |
| `reference_files`              | List   |     | Attached files (see below)                   |
| `estimated_time_saved_minutes` | Number |     | Productivity metric                          |
| `creator_id`                   | String |     | User ID who created the agent                |
| `created_by_name`              | String |     | Display name of creator                      |
| `created_at`                   | Number |     | Unix timestamp                               |
| `updated_at`                   | Number |     | Unix timestamp                               |
| `version`                      | Number |     | Optimistic locking                           |
| `source_agent_id`              | String |     | Original agent if duplicated                 |

**GSI:** `tenant_id-updated_at-index` for listing agents sorted by recency

---

### 2. User Agents Table

**Table Name:** `{client}-user-agents`
**Purpose:** Stores personal/private agents

| Attribute                      | Type    | Key | Description                        |
| ------------------------------ | ------- | --- | ---------------------------------- |
| `user_id`                      | String  | PK  | Owner's user ID                    |
| `agent_id`                     | String  | SK  | Agent ID (`agt_<uuid>`)            |
| `tenant_id`                    | String  |     | Workspace for reference            |
| `title`                        | String  |     | Display name                       |
| `description`                  | String  |     | What the agent does                |
| `system_prompt`                | String  |     | Core instructions                  |
| `user_welcome_message`         | String  |     | Greeting message                   |
| `visibility`                   | String  |     | Always `'personal'` for this table |
| `agent_type`                   | String  |     | Agent category                     |
| `icon`                         | String  |     | Bootstrap icon                     |
| `icon_image`                   | Map     |     | Custom image reference             |
| `required_integrations`        | List    |     | Required integrations              |
| `tools_config`                 | Map     |     | Tool permissions                   |
| `reference_files`              | List    |     | Attached files                     |
| `estimated_time_saved_minutes` | Number  |     | Time saved estimate                |
| `created_at`                   | Number  |     | Unix timestamp                     |
| `updated_at`                   | Number  |     | Unix timestamp                     |
| `version`                      | Number  |     | Optimistic locking                 |
| `source_agent_id`              | String  |     | Original if duplicated             |
| `is_favorite`                  | Boolean |     | User's favorite flag               |

**GSI:** `user_id-updated_at-index` for listing user's agents

---

### 3. Agents Settings Table

**Table Name:** `{client}-agents-settings`
**Purpose:** Stores workspace-level agent policy

| Attribute    | Type   | Key | Description                             |
| ------------ | ------ | --- | --------------------------------------- |
| `setting`    | String | PK  | Always `'agents_policy'`                |
| `mode`       | String |     | `'off'`, `'personal_only'`, or `'full'` |
| `updated_at` | Number |     | Last modified timestamp                 |
| `updated_by` | String |     | Admin user ID                           |

**Mode Effects:**

- `'off'` - Agents feature completely disabled
- `'personal_only'` - Only personal agents, no sharing
- `'full'` - Full agent sharing with marketplace

---

## Nested Data Structures

### tools_config Map

```json
{
  "autoToolsEnabled": true,
  "queryDataSources": true,
  "webSearchEnabled": false,
  "createAgentEnabled": false,
  "enabledConnections": ["slack", "notion"],
  "allowedKnowledgeBases": ["kb-123", "kb-456"]
}
```

| Field                   | Type                 | Description                             |
| ----------------------- | -------------------- | --------------------------------------- |
| `autoToolsEnabled`      | Boolean              | Agent auto-selects tools                |
| `queryDataSources`      | Boolean              | Can access knowledge base               |
| `webSearchEnabled`      | Boolean              | Can search the web                      |
| `createAgentEnabled`    | Boolean              | Can create sub-agents                   |
| `enabledConnections`    | List<String>         | Pipedream integration IDs               |
| `allowedKnowledgeBases` | List<String> or null | `null`=all, `[]`=none, `['x']`=specific |

### reference_files List Item

```json
{
  "fileName": "report.pdf",
  "fileType": "application/pdf",
  "fileSize": 1048576,
  "s3Key": "agents/agt_abc123/files/report.pdf",
  "s3Bucket": "numa-client-outputs",
  "extractedContentS3Key": "agents/agt_abc123/extracted/report.txt",
  "uploadedAt": "2024-01-15T10:30:00Z",
  "source": "upload"
}
```

| Field                   | Type   | Description                    |
| ----------------------- | ------ | ------------------------------ |
| `fileName`              | String | Original file name             |
| `fileType`              | String | MIME type                      |
| `fileSize`              | Number | Size in bytes                  |
| `s3Key`                 | String | Path in S3 bucket              |
| `s3Bucket`              | String | Bucket name                    |
| `extractedContentS3Key` | String | Extracted text location        |
| `uploadedAt`            | String | ISO timestamp                  |
| `source`                | String | `'upload'` or `'conversation'` |

### icon_image Map

```json
{
  "s3Bucket": "numa-client-outputs",
  "s3Key": "agent-icons/public/agt_abc123.png"
}
```

---

## S3 Storage Patterns

### Reference Files

**Bucket:** `{client}-outputs` (same as chat outputs)

```
agents/
├── {agentId}/
│   ├── files/
│   │   ├── document.pdf
│   │   ├── spreadsheet.xlsx
│   │   └── image.png
│   └── extracted/
│       ├── document.txt
│       ├── spreadsheet.txt
│       └── image.txt
```

### Agent Icons

**Bucket:** `{client}-outputs`

```
agent-icons/
├── {userId}/           # Personal agent icons
│   └── icon.png
└── public/             # Workspace agent icons
    ├── agt_abc123.png
    └── agt_def456.jpg
```

**Icon Normalization:**

- When agent changes from personal → public: icon copied to `public/` prefix
- Public icons use agent ID as filename
- Personal icons use user-specific prefix

---

## Access Patterns

### List User's Agents

```
Query user-agents: PK = user_id
Query workspace-agents: creator_id = user_id (via GSI or filter)
Merge results, sort by updated_at DESC
```

### List Workspace Agents (Marketplace)

```
Query workspace-agents: PK = tenant_id
Filter: creator_id != current_user_id (exclude own)
Sort by updated_at DESC
```

### Get Single Agent

```
Parallel queries:
  - user-agents: PK = user_id, SK = agent_id
  - workspace-agents: PK = tenant_id, SK = agent_id
Return whichever exists
```

### Check Edit Permission

```
IF agent in user-agents AND user_id matches → allowed
IF agent in workspace-agents:
  IF creator_id == user_id → allowed
  IF user is admin → allowed
  ELSE → denied
```

---

## Infrastructure

### CDKTF Definition

**Location:** `/infra/constructs/numa-chat-agent-construct.ts`

```typescript
// Tables created in construct
const workspaceAgentsTable = new DynamodbTable(this, 'workspace-agents', {
  name: `${clientName}-agents`,
  hashKey: 'tenant_id',
  rangeKey: 'agent_id',
  billingMode: 'PAY_PER_REQUEST',
  // ...attributes and GSIs
});

const userAgentsTable = new DynamodbTable(this, 'user-agents', {
  name: `${clientName}-user-agents`,
  hashKey: 'user_id',
  rangeKey: 'agent_id',
  billingMode: 'PAY_PER_REQUEST',
  // ...
});

const agentsSettingsTable = new DynamodbTable(this, 'agents-settings', {
  name: `${clientName}-agents-settings`,
  hashKey: 'setting',
  billingMode: 'PAY_PER_REQUEST',
});
```

### Environment Variables

Lambdas receive table names via environment:

```
WORKSPACE_AGENTS_TABLE={client}-agents
USER_AGENTS_TABLE={client}-user-agents
AGENTS_SETTINGS_TABLE_NAME={client}-agents-settings
```

---

## Data Flow Examples

### Create Personal Agent

```
1. Frontend: POST /api/agents { visibility: 'personal', ... }
2. Lambda: Generate agent_id = "agt_" + uuid
3. Lambda: PutItem to user-agents table
   - PK: user_id
   - SK: agent_id
4. If reference files: Upload to S3 agents/{agentId}/files/
5. Return created agent
```

### Publish Agent to Workspace

```
1. Frontend: PUT /api/agents/{id} { visibility: 'public' }
2. Lambda: Read from user-agents (verify ownership)
3. Lambda: Copy icon to public/ prefix if needed
4. Lambda: PutItem to workspace-agents table
   - PK: tenant_id
   - SK: agent_id
   - creator_id: user_id
5. Lambda: Keep in user-agents (dual storage)
6. Return updated agent
```

### Duplicate Agent

```
1. Frontend: POST /api/agents/{id}/duplicate
2. Lambda: Read source agent (either table)
3. Lambda: Generate new agent_id
4. Lambda: Copy reference files to new S3 prefix
5. Lambda: PutItem to user-agents (always personal)
   - source_agent_id: original agent_id
6. Return new agent
```
