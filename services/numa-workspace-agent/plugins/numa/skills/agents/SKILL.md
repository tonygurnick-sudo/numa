---
name: agents
description: Manage Numa agents - list, create, update, and duplicate custom AI agents. Use when the user wants to work with saved agents or create new ones. Supports attaching workspace files as reference documents.
---

# Agent Management Skill

Create, list, update, and duplicate Numa agents from the workspace. Supports attaching reference files from the workspace.

## Quick Reference

```python
# List your agents
mcp__numa__numa_tool(name="agents", description="List my agents", params={
    "operation": "list", "scope": "owned"
})

# Get agent details
mcp__numa__numa_tool(name="agents", description="Get agent details", params={
    "operation": "get", "agent_id": "agt_abc123"
})

# Create a new agent
mcp__numa__numa_tool(name="agents", description="Create customer support agent", params={
    "operation": "create",
    "title": "Customer Support Agent",
    "systemPrompt": "You are a helpful customer support assistant...",
    "visibility": "personal"
})

# Create an agent with file attachments
mcp__numa__numa_tool(name="agents", description="Create policy expert agent", params={
    "operation": "create",
    "title": "Policy Expert",
    "systemPrompt": "You help answer questions about company policies.",
    "attach_files": ["/workdir/uploads/handbook.pdf", "/workdir/uploads/policies.docx"]
})
```

## Operations

| Operation   | Purpose                                |
| ----------- | -------------------------------------- |
| `list`      | List agents (owned, public, or all)    |
| `get`       | Get details of a specific agent        |
| `create`    | Create a new agent                     |
| `update`    | Update an existing agent               |
| `duplicate` | Copy an agent to your personal library |

---

## List Operation

List agents with scope filtering.

### Parameters

| Parameter    | Required | Default   | Description                 |
| ------------ | -------- | --------- | --------------------------- |
| `operation`  | Yes      | -         | `"list"`                    |
| `scope`      | No       | `"owned"` | `owned`, `public`, or `all` |
| `agent_type` | No       | -         | Filter by agent type        |

### Examples

```python
# List your personal agents and agents you created
mcp__numa__numa_tool(name="agents", description="List my agents", params={
    "operation": "list", "scope": "owned"
})

# List all public/company agents
mcp__numa__numa_tool(name="agents", description="List public agents", params={
    "operation": "list", "scope": "public"
})

# List all agents you can access
mcp__numa__numa_tool(name="agents", description="List all agents", params={
    "operation": "list", "scope": "all"
})

# Filter by agent type
mcp__numa__numa_tool(name="agents", description="List task agents", params={
    "operation": "list", "scope": "owned", "agent_type": "task"
})
```

### Output Format

JSON response with:

- `agents` - Array of agent summaries, each containing:
  - `agentId` - Unique agent ID
  - `title` - Agent display name
  - `description` - Brief description
  - `scope` - "user" (personal) or "workspace" (public)
  - `visibility` - "personal" or "public"
  - `agentType` - Agent type (e.g., "task")
  - `createdBy` - Creator info
  - `updatedAt` - Last update timestamp

---

## Get Operation

Get detailed information about a specific agent.

### Parameters

| Parameter   | Required | Description          |
| ----------- | -------- | -------------------- |
| `operation` | Yes      | `"get"`              |
| `agent_id`  | Yes      | Agent ID to retrieve |

### Examples

```python
mcp__numa__numa_tool(name="agents", description="Get agent details", params={
    "operation": "get", "agent_id": "agt_abc123"
})
```

### Output Format

JSON response with full agent details including:

- `agentId`, `title`, `description`
- `systemPrompt` - The agent's instructions
- `userWelcomeMessage` - Welcome message shown to users
- `toolsConfig` - Which tools the agent can use
- `referenceFiles` - Attached reference documents

---

## Create Operation

Create a new agent with custom instructions.

### Parameters

| Parameter                   | Required | Default      | Description                                     |
| --------------------------- | -------- | ------------ | ----------------------------------------------- |
| `operation`                 | Yes      | -            | `"create"`                                      |
| `title`                     | Yes      | -            | Agent display name                              |
| `systemPrompt`              | Yes      | -            | Core instructions for the agent                 |
| `visibility`                | No       | `"personal"` | `personal` or `public`                          |
| `description`               | No       | -            | One-line description                            |
| `agentType`                 | No       | `"task"`     | Agent type label                                |
| `userWelcomeMessage`        | No       | -            | Greeting shown when agent starts                |
| `estimatedTimeSavedMinutes` | No       | -            | Estimated time saved in minutes                 |
| `toolsConfig`               | No       | -            | Tools configuration object                      |
| `attach_files`              | No       | -            | Array of workspace file paths to attach (max 5) |

### Examples

```python
# Create a personal agent
mcp__numa__numa_tool(name="agents", description="Create sales report agent", params={
    "operation": "create",
    "title": "Sales Report Generator",
    "systemPrompt": "You help create weekly sales reports from CRM data. Always include YoY comparisons and highlight significant changes.",
    "description": "Generates weekly sales reports with insights"
})

# Create a public/company agent
mcp__numa__numa_tool(name="agents", description="Create onboarding assistant", params={
    "operation": "create",
    "title": "Onboarding Assistant",
    "systemPrompt": "You help new employees navigate company resources and policies.",
    "visibility": "public",
    "description": "Helps new hires get started"
})

# Create with file attachments
mcp__numa__numa_tool(name="agents", description="Create policy expert agent", params={
    "operation": "create",
    "title": "Policy Expert",
    "systemPrompt": "You help answer questions about company policies using the attached documents.",
    "attach_files": ["/workdir/uploads/employee_handbook.pdf", "/workdir/uploads/benefits_guide.docx"]
})

# Create with tools configuration
mcp__numa__numa_tool(name="agents", description="Create research agent", params={
    "operation": "create",
    "title": "Research Agent",
    "systemPrompt": "You help with research tasks using web search and company KB.",
    "toolsConfig": {"webSearchEnabled": true, "allowedKnowledgeBases": ["company"]}
})
```

### Tools Configuration Options

```json
{
  "autoToolsEnabled": true,
  "webSearchEnabled": true,
  "allowedKnowledgeBases": ["company", "kb-uuid"]
}
```

- `autoToolsEnabled` - Enable automatic tool selection (default: true)
- `webSearchEnabled` - Allow web search (default: false)
- `allowedKnowledgeBases` - Which KBs can be queried (null = all, [] = none, array = specific)

### Visibility Rules

- **personal** - Only you can see and use the agent
- **public** - All company members can use the agent

### Policy Restrictions

Admin policies may restrict agent creation:

- **off** - Agent creation disabled for all users
- **personal_only** - Only personal agents allowed (public blocked)
- **full** - Both personal and public allowed

---

## Update Operation

Update an existing agent you own or have permission to edit.

### Parameters

| Parameter                   | Required | Description                                |
| --------------------------- | -------- | ------------------------------------------ |
| `operation`                 | Yes      | `"update"`                                 |
| `agent_id`                  | Yes      | Agent ID to update                         |
| `title`                     | No       | New title                                  |
| `systemPrompt`              | No       | New instructions                           |
| `visibility`                | No       | Change visibility (`personal` or `public`) |
| `description`               | No       | New description                            |
| `agentType`                 | No       | New agent type                             |
| `userWelcomeMessage`        | No       | New welcome message                        |
| `estimatedTimeSavedMinutes` | No       | New time saved estimate                    |
| `toolsConfig`               | No       | New tools configuration object             |
| `attach_files`              | No       | Workspace files to attach (max 5 total)    |

### Examples

```python
# Update agent title and description
mcp__numa__numa_tool(name="agents", description="Update agent title", params={
    "operation": "update",
    "agent_id": "agt_abc123",
    "title": "Sales Report Generator v2",
    "description": "Updated with quarterly projections"
})

# Update system prompt
mcp__numa__numa_tool(name="agents", description="Update agent prompt", params={
    "operation": "update",
    "agent_id": "agt_abc123",
    "systemPrompt": "Improved instructions..."
})

# Add file attachments to an existing agent
mcp__numa__numa_tool(name="agents", description="Attach file to agent", params={
    "operation": "update",
    "agent_id": "agt_abc123",
    "attach_files": ["/workdir/uploads/new_policy.pdf"]
})

# Enable web search for an agent
mcp__numa__numa_tool(name="agents", description="Enable web search for agent", params={
    "operation": "update",
    "agent_id": "agt_abc123",
    "toolsConfig": {"webSearchEnabled": true}
})
```

### Permissions

- You can update your own personal agents
- You can update company agents you created
- Admins can update any company agent

---

## File Attachments

Agents can have reference files attached that provide context for answering questions. Files are copied to permanent agent storage when attached.

### Supported Locations

Files can be attached from these workspace locations:

- `/workdir/uploads/` - User-uploaded files
- `/workdir/outputs/` - Files created during the conversation
- `/workdir/chat-workflows/` - Workflow output files

### How It Works

1. **Upload/Create files first** - Files must exist in the workspace before attaching
2. **Use `attach_files`** - Provide an array of full workspace paths
3. **Files are copied** - Files are copied to permanent agent storage (original files remain)
4. **Extracted content included** - If the file has been processed with the `extract_content` tool (via `numa_tool` MCP), the extracted text is also attached

### Limits

- Maximum 5 reference files per agent
- When updating, new attachments are added to existing files (up to the 5 file limit)

### Example Workflow

```python
# 1. User uploads files to workspace (via UI or prior steps)
# Files are now at /workdir/uploads/handbook.pdf, /workdir/uploads/policies.docx

# 2. Optionally extract content for better search
mcp__numa__numa_tool(name="extract_content", description="Extract content from handbook", params={
    "file_path": "/workdir/uploads/handbook.pdf"
})

# 3. Create agent with file attachments
mcp__numa__numa_tool(name="agents", description="Create HR assistant agent", params={
    "operation": "create",
    "title": "HR Assistant",
    "systemPrompt": "You help employees with HR questions using the attached handbook and policies.",
    "attach_files": ["/workdir/uploads/handbook.pdf", "/workdir/uploads/policies.docx"]
})
```

---

## Duplicate Operation

Create a personal copy of any agent you can access.

### Parameters

| Parameter   | Required | Description           |
| ----------- | -------- | --------------------- |
| `operation` | Yes      | `"duplicate"`         |
| `agent_id`  | Yes      | Agent ID to duplicate |

### Examples

```python
# Duplicate a company agent to your personal library
mcp__numa__numa_tool(name="agents", description="Duplicate company agent", params={
    "operation": "duplicate", "agent_id": "agt_company123"
})

# Duplicate your own agent to make a variant
mcp__numa__numa_tool(name="agents", description="Duplicate my agent", params={
    "operation": "duplicate", "agent_id": "agt_personal456"
})
```

The duplicate is always created as a **personal** agent with "(Copy)" appended to the title. If a copy already exists, it becomes "(Copy 2)", "(Copy 3)", etc.

---

## When to Use

Use this skill when the user:

- Asks to "create an agent" or "make a bot"
- Wants to "see my agents" or "list agents"
- Asks to "update/modify/edit an agent"
- Wants to "copy/duplicate an agent"
- Asks about "my saved agents" or "company agents"

### Trigger Phrases for Interactive Creation

When you hear any of these phrases, **start the Interactive Agent Creation Process** (see Common Workflows section):

- "Help me create an agent"
- "I want to build an agent"
- "Create an agent for..."
- "Make me an agent that..."
- "I need an agent to..."
- "Can you make an agent..."
- "Let's create an agent"
- "Build me a bot that..."

**Important:** For these creation requests, always start with Step 1 (Use Case Discovery) rather than immediately asking for technical parameters. The interactive process helps users who don't know exactly what parameters they need.

## When NOT to Use

- User is chatting WITH an agent (the agent is already loaded)
- User is asking ABOUT agents conceptually (general questions)
- User wants to DELETE an agent (deletion must be done via the web UI)

---

## Common Workflows

### Interactive Agent Creation Process

When a user wants to create an agent, follow this structured conversation flow. **NEVER skip directly to creating an agent - always gather requirements first.**

#### Step 1: Use Case Discovery (Open-ended)

Start by understanding what the user needs. Ask open-ended questions and let them articulate their needs in their own words.

- "What would you like this agent to help you with?"
- "What tasks should this agent be able to handle?"
- "What outcome are you hoping to achieve?"

**Important:** Don't suggest examples or lead the user. Let them describe their use case naturally, then ask clarifying follow-up questions.

#### Step 2: Audience & Visibility

Once you understand the use case, determine who should have access:

- Ask: "Is this agent just for you, or should your whole company have access?"
- Explain the difference if needed:
  - **Personal** = Only you can see and use it
  - **Public** = Everyone in your company can use it

#### Step 3: Capability Assessment

Based on the use case, ask about the tools and capabilities the agent needs:

- **Web Search:** "Will this agent need to search the web for current information?"
- **Knowledge Bases:** "Should it have access to your company's knowledge bases?"
  - If yes: "All knowledge bases, or specific ones?"

Build the `toolsConfig` based on their answers:

```json
{
  "webSearchEnabled": true/false,
  "allowedKnowledgeBases": null  // null = all, [] = none, ["kb-id"] = specific
}
```

#### Step 4: Reference Documents

Check if the agent needs reference materials:

- "Are there any documents the agent should use as reference material?"
- If yes:
  - Check if files are already in the workspace (`/workdir/uploads/`)
  - Or guide them to upload files first
  - Remind about the **5 file maximum**

#### Step 5: Time Saved Estimate

Gather the value metric:

- "Roughly how much time do you think this agent will save per use? (in minutes)"
- This helps track the agent's value and can be adjusted later

#### Step 6: Draft Presentation

Before creating anything, present a complete draft for review:

```
## Agent Draft

**Title:** [Proposed title based on the use case]
**Description:** [One-line summary of what the agent does]
**Visibility:** personal / public

**System Prompt:**
> [The complete instructions for the agent, written based on your conversation]

**Tools Configuration:**
- Web Search: enabled / disabled
- Knowledge Bases: all / specific list / none

**Reference Files:** (if any)
- file1.pdf
- file2.docx

**Time Saved:** X minutes per use
```

#### Step 7: User Confirmation

**CRITICAL: Never create an agent without explicit user approval.**

- Ask: "Does this look good? Let me know if you'd like any changes, or say 'create it' to proceed."
- Wait for explicit confirmation like "yes", "create it", "looks good", etc.
- If the user requests changes:
  1. Update the draft
  2. Present the updated draft
  3. Ask for confirmation again
- Only proceed to creation after receiving clear approval

Once confirmed, execute the create call:

```python
mcp__numa__numa_tool(name="agents", description="Create agent", params={
    "operation": "create",
    "title": "Agent Title",
    "systemPrompt": "The complete system prompt...",
    "description": "One-line description",
    "visibility": "personal",
    "estimatedTimeSavedMinutes": 15,
    "toolsConfig": {"webSearchEnabled": true, "allowedKnowledgeBases": null}
})
```

---

### Example: Interactive Agent Creation Conversation

Here's how a typical agent creation conversation should flow:

```
User: I want to create an agent

Numa: I'd be happy to help you create an agent! What would you like this agent
      to help you with?

User: Help me write weekly status reports

Numa: Great idea - a status report assistant. A few questions to make sure I
      build this right for you:

      Is this agent just for you, or should your whole company have access?

User: Just me

Numa: Got it, personal visibility.

      Will this agent need any special capabilities?
      - Should it be able to search the web for current information?
      - Should it access your company's knowledge bases?

User: No web search, but it should be able to search our company KB

Numa: Perfect. Are there any documents you'd like to attach as reference
      material for this agent? For example, a template or style guide?

User: No documents needed

Numa: Last question - roughly how much time do you think this agent will save
      you each week?

User: Maybe 15 minutes

Numa: Here's the draft:

      ## Agent Draft

      **Title:** Weekly Status Report Assistant
      **Description:** Helps write weekly status reports by organizing
                       accomplishments and plans
      **Visibility:** personal

      **System Prompt:**
      > You are a helpful assistant that helps write weekly status reports.
      > When the user provides their accomplishments and plans, you:
      > 1. Organize the information clearly
      > 2. Use professional but concise language
      > 3. Highlight key achievements
      > 4. Structure the report with clear sections
      > Ask clarifying questions if the user's input is unclear.

      **Tools Configuration:**
      - Web Search: disabled
      - Knowledge Bases: all (company KB access)

      **Reference Files:** none

      **Time Saved:** 15 minutes

      Does this look good, or would you like any changes?

User: Change the title to "Weekly Report Helper"

Numa: Updated draft:

      ## Agent Draft

      **Title:** Weekly Report Helper
      [... rest of draft with updated title ...]

      Ready to create this agent?

User: Yes, create it

Numa: [Executes create call and confirms success]
```

---

### Create an agent from conversation context

If the user has been working on a task and wants to save it as a reusable agent based on what you've discussed:

1. Summarize what you've learned about their needs from the conversation
2. **Still follow Steps 2-7** of the interactive process above
3. Pre-fill the draft based on conversation context, but still get confirmation

```python
mcp__numa__numa_tool(name="agents", description="Create weekly report helper agent", params={
    "operation": "create",
    "title": "Weekly Report Helper",
    "systemPrompt": "Based on our conversation, here are the instructions...",
    "description": "Helps create weekly status reports"
})
```

### Find and use an agent

When user asks about available agents:

1. List agents to show options
2. Get details of specific agent if needed
3. The user can select the agent via the UI

```python
# Show available agents
mcp__numa__numa_tool(name="agents", description="List all agents", params={
    "operation": "list", "scope": "all"
})

# Get details about a specific one
mcp__numa__numa_tool(name="agents", description="Get agent details", params={
    "operation": "get", "agent_id": "agt_abc123"
})
```

### Improve an existing agent

When user wants to enhance an agent:

1. Get current agent details
2. Discuss improvements with user
3. Update with new instructions

```python
# Get current state
mcp__numa__numa_tool(name="agents", description="Get agent details", params={
    "operation": "get", "agent_id": "agt_abc123"
})

# Update with improvements
mcp__numa__numa_tool(name="agents", description="Update agent instructions", params={
    "operation": "update",
    "agent_id": "agt_abc123",
    "systemPrompt": "Improved instructions..."
})
```
