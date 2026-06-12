---
api_name: 'Cin7 Omni API'
api_slug: 'cin7-omni'
base_url: 'https://api.cin7.com/api'
version: 'v1 (primary) + v2 (BomMasters only); spec info.version 1.0.0'
spec_format: 'OpenAPI 3.0 (BETA)'
spec_url: 'https://api.cin7.com/api/OpenApi/GetSpec'
docs_url: 'https://api.cin7.com/api (HTML reference); https://help.omni.cin7.com (auth setup guide)'
date_researched: '2026-05-22'
generated_date: '2026-06-10'
---

# Cin7 Omni — API Specification & Investigation

> Developer reference for the Cin7 Omni REST API — the condensed output of
> `00-api-investigation-questionnaire.md`. Compiled from the **official HTML docs** and the
> **live OpenAPI 3.0 spec** (`/api/OpenApi/GetSpec` — 44 paths / 73 operations, marked BETA),
> both retrieved live during the API investigation on 2026-05-22.
>
> ⚠️ **TWO PRODUCTS.** This file covers **Cin7 Omni** (`api.cin7.com`, HTTP Basic auth) ONLY.
> **Cin7 Core** (formerly DEAR Inventory; `inventory.dearsystems.com`, custom-header auth) is a
> completely different API with its own connector (`cin7-core`). Confirm which product the
> customer uses before calling anything.
>
> ⚠️ **NO AUTHENTICATED CALL has been made** — no credentials were available. Endpoint inventory
> and parameters are exact ([CONFIRMED — API investigation 2026-05-22] / [SPEC]); auth behaviour,
> error bodies, and response casing need verification against a real account (§Known Unknowns).

---

## Overview

- **Vendor / product:** Cin7 Omni — inventory and order management for multi-channel retail/wholesale
- **API style:** REST, JSON [DOCUMENTED]
- **Base URL:** `https://api.cin7.com/api` — single shared SaaS host, no per-customer instance [DOCUMENTED]
- **Versions:** v1 for everything; v2 exists only for BomMasters [SPEC]
- **Spec:** `GET /api/OpenApi/GetSpec` — OAS 3.0, ~1.6MB, `info.version: 1.0.0`, **marked BETA**;
  Swagger UI at `/api/swagger` [CONFIRMED — API investigation 2026-05-22]
- **Auth:** HTTP Basic — `Authorization: Basic base64(api-username:api-key)`; spec
  `securitySchemes: { basicAuth: { type: http, scheme: basic } }` applied globally [SPEC]
- **Rate limits:** **3/sec, 60/min, 5,000/day per API connection** [DOCUMENTED]
- **Dates:** UTC, `yyyy-MM-ddTHH:mm:ssZ` [DOCUMENTED] — **IDs:** integers [SPEC]
- **Scale:** **44 paths / 73 operations / 24 resource families** [SPEC]
- **No webhooks, no SDKs, no Postman collection** — polling with `modifieddate` is the only event
  pattern [DOCUMENTED guidance; outbound webhooks not found anywhere — UNKNOWN/assumed absent]

**Summary:** A compact, uniform inventory API — products (+options/BOMs/categories/images), sales
orders (+cartons), purchase orders, quotes, contacts, stock, adjustments, branches/transfers,
payments/credit notes/fees, production jobs, serials, sizes, users, vouchers. Every list endpoint
shares one query grammar (`fields`/`where`/`order`/`page`/`rows`); every write takes an array and
returns a per-record result envelope.

**Numa integration model:** Native data connector (`authType: username-password`, NOT Pipedream).
The workspace agent calls
`connectors(name="request", params={connector: "cin7-omni", url: "/v1/Products?page=1&rows=50", method: "GET"})`.
The backend expands relative URLs against the stored `base_url` (`https://api.cin7.com/api`) and
injects `Authorization: Basic base64(username:password)` from the user's personal vault
(`connector-cin7-omni` — `username` = API Username, `password` = API Key). The agent never sees
the credentials. See `03-connector-setup.md`.

---

## Authentication

**Method:** HTTP Basic Authentication over HTTPS — checked on **every request**; no sessions, no
tokens, no expiry [DOCUMENTED].

```
Authorization: Basic <base64(api-username:api-key)>
```

**Credential setup (Cin7 Omni admin)** [DOCUMENTED — help.omni.cin7.com article 10015165519503]:

1. **Settings → Integrations & API → API v1**
2. Note the **API Username** — account-level, shared across all connections
3. **Add New API Connection** → name it → copy the generated **API Key** (per-connection)
4. Toggle the connection's per-endpoint **Create / Read / Update / Write** permissions

**Permission model — the defining Omni quirk** [DOCUMENTED]:

Each API key carries independent per-endpoint permission toggles. The failure semantics are:

| Status | Meaning                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| 401    | Bad credentials (wrong username or key, or key regenerated) — spec example body `"Unauthorized access"` [SPEC] |
| 403    | Credentials are **valid** but the key lacks this endpoint's permission toggle — spec example body `"Access is forbidden"` [SPEC]. Fixed in Cin7's API settings UI, never in Numa. |

**Key lifecycle** [DOCUMENTED]:

- No expiry — static credentials
- Regenerating a key **invalidates the old key immediately** (breaks integrations until re-entered)
- Fixed cap on API connections per account; exceeding it requires Cin7 support
- Rate limits are **per connection** — a dedicated connection for Numa isolates its budget from
  the customer's other integrations

---

## Endpoint Inventory [SPEC — 44 paths / 73 ops, retrieved live 2026-05-22]

### Conventions

```
GET    /api/v1/{Resource}?fields&where&order&page&rows    list/search (identical params everywhere)
GET    /api/v1/{Resource}/{id}                            single record by integer id
POST   /api/v1/{Resource}                                 create — body is an ARRAY (≤250)
PUT    /api/v1/{Resource}                                 update — body is an ARRAY (≤250, each with id)
DELETE /api/v1/{Resource}/{id}                            Contacts and Payments only
```

### Full catalogue

| Resource                         | GET list | GET /{id} | POST | PUT | DELETE | Notes                                            |
| -------------------------------- | -------- | --------- | ---- | --- | ------ | ------------------------------------------------- |
| `/v1/Adjustments`                | ✓        | ✓         | ✓    | ✓   | —      | Inventory adjustments                              |
| `/v1/BomMasters`                 | ✓        | ✓         | —    | —   | —      | Read-only; also `/v2/BomMasters[/{id}]`            |
| `/v1/Branches`                   | ✓        | ✓         | ✓    | ✓   | —      | Warehouses/stores                                  |
| `/v1/BranchTransfers`            | ✓        | ✓         | ✓    | ✓   | —      | Inter-branch movements                             |
| `/v1/Cartons/{id}`               | —        | ✓         | —    | ✓   | —      | Per-sales-order carton list; PUT replaces it       |
| `/v1/Contacts`                   | ✓        | ✓         | ✓    | ✓   | **✓**  | Customers/suppliers; one of two DELETEs            |
| `/v1/CreditNotes`                | ✓        | ✓         | ✓    | ✓   | —      |                                                    |
| `/v1/PaymentFeesAndPayouts/Fees` | ✓        | —         | —    | —   | —      | Read-only                                          |
| `/v1/PaymentFeesAndPayouts/Payouts` | ✓     | —         | —    | —   | —      | Read-only                                          |
| `/v1/Payments`                   | ✓        | ✓         | ✓    | ✓   | **✓**  | One of two DELETEs                                 |
| `/v1/ProductCategories`          | ✓        | ✓         | ✓    | ✓   | —      |                                                    |
| `/v1/ProductImages`              | —        | —         | ✓    | —   | —      | `?productId={id}&imagePriority={n}`; **body undocumented** |
| `/v1/ProductionJobs`             | ✓        | ✓         | ✓    | ✓   | —      | Manufacturing                                      |
| `/v1/ProductOptions`             | ✓        | ✓         | ✓    | ✓   | —      | Variant-level records                              |
| `/v1/Products`                   | ✓        | ✓         | ✓    | ✓   | —      | Duplicate StyleCode/OptionCode on POST → 400       |
| `/v1/PurchaseOrders`             | ✓        | ✓         | ✓    | ✓   | —      | POST/PUT take `?loadboms={bool}`                   |
| `/v1/Quotes`                     | ✓        | ✓         | ✓    | ✓   | —      | POST/PUT take `?loadboms={bool}`                   |
| `/v1/SalesOrders`                | ✓        | ✓         | ✓    | ✓   | —      | POST/PUT take `?loadboms={bool}`                   |
| `/v1/SalesOrdersWithCartons`     | ✓        | ✓         | —    | —   | —      | Read-only order+carton view                        |
| `/v1/SerialNumbers`              | ✓        | ✓         | —    | —   | —      | Read-only                                          |
| `/v1/SizeRanges`                 | ✓        | ✓         | —    | —   | —      | Read-only size grids                               |
| `/v1/Stock`                      | ✓        | —         | —    | —   | —      | Read-only; supports `?barcode={code}` lookup       |
| `/v1/Users`                      | ✓        | ✓         | —    | —   | —      | Read-only; new users ≤2h propagation [DOCUMENTED]  |
| `/v1/Voucher`                    | ✓        | —         | —    | —   | —      | Read-only; supports `?code={code}` lookup          |

**`loadboms` (SalesOrders/Quotes/PurchaseOrders POST+PUT):** "An option to expand BOM's
(**This cannot be undone**)" [SPEC]. Require explicit human confirmation in Numa before setting it.

---

## Query Grammar (all list GETs) [DOCUMENTED][SPEC]

| Parameter | Default | Description                                                                |
| --------- | ------- | --------------------------------------------------------------------------- |
| `fields`  | all     | Comma-separated projection; nested child selection: `fields=id,invoicedate,lineitems(code)` |
| `where`   | —       | SQL-like filter — **parent-level fields only** (no line-item filtering)     |
| `order`   | —       | Sort field(s); **default direction DESC**, append ` ASC` to reverse         |
| `page`    | 1       | 1-based page number                                                         |
| `rows`    | **50**  | Rows per page, **max 250** [SPEC]                                           |

**`where` operators:** `=`, `<>`, `>`, `<`, `<=`, `>=`, `IS`, `IS NOT`, `LIKE`, `NOT LIKE`, `IN`
[DOCUMENTED]. Encode `%` as `%25` inside expressions: `name LIKE '%25Widget%25'` [DOCUMENTED].

**Worked examples:**

```http
GET /api/v1/SalesOrders?where=modifieddate>='2026-06-01T00:00:00Z'&order=modifieddate ASC&page=1&rows=50
GET /api/v1/Contacts?where=company LIKE '%25Acme%25'&page=1&rows=20
GET /api/v1/Products?fields=id,styleCode,name,status&page=1&rows=100
GET /api/v1/Stock?barcode=9400000000001
GET /api/v1/Voucher?code=GIFT-2026
GET /api/v1/SalesOrders?where=id IN (101,102,103)
GET /api/v1/Contacts?where=integrationRef IS NULL&page=1&rows=50
```

---

## Pagination

- **Type:** page-number — `page` (1-based) + `rows` (default 50, max 250) [SPEC]
- **Total count:** **NONE** — no total anywhere in list responses [DOCUMENTED]
- **Last-page detection:** fetch until the response array is **empty**; do not stop on a short page
- 400 messages enforce the bounds: `"The page number is out of range..."`,
  `"The rows argument cannot be greater than 250."` [SPEC]

```
Page 1: GET /api/v1/Products?order=id ASC&page=1&rows=250   → 250 rows
Page N: ...                                                  → [] → stop
```

Budget note: every page is one request against 3/sec · 60/min · **5,000/day**.

---

## Write Semantics

**Request shape:** POST/PUT bodies are **arrays** — wrap single records in `[ ... ]`.
**Batch limit: 250** records per request — exceeding it returns 400 `"Batch limit is 250."` [SPEC]

**Response shape (200):** a per-record result envelope, NOT the created/updated entities [SPEC]:

```json
[
  { "index": 0, "success": true,  "id": 1, "code": "SALE4-28", "errors": [] },
  { "index": 1, "success": false, "id": 0, "code": "",          "errors": ["..."] }
]
```

⚠️ A 200 does NOT mean every record succeeded — **check `success` per element**. DELETE responds
with the same envelope shape [SPEC].

**Product-specific rules** [DOCUMENTED]:

- POST: duplicate `StyleCode` or `ProductOptionCode` → the **whole request** is rejected with 400
- PUT: `null` = leave field unchanged; `""` (empty string) = **clear the field** — silent data
  loss if confused
- `InvoiceNumber` (SalesOrders) is read-only; assigned when `InvoiceDate` is set [SPEC]

---

## Data Models [SPEC extracts]

> Schema property names are PascalCase but every spec response *example* is camelCase
> (`styleCode`, `modifiedDate`) and documented query examples use lowercase (`modifieddate`).
> Expect camelCase responses; verify case-sensitivity live [UNVERIFIED].

### Product (top-level fields)

`Id`, `Status`, `CreatedDate`, `ModifiedDate`, `StyleCode`, `Name`, `Description`, `Tags`,
`Images[].Link`, `PdfUpload`, `PdfDescription`, `SupplierId`, `Brand`, `Category`, `SubCategory`,
`CategoryIdArray`, `Channels`, `Weight`, `Height`, `Width`, `Length`, `Volume`, `StockControl`,
`OrderType`, `ProductType`, `ProductSubtype`, `ProjectName`, `OptionLabel1–3`, `SalesAccount`,
`PurchasesAccount`, `ImportCustomsDuty`, `SizeRangeId`, `CustomFields`, `ProductOptions[]`.

### Stock row

```json
{ "productId": 1, "productOptionId": 0, "modifiedDate": "2026-06-10T05:28:32Z",
  "styleCode": "StyleCode123", "code": "ABC123", "barcode": "123456789012",
  "branchId": 1, "branchName": "Main Branch", "productName": "T-Shirt",
  "option1": "Red", "option2": null, "option3": null, "size": "XXL",
  "available": 2.0, "stockOnHand": 9.0, "openSales": 7.0,
  "incoming": 8.0, "virtual": 0.0, "holding": 0.0 }
```

(`available` = stockOnHand − openSales + incoming adjustments — exact formula [UNVERIFIED].)

### SalesOrder (selected header fields)

`Id`, `CreatedDate`, `ModifiedDate`, `CreatedBy`, `ProcessedBy`, `IsApproved`, `Reference`,
`MemberId` (customer Contact id), customer snapshot (`FirstName`/`LastName`/`Company`/`Email`/
`Phone`/`Mobile`/`Fax`), full `Delivery*` and `Billing*` address blocks, `BranchId`, `BranchEmail`,
`ProjectName`, `TrackingCode`, `InternalComments`, `ProductTotal`, `FreightTotal`,
`InvoiceDate` (setting it assigns the read-only `InvoiceNumber`), `DispatchedDate`,
`LogisticsCarrier`/`LogisticsStatus`, `EdiStatus`, `DistributionBranchId`, `LineItems[]`.

**LineItem:** `StyleCode`, `Code`, `Barcode` (if it exists in Cin7, only quantity is required),
`SizeCodes` (`Qty|Size|Code|Barcode` packed string), quantities and prices [SPEC].

### Contact (selected)

`Id`, `IsActive`, `Type` (customer/supplier), `Company`, `FirstName`, `LastName`, `JobTitle`,
`Email`, `Website`, `Phone`, `Fax`, `Mobile`, street + postal address blocks, `Notes`,
`IntegrationRef`, `CustomFields`, `SecondaryContacts[]`, `SalesPersonId`, `AccountNumber`,
billing/accounts-contact fields, `CreatedDate`, `ModifiedDate`.

### BomMaster (component fields)

`Id`, `ProductId`, `ProductOptionId`, `Type` (enum: `Undefined` | `Make` | `Use` | `Addon`),
`Code`, `Name`, `Option1–3`, `Qty` (**required**), `UnitCost` [SPEC].

---

## Rate Limits

| Scope              | Limit  | Window | Response |
| ------------------ | ------ | ------ | -------- |
| Per API connection | 3      | second | 429      |
| Per API connection | 60     | minute | 429      |
| Per API connection | **5,000** | day | 429      |

[DOCUMENTED]. No rate-limit headers documented; `Retry-After` presence [UNKNOWN]. 429 spec example
body: `"Rate limit exceeded. Retry after some time."` [SPEC].

**Official guidance:** keep a local copy of data and poll with `modifieddate` filters to fetch only
changed records [DOCUMENTED]. The 5,000/day budget is the binding constraint — a full pull of a
100k-row entity at 250 rows/page costs 400 calls.

**Backoff:** ≥350ms spacing stays under 3/sec; on 429 back off 1s → 5s → 30s → 2m, then defer to
the next window. Never busy-retry a daily-budget 429.

---

## Error Handling

**Status codes** [DOCUMENTED][SPEC]:

| Status | Meaning                                              | Retryable? | Recovery                                              |
| ------ | ----------------------------------------------------- | ---------- | ------------------------------------------------------ |
| 200    | OK — but check per-record `success` on writes         | —          |                                                        |
| 400    | Validation: page out of range, rows > 250, batch > 250, malformed JSON, duplicate codes | No | Fix payload |
| 401    | Bad username/key (or key regenerated)                 | No         | Re-enter credentials via the chat card                 |
| 403    | **Key lacks the endpoint's permission toggle**        | No         | Cin7 admin enables it on the API connection            |
| 404    | Wrong id or path                                      | No         | Verify resource/id                                     |
| 429    | Rate limited                                          | Yes        | Backoff; respect daily budget                          |
| 500    | Server error                                          | Cautiously | Retry once; then surface                               |
| 503    | Scheduled maintenance                                 | Yes        | Wait 5–10 min                                          |

**Bodies:** the BETA spec types every error body as a plain **string** (`"Unauthorized access"`,
`"Access is forbidden"`, `"Resource not found"`, enumerated 400 messages) [SPEC]. Real-world shape
unverified [UNKNOWN] — parse defensively: status first, try JSON, fall back to raw text.

**Idempotency:** no idempotency keys. GET/DELETE idempotent; PUT re-sends safe (id-addressed);
**POST retries duplicate records** (except Products, where duplicate StyleCodes 400). After a write
timeout, query before retrying.

---

## Events / Webhooks

**None.** No outbound webhook API exists in the docs or spec — the only webhook reference found is
*inbound* (receiving from Mailchimp) [UNKNOWN — assumed absent]. Cin7 **Core** has webhooks; Omni
does not. **Polling with a `modifieddate` watermark is the only event pattern** [DOCUMENTED
guidance]:

```
GET /api/v1/{Resource}?where=modifieddate>='{watermark}'&order=modifieddate ASC&page=1&rows=250
→ walk pages until empty; advance watermark to the highest modifieddate seen
```

Budget the polling cadence against 5,000/day (e.g. 5-minute polls on 5 entities ≈ 1,440 calls/day
before result pages).

---

## OpenAPI Spec Notes

- **URL:** `https://api.cin7.com/api/OpenApi/GetSpec` [CONFIRMED — API investigation 2026-05-22]
- **Format:** OpenAPI 3.0.0; `info.version 1.0.0`; ~1.6MB — parse selectively per entity
- **Status: BETA** — Cin7's own framing; treat as supplementary to the HTML docs at
  `https://api.cin7.com/api` and verify critical fields against a real account [DOCUMENTED]
- Carries inline request/response **examples** per endpoint (the source of the camelCase
  observation), parameter docs (rows default/max), enumerated 400 messages, and the
  global `basicAuth` security scheme
- Quirk: schemas are inlined per path (no `components.schemas`), so the same entity shape repeats

---

## Integration Path Assessment

**Recommended path:** **Direct API via Numa native data connector** (`request` operation),
registry `authType: username-password` — NOT Pipedream, NOT OAuth. Implemented; see
`03-connector-setup.md` for the real wiring and `04-connection-and-reauth.md` for lifecycle.

**Justification:** HTTP Basic with two user-pasted values (API username + API key) rides the
existing username-password backend (`_user_connector_basic_creds` → `Authorization: Basic ...`)
with zero new auth code. The admin contributes metadata only — unlike ProWorkflow there is no
separate account-level secret; both halves of the credential live in the user's personal vault.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not apply).

**Rollout checklist (per customer):**

1. Confirm the customer is on **Omni** (login at `go.cin7.com`/`app.cin7.com`), not Core
2. Cin7 admin: create a **dedicated API connection for Numa** (own key, own rate-limit budget)
   and enable per-endpoint permissions — Read on queried entities; Create/Update only if writes
   are in scope
3. Numa admin: add **Cin7 Omni** in Integrations (wizard is metadata-only; leave instance URL empty)
4. Each user: paste API Username + API Key into the chat credential card on first use
5. Verify: `GET /v1/Users?rows=1` → 200; then a 403 walk across needed entities to surface missing
   permission toggles early
6. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md` with findings

---

## Known Unknowns — verify on a credentialed account before customer rollout

1. **Error body shapes in the wild** — spec says plain strings; confirm 400/401/403/429 bodies
   and whether 429 includes `Retry-After`
2. **Response key casing + query-field case sensitivity** — examples say camelCase responses,
   lowercase query fields; confirm
3. **Write envelope behaviour** — partial-failure semantics inside a 200 batch
4. **Default `where` AND/OR combination grammar** — single-expression docs only
5. **Status/type enum values** (Product.Status, order statuses) — not enumerated in the spec
6. **`ProductImages` POST body** — undocumented; needed before exposing image upload
7. **Sandbox/trial availability** — unconfirmed; all testing currently requires a live account
8. **`fields` nested-projection syntax across entities** — documented for SalesOrders
   (`lineitems(code)`); verify for others
9. **Stock `modifiedDate` reliability** as an incremental watermark
10. **BETA spec drift** — diff the spec against the HTML docs for any entity before building on
    its field list

---

_Researched 2026-05-22 (live retrieval of docs + OAS3 spec + Swagger UI), split into this
Omni-only pack 2026-06-10. **No authenticated call was possible — docs/spec-derived only.**
Source: `00-api-investigation-questionnaire.md`._
