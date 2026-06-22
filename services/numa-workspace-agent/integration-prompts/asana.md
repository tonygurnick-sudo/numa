# Asana Integration Tips

All Asana calls go through the `numa integrations` CLI. Action keys below are
real (`numa integrations pipedream-actions asana` lists them). The auth prop is
always required — pass `"asana": {"authProvisionId": "auto"}` and the proxy
resolves the user's connected account.

**Before performing Asana operations**, establish context:

1. Resolve `workspace` via `pipedream-props-options` — if multiple workspaces exist, ask the user which one
2. For most operations, resolve `project` next (depends on workspace)
3. For project creation in an **organization** workspace, resolve `team` — it's required (hard schema requirement)

When working with Asana, keep these tips in mind:

- **Dynamic prop resolution chain:** Use `pipedream-props-options` to resolve `workspace` → `project` → `task_gid`/`section_gid` in sequence — each depends on the previous. Pass the auth prop either way (both work):

  ```bash
  numa integrations pipedream-props-options asana asana-create-task workspace \
    --asana '{"authProvisionId":"auto"}' -m "Listing Asana workspaces"
  ```

- **Inconsistent task-ID prop names:** Different actions name the task reference differently — always check the schema (`numa integrations pipedream-props asana <action>`):

  | Prop name  | Actions                                                                                                 |
  | ---------- | ------------------------------------------------------------------------------------------------------- |
  | `task_gid` | `create-task`, `update-task`, `delete-task`, `find-task-by-id`, `create-subtask`, `create-task-comment` |
  | `taskId`   | `list-task-stories`                                                                                     |
  | `task`     | `add-task-to-section` (the section prop is `section_gid`)                                               |

- **`list-organizations-options` returns no labels:** its response is `{"value":"<gid>"}` only — no `label` field, useless for display. Use **`list-workspaces`** when you need human-readable workspace names (it returns `name`, plus `is_organization`/`email_domains` via `optFields`).

- **Searching with empty strings:** `search-tasks` and `search-sections` accept an empty `name` (`""`) to return all items. `search-tasks`' `project` prop is optional in the schema but practically required for useful results.

- **`get-tasks-from-task-list` is My Tasks, not a project:** it returns the authenticated user's "My Tasks" list (workspace only, no project list). Use `search-tasks` for a project's tasks.

## Paid-tier gates — 402 on lower plans (not a bug, not a proxy limit)

Some actions hit Asana features that require a paid plan. On accounts below the
required tier they return **HTTP 402**; on accounts **with** the tier they work
normally. This is an upstream Asana plan gate — the same 402 comes back whether
you call the action or hit the REST API via `request`, so `request` is **not** a
free-tier workaround for these:

| Action / endpoint                                            | Tier required       | Error                                                                        |
| ------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------- |
| `search-tasks-premium` + advanced search (`request`, below)  | Premium+            | "Search is only available to premium users."                                 |
| `list-portfolios` / `get-portfolio` / `list-portfolio-items` | Business/Enterprise | "Portfolios are only available for users in an Enterprise or Business plan." |

Don't treat 402 as broken — it just means the connected account's plan doesn't include that feature.

- **No due-date filter in `search-tasks`:** it only has `completedSince` and `modifiedSince`. For due-date filtering use Asana's advanced search via `request` — **but it requires Premium** (402 otherwise):

  ```bash
  numa integrations request asana GET \
    "https://app.asana.com/api/1.0/workspaces/{workspace_gid}/tasks/search?due_on.after=2026-02-09&due_on.before=2026-02-11" \
    -m "Searching Asana tasks by due date"
  ```

  Filters: `due_on.before`, `due_on.after`, `due_at.before`, `due_at.after`, `assignee.any={user_gid}`, `projects.any={project_gid}`, `is_subtask=false`, `completed=false`, `text={term}`. Combine with `&`.

- **Task templates are NOT tier-gated at the API:** `create-task-from-template`'s options come back empty when the workspace has **no templates** — and authoring templates is a paid feature, so free/standard workspaces have none. But the `task_templates` endpoint itself returns **200 + `{"data":[]}`** even on a free account (verified) — empty means "no templates," not 402. Check what exists:

  ```bash
  numa integrations request asana GET \
    "https://app.asana.com/api/1.0/task_templates?project={project_gid}" -m "List task templates"
  ```

## Capabilities with no pre-built action — use `request`

Asana's REST API covers more than the action set. "No action" does **not** mean
"not possible" — these all work via `request` (verified, all plan tiers unless noted):

- **Delete a project** — there's no `asana-delete-project` action, but deletion is **not** blocked: `numa integrations request asana DELETE "https://app.asana.com/api/1.0/projects/{project_gid}"` → returns `{"data":{}}` on success (the project then 404s). The same applies to other entities without a delete action (`/tasks/{gid}`, `/sections/{gid}`, etc.).
- **Archive a project** (alternative to delete): `request asana PUT ".../projects/{project_gid}"` with `--body '{"data":{"archived":true}}'`.
- **List subtasks of a task:** `request asana GET ".../tasks/{task_gid}/subtasks?opt_fields=name,completed"`.
- **List workspace tags:** `request asana GET ".../tags?workspace={workspace_gid}&opt_fields=name,color"`.

## create-project specifics

- **`team` is required** in organization workspaces (hard schema requirement — resolve it via `pipedream-props-options` after the workspace).
- **`defaultView`**: `list` | `board` | `calendar` | `timeline`.
- **`privacySetting`**: `public_to_workspace` | `private_to_team` | `private`.
- **`startOn` requires `dueOn`** — Asana rejects a start date without a due date.

## Section behaviour

- `add-task-to-section` **moves** the task — it's removed from any other section in that project. Props are `task` (not `task_gid`) and `section_gid`. It returns an empty **`{"data":{}}`** on success — don't expect a task record back; fetch the task separately if you need it.
- **New tasks land in the project's first section by default** (e.g. the first board column) when you don't specify one.

## Notes, comments & dates

- **Plain text** works in `notes` (no special formatting needed, unlike Jira's ADF).
- **Rich text:** `html_notes` (tasks) / `html_text` (comments), wrapped in `<body>` tags: `{"html_notes":"<body><strong>Bold</strong></body>"}`. For comments, `text` (plain) vs `html_text` (formatted) — provide one; if both, `html_text` wins.
- **Dates:** `YYYY-MM-DD` for `due_on`/`start_on`; ISO 8601 datetime for `due_at` (e.g. `2026-02-15T09:00:00.000Z`). Don't pass `due_on` and `due_at` together.

## File attachments

No pre-built action. Add an **external link** attachment via `request`:

```bash
numa integrations request asana POST \
  "https://app.asana.com/api/1.0/tasks/{task_gid}/attachments" \
  --body '{"data":{"resource_subtype":"external","name":"filename.pdf","url":"https://example.com/file.pdf"}}' \
  -m "Attaching external link to Asana task"
```

Direct **binary** file uploads (multipart/form-data) are not supported through the proxy — use external URLs. To **list** a task's attachments: `request asana GET ".../tasks/{task_gid}/attachments"`; any binary files are delivered automatically — reference the `downloaded_files` path in the result.
