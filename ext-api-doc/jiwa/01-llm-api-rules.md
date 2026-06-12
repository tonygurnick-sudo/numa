---
api_name: 'Jiwa Financials'
api_slug: 'jiwa'
version: 'Jiwa 8 REST API (Swagger 2.0, 816 paths / 1,381 operations)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'OpenAPI spec (api.jiwa.com.au/openapi) + Jiwa official wiki — NO live testing'
line_count_target: '< 300 lines'
---

# Jiwa Financials -- Workspace Agent API Rules

> ⚠️ **Spec-derived — NOT yet live-validated. Expect per-customer differences (Jiwa 7 vs 8 routes, enabled plugins, User Group route permissions).**
>
> **This file is loaded into the workspace agent's context when the Jiwa integration is active.**
> It must stay under 300 lines. Companion file `01a-domain-model-reference.md` has the entity catalog.
> Facts are tagged [SPEC] (OpenAPI spec), [DOCS] (Jiwa wiki), [UNVERIFIED] (inferred). Treat all as unconfirmed until tested on a real instance.

## Context

- **API:** Jiwa Financials REST API — Australian ERP (inventory/distribution, AR/AP, GL). Built on ServiceStack; DTO-in/DTO-out [DOCS]
- **Base URL:** customer's own self-hosted instance — **no fixed cloud host**. Relative URLs expand against the admin-configured Instance URL
- **Auth:** Staff API key as `Authorization: Bearer {key}` — **injected automatically by Numa. Never set it.**
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **Rate limits:** NONE by default; optional per-IP "REST API Rate Limit" plugin if the customer enabled it [DOCS]
- **Field casing:** PascalCase throughout (`DebtorID`, `AccountNo`, `QuantityOrdered`) [SPEC]
- **ID format:** "RecID" strings, typically 20 chars (e.g. `0000000061000000001V`, `5244dd5e199749f4b6fe`) [DOCS]

## How to Call

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V",
  "method": "GET"
})
```

- Relative `url` expands against the customer's instance URL (admin-configured). Never hardcode a host.
- POST/PATCH: pass the JSON DTO in `body`. JSON content negotiation (Accept/Content-Type) is handled by the backend.
- **NEVER set `Authorization` headers.** Numa injects the user's vaulted Staff API key on every request; you never see it.
- Verbs [DOCS]: GET = read, POST = create, **PATCH = update (not PUT)**, DELETE = delete.

## Auth Structure

Bearer Staff API key per request, injected by Numa — show requests WITHOUT auth headers.

- Keys belong to a Jiwa **staff member**; the request runs with exactly that staff member's permissions [DOCS].
- **Route access is per User Group** ("Default REST API Permission" + per-route grants in User Group Maintenance). Disallow wins; Undefined = deny unless allowed elsewhere [DOCS].
- **403** = authenticated but the route isn't permitted for the user's User Group — a Jiwa-side setting. Tell the user to ask their Jiwa administrator; do not retry.
- **401** = key invalid, expired, or revoked (empty body observed on the hosted instance). The user should reconnect Jiwa via the chat credential card.

## Capabilities

### CAN

1. Read-query nearly everything via `/Queries/*` AutoQuery routes (152 ops over DB views/tables: DebtorList, SalesOrderList, InventoryItemList, IN_SOH stock-on-hand, DB_Main, CR_Main, PO_Main, GL_Ledger, DebtorTransactionList, BackOrderList…) [SPEC]
2. Full business-object CRUD: Debtors, Inventory items, Sales Orders (+lines/payments/notes), Sales Quotes, Purchase Orders, Creditors, GRNs, Purchase Invoices, Shipments, Work Orders, Bills, Journal Sets, Warehouse Transfers, To Dos, Carriers [SPEC]
3. Lifecycle actions: process a sales order (post journals/debtor transactions), convert quote→order (`/MakeOrder`), activate POs/GRNs/purchase invoices/shipments/transfers [SPEC]
4. Upsert child collections (Lines, Notes, CustomFieldValues, Payments) inside a single PATCH of the parent [DOCS]
5. Read/write custom field values on most entities (`/CustomFieldValues` sub-routes) [DOCS]
6. List every route the instance exposes: `GET /RestPaths` [DOCS]

### CANNOT

1. Confirm anything works until tested — **no live validation has been performed** on any customer instance
2. Call routes the customer's Jiwa version/plugins don't provide (Jiwa 7 has fewer routes; API + OpenAPI are plugins that must be enabled) [DOCS]
3. Use Debtor API keys — Numa connects with **Staff** keys only (Debtor keys are for customer portals and are heavily filtered) [DOCS]
4. Receive webhooks into Numa — Jiwa has a webhook subsystem, but there is no Numa receiver; poll `LastSavedDateTimeGreaterThan` instead
5. Rely on a rate limit header — there is none unless the rate-limit plugin is installed [DOCS]

## Critical Gotchas

1. **Updates are PATCH, not PUT.** PUT exists only on a few special routes (e.g. LineDetails bulk replace). [SPEC]
2. **Prefer `/Queries/*` for ALL read/list/report questions.** Entity GETs (e.g. `/Debtors/{id}`) return the FULL business DTO — notes, documents, prices, ledgers — which is huge. Queries support `Fields=` to trim columns. [DOCS]
3. **AutoQuery filter grammar:** plain `Field=x` is exact match; suffix operators `StartsWith`, `EndsWith`, `Contains`, `Like`, `GreaterThan(OrEqualTo)`, `LessThan(OrEqualTo)`, `NotEqualTo`, `Between`, `In` (e.g. `AccountNoStartsWith=1`, `LastSavedDateTimeGreaterThan=2026-06-01`). Multiple criteria AND by default; use the `/Queries/OR/...` twin route to OR them. [SPEC]
4. **Sales orders/quotes are snapshot-based.** Lines live under `/SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines`. Simpler: PATCH the parent `/SalesOrders/{InvoiceID}` with a `Lines` array — a line WITH `InvoiceLineID` updates that line; WITHOUT it appends a new line. [DOCS]
5. **Omit the price** on a new sales order line and Jiwa applies its normal pricing-scheme logic; set `DiscountedPrice` only to override. [DOCS]
6. **Resolution pairs:** provide `DebtorID` or `DebtorAccountNo` (ID wins if both); line items take `InventoryID` or `PartNo` (ID wins). [DOCS]
7. **Processing a sales order is a GET:** `GET /SalesOrders/{InvoiceID}/Process` posts journals + debtor transactions — a state-changing GET. Never call it casually. [SPEC]
8. **Custom field `SettingID`s contain trailing spaces** (stored as padded char). URL-encode them (`%20`) in paths like `/CustomFieldValues/{SettingID}`. [DOCS]
9. **204 No Content** is returned for GETs with nothing to return and successful DELETEs — handle an empty body. [DOCS]
10. **409 Conflict** = business-logic veto (e.g. deleting a product used on an order) OR optimistic-concurrency clash (record changed between read and save). Re-read, then retry once. [DOCS]
11. **`Take` is capped by the `AutoQueryMaxLimit` system setting** (DoS guard). Use `Include=Total` — if `Total` > rows returned, page with `Skip`. [DOCS]
12. **`GET /Debtors` (no ID) is NOT "list debtors"** — it returns the debtor of a Debtor-API-key caller. With a Staff key, list customers via `/Queries/DebtorList` or `/Queries/DB_Main`. [DOCS]
13. **Documents are embedded base64** (`FileBinary` in Document DTOs) — avoid pulling document collections unless asked. [SPEC]

## Default Parameters

Use these defaults on `/Queries/*` unless the user specifies otherwise:

| Parameter | Default                          | Reason                                          |
| --------- | -------------------------------- | ----------------------------------------------- |
| Take      | 25                               | Bounded result set; AutoQueryMaxLimit caps it   |
| Skip      | 0 (then 25, 50… to page)         | Offset paging                                   |
| Include   | Total                            | Returns total match count for pagination        |
| Fields    | the few columns you need         | Full rows are wide; trims payload               |
| OrderBy   | sensible key (`OrderByDesc=LastSavedDateTime` for recency) | Deterministic paging |

## Working Examples

All examples are adapted from Jiwa's official wiki [DOCS]; response shapes from the spec [SPEC]. Not yet replayed against a live instance.

### Example 1: Filtered, paginated sales order list [DOCS]

```
connectors(name="request", params={"connector": "jiwa", "method": "GET",
  "url": "/Queries/SalesOrderList?PhysicalWarehouseDescription=New South Wales&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID,AccountNo,DebtorName&OrderBy=InvoiceNo&Include=Total&Take=25"})
```

```json
{
  "Offset": 0,
  "Total": 312,
  "Results": [
    { "InvoiceID": "000000000800000000NK", "InvoiceNo": "104001", "InvoiceInitDate": "2026-05-30T00:00:00",
      "DebtorID": "00000000080000000002", "AccountNo": "CASH", "DebtorName": "Cash Sales" }
  ]
}
```

Next page: same URL + `&Skip=25`. (`Results` shape per `QueryResponse` DTO [SPEC].)

### Example 2: Create a sales order with lines and a payment [DOCS]

```
connectors(name="request", params={"connector": "jiwa", "method": "POST", "url": "/SalesOrders",
  "body": {
    "DebtorID": "00000000080000000002",
    "OrderNo": "1234",
    "SOReference": "Test order",
    "Lines": [
      {"PartNo": "1170", "QuantityOrdered": 5},
      {"CommentLine": true, "CommentText": "This is a comment line"},
      {"InventoryID": "000000000K00000000BV", "QuantityOrdered": 2, "DiscountedPrice": 15.67}
    ],
    "Payments": [{"PaymentRef": "S454873-J5", "AmountPaid": 50.00}]
  }})
```

Response `201` = the **full SalesOrder DTO** (generated `InvoiceID`, `InvoiceNo`, computed totals, `Histories`). Line 1 is priced by Jiwa's pricing logic (no price given); omitted `PaymentType` uses the configured default. [DOCS]

### Example 3: Update a debtor — change fields and upsert notes in one PATCH [DOCS]

```
connectors(name="request", params={"connector": "jiwa", "method": "PATCH",
  "url": "/Debtors/0000000061000000001V",
  "body": {
    "EmailAddress": "name2@example.com",
    "WebAccess": false,
    "Notes": [
      {"NoteText": "A new note added"},
      {"NoteID": "DE91CC53-724A-47C6-8920-57AC82BFAD1F", "NoteText": "A modified note text"}
    ]
  }})
```

Response `200` = full updated Debtor DTO. Child item WITH its ID updates; WITHOUT its ID appends — same convention as sales order lines. [DOCS]

## Proxy API Operations

> Core verticals only [SPEC]. The full route list (816 paths) is available from `{instance}/RestPaths` and the OpenAPI spec at `{instance}/openapi` — check there before assuming a route doesn't exist.

| Operation                   | Method | Path                                            | Key Parameters                            | Notes                                       |
| --------------------------- | ------ | ----------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| List/search customers       | GET    | /Queries/DebtorList (or /Queries/DB_Main)       | NameContains, AccountNoStartsWith, LastSavedDateTimeGreaterThan, Fields, Take | First stop for customer questions |
| Customer transactions       | GET    | /Queries/DebtorTransactionList                  | DebtorID, Fields, Take                    | AR transactions                             |
| Get / update / delete debtor| GET/PATCH/DELETE | /Debtors/{DebtorID}                   | full DTO; Notes/ContactNames upsert       | Full business object — large                |
| Create debtor               | POST   | /Debtors                                        | AccountNo (recommended), Name, EmailAddress | All fields optional; IDs generated [DOCS] |
| List/search inventory       | GET    | /Queries/InventoryItemList (or /Queries/IN_Main)| PartNoStartsWith, DescriptionContains, Fields | Includes AvailableStock, SellPrice      |
| Stock on hand               | GET    | /Queries/IN_SOH, /Queries/INSOHWithBinLocations | InventoryID, IN_LogicalID                 | Quantities/costs by warehouse               |
| Get / update inventory item | GET/PATCH/DELETE | /Inventory/{InventoryID}              | full DTO                                  |                                             |
| Create inventory item       | POST   | /Inventory                                      | PartNo, Description                       |                                             |
| List sales orders           | GET    | /Queries/SalesOrderList (or /Queries/SO_Main)   | InvoiceNo, DebtorID, StatusIn, warehouse fields | Joined customer+delivery view          |
| Get sales order             | GET    | /SalesOrders/{InvoiceID}                        | —                                         | Full DTO with Lines, Payments, Histories    |
| Create sales order          | POST   | /SalesOrders                                    | DebtorID/DebtorAccountNo, Lines[]         | Omit price → auto-pricing [DOCS]            |
| Update sales order          | PATCH  | /SalesOrders/{InvoiceID}                        | Lines[] (InvoiceLineID = update), Notes[] | Upsert children in one call [DOCS]          |
| Line-level CRUD             | GET/POST/PATCH/DELETE | /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines[/{InvoiceLineID}] | PartNo, QuantityOrdered | Needs history (snapshot) ID |
| Process sales order         | GET    | /SalesOrders/{InvoiceID}/Process                | —                                         | ⚠️ State-changing GET — posts journals      |
| List sales quotes           | GET    | /Queries/SalesQuoteList (or /Queries/QO_Main)   | DebtorID, Fields, Take                    |                                             |
| Get/create/update quote     | GET/POST/PATCH | /SalesQuotes[/{QuoteID}]                | same shape as sales orders                |                                             |
| Convert quote to order      | POST   | /SalesQuotes/{QuoteID}/MakeOrder                | —                                         | Also /MakeOrderB2B                          |
| List purchase orders        | GET    | /Queries/PO_Main                                | CreditorID, Status, OrderNo               |                                             |
| Get/create/update/delete PO | GET/POST/PATCH/DELETE | /PurchaseOrders[/{PurchaseOrderID}] | CreditorAccountNo, Lines[]                | Create path is `/PurchaseOrders/` [SPEC]    |
| PO lines                    | GET/POST/PATCH/DELETE | /PurchaseOrders/{PurchaseOrderID}/Lines[/{PurchaseOrderLineID}] | PartNo, Quantity |                            |
| Activate PO                 | POST   | /PurchaseOrders/Activate/{PurchaseOrderID}      | —                                         | Moves order into active workflow            |
| List suppliers              | GET    | /Queries/CR_Main                                | NameContains, AccountNo                   |                                             |
| Get/create/update creditor  | GET/POST/PATCH/DELETE | /Creditors[/{CreditorID}]        | AccountNo, Name                           | Supplier master                             |
| Goods receipt from PO       | POST   | /GoodsReceivedNotes/FromPurchaseOrders/{OrderNos} | —                                       | Then PATCH lines, POST /GoodsReceivedNotes/Activate/{GRNID} |
| Supplier invoice from GRN   | POST   | /PurchaseInvoices/FromGoodsReceivedNotes/{GRNNos} | —                                       | Then /PurchaseInvoices/Activate/{id}        |
| All routes on this instance | GET    | /RestPaths                                      | —                                         | Authoritative per-customer route list       |

## Pagination [DOCS]

- **Type:** offset-based — `Skip` + `Take` on all `/Queries/*` routes
- **Server cap:** `AutoQueryMaxLimit` system setting (value varies per customer) [DOCS]
- **Total count:** add `Include=Total` → response `Total` field; page until `Skip + len(Results) >= Total`

```
GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25            (page 1)
GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25&Skip=25    (page 2)
```

- Always set `OrderBy`/`OrderByDesc` when paging — deterministic order is not guaranteed otherwise [UNVERIFIED]

## Error Handling

HTTP status + response body **text** describing the problem (e.g. "product not found"); the `DebugMode` system setting adds stack traces. 401 was observed with an EMPTY body. Parse defensively — body may be plain text, a ServiceStack `ResponseStatus` JSON object, or empty. [DOCS / UNVERIFIED for exact shapes]

**Recovery by status [DOCS]:**

| Status | Meaning                                   | Action                                                            |
| ------ | ----------------------------------------- | ----------------------------------------------------------------- |
| 200/201| OK / created                              | POST returns the full created DTO with generated IDs              |
| 204    | No content (empty GET result, DELETE OK)  | Treat as success with empty body                                  |
| 401    | Key invalid / expired / revoked           | User must reconnect Jiwa via the chat credential card             |
| 403    | User Group denies this route              | Jiwa-side permission — user asks their Jiwa admin; do not retry   |
| 404    | Bad route OR missing record               | Verify the RecID; check `/RestPaths` if the route may not exist   |
| 409    | Business-logic veto / concurrency conflict| Read the body text; re-read the record and retry once             |
| 429    | Rate limited (only if plugin installed)   | Back off and retry                                                |
| 5xx    | Server error                              | Retry once with backoff; report the body text                     |

## Known Limitations

1. **Nothing here is live-validated** — verify against a test instance before first customer use; expect drift per Jiwa version (7 vs 8), enabled plugins, and User Group permissions
2. Self-hosted: the customer's API must be internet-reachable (HTTPS, often Cloudflare/IP-whitelisted) — connectivity issues are environment-side [DOCS]
3. The REST API and the OpenAPI/Swagger endpoint are Jiwa **plugins** — if disabled in Plugin Maintenance, routes 404 [DOCS]
4. No webhook receiver in Numa — poll `/Queries/*` with `LastSavedDateTimeGreaterThan` for change detection
5. Entity GET responses are full business DTOs (can be very large); no field selection outside `/Queries/*`
6. No bulk/batch endpoint for unrelated writes; child collections batch only within one parent PATCH
7. Jiwa is building an official MCP server on this API (announced, not shipped) — this connector may later be superseded [DOCS]

---

_Generated 2026-06-10 from the Jiwa OpenAPI spec + official wiki. NOT live-tested. See companion file:_

- _01a-domain-model-reference.md -- Entity catalog, relationships, lifecycle/status fields_
