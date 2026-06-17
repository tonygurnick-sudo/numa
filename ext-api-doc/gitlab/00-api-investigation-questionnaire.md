---
api_name: GitLab
api_slug: gitlab
investigated_by: Claude (docs-derived)
date: 2026-06-18
confidence_legend: '[CONFIRMED]=live-tested, [DOCUMENTED]=in official docs, [INFERRED]=deduced, [UNKNOWN]=open'
status: docs complete; Phase-2 live smoke test pending
---

# GitLab — API Investigation Questionnaire

> Human research record. NOT loaded into the agent (00-_ is excluded from the runtime sync). The agent reads 01_/02/03/04.

## Phase 1 — Documentation

- Official REST docs: https://docs.gitlab.com/ee/api/rest/ [DOCUMENTED]
- Per-resource pages: issues, merge_requests, commits, repository_files, releases, pipelines, jobs, search, members [DOCUMENTED]
- OpenAPI: partial/per-area; not a single authoritative spec [DOCUMENTED]
- GraphQL alternative at `/api/graphql` — out of scope [DOCUMENTED]

## Phase 2 — First successful call (GATE)

- Intended smoke test: `GET https://gitlab.com/api/v4/user` with `Authorization: Bearer <PAT>` → 200 + the token owner. [PENDING live verification through Numa]
- Auth header confirmed by docs: Bearer PAT or `PRIVATE-TOKEN` header. [DOCUMENTED]

## Phase 3 — Auth

- Type: Personal/Project/Group Access Token (static bearer). [DOCUMENTED]
- Scopes: `api` (read+write), `read_api`, `read_repository`/`write_repository`. [DOCUMENTED]
- Connector uses per-user PAT, captured in chat, stored in user vault; backend injects Bearer. [CONFIRMED — framework pattern]
- No refresh flow; expiry → 401; new token + reconnect. [DOCUMENTED]

## Phase 4 — Base URL & environments

- SaaS: `https://gitlab.com/api/v4`. [DOCUMENTED]
- Self-managed: `https://<host>/api/v4` — admin sets Instance URL in wizard; backend prefers vault `instance_url`. [CONFIRMED — framework pattern]
- `/api/v4` is part of base; relative paths must not repeat it. [DOCUMENTED]

## Phase 5 — Identifiers & casing

- Project/group id = numeric OR URL-encoded full path (`%2F` for `/`). [DOCUMENTED]
- Issues/MRs by project-scoped `iid` in project paths; global `id` elsewhere. [DOCUMENTED]
- snake_case for params and response fields. [DOCUMENTED]
- Dates ISO 8601 UTC. [DOCUMENTED]

## Phase 6 — Read operations

- Projects, repository tree/files/commits/compare, branches, tags, MRs (+changes/commits/notes), issues, pipelines/jobs (+trace), releases, members, search. See 01b. [DOCUMENTED]

## Phase 7 — Write operations

- Issues (create/update/close/notes), MRs (create/update/comment/merge), files (single + multi-file commit), branches/tags, releases, pipelines (trigger/retry/cancel), labels/milestones. See 01c. [DOCUMENTED]
- Writes need `api` scope + sufficient role; not idempotent (GET-check after 5xx). [DOCUMENTED]

## Phase 8 — Pagination, rate limits, errors

- Offset (`page`/`per_page`≤100, `x-next-page`/`x-total*`) + keyset (`pagination=keyset`, `Link rel=next`). [DOCUMENTED]
- GitLab.com ~2,000 req/min/user; 429 + `Retry-After` + `RateLimit-*`. [DOCUMENTED]
- Errors: `{"message"|"error"}`; 401/403/404(hide)/405/406/409/422/429/5xx. See 01d. [DOCUMENTED]

## Phase 9 — Integration path

- Has browsable content (repo files) AND actions → could be Hybrid. [DOCUMENTED]
- Decision: **Direct API (spec-driven, chat-only)** to match the other API connectors; Files Remote browsing deferred (would need a `gitlab_provider.py`). [DECIDED]

## Phase 10 — Readiness checklist

- [x] Docs located, auth + base URL + identifiers nailed down
- [x] Read + write catalogs, pagination, rate limits, error table
- [x] Integration path chosen; registry + catalog + slug-mirror + docs pack authored
- [ ] Phase-2 live smoke test through Numa (mark [CONFIRMED] in 02 when done)
- [ ] Deploy so the docs folder lands in `{client}-ext-api-doc` (un-greys the picker)
