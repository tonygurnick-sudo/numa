---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com
route_prefix_injected_by_connector: /api/partner
path_version_segment: none ("v1" is a label, never a path segment; /v1/... → 404)
auth: Bearer {token}
field_casing: camelCase
id_format: integer
call_surface: HTTP via `numa integrations request` (NOT a file-store connector)
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Fergus — Event & Error Handling

Event-driven capabilities (webhooks/polling), error formats, recovery playbooks. Paths are FLAT (`/jobs`); connector injects `/api/partner`.

## Event-Driven Capabilities

| Mechanism              | Supported | Notes                                                    |
| ---------------------- | --------- | -------------------------------------------------------- |
| Webhooks               | Uncertain | listed on API Tracker but NOT in OpenAPI spec [INFERRED] |
| WebSocket              | No        |                                                          |
| Server-Sent Events     | No        |                                                          |
| Long polling           | No        |                                                          |
| Change feeds / streams | No        |                                                          |

## Webhooks

API Tracker lists "Webhooks" + "Webhooks management API" as Fergus features [INFERRED], but NO webhook endpoints (registration, event catalog) appear in the OpenAPI spec at `api.fergus.com/docs/json`. Possible: separate API surface, Fergus web UI (Settings > Integrations), or private/partner API needing registration. Until confirmed: use polling; contact `integrations@fergus.com`; check https://info.fergus.com/developers.

## Polling Fallback (primary change detection)

- Jobs: `GET /jobs?sortField=lastModified&sortOrder=desc&pageSize=20` — detect via `lastModified` per job; store most-recent timestamp, compare each poll.
- Quotes (BEST — has `modifiedAfter`): `GET /jobs/quotes?modifiedAfter=2025-03-29T14:30:00Z` — returns only quotes modified since timestamp. `modifiedAfter` OVERRIDES `sortField`/`sortOrder`. Use `/jobs/quotes`, NOT `/quotes` (404).
- Invoices: `GET /customerInvoices?sortField=createdAt&sortOrder=desc&pageSize=20`.

Pattern: store `last_poll_timestamp` = now (UTC) → wait ≥60s → `GET /jobs/quotes?modifiedAfter={last_poll_timestamp}` → process → update timestamp → repeat.
Budget: 100 req/min per company; reserve ≥50% for user actions (polling ≤~50 req/min). 1 poll/resource/min across 5 resources = 5 req/min (safe); multiply by page count with pagination.
Tips: prefer `modifiedAfter` on `/jobs/quotes`; sort `/jobs` by `lastModified desc`; small `pageSize` (10) for polling; only poll resources of interest; keep high-water-mark timestamps per resource.

## Error Handling

Error response format VARIES by HTTP status code — not all use the same structure.

400 Bad Request / Validation: `{"error":"Bad Request","message":"Validation Failed: [<body>: must have required property 'defaultContact'].","statusCode":400}`. Invalid enum: `{"error":"Bad Request","message":"The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'","statusCode":400}`.
403 Forbidden (minimal — NO `error`/`statusCode`): `{"message":"Forbidden"}`.
404 Not Found (reveals internal `/api/partner/` prefix; client-facing paths drop it): `{"message":"Route GET:/api/partner/quotes?pageSize=3 not found","error":"Not Found","statusCode":404}`.
415 Unsupported Media Type: `{"error":"FastifyError","message":"Unsupported Media Type: ...","statusCode":415}`.
DELETE with Content-Type (no body): `{"error":"...","message":"Body cannot be empty when content-type is set to 'application/json'","statusCode":400}`. Fix: omit Content-Type on DELETE, or send empty body `{}`.

Error fields: `error` (string, MISSING on 403) · `message` (string, always present) · `statusCode` (number, MISSING on 403).

### Recovery Playbook

| Status | Code(s)                | Meaning                      | Retryable | Recovery                                                      | Max Retries |
| ------ | ---------------------- | ---------------------------- | --------- | ------------------------------------------------------------- | ----------- |
| 303    | Redirect               | resource already exists      | No        | follow `location` header to existing resource                 | 0           |
| 400    | Bad Request            | invalid request / validation | No        | fix request per `message`                                     | 0           |
| 401    | Unauthorized           | invalid/expired token        | Yes       | refresh OAuth token or check PAT validity                     | 1           |
| 403    | Forbidden              | insufficient permissions     | No        | check permissions; response is just `{"message":"Forbidden"}` | 0           |
| 404    | Not Found              | resource/endpoint missing    | No        | verify id; some endpoints are 404 (`/quotes`, `/stockOnHand`) | 0           |
| 409    | Conflict               | state conflict               | Maybe     | re-read, resolve, retry                                       | 1           |
| 415    | Unsupported Media Type | wrong Content-Type           | No        | fix headers; on DELETE omit Content-Type entirely             | 0           |
| 422    | Validation Failed      | field validation error       | No        | fix fields per `message`                                      | 0           |
| 429    | Too Many Requests      | rate limit exceeded          | Yes       | wait `retry-after` seconds                                    | 3           |
| 500    | Internal Server Error  | server error                 | Yes       | exponential backoff                                           | 3           |
| 502    | Bad Gateway            | upstream error               | Yes       | retry after 5s                                                | 3           |
| 503    | Service Unavailable    | service down                 | Yes       | retry after `retry-after` if present                          | 3           |

### 303 See Other (Customer/Site dedup)

Creating a customer/site that already exists returns: `{"result":"redirect","message":"Customer already exists","location":"/customers/9778208"}`. Follow `location` to GET the existing resource; do NOT retry the POST.

### Rate Limits

Per company: 100 requests / 1 minute, shared across all tokens and endpoints. Headers present on every response: `x-ratelimit-limit` (max/window, `100`), `x-ratelimit-remaining` (e.g. `87`), `x-ratelimit-reset` (seconds until reset, `60`), `retry-after` (seconds to wait, 429 only, `15`).
429 response: `{"error":"Too Many Requests","message":"Rate limit exceeded. Please retry after the specified time.","statusCode":429}` with headers `x-ratelimit-limit:100`, `x-ratelimit-remaining:0`, `x-ratelimit-reset:42`, `retry-after:42`.
Backoff: (1) honor `retry-after` if present — wait exactly that many seconds; (2) else exponential from 2s; (3) max 60s (one window); (4) add 0-1s jitter; (5) max 3 retries then surface error.
Proactive: monitor `x-ratelimit-remaining` per response. < 20 → reduce polling, batch logical ops (read before write), delay non-critical. < 5 → pause non-essential, allow only user-initiated critical ops, wait `x-ratelimit-reset` seconds before resuming.

## Counter-Exceptions

1. 303 on create is NOT an error: POST /customers and POST /sites return 303 (redirect to existing) on duplicate — normal flow. (Standard would be 201 or 409.) Follow `location`.
2. Calendar event UPDATE uses POST, returns 200: `POST /calendarEvents/{id}` with body (non-standard; standard is PUT/PATCH).
3. DELETE /calendarEvents requires a body: `{"deleteAllRecurring":false}` or `true`, even though DELETE typically has none.
4. DELETE must NOT include Content-Type header: `Content-Type: application/json` without body → 400 `"Body cannot be empty when content-type is set to 'application/json'"`.
5. 403 has minimal format: just `{"message":"Forbidden"}` — no `error`/`statusCode`.
6. 404 reveals internal `/api/partner/` prefix in the route; client-facing paths drop it.
7. Job status transient after creation: POST returns `"Draft"`, GET returns `"To Price"`.
8. `/jobs/{id}/finalise` is PUT, not POST: HATEOAS `"type":"POST"` is a server bug; spec defines `put` only; POST → 404. [VERIFIED 2026-05-19]

## Output Formatting (presenting responses to the user)

| Data Type      | Format                   | Example                                                               |
| -------------- | ------------------------ | --------------------------------------------------------------------- |
| Job            | summary line             | "J-0042: Kitchen renovation (Quote, To Price) - Smith Plumbing Ltd"   |
| Customer       | name + contact           | "Smith Plumbing Ltd - Jane Smith (jane@smith.co.nz, +64 9 555 1234)"  |
| Site           | name + address           | "Main Office - 123 Queen St, Auckland"                                |
| Quote          | title + status + amount  | "Initial Quote v1 - Published, due in 14 days"                        |
| Time Entry     | user + date + hours      | "Mike Johnson: 8.0hrs on 2025-03-28 - Pipe installation (J-0042)"     |
| Invoice        | number + amount + status | "INV-001: $2,875.00 (incl. GST) - Overdue, due 2025-03-15"            |
| Calendar Event | title + time + user      | "Site visit: Apr 1, 9:00-11:00 AM - Mike Johnson"                     |
| Note           | text + author + date     | "[Pinned] Customer confirmed schedule - by Mike (Mar 28)"             |
| Currency       | dollar format            | "$2,500.00" (format per company's country)                            |
| Date           | human-readable           | "March 28, 2025"                                                      |
| DateTime       | relative or absolute     | "2 hours ago" or "Mar 28, 2025 at 3:30 PM"                            |
| Errors         | clear message            | "Could not create job: jobType must be Quote, Estimate, or Charge Up" |

Truncation: lists show first 10, note total ("Showing 10 of 47 jobs"); long descriptions truncate at 200 chars with "..."; nested records 2 levels deep (Job > Quote sections, not line items); offer to fetch more when total exceeds displayed.
Job status indicators: `[Draft]` (transient, rarely seen), `[To Price]`, `[Active]`, `[On Hold]`, `[Completed]`, `[Archived]`, `[Quote Sent]`, `[Quote Rejected]`.
