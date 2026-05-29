---
api_name: 'Total Synergy (API Key)'
api_slug: 'totalsynergy-api'
base_url: 'https://api.totalsynergy.com/api/v2/'
version: 'v2 (primary); v4 surface also live'
spec_format: 'Swagger UI (JS-rendered SPA); raw OpenAPI JSON URL not located'
spec_url: 'https://developers.totalsynergy.com/swagger/ui/index'
docs_url: 'https://developers.totalsynergy.com/'
date_researched: '2026-05-29'
---

# Total Synergy (API Key) — API Specification & Investigation

> Clean developer reference for the Total Synergy v2 REST API (static API-key credential variant).
> **Documentation-based** — no live call was made (no static key / tenant at research time). The
> static-key auth model, rate limits, pagination, and base URL are `[DOCUMENTED]`; the endpoint
> catalog and field schemas are `[INFERRED]` because the reference is a JS-rendered Swagger SPA.
> Items tagged **🔬** require a live tenant to confirm.
>
> 📌 **Same API as `totalsynergy-oauth`.** Identical base URL, resources, pagination, error model,
> and — crucially — the **same `access-token` request header.** The **only** difference is how the
> credential is obtained: a **long-lived static API key copied from the user's Synergy profile**
> here, vs. the OAuth2 authorization-code flow there. Keep the entity / endpoint / pagination /
> error sections of the two doc sets consistent; if you change one, change both. This connector is
> the **lower-friction** Total Synergy variant — no redirect, no token exchange, no refresh.

---

## Overview

- **Vendor:** Total Synergy Pty Ltd — practice management for architecture & engineering firms.
- **API version:** v2 (primary documented surface). A v4 surface (`/swagger/v4`) is also live.
- **Base URL:** `https://api.totalsynergy.com/api/v2/`
- **Test/beta URL:** `https://betaapi.totalsynergy.com/` (on request); UAT copy at `uat.totalsynergy.com` (weekly-refreshed production clone).
- **Power BI / public surface:** `https://publicapi.totalsynergy.com/`
- **API type:** REST. **Data format:** JSON.
- **Documentation:** [developers.totalsynergy.com](https://developers.totalsynergy.com/)
- **API reference:** [Swagger UI](https://developers.totalsynergy.com/swagger/ui/index) — JS-rendered SPA; not scrapable without a live key + tenant 🔬
- **API FAQ (KB):** https://help.totalsynergy.com/en/articles/8696457-api-faq
- **OpenAPI spec:** Swagger **UI** confirmed; raw OpenAPI JSON URL not located 🔬
- **Status page:** Not located.

**Summary:** A REST API over an architecture/engineering firm's practice-management data —
projects, contacts, staff, timesheets, timers, and financial transactions (invoices). Used for
reporting (e.g. Power BI), timesheet/invoice automation, and project/contact lookups. The static
API key is the vendor's documented path for **batch jobs, internal applications, and testing**.

---

## Authentication

### Method: Static API key (long-lived "hard coded key")

Total Synergy supports a **static, long-lived API key** as an alternative to its OAuth2 flow. Per
the API FAQ: _"For customers wanting to build batch applications, internal applications or for
testing before deployment, limited duration hard coded keys can be used for static integrations."_
The user generates the key in their Synergy profile and pastes it into Numa; it is sent verbatim on
every call. There is **no authorize redirect, no code exchange, no refresh token, and no
`Oauth2/*` machinery** — the key **is** the access token. Full step-by-step setup is in
`04-connection-and-reauth.md`.

**Header format (every API call):**

```
access-token: <apiKey>
Content-Type: application/json
```

> ⚠️ The credential header is **`access-token`** — **NOT** `Authorization: Bearer`. A `Bearer`
> header (or `X-API-Key`) returns 401. This is the #1 mistake.

**Static-key properties:**

| Property                | Value                                                                                             | Confidence    |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| Auth standard           | Static API key ("hard coded key" for static integrations)                                         | [DOCUMENTED]  |
| Credential header       | **`access-token: <apiKey>`** on every call — not `Authorization: Bearer`                          | [DOCUMENTED]  |
| Key is the access token | "copy the complete API key and use it as an access token" — the key IS the bearer value           | [DOCUMENTED]  |
| How to obtain           | Synergy → profile icon (top-right) → **Profile settings** → ellipsis (⋯) → **API Key** → copy     | [DOCUMENTED]  |
| Key options / lifetime  | **Two keys offered — a 1-year key and a 3-year key.** No refresh.                                 | [DOCUMENTED]  |
| Refresh mechanism       | **None.** When the key expires (1/3-yr), the user generates a **new** key and re-pastes it        | [DOCUMENTED]  |
| Scopes                  | **None.** No scope system — access is governed by the issuing user's Synergy role                 | [DOCUMENTED]  |
| Per-user vs. per-tenant | Key is **personal** (issued from a user's profile); data access = that user's Synergy permissions | [DOCUMENTED]  |
| Key format / pattern    | Opaque string (exact length/charset unconfirmed)                                                  | [UNKNOWN] 🔬  |
| Revocation              | Regenerating the key in the profile invalidates the old one (exact behaviour unconfirmed)         | [INFERRED] 🔬 |
| Rate limits per key     | Counted **per organisation**, not per key (see Rate Limits)                                       | [DOCUMENTED]  |

**Required scopes:**

| Scope  | Purpose                                                                                                                      | Required for integration? |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| _none_ | Total Synergy has **no scope system.** Access is governed by the Synergy security/role level of the user who issued the key. | n/a                       |

> 🚩 **Registry `instance_url` does NOT match the API base (build-time concern).** The connector
> registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, id
> `totalsynergy-api`) collects `api_key` (password) + `instance_url` (url, placeholder
> `https://yourcompany.totalsynergy.com`). The `api_key` part is correct and simple — but the REST
> API is served from the **shared host** `https://api.totalsynergy.com/api/v2/`, **not** a
> per-tenant `*.totalsynergy.com` subdomain. Tenancy is the org **`{Slug}`** in the path
> (`…/Organisation/{Slug}/{Resource}`), not the hostname. Either reinterpret `instance_url` as the
> org slug, derive the slug from a "my organisation" lookup, or treat the field as informational and
> hard-code `api.totalsynergy.com`. **Reconcile before the connector makes a call.** See §3 of
> `03-connector-setup.md`.

---

## Endpoint Catalog

Resources are **organisation-scoped**: most paths are `…/Organisation/{Slug}/{Resource}`, where
`{Slug}` is the org identifier (resolve it first via `Organisation` / `Organisation/MySlug` 🔬).
Standard reads are paged with `criteria.pagesize`; the response envelope is
`{ "totalItems": <int>, "items": [ … ] }`. **No `Oauth2/*` token endpoints apply** to this
connector — the static key is pasted directly and sent on every call. The data endpoints are
identical to `totalsynergy-oauth`.

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
> `/swagger/v4` against a live static key — the SPA returns near-empty HTML to a scraper, so the
> tables above are the documented/inferred subset, **not** the complete catalog.

---

## Data Models

> All field names/types below are `[INFERRED]` from KB articles + product UI naming. Synergy
> serialises strongly-typed values (e.g. dates) as **strings** in JSON, but exact key names and
> casing are unconfirmed. 🔬 DISCOVER from a live spec dump. Full entity/relationship detail lives
> in `01a-domain-model-reference.md`. (Identical to `totalsynergy-oauth` — same product, same data
> model; only the credential differs.)

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

| Format   | Pattern                                    | Example         | Notes                                                          | Confidence    |
| -------- | ------------------------------------------ | --------------- | -------------------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)               | `"2026-05-29"`  | "dates are serialized and delivered in string format"          | [DOCUMENTED]  |
| Int-date | `yyyymmdd`-style integer on some endpoints | `20260529`      | `fromDateAsInt` / `toDateAsInt` seen on timesheet inputs       | [INFERRED] 🔬 |
| ID       | string or integer per resource             | `"12345"`       | Queryable via `criteria.Id`; exact type per resource 🔬        | [INFERRED] 🔬 |
| Currency | decimal number                             | `1500.00`       | On Transactions / invoices                                     | [INFERRED] 🔬 |
| Slug     | org identifier string in path              | `acme-eng`      | `…/Organisation/{Slug}/…`                                      | [DOCUMENTED]  |
| API key  | opaque string (the access token)           | `<long string>` | Pasted into the `api_key` field; sent as `access-token` header | [DOCUMENTED]  |

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
- **The budget is per-org, not per-key** — issuing multiple static keys for the same organisation
  does **not** increase the daily allowance; they all share one budget. [DOCUMENTED]
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

| Status  | Meaning            | Retryable    | Recovery                                                                                      |
| ------- | ------------------ | ------------ | --------------------------------------------------------------------------------------------- |
| 200     | OK (JSON body)     | —            | —                                                                                             |
| 400     | Bad request        | No           | Fix params (`criteria.*`, body fields)                                                        |
| 401     | Unauthorized       | **No\***     | Key missing / **expired** (past its 1/3-yr life) / revoked / sent in wrong header — see below |
| 404     | Not found          | No           | Verify `{Slug}` and the resource id                                                           |
| 429 (?) | Rate limit (daily) | Yes/next-day | Stop calling — won't reset until next day; suggest Premium 🔬                                 |
| 5xx     | Server error       | Yes          | Retry with exponential backoff (sparingly — budget)                                           |

\* **Unlike the OAuth variant, a 401 here is NOT fixable by refreshing — there is no refresh flow.**
A 401 means the static key is missing, **expired**, revoked, or sent under the wrong header
(`Authorization: Bearer` / `X-API-Key` instead of the required `access-token`). Recovery = the user
regenerates a key in their Synergy profile and re-pastes it into Numa. [DOCUMENTED / INFERRED]

- Most common 401 cause: key sent in `Authorization`/`X-API-Key` instead of the `access-token`
  header, or an **expired** static key. [DOCUMENTED]

---

## Webhooks / Events

No webhook / WebSocket / SSE support found in the portal or KB. Change detection is
**polling-only**, and the daily cap makes polling **low-frequency** (Premium tenants excepted).
Poll list endpoints and diff on a date/modified field — which field reliably exposes "modified
since" is 🔬 DISCOVER.

---

## Known Limitations

1. **Daily rate budget is the dominant constraint** (300/day; 50/day Transactions) — no bulk or
   high-frequency use without the Premium add-on. The budget is per-org; extra keys don't help.
2. **No token refresh** — an expired key (1/3-yr) needs **manual regeneration + re-paste** by the
   user. There is no `Oauth2/*` exchange. (This is the trade-off for the simpler auth: a longer-lived
   secret that someone must rotate by hand.)
3. **Field schemas + error body are inferred/unknown** 🔬 — the reference is a JS-rendered Swagger
   SPA; verify on a live tenant before trusting write bodies or parsing errors.
4. **Tenant isolation by `{Slug}`** — one key cannot read across organisations.
5. **No webhooks** — polling only, and polling must be sparse.
6. **No idempotency on Transaction writes** — retries risk duplicate invoices/entries and burn the
   tight daily budget.
7. **Registry `instance_url` doesn't match the real API base** 🚩 — always call
   `api.totalsynergy.com` with the org `{Slug}` in the path, not a per-tenant subdomain.

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
Files-Remote connector. It is the **same product and integration shape as `totalsynergy-oauth`**;
only credential acquisition differs (static key here vs. OAuth there). It mirrors the
Actionstep / NetSuite / Zoho pattern: a connector whose specs live in `ext-api-doc/` and are read by
the workspace agent via the connector request path — **no `lib/oauth-providers/` provider class** is
needed. `surfaces: ['chat']`.

> ✅ **Why this connector is the _simpler_ of the two Total Synergy variants:** the static-key path
> sidesteps the entire non-standard OAuth flow that makes `totalsynergy-oauth` fragile (custom
> authorize params, `api/v2/Oauth2/GetAccessToken` token endpoint, refresh handling). Here the
> credential is one pasted string. The **only** non-standard requirements the framework must honour
> are the **`access-token` header** (not `Authorization: Bearer`) and the **`api.totalsynergy.com`
> host + org `{Slug}` path** (not the registry's `instance_url`). For OAuth-averse or
> batch/internal-tooling tenants, **steer customers to this connector.**

| Connector Method | API Endpoint                              | Feasibility                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------------- |
| list (chat)      | `GET …/Organisation/{Slug}/{Resource}`    | good                                              |
| get/read (chat)  | `GET …?criteria.Id={id}`                  | good                                              |
| create/update    | `POST …/Organisation/{Slug}/Transactions` | partial (fields 🔬; rate-limited; non-idempotent) |
| file browsing    | n/a                                       | none (not a file connector)                       |

---

_Researched on 2026-05-29 (documentation-based; live smoke test pending). Source: investigation
questionnaire (`00-api-investigation-questionnaire.md`) + official developer portal & KB. See
companion files `01a`–`01d` for entity, query, mutation, and event/error detail. Keep consistent
with the sibling `totalsynergy-oauth` doc set — only the auth differs._
