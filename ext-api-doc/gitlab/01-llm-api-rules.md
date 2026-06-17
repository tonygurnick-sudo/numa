---
api_name: GitLab
api_slug: gitlab
base_url: https://gitlab.com/api/v4
self_managed: admin may set an Instance URL → base becomes https://gitlab.example.com/api/v4 (same paths). Never hardcode gitlab.com if a project path implies a private host.
url_form: relative path against base_url (e.g. /projects/123/issues); backend expands it
path_version_segment: /api/v4 is part of base_url — do NOT add it to the relative path
auth: Bearer PAT (glpat-…) — injected by backend; agent NEVER sets Authorization or PRIVATE-TOKEN
field_casing: snake_case (request params AND response fields)
id_format: project/group id = numeric OR URL-encoded full path ("group%2Fsubgroup%2Fproject"). issues/MRs are addressed by project-scoped iid, NOT global id.
pagination: offset by default (page + per_page, max 100); response headers x-next-page / x-total / Link. Keyset for big/unbounded lists.
rate_limit: GitLab.com authenticated ~2000 req/min/user; 429 carries Retry-After + RateLimit-* headers
call_surface: HTTP via `numa integrations request gitlab <METHOD> <URL> [--body '{...}']`. NOT a file-store connector — does NOT support list-files/search-files/download-file; read repo content through repository endpoints below.
confidence: facts are docs-derived from GitLab REST API v4 [DOCS], NOT live-validated through Numa. Trust real responses over this file; note discrepancies. Non-default markers [UNVERIFIED]/[INFERRED] inline.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# GitLab — API Rules

GitLab REST API v4 — DevOps platform: projects (repos), branches/tags/commits, files, merge requests, issues, pipelines/jobs, releases, members, groups, users.

## How to call

```
numa integrations request gitlab GET "/projects?membership=true&per_page=100&order_by=last_activity_at" -m "list my projects"
numa integrations request gitlab GET "/projects/mygroup%2Fmyrepo/issues?state=opened" -m "open issues"
numa integrations request gitlab POST /projects/123/issues --body '{"title":"Bug: login fails","description":"Steps...","labels":"bug"}' -m "create issue"
```

- URL = relative path (`/projects/...`); backend prepends base_url (`/api/v4` already included). NEVER add `/api/v4` yourself.
- `Authorization: Bearer glpat-…` is backend-injected from the user's vault. NEVER set it; you never see the token.
- Params and body are **snake_case**. Body = single JSON object, or use `--field key=value` flags.
- Self-managed GitLab: the admin may have set an Instance URL; paths are identical. Don't assume gitlab.com.

## Identifying a project (the #1 gotcha)

A project `:id` is **either** the numeric id **or** the URL-encoded full path with `/` → `%2F`:

- `mygroup/myrepo` → `mygroup%2Fmyrepo`
- `mygroup/subgroup/myrepo` → `mygroup%2Fsubgroup%2Fmyrepo`

If you only know the name, resolve first: `GET /projects?search=myrepo&membership=true`. Cache the numeric id for the session. A wrong/foreign path → **404, not 403** (GitLab hides private resources — see below).

## iid vs id (issues & merge requests)

Issues and MRs have BOTH a global `id` and a project-scoped `iid` (the number users see, `#42`). Project endpoints address them by **iid**: `GET /projects/:id/issues/:issue_iid`, `/merge_requests/:merge_request_iid`. Using the global `id` there → 404. Always pass the iid in project-scoped paths.

## Auth structure

PAT = Personal/Project/Group Access Token from GitLab → Settings → Access Tokens. Scopes are chosen at creation.

- Reads need `read_api` (and `read_repository` for repo content). Writes need `api`.
- **401 = bad/expired/revoked token.** User reconnects via the chat credential card. Do not retry.
- **403 = the token's scope or the user's role is insufficient** for that action (e.g. a Reporter trying to merge). Name the missing scope/role; do not retry.
- **404 on a resource you expect to exist = often a permissions hide**, not a real absence. GitLab returns 404 (not 403) for private resources the token can't see. Re-check the path encoding AND whether the token's user has access.

## CAN

1. Projects: list/search, read, read settings, languages, members.
2. Repository: browse tree, read raw file content, list/read commits, diffs, compare refs, branches, tags.
3. Merge requests: list/search, read, read changes/commits/notes; create, update, comment, merge.
4. Issues: list/search (project, group, or global), read, create, update, close, comment, label.
5. Pipelines & jobs: list/read status, read job logs (trace), trigger a pipeline, retry/cancel.
6. Releases & tags: list/read; create a tag or a release with notes.
7. Members, users (`GET /user` = the token owner), groups, milestones, labels.
8. Page any list: `per_page` (max 100) + `page`, or keyset for large sets.

## CANNOT

1. Receive webhooks for the agent — **polling only** (list with `updated_after`/`order_by`).
2. Exceed 100 records/page.
3. Act beyond the token's scope or the user's project role (→ 403).
4. Read a private project the token's user isn't a member of (→ 404).
5. Use a path id without URL-encoding the slashes (→ 404).

## Critical gotchas

1. **URL-encode project paths** (`/` → `%2F`). The most common cause of a surprise 404.
2. **404 can mean "no permission"** on private resources — don't tell the user "it doesn't exist"; suggest checking access/encoding first.
3. **Address issues/MRs by `iid`** in project paths, never the global `id`.
4. **Read file content** via `GET /projects/:id/repository/files/{file_path}/raw?ref=main` — `file_path` must be URL-encoded (`src/app.py` → `src%2Fapp.py`). The non-`/raw` variant returns base64 in a JSON envelope.
5. **`ref` defaults to the project's default branch** when omitted on file/commit reads — pass `ref` explicitly for reproducibility.
6. **Pagination total may be absent** on large/keyset lists (`x-total` omitted for performance). Phrase counts as "at least N" unless you paged to the end (no `x-next-page`).
7. **Dates are ISO 8601** (`2026-06-17T10:00:00.000Z`). Filters: `created_after`, `updated_after`, `since`/`until` (commits).
8. **Merging an MR is a real action** — confirm with the user; respects merge checks (pipeline must pass, approvals) and can 405/422 if not mergeable.
9. **Self-managed instance:** don't hardcode `gitlab.com`; use relative paths so the configured base applies.

## Default parameters (override only if the user specifies)

| Param    | Default                                              | Reason                                |
| -------- | ---------------------------------------------------- | ------------------------------------- |
| per_page | 20 (API default); use 100 for bulk reads             | max 100                               |
| page     | 1; then follow `x-next-page`                         | offset pagination                     |
| ref      | project default branch                               | pass explicitly for file/commit reads |
| order_by | `created_at` (lists) / `last_activity_at` (projects) | newest-first when `sort=desc`         |
| scope    | `membership=true` on `/projects`                     | limits to the user's own projects     |
| Pacing   | sequential, back off on 429                          | respect Retry-After                   |

## Core operations (full catalog in 01a/01b/01c)

| Operation              | Method   | Path                                                     | Notes                               |
| ---------------------- | -------- | -------------------------------------------------------- | ----------------------------------- |
| Current user           | GET      | /user                                                    | resolves the token owner            |
| List/search projects   | GET      | /projects?search=&membership=true                        | resolve a project id here           |
| Get project            | GET      | /projects/{id}                                           | id numeric or URL-encoded path      |
| Repo tree              | GET      | /projects/{id}/repository/tree?ref=&path=&recursive=true | browse files/folders                |
| Read file (raw)        | GET      | /projects/{id}/repository/files/{file_path}/raw?ref=main | file_path URL-encoded               |
| List commits           | GET      | /projects/{id}/repository/commits?ref_name=&since=       | history                             |
| Compare refs           | GET      | /projects/{id}/repository/compare?from=&to=              | diff between branches/tags/SHAs     |
| List MRs               | GET      | /projects/{id}/merge_requests?state=opened               | also group/global variants          |
| Get MR + changes       | GET      | /projects/{id}/merge_requests/{iid}[/changes]            | by iid                              |
| Create/update MR       | POST/PUT | /projects/{id}/merge_requests[/{iid}]                    | source_branch, target_branch, title |
| Merge MR               | PUT      | /projects/{id}/merge_requests/{iid}/merge                | REAL — confirm first                |
| List/create issues     | GET/POST | /projects/{id}/issues                                    | by iid for get/update               |
| Comment (note)         | POST     | /projects/{id}/issues/{iid}/notes                        | `{"body":"..."}`                    |
| List pipelines         | GET      | /projects/{id}/pipelines?ref=&status=                    | status: success/failed/running…     |
| Job log (trace)        | GET      | /projects/{id}/jobs/{job_id}/trace                       | plain-text build log                |
| List releases          | GET      | /projects/{id}/releases                                  | tag_name, description (notes)       |
| Create release         | POST     | /projects/{id}/releases                                  | tag_name + description              |
| Search (project blobs) | GET      | /projects/{id}/search?scope=blobs&search=                | code search; also global /search    |

## Pagination

Offset: `per_page` (default 20, max 100) + `page`. Next page in `x-next-page` header (empty when done); `x-total`/`x-total-pages` when available. For large/unbounded lists use keyset: `?pagination=keyset&per_page=100&order_by=id&sort=asc`, then follow the `Link: rel="next"` URL verbatim. Stop when `x-next-page` is empty or a page returns `[]`.

## Errors

Body is JSON: usually `{"message":"..."}` or `{"error":"..."}`. Status is the contract; quote bodies verbatim.

| Status | Meaning                                      | Action                                                              |
| ------ | -------------------------------------------- | ------------------------------------------------------------------- |
| 400    | bad request / validation                     | fix params/body (encoding, required fields); do NOT retry unchanged |
| 401    | bad/expired/revoked PAT                      | reconnect via chat credential card; do not retry                    |
| 403    | token scope or user role insufficient        | name the scope/role; do not retry                                   |
| 404    | wrong id/path/iid OR private resource hidden | fix path encoding + iid; else token's user lacks access             |
| 405    | method not allowed for current state         | e.g. MR not mergeable yet (checks pending)                          |
| 409    | conflict                                     | e.g. branch already exists; reconcile then retry                    |
| 422    | unprocessable (validation)                   | fix values; don't retry unchanged                                   |
| 429    | rate limited                                 | honor `Retry-After`; back off; reduce pacing                        |
| 5xx    | server error                                 | retry once after 5s; for writes, verify whether it landed           |

## Examples

1. Resolve a project, then read a file:

```
numa integrations request gitlab GET "/projects?search=numa&membership=true&per_page=20" -m "find project"
numa integrations request gitlab GET "/projects/4279%2Fnuma/repository/files/README.md/raw?ref=main" -m "read README"
```

2. Open issues, newest first, then comment:

```
numa integrations request gitlab GET "/projects/4279%2Fnuma/issues?state=opened&order_by=created_at&sort=desc&per_page=100" -m "open issues"
numa integrations request gitlab POST "/projects/4279%2Fnuma/issues/42/notes" --body '{"body":"Looking into this now."}' -m "comment on #42"
```

3. Generate release notes — compare last tag to HEAD, then read merged MRs:

```
numa integrations request gitlab GET "/projects/4279%2Fnuma/repository/tags?per_page=1&order_by=updated" -m "latest tag"
numa integrations request gitlab GET "/projects/4279%2Fnuma/repository/compare?from=v1.2.0&to=main" -m "diff since last release"
numa integrations request gitlab GET "/projects/4279%2Fnuma/merge_requests?state=merged&order_by=updated_at&sort=desc&per_page=100" -m "merged MRs"
```

4. Create a release (after confirming with the user):

```
numa integrations request gitlab POST "/projects/4279%2Fnuma/releases" --body '{"tag_name":"v1.3.0","ref":"main","name":"v1.3.0","description":"## Highlights\n- ..."}' -m "create release"
```
