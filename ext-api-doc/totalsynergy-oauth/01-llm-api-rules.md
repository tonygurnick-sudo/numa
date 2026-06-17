---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
base_url: https://api.totalsynergy.com/api/v2/
path_version_segment: /api/v2 (LITERAL — present in base_url, you supply it; v4 surface exists but v2 is primary)
route_prefix: none beyond base_url; resource paths are org-scoped → Organisation/{Slug}/{Resource}
auth: custom header `access-token: <token>` — NOT `Authorization: Bearer`
field_casing: mixed (criteria.* lowercase params; field keys [INFERRED] 🔬)
id_format: string-or-integer per resource (query via criteria.Id) 🔬
rate_limit: 300/day all calls; 50/day Transactions (Premium 60k/20k). PER-ORG, DAILY window — the binding constraint
call_surface: HTTP via `numa integrations request` (chat-only, spec-driven). NOT a file connector — no list-files/download-file. No MCP.
same_api_as: totalsynergy-api (identical base URL/resources/pagination/errors; only credential acquisition differs — OAuth here vs static key there)
confidence: auth flow + rate limits + pagination + base URL are [DOCUMENTED]; endpoint catalog + every field schema are [INFERRED] 🔬 (JS-rendered Swagger SPA, no live call made). Trust reads over writes. Items tagged 🔬 need a live tenant.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Total Synergy (OAuth) — API Rules

Practice management for architecture & engineering firms. Job/engagement = **Project**. Invoices + timesheet entries = **Transactions**.

## Paths (read first)

- Call via `numa integrations request`. Base: `https://api.totalsynergy.com/api/v2/`. The `/api/v2` segment is LITERAL — include it.
- Every resource path is org-scoped: `Organisation/{Slug}/{Resource}`. `{Slug}` is distinct from the `tenant` used at authorize time — **resolve it first** via `GET Organisation` or `Organisation/MySlug` 🔬.
- Single-record fetch = filtered list (`?criteria.Id={id}`), NOT `…/{Resource}/{id}`. Read `items[0]`.

## Auth

Header on every call: `access-token: <token>` + `Content-Type: application/json`.

- 🚩 `Authorization: Bearer` → 401. **#1 mistake.** No scopes (access = the user's Synergy role).
- Connector injects the token; you don't handle the OAuth flow (authorize/exchange/refresh).

## CAN

- Read/list/search **Projects**, **Contacts**, **Staff** (filter `criteria.Id`, page `criteria.pagesize`).
- Read timesheets (`Timesheet/Week`, `Timesheet/Leaderboard`) and **Timers**.
- Read **Transactions/invoices**; **create** timesheet entries / invoices via `POST Transactions` (sparingly).

## CANNOT

- High-frequency polling / bulk sync — the 300/day (50/day Transactions) cap kills it without Premium.
- Cross-organisation queries — one token = one org `{Slug}`.
- Blind retries of Transaction POSTs — no idempotency key → duplicate invoices/entries + budget burn.

## Gotchas

1. Token header is `access-token`, NOT `Authorization: Bearer` → else 401.
2. Every resource path needs `{Slug}`: `Organisation/{Slug}/{Resource}`. Resolve `{Slug}` first 🔬.
3. Transactions has its own far tighter budget (50/day standard). Confirm before each write, never loop.
4. Limits are DAILY, not per-second. Mitigate with call frugality + caching, not retry loops. One careless paginated scan burns the day's 300.
5. Field names are [INFERRED] 🔬 — don't trust write-body keys (`staffId`, `units`, `fromDateAsInt`) until confirmed on a live tenant. Reads safer than writes.
6. Single fetch = filtered list (`?criteria.Id=…`); read `items[0]`. Response is enveloped (`{totalItems, items[]}`), not a bare array.

## Registry mismatch (build-time, not your runtime concern) 🚩

The connector registry declares standard endpoints (`app.totalsynergy.com/oauth2/token`, `Authorization: Bearer`) that DON'T match this API. Until a Total Synergy OAuth adapter ships, auth may fail. If calls 401 at the proxy and the user is OAuth-blocked, suggest the **`totalsynergy-api` static-key connector** (same API, simpler auth).

## Defaults (override only if the user specifies)

`criteria.pagesize=200` for reads (max 1000 — stay under it, minimise call count). API version `v2`. Token header `access-token`.

## Operations

> Paths under `https://api.totalsynergy.com/api/v2/`. Confidence in parens.

| Operation                | Method | Path                                        | Key params / notes                        |
| ------------------------ | ------ | ------------------------------------------- | ----------------------------------------- |
| Resolve org slug         | GET    | `Organisation` / `Organisation/MySlug`      | Do FIRST; needed for every path 🔬        |
| List/search projects     | GET    | `Organisation/{Slug}/Projects`              | `criteria.Id`, `criteria.pagesize` (DOC)  |
| List/search contacts     | GET    | `Organisation/{Slug}/Contacts`              | same envelope (DOC)                       |
| List staff               | GET    | `Organisation/{Slug}/Staff`                 | resolve `staffId` for writes (DOC)        |
| Weekly timesheet         | GET    | `Organisation/{Slug}/Timesheet/Week`        | week-start, staff 🔬 (DOC path)           |
| Timesheet leaderboard    | GET    | `Organisation/{Slug}/Timesheet/Leaderboard` | aggregate 🔬 (DOC)                        |
| Timers                   | GET    | `Organisation/{Slug}/Timers`                | running/stored 🔬 (DOC)                   |
| List transactions        | GET    | `Organisation/{Slug}/Transactions`          | invoices live here; keyset? 🔬 (INFERRED) |
| Create timesheet/invoice | POST   | `Organisation/{Slug}/Transactions`          | body; 50/day; NOT idempotent (DOC)        |
| Project stages           | GET    | `Organisation/{Slug}/Projects/{id}/Stages`  | `stageId` source 🔬 (INFERRED)            |
| Project tasks            | GET    | `Organisation/{Slug}/Projects/{id}/Tasks`   | `taskId` source 🔬 (INFERRED)             |

> Full catalog needs Swagger enumeration (`/swagger/ui/index` v2, `/swagger/v4`) against a live app key. Above is the documented/inferred subset.

## Pagination

- Offset/page via `criteria.pagesize` (+ page index `criteria.page`, spelling unconfirmed 🔬). **Keyset** on some endpoints (unidentified 🔬 — `pagesize`/`page` may not work there).
- No documented default size — always send `criteria.pagesize` explicitly. Max **1000** (non-keyset).
- Envelope: `{ "totalItems": <int>, "items": [ … ] }`.
- Last page: `(page * pagesize) >= totalItems`, or `items.length < pagesize`.
- ⚠️ Each page = one of 300 daily calls. Use `pagesize=1000` to minimise pages; prefer targeted `criteria.Id` over full scans.

## Errors

Error-body shape is **NOT published** 🔬 — all responses JSON but code/message/details unknown. Do NOT fabricate it; surface raw body + status. Detect failure by HTTP status, not by parsing a guessed envelope.

| Status  | Meaning            | Action                                                                                  |
| ------- | ------------------ | --------------------------------------------------------------------------------------- |
| 400     | Bad request        | fix `criteria.*` params or body fields (likely wrong field name)                        |
| 401     | Unauthorized       | check `access-token` header (not `Authorization`); refresh token, retry once            |
| 404     | Not found          | verify `{Slug}` and resource id                                                         |
| 429 (?) | Rate limit (daily) | STOP — won't reset until next day; suggest Premium. Status/`Retry-After` unconfirmed 🔬 |
| 5xx     | Server error       | exponential backoff, sparingly (≤2–3, budget)                                           |

## Examples

1. List projects: `GET Organisation/acme-eng/Projects?criteria.pagesize=50` with `access-token: <token>`
   → `{"totalItems":312,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551"}]}`

2. One project by id: `GET Organisation/acme-eng/Projects?criteria.Id=10042`
   → `{"totalItems":1,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active"}]}`

3. Resolve slug (do first): `GET Organisation/MySlug`
   → `{"slug":"acme-eng","name":"Acme Engineering"}` — path/shape 🔬 (may be `GET Organisation` returning a list).

4. Create timesheet entry (write — Transactions, 50/day, NOT idempotent): `POST Organisation/acme-eng/Transactions`
   body `{"staffId":"88","projectId":"10042","stageId":"3","taskId":"17","fromDateAsInt":20260526,"toDateAsInt":20260526,"units":7.5}`
   → `{"timesheetId":"990123"}` — body fields + exact path [INFERRED] 🔬. Never blind-retry.
