---
name: numa-agents
description: Create and manage Numa agents (AI chat wrappers with custom prompts and tools). Use when working with agents, agent builder, agent APIs, agent database schema, AgentCreateModal, agent tools config, or agent visibility settings.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Agents

Agents in Numa are **configurable AI chat wrappers** - they customize Claude's behavior with custom system prompts, tool permissions, reference files, and integrations.

## Quick Reference

### What Agents Are

Agents are NOT separate AI models. They're **configuration wrappers** that modify how the standard Numa chat behaves:

- **System Prompt** - Custom instructions prepended to all messages
- **Tools Config** - Which tools (KB, web search, integrations) the agent can use
- **Reference Files** - Documents the agent has access to
- **Integrations** - External services (Slack, Notion, etc.) the agent can use

### Architecture Overview

```
User creates agent (AgentCreateModal)
    ↓
Stored in DynamoDB (user-agents or workspace-agents table)
    ↓
User selects agent in chat (AgentsSidebar)
    ↓
Agent config applied to chat request
    ↓
numa-chat-agent receives: base prompt + agent.systemPrompt + tools config
    ↓
Responses reflect agent's personality and capabilities
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **AgentCreateModal** | `/numa-frontend/src/Components/Agents/AgentCreateModal.tsx` | Form for creating/editing agents |
| **AgentsManagement** | `/numa-frontend/src/Pages/AgentsManagement.tsx` | List and manage agents |
| **AgentsService** | `/numa-frontend/src/Services/AgentsService.ts` | CRUD API calls |
| **agents Lambda** | `/lambdas/node/agents/index.ts` | Backend CRUD API |
| **agent_creation tool** | `/lambdas/python/numa-chat-agent/.../agent_creation.py` | Create agents from chat |

### Database Tables

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `{client}-agents` | Workspace (public) agents | `tenant_id` + `agent_id` |
| `{client}-user-agents` | Personal agents | `user_id` + `agent_id` |
| `{client}-agents-settings` | Feature policy | `setting` |

### Agent Visibility

| Visibility | Storage | Who Can See |
|------------|---------|-------------|
| `personal` | user-agents table | Only creator |
| `public` | workspace-agents table | All workspace users |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | List agents |
| GET | `/api/agents/{id}` | Get agent |
| POST | `/api/agents` | Create agent |
| PUT | `/api/agents/{id}` | Update agent |
| DELETE | `/api/agents/{id}` | Delete agent |
| POST | `/api/agents/{id}/duplicate` | Clone agent |

## Detailed Guides

For comprehensive documentation, see supporting files:

- **[agents-overview.md](agents-overview.md)** - Conceptual overview of how agents work
- **[agents-frontend.md](agents-frontend.md)** - Agent builder form, UI components, services
- **[agents-backend.md](agents-backend.md)** - API handlers, chat integration, intent verification
- **[agents-database.md](agents-database.md)** - DynamoDB schema, S3 storage, data model

## Key Data Structures

### Agent Payload (Create/Update)

```typescript
{
  title: string;                    // Required
  systemPrompt: string;             // Required - the agent's instructions
  description?: string;
  userWelcomeMessage?: string;
  visibility?: 'personal' | 'public';
  icon?: string;
  iconImage?: { s3Bucket, s3Key };
  requiredIntegrations?: string[];
  toolsConfig?: {
    autoToolsEnabled?: boolean;
    queryDataSources?: boolean;
    webSearchEnabled?: boolean;
    createAgentEnabled?: boolean;
    enabledConnections?: string[];
    allowedKnowledgeBases?: string[] | null;
  };
  referenceFiles?: AgentReferenceFile[];
}
```

### Tools Config

```typescript
{
  autoToolsEnabled: boolean;           // Let agent auto-select tools
  queryDataSources: boolean;           // Access to knowledge base
  webSearchEnabled: boolean;           // Can search the web
  createAgentEnabled: boolean;         // Can create sub-agents
  enabledConnections: string[];        // Pipedream integrations
  allowedKnowledgeBases: string[] | null; // null=all, []=none, ['x']=specific
}
```

## Admin Feature Modes

Controlled via `/api/settings/agents`:

| Mode | Behavior |
|------|----------|
| `off` | Agents feature disabled |
| `personal_only` | Only personal agents allowed |
| `full` | Full agent sharing enabled |
