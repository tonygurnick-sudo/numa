---
api_name: MYOB Greentree
api_slug: greentree
base_url: NONE — customer-hosted; admin sets per-customer instance_url (its own web server, default port 9000). No shared SaaS host.
path_rule: /{company}/{entity}[/{identifier}] — company code (e.g. 01) is the FIRST path segment on EVERY call; segment order is mandatory
path_version_segment: none (API is unversioned; feature availability tracks the Greentree release — NOT a path or header)
call_surface: HTTP via connectors(name="request", connector="greentree", url, method[, body]). NOT a file store (no list-files/search-files/download-file). NOT MCP. NOT Pipedream/OAuth.
auth: dual, both backend-injected, agent sets NEITHER — (1) ApiKey header = site serial number (account-level); (2) Authorization: Basic = per-user Greentree login. API runs with that user's Greentree permissions.
verbs: GET=read, POST=create(no identifier) AND update(to /{entity}/{ref}) AND actions(?action=), DELETE=delete. NO PUT/PATCH.
field_casing: PascalCase (AccountNo, DocumentDate, QuantityOnHand)
id_format: entity human key (AccountNo/Code/Reference) — NOT the internal OidString. Greentree allocates it on create.
response_format: JSON (backend negotiates Accept; docs samples are XML)
rate_limit: none documented; customer's single Jade server with bounded worker pool — self-throttle
confidence: docs-derived from MYOB Greentree official KB; NOT live-validated through the Numa connector. Treat all as [DOCS] unless tagged [UNVERIFIED]. Verify on a live instance before first customer use.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# MYOB Greentree — API Rules

## Paths (read first)

- Every call: `/{company}/{entity}[/{identifier}]`. The **company code (e.g. `01`) is the FIRST path segment on EVERY call** — list GETs too (`/01/Customer?...`, never `/Customer?company=01`). Forget it → fail. Confirm the code with the user before the first call.
- NO version segment. The API is unversioned — never add `/v1/` or similar.
- Segment ORDER is mandatory: `{company}` then `{entity}` then `{identifier}`.
- `{entity}` = the Greentree Jade class name (PascalCase). Some routes differ from the module name: AR Customer → route `/Customer` (class `ARCustomer`); AP Supplier → route `/Supplier` (class `APSupplier`). GL/SO/PO/JC use prefixed class names as the route (`GLAccount`, `SOSalesOrder`, `POPurchaseOrder`, `JCJob`).
- `{identifier}` = the entity's **human key** (`AccountNo`, customer/supplier `Code`, document `Reference`, part `Code`), NOT the internal `OidString`. Omit it → list. Treat references as opaque strings (may be dotted, e.g. `24333.01`); don't parse/construct.
- Base URL is the customer's own self-hosted server (admin-configured `instance_url`); never hardcode a host or port. Relative `url` expands against it.

## How to call

```
connectors(name="request", params={"connector":"greentree","method":"GET","url":"/01/GLAccount?page=1&pageSize=50"})
```

- HTTP connector only — use `request`. NOT a file store (no list-files/search-files/download-file). NOT MCP.
- POST: pass the JSON document in `body`.
- **NEVER set `ApiKey`, `Authorization`, or Basic-auth headers.** Numa injects the admin site ApiKey + the user's vaulted Greentree login on every request; you never see them.

## Auth (dual; both injected by Numa)

1. **ApiKey** header = the site's Greentree serial number. Account/site-level (same for every user), admin-supplied once.
2. **HTTP Basic** = the user's Greentree username+password. The API runs with **exactly that user's Greentree permissions** — the same query returns different data for different users.

- **401** = auth failure from EITHER mechanism. Surface BOTH fixes: user reconnects their Greentree login via the chat credential card, OR admin re-saves the site ApiKey. Do NOT blind-retry.
- A permission gap (user authenticates but lacks rights) returns **filtered/empty results, not a 403** [UNVERIFIED]. "Missing" data usually = a Greentree-role gap, not a bug — tell the user to check with their Greentree admin.

## CAN

- Read/list across all modules: GL (`GLAccount`,`GLBudget`,`GLDocument`), AR (`Customer`,`ARInvoice`,`ARReceipt`,`ARCreditNote`), AP (`Supplier`,`APInvoice`,`APPayment`), Inventory (`StockItem`,`INTransaction`,`Location`), Purchasing (`POPurchaseOrder`,`POReceipt`), Sales Orders (`SOSalesOrder`,`SOPackingSlip`), Job Costing (`JCJob`,`JCTimesheet`,`JCEstimate`), HR, CRM.
- Create + update via POST (POST `/{entity}` creates; POST `/{entity}/{ref}` updates).
- Per-entity filters: `modifiedSince` + entity-specific (`customer`,`supplier`,`status`,`isActive`,`analysisCode`,`treeName`/`treeBranch`,`outstandingOnly`…).
- Page lists with `page`+`pageSize` (100-record cap).
- Query/upload/download Attachments; read/write Sticky Notes on any entity.
- Read Approvals; approve/reject/clear via `action=approve|reject|clearApproval`.
- Run reports to PDF via `action=report`. Global Search via `?globalSearch=` (2020.1+). Sort via `sortBy1`/`sortDesc1` (2021+, per-entity rollout, started ARInvoice).

## CANNOT

- Confirm anything works until live-tested (no validation performed).
- Use PUT/PATCH (don't exist).
- Call entities/modifiers the customer's Greentree VERSION lacks (features roll out per release; many modifiers carry a min version; e.g. `StockItem` POST-create 2021.3+).
- Rely on a fixed base URL/port — every customer differs and must be internet-reachable over HTTPS.
- Receive webhooks — none; poll `modifiedSince`.
- Assume a uniform status vocabulary — status values are per-entity, per-customer-config [UNVERIFIED].

## Gotchas

1. **Company code is in the PATH, not a header/param.** `/01/Customer/CUST1234` — confirm the code first.
2. **Updates are POST, not PUT/PATCH.** POST `/{entity}/{ref}` (partial body) updates; POST `/{entity}` (no identifier) creates.
3. **`<identifier>` is the human key, not OidString.** On create you generally CANNOT set it — Greentree allocates it (documented exceptions per entity); capture it from the response.
4. **List GETs cap at 100 records**, paged `page`+`pageSize`. `pageSize` omitted → 100. Increment `page` until a page returns < `pageSize` rows.
5. **Modifiers are version-gated** (e.g. `postingDate` on ARInvoice 2021.1; `branch` on PO 2017.1). On older instances an unsupported modifier may be ignored or error.
6. **Some POSTs to `/{entity}/{ref}` are ACTIONS, not updates:** `action=cancel` (PO,SO), `action=putOnHold`/`takeOffHold` (SO), `action=approve`/`reject`/`clearApproval` (any), `action=report`, `action=attachment`. Each carries its own required payload.
7. **User's Greentree permissions filter every response.** "Missing" records usually = a permissions gap, not a bug.
8. **JSON POST is supported from Greentree 4@8-5** — very old instances may only accept XML for writes. Reads return JSON.
9. **`modifiedSince` is the universal change filter** (essentially every entity). ISO8601, server-local, no timezone (`2013-02-28T16:45:00`).
10. **`globalSearch` (2020.1+) ≠ a field filter** — runs Greentree's configured Global Search across configured columns. Use specific modifiers for precise filters.
11. **Reports/big writes can outrun the timeout.** `action=report` 60s default (`timeout=n` to extend); a slow report or large posting may exceed the connector timeout.

## Defaults (override only if the user specifies)

| Parameter     | Default                        | Note                                          |
| ------------- | ------------------------------ | --------------------------------------------- |
| company       | ask the user once              | REQUIRED in the path (e.g. `01`)              |
| page          | 1 (then 2,3…)                  | mandatory paging companion                    |
| pageSize      | 50 (max 100)                   | server caps at 100                            |
| modifiedSince | omit unless "recently changed" | universal change filter; ISO8601 server-local |
| sortBy1       | omit (2021+ only)              | version-gated, per-entity rollout             |

## Operations (prepend `/{company}`)

| Operation                   | Method   | Path                                                  | Key params / notes                                                                                          |
| --------------------------- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| List / get GL accounts      | GET      | /GLAccount[/{AccountNo}]                              | accountType, treeName/treeBranch, modifiedSince, includeOpeningBalance; `IsPosting` flags postable accounts |
| List / get customers        | GET      | /Customer[/{Code}]                                    | modifiedSince, isActive, emailAddress, treeName; class `ARCustomer`                                         |
| Create / update customer    | POST     | /Customer[/{Code}]                                    | Name, Status, Address{}, CreditLimit, TaxCode; DELETE supported                                             |
| List / get AR invoices      | GET      | /ARInvoice[/{Reference}]                              | customer, holdCode, outstandingOnly, postingDate, sortBy1; LineItems are GLLineItem rows                    |
| Create AR invoice           | POST     | /ARInvoice                                            | Customer, DocumentDate, LineItems[]; POST `/{ref}?action=setIsPrinted` (2021.1+) — action only              |
| List / get suppliers        | GET      | /Supplier[/{Code}]                                    | modifiedSince, isActive, taxReference, status; class `APSupplier`                                           |
| List / get stock items      | GET      | /StockItem[/{Code}]                                   | isActive, analysisCode, stockingLocation, listOnly, modifiedSince; QuantityOnHand/Available/Committed       |
| Stock item price            | GET      | /StockItem/{Code}?action=sellingPrice                 | customer, priceLevel, quantity, date, location                                                              |
| List / get purchase orders  | GET      | /POPurchaseOrder[/{Reference}]                        | supplier, status (pipe-list 2021.1+), branch, modifiedSince; LineItems[]                                    |
| Create / update PO          | POST     | /POPurchaseOrder[/{Reference}]                        | Supplier, DocumentDate, LineItems[]; POST `/{ref}?action=cancel` (2021.3+)                                  |
| PO receipt                  | GET/POST | /POReceipt[/{Reference}]                              | goods receipt against a PO                                                                                  |
| List / get sales orders     | GET      | /SOSalesOrder[/{Reference}]                           | customer, status, salesPerson, customerOrderNumber                                                          |
| Create / update sales order | POST     | /SOSalesOrder[/{Reference}]                           | Customer, DeliveryDate, LineItems[]; `action=cancel\|putOnHold\|takeOffHold`                                |
| Packing slip                | GET      | /SOPackingSlip/{Reference}                            | overview's worked-example entity                                                                            |
| List / get jobs             | GET      | /JCJob[/{Code}]                                       | customer, jobManager, excludeClosed, includeSubJobs; Job Costing header                                     |
| Job timesheets / estimates  | GET/POST | /JCTimesheet, /JCEstimate                             | entity-specific                                                                                             |
| Approve / reject a record   | POST     | /{entity}/{ref}?action=approve\|reject\|clearApproval | Approval{ApprovedBy, Narration}; any approvable entity                                                      |
| Run a report to PDF         | POST     | /{entity}/{ref}?action=report                         | AHFormDefn{Name, Parameters[], Attachment{}}; 60s default, `timeout=n` to extend                            |
| Attachments                 | GET/POST | /{entity}/{ref}?action=attachment                     | includeAttachments=true (GET); download `name=`; upload multipart/form-data                                 |
| Health check                | GET      | /Ping                                                 | liveness check                                                                                              |

> Core verticals only. Full entity catalog (~120 entities) on MYOB's docs (`/api-documentation`) — check there + the customer's version before assuming an entity/modifier exists.

## Pagination

Page-number based — `page` (1-based) + `pageSize`, used together. List GETs cap at **100 records**; `pageSize` omitted → 100. No documented total count [UNVERIFIED]. Detect last page by a short/empty page.

```
GET /01/SOSalesOrder?status=Entered&page=1&pageSize=50    (records 1-50)
GET /01/SOSalesOrder?status=Entered&page=2&pageSize=50    (records 51-100)  → short page = last
```

Sorting (`sortBy1`/`sortDesc1`) is version-gated (2021+, per-entity) — don't rely on it for stable paging on older instances.

## Errors (recovery by status) [codes UNVERIFIED through the connector — parse defensively; body may be XML or JSON]

| Status  | Meaning                                       | Action                                                                                                     |
| ------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 200     | OK (GET / POST create / update / action)      | POST responses carry the saved record incl. any allocated identifier                                       |
| 401     | Auth failed (Greentree login OR site ApiKey)  | Surface BOTH: user reconnects login, OR admin re-saves the ApiKey. Do NOT blind-retry                      |
| 404     | Bad route / unknown entity / wrong identifier | Check company code, entity route token (`Customer` not `ARCustomer`), human-key identifier (not OidString) |
| 4xx     | Validation / business-rule rejection          | Read the body; fix the payload (missing required fields, bad references)                                   |
| 5xx     | Server fault (customer's Greentree service)   | Retry GETs with backoff (≤3); NEVER blind-retry writes — re-read first                                     |
| timeout | Slow report/posting outran the request        | Reports: raise `timeout=n`; writes: re-read before retrying (may have landed)                              |
| network | Instance unreachable / TLS / DNS              | Customer-hosted — server may be down or not internet-reachable; environment-side                           |

## Examples (adapted from MYOB docs; response shapes illustrative [UNVERIFIED]; company `01`)

1. List GL accounts, paged:
   `GET /01/GLAccount?page=1&pageSize=50&accountType=Income` → up to 50 Income accounts, each with `AccountNo`,`Description`,`AccountType`,`AccountSign`,`Status`,`IsPosting`. Page with `&page=2` until short.

2. Find a customer, then their open invoices:
   `GET /01/Customer/CUST1234`
   `GET /01/ARInvoice?customer=CUST1234&outstandingOnly=true&sortBy1=documentDate&sortDesc1=true&page=1&pageSize=25`

3. Create a customer, then update it:
   `POST /01/Customer` body `{"Name":"New Trade Customer","Status":"Active","Address":{"Address1":"1 Queen St","Suburb":"Auckland","Email":"ap@example.com"}}` → Greentree allocates `Code`; capture it. Then update by POSTing to the identifier route:
   `POST /01/Customer/CUST1235` body `{"CreditLimit":10000}` → partial body; only sent fields change [UNVERIFIED merge semantics].
