**Before performing Asana operations**, establish context:
1. Resolve `workspace` via `configure_props` — if multiple workspaces exist, ask the user which one
2. For most operations, resolve `project` next (depends on workspace)
3. For project creation in organization workspaces, resolve `team` — it's required

When working with Asana, keep these tips in mind:

- **Dynamic prop resolution chain:** Use `configure_props` to resolve `workspace` → `project` → `task_gid`/`section_gid` in sequence — each depends on the previous.

- **Inconsistent task ID prop names:** Different actions use different prop names for task references:
  - `task_gid`: Used by `create-task`, `update-task`, `delete-task`, `find-task-by-id`, `create-subtask`, `create-task-comment`
  - `taskId`: Used by `list-task-stories`
  - `task`: Used by `add-task-to-section`
  - Always check the action schema for the correct prop name.

- **Team is required for project creation:** When creating a project in an organization workspace (vs a personal workspace), you must provide a `team` value. Resolve it via `configure_props` after setting the workspace.

- **Plain text notes work:** Unlike Jira's ADF requirement, Asana accepts plain text in `notes` fields. No special formatting required.

- **HTML formatting:** For rich text, use `html_notes` (tasks) or `html_text` (comments) with simple HTML wrapped in `<body>` tags:
  ```json
  {
    "html_notes": "<body><strong>Bold</strong> and <em>italic</em></body>"
  }
  ```

- **Searching with empty strings:** `search-tasks` and `search-sections` accept empty name strings to return all items. Useful for discovery.

- **CRITICAL: No due date filter in `search-tasks`:** The built-in `search-tasks` action does NOT support filtering by due date. It only has `completedSince` and `modifiedSince`. To find tasks by due date, use `proxy_request` with Asana's advanced search API:
  ```
  GET https://app.asana.com/api/1.0/workspaces/{workspace_gid}/tasks/search?due_on.after=2026-02-09&due_on.before=2026-02-11
  ```
  Supported filters: `due_on.before`, `due_on.after`, `due_at.before`, `due_at.after`, `assignee.any={user_gid}`, `projects.any={project_gid}`, `is_subtask=false`, `completed=false`, `text={search_term}`. Combine multiple filters with `&`.

- **`get-tasks-from-task-list` is for My Tasks:** This action returns tasks from the user's "My Tasks" list, not a project's task list. The `project` prop filters which project's tasks appear in My Tasks. Use `search-tasks` to get tasks within a project.

- **No delete project action:** There's no `asana-delete-project` action available. Projects must be deleted or archived manually in the Asana UI.

- **Date formats:** Use `YYYY-MM-DD` for `due_on` and `start_on`. Use ISO 8601 datetime strings for `due_at` (e.g., `2026-02-15T09:00:00.000Z`). Don't use both `due_on` and `due_at` together.

- **Comments — `text` vs `html_text`:** Use `text` for plain text comments or `html_text` for formatted comments. If you provide both, `html_text` takes precedence.

- **Section behavior:** When you add a task to a section via `add-task-to-section`, it removes the task from other sections in that project. New projects created without `defaultView: "board"` have minimal default sections.

- **Task templates require premium:** The `create-task-from-template` action only works with Asana Business or Enterprise tiers. On free/Premium tiers, `configure_props` for `taskTemplateId` returns an empty array. Creating templates via API also fails on non-Business tiers.

- **File attachments via proxy:** There's no built-in Pipedream action for file attachments. Use `proxy_request` to add external link attachments:
  ```
  POST https://app.asana.com/api/1.0/tasks/{task_gid}/attachments
  Body: {"data": {"resource_subtype": "external", "name": "filename.pdf", "url": "https://example.com/file.pdf"}}
  ```
  Direct file uploads require multipart/form-data which `proxy_request` doesn't support — use external URLs instead.

- **Listing attachments:** Use `proxy_request` with `GET` to `https://app.asana.com/api/1.0/tasks/{task_gid}/attachments` to list a task's attachments.
