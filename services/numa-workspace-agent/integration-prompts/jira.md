**Before performing Jira operations**, establish context:

1. Resolve `cloudId` via `configure_props` — if multiple sites exist, ask the user which one
2. If no project specified, use `jira-get-all-projects` to see available projects and confirm with the user
3. For issue creation, resolve `issueTypeId` to see available types (Story, Bug, Epic, etc.)

When working with Jira, keep these tips in mind:

- **Creating/updating issues — use `additionalProperties`:** The `jira-create-issue` and `jira-update-issue` actions require issue fields (summary, description, priority, labels, assignee, etc.) inside `additionalProperties`, NOT as top-level props:
  ```json
  {
    "app": { "authProvisionId": "auto" },
    "cloudId": "...",
    "projectId": "...",
    "issueTypeId": "...",
    "additionalProperties": {
      "summary": "Issue title here",
      "description": {
        "type": "doc",
        "version": 1,
        "content": [{ "type": "paragraph", "content": [{ "text": "Description here", "type": "text" }] }]
      },
      "priority": { "name": "High" },
      "labels": ["bug", "urgent"],
      "assignee": { "accountId": "..." }
    }
  }
  ```
- **Description must use ADF format:** Plain text descriptions will fail with "not valid ADF content". Always use Atlassian Document Format as shown above.
- **Dynamic prop resolution:** Use `configure_props` to resolve `cloudId` → `projectId` → `issueTypeId` in sequence — each depends on the previous. Users may have multiple Jira sites, so always resolve `cloudId` first.
- **Issue keys vs IDs:** Issues can be referenced by key (e.g., `NUMA-123`) or numeric ID via `issueIdOrKey`. Keys are more readable.
- **JQL searches:** Use `jira-search-issues-with-jql` for searching. Examples: `project = NUMA AND status = "In Progress"`, `assignee = currentUser() ORDER BY created DESC`.
- **Transitions:** To change issue status, use `jira-transition-issue`. First call `jira-get-transitions` to discover available transitions for the current issue state.
- **Finding users:** `jira-get-users` requires a `query` parameter (e.g., `{"query": "john"}`) despite being marked optional in the schema.
- **Comments:** Use `comment` prop for plain text or `body` prop for ADF format. If both are provided, `body` overwrites `comment`.
- **Fallback to `proxy_request`:** If `jira-update-issue` via `additionalProperties` doesn't persist changes (e.g., description formatting), use `proxy_request` to make a direct `PUT /rest/api/3/issue/{issueIdOrKey}` call with `{"fields": {"description": {...}}}` in the body for full control.
