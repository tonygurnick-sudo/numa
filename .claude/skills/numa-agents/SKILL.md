---
name: numa-agents
description: Create and manage Numa agents (AI chat wrappers with custom prompts and tools). Use when working with agents, agent builder, agent APIs, agent database schema, AgentCreateModal, agent tools config, agent visibility settings, agent scheduling, or agent tags.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Agents

Agents in Numa are **configurable AI chat wrappers** - they customize Claude's behavior with custom system prompts, tool permissions, reference files, and integrations.

## Quick Reference

### What Agents Are

Agents are NOT separate AI models. They're **configuration wrappers** that modify how the standard Numa chat behaves:

- **System Prompt** - Custom instructions prepended to all messages
- **Tools Config** - Which tools (KB, web search, integrations, memories, Numa Ops) the agent can use
- **Reference Files** - Documents the agent has access to
- **Integrations** - External services (Slack, Notion, etc.) the agent can use
- **Approval Mode** - Controls integration tool call approval behavior
- **Tags** - Categorization labels (up to 20 per agent)

### Architecture Overview

```
User creates agent (AgentCreateModal)
    |
Stored in DynamoDB (user-agents or workspace-agents table)
    |
User selects agent in chat (AgentsSidebar)
    |
Agent config applied to workspace chat request
    |
numa-workspace-agent receives: agentId in request body
    |
agent_config.py fetches agent from DynamoDB, applies system prompt + tools config
    |
Responses reflect agent's personality and capabilities
```

### Key Components

| Component            | Location                                                    | Purpose                          |
| -------------------- | ----------------------------------------------------------- | -------------------------------- |
| **AgentCreateModal** | `/numa-frontend/src/Components/Agents/AgentCreateModal.tsx` | Form for creating/editing agents |
| **AgentsManagement** | `/numa-frontend/src/Pages/AgentsManagement.tsx`             | List and manage agents           |
| **AgentsService**    | `/numa-frontend/src/Services/AgentsService.ts`              | CRUD API calls                   |
| **ScheduleService**  | `/numa-frontend/src/Services/ScheduleService.ts`            | Agent scheduling API calls       |
| **agents Lambda**    | `/lambdas/node/agents/index.ts`                             | Backend CRUD API                 |
| **agent-schedules**  | `/lambdas/node/agent-schedules/index.ts`                    | Backend scheduling API           |
| **agent_config.py**  | `/services/numa-workspace-agent/.../agent_config.py`        | Workspace agent config loader    |
| **numa_tool.py**     | `/services/numa-workspace-agent/.../mcp_tools/numa_tool.py` | MCP tool for agent ops from chat |

### Database Tables

| Table                      | Purpose                   | Primary Key               |
| -------------------------- | ------------------------- | ------------------------- |
| `{client}-agents`          | Workspace (public) agents | `tenant_id` + `agent_id`  |
| `{client}-user-agents`     | Personal agents           | `user_id` + `agent_id`    |
| `{client}-agents-settings` | Feature policy            | `setting`                 |
| `{client}-agent-schedules` | Agent schedules           | `user_id` + `schedule_id` |

### Agent Visibility

| Visibility | Storage                | Who Can See         |
| ---------- | ---------------------- | ------------------- |
| `personal` | user-agents table      | Only creator        |
| `public`   | workspace-agents table | All workspace users |

### API Endpoints

| Method | Path                            | Purpose         |
| ------ | ------------------------------- | --------------- |
| GET    | `/api/agents`                   | List agents     |
| GET    | `/api/agents/{id}`              | Get agent       |
| POST   | `/api/agents`                   | Create agent    |
| PUT    | `/api/agents/{id}`              | Update agent    |
| DELETE | `/api/agents/{id}`              | Delete agent    |
| POST   | `/api/agents/{id}/duplicate`    | Clone agent     |
| GET    | `/api/agent-schedules`          | List schedules  |
| GET    | `/api/agent-schedules/{id}`     | Get schedule    |
| POST   | `/api/agent-schedules`          | Create schedule |
| PUT    | `/api/agent-schedules/{id}`     | Update schedule |
| DELETE | `/api/agent-schedules/{id}`     | Delete schedule |
| GET    | `/api/agent-schedules/calendar` | Calendar events |

## Detailed Guides

For comprehensive documentation, see supporting files:

- **[agents-overview.md](agents-overview.md)** - Conceptual overview of how agents work
- **[agents-frontend.md](agents-frontend.md)** - Agent builder form, UI components, services, scheduling
- **[agents-backend.md](agents-backend.md)** - API handlers, workspace agent integration, MCP tools
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
    memoriesEnabled?: boolean;
    numaOpsEnabled?: boolean;
    enabledConnections?: string[];
    allowedKnowledgeBases?: string[] | null;
    approvalMode?: 'always' | 'non_destructive' | 'never';
  };
  referenceFiles?: AgentReferenceFile[];
  tags?: string[];
}
```

### Tools Config

```typescript
{
  autoToolsEnabled: boolean;           // Let agent auto-select tools
  queryDataSources: boolean;           // Access to knowledge base
  webSearchEnabled: boolean;           // Can search the web
  createAgentEnabled: boolean;         // Can create sub-agents
  memoriesEnabled: boolean;            // Can use user memories
  numaOpsEnabled: boolean;             // Can use Numa Ops tools
  enabledIntegrations: { slug, method: 'pipedream'|'native', name }[]; // method-tagged — source of truth
  enabledConnections: string[];        // legacy flat slug mirror (written in parallel)
  allowedKnowledgeBases: string[] | null; // null=all, []=none, ['x']=specific
  approvalMode: 'always' | 'non_destructive' | 'never'; // global default
  approvalModes: Record<string, 'always'|'non_destructive'|'never'>; // per-category:
                                        // integrations|agents|memories|knowledgeBases|ops|connectors
}
```

## Configuring agents from Numa chat / the CLI

`numa agents create` and `numa agents update` reach **full UI parity** — chat can
build a properly-configured agent in one call, not a barebones one. Beyond the
basics (`--prompt`, `--visibility`, `--description`, …):

- **Integrations:** `--enable-integration <slug>` (repeatable) — turns an integration
  on as a tool. Resolves the method from the user's connected integrations and writes
  both `enabledIntegrations` and `enabledConnections`. (Distinct from `--integration`,
  which only sets `requiredIntegrations`, a "user should connect this" hint.)
- **Capabilities:** `--web-search` / `--query-data-sources` / `--create-agent` /
  `--auto-tools` / `--memories` / `--numa-ops` (each with a `--no-` variant).
- **Knowledge bases:** `--knowledge-base <id>` (repeatable) · `--all-kbs` · `--no-kbs`.
- **Approvals:** `--approval-mode <always|non_destructive|never>` (global) and
  `--approval-modes '{"integrations":"never","agents":"always"}'` (per-category).
- **Taxonomy:** `--tag` (max 20) · `--persona` (CEO|Finance|HR|Operations|Commercial) ·
  `--industry` (Manufacturing|Construction|Engineering|Professional Services|Franchise).
  Invalid personas/industries are rejected.
- **Escape hatch:** `--tools-config '<json>'` accepts the full toolsConfig object
  (individual flags override it).

Example — an agent that can post to Slack, auto-approving its actions:

```bash
numa agents create "Slack Poster" --prompt-file ./prompt.txt \
  --enable-integration slack --approval-mode never \
  --tag automation --persona Commercial -m "Create Slack poster agent"
```

## Admin Feature Modes

Controlled via `/api/settings/agents`:

| Mode            | Behavior                     |
| --------------- | ---------------------------- |
| `off`           | Agents feature disabled      |
| `personal_only` | Only personal agents allowed |
| `full`          | Full agent sharing enabled   |
