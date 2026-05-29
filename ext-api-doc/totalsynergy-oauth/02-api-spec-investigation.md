---
api_name: 'Total Synergy (OAuth)'
api_slug: 'totalsynergy-oauth'
base_url: 'https://api.totalsynergy.com/api/v2/'
version: 'v2 (primary); v4 surface also live'
spec_format: 'Swagger UI (JS-rendered SPA); raw OpenAPI JSON URL not located'
spec_url: 'https://developers.totalsynergy.com/swagger/ui/index'
docs_url: 'https://developers.totalsynergy.com/'
date_researched: '2026-05-29'
---

# Total Synergy (OAuth) — API Specification & Investigation

> Clean developer reference for the Total Synergy v2 REST API (OAuth2 credential variant).
> **Documentation-based** — no live call was made (no application key / tenant at research
> time). Auth flow, rate limits, pagination, and base URL are `[DOCUMENTED]`; the endpoint
> catalog and field schemas are `[INFERRED]` because the reference is a JS-rendered Swagger SPA.
> Items tagged **🔬** require a live tenant to confirm.
>
> 📌 **Same API as `totalsynergy-api`.** Identical base URL, resources, pagination, and error
> model. The **only** difference is how the bearer credential is obtained — OAuth2
> authorization-code here vs. a long-lived static key copied from a user profile there. The
> `access-token` request header is identical either way. Keep both doc sets consistent; do not
> let the entity/endpoint/pagination sections diverge.

---

## Overview

- **Vendor:** Total Synergy Pty Ltd — practice management for architecture & engineering firms.
- **API version:** v2 (primary documented surface). A v4 surface (`/swagger/v4`) is also live.
- **Base URL:** `https://api.totalsynergy.com/api/v2/`
- **Test/beta URL:** `https://betaapi.totalsynergy.com/` (on request); UAT copy at `uat.totalsynergy.com` (weekly-refreshed production clone).
- **Power BI / public surface:** `https://publicapi.totalsynergy.com/`
- **API type:** REST. **Data format:** JSON.
- **Documentation:** [developers.totalsynergy.com](https://developers.totalsynergy.com/)
- **API reference:** [Swagger UI](https://developers.totalsynergy.com/swagger/ui/index) — JS-rendered SPA; not scrapable without a live app key 🔬
- **API FAQ (KB):** https://help.totalsynergy.com/en/articles/8696457-api-faq
- **OpenAPI spec:** Swagger **UI** confirmed; raw OpenAPI JSON URL not located 🔬
- **Status page:** Not located.

**Summary:** A REST API over an architecture/engineering firm's practice-management data —
projects, contacts, staff, timesheets, timers, and financial transactions (invoices). Used for
reporting (e.g. Power BI), timesheet/invoice automation, and project/contact lookups.

---

## Authentication

### Method: OAuth 2.0 (authorization-code grant — **vendor-custom**)

Total Synergy uses an authorization-code-style OAuth flow, but with **non-standard parameter
names, a non-standard token endpoint path, and a non-standard credential header.** This is the
single most important — and most fragile — part of the integration. Full step-by-step setup is in
`04-connection-and-reauth.md`.

**Header format (every API call):**

```
access-token: <accessToken>
Content-Type: application/json
```

> ⚠️ The credential header is **`access-token`** — **NOT** `Authorization: Bearer`. A `Bearer`
> header returns 401. This is the #1 mistake.

**OAuth 2.0 (as documented on the developer portal):**

| Parameter              | Value                                                                          | Confidence    |
| ---------------------- | ------------------------------------------------------------------------------ | ------------- |
| Grant type             | `authorization_code`                                                           | [DOCUMENTED]  |
| Authorization URL      | `https://app.totalsynergy.com/OAuth2/Authorize`                                | [DOCUMENTED]  |
| Authorize params       | `ApplicationKey`, `RedirectUri`, `tenant` (+ optional `simple=true`)           | [DOCUMENTED]  |
| Token URL              | `https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken` (POST)             | [DOCUMENTED]  |
| Token body             | `applicationKey`, `ApplicationSecret`, `code`, `grant_type=authorization_code` | [DOCUMENTED]  |
| Refresh URL            | `https://api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken` (POST)         | [DOCUMENTED]  |
| Refresh body           | `applicationKey`, `ApplicationSecret`, `refreshToken`, `grant_type`            | [DOCUMENTED]  |
| Revocation URL         | Not documented                                                                 | [UNKNOWN]     |
| Access token lifetime  | Short-lived; exact TTL returned in the token response, not published           | [INFERRED] 🔬 |
| Refresh token lifetime | **~1 month** ("the token contains a refreshToken that lasts for 1 month")      | [DOCUMENTED]  |
| Refresh rotation       | Whether `RefreshAccessToken` returns a _new_ refresh token is not stated       | [UNKNOWN] 🔬  |
| PKCE required          | No (custom flow; an `ApplicationSecret` is exchanged server-side instead)      | [INFERRED]    |
| Credential header      | **`access-token: <token>`** on every call — not `Authorization: Bearer`        | [DOCUMENTED]  |

> 🚩 **Registry mismatch (build-time blocker — see `03-connector-setup.md`).** The connector
> registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`) declares standard
> endpoints — `authUrl: app.totalsynergy.com/oauth2/authorize`, `tokenUrl:
app.totalsynergy.com/oauth2/token`, `scopes: ''` — which **do not match** the real flow above
> (wrong host/path on token; standard `client_id`/`response_type` params assumed but the API wants
> `ApplicationKey`/`tenant`; standard `Authorization: Bearer` assumed but the API wants
> `access-token`). The generic OAuth machinery will almost certainly not authenticate unmodified.

**Required scopes:**

| Scope  | Purpose                                                                                                                   | Required for integration? |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| _none_ | Total Synergy has **no OAuth scope system.** Access is governed by the authenticating user's Synergy security/role level. | n/a                       |

---

## Endpoint Catalog

Resources are **organisation-scoped**: most paths are `…/Organisation/{Slug}/{Resource}`, where
`{Slug}` is the org identifier (distinct from the `tenant` used at authorize time — resolve it
first via `Organisation` / `Organisation/MySlug` 🔬). Standard reads are paged with
`criteria.pagesize`; the response envelope is `{ "totalItems": <int>, "items": [ … ] }`.

### Auth (token lifecycle — `app secret`, not `access-token`)

| Method | Path                        | Purpose               | Auth       | Paginated |
| ------ | --------------------------- | --------------------- | ---------- | --------- |
| POST   | `Oauth2/GetAccessToken`     | Exchange code → token | app secret | No        |
| POST   | `Oauth2/RefreshAccessToken` | Refresh access token  | app secret | No        |

### Organisation / tenant

| Method | Path                                   | Purpose                      | Auth | Paginated | Confidence      |
| ------ | -------------------------------------- | ---------------------------- | ---- | --------- | --------------- |
| GET    | `Organisation` / `Organisation/MySlug` | List orgs / resolve `{Slug}` | Yes  | Maybe     | [DOCUMENTED] 🔬 |

### Projects

| Method | Path                                            | Purpose              | Auth | Paginated | Idempotent | Confidence    |
| ------ | ----------------------------------------------- | -------------------- | ---- | --------- | ---------- | ------------- |
| GET    | `Organisation/{Slug}/Projects`                  | List/search projects | Yes  | Yes       | Yes        | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Projects?criteria.Id={id}` | Get one project      | Yes  | No        | Yes        | [DOCUMENTED]  |
| GET    | `Organisation/{Slug}/Projects/{id}/Stages`      | Project stages       | Yes  | 🔬        | Yes        | [INFERRED] 🔬 |
| GET    | `Organisation/{Slug}/Projects/{id}/Tasks`       | Project tasks        | Yes  | 🔬        | Yes        | [INFERRED] 🔬 |

### Contacts / Staff

| Method | Path                           | Purpose              | Auth | Paginated | Confidence   |
| ------ | ------------------------------ | -------------------- | ---- | --------- | ------------ |
| GET    | `Organisation/{Slug}/Contacts` | List/search contacts | Yes  | Yes       | [DOCUMENTED] |
| GET    | `Organisation/{Slug}/Staff`    | List staff           | Yes  | Yes       | [DOCUMENTED] |

### Timesheets / Timers

| Method | Path                                        | Purpose               | Auth | Paginated | Confidence   |
| ------ | ------------------------------------------- | --------------------- | ---- | --------- | ------------ |
| GET    | `Organisation/{Slug}/Timesheet/Week`        | Weekly timesheet read | Yes  | 🔬        | [DOCUMENTED] |
| GET    | `Organisation/{Slug}/Timesheet/Leaderboard` | Timesheet leaderboard | Yes  | 🔬        | [DOCUMENTED] |
| GET    | `Organisation/{Slug}/Timers`                | Running/stored timers | Yes  | 🔬        | [DOCUMENTED] |

### Transactions (invoices + timesheet entries — **rate-limited**)

| Method | Path                               | Purpose                          | Auth | Paginated  | Idempotent | Confidence    |
| ------ | ---------------------------------- | -------------------------------- | ---- | ---------- | ---------- | ------------- |
| GET    | `Organisation/{Slug}/Transactions` | List transactions/invoices       | Yes  | keyset? 🔬 | Yes        | [INFERRED] 🔬 |
| POST   | `Organisation/{Slug}/Transactions` | Create timesheet entry / invoice | Yes  | No         | **No**     | [DOCUMENTED]  |

> The Transactions endpoint carries its **own, much tighter budget** (50 calls/day standard,
> 20,000/day Premium). Invoices and timesheet entries are both written through it; the exact create
> path and request/response for invoices vs. timesheet entries are 🔬 DISCOVER.

### Full Endpoint Index

> **🔬 DISCOVER:** the complete inventory must be enumerated from `/swagger/ui/index` (v2) and
> `/swagger/v4` against a live app key — the SPA returns near-empty HTML to a scraper, so the table
> above is the documented/inferred subset, **not** the complete catalog.

---

## Data Models

> All field names/types below are `[INFERRED]` from KB articles + product UI naming. Synergy
> serialises strongly-typed values (e.g. dates) as **strings** in JSON, but exact key names and
> casing are unconfirmed. 🔬 DISCOVER from a live spec dump. Full entity/relationship detail lives
> in `01a-domain-model-reference.md`.

### Project

| Field           | Type          | Required     | Writable | Description                                    |
| --------------- | ------------- | ------------ | -------- | ---------------------------------------------- |
| `id`            | string / int  | —            | no       | Unique project id; queryable via `criteria.Id` |
| `name`          | string        | yes (create) | yes      | Project/job name                               |
| `projectNumber` | string        | —            | maybe    | Human-facing job number                        |
| `status`        | enum/string   | —            | yes      | e.g. Active / On Hold / Closed 🔬              |
| `clientId`      | string / int  | —            | yes      | FK → Contact (the client)                      |
| `createdDate`   | string (ISO?) | —            | no       | Date serialised as a string (see formats)      |

**Relationships:**

- `Organisation ({Slug}) 1→N Project 1→N Stage 1→N Task`
- `Project N→1 Contact` (the client)
- `Staff 1→N Transactions` (timesheet entries / invoices reference `staffId`, `projectId`, `stageId`, `taskId`)

### Field Format Reference

| Format   | Pattern                                    | Example        | Notes                                                    | Confidence    |
| -------- | ------------------------------------------ | -------------- | -------------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)               | `"2026-05-29"` | "dates are serialized and delivered in string format"    | [DOCUMENTED]  |
| Int-date | `yyyymmdd`-style integer on some endpoints | `20260529`     | `fromDateAsInt` / `toDateAsInt` seen on timesheet inputs | [INFERRED] 🔬 |
| ID       | string or integer per resource             | `"12345"`      | Queryable via `criteria.Id`; exact type per resource 🔬  | [INFERRED] 🔬 |
| Currency | decimal number                             | `1500.00`      | On Transactions / invoices                               | [INFERRED] 🔬 |
| Slug     | org identifier string in path              | `acme-eng`     | `…/Organisation/{Slug}/…`                                | [DOCUMENTED]  |

---

## Pagination

- **Type:** offset/page via `criteria.pagesize` (+ a page-index param). **Keyset** on some
  endpoints (unidentified 🔬 — do not assume `pagesize` works on them).
- **Default page size:** not documented — always send `criteria.pagesize` explicitly 🔬.
- **Max page size:** **1000** (non-keyset endpoints).
- **Total count:** yes — `totalItems` in the response envelope.

| Parameter           | Type | Default  | Description                            |
| ------------------- | ---- | -------- | -------------------------------------- |
| `criteria.pagesize` | int  | unset 🔬 | Records per page (≤ 1000)              |
| `criteria.page`     | int  | unset 🔬 | Page index (param name unconfirmed) 🔬 |
| `criteria.Id`       | str  | —        | Return the single matching record      |

**Response structure (DOCUMENTED shape):**

```json
{
  "totalItems": 312,
  "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }]
}
```

**Last-page detection:** `(page * pagesize) >= totalItems`, or `items.length < pagesize`.

> ⚠️ Each page is one of your 300 daily calls. Use `pagesize=1000` to minimise pages; do not scan
> large resources casually.

---

## Rate Limits

| Scope                       | Limit  | Window |
| --------------------------- | ------ | ------ |
| All API calls (standard)    | 300    | / day  |
| Transactions API (standard) | 50     | / day  |
| All API calls (Premium)     | 60,000 | / day  |
| Transactions API (Premium)  | 20,000 | / day  |

- Limits are **per organisation**, on a **daily** window, raised via the "Premium API" add-on on
  the Subscription page. [DOCUMENTED]
- **Headers / exact 429 body:** not documented 🔬 — confirm whether the limit returns `429` (vs. a
  bespoke status) and whether `Retry-After` is sent.

**When exceeded:** assumed `429` 🔬. Because the budget is **daily, not per-second**, retrying
within the same day is futile.

**Recommended strategy:** **call frugality + caching**, not tight retry loops. One careless
paginated scan can exhaust the day's 300.

---

## Error Handling

**Standard error format:** **not published** — responses are JSON, but the error-body shape
(code / message / details) is `[UNKNOWN]`. Do **not** fabricate it; surface the raw body + status
and discover the real schema by triggering errors against a live tenant. 🔬

| Status  | Meaning            | Retryable    | Recovery                                                                    |
| ------- | ------------------ | ------------ | --------------------------------------------------------------------------- |
| 200     | OK (JSON body)     | —            | —                                                                           |
| 400     | Bad request        | No           | Fix params (`criteria.*`, body fields)                                      |
| 401     | Unauthorized       | Yes          | Token missing/expired/wrong header — **check `access-token`**, then refresh |
| 404     | Not found          | No           | Verify `{Slug}` and the resource id                                         |
| 429 (?) | Rate limit (daily) | Yes/next-day | Stop calling — won't reset until next day; suggest Premium 🔬               |
| 5xx     | Server error       | Yes          | Retry with exponential backoff (sparingly — budget)                         |

- Most common 401 cause: token sent in `Authorization` instead of the `access-token` header. [DOCUMENTED]

---

## Webhooks / Events

No webhook / WebSocket / SSE support found in the portal or KB. Change detection is
**polling-only**, and the daily cap makes polling **low-frequency** (Premium tenants excepted).
Poll list endpoints and diff on a date/modified field — which field reliably exposes "modified
since" is 🔬 DISCOVER.

---

## Known Limitations

1. **Daily rate budget is the dominant constraint** (300/day; 50/day Transactions) — no bulk or
   high-frequency use without the Premium add-on.
2. **Non-standard OAuth** — custom authorize params, `api/v2/Oauth2/...` token endpoints, and the
   `access-token` header break generic OAuth tooling (the registry config does not match reality 🚩).
3. **Field schemas + error body are inferred/unknown** 🔬 — the reference is a JS-rendered Swagger
   SPA; verify on a live tenant before trusting write bodies or parsing errors.
4. **Tenant isolation by `{Slug}`** — one token cannot read across organisations.
5. **No webhooks** — polling only, and polling must be sparse.
6. **No idempotency on Transaction writes** — retries risk duplicate invoices/entries and burn the
   tight daily budget.

---

## SDKs & Tooling

| SDK / tooling      | Notes                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Official SDKs      | None located — REST + raw HTTP only.                                                     |
| Postman collection | None located.                                                                            |
| OpenAPI (raw JSON) | Swagger **UI** exists (`/swagger/ui/index` v2, `/swagger/v4`); raw spec URL not found 🔬 |

**Postman collection:** Not available.
**OpenAPI spec:** Swagger UI only (JS-rendered); raw JSON URL not located 🔬.

---

## Integration Path Assessment

**Recommended path:** **Direct API (spec-driven, chat-only).**

**Justification:** Total Synergy exposes structured practice-management data (projects, contacts,
transactions/invoices, timesheets, staff), **not** browsable files/folders — so it is not a
Files-Remote connector. It is the **same product and integration shape as `totalsynergy-api`**;
only credential acquisition differs (OAuth here vs. static key there). It mirrors the
Actionstep / NetSuite / Zoho pattern: an OAuth2 connector whose specs live in `ext-api-doc/` and
are read by the workspace agent via the connector request path — **no `lib/oauth-providers/`
provider class** is needed. `surfaces: ['chat']`.

> ⚠️ **Caveat affecting "Direct API" viability:** the generic OAuth helper cannot drive this
> non-standard flow as-is. Either (a) add a small Total-Synergy-specific OAuth adapter, or (b) for
> OAuth-averse tenants, steer customers to the **`totalsynergy-api` static-key connector** (same
> API, simpler auth — a long-lived 1yr/3yr key copied from a user profile).

| Connector Method | API Endpoint                              | Feasibility                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------------- |
| list (chat)      | `GET …/Organisation/{Slug}/{Resource}`    | good                                              |
| get/read (chat)  | `GET …?criteria.Id={id}`                  | good                                              |
| create/update    | `POST …/Organisation/{Slug}/Transactions` | partial (fields 🔬; rate-limited; non-idempotent) |
| file browsing    | n/a                                       | none (not a file connector)                       |

---

_Researched on 2026-05-29 (documentation-based; live smoke test pending). Source: investigation
questionnaire (`00-api-investigation-questionnaire.md`) + official developer portal & KB. See
companion files `01a`–`01d` for entity, query, mutation, and event/error detail._
