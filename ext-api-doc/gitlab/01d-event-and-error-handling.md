---
api_name: GitLab
api_slug: gitlab
doc: events-and-error-handling (companion to 01-llm-api-rules.md)
---

# GitLab — Events & Error Handling

## Events / webhooks — NOT available to the agent

GitLab supports webhooks and system hooks, but this connector is a **polling** REST client — the agent receives no push events. To detect change, poll with time filters and ordering:

- New/updated issues or MRs: `?updated_after={iso}&order_by=updated_at&sort=desc`.
- New commits: `/repository/commits?since={iso}&ref_name={branch}`.
- Pipeline outcomes: `/pipelines?ref={branch}&order_by=id&sort=desc` then read `status`.

Persist the last-seen timestamp/SHA between polls. Poll conservatively (respect rate limits); there is no long-poll/streaming.

> If true event-driven automation is needed (e.g. "run an agent when an MR is opened"), that belongs in Numa Automations / triggers, not in this request-based connector.

## Rate limiting

- GitLab.com authenticated default is ~**2,000 requests/min/user** (self-managed varies; admins can tune). Specific endpoints have tighter limits.
- On **429**, GitLab returns `Retry-After` (seconds) plus `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. **Honor `Retry-After`**; if absent, back off 2s → 10s → 30s → stop.
- Pace bulk reads sequentially; prefer `per_page=100` to cut request count.

## Error format

Bodies are JSON. Two common shapes:

```json
{"message": "404 Project Not Found"}
{"error": "insufficient_scope", "error_description": "..."}
{"message": {"title": ["can't be blank"]}}   // validation: field → messages
```

Always read the **status code** first (the contract), then surface the body verbatim.

## Status → meaning → action

| Status      | Meaning                                                          | Action                                                               |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| 400         | bad request / validation                                         | check param encoding, required fields; do NOT retry unchanged        |
| 401         | invalid/expired/revoked PAT                                      | reconnect via chat credential card; do not retry                     |
| 403         | token scope (`api`/`read_api`) or user role too low              | name the missing scope/role; do not retry                            |
| 404         | wrong id/path/iid **or** private resource hidden from this token | verify `%2F` encoding + iid; else the user lacks access              |
| 405         | method not allowed for current state (e.g. MR not mergeable)     | resolve preconditions (checks/approvals) first                       |
| 406         | merge conflict                                                   | rebase/resolve, then retry                                           |
| 409         | conflict — already exists (branch/tag/release)                   | reconcile; update instead of create                                  |
| 422         | unprocessable (semantic validation)                              | fix values; don't retry unchanged                                    |
| 429         | rate limited                                                     | honor `Retry-After`; reduce pacing for the session                   |
| 500/502/503 | server error                                                     | retry once after 5s; for writes, GET to confirm landing before retry |

## Recovery playbook

1. **Surprise 404 on a known project** → first re-check path encoding (`/` must be `%2F`) and that you used `iid` not `id`; then suspect the user's token lacks access (private-resource hide).
2. **403 on a write** → distinguish: token missing `api` scope (re-create PAT) vs user role too low (someone with Maintainer must act, or grant the role). Tell the user which.
3. **MR won't merge (405/406)** → GET the MR, read `merge_status`, `has_conflicts`, `detailed_merge_status`; report the specific blocker (pipeline pending, approvals missing, draft, conflict).
4. **Push rejected to main** → it's a protected branch; create a feature branch + MR instead.
5. **Duplicate after a 5xx** → before re-POSTing, GET the list filtered by the title/branch you just used; if it exists, don't recreate.
6. **Empty/short results with no error** → check `x-next-page`; you may have only read page 1.
