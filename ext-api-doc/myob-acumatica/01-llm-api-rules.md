---
api_name: MYOB Acumatica
api_slug: myob-acumatica
api_type: Contract-Based REST API + OData query syntax
api_version: 24.200.001 (2024 R2)
base_url: https://{instance}.myobadvanced.com
path_template: /entity/Default/{api_version}/{Entity}   # e.g. /entity/Default/24.200.001/Customer
path_version_segment: REQUIRED — 24.200.001 is a literal PATH segment (the contract version), NOT a label. Never drop it; no "latest" alias.
endpoint_name_segment: Default (the standard Web Service Endpoint; ~280 entities). Custom endpoint names possible per-instance.
call_surface: HTTP via `numa integrations request` (build the full path incl. /entity/Default/24.200.001/). NOT a file-store connector.
auth: OAuth2 Authorization Code, per-instance IdentityServer, Bearer {access_token}
field_casing: PascalCase field names; every business field value wrapped {"value": ...}
id_format: system `id` = GUID (NOT wrapped). Business keys (CustomerID, OrderNbr…) are strings.
mutation_method: PUT = upsert (create + update). NO POST for create, NO PATCH.
rate_limit: concurrency-based (6 concurrent L-series [DOCUMENTED]; queue depth 20 / timeout 60s [INFERRED, single forum post]). No Retry-After header. Shared per-instance.
integration_path: hybrid (Data Connector OAuth2 + Direct API)
confidence: facts [DOCUMENTED] unless tagged [INFERRED]/[VERIFIED <date>]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# MYOB Acumatica — API Rules

## Paths (read first)

- Full path = `/entity/Default/24.200.001/{Entity}`. Send via `numa integrations request` against base `https://{instance}.myobadvanced.com`.
- `24.200.001` IS a real path segment (the contract version). Keep it verbatim. No "latest" alias; a version is never just a label here.
- `{instance}` is the per-tenant hostname (e.g. `mgccivil`). Domain is `.myobadvanced.com` (NOT `.myob.com`).
- `Default` is the endpoint name. Per-instance custom endpoints can exist; assume `Default`.

## Auth

`Authorization: Bearer {access_token}` + `Content-Type: application/json`. Per-instance OAuth2 (Authorization Code + refresh). 403 on every call = paid **API License** add-on missing (not a token problem). **`client_id` MUST carry a `@CompanyId` suffix** (e.g. `{GUID}@Company`) — without it the OAuth server can't resolve the tenant and the token request fails. [VERIFIED 2026-05-19]

## CAN

CRUD on 200+ entities (Customer, Vendor, SalesOrder, SalesInvoice, Bill, PurchaseOrder, StockItem, Lead, Opportunity, Project, Employee, JournalTransaction). OData query (filter, sort, paginate, `$select`, `$expand`). Execute actions (release invoices, confirm orders, convert leads). Attach/download files on entities. Read Generic Inquiries.

## CANNOT

Create/modify/delete webhook subscriptions via API (Push Notifications are UI-only). Bulk/batch in one request (no `$batch`). Edit released financial docs (void + recreate). Get a total record count from list queries.

## Critical rules (violation = broken request)

1. **Every business field value is wrapped `{"value": ...}`.** CORRECT `{"CustomerName":{"value":"Acme"}}`; WRONG `{"CustomerName":"Acme"}`. Nested too: `{"MainContact":{"Email":{"value":"a@b.com"}}}`. System `id` (GUID) is NOT wrapped.
2. **PUT = create AND update (upsert).** PUT without `id`/key match = create; PUT with `id` or matching key = update. NO POST for create. NO PATCH. (POST/PATCH → 405.)
3. **Filters use bare field names + single quotes.** CORRECT `$filter=Status eq 'Active'`; WRONG `$filter=Status.value eq 'Active'`; WRONG `$filter=Status eq "Active"` (no double quotes).
4. **Always set `$top` on list queries.** Omitting it returns ALL records (thousands). Use `$top=100` (max practical 200, hard ceiling ~500).
5. **Totals/balances are computed, read-only** (`OrderTotal`, `Amount`, `Balance`, `LineTotal`). Sending them in PUT is ignored or errors.
6. **Released documents are immutable** (SalesInvoice/Bill/JournalTransaction). Must void + recreate.
7. **Line-item update replaces the ENTIRE `Details` array.** Include `id` on existing lines to preserve; omit `id` for new lines; any existing line NOT in the array is DELETED. GET with `$expand=Details` first to get line `id`s.
8. **Actions return 202 OR 204 — both success.** 204 = done immediately. 202 = long-running; poll the `Location` header URL (202 = still processing, 204 = done).

## Defaults (override only if user specifies)

`$top=100`, `$orderby` always set when paginating (deterministic order, else duplicates/misses). For polling: `$filter=LastModifiedDateTime gt datetimeoffset'...'`.

## HTTP methods

| Method | Purpose                    | Example                                                                                                       |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | List/read                  | `/entity/Default/24.200.001/Customer?$top=20`                                                                 |
| PUT    | Create or update (upsert)  | `/entity/Default/24.200.001/Customer`                                                                         |
| DELETE | Delete by GUID or key path | `/entity/Default/24.200.001/Customer/{guid}`                                                                  |
| POST   | Execute action             | `/entity/Default/24.200.001/SalesInvoice/{guid}/action/ReleaseSalesInvoice`                                   |
| PUT    | Attach file                | `/entity/Default/24.200.001/SalesOrder/SO/000042/files/{filename}` (`Content-Type: application/octet-stream`) |

## OData query params

`$top` (always; max ~200) · `$skip` (pagination offset) · `$filter` (bare fields, single quotes) · `$select=CustomerID,CustomerName` (top-level fields only; reduces payload) · `$orderby=CustomerName asc` (asc/desc) · `$expand=Details` (line items/sub-entities; without it arrays are omitted) · `$custom=true` (include UDFs).

## Pagination

Offset-based: `$top=100&$skip=0`, then `$skip=100`… Always add `$orderby`. No total count, no `@odata.count`, no `@odata.nextLink`. **Last page when `results.length < $top`.** `$skip` past the end returns `[]` (not an error).

## Webhooks / events

No API-managed webhooks. Push Notifications are UI-configured only. Detect changes by polling: `$filter=LastModifiedDateTime gt datetimeoffset'2026-03-30T10:00:00Z'`. Interval 5–15 min.

## Errors

Format: `{"message":"An error has occurred.","exceptionMessage":"Error: 'CustomerClass' cannot be empty.","exceptionType":"PX.Data.PXException"}`. `exceptionMessage` carries the actionable detail — surface it. Multi-field errors use `PX.Data.PXOuterException` with `innerException.message` listing each field.

Recovery by status: 400 fix per `exceptionMessage` · 401 refresh token, retry once · 403 API License inactive OR role lacks permission (do NOT refresh-loop) · 404 verify entity name + id · 409 optimistic-concurrency conflict → re-GET, merge, retry PUT · 422 business rule (state/credit hold/closed period) · 429 wait 2–5s, exponential backoff (no Retry-After) · 500 retry once with backoff.

Common error strings (verbatim — match on these):

- `"Document is already released and cannot be modified."` → void + recreate.
- `"Another process has updated the 'SOOrder' record. Your changes will be lost."` → re-GET, merge, retry (409 path).
- `"The API license is not valid or has expired."` → 403; customer renews API License add-on.
- `"The document cannot be processed because Customer 'ACME01' is on credit hold."` → 422.
- `"The financial period '01-2026' is closed. Transactions cannot be posted to this period."` → use an open period.

## Do NOT

POST/PATCH to create or update (use PUT) · drop the `{"value":...}` wrapper · `$filter=Status.value eq ...` (use bare `Status`) · double-quote filter strings · omit `$top` · send partial `Details` array on update (send ALL lines) · edit released docs · assume actions always 204 (may be 202) · drop the `24.200.001` path segment.

## Examples

1. List active customers (`GET`):
   `/entity/Default/24.200.001/Customer?$top=20&$filter=Status eq 'Active'&$select=CustomerID,CustomerName,Status,Balance&$orderby=CustomerName asc`

2. Create a customer (`PUT /entity/Default/24.200.001/Customer`):
   `{"CustomerID":{"value":"ACME01"},"CustomerName":{"value":"Acme Corporation"},"CustomerClass":{"value":"DEFAULT"},"Status":{"value":"Active"},"MainContact":{"Email":{"value":"billing@acme.com"}}}`
   → `200 OK` with full entity incl. generated `id`, `rowNumber`, `note`.

3. Create a sales order with lines (`PUT /entity/Default/24.200.001/SalesOrder`):
   `{"OrderType":{"value":"SO"},"CustomerID":{"value":"ACME01"},"Description":{"value":"Q1 2026 Order"},"Details":[{"InventoryID":{"value":"WIDGET01"},"Quantity":{"value":10},"UnitPrice":{"value":25.00}}]}`

4. Release an invoice (`POST /entity/Default/24.200.001/SalesInvoice/{guid}/action/ReleaseSalesInvoice`):
   `{"entity":{"id":"{guid}"}}` → `204` (done) or `202` (poll `Location`).

5. Paginated stock list (`GET`):
   `/entity/Default/24.200.001/StockItem?$top=100&$skip=0&$filter=ItemStatus eq 'Active'&$orderby=InventoryID asc` — stop when `results.length < 100`.
