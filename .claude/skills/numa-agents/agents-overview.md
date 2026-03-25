# Numa Agents: Overview

## What Are Agents?

Agents in Numa are **configurable AI chat wrappers** - they customize how Claude behaves during a chat session. They are NOT separate AI models or independent systems.

Think of agents as **presets** that combine:

- A custom system prompt (personality, instructions, expertise)
- Tool permissions (what the agent can do)
- Reference materials (documents the agent knows about)
- Integration access (external services it can use)
- Approval mode (controls integration tool call approval behavior)
- Tags (categorization labels, up to 20 per agent)

## How Agents Work

```
+-------------------------------------------------------------+
|                    User's Chat Message                       |
+----------------------------+--------------------------------+
                             |
                             v
+-------------------------------------------------------------+
|                     Agent Selected?                          |
|  +--------------+              +--------------------------+  |
|  | No Agent     |              | Agent Active             |  |
|  |              |              |                          |  |
|  | Default      |              | agent.systemPrompt       |  |
|  | Numa Chat    |              | + agent.toolsConfig      |  |
|  | behavior     |              | + agent.referenceFiles   |  |
|  +--------------+              +--------------------------+  |
+----------------------------+--------------------------------+
                             |
                             v
+-------------------------------------------------------------+
|              numa-workspace-agent (AgentCore MicroVM)        |
|                                                              |
|  agent_config.py fetches agent from DynamoDB                 |
|  System Prompt = base_prompt + agent.systemPrompt            |
|  Tools Enabled = based on agent.toolsConfig                  |
|  KB Access = agent.allowedKnowledgeBases                     |
|  Integrations = agent.enabledConnections                     |
|  Approval Mode = agent.approvalMode (or user default)        |
+----------------------------+--------------------------------+
                             |
                             v
+-------------------------------------------------------------+
|                   Claude Response                            |
|           (reflects agent's personality & capabilities)      |
+-------------------------------------------------------------+
```

## Agent Configuration Options

### 1. Identity & Instructions

| Field               | Purpose             | Example                                |
| ------------------- | ------------------- | -------------------------------------- |
| **Title**           | Display name        | "Financial Analyst"                    |
| **Description**     | What the agent does | "Helps analyze financial documents"    |
| **System Prompt**   | Core instructions   | "You are a financial expert..."        |
| **Welcome Message** | Greeting to user    | "Hello! Upload your financial docs..." |

### 2. Tools & Capabilities

| Option                | Effect                                                   |
| --------------------- | -------------------------------------------------------- |
| **Auto-select tools** | Agent chooses which tools to use                         |
| **Knowledge Base**    | Access to company documents (all, none, or specific KBs) |
| **Web Search**        | Can search the internet                                  |
| **Create Agents**     | Can create new agents from conversation                  |
| **Memories**          | Can use user memories                                    |
| **Numa Ops**          | Can use Numa Ops tools (tickets, projects, etc.)         |
| **Integrations**      | External services (Slack, Notion, etc.)                  |
| **Approval Mode**     | Controls integration tool call approval behavior         |

### 3. Reference Files

Agents can have up to 5 attached files that provide context:

- PDFs, Word docs, Excel files
- Images (PNG, JPG)
- Audio/video files
- Code files (Python, JavaScript, etc.)

These files are processed and made available to the agent during chat.

### 4. Appearance

| Option                  | Purpose               |
| ----------------------- | --------------------- |
| **Icon**                | Bootstrap icon class  |
| **Icon Image**          | Custom uploaded image |
| **Time Saved Estimate** | Productivity metric   |

### 5. Tags

Agents support up to 20 tags for categorization. Tags are normalized (trimmed, lowercased, deduplicated) on save.

## Agent Types

### By Visibility

| Type                 | Who Can See         | Storage                      |
| -------------------- | ------------------- | ---------------------------- |
| **Personal**         | Only creator        | `{client}-user-agents` table |
| **Public/Workspace** | All workspace users | `{client}-agents` table      |

### By Agent Type Field

The `agentType` field is flexible:

- `task` - General task-focused agent
- `knowledge` - Knowledge base focused
- `scheduled` - Runs on schedule
- Custom strings allowed

## User Flows

### Creating an Agent

1. Go to `/agents` page
2. Click "Create Agent"
3. Fill in title + system prompt (required)
4. Configure tools, add files, set visibility
5. Save - Agent appears in list

### Using an Agent in Chat

1. Go to `/chat` (`NumaWorkspaceChatAgents`)
2. Open agents panel or select from conversation sidebar
3. Select an agent
4. (Check for missing integrations if any)
5. Start chatting - Agent context applied via `agent_config.py` in the workspace agent

### Creating an Agent from Chat

1. Ask the workspace agent to create an agent
2. The `numa_tool.py` MCP tool handles the `agents` operation
3. Intent verification checks user explicitly confirmed creation
4. Agent is stored in DynamoDB via the workspace-chat-tools Lambda

### Sharing an Agent

1. Edit an existing agent
2. Change visibility to "Public"
3. Confirm the warning
4. Agent appears in "Company Marketplace" for others

### Duplicating an Agent

1. Find agent in list or marketplace
2. Click "Duplicate"
3. Creates personal copy
4. Edit your copy as needed

### Scheduling an Agent

1. From the agents page or scheduling page, create a schedule
2. Configure cron expression, timezone, prompt text
3. Schedule runs via EventBridge Scheduler -> `agent-schedule-runner` Lambda
4. Results tracked in `{client}-agent-schedules` DynamoDB table

## Feature Administration

Admins can control agent availability via `/api/settings/agents`:

| Mode            | Effect                              |
| --------------- | ----------------------------------- |
| `off`           | Agents feature completely disabled  |
| `personal_only` | Only personal agents, no sharing    |
| `full`          | Full agent support with marketplace |

## Key Concepts

### Agents Are Chat Wrappers

Agents don't run independently - they modify how the standard chat works:

- Same underlying Claude model
- Same `numa-workspace-agent` service (AgentCore MicroVM)
- Just different configuration applied via `agent_config.py`

### System Prompt Composition

When an agent is active:

```
Final Prompt = Base Numa Prompt
             + Agent's System Prompt
             + Agent's Welcome Message (as guidance)
             + Reference Files (as context)
```

### Tool Permissions Are Additive

Agent tools config enables/disables features:

- `autoToolsEnabled: true` - Agent picks tools automatically
- `queryDataSources: true` - Can access knowledge base
- `webSearchEnabled: true` - Can search web
- `memoriesEnabled: true` - Can use user memories
- `numaOpsEnabled: true` - Can use Numa Ops tools
- `approvalMode` - Controls integration approval (`always`, `non_destructive`, `never`)
- Each integration must be explicitly enabled

### Reference Files Are Indexed

When you add files to an agent:

1. Files uploaded to S3
2. Content extracted and processed
3. Made available in agent context
4. Persisted with agent record
