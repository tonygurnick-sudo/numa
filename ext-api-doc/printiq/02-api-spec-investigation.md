---
api_name: PrintIQ
api_slug: printiq
api_label: IQConnect (version scheme unknown — NOT a path segment)
base_url: '[UNKNOWN] per-tenant — inferred https://{instance}.printiq.com/api/ (custom domains also exist)'
path_version_segment: none (no /v1/; product ships at v48/v49, a product version, never a path)
spec_format: none (no public OpenAPI/Swagger — partner-gated)
docs_url: https://printiq.com/iqconnect-api/ (marketing overview only; real reference partner-gated)
date_researched: '2026-05-29'
date_live_tested: NEVER — no instance, no credentials, no public sandbox
call_surface: HTTP via connect_request (Direct API, action-oriented). NOT a Files browser. NOT MCP.
confidence: LOW — discovery plan, not a verified contract. Only the credential MODEL, `GetPrice` existence, the cXML Punch-Out surface, and the support-provisioned webhook model are [DOCUMENTED] from public material. Every endpoint path, field name, token-header name, error shape, pagination detail, and rate limit is [INFERRED] or [UNKNOWN]. A discovery pass against a live instance is required before any of this can be trusted.
---

# PrintIQ — API Specification & Investigation

Developer reference for the printIQ "IQConnect" API. Condensed from the investigation questionnaire. The IQConnect reference is partner-gated — printIQ's support/integrations team hands it to integrators on request; it is not published.

## Overview

- **Vendor:** printIQ — cloud print MIS / estimating & workflow software (NZ-founded, AU/global) [DOCUMENTED]
- **API name:** IQConnect [DOCUMENTED]. **Version:** unknown; product ships at v48/v49, API versioning scheme not public [UNKNOWN]
- **Base URL:** per-tenant — each customer has their own instance. Inferred `https://{instance}.printiq.com/api/` (custom domains also exist). Exact API base path `[UNKNOWN]` [INFERRED]
- **Sandbox:** not documented; printIQ may provision a test/staging instance per integrator [UNKNOWN]
- **API type:** REST/JSON over HTTPS most likely (modern Punch-Out + Zapier publication imply JSON REST); older surfaces may be SOAP/XML. Treat as REST/JSON [INFERRED]
- **Data format:** JSON for IQConnect REST; **cXML** specifically for the Punch-Out flow [INFERRED for JSON / DOCUMENTED that Punch-Out uses cXML]
- **Field casing:** `[UNKNOWN]`. **ID format:** `[UNKNOWN]` — likely a human ref (e.g. `Q-100234`) + a GUID [INFERRED]
- **Docs:** https://printiq.com/iqconnect-api/ — marketing overview only; real reference partner-gated [DOCUMENTED]
- **API reference:** not public; provided by printIQ support to integrators on request, likely a PDF and/or Postman collection [DOCUMENTED gated; content UNKNOWN]
- **OpenAPI spec:** none public [UNKNOWN — probe `{instance}/api/swagger`, `{instance}/swagger.json` during discovery]. **Status page:** none found [UNKNOWN]
- **Contact:** printIQ support / integrations team (via printiq.com "Get Started" / contact); the integrator's account manager provisions credentials and webhooks

printIQ is a print MIS for commercial print businesses — estimating, quoting, ordering, production/job tracking, products/stock, customers. IQConnect exposes those workflows: request real-time pricing, build quotes, push/receive orders, track jobs through the Production Board, sync products and customers. Hero capability: **on-demand estimating** — pricing lives in printIQ, fetched via `GetPrice`.

**IQConnect modules (public marketing page):** [DOCUMENTED]
| Module | Purpose |
| --- | --- |
| **Integrate** | "Comprehensive API's" for CRM/EDM connections (HubSpot, Zoho); also published in Zapier |
| **Link** | Connects multiple printIQ instances via APIs (inter-trade outsourcing) |
| **Punch-Out** | cXML procurement — delivers orders + artwork "directly into your Production Board" |
| **SmartSite** | Self-contained ordering module with "built-in API calls" (SEO storefront / simplified ordering) |

The surface relevant to a Numa Direct-API connector is the **Integrate** REST API (pricing, quotes, orders/jobs, products, customers). **Punch-Out (cXML)** and **SmartSite** are separate surfaces, out of scope.

## Authentication — credential exchange → bearer-style session token

The credential MODEL is well-confirmed; the token-exchange endpoint is not. The integrator is issued four credentials by printIQ support plus the customer's instance URL:
| Credential | Field | Type | Issued by | Notes |
| --- | --- | --- | --- | --- |
| Username | `username` | text | printIQ support | API user inside the printIQ instance |
| Password | `password` | secret | printIQ support | API user password |
| App name | `app_name` | text | printIQ support | Identifies the calling application |
| App key | `app_key` | secret | printIQ support | Application key (reissued by support if rotated) |
| Instance | (host) | url | the customer | **NOT in the connector credentials** — see gap below |

These four are POSTed to a token endpoint on the instance, exchanged for a session/access token sent on subsequent calls. [DOCUMENTED credential fields / INFERRED token mechanics]

Token exchange (INFERRED — path, fields, response shape ALL unverified): `POST https://{instance}.printiq.com/api/Site/Token` Content-Type application/json `{ "username": "apiuser", "password": "••••••••", "app_name": "MyApp", "app_key": "••••••••" }` → `{ "token": "eyJhbGciOi...", "expires": "2026-05-29T12:00:00Z" }`. Header on subsequent calls (header name unverified): `Authorization: Bearer {token}` + `Content-Type: application/json`.

| Property       | Value                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| Grant style    | Custom credential exchange (NOT OAuth 2.0; no `client_id`/`client_secret`/redirect)       |
| Token endpoint | `[INFERRED]` `POST /api/Site/Token` (also try `/api/Token`, `/api/Authenticate`)          |
| Token header   | `[UNKNOWN]` — `Authorization: Bearer`, a custom header, or a query token all possible     |
| Token lifetime | `[UNKNOWN]` — treat short-lived; be ready to re-mint                                      |
| Refresh        | `[INFERRED]` — no refresh-token grant documented; re-POST the four credentials to re-mint |
| Scopes         | `[INFERRED]` — tied to the API user's role inside the printIQ instance, not API scopes    |
| Key rotation   | `[INFERRED]` — `app_key` reissued by printIQ support                                      |

**AUTH GOTCHA:** `app_name` + `app_key` are part of the token exchange, NOT per-request headers — sent once to mint a token; do NOT append to data requests.

### BLOCKER: the per-tenant instance URL is NOT in the connector credentials

`credentialFields` collect ONLY `username`, `password`, `app_name`, `app_key` (verified in `connectorRegistry.ts`) — NOT the instance/base URL, without which the API has no host to target. printIQ is per-tenant; no global base URL. Before any call can succeed, the instance URL must be supplied (a connector setup field, connector metadata, or asked at chat time — see 03 §"Known gap"). If the host is unknown, STOP and ask the user — do not guess a hostname.

## Endpoint Catalog

None of the paths below are verified. `GetPrice` is the only endpoint whose existence is documented; its path/payload are inferred. Treat as a discovery checklist.

| Method | Path (INFERRED)        | Purpose                            | Auth | Paginated | Idempotent    | Confidence                         |
| ------ | ---------------------- | ---------------------------------- | ---- | --------- | ------------- | ---------------------------------- |
| POST   | `/api/Site/Token`      | Exchange 4 credentials for a token | No   | —         | —             | INFERRED path; model DOCUMENTED    |
| POST   | `.../GetPrice`         | Real-time price for product + spec | Yes  | No        | Yes (compute) | DOCUMENTED exists / INFERRED shape |
| GET    | `/api/Quote/{quoteNo}` | Get a quote                        | Yes  | No        | Yes           | INFERRED                           |
| POST   | `/api/Quote`           | Create/save a quote (cart)         | Yes  | No        | No            | INFERRED                           |
| GET    | `/api/Job/{jobNo}`     | Get a job/order (prod. status)     | Yes  | No        | Yes           | INFERRED                           |
| GET    | `/api/Order/{orderNo}` | Get an order                       | Yes  | No        | Yes           | INFERRED                           |
| GET    | `/api/Customer/{code}` | Get a customer                     | Yes  | No        | Yes           | INFERRED                           |
| POST   | `/api/Customer`        | Create a customer                  | Yes  | No        | No            | INFERRED                           |
| GET    | `/api/Product/{code}`  | Get a product definition           | Yes  | No        | Yes           | INFERRED                           |

Non-REST surfaces (out of scope): Punch-Out — cXML request/callback, receive order + artwork → Production Board [DOCUMENTED] · SmartSite — built-in storefront APIs, SEO/simplified self-ordering [DOCUMENTED] · Link — instance-to-instance API, inter-trade outsourcing [DOCUMENTED].

## Data Models

Entity existence is `[DOCUMENTED]`. All field lists are `[INFERRED]` placeholders pending live discovery — the real schema may use entirely different names (`quoteNo` vs `QuoteReference` vs `id`). Full field tables: see 01a.

- **Quote [INFERRED fields]:** `quoteNo` (string, human ref `"Q-100234"`), `quoteGuid` (system id), `customerCode` (writable), `status` (`"Draft"`), `lines[]` (writable, product+spec+qty), `total` (computed `1250.00`), `currency` (from instance), `createdDate` (ISO 8601).
- **Order/Job [INFERRED fields]:** `jobNo`, `orderNo`, `quoteNo` (source), `customerCode`, `status` (production state), `dueDate`, `shippedDate`, `lines`, `artworkRefs`. A confirmed order becomes one or more production **jobs** on the Production Board (barcoded job bags, scheduling, production methods). [DOCUMENTED at domain level]
- **Product [INFERRED fields]:** `productCode`, `name`, `options[]`/`spec`, `inventory?`. A configurable definition driving `GetPrice`; printIQ also distinguishes **Inventory Items** (stocked) from configurable products — Infigo treats them as separate sync streams ("static PDF product sync" vs "Inventory Items product sync"). [DOCUMENTED both types exist]
- **Customer [INFERRED fields]:** `customerCode`, `name`, `contacts[]`, `addresses[]`, `priceList`/`pricingTier`, `accountStatus`. printIQ syncs customers + pipeline updates to HubSpot/Zoho/Salesforce. [DOCUMENTED CRM sync exists]
- **Price (GetPrice result) [INFERRED fields]:** `price` (number), `currency`, `breakdown[]`, `leadTimeDays`. The most-cited IQConnect endpoint — Infigo "requests pricing solely from printIQ via the GetPrice API". [DOCUMENTED GetPrice is the pricing source of truth]

Relationships (INFERRED domain model, not API schema): `Customer ──1:N──> Quote ──convert──> Order ──1:N──> Job (Production Board)`; Quote references Product (GetPrice prices a Product); Job carries Artwork / Job Bag.

## Pagination

Type `[UNKNOWN]` — likely page-number or offset on list endpoints [INFERRED]. Default/max size and total count `[UNKNOWN]`. Discover by hitting a live list endpoint and reading the envelope — look for `page`/`pageSize`/`offset`/`total`/`next`, then follow it. Last page `[UNKNOWN]` — likely an empty result array or absent `next` [INFERRED].

## Rate Limits

Global limit/window `[UNKNOWN]`. Headers `[UNKNOWN]` — none published. When exceeded `[UNKNOWN]` — assume `429`, honour `Retry-After` if present. Strategy: conservative client-side throttling + exponential backoff (start 2s, ≤3 retries, cap ~60s). Single-tenant instance — do not hammer it. [INFERRED]

## Error Handling

Standard format `[UNKNOWN]` — not public. Likely HTTP status + JSON body with message/code, shape unverified: `{ "success": false, "message": "Invalid credentials", "errorCode": "..." }` [INFERRED — UNVERIFIED].
Status codes (semantics generic-REST `[INFERRED]`, NOT confirmed): 400 fix body/params + check REST-vs-XML (No) · 401 re-mint token (re-POST creds) + verify token header (Yes) · 403 API user lacks permission, check role (No) · 404 verify reference AND instance host/base path (No) · 409 re-read, resolve, retry (Maybe) · 422 fix fields per message (No) · 429 backoff, honour Retry-After (Yes) · 5xx exponential backoff ≤3 (Yes).

## Webhooks / Events

printIQ webhooks EXIST but are provisioned by printIQ support on request — the consumer supplies a Webhook URL and printIQ configures the events. No public self-service API/UI to register them. [DOCUMENTED]
Confirmed from the Infigo integration (three webhooks) [DOCUMENTED]: Static PDF product sync (product change → pushes product changes) · Inventory Items product sync (inventory/stock change → pushes stocked-product changes) · Shipped status update (job/order ships → notifies consumer to mark shipped).
Registration: support request, not API/UI self-service [DOCUMENTED]. Full event catalog / payload / signature / retry policy `[UNKNOWN]`.
Polling fallback: poll `GET /api/Job/{jobNo}` (or a job list with a "modified-since" filter, if one exists) for status changes when webhooks aren't provisioned; filter availability `[UNKNOWN]`. (See 01d.)

## Known Limitations

1. Low confidence overall — no public endpoint reference, OpenAPI spec, or SDK; all paths/fields inferred.
2. Per-tenant instance/base URL NOT captured by the connector — must be supplied before any call works.
3. Token endpoint path, token header name, and token lifetime unverified.
4. No public rate-limit, pagination, error-format, or enum data.
5. Punch-Out (cXML) and SmartSite are separate surfaces — not the Integrate REST API, not this connector.
6. Webhook provisioning is support-driven, not API-driven — the agent cannot create/manage webhooks.
7. Bulk operations / exports — none documented.
8. Delete — not documented; do not assume it exists or is safe.
9. REST-vs-SOAP unconfirmed for older surfaces — if JSON 400s on a malformed-body error, check whether the endpoint expects XML.

## SDKs & Tooling

No public SDK found. **Postman collection:** not public; printIQ reportedly ships one to integrators on request [INFERRED]. **OpenAPI spec:** not available (partner-gated). **Indirect catalogs:** the Zapier "printIQ" app (if listed) and the Infigo Academy printIQ/Punchout courses + "Connect: printIQ" Zendesk article are the richest public-ish technical sources (gated/403 to automated fetch but readable in a browser). [DOCUMENTED]

## Integration Path Assessment

**Path:** Direct API via `connect_request` (action-oriented; NOT a Files browser, NOT MCP). printIQ exposes transactional print-MIS workflows (pricing `GetPrice`, quotes, orders/jobs, products, customers), not browsable files — so it does NOT belong in Files > Remote. The workspace agent calls the connector's stored printIQ credentials through the `connect_request` proxy to hit the IQConnect REST endpoints (price a job, fetch a quote, check production/shipping status, look up a customer). Mirrors the **Fergus** connector pattern — except printIQ is more strongly action-oriented (hero capability is on-demand estimating) and is **per-tenant**, so the integration must also capture the instance/base URL (see blocker above).

Connector method mapping (file-browser methods do NOT apply — Direct API):
| Agent action | API endpoint (INFERRED) | Feasibility |
| --- | --- | --- |
| `get_price` | `POST .../GetPrice` | Good (hero) once confirmed |
| `get_quote` | `GET /api/Quote/{no}` | Inferred — verify path |
| `create_quote` | `POST /api/Quote` | Inferred — write, confirm-first |
| `get_job` / `get_order` | `GET /api/Job/{no}` | Inferred — production/shipping status |
| `get_customer` | `GET /api/Customer/{code}` | Inferred — verify path |
| `create_customer` | `POST /api/Customer` | Inferred — write, confirm-first |

## Required Next Step (Discovery Playbook)

When a client provides credentials + instance URL, run in order and re-tag every `[INFERRED]` item:

1. **Confirm host & API base:** `GET https://{instance}.printiq.com/`, then probe `/api`, `/api/swagger`, `/swagger.json`, `/api/v1`.
2. **Token exchange:** POST the four credentials to candidate paths (`/api/Site/Token`, `/api/Token`, `/api/Authenticate`); capture exact field names, response shape, token header, expiry.
3. **GetPrice:** the documented hero endpoint — find its exact path and required product/spec payload; validates the whole auth + product model.
4. **Reads:** quote, job/order, customer, product by reference — capture real field names (replace all INFERRED schemas).
5. **List + pagination:** hit a list endpoint to learn pagination + filter syntax.
6. **Errors:** trigger 401 (bad token), 404 (bad reference), and a validation error to capture the real error body.
7. **Webhooks:** ask the printIQ account manager which webhook events are available and their payload/signature format.
8. **Ask printIQ support** for the IQConnect API documentation pack + Postman collection — the authoritative source this public investigation could not reach.

_Researched 2026-05-29 (web research only — partner-gated docs; no live call). Sources: printIQ.com IQConnect marketing pages (iqconnect-api / iqconnect / iqconnect-automate); Infigo "Connect: printIQ" Zendesk article + Infigo Academy printIQ/Punchout courses; SQiBLE/SQConnect; general web search. No OpenAPI spec, no SDK, no live call._
