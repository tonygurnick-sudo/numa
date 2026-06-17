---
api_name: Cin7 Core API
api_slug: cin7-core
base_url: https://inventory.dearsystems.com/externalapi/v2
path_version_segment: /externalapi/v2 is part of base_url (a fixed host path), injected by the connector. NOT a per-request /v2/ prefix the agent adds — pass FLAT relative paths (/Product, /Sale). "v2" is the only API generation; there is no v1.
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url>` (native data connector, authType api-key + credentialHeaderMap). Not a file source — list_files/download_file do not apply.
spec_format: API Blueprint (Apiary) — no OpenAPI spec exists
spec_url: https://dearinventory.docs.apiary.io/ (official, still under the DEAR name)
date_researched: 2026-05-22
confidence: endpoint inventory + webhook model are exact [DOCUMENTED, from the live blueprint]. Auth behaviour, error bodies, and stage-transition bodies inferred — see §Known Unknowns. NO authenticated call was possible (no credentials); docs-derived only. Inline [UNVERIFIED]/[UNKNOWN] = not confirmed.
---

# Cin7 Core — API Specification & Investigation

Developer reference for the Cin7 Core (formerly DEAR Inventory) REST API — condensed from `00-api-investigation-questionnaire.md`. Compiled from the **official API Blueprint** on Apiary (`https://dearinventory.docs.apiary.io/`, ~356KB, retrieved live 2026-05-22).

⚠️ **TWO PRODUCTS.** Covers **Cin7 Core** (`inventory.dearsystems.com`, custom-header auth, GUID IDs) ONLY. **Cin7 Omni** (`api.cin7.com`, HTTP Basic auth, integer IDs) is a different API with its own connector (`cin7-omni`). Confirm the product before calling anything.

## Overview

- **Product:** Cin7 Core — cloud inventory/ERP for SMBs with a manufacturing/production lean (formerly DEAR Inventory)
- **API style:** REST, JSON only
- **Base URL:** `https://inventory.dearsystems.com/externalapi/v2` — single shared SaaS host, no per-customer instance
- **Versions:** v2 only; `/externalapi/v2` is the fixed host path (part of base_url), not a per-call version prefix. No v1 exists.
- **Spec:** none — official docs are an **API Blueprint** on Apiary, not OpenAPI
- **Auth:** two custom headers — `api-auth-accountid` + `api-auth-applicationkey` on every request; **no Authorization header at all**
- **Rate limit:** **60/min per Application Key**
- **Dates:** ISO 8601 UTC, `yyyy-MM-ddTHH:mm:ss.fff` — milliseconds, **no `Z`**. **IDs:** GUID strings
- **Scale:** ~40 entity endpoints across 11 groups (Product, Sale, Purchase, Stock, Customer, Supplier, Production, Reference, CRM, Finance, Webhooks)
- **Webhooks:** YES — 31 event types via `/webhooks` CRUD; requires the **Automation module add-on**; the big capability difference from Omni

**Summary:** A document-lifecycle ERP API — sales and purchases are state machines spanning stage sub-documents (quote → order → fulfilment → invoice → payment), each with its own endpoint. List/detail split (`/SaleList` summary → `/Sale` full object). Pagination on exactly 7 endpoints (with a `Total` count); everything else returns all records. Single-object writes only — no batching.

**Numa integration model:** Native data connector (`authType: api-key` with a `credentialHeaderMap`, NOT Pipedream). The workspace agent calls `numa integrations request cin7-core GET "/Product?page=1&limit=100"`. The backend expands relative URLs against the stored `base_url` and injects **both** custom auth headers from the user's personal vault (`connector-cin7-core` — `account_id` + `application_key`). Agent never sees the credentials. See `03-connector-setup.md`.

## Authentication

**Method:** custom HTTP request headers — checked on **every request**; no sessions, no tokens, no expiry.

```
api-auth-accountid:      <account-id>
api-auth-applicationkey: <application-key>
```

**Credential setup (Cin7 Core user/admin):** 1) Log into Cin7 Core (`inventory.dearsystems.com`); 2) **Integrations → API**; 3) **New Application** → copy the **Account ID** and the generated **Application Key**.

**Auth-failure semantics — the defining Core quirk:**
| Status | Meaning |
| --- | --- |
| 403 | **Authentication failure** — wrong or revoked Account ID / Application Key. Exact opposite of Cin7 Omni, where 403 means a missing permission toggle. Reconnect via the chat credential card. |
| 404 | NOT auth — almost always a misspelled endpoint name (`/Products` vs `/Product`) |

**No per-endpoint permission model**: a valid key pair grants the application's full API access. (Treat an unexpected 401 the same as 403 — re-enter credentials.)

**Key lifecycle:**

- No expiry — static credentials.
- Deleting/regenerating the Application in Cin7 Core invalidates the old key immediately.
- **Account ID is per company** — multi-company customers need the right company's ID; the same Application Key cannot span companies.
- Rate limits are **per Application Key** — a dedicated Application for Numa isolates its 60/min budget from the customer's other integrations.

## Endpoint inventory [DOCUMENTED — Apiary blueprint, live 2026-05-22]

### Conventions

```
GET    /{Endpoint}?page&limit   paginated list (7 endpoints ONLY) — response carries Total
GET    /{Endpoint}?ID={guid}    single record by GUID (query param, NOT a path segment)
POST   /{Endpoint}              create — body is ONE object
PUT    /{Endpoint}              update — body is ONE object incl. ID (GUID)
DELETE /{Endpoint}              webhooks, Brand, Carrier only
```

Endpoint names are **singular and exact** — `/Product`, `/Customer`, `/Sale`.

### Full catalogue

| Endpoint                         | Methods                    | Paginated | Notes                                                 |
| -------------------------------- | -------------------------- | --------- | ----------------------------------------------------- |
| `/me`                            | GET                        | —         | Current company/account details — connection probe    |
| `/Product`                       | GET, POST, PUT             | **Yes**   | Default 100, max 1000/page                            |
| `/ProductFamily`                 | GET, POST, PUT             | No        | Product groups; + attachments                         |
| `/Category`                      | GET, POST, PUT             | **Yes**   |                                                       |
| `/ProductAvailability`           | GET                        | No        | Real-time stock per product per location              |
| `/SaleList`                      | GET                        | **Yes**   | Summary rows; use `SaleID` for full detail            |
| `/Sale`                          | GET, POST, PUT             | No        | Full sale object incl. all stage sub-documents        |
| `/SaleQuote`                     | GET, POST, PUT             | No        | Quote stage                                           |
| `/SaleOrder`                     | GET, POST, PUT             | No        | Order stage                                           |
| `/SaleFulfilment`                | GET, POST, PUT             | No        | Fulfilment stage (+ Pick / Pack / Ship sub-endpoints) |
| `/SaleInvoice`                   | GET, POST, PUT             | No        | Invoice stage                                         |
| `/SalePayments`                  | GET, POST, PUT             | No        | Payments against a sale                               |
| `/SaleCreditNote`                | GET, POST, PUT             | No        | Credit notes                                          |
| `/PurchaseList`                  | GET                        | **Yes**   | Summary rows                                          |
| `/Purchase`                      | GET, POST, PUT             | No        | Full purchase object                                  |
| `/PurchaseOrder`                 | GET, POST, PUT             | No        | PO stage                                              |
| `/PurchaseStockReceived`         | GET, POST, PUT             | No        | Goods receipt                                         |
| `/PurchaseInvoice`               | GET, POST, PUT             | No        | Supplier invoice                                      |
| `/PurchaseCreditNote`            | GET, POST, PUT             | No        | Purchase credit notes                                 |
| `/PurchasePayments`              | GET, POST, PUT             | No        | Payments against a purchase                           |
| `/Customer`                      | GET, POST, PUT             | No        | **Returns ALL records**; 7 required fields on POST    |
| `/CustomerCredits`               | GET                        | No        | Credit balances                                       |
| `/Supplier`                      | GET, POST, PUT             | No        | Returns ALL records                                   |
| `/SupplierDeposits`              | GET, POST, PUT             | No        |                                                       |
| `/StockAdjustmentList`           | GET                        | **Yes**   | → `/StockAdjustment` for detail/writes                |
| `/StockAdjustment`               | GET, POST, PUT             | No        |                                                       |
| `/StockTakeList`                 | GET                        | **Yes**   |                                                       |
| `/StockTake`                     | GET, POST, PUT             | No        |                                                       |
| `/StockTransferList`             | GET                        | **Yes**   |                                                       |
| `/StockTransfer`                 | GET, POST, PUT             | No        |                                                       |
| `/ProductionOrder`               | GET, POST, PUT             | No        | Manufacturing                                         |
| `/FinishedGoods`                 | GET, POST, PUT             | No        |                                                       |
| `/Disassembly`                   | GET, POST, PUT             | No        | Documents the `Errors`-in-200 partial-success pattern |
| `/Location`                      | GET, POST, PUT             | No        | Warehouses                                            |
| `/Brand`                         | GET, POST, PUT, **DELETE** | No        |                                                       |
| `/Carrier`                       | GET, POST, PUT, **DELETE** | No        |                                                       |
| `/Tax`                           | GET, POST, PUT             | No        | Tax rules                                             |
| `/PriceTiers`                    | GET                        | No        |                                                       |
| `/PaymentTerm`                   | GET, POST, PUT             | No        |                                                       |
| `/UnitOfMeasure`                 | GET, POST, PUT             | No        |                                                       |
| `/ChartOfAccounts`               | GET, POST, PUT             | No        | **PUT blocked while Xero/QBO integration is active**  |
| `/Journal`                       | GET, POST, PUT             | No        |                                                       |
| `/Transactions`                  | GET                        | No        |                                                       |
| `/Lead`, `/Opportunity`, `/Task` | GET, POST, PUT             | No        | CRM                                                   |
| `/webhooks`                      | GET, POST, PUT, **DELETE** | No        | Requires the Automation module add-on; lowercase path |

**No batch writes anywhere** — POST/PUT take ONE object per request.

## Query model

No generic filter grammar (no `where`/`order`/`fields` — that's Omni). Each endpoint documents its own query params:
| Pattern | Example | Status |
| --- | --- | --- |
| GUID lookup | `/Sale?SaleID={guid}`, `/Product?ID={guid}` | [DOCUMENTED] |
| Pagination | `/Product?page=2&limit=200` | [DOCUMENTED] |
| List date filters | `/SaleList?...&CreatedSince=2026-05-01T00:00:00.000` | [UNVERIFIED — param names per endpoint need a live check] |

Worked examples (flat relative paths; connector prepends the host + `/externalapi/v2`):

```
GET /me
GET /Product?page=1&limit=100
GET /Product?ID=91EE7B1D-BD35-4E43-B98A-DB86BE777624
GET /SaleList?page=1&limit=100
GET /Sale?SaleID=91EE7B1D-BD35-4E43-B98A-DB86BE777624
GET /ProductAvailability
GET /PaymentTerm
```

## Pagination

- **Type:** page-number — `page` (1-based) + `limit` (default **100**, min 1, max **1000**)
- **Total count: YES** — paginated responses carry `Total`; pages = `ceil(Total / limit)` (the big difference from Cin7 Omni, which has no total)
- ⚠️ **Supported on exactly SEVEN endpoints:** `SaleList`, `PurchaseList`, `StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category`. **All other endpoints return every record in one response.**

```
Page 1: GET /Product?page=1&limit=200 → 200 rows, "Total":412
Page 3: GET /Product?page=3&limit=200 → 12 rows → stop (ceil(412/200)=3)
{"Products":[{"ID":"guid","SKU":"WIDGET-001","Name":"Widget"}],"Total":412}
```

Budget: every page is one request against the 60/min key budget — pace ~1 req/sec.

## Write semantics

**Request shape:** POST/PUT bodies are **single JSON objects** — no arrays, no batching (unlike Omni's 250-record arrays). PUT requires the `ID` (GUID) in the body, treated as an object replace — resend the full object [UNVERIFIED partial-update behaviour].

**Customer POST — all seven required fields:**
`{"Name":"Acme Ltd","Status":"Active","Currency":"NZD","PaymentTerm":"30 days","AccountReceivable":"200","RevenueAccount":"400","TaxRule":"GST on Sales"}`
`Name` must be unique; `PaymentTerm`, account codes, `TaxRule` must match values already configured in the company — read the reference books (`/PaymentTerm`, `/ChartOfAccounts`, `/Tax`) first.

**Lifecycle writes:** advance sales/purchases through the **stage endpoints** (`/SaleOrder`, `/SaleFulfilment`, `/SaleInvoice`…) — never flip statuses directly on the parent `/Sale`. Exact stage-transition bodies [UNVERIFIED].

**Partial success inside 200:** some endpoints (e.g. Disassembly) return an `Errors` array in a 200 body — always check after mutations. **204 No Content** = success, empty body; don't JSON-parse it.

**Blocked writes:** `/ChartOfAccounts` PUT disabled while a Xero/QuickBooks integration is active.

## Data models [DOCUMENTED extracts]

All keys PascalCase; all IDs GUID strings; all dates `yyyy-MM-ddTHH:mm:ss.fff` UTC (no `Z`).

**Customer (selected):** `ID` (GUID, required for PUT), **`Name`** (string 256, unique, required), `DisplayName`, **`Status`** (`Active`/`Deprecated`, required), **`Currency`** (ISO 4217, required), **`PaymentTerm`** (required), **`AccountReceivable`** / **`RevenueAccount`** (account codes, required), **`TaxRule`** (required), `PriceTier`, `Carrier`, `Discount` (int 0–100), `CreditLimit`, `Comments` (2000), `TaxNumber`, `Tags` (comma-delimited), `AttributeSet`, `AdditionalAttribute1–10`, `IsOnCreditHold`, `IsLegalEntity`, `CustomerParentID` (GUID), `IsBillParent`, `ProductPrices[]`, `Addresses[]`, `Contacts[]`, `ChildCustomers[]` (read-only), `LastModifiedOn` (read-only).

**Chart of Accounts (selected):** **`Code`** (string 50, unique, required), **`Name`** (string 256, required), **`Type`** (`BANK`, `CURRLIAB`, `LIABILITY`, `TERMLIA`…, required), **`Status`** (required), `Class` (`ASSET`/`LIABILITY`/`EXPENSE`/`EQUITY`/`REVENUE`), `Bank` + `BankAccountNumber` (required when `Type=BANK`), `Currency` (read-only).

**Webhook subscription:** `ID` (GUID — required for PUT), `Type` (event type string), `IsActive` (bool), `ExternalURL`, `ExternalAuthorizationType` (`noauth`/`basicauth`/`bearerauth`), `ExternalUserName`/`ExternalPassword` (basicauth), `ExternalBearerToken` (bearerauth), `ExternalHeaders[]` (key/value objects).

**Webhook payload (thin notification):** `{"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","SaleOrderNumber":"SO-00044","EventType":"Sale/OrderAuthorised"}` — some events carry more (`Sale/Created` adds customer/contact fields and `SaleOrderDate`; `Sale/ShipmentAuthorised` uses `SaleTaskID` + `TenantID`). Always fetch the full entity by ID.

## Rate limits

| Scope               | Limit  | Window | Response |
| ------------------- | ------ | ------ | -------- |
| Per Application Key | **60** | minute | 429      |

No per-second or per-day limit documented. No rate-limit headers documented; `Retry-After` presence [UNKNOWN]. Multiple Applications = independent 60/min buckets — give Numa its own Application. Backoff: ~1 req/sec baseline; on 429 back off 1s → 5s → 30s → 2m, then defer to the next minute window.

## Error handling

| Status | Meaning                                             | Retryable? | Recovery                                            |
| ------ | --------------------------------------------------- | ---------- | --------------------------------------------------- |
| 200    | OK — but check the body for an `Errors` array       | —          | Surface partial failures                            |
| 204    | No Content — success, empty body                    | —          | Don't JSON-parse                                    |
| 400    | Validation failure / malformed request              | No         | Fix payload (e.g. missing Customer required fields) |
| 403    | **Authentication failure** (wrong/revoked key pair) | No         | Re-enter credentials via the chat card              |
| 404    | Wrong endpoint name (`/Products` vs `/Product`)     | No         | Check exact singular endpoint spelling              |
| 405    | Method not allowed (write to a read-only `…List`)   | No         | Check the endpoint's CRUD support                   |
| 429    | Rate limited (60/min per key)                       | Yes        | Backoff; pace ~1 req/sec                            |
| 500    | Server error / object could not be parsed           | Cautiously | Check request format; retry once; then surface      |

**Bodies:** [UNKNOWN] — the blueprint says the API returns "an appropriate HTML status code, and an error message", but the JSON shape is undocumented. Parse defensively: status first, try JSON, fall back to raw text.

**Idempotency:** no idempotency keys. GET idempotent; PUT re-sends safe (ID-addressed); **POST retries duplicate records** (except `/Customer`, where the unique-`Name` rule 400s). Vendor guidance: queue all requests and retry on network failure — pair with query-before-retry on mutations.

## Events / webhooks

Full outbound webhook support — **31 event types**; requires the customer's **Automation module add-on** (not on all plans).

- **CRUD:** `/webhooks` (GET, POST, PUT, DELETE)
- **Limit:** max **5 webhooks of the same type** at once
- **Retry:** 6 attempts (1m after the event, then +5m, +10m, +15m, +20m, +25m); after 6 failures the webhook is **silently auto-deactivated** — monitor `IsActive` and reactivate via PUT
- **Payloads are thin** — IDs + `EventType`; fetch the full entity afterwards
- **Event families:** Sale (16 events incl. `Sale/Created`, `Sale/OrderAuthorised`, `Sale/InvoiceAuthorised`, `Sale/FullPaymentReceived`), Purchase (5), `Customer/Updated`, `Supplier/Updated`, `Product/Updated`, `Stock/AvailableStockLevelChanged`, CRM (6), `Task/Overdue` — full string catalog in `01d`

**Numa applicability:** Numa has **no webhook receiver** for this connector — webhook CRUD via the agent manages the _customer's own_ endpoints. For in-chat change detection, poll the paginated lists; the 60/min budget makes ~1-minute polling cadences trivially affordable.

## Integration path assessment

**Recommended path:** Direct API via Numa native data connector (`request` operation), registry `authType: api-key` **with `credentialHeaderMap`** — NOT Pipedream, NOT OAuth. Implemented; see `03-connector-setup.md` for wiring, `04-connection-and-reauth.md` for lifecycle.

**Justification:** Core's two-custom-header auth fits neither Bearer-token nor Basic-auth backends. The registry's `credentialHeaderMap` (`{"api-auth-accountid":"account_id","api-auth-applicationkey":"application_key"}`) tells the backend which user-vault field rides in which header; `_user_connector_header_creds` builds **both** headers per request, all-or-nothing. The admin contributes metadata only — both halves of the credential pair are per-user.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not apply).

**Rollout checklist (per customer):**

1. Confirm the customer is on **Core** (login at `inventory.dearsystems.com`), not Omni
2. Cin7 Core side: create a **dedicated API Application for Numa** (Integrations → API → New Application) — isolates its 60/min budget; note the right company's Account ID in multi-company setups
3. Numa admin: add **Cin7 Core** in Integrations (wizard is metadata-only; leave instance URL empty)
4. Each user: paste Account ID + Application Key into the chat credential card on first use
5. Verify: `GET /me` → 200; then `GET /Product?page=1&limit=1` to confirm business-data access
6. If event-driven flows are wanted (customer's own endpoints): confirm the **Automation module add-on** is on their plan
7. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md` with findings

## Known unknowns — verify on a credentialed account before customer rollout

1. **Error body shapes in the wild** — undocumented; confirm 400/403/429 bodies and whether 429 includes `Retry-After`
2. **Sale/purchase stage-transition request bodies** — inferred from the blueprint's sub-endpoint structure only
3. **List filter parameter names** (e.g. `CreatedSince`/`CreatedUntil` on `/SaleList`) — pattern inferred; confirm per endpoint
4. **PUT partial-update behaviour** — object-replace assumed; confirm whether omitted fields are cleared or kept
5. **Endpoint-name case sensitivity** — docs show both `externalapi` and `ExternalApi` casing
6. **Whether unsupported `page`/`limit` params are ignored or rejected** on non-paginated endpoints
7. **Attachment/file upload mechanics** (`/ProductAttachments`, sale attachments)
8. **Sandbox/trial availability** — unconfirmed; all testing currently requires a live account, so treat every mutation as production
9. **`/me` response shape** — fields unverified; needed for the connection-probe UX
10. **429 behaviour at the minute boundary** — sliding vs fixed window unknown
