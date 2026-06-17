---
api_name: GitLab
api_slug: gitlab
doc: query-patterns (companion to 01-llm-api-rules.md)
---

# GitLab — Query Patterns (reads)

All paths are relative to base_url (`https://gitlab.com/api/v4`, or the configured self-managed root). Project `:id` = numeric or URL-encoded `group%2Fproject`. Issues/MRs by `iid`.

## Resolve a project

```
GET /projects?search={name}&membership=true&per_page=20&order_by=last_activity_at&sort=desc
GET /projects/{id}                       # full project; read default_branch here
GET /user                                # the token owner (id, username)
```

Prefer `membership=true` to limit to the user's projects. `simple=true` returns a lighter payload. Cache the numeric `id` for the session.

## Browse repository

```
GET /projects/{id}/repository/tree?ref={branch}&path={dir}&recursive=true&per_page=100
GET /projects/{id}/repository/files/{file_path}/raw?ref={branch}     # raw bytes/text
GET /projects/{id}/repository/files/{file_path}?ref={branch}         # JSON: base64 content + metadata
GET /projects/{id}/repository/branches?search={q}
GET /projects/{id}/repository/tags?order_by=updated&sort=desc&per_page=20
```

- `file_path` must be URL-encoded: `src/app.py` → `src%2Fapp.py`.
- Omit `ref` to use the default branch; pass it explicitly for reproducibility.
- `recursive=true` walks the whole subtree (still paginated — follow `x-next-page`).

## Commits, diffs, compare

```
GET /projects/{id}/repository/commits?ref_name={branch}&since={iso}&until={iso}&per_page=100
GET /projects/{id}/repository/commits/{sha}                          # single commit
GET /projects/{id}/repository/commits/{sha}/diff                     # file-level diffs
GET /projects/{id}/repository/compare?from={ref}&to={ref}            # diff + commits between refs
```

`compare` is the workhorse for "what changed since the last release" — `from=<last tag>`, `to=main`.

## Merge requests

```
GET /projects/{id}/merge_requests?state=opened&order_by=created_at&sort=desc&per_page=100
GET /projects/{id}/merge_requests?state=merged&updated_after={iso}    # for release notes
GET /projects/{id}/merge_requests/{iid}
GET /projects/{id}/merge_requests/{iid}/changes                       # diffs
GET /projects/{id}/merge_requests/{iid}/commits
GET /projects/{id}/merge_requests/{iid}/notes
GET /merge_requests?scope=assigned_to_me&state=opened                 # global, the token user
```

Filters: `state`, `author_username`, `assignee_username`, `reviewer_username`, `labels`, `milestone`, `target_branch`, `source_branch`, `search`.

## Issues

```
GET /projects/{id}/issues?state=opened&labels=bug&order_by=created_at&sort=desc&per_page=100
GET /projects/{id}/issues/{iid}
GET /groups/{id}/issues?state=opened
GET /issues?scope=assigned_to_me&state=opened                         # global, the token user
```

Filters: `state`, `labels` (comma-joined; `None`/`Any` special), `milestone`, `assignee_username`, `author_username`, `search`, `created_after/before`, `updated_after/before`, `confidential`.

## Pipelines & jobs

```
GET /projects/{id}/pipelines?ref={branch}&status=failed&order_by=id&sort=desc&per_page=20
GET /projects/{id}/pipelines/{pipeline_id}
GET /projects/{id}/pipelines/{pipeline_id}/jobs
GET /projects/{id}/jobs/{job_id}
GET /projects/{id}/jobs/{job_id}/trace                                # plain-text log
```

## Releases, members, search

```
GET /projects/{id}/releases?per_page=20
GET /projects/{id}/releases/{tag_name}
GET /projects/{id}/members/all?per_page=100                           # incl. inherited
GET /projects/{id}/search?scope=blobs&search={query}                  # code search
GET /search?scope=projects&search={query}                            # global search
```

Project search scopes: `blobs` (code), `commits`, `issues`, `merge_requests`, `milestones`, `wiki_blobs`, `notes`, `users`.

## Pagination

- **Offset (default):** `per_page` (≤100) + `page`. Read `x-next-page` (empty = last), `x-total`/`x-total-pages` (may be absent on big lists). Loop while `x-next-page` is non-empty.
- **Keyset (large/unbounded):** `?pagination=keyset&per_page=100&order_by=id&sort=asc`; follow the `Link: <...>; rel="next"` URL verbatim until no `next` link.
- Never assume a total when `x-total` is missing — say "at least N" unless fully paged.

## Worked example — open issues, paged

```
numa integrations request gitlab GET "/projects/mygroup%2Fmyrepo/issues?state=opened&per_page=100&page=1" -m "issues p1"
# if response header x-next-page = 2:
numa integrations request gitlab GET "/projects/mygroup%2Fmyrepo/issues?state=opened&per_page=100&page=2" -m "issues p2"
```
