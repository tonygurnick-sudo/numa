---
api_name: 'Jiwa Financials REST API'
api_slug: 'jiwa'
vendor: 'Jiwa Financials (Australia)'
website: 'https://www.jiwa.com.au'
investigation_started: '2026-06-10'
investigator: 'Claude Code (spec + official wiki only — NO live test instance)'
investigation_status: 'blocked' # docs/spec research complete; Phase 2.4 live-call gate NOT passed
documentation_quality: 'good'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No live test instance available — every answer is docs/spec-derived, none live-verified'
  - 'Per-customer self-hosted deployment: enabled plugins, route permissions, and Jiwa version (7 vs 8) vary per install'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: Jiwa Financials

> **Source:** Official OpenAPI specification pulled from `https://api.jiwa.com.au/openapi`
> (Swagger 2.0, **816 paths / 1,381 operations / 2,022 DTO definitions**) plus Jiwa's official
> Atlassian wiki (space `J7UG`): "About the REST API", "Consuming the REST API",
> "Sales Order API Operations — Examples Of Use" (page 882967536),
> "Debtor API Operations — Examples Of Use" (page 882967390), "Open API Specification" (882967642).
> A public Swagger UI is embedded at https://jiwa.com.au/swagger/.
>
> ⚠️ **NO TEST INSTANCE was available.** Nothing here is live-verified. The only live observation
> made during research: `GET https://api.jiwa.com.au/Debtors` without auth returns **401 with an
> empty body** (instance is Cloudflare-fronted).
>
> **Confidence markers (per repo convention for this connector):**
>
> - `[DOCS]` — stated in Jiwa's official wiki documentation
> - `[SPEC]` — extracted from the official OpenAPI specification document
> - `[UNVERIFIED]` — inferred; must be checked against a real instance before relied upon
>
> (`[CONFIRMED]` is deliberately absent — there were no live tests.)

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** Jiwa Atlassian wiki, space `J7UG` — "About the REST API" + "Consuming the REST API" pages [DOCS]
- **API reference / endpoint catalog URL:** `https://{instance}/openapi` (OpenAPI document, served by the REST API itself when the "REST API OpenAPI" plugin is enabled); public copy at `https://api.jiwa.com.au/openapi`; Swagger UI embedded at `https://jiwa.com.au/swagger/` [DOCS]
- **Authentication guide URL:** "Consuming the REST API" wiki page (Authenticating section) [DOCS]
- **Changelog / release notes URL:** None found for the API itself. The REST API plugin version ships with each Jiwa service release (`JiwaAPI.zip` in the Jiwa program directory) [DOCS]
- **Status page URL:** None — every customer self-hosts their own instance [DOCS]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** `https://{instance}/openapi` — Swagger 2.0, title `JiwaAPI`, version `1.0` [SPEC]
- **Postman collection URL:** None official found
- **Official SDK repositories:** No published SDK repos, but ServiceStack typed clients are first-class: the instance serves generated DTOs at `/types/csharp`, `/types/vbnet`, `/types/fsharp`, `/types/typescript`, `/types/java`, `/types/kotlin`, `/types/swift` [DOCS]
- **Official blog / engineering blog:** Jiwa wiki "Related articles" (labels `restapi`, `consume`) [DOCS]
- **Community forums / Stack Overflow tag:** Negligible community footprint; rely on the wiki + spec
- **Other:** Jiwa has announced an official **MCP server** built on this REST API (announced, not shipped) [DOCS]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                     |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Both auth methods (session + API key) clearly documented with curl/C# examples [DOCS]                     |
| Endpoint reference        | 5      | Full machine-readable OpenAPI spec; every route, parameter, and DTO present [SPEC]                        |
| Request/response examples | 4      | Wiki "Examples Of Use" pages give real request bodies for Debtors and Sales Orders; other tags spec-only  |
| Error documentation       | 3      | Status-code semantics documented; actual error **body shapes** not shown anywhere [DOCS]                  |
| Rate limit documentation  | 3      | Clear: none by default; optional per-IP "REST API Rate Limit" plugin [DOCS]                               |
| Pagination documentation  | 4      | AutoQuery Skip/Take/Include=Total documented with worked examples [DOCS]                                  |
| Webhook documentation     | 3      | System settings + routes documented; payload shape, signing, and event payloads not shown [DOCS]          |
| SDKs / code examples      | 4      | ServiceStack typed-client generation in 7 languages; C#/curl/browser examples on wiki [DOCS]              |
| Changelog / versioning    | 1      | No API changelog; spec is `version: 1.0` with no versioning strategy [SPEC]                               |

**Overall documentation quality:** good

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (Jiwa Atlassian wiki)
- [x] Found OpenAPI/Swagger spec (`/openapi`, Swagger 2.0, 816 paths)
- [x] Identified authentication method (session via `/auth` OR API key Bearer — see 2.3)
- [ ] Found at least one working example — **NOT live-verified; wiki examples only** [DOCS]
- [x] Identified rate limit information (none by default; optional plugin) [DOCS]
- [x] Identified pagination approach (ServiceStack AutoQuery Skip/Take on `/Queries/*`) [DOCS]
- [x] Checked for webhook/event support (built in — 18 ops under the Webhooks tag) [SPEC]
- [x] Checked for official SDKs (ServiceStack generated clients via `/types/*`) [DOCS]

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Jiwa REST API (spec title `JiwaAPI`) [SPEC]
- **Vendor / company:** Jiwa Financials — Australian ERP focused on inventory/distribution; SQL Server 2016+ backed [DOCS]
- **Current API version:** `1.0` (spec); the API is a Jiwa **plugin** versioned with each Jiwa service release. REST API requires **Jiwa 8.00.00+** (API keys exist from Jiwa 7.2+) [DOCS]
- **Base URL(s):**
  - Production: **per-customer instance URL** — every customer self-hosts (e.g. `https://erp.customer.com.au/`). There is NO shared SaaS host. `api.jiwa.com.au` is Jiwa's own hosted instance used for the public spec/demos [DOCS]
  - Sandbox / testing: None public. Jiwa ships a "Jiwa Demo Database" customers can point a service at [DOCS]
- **API type:** REST (ServiceStack framework; DTO-in / DTO-out message pattern) [DOCS]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (per spec `schemes: [https]`; in practice a Windows cert binding on the self-hosted service — see Phase 9 hosting notes) [SPEC][DOCS]
- **Data format:** JSON by default; XML and CSV also supported via content negotiation [DOCS]. Spec `consumes`: `application/x-www-form-urlencoded`, `application/json`, `application/xml`; `produces`: `application/json`, `application/xml` [SPEC]
- **Content-Type header(s):** `application/json` for request bodies; response format negotiable via `Accept`, `?format=json|xml|csv`, or a `.json`/`.xml`/`.csv` route suffix (e.g. `/Debtors/{DebtorID}.json`) [DOCS]
- **Character encoding:** UTF-8 [UNVERIFIED — not stated; ServiceStack default]
- **URL structure pattern:** [DOCS]

```
https://{instance}/{PluralResource}/{RecID}                       (GET / PATCH / DELETE)
https://{instance}/{PluralResource}                               (POST — server generates the RecID)
https://{instance}/{PluralResource}/{RecID}/{ChildPlural}/{ChildRecID}   (nested relational data)
https://{instance}/Queries/{ViewName}?...                         (AutoQuery read-only list routes)
```

- **Versioning strategy:** None — no version segment, header, or query param [SPEC]
- **CORS policy:** [UNVERIFIED] — not documented; irrelevant for Numa (server-side proxy)
- **Required headers (all requests):**

| Header          | Value                          | Purpose                                                                     |
| --------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `Authorization` | `Bearer {api-key}`             | API-key auth (the method Numa uses) [DOCS]                                  |
| `Content-Type`  | `application/json`             | On POST/PATCH/PUT bodies [DOCS]                                             |
| `Accept`        | `application/json`             | Recommended — browsers otherwise get an HTML razor view [DOCS]              |
| `Cookie: ss-id` / `X-ss-id` | `{SessionId}`      | ONLY for session (username/password) auth — not used by Numa [DOCS]         |

- **Important quirk:** if no content-type override is supplied, a browser-like `Accept` yields an **HTML razor view** of the data instead of JSON. Always send `Accept: application/json` (or `?format=json`) [DOCS]

### 2.3 Authentication [REQUIRED]

> Two methods exist. **Numa uses API Key (Bearer) only** — it maps 1:1 onto the existing
> token-connector backend (header injection from the user vault, zero new auth code).

- **Auth method:** API key (Bearer token) — alternative: session auth via `/auth` [DOCS]
- **Auth location:** Header
- **Auth header format:**

```
Authorization: Bearer {api-key}
```

**Method 1 — API Key (Jiwa 7.2+) — THE METHOD NUMA USES [DOCS]:**

- **No authentication step.** Supply the key on every request as an HTTP **Bearer token**, via HTTP **Basic**, or as a URL/form parameter (avoid the URL form — it leaks into request logs).
- Keys are associated with a **Jiwa staff member**; all permissions are exactly that staff member's — identical to logging in with their username/password.
- Keys can carry an **expiration date** and can be **revoked** (un-ticking Enabled). Expired/revoked key → `401 Not Authenticated` [DOCS].
- **Two key types** [DOCS]:
  - **Staff API Keys** — created in the **Staff Maintenance** form; an alternate credential for a staff member. → This is what each Numa user supplies (per-user secret).
  - **Debtor API Keys** — intended for **customers** (web portals); linked to a debtor AND a nominated staff user; the wiki explicitly says requests made with them must not be trusted, and the plugin applies request/response filtering (cost stripping, DebtorID scoping). **NOT for Numa connectors — recommend Staff keys only.**
- Security guidance from the wiki: don't give admin users API keys; only allow the routes actually needed [DOCS].

**Method 2 — User credentials / session (NOT used by Numa) [DOCS]:**

- `POST /auth` (or GET with URL params) with `UserName` + `Password` → `AuthenticateResponse` containing `SessionId` (also `UserId`, `DisplayName`, `BearerToken`, `RefreshToken` fields per the spec — JWT usability [UNVERIFIED]) [SPEC]
- Subsequent requests carry `Cookie: ss-id={SessionId}` or header `X-ss-id: {SessionId}`.
- Sessions expire after `SessionExpiryInMinutes` of inactivity (system setting). `GET /KeepAlive` extends a session; `GET /auth/logout` ends it [DOCS].

**For API Key auth:**

- **How to obtain:** Jiwa administrator creates a Staff API Key in the Staff Maintenance form, per user [DOCS]
- **Key format / pattern:** [UNVERIFIED] — not documented; treat as an opaque string
- **Rate limits per key:** None by default (see Phase 8) [DOCS]
- **Key rotation procedure:** Create a new key / set expiry / disable old key in Staff Maintenance; no API-driven self-rotation found in the spec [DOCS][SPEC]

**Auth failure semantics [DOCS]:**

- `401 Not Authenticated` — no/bad/expired/revoked credentials (observed once live: empty body on the hosted instance)
- `403 Forbidden` — authenticated, but the User Group route permissions deny the route (Jiwa-side configuration — see Phase 9)

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No test instance was available, so no authenticated call has ever been
> made. Do NOT treat any request/response shape in this pack as live-verified.

**Endpoint planned for first call (when an instance is available):**

```http
GET /SystemInfo HTTP/1.1
Host: {instance}
Authorization: Bearer {staff-api-key}
Accept: application/json
```

**Expected response (from the spec — `SystemInformationGETResponse`)** [SPEC]:

```json
{
  "JiwaVersion": "…",
  "JiwaRESTAPIPluginVersion": "…",
  "ServiceStackVersion": "…",
  "DatabaseName": "…",
  "LicensedCompany": "…",
  "CurrencyShortName": "AUD",
  "MoneyDecimalPlaces": 2
}
```

- **HTTP status code:** expected 200 [SPEC]
- **The only live observation made:** unauthenticated `GET https://api.jiwa.com.au/Debtors` → **401, empty body**, Cloudflare-fronted.
- **Gotchas expected during setup:** REST API plugin must be enabled in Plugin Maintenance; route permissions must be imported/allowed for the key's User Group; instance must be internet-reachable with a valid cert (see Phase 9).

- [ ] **GATE CHECK: First successful API call completed and documented above** — **NOT DONE; blocked on test instance**

---

## Phase 3: Domain Model & Behavior

> Jiwa is a full distribution ERP. The API exposes ~37 resource families (spec tags). The core
> commercial entities below are the ones Numa users will actually ask about. All field lists are
> [SPEC] extracts (top-level DTO properties; large DTOs truncated to the decision-relevant fields).

### 3.1 Core Entities [REQUIRED]

#### Entity: Debtor (= Customer)

- **API resource name / endpoint path:** `/Debtors/{DebtorID}` (+ ~30 child collections)
- **Description:** A customer account (accounts receivable). Jiwa calls customers "debtors".
- **CRUD support:** Create (`POST /Debtors`) / Read / Update (`PATCH`) / Delete (`DELETE`) [SPEC]

**Fields (selected from 87 properties)** [SPEC]:

| Field             | Type            | Required? | Writable? | Description                                | Example Value            |
| ----------------- | --------------- | --------- | --------- | ------------------------------------------ | ------------------------ |
| DebtorID          | string (RecID)  | —         | no        | Primary key, server-generated              | `0000000061000000001V`   |
| AccountNo         | string          | no\*      | yes       | Human account code (\*auto-generated if omitted, but usual practice is to supply it [DOCS]) | `CASH001` |
| Name              | string          | no        | yes       | Customer name                              | `A new customer`         |
| EmailAddress      | string          | no        | yes       |                                            | `name@example.com`       |
| Address1–4 / Postcode / Country / Phone / Fax | string | no | yes | Postal details              |                          |
| ABN / ACN         | string          | no        | yes       | Australian business identifiers            |                          |
| CreditLimit       | number          | no        | yes       |                                            | `10000`                  |
| AccountOnHold     | boolean         | no        | yes       |                                            | `false`                  |
| CurrentBalance / Period1–4Balance | number | —      | no        | Computed balances                          |                          |
| TradingStatus / TermsDays / TermsType | mixed | no   | yes       | Trading terms                              |                          |
| WebAccess         | boolean         | no        | yes       | Web-portal flag (used in DebtorList query) | `true`                   |
| LastSavedDateTime | date-time       | —         | no        | **Change-detection field**                 |                          |
| ContactNames / DeliveryAddresses / Notes / Documents / CustomFieldValues / GroupMemberships / TagMemberships | arrays | no | yes | Child collections — writable inline on POST/PATCH |  |

**Relationships:**

| Related Entity   | Relationship Type | How Expressed                                       | Notes                                  |
| ---------------- | ----------------- | ---------------------------------------------------- | -------------------------------------- |
| ContactName      | one-to-many       | sub-resource `/Debtors/{id}/ContactNames` AND nested | Inline create/update supported [DOCS]  |
| DeliveryAddress  | one-to-many       | sub-resource + nested                                |                                        |
| SalesOrder       | one-to-many       | `DebtorID` reference on the order                    |                                        |
| Classification / Category1–5 / PricingGroup | many-to-one | nested objects / lookup routes |                                        |
| Backorders       | one-to-many       | `GET /Debtors/{id}/Backorders`                       | Read-only convenience view             |

#### Entity: InventoryItem (= Product)

- **API resource name / endpoint path:** `/Inventory/{InventoryID}` (+ ~25 child collections; the **largest tag — 176 ops**)
- **Description:** A product/SKU including pricing, stock, suppliers, BOM components, images.
- **CRUD support:** Create / Read / Update (`PATCH`) / Delete [SPEC]

**Fields (selected from 89 properties)** [SPEC]:

| Field             | Type           | Required? | Writable? | Description                              | Example  |
| ----------------- | -------------- | --------- | --------- | ----------------------------------------- | -------- |
| InventoryID       | string (RecID) | —         | no        | Primary key                               | `000000000K00000000BV` |
| PartNo            | string         | yes [UNVERIFIED] | yes | Human part number — accepted as an alternative to InventoryID in sales-order lines [DOCS] | `1170` |
| Description       | string         | no        | yes       |                                           |          |
| DefaultPrice / RRPPrice | number   | no        | yes       | Sell prices                               |          |
| LCost / SCost / StandardCost / UnitCost | number | — | partially | **Cost fields — stripped for Debtor-key callers** [DOCS] | |
| Status            | string         | no        | yes       |                                           |          |
| PhysicalItem / BackOrderable / WebEnabled / UseSerialNo / UseExpiryDate | boolean | no | yes | Behavior flags |  |
| Classification / Category1–5 / Style / Colour / Size | objects | no | yes | Taxonomy            |          |
| LastSavedDateTime | date-time      | —         | no        | Change detection                          |          |

**Relationships:** Suppliers per Region (`/Inventory/{id}/Regions/{name}/Suppliers`), BOM `Components`, `AlternateChildren`/`AlternateParents`, price lists (`DebtorSpecificPrices`, `DebtorClassificationPrices`, `DebtorPriceGroupPrices`), `UnitOfMeasures`, `Images`, `Documents`, `Notes`, stock (`/Queries/IN_SOH`, `ProductAvailabilities`).

#### Entity: SalesOrder

- **API resource name / endpoint path:** `/SalesOrders/{InvoiceID}` (82 ops)
- **Description:** A sales order/invoice. **Snapshot model:** each order has `Historys` (snapshots); lines live UNDER a history: `/SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}` [SPEC]
- **CRUD support:** Create (`POST /SalesOrders`) / Read / Update (`PATCH`) / no top-level DELETE (only `Cache`, child lines, notes, payments are deletable) [SPEC]

**Fields (selected from 105 properties)** [SPEC]:

| Field              | Type           | Required?      | Writable? | Description                                         |
| ------------------ | -------------- | -------------- | --------- | ---------------------------------------------------- |
| InvoiceID          | string (RecID) | —              | no        | Primary key, server-generated                        |
| InvoiceNo          | string         | —              | no        | Human order number                                   |
| DebtorID / DebtorAccountNo | string | one of them    | at create | Either resolves the customer; DebtorID wins if both supplied [DOCS] |
| InitiatedDate / ExpectedDeliveryDate | date-time | no | yes  |                                                      |
| OrderNo / SOReference | string      | no             | yes       | Customer PO no. / freetext reference                 |
| Status / SalesOrderType / OrderType | string | —     | partially | Lifecycle fields [UNVERIFIED semantics]              |
| Lines              | array          | no             | yes       | Order lines — inline on POST/PATCH (see rules below) |
| Payments / Notes / Documents / CustomFieldValues | arrays | no | yes | Child collections                       |
| LogicalID / LogicalWarehouseDescription / PhysicalWarehouseDescription | string | no | yes | Warehouse routing |
| CreditNote         | boolean        | no             | at create | Credit-note flag                                     |

**SalesOrderLine key fields** [SPEC][DOCS]: `InvoiceLineID` (omit to append, supply to update), `InventoryID` OR `PartNo` (InventoryID wins), `QuantityOrdered`, `DiscountedPrice` (omit → Jiwa pricing engine sets the price), `CommentLine`+`CommentText` for comment lines, `CustomFieldValues[]` (per-line custom fields), computed `LineTotal`, `TaxToCharge`, `QuantityBackOrd`, `QuantityThisDel`.

**Relationships:** Debtor (N:1), Historys (1:N snapshots) → Lines (1:N) → LineDetails (1:N), Payments, Carrier ConsignmentNotes/FreightItems per history, Notes/Documents.

#### Entity: Creditor (= Supplier) — and the procurement chain

- `/Creditors/{CreditorID}` (56 ops): supplier accounts, mirror of Debtors (Classifications, Documents, Notes, Tags, WarehouseAddresses) [SPEC]
- Procurement flow entities: **PurchaseOrders** (35) → **Shipments** (48) / **GoodsReceivedNotes** (51) → **PurchaseInvoices** (38), each with `Activate/{id}` action routes and `From*` constructors (e.g. `POST /GoodsReceivedNotes/FromPurchaseOrders/{OrderNos}`) [SPEC]

#### Other notable entities [SPEC]

| Entity family     | Ops | Notes                                                                       |
| ----------------- | --- | ---------------------------------------------------------------------------- |
| Service Manager   | 112 | Service jobs → tasks → labour/part lines; `ProcessSalesOrder`/`ProcessCreditNote`/`Retire` actions |
| Work Orders       | 105 | Manufacturing: stages, inputs, outputs, wastage line details                 |
| Bills             | 70  | Bills of materials: stages, inputs, instructions, outputs                    |
| Journal Sets      | 39  | GL journals with lines                                                       |
| Staff             | 37  | Departments, timesheets, `GET /Sessions`, `GET /UserSettings`                |
| Sales Quotes      | 44  | Same snapshot model as orders + `MakeOrder` / `MakeOrderB2B` conversion      |
| To Dos            | 19  | Task list with collaborations and dependencies                              |
| Email Messages    | 15  | Stored email messages + attachments                                          |
| Carriers / Currencies / TaxRates / Regions / Languages | ~50 | Reference data                          |

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────┐ 1:N  ┌──────────────┐ 1:N ┌───────────────┐ 1:N ┌──────────────┐
│  Debtor  │─────>│  SalesOrder  │────>│ History(snap) │────>│ Line         │
└──────────┘      └──────────────┘     └───────────────┘     └─────┬────────┘
     │ 1:N                │ 1:N                                    │ N:1
     ▼                    ▼                                        ▼
┌──────────────┐   ┌────────────┐                          ┌───────────────┐
│ ContactNames │   │ Payments / │                          │ InventoryItem │
│ DelivAddrs   │   │ Notes/Docs │                          └───────┬───────┘
└──────────────┘   └────────────┘                                  │ 1:N
                                                                   ▼
┌──────────┐ 1:N ┌───────────────┐ 1:N ┌─────────────┐   ┌──────────────────┐
│ Creditor │────>│ PurchaseOrder │────>│ GRN/Shipment│──>│ PurchaseInvoice  │
└──────────┘     └───────────────┘     └─────────────┘   └──────────────────┘
```

Every transactional entity also hangs `Notes`, `Documents`, and `CustomFieldValues` collections off it, with per-entity `NoteTypes` / `DocumentTypes` lookup routes [SPEC].

### 3.3 State Machines [IMPORTANT]

> Lifecycle handling is exposed via **action routes**, not status PATCHes. Exact state names/values
> are [UNVERIFIED] — the spec exposes the verbs, not the state charts.

| Entity                  | Action route(s)                                                       | Meaning [DOCS/SPEC]                                            |
| ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| SalesOrder              | `GET /SalesOrders/{InvoiceID}/Process`                                | Posts journals + debtor transactions ("processing") [DOCS]      |
| SalesOrder (stateful)   | `GET /SalesOrders/{InvoiceID}/Save`, `DELETE …/Abandon`               | Stateful edit-session save/abandon [DOCS]                       |
| SalesQuote              | `POST /SalesQuotes/{QuoteID}/MakeOrder` / `MakeOrderB2B`              | Quote → order conversion [SPEC]                                 |
| GRN / Shipment / PurchaseInvoice / BookIn / StockTransfer / WarehouseTransfer | `POST /{family}/Activate/{id}` | Draft → activated (posts the document) [SPEC; semantics UNVERIFIED] |
| ServiceManager Task     | `POST …/Retire`, `POST …/Unretire`, `…/ProcessSalesOrder`, `…/ProcessCreditNote` | Task lifecycle + billing handoff [SPEC]            |
| WorkOrder               | `POST /WorkOrders/Reversal`                                           | Reversal document [SPEC]                                        |

⚠️ Treat `Process` and `Activate/*` routes as **financially significant, hard-to-undo operations** — they post to the GL. The Numa LLM rules must require explicit human confirmation before calling them.

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules [DOCS]:**

- Sales-order lines/notes/payments can be created inline within a single `POST /SalesOrders` or `PATCH /SalesOrders/{id}` — no need for separate child calls.
- A GRN can be constructed from purchase orders (`FromPurchaseOrders/{OrderNos}`); a purchase invoice from GRNs (`FromGoodsReceivedNotes/{GRNNos}`); a BookIn from a shipment.

**Field-level rules [DOCS]:**

- `DebtorID` or `DebtorAccountNo` both accepted; **DebtorID wins** when both supplied.
- Line items: `InventoryID` or `PartNo` both accepted; **InventoryID wins**.
- **Omit the price on a new line → Jiwa computes it** via the normal pricing-scheme logic.
- Omit `NoteType` on a note / `PaymentType` on a payment → the Jiwa-configured default is used.
- PATCH semantics for child arrays: supplying the child ID (`InvoiceLineID`, `NoteID`) **updates** that child; omitting it **appends** a new one.

**Cascading / hard-delete rules:**

- `409 Conflict` when business logic forbids an operation, e.g. deleting a product referenced by a sales order [DOCS].

**Concurrency:**

- **Optimistic concurrency control:** if a record changed between your read and your save, the API returns `409 Conflict` [DOCS]. DTOs carry `RowHash` (binary) — whether clients must echo it on PATCH is [UNVERIFIED].

**Computed / read-only fields:**

- Balances on Debtor, `LineTotal`/tax on lines, `CurrentBalance`, costs; `LastSavedDateTime` everywhere (useful for incremental sync).

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                                  | Example                  | Notes                                                                                       |
| ----------- | ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| ID (RecID)  | 20-char string                           | `0000000061000000001V`   | Server-generated, opaque; some IDs in wiki examples are GUID-ish 20-hex (`babce67cdbf64f778536`) [SPEC/DOCS] |
| ID padding  | RecID **with trailing spaces** in URLs   | `1ae102b94dc54dfc8a45                ` | Wiki custom-field examples URL-include trailing padding — looks like CHAR(20+) columns. Behavior without padding [UNVERIFIED] |
| Date/Time   | `string` / `date-time` in spec           | `2017-09-18T00:00:00.000` (query example) | **Wire format on responses [UNVERIFIED]** — ServiceStack can emit `/Date(ms)/` unless configured for ISO 8601. MUST verify on a test instance |
| Currency    | `number` (double)                        | `15.67`                  | `MoneyDecimalPlaces` from `/SystemInfo`; AUD-centric (GST fields everywhere)                  |
| Booleans    | JSON true/false                          | `true`                   | One wiki example sends `"false"` as a string — server appears lenient [DOCS]                  |
| Enums       | strings in spec (`Type`, `Status`, …)    |                          | Allowed values NOT enumerated in the spec [UNVERIFIED]                                        |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

Not extractable — the Swagger 2.0 spec types lifecycle/status fields as bare `string` without
`enum` arrays. Collect real values from a test instance (e.g. read orders in each state) before
documenting. One observed write: `{ "Status": 2 }` PATCHed to a sales-order history (integer!)
in a wiki example — numeric/string duality [UNVERIFIED].

---

## Phase 4: Endpoint Catalog

> Scale: **816 paths / 1,381 operations** across 37 tags [SPEC]. Method split: GET 680, DELETE 239,
> PATCH 226, POST 217, PUT 19 (PUT = replace-the-set operations like `TagMembership`, `LineDetails`).
> The full per-tag inventory lives in `02-api-spec-investigation.md`; below are the worked-example
> endpoints for the LLM pack.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /SystemInfo

- **Purpose:** Version/database/currency info — the recommended **test-connection** call
- **Authentication required:** yes — **Response:** `SystemInformationGETResponse` (JiwaVersion, JiwaRESTAPIPluginVersion, DatabaseName, LicensedCompany, CurrencyShortName, MoneyDecimalPlaces…) [SPEC]

#### Endpoint: GET /Queries/DB_Main (list customers)

- **Purpose:** Filtered, paginated customer list (AutoQuery over the `DB_Main` table)
- **Idempotent:** yes — **Paginated:** Skip/Take

**Query parameters (pattern — 494 generated params on this route)** [SPEC]:

| Parameter                       | Type   | Required | Description                                              |
| ------------------------------- | ------ | -------- | --------------------------------------------------------- |
| `{Field}`                       | varies | no       | Exact match (e.g. `AccountNo=CASH001`)                    |
| `{Field}StartsWith/EndsWith/Contains/Like` | string | no | String operators                                |
| `{Field}In`                     | csv    | no       | OR-list                                                   |
| `{Field}Between`                | range  | no       | Range filter                                              |
| `{Field}GreaterThan[OrEqualTo]` / `LessThan[OrEqualTo]` / `NotEqualTo` | varies | no | Comparison (dates/numbers) |
| `Skip` / `Take`                 | int    | no       | Pagination (`Take` capped by `AutoQueryMaxLimit`) [DOCS]  |
| `OrderBy` / `OrderByDesc`       | csv    | no       | Sorting                                                   |
| `Fields`                        | csv    | no       | Sparse field selection                                    |
| `Include`                       | string | no       | `Include=Total` adds total row count [DOCS]               |

**Example (from wiki, sanitized)** [DOCS]:

```http
GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=5&Fields=DebtorID,AccountNo,Name,EmailAddress
```

**Success response shape (`QueryResponse<DB_Main>`)** [SPEC]:

```json
{ "Offset": 0, "Total": 132, "Results": [ { "DebtorID": "…", "AccountNo": "…", "Name": "…" } ] }
```

#### Endpoint: GET /Debtors/{DebtorID}

- **Purpose:** Full customer DTO. 404 if no debtor matches [SPEC]
- **Errors:** 401 / 403 / 404 (`'No debtor with the DebtorID provided was found'`) [SPEC]

#### Endpoint: POST /Debtors

- **Purpose:** Create a customer. Nothing is strictly required — `AccountNo` and `DebtorID` are generated if omitted (but supply `AccountNo` in practice) [DOCS]
- **Request body (wiki example):**

```json
{ "AccountNo": "NewAccountNo", "Name": "A new customer", "EmailAddress": "name@example.com", "WebAccess": true }
```

- **Success:** 200/201 with the **full Debtor DTO** including generated `DebtorID` [SPEC][DOCS]

#### Endpoint: PATCH /Debtors/{DebtorID}

- **Purpose:** Partial update + inline child ops — e.g. update `EmailAddress`, append one note, edit another:

```json
{ "EmailAddress": "name2@example.com", "Notes": [ { "NoteText": "A new note added" }, { "NoteID": "DE91CC53-…", "NoteText": "A modified note text" } ] }
```

#### Endpoint: GET /Queries/SalesOrderList

- **Purpose:** Sales-order list view (`v_Jiwa_SalesOrder_List` — joins customer + order + delivery data) [DOCS]
- **Example:** `GET /Queries/SalesOrderList?PhysicalWarehouseDescription=New South Wales&LogicalWarehouseDescription=Main&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID,AccountNo,DebtorName&OrderBy=InvoiceNo&Include=Total&Take=25` [DOCS]

#### Endpoint: POST /SalesOrders

- **Purpose:** Create an order with lines/payments inline (see 3.4 for resolution rules)

```json
{
  "DebtorID": "00000000080000000002",
  "OrderNo": "1234",
  "SOReference": "Test order",
  "Lines": [
    { "PartNo": "1170", "QuantityOrdered": 5 },
    { "CommentLine": true, "CommentText": "This is a comment line" },
    { "InventoryID": "000000000K00000000BV", "QuantityOrdered": 2, "DiscountedPrice": 15.67 }
  ],
  "Payments": [ { "PaymentRef": "S454873-J5", "AmountPaid": 50.0 } ]
}
```

- **Success:** 200/201 → full SalesOrder DTO [SPEC]

#### Endpoint: PATCH /SalesOrders/{InvoiceID}

- **Purpose:** Compound update — adjust header fields, update a line (by `InvoiceLineID`), append a line, add a note in ONE call [DOCS]

#### Endpoint: GET /Inventory/{InventoryID}

- **Purpose:** Full product DTO; 404 `'No inventory with the InventoryID provided was found'` [SPEC]

#### Endpoint: GET /SalesOrders/{InvoiceID}/Process

- **Purpose:** **Processes** the order — posts journals + debtor transactions. GET-with-side-effects (ServiceStack idiom). HIGH-RISK: human confirmation required in Numa [DOCS]

**Common error responses (all endpoints)** [DOCS]:

| Status | Error Code | Meaning                                  | Recovery                                  |
| ------ | ---------- | ---------------------------------------- | ------------------------------------------ |
| 401    | —          | Not authenticated / bad or expired key   | Fix/rotate key                             |
| 403    | —          | Route not permitted for this User Group  | Jiwa admin must grant the route            |
| 404    | —          | Bad route or no such record              | Verify RecID / path                        |
| 409    | —          | Business-logic veto OR concurrency clash | Re-read, reconcile, retry deliberately     |

### 4.2 Full Endpoint Index [IMPORTANT]

See `02-api-spec-investigation.md` §Endpoint Inventory — all 37 tags with per-tag op counts and
route-pattern tables. Reproducing 816 paths here adds no value; a live instance also serves
`GET /RestPaths` (machine-readable route list) and `/openapi` [DOCS].

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

None. (ServiceStack also exposes a human `/metadata` page and typed-client `/types/*` generators —
not REST data endpoints.) [DOCS]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

> All advanced querying lives on the **`/Queries/*` AutoQuery routes** (152 ops over named DB
> views/tables: `DB_Main`, `IN_Main`, `SO_Main`, `CR_Main`, `DebtorList`, `SalesOrderList`,
> `IN_SOH`, `StaffTimesheets`, …). Entity GET routes take only the RecID. [SPEC][DOCS]

| Capability                          | Supported?         | Syntax                                            | Notes                                       |
| ----------------------------------- | ------------------ | ------------------------------------------------- | -------------------------------------------- |
| Filter by field value               | yes (Queries)      | `?AccountNo=CASH001`                              | Exact match                                  |
| Filter by date range                | yes (Queries)      | `?LastSavedDateTimeGreaterThan=2017-09-18T00:00:00.000` / `…Between` | [DOCS]                    |
| Full-text search                    | no                 | —                                                 | Use `{Field}Contains` per field              |
| Sort by field                       | yes                | `?OrderBy=InvoiceNo` / `?OrderByDesc=…` (csv)     |                                              |
| Field selection / sparse fields     | yes                | `?Fields=DebtorID,AccountNo,Name`                 |                                              |
| Include related records             | no (Queries are flat views) | —                                        | Entity GETs return nested DTOs instead       |
| Aggregate / count                   | total only         | `?Include=Total` → `Total` in response            |                                              |
| Logical operators (AND/OR)          | AND default; OR via `/Queries/OR/{View}` twin routes | 75 OR variants exist [SPEC] | OR semantics [UNVERIFIED]  |
| Comparison operators                | yes                | `{Field}GreaterThan[OrEqualTo]`, `LessThan…`, `NotEqualTo`, `Between`, `In` | [SPEC]            |
| String operators                    | yes                | `{Field}StartsWith/EndsWith/Contains/Like`        | [SPEC]                                       |
| Null checks                         | [UNVERIFIED]       | —                                                 | Not visible in generated params              |
| Regex / pattern matching            | `Like` only        | SQL LIKE semantics [UNVERIFIED]                   |                                              |

### 5.2 Filter Syntax [REQUIRED]

**General pattern** (convention-generated per field of the underlying view — `DB_Main` alone has 494 params) [SPEC]:

```
GET /Queries/{ViewName}?{Field}{Operator}={value}&…
```

- Multiple filters combine with **AND** (default routes). For OR, the spec exposes a parallel `/Queries/OR/{ViewName}` route per view ([UNVERIFIED] that conditions are OR-combined — test before documenting in LLM rules).
- Requests can also be sent as a **DTO body** instead of URL params (auth + queries) [DOCS].

### 5.3 Sort Syntax [IMPORTANT]

```
?OrderBy=AccountNo            (ascending)
?OrderByDesc=LastSavedDateTime (descending)
?OrderBy=Field1,Field2         (multi-column, csv)
```

### 5.4 Field Selection [NICE-TO-HAVE]

```
?Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID
```

Strongly recommended for the Numa agent — full view rows are wide and burn context tokens.

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none
- **Per-resource search:** `/Queries/{View}` with `{Field}Contains` / `StartsWith` filters
- **Fuzzy matching:** not supported
- **Useful views for "find X":** `DB_Main`/`DebtorList` (customers), `IN_Main`/`InventoryItemList` (products), `SO_Main`/`SalesOrderList` (orders), `CR_Main` (suppliers), `HR_Staff` (staff) [SPEC]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1 — customers changed since a date (incremental sync / "what's new"):** [DOCS]

```http
GET /Queries/DebtorList?WebAccess=true&LastSavedDateTimeGreaterThan=2026-06-01T00:00:00.000&Fields=AccountNo,Name&Include=Total
```

**Pattern 2 — find a product by partial part number:**

```http
GET /Queries/IN_Main?PartNoStartsWith=117&Fields=InventoryID,PartNo,Description&OrderBy=PartNo&Take=25
```

**Pattern 3 — recent sales orders for one customer:**

```http
GET /Queries/SalesOrderList?AccountNo=CASH001&OrderByDesc=InvoiceInitDate&Take=25&Include=Total&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorName
```

**Pattern 4 — stock on hand for a warehouse:**

```http
GET /Queries/IN_SOH?Take=100&Include=Total
```

**Pattern 5 — page 2 of a result set:**

```http
GET /Queries/DB_Main?OrderBy=AccountNo&Take=25&Skip=25
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset (`Skip` + `Take`) — `/Queries/*` routes only [DOCS][SPEC]
- **Default page size:** [UNVERIFIED] — when `Take` is omitted, row count is bounded by the `AutoQueryMaxLimit` system setting (value per-instance; the wiki frames it as a DoS guard) [DOCS]
- **Maximum page size:** `AutoQueryMaxLimit` (per-instance setting; clamp-vs-error behavior [UNVERIFIED])
- **Total count available:** yes — `?Include=Total` → `Total` property [DOCS]

**Request parameters:**

| Parameter | Type | Default        | Description                       |
| --------- | ---- | -------------- | ---------------------------------- |
| Skip      | int  | 0              | Rows to skip (offset)              |
| Take      | int  | [UNVERIFIED]   | Rows to return (≤ AutoQueryMaxLimit) |
| Include   | str  | —              | `Total` to include match count     |

**Response structure (`QueryResponse<T>`)** [SPEC]:

```json
{ "Offset": 25, "Total": 132, "Results": [ … ], "Meta": null, "ResponseStatus": null }
```

**How to detect last page:** `Offset + len(Results) >= Total` (request `Include=Total`); or stop when `Results` comes back short/empty.

⚠️ **Entity child collections are NOT paginated** — e.g. `GET /Debtors/{id}/ContactNames` returns the whole array [SPEC]. Fine for child data; for big lists always go through `/Queries/*`.

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /Queries/DB_Main?OrderBy=AccountNo&Take=25&Include=Total   → Offset 0,  Total 132
Page 2: GET /Queries/DB_Main?OrderBy=AccountNo&Take=25&Skip=25         → Offset 25
…
Last:   Skip=125 returns 7 rows (125+7 = 132 = Total) → stop
```

(Always pin `OrderBy` when paging — unordered SQL paging is unstable.)

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint                                   | Max Batch Size | Notes                                                       |
| --------------------- | ------------------------------------------ | -------------- | ------------------------------------------------------------ |
| Bulk create           | none (no batch envelope)                   | —              | Compound DTOs are the idiom: one `POST /SalesOrders` carries N lines + payments + notes [DOCS] |
| Bulk update           | none                                       | —              | One `PATCH /SalesOrders/{id}` can update + append several children at once [DOCS] |
| Bulk delete           | none                                       | —              |                                                              |
| Bulk read             | `/Queries/*` with `Take`                   | AutoQueryMaxLimit |                                                          |
| Set replace           | `PUT …/TagMembership`, `PUT …/LineDetails` | —              | The 19 PUT ops replace whole child sets [SPEC]               |

**Partial failure handling:** [UNVERIFIED] — compound-DTO writes presumably succeed/fail atomically inside Jiwa business logic, but this is not documented. Treat as all-or-nothing and verify.

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **CSV export:** any route via `?format=csv` or `.csv` suffix [DOCS] — handy for data pulls into the Numa workspace
- **Async export:** none — all synchronous

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported? | Notes                                                  |
| ------------------------ | ---------- | ------------------------------------------------------- |
| Webhooks                 | **yes**    | Built in — 18 ops under the Webhooks tag [SPEC][DOCS]   |
| WebSocket                | no         | (ServiceStack SSE not exposed in the spec)              |
| Server-Sent Events (SSE) | no         |                                                          |
| Long polling             | no         |                                                          |
| Change feeds / streams   | no         | Poll `LastSavedDateTime` filters instead                 |

### 7.2 Webhooks [IMPORTANT]

**Setup (API-managed, subscriber → subscriptions model)** [SPEC]:

- `POST /Webhooks/Subscribers/` `{ "Name": "...", "IsEnabled": true }` → `SY_WebhookSubscriber` (RecID)
- `POST /Webhooks/Subscribers/{SubscriberID}/Subscriptions/` `{ "URL": "https://…", "EventName": "…", "RequestHeaders": [{ "Name": "X-Numa-Secret", "Value": "…" }] }`
- `GET /Webhooks/Events/` → `[ { "Name": "…", "Description": "…" } ]` — the event catalog is **instance-served, not in the spec** [SPEC]; concrete event names [UNVERIFIED]
- `POST /Webhooks/Test/` — test fire; delivery inspection via `GET /Webhooks/Subscribers/{id}/Messages` (+ `/Responses`) [SPEC]
- **Precondition:** the `HostURL` system setting must be set or webhooks don't function [DOCS]

**Verification / security:**

- **No signature/HMAC mechanism found** in spec or wiki [UNVERIFIED — assume none]. Mitigation: subscriptions support **custom RequestHeaders** — inject a shared-secret header and validate receiver-side.

**Reliability [DOCS]:**

- Retry backoff: `10 ^ (RetryNo × WebhooksRetryInterval)` seconds, up to `WebhooksMaxRetries`
- Sent/failed messages retained `WebhooksMessagesRetentionDays` (event log 8 days default) — replayability via the Messages routes
- Multi-host installs nominate a dedicated retry-handler host (`WebhooksHostName` / `WebhooksHostRetrierURL`)

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `/Queries/{View}?LastSavedDateTimeGreaterThan={iso}` — `LastSavedDateTime` exists on virtually every entity [SPEC]
- **Recommended polling interval:** ≥ 60s (self-hosted boxes; be polite — no rate limiter protects them by default)
- **Change detection field(s):** `LastSavedDateTime`; `RowHash` per record

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope        | Limit                              | Window       | Notes                                       |
| ------------ | ---------------------------------- | ------------ | -------------------------------------------- |
| Default      | **none**                           | —            | [DOCS]                                       |
| Optional     | per-IP via "REST API Rate Limit" plugin | configurable | Only if the customer enables it [DOCS] |

- **Rate limit headers:** none documented; plugin behavior [UNVERIFIED]
- **Practical guidance:** the API is a customer's production ERP box. Numa should self-throttle (small `Take`, no parallel fan-out) regardless of the absent limit. `AutoQueryMaxLimit` is the only built-in guard [DOCS].

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** HTTP status + **response body text describing the problem**
(e.g. "product not found") [DOCS]. The spec defines the ServiceStack `ResponseStatus` DTO, which is
the structured form [SPEC]:

```json
{ "ResponseStatus": { "ErrorCode": "…", "Message": "…", "StackTrace": null, "Errors": [ { "ErrorCode": "…", "FieldName": "…", "Message": "…" } ] } }
```

⚠️ Actual wire shape per failure class is [UNVERIFIED] — the one live observation was a 401 with an
**empty body**. `DebugMode=true` adds stack traces to error responses [DOCS]. **Parse defensively:**
status code first, then try JSON `ResponseStatus`, then fall back to raw body text.

**Error codes reference [DOCS]:**

| HTTP Status | Meaning                                                            | Retryable?  | Recovery Action                                |
| ----------- | ------------------------------------------------------------------ | ----------- | ----------------------------------------------- |
| 200         | OK (GETs, most ops)                                                | —           |                                                 |
| 201         | Created (successful POST)                                          | —           |                                                 |
| 204         | No Content (successful DELETE; GET with nothing to return)         | —           | Not an error — handle empty body                |
| 400         | Malformed request [UNVERIFIED — implied, not listed in wiki]       | No          | Fix request                                     |
| 401         | Not authenticated — bad/expired/revoked key                        | No          | Fix or rotate the API key                       |
| 403         | Authenticated but route not permitted (User Group config)          | No          | Jiwa admin grants the route — config, not code  |
| 404         | Invalid route OR resource not found                                | No          | Verify RecID and path                           |
| 409         | Business-logic veto (referenced record) OR optimistic-concurrency conflict | Sometimes | Re-read record, reconcile, retry deliberately |
| 500         | Server error (plugin compile failures land in Windows event log)   | Cautiously  | Check body text; likely environmental [DOCS]    |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** no
- GET: yes (except action GETs like `/Process`, `/Save` — **side-effecting**); DELETE: yes; PATCH: re-sends safe for scalar fields, but child-array elements WITHOUT IDs are **appended** — a PATCH retry can duplicate lines/notes; POST: retries create duplicate records.
- Numa guidance: after a write timeout, **query before retrying** (e.g. `Queries/SO_Main?OrderNo=…`).

### 8.4 Async Operations [IMPORTANT]

None — all operations are synchronous [SPEC].

### 8.5 File Handling [IMPORTANT]

- Most transactional entities carry a `Documents` sub-resource (`GET/POST/PATCH/DELETE /{family}/{id}/Documents/{DocumentID}`), Email Messages carry `Attachments`, Inventory carries `Images`; `InventoryItem.Picture` is typed `string`/`binary` [SPEC]
- **Encoding for upload/download (base64 vs multipart) is [UNVERIFIED]** — DTO-based, likely base64-in-JSON; verify before exposing document upload through Numa.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** yes — 409 on write conflicts [DOCS]; `RowHash` field on DTOs [SPEC]; client echo requirements [UNVERIFIED]
- **Caching plugins:** optional; when enabled, `Cache/` invalidation routes appear (`DELETE /Debtors/Cache/{DebtorID}` etc. — present throughout the spec) and `HostURL` must be set for invalidation fan-out [DOCS]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                            | Fits? | Notes                                                        |
| -------------------------- | ------------------------------------------------------ | ----- | ------------------------------------------------------------ |
| **Data Connector**         | API has file-like content to browse/search/download    | no    | Documents exist but are attachments, not a browsable file system |
| **Data Connector (Files)** | API is primarily a file storage/document system        | no    |                                                              |
| **Direct API Only**        | API is action-oriented (no browsable content)          | **yes** | ERP queries + transactional actions via the `request` op  |
| **Hybrid**                 | Browsable content AND actions                          | no    |                                                              |

**Selected integration path:** **Direct API via the Numa native data connector (`request` operation)** — `authType: api-key`, NOT Pipedream, NOT OAuth.

**Justification:** Bearer API key == the existing token-connector backend (header injection, zero new auth code). Per-user Staff API Keys map onto Numa's per-user vault model; the admin contributes only the **instance URL**. Jiwa-side User Group route permissions enforce least privilege server-side.

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector:"jiwa", url:"/Queries/DB_Main?Take=25", method:"GET"})
  → Numa backend resolves connector-config-jiwa.instance_url (admin-set; REQUIRED — no default base URL)
  → injects Authorization: Bearer {user vault: connector-jiwa.api_key}
  → forwards; agent never sees the key
```

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A.

- **Auth type for connector:** API Key (Bearer) — per-user Staff API Key in the user's personal vault (field `api_key`), captured via the chat credential card on first use. The admin does NOT hold user credentials.
- **Per-client config:** `instance_url` (set in the ApiKeyWizard; the generic wizard marks it optional but it is **required** for Jiwa — there is no default base URL).
- **Connector category:** ERP / finance
- **Caching appropriate:** no (live transactional data)

**Deployment-model constraints (unique to Jiwa — surface these in the admin wizard copy):**

1. **Self-hosted only:** Jiwa 8's REST API runs as a Windows service installed with Jiwa (`JiwaAPISelfHostedService.exe.config`: ServerName, DatabaseName, JiwaUsername, JiwaPassword, URLBase — **trailing slash required** on URLBase). IIS reverse-proxying is no longer supported in v8 [DOCS].
2. **Internet reachability:** Numa's backend must reach the instance. Many Jiwa boxes are LAN-only; the customer may need a public DNS name, valid TLS cert (wiki recommends Let's Encrypt/win-acme), port-forward/Cloudflare, and — if they IP-whitelist — allowance for Numa's egress IPs [DOCS].
3. **Plugin + permission prerequisites:** REST API plugin enabled in Plugin Maintenance; "REST API OpenAPI" plugin for `/openapi`/Swagger; route permissions granted to the connector users' User Group (Default REST API Permission, or explicit per-route grants imported from `{api}/RestPaths`). Disallow-anywhere-wins; Undefined = deny unless allowed elsewhere [DOCS].
4. **Version sensitivity:** REST API requires Jiwa 8.00.00+ (keys from 7.2+); route coverage differs across versions — re-pull `/openapi` per customer [DOCS].

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Answer data questions via `/Queries/*` (customers, products, stock on hand, sales orders, quotes, purchase orders, timesheets, GL views) with filters, sorting, `Fields`, and Skip/Take paging
2. Read full entity DTOs (`/Debtors/{id}`, `/Inventory/{id}`, `/SalesOrders/{id}`, …) including notes, documents metadata, custom field values
3. Create/update master data and transactions on explicit user request: customers, contacts, sales orders (+lines/payments/notes), quotes, to-dos
4. Incremental "what changed" reporting via `LastSavedDateTimeGreaterThan`
5. Diagnostics: `GET /SystemInfo`, `GET /Sessions/Current`, `GET /RestPaths`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Call financial-posting actions without explicit human confirmation: `/SalesOrders/{id}/Process`, any `Activate/{id}`, `MakeOrder`, `ProcessSalesOrder`/`ProcessCreditNote`, `WorkOrders/Reversal`
2. DELETE operations without explicit human confirmation (and never bulk-delete loops)
3. Touch admin/infrastructure routes: `/Services/Restart`, `/Services/Stop`, Webhooks management, `/Staff` password routes, Customer Web Portal routes
4. Use or request Debtor API Keys (Staff keys only)
5. Mutate GL journals (`/JournalSets`) — read-only unless a human-approved workflow exists

**Default parameters:**

| Parameter | Default                          | Reason                                            |
| --------- | -------------------------------- | -------------------------------------------------- |
| Take      | 25 (max 100 unless asked)        | Don't hammer a customer's ERP box; context economy |
| Include   | `Total`                          | Lets the agent report "N of M"                     |
| Fields    | minimal explicit list            | View rows are very wide                            |
| OrderBy   | always set when paging           | Stable pagination                                  |
| format    | (header `Accept: application/json`) | Avoid HTML razor-view responses                 |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                          | Language   | Quality | Maintained?      | Worth Using? | Notes                                  |
| ---------------------------- | ---------- | ------- | ---------------- | ------------ | --------------------------------------- |
| ServiceStack generated DTOs  | C#/TS/Java/Kotlin/Swift/VB/F# | good | per-instance generated | No for Numa | Numa goes through the generic `request` proxy; raw HTTP + JSON suffices |

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 **partially**: auth model documented from DOCS/SPEC; **first-call gate NOT passed (no instance)**
- [x] Phase 3 complete: core entities + fields from spec; enums/state values outstanding
- [x] Phase 4 complete: 9 critical endpoints with request/response shapes (wiki/spec-derived)
- [x] Phase 5 complete: AutoQuery filter/sort/fields patterns documented
- [x] Phase 6 complete: Skip/Take/Include=Total pagination with worked example
- [x] Phase 7 complete: webhooks assessed (subscriber model; event catalog instance-served)
- [x] Phase 8 complete: status-code table; error body shape flagged UNVERIFIED
- [x] Phase 9 complete: integration path selected (Direct API, api-key connector)

**Overall investigation confidence:** **medium** — endpoint/DTO coverage is excellent (full official
spec), but zero live validation, per-customer variability, and unknown error/date wire formats cap it.

**Known gaps that will reduce output quality:**

1. **No live verification of anything** — error body shapes, date serialization format (ISO vs ServiceStack `/Date(ms)/`), default `Take`, 401/403 bodies, RowHash echo requirements
2. Enum/status values for lifecycle fields (SalesOrder Status etc.) not enumerated in the spec
3. Webhook event-name catalog and payload shape only discoverable from a live instance (`GET /Webhooks/Events/`)
4. Per-customer drift: enabled plugins (OpenAPI, caching, rate limit), User Group route permissions, Jiwa 7 vs 8 route coverage

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):

1. **01-llm-api-rules.md** — Phases 2, 4, 8, 9. **MUST open with a prominent banner:** spec-derived,
   not live-validated; verify against a test instance before first customer use; expect per-customer
   differences (plugins, permissions, versions). Mandate human confirmation for Process/Activate/DELETE.
2. **01a-domain-model-reference.md** — Phase 3
3. **01b-query-patterns.md** — Phases 5–6 (AutoQuery deep-dive)
4. **01c-mutation-patterns.md** — Phases 3.4, 4 (compound DTO writes, ID-resolution rules, 409 handling)
5. **01d-event-and-error-handling.md** — Phases 7–8
6. **02-api-spec-investigation.md** — all phases condensed (companion file in this folder)
7. **03-connector-setup.md** — Phase 9 (api-key connector; instance_url required; Staff-key guidance)

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                       |
| ---------------------------- | ------------- | ---------- | ----------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium     | Error bodies, date wire format unverified                   |
| 01a-domain-model-reference   | yes           | medium-high| Enum values missing; field lists are [SPEC]-solid           |
| 01b-query-patterns           | yes           | high       | AutoQuery params are mechanically generated → reliable      |
| 01c-mutation-patterns        | yes           | medium     | Wiki worked examples for Debtors/SalesOrders only           |
| 01d-event-and-error-handling | yes           | low-medium | Webhook events + error shapes need a live instance          |
| 02-api-spec-investigation    | yes           | medium-high| Counts/routes exact from spec; behavior partly unverified   |
| 03-connector-setup           | yes           | high       | Standard api-key connector; instance_url constraint clear   |

---

_Compiled 2026-06-10 from the official Jiwa OpenAPI spec (`https://api.jiwa.com.au/openapi`) and
Jiwa's Atlassian wiki. **No live test instance — re-validate flagged items before first customer use.**_
