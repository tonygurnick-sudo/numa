---
api_name: 'PrintIQ'
api_slug: 'printiq'
vendor: 'printIQ (NZ/AU print MIS)'
website: 'https://printiq.com'
investigation_started: '2026-05-29'
investigation_updated: '2026-05-29'
investigator: 'Claude Code (automated) — web research only, no live API access'
investigation_status: 'in-progress'
documentation_quality: 'poor'
api_types: ['REST']
overall_confidence: 'low — docs are partner-gated; almost no endpoint/field detail is public'
blockers:
  - 'IQConnect API reference is behind a partner/support wall — not publicly browsable'
  - 'No live instance, credentials, OpenAPI spec, or SDK available for discovery'
  - 'Exact base URL pattern, token endpoint path, and entity field schemas are unconfirmed'
---

# API Investigation Questionnaire: PrintIQ

> Completed by automated **web-only** investigation on 2026-05-29.
> **HONESTY NOTE:** printIQ's "IQConnect" API documentation is **partner-gated** — it is handed out by the printIQ support/integrations team to integrators, not published. Public marketing pages confirm the API exists and confirm the **credential model** (instance URL + username + password + app_name + app_key, all issued by printIQ support), and they name some workflow surfaces (pricing via `GetPrice`, quotes, orders/jobs, products, customers, punch-out). **Beyond that, almost every endpoint path, request/response shape, and field name below is `[INFERRED]` from REST conventions or `[UNKNOWN]`.** Do **not** treat any endpoint here as a verified contract. A discovery pass against a real instance (with credentials from printIQ support) is required before generating production rules.
> Sources: printIQ.com IQConnect marketing pages, Infigo (web-to-print) integration help/academy material, SQiBLE/SQConnect, general web search. No OpenAPI spec, no SDK, no live call.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** https://printiq.com/iqconnect-api/ — marketing overview only; the actual reference is partner-gated [DOCUMENTED]
- **API reference / endpoint catalog URL:** Not public. Provided by printIQ support/integrations team to integrators on request [DOCUMENTED that it is gated; content itself UNKNOWN]
- **Authentication guide URL:** Not public; credentials (instance URL, username, password, app_name, app_key) issued by printIQ support [DOCUMENTED]
- **Changelog / release notes URL:** https://printiq.com/wp-content/uploads/2025/08/printIQ-v49v48.2v48.1-Release-Notes.pdf (product release notes; image-heavy, no API text layer) [DOCUMENTED]
- **Status page URL:** None found [UNKNOWN]

> **Discovery tip:** The real reference is almost certainly shipped as a PDF/Postman collection from printIQ's integrations team. When a client provides credentials, also ask for "the IQConnect API documentation pack" — that is the authoritative source, not the website.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** None found public [UNKNOWN] — check `{instance}/api/swagger` / `{instance}/swagger.json` during live discovery [INFERRED]
- **Postman collection URL:** None public; printIQ reportedly ships one to integrators [INFERRED]
- **Official SDK repositories:**
  - Python: None [UNKNOWN]
  - Node.js: None [UNKNOWN]
  - Other: None found. No public GitHub repos for the printIQ/IQConnect API [UNKNOWN]
- **Official blog / engineering blog:** https://printiq.com/iqconnect/ , https://printiq.com/iqconnect-automate/ (marketing) [DOCUMENTED]
- **Community forums / Stack Overflow tag:** None found [UNKNOWN]
- **Third-party integration docs (most useful indirect source):**
  - Infigo "Connect: printIQ" help article + Infigo Academy printIQ/Punchout courses — confirm credential model, GetPrice usage, webhook setup-by-support pattern, cXML punch-out [DOCUMENTED, but HTTP 403 to automated fetch — read manually]
  - SQiBLE "SQConnect for printIQ" — third-party connector, confirms API exists for sync [DOCUMENTED]
  - printIQ APIs are reportedly published in **Zapier** — Zapier's printIQ app (if listed) is a usable indirect catalog of triggers/actions [INFERRED]

> **Discovery tip:** The Infigo Academy "printIQ" and "Punchout" courses and the "Connect: printIQ" Zendesk article are the richest _public-ish_ technical sources. They are gated/403 to automated fetch but readable in a browser and describe GetPrice, webhooks, and the punch-out (cXML) flow in concrete terms.

### 1.3 Documentation Quality Assessment [REQUIRED]

Rate each area (1-5, where 5 = comprehensive with examples):

| Area                      | Rating | Notes                                                                                                                       |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Authentication            | 2      | Credential _fields_ are documented (instance URL + user/pass + app_name + app_key); the token exchange itself is not public |
| Endpoint reference        | 1      | Not public. Only workflow _names_ (GetPrice, quotes, orders, punch-out) are mentioned                                       |
| Request/response examples | 1      | None public                                                                                                                 |
| Error documentation       | 1      | None public                                                                                                                 |
| Rate limit documentation  | 1      | None public                                                                                                                 |
| Pagination documentation  | 1      | None public                                                                                                                 |
| Webhook documentation     | 2      | Confirmed webhooks exist but are _created by printIQ support per request_; no public catalog                                |
| SDKs / code examples      | 1      | No public SDK or code                                                                                                       |
| Changelog / versioning    | 2      | Product release notes exist (v48/v49); no API-specific changelog                                                            |

**Overall documentation quality:** poor (public). The real partner pack is likely "adequate-to-good" but inaccessible to this investigation.

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API _marketing_ page (reference itself is gated)
- [x] Confirmed **no public** OpenAPI/Swagger spec
- [x] Identified authentication _model_ (username/password + app_name + app_key -> token) [DOCUMENTED at the credential-field level]
- [ ] Found at least one working example — **NOT achieved** (no public example, no credentials)
- [ ] Identified rate limit information — **NOT found**
- [ ] Identified pagination approach — **NOT found**
- [x] Checked for webhook/event support — exists, support-provisioned [DOCUMENTED]
- [x] Checked for official SDKs — none found

---

## Phase 2: API Fundamentals

> **Why:** These are the non-negotiable basics. Without clear auth and a working first call, nothing else matters. **GATE NOT PASSED — no live call was possible.**

### 2.1 API Identity [REQUIRED]

- **API name:** IQConnect API (the API surface of printIQ) [DOCUMENTED]
- **Vendor / company:** printIQ — cloud print MIS / print estimating & workflow software (NZ-founded, AU/global) [DOCUMENTED]
- **Current API version:** Unknown. Product is at v48/v49; API versioning scheme not public [UNKNOWN]
- **Base URL(s):**
  - Production: **Per-instance/tenant** — each customer has their own printIQ instance URL. Pattern is `https://{instance}.printiq.com/` or a customer-custom domain; the API likely lives under a path such as `https://{instance}.printiq.com/api/...`. **The exact API base path is `[INFERRED]` and must be confirmed against a real instance.** [INFERRED]
  - Sandbox / testing: Not documented; printIQ may provision a test/staging instance per integrator [UNKNOWN]
- **API type:** REST/JSON over HTTPS is the most likely model (modern punch-out + Zapier publication strongly imply JSON REST). Older printIQ integrations may have used SOAP-style endpoints. **Treat as REST/JSON `[INFERRED]`; verify during discovery.** [INFERRED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1) [INFERRED]
- **Data format:** JSON for the IQConnect REST API; **cXML** specifically for the Punch-Out (procurement) flow [INFERRED for JSON; DOCUMENTED that punch-out uses cXML]
- **Content-Type header(s):** `application/json` (REST); `text/xml` / `application/xml` for cXML punch-out [INFERRED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:**

```
[INFERRED] https://{instance}.printiq.com/api/{Resource}/{Action}
```

- **Versioning strategy:** Unknown — possibly path-based (`/api/v1/`) or none [UNKNOWN]
- **CORS policy:** Unknown [UNKNOWN]
- **Required headers (all requests):**

| Header        | Value                                         | Purpose                                                                         |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| Authorization | `Bearer {token}` _(or a custom token header)_ | Auth token obtained from the token-exchange call — **header name `[INFERRED]`** |
| Content-Type  | `application/json`                            | Request body format (POST) [INFERRED]                                           |

> **NOTE:** The exact way the issued token is attached (Authorization: Bearer vs. a custom header vs. a query param) is **`[UNKNOWN]`** and is the first thing to confirm in discovery.

### 2.3 Authentication [REQUIRED]

> **This is the single most important section.** The credential _model_ is well-confirmed; the _token-exchange endpoint_ is not.

- **Auth method:** Credential-exchange -> bearer-style token. The integrator is issued **four credentials by printIQ support**: a **username**, **password**, **application name (`app_name`)**, and **application key (`app_key`)** — plus the customer's **instance URL**. These are exchanged for a session/access token used on subsequent calls. [DOCUMENTED — credential fields; token-exchange mechanics INFERRED]
- **Auth location:** Header (token on subsequent calls) [INFERRED]
- **Auth header format:**

```
[INFERRED]
Authorization: Bearer {token}
```

**For token-based auth (this connector — `authType: username-password` with extra app_name/app_key fields):**

- **How to generate tokens:** POST the four credentials to a token endpoint on the instance. **Endpoint path is `[INFERRED]`** — likely something like `POST https://{instance}.printiq.com/api/Site/Token` or `/api/Token` / `/api/Authenticate`. Request body (inferred):

```json
[INFERRED — exact field names & path unconfirmed]
POST /api/Site/Token
{
  "username": "apiuser",
  "password": "••••••••",
  "app_name": "MyApp",
  "app_key": "••••••••"
}
```

Expected response (inferred):

```json
[INFERRED]
{
  "token": "eyJ...",
  "expires": "2026-05-29T12:00:00Z"
}
```

- **Token lifetime:** Unknown [UNKNOWN]
- **Token refresh mechanism:** Unknown — likely "re-POST credentials to re-mint" rather than a refresh-token grant [INFERRED]
- **Scopes or permissions model:** Unknown — permissions are probably tied to the API user's role inside the printIQ instance [INFERRED]
- **Key rotation procedure:** `app_key` is reissued by printIQ support [INFERRED]

**Registry alignment (`connectorRegistry.ts` -> `printiq`):** [CONFIRMED against repo]

- `authType: 'username-password'`
- `credentialFields`: `username` (text), `password` (password), `app_name` (text), `app_key` (password) — all `required: true`
- There is **no OAuth block** for this connector — it is **not** an OAuth flow. The connector collects all four credentials and the backend performs the token exchange. The instance/base URL is **not** in `credentialFields`, so it must be captured elsewhere (e.g. connector setup/instance config) or derived — **flag this as a gap to resolve** (the API is per-tenant and cannot function without the instance URL). [CONFIRMED — registry has no base-URL field]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **This gate is NOT passed.** No live call was made — no instance, no credentials, no public sandbox.

**Endpoint that _would_ be used for first call (inferred):**

```http
[INFERRED — UNVERIFIED]
POST /api/Site/Token HTTP/1.1
Host: {instance}.printiq.com
Content-Type: application/json

{ "username": "...", "password": "...", "app_name": "...", "app_key": "..." }
```

**Response received:** None — not executed. [UNKNOWN]

- **HTTP status code:** Unknown [UNKNOWN]
- **Time to first successful call:** N/A
- **Gotchas anticipated:** (1) instance URL not in `credentialFields`; (2) token header name unknown; (3) REST vs SOAP unknown; (4) punch-out is a separate cXML surface, not the REST API.

- [ ] **GATE CHECK: First successful API call — NOT completed. Discovery against a live instance required.**

---

## Phase 3: Domain Model & Behavior

> **Why:** Claude needs the entities and rules. printIQ's _domain_ (print MIS) is well understood from marketing; the _API field schemas_ are not public. Entities below are `[INFERRED]` from the printIQ product domain unless noted.

### 3.1 Core Entities [REQUIRED]

> Entity _existence_ is `[DOCUMENTED]` from product/marketing material (printIQ centers on quoting, ordering, jobs/production, products/stock, customers). **Field lists are `[INFERRED]` placeholders pending live discovery.**

#### Entity: Quote

- **API resource name / endpoint path:** `[INFERRED]` `/api/Quote`, `/api/Quote/{quoteNo}`; pricing via a `GetPrice` call
- **Description:** A priced estimate for a print job. printIQ's core strength is automated estimating — `GetPrice` returns real-time pricing for a specified product/spec. [DOCUMENTED that GetPrice exists]
- **CRUD support:** Create (build cart -> quote), Read, price (`GetPrice`); update before conversion [INFERRED]

**Fields (INFERRED — verify):**

| Field        | Type   | Required? | Writable? | Description                             | Example Value      |
| ------------ | ------ | --------- | --------- | --------------------------------------- | ------------------ |
| quoteNo      | string | yes       | no        | Human-readable quote number             | `"Q-100234"`       |
| quoteGuid    | string | yes       | no        | System unique id                        | `"a1b2c3..."`      |
| customerCode | string | yes       | yes       | Owning customer reference               | `"CUST001"`        |
| status       | string | yes       | no        | Quote lifecycle state                   | `"Draft"`          |
| lines        | array  | yes       | yes       | Quote line items (product + spec + qty) | `[...]`            |
| total        | number | yes       | no        | Computed price total                    | `1250.00`          |
| currency     | string | yes       | no        | From instance settings                  | `"NZD"`            |
| createdDate  | string | yes       | no        | ISO 8601 timestamp                      | `"2026-05-29T..."` |

> **All fields above are `[INFERRED]`.** The real schema (and whether it's `quoteNo` vs `QuoteReference` vs `id`) must come from the IQConnect doc pack or a live response.

#### Entity: Order / Job

- **API resource name / endpoint path:** `[INFERRED]` `/api/Order`, `/api/Job`, `/api/Job/{jobNo}`
- **Description:** A confirmed order that becomes one or more production **jobs** tracked on printIQ's Production Board (barcoded job bags, scheduling, production methods). Punch-out delivers orders (with artwork) straight to the Production Board. [DOCUMENTED at domain level]
- **CRUD support:** Create (from accepted quote / punch-out), Read, status updates (production lifecycle) [INFERRED]

**Fields (INFERRED — verify):** `jobNo`, `orderNo`, `quoteNo` (source), `customerCode`, `status` (production state), `dueDate`, `shippedDate`, `lines`, `artworkRefs`.

#### Entity: Product

- **API resource name / endpoint path:** `[INFERRED]` `/api/Product`, `/api/Product/{code}`
- **Description:** A configurable print product definition (the thing you get a price for). Drives `GetPrice`. printIQ also has **Inventory Items** (stocked products) — note the Infigo integration distinguishes a "static PDF product sync" webhook from an "Inventory Items product sync" webhook. [DOCUMENTED that both product types exist]
- **CRUD support:** Read (catalog/sync); create/update is likely admin-side [INFERRED]

#### Entity: Customer

- **API resource name / endpoint path:** `[INFERRED]` `/api/Customer`, `/api/Customer/{code}`
- **Description:** A customer/account that quotes and orders are placed against. printIQ integrates customer + pipeline updates to HubSpot/Zoho/Salesforce. [DOCUMENTED that customer sync to CRMs exists]
- **CRUD support:** Create, Read, Update [INFERRED]

**Fields (INFERRED — verify):** `customerCode`, `name`, `contacts[]`, `addresses[]`, `pricingTier`/`priceList`, `accountStatus`.

#### Entity: Price (GetPrice result)

- **API resource name / endpoint path:** `[INFERRED]` `GetPrice` (e.g. `POST /api/Quote/GetPrice` or `/api/GetPrice`)
- **Description:** Real-time pricing for a product + specification + quantity. This is the single most-cited IQConnect endpoint (Infigo "requests pricing solely from printIQ via the GetPrice API"). The integration philosophy is that **pricing lives in printIQ** and is fetched on demand. [DOCUMENTED that GetPrice exists and is the pricing source of truth]
- **CRUD support:** Read/compute only (POST a spec, get a price) [INFERRED]

### 3.2 Entity Relationships [IMPORTANT]

```
[INFERRED domain model — not from API schema]

┌──────────┐   1:N   ┌──────────┐   convert   ┌──────────┐   1:N   ┌──────────┐
│ Customer │────────>│  Quote   │────────────>│  Order   │────────>│   Job    │
└──────────┘         └──────────┘             └──────────┘         └──────────┘
                          │  references                                  │
                          ▼                                              ▼ (Production Board)
                     ┌──────────┐                                 ┌──────────────┐
                     │ Product  │  (GetPrice prices a Product)    │  Artwork /   │
                     │ /Inventory│                                │  Job Bag     │
                     └──────────┘                                 └──────────────┘
```

### 3.3 State Machines [IMPORTANT]

#### State Machine: Quote -> Order -> Job (INFERRED)

```
[Quote Draft] --price (GetPrice)--> [Quoted] --accept/convert--> [Order]
                                                                    │
                                                              (production)
                                                                    ▼
                                  [Job: Pending] -> [In Production] -> [Shipped] -> [Completed]
```

| From State    | Action/Trigger   | To State  | Reversible? | Side Effects                               |
| ------------- | ---------------- | --------- | ----------- | ------------------------------------------ |
| Quote Draft   | GetPrice         | Quoted    | yes         | Price computed (no commitment)             |
| Quoted        | Accept / convert | Order/Job | no          | Job created on Production Board            |
| In Production | Ship             | Shipped   | no          | "shipped status" webhook fires to consumer |

> All states/transitions above are `[INFERRED]` from the print MIS domain. Real status enum values are `[UNKNOWN]`.

### 3.4 Business Rules [IMPORTANT]

- **Pricing is authoritative in printIQ** — integrators must call `GetPrice` rather than computing prices themselves. [DOCUMENTED]
- **A valid product + specification is required to get a price** — `GetPrice` needs the product code and its option/spec selections. [INFERRED]
- **Orders flow to the Production Board with artwork attached** (punch-out delivers order + artwork together). [DOCUMENTED]
- **Per-tenant isolation:** all calls are scoped to one printIQ instance; the instance URL is mandatory context. [DOCUMENTED]
- Field-level rules, uniqueness constraints, and computed-field lists are **`[UNKNOWN]`** without the doc pack.

### 3.5 Field Format Reference [IMPORTANT]

| Format        | Pattern  | Example                | Notes                                                     |
| ------------- | -------- | ---------------------- | --------------------------------------------------------- |
| Date/DateTime | ISO 8601 | `2026-05-29T10:00:00Z` | [INFERRED]                                                |
| Currency      | number   | `1250.00`              | Currency from instance settings (e.g. NZD/AUD) [INFERRED] |
| ID format     | string   | `"Q-100234"` / GUID    | Likely human ref + GUID pair [INFERRED]                   |
| Enum values   | string   | —                      | Status enums UNKNOWN [UNKNOWN]                            |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

`[UNKNOWN]` — no enum values are public. Discover from live responses.

---

## Phase 4: Endpoint Catalog

> **Why:** Normally the core of the spec. Here it is **almost entirely inferred** — treat as a discovery checklist, not a contract.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: POST /api/Site/Token (token exchange) — [INFERRED]

- **Purpose:** Exchange username/password/app_name/app_key for a session token
- **Authentication required:** no (this _is_ the auth call)
- **Idempotent:** effectively yes (re-mint)

**Request body (INFERRED):**

```json
{ "username": "apiuser", "password": "•••", "app_name": "MyApp", "app_key": "•••" }
```

**Success response (INFERRED):**

```json
{ "token": "eyJ...", "expires": "2026-05-29T12:00:00Z" }
```

> Path, field names, and response shape are **`[INFERRED]`**.

#### Endpoint: POST .../GetPrice — [DOCUMENTED it exists / INFERRED shape]

- **Purpose:** Real-time price for a product + spec + quantity
- **Authentication required:** yes (token)
- **Idempotent:** yes (pure compute)

**Request body (INFERRED):**

```json
{
  "productCode": "BC-350GSM",
  "quantity": 500,
  "options": { "finish": "Matte Laminate", "sides": "Double Sided" }
}
```

**Success response (INFERRED):**

```json
{ "price": 250.0, "currency": "NZD", "breakdown": [], "leadTimeDays": 3 }
```

> That `GetPrice` exists and is the pricing source of truth is `[DOCUMENTED]`. The exact path and payload are `[INFERRED]`.

#### Endpoints: Quote / Order / Job / Product / Customer CRUD — [INFERRED]

All `[INFERRED]` from REST conventions:

```
GET  /api/Quote/{quoteNo}        get a quote
POST /api/Quote                  create/save a quote (cart)
GET  /api/Job/{jobNo}            get a job/order
GET  /api/Customer/{code}        get a customer
POST /api/Customer               create a customer
GET  /api/Product/{code}         get a product definition
```

> **None of these paths are verified.** Confirm against the IQConnect doc pack or a live instance.

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path (INFERRED)      | Purpose                 | Auth?         | Source / Confidence                  |
| ------ | -------------------- | ----------------------- | ------------- | ------------------------------------ |
| POST   | /api/Site/Token      | Token exchange          | No            | INFERRED (path) — model DOCUMENTED   |
| POST   | .../GetPrice         | Real-time pricing       | Yes           | DOCUMENTED (exists) / INFERRED shape |
| GET    | /api/Quote/{quoteNo} | Get quote               | Yes           | INFERRED                             |
| POST   | /api/Quote           | Create/save quote       | Yes           | INFERRED                             |
| GET    | /api/Job/{jobNo}     | Get job/order           | Yes           | INFERRED                             |
| GET    | /api/Customer/{code} | Get customer            | Yes           | INFERRED                             |
| POST   | /api/Customer        | Create customer         | Yes           | INFERRED                             |
| GET    | /api/Product/{code}  | Get product             | Yes           | INFERRED                             |
| —      | (cXML punch-out)     | Receive order + artwork | Shared secret | DOCUMENTED (separate cXML surface)   |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

- **Punch-Out (cXML):** A separate procurement integration surface using **cXML** request flows with configured identities and shared secrets. Delivers orders (with artwork) to the Production Board. This is **not** the JSON REST API and is out of scope for the workspace-agent direct-API connector. [DOCUMENTED]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported? | Syntax | Notes                |
| ------------------------------- | ---------- | ------ | -------------------- |
| Filter by field value           | [UNKNOWN]  | —      | No public query docs |
| Filter by date range            | [UNKNOWN]  | —      |                      |
| Full-text search                | [UNKNOWN]  | —      |                      |
| Sort by field                   | [UNKNOWN]  | —      |                      |
| Field selection / sparse fields | [UNKNOWN]  | —      |                      |
| Include related records         | [UNKNOWN]  | —      |                      |
| Aggregate / count               | [UNKNOWN]  | —      |                      |
| Logical operators (AND/OR)      | [UNKNOWN]  | —      |                      |

### 5.2 Filter Syntax [REQUIRED]

`[UNKNOWN]` — no public filter syntax. Discover from the doc pack / live list endpoints. Likely query-string filters on list endpoints `[INFERRED]`.

### 5.6 Common Query Patterns [REQUIRED]

Anticipated (all `[INFERRED]`):

1. **Price a product:** `POST .../GetPrice` with product + spec + qty.
2. **Look up a quote by number:** `GET /api/Quote/{quoteNo}`.
3. **Look up a job/order status:** `GET /api/Job/{jobNo}`.
4. **Find a customer:** `GET /api/Customer/{code}`.

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** `[UNKNOWN]` — likely page-number or offset on list endpoints [INFERRED]
- **Default / max page size:** `[UNKNOWN]`
- **Total count available:** `[UNKNOWN]`

> No public pagination documentation. Must be discovered from a live list response.

### 6.3 Bulk Operations [IMPORTANT]

`[UNKNOWN]` — none documented. Sync-style bulk product/inventory flows exist via the webhook sync model (printIQ -> consumer), not necessarily via a bulk REST endpoint. [INFERRED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?           | Notes                                                                                           |
| ------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| Webhooks                 | Yes (support-set-up) | printIQ **support/account manager creates webhooks per request**; not self-service [DOCUMENTED] |
| WebSocket                | [UNKNOWN]            | None found                                                                                      |
| Server-Sent Events (SSE) | [UNKNOWN]            | None found                                                                                      |
| Long polling             | No                   | [INFERRED]                                                                                      |
| cXML callbacks           | Yes (punch-out)      | Procurement punch-out uses cXML request/callback flows [DOCUMENTED]                             |

### 7.2 Webhooks [IMPORTANT]

Confirmed from the Infigo integration: printIQ webhooks are **provisioned by the printIQ team via a support request** (the consumer provides a Webhook Link). The Infigo setup uses **three** webhooks:

1. **Static PDF product sync** — pushes product changes to the consumer [DOCUMENTED]
2. **Inventory Items product sync** — pushes inventory/stock product changes [DOCUMENTED]
3. **Shipped status update** — notifies the consumer when a job/order ships so it can be marked shipped and the end customer notified [DOCUMENTED]

- **Registration method:** Support request (not API/UI self-service) [DOCUMENTED]
- **Event catalog (general):** `[UNKNOWN]` beyond the three Infigo examples — the full set of available printIQ webhook events is not public.
- **Payload format / signature / retry policy:** `[UNKNOWN]`

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `[INFERRED]` poll job/order status (`GET /api/Job/{jobNo}` or a job-list with a "modified since" filter) if webhooks aren't provisioned.
- **"Modified since" filter available:** `[UNKNOWN]`
- **Rate-limit implications:** `[UNKNOWN]` (no published limits).

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope  | Limit     | Window | Notes                    |
| ------ | --------- | ------ | ------------------------ |
| Global | [UNKNOWN] | —      | No published rate limits |

- **Rate limit headers:** `[UNKNOWN]`
- **429 behavior:** `[UNKNOWN]` — apply conservative client-side throttling + exponential backoff by default [INFERRED]

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** `[UNKNOWN]` — not public.

Anticipated (INFERRED) — likely an HTTP status + JSON body with a message/code, but the shape is unverified:

```json
[INFERRED — UNVERIFIED]
{ "success": false, "message": "Invalid credentials", "errorCode": "..." }
```

**Error codes reference:**

| HTTP Status | Meaning (assumed) | Retryable? | Recovery Action            |
| ----------- | ----------------- | ---------- | -------------------------- |
| 400         | Bad request       | No         | Fix request                |
| 401         | Unauthorized      | Yes        | Re-mint token              |
| 403         | Forbidden         | No         | Check API user permissions |
| 404         | Not found         | No         | Verify reference/instance  |
| 429         | Rate limited      | Yes        | Backoff (limits UNKNOWN)   |
| 5XX         | Server error      | Yes        | Retry with backoff         |

> Status semantics above are `[INFERRED]` generic REST conventions — **not confirmed for printIQ**.

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** `[UNKNOWN]`
- GET assumed safe; POST (create quote/order) assumed non-idempotent — **guard creates carefully** [INFERRED]

### 8.5 File Handling [IMPORTANT]

- **Artwork upload:** Orders carry artwork (punch-out delivers "order complete with artwork"). The REST mechanism for uploading/attaching artwork is `[UNKNOWN]`; in punch-out it travels via the cXML/order flow. [DOCUMENTED that artwork moves with orders; REST upload mechanics UNKNOWN]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                       | Fits?        | Notes                                                                                            |
| -------------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| **Data Connector (Files)** | API is primarily a file/document store            | No           | printIQ is not a file system; artwork is incidental                                              |
| **Data Connector**         | API has browsable file-like content               | No           | Content is transactional records, not browsable documents                                        |
| **Direct API Only**        | API is action-oriented (price/quote/order/lookup) | **Best fit** | printIQ is action/transaction-oriented: get prices, create quotes, look up jobs/orders/customers |
| **Hybrid**                 | Both browsable content AND actions                | No           | No real file-browsing surface                                                                    |

**Selected integration path:** **Direct API via `connect_request`** (action-oriented, not a file browser).

**Justification:** printIQ exposes transactional print-MIS workflows — real-time pricing (`GetPrice`), quotes, orders/jobs, products, and customers — not browsable files or documents. This is **not** a Drive/Gmail-style file connector, so it does **not** belong in Files > Remote. It fits the **Direct API** model: the workspace agent calls the connector's stored printIQ credentials via the connector's `connect_request` proxy to hit the IQConnect REST endpoints (price a job, fetch a quote, check a job's production/shipping status, look up a customer). This mirrors the Fergus connector's pattern, **except** printIQ is more strongly action-oriented (its hero capability is on-demand estimating) and is **per-tenant**, so the integration must capture the instance/base URL in addition to the four credentials.

> **Connector implementation gap (must resolve before build):** `credentialFields` in the registry collect `username`, `password`, `app_name`, `app_key` — but **not** the per-tenant instance/base URL, which the API cannot work without. Either add an instance-URL field to the connector config, or store it in connector setup/metadata. Without it the token exchange has no host to target.

### 9.2 Connector Requirements [IMPORTANT]

`connect_request`-style direct API. Not a Files connector, so the `list_files`/`download_file` mapping does not apply. Instead, the agent-facing actions map to (all endpoint paths `[INFERRED]`):

| Agent Action            | API Endpoint (INFERRED)    | Notes                                |
| ----------------------- | -------------------------- | ------------------------------------ |
| `get_price`             | `POST .../GetPrice`        | Hero capability — real-time estimate |
| `get_quote`             | `GET /api/Quote/{no}`      | Look up a quote                      |
| `create_quote`          | `POST /api/Quote`          | Build/save a quote (guard: write)    |
| `get_job` / `get_order` | `GET /api/Job/{no}`        | Production/shipping status           |
| `get_customer`          | `GET /api/Customer/{code}` | Customer lookup                      |
| `create_customer`       | `POST /api/Customer`       | Create customer (guard: write)       |

**Auth type for connector:** Token via credential exchange (`authType: username-password` + `app_name`/`app_key` extra fields) — matches the registry.
**Connector category:** Manufacturing (matches registry `category: 'Manufacturing'`); functionally print MIS / quoting & order management.
**Caching appropriate:** Pricing results — short TTL only or none (prices change; printIQ is the source of truth). Product/customer lookups — modest TTL acceptable. [INFERRED]

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope, once discovery confirms endpoints):**

1. Get real-time pricing for a product/spec/quantity via `GetPrice` [DOCUMENTED capability / INFERRED shape]
2. Look up quotes, jobs/orders, customers, and products by reference [INFERRED]
3. Check a job's production/shipping status [INFERRED]
4. Create/save quotes and customers (write — gate behind confirmation) [INFERRED]

**CANNOT do (out of scope / dangerous / unverified):**

1. Anything until the **instance/base URL + endpoint paths + token header** are confirmed against a live instance — every endpoint here is `[INFERRED]`.
2. Punch-out / cXML procurement flows (separate XML surface, not this connector).
3. Bulk operations / exports (none documented).
4. Configure webhooks (printIQ-support-only, not API-driven).
5. Destructive operations (delete) — not documented; do not assume.

**Default parameters:**

| Parameter | Default              | Reason                                               |
| --------- | -------------------- | ---------------------------------------------------- |
| (pricing) | no caching of prices | printIQ is the pricing source of truth               |
| writes    | confirm-first        | Creating quotes/customers/orders has business impact |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK | Language | Quality | Maintained? | Worth Using? | Notes               |
| --- | -------- | ------- | ----------- | ------------ | ------------------- |
| —   | —        | —       | —           | No           | No public SDK found |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1: sources identified (and confirmed mostly gated)
- [ ] Phase 2: **auth NOT live-verified; first-call GATE NOT passed**
- [ ] Phase 3: entities named (DOCUMENTED) but fields are INFERRED placeholders
- [ ] Phase 4: endpoints INFERRED, not verified (GetPrice existence DOCUMENTED only)
- [ ] Phase 5: query/filter UNKNOWN
- [ ] Phase 6: pagination UNKNOWN
- [x] Phase 7: events assessed (webhooks support-provisioned; cXML punch-out)
- [ ] Phase 8: rate limits & error format UNKNOWN
- [x] Phase 9: integration path selected (Direct API via `connect_request`)

**Overall investigation confidence:** **low** — domain and auth _model_ are clear; concrete API surface is not. **This questionnaire is a discovery plan, not a verified spec.**

**Known gaps that will reduce output quality:**

1. No public endpoint reference, OpenAPI spec, or SDK — all paths/fields are inferred.
2. Auth token-exchange endpoint, token header name, and token lifetime unconfirmed.
3. Per-tenant **instance/base URL is not captured by the connector's `credentialFields`** — a real blocker for a working connector.
4. No rate-limit, pagination, error-format, or enum data.

**Required next step:** Obtain the IQConnect API documentation pack from printIQ support (with a test instance + credentials) and run a discovery pass — first call to the token endpoint, then `GetPrice`, then quote/job/customer reads — recording real request/response pairs. Re-tag every `[INFERRED]` item afterward.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate?                 | Confidence | Gaps                                                       |
| ---------------------------- | ----------------------------- | ---------- | ---------------------------------------------------------- |
| 01-llm-api-rules             | Partial (skeleton)            | Low        | Endpoints/auth header inferred; needs live verification    |
| 01a-domain-model-reference   | Partial                       | Low-Med    | Entities known from domain; field schemas inferred         |
| 01b-query-patterns           | No                            | Low        | No query/filter/pagination data                            |
| 01c-mutation-patterns        | Partial                       | Low        | Write endpoints inferred only                              |
| 01d-event-and-error-handling | Partial                       | Low-Med    | Webhooks/cXML DOCUMENTED; error format UNKNOWN             |
| 02-api-spec-investigation    | Partial (as a discovery plan) | Low        | Most of the spec is inferred                               |
| 03-connector-setup           | Partial                       | Medium     | Auth model + path decision clear; instance-URL gap flagged |

---

## Appendix A: Discovery Playbook (printIQ-specific)

When a client provides credentials + instance URL, run these in order and re-tag answers above:

1. **Confirm host & API base:** try `GET https://{instance}.printiq.com/`, then probe `/api`, `/api/swagger`, `/swagger.json`, `/api/v1`.
2. **Token exchange:** POST the four credentials to candidate token paths (`/api/Site/Token`, `/api/Token`, `/api/Authenticate`); capture exact field names, response shape, token header, and expiry.
3. **GetPrice:** the documented hero endpoint — find its exact path and required product/spec payload first; it validates the whole auth + product model.
4. **Reads:** quote, job/order, customer, product by reference — capture real field names (replace all INFERRED schemas).
5. **List + pagination:** hit a list endpoint to learn pagination + filter syntax.
6. **Errors:** trigger 401 (bad token), 404 (bad reference), and a validation error to capture the real error body.
7. **Webhooks:** ask the printIQ account manager which webhook events are available and their payload/signature format.
8. **Ask printIQ support directly** for the IQConnect doc pack + Postman collection — it is the authoritative source this public investigation could not reach.
