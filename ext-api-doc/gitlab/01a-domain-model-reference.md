---
api_name: GitLab
api_slug: gitlab
doc: domain-model-reference (companion to 01-llm-api-rules.md)
---

# GitLab — Domain Model Reference

Entity catalog, relationships, and business rules for GitLab REST API v4. All field names are snake_case. IDs are integers unless noted.

## Hierarchy

```
User ── member of ──> Group ── contains ──> Subgroup ── contains ──> Project (repository)
                                                   │
Project ── has ──> Branches, Tags, Commits, Files (repository)
        ── has ──> MergeRequests, Issues, Pipelines/Jobs, Releases, Milestones, Labels, Members
```

- **Group**: namespace that owns projects and subgroups. Addressed by id or URL-encoded path.
- **Project**: a single repository plus its issues/MRs/pipelines/releases. The central entity. Addressed by numeric `id` or URL-encoded `namespace/path`.
- A user's effective permissions come from their **role** (access level) on the project/group.

## Access levels (roles)

Numeric `access_level`: 10 Guest, 20 Reporter, 30 Developer, 40 Maintainer, 50 Owner. Reads generally need Reporter+; pushing/merging needs Developer/Maintainer+. A 403 on a write usually means the user's role is too low — not a bad token.

## Project

| Field                                      | Notes                                                        |
| ------------------------------------------ | ------------------------------------------------------------ | ------- |
| id                                         | numeric, stable                                              |
| path_with_namespace                        | e.g. `mygroup/myrepo` — URL-encode for path-based addressing |
| default_branch                             | used as the default `ref` for file/commit reads              |
| visibility                                 | private / internal / public                                  |
| namespace                                  | `{id, path, kind: user                                       | group}` |
| web_url, http_url_to_repo, ssh_url_to_repo | clone/links                                                  |
| last_activity_at                           | good `order_by` for "most recent"                            |

## Repository objects

- **Branch**: `{name, commit, merged, protected, default}`. Protected branches block direct pushes/force-push.
- **Tag**: `{name, target (SHA), commit, release}`. Releases attach to tags.
- **Commit**: `{id (full SHA), short_id, title, message, author_name, authored_date, committed_date, parent_ids, web_url}`.
- **Tree entry**: `{id, name, type: tree|blob, path, mode}`. `tree` = directory, `blob` = file.
- **File**: raw content via `.../files/{path}/raw`; metadata via `.../files/{path}` returns `{file_name, file_path, size, encoding: base64, content, content_sha256, ref, blob_id, commit_id, last_commit_id}`.

## Merge Request

| Field                                    | Notes                                        |
| ---------------------------------------- | -------------------------------------------- |
| iid                                      | project-scoped number (`!42`) — use in URLs  |
| id                                       | global id — do NOT use in project paths      |
| state                                    | opened / closed / merged / locked            |
| source_branch, target_branch             | merge direction                              |
| draft / work_in_progress                 | not ready to merge                           |
| merge_status                             | can_be_merged / cannot_be_merged / unchecked |
| has_conflicts                            | blocks merge                                 |
| sha, merge_commit_sha, squash_commit_sha | commit refs                                  |
| author, assignees, reviewers             | user objects                                 |
| labels, milestone                        | organization                                 |

**Rules:** Cannot merge while `draft`, with conflicts, or with failing required pipelines / unmet approvals. Merging respects project merge method (merge / squash / rebase).

## Issue

| Field                          | Notes                                               |
| ------------------------------ | --------------------------------------------------- |
| iid                            | project-scoped number (`#42`) — use in URLs         |
| id                             | global id — do NOT use in project paths             |
| state                          | opened / closed                                     |
| title, description             | description is Markdown                             |
| labels                         | array of strings; on write pass comma-joined string |
| assignees, milestone, due_date | planning                                            |
| confidential                   | hidden from non-members                             |

Issues exist at three scopes: project (`/projects/:id/issues`), group (`/groups/:id/issues`), global (`/issues`, the token user's issues).

## Pipeline / Job

- **Pipeline**: `{id, iid, status, ref, sha, source, created_at, web_url}`. status ∈ created, waiting_for_resource, preparing, pending, running, success, failed, canceled, skipped, manual, scheduled.
- **Job**: `{id, name, stage, status, ref, pipeline, started_at, finished_at, duration, web_url}`. Log via `/jobs/{id}/trace` (plain text).

## Release / Tag

- **Release**: `{tag_name, name, description (Markdown notes), created_at, released_at, author, commit, assets:{links,sources}}`. Created against an existing or new tag.
- Creating a release with a `ref` will create the tag if it doesn't exist.

## Notes (comments)

Comments on issues/MRs/commits/snippets are **notes**: `POST /projects/:id/{issues|merge_requests}/:iid/notes` with `{body}` (Markdown). System notes (label changes, etc.) are read-only.

## Cross-cutting rules

- **iid vs id**: project endpoints use iid; global endpoints return id. Mixing them → 404.
- **404 hides private resources**: a 404 may mean "no access," not "absent."
- **Dates**: ISO 8601 UTC. Filters: `created_after/before`, `updated_after/before`, `since/until` (commits).
- **Markdown** everywhere (descriptions, notes, release notes) — GitLab Flavored Markdown.
- **Labels** are strings; on writes pass a comma-separated string, on reads you get an array.
