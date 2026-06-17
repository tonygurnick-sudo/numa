---
api_name: Cin7 Core
api_slug: cin7-core
product: Cin7 Core (formerly DEAR Inventory) — NOT Cin7 Omni
base_url: https://inventory.dearsystems.com/externalapi/v2
path_version_segment: /externalapi/v2 is part of base_url and injected by the connector; pass FLAT relative paths (/Product, /Sale). Do NOT prepend /externalapi/v2 or any /v2/ yourself.
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url> [--body <json>] -m "caption"` (native connector). Supports request only — NOT a file store; no list-files/download-file.
auth: two custom headers api-auth-accountid + api-auth-applicationkey, BOTH injected by Numa from the user's vault. NEVER set them. No Authorization header. No OAuth/token/expiry.
field_casing: PascalCase
id_format: GUID/UUID string (e.g. 91EE7B1D-BD35-4E43-B98A-DB86BE777624); server-generated; passed in query string (?ID=/?SaleID=), never a path segment
rate_limit: 60/min per Application Key → 429. Pace ~1 req/sec.
dates: yyyy-MM-ddTHH:mm:ss.fff UTC, milliseconds, NO `Z` (e.g. 2026-06-10T00:00:00.000)
auth_failure_code: 403 (NOT 401) = bad/revoked credentials
confidence: every fact from the official Cin7 Core Apiary blueprint (dearinventory.docs.apiary.io), captured live 2026-05-22; NOT yet validated through the Numa connector path. Inline [UNVERIFIED] = inferred, confirm with a cheap GET before relying on it.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Cin7 Core — API Rules

## Two Cin7 products — this connector is Cin7 CORE only

|             | Cin7 Core (this)                                | Cin7 Omni (separate, connector `cin7-omni`) |
| ----------- | ----------------------------------------------- | ------------------------------------------- |
| Formerly    | DEAR Inventory                                  | Cin7                                        |
| Login       | `inventory.dearsystems.com`                     | `go.cin7.com` / `app.cin7.com`              |
| API base    | `inventory.dearsystems.com/externalapi/v2`      | `api.cin7.com/api`                          |
| Credentials | Account ID + Application Key (2 custom headers) | API Username + API Key (Basic auth)         |
| Entity IDs  | GUID strings                                    | integers                                    |

Customer logs in at `go.cin7.com` or describes "API username + key" → **Omni**; this connector will NOT work. Confirm product before calling.

## How to call

```
numa integrations request cin7-core GET "/Product?page=1&limit=100" -m "list products"
```

- Pass FLAT relative paths (`/Product`, `/Sale`). Connector expands against `https://inventory.dearsystems.com/externalapi/v2`. Never hardcode the host; never add `/externalapi/v2` or `/v2/`.
- POST/PUT: JSON object via `--body`. Content-Type set by backend.
- Numa injects `api-auth-accountid` + `api-auth-applicationkey` per request from the user's stored Account ID + Application Key (`credential_header_map`). NEVER set these headers; you never see the values.
- Account ID is **per company** — multi-company customers have a different Account ID per company. 60/min limit is per Application Key, not per account. Credentials from Cin7 Core → Integrations → API → New Application; no OAuth, no expiry.
- On 403/401: tell the user to reconnect via the chat credential card; do NOT retry. (Core uses **403, not 401**, for bad credentials.)

## CAN

1. Read/write Products, ProductFamily, Category; real-time stock per location via `/ProductAvailability`
2. Full sale lifecycle: `/SaleList` + `/Sale` plus stages `/SaleQuote`, `/SaleOrder`, `/SaleFulfilment` (Pick/Pack/Ship), `/SaleInvoice`, `/SaleCreditNote`, `/SalePayments`
3. Full purchase lifecycle: `/PurchaseList` + `/Purchase` plus `/PurchaseOrder`, `/PurchaseStockReceived`, `/PurchaseInvoice`, `/PurchaseCreditNote`, `/PurchasePayments`
4. Stock: `/StockAdjustment(List)`, `/StockTake`, `/StockTransfer`
5. Read/write Customers (+`/CustomerCredits`), Suppliers (+`/SupplierDeposits`)
6. Production (`/ProductionOrder`, `/FinishedGoods`, `/Disassembly`), CRM (`/Lead`, `/Opportunity`, `/Task`), Finance (`/Journal`, `/Transactions`, `/ChartOfAccounts`)
7. Reference books: `/Location`, `/Brand`, `/Carrier`, `/Tax`, `/PriceTiers`, `/PaymentTerm`, `/UnitOfMeasure`
8. Webhook CRUD via `/webhooks` — requires the customer's **Automation module add-on**
9. Account/company details: `GET /me`

## CANNOT

1. OAuth — static keys only; revoked keys replaced by the user via the credential card
2. Receive webhooks into Numa — no receiver exists; webhook CRUD manages the _customer's own_ endpoints. In-chat change detection = poll (`01d`)
3. Paginate most endpoints — only 7 support `page`/`limit` (`SaleList`, `PurchaseList`, `StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category`); everything else returns ALL records
4. DELETE most entities — confirmed only on `/webhooks`, `/Brand`, `/Carrier`; documents are voided via status workflow, not deleted
5. Update `/ChartOfAccounts` (PUT) while a Xero/QuickBooks integration is active — endpoint disabled
6. Exceed 60 req/min per Application Key
7. Rely on a documented error body shape — undocumented; parse defensively [UNVERIFIED]

## Gotchas

1. **403 = bad credentials, not permissions.** Opposite of most APIs. Reconnect via card; never retry-loop a 403.
2. **Endpoint names singular and exact** — `/Product`, `/Customer`, `/Sale` (NOT `/Products`). 404 almost always = misspelled endpoint, not a missing record.
3. **Only 7 endpoints paginate.** All others return every record in one response — expect large payloads; never assume `page`/`limit` worked elsewhere.
4. **List/detail split:** `/SaleList`, `/PurchaseList` return summary rows; fetch full document via `GET /Sale?SaleID={guid}` (single object, all stage sub-documents).
5. **Sales/purchases are state machines.** Advance via stage endpoints (`/SaleOrder`, `/SaleFulfilment`, `/SaleInvoice`…); do not flip statuses directly on parent `/Sale`. Exact stage bodies [UNVERIFIED] — see `01c`.
6. **Customer POST requires 7 fields:** `Name` (unique), `Status`, `Currency`, `PaymentTerm`, `AccountReceivable`, `RevenueAccount`, `TaxRule`. Missing any → 400.
7. **Date format = milliseconds, no `Z`:** `2026-06-10T00:00:00.000`.
8. **Webhooks need the Automation module add-on** — not on all plans. Max 5 per event type; silently auto-deactivated after 6 failed deliveries.
9. **PUT requires `ID` (GUID) in the body**, object replace — resend the full object, not just changed fields [UNVERIFIED partial-update; see `01c`].
10. **Partial success hides inside HTTP 200:** some endpoints (e.g. Disassembly) return an `Errors` array in a 200 body. Always check `Errors` after mutations.
11. **204 No Content = success, empty body** — don't JSON-parse it.
12. **Vendor guidance: queue everything.** "Never assume the API is online at any time. Always queue requests… so that you can retry." Make mutations idempotent-safe before retrying.

## Defaults (paginated endpoints, override only if user specifies)

`page=1` (1-based), `limit=100` (documented default; min 1, max 1000). Response carries `Total`; pages = `ceil(Total / limit)`.

## Operations

| Operation               | Method              | Path                                                                                              | Notes                                      |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Account/company info    | GET                 | `/me`                                                                                             | connection sanity check                    |
| List products           | GET                 | `/Product?page&limit`                                                                             | paginated, `Total`                         |
| Get product             | GET                 | `/Product?ID={guid}`                                                                              | —                                          |
| Create/update product   | POST/PUT            | `/Product`                                                                                        | PUT needs `ID`                             |
| Stock availability      | GET                 | `/ProductAvailability`                                                                            | real-time, per location                    |
| List categories         | GET                 | `/Category?page&limit`                                                                            | paginated                                  |
| List sales              | GET                 | `/SaleList?page&limit`                                                                            | summary rows                               |
| Get sale (full)         | GET                 | `/Sale?SaleID={guid}`                                                                             | all sub-documents                          |
| Create sale (draft)     | POST                | `/Sale`                                                                                           | then advance via stage endpoints           |
| Sale stages             | GET/POST/PUT        | `/SaleQuote`, `/SaleOrder`, `/SaleFulfilment`, `/SaleInvoice`, `/SalePayments`, `/SaleCreditNote` | bodies [UNVERIFIED] — `01c`                |
| List purchases          | GET                 | `/PurchaseList?page&limit`                                                                        | summary rows                               |
| Get purchase (full)     | GET                 | `/Purchase?ID={guid}`                                                                             | param name [UNVERIFIED]                    |
| Purchase stages         | GET/POST/PUT        | `/PurchaseOrder`, `/PurchaseStockReceived`, `/PurchaseInvoice`                                    | —                                          |
| Customers               | GET/POST/PUT        | `/Customer`                                                                                       | NOT paginated — returns all                |
| Suppliers               | GET/POST/PUT        | `/Supplier`                                                                                       | NOT paginated                              |
| Stock adjustments       | GET                 | `/StockAdjustmentList?page&limit` → `/StockAdjustment`                                            | —                                          |
| Stock takes / transfers | GET/POST/PUT        | `/StockTake`, `/StockTransfer` (+ `…List` paginated)                                              | —                                          |
| Production              | GET/POST/PUT        | `/ProductionOrder`, `/FinishedGoods`, `/Disassembly`                                              | —                                          |
| Reference books         | GET/POST/PUT        | `/Location`, `/Brand`, `/Carrier`, `/Tax`, `/PriceTiers`, `/PaymentTerm`, `/UnitOfMeasure`        | Brand/Carrier also DELETE                  |
| Chart of accounts       | GET/POST/PUT        | `/ChartOfAccounts`                                                                                | PUT blocked when Xero/QBO active           |
| CRM                     | GET/POST/PUT        | `/Lead`, `/Opportunity`, `/Task`                                                                  | —                                          |
| Webhooks                | GET/POST/PUT/DELETE | `/webhooks`                                                                                       | Automation module required; lowercase path |

## Pagination

Page-based: `?page={n}&limit={size}`, 1-based; default limit 100, min 1, max 1000. Supported on exactly 7 endpoints (CANNOT #3). Response carries `Total`; stop when `page > ceil(Total / limit)`. All other endpoints return every record.

## Errors

| Status  | Meaning                    | Action                                             |
| ------- | -------------------------- | -------------------------------------------------- |
| 200     | OK                         | Check body for an `Errors` array (partial success) |
| 204     | No content                 | Success, empty body — don't JSON-parse             |
| 400     | Validation / malformed     | Fix payload; do NOT retry as-is                    |
| 401/403 | Bad/revoked keys           | User reconnects via credential card; do not retry  |
| 404     | Wrong endpoint name        | Check exact singular spelling                      |
| 405     | Method not allowed         | Endpoint is read-only (e.g. the `…List` endpoints) |
| 429     | Rate limit (60/min)        | Back off and retry — `01d`                         |
| 500     | Server error / unparseable | Check request format; retry once with backoff      |

Error body JSON shape **undocumented** [UNVERIFIED] — read status code first, then defensively parse any body for a message string. Nothing here is validated through the connector path — verify with `GET /me` on first use. No sandbox confirmed: all calls hit live company data; treat every mutation as production [UNVERIFIED].

## Examples

1. Paginated product list:
   `numa integrations request cin7-core GET "/Product?page=1&limit=100" -m "list products"`
   → `{"Products":[{"ID":"guid","SKU":"WIDGET-001","Name":"Widget"}],"Total":412}` — continue `page=2`…`page=ceil(412/100)=5`.

2. Sale summary → full detail:
   `numa integrations request cin7-core GET "/SaleList?page=1&limit=100" -m "list sales"` → take a `SaleID` from summary rows, then
   `numa integrations request cin7-core GET "/Sale?SaleID=91EE7B1D-BD35-4E43-B98A-DB86BE777624" -m "get sale"` → full sale with quote/order/fulfilment/invoice/payment sub-documents.

3. Create customer (all 7 required fields):
   `numa integrations request cin7-core POST /Customer --body '{"Name":"Acme Ltd","Status":"Active","Currency":"NZD","PaymentTerm":"30 days","AccountReceivable":"200","RevenueAccount":"400","TaxRule":"GST on Sales"}' -m "create customer"`
   `PaymentTerm`, account codes, `TaxRule` must match values already configured (read `/PaymentTerm`, `/ChartOfAccounts`, `/Tax` first). Response shape [UNVERIFIED].

4. Webhook health check:
   `numa integrations request cin7-core GET /webhooks -m "check webhooks"` → check `IsActive` on each; `false` = auto-deactivated after 6 failed deliveries.
