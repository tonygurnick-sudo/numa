---
api_name: GitLab
api_slug: gitlab
doc: mutation-patterns (writes) (companion to 01-llm-api-rules.md)
---

# GitLab — Mutation Patterns (writes)

Writes require a PAT with the `api` scope and a sufficient project **role** (Developer+ for most; Maintainer+ to merge/protect). Body is a single snake_case JSON object. **Confirm real, visible actions** (merging, creating releases, closing issues) with the user before sending.

## Idempotency note

GitLab writes are NOT idempotent by default — re-POSTing creates duplicates. On a 5xx after a POST, **GET to check whether it landed** before retrying. Prefer PUT (update by iid) when adjusting an existing entity.

## Issues

```
POST /projects/{id}/issues
  {"title":"...", "description":"...(Markdown)", "labels":"bug,backend", "assignee_ids":[123], "milestone_id":5, "due_date":"2026-07-01"}

PUT  /projects/{id}/issues/{iid}
  {"title":"...", "description":"...", "labels":"bug", "add_labels":"urgent", "remove_labels":"triage", "state_event":"close"}   # or "reopen"

POST /projects/{id}/issues/{iid}/notes        {"body":"comment (Markdown)"}
```

- `state_event` (`close`/`reopen`) changes state — there is no direct `state` write field.
- `labels` replaces the whole set; use `add_labels`/`remove_labels` for incremental changes.

## Merge requests

```
POST /projects/{id}/merge_requests
  {"source_branch":"feature/x", "target_branch":"main", "title":"Add X", "description":"...", "remove_source_branch":true, "reviewer_ids":[123]}

PUT  /projects/{id}/merge_requests/{iid}
  {"title":"...", "description":"...", "assignee_ids":[...], "state_event":"close", "target_branch":"..."}

POST /projects/{id}/merge_requests/{iid}/notes     {"body":"review comment"}

PUT  /projects/{id}/merge_requests/{iid}/merge
  {"merge_commit_message":"...", "squash":true, "should_remove_source_branch":true, "merge_when_pipeline_succeeds":false}
```

**Merge gotchas:** 405 = not mergeable yet (draft, conflicts, failing required pipeline, missing approvals). 406 = merge conflict. Check `merge_status`/`has_conflicts` (GET the MR) before merging. Title prefixed `Draft:` blocks merge — `PUT` to remove the prefix first.

## Branches, tags, commits, files

```
POST /projects/{id}/repository/branches?branch=feature/x&ref=main
POST /projects/{id}/repository/tags?tag_name=v1.3.0&ref=main&message=...

# Create / update / delete a file (single-file commit):
POST   /projects/{id}/repository/files/{file_path}
  {"branch":"main", "content":"...", "commit_message":"...", "encoding":"text"}   # encoding text|base64
PUT    /projects/{id}/repository/files/{file_path}
  {"branch":"main", "content":"...", "commit_message":"...", "last_commit_id":"<sha>"}   # last_commit_id guards against lost updates
DELETE /projects/{id}/repository/files/{file_path}
  {"branch":"main", "commit_message":"..."}

# Multi-file atomic commit:
POST /projects/{id}/repository/commits
  {"branch":"main", "commit_message":"...", "actions":[{"action":"create|update|delete|move","file_path":"...","content":"..."}]}
```

- `file_path` is URL-encoded in the URL.
- Pushing to a **protected branch** (often `main`) fails with 400/403 — push to a feature branch and open an MR instead.
- `last_commit_id` on PUT prevents overwriting a newer change (optimistic concurrency).

## Releases & tags

```
POST /projects/{id}/releases
  {"tag_name":"v1.3.0", "ref":"main", "name":"v1.3.0", "description":"## Notes\n- ...(Markdown)", "milestones":["v1.3"]}

PUT  /projects/{id}/releases/{tag_name}     {"description":"updated notes"}
```

`ref` creates the tag if it doesn't already exist. A release for an existing `tag_name` 409s — update instead.

## Pipelines

```
POST /projects/{id}/pipeline?ref=main                      # trigger a pipeline on a ref
POST /projects/{id}/pipelines/{pipeline_id}/retry
POST /projects/{id}/pipelines/{pipeline_id}/cancel
POST /projects/{id}/jobs/{job_id}/retry
POST /projects/{id}/jobs/{job_id}/play                     # run a manual job
```

## Labels & milestones

```
POST /projects/{id}/labels        {"name":"needs-review", "color":"#FF0000"}
POST /projects/{id}/milestones     {"title":"v1.3", "due_date":"2026-07-01"}
```

## Validation & errors on writes

- 400/422 → field validation; the body lists offending fields. Fix and don't retry unchanged.
- 403 → role too low for this write (name the needed role) OR token missing `api` scope.
- 409 → conflict (branch/tag/release already exists) — reconcile.
- After a write, capture the returned `iid`/`id`/`web_url` and surface it to the user.
