---
api_name: 'Cin7 Core API'
api_slug: 'cin7-core'
vendor: 'Cin7 (Cin7 Core product line — formerly DEAR Inventory)'
website: 'https://www.cin7.com'
investigation_started: '2026-05-22'
investigator: 'Numa API Investigation Agent (live docs investigation 2026-05-22); split into this Core-only pack 2026-06-10'
investigation_status: 'blocked' # docs research complete (Apiary blueprint retrieved live); Phase 2.4 authenticated-call gate NOT passed (no credentials)
documentation_quality: 'excellent'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No Cin7 Core credentials were available — the Apiary blueprint was retrieved live, but no AUTHENTICATED API call has been made'
  - 'Error response body JSON format undocumented and unverified'
  - 'Sandbox/trial account availability unconfirmed'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: Cin7 Core

> **Source:** Live API investigation completed 2026-05-22 against the official Cin7 Core (DEAR
> Inventory) **API Blueprint** on Apiary (`https://dearinventory.docs.apiary.io/`, retrieved live,
> HTTP 200, ~356KB full blueprint), plus the official help docs and third-party consultant notes.
>
> ⚠️ **TWO PRODUCTS, TWO CONNECTORS.** Cin7 sells two separate inventory platforms with completely
> different APIs:
>
> | Product | Formerly | Base URL | Auth | Numa slug |
> |---------|----------|----------|------|-----------|
> | **Cin7 Core** | DEAR Inventory | `https://inventory.dearsystems.com/externalapi/v2` | Custom headers (Account ID + Application Key) | `cin7-core` — **this pack** |
> | **Cin7 Omni** | Cin7 | `https://api.cin7.com/api` | HTTP Basic (API username + API key) | `cin7-omni` — separate pack |
>
> **This document covers Cin7 Core ONLY.** Login at `inventory.dearsystems.com` = Core; login at
> `go.cin7.com`/`app.cin7.com` = Omni. Always confirm before calling anything.
>
> ⚠️ **NO AUTHENTICATED CALL has been made.** The investigation confirmed the Apiary blueprint is
> live and complete, but had no credentials — auth behaviour, error bodies, and field semantics
> are docs-derived, not live-verified through the Numa connector path.
>
> **Confidence markers:** `[CONFIRMED — API investigation 2026-05-22]` = verified live during
> the investigation (docs retrieved over HTTP) · `[DOCUMENTED]` = stated in Cin7's official
> Apiary blueprint / help docs · `[UNVERIFIED]`/`[UNKNOWN]` = inferred or undetermined.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://dearinventory.docs.apiary.io/` — the complete official API
  Blueprint (still hosted under the DEAR name) [CONFIRMED — API investigation 2026-05-22]
- **API reference / endpoint catalog URL:** same Apiary blueprint — per-endpoint request/response
  documentation for every entity group
- **Authentication guide URL:** covered inside the blueprint (Integrations → API → New
  Application setup path) [DOCUMENTED] — **Changelog / status page:** none found

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** none — Cin7 Core publishes an API Blueprint (Apiary), not an
  OAS spec [UNKNOWN — searched, not found]
- **Postman collection / official SDKs:** none published [UNKNOWN — searched, not found]
- **Community:** unofficial TypeScript SDK `cin7-core-api-sdk` (github.com/disosur — 1 star,
  partial); Zapier/viaSocket MCP servers; BlueHub consultant gotchas article
  (bluehub.co.uk/common-issues-to-avoid-when-using-cin7-core/)

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                       |
| ------------------------- | ------ | ---------------------------------------------------------------------------- |
| Authentication            | 5      | Custom-header model + credential setup path fully documented [DOCUMENTED]    |
| Endpoint reference        | 5      | Full Apiary blueprint, every entity group covered [CONFIRMED]                |
| Request/response examples | 4      | Blueprint carries field tables + examples per endpoint [DOCUMENTED]          |
| Error documentation       | 2      | Status codes documented; error body JSON shape is NOT [UNKNOWN]              |
| Rate limit documentation  | 5      | Explicit: 60/min per application key [DOCUMENTED]                            |
| Pagination documentation  | 5      | page/limit + `Total`; the 7 paginated endpoints are enumerated [DOCUMENTED]  |
| Webhook documentation     | 5      | 31 event types, payloads, retry schedule, auth options [DOCUMENTED]          |
| SDKs / code examples      | 2      | No official SDKs; raw HTTP examples only                                     |
| Changelog / versioning    | 1      | No changelog; single v2 in the URL path                                      |

**Overall documentation quality:** excellent (for the REST surface and webhooks; error bodies
and SDKs are the gaps)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (Apiary blueprint, live, 200) [CONFIRMED — API investigation 2026-05-22]
- [ ] Found OpenAPI/Swagger spec — none exists; API Blueprint format only
- [x] Identified authentication method (custom headers — Account ID + Application Key)
- [ ] Found at least one working **authenticated** example — **NOT done; no credentials** [UNKNOWN]
- [x] Identified rate limit information (60/min per application key) [DOCUMENTED]
- [x] Identified pagination approach (page + limit + `Total`; 7 endpoints only) [DOCUMENTED]
- [x] Checked for webhook/event support (31 event types; Automation module add-on required) [DOCUMENTED]
- [x] Checked for official SDKs (none exist)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Cin7 Core External API (blueprint still titled "DEAR Inventory API") [DOCUMENTED]
- **Vendor / company:** Cin7 — Core is the manufacturing/production-leaning inventory ERP
  (formerly DEAR Inventory), distinct from the retail-leaning Omni
- **Current API version:** v2 — the only active version, in the URL path [DOCUMENTED]
- **Base URL(s):** Production `https://inventory.dearsystems.com/externalapi/v2` — single shared
  SaaS host [DOCUMENTED]; Sandbox: none confirmed [UNKNOWN — check trial availability with Cin7]
- **API type:** REST, JSON only [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS only; JSON; `Content-Type: application/json` on POST/PUT bodies
  [DOCUMENTED]; UTF-8 [UNVERIFIED — standard assumption]
- **URL structure pattern:** [DOCUMENTED]

```
GET    https://inventory.dearsystems.com/externalapi/v2/{Endpoint}?{params}
GET    https://inventory.dearsystems.com/externalapi/v2/{Endpoint}?ID={guid}     single record
POST   https://inventory.dearsystems.com/externalapi/v2/{Endpoint}               body = ONE object
PUT    https://inventory.dearsystems.com/externalapi/v2/{Endpoint}               body = ONE object incl. ID
DELETE https://inventory.dearsystems.com/externalapi/v2/{Endpoint}               webhooks/Brand/Carrier only
```

- **Endpoint naming:** **singular, exact names** — `/Product`, `/Customer`, `/Sale`
  (NOT `/Products`). A 404 almost always means a misspelled endpoint name, not a missing record
  [DOCUMENTED]. The docs show both `externalapi` and `ExternalApi` path casing in examples —
  endpoint-name case sensitivity [UNVERIFIED]
- **Versioning strategy:** URL path segment (`/v2/`); no other versions live. **CORS:**
  [UNVERIFIED] — irrelevant for Numa (server-side proxy)
- **Required headers:** both auth headers (below) on **every** request — no session.
  **Response key casing:** PascalCase throughout (`Products`, `Total`, `SaleID`) [DOCUMENTED]

### 2.3 Authentication [REQUIRED]

- **Auth method:** custom HTTP request headers [DOCUMENTED] — **Location:** headers (two of them)

```
api-auth-accountid:      <account-id>
api-auth-applicationkey: <application-key>
```

There is **no Authorization header at all** — the pair rides in these two custom headers.

**How to obtain** [DOCUMENTED — Apiary blueprint]: log into Cin7 Core
(`inventory.dearsystems.com`) → **Integrations → API** → **New Application** → copy the
**Account ID** and the generated **Application Key**.

**Key facts:**

- **Account ID is per company** — multi-company customers have a different Account ID per
  company; the same Application Key cannot span companies [DOCUMENTED]
- **Rate limits are per Application Key**, not per account — multiple keys = independent
  60/min budgets [DOCUMENTED]
- **Expiry:** none — static credentials, no OAuth, no refresh. Keys can be deleted/regenerated
  in the Cin7 Core UI; doing so invalidates the old key immediately [DOCUMENTED]
- **Key format:** opaque strings (GUID-like) [UNVERIFIED]

**Auth-failure semantics (critical Core behaviour)** [DOCUMENTED]: Cin7 Core returns
**403 Forbidden for authentication failure** (wrong/revoked Account ID or Application Key) —
NOT 401, and the exact opposite of Cin7 Omni, where 403 means a missing permission toggle.
There is no per-endpoint permission model in Core: a valid pair grants full API access.

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No Cin7 Core credentials were available. The Apiary blueprint was
> retrieved live (200) [CONFIRMED — API investigation 2026-05-22], but no authenticated API call
> has ever been made. Do NOT treat response shapes below as live-verified.

**Endpoint planned for first call (when credentials are available):**

```http
GET /externalapi/v2/me HTTP/1.1
Host: inventory.dearsystems.com
api-auth-accountid: <account-id>
api-auth-applicationkey: <application-key>
```

(`/me` returns the current company/account details — tiny payload, the ideal connection probe.)

- **Expected status:** 200 with a JSON object [DOCUMENTED]; 403 = bad Account ID or Application Key
- **Live observations made (unauthenticated):** Apiary blueprint returned **200** with the full
  API Blueprint (~356KB) [CONFIRMED — API investigation 2026-05-22]

- [ ] **GATE CHECK: First successful authenticated API call completed and documented above** — **NOT DONE; blocked on credentials**

---

## Phase 3: Domain Model & Behavior

> Cin7 Core is a full inventory ERP: products, the complete sale lifecycle (quote → order →
> fulfilment → invoice → payment), purchasing, stock operations, manufacturing/production, CRM,
> and finance. All entity IDs are **GUID strings**; all dates are ISO 8601 UTC with milliseconds
> and **no `Z` suffix** (`2012-11-14T13:28:33.363`) [DOCUMENTED].

### 3.1 Core Entities [REQUIRED]

#### Entity: Product

- **Endpoint path:** `/Product` — GET (paginated list or `?ID={guid}`), POST, PUT [DOCUMENTED]
- An inventory item (SKU). Companions: `/ProductFamily` (groups, + attachments), `/Category`
  (paginated), `/ProductAvailability` (GET only — real-time stock per location).

#### Entity: Sale (the lifecycle aggregate)

- **Endpoint path:** `/Sale` (full object, `?SaleID={guid}`), `/SaleList` (paginated summary) [DOCUMENTED]
- The sale is a **state machine** spanning sub-documents, each with its own stage endpoint:
  `/SaleQuote`, `/SaleOrder`, `/SaleFulfilment` (+ Pick/Pack/Ship), `/SaleInvoice`,
  `/SaleCreditNote`, `/SalePayments`.
- **Pattern:** browse with `/SaleList` (summary rows + `Total`), drill in with
  `GET /Sale?SaleID={guid}` (full object incl. all stage sub-documents), mutate stages through
  the stage endpoints — never flip statuses directly on the parent.

#### Entity: Purchase (supplier-side twin)

- **Endpoint path:** `/Purchase` (full object) + `/PurchaseList` (paginated summary), plus
  stage endpoints `/PurchaseOrder`, `/PurchaseStockReceived`, `/PurchaseInvoice`,
  `/PurchaseCreditNote`, `/PurchasePayments` [DOCUMENTED]

#### Entity: Customer

- **Endpoint path:** `/Customer` — GET, POST, PUT (no DELETE); **NOT paginated** — returns all
  records [DOCUMENTED]

**Required fields for POST (all seven)** [DOCUMENTED]: **`Name`** (string 256 — **must be
unique across customers**), **`Status`** (`Active`/`Deprecated`), **`Currency`** (ISO 4217),
**`PaymentTerm`**, **`AccountReceivable`**, **`RevenueAccount`** (existing account codes),
**`TaxRule`** — the last four must match values already configured in the company's reference
books. Other notable fields: `ID` (GUID, required for PUT), `Discount` (integer 0–100),
`CreditLimit`, `Tags`, `AdditionalAttribute1–10`, `Addresses[]`, `Contacts[]`,
`ProductPrices[]`, `LastModifiedOn` (read-only). `/CustomerCredits` reads credit balances.

#### Other entities (summary)

| Group      | Endpoints                                                                       | Notes                                            |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Supplier   | `/Supplier` (GET/POST/PUT, NOT paginated), `/SupplierDeposits`                   |                                                  |
| Stock      | `/StockAdjustmentList`/`/StockTakeList`/`/StockTransferList` (paginated) → `/StockAdjustment`/`/StockTake`/`/StockTransfer` (GET/POST/PUT) | List/detail split |
| Production | `/ProductionOrder`, `/FinishedGoods`, `/Disassembly`, `/FactoryCalendar`         | Disassembly documents the `Errors` partial-success pattern |
| CRM        | `/Lead`, `/Opportunity`, `/Task`, `/TaskCategory`, `/Workflow`                   | Webhook events on lead/opportunity transitions   |
| Finance    | `/Journal`, `/Transactions`, `/MoneyTask`, `/BankTransfer`, `/ChartOfAccounts`   | ChartOfAccounts PUT **blocked when Xero/QBO is active** [DOCUMENTED] |
| Reference  | `/Location`, `/Brand`, `/Carrier`, `/Tax`, `/PriceTiers`, `/PaymentTerm`, `/UnitOfMeasure` | Brand/Carrier also support DELETE       |
| Webhooks   | `/webhooks` (GET/POST/PUT/DELETE)                                                | Requires the **Automation module add-on** — Phase 7 |
| Account    | `/me`                                                                            | Current company/account details — connection probe |

### 3.2 Entity Relationships [IMPORTANT]

```
Customer 1:N─> Sale ──1:1──> SaleQuote → SaleOrder → SaleFulfilment(Pick/Pack/Ship) → SaleInvoice
                  │1:N─> SalePayments / SaleCreditNote
Supplier 1:N─> Purchase ──> PurchaseOrder → PurchaseStockReceived → PurchaseInvoice (+ CreditNote/Payments)
ProductFamily 1:N─> Product 1:N─> ProductAvailability (per Location)
Location 1:N─> ProductAvailability / StockAdjustment / StockTransfer (src+dst)
ProductionOrder ──> Product (finished good);  Webhook ──> listens to entity transitions
```

### 3.3 State Machines [IMPORTANT]

**Sale lifecycle** [DOCUMENTED — webhook events fire on each transition]:

```
Draft → Quote Authorised → Order Authorised → Fulfilment (Pick/Pack/Ship) → Invoice Authorised → Paid
                                   ↓ Backordered          Voided (reachable from any stage)
```

**Purchase lifecycle** [DOCUMENTED]:

```
Draft → PO Authorised → Stock Received → Invoice Authorised → Paid   (+ Credit Note path)
```

**Disassembly statuses** [DOCUMENTED]: `DRAFT` → `WORK IN PROGRESS` (auto-picks items) →
`COMPLETED`; `VOIDED` = cancelled. Stage transitions happen through the **stage endpoints**
(`/SaleOrder`, `/SaleFulfilment`, ...). Exact transition request bodies are [UNVERIFIED] —
inferred from the blueprint's sub-endpoint structure; test before exposing writes.

### 3.4 Business Rules [IMPORTANT]

- **POST/PUT take ONE object** — not batch arrays (unlike Omni) [DOCUMENTED]
- **PUT requires the `ID` (GUID) in the body**; treat it as an object replace — resend the full
  object [UNVERIFIED partial-update behaviour]
- Customer `Name` must be **unique**; POST without all 7 required fields → 400; `PaymentTerm` /
  account codes / `TaxRule` must reference existing reference-book values [DOCUMENTED]
- **ChartOfAccounts PUT is disabled while a Xero/QuickBooks integration is active** [DOCUMENTED]
- **Partial success inside HTTP 200:** some endpoints (e.g. Disassembly) return an `Errors`
  array in a 200 body — always check after mutations. **204 = success, empty body** [DOCUMENTED]
- **Vendor guidance — queue everything:** "Never assume the API is online at any time. Always
  queue requests to the API so that you can retry…" [DOCUMENTED]
- Field gotchas: leading zeros in SKUs dropped by CSV round-trips; scientific-notation barcodes
  rejected [DOCUMENTED — bluehub.co.uk]

### 3.5 Field Format & Enum Reference [IMPORTANT]

| Format    | Pattern                            | Example                          | Notes                                  |
| --------- | ---------------------------------- | -------------------------------- | --------------------------------------- |
| DateTime  | `yyyy-MM-ddTHH:mm:ss.fff` (UTC)    | `2012-11-14T13:28:33.363`        | Milliseconds, **no `Z` suffix** [DOCUMENTED] |
| ID        | GUID/UUID string                   | `91EE7B1D-BD35-4E43-B98A-DB86BE777624` | All entity IDs [DOCUMENTED]      |
| Currency  | ISO 4217 string(3)                 | `NZD`                            | [DOCUMENTED]                            |
| Percentage| integer 0–100                      | `10`                             | Customer `Discount` [DOCUMENTED]        |
| JSON keys | PascalCase                         | `SaleID`, `Total`                | [DOCUMENTED]                            |

**Documented enums:** Customer `Status` (`Active`/`Deprecated`); Disassembly status
(`DRAFT`/`WORK IN PROGRESS`/`COMPLETED`/`VOIDED`); ChartOfAccounts `Class`
(`ASSET`/`LIABILITY`/`EXPENSE`/`EQUITY`/`REVENUE`) and `Type` (`BANK`, `CURRLIAB`, ...); webhook
`ExternalAuthorizationType` (`noauth`/`basicauth`/`bearerauth`). Stage statuses [UNVERIFIED].

---

## Phase 4: Endpoint Catalog

> Scale: ~40 entity endpoints across 11 groups (Product, Sale, Purchase, Stock, Customer,
> Supplier, Production, Reference, CRM, Finance, Webhooks) [DOCUMENTED — Apiary blueprint]. Full
> per-endpoint table: `02-api-spec-investigation.md` §Endpoint Inventory. No non-REST endpoints.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /me

Account/company details — the recommended **test-connection probe**. 200 = connected;
403 = bad credential pair.

#### Endpoint: GET /Product (the canonical paginated list)

- **Authentication:** yes — **Paginated:** page/limit (one of only 7 paginated endpoints)

```http
GET /externalapi/v2/Product?page=1&limit=100
api-auth-accountid: <account-id>
api-auth-applicationkey: <application-key>
```

**Success:** 200 with a PascalCase envelope including a **`Total`** count [DOCUMENTED]:

```json
{ "Products": [ { "ID": "guid", "SKU": "WIDGET-001", "Name": "Widget" } ], "Total": 412 }
```

**Single record:** `GET /Product?ID={guid}` — query parameter, NOT a path segment [DOCUMENTED].

#### Endpoint: GET /SaleList → GET /Sale

The workhorse pair for "what sold" — `SaleList` rows carry `SaleID`; use it to fetch the full
sale with every stage sub-document:

```http
GET /externalapi/v2/SaleList?page=1&limit=100        # summary rows + Total
GET /externalapi/v2/Sale?SaleID=91EE7B1D-BD35-4E43-B98A-DB86BE777624   # full object, all stages
```

#### Endpoint: POST /Customer

```json
{ "Name": "Acme Ltd", "Status": "Active", "Currency": "NZD", "PaymentTerm": "30 days",
  "AccountReceivable": "200", "RevenueAccount": "400", "TaxRule": "GST on Sales" }
```

- **Success:** 200 [DOCUMENTED]; response body shape [UNVERIFIED]. **Failure:** missing any of
  the 7 required fields, or duplicate `Name` → 400. **PUT:** same shape + `ID` (GUID) [DOCUMENTED]

#### Endpoint: GET /ProductAvailability · /webhooks

`/ProductAvailability` = real-time stock per product per location, read-only.
`/webhooks` = subscription CRUD (Phase 7; needs the Automation module add-on) [DOCUMENTED].

**Common error responses (all endpoints):** identical status set everywhere — see Phase 8.2.
Error body JSON shape is **undocumented** [UNKNOWN]; the blueprint notes only that the API
returns "an appropriate HTML status code, and an error message".

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?          | Syntax                                  | Notes                                          |
| ------------------------------- | ------------------- | ---------------------------------------- | ----------------------------------------------- |
| Filter by field value           | per-endpoint params | e.g. `/Sale?SaleID={guid}`               | No generic `where` grammar (unlike Omni)        |
| Filter by date range            | on some lists       | e.g. `CreatedSince=...` on `/SaleList`   | Exact param names per endpoint [UNVERIFIED]     |
| Full-text search / generic sort | no                  | —                                        | [UNVERIFIED — none documented]                  |
| Field selection / sparse fields | no                  | —                                        | Full DTOs always returned                       |
| Aggregate / count               | `Total` on lists    | paginated responses only                 | [DOCUMENTED]                                    |

### 5.2 Filter Syntax & Common Patterns [REQUIRED]

Cin7 Core has **no generic filter grammar** — each endpoint documents its own query parameters
(ID lookups like `?ID={guid}` / `?SaleID={guid}`, plus list filters such as date-range
parameters on `/SaleList`). Exact filter parameter names per list endpoint are [UNVERIFIED] —
confirm live before the agent relies on them.

```http
GET /externalapi/v2/me                                  # 1 — connection probe
GET /externalapi/v2/Product?page=1&limit=100            # 2 — paginated walk: Total=412 → ceil(412/100) pages
GET /externalapi/v2/SaleList?page=1&limit=100           # 3 — sale browse...
GET /externalapi/v2/Sale?SaleID={guid}                  #     ...then drill-in (ID via query param)
GET /externalapi/v2/ProductAvailability                 # 4 — real-time stock
GET /externalapi/v2/PaymentTerm                         # 5 — reference books before a Customer create (+ /Tax, /ChartOfAccounts)
GET /externalapi/v2/SaleList?page=1&limit=100&CreatedSince=2026-05-01T00:00:00.000   # [UNVERIFIED param name]
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number (`page` + `limit`); default 100, min 1, max 1000 [DOCUMENTED]
- **Total count available:** **YES** — every paginated response carries a `Total` field
  (the big difference from Cin7 Omni) [DOCUMENTED]
- **How to detect last page:** `pages_needed = ceil(Total / limit)`; stop when `page` exceeds it

⚠️ **Only SEVEN endpoints support pagination** [DOCUMENTED]: `SaleList`, `PurchaseList`,
`StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category`.
**Every other endpoint returns ALL records in one response** — Customers, Suppliers, etc. can
produce very large payloads. Never assume `page`/`limit` worked elsewhere [UNVERIFIED whether
unsupported params are ignored or rejected].

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /externalapi/v2/Product?page=1&limit=200   → 200 rows, Total: 412
Page 3: GET /externalapi/v2/Product?page=3&limit=200   → 12 rows → stop (3 = ceil(412/200))
```

(Each page is a separate request against the 60/min budget — pace at ~1 req/sec.)

### 6.3 Bulk Operations [IMPORTANT]

**There is no batch-write API** — POST/PUT take ONE object per request [DOCUMENTED]; bulk reads
use the 7 paginated lists at `limit=1000` max. Bulk loads = one request per record at ≤60/min —
a 600-record import takes ≥10 minutes. **Partial failure:** single-object writes succeed or
fail whole, EXCEPT endpoints that return an `Errors` array inside a 200 (e.g. Disassembly).

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

None — no export endpoints, no async jobs. Large pulls = paginated GETs (where supported) or
single all-records responses (everywhere else).

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                 | Supported?            | Notes                                                       |
| ------------------------- | --------------------- | ------------------------------------------------------------ |
| Webhooks (outbound)       | **YES — 31 event types** [DOCUMENTED] | Requires the **Automation module add-on** — not on all plans |
| WebSocket / SSE / change feeds | no               |                                                              |

(Contrast: Cin7 **Omni** has no outbound webhooks at all.)

### 7.2 Webhook Details [DOCUMENTED]

- **Management:** full CRUD on `/webhooks`. **Fields:** `ID` (GUID, required for PUT), `Type`,
  `IsActive`, `ExternalURL`, `ExternalAuthorizationType` (`noauth`/`basicauth`/`bearerauth`),
  `ExternalUserName`/`ExternalPassword`, `ExternalBearerToken`, `ExternalHeaders[]`
- **Limit:** max **5 webhooks of the same type** simultaneously
- **Retry schedule:** 6 attempts — 1m after the event, then +5m, +10m, +15m, +20m, +25m;
  after 6 failures the webhook is **silently auto-deactivated** (`IsActive: false`) — must be
  monitored and reactivated via PUT
- **Payloads are thin notifications** — IDs + `EventType` (e.g. `{ "SaleID": "...",
  "EventType": "Sale/OrderAuthorised" }`); call the API for full entity data

**Event types (31)** [DOCUMENTED]: Sale ×16 (`Sale/Created`, `Sale/QuoteAuthorised`,
`Sale/OrderAuthorised`, `Sale/Voided`, `Sale/Backordered`, ship/invoice/pick/pack/credit-note
authorised, `Sale/Undo`, partial/full payment received, attachment/attributes/tracking
changes); Purchase ×5 (order/invoice/stock-received/credit-note authorised,
`Purchase/Updated`); `Customer/Updated`; `Supplier/Updated`; `Product/Updated`;
`Stock/AvailableStockLevelChanged`; CRM ×6 (lead updated/converted, opportunity
authorized/attachment/voided/converted); `Task/Overdue`. Full list in `01d`.

### 7.3 Numa Applicability [IMPORTANT]

**Numa has no webhook receiver for this connector** — webhook CRUD through the agent manages
the *customer's own* endpoints, not Numa's. For in-chat change detection, **poll** `/SaleList`
/ `/PurchaseList` (date-range filter param names [UNVERIFIED]) — the 60/min budget is far
roomier than Omni's 5,000/day, but still pace at ~1 req/sec.

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope               | Limit       | Window | Notes                                                        |
| ------------------- | ----------- | ------ | ------------------------------------------------------------- |
| Per Application Key | **60 requests** | minute | No per-second or per-day limit documented [DOCUMENTED]    |

- Limits are **per key** — a dedicated Application for Numa isolates its budget [DOCUMENTED].
  Rate-limit headers / `Retry-After`: none documented [UNKNOWN — needs a live 429]
- **Backoff strategy:** ~1 req/sec baseline keeps under 60/min; on 429 back off
  1s → 5s → 30s → 2m, then defer to the next minute window

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** [UNKNOWN] — the blueprint says only that the API returns
"an appropriate HTML status code, and an error message". Parse defensively: status code first,
then try JSON, fall back to raw text.

| HTTP Status | Meaning                                                | Retryable? | Recovery Action                                       |
| ----------- | ------------------------------------------------------- | ---------- | ------------------------------------------------------ |
| 200         | OK — but check the body for an `Errors` array           | —          | Process; surface partial failures                      |
| 204         | No Content — success, empty body                        | —          | Treat as success; don't JSON-parse                     |
| 400         | Validation failure or malformed request                 | No         | Fix the payload; never blind-retry                     |
| 403         | **Authentication failure** (wrong/revoked key pair)     | No         | Re-enter credentials (chat card) — NOT a permission issue |
| 404         | Wrong endpoint name (e.g. `/Products` vs `/Product`)    | No         | Check exact singular endpoint spelling                 |
| 405         | Method not allowed (e.g. PUT on a read-only `…List`)    | No         | Check the endpoint's CRUD support                      |
| 429         | Rate limited (60/min)                                   | Yes        | Backoff per 8.1                                        |
| 500         | Server error / object could not be parsed               | Cautiously | Check request format; retry once with backoff          |

### 8.3 Idempotency [IMPORTANT]

No idempotency keys. GET: idempotent. PUT: re-sends safe (ID-addressed object replace).
**POST retries create duplicates** — except `/Customer`, where the unique-`Name` rule 400s the
duplicate (an accidental dedup guard). Vendor guidance mandates queue+retry around network
failures — pair it with query-before-retry for mutations (e.g. search `/Customer` by `Name`
after a write timeout).

### 8.4 Async Operations / 8.5 File Handling [IMPORTANT]

- **Async:** none — all synchronous.
- **Files:** `/ProductAttachments` and sale/opportunity attachment events exist; upload
  mechanics are [UNVERIFIED] — do not expose file upload through Numa until tested.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

No etag/version fields documented; last-write-wins assumed [UNVERIFIED]. `LastModifiedOn`
timestamps carry milliseconds — finer-grained than Omni's seconds.

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — registry `authType: api-key` **with a `credentialHeaderMap`**, NOT Pipedream,
NOT OAuth. (Not a file source — Data Connector (Files) and Hybrid paths don't fit; inventory
data, not documents.)

**Justification:** Cin7 Core's two-custom-header auth doesn't fit Bearer-token or Basic-auth
backends. The registry's `credentialHeaderMap` — `{"api-auth-accountid": "account_id",
"api-auth-applicationkey": "application_key"}` — maps each custom header to a per-user
credential field, and the backend (`_user_connector_header_creds`) builds **both** headers from
the user's vault on every request, all-or-nothing. The admin contributes metadata only.

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector: "cin7-core", url: "/Product?page=1&limit=100", method: "GET"})
  → backend resolves base_url https://inventory.dearsystems.com/externalapi/v2 (connector-config-cin7-core)
  → injects api-auth-accountid + api-auth-applicationkey (user vault: connector-cin7-core.account_id + .application_key)
  → forwards; the agent never sees the credentials
```

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A.

- **Auth type for connector:** `api-key` with `credentialHeaderMap` — per-user `account_id` +
  `application_key` in the user's personal vault, captured via the inline chat credential card
- **Per-client config:** none — fixed SaaS base URL from the registry; wizard instance URL
  stays empty. **Category:** Inventory; standard project-management caching preset
- **Cin7-side prerequisite:** an API Application created under Integrations → API; for webhooks
  (customer's own endpoints), the Automation module add-on

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Answer inventory/data questions: products, real-time stock per location, sales (list +
   drill-in), purchases, customers, suppliers, stock ops, production, CRM, reference books
2. Drive the sale/purchase lifecycle on explicit user request via the stage endpoints
   (bodies [UNVERIFIED] — confirm live before exposing writes)
3. Create/update records: customers (validating the 7 required fields + reference-book values
   first), suppliers, products
4. Manage the customer's webhook subscriptions (list/create/reactivate) when the Automation
   module is present; connection diagnostics via `GET /me`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Receive webhooks into Numa — no receiver exists; in-chat events = polling
2. Paginate the non-paginated endpoints — expect full-dataset payloads; summarize, never dump
3. Update ChartOfAccounts while a Xero/QBO integration is active
4. DELETE business documents — voiding goes through the status workflow; DELETE exists only on
   `/webhooks`, `/Brand`, `/Carrier`
5. Skip lifecycle stages on sales/purchases, or exceed 60 requests/minute per key

**Default parameters:** `page=1`, `limit=100` (max 1000 when bulk-reading); pace at ~1 req/sec
to stay under 60/min.

### 9.4 SDK Assessment [NICE-TO-HAVE]

Unofficial `cin7-core-api-sdk` only — not worth depending on. Raw HTTP via the generic
`request` proxy suffices.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified, Apiary blueprint retrieved live, quality assessed
- [ ] Phase 2 **partially**: auth model fully documented; **authenticated first-call gate NOT passed (no credentials)**
- [x] Phases 3–4 complete: entities + required fields + lifecycles + critical endpoints from the
  blueprint; stage bodies outstanding
- [x] Phases 5–6 complete: per-endpoint query model (no generic grammar); page/limit + `Total`
  pagination (7 endpoints only); single-object writes
- [x] Phase 7 complete: 31 webhook events + retry/deactivation model; Numa polling fallback
- [x] Phase 8 complete: rate limit exact; error bodies UNKNOWN, flagged for live verification
- [x] Phase 9 complete: integration path selected (Direct API, api-key connector + credentialHeaderMap)

**Overall investigation confidence:** **medium** — endpoint and webhook coverage is excellent
(live blueprint), but zero authenticated validation, undocumented error bodies, and unverified
stage-transition bodies cap it.

**Known gaps that will reduce output quality:**

1. **No authenticated call ever made** — error body shapes, 429 Retry-After, list filter
   parameter names, and stage-transition bodies all need a credentialed test
2. Error response body JSON format undocumented (both Cin7 products share this gap)
3. Sandbox/trial account availability unconfirmed — every call hits live company data
4. Sale/purchase stage-transition bodies inferred; attachment/file upload mechanics unverified

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):
**01-llm-api-rules** (Phases 2/4/8/9 — MUST open with the not-live-validated banner + the
two-product warning; emphasise 403=auth-failure and the 7-paginated-endpoint rule) ·
**01a** (Phase 3) · **01b** (Phases 5–6) · **01c** (Phases 3.4 + 4: single-object writes,
required Customer fields, stage endpoints, `Errors`-in-200) · **01d** (Phases 7–8) ·
**02-api-spec-investigation** (all phases condensed) · **03-connector-setup** (Phase 9 — real
registry/wizard/backend wiring incl. `credentialHeaderMap`) · **04-connection-and-reauth**
(Phase 2.3 + lifecycle: no expiry, 403 reconnect semantics).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                        |
| ---------------------------- | ------------- | ----------- | ------------------------------------------------------------ |
| 01-llm-api-rules             | yes           | medium      | Error bodies unknown; stage bodies unverified                 |
| 01a-domain-model-reference   | yes           | medium-high | Customer/CoA fields solid; stage status enums missing         |
| 01b-query-patterns           | yes           | medium-high | Pagination exact; list filter param names unverified          |
| 01c-mutation-patterns        | yes           | medium      | Single-object writes documented; transition bodies inferred   |
| 01d-event-and-error-handling | yes           | high        | Webhook model fully documented; error bodies flagged          |
| 02-api-spec-investigation    | yes           | medium-high | Endpoint inventory complete from the live blueprint           |
| 03-connector-setup           | yes           | high        | api-key + credentialHeaderMap connector; wiring is real code  |
| 04-connection-and-reauth     | yes           | high        | Auth lifecycle simple and fully documented                    |

---

_Compiled 2026-06-10 from the Numa API investigation of 2026-05-22 (live retrieval of the
official Cin7 Core / DEAR Inventory Apiary blueprint) — split from the combined two-product
investigation into this Core-only pack. **No authenticated call has been made — re-validate
flagged items with real credentials before first customer use.**_
