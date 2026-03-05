# Numa Agents: Overview

## What Are Agents?

Agents in Numa are **configurable AI chat wrappers** - they customize how Claude behaves during a chat session. They are NOT separate AI models or independent systems.

Think of agents as **presets** that combine:

- A custom system prompt (personality, instructions, expertise)
- Tool permissions (what the agent can do)
- Reference materials (documents the agent knows about)
- Integration access (external services it can use)

## How Agents Work

```
┌─────────────────────────────────────────────────────────────┐
│                    User's Chat Message                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Agent Selected?                          │
│  ┌─────────────┐              ┌─────────────────────────┐   │
│  │ No Agent    │              │ Agent Active            │   │
│  │             │              │                         │   │
│  │ Default     │              │ agent.systemPrompt      │   │
│  │ Numa Chat   │              │ + agent.toolsConfig     │   │
│  │ behavior    │              │ + agent.referenceFiles  │   │
│  └─────────────┘              └─────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  numa-chat-agent Lambda                      │
│                                                              │
│  System Prompt = base_prompt + agent.systemPrompt           │
│  Tools Enabled = based on agent.toolsConfig                 │
│  KB Access = agent.allowedKnowledgeBases                    │
│  Integrations = agent.enabledConnections                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Claude Response                            │
│           (reflects agent's personality & capabilities)      │
└─────────────────────────────────────────────────────────────┘
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
| **Integrations**      | External services (Slack, Notion, etc.)                  |

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
- `scheduled` - Runs on schedule (future)
- Custom strings allowed

## User Flows

### Creating an Agent

1. Go to `/agents` page
2. Click "Create Agent"
3. Fill in title + system prompt (required)
4. Configure tools, add files, set visibility
5. Save → Agent appears in list

### Using an Agent in Chat

1. Go to `/chat`
2. Click "Agents" sidebar button
3. Select an agent
4. (Check for missing integrations if any)
5. Start chatting → Agent context applied

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
- Same numa-chat-agent Lambda
- Just different configuration applied

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

- `autoToolsEnabled: true` → Agent picks tools automatically
- `queryDataSources: true` → Can access knowledge base
- `webSearchEnabled: true` → Can search web
- Each integration must be explicitly enabled

### Reference Files Are Indexed

When you add files to an agent:

1. Files uploaded to S3
2. Content extracted and processed
3. Made available in agent context
4. Persisted with agent record
