---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
path_version_segment: /v1/ all entities, /v2/ BomMasters only — a REAL path segment, not a label. info.version 1.0.0 is just the spec version.
auth: HTTP Basic base64(api-username:api-key), global securityScheme basicAuth
field_casing: schema PascalCase; spec response examples camelCase; query fields lowercase in docs — case-sensitivity [UNVERIFIED]
id_format: integer
rate_limit: 3/sec, 60/min, 5000/day per API connection
spec_format: OpenAPI 3.0 (BETA) — 44 paths / 73 operations / 24 resource families
spec_url: https://api.cin7.com/api/OpenApi/GetSpec (Swagger UI /api/swagger)
docs_url: https://api.cin7.com/api (HTML reference); https://help.omni.cin7.com (auth setup)
call_surface: HTTP via Numa native data connector, `request` operation (authType username-password). NOT Pipedream, NOT OAuth, NOT a file source.
doc_role: developer spec — endpoint inventory, auth, data models, integration assessment
confidence: docs + live OpenAPI 3.0 spec retrieved 2026-05-22; treat as fact unless tagged [UNVERIFIED] or [UNKNOWN]. **NO authenticated call was possible** — auth behaviour, error bodies, response casing need verification on a real account (see Known Unknowns).
---

# Cin7 Omni — API Specification & Investigation

> ⚠️ **TWO PRODUCTS.** Omni (`api.cin7.com`, HTTP Basic) ONLY. **Core** (formerly DEAR Inventory; `inventory.dearsystems.com`, custom-header auth) is a different API with its own connector `cin7-core`. Confirm which product before calling.

## Overview

- **Product:** Cin7 Omni — inventory/order management for multi-channel retail/wholesale. REST, JSON. Single shared SaaS host `https://api.cin7.com/api`, no per-customer instance.
- **Versions:** v1 for everything; v2 only for BomMasters.
- **Spec:** `GET /api/OpenApi/GetSpec` — OAS 3.0, ~1.6MB, `info.version 1.0.0`, **BETA**.
- **Auth:** HTTP Basic — `Authorization: Basic base64(api-username:api-key)`; global `securitySchemes:{basicAuth:{type:http,scheme:basic}}`.
- **Rate limits:** 3/sec, 60/min, 5,000/day per API connection; 429 on exceed.
- **Dates:** UTC `yyyy-MM-ddTHH:mm:ssZ`. **IDs:** integers. **Scale:** 44 paths / 73 ops / 24 resource families.
- **No webhooks, no SDKs, no Postman collection** — polling with `modifieddate` is the only event pattern (outbound webhooks not found anywhere — [UNKNOWN/assumed absent]).
- **Shape:** every list endpoint shares one query grammar (`fields`/`where`/`order`/`page`/`rows`); every write takes an array and returns a per-record result envelope.

**Numa integration model:** Native data connector (`authType: username-password`, NOT Pipedream). Agent calls `connectors(name="request", params={connector:"cin7-omni", url:"/v1/Products?page=1&rows=50", method:"GET"})`. Backend expands relative URLs against stored `base_url` and injects `Authorization: Basic base64(username:password)` from the user's personal vault (`connector-cin7-omni` — `username`=API Username, `password`=API Key). Agent never sees credentials. See `03-connector-setup.md`.

## Authentication

HTTP Basic over HTTPS, checked on **every request** — no sessions, tokens, or expiry.

```
Authorization: Basic <base64(api-username:api-key)>
```

**Setup (Cin7 Omni admin)** [help.omni.cin7.com article 10015165519503]:

1. Settings → Integrations & API → API v1.
2. Note the **API Username** — account-level, shared across all connections.
3. **Add New API Connection** → name it → copy the generated **API Key** (per-connection).
4. Toggle the connection's per-endpoint **Create / Read / Update / Write** permissions.

**Permission model — the defining Omni quirk:** each key carries independent per-endpoint toggles.
| Status | Meaning |
| --- | --- |
| 401 | Bad credentials (wrong username/key, or key regenerated) — spec body `"Unauthorized access"` |
| 403 | Credentials **valid** but the key lacks this endpoint's toggle — spec body `"Access is forbidden"`. Fixed in Cin7's API settings UI, never in Numa. |

**Key lifecycle:** no expiry (static); regenerating a key **invalidates the old one immediately**; fixed cap on connections per account (raising it needs Cin7 support); rate limits are **per connection** — a dedicated Numa connection isolates its budget from the customer's other integrations.

## Endpoint inventory (44 paths / 73 ops)

### Conventions

```
GET    /api/v1/{Resource}?fields&where&order&page&rows    list/search (identical params everywhere)
GET    /api/v1/{Resource}/{id}                            single record by integer id
POST   /api/v1/{Resource}                                 create — body is an ARRAY (≤250)
PUT    /api/v1/{Resource}                                 update — body is an ARRAY (≤250, each with id)
DELETE /api/v1/{Resource}/{id}                            Contacts and Payments only
```

### Catalogue

| Resource                            | list | /{id} | POST | PUT | DELETE | Notes                                                      |
| ----------------------------------- | ---- | ----- | ---- | --- | ------ | ---------------------------------------------------------- |
| `/v1/Adjustments`                   | ✓    | ✓     | ✓    | ✓   | —      | inventory adjustments                                      |
| `/v1/BomMasters`                    | ✓    | ✓     | —    | —   | —      | read-only; also `/v2/BomMasters[/{id}]`                    |
| `/v1/Branches`                      | ✓    | ✓     | ✓    | ✓   | —      | warehouses/stores                                          |
| `/v1/BranchTransfers`               | ✓    | ✓     | ✓    | ✓   | —      | inter-branch movements                                     |
| `/v1/Cartons/{id}`                  | —    | ✓     | —    | ✓   | —      | per-sales-order carton list; PUT replaces it               |
| `/v1/Contacts`                      | ✓    | ✓     | ✓    | ✓   | **✓**  | customers/suppliers; one of two DELETEs                    |
| `/v1/CreditNotes`                   | ✓    | ✓     | ✓    | ✓   | —      |                                                            |
| `/v1/PaymentFeesAndPayouts/Fees`    | ✓    | —     | —    | —   | —      | read-only                                                  |
| `/v1/PaymentFeesAndPayouts/Payouts` | ✓    | —     | —    | —   | —      | read-only                                                  |
| `/v1/Payments`                      | ✓    | ✓     | ✓    | ✓   | **✓**  | one of two DELETEs                                         |
| `/v1/ProductCategories`             | ✓    | ✓     | ✓    | ✓   | —      |                                                            |
| `/v1/ProductImages`                 | —    | —     | ✓    | —   | —      | `?productId={id}&imagePriority={n}`; **body undocumented** |
| `/v1/ProductionJobs`                | ✓    | ✓     | ✓    | ✓   | —      | manufacturing                                              |
| `/v1/ProductOptions`                | ✓    | ✓     | ✓    | ✓   | —      | variant-level records                                      |
| `/v1/Products`                      | ✓    | ✓     | ✓    | ✓   | —      | duplicate StyleCode/OptionCode on POST → 400               |
| `/v1/PurchaseOrders`                | ✓    | ✓     | ✓    | ✓   | —      | POST/PUT take `?loadboms={bool}`                           |
| `/v1/Quotes`                        | ✓    | ✓     | ✓    | ✓   | —      | POST/PUT take `?loadboms={bool}`                           |
| `/v1/SalesOrders`                   | ✓    | ✓     | ✓    | ✓   | —      | POST/PUT take `?loadboms={bool}`                           |
| `/v1/SalesOrdersWithCartons`        | ✓    | ✓     | —    | —   | —      | read-only order+carton view                                |
| `/v1/SerialNumbers`                 | ✓    | ✓     | —    | —   | —      | read-only                                                  |
| `/v1/SizeRanges`                    | ✓    | ✓     | —    | —   | —      | read-only size grids                                       |
| `/v1/Stock`                         | ✓    | —     | —    | —   | —      | read-only; supports `?barcode={code}`                      |
| `/v1/Users`                         | ✓    | ✓     | —    | —   | —      | read-only; new users ≤2h propagation                       |
| `/v1/Voucher`                       | ✓    | —     | —    | —   | —      | read-only; supports `?code={code}`                         |

**`loadboms` (SalesOrders/Quotes/PurchaseOrders POST+PUT):** "An option to expand BOM's (**This cannot be undone**)". Require explicit human confirmation in Numa before setting it.

## Query grammar (all list GETs)

| Param    | Default | Description                                                                                |
| -------- | ------- | ------------------------------------------------------------------------------------------ |
| `fields` | all     | comma-separated projection; nested child selection `fields=id,invoicedate,lineitems(code)` |
| `where`  | —       | SQL-like filter — **parent-level fields only** (no line-item filtering)                    |
| `order`  | —       | sort field(s); **default direction DESC**, append ` ASC` to reverse                        |
| `page`   | 1       | 1-based page number                                                                        |
| `rows`   | **50**  | rows per page, **max 250**                                                                 |

**`where` operators:** `=`, `<>`, `>`, `<`, `<=`, `>=`, `IS`, `IS NOT`, `LIKE`, `NOT LIKE`, `IN`. Encode `%` as `%25`: `name LIKE '%25Widget%25'`.

```http
GET /api/v1/SalesOrders?where=modifieddate>='2026-06-01T00:00:00Z'&order=modifieddate ASC&page=1&rows=50
GET /api/v1/Contacts?where=company LIKE '%25Acme%25'&page=1&rows=20
GET /api/v1/Products?fields=id,styleCode,name,status&page=1&rows=100
GET /api/v1/Stock?barcode=9400000000001
GET /api/v1/Voucher?code=GIFT-2026
GET /api/v1/SalesOrders?where=id IN (101,102,103)
GET /api/v1/Contacts?where=integrationRef IS NULL&page=1&rows=50
```

## Pagination

Page-number: `page` (1-based) + `rows` (default 50, max 250). **No total count anywhere.** Last-page detection: fetch until the response array is **empty** (do not stop on a short page). Bounds enforced by 400 strings: `"The page number is out of range; the value must be greater than or equal to 1."`, `"The rows argument cannot be greater than 250."`. Every page is one request against 3/sec · 60/min · 5,000/day.

## Write semantics

- **Request:** POST/PUT bodies are **arrays** — wrap single records in `[...]`. **Batch limit 250** → over → 400 `"Batch limit is 250."`.
- **Response (200):** a per-record envelope, NOT the created/updated entities — **check `success` per element**; a 200 doesn't mean every record succeeded. DELETE returns the same shape.

```json
[
  { "index": 0, "success": true, "id": 1, "code": "SALE4-28", "errors": [] },
  { "index": 1, "success": false, "id": 0, "code": "", "errors": ["..."] }
]
```

- **Product-specific:** POST duplicate `StyleCode`/`ProductOptionCode` → **whole request** rejected 400. PUT `null`=leave unchanged, `""`=**clear the field** (silent data loss if confused). `InvoiceNumber` (SalesOrders) read-only, assigned when `InvoiceDate` is set.

## Data models [SPEC extracts]

> Schema names are PascalCase but every spec response _example_ is camelCase (`styleCode`,`modifiedDate`) and documented query examples use lowercase (`modifieddate`). Expect camelCase responses; verify case-sensitivity live [UNVERIFIED].

**Product (top-level):** `Id`,`Status`,`CreatedDate`,`ModifiedDate`,`StyleCode`,`Name`,`Description`,`Tags`,`Images[].Link`,`PdfUpload`,`PdfDescription`,`SupplierId`,`Brand`,`Category`,`SubCategory`,`CategoryIdArray`,`Channels`,`Weight`,`Height`,`Width`,`Length`,`Volume`,`StockControl`,`OrderType`,`ProductType`,`ProductSubtype`,`ProjectName`,`OptionLabel1–3`,`SalesAccount`,`PurchasesAccount`,`ImportCustomsDuty`,`SizeRangeId`,`CustomFields`,`ProductOptions[]`.

**Stock row:** `{"productId":1,"productOptionId":0,"modifiedDate":"2026-06-10T05:28:32Z","styleCode":"StyleCode123","code":"ABC123","barcode":"123456789012","branchId":1,"branchName":"Main Branch","productName":"T-Shirt","option1":"Red","option2":null,"option3":null,"size":"XXL","available":2.0,"stockOnHand":9.0,"openSales":7.0,"incoming":8.0,"virtual":0.0,"holding":0.0}` (`available` = stockOnHand − openSales + incoming adjustments — exact formula [UNVERIFIED]).

**SalesOrder (selected header):** `Id`,`CreatedDate`,`ModifiedDate`,`CreatedBy`,`ProcessedBy`,`IsApproved`,`Reference`,`MemberId` (customer Contact id), customer snapshot (`FirstName`/`LastName`/`Company`/`Email`/`Phone`/`Mobile`/`Fax`), full `Delivery*`+`Billing*` address blocks,`BranchId`,`BranchEmail`,`ProjectName`,`TrackingCode`,`InternalComments`,`ProductTotal`,`FreightTotal`,`InvoiceDate` (setting it assigns the read-only `InvoiceNumber`),`DispatchedDate`,`LogisticsCarrier`/`LogisticsStatus`,`EdiStatus`,`DistributionBranchId`,`LineItems[]`.
**LineItem:** `StyleCode`,`Code`,`Barcode` (if it exists in Cin7, only quantity is required),`SizeCodes` (`Qty|Size|Code|Barcode` packed string), quantities + prices.

**Contact (selected):** `Id`,`IsActive`,`Type` (customer/supplier),`Company`,`FirstName`,`LastName`,`JobTitle`,`Email`,`Website`,`Phone`,`Fax`,`Mobile`, street+postal address blocks,`Notes`,`IntegrationRef`,`CustomFields`,`SecondaryContacts[]`,`SalesPersonId`,`AccountNumber`, billing/accounts-contact fields,`CreatedDate`,`ModifiedDate`.

**BomMaster (component):** `Id`,`ProductId`,`ProductOptionId`,`Type` (`Undefined`|`Make`|`Use`|`Addon`),`Code`,`Name`,`Option1–3`,`Qty` (**required**),`UnitCost`.

(Full field/enum tables: `01a-domain-model-reference.md`.)

## Rate limits

| Scope              | Limit     | Window | Response |
| ------------------ | --------- | ------ | -------- |
| Per API connection | 3         | second | 429      |
| Per API connection | 60        | minute | 429      |
| Per API connection | **5,000** | day    | 429      |

No rate-limit headers documented; `Retry-After` presence [UNKNOWN]. 429 spec body `"Rate limit exceeded. Retry after some time."`. **Official guidance:** keep a local copy and poll with `modifieddate` filters. The 5,000/day budget is the binding constraint — a full pull of a 100k-row entity at 250/page costs 400 calls. **Backoff:** ≥350ms spacing stays under 3/sec; on 429 back off 1s→5s→30s→2m then defer to the next window. Never busy-retry a daily-budget 429.

## Error handling

| Status | Meaning                                                                             | Retryable? | Recovery                                    |
| ------ | ----------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| 200    | OK — check per-record `success` on writes                                           | —          |                                             |
| 400    | validation: page out of range, rows>250, batch>250, malformed JSON, duplicate codes | No         | fix payload                                 |
| 401    | bad username/key (or regenerated)                                                   | No         | re-enter credentials via the chat card      |
| 403    | **key lacks the endpoint's permission toggle**                                      | No         | Cin7 admin enables it on the API connection |
| 404    | wrong id or path                                                                    | No         | verify resource/id                          |
| 429    | rate limited                                                                        | Yes        | backoff; respect daily budget               |
| 500    | server error                                                                        | Cautiously | retry once; then surface                    |
| 503    | maintenance                                                                         | Yes        | wait 5–10 min                               |

**Bodies:** the BETA spec types every error body as a plain **string** (`"Unauthorized access"`,`"Access is forbidden"`,`"Resource not found"`, enumerated 400 messages). Real-world shape unverified [UNKNOWN] — parse defensively: status first, try JSON, fall back to raw text.
**Idempotency:** none. GET/DELETE idempotent; PUT re-sends safe (id-addressed); **POST retries duplicate records** (except Products dup StyleCodes 400). After a write timeout, query before retrying.

## Events / webhooks

**None.** No outbound webhook API in docs or spec — the only webhook reference found is _inbound_ (receiving from Mailchimp) [UNKNOWN — assumed absent]. Cin7 **Core** has webhooks; Omni does not. **Polling with a `modifieddate` watermark is the only event pattern:**

```
GET /api/v1/{Resource}?where=modifieddate>='{watermark}'&order=modifieddate ASC&page=1&rows=250
→ walk pages until empty; advance watermark to the highest modifieddate seen
```

Budget the cadence against 5,000/day (e.g. 5-min polls on 5 entities ≈ 1,440 calls/day before result pages). Full operational loop: `01d`.

## OpenAPI spec notes

- URL `https://api.cin7.com/api/OpenApi/GetSpec`; OAS 3.0.0; `info.version 1.0.0`; ~1.6MB — parse selectively per entity.
- **BETA** (Cin7's own framing) — supplementary to the HTML docs at `https://api.cin7.com/api`; verify critical fields against a real account.
- Carries inline request/response **examples** per endpoint (source of the camelCase observation), parameter docs (rows default/max), enumerated 400 messages, and the global `basicAuth` scheme.
- Quirk: schemas are inlined per path (no `components.schemas`), so the same entity shape repeats.

## Integration path assessment

**Recommended:** Direct API via Numa native data connector (`request` op), registry `authType: username-password` — NOT Pipedream, NOT OAuth. Implemented; see `03-connector-setup.md` (wiring) and `04-connection-and-reauth.md` (lifecycle).
**Why:** HTTP Basic with two user-pasted values (API username + API key) rides the existing username-password backend (`_user_connector_basic_creds` → `Authorization: Basic ...`) with zero new auth code. The admin contributes metadata only — unlike ProWorkflow there is no separate account-level secret; both credential halves live in the user's personal vault.
**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not apply).

**Rollout checklist (per customer):**

1. Confirm the customer is on **Omni** (login at `go.cin7.com`/`app.cin7.com`), not Core.
2. Cin7 admin: create a **dedicated API connection for Numa** (own key, own rate-limit budget) and enable per-endpoint permissions — Read on queried entities; Create/Update only if writes are in scope.
3. Numa admin: add **Cin7 Omni** in Integrations (wizard is metadata-only; leave instance URL empty).
4. Each user: paste API Username + API Key into the chat credential card on first use.
5. Verify: `GET /v1/Users?rows=1` → 200; then a 403 walk across needed entities to surface missing toggles early.
6. Burn down Known Unknowns on the first connected account; update `01-llm-api-rules.md` with findings.

## Known unknowns — verify on a credentialed account before rollout

1. **Error body shapes in the wild** — spec says plain strings; confirm 400/401/403/429 bodies and whether 429 includes `Retry-After`.
2. **Response key casing + query-field case sensitivity** — examples say camelCase responses, lowercase query fields.
3. **Write envelope behaviour** — partial-failure semantics inside a 200 batch.
4. **Default `where` AND/OR combination grammar** — single-expression docs only.
5. **Status/type enum values** (Product.Status, order statuses) — not enumerated in the spec.
6. **`ProductImages` POST body** — undocumented; needed before exposing image upload.
7. **Sandbox/trial availability** — unconfirmed; all testing requires a live account.
8. **`fields` nested-projection syntax across entities** — documented for SalesOrders (`lineitems(code)`); verify for others.
9. **Stock `modifiedDate` reliability** as an incremental watermark.
10. **BETA spec drift** — diff the spec against the HTML docs for any entity before building on its field list.

---

_Source: `00-api-investigation-questionnaire.md`. Researched 2026-05-22 (live retrieval of docs + OAS3 spec + Swagger UI); no authenticated call was possible — docs/spec-derived only._
