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

## Chat Agent Integration

### Environment Variables

Set in `numa-chat-agent-construct.ts`:

```
WORKSPACE_AGENTS_TABLE={client}-agents
USER_AGENTS_TABLE={client}-user-agents
AGENTS_SETTINGS_TABLE_NAME={client}-agents-settings
```

### Agent Creation Tool

**Location:** `/lambdas/python/numa-chat-agent/numa_chat_agent/tools/agent_creation.py`

This Strands tool allows creating agents from within a chat conversation:

```python
@tool
def create_agent_tool(**kwargs) -> dict:
    """Create a new agent with the specified configuration."""
    # 1. Extract user context from auth
    # 2. Validate payload (title, systemPrompt)
    # 3. Check policy allows creation
    # 4. Verify user intent
    # 5. Normalize reference files
    # 6. Store in DynamoDB
    return {"status": "success", "agent": {...}}
```

### Intent Verification

**Location:** `/lambdas/python/numa-chat-agent/numa_chat_agent/intent_verification.py`

Before creating an agent from chat, the system verifies explicit user intent:

```python
def verify_user_intent_with_context(config, transcript, latest_message):
    """
    Uses fast LLM to classify if user explicitly confirmed agent creation.
    Returns 'YES' or 'NO' with explanation.
    """
    # Reads recent conversation snippets (max 24 items)
    # Calls fast model with verification prompt
    # If 'NO', returns denial message asking for confirmation
```

### Agent Creation Flow from Chat

```
numa-chat-agent (streaming)
    ↓
Tool registry includes: create_agent_tool
    ↓ (model calls tool)
get_current_user_auth() → extract user_id, conversation_id
    ↓
AgentPayload.from_kwargs(tool_args)
    ↓
_check_policy_allows_visibility()
    - Read AGENTS_SETTINGS_TABLE
    - policy='off' → denied
    - policy='personal_only' + visibility='public' → force personal
    ↓
get_recent_conversation_snippets(conversation_id, user_id, max=24)
    - Read from CHAT_HISTORY_TABLE
    ↓
verify_user_intent_with_context(config, transcript, latest)
    - Call fast LLM
    - decision='NO' → return "Please confirm..."
    ↓
_normalise_reference_files(specs, history_items, agent_id, user_id)
    - Copy files from conversation to agent S3 prefix
    ↓
_put_user_agent() OR _put_workspace_agent()
    - DynamoDB PutItem
    ↓
Return {status: 'success', agent: {...}, warnings: [...]}
```

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

| File                                                              | Purpose                |
| ----------------------------------------------------------------- | ---------------------- |
| `/lambdas/node/agents/index.ts`                                   | Main agents CRUD API   |
| `/lambdas/node/admin-agents-settings/index.ts`                    | Policy management      |
| `/lambdas/python/numa-chat-agent/.../agent_creation.py`           | Chat tool + guardrails |
| `/lambdas/python/numa-chat-agent/.../intent_verification.py`      | Intent classification  |
| `/infra/constructs/numa-chat-agent-construct.ts`                  | Chat agent config      |
| `/infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` | API routing            |

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
