---
name: agents
description: Manage Numa agents - list, create, update, and duplicate custom AI agents. Use when the user wants to work with saved agents or create new ones. Supports attaching workspace files as reference documents.
---

# Agent Management Skill

Create, list, update, and duplicate Numa agents from the workspace. Supports attaching reference files from the workspace.

## Quick Reference

```bash
# List your agents
python3 /workdir/tools/numa/numa-agents.py list --scope owned

# Get agent details
python3 /workdir/tools/numa/numa-agents.py get --agent-id agt_abc123

# Create a new agent
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Customer Support Agent" \
    --system-prompt "You are a helpful customer support assistant..." \
    --visibility personal

# Create an agent with file attachments
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Policy Expert" \
    --system-prompt "You help answer questions about company policies." \
    --attach-file /workdir/uploads/handbook.pdf \
    --attach-file /workdir/uploads/policies.docx
```

## Subcommands

| Subcommand | Purpose |
|------------|---------|
| `list` | List agents (owned, public, or all) |
| `get` | Get details of a specific agent |
| `create` | Create a new agent |
| `update` | Update an existing agent |
| `duplicate` | Copy an agent to your personal library |

---

## List Subcommand

List agents with scope filtering.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--scope, -s` | No | owned | Scope: owned, public, or all |
| `--agent-type, -t` | No | - | Filter by agent type |

### Examples

```bash
# List your personal agents and agents you created
python3 /workdir/tools/numa/numa-agents.py list --scope owned

# List all public/company agents
python3 /workdir/tools/numa/numa-agents.py list --scope public

# List all agents you can access
python3 /workdir/tools/numa/numa-agents.py list --scope all

# Filter by agent type
python3 /workdir/tools/numa/numa-agents.py list --scope owned --agent-type task
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

## Get Subcommand

Get detailed information about a specific agent.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--agent-id, -a` | Yes | Agent ID to retrieve |

### Examples

```bash
python3 /workdir/tools/numa/numa-agents.py get --agent-id agt_abc123
```

### Output Format

JSON response with full agent details including:
- `agentId`, `title`, `description`
- `systemPrompt` - The agent's instructions
- `userWelcomeMessage` - Welcome message shown to users
- `toolsConfig` - Which tools the agent can use
- `referenceFiles` - Attached reference documents

---

## Create Subcommand

Create a new agent with custom instructions.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--title, -t` | Yes | - | Agent display name |
| `--system-prompt, -p` | Yes | - | Core instructions for the agent |
| `--visibility, -v` | No | personal | personal or public |
| `--description, -d` | No | - | One-line description |
| `--agent-type` | No | task | Agent type label |
| `--welcome-message, -w` | No | - | Greeting shown when agent starts |
| `--time-saved` | No | - | Estimated time saved in minutes |
| `--tools-config` | No | - | JSON tools configuration |
| `--attach-file, -f` | No | - | Workspace file to attach (repeatable, max 5) |

### Examples

```bash
# Create a personal agent
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Sales Report Generator" \
    --system-prompt "You help create weekly sales reports from CRM data. Always include YoY comparisons and highlight significant changes." \
    --description "Generates weekly sales reports with insights"

# Create a public/company agent
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Onboarding Assistant" \
    --system-prompt "You help new employees navigate company resources and policies." \
    --visibility public \
    --description "Helps new hires get started"

# Create with file attachments
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Policy Expert" \
    --system-prompt "You help answer questions about company policies using the attached documents." \
    --attach-file /workdir/uploads/employee_handbook.pdf \
    --attach-file /workdir/uploads/benefits_guide.docx

# Create with tools configuration
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Research Agent" \
    --system-prompt "You help with research tasks using web search and company KB." \
    --tools-config '{"webSearchEnabled": true, "allowedKnowledgeBases": ["company"]}'
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

## Update Subcommand

Update an existing agent you own or have permission to edit.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--agent-id, -a` | Yes | Agent ID to update |
| `--title, -t` | No | New title |
| `--system-prompt, -p` | No | New instructions |
| `--visibility, -v` | No | Change visibility |
| `--description, -d` | No | New description |
| `--agent-type` | No | New agent type |
| `--welcome-message, -w` | No | New welcome message |
| `--time-saved` | No | New time saved estimate |
| `--tools-config` | No | New tools configuration (JSON) |
| `--attach-file, -f` | No | Workspace file to attach (repeatable, max 5 total) |

### Examples

```bash
# Update agent title and description
python3 /workdir/tools/numa/numa-agents.py update \
    --agent-id agt_abc123 \
    --title "Sales Report Generator v2" \
    --description "Updated with quarterly projections"

# Update system prompt
python3 /workdir/tools/numa/numa-agents.py update \
    --agent-id agt_abc123 \
    --system-prompt "You help create comprehensive sales reports..."

# Add file attachments to an existing agent
python3 /workdir/tools/numa/numa-agents.py update \
    --agent-id agt_abc123 \
    --attach-file /workdir/uploads/new_policy.pdf

# Change agent to public
python3 /workdir/tools/numa/numa-agents.py update \
    --agent-id agt_abc123 \
    --visibility public

# Enable web search for an agent
python3 /workdir/tools/numa/numa-agents.py update \
    --agent-id agt_abc123 \
    --tools-config '{"webSearchEnabled": true}'
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
- `/workdir/session/` - Files created during the conversation
- `/workdir/chat-workflows/` - Workflow output files

### How It Works

1. **Upload/Create files first** - Files must exist in the workspace before attaching
2. **Use `--attach-file`** - Specify the full workspace path (can repeat for multiple files)
3. **Files are copied** - Files are copied to permanent agent storage (original files remain)
4. **Extracted content included** - If the file has been processed with `extract_content.py`, the extracted text is also attached

### Limits

- Maximum 5 reference files per agent
- When updating, new attachments are added to existing files (up to the 5 file limit)

### Example Workflow

```bash
# 1. User uploads files to workspace (via UI or prior steps)
# Files are now at /workdir/uploads/handbook.pdf, /workdir/uploads/policies.docx

# 2. Optionally extract content for better search
python3 /workdir/tools/numa/extract_content.py -f /workdir/uploads/handbook.pdf

# 3. Create agent with file attachments
python3 /workdir/tools/numa/numa-agents.py create \
    --title "HR Assistant" \
    --system-prompt "You help employees with HR questions using the attached handbook and policies." \
    --attach-file /workdir/uploads/handbook.pdf \
    --attach-file /workdir/uploads/policies.docx
```

---

## Duplicate Subcommand

Create a personal copy of any agent you can access.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--agent-id, -a` | Yes | Agent ID to duplicate |

### Examples

```bash
# Duplicate a company agent to your personal library
python3 /workdir/tools/numa/numa-agents.py duplicate --agent-id agt_company123

# Duplicate your own agent to make a variant
python3 /workdir/tools/numa/numa-agents.py duplicate --agent-id agt_personal456
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

Once confirmed, execute the create command:
```bash
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Agent Title" \
    --system-prompt "The complete system prompt..." \
    --description "One-line description" \
    --visibility personal \
    --time-saved 15 \
    --tools-config '{"webSearchEnabled": true, "allowedKnowledgeBases": null}'
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

Numa: [Executes create command and confirms success]
```

---

### Create an agent from conversation context

If the user has been working on a task and wants to save it as a reusable agent based on what you've discussed:

1. Summarize what you've learned about their needs from the conversation
2. **Still follow Steps 2-7** of the interactive process above
3. Pre-fill the draft based on conversation context, but still get confirmation

```bash
python3 /workdir/tools/numa/numa-agents.py create \
    --title "Weekly Report Helper" \
    --system-prompt "Based on our conversation, here are the instructions..." \
    --description "Helps create weekly status reports"
```

### Find and use an agent

When user asks about available agents:

1. List agents to show options
2. Get details of specific agent if needed
3. The user can select the agent via the UI

```bash
# Show available agents
python3 /workdir/tools/numa/numa-agents.py list --scope all

# Get details about a specific one
python3 /workdir/tools/numa/numa-agents.py get --agent-id agt_abc123
```

### Improve an existing agent

When user wants to enhance an agent:

1. Get current agent details
2. Discuss improvements with user
3. Update with new instructions

```bash
# Get current state
python3 /workdir/tools/numa/numa-agents.py get --agent-id agt_abc123

# Update with improvements
python3 /workdir/tools/numa/numa-agents.py update \
    --agent-id agt_abc123 \
    --system-prompt "Improved instructions..."
```
