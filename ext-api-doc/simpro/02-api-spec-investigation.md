---
api_name: simPRO
api_slug: simpro
doc: api spec & investigation (developer reference)
base_url: https://{build}.simprosuite.com/api/v1.0/ (per-tenant subdomain; /api/v1.0 is a REAL path segment, not a label)
api_version: v1.0 (label; the version also appears literally in the path as /api/v1.0)
auth: OAuth 2.0 Bearer (or Direct Access API key)
field_casing: PascalCase
id_format: integer
spec_format: none publicly available (OpenAPI not published; probes return 403/404)
docs_url: https://developer.simprogroup.com/apidoc/
date_researched: 2026-03-30
confidence: confirmed via official PHP SDK + SyncHub data model + forum payloads unless tagged [DOCUMENTED]/[UNKNOWN]/[VERIFIED <date>]
---

# simPRO — API Spec & Investigation

## Overview

- Vendor: Simpro Group (formerly simPRO Software). Cloud field-service-management for trades (electrical, plumbing, HVAC, construction). Each customer = isolated tenant with own subdomain.
- API: REST, JSON. Version v1.0. Base URL `https://{build}.simprosuite.com/api/v1.0/`. No sandbox.
- Surface: CRUD over jobs, quotes, leads, customers, schedules, invoices, catalogs + 100+ entities.
- Links: docs developer.simprogroup.com/apidoc/ · dev center developer.simprogroup.com · code examples developer.simprogroup.com/code-examples/ · forum apiforum.simprogroup.com · status status.simprogroup.com · data model synchub.io/connectors/simpro/datamodel (100+ entities). OpenAPI spec NOT public.

## Authentication — OAuth 2.0

API apps created in simPRO: System > Setup > API > Applications. Two access types: **Direct Access** (unfettered, not user-tied) and **User Token Access** (scoped to user permissions).
Header: `Authorization: Bearer {access_token}` + `Content-Type: application/json`.

| Param                          | Value                                                                                                                      | Source                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Grant types                    | authorization_code, client_credentials, resource_owner (**deprecated**), implicit (**deprecated by OAuth 2.1 / RFC 9700**) | PHP SDK                                  |
| Authorization URL              | `https://{build}.simprosuite.com/oauth2/login?client_id={CLIENT_ID}`                                                       | [VERIFIED 2026-05-19 — Provider.php:230] |
| Token URL                      | `https://{build}.simprosuite.com/oauth2/token`                                                                             | [VERIFIED 2026-05-19 — Provider.php:225] |
| ~~Centralized URL~~            | ~~`https://auth.simpro.co/...`~~ — does NOT exist (NXDOMAIN, removed 2026-05-19). Only per-build URLs work.                | DNS, no A record                         |
| Access token lifetime          | 3600s (1 hour)                                                                                                             | forum                                    |
| Refresh token lifetime         | 14 days, single-use (invalidated after use)                                                                                | forum                                    |
| Refresh mechanism              | `grant_type=refresh_token` + client_id, client_secret, refresh_token                                                       |                                          |
| Revocation URL / PKCE / Scopes | [UNKNOWN] (scopes exist but not publicly enumerated)                                                                       |                                          |

API Key auth (alternative): obtain via System > Setup > API > Applications. SDK: `withBuildURL($buildURL)->withToken($token)`.

Authorization Code flow:

```
1. Redirect: https://{build}.simprosuite.com/oauth2/login?client_id={CID}&redirect_uri={URI}&response_type=code&state={STATE}
2. User authorizes → {URI}?code={AUTH_CODE}&state={STATE}   (error: ?error={e}&error_description={msg})
3. POST https://{build}.simprosuite.com/oauth2/token  (Content-Type: application/x-www-form-urlencoded)
   grant_type=authorization_code&client_id={CID}&client_secret={SECRET}&code={AUTH_CODE}&redirect_uri={URI}
4. Response: {"access_token":"...","refresh_token":"...","expires_in":3600}
5. Use: Authorization: Bearer {access_token}
```

## Endpoint catalog

All resource paths scoped under `/companies/{cid}/` except `/companies/` and `/webhooks/`. Auth required on all.

Companies: `GET /companies/` — list companies on the build; returns `{ID,Name}[]`; use to discover companyID (do NOT hardcode 0).

Jobs:
| Method | Path | Idempotent |
| --- | --- | --- |
| GET | /companies/{cid}/jobs/ | yes (paginated) |
| GET | /companies/{cid}/jobs/{id} | yes |
| POST | /companies/{cid}/jobs/ | no |
| PATCH | /companies/{cid}/jobs/{id} | yes (partial) |
| PUT | /companies/{cid}/jobs/{id} | yes (full) |
| DELETE | /companies/{cid}/jobs/{id} | yes |

Quotes: GET `/companies/{cid}/quotes/` (paginated), GET `/quotes/{id}`, POST `/quotes/` (non-idempotent), PATCH `/quotes/{id}`.
Leads: GET `/companies/{cid}/leads/` (paginated), POST `/leads/`, PATCH `/leads/{id}`.
Customers (company): GET `/companies/{cid}/customers/companies/` + `/{id}`, POST, PATCH `/{id}`.
Customers (individual): GET `/companies/{cid}/customers/individuals/` + (POST), PATCH `/{id}`.
Other core (GET, paginated): `/companies/{cid}/` + `contacts/`, `sites/`, `employees/` (+ `employees/{id}` detail), `contractors/`, `catalogs/`, `vendors/`, `schedules/`, `customerInvoices/`, `purchaseOrders/`, `vendorOrders/`, `assets/`, `accounts/payable/invoices/`.
Sub-resources (GET/POST): `/companies/{cid}/jobs/{jid}/sections/` → `.../{sid}/costCenters/` → `.../{ccid}/schedules/` | `.../labor/` | `.../catalogs/`.
Webhooks: GET `/webhooks/` (list), POST `/webhooks/` (create), DELETE `/webhooks/{id}`.

Full entity index (100+, SyncHub-confirmed):

- Core: Activity, Asset, AssetType, Catalog, CatalogGroup, ChartOfAccounts, Company, Contact, ContactLog, Contractor, CostCenter, CreditNote, CustomField, Zone
- Customers: CompanyCustomer, IndividualCustomer, CustomerPayment, CustomerTag
- Jobs: Job, JobSection, JobSectionCostCenter, JobCard, JobLog, JobAttachmentFile/Folder
- Quotes: Quote, QuoteSection, QuoteSectionCostCenter, QuoteLog, QuoteAttachmentFile/Folder
- Leads: Lead
- Financials: Invoice, CreditNote, RecurringInvoice, InvoiceLog
- Procurement: PurchaseOrder, PurchaseOrderReceipt(+Catalog/Credit), Vendor
- Contractors: ContractorJob, ContractorInvoice, ContractorTimesheet
- Employees: Employee, EmployeeLicence
- Scheduling: Schedule, ActivitySchedule, MobileStatusLog
- Pricing: LaborRate, PlantAndEquipment, PlantType, TaxCode, PreBuildGroup
- Commissions: BasicCommission, AdvancedCommission · Recurring: CompanyRecurringJob
- Status codes: ProjectStatusCode, CustomerInvoiceStatusCode, PurchaseOrderStatusCode

## Data models (SyncHub-confirmed; full field lists in 01a)

Job: ID(int,ro) · Name · Description · Type(req, `Service`/`Project`/`Prepaid`) · CompanyCustomerID/IndividualCustomerID(conditional FK) · SiteID(req FK) · CustomerContactID/SiteContactID(FK) · OrderNo · Notes · DateIssued · DueDate · DueTime · Stage(ro: Pending/Progress/Complete/Invoiced/Archived) · StatusID(FK ProjectStatusCode) · SalesPersonEmployeeID/ProjectManagerEmployeeID(FK) · AutoAdjustStatus · IsVariation · CompletedDate(ro) · Totals(decimals, ro, computed).
Customer (Company): ID(ro) · CompanyName(req) · EIN · Website · Address/BillingAddress/Banking fields.
Customer (Individual): ID(ro) · Title · GivenName(req) · FamilyName(req) · CellPhone · Email · Phone.
Employee: ID(ro) · Name(req) · Position · DateOfHire · Contact fields.
Invoice: ID(ro) · Description · DateIssued · Type(ro) · Stage(ro) · StatusID(FK) · ExTax(ro) · IncTax(ro) · BalanceDue(ro) · IsPaid(ro).

## Query parameters

| Param       | Type   | Default | Description                                                          |
| ----------- | ------ | ------- | -------------------------------------------------------------------- |
| page        | int    | 1       | page number (1-indexed)                                              |
| pageSize    | int    | 30      | records/page (1–250)                                                 |
| columns     | string | default | comma-separated field names                                          |
| orderby     | string | default | sort field(s), `-` prefix = desc                                     |
| {FieldName} | string | -       | filter; supports `gt() lt() ge() le() ne() between()` + `%` wildcard |

Header filter: `If-Modified-Since: YYYY-MM-ddTHH:mm:ss` → return only modified records.

## Pagination

Page-number based. Default 30, max 250. Total count via `Result-Total` header. Body = bare JSON array.

```
HTTP/1.1 200 OK
Result-Total: 816
Result-Pages: 28
Result-Count: 30
Link: <...?page=2>; rel="next", <...?page=28>; rel="last", <...?page=1>; rel="first"

[{"ID":1,"Type":"Service",...},{"ID":2,"Type":"Project",...}]
```

Last page: no `rel="next"` in `Link`, or `page >= Result-Pages`.

## Rate limits

| Scope                     | Limit       | Window   | Source                           |
| ------------------------- | ----------- | -------- | -------------------------------- |
| Per-build (all consumers) | 10 requests | 1 second | strictly enforced since Aug 2022 |
| Per-build (daily)         | [UNKNOWN]   | 24h      | exists but unpublished           |

No rate-limit headers. Exceeded → 429. Strategy: 80% threshold (8 req/sec); exponential backoff on 429 (per Laravel pkg).

## Error handling

`{"status":"error","url":"https://build.simprosuite.com/api/v1.0/...","header":{},"data":{"errors":[{"path":null,"message":"Invalid route.","value":null}]}}`
| Status | Retryable | Recovery |
| --- | --- | --- |
| 200 | - | - |
| 204 (PATCH) | - | verify with GET (may be silent rejection) |
| 400 | no | fix per `data.errors` |
| 401 | yes | refresh token |
| 403 | no | check access type |
| 404 | no | verify ID + companyID |
| 429 | yes | wait ≥1s, retry |
| 500 | yes | retry; check column/filter conflicts |

## Webhooks / events

Register: `POST /api/v1.0/webhooks/` body `{"url":"...","events":[...]}`. 22 events:
| Event | Trigger |
| --- | --- |
| job.created / updated / status | job lifecycle |
| job.stage.pending / progress / complete / invoiced / archived | job stage transitions |
| quote.created / updated / status | quote lifecycle |
| lead.created / updated / status | lead lifecycle |
| contact.created / updated | contact changes |
| company.customer.created / updated | company customer changes |
| individual.customer.updated | individual customer changes |
| job.schedule.created / updated | job scheduling |
| quote.schedule.created / updated | quote scheduling |

Payload: `{"ID":"job.status","build":"{build}","name":"Job","action":"status","reference":{"companyID":0,"jobID":300555,"statusID":10},"date_triggered":"2023-01-31T09:05:27+00:00","description":"Status of Job #300555 set to \"Job : In Progress\""}`
Verification: no signature mechanism. Retry policy: [UNKNOWN].

## SDKs & tooling

| SDK                | Lang        | Repo                                          | Quality | Notes                                                        |
| ------------------ | ----------- | --------------------------------------------- | ------- | ------------------------------------------------------------ |
| simpro-restapi-php | PHP         | github.com/simPRO-Software/simpro-restapi-php | good    | Official; OAuth2 + CRUD; code analyzed                       |
| simpro-api-php     | PHP         | github.com/simPRO-Software/simpro-api-php     | fair    | Official; older examples                                     |
| laravel-simpro-api | PHP/Laravel | github.com/stitch-digital/laravel-simpro-api  | good    | Community; Saloon-based; pagination + rate limiting built in |
| SimproAPI          | Python      | pypi.org/project/SimproAPI/                   | poor    | Community; limited to Plants & Equipment                     |
| simpropy           | Python      | pypi.org/project/simpropy/                    | fair    | Community; basic wrapper                                     |

Postman: postman.com/ishara-rajapakshe/simpro/overview · postman.com/prevalentware/simpro/ · postman.com/cryosat-cosmologist-3801651/workspace/simpro-api-wp/. OpenAPI spec: not public.

## Integration path

Recommended: **Hybrid (Data Connector + Direct API)**. simPRO offers browsable structured content (jobs, quotes, customers, schedules, invoices) for a data connector AND action capabilities (create jobs, update statuses, manage schedules) for direct API. Webhooks enable real-time event-driven sync.
Connector method → endpoint mapping: list_files → `GET /companies/{cid}/jobs/` (paginated list w/ field selection + filters) · download_file → `GET /companies/{cid}/jobs/{id}` (single record) · search_files → `GET /companies/{cid}/jobs/?FieldName=value` (filters/operators/wildcards) · get_file_metadata → `GET /companies/{cid}/jobs/{id}?columns=ID,Status` (minimal fields). All feasibility: good.

_Researched 2026-03-30. Sources: official PHP SDK (code analyzed), SyncHub data model (100+ entities), forum posts (actual payloads), Rollout guides, Laravel community package, simPRO Help FAQ._
