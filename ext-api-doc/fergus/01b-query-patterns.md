---
api_name: 'Fergus'
api_slug: 'fergus'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
updated_date: '2026-04-04'
update_source: 'live API testing'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Fergus -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all read operation patterns including
> filtering, searching, sorting, pagination, and common query recipes.
> **Updated 2026-04-04 with corrections from live API testing.**

---

## Query Capabilities Summary

| Capability                 | Supported    | Syntax                                                   | Notes                                     |
| -------------------------- | ------------ | -------------------------------------------------------- | ----------------------------------------- |
| Filter by field value      | Yes          | `?filterFieldName=value`                                 | Prefix `filter` on param name [CONFIRMED] |
| Filter by date range       | Yes          | `?filterDateFrom=YYYY-MM-DD&filterDateTo=YYYY-MM-DD`     | Time entries, stock, invoices             |
| Full-text search           | Yes          | `?filterSearchText=term`                                 | Substring match across multiple fields    |
| Sort by field              | Yes          | `?sortField=fieldName`                                   | Allowed fields vary per endpoint          |
| Sort direction             | Yes          | `?sortOrder=asc` or `desc`                               | Default: `asc`                            |
| Field selection            | No           | --                                                       | Not supported                             |
| Include related records    | No           | --                                                       | Related data embedded or separate call    |
| Aggregation / count        | No           | --                                                       | Only `paging.pageCount` available         |
| Logical operators (AND/OR) | Implicit AND | Multiple `filter*` params                                | All combined with AND                     |
| Comparison operators       | Limited      | `dueBefore`, `dueAfter`, `createdAfter`, `modifiedAfter` | Only on specific endpoints                |
| Null checks                | No           | --                                                       | Not supported                             |

---

## Common Patterns

### Pattern 1: List & Filter

> Get a filtered list of resources.

**Syntax:**

```http
GET /{resource}?filterFieldName=value&filterOtherField=value2&pageSize=20&sortField=createdAt&sortOrder=desc
Host: api.fergus.com
Authorization: Bearer {token}
```

**Filter naming convention:** All filter parameters are prefixed with `filter` (e.g., `filterJobStatus`, `filterCustomerId`, `filterSearchText`). Exception: some date filters use unprefixed names (`dueBefore`, `dueAfter`, `createdAfter`, `modifiedAfter`).

**Combining filters:**

- Multiple filters are combined with: implicit AND
- Nesting: not supported
- No OR operator -- use multiple requests if needed

---

### Pattern 2: Search

> Substring text search within a resource.

**Per-resource search:**

```http
GET /{resource}?filterSearchText=search+term
Host: api.fergus.com
Authorization: Bearer {token}
```

- **No global search endpoint** -- search is per-resource
- **Searchable fields vary by endpoint:**
  - `/jobs`: description, longDescription, jobNo, customer name, site name/address
  - `/customers`: customerFullName, contact names, email, phone
  - `/sites`: name, contact names, customer name, billing contact
  - `/users`: firstName, lastName, email
  - `/timeEntries`: user, username, jobPhaseTitle, jobPhaseDetails
  - `/enquiries`: (via filterSearchText)
  - `/contacts`: (via filterSearchText)
- **Fuzzy matching:** No -- exact substring only
- **Minimum query length:** Not documented
- **Result ranking:** Results are sorted by the specified `sortField`, not by relevance

**Pricebook search (special):**

```http
POST /pricebooks/search
Host: api.fergus.com
Authorization: Bearer {token}
Content-Type: application/json

{
  "search": "copper pipe",
  "pricingTierId": 1,
  "allSuppliers": true
}
```

- Minimum 3 characters for search term
- Searches across: name, productCode, searchValues, supplierSku
- Can filter by specific supplier IDs when `allSuppliers` is false

---

### Pattern 3: Get by ID

> Retrieve a single resource by its identifier.

```http
GET /{resource}/{id}
Host: api.fergus.com
Authorization: Bearer {token}
```

Response wrapper: [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": { ... single resource object ... }
}
```

No `?include=` or `?expand=` support. Related data is either embedded in the response or requires a separate call.

**HATEOAS links in every response:** [CONFIRMED -- live API test 2026-04-04]

```json
"links": [
  {"href": "/customers/9778208", "rel": "self", "type": "GET"},
  {"href": "/jobs/20909314", "rel": "edit", "type": "PUT"}
]
```

---

### Pattern 4: Get Related Records

> Fetch child or associated records.

**Sub-resource pattern (quotes, phases):**

```http
GET /jobs/{jobId}/quotes?pageSize=20
GET /jobs/{jobId}/phases
```

**NOTE:** Use `/jobs/{jobId}/quotes` or `/jobs/quotes`. The standalone `/quotes` endpoint does NOT exist (404). [CONFIRMED -- live API test 2026-04-04]

**Filter by parent (alternative):**

```http
GET /customerInvoices?jobId=20909314
GET /customerInvoices?customerId=9778208
GET /contacts?filterCustomerId=9778208
GET /contacts?filterSiteId=8169663
GET /notes?filterEntityName=JOB&filterEntityId=20909314
GET /calendarEvents?filterJobId=20909314
GET /timeEntries?filterJobNo=42
```

---

### Pattern 5: Date Range Query

**Time entries:**

```http
GET /timeEntries?filterDateFrom=2025-01-01&filterDateTo=2025-01-31
```

**Invoices:**

```http
GET /customerInvoices?dueAfter=2025-01-01&dueBefore=2025-03-31
```

**Quotes (modified since):**

```http
GET /jobs/quotes?modifiedAfter=2025-03-29T00:00:00Z&sortField=lastModified
```

**Calendar events:**

```http
GET /calendarEvents?filterDateFrom=2025-03-30T00:00:00.000+13:00&filterCalendarRange=WEEK
```

**Date format:** `YYYY-MM-DD` for dates, ISO 8601 for datetimes. Calendar events accept timezone offsets.

**Calendar range options:** `DAY`, `THREE_DAY`, `WEEK`, `FORTNIGHT`, `MONTH` -- sets the window from filterDateFrom.

---

### Pattern 6: Sorting

```http
GET /jobs?sortField=lastModified&sortOrder=desc
```

**Allowed sort fields per endpoint:**

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

**IMPORTANT:** `/notes` uses `sortField=created_at` (snake_case), NOT `createdAt`. This is the only known endpoint with this exception. [CONFIRMED -- live API test 2026-04-04]

---

## Pagination Handling [CONFIRMED -- live API test 2026-04-04]

### Model

- **Type:** Cursor-based (integer offset, 0-based)
- **Default page size:** 10 (varies by endpoint, overrideable)
- **Max page size:** Not documented (use 20-50 conservatively)
- **Total count available:** Yes -- `paging.pageCount` gives total number of pages

### Request Parameters

| Parameter  | Type    | Default | Description                     |
| ---------- | ------- | ------- | ------------------------------- |
| pageSize   | number  | 10      | Items per page                  |
| pageCursor | integer | 0       | Offset cursor (0-based integer) |
| sortOrder  | string  | "asc"   | asc or desc                     |
| sortField  | string  | varies  | Field to sort by                |

### Response Structure [CONFIRMED -- live API test 2026-04-04]

```json
{
  "result": "success",
  "data": [ ... array of resources ... ],
  "paging": {
    "perPage": 20,
    "pageCount": 5,
    "links": {
      "self": "/jobs?pageCursor=0&pageSize=20&sortField=createdAt&sortOrder=desc",
      "previous": null,
      "next": "/jobs?pageCursor=20&pageSize=20&sortField=createdAt&sortOrder=desc"
    }
  }
}
```

### Last Page Detection

- `paging.links.next` is `null` [CONFIRMED -- live API test 2026-04-04]
- OR `data` array is empty
- OR current page number equals `paging.pageCount`

### Full Pagination Loop

```
Request 1: GET /jobs?pageSize=20&pageCursor=0&sortField=createdAt&sortOrder=desc
Response 1: { "data": [...20 items...], "paging": {"perPage": 20, "pageCount": 5, "links": {"self": "...", "previous": null, "next": "/jobs?pageCursor=20&pageSize=20..."}} }

Request 2: GET /jobs?pageSize=20&pageCursor=20&sortField=createdAt&sortOrder=desc
Response 2: { "data": [...20 items...], "paging": {"links": {"self": "...", "previous": "...", "next": "/jobs?pageCursor=40&pageSize=20..."}} }

...

Last Page: GET /jobs?pageSize=20&pageCursor=80&sortField=createdAt&sortOrder=desc
Response:  { "data": [...remaining items...], "paging": {"links": {"self": "...", "previous": "...", "next": null}} }
           <- next is null means done
```

**Note:** The `links.next` URL includes all current query parameters. You can follow it directly.

### Special: Calendar Events

Calendar events do NOT use standard pagination. They use a date range model:

- `filterDateFrom` sets the start date
- `filterCalendarRange` sets the window (DAY/THREE_DAY/WEEK/FORTNIGHT/MONTH)
- No `pageCursor` or `paging` in response

### Special: Stock Used

Stock used has a max lookback of 180 days from current date:

- `filterDateFrom` defaults to 90 days ago
- Maximum is 180 days ago

---

## Worked Examples

### Example 1: Find all active jobs for a specific customer

> Retrieve active jobs for customer ID 9778208, most recent first.

```http
GET /jobs?filterCustomerId=9778208&filterJobStatus=Active&sortField=lastModified&sortOrder=desc&pageSize=20
Host: api.fergus.com
Authorization: Bearer {token}
```

```json
{
  "result": "success",
  "data": [
    {
      "id": 20909314,
      "jobNo": "J-0042",
      "description": "Kitchen renovation",
      "jobType": "Quote",
      "status": "Active",
      "customer": { "id": 9778208, "customerFullName": "Smith Plumbing Ltd" },
      "siteAddress": { "id": 8169663, "name": "Main Office", "address1": "123 Queen St" },
      "onHold": false,
      "archived": false,
      "links": [{ "href": "/jobs/20909314", "rel": "self", "type": "GET" }]
    }
  ],
  "paging": { "perPage": 20, "pageCount": 1, "links": { "self": "...", "previous": null, "next": null } }
}
```

**Key points:**

- All filter parameters combine with AND
- Customer object is embedded in job response
- `onHold` and `archived` default to hidden unless filterShowOnHold/filterShowArchived are set
- HATEOAS links included in every resource [CONFIRMED -- live API test 2026-04-04]

---

### Example 2: Search for a customer by name

> Find customers matching "Smith".

```http
GET /customers?filterSearchText=Smith&sortField=name&sortOrder=asc&pageSize=20
Host: api.fergus.com
Authorization: Bearer {token}
```

```json
{
  "result": "success",
  "data": [
    {
      "id": 9778208,
      "customerFullName": "Smith Plumbing Ltd",
      "mainContact": { "id": 50, "firstName": "Jane", "lastName": "Smith" },
      "physicalAddress": { "address1": "123 Queen St", "addressCity": "Auckland" },
      "links": [{ "href": "/customers/9778208", "rel": "self", "type": "GET" }]
    }
  ],
  "paging": { "perPage": 20, "pageCount": 1, "links": { "self": "...", "previous": null, "next": null } }
}
```

**Key points:**

- Searches across customerFullName, mainContact.firstName, mainContact.lastName, contact email/phone
- Substring matching: "Smith" matches "Smithson", "Blacksmith", etc.

---

### Example 3: Get time entries for a user in a date range

> Retrieve this week's time entries for user ID 173187.

```http
GET /timeEntries?filterUserId=173187&filterDateFrom=2025-03-24&filterDateTo=2025-03-30&sortField=timeEntryDate&sortOrder=desc
Host: api.fergus.com
Authorization: Bearer {token}
```

```json
{
  "result": "success",
  "data": [
    {
      "timeEntryId": 300,
      "userId": 173187,
      "user": "Mike Johnson",
      "dateEntered": "2025-03-28",
      "startTime": "2025-03-28 07:00",
      "endTime": "2025-03-28 15:30",
      "paidDuration": 8.0,
      "payRate": 35.0,
      "chargeOutRate": 85.0,
      "workDescription": "Pipe installation",
      "jobNo": "J-0042",
      "jobId": 20909314,
      "isLocked": false
    }
  ],
  "paging": { "perPage": 10, "pageCount": 1, "links": { "self": "...", "previous": null, "next": null } }
}
```

**Key points:**

- Date format for filters is YYYY-MM-DD
- Time entry times use non-ISO format: "YYYY-MM-DD HH:MM"
- Duration is in decimal hours

---

### Example 4: List overdue invoices

> Find invoices due before today that are not yet paid.

```http
GET /customerInvoices?dueBefore=2025-03-30&sortField=dueDate&sortOrder=asc&pageSize=50
Host: api.fergus.com
Authorization: Bearer {token}
```

```json
{
  "result": "success",
  "data": [
    {
      "id": 800,
      "jobId": 20909314,
      "customerId": 9778208,
      "invoiceNumber": "INV-001",
      "title": "Kitchen Renovation - Progress Invoice",
      "subtotal": 2500.0,
      "taxValue": 375.0,
      "taxRate": 15.0,
      "dueDate": "2025-03-15",
      "paidAt": null,
      "status": "overdue",
      "isSent": true,
      "isFinal": true
    }
  ],
  "paging": { "perPage": 50, "pageCount": 1, "links": { "self": "...", "previous": null, "next": null } }
}
```

---

## Gotchas & Counter-Exceptions

1. **Calendar events are not paginated:** They use a date-range model instead of cursor pagination. You cannot page through all events -- you must specify a date window using `filterDateFrom` and `filterCalendarRange`.

2. **Stock used has a 180-day lookback limit:** `filterDateFrom` cannot go further back than 180 days. Default is 90 days ago.

3. **The `modifiedAfter` and `createdAfter` filters on /jobs/quotes override sort:** When these are provided, they override the `sortField` and `sortOrder` parameters.

4. **Search is substring, not word-boundary:** `filterSearchText=art` will match "cart", "article", "Martin". There is no way to do exact-match or word-boundary search.

5. **Some list endpoints do not return full objects:** List responses may omit fields that are present in the get-by-ID response. Always use `GET /{resource}/{id}` when you need complete data.

6. **Enquiry list returns EnquiryWithJobIds:** The list endpoint returns enriched enquiry objects that include associated job IDs, which are not present on the create response.

7. **`/quotes` standalone endpoint does NOT exist.** Returns 404. Use `/jobs/quotes` for cross-job listing or `/jobs/{jobId}/quotes` for job-scoped. [CONFIRMED -- live API test 2026-04-04]

8. **`/stockOnHand` standalone endpoint does NOT exist.** Returns 404. Use `/phases/{jobPhaseId}/stockOnHand`. [CONFIRMED -- live API test 2026-04-04]

9. **Notes sort field is snake_case.** `sortField=created_at`, not `createdAt`. Only known exception. [CONFIRMED -- live API test 2026-04-04]

10. **Pagination `links.next` is `null` (not absent) on last page.** [CONFIRMED -- live API test 2026-04-04]

---

_Generated from the investigation questionnaire, Phases 5-6. Updated 2026-04-04 with live API test corrections._
