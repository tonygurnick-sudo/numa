---
api_name: Jiwa Financials
api_slug: jiwa
base_url: per-customer self-hosted instance — NO shared cloud host, NO default. Admin sets instance_url; backend joins relative paths against it.
route_prefix_injected_by_connector: none (pass paths exactly as routed, e.g. /Debtors/{id})
path_version_segment: none ("Jiwa 8 / API 1.0" is a label only; routes are unversioned — no /v1/, no /v8/)
auth: Bearer {staff_api_key} — injected by Numa per request; NEVER set Authorization yourself; you never see the key
field_casing: PascalCase (DebtorID, AccountNo, QuantityOrdered)
id_format: RecID — opaque string, typically 20 chars (0000000061000000001V, 5244dd5e199749f4b6fe); NEVER parse/construct
rate_limit: none by default; optional per-IP "REST API Rate Limit" plugin only if customer enabled it
call_surface: HTTP via `numa integrations request` — connector: jiwa, method, url, body. NOT a file-store (no list-files/download-file). NOT MCP.
verbs: GET=read, POST=create, PATCH=update (NOT PUT), DELETE=delete
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: spec/docs-derived, NOT live-validated. Tags: [SPEC]=OpenAPI, [DOCS]=Jiwa wiki, [UNVERIFIED]=inferred. Treat ALL as unconfirmed until tested. Expect drift per Jiwa version (7 vs 8), enabled plugins, User Group route permissions.
---

# Jiwa Financials — API Rules

> Spec-derived, NOT yet live-validated. Jiwa = Australian ERP (inventory/distribution, AR/AP, GL) on ServiceStack, DTO-in/DTO-out [DOCS]. 816 paths / 1,381 ops.

## How to call

`numa integrations request` with `connector: "jiwa"`, `method`, `url` (relative), `body` (JSON DTO for POST/PATCH). Examples below abbreviate to `METHOD /path body {...}`.

- Relative `url` expands against the admin-configured instance URL. Never hardcode a host or use an absolute URL.
- NEVER set `Authorization`/`Content-Type` — backend injects Bearer key + JSON negotiation.

## Auth & route permissions

- Bearer **Staff** API key per request (Debtor keys rejected — see CANNOT). Runs with exactly that staff member's permissions [DOCS].
- Route access is per **User Group** ("Default REST API Permission" + per-route grants in User Group Maintenance). Disallow anywhere wins; Undefined = deny unless allowed elsewhere [DOCS].
- **403** = authenticated but route not permitted for the user's group — a Jiwa-side setting. Tell the user to ask their Jiwa admin; do NOT retry.
- **401** = key invalid/expired/revoked (empty body observed on hosted instance). User reconnects Jiwa via the chat credential card.

## CAN

1. Read-query nearly everything via `/Queries/*` AutoQuery routes (152 ops over DB views/tables: DebtorList, SalesOrderList, InventoryItemList, IN_SOH stock-on-hand, DB_Main, CR_Main, PO_Main, GL_Ledger, DebtorTransactionList, BackOrderList…) [SPEC].
2. Full CRUD: Debtors, Inventory, Sales Orders (+lines/payments/notes), Sales Quotes, Purchase Orders, Creditors, GRNs, Purchase Invoices, Shipments, Work Orders, Bills, Journal Sets, Warehouse Transfers, To Dos, Carriers [SPEC].
3. Lifecycle actions: process a sales order (`GET /Process` posts journals + debtor transactions), convert quote→order (`POST /SalesQuotes/{id}/MakeOrder`), activate POs/GRNs/purchase invoices/shipments/transfers (`POST /{Plural}/Activate/{id}`) [SPEC].
4. Upsert child collections (Lines, Notes, CustomFieldValues, Payments) inside one PATCH of the parent [DOCS].
5. Read/write custom field values (`/CustomFieldValues` sub-routes) [DOCS].
6. List every route the instance exposes: `GET /RestPaths` [DOCS].

## CANNOT

1. Confirm anything works — no live validation performed on any customer instance.
2. Call routes the customer's Jiwa version/plugins don't provide (Jiwa 7 has fewer routes; REST API + OpenAPI are plugins that must be enabled) [DOCS].
3. Use **Debtor** API keys — Numa connects with Staff keys only (Debtor keys are for customer portals, heavily filtered) [DOCS].
4. Receive webhooks — Jiwa has a webhook subsystem but there is no Numa receiver; poll `LastSavedDateTimeGreaterThan` instead.
5. Rely on a rate-limit header — none unless the rate-limit plugin is installed [DOCS].

## Critical gotchas

1. **Updates are PATCH, not PUT.** PUT exists only on a few set-replace routes (e.g. LineDetails) [SPEC].
2. **Prefer `/Queries/*` for ALL read/list/report questions.** Entity GETs (e.g. `/Debtors/{id}`) return the FULL business DTO — notes, documents, prices, ledgers — huge. Queries support `Fields=` to trim columns [DOCS].
3. **AutoQuery filter grammar:** plain `Field=x` = exact; suffix operators `StartsWith`, `EndsWith`, `Contains`, `Like`, `GreaterThan(OrEqualTo)`, `LessThan(OrEqualTo)`, `NotEqualTo`, `Between`, `In` (e.g. `AccountNoStartsWith=1`, `LastSavedDateTimeGreaterThan=2026-06-01`). Multiple criteria AND by default; use the `/Queries/OR/{name}` twin to OR them [SPEC].
4. **Sales orders/quotes are snapshot-based.** Lines live under `/SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines`. Simpler: PATCH the parent `/SalesOrders/{InvoiceID}` with a `Lines` array — a line WITH `InvoiceLineID` updates it; WITHOUT it appends [DOCS].
5. **Omit price** on a new sales-order line → Jiwa applies its pricing-scheme logic; set `DiscountedPrice` only to override [DOCS].
6. **Resolution pairs:** `DebtorID` or `DebtorAccountNo` (ID wins if both); line items take `InventoryID` or `PartNo` (ID wins) [DOCS].
7. **Processing a sales order is a GET:** `GET /SalesOrders/{InvoiceID}/Process` posts journals + debtor transactions — a state-changing GET. Never call casually; never auto-retry [SPEC].
8. **Custom-field `SettingID`s contain trailing spaces** (padded char). URL-encode as `%20` in paths like `/CustomFieldValues/{SettingID}`; never trim [DOCS].
9. **204 No Content** for GETs with nothing to return and successful DELETEs — handle an empty body, do not JSON-parse [DOCS].
10. **409 Conflict** = business-logic veto (e.g. deleting a product used on an order) OR optimistic-concurrency clash (record changed between read and save). Re-read, then retry once [DOCS].
11. **`Take` is capped by the `AutoQueryMaxLimit` system setting** (DoS guard, value varies per customer, silent clamp). Use `Include=Total` — if `Total` > rows returned, page with `Skip` [DOCS].
12. **`GET /Debtors` (no ID) is NOT "list debtors"** — it returns the debtor of a Debtor-API-key caller. With a Staff key, list customers via `/Queries/DebtorList` or `/Queries/DB_Main` [DOCS].
13. **Documents are embedded base64** (`FileBinary` in Document DTOs) — avoid pulling document collections unless asked [SPEC].

## Defaults (override only if the user specifies)

On `/Queries/*`: `Take=25`, `Skip=0` (then 25, 50…), `Include=Total` (match count), `Fields=` only the columns needed, `OrderBy`/`OrderByDesc` a sensible key (`OrderByDesc=LastSavedDateTime` for recency — deterministic paging).

## Working examples

Bodies adapted from Jiwa's wiki [DOCS]; response shapes from spec [SPEC]; not replayed live.

1. **Filtered, paginated sales-order list** [DOCS]:
   `GET /Queries/SalesOrderList?PhysicalWarehouseDescription=New South Wales&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID,AccountNo,DebtorName&OrderBy=InvoiceNo&Include=Total&Take=25`
   → `{"Offset":0,"Total":312,"Results":[{"InvoiceID":"000000000800000000NK","InvoiceNo":"104001","InvoiceInitDate":"2026-05-30T00:00:00","DebtorID":"00000000080000000002","AccountNo":"CASH","DebtorName":"Cash Sales"}]}`
   Next page: same URL + `&Skip=25`. (`QueryResponse` shape [SPEC].)

2. **Create a sales order with lines + payment** (`POST /SalesOrders`) [DOCS]:
   `{"DebtorID":"00000000080000000002","OrderNo":"1234","SOReference":"Test order","Lines":[{"PartNo":"1170","QuantityOrdered":5},{"CommentLine":true,"CommentText":"This is a comment line"},{"InventoryID":"000000000K00000000BV","QuantityOrdered":2,"DiscountedPrice":15.67}],"Payments":[{"PaymentRef":"S454873-J5","AmountPaid":50.00}]}`
   → `201` = full SalesOrder DTO (generated `InvoiceID`, `InvoiceNo`, computed totals, `Histories`). Line 1 priced by Jiwa (no price given); omitted `PaymentType` uses the configured default [DOCS].

3. **Update a debtor — change fields + upsert notes in one PATCH** (`PATCH /Debtors/0000000061000000001V`) [DOCS]:
   `{"EmailAddress":"name2@example.com","WebAccess":false,"Notes":[{"NoteText":"A new note added"},{"NoteID":"DE91CC53-724A-47C6-8920-57AC82BFAD1F","NoteText":"A modified note text"}]}`
   → `200` = full updated Debtor DTO. Child WITH its ID updates; WITHOUT it appends.

## Operations

> Core verticals only. Full route list (816 paths) at `{instance}/RestPaths` and `{instance}/openapi` — check there before assuming a route absent.

| Operation                   | Method                | Path                                                                         | Key params / notes                                                                                                |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| List/search customers       | GET                   | /Queries/DebtorList (or /Queries/DB_Main)                                    | NameContains, AccountNoStartsWith, LastSavedDateTimeGreaterThan, Fields, Take — first stop for customer questions |
| Customer AR transactions    | GET                   | /Queries/DebtorTransactionList                                               | DebtorID, Fields, Take                                                                                            |
| Get/update/delete debtor    | GET/PATCH/DELETE      | /Debtors/{DebtorID}                                                          | full DTO (large); Notes/ContactNames upsert                                                                       |
| Create debtor               | POST                  | /Debtors                                                                     | AccountNo (recommended), Name, EmailAddress — all fields optional; IDs generated [DOCS]                           |
| List/search inventory       | GET                   | /Queries/InventoryItemList (or /Queries/IN_Main)                             | PartNoStartsWith, DescriptionContains, Fields — includes AvailableStock, SellPrice                                |
| Stock on hand               | GET                   | /Queries/IN_SOH, /Queries/INSOHWithBinLocations                              | InventoryID, IN_LogicalID — qty/cost by warehouse                                                                 |
| Get/update inventory item   | GET/PATCH/DELETE      | /Inventory/{InventoryID}                                                     | full DTO                                                                                                          |
| Create inventory item       | POST                  | /Inventory                                                                   | PartNo, Description                                                                                               |
| List sales orders           | GET                   | /Queries/SalesOrderList (or /Queries/SO_Main)                                | InvoiceNo, DebtorID, StatusIn, warehouse fields — joined customer+delivery view                                   |
| Get sales order             | GET                   | /SalesOrders/{InvoiceID}                                                     | full DTO with Lines, Payments, Histories                                                                          |
| Create sales order          | POST                  | /SalesOrders                                                                 | DebtorID/DebtorAccountNo, Lines[] — omit price → auto-pricing [DOCS]                                              |
| Update sales order          | PATCH                 | /SalesOrders/{InvoiceID}                                                     | Lines[] (InvoiceLineID = update), Notes[] — upsert children in one call [DOCS]                                    |
| Line-level CRUD             | GET/POST/PATCH/DELETE | /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines[/{InvoiceLineID}] | PartNo, QuantityOrdered — needs history (snapshot) ID                                                             |
| Process sales order         | GET                   | /SalesOrders/{InvoiceID}/Process                                             | State-changing GET — posts journals                                                                               |
| List sales quotes           | GET                   | /Queries/SalesQuoteList (or /Queries/QO_Main)                                | DebtorID, Fields, Take                                                                                            |
| Get/create/update quote     | GET/POST/PATCH        | /SalesQuotes[/{QuoteID}]                                                     | same shape as sales orders                                                                                        |
| Convert quote to order      | POST                  | /SalesQuotes/{QuoteID}/MakeOrder                                             | also /MakeOrderB2B                                                                                                |
| List purchase orders        | GET                   | /Queries/PO_Main                                                             | CreditorID, Status, OrderNo                                                                                       |
| Get/create/update/delete PO | GET/POST/PATCH/DELETE | /PurchaseOrders[/{PurchaseOrderID}]                                          | CreditorAccountNo, Lines[] — create path is `/PurchaseOrders/` [SPEC]                                             |
| PO lines                    | GET/POST/PATCH/DELETE | /PurchaseOrders/{PurchaseOrderID}/Lines[/{PurchaseOrderLineID}]              | PartNo, Quantity                                                                                                  |
| Activate PO                 | POST                  | /PurchaseOrders/Activate/{PurchaseOrderID}                                   | moves order into active workflow                                                                                  |
| List suppliers              | GET                   | /Queries/CR_Main                                                             | NameContains, AccountNo                                                                                           |
| Get/create/update creditor  | GET/POST/PATCH/DELETE | /Creditors[/{CreditorID}]                                                    | AccountNo, Name — supplier master                                                                                 |
| Goods receipt from PO       | POST                  | /GoodsReceivedNotes/FromPurchaseOrders/{OrderNos}                            | then PATCH lines, POST /GoodsReceivedNotes/Activate/{GRNID}                                                       |
| Supplier invoice from GRN   | POST                  | /PurchaseInvoices/FromGoodsReceivedNotes/{GRNNos}                            | then /PurchaseInvoices/Activate/{id}                                                                              |
| All routes on this instance | GET                   | /RestPaths                                                                   | authoritative per-customer route list                                                                             |

## Pagination [DOCS]

Offset-based — `Skip` + `Take` on all `/Queries/*` routes. Server cap = `AutoQueryMaxLimit` (per-customer, silent clamp). Add `Include=Total` → response `Total`; page until `Skip + len(Results) >= Total`. Always set `OrderBy`/`OrderByDesc` when paging — deterministic order not otherwise guaranteed [UNVERIFIED].

```
GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25            (page 1)
GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25&Skip=25    (page 2)
```

## Error handling

HTTP status + body **text** describing the problem (e.g. "product not found"); `DebugMode` system setting adds stack traces. 401 observed with EMPTY body. Parse defensively — body may be plain text, a ServiceStack `ResponseStatus` JSON object, or empty [DOCS / UNVERIFIED exact shapes].

| Status  | Meaning                                    | Action                                                          |
| ------- | ------------------------------------------ | --------------------------------------------------------------- |
| 200/201 | OK / created                               | POST returns full created DTO with generated IDs                |
| 204     | No content (empty GET result, DELETE OK)   | success with empty body                                         |
| 401     | Key invalid/expired/revoked                | user reconnects Jiwa via the chat credential card               |
| 403     | User Group denies this route               | Jiwa-side permission — user asks their Jiwa admin; do NOT retry |
| 404     | Bad route OR missing record                | verify the RecID; check `/RestPaths` if the route may not exist |
| 409     | Business-logic veto / concurrency conflict | read body text; re-read the record and retry once               |
| 429     | Rate limited (only if plugin installed)    | back off and retry                                              |
| 5xx     | Server error                               | retry once with backoff; report the body text                   |

## Self-hosted caveats [DOCS]

Customer's API must be internet-reachable (HTTPS, often Cloudflare/IP-whitelisted) — connectivity issues are environment-side. REST API + OpenAPI/Swagger are Jiwa **plugins**; if disabled in Plugin Maintenance, routes 404. No bulk/batch endpoint for unrelated writes; children batch only within one parent PATCH. Jiwa is building an official MCP server on this API (announced, not shipped) — this connector may later be superseded.

_Companion: 01a-domain-model-reference.md — entity catalog, relationships, lifecycle/status fields._
