# Numa Agents: Backend Implementation

## Agent APIs

### Main Agents Lambda

**Location:** `/lambdas/node/agents/index.ts`
**Runtime:** Node.js 22.x
**Authentication:** Required (Cognito JWT)

#### CRUD Operations

| Operation     | Endpoint                          | Method | Description                |
| ------------- | --------------------------------- | ------ | -------------------------- |
| **List**      | `/api/agents`                     | GET    | List owned + public agents |
| **Get**       | `/api/agents/{agentId}`           | GET    | Get single agent           |
| **Create**    | `/api/agents`                     | POST   | Create new agent           |
| **Update**    | `/api/agents/{agentId}`           | PUT    | Update agent               |
| **Delete**    | `/api/agents/{agentId}`           | DELETE | Delete agent               |
| **Duplicate** | `/api/agents/{agentId}/duplicate` | POST   | Clone agent                |

#### List Agents Query Parameters

| Param       | Values                    | Default |
| ----------- | ------------------------- | ------- |
| `scope`     | `owned`, `public`, `all`  | `owned` |
| `agentType` | `task`, `knowledge`, etc. | (all)   |

### Admin Settings Lambda

**Location:** `/lambdas/node/admin-agents-settings/index.ts`

| Endpoint               | Method | Auth          | Description          |
| ---------------------- | ------ | ------------- | -------------------- |
| `/api/settings/agents` | GET    | Public + Auth | Read agents policy   |
| `/api/settings/agents` | PUT    | Admin only    | Update agents policy |

**Policy Modes:**

- `'off'` - Agents disabled
- `'personal_only'` - Only personal agents
- `'full'` - Full agent sharing enabled

---

## Request Flows

### Create Agent (POST /api/agents)

```
Frontend (with JWT)
    ↓
API Gateway (Cognito authorizer)
    ↓
/lambdas/node/agents handler
    ↓
validateCreatePayload()
    - Check title, systemPrompt required
    - Validate referenceFiles ≤ 5
    ↓
Read AGENTS_SETTINGS_TABLE
    - mode='off' → 403 Forbidden
    - mode='personal_only' + visibility='public' → 403 Forbidden
    - mode='full' → continue
    ↓
generateAgentId() → "agt_<uuid>"
    ↓
IF visibility='public':
    buildWorkspaceItem() → DynamoDB PutItem (workspace table)
    Normalize icon to public S3 prefix
ELSE:
    buildUserItem() → DynamoDB PutItem (user table)
    ↓
Return 201 with agent
```

### Update Agent (PUT /api/agents/{agentId})

```
GET both tables (parallel):
    - getUserAgentById(agentId, userId)
    - getWorkspaceAgentById(agentId, tenantId)
    ↓
IF userAgent exists:
    Merge payload with existing
    IF visibility='public' → also update/create workspace agent
    ELSE → delete from workspace if creator
ELSE IF workspaceAgent exists:
    Check permission: creator_id == user_id OR isAdmin
    IF denied → 403
    ↓
Return 200 with agent
```

### List Agents (GET /api/agents)

```
Query both tables:
    - listUserAgents(userId)
    - listWorkspaceAgentsByCreator(userId)
    - listWorkspaceAgentsForTenant()
    ↓
Filter by scope parameter
Filter by agentType if provided
Sort by updated_at DESC
    ↓
Read agents policy
    - mode='personal_only' → exclude workspace agents
    - mode='off' → return empty list
    ↓
Return 200 with agents[]
```

---

## Workspace Agent Integration

### Environment Variables

Set in `workspace-chat-agent-construct.ts`:

```
WORKSPACE_AGENTS_TABLE=numa-{client}-agents
USER_AGENTS_TABLE=numa-{client}-user-agents
AGENTS_SETTINGS_TABLE_NAME={client}-agents-settings
```

### Agent Config Loading

**Location:** `services/numa-workspace-agent/numa_workspace_agent/agent_config.py`

When a chat request includes an `agentId`, the workspace agent fetches the agent config from DynamoDB and applies it (system prompt, tools config, reference files, integrations).

### Agent Creation from Chat (numa CLI)

**Location:** `lambdas/python/workspace-chat-tools/tools/` (invoked server-side via the `numa-cli-api` Lambda)

Agents can be created/managed from within workspace chat via the `numa agents` CLI (run through the Bash tool):

```bash
# Commands: list, get, create, update, duplicate
numa agents create ... -m "Creating a new agent"
```

### Agent Scheduling

**Location:** `/lambdas/node/agent-schedules/index.ts`

| Endpoint                        | Method | Description           |
| ------------------------------- | ------ | --------------------- |
| `/api/agent-schedules`          | GET    | List user's schedules |
| `/api/agent-schedules`          | POST   | Create schedule       |
| `/api/agent-schedules/{id}`     | GET    | Get schedule          |
| `/api/agent-schedules/{id}`     | PUT    | Update schedule       |
| `/api/agent-schedules/{id}`     | DELETE | Delete schedule       |
| `/api/agent-schedules/calendar` | GET    | Calendar view         |

Schedules are stored in DynamoDB table `{client}-agent-schedules` (PK: `user_id`, SK: `schedule_id`). GSIs: `schedule-id-index`, `event-type-index`.

---

## Infrastructure (CDKTF)

### API Gateway Routing

**Location:** `/infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` (lines 353-410)

```typescript
// Agents API routes
this.addAgentApi(agentsLambda, {
  routes: [
    { method: 'GET', path: '/api/agents' },
    { method: 'POST', path: '/api/agents' },
    { method: 'GET', path: '/api/agents/{agentId}' },
    { method: 'PUT', path: '/api/agents/{agentId}' },
    { method: 'DELETE', path: '/api/agents/{agentId}' },
    { method: 'POST', path: '/api/agents/{agentId}/duplicate' },
  ],
  permissions: {
    dynamodb: ['Query', 'GetItem', 'PutItem', 'UpdateItem', 'DeleteItem', 'Scan'],
    s3: ['GetObject', 'PutObject', 'CopyObject', 'DeleteObject'],
  },
});
```

### Lambda Permissions

The agents Lambda needs:

- DynamoDB access to all three agent tables
- S3 access for icon management: `numa-chat/agent-icons/*`
- Read access to agents settings table

---

## Security & Authorization

### Authentication

- Cognito JWT bearer token required
- Parsed from `Authorization: Bearer <token>` header
- Admin settings GET is public (mode info)

### Authorization Rules

| Resource         | Who Can Read | Who Can Edit/Delete |
| ---------------- | ------------ | ------------------- |
| Personal agents  | Owner only   | Owner only          |
| Workspace agents | All users    | Creator or Admin    |
| Settings         | All users    | Admin only          |

### Admin Group Check

- Extracted from JWT: `cognito:groups` claim
- Required for: PUT `/api/settings/agents`

### Icon Image Handling

- Personal icons: `numa-chat/agent-icons/{userId}/*`
- Public icons: `numa-chat/agent-icons/public/{agentId}.*`
- Icons copied to public prefix when agent is published

---

## Key Files Summary

| File                                                              | Purpose                    |
| ----------------------------------------------------------------- | -------------------------- |
| `/lambdas/node/agents/index.ts`                                   | Main agents CRUD API       |
| `/lambdas/node/admin-agents-settings/index.ts`                    | Policy management          |
| `services/numa-workspace-agent/.../agent_config.py`               | Agent config loading       |
| `lambdas/python/workspace-chat-tools/tools/` (via `numa-cli-api`) | Chat agent CRUD (numa CLI) |
| `/lambdas/node/agent-schedules/index.ts`                          | Agent scheduling API       |
| `/infra/constructs/core-numa-infra-construct.ts`                  | Table definitions          |
| `/infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` | API routing                |

---

## Error Handling

| Status | Cause                                                        |
| ------ | ------------------------------------------------------------ |
| 400    | Invalid payload (missing title/systemPrompt, too many files) |
| 403    | Not authorized (not owner, not admin, policy denies)         |
| 404    | Agent not found                                              |
| 500    | Internal error                                               |

### Common Errors

**"Agents feature is disabled"** - Policy mode is 'off'
**"Public agents not allowed"** - Policy mode is 'personal_only'
**"Please confirm..."** - Intent verification failed (chat creation)
**"Permission denied"** - Trying to edit/delete agent you don't own
