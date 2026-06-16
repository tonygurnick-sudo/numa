---
name: integrations
description: Execute actions, search data, and make API calls to connected external apps via Pipedream integrations. Handles schema lookup, dynamic prop resolution, file uploads/downloads, and result parsing.
---

# Integrations Skill

Execute actions, search data, and make API calls to connected external applications through Pipedream integrations.

## Available Commands

| Command                                     | Purpose                                                      | Approval                         |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| `numa integrations pipedream-call`          | Execute an integration action (search, create, update, etc.) | May require approval (see below) |
| `numa integrations pipedream-props-options` | Resolve dynamic dropdown properties before running actions   | No                               |
| `numa integrations request`                 | Make raw authenticated API requests to connected apps        | May require approval (see below) |

---

## CRITICAL: Read Schemas Before Any Action

**NEVER guess parameter names.** Always read the schema files first.

### Schema File Structure

```
/workdir/tools/integrations/{app_slug}/
  ├── _index.json                           # List of all available actions
  └── {app_slug}-{action-name}.json         # Individual action schema
```

### Step 1: Read the Index

```
Read /workdir/tools/integrations/{app_slug}/_index.json
```

Shows all actions with: `key` (action identifier), `name`, `description`, `annotations` (`readOnlyHint`, `destructiveHint`), and `file` (schema filename).

### Step 2: Read the Action Schema

```
Read /workdir/tools/integrations/{app_slug}/{app_slug}-{action-name}.json
```

Shows: required vs optional parameters, types, descriptions, dynamic properties (`"remoteOptions": true`), and default values.

---

## pipedream-call

```
Bash("numa integrations pipedream-call <app_slug> <action_key> --props '{\"appName\":{\"authProvisionId\":\"auto\"},\"param1\":\"value1\"}' -m 'Human-readable description for user approval'")
```

| Parameter    | Type        | Required | Description                                                                         |
| ------------ | ----------- | -------- | ----------------------------------------------------------------------------------- |
| `app_slug`   | string      | Yes      | The integration app slug                                                            |
| `action_key` | string      | Yes      | Full action identifier from schema                                                  |
| `--props`    | JSON string | Yes      | Auth object + action parameters                                                     |
| `-m`         | string      | Yes      | Clear description shown to user for approval                                        |
| `--stash-id` | string      | No       | CLI flag (NOT a prop). Use `--stash-id NEW` for the first file in a download/upload |

### Props Structure

Always include the auth object:

```json
{"appName": {"authProvisionId": "auto"}, ...params}
```

The auth key matches the app slug in camelCase: `google_drive` → `googleDrive`, `slack` → `slack`, `jira` → `jira`, etc.

### Example

```
# After reading schema for the action:
Bash("numa integrations pipedream-call google_drive google_drive-find-file --props '{\"googleDrive\":{\"authProvisionId\":\"auto\"},\"nameSearchTerm\":\"Q4 report\"}' -m 'Search Google Drive for files named Q4 report'")
```

---

## pipedream-props-options

Resolve dynamic dropdown options for parameters marked `"remoteOptions": true` in the schema.

```
Bash("numa integrations pipedream-props-options <app_slug> <action_key> <prop_name> --configured '{\"appName\":{\"authProvisionId\":\"auto\"}}' -m 'Resolve dynamic options'")
```

Returns a list of `{"label": "...", "value": "..."}` options. Use the `value` (not the label) in your `pipedream-call` invocation.

Include any parent dependencies in `--configured` if the schema indicates them (e.g., a folder list may depend on which drive is selected).

---

## request

Make raw authenticated HTTP requests when no pre-built action exists. Pipedream injects the user's OAuth token automatically.

```
Bash("numa integrations request <app_slug> <METHOD> '<url>' -m 'Human-readable description for approval'")
```

For POST/PUT with a body:

```
Bash("numa integrations request <app_slug> POST '<url>' --body '{\"key\":\"value\"}' -m 'Description'")
```

**When to use:** APIs not covered by actions, advanced queries with OData filters, bulk operations, or new API features before Pipedream adds them.

**NEVER use `request` for files — uploads OR downloads.** It forwards a JSON body and decodes responses as text, not binary. Uploading a file through it overwrites the file with a tiny JSON blob (this has corrupted a customer document); downloading binary through it mangles the bytes. Always use the integration's upload / update / download **action** for any file. The proxy now rejects obvious upload URLs, but the rule applies to all binary in both directions.

---

## File Uploads

When an action requires a file:

1. Use the **workspace path** directly in props (e.g., `/workdir/uploads/report.pdf`)
2. The system automatically converts it to a presigned URL — do NOT generate URLs yourself
3. The file must exist in the workspace before calling the action

**IMPORTANT:** The parameter name for files varies per action (e.g., `filePath`, `file`, `content`, `doc`). Always check the action schema for the correct name.

---

## File Downloads

When downloading files from integrations:

1. In props, specify `"filePath": "/tmp/filename.ext"` (Pipedream convention — use `/tmp/` prefix)
2. Include `--stash-id NEW` in the command. This is a CLI flag — pass it as `--stash-id NEW`, NOT as a `stash_id` value inside the `--props` JSON
3. The file is automatically saved to `/workdir/tmp/integrations-results/`
4. Read it from there: `Read /workdir/tmp/integrations-results/filename.ext`
5. **If the user asked for the file** (download, save, "give me X"), copy it into `/workdir/outputs/` so it appears in their Files page:
   `Bash("cp /workdir/tmp/integrations-results/filename.ext /workdir/outputs/")`
   Otherwise leave it in tmp and reference it inline — the user doesn't want raw attachments cluttering their Files page when they only asked you to read or summarize them.

---

## Result Handling

- Integration JSON results land in `/workdir/tmp/integrations-results/` to avoid flooding context
- Downloaded files (attachments, exports, transcripts) also land in that directory
- `/workdir/tmp/` is scratch: synced to S3 for your continuity but hidden from the user's Files UI. `/workdir/outputs/` is what the user sees
- For large results: read the file, extract what's needed, summarize for the user
- Move/copy files to `/workdir/outputs/` only when the user actually wants them as a deliverable

---

## Approval mode varies per workspace

Workspaces configure one of three integration-approval modes:

- `always` — every call shows a user-facing approval card the user has to click.
- `non_destructive` — only writes/destructive actions show a card; reads auto-approve.
- `never` — all calls auto-approve server-side with no card shown.

You do NOT have direct visibility into which mode is active. Tool results will tell you: a completed call was approved (either by the user clicking or by auto-approve), a `denied` status means the user rejected it, and a `timeout` status means a card was shown but not responded to. Handle these per the Error Handling table.

Do NOT assume approvals are pending, in flight, or timing out when you have no tool result saying so. When a user asks why something was slow, diagnose from observable signals (tool durations, context size, file re-reads, retries) — never from guessed approval state. The `-m` parameter is still always required because approval may apply; write it as if the user will read it.

---

## Writing Descriptions for Approval

The `-m` parameter is shown to users before they approve (when approval applies).

**Read operations** — brief is fine:

```
"Search for Q4 reports"
"List recent messages in #general"
```

**Write operations** — include the full content verbatim so users can review:

```
"Send message to #general:
Hey team, standup is at 10am today. Please have your updates ready."

"Create issue:
Project: PROJ | Type: Bug
Summary: Login page returns 500 error
Description: Users report login fails intermittently"
```

---

## Error Handling

| Error                    | Resolution                                              |
| ------------------------ | ------------------------------------------------------- |
| `NOT_CONNECTED`          | User needs to connect the app via Integrations settings |
| `ACTION_DENIED`          | Admin policy blocks this — user must contact admin      |
| `SCHEMA_NOT_FOUND`       | App not in enabled integrations list                    |
| `PROP_RESOLUTION_FAILED` | Check parent prop values are correct                    |
| `MISSING_REQUIRED_PROP`  | Re-read schema for required parameters                  |

Do NOT retry denied actions. Read error messages carefully — they indicate what's wrong.

---

## End-to-End Workflow Example

```
# 1. Read index to find the right action
Read /workdir/tools/integrations/{app_slug}/_index.json

# 2. Read the action schema for exact parameter names
Read /workdir/tools/integrations/{app_slug}/{app_slug}-{action-name}.json

# 3. Resolve dynamic props if schema shows "remoteOptions": true
Bash("numa integrations pipedream-props-options <app_slug> <action_key> <dynamicField> --configured '{\"appName\":{\"authProvisionId\":\"auto\"}}' -m 'Resolve dynamic field options'")

# 4. Execute the action with correct params from schema
Bash("numa integrations pipedream-call <app_slug> <action_key> --props '{\"appName\":{\"authProvisionId\":\"auto\"},\"field\":\"resolvedValue\"}' -m 'Clear description of what this does'")

# 5. Read and summarize the result
Read /workdir/tmp/integrations-results/result-{timestamp}.json
```

---

## Best Practices

1. **Schema first, always** — read `_index.json` then the action schema before calling anything
2. **Check parameter names** — they vary across integrations, never assume
3. **Resolve dynamic props** — if a schema field has `"remoteOptions": true`, call `pipedream-props-options` first
4. **Verify files exist** before upload operations
5. **Use descriptive approvals** — full content for writes, brief for reads
6. **Summarize large results** — don't dump raw JSON to the user
7. **Prefer built-in actions over `request`** — for a simple single call the curated action is cheaper and less error-prone than a hand-built raw REST request (raw REST cost +82% for identical output in one bench). Reserve `request` for bulk/paginated pulls and capabilities no action covers.
8. **"Update X" means update — never duplicate.** When revising an existing record (a draft, a calendar event, a CRM note), modify or replace the original; don't create a second copy. If there's no in-place update action, delete-and-recreate.
9. **No unresolved placeholders in external write-backs.** A bracketed placeholder (`[Company]`, `[NAME]`) is fine in a _draft document the user will review_, but must NEVER be written to an external system as live data — a Gmail draft subject-lined `[Company]`, a CRM field set to `[TBD]`. Before any external write, confirm every field holds a real value; if one is missing, ask or hold the write — don't ship the placeholder.

## Helper Scripts

- **`decode_attachment.py`** — decode a Gmail/Graph base64 attachment to a file in one step (handles URL-safe and standard base64; can auto-find the field in a saved action result). Read-only at `/app/plugins/numa/skills/integrations/helpers/`.
  ```bash
  python3 /app/plugins/numa/skills/integrations/helpers/decode_attachment.py \
    --json /workdir/tmp/integrations-results/<id>.json --out /workdir/tmp/file.pdf
  ```
