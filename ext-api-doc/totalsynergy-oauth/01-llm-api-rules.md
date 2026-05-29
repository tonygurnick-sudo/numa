---
api_name: 'Total Synergy (OAuth)'
api_slug: 'totalsynergy-oauth'
version: 'v2 (primary); v4 surface also live'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Total Synergy (OAuth) — Workspace Agent API Rules

> **Loaded into the workspace agent's context when the Total Synergy (OAuth) integration is active.**
> Total Synergy is practice management for **architecture & engineering** firms.
> Companion files (01a–01d) hold the detailed reference.
>
> 📌 **Same API as `totalsynergy-api`.** Identical base URL, resources, pagination, and error
> model. The **only** difference is how the credential is obtained: OAuth2 here vs. a long-lived
> static key there. The `access-token` request header is identical either way.
>
> ⚠️ **Confidence:** auth flow, rate limits, pagination, and base URL are `[DOCUMENTED]`. The
> endpoint catalog and every field schema are `[INFERRED]` from KB articles + UI naming — the
> reference is a JS-rendered Swagger SPA that could not be enumerated. Items tagged **🔬** must be
> confirmed against a live tenant before you trust them. **No live call was made.**

## Context

- **API:** Total Synergy v2 (`https://api.totalsynergy.com/api/v2/`). A v4 surface also exists;
  v2 is the primary documented one — prefer **v2** unless told otherwise.
- **Base URL:** `https://api.totalsynergy.com/api/v2/`
- **Auth:** OAuth2 authorization-code, but **non-standard** — token sent in a custom `access-token`
  header, **not** `Authorization: Bearer`. No scopes.
- **Integration path:** Direct API, chat-only. No `lib/oauth-providers/` class; specs read by the agent.
- **Rate limits:** **300 calls/day** standard (50/day for Transactions). Premium add-on: 60k/day
  (20k/day Transactions). Per organisation, daily window. **Budget is the binding constraint.**

## Auth Structure

The connector layer holds the credential. You issue HTTP calls with the token in a **custom
header** — Total Synergy does **not** use `Authorization: Bearer`.

```
access-token: <accessToken>
Content-Type: application/json
```

**Token lifecycle:**

- Access token is short-lived (exact TTL unpublished 🔬). Refresh token lasts **~1 month** `[DOCUMENTED]`.
- Authorize: `app.totalsynergy.com/OAuth2/Authorize?ApplicationKey=…&RedirectUri=…&tenant=…`.
  Token exchange: **POST** `api.totalsynergy.com/api/v2/Oauth2/GetAccessToken`. Refresh:
  **POST** `…/Oauth2/RefreshAccessToken`. The connector handles all of this — you do not.

> 🚩 **Registry mismatch (build-time blocker, not a runtime concern for you).** The connector
> registry declares standard endpoints (`app.totalsynergy.com/oauth2/token`,
> `Authorization: Bearer`) that **do not match** this API. Until the connector ships a Total
> Synergy OAuth adapter, auth may not succeed. If calls fail with 401 at the proxy and the user
> is OAuth-blocked, suggest the **`totalsynergy-api` static-key connector** (same API, simpler auth).

## Capabilities

### CAN

1. List/search **Projects**, **Contacts**, **Staff** (read), filter by `criteria.Id` and page with `criteria.pagesize`.
2. Read timesheets (`Timesheet/Week`, `Timesheet/Leaderboard`) and **Timers**.
3. Read **Transactions/invoices**; **create** timesheet entries / invoices via the Transactions API (sparingly).

### CANNOT

1. **High-frequency polling or bulk sync** — the 300/day (50/day Transactions) standard cap kills it without Premium.
2. **Cross-organisation queries** — every path is scoped to one org `{Slug}`; one token = one org.
3. **Blind retries of Transaction POSTs** — no idempotency key; retries risk duplicate invoices/entries and burn the tight daily budget.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Token header is `access-token`, NOT `Authorization: Bearer`.** A `Bearer` header → 401. This is the #1 mistake.
2. **Every resource path needs the org `{Slug}`:** `…/Organisation/{Slug}/{Resource}`. The `{Slug}`
   is distinct from the `tenant` used at authorize time — resolve it first via `GET …/Organisation`
   or `…/Organisation/MySlug` 🔬.
3. **Transactions has its own, far tighter budget** (50/day standard). Treat timesheet/invoice
   writes as scarce — confirm before each, never loop.
4. **Daily — not per-second — limits.** Mitigation is **call frugality + caching**, not retry loops.
   One careless paginated scan can exhaust the day's 300.
5. **Field names are `[INFERRED]` 🔬.** Don't trust write-body keys (`staffId`, `units`,
   `fromDateAsInt`) until confirmed on a live tenant. Reads are safer than writes.

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter           | Default                | Reason                                              |
| ------------------- | ---------------------- | --------------------------------------------------- |
| `criteria.pagesize` | 200 (read), up to 1000 | Stay under the 1000 max while minimising call count |
| API version         | `v2`                   | Primary documented surface                          |
| Token header        | `access-token`         | Vendor-mandated; never `Authorization: Bearer`      |

## Working Examples

> Token shown in examples; the connector injects it. `{Slug}` = the org identifier (e.g. `acme-eng`).

### Example 1: List projects (read)

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.pagesize=50
Host: api.totalsynergy.com
access-token: <accessToken>
```

```json
{
  "totalItems": 312,
  "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }]
}
```

### Example 2: Get one project by id

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042
Host: api.totalsynergy.com
access-token: <accessToken>
```

```json
{ "totalItems": 1, "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade", "status": "Active" }] }
```

### Example 3: Resolve the org slug (do this first)

```http
GET /api/v2/Organisation/MySlug
Host: api.totalsynergy.com
access-token: <accessToken>
```

```json
{ "slug": "acme-eng", "name": "Acme Engineering" }
```

> Exact path + response shape 🔬 — may be `GET /api/v2/Organisation` returning a list of orgs.

### Example 4: Create a timesheet entry (write — Transactions API, rate-limited)

```http
POST /api/v2/Organisation/acme-eng/Transactions
Host: api.totalsynergy.com
access-token: <accessToken>
Content-Type: application/json

{ "staffId": "88", "projectId": "10042", "stageId": "3", "taskId": "17",
  "fromDateAsInt": 20260526, "toDateAsInt": 20260526, "units": 7.5 }
```

```json
{ "timesheetId": "990123" }
```

> Body fields + exact path are `[INFERRED]` 🔬. Counts against the **50/day** Transaction budget. **Not idempotent** — never blind-retry.

## Proxy API Operations

> Paths are under `https://api.totalsynergy.com/api/v2/`. Confidence in parentheses.

| Operation                | Method | Path                                        | Key Parameters                     | Notes                                     |
| ------------------------ | ------ | ------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| Resolve org slug         | GET    | `Organisation` / `Organisation/MySlug`      | —                                  | Do first; needed for every path 🔬        |
| List/search projects     | GET    | `Organisation/{Slug}/Projects`              | `criteria.Id`, `criteria.pagesize` | `totalItems` + `items[]` (DOC)            |
| List/search contacts     | GET    | `Organisation/{Slug}/Contacts`              | `criteria.Id`, `criteria.pagesize` | Same envelope (DOC)                       |
| List staff               | GET    | `Organisation/{Slug}/Staff`                 | `criteria.pagesize`                | Resolve `staffId` for writes (DOC)        |
| Weekly timesheet         | GET    | `Organisation/{Slug}/Timesheet/Week`        | week-start, staff 🔬               | Read timesheet (DOC path)                 |
| Timesheet leaderboard    | GET    | `Organisation/{Slug}/Timesheet/Leaderboard` | 🔬                                 | Aggregate metric (DOC)                    |
| Timers                   | GET    | `Organisation/{Slug}/Timers`                | 🔬                                 | Running/stored timers (DOC)               |
| List transactions        | GET    | `Organisation/{Slug}/Transactions`          | keyset? 🔬                         | Invoices live here (INFERRED)             |
| Create timesheet/invoice | POST   | `Organisation/{Slug}/Transactions`          | body                               | Rate-limited 50/day; not idempotent (DOC) |
| Project stages           | GET    | `Organisation/{Slug}/Projects/{id}/Stages`  | 🔬                                 | Referenced by `stageId` (INFERRED)        |
| Project tasks            | GET    | `Organisation/{Slug}/Projects/{id}/Tasks`   | 🔬                                 | Referenced by `taskId` (INFERRED)         |

> 🔬 Full catalog needs Swagger enumeration (`/swagger/ui/index` v2, `/swagger/v4`) against a live app key. This is the documented/inferred subset.

## Pagination

- **Type:** offset/page via `criteria.pagesize` (+ page index). **Keyset** on some endpoints (unidentified 🔬).
- **Default page size:** not documented — always send `criteria.pagesize` explicitly 🔬.
- **Max page size:** **1000** (non-keyset endpoints).
- **How to paginate:**

```http
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000              # page 1
GET /api/v2/Organisation/acme-eng/Contacts?criteria.pagesize=1000&criteria.page=2   # page 2 🔬 (param name unconfirmed)
```

- **Response envelope:** `{ "totalItems": <int>, "items": [ … ] }`.
- **Last-page detection:** `(page * pagesize) >= totalItems`, or `items.length < pagesize`.
- ⚠️ Each page is one of your 300 daily calls. Use `pagesize=1000` to minimise pages; don't scan huge resources casually.

## Webhooks / Events

No webhook / WebSocket / SSE support found. Change detection is **polling-only**, and the daily
cap makes polling **low-frequency** (Premium tenants excepted). Poll list endpoints and diff on a
date/modified field — which field reliably exposes "modified since" is 🔬 DISCOVER.

## Error Handling

**Standard error format:** **not published** — all responses are JSON but the error-body shape
(code/message/details) is `[UNKNOWN]`. Do **not** fabricate it; surface the raw body + status.

**Recovery by status:**

| Status  | Meaning            | Action                                                                         |
| ------- | ------------------ | ------------------------------------------------------------------------------ |
| 200     | OK (JSON body)     | —                                                                              |
| 400     | Bad request        | Fix params (`criteria.*`, body fields)                                         |
| 401     | Unauthorized       | Token missing/expired/in wrong header — **check `access-token`**, then refresh |
| 404     | Not found          | Verify `{Slug}` and the resource id                                            |
| 429 (?) | Rate limit (daily) | Stop calling — won't reset until next day; suggest Premium 🔬                  |
| 5xx     | Server error       | Retry with exponential backoff (sparingly — budget)                            |

- Most common 401 cause: token in `Authorization` instead of the `access-token` header.
- 429 status/headers/`Retry-After` are 🔬 unconfirmed. Because limits are **daily**, retrying within the same day is futile.

## Known Limitations

1. **Daily rate budget is the dominant constraint** (300/day; 50/day Transactions) — no bulk/high-frequency use without Premium.
2. **No webhooks** — polling only, and polling must be sparse.
3. **No idempotency on Transaction writes** — duplicate-risk + budget-burn; track created ids client-side.
4. **Field schemas + error body are inferred/unknown** 🔬 — verify on a live tenant before trusting writes or parsing errors.
5. **Registry OAuth config doesn't match the real flow** 🚩 — auth may need a custom adapter; static-key connector is the fallback.

---

_Generated from investigation questionnaire. See companion files:_

- _01a-domain-model-reference.md — entities, relationships, business rules_
- _01b-query-patterns.md — filtering, `criteria.*`, pagination_
- _01c-mutation-patterns.md — Transactions create (timesheets/invoices)_
- _01d-event-and-error-handling.md — no webhooks, errors, daily rate limits_
