---
name: agents
description: Manage Numa agents - list, show, create, update, patch-prompt, duplicate, and delete custom AI agents. Use when the user wants to work with saved agents or create new ones. Supports attaching workspace files as reference documents.
---

# Agent Management Skill

Create, list, show, update, patch, duplicate, and delete Numa agents from the workspace. Supports attaching reference files from the workspace.

The CLI surface below is the real `numa agents` command tree (seven commands: `list`, `show`, `create`, `update`, `patch-prompt`, `duplicate`, `delete`). Only the flags documented here exist — do not invent flags.

## Quick Reference

```
# List your agents
Bash("numa agents list --scope owned --json -m 'List my agents'")

# Show full agent details (includes the complete systemPrompt)
Bash("numa agents show agt_abc123 --json -m 'Show agent details'")

# Create a new agent
Bash("numa agents create 'Customer Support Agent' --prompt 'You are a helpful customer support assistant...' --visibility personal --json -m 'Create customer support agent'")

# Create an agent with reference files (--attach is repeatable, one per file, max 5)
Bash("numa agents create 'Policy Expert' --prompt 'You help answer questions about company policies.' --attach /workdir/uploads/handbook.pdf --attach /workdir/uploads/policies.docx --json -m 'Create policy expert agent'")

# Patch a phrase in an existing agent's system prompt — positional args, only the diff travels
Bash("numa agents patch-prompt agt_abc123 'Client Content' 'Receive Content' -m 'Rename a phrase in agent prompt'")

# Delete an agent
Bash("numa agents delete agt_abc123 -y -m 'Delete the obsolete agent'")
```

## Operations

| Operation      | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `list`         | List agents (owned, public, or all)                                             |
| `show`         | Show full details of a specific agent (includes systemPrompt)                   |
| `create`       | Create a new agent                                                              |
| `update`       | Replace any fields on an existing agent (full-value writes)                     |
| `patch-prompt` | Edit the system prompt in place via find/replace — cheap for small text changes |
| `duplicate`    | Copy an agent to your personal library                                          |
| `delete`       | Permanently delete an agent                                                     |

---

## Conventions that apply to every command

- **`-m "<caption>"` is required on every command.** It's the short caption shown to the user in chat (`Numa <cat>: <msg>`) and the approval-card text on HITL writes. A command without `-m` fails before it does anything.
- **Add `--json` for machine-readable output.** In the workspace you almost always want `--json` so you can parse the result with `jq`. (Other output flags exist for completeness: `--standard` forces the LLM-friendly envelope, `--pretty` forces a human table.)
- **`-y` / `--yes` skips the local confirmation prompt.** This is a no-op inside the non-TTY workspace agent (there's no interactive prompt to skip) — it only matters when driving the CLI from a laptop. It's harmless to include on write commands.
- **Check the response of every write.** Create/update/delete return the affected agent under `agent`, and file attaches surface partial failures under `fileWarnings` — read them.

---

## List Operation

`numa agents list [options]`

List agents with scope filtering, title/search filtering, and optional pagination.

### Flags

| Flag       | Required | Default | Description                                                         |
| ---------- | -------- | ------- | ------------------------------------------------------------------- |
| `--scope`  | No       | `owned` | `owned`, `public`, or `all` (any other value returns a clear error) |
| `--type`   | No       | -       | Filter by agent type                                                |
| `--search` | No       | -       | Substring match across title, description, and tags                 |
| `--title`  | No       | -       | Substring match against title only                                  |
| `--limit`  | No       | -       | Max results (server caps at 200). Enables pagination                |
| `--offset` | No       | `0`     | Pagination offset (use with `--limit`)                              |

> `--scope` accepts only `owned`, `public`, `all`. An invalid scope returns an explicit error — it does not silently return an empty list.

### Examples

```
# List your personal agents and agents you created
Bash("numa agents list --scope owned --json -m 'List my agents'")

# List all public/company agents
Bash("numa agents list --scope public --json -m 'List public agents'")

# List all agents you can access
Bash("numa agents list --scope all --json -m 'List all agents'")

# Filter by agent type
Bash("numa agents list --scope owned --type task --json -m 'List task agents'")

# Find an agent by name (matches title/description/tags)
Bash("numa agents list --search sales --json -m 'Find sales agent'")

# Match the title only
Bash("numa agents list --title 'Weekly Report' --json -m 'Find weekly report agent'")

# Paginate (first page of 10, then the next page)
Bash("numa agents list --scope all --limit 10 --json -m 'List agents page 1'")
Bash("numa agents list --scope all --limit 10 --offset 10 --json -m 'List agents page 2'")
```

### Output Format

JSON response with:

- `agents` — array of agent summaries, each containing:
  - `agentId` — unique agent ID
  - `title` — display name
  - `description` — brief description
  - `systemPrompt` — **truncated** to the first ~200 characters (use `show` for the full prompt)
  - `referenceFiles` — **file names only** (use `show` for full file metadata)
  - `scope` — `user` (personal) or `workspace` (public)
  - `visibility` — `personal` or `public`
  - `agentType` — agent type (e.g. `task`)
  - `createdBy` — creator info
  - `updatedAt` — last update timestamp
- `pagination` — present when `--limit` is used: `total`, `limit`, `offset`, `hasMore`

**Note:** `list` returns lightweight summaries. Use `show <id>` to retrieve full details including the complete system prompt and reference-file metadata.

---

## Show Operation

`numa agents show <id>`

Show full details of a single agent — including the complete `systemPrompt`.

### Arguments

| Argument | Required | Description      |
| -------- | -------- | ---------------- |
| `<id>`   | Yes      | Agent ID to show |

### Examples

```
Bash("numa agents show agt_abc123 --json -m 'Show agent details'")
```

### Output Format

JSON response under `agent` with full details including:

- `agentId`, `title`, `description`
- `systemPrompt` — the agent's full instructions
- `userWelcomeMessage` — welcome message shown to users
- `toolsConfig` — which tools the agent can use (see Tools Configuration below)
- `referenceFiles` — attached reference documents (full metadata)

> There is **no** `numa agents get` command. Use `show`.

---

## Create Operation

`numa agents create <title> [options]`

The title is a **positional argument**, not a flag. The system prompt is required (via `--prompt` or `--prompt-file`).

### Core flags

| Flag            | Required | Default    | Description                                                                                   |
| --------------- | -------- | ---------- | --------------------------------------------------------------------------------------------- |
| `<title>`       | Yes      | -          | Agent display name (positional)                                                               |
| `--prompt`      | Yes\*    | -          | System prompt, inline                                                                         |
| `--prompt-file` | Yes\*    | -          | Read the system prompt from a local file (use for long prompts)                               |
| `--visibility`  | No       | `personal` | `personal` or `public` (workspace-shared)                                                     |
| `--type`        | No       | `task`     | Agent type                                                                                    |
| `--description` | No       | -          | One-line description                                                                          |
| `--welcome`     | No       | -          | User-facing welcome message shown when the agent opens                                        |
| `--time-saved`  | No       | -          | Estimated minutes saved per use (integer)                                                     |
| `--icon`        | No       | -          | Icon class name (e.g. a Lucide icon)                                                          |
| `--attach`      | No       | -          | Workspace file to attach as a reference. **Repeatable**, max 5                                |
| `--integration` | No       | -          | Required-integration slug (repeatable) — a "user should connect this" hint, not a tool enable |

\* Exactly one of `--prompt` / `--prompt-file` is required.

Plus all the **capability flags** (web search, KB scoping, integrations as tools, approval modes, tags, persona/industry, full toolsConfig) — see [Capability Flags](#capability-flags) below.

### Examples

```
# Create a personal agent
Bash("numa agents create 'Sales Report Generator' --prompt 'You help create weekly sales reports from CRM data. Always include YoY comparisons and highlight significant changes.' --description 'Generates weekly sales reports with insights' --time-saved 20 --json -m 'Create sales report agent'")

# Create a public/company agent
Bash("numa agents create 'Onboarding Assistant' --prompt 'You help new employees navigate company resources and policies.' --visibility public --description 'Helps new hires get started' --json -m 'Create onboarding assistant'")

# Create with reference files (--attach once per file)
Bash("numa agents create 'Policy Expert' --prompt 'You help answer questions about company policies using the attached documents.' --attach /workdir/uploads/employee_handbook.pdf --attach /workdir/uploads/benefits_guide.docx --json -m 'Create policy expert agent'")

# Create with capabilities via individual flags (preferred over raw --tools-config)
Bash("numa agents create 'Research Agent' --prompt 'You help with research using web search and Company Files.' --web-search --knowledge-base company --approval-mode non_destructive --json -m 'Create research agent'")

# Long prompt from a file
Bash("numa agents create 'Compliance Reviewer' --prompt-file /workdir/tmp/compliance_prompt.txt --visibility public --json -m 'Create compliance reviewer'")
```

### Output

`agent` (the created agent), and `fileWarnings` if any attachments were skipped. The pretty/standard output also echoes the new `agentId` — capture it for follow-up commands.

### Visibility Rules

- **personal** — only you can see and use the agent.
- **public** — all company members can use the agent.

### Policy Restrictions

Admin policies may restrict agent creation:

- **off** — agent creation disabled for all users.
- **personal_only** — only personal agents allowed (public blocked).
- **full** — both personal and public allowed.

---

## Update Operation

`numa agents update <id> [options]`

Update fields on an existing agent. Use `patch-prompt` instead when you're only changing part of the system prompt (much cheaper — see below).

### Core flags

| Flag            | Required | Description                                                                 |
| --------------- | -------- | --------------------------------------------------------------------------- |
| `<id>`          | Yes      | Agent ID to update (positional)                                             |
| `--title`       | No       | New title                                                                   |
| `--prompt`      | No       | New system prompt, inline                                                   |
| `--prompt-file` | No       | Read a new system prompt from a local file                                  |
| `--visibility`  | No       | `personal` or `public`                                                      |
| `--type`        | No       | New agent type                                                              |
| `--description` | No       | New description                                                             |
| `--welcome`     | No       | New user welcome message                                                    |
| `--time-saved`  | No       | New estimated minutes saved per use (integer)                               |
| `--icon`        | No       | New icon class name                                                         |
| `--integration` | No       | Required-integration slug (repeatable; **replaces** existing)               |
| `--attach`      | No       | Workspace file to attach (repeatable; **appends** to existing, max 5 total) |
| `--favorite`    | No       | Mark as favorite (update only)                                              |
| `--no-favorite` | No       | Clear favorite (update only)                                                |

Plus all the **capability flags** — see [Capability Flags](#capability-flags) below.

### Examples

```
# Update title and description
Bash("numa agents update agt_abc123 --title 'Sales Report Generator v2' --description 'Updated with quarterly projections' -m 'Update agent title'")

# Replace the system prompt wholesale (prefer patch-prompt for partial edits)
Bash("numa agents update agt_abc123 --prompt 'Improved instructions...' -m 'Update agent prompt'")

# Append a reference file
Bash("numa agents update agt_abc123 --attach /workdir/uploads/new_policy.pdf -m 'Attach file to agent'")

# Enable web search
Bash("numa agents update agt_abc123 --web-search -m 'Enable web search for agent'")

# Mark as favorite
Bash("numa agents update agt_abc123 --favorite -m 'Favorite this agent'")
```

### Permissions

- You can update your own personal agents.
- You can update public agents you created.
- Admins can update any public agent.

---

## Patch Prompt Operation

`numa agents patch-prompt <id> <old-text> <new-text> [--replace-all]`

Edit an agent's `systemPrompt` in place via find/replace. The DynamoDB record is the source of truth — you send only the substring to find and its replacement, **not** the full prompt.

**All three are positional arguments** (id, old-text, new-text) — there are no `--old-text` / `--new-text` flags.

**Prefer `patch-prompt` over `update` when changing part of a system prompt.** `update` requires re-sending the entire new `systemPrompt` as output tokens — for any prompt of meaningful size (more than a few hundred chars) that is dramatically more expensive than `patch-prompt`, which only ships the diff. Reserve `update` for full rewrites or for changing non-prompt fields.

If you don't already know the current prompt body, call `show` first to read it.

### Arguments & flags

| Argument / flag | Required | Default | Description                                                                      |
| --------------- | -------- | ------- | -------------------------------------------------------------------------------- |
| `<id>`          | Yes      | -       | Agent ID to patch (positional)                                                   |
| `<old-text>`    | Yes      | -       | Exact substring to find (whitespace + case sensitive) (positional)               |
| `<new-text>`    | Yes      | -       | Replacement text. Use `''` to delete the match (positional)                      |
| `--replace-all` | No       | `false` | If `false`, requires `old-text` to appear exactly once. If `true`, replaces all. |

### Match rules

- Match is **exact** — whitespace, punctuation, and casing all matter.
- Default behaviour requires `old-text` to appear **exactly once** in the prompt. Zero matches → error; multiple matches → error reporting the count.
- To resolve a multi-match error: either extend `old-text` with 1-2 lines of surrounding context until it's unique, or set `--replace-all` to replace every occurrence.
- `old-text` and `new-text` must differ (identical → error, nothing to patch).

### Examples

```
# Rename a phrase that appears once in the prompt
Bash("numa agents patch-prompt agt_abc123 'Client Content' 'Receive Content' -m 'Rename phrase in agent prompt'")

# Replace every occurrence of a term (e.g. branding rename)
Bash("numa agents patch-prompt agt_abc123 'AcmeCorp' 'ArcanumCorp' --replace-all -m 'Brand rename across prompt'")

# Delete a sentence from the prompt (empty new-text)
Bash("numa agents patch-prompt agt_abc123 'Always CC legal@example.com on outbound emails. ' '' -m 'Remove outdated instruction'")
```

> **Shell quoting matters — both texts are positional args.** Wrap each in single quotes so the shell passes them through verbatim. If a value itself contains a single quote, close the quote, add an escaped quote, and reopen — `'it'\''s'` → `it's`. If a value contains a literal newline, prefer enclosing it with `$'...'` and `\n`, or do the edit via `update --prompt-file` instead.

> **Renumber when you edit a numbered list.** If you insert or delete a step in a numbered sequence (`1.`, `2.`, `3.` …), patch the surrounding numbers too so the list stays consecutive — don't leave a duplicate "step 3" or a gap. A second `patch-prompt` covering the affected numbers is fine.

### Permissions

- Same as `update`: personal agents you own, public agents you created, or any public agent if you are an admin.

---

## Duplicate Operation

`numa agents duplicate <id>`

Create a personal copy of any agent you can access. The duplicate **always** lands in your personal library.

### Arguments

| Argument | Required | Description                             |
| -------- | -------- | --------------------------------------- |
| `<id>`   | Yes      | Source agent ID (personal or workspace) |

### Examples

```
# Duplicate a company agent into your personal library
Bash("numa agents duplicate agt_company123 --json -m 'Duplicate company agent'")

# Duplicate your own agent to make a variant
Bash("numa agents duplicate agt_personal456 --json -m 'Duplicate my agent'")
```

The duplicate is created as a **personal** agent with `(Copy)` appended to the title (`(Copy 2)`, `(Copy 3)`, … if a copy already exists). Output includes the new `agentId` under `agent`.

---

## Delete Operation

`numa agents delete <id>`

Permanently delete an agent. **Destructive** — this cannot be undone. Personal agents are gone; public/workspace agents are removed for everyone.

### Arguments & flags

| Argument / flag | Required | Description                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------------- |
| `<id>`          | Yes      | Agent ID to delete (positional)                                                    |
| `-y`, `--yes`   | No       | Skip the destructive-op confirmation prompt (laptop only — no-op in the workspace) |

### Examples

```
# Delete an agent
Bash("numa agents delete agt_abc123 -y -m 'Delete the obsolete agent'")
```

### Output

Returns the **full deleted agent object** under `agent` (same shape as `show`) — useful for confirmation/audit, so you can report exactly what was removed:

```json
{ "agent": { "agentId": "agt_abc123", "title": "Obsolete Agent", "scope": "user", "...": "..." } }
```

Deleting a non-existent ID errors (it never silently succeeds), so always check the response.

### Permissions

- You can delete your own personal agents.
- You can delete public agents you created.
- Admins can delete any public agent.

---

## Capability Flags

These flags work on both `create` and `update`. They each set a field in the agent's `toolsConfig` (see the next section for the resulting JSON shape). Prefer these individual flags over hand-writing `--tools-config` JSON.

Each boolean capability has a `--no-` variant to turn it off explicitly.

| Flag                                               | Effect                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--web-search` / `--no-web-search`                 | Enable / disable web search (`webSearchEnabled`)                                                                                                                                                                                                                                                       |
| `--query-data-sources` / `--no-query-data-sources` | Enable / disable knowledge-base querying (`queryDataSources`)                                                                                                                                                                                                                                          |
| `--create-agent` / `--no-create-agent`             | Allow / disallow this agent creating sub-agents (`createAgentEnabled`)                                                                                                                                                                                                                                 |
| `--auto-tools` / `--no-auto-tools`                 | Let the agent auto-select tools / disable it (`autoToolsEnabled`)                                                                                                                                                                                                                                      |
| `--memories` / `--no-memories`                     | Enable / disable memories (`memoriesEnabled`)                                                                                                                                                                                                                                                          |
| `--numa-ops` / `--no-numa-ops`                     | Enable / disable Numa Ops tools (`numaOpsEnabled`)                                                                                                                                                                                                                                                     |
| `--knowledge-base <id>`                            | Scope to a specific KB id (**repeatable** — pass once per KB) → `allowedKnowledgeBases: [ids]`                                                                                                                                                                                                         |
| `--all-kbs`                                        | Allow all knowledge bases (clears KB scoping) → `allowedKnowledgeBases: null`                                                                                                                                                                                                                          |
| `--no-kbs`                                         | Allow no knowledge bases → `allowedKnowledgeBases: []`                                                                                                                                                                                                                                                 |
| `--enable-integration <slug>`                      | **Enable an integration as a tool** (repeatable). Resolves the method from your connected integrations and writes a `{slug,method,name}` row into `enabledIntegrations`. Errors if the slug isn't a connected/enabled integration in the session, or has multiple methods (use `--tools-config` then). |
| `--integration <slug>`                             | **Different from `--enable-integration`.** Sets `requiredIntegrations` only — a "user should connect this" hint, NOT a tool enable. Repeatable.                                                                                                                                                        |
| `--approval-mode <mode>`                           | **Global** integration approval default: `always` \| `non_destructive` \| `never` → `approvalMode`                                                                                                                                                                                                     |
| `--approval-modes <json>`                          | **Per-category** approval JSON → `approvalModes`. Keys: `integrations`, `agents`, `memories`, `knowledgeBases`, `ops`, `connectors`. Values: `always` \| `non_destructive` \| `never`                                                                                                                  |
| `--tag <tag>`                                      | Categorisation tag (repeatable, max 20)                                                                                                                                                                                                                                                                |
| `--persona <persona>`                              | Persona tag (repeatable): `CEO` \| `Finance` \| `HR` \| `Operations` \| `Commercial`                                                                                                                                                                                                                   |
| `--industry <industry>`                            | Industry tag (repeatable): `Manufacturing` \| `Construction` \| `Engineering` \| `Professional Services` \| `Franchise`                                                                                                                                                                                |
| `--icon <name>`                                    | Icon class name                                                                                                                                                                                                                                                                                        |
| `--tools-config <json>`                            | Full `toolsConfig` JSON escape hatch. Individual flags above are **merged on top** (they override the JSON after parse).                                                                                                                                                                               |

### KB scoping is tri-state

`--all-kbs` (→ `null`, all KBs) **>** `--no-kbs` (→ `[]`, none) **>** `--knowledge-base <id>` (→ specific list). If you pass more than one, the higher-priority flag wins.

### `--enable-integration` vs `--integration` — don't confuse them

- `--enable-integration <slug>` turns the integration into a **callable tool** for the agent (writes `enabledIntegrations` / mirrors `enabledConnections`).
- `--integration <slug>` only records the slug in `requiredIntegrations` — a soft prompt to the user to connect it. It does **not** give the agent the tool.

### `--approval-mode` (singular) vs `--approval-modes` (plural) — different keys, by design

These are **two distinct keys** that coexist intentionally — this is not a bug:

- `--approval-mode <mode>` sets `approvalMode` — the **single global** integration approval default.
- `--approval-modes '<json>'` sets `approvalModes` — the **per-category** map (`integrations`, `agents`, `memories`, `knowledgeBases`, `ops`, `connectors`).

Both can be present on the same agent. A category in `approvalModes` overrides the global `approvalMode` for that category.

Example using per-category modes:

```
Bash("numa agents create 'Ops Helper' --prompt '...' --numa-ops --approval-modes '{\"integrations\":\"non_destructive\",\"agents\":\"never\",\"memories\":\"never\",\"knowledgeBases\":\"never\",\"ops\":\"never\"}' --json -m 'Create ops helper'")
```

---

## Tools Configuration (the `toolsConfig` object)

`toolsConfig` is what the capability flags assemble. You can also pass it whole with `--tools-config '<json>'` (individual flags override after merge). The real, complete shape:

```json
{
  "autoToolsEnabled": true,
  "queryDataSources": false,
  "webSearchEnabled": false,
  "createAgentEnabled": false,
  "memoriesEnabled": true,
  "numaOpsEnabled": false,
  "allowedKnowledgeBases": null,
  "enabledIntegrations": [{ "slug": "google_drive", "method": "...", "name": "Google Drive" }],
  "enabledConnections": ["google_drive"],
  "approvalMode": "non_destructive",
  "approvalModes": {
    "integrations": "non_destructive",
    "agents": "never",
    "memories": "never",
    "knowledgeBases": "never",
    "ops": "never",
    "connectors": "never"
  }
}
```

Field-by-field:

- `autoToolsEnabled` — let the agent auto-select tools (default: `true`).
- `queryDataSources` — allow knowledge-base querying (default: `false`).
- `webSearchEnabled` — allow web search (default: `false`).
- `createAgentEnabled` — allow the agent to create sub-agents (default: `false`).
- `memoriesEnabled` — allow memories (default: `true`).
- `numaOpsEnabled` — allow Numa Ops tools (default: `false`).
- `allowedKnowledgeBases` — which KBs the agent may search. Tri-state: `null` = **all**, `[]` = **none**, `["id1","id2"]` = **specific**.
- `enabledIntegrations` — **canonical source of truth** for which integrations are enabled as tools. An array of method-tagged rows: `[{ "slug", "method", "name" }]`. Set this via `--enable-integration`.
- `enabledConnections` — **legacy flat-slug mirror** of `enabledIntegrations`, written in parallel for backward compatibility. Treat it as derived — do not present it as canonical; prefer `enabledIntegrations`.
- `approvalMode` — **global** integration approval default. One of `always` | `non_destructive` | `never`. (Set via `--approval-mode`.)
- `approvalModes` — **per-category** approval map (different key from `approvalMode`). Keys: `integrations`, `agents`, `memories`, `knowledgeBases`, `ops`, `connectors`. (Set via `--approval-modes`.)

Approval mode values, in every place they appear:

- `"always"` — require user approval for **every** action in this category.
- `"non_destructive"` — auto-approve read-only actions; require approval for writes/mutations ("Writes only").
- `"never"` — auto-approve all actions in this category.

---

## File Attachments

Agents can have reference files attached that provide context for answering questions. Files are **copied** to permanent agent storage when attached (originals stay put).

### Supported workspace locations

- `/workdir/uploads/` — user-uploaded files
- `/workdir/outputs/` — files created during the conversation
- `/workdir/chat-workflows/` — workflow output files

### How it works

1. **The file must exist in the workspace first** (uploaded or created by a prior step).
2. **Pass `--attach <path>` once per file** (it's repeatable; max 5). There is **no** comma-separated form — `--attach 'a.pdf,b.pdf'` will try to attach a single file literally named `a.pdf,b.pdf` and fail.
3. **Files are copied** to permanent agent storage. If a file was processed with `numa docs extract`, the extracted text is attached alongside it.
4. On `update`, new attachments **append** to existing reference files (up to the 5-file total).

### `--attach` requires a conversation context

`--attach` resolves the workspace path against the current conversation to copy the file into agent storage, so it needs a conversation context. Inside the workspace agent that context is always present. (From a laptop you'd set it via `numa-dev context set --conversation-id`.) Without it, the command errors before writing anything.

### Always check the response

- Partial failures (a file that doesn't resolve / isn't in S3) surface as warnings under `fileWarnings` — the rest still attach.
- If **every** requested attachment fails to resolve, the command **errors** rather than silently returning an empty `referenceFiles` list.

So after any create/update with `--attach`, read `fileWarnings` (and confirm the expected `referenceFiles` count via `show`) before telling the user the files were attached.

### Example workflow

```
# 1. User uploads files to the workspace (UI or prior steps).
#    Files are now at /workdir/uploads/handbook.pdf and /workdir/uploads/policies.docx

# 2. (Optional) extract content for better search
Bash("numa docs extract /workdir/uploads/handbook.pdf -m 'Extract content from handbook'")

# 3. Create the agent, one --attach per file
Bash("numa agents create 'HR Assistant' --prompt 'You help employees with HR questions using the attached handbook and policies.' --attach /workdir/uploads/handbook.pdf --attach /workdir/uploads/policies.docx --json -m 'Create HR assistant agent'")
```

---

## When to Use

Use this skill when the user:

- Asks to "create an agent" or "make a bot"
- Wants to "see my agents" or "list agents"
- Asks to "update/modify/edit an agent"
- Wants to "copy/duplicate an agent"
- Wants to "delete/remove an agent"
- Asks about "my saved agents" or "company agents"

### Creation Trigger Phrases

When you hear any of these phrases, start one of the two creation flows:

- "Help me create an agent"
- "I want to build an agent"
- "Create an agent for..."
- "Make me an agent that..."
- "I need an agent to..."
- "Can you make an agent..."
- "Save this as an agent"
- "Turn this into an agent"
- "Let's create an agent"
- "Build me a bot that..."

**Pick the right path — this is the single most important decision for creation:**

- **Context-Aware Path (DEFAULT when there is any prior conversation).** If the current conversation already contains a substantive exchange — the user asked for something, Numa did it, there's a repeatable task, or files exist in `/workdir/` — mine the transcript and pre-fill a full draft. Do NOT restart with open discovery questions. Skip to the draft and only ask about the gaps you cannot infer (visibility, approval modes, time saved, reference files to attach).
- **Discovery Path (cold start only).** Only when the conversation has no meaningful prior context — the user's very first message is "create an agent" with nothing before it — run the full 7-step Interactive Agent Creation Process.

**Quick heuristic:** If you can already answer _"what would this agent do?"_ from what's been said or produced in this conversation, use the Context-Aware Path. If you'd have to ask "what should it help with?" to find out, use the Discovery Path.

When in doubt, default to Context-Aware — users asking mid-chat almost always mean "save what we've been doing".

## When NOT to Use

- User is chatting WITH an agent (the agent is already loaded)
- User is asking ABOUT agents conceptually (general questions)
- User wants to SCHEDULE an agent to run automatically (see capability boundaries below)

> Note: deleting an agent **is** supported here — use `numa agents delete <id>`. (Earlier guidance that deletion was UI-only was wrong.)

### Capability boundaries — don't hallucinate these

- **You cannot schedule an agent to run itself.** Recurring/automated runs are configured by the user in the web UI only (the agent schedule modal). There is no chat command, `/loop`, or cron you can invoke to put an agent on a schedule — never claim a schedule is "live", and never invent a mechanism. If the user wants a scheduled agent, tell them to set the schedule from the agent's settings in the UI.
- **Warn about unattended approvals when scheduling comes up.** A scheduled agent runs unattended, so any integration _write_ it performs under a "writes need approval" mode silently stalls on the approval gate (~180s timeout, then fails). When a user sets up or asks about a scheduled agent that uses integrations, proactively flag this and recommend they set the agent's integration approval to **auto-approve all** (`--approval-mode never`, or `integrations: "never"` in `--approval-modes`) for unattended runs.
- **Re-query before confirming existence.** When asked to confirm an agent (or its files/config) exists or was created, re-read it with `show` — don't confirm from memory of having just done it.

---

## Common Workflows

### Context-Aware Creation (DEFAULT — use this mid-chat)

Use this path whenever the user asks to create an agent and the conversation already contains the raw material to do it. This is the common case — the user has been working on something and now wants it saved as a reusable agent. Do not restart from scratch.

#### Step 1: Mine the conversation

Before asking anything, read the transcript and extract:

- **The recurring task.** What did the user ask for? What did Numa produce? State it in one sentence.
- **The approach / style.** How did Numa structure the answer? Output format (bullets, tables, sections), tone, length, constraints, any steps Numa took that worked well. The system prompt needs to capture not just _what_ the agent does but _how_ it does it.
- **Inputs.** What kind of input does the task take (a CSV, a CV, a meeting transcript, a free-text brief)? How should the agent ask for it if the user doesn't provide it?
- **Outputs / artifacts.** What did Numa deliver? Files, inline tables, a summary? The agent should reproduce this.
- **Tools used.** Which tools did Numa actually use in the conversation (web search, a specific KB, a specific integration, code execution)? These become the agent's capability flags / `toolsConfig`.
- **Reference files.** Anything under `/workdir/uploads/`, `/workdir/outputs/`, or `/workdir/chat-workflows/` that the task depends on is a candidate for `--attach`. Prefer source material (templates, policies, guidelines) over one-off outputs.

#### Step 2: Draft everything you can infer

Pre-fill as much of the draft as the conversation supports:

- `title` — short, descriptive, reflects the task (e.g. "Weekly Sales Summary Agent", "CV Screening Agent")
- `description` — one line
- `systemPrompt` — written from the conversation. Include the task, the input shape, the output format, the style/tone observed, and any constraints the user applied. Do not copy-paste the transcript; distil it into reusable instructions. If helpful, include a short "How to respond" block that mirrors what worked in the conversation.
- capabilities — set `--web-search`, `--knowledge-base`/`--all-kbs`/`--no-kbs`, `--enable-integration`, and approval modes to match what was actually used. Default approval modes to the recommended set (see Step 3 of the Discovery Path).
- attachments — list any obvious reference files from the conversation (one `--attach` each)

#### Step 3: Ask ONLY about gaps

Present the pre-filled draft, then ask for the handful of things you genuinely cannot infer. Keep this short:

- **Visibility:** personal or public? (required)
- **Approval modes:** "Default to Writes-only for integrations, Auto-approve for everything else — want to adjust?" (required, but one-line)
- **Time saved estimate:** "Roughly how many minutes does this save per use?" (required)
- **Reference files:** Only ask if you spotted candidates — "I saw `brand-guidelines.pdf` in the workspace. Attach it as a reference file?"

Do **NOT** ask "what would you like this agent to help you with?" — you already know.

#### Step 4: Present the draft

Use the same draft layout as the Discovery Path (see Step 6 there). Lead with: _"Based on what we've been working on, here's a draft — let me know if you want changes, or say 'create it' to proceed."_

#### Step 5: Confirm and create

Wait for explicit approval. On confirmation, call `create` with the full payload (see Create Operation for the exact flag shape).

#### Example — Context-Aware creation

```
[Prior conversation: user uploaded sales.csv and asked Numa to summarise top-5 customers
 by revenue for Q3, with YoY comparison and a short narrative. Numa produced a tidy
 markdown summary with a table and 3 bullet trends.]

User: Save this as an agent.

Numa: Here's a draft based on what we've been doing:

      ## Agent Draft

      **Title:** Quarterly Sales Summary Agent
      **Description:** Summarises top customers by revenue from a sales CSV with YoY
                       comparison and trend commentary.
      **Visibility:** (need your input — personal or public?)

      **System Prompt:**
      > You help produce quarterly sales summaries from a CSV of sales data.
      > When the user provides a sales CSV:
      > 1. Identify the top 5 customers by revenue for the requested quarter.
      > 2. Calculate YoY change vs. the same quarter last year where data allows.
      > 3. Return a markdown summary with: a table of the top 5 (customer, revenue,
      >    YoY %), followed by 3 short bullet trends (growth, risk, standouts).
      > 4. Keep commentary factual and concise — no speculation beyond the data.
      > If the CSV is missing required columns (customer, revenue, date), ask the
      > user to clarify before proceeding.

      **Tools Configuration:**
      - Web Search: disabled
      - Knowledge Bases: none
      - Integrations: none

      **Approval Modes:** defaults (Writes-only for integrations, Auto-approve otherwise)

      **Reference Files:** none detected — attach a template if you have one.

      Two things I need from you:
      1. Personal or public?
      2. Roughly how many minutes does this save per use?

User: Personal, probably 20 minutes.

Numa: Great. Ready to create?

User: Yes.

Numa: [executes:
       numa agents create 'Quarterly Sales Summary Agent' \
         --prompt '...' --description '...' --visibility personal --time-saved 20 \
         --no-web-search --no-kbs \
         --approval-modes '{"integrations":"non_destructive","agents":"never","memories":"never","knowledgeBases":"never","ops":"never"}' \
         --json -m 'Create quarterly sales summary agent']
```

---

### Interactive Agent Creation Process (cold start only)

Use this path **only when there is no useful conversation context** — the user's first message of the conversation is "create an agent" and there is nothing to mine. Follow this structured flow and gather requirements one step at a time. **NEVER skip directly to creating an agent — always gather requirements first.**

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

- **Web Search:** "Will this agent need to search the web for current information?" → `--web-search` / `--no-web-search`
- **Numa Files / Knowledge Bases:** "Should it have access to your Numa Files folders (Personal, Company Files, shared folders)?"
  - Check the **Available Numa Files folders** section in your context. If folders are listed, present them by name so the user can choose specific ones.
  - All folders → `--all-kbs`. Specific ones → one `--knowledge-base <id>` per folder. None → `--no-kbs`.
  - If no folders are available in your context, inform the user: "No Numa Files folders are currently configured."
- **Integrations:** "Should this agent be able to use any connected integrations?"
  - Check the **Connected Integrations** section in your context. Present ALL connected integrations by name so the user can choose which to enable on the agent — not just the ones enabled for this conversation.
  - To enable one as a tool: `--enable-integration <slug>` (repeatable).
  - If no integrations are listed, inform the user: "No integrations are currently connected." and move on.
- **Approval Modes (REQUIRED — do NOT skip):** You MUST ask about approval modes before proceeding. Present the recommended defaults:
  - **Integrations:** Writes only (auto-approve reads, require approval for writes)
  - **Agents:** Auto-approve
  - **Memories:** Auto-approve
  - **Numa Files (knowledgeBases):** Auto-approve
  - **Ops:** Auto-approve
  - "Would you like to use these defaults, or customise any category?"
  - The three options per category: **Always** (approve every action), **Writes only** (`non_destructive`), **Auto-approve** (`never`).
  - If the user accepts defaults, use the recommended values via `--approval-modes`. If they want to customise, walk through each category.

The recommended default approval-modes JSON:

```json
{
  "integrations": "non_destructive",
  "agents": "never",
  "memories": "never",
  "knowledgeBases": "never",
  "ops": "never"
}
```

**Approval mode values:** `"always"` = Always, `"non_destructive"` = Writes only, `"never"` = Auto-approve.

#### Step 4: Reference Documents

Check if the agent needs reference materials:

- "Are there any documents the agent should use as reference material?"
- If yes:
  - Check if files are already in the workspace (`/workdir/uploads/`).
  - Or guide them to upload files first.
  - Remind about the **5-file maximum**. Each file goes in via its own `--attach <path>`.

#### Step 5: Time Saved Estimate

Gather the value metric:

- "Roughly how much time do you think this agent will save per use? (in minutes)"
- This maps to `--time-saved <minutes>` and can be adjusted later.

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
- Integrations: [list of enabled integrations] / none

**Approval Modes:**
- Integrations: Writes only
- Agents: Auto-approve
- Memories: Auto-approve
- Knowledge Bases: Auto-approve
- Ops: Auto-approve

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
- Only proceed to creation after receiving clear approval.

Once confirmed, execute the create call (title positional, one `--attach` per file, capability flags for tools):

```
Bash("numa agents create 'Agent Title' --prompt 'The complete system prompt...' --description 'One-line description' --visibility personal --time-saved 15 --web-search --enable-integration google_drive --approval-modes '{\"integrations\":\"non_destructive\",\"agents\":\"never\",\"memories\":\"never\",\"knowledgeBases\":\"never\",\"ops\":\"never\"}' --json -m 'Create agent'")
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

      Now let's set up the agent's capabilities:

      **Web Search:** Should it be able to search the web for current information?

User: No web search needed

Numa: **Numa Files:** Should it access your Numa Files folders?
      You have these available: Company Files, Product Docs, HR Policies

User: Yes, just Company Files

Numa: **Integrations:** Should this agent use any of your connected integrations?
      You have: Google Drive, Slack, Jira

User: No integrations needed

Numa: **Approval Modes:** What level of approval should be required when this
      agent takes actions? Here are the recommended defaults:

      | Category        | Setting       |
      |-----------------|---------------|
      | Integrations    | Writes only   |
      | Agents          | Auto-approve  |
      | Memories        | Auto-approve  |
      | Knowledge Bases | Auto-approve  |
      | Ops             | Auto-approve  |

      Would you like to use these defaults, or customise any category?

User: Defaults are fine

Numa: Are there any documents you'd like to attach as reference material
      for this agent? For example, a template or style guide?

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
      - Knowledge Bases: Company Files
      - Integrations: none

      **Approval Modes:**
      - Integrations: Writes only
      - Agents: Auto-approve
      - Memories: Auto-approve
      - Knowledge Bases: Auto-approve
      - Ops: Auto-approve

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

Numa: [Executes:
       numa agents create 'Weekly Report Helper' --prompt '...' \
         --description 'Helps write weekly status reports...' --visibility personal \
         --time-saved 15 --no-web-search --knowledge-base company-files \
         --approval-modes '{"integrations":"non_destructive","agents":"never","memories":"never","knowledgeBases":"never","ops":"never"}' \
         --json -m 'Create weekly report helper'
       then confirms success]
```

---

### Find and use an agent

When the user asks about available agents:

1. List agents to show options.
2. `show` a specific agent's details if needed.
3. The user can select the agent via the UI.

```
# Show available agents
Bash("numa agents list --scope all --json -m 'List all agents'")

# Show details about a specific one
Bash("numa agents show agt_abc123 --json -m 'Show agent details'")
```

### Improve an existing agent

When the user wants to enhance an agent:

1. `show` the current agent details.
2. Discuss improvements with the user.
3. For small wording changes, use `patch-prompt`. For larger changes or non-prompt fields, use `update`.

```
# Read the current state (full prompt)
Bash("numa agents show agt_abc123 --json -m 'Show agent details'")

# Small, targeted prompt edit (cheap — only the diff travels)
Bash("numa agents patch-prompt agt_abc123 'old phrasing' 'new phrasing' -m 'Tweak agent prompt'")

# Larger rewrite or non-prompt field change
Bash("numa agents update agt_abc123 --prompt 'Improved instructions...' -m 'Update agent instructions'")
```
