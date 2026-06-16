---
api_name: Actionstep
api_slug: actionstep
base_url: dynamic — api_endpoint from the OAuth token response (region-specific), then /api/rest/{resource}
path_version_segment: none — "v1"/"v2" are API variants (content-type/label), NEVER a path segment
api_variant: v1 (application/vnd.api+json, full surface) + v2 (plain JSON, partial — Matters/FileNotes/Tags)
spec_format: OpenAPI (per-endpoint YAMLs); no single aggregate spec
spec_url: https://docs.actionstepdev.com/ (v2 reference)
docs_url: https://docs.actionstep.com/
auth: OAuth2 authorization-code only (user-context); no machine-to-machine
field_casing: camelCase
id_format: integer
date_researched: 2026-05-27 (doc-based — no live call; confirm 🔬 on a sandbox)
---

# Actionstep — API Specification & Investigation

## Overview

- **Vendor:** Actionstep (legal practice management SaaS; NZ-founded, US-HQ, PE-owned).
- **API variants:** v1 (`application/vnd.api+json`, full surface) + v2 (cleaner plain JSON; partial — Matters/FileNotes/Tags only). Use v1 unless told.
- **Base URL:** `api_endpoint` from the OAuth token response, then `/api/rest/{resource}`. No version segment in the path.
- **API type / format:** REST; JSON (`vnd.api+json` envelope on v1).
- **Sandbox/staging hosts:** `go.actionstepstaging.com` (authorize) / `api.actionstepstaging.com` (token). Production: `go.actionstep.com` / `api.actionstep.com`.
- **Docs:** https://docs.actionstep.com/ · legacy: https://actionstep.atlassian.net/wiki/spaces/API
- **OpenAPI:** per-endpoint YAML specs; no single aggregate file.
- **Summary:** REST API over a law firm's matters, contacts, time, billing, tasks, documents.

## Authentication — OAuth 2.0 (Authorization Code only)

User-context only — no machine-to-machine. The token response carries the **region base URL** (`api_endpoint`) and org id (`orgkey`).

Headers: `Authorization: Bearer <access_token>` · `Content-Type: application/vnd.api+json`.

| Parameter         | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)          |
| Authorization URL | `https://go.actionstep.com/api/oauth/authorize`             |
| Token URL         | `https://api.actionstep.com/api/oauth/token`                |
| Token lifetime    | access 28800s (8h); refresh 21 days, **rotates** on refresh |
| PKCE required     | Not documented 🔬                                           |

**Scopes:** space-separated resource names; `all` = wildcard. Common: `actions`, `participants`, `timerecords`, `filenotes`, `tasks`, `bills`, `actiondocuments`, `resthooks`.

## Endpoint Catalog

Standard verbs per resource (`{api_endpoint}/api/rest/...`):

| Method | Path            | Purpose       | Paginated |
| ------ | --------------- | ------------- | --------- |
| GET    | `/actions`      | List matters  | Yes       |
| GET    | `/actions/{id}` | Get matter    | No        |
| POST   | `/actions`      | Create matter | No        |
| PUT    | `/actions/{id}` | Update matter | No        |
| DELETE | `/actions/{id}` | Delete matter | No        |

Same shape repeats for: `participants`, `timeentries`, `filenotes`, `tasks`, `bills`, `actiondocuments`, `actiontypes`, `datacollections`, `datacollectionrecords`, `resthooks`, `disbursements`, and the other resources at `/endpoint-resources/`.

RestHooks: `GET /resthooks` (list) · `POST /resthooks` (subscribe) · `PUT /resthooks/{id}` (update) · `DELETE /resthooks/{id}` (unsubscribe).

## Data Models

See `01a-domain-model-reference.md`. Core: **Action** (matter), **Participant** (contact), **TimeEntry**, **FileNote**, **Task**, **Bill**, **ActionDocument**. Integer ids; related records sideloaded under `linked` with URI templates under `links`.

## Pagination

Page-number. Default 50, max 200 (`pageSize` cap). Total count: yes.

| Param      | Type | Default | Description         |
| ---------- | ---- | ------- | ------------------- |
| `page`     | int  | 1       | 1-based page no.    |
| `pageSize` | int  | 50      | Records/page (≤200) |

Response: `{"actions":[...],"links":{...},"linked":{...},"meta":{"paging":{"actions":{"recordCount":240,"pageCount":5,"page":1,"pageSize":50,"prevPage":null,"nextPage":2}}}}`. Last page when `meta.paging.{resource}.nextPage === null`.

## Rate Limits

Scope: user/session + orgkey + IP. Limit: unpublished 🔬. **When exceeded:** `429`. **Headers:** none documented 🔬. **Strategy:** exponential backoff + jitter; serialise bursty work (limits are session/org-based). Live since April 2024.

## Error Handling

Format: `{"errors":{"id":"...","status":422,"code":"AS-…","title":"...","detail":"...","source":{"pointer":null,"parameter":null}}}`

| Status | Meaning          | Retryable | Recovery             |
| ------ | ---------------- | --------- | -------------------- |
| 400    | Bad request      | No        | Fix request          |
| 401    | Unauthorized     | Yes       | Refresh token        |
| 403    | Forbidden        | No        | Check scopes/role    |
| 404    | Not found        | No        | Verify id + base URL |
| 422    | Validation error | No        | Read `code`/`source` |
| 429    | Rate limited     | Yes       | Backoff              |
| 5xx    | Server error     | Yes       | Backoff              |

Per-resource validation codes: `A01–A02`, `P01–P03`, `T01–T11`, `TR01–TR05`.

## Webhooks / Events

Registration: `POST /api/rest/resthooks` (`{"resthooks":{"eventName","targetUrl"}}`). Events: 24 (ActionCreated, ActionUpdated, TaskCreated, TimeEntryCreated, FileNoteCreated, ParticipantCreated, StepChanged, …). Verification: none documented 🔬. Reliability: target must return 200 or the hook is disabled; payload body shape undocumented 🔬 (re-fetch). Full event list in `01d`.

## Known Limitations

1. OAuth user-context only — no service accounts.
2. Region base URL is dynamic (`api_endpoint`) — store/use per connection.
3. Filter/sort syntax, webhook payloads, and exact rate limits are under-documented.

## SDKs & Tooling

| SDK / tooling          | Notes                                               |
| ---------------------- | --------------------------------------------------- |
| Postman examples       | Staging Postman walkthrough in the legacy API guide |
| OpenAPI (per-endpoint) | YAML per resource; no aggregate spec                |
| Official SDK           | None first-party of note 🔬                         |

## Integration Path Assessment

**Recommended: Direct API (spec-driven, chat-only).** Justification: structured legal-practice data, not browsable files — so not a Files-Remote connector. Mirrors NetSuite/simPRO/Zoho: an OAuth2 connector whose specs live in `ext-api-doc/` and are read by the workspace agent; **no `lib/oauth-providers/` provider class**; `surfaces: ['chat']`.

| Connector Method | Feasibility | Note                                    |
| ---------------- | ----------- | --------------------------------------- |
| list (chat)      | good        | `GET /api/rest/{resource}`              |
| get/read (chat)  | good        | `GET /api/rest/{resource}/{id}`         |
| create/update    | good        | `POST`/`PUT` (confirm field schemas 🔬) |
| file browsing    | n/a         | not a file connector                    |

## Sources

Researched 2026-05-27 (doc-based; live smoke test pending). Investigation questionnaire + docs.actionstep.com.
