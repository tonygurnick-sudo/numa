---
doc: api-spec-investigation (dev reference)
vendor: MYOB (Acumatica-based ERP, ANZ market)
api_version: 24.200.001 (2024 R2)
api_type: Contract-Based REST API + OData query syntax; JSON
base_url: https://{instance}.myobadvanced.com
path_template: /entity/Default/24.200.001/{Entity}
researched: 2026-03-30
docs: https://enterprise-support.myob.com/acudev/api-documentation ; upstream https://help.acumatica.com
openapi: per-instance /entity/Default/24.200.001/swagger.json?company={CompanyName} (auth required; not public)
csharp_sdk: https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp
confidence: [DOCUMENTED] unless tagged
---

# MYOB Acumatica — API Spec & Investigation

Cloud ERP exposing 200+ business entities via contract-based REST. Used by AU/NZ mid-market for financials, sales, purchasing, inventory, CRM, projects.

## Authentication — OAuth 2.0 Authorization Code

Per-instance OAuth; each instance has its own IdentityServer.
| Parameter | Value |
| --- | --- |
| Grant type | authorization_code (+ refresh_token) |
| Authorization URL | `https://{instance}.myobadvanced.com/identity/connect/authorize` |
| Token URL | `https://{instance}.myobadvanced.com/identity/connect/token` |
| OIDC Discovery | `https://{instance}.myobadvanced.com/identity/` |
| Access token lifetime | ~3600s (instance-configurable) |
| Refresh token lifetime | 30 days (configurable from 2023 R2 via SM303010) |
| Refresh behavior | rotate on use (old token invalidated) |
| PKCE required | No (recommended, not enforced) |

Required scopes: `api` (REST access) + `offline_access` (receive refresh token) — both required.
Header: `Authorization: Bearer {access_token}` + `Content-Type: application/json`.

> ⚠️ `client_id` MUST include the `@CompanyId` suffix, e.g. `392B04F6-6CA4-43FA-48D9-45A6E6DF5579@Company`. Without it the OAuth server cannot resolve the tenant. [VERIFIED 2026-05-19 — fast-programmer/myob_acumatica README + Keboola helper]

Token exchange: `POST {token_url}` form-urlencoded — `grant_type=authorization_code&code={authorization_code}&redirect_uri={redirect_uri}&client_id={GUID}@{CompanyId}&client_secret={client_secret}`
Token response: `{"access_token":"eyJ0eXAiOiJKV1Qi...","token_type":"Bearer","expires_in":3600,"refresh_token":"abc123def456..."}`
Token refresh: `POST {token_url}` form-urlencoded — `grant_type=refresh_token&refresh_token={refresh_token}&client_id={GUID}@{CompanyId}&client_secret={client_secret}`
Sources: help.acumatica.com pageid=ff780860-09c2-46c9-bdd7-c6c3b1fc442c ; satvasolutions.com/blog/oauth-2-0-authentication-in-myob-acumatica ; help.acumatica.com pageid=a8f71c44-9f5c-4af8-9d47-bc815c8a58e7

## Endpoint catalog

Entity API — `/entity/Default/24.200.001/`:
| Method | Path | Purpose | Returns |
| --- | --- | --- | --- |
| GET | `/{Entity}` | list (OData params) | JSON array |
| GET | `/{Entity}/{id}` | get by GUID | single entity |
| GET | `/{Entity}/{key1}/{key2}` | get by business keys | single entity |
| PUT | `/{Entity}` | create (no key match) or update (key match/`id`) | created/updated entity |
| DELETE | `/{Entity}/{id}` | delete by GUID | 204 |
| DELETE | `/{Entity}/{key1}/{key2}` | delete by keys | 204 |
| POST | `/{Entity}/{id}/action/{ActionName}` | execute action | 202 or 204 |
| PUT | `/{Entity}/{key1}/{key2}/files/{filename}` | attach file (binary) | 204 |
| GET | `/{Entity}/{key1}/{key2}/files/{filename}` | download file | binary |

Generic Inquiry (OData): `GET /odata/{Company}/{GI_ScreenID}` → JSON array of flat objects.
OAuth API — `/identity/connect/`: `GET /authorize` (code request → redirect); `POST /token` (exchange/refresh → token response).

## Entity endpoints — examples

### Customer

List: `GET /entity/Default/24.200.001/Customer?$top=50&$filter=Status eq 'Active'&$select=CustomerID,CustomerName,Status,Balance,MainContact&$orderby=CustomerName asc`
Response: `[{"id":"f7a8b9c0-d1e2-3456-7890-abcdef123456","rowNumber":1,"note":null,"CustomerID":{"value":"ACME01"},"CustomerName":{"value":"Acme Corporation"},"Status":{"value":"Active"},"Balance":{"value":12500.0},"MainContact":{"id":"11223344-5566-7788-99aa-bbccddeeff00","rowNumber":1,"Email":{"value":"billing@acme.com"},"Phone1":{"value":"+64 9 555 0100"}}}]`
Create: `PUT /entity/Default/24.200.001/Customer` → `{"CustomerID":{"value":"NEWCUST01"},"CustomerName":{"value":"New Customer Ltd"},"CustomerClass":{"value":"DEFAULT"},"Status":{"value":"Active"}}` → `200 OK` with full entity incl. generated `id`.
Update: `PUT /entity/Default/24.200.001/Customer` → `{"id":"f7a8b9c0-d1e2-3456-7890-abcdef123456","CustomerName":{"value":"Acme Corp (New Name)"}}`
Delete: `DELETE /entity/Default/24.200.001/Customer/f7a8b9c0-d1e2-3456-7890-abcdef123456` → `204`.

### SalesOrder

List with lines: `GET /entity/Default/24.200.001/SalesOrder?$top=20&$filter=Status eq 'Open' and CustomerID eq 'ACME01'&$expand=Details&$orderby=Date desc`
Response: `[{"id":"e5f6a7b8-...","rowNumber":1,"note":null,"OrderType":{"value":"SO"},"OrderNbr":{"value":"000042"},"CustomerID":{"value":"ACME01"},"Date":{"value":"2026-03-28T00:00:00+00:00"},"Status":{"value":"Open"},"OrderTotal":{"value":500.0},"Details":[{"id":"line-1-guid","rowNumber":1,"InventoryID":{"value":"WIDGET01"},"Quantity":{"value":10.0},"UnitPrice":{"value":25.0},"Amount":{"value":250.0}}]}]`
Create: `PUT /entity/Default/24.200.001/SalesOrder` → `{"OrderType":{"value":"SO"},"CustomerID":{"value":"ACME01"},"Description":{"value":"New order"},"Details":[{"InventoryID":{"value":"WIDGET01"},"Quantity":{"value":10},"UnitPrice":{"value":25.00}}]}`
Confirm (action): `POST /entity/Default/24.200.001/SalesOrder/{guid}/action/ConfirmSalesOrder` → `{"entity":{"id":"{guid}"}}` → `204` or `202` (poll Location).

### SalesInvoice

List: `GET /entity/Default/24.200.001/SalesInvoice?$top=50&$filter=Status eq 'Open'&$select=ReferenceNbr,Type,CustomerID,Date,DueDate,Amount,Balance,Status&$orderby=Date desc`
Response: `[{"id":"inv-guid-1","rowNumber":1,"note":null,"Type":{"value":"INV"},"ReferenceNbr":{"value":"AR007890"},"CustomerID":{"value":"ACME01"},"Date":{"value":"2026-03-15T00:00:00+00:00"},"DueDate":{"value":"2026-04-14T00:00:00+00:00"},"Status":{"value":"Open"},"Amount":{"value":1250.0},"Balance":{"value":1250.0}}]`
Release (action): `POST /entity/Default/24.200.001/SalesInvoice/{guid}/action/ReleaseSalesInvoice` → `{"entity":{"id":"{guid}"}}`

### Bill

List: `GET /entity/Default/24.200.001/Bill?$top=50&$filter=Status eq 'Open' and VendorID eq 'SUPPLY01'&$select=ReferenceNbr,Type,VendorID,Date,DueDate,Amount,Balance,Status&$orderby=DueDate asc`
Create: `PUT /entity/Default/24.200.001/Bill` → `{"Type":{"value":"BL"},"VendorID":{"value":"SUPPLY01"},"VendorRef":{"value":"VENDOR-INV-123"},"Description":{"value":"Office supplies"},"Details":[{"InventoryID":{"value":"PAPER"},"Quantity":{"value":100},"UnitPrice":{"value":5.00}}]}`

### StockItem

List: `GET /entity/Default/24.200.001/StockItem?$top=100&$filter=ItemStatus eq 'Active'&$select=InventoryID,Description,DefaultPrice,CurrentStockQty,ItemStatus&$orderby=InventoryID asc`
Response: `[{"id":"item-guid-1","rowNumber":1,"note":null,"InventoryID":{"value":"WIDGET01"},"Description":{"value":"Standard Widget"},"DefaultPrice":{"value":25.0},"CurrentStockQty":{"value":1250.0},"ItemStatus":{"value":"Active"}}]`

### JournalTransaction

Create balanced entry: `PUT /entity/Default/24.200.001/JournalTransaction` → `{"Module":{"value":"GL"},"TransactionDate":{"value":"2026-03-30"},"Description":{"value":"Adjusting entry"},"Details":[{"AccountID":{"value":"52000"},"DebitAmount":{"value":1000.00},"CreditAmount":{"value":0},"Description":{"value":"Debit - expense"}},{"AccountID":{"value":"21000"},"DebitAmount":{"value":0},"CreditAmount":{"value":1000.00},"Description":{"value":"Credit - liability"}}]}`

### Lead / Opportunity

Create lead: `PUT /entity/Default/24.200.001/Lead` → `{"FirstName":{"value":"John"},"LastName":{"value":"Doe"},"CompanyName":{"value":"Potential Client Inc"},"Email":{"value":"john@potentialclient.com"},"Source":{"value":"Referral"}}`
Convert: `POST /entity/Default/24.200.001/Lead/{guid}/action/ConvertLeadToOpportunity` → `{"entity":{"id":"{guid}"}}`

### Files

Attach: `PUT /entity/Default/24.200.001/SalesOrder/SO/000042/files/quote.pdf` · `Content-Type: application/octet-stream` · binary body → `204`.
Download: `GET /entity/Default/24.200.001/SalesOrder/SO/000042/files/quote.pdf`.
List: `GET /entity/Default/24.200.001/SalesOrder/SO/000042?$expand=files`.

## Pagination

Offset-based (`$top` + `$skip`). No default page size (omit `$top` → ALL records). Max practical ~500. No total count in contract-based API. Params: `$top` (int, no default, max records) · `$skip` (int, default 0). Last page when `results.length < $top`.

## Rate limits

Per-instance concurrent: 6 (L-series). Request queue: 20, queue timeout 60s. Exceeded → HTTP 429 (no documented `Retry-After`). Strategy: cap parallelism 3–4, exponential backoff on 429. (Detail in 01d / 03.)

## Error handling

Format: `{"message":"An error has occurred.","exceptionMessage":"Error: 'CustomerClass' cannot be empty.","exceptionType":"PX.Data.PXException"}`
| Status | Meaning | Retryable | Recovery |
| --- | --- | --- | --- |
| 400 | Validation | No | fix per `exceptionMessage` |
| 401 | Unauthorized | Yes | refresh token |
| 403 | Forbidden | No | check API license / permissions |
| 404 | Not found | No | verify entity name + id |
| 409 | Conflict | Yes | re-GET, merge, retry |
| 422 | Business rule | No | check state / constraints |
| 429 | Rate limited | Yes | backoff + retry |
| 500 | Server error | Yes | retry once |
(Full error strings + recovery playbook in 01d.)

## Webhooks / events

Push Notifications — UI-configured only (not API-managed). Payload fields: `Query`, `CompanyId`, `Id`, `TimeStamp`, `Inserted[]`, `Deleted[]`, `AdditionalInfo`. Delivery at-least-once (dedupe on `Id`). No API webhook management → poll with `LastModifiedDateTime` filter. (Detail in 01d.)

## Known limitations

1. No batch/bulk endpoint — individual PUT calls only.
2. No total record count in list responses.
3. Push Notifications (webhooks) are UI-only — no API management.
4. Swagger spec requires authenticated instance access (not publicly downloadable).
5. Released financial documents are immutable (void + recreate).
6. Line-item arrays are fully replaced on update (no partial array updates).
7. API License add-on required (separate purchase from MYOB; 403 without it).
8. No `Retry-After` header documented for 429.

## SDKs & tooling

| SDK                     | Lang | Repo                                                 | Quality | Notes                              |
| ----------------------- | ---- | ---------------------------------------------------- | ------- | ---------------------------------- |
| Acumatica.RESTClient    | C#   | github.com/Acumatica/AcumaticaRESTAPIClientForCSharp | Good    | official, NuGet                    |
| Acumatica Java REST API | Java | github.com/Acumatica/Java-based-REST-API             | Fair    | community                          |
| EndpointModelGenerator  | C#   | same repo as RESTClient                              | Good    | generates models from swagger.json |

Postman collection: not public. OpenAPI: per-instance `/entity/Default/{version}/swagger.json?company={Company}`.

## Integration path

Recommended: **Data Connector (OAuth2) + Direct API (hybrid)** — browsable entity data suits a data connector; action capabilities (release/confirm/convert) suit direct API via workspace agent.
Connector method mapping: `list_files` → `GET /{Entity}?$top=...`; `download_file` → `GET /{Entity}/{keys}/files/{filename}`; `search_files` → `GET /{Entity}?$filter=contains(...)`; `get_file_metadata` → `GET /{Entity}/{id}`. All Good feasibility.

Sources: Official Acumatica help docs, MYOB Enterprise Support, Integration Development Guide PDFs, Acumatica community forums, GitHub SDK, DevCon presentations.
