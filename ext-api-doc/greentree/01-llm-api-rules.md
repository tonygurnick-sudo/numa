---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
version: 'Greentree RESTful HTTP API (customer-hosted, versions ~2018.3–2021.4+)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-11'
update_source: 'MYOB Greentree official docs (enterprisesupport.myob.com/greentree/api-overview + /api-documentation entity pages) — NO live testing through the Numa connector path'
line_count_target: '< 300 lines'
---

# MYOB Greentree -- Workspace Agent API Rules

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the Greentree integration is active.**
> It must stay under 300 lines. Companion file `01a-domain-model-reference.md` has the entity catalog.
> Facts are tagged [DOCS] (official MYOB Greentree docs) or [UNVERIFIED] (inferred). Treat all as
> unconfirmed until exercised on a real customer instance.

## Context

- **API:** MYOB Greentree RESTful HTTP API — a NZ/AU ERP (GL, AR/AP, inventory, purchasing, sales orders, job costing, HR, CRM, manufacturing). Descriptive URLs map to Greentree Jade classes [DOCS]
- **Base URL:** the customer's OWN self-hosted Greentree server — **no fixed cloud host**. The Greentree API is its own web server (no IIS required), default port 9000. Relative URLs expand against the admin-configured Instance URL [DOCS]
- **Company code in the path:** every URL starts with the Greentree company code (e.g. `01`) — `/{company}/{entity}/{identifier}`. The agent MUST include it; ask the user or discover it if unknown [DOCS]
- **Auth:** TWO mechanisms, both injected automatically by Numa — the site's `ApiKey` header (admin-supplied serial number) AND the user's Greentree login (HTTP Basic auth). **Never set either.** [DOCS]
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **Response format:** XML or JSON; **use JSON** — Numa negotiates `application/json` via the Accept header [DOCS]
- **Field casing:** PascalCase property names (`AccountNo`, `DocumentDate`, `QuantityOnHand`) [DOCS]
- **ID format:** the entity's natural human key (the `<identifier>` path segment): `AccountNo` (GL), customer `Code`, `Reference` (AR/AP/SO/PO documents), part `Code` (stock). Greentree also exposes an `OidString` internal object id on most entities [DOCS]

## How to Call

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/GLAccount?page=1&pageSize=50",
  "method": "GET"
})
```

- Relative `url` expands against the customer's instance URL (admin-configured). Never hardcode a host or port.
- **The company code (`01` above) is part of the path** — `/{company}/{entity}[/{identifier}]`. Include it on every call.
- POST: pass the JSON document in `body`. JSON content negotiation (Accept/Content-Type) is handled by the backend.
- **NEVER set `ApiKey`, `Authorization`, or Basic-auth headers.** Numa injects the admin site ApiKey and the user's vaulted Greentree login on every request; you never see them.
- Verbs [DOCS]: **GET = read, POST = create AND update (POST to `/{entity}/{ref}` updates), DELETE = delete.** There is no PUT/PATCH — Greentree overloads POST.

## Auth Structure

Two mandatory mechanisms per request, both injected by Numa — show requests WITHOUT auth headers.

1. **ApiKey** — the site's Greentree serial number, sent as the `ApiKey` HTTP header. Account/site-level (same for every user of that Greentree site), supplied once by the admin [DOCS].
2. **Basic auth** — a regular Greentree username + password. The API runs with **exactly that user's Greentree permissions**, so the same query returns different data for different users [DOCS].

- **401** = an auth failure (bad/expired/revoked Greentree login, or a wrong/disabled ApiKey). Two possible fixes: the **user reconnects** their Greentree login via the chat credential card, OR the **admin re-saves the site ApiKey** in the integration settings. Surface both. Do not blind-retry.
- A permission-denied read returns whatever Greentree returns for that user's rights — likely an empty/partial result, not a distinct 403 [UNVERIFIED]. If a user "can't see" expected data, suspect their Greentree permissions.

## Capabilities

### CAN

1. Read/list across all modules: GL (`GLAccount`, `GLBudget`, `GLDocument`), AR (`Customer`, `ARInvoice`, `ARReceipt`, `ARCreditNote`), AP (`Supplier`, `APInvoice`, `APPayment`), Inventory (`StockItem`, `INTransaction`, `Location`), Purchasing (`POPurchaseOrder`, `POReceipt`), Sales Orders (`SOSalesOrder`, `SOPackingSlip`), Job Costing (`JCJob`, `JCTimesheet`, `JCEstimate`), HR, CRM [DOCS]
2. Create + update master/transaction records via POST (POST to `/{entity}` creates; POST to `/{entity}/{ref}` updates) [DOCS]
3. Per-entity selection filters: `modifiedSince`, plus entity-specific filters (`customer`, `supplier`, `status`, `isActive`, `analysisCode`, `treeName`/`treeBranch`, `outstandingOnly`…) [DOCS]
4. Page large lists with `page` + `pageSize` (100-record cap per request) [DOCS]
5. Query/upload/download **Attachments** and read/write **Sticky Notes** on any entity (query modifiers) [DOCS]
6. Read **Approvals**, and **approve/reject/clear-approval** records via `action=approve|reject|clearApproval` POSTs [DOCS]
7. Run soft-coded reports to PDF via `action=report` (POST an AHFormDefn) [DOCS]
8. Global Search on any list endpoint via `?globalSearch=...` (2020.1+) [DOCS]
9. Sort list results via `sortBy1`/`sortDesc1` (rolling out from 2021; started on ARInvoice) [DOCS]

### CANNOT

1. Confirm anything works until tested — **no live validation has been performed** on any customer instance
2. Call entities/modifiers the customer's Greentree VERSION doesn't have — features rolled out per release (e.g. `StockItem` POST-create is 2021.3+; sorting is 2021+). Many modifiers carry a minimum version [DOCS]
3. Use PUT/PATCH — they don't exist; POST is overloaded for create AND update [DOCS]
4. Rely on a fixed base URL or port — every customer is different and must be internet-reachable over HTTPS for Numa's Lambdas to reach it [DOCS]
5. Receive webhooks into Numa — Greentree has no webhook system; poll `modifiedSince` instead
6. Assume a uniform status vocabulary — status values are per-entity and per-customer-config [UNVERIFIED]

## Critical Gotchas

1. **The company code is in the PATH, not a header or param.** `/01/Customer/CUST1234` — forget the `01` and the call fails. Confirm the company code with the user before the first call. [DOCS]
2. **Updates are POST, not PUT/PATCH.** `POST /{company}/{entity}/{reference}` with a partial body updates that record; `POST /{company}/{entity}` (no identifier) creates a new one. [DOCS]
3. **`<identifier>` is the human key, not an internal id.** `/Customer/CUST1234`, `/GLAccount/1000`, `/ARInvoice/100023`, `/SOSalesOrder/SO100001`. On create you generally CANNOT specify the identifier — Greentree allocates it (documented exceptions per entity). [DOCS]
4. **List GETs are capped at 100 records** and paged with `page` + `pageSize`. Increment `page` until a page returns fewer than `pageSize` rows. `pageSize` omitted defaults to 100. [DOCS]
5. **Modifiers are version-gated.** Each entity page lists a min version per modifier (e.g. `branch` on PO from 2017.1, `postingDate` on ARInvoice from 2021.1). On an older instance, an unsupported modifier may be ignored or error. [DOCS]
6. **Some POSTs to `/{entity}/{ref}` are ACTIONS, not updates.** `action=cancel` (PO, SO), `action=putOnHold`/`takeOffHold` (SO), `action=approve`/`reject`/`clearApproval` (any), `action=report`, `action=attachment`. These carry their own required payload fields. [DOCS]
7. **The user's Greentree permissions filter every response.** Two users running the same query get different data. "Missing" records usually = a permissions gap in Greentree, not a bug. [DOCS]
8. **JSON POST is supported from Greentree 4@8-5** — very old instances may only accept XML for writes. Reads return JSON when Numa asks for it. [DOCS]
9. **`modifiedSince` is the universal change filter** — present on essentially every entity. ISO8601, server-local time (`2013-02-28T16:45:00`, no timezone). [DOCS]
10. **`globalSearch` (2020.1+) ≠ a field filter** — it runs Greentree's configured Global Search and returns matches across configured columns. Use specific modifiers (`customer=`, `status=`) for precise filters. [DOCS]
11. **Reports and big writes can outrun the request timeout.** `action=report` has a 60s default (override with `timeout=n`); a slow report or large posting may exceed the connector timeout. [DOCS]
12. **Trailing-slash / path-segment ORDER matters.** `/{company}/{entity}/{identifier}` segments MUST be in that exact sequence. [DOCS]

## Default Parameters

Use these defaults on list GETs unless the user specifies otherwise:

| Parameter   | Default                         | Reason                                                |
| ----------- | ------------------------------- | ----------------------------------------------------- |
| page        | 1 (then 2, 3… to page)          | Mandatory paging companion to pageSize                |
| pageSize    | 50 (max 100)                    | Bounded result set; server caps at 100                |
| modifiedSince | (omit unless "recently changed") | Universal change filter; ISO8601 server-local        |
| sortBy1     | (omit; 2021+ only)              | Sorting is version-gated and entity-by-entity rollout |
| company     | ask the user once               | Company code (e.g. `01`) is REQUIRED in the path      |

## Working Examples

All examples are adapted from MYOB Greentree's official docs [DOCS]; response shapes are illustrative [UNVERIFIED]. Not yet replayed against a live instance. Assume company `01`.

### Example 1: List GL accounts, paged [DOCS]

```
connectors(name="request", params={"connector": "greentree", "method": "GET",
  "url": "/01/GLAccount?page=1&pageSize=50&accountType=Income"})
```

Returns up to 50 GL accounts of type Income. Each has `AccountNo`, `Description`, `AccountType`, `AccountSign`, `Status`, `IsPosting`. Page with `&page=2` until a short page. [DOCS]

### Example 2: Find a customer by code, then their open invoices [DOCS]

```
connectors(name="request", params={"connector": "greentree", "method": "GET",
  "url": "/01/Customer/CUST1234"})
```

```
connectors(name="request", params={"connector": "greentree", "method": "GET",
  "url": "/01/ARInvoice?customer=CUST1234&outstandingOnly=true&sortBy1=documentDate&sortDesc1=true&page=1&pageSize=25"})
```

`ARInvoice` selection supports `customer`, `outstandingOnly`, `holdCode`, `postingDate` (2021.1+), and `sortBy1`/`sortDesc1` (2021.1+). [DOCS]

### Example 3: Create a customer, then update it [DOCS]

```
connectors(name="request", params={"connector": "greentree", "method": "POST", "url": "/01/Customer",
  "body": {"Name": "New Trade Customer", "Status": "Active",
           "Address": {"Address1": "1 Queen St", "Suburb": "Auckland", "Email": "ap@example.com"}}})
```

POST with no identifier creates; Greentree allocates the `Code`. Capture it from the response. Then update by POSTing to the identifier route:

```
connectors(name="request", params={"connector": "greentree", "method": "POST", "url": "/01/Customer/CUST1235",
  "body": {"CreditLimit": 10000}})
```

Partial body — only the fields you send change. [DOCS / UNVERIFIED merge semantics]

## Proxy API Operations

> Core verticals only [DOCS]. The full entity catalog is on MYOB's docs (`/api-documentation`) — check there (and the customer's version) before assuming an entity or modifier exists.

| Operation                  | Method | Path (prepend `/{company}`)         | Key Parameters / Body                              | Notes                                          |
| -------------------------- | ------ | ----------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| List / get GL accounts     | GET    | /GLAccount[/{AccountNo}]            | accountType, treeName/treeBranch, modifiedSince, includeOpeningBalance | `IsPosting` flags postable accounts |
| List / get customers       | GET    | /Customer[/{Code}]                  | modifiedSince, isActive, emailAddress, treeName    | Greentree class is `ARCustomer` (route `Customer`) |
| Create / update customer   | POST   | /Customer[/{Code}]                  | Name, Status, Address{}, CreditLimit, TaxCode      | DELETE supported                               |
| List / get AR invoices     | GET    | /ARInvoice[/{Reference}]            | customer, holdCode, outstandingOnly, postingDate, sortBy1 | LineItems are GLLineItem rows           |
| Create AR invoice          | POST   | /ARInvoice                          | Customer, DocumentDate, LineItems[]                | POST `/ARInvoice/{ref}?action=setIsPrinted` (2021.1+) |
| List / get suppliers        | GET    | /Supplier[/{Code}]                  | modifiedSince, isActive, taxReference, status      | Class `APSupplier` (route `Supplier`)          |
| List / get stock items      | GET    | /StockItem[/{Code}]                 | isActive, analysisCode, stockingLocation, listOnly, modifiedSince | QuantityOnHand/Available/Committed |
| Stock item price            | GET    | /StockItem/{Code}?action=sellingPrice | customer, priceLevel, quantity, date, location   | Price calc for a context                       |
| List / get purchase orders  | GET    | /POPurchaseOrder[/{Reference}]      | supplier, status (pipe-list 2021.1+), branch, modifiedSince | LineItems[]                            |
| Create / update PO          | POST   | /POPurchaseOrder[/{Reference}]      | Supplier, DocumentDate, LineItems[]                | POST `/{ref}?action=cancel` (2021.3+)          |
| PO receipt                  | GET/POST | /POReceipt[/{Reference}]          | —                                                  | Goods receipt against a PO                     |
| List / get sales orders     | GET    | /SOSalesOrder[/{Reference}]         | customer, status, salesPerson, customerOrderNumber | LineItems[]; class `SOSalesOrder`             |
| Create / update sales order | POST   | /SOSalesOrder[/{Reference}]         | Customer, DeliveryDate, LineItems[]                | `action=cancel|putOnHold|takeOffHold`          |
| Packing slip                | GET    | /SOPackingSlip/{Reference}          | —                                                  | The overview's worked example entity           |
| List / get jobs             | GET    | /JCJob[/{Code}]                     | customer, jobManager, excludeClosed, includeSubJobs| Job Costing header                             |
| Job timesheets / estimates  | GET/POST | /JCTimesheet, /JCEstimate         | (entity-specific)                                  |                                                |
| Approve / reject a record   | POST   | /{entity}/{ref}?action=approve\|reject\|clearApproval | Approval{ApprovedBy, Narration}       | Works on any approvable entity                 |
| Run a report to PDF         | POST   | /{entity}/{ref}?action=report       | AHFormDefn{Name, Parameters[], Attachment{}}       | 60s default; `timeout=n` to extend             |
| Attachments                 | GET/POST | /{entity}/{ref}?action=attachment | includeAttachments=true (GET); multipart (POST)    | Download by `name=`; upload multipart/form-data|
| Health check                | GET    | /Ping                               | —                                                  | Liveness check                                 |

## Pagination [DOCS]

- **Type:** page-number based — `page` (1-based) + `pageSize`, used together. List GETs cap at **100 records**.
- **Default:** `pageSize` omitted → 100 records (page 1).
- **Last page detection:** keep incrementing `page` until a page returns **fewer than `pageSize`** rows.

```
GET /01/SOSalesOrder?status=Entered&page=1&pageSize=50    (records 1-50)
GET /01/SOSalesOrder?status=Entered&page=2&pageSize=50    (records 51-100)
```

- No total-count field is documented [UNVERIFIED] — detect the end by a short/empty page.
- Sorting (`sortBy1`/`sortDesc1`) is version-gated (2021+) and rolling out per entity — don't rely on it for stable paging on older instances. [DOCS]

## Error Handling

Greentree returns an HTTP status with a body describing the problem (shape per-entity, [UNVERIFIED] through the connector). Parse defensively — body may be XML or JSON.

**Recovery by status [DOCS / UNVERIFIED codes]:**

| Status | Meaning                                       | Action                                                                       |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| 200    | OK (GET / POST create / POST update)          | POST responses carry the saved record incl. any allocated identifier          |
| 401    | Auth failed (Greentree login OR site ApiKey)  | User reconnects their Greentree login via the chat card, OR admin re-saves the site ApiKey. Do NOT blind-retry |
| 404    | Bad route / unknown entity / wrong identifier | Check company code, entity name, and the identifier (human key, not OidString) |
| 4xx    | Validation / business-rule rejection          | Read the body; fix the payload (missing required fields, bad references)       |
| 5xx    | Server fault (customer's Greentree service)   | Retry GETs with backoff; NEVER blind-retry writes — re-read first              |
| timeout| Slow report/posting outran the request        | For reports raise `timeout=n`; for writes, re-read before retrying             |

## Known Limitations

1. **Nothing here is live-validated** — verify against a test instance before first customer use; expect drift per Greentree version (modifiers and even whole entities are version-gated)
2. Customer-hosted: the Greentree API server (default port 9000) must be internet-reachable over HTTPS for Numa to reach it — connectivity is environment-side [DOCS]
3. No webhooks/streaming — poll `modifiedSince` for change detection
4. No PUT/PATCH — POST is overloaded for create and update; some POSTs are actions
5. No documented total-count on lists — page until a short page; 100-record hard cap per request
6. Status/type vocabularies are per-entity and per-customer-config — discover them empirically, don't hardcode

---

_Generated 2026-06-11 from MYOB Greentree's official API docs. NOT live-tested. See companion files:_

- _01a-domain-model-reference.md -- Entity catalog, identifiers, modules, relationships_
- _01b-query-patterns.md -- List/filter/page/sort patterns_
- _01c-mutation-patterns.md -- Create/update/action/report patterns_
- _01d-event-and-error-handling.md -- Change polling, errors, recovery_
