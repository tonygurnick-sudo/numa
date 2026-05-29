---
api_name: 'PrintIQ'
api_slug: 'printiq'
base_url: '[UNKNOWN] per-tenant — inferred https://{instance}.printiq.com/api/'
version: 'IQConnect (version scheme unknown)'
spec_format: 'none' # no public OpenAPI / Swagger — partner-gated
spec_url: 'Not available (partner-gated)'
docs_url: 'https://printiq.com/iqconnect-api/'
date_researched: '2026-05-29'
date_live_tested: 'NEVER — no instance, no credentials, no public sandbox'
---

# PrintIQ -- API Specification & Investigation

> Clean developer reference for the PrintIQ "IQConnect" API. This document is the condensed
> output of the investigation questionnaire -- everything a developer needs to integrate
> with this API, in one place.
>
> ⚠️ **CONFIDENCE: LOW. This is a discovery plan, not a verified contract.**
> The IQConnect API reference is **partner-gated** — printIQ's support/integrations team hands it
> to integrators on request; it is not published. The **credential model** (instance URL + username
>
> - password + `app_name` + `app_key`), the existence of the **`GetPrice`** endpoint, the
>   **cXML Punch-Out** surface, and the **support-provisioned webhook** model are the only things
>   confirmed from public material. **Every endpoint path, field name, token-header name, error shape,
>   pagination detail, and rate limit below is `[INFERRED]` or `[UNKNOWN]`.** Do not treat any inferred
>   endpoint here as a real route. A discovery pass against a live instance (with credentials from
>   printIQ support) is required before any of this can be trusted.

---

## Overview

- **Vendor:** printIQ — cloud print MIS / estimating & workflow software (NZ-founded, AU/global) [DOCUMENTED]
- **API name:** IQConnect (printIQ's API surface) [DOCUMENTED]
- **API version:** Unknown. Product ships at v48/v49; the API versioning scheme is not public [UNKNOWN]
- **Base URL:** **Per-tenant** — each customer has their own printIQ instance. Inferred pattern
  `https://{instance}.printiq.com/api/` (custom domains also exist). **Exact API base path is `[UNKNOWN]`** [INFERRED]
- **Sandbox URL:** Not documented. printIQ may provision a test/staging instance per integrator [UNKNOWN]
- **API type:** REST/JSON over HTTPS is the most likely model (modern Punch-Out + Zapier publication
  imply JSON REST). Older surfaces may be SOAP/XML. **Treat as REST/JSON `[INFERRED]`** [INFERRED]
- **Data format:** JSON for the IQConnect REST API; **cXML** specifically for the Punch-Out (procurement)
  flow [INFERRED for JSON / DOCUMENTED that Punch-Out uses cXML]
- **Field casing:** `[UNKNOWN]` — not observable without a live response
- **ID format:** `[UNKNOWN]` — likely a human-readable reference (e.g. `Q-100234`) plus a GUID [INFERRED]
- **Documentation:** [https://printiq.com/iqconnect-api/](https://printiq.com/iqconnect-api/) — marketing
  overview only; the actual reference is partner-gated [DOCUMENTED]
- **API reference:** Not public. Provided by printIQ support/integrations to integrators on request.
  Likely ships as a PDF and/or Postman collection [DOCUMENTED that it is gated; content UNKNOWN]
- **OpenAPI spec:** Not available (none public) [UNKNOWN — probe `{instance}/api/swagger`, `{instance}/swagger.json` during discovery]
- **Status page:** None found [UNKNOWN]
- **Contact:** printIQ support / integrations team (via [printiq.com](https://printiq.com/) "Get Started" /
  contact). The integrator's printIQ account manager provisions credentials and webhooks.

**Summary:** printIQ is a print MIS (Management Information System) for commercial print businesses —
estimating, quoting, ordering, production/job tracking, products/stock, and customers. The IQConnect API
exposes those workflows so integrators can request real-time pricing, build quotes, push/receive orders,
track jobs through the Production Board, and sync products and customers. Its hero capability is
**on-demand estimating**: pricing lives in printIQ and is fetched via `GetPrice`.

**IQConnect modules (from the public marketing page):** [DOCUMENTED]

| Module        | Purpose                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **Integrate** | "Comprehensive API's" for CRM/EDM connections (HubSpot, Zoho); also published in Zapier         |
| **Link**      | Connects multiple printIQ instances together via APIs (inter-trade outsourcing)                 |
| **Punch-Out** | cXML procurement — delivers orders + artwork "directly into your Production Board"              |
| **SmartSite** | Self-contained ordering module with "built-in API calls" (SEO storefront / simplified ordering) |

> The IQConnect surface relevant to a Numa Direct-API connector is the **Integrate** REST API (pricing,
> quotes, orders/jobs, products, customers). **Punch-Out (cXML)** and **SmartSite** are separate surfaces
> and out of scope for this connector.

---

## Authentication

### Method: Credential exchange → bearer-style session token

> **The credential _model_ is well-confirmed; the _token-exchange endpoint_ is not.**

The integrator is issued **four credentials by printIQ support** plus the customer's **instance URL**:

| Credential | Field      | Type   | Issued by       | Notes                                                |
| ---------- | ---------- | ------ | --------------- | ---------------------------------------------------- |
| Username   | `username` | text   | printIQ support | API user inside the printIQ instance                 |
| Password   | `password` | secret | printIQ support | API user password                                    |
| App name   | `app_name` | text   | printIQ support | Identifies the calling application                   |
| App key    | `app_key`  | secret | printIQ support | Application key (reissued by support if rotated)     |
| Instance   | (host)     | url    | the customer    | **Not in the connector credentials** — see gap below |

These four credentials are POSTed to a **token endpoint on the instance** and exchanged for a session/access
token, which is then sent on subsequent calls. [DOCUMENTED — credential fields. INFERRED — token mechanics.]

**Token exchange (INFERRED — path, field names, and response shape are ALL unverified):**

```http
POST https://{instance}.printiq.com/api/Site/Token HTTP/1.1
Content-Type: application/json

{ "username": "apiuser", "password": "••••••••", "app_name": "MyApp", "app_key": "••••••••" }
```

**Expected response (INFERRED):**

```json
{ "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }
```

**Header on subsequent calls (INFERRED — header name unverified):**

```
Authorization: Bearer {token}
Content-Type:  application/json
```

| Property             | Value                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Grant style          | Custom credential exchange (NOT OAuth 2.0; no `client_id`/`client_secret`/redirect)       |
| Token endpoint       | `[INFERRED]` `POST /api/Site/Token` (also try `/api/Token`, `/api/Authenticate`)          |
| Token header         | `[UNKNOWN]` — `Authorization: Bearer`, a custom header, or a query token are all possible |
| Token lifetime       | `[UNKNOWN]` — treat as short-lived; be ready to re-mint                                   |
| Refresh mechanism    | `[INFERRED]` — no refresh-token grant documented; re-POST the four credentials to re-mint |
| Scopes / permissions | `[INFERRED]` — tied to the API user's role inside the printIQ instance, not API scopes    |
| Key rotation         | `[INFERRED]` — `app_key` reissued by printIQ support                                      |

> **⚠️ AUTH GOTCHA:** `app_name` + `app_key` are part of the **token exchange**, not per-request headers.
> They are sent once to mint a token — do NOT append them to data requests.

### ⚠️ BLOCKER: the per-tenant instance URL is NOT in the connector credentials

The connector's `credentialFields` collect **only** `username`, `password`, `app_name`, `app_key`
(verified in `connectorRegistry.ts`). They do **not** include the per-tenant instance/base URL — **without
which the API has no host to target.** printIQ is per-tenant; there is no global base URL. Before any call
can succeed, the instance URL must be supplied (a connector setup field, connector metadata, or asked from
the user at chat time). See `03-connector-setup.md` §"Known gap" for the resolution options. If the instance
host is unknown, STOP and ask the user — do not guess a hostname.

---

## Endpoint Catalog

> **⚠️ None of the paths below are verified.** `GetPrice` is the only endpoint whose _existence_ is
> documented; its path and payload are inferred. Treat this table as a discovery checklist.

### Token / Auth

| Method | Path (INFERRED)   | Purpose                            | Auth | Confidence                      |
| ------ | ----------------- | ---------------------------------- | ---- | ------------------------------- |
| POST   | `/api/Site/Token` | Exchange 4 credentials for a token | No   | INFERRED path; model DOCUMENTED |

### Pricing (hero capability)

| Method | Path (INFERRED) | Purpose                            | Auth | Idempotent    | Confidence                         |
| ------ | --------------- | ---------------------------------- | ---- | ------------- | ---------------------------------- |
| POST   | `.../GetPrice`  | Real-time price for product + spec | Yes  | Yes (compute) | DOCUMENTED exists / INFERRED shape |

### Quotes / Orders / Jobs / Products / Customers (all INFERRED from REST conventions)

| Method | Path (INFERRED)        | Purpose                        | Auth | Paginated | Idempotent | Confidence |
| ------ | ---------------------- | ------------------------------ | ---- | --------- | ---------- | ---------- |
| GET    | `/api/Quote/{quoteNo}` | Get a quote                    | Yes  | No        | Yes        | INFERRED   |
| POST   | `/api/Quote`           | Create/save a quote (cart)     | Yes  | No        | No         | INFERRED   |
| GET    | `/api/Job/{jobNo}`     | Get a job/order (prod. status) | Yes  | No        | Yes        | INFERRED   |
| GET    | `/api/Order/{orderNo}` | Get an order                   | Yes  | No        | Yes        | INFERRED   |
| GET    | `/api/Customer/{code}` | Get a customer                 | Yes  | No        | Yes        | INFERRED   |
| POST   | `/api/Customer`        | Create a customer              | Yes  | No        | No         | INFERRED   |
| GET    | `/api/Product/{code}`  | Get a product definition       | Yes  | No        | Yes        | INFERRED   |

### Non-REST surfaces (out of scope for this connector)

| Surface   | Mechanism                | Purpose                                    | Confidence |
| --------- | ------------------------ | ------------------------------------------ | ---------- |
| Punch-Out | cXML (request/callback)  | Receive order + artwork → Production Board | DOCUMENTED |
| SmartSite | Built-in storefront APIs | SEO/simplified self-ordering widget        | DOCUMENTED |
| Link      | Instance-to-instance API | Inter-trade outsourcing                    | DOCUMENTED |

---

## Data Models

> Entity **existence** is `[DOCUMENTED]` from product/marketing material. **All field lists are
> `[INFERRED]` placeholders** pending live discovery — the real schema may use entirely different field
> names (`quoteNo` vs `QuoteReference` vs `id`).

### Quote [INFERRED fields]

| Field          | Type   | Required | Writable | Description                             | Example            |
| -------------- | ------ | -------- | -------- | --------------------------------------- | ------------------ |
| `quoteNo`      | string | yes      | no       | Human-readable quote number             | `"Q-100234"`       |
| `quoteGuid`    | string | yes      | no       | System unique id                        | `"a1b2c3..."`      |
| `customerCode` | string | yes      | yes      | Owning customer reference               | `"CUST001"`        |
| `status`       | string | yes      | no       | Quote lifecycle state                   | `"Draft"`          |
| `lines`        | array  | yes      | yes      | Quote line items (product + spec + qty) | `[...]`            |
| `total`        | number | yes      | no       | Computed price total                    | `1250.00`          |
| `currency`     | string | yes      | no       | From instance settings                  | `"NZD"`            |
| `createdDate`  | string | yes      | no       | ISO 8601 timestamp                      | `"2026-05-29T..."` |

### Order / Job [INFERRED fields]

`jobNo`, `orderNo`, `quoteNo` (source), `customerCode`, `status` (production state), `dueDate`,
`shippedDate`, `lines`, `artworkRefs`. A confirmed order becomes one or more production **jobs** tracked on
printIQ's Production Board (barcoded job bags, scheduling, production methods). [DOCUMENTED at domain level]

### Product [INFERRED fields]

A configurable print product definition (the thing you get a price for) — drives `GetPrice`. printIQ also
distinguishes **Inventory Items** (stocked products) from configurable products; the Infigo integration
treats them as separate sync streams ("static PDF product sync" vs "Inventory Items product sync").
[DOCUMENTED that both product types exist]. Fields: `productCode`, `name`, `options[]`/`spec`, `inventory?`.

### Customer [INFERRED fields]

`customerCode`, `name`, `contacts[]`, `addresses[]`, `priceList`/`pricingTier`, `accountStatus`. printIQ
syncs customers + pipeline updates to HubSpot/Zoho/Salesforce. [DOCUMENTED that CRM sync exists]

### Price (GetPrice result) [INFERRED fields]

`price` (number), `currency`, `breakdown[]`, `leadTimeDays`. Real-time pricing for a product + spec + qty.
This is the single most-cited IQConnect endpoint — Infigo "requests pricing solely from printIQ via the
GetPrice API". [DOCUMENTED that GetPrice is the pricing source of truth]

**Relationships (INFERRED domain model, not API schema):**

```
Customer ──1:N──> Quote ──convert──> Order ──1:N──> Job (Production Board)
                    │ references                         │
                    ▼                                     ▼
                 Product  (GetPrice prices a Product)   Artwork / Job Bag
```

---

## Pagination

- **Type:** `[UNKNOWN]` — likely page-number or offset on list endpoints [INFERRED]
- **Default page size:** `[UNKNOWN]`
- **Max page size:** `[UNKNOWN]`
- **Total count:** `[UNKNOWN]`

**How to discover:** hit a live list endpoint and read the actual envelope — look for
`page`/`pageSize`/`offset`/`total`/`next` fields, then follow whatever it returns.

**Last page detection:** `[UNKNOWN]` — likely an empty result array or an absent `next` link [INFERRED]

---

## Rate Limits

| Scope  | Limit     | Window |
| ------ | --------- | ------ |
| Global | [UNKNOWN] | —      |

- **Headers:** `[UNKNOWN]` — no published limit headers
- **When exceeded:** `[UNKNOWN]` — assume `429`; honour `Retry-After` if present
- **Recommended strategy:** conservative client-side throttling + exponential backoff (start 2s, ≤3 retries,
  cap ~60s). It is a single tenant instance — do not hammer it. [INFERRED]

---

## Error Handling

**Standard error format:** `[UNKNOWN]` — not public. Likely an HTTP status + a JSON body with a message/code,
but the shape is unverified:

```json
[INFERRED — UNVERIFIED]
{ "success": false, "message": "Invalid credentials", "errorCode": "..." }
```

**Status codes** (semantics are generic-REST `[INFERRED]`, NOT confirmed for printIQ):

| Status | Meaning          | Retryable | Recovery                                                  |
| ------ | ---------------- | --------- | --------------------------------------------------------- |
| 400    | Bad request      | No        | Fix request body/params; check REST-vs-XML expectation    |
| 401    | Unauthorized     | Yes       | Re-mint token (re-POST credentials); verify token header  |
| 403    | Forbidden        | No        | API user lacks permission for the resource — check role   |
| 404    | Not found        | No        | Verify reference AND the instance host/base path          |
| 409    | Conflict         | Maybe     | Re-read resource, resolve, retry                          |
| 422    | Validation error | No        | Fix fields per message (format unknown)                   |
| 429    | Rate limited     | Yes       | Backoff (limits unknown); honour `Retry-After` if present |
| 5xx    | Server error     | Yes       | Retry with exponential backoff (≤3)                       |

---

## Webhooks / Events

PrintIQ webhooks **exist** but are **provisioned by printIQ support on request** — the consumer supplies a
Webhook URL and printIQ's team configures the events. There is **no public self-service API/UI** to register
them. [DOCUMENTED]

**Confirmed from the Infigo integration** (three webhooks): [DOCUMENTED]

| Event                        | Trigger                        | Payload Summary                        |
| ---------------------------- | ------------------------------ | -------------------------------------- |
| Static PDF product sync      | Product change                 | Pushes product changes to the consumer |
| Inventory Items product sync | Inventory/stock product change | Pushes stocked-product changes         |
| Shipped status update        | Job/order ships                | Notifies the consumer to mark shipped  |

- **Registration:** support request (not API/UI self-service) [DOCUMENTED]
- **Full event catalog / payload shape / signature / retry policy:** `[UNKNOWN]`

**Polling fallback:** poll `GET /api/Job/{jobNo}` (or a job list with a "modified-since" filter, if one
exists) for status changes when webhooks aren't provisioned. Filter availability is `[UNKNOWN]`.

---

## Known Limitations

1. **Low confidence overall** — no public endpoint reference, OpenAPI spec, or SDK. All paths/fields inferred.
2. **Per-tenant instance/base URL is NOT captured by the connector** — must be supplied before any call works.
3. Token endpoint path, token header name, and token lifetime are unverified.
4. No public rate-limit, pagination, error-format, or enum data.
5. **Punch-Out (cXML)** and **SmartSite** are separate surfaces — not the Integrate REST API and not this connector.
6. **Webhook provisioning is support-driven**, not API-driven — the agent cannot create/manage webhooks.
7. Bulk operations / exports — none documented.
8. Delete operations — not documented; do not assume they exist or are safe.
9. REST-vs-SOAP is unconfirmed for older surfaces — if JSON 400s on a malformed-body error, check whether the endpoint expects XML.

---

## SDKs & Tooling

| SDK | Language | Repository | Quality | Notes               |
| --- | -------- | ---------- | ------- | ------------------- |
| —   | —        | —          | —       | No public SDK found |

**Postman collection:** Not public; printIQ reportedly ships one to integrators on request [INFERRED]
**OpenAPI spec:** Not available (partner-gated)
**Indirect catalogs:** the **Zapier** "printIQ" app (if listed) and the **Infigo Academy** printIQ/Punchout
courses + "Connect: printIQ" Zendesk article are the richest public-ish technical sources (gated/403 to
automated fetch but readable in a browser). [DOCUMENTED]

---

## Integration Path Assessment

**Recommended path:** **Direct API via `connect_request`** (action-oriented; NOT a Files browser).

**Justification:** printIQ exposes transactional print-MIS workflows — real-time pricing (`GetPrice`),
quotes, orders/jobs, products, customers — not browsable files or documents. This is **not** a
Drive/Gmail-style file connector, so it does **not** belong in Files > Remote. The workspace agent calls the
connector's stored printIQ credentials through the connector's `connect_request` proxy to hit the IQConnect
REST endpoints (price a job, fetch a quote, check a job's production/shipping status, look up a customer).
This mirrors the **Fergus** connector pattern — except printIQ is more strongly action-oriented (its hero
capability is on-demand estimating) and is **per-tenant**, so the integration must also capture the
instance/base URL (see the blocker above).

**Connector method mapping** (file-browser methods do NOT apply — this is Direct API):

| Agent Action            | API Endpoint (INFERRED)    | Feasibility                           |
| ----------------------- | -------------------------- | ------------------------------------- |
| `get_price`             | `POST .../GetPrice`        | Good (hero capability) once confirmed |
| `get_quote`             | `GET /api/Quote/{no}`      | Inferred — verify path                |
| `create_quote`          | `POST /api/Quote`          | Inferred — write, confirm-first       |
| `get_job` / `get_order` | `GET /api/Job/{no}`        | Inferred — production/shipping status |
| `get_customer`          | `GET /api/Customer/{code}` | Inferred — verify path                |
| `create_customer`       | `POST /api/Customer`       | Inferred — write, confirm-first       |

---

## Required Next Step (Discovery Playbook)

When a client provides credentials + instance URL, run these in order and re-tag every `[INFERRED]` item:

1. **Confirm host & API base:** `GET https://{instance}.printiq.com/`, then probe `/api`, `/api/swagger`, `/swagger.json`, `/api/v1`.
2. **Token exchange:** POST the four credentials to candidate paths (`/api/Site/Token`, `/api/Token`, `/api/Authenticate`); capture the exact field names, response shape, token header, and expiry.
3. **GetPrice:** the documented hero endpoint — find its exact path and required product/spec payload; it validates the whole auth + product model.
4. **Reads:** quote, job/order, customer, product by reference — capture real field names (replace all INFERRED schemas).
5. **List + pagination:** hit a list endpoint to learn pagination + filter syntax.
6. **Errors:** trigger 401 (bad token), 404 (bad reference), and a validation error to capture the real error body.
7. **Webhooks:** ask the printIQ account manager which webhook events are available and their payload/signature format.
8. **Ask printIQ support** for the IQConnect API documentation pack + Postman collection — the authoritative source this public investigation could not reach.

---

_Researched on 2026-05-29 (web research only — partner-gated docs; no live call)._
_Sources: printIQ.com IQConnect marketing pages (iqconnect-api / iqconnect / iqconnect-automate); Infigo
"Connect: printIQ" Zendesk article + Infigo Academy printIQ/Punchout courses; SQiBLE/SQConnect; general web
search. No OpenAPI spec, no SDK, no live call._
