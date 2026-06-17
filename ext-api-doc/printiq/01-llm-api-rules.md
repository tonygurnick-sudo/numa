---
api_name: PrintIQ
api_slug: printiq
api_label: IQConnect (version scheme unknown — NOT a path segment)
base_url: per-tenant — https://{instance}.printiq.com (instance host supplied by user/config, NOT in credentials)
route_prefix: /api (inferred; e.g. /api/Quote/GetPrice)
path_version_segment: none (no /v1/; "v48/v49" is a product version, never a path)
auth: credential-exchange → session token (4 creds → token endpoint → token on calls); NOT OAuth2, NOT static PAT
token_header: '[UNKNOWN] — try Authorization: Bearer {token}, else custom header, else query token'
field_casing: '[UNKNOWN]'
id_format: '[INFERRED] human ref (e.g. Q-100234) + GUID pair'
rate_limit: '[UNKNOWN] — none published; throttle conservatively + exponential backoff'
call_surface: HTTP via `numa integrations request` (Direct API / connect_request, action-oriented). NOT a Files browser. NOT MCP.
confidence: LOW. Every path, field, token-header, error shape, enum, and pagination detail is [INFERRED] or [UNKNOWN] UNLESS tagged [DOCUMENTED]. Web research only 2026-05-29; no live call. Treat the first real call as discovery — trust the live response over this doc.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# PrintIQ — API Rules

Print MIS (estimating, quotes, orders/jobs, products, customers). Hero capability: real-time pricing via `GetPrice` — pricing lives in printIQ, fetched on demand. [DOCUMENTED]

## BLOCKER — instance host (read first)

No global base URL; printIQ is per-tenant. Connector `credentialFields` collect ONLY `username`, `password`, `app_name`, `app_key` (verified in `connectorRegistry.ts`) — NOT the instance URL. Without the host the API has no target. If the instance URL is unknown, STOP and ask the user — do NOT guess a hostname.

## Paths

- Inferred host+route: `https://{instance}.printiq.com/api/...` (e.g. `/api/Quote/GetPrice`). All paths `[INFERRED]` except `GetPrice` existence `[DOCUMENTED]`.
- NO version path segment. "v48/v49" = product version, never `/v1/`.
- Do NOT present any inferred path to the user as fact. On 404, re-check the host first (404 is ambiguous: wrong ref OR wrong instance host/base path).

## Auth

Credential exchange → session token. POST the 4 creds to a token endpoint on the instance, get a token, send it on subsequent calls.

```
[INFERRED — path, field names, token header ALL unverified]
POST https://{instance}.printiq.com/api/Site/Token   Content-Type: application/json
{ "username": "apiuser", "password": "••••", "app_name": "MyApp", "app_key": "••••" }
→ { "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }
```

Subsequent calls (header name `[UNKNOWN]`): `Authorization: Bearer {token}` + `Content-Type: application/json`.

- Token lifetime `[UNKNOWN]` — treat short-lived. No refresh grant; re-POST the 4 creds to re-mint `[INFERRED]`.
- `app_name`+`app_key` belong to the token exchange ONLY — never append them to data requests.

## CAN (once paths confirmed against a live instance)

1. `GetPrice` — real-time price for product + spec + quantity. Hero capability; printIQ pricing is authoritative. [DOCUMENTED exists / INFERRED shape]
2. Look up quotes, orders/jobs, customers, products by reference. [INFERRED]
3. Check a job's production/shipping status. [INFERRED]
4. Create/save quotes and customers (writes — confirm with user first). [INFERRED]

## CANNOT

1. Do anything reliably until instance URL + token mechanics + paths are confirmed live — everything is inferred. [UNKNOWN]
2. Punch-Out / cXML procurement — separate XML surface, not this connector. [DOCUMENTED out-of-scope]
3. Self-service webhooks — printIQ support provisions them per request, no API to register. [DOCUMENTED]
4. Bulk operations / exports — none documented. [UNKNOWN]
5. Delete — not documented; do NOT assume it exists/is safe. Prefer cancel/void over DELETE. [UNKNOWN]

## Gotchas

1. Per-tenant host mandatory and NOT in credentials — no host = no call. Ask the user. [DOCUMENTED gap]
2. `app_name`+`app_key` are AUTH (token exchange), not per-request headers. [INFERRED]
3. Never compute prices yourself — always `GetPrice`; printIQ is source of truth, prices change. [DOCUMENTED]
4. `GetPrice` needs a valid product code + its required option/spec selections; a bare code fails or misprices. [INFERRED]
5. Token header name unverified — if `Authorization: Bearer` 401s a known-good token, try custom-header / query-token variants. [UNKNOWN]
6. REST-vs-SOAP unconfirmed — modern punch-out + Zapier imply JSON REST, but older surfaces may be SOAP/XML. If JSON 400s on a malformed-body error, check whether the endpoint expects XML. [INFERRED]
7. Writes have real business impact (a saved quote / created customer is visible to staff). Confirm before any POST. [INFERRED]
8. Pricing is per-customer/per-`priceList` — same product prices differently by tier; don't reuse one customer's price for another. [INFERRED]
9. No idempotency keys — a repeated POST likely creates a duplicate. Read-before-write; guard creates. [INFERRED]
10. Quote→Order/Job conversion is ONE-WAY (irreversible, creates production work). [INFERRED]

## Defaults (override only if user specifies)

price caching=none (always live) · writes=confirm-first · pagination size=20 (conservative, limits unknown) · retries on 5xx/429=exponential backoff ≤3.

## Operations (all paths `[INFERRED]` — confirm live; only `GetPrice` existence is `[DOCUMENTED]`)

| Operation       | Method | Path                 | Key params / notes                                       |
| --------------- | ------ | -------------------- | -------------------------------------------------------- |
| Token exchange  | POST   | /api/Site/Token      | username, password, app_name, app_key; no token required |
| Get price       | POST   | .../GetPrice         | productCode, quantity, options; HERO [DOCUMENTED exists] |
| Get quote       | GET    | /api/Quote/{quoteNo} | —                                                        |
| Create quote    | POST   | /api/Quote           | customerCode, lines[]; write, confirm first              |
| Get job/order   | GET    | /api/Job/{jobNo}     | production/shipping status                               |
| Get customer    | GET    | /api/Customer/{code} | —                                                        |
| Create customer | POST   | /api/Customer        | name, contacts[]; write, confirm first                   |
| Get product     | GET    | /api/Product/{code}  | —                                                        |
| (Punch-Out)     | —      | cXML surface         | OUT OF SCOPE [DOCUMENTED]                                |

## Pagination

Type `[UNKNOWN]` — likely page-number or offset. Default/max size `[UNKNOWN]`. Discover from a live list envelope: fetch page 1, look for `page`/`pageSize`/`offset`/`total`/`next`, then follow it. Last page `[UNKNOWN]` — likely empty array or absent `next`. [INFERRED]

## Errors

Format `[UNKNOWN]` — not public. Anticipated (do NOT rely on field names): `{ "success": false, "message": "Invalid credentials", "errorCode": "..." }` `[INFERRED]`. On the first real error, capture the exact body shape and adapt parsing.
Recovery (status semantics generic-REST `[INFERRED]`, not printIQ-confirmed): 400 fix body/params + check REST-vs-XML · 401 re-mint token (re-POST 4 creds) + verify token header · 403 API user lacks permission, check role · 404 verify reference AND instance host/base path (ambiguous!) · 409 re-read then retry · 422 fix fields per message · 429 honor Retry-After else exponential backoff (limits unknown) · 5xx exponential backoff (≤3).

## Examples (all `[INFERRED]` reconstructions, NOT live calls — validate against the real response)

1. Exchange credentials for a token:
   `POST /api/Site/Token` `{ "username": "apiuser", "password": "••••", "app_name": "MyApp", "app_key": "••••" }`
   → `{ "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }`

2. Price a product (`POST /api/Quote/GetPrice`) [DOCUMENTED exists / INFERRED shape]:
   `{ "productCode": "BC-350GSM", "quantity": 500, "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }`
   → `{ "price": 250.0, "currency": "NZD", "leadTimeDays": 3, "breakdown": [] }`

3. Job/order status (`GET /api/Job/J-100234`):
   → `{ "jobNo": "J-100234", "orderNo": "O-55012", "quoteNo": "Q-100234", "customerCode": "CUST001", "status": "In Production", "dueDate": "2026-06-04" }`

4. Customer by code (`GET /api/Customer/CUST001`):
   → `{ "customerCode": "CUST001", "name": "Acme Signs Ltd", "accountStatus": "Active", "priceList": "Trade", "contacts": [], "addresses": [] }`

## Required next step (discovery)

Get the IQConnect doc pack + a test instance from printIQ support, then run: token → GetPrice → reads → list+pagination → errors → ask account manager for webhook events. Re-tag every `[INFERRED]` item afterward.
