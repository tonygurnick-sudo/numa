---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com
route_prefix_injected_by_connector: /api/partner
path_version_segment: none ("v1" is a label, never a path segment; /v1/... → 404)
auth: Bearer {token}
field_casing: camelCase
id_format: integer
call_surface: HTTP via `numa integrations request` (NOT a file-store connector)
companions: 01=api-rules, 01a=domain-model, 01c=mutation-patterns, 01d=events+errors
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Fergus — Query Patterns

All read operations: filtering, searching, sorting, pagination, recipes. Paths are FLAT (`/jobs`); connector injects `/api/partner`.

## Query Capabilities

| Capability              | Supported | Syntax                                                   | Notes                                 |
| ----------------------- | --------- | -------------------------------------------------------- | ------------------------------------- |
| Filter by field         | Yes       | `?filterFieldName=value`                                 | prefix `filter` on param name         |
| Filter by date range    | Yes       | `?filterDateFrom=YYYY-MM-DD&filterDateTo=YYYY-MM-DD`     | time entries, stock, invoices         |
| Full-text search        | Yes       | `?filterSearchText=term`                                 | substring across multiple fields      |
| Sort by field           | Yes       | `?sortField=fieldName`                                   | allowed fields vary per endpoint      |
| Sort direction          | Yes       | `?sortOrder=asc\|desc`                                   | default `asc`                         |
| Field selection         | No        | —                                                        |                                       |
| Include related records | No        | —                                                        | embedded or separate call             |
| Aggregation / count     | No        | —                                                        | only `paging.pageCount`               |
| Logical AND/OR          | AND only  | multiple `filter*` params                                | all combined with implicit AND; no OR |
| Comparison operators    | Limited   | `dueBefore`, `dueAfter`, `createdAfter`, `modifiedAfter` | specific endpoints only               |
| Null checks             | No        | —                                                        |                                       |

## Pattern 1: List & Filter

`GET /{resource}?filterFieldName=value&filterOtherField=value2&pageSize=20&sortField=createdAt&sortOrder=desc`
All filter params prefixed `filter` (`filterJobStatus`, `filterCustomerId`, `filterSearchText`). Exception: date filters `dueBefore`, `dueAfter`, `createdAfter`, `modifiedAfter` are unprefixed. Multiple filters combine with implicit AND. No nesting, no OR (use multiple requests).

## Pattern 2: Search

`GET /{resource}?filterSearchText=search+term` — per-resource (no global search endpoint), exact substring only (no fuzzy), sorted by `sortField` (not relevance). Min query length not documented.
Searchable fields per endpoint:

- `/jobs`: description, longDescription, jobNo, customer name, site name/address
- `/customers`: customerFullName, contact names, email, phone
- `/sites`: name, contact names, customer name, billing contact
- `/users`: firstName, lastName, email
- `/timeEntries`: user, username, jobPhaseTitle, jobPhaseDetails
- `/enquiries`, `/contacts`: via filterSearchText

Pricebook search (special): `POST /pricebooks/search` with body `{"search":"copper pipe","pricingTierId":1,"allSuppliers":true}`. Min 3 chars. Searches name, productCode, searchValues, supplierSku. Filter by supplier IDs when `allSuppliers:false`.

## Pattern 3: Get by ID

`GET /{resource}/{id}` → `{"result":"success","data":{...single object...}}`. No `?include=`/`?expand=`; related data embedded or via separate call. HATEOAS `links` array in every response, e.g. `[{"href":"/customers/9778208","rel":"self","type":"GET"},{"href":"/jobs/20909314","rel":"edit","type":"PUT"}]`.

## Pattern 4: Get Related Records

Sub-resource: `GET /jobs/{jobId}/quotes?pageSize=20`, `GET /jobs/{jobId}/phases`. Use `/jobs/{jobId}/quotes` or `/jobs/quotes` — standalone `/quotes` is 404.
Filter by parent: `GET /customerInvoices?jobId=20909314` · `?customerId=9778208` · `GET /contacts?filterCustomerId=9778208` · `?filterSiteId=8169663` · `GET /notes?filterEntityName=JOB&filterEntityId=20909314` · `GET /calendarEvents?filterJobId=20909314` · `GET /timeEntries?filterJobNo=42`.

## Pattern 5: Date Range Query

- Time entries: `GET /timeEntries?filterDateFrom=2025-01-01&filterDateTo=2025-01-31`
- Invoices: `GET /customerInvoices?dueAfter=2025-01-01&dueBefore=2025-03-31`
- Quotes (modified since): `GET /jobs/quotes?modifiedAfter=2025-03-29T00:00:00Z&sortField=lastModified`
- Calendar: `GET /calendarEvents?filterDateFrom=2025-03-30T00:00:00.000+13:00&filterCalendarRange=WEEK`

Date format `YYYY-MM-DD`; ISO 8601 for datetimes; calendar events accept timezone offsets. `filterCalendarRange` ∈ DAY/THREE_DAY/WEEK/FORTNIGHT/MONTH — sets the window from `filterDateFrom`.

## Pattern 6: Sorting

`GET /jobs?sortField=lastModified&sortOrder=desc`

| Endpoint          | Sort Fields                          | Default         |
| ----------------- | ------------------------------------ | --------------- |
| /jobs             | `jobNo`, `createdAt`, `lastModified` | `createdAt`     |
| /customers        | `name`, `createdAt`                  | `createdAt`     |
| /sites            | `name`, `createdAt`                  | `createdAt`     |
| /jobs/quotes      | `id`, `createdAt`, `lastModified`    | `createdAt`     |
| /timeEntries      | `timeEntryDate`, `jobNo`, `user`     | `timeEntryDate` |
| /customerInvoices | `id`, `createdAt`, `dueDate`         | `createdAt`     |
| /users            | varies                               | varies          |
| /notes            | **`created_at`** (snake_case!)       | `created_at`    |
| /enquiries        | varies                               | varies          |

`/notes` uses `sortField=created_at` (snake_case), NOT `createdAt`. Only known endpoint with this exception.

## Pagination

- Type: cursor-based, integer offset, 0-based. Default page size 10 (varies by endpoint, overrideable). Max not documented (use 20-50). Total via `paging.pageCount` (total pages).

| Param      | Type    | Default | Description             |
| ---------- | ------- | ------- | ----------------------- |
| pageSize   | number  | 10      | items per page          |
| pageCursor | integer | 0       | offset cursor (0-based) |
| sortOrder  | string  | "asc"   | asc or desc             |
| sortField  | string  | varies  | field to sort by        |

Response: `{"result":"success","data":[...],"paging":{"perPage":20,"pageCount":5,"links":{"self":"/jobs?pageCursor=0&pageSize=20&sortField=createdAt&sortOrder=desc","previous":null,"next":"/jobs?pageCursor=20&pageSize=20&sortField=createdAt&sortOrder=desc"}}}`
Last page when `paging.links.next == null` (null, not absent), OR `data` empty, OR current page == `pageCount`.
Loop: `GET /jobs?pageSize=20&pageCursor=0&...` → take `links.next` (carries all current params; follow directly) → repeat until `next == null`.
Special — Calendar events: NO standard pagination. Date-range model (`filterDateFrom` + `filterCalendarRange`); no `pageCursor`/`paging` in response.
Special — Stock used: max 180-day lookback from now; `filterDateFrom` defaults to 90 days ago, max 180.

## Worked Examples

### Ex1: Active jobs for a customer (most recent first)

`GET /jobs?filterCustomerId=9778208&filterJobStatus=Active&sortField=lastModified&sortOrder=desc&pageSize=20`
→ `{"result":"success","data":[{"id":20909314,"jobNo":"J-0042","description":"Kitchen renovation","jobType":"Quote","status":"Active","customer":{"id":9778208,"customerFullName":"Smith Plumbing Ltd"},"siteAddress":{"id":8169663,"name":"Main Office","address1":"123 Queen St"},"onHold":false,"archived":false,"links":[{"href":"/jobs/20909314","rel":"self","type":"GET"}]}],"paging":{"perPage":20,"pageCount":1,"links":{"self":"...","previous":null,"next":null}}}`
Filters combine with AND. Customer embedded in job. `onHold`/`archived` hidden unless `filterShowOnHold`/`filterShowArchived` set. HATEOAS links in every resource.

### Ex2: Search customers by name

`GET /customers?filterSearchText=Smith&sortField=name&sortOrder=asc&pageSize=20`
→ `{"result":"success","data":[{"id":9778208,"customerFullName":"Smith Plumbing Ltd","mainContact":{"id":50,"firstName":"Jane","lastName":"Smith"},"physicalAddress":{"address1":"123 Queen St","addressCity":"Auckland"},"links":[{"href":"/customers/9778208","rel":"self","type":"GET"}]}],"paging":{"perPage":20,"pageCount":1,"links":{"self":"...","previous":null,"next":null}}}`
Searches customerFullName, mainContact firstName/lastName, contact email/phone. Substring: "Smith" matches "Smithson", "Blacksmith".

### Ex3: Time entries for a user in a date range

`GET /timeEntries?filterUserId=173187&filterDateFrom=2025-03-24&filterDateTo=2025-03-30&sortField=timeEntryDate&sortOrder=desc`
→ `{"result":"success","data":[{"timeEntryId":300,"userId":173187,"user":"Mike Johnson","dateEntered":"2025-03-28","startTime":"2025-03-28 07:00","endTime":"2025-03-28 15:30","paidDuration":8.0,"payRate":35.0,"chargeOutRate":85.0,"workDescription":"Pipe installation","jobNo":"J-0042","jobId":20909314,"isLocked":false}],"paging":{"perPage":10,"pageCount":1,"links":{"self":"...","previous":null,"next":null}}}`
Filter dates `YYYY-MM-DD`; time entry times non-ISO `YYYY-MM-DD HH:MM`; duration decimal hours.

### Ex4: Overdue invoices (due before today)

`GET /customerInvoices?dueBefore=2025-03-30&sortField=dueDate&sortOrder=asc&pageSize=50`
→ `{"result":"success","data":[{"id":800,"jobId":20909314,"customerId":9778208,"invoiceNumber":"INV-001","title":"Kitchen Renovation - Progress Invoice","subtotal":2500.0,"taxValue":375.0,"taxRate":15.0,"dueDate":"2025-03-15","paidAt":null,"status":"overdue","isSent":true,"isFinal":true}],"paging":{"perPage":50,"pageCount":1,"links":{"self":"...","previous":null,"next":null}}}`

## Gotchas

1. Calendar events not paginated — date-range model only (`filterDateFrom` + `filterCalendarRange`); cannot page through all events.
2. Stock used: 180-day lookback limit; `filterDateFrom` default 90 days ago.
3. `modifiedAfter`/`createdAfter` on `/jobs/quotes` OVERRIDE `sortField`/`sortOrder`.
4. Search is substring, not word-boundary: `filterSearchText=art` matches "cart", "article", "Martin". No exact/word-boundary mode.
5. List endpoints may omit fields present in get-by-ID. Use `GET /{resource}/{id}` for complete data.
6. Enquiry list returns EnquiryWithJobIds (enriched with associated job IDs not on the create response).
7. `/quotes` standalone → 404. Use `/jobs/quotes` (cross-job) or `/jobs/{jobId}/quotes` (job-scoped).
8. `/stockOnHand` standalone → 404. Use `/phases/{jobPhaseId}/stockOnHand`.
9. Notes sort field is snake_case `created_at`, not `createdAt`. Only known exception.
10. Pagination `links.next` is `null` (not absent) on last page.
