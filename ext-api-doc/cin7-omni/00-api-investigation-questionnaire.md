---
api_name: 'Cin7 Omni API'
api_slug: 'cin7-omni'
vendor: 'Cin7 (Cin7 Omni product line — formerly just "Cin7")'
website: 'https://www.cin7.com'
investigation_started: '2026-05-22'
investigator: 'Numa API Investigation Agent (live docs/spec investigation 2026-05-22); split into this Omni-only pack 2026-06-10'
investigation_status: 'blocked' # docs + live OAS3 spec research complete; Phase 2.4 authenticated-call gate NOT passed (no credentials)
documentation_quality: 'excellent'
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No Cin7 Omni credentials were available — docs/spec endpoints were retrieved live, but no AUTHENTICATED API call has been made'
  - 'Error response body format unverified against the live API (spec gives string bodies but is marked BETA)'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: Cin7 Omni

> **Source:** Live API investigation completed 2026-05-22 against Cin7's official documentation
> (`https://api.cin7.com/api`, retrieved live, HTTP 200), the official **OpenAPI 3.0 spec**
> (`https://api.cin7.com/api/OpenApi/GetSpec`, retrieved live — 44 paths / 73 operations, marked
> BETA), the Swagger UI (live), and the official auth setup guide on the Cin7 Omni help centre.
>
> ⚠️ **TWO PRODUCTS, TWO CONNECTORS.** Cin7 sells two separate inventory platforms with completely
> different APIs:
>
> | Product | Formerly | Base URL | Auth | Numa slug |
> |---------|----------|----------|------|-----------|
> | **Cin7 Omni** | Cin7 | `https://api.cin7.com/api` | HTTP Basic (API username + API key) | `cin7-omni` — **this pack** |
> | **Cin7 Core** | DEAR Inventory | `https://inventory.dearsystems.com/externalapi/v2` | Custom headers (account ID + application key) | `cin7-core` — separate pack |
>
> **This document covers Cin7 Omni ONLY.** Login at `go.cin7.com`/`app.cin7.com` = Omni; login at
> `inventory.dearsystems.com` = Core. Always confirm before calling anything.
>
> ⚠️ **NO AUTHENTICATED CALL has been made.** The investigation confirmed the docs, spec, and
> Swagger UI are live, but had no credentials — auth behaviour, error bodies, and field semantics
> are docs/spec-derived, not live-verified through the Numa connector path.
>
> **Confidence markers (per repo convention for this connector):**
> `[CONFIRMED — API investigation 2026-05-22]` = verified live during the investigation
> (docs/spec/Swagger retrieved over HTTP) · `[DOCUMENTED]` = stated in Cin7's official docs/help
> centre · `[SPEC]` = extracted from the live OpenAPI 3.0 spec (BETA) · `[UNVERIFIED]`/`[UNKNOWN]`
> = inferred or undetermined; check with real credentials.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://api.cin7.com/api` — full HTML reference, served by the API host itself [CONFIRMED — API investigation 2026-05-22]
- **API reference / endpoint catalog URL:** same; machine-readable spec at `https://api.cin7.com/api/OpenApi/GetSpec` [CONFIRMED — API investigation 2026-05-22]
- **Authentication guide URL:** `https://help.omni.cin7.com/hc/en-us/articles/10015165519503` — official "API v1 connection" setup guide [DOCUMENTED]
- **Changelog / status page URL:** None found for the API

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** `https://api.cin7.com/api/OpenApi/GetSpec` — OpenAPI 3.0, ~1.6MB JSON, **marked BETA**; Swagger UI at `/api/swagger` [CONFIRMED — API investigation 2026-05-22]
- **Postman collection / official SDKs:** None published [UNKNOWN — searched, not found]
- **Community:** an unofficial TypeScript SDK exists for the *Core* product only — not applicable to Omni; no Omni MCP server found

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                          |
| ------------------------- | ------ | ------------------------------------------------------------------------------- |
| Authentication            | 5      | Basic auth + credential setup path fully documented with examples [DOCUMENTED]  |
| Endpoint reference        | 5      | Full HTML docs + live OAS3 spec (44 paths / 73 ops) [CONFIRMED]                 |
| Request/response examples | 4      | Spec carries inline request/response examples per endpoint [SPEC]               |
| Error documentation       | 3      | Status codes + spec string bodies; real-world shape untested [SPEC][UNKNOWN]    |
| Rate limit documentation  | 5      | Explicit: 3/sec, 60/min, 5,000/day per API connection [DOCUMENTED]              |
| Pagination documentation  | 4      | page/rows documented; spec adds default 50 / max 250 [DOCUMENTED][SPEC]         |
| Webhook documentation     | 1      | No outbound webhook docs exist at all (Phase 7) [UNKNOWN]                       |
| SDKs / code examples      | 2      | No official SDKs; raw HTTP examples only                                        |
| Changelog / versioning    | 1      | No changelog; v1 routes plus a lone v2 (BomMasters)                             |

**Overall documentation quality:** excellent (for the REST surface; webhooks/SDKs are the gaps)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (live, 200) [CONFIRMED — API investigation 2026-05-22]
- [x] Found OpenAPI/Swagger spec (OAS 3.0, BETA, 44 paths / 73 ops) [CONFIRMED — API investigation 2026-05-22]
- [x] Identified authentication method (HTTP Basic — API username + API key)
- [ ] Found at least one working **authenticated** example — **NOT done; no credentials** [UNKNOWN]
- [x] Identified rate limit information (3/sec, 60/min, 5,000/day) [DOCUMENTED]
- [x] Identified pagination approach (page + rows; empty-array end detection) [DOCUMENTED]
- [x] Checked for webhook/event support (none found — polling only) [UNKNOWN — assumed absent]
- [x] Checked for official SDKs (none exist)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Cin7 API (spec title; the product is Cin7 Omni) [SPEC]
- **Vendor / company:** Cin7 — inventory and order management for multi-channel retail/wholesale
- **Current API version:** v1 (primary); v2 exists for BomMasters only [CONFIRMED — API investigation 2026-05-22]
- **Base URL(s):** Production `https://api.cin7.com/api` — single shared SaaS host [DOCUMENTED];
  Sandbox: none confirmed [UNKNOWN — trial-account availability needs checking with Cin7]
- **API type:** REST, JSON responses [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS only; JSON; `Content-Type: application/json` on POST/PUT bodies [DOCUMENTED]; UTF-8 [UNVERIFIED — standard assumption]
- **URL structure pattern:** [DOCUMENTED]

```
GET    https://api.cin7.com/api/v1/{Resource}/{id}
GET    https://api.cin7.com/api/v1/{Resource}?fields={f}&where={w}&order={o}&page={p}&rows={r}
POST   https://api.cin7.com/api/v1/{Resource}          (body = ARRAY of records)
PUT    https://api.cin7.com/api/v1/{Resource}          (body = ARRAY of records)
DELETE https://api.cin7.com/api/v1/{Resource}/{id}     (Contacts and Payments only)
```

- **Versioning strategy:** URL path segment (`/v1/`, `/v2/`); only BomMasters has a v2 [SPEC]
- **CORS policy:** [UNVERIFIED] — irrelevant for Numa (server-side proxy)
- **Required headers:** `Authorization: Basic base64(username:apikey)` on **every** request — no session [DOCUMENTED]
- **Response key casing quirk:** schema properties are PascalCase (`StyleCode`) but every inline
  response *example* uses camelCase (`styleCode`), and documented query examples use lowercase
  field names (`modifieddate`). Expect camelCase responses and case-insensitive query fields, but
  verify [SPEC][UNVERIFIED].

### 2.3 Authentication [REQUIRED]

- **Auth method:** HTTP Basic Authentication over HTTPS [DOCUMENTED] — **Location:** header

```
Authorization: Basic <base64(api-username:api-key)>
```

Example from the official docs: `Authorization: Basic dGVzdGFwaXVzZXJuYW1lOnRlc3RhcGlrZXk=` [DOCUMENTED]

**How to obtain** [DOCUMENTED — help.omni.cin7.com article 10015165519503]:

1. Log into Cin7 Omni as an administrator → **Settings → Integrations & API → API v1**
2. Note the **API Username** — **account-level**, shared by all connections
3. **Add New API Connection** → name it → copy the generated **API Key** — keys are **per-connection**
4. Configure the connection's per-endpoint **Create / Read / Update / Write** permission toggles

**Key facts:**

- **Key format:** opaque string [UNVERIFIED — not documented]
- **Rate limits per key:** 3/sec, 60/min, 5,000/day **per API connection** (Phase 8) [DOCUMENTED]
- **Rotation:** keys can be regenerated, but regeneration **invalidates the old key immediately and breaks existing integrations** [DOCUMENTED]
- **Connection cap:** fixed cap on API connections per account; exceeding it requires Cin7 support [DOCUMENTED]
- **Expiry:** none — static credentials, no OAuth, no tokens, no refresh [DOCUMENTED]

**Permission model (critical Omni behaviour)** [DOCUMENTED]: permissions are **per endpoint, per
connection** — each key carries independent Create/Read/Update/Write toggles per resource. A
**403 means the key lacks that endpoint's permission toggle — NOT bad credentials** (that's a
401). This is the most common Omni integration failure, and it is fixed in Cin7's UI, never in code.

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No Cin7 Omni credentials were available. The docs, spec and Swagger UI
> were retrieved live (all 200) [CONFIRMED — API investigation 2026-05-22], but no authenticated
> API call has ever been made. Do NOT treat response shapes below as live-verified.

**Endpoint planned for first call (when credentials are available):**

```http
GET /api/v1/Users?rows=1 HTTP/1.1
Host: api.cin7.com
Authorization: Basic <base64(api-username:api-key)>
Accept: application/json
```

(`Users` needs only Read permission and returns a small payload — a good connection probe.)

- **Expected status:** 200 with a JSON array [SPEC]; 401 = bad username/key; 403 = key lacks Read on Users
- **Live observations made (unauthenticated):** main docs, OpenAPI spec (1.6MB), and Swagger UI
  all returned **200** [CONFIRMED — API investigation 2026-05-22]

- [ ] **GATE CHECK: First successful authenticated API call completed and documented above** — **NOT DONE; blocked on credentials**

---

## Phase 3: Domain Model & Behavior

> Cin7 Omni is a multi-channel inventory/order platform exposing 24 resource families (Phase 4).
> The entities below are the ones Numa users will actually ask about. Field lists are [SPEC]
> extracts trimmed to decision-relevant fields.

### 3.1 Core Entities [REQUIRED]

#### Entity: Product

- **Endpoint path:** `/api/v1/Products[/{id}]` — Create (POST) / Read / Update (PUT); no DELETE [SPEC]
- **Description:** An inventory item ("style") with up to three option dimensions (colour/size/...)
  expressed as nested ProductOptions.

**Fields (selected)** [SPEC]: `Id` (integer, ro), `Status` (e.g. `Public`), `CreatedDate`/
`ModifiedDate` (UTC, ro — `ModifiedDate` drives incremental sync), **`StyleCode`** (human product
code — **must be unique; duplicate → whole POST rejected with 400** [DOCUMENTED]), `Name`,
`Description`, `Brand`, `Category`/`SubCategory`, `SupplierId` (→ Contact), physical dims
(`Weight`/`Height`/`Width`/`Length`/`Volume`), `StockControl`, `OptionLabel1–3` (names of the
option dimensions, e.g. `Color`/`Size`), `SizeRangeId`, `Images[].Link`, `CustomFields`,
`ProductOptions[]` (nested variants, each with its own `Code`/`Barcode`/prices — **duplicate
ProductOptionCode → 400** [DOCUMENTED]).

**Relationships:** ProductOptions (1:N nested + own resource), ProductCategories (N:1),
Contact-as-supplier (N:1 via `SupplierId`), BomMasters (1:N), Stock rows (1:N per branch/option).

#### Entity: SalesOrder (and its twin PurchaseOrder)

- **Endpoint path:** `/api/v1/SalesOrders[/{id}]` (+ read-only `/api/v1/SalesOrdersWithCartons`);
  `/api/v1/PurchaseOrders[/{id}]` is the supplier-side twin with the same shape
- **CRUD:** Create (POST `?loadboms={bool}`) / Read / Update (PUT `?loadboms={bool}`) — no DELETE [SPEC]

**Fields (selected)** [SPEC]: `Id` (ro), `CreatedDate`/`ModifiedDate` (ro), `Reference`,
`MemberId` (customer Contact id), customer snapshot (`FirstName`/`LastName`/`Company`/`Email`/
`Phone`), full `Delivery*` and `Billing*` address blocks, `BranchId`, `ProjectName`,
`TrackingCode`, `InternalComments`, `ProductTotal`/`FreightTotal`, `DispatchedDate`,
`InvoiceDate` — setting it triggers assignment of the **read-only `InvoiceNumber`** [SPEC] —
and `LineItems[]` (`StyleCode`, `Code`, `Barcode`, `Qty`, prices; if the product option barcode
exists in Cin7, only quantity is needed [SPEC]).

**`loadboms` query parameter (POST/PUT):** expands BOMs on the order — the spec warns
"**This cannot be undone**" [SPEC]. Treat as a deliberate, human-confirmed action.

#### Entity: Contact

- **Endpoint path:** `/api/v1/Contacts[/{id}]` — a customer OR supplier record (`Type`
  discriminates); Create / Read / Update / **Delete** — one of only two resources with DELETE [SPEC]

**Fields (selected)** [SPEC]: `Id` (ro), `IsActive`, `Type`, `Company`, `FirstName`, `LastName`,
`JobTitle`, `Email`, `Phone`, `Mobile`, street + postal address blocks, `Notes`, `IntegrationRef`,
`CustomFields`, `SecondaryContacts[]`, `SalesPersonId`, `AccountNumber`, billing/accounts-contact
fields, `CreatedDate`/`ModifiedDate`.

#### Entity: Stock (read-only)

- **Endpoint path:** `/api/v1/Stock` (list query or `?barcode={code}`) — Read only [SPEC]
- **Fields** [SPEC]: `ProductId`, `ProductOptionId`, `ModifiedDate`, `StyleCode`, `Code`,
  `Barcode`, `BranchId`/`BranchName`, `ProductName`, `Option1–3`, `Size`, and the quantity set:
  `Available`, `StockOnHand`, `OpenSales`, `Incoming`, `Virtual`, `Holding`.

#### Other entities (summary)

| Entity            | CRUD                | Notes                                                          |
| ----------------- | ------------------- | --------------------------------------------------------------- |
| Adjustments       | GET/POST/PUT        | Inventory adjustments                                           |
| Branches          | GET/POST/PUT        | Warehouse/store locations                                        |
| BranchTransfers   | GET/POST/PUT        | Inter-branch stock movements                                     |
| BomMasters        | GET only (v1 + v2)  | BOM components; `Type` enum `Undefined`/`Make`/`Use`/`Addon`; `Qty` required [SPEC] |
| Cartons           | GET/PUT by id       | Carton list for a sales order (PUT replaces the list)            |
| CreditNotes       | GET/POST/PUT        | Customer credit notes                                            |
| Payments          | GET/POST/PUT/DELETE | One of two resources with DELETE                                 |
| PaymentFeesAndPayouts | GET only        | `/Fees` and `/Payouts` sub-paths                                 |
| ProductCategories | GET/POST/PUT        | Category tree                                                    |
| ProductImages     | POST only           | `?productId={id}&imagePriority={n}` — request body undocumented [SPEC][UNKNOWN] |
| ProductionJobs    | GET/POST/PUT        | Manufacturing jobs                                               |
| ProductOptions    | GET/POST/PUT        | Variant-level records                                            |
| Quotes            | GET/POST/PUT        | Pre-order quotes; `?loadboms` on writes                          |
| SerialNumbers     | GET only            | Serial tracking                                                  |
| SizeRanges        | GET only            | Clothing/footwear size grids                                     |
| Users             | GET only            | Cin7 user accounts; **new users take up to 2h to appear** [DOCUMENTED] |
| Voucher           | GET only            | Gift vouchers / promo codes; `?code={code}` lookup               |

### 3.2 Entity Relationships [IMPORTANT]

```
ProductCategory 1:N─> Product 1:N─> ProductOption 1:N─> Stock (per Branch)
                         │1:N
                         └──> BomMaster
Contact (customer/supplier) 1:N─> SalesOrder / PurchaseOrder (+LineItems ─> Product)  N:1─> Branch
SalesOrder 1:N─> Payments / CreditNotes;  SalesOrder 1:1─> Cartons
```

### 3.3 State Machines [IMPORTANT]

No lifecycle action routes exist — status moves via field updates on PUT; status enums are **not
enumerated in the spec** [UNVERIFIED]. Two side-effecting behaviours to treat as transitions:

| Behaviour | Trigger | Reversible? |
| --------- | ------- | ----------- |
| Invoice number assignment | Setting `InvoiceDate` on a SalesOrder | [UNVERIFIED — assume no] |
| BOM expansion on an order | `?loadboms=true` on SalesOrders/Quotes/PurchaseOrders POST/PUT | **No — spec: "cannot be undone"** [SPEC] |

### 3.4 Business Rules [IMPORTANT]

**Write semantics (every POST/PUT):**

- **Bodies are ARRAYS** — even a single record must be wrapped in `[ ... ]` [SPEC]
- **Batch limit: 250 records** — exceeding it returns 400 `"Batch limit is 250."` [SPEC]
- **Write responses are per-record result envelopes**, not the created entities [SPEC]:

```json
[ { "index": 0, "success": true, "id": 12345, "code": "SALE4-28", "errors": [] } ]
```

  Check `success` per element — a 200 does NOT mean every record in the batch succeeded.

**Field-level rules:**

- Products POST: **duplicate `StyleCode` or `ProductOptionCode` → the entire request is rejected
  with 400**, not just the duplicate row — validate before sending [DOCUMENTED]
- Products PUT: **null vs empty string differ** — `null` skips the field, `""` **clears** it.
  Silent data loss if confused [DOCUMENTED]
- SalesOrder LineItems: if the product option `Barcode` exists in Cin7, only quantity is needed [SPEC]
- `InvoiceNumber` is read-only; assigned when `InvoiceDate` is provided [SPEC]

**Propagation delays:** new Cin7 users may take **up to 2 hours** to appear via `GET /v1/Users` [DOCUMENTED]

**Cascading / delete rules:** DELETE exists only on `Contacts/{id}` and `Payments/{id}` [SPEC];
cascade behaviour [UNVERIFIED]

### 3.5 Field Format & Enum Reference [IMPORTANT]

| Format    | Pattern                      | Example                  | Notes                                              |
| --------- | ---------------------------- | ------------------------ | --------------------------------------------------- |
| DateTime  | `yyyy-MM-ddTHH:mm:ssZ` (UTC) | `2010-12-04T11:58:00Z`   | All dates UTC [DOCUMENTED]                          |
| ID        | integer                      | `12345`                  | All record ids are integers [SPEC]                  |
| Currency  | number (double)              | `19.95`                  | Account-level currency [UNVERIFIED]                 |
| JSON keys | camelCase in responses       | `styleCode`              | Schema says PascalCase; examples camelCase [SPEC][UNVERIFIED] |

**Enums:** the only spec-enumerated enum is `BomMaster.Type` (`Undefined`/`Make`/`Use`/`Addon`)
[SPEC]. Status/type fields elsewhere are bare strings (`Product.Status: "Public"` observed in
examples) — collect the full value sets from a live account [UNVERIFIED].

---

## Phase 4: Endpoint Catalog

> Scale: **44 paths / 73 operations** across 24 resource families, all v1 except BomMasters
> (v1+v2) [CONFIRMED — API investigation 2026-05-22, via the live OAS3 spec]. The full
> per-resource table is in `02-api-spec-investigation.md` §Endpoint Inventory; below are the
> worked examples for the LLM pack. No non-REST endpoints exist.

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /api/v1/Products (the canonical list GET)

- **Authentication:** yes (+ Read permission on Products for this key) — **Paginated:** page/rows

**Query parameters (identical on every list GET)** [SPEC]:

| Parameter | Type   | Default | Description                                            |
| --------- | ------ | ------- | ------------------------------------------------------ |
| `fields`  | string | all     | Comma-separated projection; nested: `lineitems(code)`  |
| `where`   | string | —       | SQL-like filter (parent-level fields only)             |
| `order`   | string | —       | Sort; default DESC, append ` ASC` to reverse           |
| `page`    | int    | 1       | 1-based page number                                    |
| `rows`    | int    | 50      | Rows per page, **maximum 250** [SPEC]                  |

```http
GET /api/v1/Products?where=modifieddate>='2026-06-01T00:00:00Z'&order=modifieddate ASC&page=1&rows=50
Authorization: Basic <credentials>
```

**Success:** 200, JSON **array** of camelCase objects — no envelope, no total count [SPEC].
**Single record:** `GET /api/v1/Products/{id}` → one object; 404 if missing.

#### Endpoint: POST /api/v1/Products

```json
[ { "styleCode": "TSHIRT-V", "name": "V-NECK TSHIRT", "category": "T-SHIRTS",
    "optionLabel1": "Color", "optionLabel2": "Size",
    "productOptions": [ { "code": "TSHIRT-V-RED-M", "barcode": "9400000000001" } ] } ]
```

- **Success:** 200 with the per-record result envelope (`index`/`success`/`id`/`code`/`errors`) [SPEC]
- **Failure:** duplicate StyleCode/ProductOptionCode → 400 rejects the whole request [DOCUMENTED]
- **PUT variant:** same array shape, each element carries `id`; ⚠️ `null` = leave unchanged,
  `""` = clear the field [DOCUMENTED]

#### Endpoint: GET /api/v1/SalesOrders

The workhorse for "what sold / what changed":

```http
GET /api/v1/SalesOrders?where=modifieddate>='2026-06-09T00:00:00Z'&order=modifieddate ASC&page=1&rows=50
```

#### Endpoint: POST /api/v1/SalesOrders?loadboms={bool}

Create sales orders. `loadboms=true` expands BOMs — **cannot be undone** [SPEC]. Numa rule: never
set it without explicit human confirmation. (Quotes and PurchaseOrders POST/PUT take the same flag.)

#### Endpoint: GET /api/v1/Stock

`?barcode={code}` direct lookup or the standard query set; returns `available`, `stockOnHand`,
`openSales`, `incoming`, `virtual`, `holding` per product option per branch [SPEC].

#### Endpoint: GET /api/v1/Contacts + DELETE /api/v1/Contacts/{id}

Customer/supplier lookup; one of only two DELETE-capable resources (the other: Payments). DELETE
responds with the same result envelope [SPEC]. Numa rule: DELETE requires explicit human confirmation.

#### Endpoint: GET /api/v1/Users

Small, read-only — the recommended **test-connection probe**. Up to 2h propagation delay for new
users [DOCUMENTED].

**Common error responses (all endpoints):** identical status set on every operation — see the
table in Phase 8.2. Spec error bodies are plain strings (`"Unauthorized access"`,
`"Access is forbidden"`, `"Resource not found"`, enumerated 400 messages) [SPEC].

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                          | Supported?       | Syntax                                       | Notes                                  |
| ----------------------------------- | ---------------- | --------------------------------------------- | -------------------------------------- |
| Filter by field value               | yes              | `where=status='Active'`                       | Parent-level fields only [DOCUMENTED]  |
| Filter by date range                | yes              | `where=modifieddate>='2026-06-01T00:00:00Z'`  |                                        |
| Full-text search                    | no               | —                                             | Use `LIKE` per field                   |
| Sort by field                       | yes              | `order=createddate ASC`                       | Default direction DESC [DOCUMENTED]    |
| Field selection / sparse fields     | yes              | `fields=id,invoicedate,lineitems(code)`       | Nested child selection supported       |
| Aggregate / count                   | no               | —                                             | No total count anywhere [DOCUMENTED]   |
| Logical operators (AND/OR)          | within `where`   | single `where` expression                     | Exact AND/OR grammar [UNVERIFIED]      |
| Comparison operators                | yes              | `=`, `<>`, `>`, `<`, `<=`, `>=`               | [DOCUMENTED]                           |
| String operators                    | yes              | `LIKE`, `NOT LIKE` (encode `%` as `%25`)      | [DOCUMENTED]                           |
| List membership / null checks       | yes              | `IN (1,2,3)` / `IS NULL`, `IS NOT NULL`       | [DOCUMENTED]                           |

### 5.2 Filter Syntax [REQUIRED]

```
GET /api/v1/{Resource}?where={expression}
```

**Operators:** `=`, `<>`, `>`, `<`, `<=`, `>=`, `IS`, `IS NOT`, `LIKE`, `NOT LIKE`, `IN` [DOCUMENTED]

**URL-encoding rule:** `%` inside a `where` expression must be encoded as `%25` —
e.g. `name LIKE '%25Widget%25'` [DOCUMENTED]

**Constraint:** filters apply to **top-level (parent) fields only** — you cannot filter by nested
line-item fields [DOCUMENTED].

### 5.3 Sort / Field Selection / Search [IMPORTANT]

```
?order=createddate                          descending (DEFAULT direction)
?order=createddate ASC                      ascending
?fields=id,invoicedate,lineitems(code)      sparse projection incl. nested child fields
```

Always project with `fields` — full order DTOs are wide and burn context tokens. No global search
or fuzzy matching: per-resource `where ... LIKE '%25term%25'`, plus direct lookups
`Stock?barcode={code}` and `Voucher?code={code}` [SPEC].

### 5.6 Common Query Patterns [REQUIRED]

```http
# 1 — sales orders modified since a watermark (incremental sync)
GET /api/v1/SalesOrders?where=modifieddate>='2026-06-09T00:00:00Z'&order=modifieddate ASC&page=1&rows=50

# 2 — find a contact by partial name
GET /api/v1/Contacts?where=company LIKE '%25Acme%25'&page=1&rows=20

# 3 — stock on hand for one barcode
GET /api/v1/Stock?barcode=9400000000001

# 4 — slim product list (context-friendly)
GET /api/v1/Products?fields=id,styleCode,name,status&page=1&rows=100

# 5 — page 2 of a result set (pin the order!)
GET /api/v1/SalesOrders?order=id ASC&page=2&rows=50
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number (`page` + `rows`)
- **Default page size:** 50 [SPEC] — **Maximum:** 250 [SPEC] (400 `"The rows argument cannot be greater than 250."` if exceeded)
- **Total count available:** **NO** — no total anywhere; the big difference from Cin7 Core [DOCUMENTED]
- **How to detect last page:** fetch until the response array is **empty** [DOCUMENTED]. A short
  page does not reliably signal the end — always run to the empty page.

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /api/v1/SalesOrders?order=id ASC&page=1&rows=250   → 250 rows
Page 2: GET /api/v1/SalesOrders?order=id ASC&page=2&rows=250   → 41 rows
Page 3: GET /api/v1/SalesOrders?order=id ASC&page=3&rows=250   → []  → stop
```

(Each page is a separate request against the 3/sec · 60/min · 5,000/day budget.)

### 6.3 Bulk Operations [IMPORTANT]

| Operation   | Endpoint                        | Max Batch Size | Notes                                          |
| ----------- | ------------------------------- | -------------- | ----------------------------------------------- |
| Bulk create | `POST /api/v1/{Resource}`       | **250** [SPEC] | Body is always an array                         |
| Bulk update | `PUT /api/v1/{Resource}`        | **250** [SPEC] | Each element carries its `id`                   |
| Bulk delete | none                            | —              | DELETE is single-record (Contacts, Payments)    |
| Bulk read   | list GET with `rows=250`        | 250/page       |                                                 |

**Partial failure handling:** the 200 write response is a per-record envelope —
`[ { index, success, id, code, errors[] } ]`. Records can fail individually inside a 200; always
check `success` per element [SPEC].

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

None — no export endpoints, no async jobs. Large pulls = paged GETs budgeted against the daily
limit (a 100k-row entity at 250 rows/page = 400 calls).

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?                                | Notes                                       |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| Webhooks (outbound)      | **none found** [UNKNOWN — assumed absent] | The only webhook reference in Omni docs is *inbound* (receiving from Mailchimp). No outbound push API exists in docs or spec. |
| WebSocket / SSE / long polling / change feeds | no                   |                                              |

(Contrast: Cin7 **Core** has 31 webhook event types — another reason not to confuse the products.)

### 7.4 Polling Fallback [IMPORTANT]

Polling with a `modifieddate` watermark is **the only event pattern** for Omni, and the official
rate-limit guidance explicitly recommends it [DOCUMENTED]:

- **Endpoint:** any list GET with `where=modifieddate>='{watermark}'&order=modifieddate ASC`
- **Change detection field:** `modifieddate` (Products, SalesOrders, PurchaseOrders, Contacts, Stock, ...)
- **Budget maths:** 5-minute polls on 5 entities ≈ 1,440 calls/day — fits inside 5,000/day only if
  result sets stay small. Matters mostly for future trigger/sync work, not chat.

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope              | Limit          | Window  | Notes                                |
| ------------------ | -------------- | ------- | ------------------------------------ |
| Per API connection | 3 requests     | second  | [DOCUMENTED]                         |
| Per API connection | 60 requests    | minute  | [DOCUMENTED]                         |
| Per API connection | **5,000 requests** | day | Strict; the binding constraint for bulk work [DOCUMENTED] |

- **Rate limit headers / Retry-After:** none documented [UNKNOWN — needs a live 429]
- **429 body (spec example):** `"Rate limit exceeded. Retry after some time."` [SPEC]
- **Backoff strategy:** ≥350ms spacing keeps under 3/sec; on 429 back off 1s → 5s → 30s → 2m,
  then defer. If the daily budget is exhausted, stop until the window resets — do not spin.

### 8.2 Error Handling [REQUIRED]

**Standard error response format:** the BETA spec types all error bodies as plain **strings**
(e.g. `"Unauthorized access"`, `"Access is forbidden"`) [SPEC]. Real-world bodies unverified
[UNKNOWN] — parse defensively: status code first, then try JSON, fall back to raw text.

| HTTP Status | Meaning                                            | Retryable? | Recovery Action                                            |
| ----------- | --------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| 400         | Validation (batch >250, rows >250, bad page, malformed JSON, duplicate codes) | No | Fix the payload; never blind-retry |
| 401         | Bad API username or key                             | No         | Re-enter credentials (chat card)                            |
| 403         | **Key lacks this endpoint's permission toggle**     | No         | Cin7 admin enables it on the API connection — NOT a credential problem |
| 404         | Wrong id or path                                    | No         | Verify resource/id                                          |
| 429         | Rate limited (3/sec, 60/min, 5,000/day)             | Yes        | Backoff per 8.1                                             |
| 500         | Server error                                        | Cautiously | Retry once with backoff; then surface                       |
| 503         | Scheduled maintenance                               | Yes        | Wait 5–10 min, retry                                        |

**Partial failure inside 200:** write envelopes report per-record `success`/`errors` — see 6.3.

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** no
- GET: idempotent. PUT: re-sends safe for the same payload (id-addressed), but mind
  null-vs-empty-string. **POST retries create duplicates** — except Products, where duplicate
  StyleCodes 400 (an accidental dedup guard). DELETE: idempotent in effect (second call → 404).
- Numa guidance: after a write timeout, **query before retrying** (e.g. search SalesOrders by `reference`).

### 8.4 Async Operations / 8.5 File Handling [IMPORTANT]

- **Async:** none — all synchronous.
- **Files:** `POST /api/v1/ProductImages?productId={id}&imagePriority={n}` is the only file-ish
  endpoint and its request body is **undocumented** [SPEC][UNKNOWN] — do not expose through Numa
  until tested. Product image *URLs* come back in product DTOs (`images[].link`).

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

No etag/version fields in the spec; last-write-wins assumed [UNVERIFIED]. `modifieddate`
granularity is seconds — equal-timestamp edge cases possible during sync.

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — registry `authType: username-password`, NOT Pipedream, NOT OAuth. (Not a file
source — Data Connector (Files) and Hybrid paths don't fit; inventory data, not documents.)

**Justification:** HTTP Basic with two user-pasted values maps 1:1 onto the existing
username-password connector backend (ProWorkflow precedent): the user's vault stores `username`
(= Cin7 API Username) and `password` (= Cin7 API Key), and the backend builds
`Authorization: Basic base64(username:password)` on every call — zero new auth code. The admin
contributes metadata only (no admin credential — there is no account-level secret separate from
the user credential pair, unlike ProWorkflow).

**Numa request flow:**

```
workspace agent → connectors(name="request", params={connector: "cin7-omni", url: "/v1/Products?page=1&rows=50", method: "GET"})
  → backend resolves base_url https://api.cin7.com/api (connector-config-cin7-omni, written by the wizard)
  → injects Authorization: Basic base64(user vault: connector-cin7-omni.username + .password)
  → forwards; the agent never sees the credentials
```

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A.

- **Auth type for connector:** `username-password` — per-user `username` + `password` (the API
  key) in the user's personal vault, captured via the inline chat credential card on first use
- **Per-client config:** none required — fixed SaaS base URL from the registry; wizard instance URL stays empty
- **Connector category:** Inventory — **Caching:** standard project-management preset (don't cache live stock long)
- **Cin7-side prerequisite:** an API connection with the right per-endpoint permission toggles —
  Read on queried entities; Create/Update only if writes are in scope

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Answer inventory/data questions: products, stock by branch/barcode, sales orders, purchase
   orders, quotes, contacts, branches, credit notes, payments — with `where`/`order`/`fields` and pagination
2. Incremental "what changed" reporting via `modifieddate` watermark queries
3. Create/update records on explicit user request: contacts, sales orders, quotes, purchase
   orders, products (validating StyleCode uniqueness first)
4. Look up vouchers by code, stock by barcode; connection diagnostics via `GET /v1/Users?rows=1`

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Set `loadboms=true` on order writes without explicit human confirmation (irreversible)
2. DELETE Contacts or Payments without explicit human confirmation
3. Bulk writes near the 250-record batch limit without confirming intent and checking the daily budget
4. Clear fields accidentally on PUT — never send `""` unless the user explicitly wants the field emptied
5. Upload product images (`ProductImages` body is undocumented)
6. Poll aggressively — respect 3/sec, 60/min, 5,000/day shared by everything on the same API connection

**Default parameters:**

| Parameter | Default                                  | Reason                                  |
| --------- | ---------------------------------------- | ---------------------------------------- |
| rows      | 50 (max 250 when explicitly paging)      | Spec default; context economy            |
| order     | always set when paging                   | Stable pagination                        |
| fields    | minimal explicit list                    | Order/product DTOs are wide              |
| where     | `modifieddate>=` watermark for "recent"  | Avoids full-table walks                  |

### 9.4 SDK Assessment [NICE-TO-HAVE]

None exist for Omni — raw HTTP via the generic `request` proxy suffices.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified, docs/spec retrieved live, quality assessed
- [ ] Phase 2 **partially**: auth model fully documented; **authenticated first-call gate NOT passed (no credentials)**
- [x] Phase 3 complete: core entities + fields from spec; status enums outstanding
- [x] Phase 4 complete: critical endpoints with request/response shapes; full index from live spec
- [x] Phase 5 complete: where/order/fields grammar documented
- [x] Phase 6 complete: page/rows pagination (default 50 / max 250) + 250 batch limit + write envelope
- [x] Phase 7 complete: no webhooks; polling pattern documented
- [x] Phase 8 complete: rate limits exact; error bodies spec-derived, flagged for live verification
- [x] Phase 9 complete: integration path selected (Direct API, username-password connector)

**Overall investigation confidence:** **medium** — endpoint/parameter coverage is excellent (live
docs + live spec), but zero authenticated validation, a BETA spec, and unknown real-world error
bodies cap it.

**Known gaps that will reduce output quality:**

1. **No authenticated call ever made** — error body shapes, response key casing, 429 Retry-After,
   and write-envelope behaviour all need a credentialed test
2. Status/type enum values not enumerated in the spec
3. Sandbox/trial account availability unconfirmed
4. `ProductImages` request body undocumented
5. Default `where` AND/OR combination grammar unverified

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):
**01-llm-api-rules** (Phases 2/4/8/9 — MUST open with the not-live-validated banner + the
two-product warning; mandate human confirmation for `loadboms=true` and DELETEs) ·
**01a-domain-model-reference** (Phase 3) · **01b-query-patterns** (Phases 5–6) ·
**01c-mutation-patterns** (Phases 3.4 + 4: array bodies, 250 batch limit, write envelope,
null-vs-empty, duplicate codes) · **01d-event-and-error-handling** (Phases 7–8) ·
**02-api-spec-investigation** (all phases condensed — companion file) · **03-connector-setup**
(Phase 9 — real registry/wizard/backend wiring) · **04-connection-and-reauth** (Phase 2.3 +
lifecycle: no expiry, regeneration breaks, 403 permission model).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                      |
| ---------------------------- | ------------- | ----------- | ---------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium      | Error bodies + response casing unverified                  |
| 01a-domain-model-reference   | yes           | medium-high | Enum values missing; field lists [SPEC]-solid              |
| 01b-query-patterns           | yes           | high        | where/order/fields grammar fully documented                |
| 01c-mutation-patterns        | yes           | medium-high | Write envelope + batch limit from spec; live behaviour untested |
| 01d-event-and-error-handling | yes           | medium      | Error shapes spec-only; webhook absence is an inference    |
| 02-api-spec-investigation    | yes           | medium-high | Endpoint inventory exact from live spec                    |
| 03-connector-setup           | yes           | high        | Standard username-password connector; wiring is real code  |
| 04-connection-and-reauth     | yes           | high        | Auth lifecycle simple and fully documented                 |

---

_Compiled 2026-06-10 from the Numa API investigation of 2026-05-22 (live retrieval of
`https://api.cin7.com/api` docs, the OAS 3.0 spec, and Swagger UI) — split from the combined
Cin7 Omni + Core investigation into this Omni-only pack. **No authenticated call has been made —
re-validate flagged items with real credentials before first customer use.**_
