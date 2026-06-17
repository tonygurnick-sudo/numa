---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
base_url: https://api.totalsynergy.com/api/v2/
path_version_segment: /api/v2/ is a REAL path prefix already in base_url (v4 surface also live). NOT a label — every path includes it.
tenancy: org {Slug} in the path → /api/v2/Organisation/{Slug}/{Resource}. NOT the hostname. Resolve {Slug} first.
auth: access-token: <apiKey> header — NOT Authorization: Bearer, NOT X-API-Key (either → 401)
field_casing: PascalCase params (criteria.Id), field casing [INFERRED]
id_format: string or integer per resource (unconfirmed which)
rate_limit: 300 calls/day total + 50/day Transactions (standard); 60k/20k Premium. Per organisation, daily window. Shared across all keys.
call_surface: HTTP via `numa integrations request` (Direct API, chat-only). NOT a file connector — no list-files/download-file. Not MCP.
sibling: totalsynergy-oauth — identical wire API + same access-token header; only credential acquisition differs (static key here vs OAuth there)
confidence: static-key flow, rate limits, pagination, base URL are [DOCUMENTED]. Endpoint catalog + ALL field schemas are [INFERRED] (JS-rendered Swagger SPA, NO live call made). 🔬 = must confirm on a live tenant.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Total Synergy (API Key) — API Rules

Practice management for architecture & engineering firms.

## Call surface (read first)

- HTTP only, via `numa integrations request`. This is NOT a file-browse connector — there is no `list-files`/`search-files`/`download-file`. Not MCP.
- Base `https://api.totalsynergy.com/api/v2/`. The `/api/v2/` IS a real path segment (NOT a "v1 label" — it's already in the base). A v4 surface (`/swagger/v4`) is also live; prefer v2 unless told otherwise.
- Resource path: `…/Organisation/{Slug}/{Resource}`. `{Slug}` is the org identifier in the PATH — tenancy is path-based, NOT the hostname. Resolve `{Slug}` first (see below).
- **Always call `api.totalsynergy.com`.** NEVER the registry `instance_url` (`https://yourcompany.totalsynergy.com`) — that placeholder is NOT the API base; hitting it → 404.

## Auth

Header on every call:

```
access-token: <apiKey>
Content-Type: application/json   ← POST only
```

- The key IS the access token (the connector injects it). **NOT `Authorization: Bearer`, NOT `X-API-Key`** — either → 401 (#1 mistake).
- Static, long-lived (user picks a 1-year or 3-year key in Synergy profile). **No refresh, no scopes.** A 401 is never fixed by refreshing — see Gotcha 5.

## Resolve {Slug} first (every data path needs it)

`GET Organisation` or `GET Organisation/MySlug` 🔬 → org slug. Cache it for the session; do not re-resolve per call (saves budget). Exact path + response shape 🔬 (may return a list of orgs).

## CAN

List/search **Projects**, **Contacts**, **Staff** (read; filter `criteria.Id`, page `criteria.pagesize`). Read **timesheets** (`Timesheet/Week`, `Timesheet/Leaderboard`) and **Timers**. Read **Transactions/invoices**. **Create** timesheet entries / invoices via the Transactions API (sparingly — see Gotcha 3).

## CANNOT

High-frequency polling or bulk sync (300/day cap; per-org, extra keys don't help). Cross-organisation queries (one key = one org's data, only what the issuing user can see). Blind-retry Transaction POSTs (no idempotency key → duplicate invoices/entries + burns budget). Bulk/batch writes (one record per POST). File upload/download (not a doc store). Project/Contact writes are "likely" per KB but have no confirmed path/body — treat as read-only until 🔬.

## Gotchas

1. **Token header is `access-token`, NOT `Authorization: Bearer`** (and NOT `X-API-Key`) → 401. #1 mistake.
2. **Call `api.totalsynergy.com`, never the registry `instance_url`.** Tenancy = org `{Slug}` in the path (`…/Organisation/{Slug}/{Resource}`), not the hostname. Wrong host → 404.
3. **Transactions has its own far tighter budget: 50/day standard.** Treat timesheet/invoice writes as scarce — confirm before each, never loop.
4. **Limits are DAILY, not per-second.** Mitigation = call frugality + caching, NOT retry loops. One careless paginated scan can exhaust the day's 300; a 429 won't reset until the next day.
5. **A 401 is NOT refreshable** — there is no refresh flow. It means the key is missing, **expired** (past its 1/3-yr life), revoked, or in the wrong header. Recovery: user regenerates a key in their Synergy profile and re-pastes it.
6. **ID filtering still returns the LIST envelope** (`{totalItems, items[]}`), not a bare object — read `items[0]`.
7. **No default page size** — always send `criteria.pagesize` explicitly (max 1000) 🔬.
8. **Keyset endpoints exist** (unidentified 🔬) and won't honour `pagesize` — if a list ignores `pagesize` or returns a cursor, follow the cursor.
9. **Field names + write bodies are `[INFERRED]` 🔬** (`staffId`, `units`, `fromDateAsInt`, …). Don't trust write keys until confirmed on a live tenant. Reads are safer than writes.
10. **Dates serialise as strings;** some endpoints use integer dates `yyyymmdd` (`fromDateAsInt`/`toDateAsInt`).

## Defaults (override only if the user specifies)

`criteria.pagesize=200` (read; up to 1000 to minimise pages), API version `v2`, host `api.totalsynergy.com`, header `access-token`.

## Operations

Paths are under `https://api.totalsynergy.com/api/v2/`. Confidence: (DOC)=documented, (INF)=inferred, 🔬=verify on live tenant.

| Operation                  | Method | Path                                        | Key params / notes                                               |
| -------------------------- | ------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Resolve org slug           | GET    | `Organisation` / `Organisation/MySlug`      | Do first; needed for every path. 🔬 exact shape                  |
| List/search projects       | GET    | `Organisation/{Slug}/Projects`              | `criteria.Id`, `criteria.pagesize`; `{totalItems,items[]}` (DOC) |
| List/search contacts       | GET    | `Organisation/{Slug}/Contacts`              | same envelope (DOC)                                              |
| List staff                 | GET    | `Organisation/{Slug}/Staff`                 | resolve `staffId` for writes (DOC)                               |
| Weekly timesheet           | GET    | `Organisation/{Slug}/Timesheet/Week`        | week-start, staff 🔬 (DOC path)                                  |
| Timesheet leaderboard      | GET    | `Organisation/{Slug}/Timesheet/Leaderboard` | aggregate metric 🔬 (DOC)                                        |
| Timers                     | GET    | `Organisation/{Slug}/Timers`                | running/stored 🔬 (DOC)                                          |
| List transactions/invoices | GET    | `Organisation/{Slug}/Transactions`          | keyset? 🔬 (INF)                                                 |
| Create timesheet/invoice   | POST   | `Organisation/{Slug}/Transactions`          | body; **50/day budget; NOT idempotent** (DOC)                    |
| Project stages             | GET    | `Organisation/{Slug}/Projects/{id}/Stages`  | referenced by `stageId` 🔬 (INF)                                 |
| Project tasks              | GET    | `Organisation/{Slug}/Projects/{id}/Tasks`   | referenced by `taskId` 🔬 (INF)                                  |

> 🔬 Full catalog needs Swagger enumeration (`/swagger/ui/index` v2, `/swagger/v4`) against a live key — this is the documented/inferred subset, not the complete inventory. **No `Oauth2/*` endpoints apply** — the key is pasted directly.

## Pagination

Offset/page via `criteria.pagesize` (+ page index). Envelope `{ "totalItems": <int>, "items": [ … ] }`.

- Max page size **1000**; no documented default → always send `criteria.pagesize` 🔬.
- Page index param: `criteria.page` (**name unconfirmed** 🔬).
- Last page: `(page * pagesize) >= totalItems`, or `items.length < pagesize`.
- **Keyset** on some (unidentified 🔬) endpoints — don't assume `pagesize` works everywhere.
- ⚠️ Each page = one of your 300 daily calls. Use `pagesize=1000` to minimise pages; don't scan large resources casually.

## Errors

**Error-body shape is NOT published** (`[UNKNOWN]` 🔬). Do NOT fabricate a `{code,message,details}` structure — surface the raw body + HTTP status. Recover by status:

| Status     | Meaning            | Action                                                                                                                                          |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 200        | OK (JSON body)     | —                                                                                                                                               |
| 400        | Bad request        | Fix params (`criteria.*`) or write-body fields                                                                                                  |
| 401        | Unauthorized       | Check `access-token` header (not `Authorization`/`X-API-Key`). **No refresh** — ask user to regenerate the key (Profile settings → ⋯ → API Key) |
| 404        | Not found          | Verify `{Slug}` and resource id; confirm host is `api.totalsynergy.com`, not `instance_url`                                                     |
| 429 (?) 🔬 | Rate limit (daily) | Stop calling — won't reset until next day; suggest Premium add-on. Retrying same-day is futile                                                  |
| 5xx        | Server error       | Exponential backoff, sparingly (each retry costs budget)                                                                                        |

## Examples

1. Resolve the org slug (do first):
   `GET /api/v2/Organisation/MySlug` (header `access-token: <apiKey>`) → `{"slug":"acme-eng","name":"Acme Engineering"}` 🔬 (may return a list)

2. List projects:
   `GET /api/v2/Organisation/acme-eng/Projects?criteria.pagesize=50` → `{"totalItems":312,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551"}]}`

3. Get one project by id (still returns list envelope — read `items[0]`):
   `GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042` → `{"totalItems":1,"items":[{"id":"10042","name":"Riverside Bridge Upgrade","status":"Active"}]}`

4. List staff (resolve `staffId` for writes):
   `GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=200` → `{"totalItems":24,"items":[{"id":"88","name":"Jordan Lee","email":"jordan@acme-eng.com"}]}`

5. Create a timesheet entry (write — Transactions API, 50/day, NOT idempotent, body `[INFERRED]` 🔬):
   `POST /api/v2/Organisation/acme-eng/Transactions` (+ `Content-Type: application/json`)
   body: `{"staffId":"88","projectId":"10042","stageId":"3","taskId":"17","fromDateAsInt":20260526,"toDateAsInt":20260526,"units":7.5}`
   → `{"timesheetId":"990123"}`. Never blind-retry — record the returned id.
