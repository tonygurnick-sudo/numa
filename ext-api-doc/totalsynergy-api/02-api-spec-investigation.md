---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
base_url: https://api.totalsynergy.com/api/v2/
path_version_segment: /api/v2/ is a REAL path prefix in base_url (v4 surface also live). NOT a label.
spec_format: Swagger UI (JS-rendered SPA); raw OpenAPI JSON URL not located
spec_url: https://developers.totalsynergy.com/swagger/ui/index
docs_url: https://developers.totalsynergy.com/
date_researched: 2026-05-29
sibling: totalsynergy-oauth — identical wire API + same access-token header; only credential acquisition differs. Keep entity/endpoint/pagination/error sections consistent across both.
confidence: static-key auth model, rate limits, pagination, base URL are [DOCUMENTED]. Endpoint catalog + field schemas are [INFERRED] (JS-rendered Swagger SPA, NO live call made — no key/tenant at research time). 🔬 = needs a live tenant.
---

# Total Synergy (API Key) — API Specification & Investigation

Dev reference for the Total Synergy v2 REST API (static API-key variant). The **lower-friction** Total Synergy connector — one pasted static key copied from the user's Synergy profile, vs OAuth2 in `totalsynergy-oauth`.

## Overview

- **Vendor:** Total Synergy Pty Ltd — practice management for architecture & engineering firms.
- **API version:** v2 (primary documented surface). A v4 surface (`/swagger/v4`) is also live. The `/api/v2/` is a real path segment in the base URL.
- **Base URL:** `https://api.totalsynergy.com/api/v2/`
- **Test/beta:** `https://betaapi.totalsynergy.com/` (on request); UAT copy at `uat.totalsynergy.com` (weekly-refreshed production clone).
- **Power BI / public surface:** `https://publicapi.totalsynergy.com/`
- **Type:** REST. **Format:** JSON.
- **Docs:** https://developers.totalsynergy.com/
- **API reference:** Swagger UI https://developers.totalsynergy.com/swagger/ui/index — JS-rendered SPA; not scrapable without a live key + tenant 🔬
- **API FAQ (KB):** https://help.totalsynergy.com/en/articles/8696457-api-faq
- **OpenAPI spec:** Swagger UI confirmed; raw OpenAPI JSON URL not located 🔬
- **Status page:** not located.

**Summary:** REST API over an A&E firm's practice-management data — projects, contacts, staff, timesheets, timers, financial transactions (invoices). Used for reporting (e.g. Power BI), timesheet/invoice automation, project/contact lookups. The static API key is the vendor's documented path for **batch jobs, internal applications, and testing**.

## Authentication — static API key (long-lived "hard coded key")

A static, long-lived key, alternative to OAuth2. API FAQ: _"For customers wanting to build batch applications, internal applications or for testing before deployment, limited duration hard coded keys can be used for static integrations."_ The key IS the access token — sent verbatim on every call; no authorize redirect, no code exchange, no refresh token, no `Oauth2/*` machinery. Setup steps in `04-connection-and-reauth.md`.

**Header (every call):**

```
access-token: <apiKey>
Content-Type: application/json   ← POST only
```

> ⚠️ Credential header is **`access-token`** — NOT `Authorization: Bearer` and NOT `X-API-Key`. Either → 401. #1 mistake.

**Static-key properties** (scopes: none — access = the Synergy security/role level of the user who issued the key):
| Property | Value | Confidence |
| --- | --- | --- |
| Auth standard | Static API key ("hard coded key" for static integrations) | [DOCUMENTED] |
| Credential header | `access-token: <apiKey>` on every call — not `Authorization: Bearer` | [DOCUMENTED] |
| Key is the access token | "copy the complete API key and use it as an access token" | [DOCUMENTED] |
| How to obtain | Synergy → profile icon (top-right) → Profile settings → ellipsis (⋯) → API Key → copy | [DOCUMENTED] |
| Key options / lifetime | Two keys offered — a **1-year** and a **3-year** key. No refresh | [DOCUMENTED] |
| Refresh mechanism | **None.** On expiry (1/3-yr) the user generates a new key and re-pastes it | [DOCUMENTED] |
| Scopes | **None** — access governed by the issuing user's Synergy role | [DOCUMENTED] |
| Per-user vs per-tenant | Key is **personal** (from a user's profile); access = that user's permissions | [DOCUMENTED] |
| Key format / pattern | Opaque string (length/charset unconfirmed) | [UNKNOWN] 🔬 |
| Revocation | Regenerating the key invalidates the old one (exact behaviour unconfirmed) | [INFERRED] 🔬 |
| Rate limits per key | Counted per organisation, not per key (see Rate Limits) | [DOCUMENTED] |

> 🚩 **Registry `instance_url` does NOT match the API base (build-time concern).** The registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, id `totalsynergy-api`) collects `api_key` (password) + `instance_url` (url, placeholder `https://yourcompany.totalsynergy.com`). The `api_key` is correct — but the REST API is served from the **shared host** `https://api.totalsynergy.com/api/v2/`, NOT a per-tenant `*.totalsynergy.com` subdomain. Tenancy is the org **`{Slug}`** in the path (`…/Organisation/{Slug}/{Resource}`), not the hostname. Either reinterpret `instance_url` as the org slug, derive the slug from a "my organisation" lookup, or treat the field as informational and hard-code `api.totalsynergy.com`. **Reconcile before the connector makes a call.** See §3 of `03-connector-setup.md`.

## Endpoint catalog

Resources are **organisation-scoped**: `…/Organisation/{Slug}/{Resource}` (resolve `{Slug}` first via `Organisation` / `Organisation/MySlug` 🔬). Reads are paged with `criteria.pagesize`; envelope `{ "totalItems": <int>, "items": [ … ] }`. **No `Oauth2/*` token endpoints apply** — the static key is pasted directly. Data endpoints identical to `totalsynergy-oauth`.

| Method | Path                                            | Purpose                          | Paginated  | Idempotent | Confidence      |
| ------ | ----------------------------------------------- | -------------------------------- | ---------- | ---------- | --------------- |
| GET    | `Organisation` / `Organisation/MySlug`          | List orgs / resolve `{Slug}`     | Maybe      | Yes        | [DOCUMENTED] 🔬 |
| GET    | `Organisation/{Slug}/Projects`                  | List/search projects             | Yes        | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Projects?criteria.Id={id}` | Get one project                  | No         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Projects/{id}/Stages`      | Project stages                   | 🔬         | Yes        | [INFERRED] 🔬   |
| GET    | `Organisation/{Slug}/Projects/{id}/Tasks`       | Project tasks                    | 🔬         | Yes        | [INFERRED] 🔬   |
| GET    | `Organisation/{Slug}/Contacts`                  | List/search contacts             | Yes        | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Staff`                     | List staff                       | Yes        | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Timesheet/Week`            | Weekly timesheet read            | 🔬         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Timesheet/Leaderboard`     | Timesheet leaderboard            | 🔬         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Timers`                    | Running/stored timers            | 🔬         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Transactions`              | List transactions/invoices       | keyset? 🔬 | Yes        | [INFERRED] 🔬   |
| POST   | `Organisation/{Slug}/Transactions`              | Create timesheet entry / invoice | No         | **No**     | [DOCUMENTED]    |

> Transactions carries its **own tighter budget** (50/day standard, 20,000/day Premium). Invoices + timesheet entries are both written through it; the exact create path + request/response for invoices vs timesheet entries are 🔬 DISCOVER.
>
> **🔬 DISCOVER full catalog:** enumerate from `/swagger/ui/index` (v2) + `/swagger/v4` against a live static key — the SPA returns near-empty HTML to a scraper, so the table above is the documented/inferred subset, NOT the complete inventory.

## Data models

All field names/types are [INFERRED] from KB + UI naming. Synergy serialises strongly-typed values (e.g. dates) as **strings** in JSON; exact key names/casing unconfirmed 🔬. Full entity/relationship detail in `01a-domain-model-reference.md` (identical to `totalsynergy-oauth`).

### Project

| Field           | Type          | Required     | Writable | Description                            |
| --------------- | ------------- | ------------ | -------- | -------------------------------------- |
| `id`            | string/int    | —            | no       | Unique id; queryable via `criteria.Id` |
| `name`          | string        | yes (create) | yes      | Project/job name                       |
| `projectNumber` | string        | —            | maybe    | Human-facing job number                |
| `status`        | enum/string   | —            | yes      | e.g. Active / On Hold / Closed 🔬      |
| `clientId`      | string/int    | —            | yes      | FK → Contact (the client)              |
| `createdDate`   | string (ISO?) | —            | no       | Date serialised as a string            |

Relationships: `Organisation({Slug}) 1→N Project 1→N Stage 1→N Task`; `Project N→1 Contact` (client); `Staff 1→N Transactions` (timesheet entries / invoices reference `staffId`, `projectId`, `stageId`, `taskId`).

### Field format reference

| Format   | Pattern                             | Example         | Notes                                                 | Confidence    |
| -------- | ----------------------------------- | --------------- | ----------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)        | `"2026-05-29"`  | "dates are serialized and delivered in string format" | [DOCUMENTED]  |
| Int-date | `yyyymmdd` integer (some endpoints) | `20260529`      | `fromDateAsInt`/`toDateAsInt` on timesheet inputs     | [INFERRED] 🔬 |
| ID       | string or integer per resource      | `"12345"`       | Queryable via `criteria.Id`; exact type 🔬            | [INFERRED] 🔬 |
| Currency | decimal number                      | `1500.00`       | On Transactions/invoices                              | [INFERRED] 🔬 |
| Slug     | org identifier string in path       | `acme-eng`      | `…/Organisation/{Slug}/…`                             | [DOCUMENTED]  |
| API key  | opaque string (the access token)    | `<long string>` | Pasted into `api_key`; sent as `access-token` header  | [DOCUMENTED]  |

## Pagination

Offset/page via `criteria.pagesize` (+ a page-index param); **keyset** on some endpoints (unidentified 🔬 — don't assume `pagesize` works on them). No documented default page size — always send `criteria.pagesize` 🔬. Max **1000** (non-keyset). Total count via `totalItems`.

| Parameter           | Type | Default  | Description                            |
| ------------------- | ---- | -------- | -------------------------------------- |
| `criteria.pagesize` | int  | unset 🔬 | Records per page (≤ 1000)              |
| `criteria.page`     | int  | unset 🔬 | Page index (param name unconfirmed) 🔬 |
| `criteria.Id`       | str  | —        | Return the single matching record      |

Response (DOCUMENTED shape): `{"totalItems":312,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551"}]}`. Last page: `(page * pagesize) >= totalItems`, or `items.length < pagesize`. ⚠️ Each page = one of your 300 daily calls — use `pagesize=1000`; don't scan large resources casually.

## Rate limits

| Scope                       | Limit  | Window |
| --------------------------- | ------ | ------ |
| All API calls (standard)    | 300    | / day  |
| Transactions API (standard) | 50     | / day  |
| All API calls (Premium)     | 60,000 | / day  |
| Transactions API (Premium)  | 20,000 | / day  |

Per organisation, daily window, raised via the "Premium API" add-on on the Subscription page [DOCUMENTED]. **Budget is per-org, not per-key** — multiple keys for one org share one budget [DOCUMENTED]. Headers / exact 429 body not documented 🔬. **When exceeded:** assumed `429` 🔬; because the budget is daily not per-second, retrying within the same day is futile — strategy is **call frugality + caching**, not retry loops.

## Error handling

**Error-body shape NOT published** — responses are JSON but the shape (code/message/details) is [UNKNOWN]. Do NOT fabricate it; surface the raw body + status and discover the real schema by triggering errors on a live tenant 🔬.

| Status  | Meaning            | Retryable     | Recovery                                                              |
| ------- | ------------------ | ------------- | --------------------------------------------------------------------- |
| 200     | OK (JSON body)     | —             | —                                                                     |
| 400     | Bad request        | No            | Fix params (`criteria.*`, body fields)                                |
| 401     | Unauthorized       | **No\***      | Key missing / expired / revoked / wrong header — see below            |
| 404     | Not found          | No            | Verify `{Slug}` + resource id; confirm host is `api.totalsynergy.com` |
| 429 (?) | Rate limit (daily) | No (same day) | Stop calling — won't reset until next day; suggest Premium 🔬         |
| 5xx     | Server error       | Yes           | Exponential backoff, sparingly (budget)                               |

\*Unlike OAuth, a 401 here is NOT fixable by refreshing — there is no refresh flow. A 401 means the static key is missing, **expired** (past its 1/3-yr life), revoked, or sent under the wrong header (`Authorization: Bearer` / `X-API-Key` instead of `access-token`). Recovery = user regenerates a key in their Synergy profile + re-pastes it. Most common cause: wrong header or an expired key. [DOCUMENTED]

## Webhooks / events

None — no webhook/WebSocket/SSE found in portal or KB. Change detection is **polling-only**; the daily cap makes polling low-frequency. Poll list endpoints and diff on a date/modified field — which field reliably exposes "modified since" is 🔬 DISCOVER. (Detail in `01d`.)

## Known limitations

1. **Daily rate budget is the dominant constraint** (300/day; 50/day Transactions) — no bulk/high-frequency use without Premium; per-org, extra keys don't help.
2. **No token refresh** — an expired key (1/3-yr) needs manual regeneration + re-paste; there is no `Oauth2/*` exchange. (Trade-off for simpler auth: a longer-lived secret someone must rotate by hand.)
3. **Field schemas + error body are inferred/unknown** 🔬 — JS-rendered Swagger SPA; verify on a live tenant before trusting write bodies or parsing errors.
4. **Tenant isolation by `{Slug}`** — one key cannot read across organisations.
5. **No webhooks** — polling only, and polling must be sparse.
6. **No idempotency on Transaction writes** — retries risk duplicate invoices/entries + burn the daily budget.
7. **Registry `instance_url` doesn't match the real API base** 🚩 — always call `api.totalsynergy.com` with the org `{Slug}` in the path.

## SDKs & tooling

| SDK / tooling      | Notes                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| Official SDKs      | None located — REST + raw HTTP only                                                  |
| Postman collection | None located                                                                         |
| OpenAPI (raw JSON) | Swagger UI exists (`/swagger/ui/index` v2, `/swagger/v4`); raw spec URL not found 🔬 |

## Integration path assessment

**Recommended: Direct API (spec-driven, chat-only).** Total Synergy exposes structured practice-management data (projects, contacts, transactions/invoices, timesheets, staff), NOT browsable files/folders — so it is not a Files-Remote connector. Same product/shape as `totalsynergy-oauth` (only credential acquisition differs). Mirrors the Actionstep / NetSuite / Zoho pattern: specs live in `ext-api-doc/` and are read by the workspace agent via the connector request path — **no `lib/oauth-providers/` provider class** needed. `surfaces: ['chat']`.

> ✅ **Why this is the simpler of the two variants:** the static-key path sidesteps the non-standard OAuth flow that makes `totalsynergy-oauth` fragile (custom authorize params, `api/v2/Oauth2/GetAccessToken` token endpoint, refresh handling). Here the credential is one pasted string. The **only** non-standard framework requirements are the **`access-token` header** (not `Authorization: Bearer`) and the **`api.totalsynergy.com` host + org `{Slug}` path** (not the registry's `instance_url`). For OAuth-averse or batch/internal-tooling tenants, **steer customers to this connector.**

| Connector method | API endpoint                              | Feasibility                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------------- |
| list (chat)      | `GET …/Organisation/{Slug}/{Resource}`    | good                                              |
| get/read (chat)  | `GET …?criteria.Id={id}`                  | good                                              |
| create/update    | `POST …/Organisation/{Slug}/Transactions` | partial (fields 🔬; rate-limited; non-idempotent) |
| file browsing    | n/a                                       | none (not a file connector)                       |

Sources: investigation questionnaire + developer portal + KB. See companions `01a`–`01d`. Keep consistent with the sibling `totalsynergy-oauth` doc set — only the auth differs.
