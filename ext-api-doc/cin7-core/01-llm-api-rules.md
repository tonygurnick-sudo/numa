---
api_name: 'Cin7 Core'
api_slug: 'cin7-core'
version: 'Cin7 Core External API v2 (formerly DEAR Inventory)'
generated_from: '00-api-investigation (Cin7 dual-product investigation, 2026-05-22)'
generated_date: '2026-06-10'
update_source: 'Live API investigation 2026-05-22 — official Apiary blueprint (dearinventory.docs.apiary.io) confirmed live; NOT validated through the Numa connector path'
line_count_target: '< 300 lines'
---

# Cin7 Core -- Workspace Agent API Rules

> ⚠️ **Investigation-confirmed (live API tests 2026-05-22) but NOT yet validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the Cin7 Core integration is active.**
> It must stay under 300 lines. Companion files: `01a` (domain model), `01b` (query patterns), `01c` (mutation patterns), `01d` (events & errors).
> Facts tagged [DOCS] come from the official Cin7 Core Apiary blueprint, captured in the 2026-05-22 live investigation. [UNVERIFIED] = inferred — confirm with a cheap GET before relying on it.

## ⚠️ Two Cin7 products — this connector is Cin7 CORE only

| | **Cin7 Core (this connector)** | Cin7 Omni (separate product) |
| --- | --- | --- |
| Formerly | DEAR Inventory | Cin7 |
| Customer logs in at | `inventory.dearsystems.com` | `go.cin7.com` / `app.cin7.com` |
| API base | `inventory.dearsystems.com/externalapi/v2` | `api.cin7.com/api` |
| Credentials | Account ID + Application Key | API Username + API Key (Basic auth) |
| Entity IDs | GUID strings | integers |

If the customer logs in at `go.cin7.com` or describes "API username + key" credentials, they are on **Omni** — this connector will NOT work for them. Confirm the product before calling anything. [DOCS]

## Context

- **API:** Cin7 Core — cloud inventory/ERP for SMBs: products, full sale lifecycle (quote → order → fulfilment → invoice → payment), purchasing, stock, manufacturing/production, CRM, and finance. REST, JSON only. [DOCS]
- **Base URL:** fixed cloud host. Relative URLs expand against `https://inventory.dearsystems.com/externalapi/v2`.
- **Auth:** two custom headers (`api-auth-accountid` + `api-auth-applicationkey`) — **both injected automatically by Numa. Never set them.**
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation.
- **Rate limit:** 60 requests/minute per application key → 429 on exceed. Pace at ~1 req/sec. [DOCS]
- **IDs:** GUID/UUID strings (e.g. `91EE7B1D-BD35-4E43-B98A-DB86BE777624`). [DOCS]
- **Dates:** ISO 8601 UTC, `yyyy-MM-ddTHH:mm:ss.fff` — e.g. `2012-11-14T13:28:33.363` (no `Z` suffix). [DOCS]

## How to Call

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Product?page=1&limit=100",
  "method": "GET"
})
```

- Relative `url` expands against `https://inventory.dearsystems.com/externalapi/v2`. Never hardcode the host.
- POST/PUT: pass the JSON object in `body`. Content-Type is handled by the backend.
- **NEVER set `api-auth-accountid` or `api-auth-applicationkey` headers.** Numa injects both on every request from the user's stored Account ID + Application Key (credential header map); you never see the values.

## Auth Structure

Static credentials, injected per request by Numa — show requests WITHOUT auth headers.

- Credentials are created in Cin7 Core → **Integrations → API → New Application**. No OAuth, no token expiry. [DOCS]
- The Account ID is **per company** — multi-company customers have a different Account ID per company. [DOCS]
- The 60/min rate limit is **per application key**, not per account. [DOCS]
- **403 = authentication failure in Cin7 Core** (wrong/revoked Account ID or Application Key) — unlike most APIs, Core uses 403, not 401, for bad credentials. [DOCS] On 403 (or 401), tell the user to reconnect Cin7 Core via the chat credential card; do not retry.

## Capabilities

### CAN

1. Read/write Products, ProductFamily, Category; read real-time stock per location via `/ProductAvailability` [DOCS]
2. Drive the full sale lifecycle: `/SaleList` + `/Sale` plus stage endpoints (`/SaleQuote`, `/SaleOrder`, `/SaleFulfilment` Pick/Pack/Ship, `/SaleInvoice`, `/SaleCreditNote`, `/SalePayments`) [DOCS]
3. Drive the full purchase lifecycle: `/PurchaseList` + `/Purchase` plus `/PurchaseOrder`, `/PurchaseStockReceived`, `/PurchaseInvoice`, `/PurchaseCreditNote`, `/PurchasePayments` [DOCS]
4. Stock operations: `/StockAdjustment(List)`, `/StockTake`, `/StockTransfer` [DOCS]
5. Read/write Customers (+`/CustomerCredits`) and Suppliers (+`/SupplierDeposits`) [DOCS]
6. Production (`/ProductionOrder`, `/FinishedGoods`, `/Disassembly`), CRM (`/Lead`, `/Opportunity`, `/Task`), Finance (`/Journal`, `/Transactions`, `/ChartOfAccounts`) [DOCS]
7. Reference books: `/Location`, `/Brand`, `/Carrier`, `/Tax`, `/PriceTiers`, `/PaymentTerm`, `/UnitOfMeasure` [DOCS]
8. Manage webhook subscriptions via `/webhooks` (GET/POST/PUT/DELETE) — requires the customer's **Automation module add-on** [DOCS]
9. Read account/company details: `GET /me` [DOCS]

### CANNOT

1. Use OAuth — static keys only; revoked keys must be replaced by the user via the credential card [DOCS]
2. Receive webhooks into Numa — no Numa receiver exists; webhook CRUD manages the *customer's own* endpoints. For in-chat change detection, poll (see `01d`)
3. Paginate most endpoints — only 7 support `page`/`limit` (`SaleList`, `PurchaseList`, `StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category`); everything else returns ALL records [DOCS]
4. DELETE most entities — DELETE is confirmed only on `/webhooks`, `/Brand`, `/Carrier`; documents are voided via their status workflow, not deleted [DOCS]
5. Update Chart of Accounts while a Xero/QuickBooks integration is active — the PUT endpoint is disabled [DOCS]
6. Exceed 60 requests/minute per application key [DOCS]
7. Rely on a documented error response body shape — undocumented; parse defensively [UNVERIFIED]

## Critical Gotchas

1. **403 = bad credentials, not permissions.** Opposite of most APIs. Reconnect via the chat credential card; never retry-loop a 403. [DOCS]
2. **Endpoint names are singular and exact** — `/Product`, `/Customer`, `/Sale` (NOT `/Products`). 404 almost always means a misspelled endpoint name, not a missing record. [DOCS]
3. **Only 7 endpoints paginate.** All others (Customers, Suppliers, Locations…) return every record in one response — expect large payloads on big datasets; never assume `page`/`limit` worked elsewhere. [DOCS]
4. **List/detail split:** `/SaleList` and `/PurchaseList` return summary rows; fetch the full document with `GET /Sale?SaleID={guid}` (single object with all stage sub-documents). [DOCS]
5. **Sales/purchases are state machines.** Advance stages through the stage endpoints (`/SaleOrder`, `/SaleFulfilment`, `/SaleInvoice`…) — do not try to flip statuses directly on the parent `/Sale`. Exact stage bodies are [UNVERIFIED] — see `01c`.
6. **Customer POST requires 7 fields:** `Name` (must be unique), `Status`, `Currency`, `PaymentTerm`, `AccountReceivable`, `RevenueAccount`, `TaxRule`. Missing any → 400. [DOCS]
7. **Date format has milliseconds and no `Z`:** `2026-06-10T00:00:00.000`. [DOCS]
8. **Webhooks need the Automation module add-on** — not on all plans. Max 5 webhooks per event type; auto-deactivated (silently) after 6 failed deliveries. [DOCS]
9. **PUT requires the `ID` (GUID) in the body** and is an object replace — resend the full object, not just changed fields [UNVERIFIED partial-update behavior; see `01c`].
10. **Partial success hides inside HTTP 200:** some endpoints (e.g. Disassembly) return an `Errors` array in a 200 body. Always check for `Errors` after mutations. [DOCS]
11. **204 No Content = success with empty body** — don't JSON-parse it. [DOCS]
12. **Vendor guidance: queue everything.** "Never assume the API is online at any time. Always queue requests… so that you can retry." Make mutations idempotent-safe before retrying. [DOCS]

## Default Parameters

On the 7 paginated endpoints, unless the user specifies otherwise:

| Parameter | Default | Reason |
| --------- | ------- | ------ |
| page | 1 | 1-based page number |
| limit | 100 | Documented default; min 1, max 1000 [DOCS] |

Responses include a `Total` field — pages needed = `ceil(Total / limit)`. [DOCS]

## Working Examples

> Request shapes are from the official Apiary blueprint [DOCS]; not yet replayed through the Numa connector.

### Example 1: Paginated product list

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Product?page=1&limit=100",
  "method": "GET"
})
```

```json
{ "Products": [ { "ID": "guid", "SKU": "WIDGET-001", "Name": "Widget" } ], "Total": 412 }
```

Continue with `page=2` … `page=ceil(412/100)=5`.

### Example 2: Sale summary list → full sale detail

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/SaleList?page=1&limit=100",
  "method": "GET"
})
```

Take a `SaleID` from the summary rows, then:

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Sale?SaleID=91EE7B1D-BD35-4E43-B98A-DB86BE777624",
  "method": "GET"
})
```

Returns the full sale object including quote/order/fulfilment/invoice/payment sub-documents. [DOCS]

### Example 3: Create a customer (all required fields)

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/Customer",
  "method": "POST",
  "body": {
    "Name": "Acme Ltd",
    "Status": "Active",
    "Currency": "NZD",
    "PaymentTerm": "30 days",
    "AccountReceivable": "200",
    "RevenueAccount": "400",
    "TaxRule": "GST on Sales"
  }
})
```

`PaymentTerm`, account codes, and `TaxRule` must match values already configured in the customer's Cin7 Core instance — read the reference books first (`/PaymentTerm`, `/ChartOfAccounts`, `/Tax`). Response body shape [UNVERIFIED].

### Example 4: List webhook subscriptions (health check)

```
connectors(name="request", params={
  "connector": "cin7-core",
  "url": "/webhooks",
  "method": "GET"
})
```

Check `IsActive` on each — `false` means it was auto-deactivated after 6 failed deliveries. [DOCS]

## Proxy API Operations

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Account/company info | GET | `/me` | Sanity check the connection [DOCS] |
| List products | GET | `/Product?page&limit` | Paginated, `Total` [DOCS] |
| Get single product | GET | `/Product?ID={guid}` | [DOCS] |
| Create/update product | POST/PUT | `/Product` | PUT needs `ID` |
| Stock availability | GET | `/ProductAvailability` | Real-time, per location [DOCS] |
| List categories | GET | `/Category?page&limit` | Paginated [DOCS] |
| List sales | GET | `/SaleList?page&limit` | Summary rows [DOCS] |
| Get sale (full) | GET | `/Sale?SaleID={guid}` | All sub-documents [DOCS] |
| Create sale (draft) | POST | `/Sale` | Then advance via stage endpoints |
| Sale stages | GET/POST/PUT | `/SaleQuote`, `/SaleOrder`, `/SaleFulfilment`, `/SaleInvoice`, `/SalePayments`, `/SaleCreditNote` | Bodies [UNVERIFIED] — see `01c` |
| List purchases | GET | `/PurchaseList?page&limit` | Summary rows [DOCS] |
| Get purchase (full) | GET | `/Purchase?ID={guid}` | Param name [UNVERIFIED] |
| Purchase stages | GET/POST/PUT | `/PurchaseOrder`, `/PurchaseStockReceived`, `/PurchaseInvoice` | [DOCS] |
| Customers | GET/POST/PUT | `/Customer` | NOT paginated — returns all [DOCS] |
| Suppliers | GET/POST/PUT | `/Supplier` | NOT paginated [DOCS] |
| Stock adjustments | GET | `/StockAdjustmentList?page&limit` → `/StockAdjustment` | [DOCS] |
| Stock takes / transfers | GET/POST/PUT | `/StockTake`, `/StockTransfer` (+ `…List` paginated) | [DOCS] |
| Production | GET/POST/PUT | `/ProductionOrder`, `/FinishedGoods`, `/Disassembly` | [DOCS] |
| Reference books | GET/POST/PUT | `/Location`, `/Brand`, `/Carrier`, `/Tax`, `/PriceTiers`, `/PaymentTerm`, `/UnitOfMeasure` | Brand/Carrier also DELETE [DOCS] |
| Chart of accounts | GET/POST/PUT | `/ChartOfAccounts` | PUT blocked when Xero/QBO active [DOCS] |
| CRM | GET/POST/PUT | `/Lead`, `/Opportunity`, `/Task` | [DOCS] |
| Webhooks | GET/POST/PUT/DELETE | `/webhooks` | Automation module required [DOCS] |

## Pagination [DOCS]

- **Type:** page-based — `?page={n}&limit={size}`, 1-based; default limit 100, min 1, max 1000.
- **Supported on exactly 7 endpoints:** `SaleList`, `PurchaseList`, `StockAdjustmentList`, `StockTakeList`, `StockTransferList`, `Product`, `Category`. All other endpoints return every record.
- **Total count:** response carries `Total`; stop when `page > ceil(Total / limit)`.

## Error Handling

| Status | Meaning | Action |
| ------ | ------- | ------ |
| 200 | OK | Check body for an `Errors` array (partial success) [DOCS] |
| 204 | No content | Success, empty body [DOCS] |
| 400 | Validation / malformed request | Fix payload; do NOT retry as-is [DOCS] |
| 401/403 | Bad or revoked keys | User reconnects Cin7 Core via the chat credential card; do not retry [DOCS] |
| 404 | Wrong endpoint name | Check exact singular endpoint spelling [DOCS] |
| 405 | Method not allowed | Endpoint is read-only (e.g. the `…List` endpoints) [DOCS] |
| 429 | Rate limit (60/min) | Back off and retry — see `01d` [DOCS] |
| 500 | Server error / unparseable object | Check request format; retry once with backoff [DOCS] |

Error body JSON shape is **undocumented** — read the status code first, then defensively parse any body for a message string. [UNVERIFIED]

## Known Limitations

1. **Nothing here is validated through the Numa connector path** — investigation hit the live docs/spec endpoints, not the API with customer credentials. Verify with `GET /me` on first use.
2. Error response body format unknown for all endpoints [UNVERIFIED]
3. Sale/purchase stage-transition request bodies are inferred from the Apiary structure [UNVERIFIED] — see `01c`
4. No Numa webhook receiver — event-driven flows require the customer's own endpoint; in-chat pattern is polling
5. Non-paginated endpoints can return very large payloads — summarize, don't dump
6. No sandbox environment confirmed — all calls hit the customer's live company data; treat every mutation as production [UNVERIFIED]

---

_Generated 2026-06-10 from the 2026-05-22 Cin7 API investigation (official Apiary blueprint). NOT yet validated through the Numa connector. Companions:_

- _01a-domain-model-reference.md — entity catalog, relationships, lifecycles_
- _01b-query-patterns.md — reads, pagination, polling_
- _01c-mutation-patterns.md — creates, updates, stage transitions_
- _01d-event-and-error-handling.md — webhooks, errors, retries_
