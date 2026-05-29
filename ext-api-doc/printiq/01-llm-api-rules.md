---
api_name: 'PrintIQ'
api_slug: 'printiq'
version: 'IQConnect (version scheme unknown)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
update_source: 'web research only — NO live API access; partner-gated docs'
line_count_target: '< 300 lines'
---

# PrintIQ -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the PrintIQ integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.
>
> ⚠️ **CONFIDENCE: LOW. The IQConnect API reference is partner-gated and was never accessed.**
> The credential _model_ and the existence of `GetPrice` are the only things confirmed from
> public material. **Every endpoint path, field name, token-header name, error shape, and
> pagination detail below is `[INFERRED]` or `[UNKNOWN]`.** Do NOT present any inferred endpoint
> as fact to the user. Treat the first call against a real instance as a discovery exercise —
> read the actual response, then trust that over this document.

## Context

- **API:** PrintIQ "IQConnect" API (print MIS — estimating, quotes, orders/jobs, products, customers)
- **Base URL:** **Per-tenant** — each customer has their own instance. Inferred pattern `https://{instance}.printiq.com/api/` (custom domains also exist). **Exact API base path is `[UNKNOWN]`.**
- **Auth:** Credential exchange → bearer-style session token. Four credentials issued by printIQ support: `username`, `password`, `app_name`, `app_key`. [DOCUMENTED: credential model] [INFERRED: token mechanics]
- **Integration path:** Direct API via `connect_request` (action-oriented; this is NOT a Files browser). Mirrors the Fergus connector pattern.
- **Rate limits:** `[UNKNOWN]` — none published. Throttle conservatively + exponential backoff.

## ⚠️ BLOCKER: instance/base URL is not in the connector credentials

The connector's `credentialFields` collect ONLY `username`, `password`, `app_name`, `app_key`
(verified in `connectorRegistry.ts`). They do **NOT** include the per-tenant instance/base URL,
**without which the API has no host to target.** Before any call can succeed, the instance URL must
be supplied (connector setup field, metadata, or asked from the user). If you cannot determine the
instance host, STOP and ask the user for their printIQ instance URL — do not guess a hostname.

## Auth Structure

Credential-exchange authentication. POST the four credentials to a token endpoint on the instance,
receive a token, then send the token on subsequent calls.

```
[INFERRED — path, field names, and token header are ALL unverified]
POST https://{instance}.printiq.com/api/Site/Token
Content-Type: application/json

{ "username": "apiuser", "password": "••••", "app_name": "MyApp", "app_key": "••••" }
```

Subsequent calls (header name `[INFERRED]` — could be `Authorization: Bearer`, a custom header, or a query token):

```
[INFERRED]
Authorization: Bearer {token}
Content-Type: application/json
```

**Token lifecycle:**

- Lifetime `[UNKNOWN]`. Treat as short-lived; be ready to re-mint.
- No refresh-token grant is documented — re-POST the four credentials to mint a fresh token `[INFERRED]`.

## Capabilities

### CAN (once endpoints are confirmed against a live instance)

1. Get **real-time pricing** for a product + specification + quantity via `GetPrice` — the hero capability; pricing is authoritative in printIQ. [DOCUMENTED capability / INFERRED shape]
2. Look up quotes, orders/jobs, customers, and products by reference. [INFERRED]
3. Check a job's production / shipping status. [INFERRED]
4. Create / save quotes and customers (writes — confirm with the user first). [INFERRED]

### CANNOT

1. Do **anything** reliably until the instance URL + token mechanics + endpoint paths are confirmed against a real instance — everything here is inferred. [UNKNOWN]
2. Punch-Out / cXML procurement flows — a **separate XML surface**, not this connector. [DOCUMENTED out-of-scope]
3. Configure webhooks — printIQ webhooks are **provisioned by printIQ support per request**, not self-service via API. [DOCUMENTED]
4. Bulk operations / exports — none documented. [UNKNOWN]
5. Delete operations — not documented; do NOT assume they exist or are safe. [UNKNOWN]

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Per-tenant host is mandatory and not in the credentials.** There is no global base URL. If you don't have the instance URL, you cannot call anything — ask the user. [DOCUMENTED gap]
2. **`app_name` + `app_key` are part of AUTH, not per-request headers.** They are sent in the token exchange, not on every API call. Do not append them to data requests. [INFERRED]
3. **Pricing lives in printIQ — never compute prices yourself.** Always call `GetPrice`; printIQ is the source of truth and prices change. [DOCUMENTED]
4. **`GetPrice` needs a valid product code + its option/spec selections.** A bare product code without required options will fail or misprice. [INFERRED]
5. **Token header name is unverified.** If `Authorization: Bearer` gives 401 on a known-good token, try the custom-header / query-token variants and capture what works. [UNKNOWN]
6. **REST vs SOAP is unconfirmed.** Modern punch-out + Zapier publication imply JSON REST, but older surfaces may be SOAP/XML. If JSON 400s on a malformed-body error, check whether the endpoint expects XML. [INFERRED]
7. **Writes have real business impact** (a saved quote / created customer is visible to staff). Confirm with the user before any POST. [INFERRED]

## Default Parameters

Use these defaults unless the user specifies otherwise:

| Parameter          | Default                 | Reason                                                 |
| ------------------ | ----------------------- | ------------------------------------------------------ |
| price caching      | none (always live)      | printIQ is the pricing source of truth; prices change  |
| writes             | confirm-first           | Creating quotes/customers has business impact          |
| pagination size    | small (e.g. 20)         | Unknown limits — stay conservative until discovered    |
| retries on 5xx/429 | exponential backoff, ≤3 | No published limits; avoid hammering a tenant instance |

## Working Examples

> ⚠️ All examples below are `[INFERRED]` reconstructions, NOT captured live calls. Use them as a
> shape to validate against the real response, not as a guaranteed contract.

### Example 1: Exchange credentials for a token [INFERRED]

```http
POST /api/Site/Token HTTP/1.1
Host: {instance}.printiq.com
Content-Type: application/json

{ "username": "apiuser", "password": "••••", "app_name": "MyApp", "app_key": "••••" }
```

```json
{ "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }
```

### Example 2: Price a product (GetPrice) [DOCUMENTED it exists / INFERRED shape]

```http
POST /api/Quote/GetPrice HTTP/1.1
Host: {instance}.printiq.com
Authorization: Bearer {token}
Content-Type: application/json

{ "productCode": "BC-350GSM", "quantity": 500,
  "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
```

```json
{ "price": 250.0, "currency": "NZD", "leadTimeDays": 3, "breakdown": [] }
```

### Example 3: Look up a job/order status [INFERRED]

```http
GET /api/Job/{jobNo} HTTP/1.1
Host: {instance}.printiq.com
Authorization: Bearer {token}
```

```json
{
  "jobNo": "J-100234",
  "orderNo": "O-55012",
  "quoteNo": "Q-100234",
  "customerCode": "CUST001",
  "status": "In Production",
  "dueDate": "2026-06-04"
}
```

### Example 4: Get a customer by code [INFERRED]

```http
GET /api/Customer/{customerCode} HTTP/1.1
Host: {instance}.printiq.com
Authorization: Bearer {token}
```

```json
{
  "customerCode": "CUST001",
  "name": "Acme Signs Ltd",
  "accountStatus": "Active",
  "priceList": "Trade",
  "contacts": [],
  "addresses": []
}
```

## Proxy API Operations

> Quick reference. **All paths are `[INFERRED]`** — confirm each against the live instance / IQConnect doc pack.

| Operation       | Method | Path (INFERRED)      | Key Parameters                        | Notes                                  |
| --------------- | ------ | -------------------- | ------------------------------------- | -------------------------------------- |
| Token exchange  | POST   | /api/Site/Token      | username, password, app_name, app_key | Auth call; no token required           |
| Get price       | POST   | .../GetPrice         | productCode, quantity, options        | Hero capability [DOCUMENTED it exists] |
| Get quote       | GET    | /api/Quote/{quoteNo} | quoteNo                               | [INFERRED]                             |
| Create quote    | POST   | /api/Quote           | customerCode, lines[]                 | Write — confirm first [INFERRED]       |
| Get job/order   | GET    | /api/Job/{jobNo}     | jobNo                                 | Production/shipping status [INFERRED]  |
| Get customer    | GET    | /api/Customer/{code} | customerCode                          | [INFERRED]                             |
| Create customer | POST   | /api/Customer        | name, contacts[]                      | Write — confirm first [INFERRED]       |
| Get product     | GET    | /api/Product/{code}  | productCode                           | [INFERRED]                             |
| (Punch-Out)     | —      | cXML surface         | shared secret identities              | **Out of scope** [DOCUMENTED]          |

## Pagination

- **Type:** `[UNKNOWN]` — likely page-number or offset on list endpoints. [INFERRED]
- **Default / max page size:** `[UNKNOWN]`.
- **How to paginate:** Discover from a live list response — read the actual envelope, look for `page` / `pageSize` / `offset` / `total` / `next` fields, then follow whatever it returns.
- **Last page detection:** `[UNKNOWN]` — likely empty result array or absent `next`. [INFERRED]

## Webhooks / Events

PrintIQ webhooks exist but are **provisioned by printIQ support on request** — you provide a webhook
URL and printIQ's team configures the events. There is **no public self-service API** to register them.

| Event (from Infigo integration) | Trigger                        | Notes                            |
| ------------------------------- | ------------------------------ | -------------------------------- |
| Static PDF product sync         | Product change                 | Support-provisioned [DOCUMENTED] |
| Inventory Items product sync    | Inventory/stock product change | Support-provisioned [DOCUMENTED] |
| Shipped status update           | Job/order ships                | Support-provisioned [DOCUMENTED] |

**Full event catalog, payload shape, signature, and retry policy:** `[UNKNOWN]`.
**Polling fallback:** poll `GET /api/Job/{jobNo}` (or a job list with a modified-since filter, if one
exists) for status changes when webhooks aren't provisioned. See `01d`.

## Error Handling

**Standard error format:** `[UNKNOWN]` — not public. Likely an HTTP status + JSON body with a message/code:

```json
[INFERRED — UNVERIFIED]
{ "success": false, "message": "Invalid credentials", "errorCode": "..." }
```

**Recovery by status** (status semantics are generic-REST `[INFERRED]`, not confirmed for printIQ):

| Status | Meaning          | Action                                                   |
| ------ | ---------------- | -------------------------------------------------------- |
| 400    | Bad request      | Fix request body/params; check REST-vs-XML expectation   |
| 401    | Unauthorized     | Re-mint token (re-POST credentials); verify token header |
| 403    | Forbidden        | API user lacks permission for that resource — check role |
| 404    | Not found        | Verify reference AND the instance host/base path         |
| 409    | Conflict         | Re-read resource, resolve, retry                         |
| 422    | Validation error | Fix fields per message (format unknown)                  |
| 429    | Rate limited     | Backoff (limits unknown); honor Retry-After if present   |
| 5xx    | Server error     | Retry with exponential backoff (≤3)                      |

## Known Limitations

1. **Low confidence overall** — no public endpoint reference, OpenAPI spec, or SDK. All paths/fields inferred.
2. **Instance/base URL not captured by the connector** — must be supplied before any call works.
3. Token endpoint path, token header name, and token lifetime are unverified.
4. No rate-limit, pagination, error-format, or enum data is public.
5. Punch-Out (cXML) and webhook provisioning are out of band (support-driven, separate surface).
6. **Required next step:** obtain the IQConnect API doc pack + a test instance from printIQ support and run a discovery pass (token → GetPrice → reads → list → errors), then re-tag every `[INFERRED]` item.

---

_Generated from investigation questionnaire (web research only; partner-gated docs; no live call)._
_See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entity catalog, relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination examples_
- _01c-mutation-patterns.md — Create, update, delete patterns_
- _01d-event-and-error-handling.md — Events, webhooks, error recovery_
