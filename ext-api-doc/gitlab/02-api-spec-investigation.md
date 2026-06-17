---
api_name: GitLab
api_slug: gitlab
doc: api-spec-investigation (developer reference)
integration_path: Direct API (spec-driven, chat-only)
---

# GitLab REST API v4 — Developer Reference

## Overview

- **Product:** GitLab — Git hosting + DevOps (repos, MRs, issues, CI/CD, releases).
- **API:** REST v4. JSON. Stable and well-documented.
- **Base URL (SaaS):** `https://gitlab.com/api/v4`
- **Base URL (self-managed):** `https://<host>/api/v4` — admin sets the Instance URL in the wizard; the backend resolver prefers vault `instance_url` over the registry `base_url`.
- **Docs:** https://docs.gitlab.com/ee/api/rest/ (and per-resource pages, e.g. `/ee/api/issues.html`).
- **GraphQL** also exists (`/api/graphql`) but is out of scope — the connector uses REST.

## Auth

- **Mechanism:** Personal Access Token (also Project or Group Access Token). Sent as `Authorization: Bearer <token>` **or** `PRIVATE-TOKEN: <token>`. The connector uses Bearer (backend-injected).
- **Scopes:** `read_api` (read), `api` (read+write), `read_repository` / `write_repository` (Git over HTTP, repo content). For this connector: `api` gives full reach; `read_api` is enough for read-only use.
- **Expiry:** PATs may have an expiry date (GitLab.com enforces a max). Expired → 401. No refresh flow — the user generates a new token and reconnects.
- **Roles:** Beyond scope, the token user's project/group role gates writes (Developer+ to push/comment, Maintainer+ to merge/protect).

## Identifiers

- Project/group `:id` = numeric id OR URL-encoded full path (`group%2Fsubgroup%2Fproject`).
- Issues/MRs are addressed by project-scoped **iid** in project endpoints; global endpoints return the global `id`.

## Pagination

- Offset: `page` + `per_page` (default 20, max 100). Headers: `x-next-page`, `x-prev-page`, `x-page`, `x-per-page`, `x-total`, `x-total-pages` (`x-total*` may be omitted on large/keyset lists), plus RFC 5988 `Link`.
- Keyset: `?pagination=keyset&per_page=100&order_by=id&sort=asc`; follow `Link rel="next"`.

## Rate limits

- GitLab.com: ~2,000 authenticated req/min/user (plus stricter per-endpoint limits). Self-managed: configurable. 429 + `Retry-After` + `RateLimit-*` headers.

## Key endpoints (catalog)

| Group             | Endpoint                                                                  | Method              |
| ----------------- | ------------------------------------------------------------------------- | ------------------- | ------------------------------------ | -------- | ------------ |
| Identity          | `/user`                                                                   | GET                 |
| Projects          | `/projects`, `/projects/{id}`                                             | GET                 |
| Repo tree         | `/projects/{id}/repository/tree`                                          | GET                 |
| Repo file         | `/projects/{id}/repository/files/{path}[/raw]`                            | GET/POST/PUT/DELETE |
| Commits           | `/projects/{id}/repository/commits[/{sha}[/diff]]`                        | GET/POST            |
| Compare           | `/projects/{id}/repository/compare`                                       | GET                 |
| Branches          | `/projects/{id}/repository/branches`                                      | GET/POST/DELETE     |
| Tags              | `/projects/{id}/repository/tags`                                          | GET/POST/DELETE     |
| Merge requests    | `/projects/{id}/merge_requests[/{iid}[/changes                            | commits             | notes                                | merge]]` | GET/POST/PUT |
| Issues            | `/projects/{id}/issues[/{iid}[/notes]]`, `/groups/{id}/issues`, `/issues` | GET/POST/PUT        |
| Pipelines         | `/projects/{id}/pipelines[/{pid}[/jobs                                    | retry               | cancel]]`, `/projects/{id}/pipeline` | GET/POST |
| Jobs              | `/projects/{id}/jobs/{id}[/trace                                          | retry               | play]`                               | GET/POST |
| Releases          | `/projects/{id}/releases[/{tag_name}]`                                    | GET/POST/PUT        |
| Members           | `/projects/{id}/members[/all]`, `/groups/{id}/members`                    | GET                 |
| Search            | `/projects/{id}/search`, `/groups/{id}/search`, `/search`                 | GET                 |
| Labels/Milestones | `/projects/{id}/labels`, `/projects/{id}/milestones`                      | GET/POST            |

## Errors

JSON `{"message": ...}` or `{"error": ...}`. 401 bad token, 403 scope/role, 404 (also hides private resources), 405/406 merge state/conflict, 409 conflict, 422 validation, 429 rate limit. See 01d.

## Integration-path decision

- Browsable file content? **Yes** (repository files/tree) — but mapped to the chat request surface, not Files Remote (consistent with the other API connectors). The agent reads repo content via `/repository/files/.../raw`.
- Action-oriented? **Yes** (issues, MRs, releases, pipelines).
- **Chosen path: Direct API (spec-driven), chat-only.** No Python `oauth-provider`; the generic `numa integrations request gitlab ...` path resolves base_url + Bearer PAT from the vault. To add Files Remote browsing later would require a `gitlab_provider.py` implementing the OAuthProvider interface (project → ref → tree → blob) plus `handleListProviders`/`getProviderConfig` wiring.

## Validation status

Docs-derived from GitLab REST v4 [DOCS]. Phase-2 live smoke test (a real authenticated call through Numa) pending — mark `[CONFIRMED]` here once done. Trust live responses over this file.
