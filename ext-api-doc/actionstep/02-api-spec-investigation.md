---
api_name: 'Actionstep'
api_slug: 'actionstep'
base_url: '{api_endpoint}/api/rest (region-specific; from token response)'
version: 'v1 (vnd.api+json), v2 partial'
spec_format: 'OpenAPI (per-endpoint YAMLs); no single aggregate spec'
spec_url: 'https://docs.actionstepdev.com/ (v2 reference)'
docs_url: 'https://docs.actionstep.com/'
date_researched: '2026-05-27'
---

# Actionstep — API Specification & Investigation

> Clean developer reference. **Doc-based** — no live call made; confirm 🔬 items on a sandbox.

---

## Overview

- **Vendor:** Actionstep (legal practice management SaaS; NZ-founded, US-HQ, PE-owned).
- **API version:** v1 (`application/vnd.api+json`, full surface) + v2 (cleaner JSON; partial).
- **Base URL:** the `api_endpoint` from the OAuth token response, then `/api/rest/{resource}`.
- **Sandbox/staging:** `go.actionstepstaging.com` (authorize) / `api.actionstepstaging.com` (token).
- **API type:** REST. **Data format:** JSON (`vnd.api+json` envelope on v1).
- **Documentation:** https://docs.actionstep.com/ · legacy: https://actionstep.atlassian.net/wiki/spaces/API
- **OpenAPI:** per-endpoint YAML specs published; no single aggregate file.
- **Summary:** REST API over a law firm's matters, contacts, time, billing, tasks, documents.

---

## Authentication

### Method: OAuth 2.0 (Authorization Code only)

User-context only — no machine-to-machine. The token response carries the **region base URL**
(`api_endpoint`) and the org id (`orgkey`).

**Header format:**

```
Authorization: Bearer <access_token>
Content-Type: application/vnd.api+json
```

**OAuth 2.0:**

| Parameter         | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)          |
| Authorization URL | `https://go.actionstep.com/api/oauth/authorize`             |
| Token URL         | `https://api.actionstep.com/api/oauth/token`                |
| Token lifetime    | access 28800s (8h); refresh 21 days, **rotates** on refresh |
| PKCE required     | Not documented 🔬                                           |

**Scopes:** space-separated resource names; `all` is a wildcard. Common: `actions`,
`participants`, `timerecords`, `filenotes`, `tasks`, `bills`, `actiondocuments`, `resthooks`.

---

## Endpoint Catalog

Standard verbs per resource (`{api_endpoint}/api/rest/...`):

| Method | Path            | Purpose       | Paginated |
| ------ | --------------- | ------------- | --------- |
| GET    | `/actions`      | List matters  | Yes       |
| GET    | `/actions/{id}` | Get matter    | No        |
| POST   | `/actions`      | Create matter | No        |
| PUT    | `/actions/{id}` | Update matter | No        |
| DELETE | `/actions/{id}` | Delete matter | No        |

Same shape repeats for: `participants`, `timeentries`, `filenotes`, `tasks`, `bills`,
`actiondocuments`, `actiontypes`, `datacollections`, `datacollectionrecords`, `resthooks`,
`disbursements`, and the other resources listed at `/endpoint-resources/`.

### RestHooks

| Method | Path              | Purpose               |
| ------ | ----------------- | --------------------- |
| GET    | `/resthooks`      | List subscriptions    |
| POST   | `/resthooks`      | Subscribe to an event |
| PUT    | `/resthooks/{id}` | Update subscription   |
| DELETE | `/resthooks/{id}` | Unsubscribe           |

---

## Data Models

See `01a-domain-model-reference.md`. Core: **Action** (matter), **Participant** (contact),
**TimeEntry**, **FileNote**, **Task**, **Bill**, **ActionDocument**. Records use integer ids;
related records are sideloaded under `linked` with URI templates under `links`.

---

## Pagination

- **Type:** page-number. **Default:** 50. **Max:** 200 (`pageSize` cap). **Total count:** yes.

| Parameter  | Type | Default | Description         |
| ---------- | ---- | ------- | ------------------- |
| `page`     | int  | 1       | 1-based page no.    |
| `pageSize` | int  | 50      | Records/page (≤200) |

**Response structure:**

```json
{ "actions": [ ... ], "links": { ... }, "linked": { ... },
  "meta": { "paging": { "actions": { "recordCount": 240, "pageCount": 5, "page": 1, "pageSize": 50, "prevPage": null, "nextPage": 2 } } } }
```

**Last page detection:** `meta.paging.{resource}.nextPage === null`.

---

## Rate Limits

| Scope                      | Limit          | Window |
| -------------------------- | -------------- | ------ |
| user/session + orgkey + IP | unpublished 🔬 | —      |

**When exceeded:** `429`. **Headers:** none documented 🔬. **Strategy:** exponential backoff +
jitter; serialise bursty work (limits are session/org-based). Live since April 2024.

---

## Error Handling

```json
{
  "errors": {
    "id": "...",
    "status": 422,
    "code": "AS-…",
    "title": "...",
    "detail": "...",
    "source": { "pointer": null, "parameter": null }
  }
}
```

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

---

## Webhooks / Events

**Registration:** `POST /api/rest/resthooks` (`{"resthooks": {"eventName","targetUrl"}}`).
**Events:** 24 (ActionCreated, ActionUpdated, TaskCreated, TimeEntryCreated, FileNoteCreated,
ParticipantCreated, StepChanged, …). **Verification:** none documented 🔬. **Reliability:**
target must return 200 or the hook is disabled; payload body shape undocumented 🔬 (re-fetch).

---

## Known Limitations

1. OAuth user-context only — no service accounts.
2. Region base URL is dynamic (`api_endpoint`) — must be stored/used per connection.
3. Filter/sort syntax, webhook payloads, and exact rate limits are under-documented.

---

## SDKs & Tooling

| SDK / tooling          | Notes                                               |
| ---------------------- | --------------------------------------------------- |
| Postman examples       | Staging Postman walkthrough in the legacy API guide |
| OpenAPI (per-endpoint) | YAML per resource; no aggregate spec                |
| Official SDK           | None first-party of note 🔬                         |

---

## Integration Path Assessment

**Recommended path:** **Direct API (spec-driven, chat-only).**

**Justification:** Structured legal-practice data, not browsable files — so not a Files-Remote
connector. Mirrors NetSuite/simPRO/Zoho: an OAuth2 connector whose specs live in `ext-api-doc/`
and are read by the workspace agent; **no `lib/oauth-providers/` provider class**;
`surfaces: ['chat']`.

| Connector Method | Feasibility | Note                                    |
| ---------------- | ----------- | --------------------------------------- |
| list (chat)      | good        | `GET /api/rest/{resource}`              |
| get/read (chat)  | good        | `GET /api/rest/{resource}/{id}`         |
| create/update    | good        | `POST`/`PUT` (confirm field schemas 🔬) |
| file browsing    | n/a         | not a file connector                    |

---

_Researched 2026-05-27 (documentation-based; live smoke test pending). Source: investigation questionnaire._
