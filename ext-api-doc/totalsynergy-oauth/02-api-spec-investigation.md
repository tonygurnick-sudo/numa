---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
base_url: https://api.totalsynergy.com/api/v2/
path_version_segment: /api/v2 (LITERAL, in base_url). v4 surface (/swagger/v4) also live; v2 is primary.
spec_format: Swagger UI (JS-rendered SPA); raw OpenAPI JSON URL not located
spec_url: https://developers.totalsynergy.com/swagger/ui/index
docs_url: https://developers.totalsynergy.com/
auth: custom header `access-token: <token>` (NOT Authorization: Bearer); OAuth2 authorization-code, vendor-custom
rate_limit: 300/day all calls, 50/day Transactions (Premium 60k/20k); per-org, daily
date_researched: 2026-05-29
confidence: documentation-based, NO live call made. Auth flow, rate limits, pagination, base URL are [DOCUMENTED]; endpoint catalog + field schemas are [INFERRED] (JS-rendered Swagger SPA). Items tagged 🔬 need a live tenant.
same_api_as: totalsynergy-api (identical base URL/resources/pagination/errors; only credential acquisition differs — OAuth2 authorization-code here vs long-lived static key copied from a user profile there. `access-token` header identical either way. Keep both doc sets consistent.)
---

# Total Synergy (OAuth) — API Spec & Investigation

Dev reference for the Total Synergy v2 REST API (OAuth2 credential variant).

## Overview

- **Vendor:** Total Synergy Pty Ltd — practice management for architecture & engineering firms.
- **API:** REST, JSON. v2 primary; v4 (`/swagger/v4`) also live.
- **Base URL:** `https://api.totalsynergy.com/api/v2/`
- **Other hosts:** test/beta `https://betaapi.totalsynergy.com/` (on request); UAT `uat.totalsynergy.com` (weekly-refreshed prod clone); Power BI / public `https://publicapi.totalsynergy.com/`.
- **Docs:** [developers.totalsynergy.com](https://developers.totalsynergy.com/) · API reference [Swagger UI](https://developers.totalsynergy.com/swagger/ui/index) (JS-rendered SPA, not scrapable without a live app key 🔬) · API FAQ https://help.totalsynergy.com/en/articles/8696457-api-faq
- **Raw OpenAPI JSON URL:** not located 🔬. **Status page:** not located.
- **Use cases:** reporting (Power BI), timesheet/invoice automation, project/contact lookups over projects, contacts, staff, timesheets, timers, financial transactions (invoices).

## Authentication — OAuth 2.0 (authorization-code, **vendor-custom**)

Authorization-code-style flow with **non-standard parameter names, a non-standard token endpoint path, and a non-standard credential header**. The single most important + most fragile part. Full setup in `04-connection-and-reauth.md`.

**Header on every API call:** `access-token: <token>` + `Content-Type: application/json`.

> ⚠️ NOT `Authorization: Bearer` — a `Bearer` header returns 401. The #1 mistake.

| Parameter              | Value                                                                          | Confidence    |
| ---------------------- | ------------------------------------------------------------------------------ | ------------- |
| Grant type             | `authorization_code`                                                           | [DOCUMENTED]  |
| Authorization URL      | `https://app.totalsynergy.com/OAuth2/Authorize`                                | [DOCUMENTED]  |
| Authorize params       | `ApplicationKey`, `RedirectUri`, `tenant` (+ optional `simple=true`)           | [DOCUMENTED]  |
| Token URL              | `https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken` (POST)             | [DOCUMENTED]  |
| Token body             | `applicationKey`, `ApplicationSecret`, `code`, `grant_type=authorization_code` | [DOCUMENTED]  |
| Refresh URL            | `https://api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken` (POST)         | [DOCUMENTED]  |
| Refresh body           | `applicationKey`, `ApplicationSecret`, `refreshToken`, `grant_type`            | [DOCUMENTED]  |
| Revocation URL         | not documented                                                                 | [UNKNOWN]     |
| Access token lifetime  | short-lived; TTL returned in token response, not published                     | [INFERRED] 🔬 |
| Refresh token lifetime | **~1 month** ("contains a refreshToken that lasts for 1 month")                | [DOCUMENTED]  |
| Refresh rotation       | whether `RefreshAccessToken` returns a NEW refresh token not stated            | [UNKNOWN] 🔬  |
| PKCE required          | No (server-side `ApplicationSecret` exchange instead)                          | [INFERRED]    |
| Credential header      | **`access-token: <token>`** every call — not `Authorization: Bearer`           | [DOCUMENTED]  |

**Scopes:** none — Total Synergy has **no OAuth scope system**; access is governed by the authenticating user's Synergy security/role level. No `oauthScopeDefinitions.ts` entry.

> 🚩 **Registry mismatch (build-time blocker — see `03-connector-setup.md`).** `connectorRegistry.ts` declares standard endpoints — `authUrl: app.totalsynergy.com/oauth2/authorize`, `tokenUrl: app.totalsynergy.com/oauth2/token`, `scopes: ''` — which DON'T match the real flow above (wrong host/path on token; standard `client_id`/`response_type` assumed but the API wants `ApplicationKey`/`tenant`; `Authorization: Bearer` assumed but the API wants `access-token`). The generic OAuth machinery will not authenticate unmodified.

## Endpoint Catalog

Resources are **org-scoped**: most paths are `Organisation/{Slug}/{Resource}`, where `{Slug}` is the org identifier (distinct from the `tenant` used at authorize time — resolve first via `Organisation` / `Organisation/MySlug` 🔬). Reads paged with `criteria.pagesize`; envelope `{ "totalItems": <int>, "items": [ … ] }`. Full entity/field detail in `01a-domain-model-reference.md`.

**Auth (token lifecycle — uses app secret, NOT `access-token`):**

| Method | Path                        | Purpose               | Auth       |
| ------ | --------------------------- | --------------------- | ---------- |
| POST   | `Oauth2/GetAccessToken`     | exchange code → token | app secret |
| POST   | `Oauth2/RefreshAccessToken` | refresh access token  | app secret |

**Resources:**

| Method | Path                                            | Purpose                          | Paginated  | Idempotent | Confidence      |
| ------ | ----------------------------------------------- | -------------------------------- | ---------- | ---------- | --------------- |
| GET    | `Organisation` / `Organisation/MySlug`          | list orgs / resolve `{Slug}`     | Maybe      | Yes        | [DOCUMENTED] 🔬 |
| GET    | `Organisation/{Slug}/Projects`                  | list/search projects             | Yes        | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Projects?criteria.Id={id}` | get one project                  | No         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Projects/{id}/Stages`      | project stages                   | 🔬         | Yes        | [INFERRED] 🔬   |
| GET    | `Organisation/{Slug}/Projects/{id}/Tasks`       | project tasks                    | 🔬         | Yes        | [INFERRED] 🔬   |
| GET    | `Organisation/{Slug}/Contacts`                  | list/search contacts             | Yes        | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Staff`                     | list staff                       | Yes        | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Timesheet/Week`            | weekly timesheet read            | 🔬         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Timesheet/Leaderboard`     | timesheet leaderboard            | 🔬         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Timers`                    | running/stored timers            | 🔬         | Yes        | [DOCUMENTED]    |
| GET    | `Organisation/{Slug}/Transactions`              | list transactions/invoices       | keyset? 🔬 | Yes        | [INFERRED] 🔬   |
| POST   | `Organisation/{Slug}/Transactions`              | create timesheet entry / invoice | No         | **No**     | [DOCUMENTED]    |

> Transactions carries its own much tighter budget (50/day std, 20k/day Premium). Invoices + timesheet entries both written through it; exact create path + request/response for invoice vs timesheet entry are 🔬 DISCOVER.
> **🔬 DISCOVER full inventory** from `/swagger/ui/index` (v2) + `/swagger/v4` against a live app key — the SPA returns near-empty HTML to a scraper, so the above is the documented/inferred subset, not the complete catalog.

## Data Models

> All field names/types are [INFERRED] from KB + product UI naming. Synergy serialises typed values (e.g. dates) as JSON **strings**; exact key names/casing unconfirmed 🔬 DISCOVER from a live spec dump. Full entity/relationship detail in `01a-domain-model-reference.md`.

**Project:**

| Field           | Type          | Required     | Writable | Description                         |
| --------------- | ------------- | ------------ | -------- | ----------------------------------- |
| `id`            | string/int    | —            | no       | project id; query via `criteria.Id` |
| `name`          | string        | yes (create) | yes      | project/job name                    |
| `projectNumber` | string        | —            | maybe    | human-facing job number             |
| `status`        | enum/string   | —            | yes      | Active / On Hold / Closed 🔬        |
| `clientId`      | string/int    | —            | yes      | FK → Contact (the client)           |
| `createdDate`   | string (ISO?) | —            | no       | date serialised as a string         |

**Relationships:** `Organisation ({Slug}) 1→N Project 1→N Stage 1→N Task`; `Project N→1 Contact` (client); `Staff 1→N Transactions` (timesheet entries/invoices reference `staffId`, `projectId`, `stageId`, `taskId`).

**Field formats:**

| Format   | Pattern                             | Example        | Notes                                             | Confidence    |
| -------- | ----------------------------------- | -------------- | ------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)        | `"2026-05-29"` | dates delivered as strings                        | [DOCUMENTED]  |
| Int-date | `yyyymmdd` integer (some endpoints) | `20260529`     | `fromDateAsInt`/`toDateAsInt` on timesheet inputs | [INFERRED] 🔬 |
| ID       | string or integer per resource      | `"12345"`      | query via `criteria.Id`; type per resource 🔬     | [INFERRED] 🔬 |
| Currency | decimal number                      | `1500.00`      | on Transactions/invoices                          | [INFERRED] 🔬 |
| Slug     | org identifier string in path       | `acme-eng`     | `Organisation/{Slug}/…`                           | [DOCUMENTED]  |

## Pagination

Offset/page via `criteria.pagesize` (+ page index). **Keyset** on some endpoints (unidentified 🔬 — don't assume `pagesize` works there). No documented default size — always send `criteria.pagesize` explicitly 🔬. Max **1000** (non-keyset). Total count via `totalItems`.

| Parameter           | Type | Description                                |
| ------------------- | ---- | ------------------------------------------ |
| `criteria.pagesize` | int  | records per page (≤1000); default unset 🔬 |
| `criteria.page`     | int  | page index; param name unconfirmed 🔬      |
| `criteria.Id`       | str  | return the single matching record          |

Envelope `{"totalItems":312,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551"}]}`. Last page: `(page * pagesize) >= totalItems`, or `items.length < pagesize`.

> ⚠️ Each page = one of 300 daily calls. Use `pagesize=1000`; don't scan large resources casually.

## Rate Limits

| Scope                       | Limit  | Window |
| --------------------------- | ------ | ------ |
| All API calls (standard)    | 300    | / day  |
| Transactions API (standard) | 50     | / day  |
| All API calls (Premium)     | 60,000 | / day  |
| Transactions API (Premium)  | 20,000 | / day  |

Per organisation, daily window, raised via the "Premium API" add-on on the Subscription page [DOCUMENTED]. Headers / exact 429 body not documented 🔬 — confirm whether the limit returns `429` (vs a bespoke status) and whether `Retry-After` is sent. Budget is **daily, not per-second** → mitigation is **call frugality + caching**, not retry loops; one careless paginated scan can exhaust the day's 300.

## Error Handling

Error-body shape **not published** — responses are JSON but code/message/details is [UNKNOWN] 🔬. Do **not** fabricate it; surface raw body + status and discover the real schema by triggering errors against a live tenant.

| Status  | Meaning            | Retryable | Recovery                                                                    |
| ------- | ------------------ | --------- | --------------------------------------------------------------------------- |
| 200     | OK (JSON body)     | —         | —                                                                           |
| 400     | Bad request        | No        | fix params (`criteria.*`, body fields)                                      |
| 401     | Unauthorized       | Yes       | token missing/expired/wrong header — **check `access-token`**, then refresh |
| 404     | Not found          | No        | verify `{Slug}` and the resource id                                         |
| 429 (?) | Rate limit (daily) | next-day  | STOP — won't reset until next day; suggest Premium 🔬                       |
| 5xx     | Server error       | Yes       | exponential backoff (sparingly — budget)                                    |

- Most common 401: token sent in `Authorization` instead of the `access-token` header [DOCUMENTED].

## Webhooks / Events

No webhook / WebSocket / SSE support found in portal or KB. Change detection is **polling-only**; the daily cap makes polling **low-frequency** (Premium excepted). Poll list endpoints and diff on a date/modified field — which field reliably exposes "modified since" is 🔬 DISCOVER. (Full detail in `01d`.)

## SDKs & Tooling

No official SDKs, no Postman collection located — REST + raw HTTP only. Swagger **UI** exists (`/swagger/ui/index` v2, `/swagger/v4`); raw OpenAPI JSON URL not found 🔬.

## Integration Path Assessment

**Recommended:** Direct API (spec-driven, chat-only). `surfaces: ['chat']`.

**Justification:** exposes structured practice-management data (projects, contacts, transactions/invoices, timesheets, staff), **not** browsable files/folders — so NOT a Files-Remote connector. Same product + integration shape as `totalsynergy-api`; only credential acquisition differs (OAuth here vs static key). Mirrors the Actionstep / NetSuite / Zoho pattern: an OAuth2 connector whose specs live in `ext-api-doc/`, read by the workspace agent via the connector request path — **no `lib/oauth-providers/` provider class** needed.

> ⚠️ **Caveat:** the generic OAuth helper cannot drive this non-standard flow as-is. Either (a) add a small Total-Synergy OAuth adapter, or (b) for OAuth-averse tenants, steer to the **`totalsynergy-api` static-key connector** (same API, simpler auth — a long-lived 1yr/3yr key copied from a user profile).

| Connector method | API endpoint                            | Feasibility                                       |
| ---------------- | --------------------------------------- | ------------------------------------------------- |
| list (chat)      | `GET Organisation/{Slug}/{Resource}`    | good                                              |
| get/read (chat)  | `GET …?criteria.Id={id}`                | good                                              |
| create/update    | `POST Organisation/{Slug}/Transactions` | partial (fields 🔬; rate-limited; non-idempotent) |
| file browsing    | n/a                                     | none (not a file connector)                       |

## Sources

Developer portal https://developers.totalsynergy.com/ · API FAQ https://help.totalsynergy.com/en/articles/8696457-api-faq · Swagger https://developers.totalsynergy.com/swagger/ui/index · App registration https://app.totalsynergy.com/Applications. Companions `01a`–`01d` for entity/query/mutation/event-error detail.
