---
name: memories
description: Manage user memories - list, add, and update persistent memories that help personalise AI responses across conversations. Use for listing existing memories, updating them, or detailed memory management. For quick adds, use the tool directly without loading this skill.
---

# Memory Management Skill

List, add, and update the user's persistent memories. Memories are facts, preferences, and operational details that persist across conversations and help personalise responses.

## Quick Reference

```
# List all memories
Bash("numa memory list --json -m 'List all memories'")

# List memories filtered by scope
Bash("numa memory list --scope general --json -m 'List general memories'")

# Add a general memory
Bash("numa memory add 'Prefers concise responses' -m 'Save user preference'")

# Add an integration-scoped memory
Bash("numa memory add 'Jira Cloud ID: abc123-def456' --scope 'integration:jira' -m 'Save Jira config'")

# Update a memory
Bash("numa memory update mem_abc123 'Prefers concise bullet-point responses' -m 'Update preference'")
```

## Operations

| Operation | Purpose                                      |
| --------- | -------------------------------------------- |
| `list`    | List memories (optionally filtered by scope) |
| `add`     | Add a new memory                             |
| `update`  | Update an existing memory's content          |

---

## List Operation

List the user's memories, optionally filtered by scope.

### Parameters

| Parameter | Required | Default | Description                                                   |
| --------- | -------- | ------- | ------------------------------------------------------------- |
| `--scope` | No       | all     | Filter: `general`, `integration:{slug}`, or `agent:{agentId}` |

### Examples

```
# List all memories
Bash("numa memory list --json -m 'List all memories'")

# List only general memories
Bash("numa memory list --scope general --json -m 'List general memories'")

# List Jira integration memories
Bash("numa memory list --scope 'integration:jira' --json -m 'List Jira memories'")

# List memories for a specific agent
Bash("numa memory list --scope 'agent:agt_abc123' --json -m 'List agent memories'")
```

### Output Format

JSON response with:

- `memories` - Array of memory objects, each containing:
  - `id` - Memory ID (e.g., `mem_abc123def456`)
  - `content` - The memory text (max 300 characters)
  - `scope` - Scope string (`general`, `integration:jira`, `agent:agt_xyz`)
  - `createdAt` - ISO 8601 timestamp
  - `source` - `"user"` (added via Profile page) or `"ai"` (added by Numa)

---

## Add Operation

Add a new memory for the user.

### Parameters

| Parameter | Required | Default     | Description                                           |
| --------- | -------- | ----------- | ----------------------------------------------------- |
| `content` | Yes      | -           | Memory content (max 300 characters)                   |
| `--scope` | No       | `"general"` | `general`, `integration:{slug}`, or `agent:{agentId}` |

### Examples

```
# Add a general preference
Bash("numa memory add 'Prefers dark mode' -m 'Save dark mode preference'")

# Add an integration memory
Bash("numa memory add 'Slack workspace: acme-corp, main channel: #general' --scope 'integration:slack' -m 'Save Slack config'")

# Add a Jira memory
Bash("numa memory add 'Jira Cloud ID: abc123-def456, default project: ENG' --scope 'integration:jira' -m 'Save Jira config'")

# Add an agent-specific memory
Bash("numa memory add 'User wants weekly summaries from this agent' --scope 'agent:agt_abc123' -m 'Save agent preference'")
```

### Limits

- Maximum 300 characters per memory
- Maximum 50 memories total per user
- All memories added via this tool are tagged with `source: "ai"`

---

## Update Operation

Update the content of an existing memory. The scope and creation date are preserved.

### Parameters

| Parameter   | Required | Description                             |
| ----------- | -------- | --------------------------------------- |
| `memory_id` | Yes      | Memory ID to update                     |
| `content`   | Yes      | New memory content (max 300 characters) |

### Examples

```
# Update a memory's content
Bash("numa memory update mem_abc123def456 'Prefers concise bullet-point responses with code examples' -m 'Update preference'")
```

### Notes

- You can only update the content; scope and createdAt are preserved
- Updated memories are tagged with `source: "ai"`
- To find a memory's ID, use `list` first

---

## Scope Reference

| Scope                | When to use                                  | Example                     |
| -------------------- | -------------------------------------------- | --------------------------- |
| `general`            | User preferences, facts, communication style | "Prefers concise responses" |
| `integration:{slug}` | Integration-specific operational details     | "Jira Cloud ID: abc123"     |
| `agent:{agentId}`    | Agent-specific user preferences              | "Wants weekly summaries"    |

Common integration slugs: `jira`, `slack`, `google_drive`, `gmail`, `notion`, `sharepoint`, `hubspot`, `xero`, `outlook`, `teams`

---

## Behavioral Rules

### Retrieve before you produce

Before generating a user-facing deliverable (email, doc, message, summary), list the relevant memories first — preferences, sign-off, tone, names, operational details — and apply them. This matters most when the **output format changes mid-conversation**: if you saved that the user signs off as "Priya — PMM", carry that into the Slack message too, not just the email you first saved it from. A saved preference you don't retrieve is a preference you've effectively forgotten.

### Always Confirm First

**ALWAYS ask the user before adding or updating a memory.** Never silently save memories.

Examples of good confirmation:

- "I'd like to save a memory that you prefer concise bullet-point responses. Shall I go ahead?"
- "I noticed your Jira Cloud ID is abc123-def456. Want me to remember that for future Jira tasks?"
- "You mentioned you prefer dark mode — shall I save that as a memory so I remember next time?"

Only run the add/update command **after the user confirms**.

### When to Suggest Adding Memories

**DO suggest adding memories when:**

- The user explicitly says "remember this", "keep this in mind", "save this for next time", or semantically similar
- Working with integrations and discovering useful operational details (cloud IDs, channel IDs, project boards, preferred settings)
- The user shares a persistent preference about how they like to work

**DO NOT suggest adding memories when:**

- It's a one-off instruction for the current conversation only
- The user is telling you about their profile (name, job title, etc.) - direct them to the Profile page in Settings
- The information is already captured in an existing memory (update it instead)
- Every interaction - memories should be intentional, not automatic

### When to Update vs Add

- If a memory on the same topic already exists, **update** it rather than adding a duplicate
- List memories first to check for existing ones on the same topic
- **Merged vs separate is a judgment call.** Closely-related facts can live in one memory (retrieved together) or as separate memories (finer update granularity) — both pass hygiene. Prefer separate when the facts will change independently, merged when they're always used together.

### Deleting Memories

You cannot delete memories. If the user wants to delete a memory, direct them to manage it from their **Profile page in Settings**.

---

## Common Workflows

### Quick Memory Save

When the user says "remember this" or similar:

```
# Just add it directly - no need to load the skill for quick adds
Bash("numa memory add 'Prefers responses in British English' -m 'Save preference'")
```

### Review and Manage Memories

When the user wants to see or manage their memories:

```
# 1. List all memories
Bash("numa memory list --json -m 'List all memories'")

# 2. If updating, find the memory ID from the list, then:
Bash("numa memory update mem_abc123 'Updated preference text' -m 'Update preference'")
```

### Save Integration Details

When working with an integration and discovering useful details:

```
# After discovering the user's Jira Cloud ID during an integration task
Bash("numa memory add 'Jira Cloud ID: abc123-def456, preferred project: ENG-board' --scope 'integration:jira' -m 'Save Jira config'")
```
