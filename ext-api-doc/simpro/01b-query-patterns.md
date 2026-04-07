---
api_name: 'simPRO'
api_slug: 'simpro'
generated_from: '00-api-investigation'
generated_date: '2026-03-30'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# simPRO -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all read operation patterns including
> filtering, searching, sorting, pagination, and bulk reads.

---

## Query Capabilities Summary

| Capability              | Supported        | Syntax                                                         | Notes                                 |
| ----------------------- | ---------------- | -------------------------------------------------------------- | ------------------------------------- |
| Filter by field value   | Yes              | `?FieldName=value`                                             | [CONFIRMED -- forum]                  |
| Wildcard search         | Yes              | `%` in value: `?GivenName=Rose%`                               | [CONFIRMED -- forum]                  |
| Comparison operators    | Yes              | `gt()`, `lt()`, `ge()`, `le()`, `ne()`, `between()`            | [CONFIRMED -- forum]                  |
| Filter by date range    | Yes              | `If-Modified-Since` header OR `?DateIssued=between(start,end)` | [DOCUMENTED]                          |
| Nested field filter     | Yes              | Dot notation: `?CustomFields.CustomField.ID=35`                | [CONFIRMED -- forum]                  |
| Full-text search        | No               | N/A                                                            | No search endpoint exists [CONFIRMED] |
| Sort by field           | Yes              | `?orderby=FieldName`                                           | [DOCUMENTED]                          |
| Sort direction          | Yes              | `?orderby=-FieldName` (prefix `-`)                             | [DOCUMENTED]                          |
| Multi-sort              | Yes              | `?orderby=Field1,Field2`                                       | [DOCUMENTED]                          |
| Field selection         | Yes              | `?columns=Field1,Field2`                                       | [DOCUMENTED]                          |
| Include related records | Partial          | `?columns=CustomFields`                                        | [DOCUMENTED]                          |
| Aggregation / count     | No (header only) | `Result-Total` response header                                 | [DOCUMENTED]                          |
| Logical operators (AND) | Yes              | Multiple params are AND-combined                               | [CONFIRMED -- forum]                  |
| Logical operators (OR)  | No               | Not supported                                                  | [CONFIRMED]                           |

---

## Filter Syntax

### Field Value Filters [CONFIRMED -- forum]

```
?GivenName=Rose%                 -- wildcard match (% = any characters)
?FamilyName=Smith                -- exact match
?CompanyName=Acme%               -- wildcard on company name
?GivenName=Rose%&FamilyName=A%   -- AND-combined filters
```

### Comparison Operators [CONFIRMED -- forum]

| Operator          | Syntax         | Example                                      | Description        |
| ----------------- | -------------- | -------------------------------------------- | ------------------ |
| Greater than      | `gt(value)`    | `?ID=gt(4)`                                  | ID greater than 4  |
| Less than         | `lt(value)`    | `?DateIssued=lt(2026-01-01)`                 | Before date        |
| Greater or equal  | `ge(value)`    | `?DateIssued=ge(2026-01-01)`                 | On or after date   |
| Less or equal     | `le(value)`    | `?DateIssued=le(2026-12-31)`                 | On or before date  |
| Not equal         | `ne(value)`    | `?Status.Name=ne(Archived)`                  | Exclude value      |
| Not equal (empty) | `ne()`         | `?Email=ne()`                                | Field is not empty |
| Between           | `between(a,b)` | `?DateIssued=between(2026-01-01,2026-06-30)` | Range inclusive    |

### Nested Field Filters [CONFIRMED -- forum]

```
?CustomFields.CustomField.ID=35&CustomFields.Value=Yes
```

### Date Filtering via Header [DOCUMENTED]

```
If-Modified-Since: 2026-03-01T00:00:00
```

Returns only records modified since the specified datetime.

### Gotchas

- **ID column is not searchable on some endpoints.** Including ID in a filter may cause failure. [CONFIRMED -- forum]
- **Use `CompanyName` for company customers**, not `Name`. [CONFIRMED -- forum]
- **Combining `If-Modified-Since` + `orderby=DateModified` + certain columns (e.g., `AssignedTo`) causes HTTP 500.** [DOCUMENTED -- forum]

---

## Common Patterns

### Pattern 1: List & Filter

> Get a paginated list of resources with field selection and sorting.

```http
GET /api/v1.0/companies/{companyID}/{resource}/?columns={col1},{col2}&orderby={field}&pageSize={size}&page={num}
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

**Available query parameters (all optional):**

| Parameter   | Type    | Default     | Description                                                |
| ----------- | ------- | ----------- | ---------------------------------------------------------- |
| page        | integer | 1           | Page number (1-indexed) [DOCUMENTED]                       |
| pageSize    | integer | 30          | Records per page (1-250) [DOCUMENTED]                      |
| columns     | string  | default set | Comma-separated field names [DOCUMENTED]                   |
| orderby     | string  | [UNKNOWN]   | Sort field(s), prefix `-` for descending [DOCUMENTED]      |
| {FieldName} | string  | -           | Filter by field value, with optional operators [CONFIRMED] |

---

### Pattern 2: Date-Based Change Detection

> Get records modified after a specific timestamp.

```http
GET /api/v1.0/companies/{companyID}/{resource}/?pageSize=250
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
If-Modified-Since: 2026-03-01T00:00:00
```

- **Date format in header:** `YYYY-MM-ddTHH:mm:ss` [DOCUMENTED]
- **Key limitation:** Do not combine `If-Modified-Since` with `orderby=DateModified` and columns like `AssignedTo` [DOCUMENTED]

---

### Pattern 3: Get by ID

```http
GET /api/v1.0/companies/{companyID}/{resource}/{id}
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

Optionally include specific columns:

```http
GET /api/v1.0/companies/{companyID}/jobs/123?columns=ID,Type,Status,Totals,CustomFields
```

[CONFIRMED -- SDK code demonstrates this pattern]

---

### Pattern 4: Get Related Records (Sub-resources)

> Fetch child or associated records via nested resource paths.

```http
GET /api/v1.0/companies/{companyID}/jobs/{jobID}/sections/
GET /api/v1.0/companies/{companyID}/jobs/{jobID}/sections/{sectionID}/costCenters/
GET /api/v1.0/companies/{companyID}/jobs/{jobID}/sections/{sectionID}/costCenters/{ccID}/schedules/
```

[CONFIRMED -- forum posts show this nested URL pattern]

> **Job hierarchy:** `Job > Section > CostCenter > (Labor | Materials | Schedule | ContractorJob | ServiceFee)`

---

### Pattern 5: Filter with Comparison Operators

> Use operators for range queries and exclusions.

```http
GET /api/v1.0/companies/0/customerInvoices/?DateIssued=gt(2026-01-01)&pageSize=250
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

```http
GET /api/v1.0/companies/0/jobs/?DateIssued=between(2026-01-01,2026-06-30)&orderby=-DateIssued
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

[CONFIRMED -- forum posts show operator syntax]

---

### Pattern 6: Wildcard Search on Names

```http
GET /api/v1.0/companies/0/customers/individuals/?GivenName=Rose%&FamilyName=A%&pageSize=100
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

[CONFIRMED -- forum]

---

### Pattern 7: Field Selection to Reduce Payload

```http
GET /api/v1.0/companies/0/jobs/?columns=ID,Status,DateIssued,Customer,Totals&pageSize=100
```

**Key rules:**

- Column names generally match the simPRO web UI [DOCUMENTED]
- Use `CustomFields` to include user-defined fields [DOCUMENTED -- forum]
- Sub-resource columns (e.g., site address details) are NOT available via columns [DOCUMENTED -- forum]
- Some columns like "Amount Remaining" are computed on-the-fly [DOCUMENTED -- forum]

---

## Pagination Handling

### Model

- **Type:** Page-number based [DOCUMENTED]
- **Default page size:** 30 [DOCUMENTED]
- **Max page size:** 250 [DOCUMENTED]
- **Total count available:** Yes -- via `Result-Total` response header [DOCUMENTED]

### Request Parameters

| Parameter | Type    | Default | Description                            |
| --------- | ------- | ------- | -------------------------------------- |
| page      | integer | 1       | 1-indexed page number [DOCUMENTED]     |
| pageSize  | integer | 30      | Records per page, max 250 [DOCUMENTED] |

### Response Structure

Response body is a **JSON array** (not wrapped in an object). Pagination metadata is exclusively in response headers:

```
HTTP/1.1 200 OK
Result-Total: 816
Result-Pages: 28
Result-Count: 30
Link: <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=2>; rel="next",
      <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=28>; rel="last",
      <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=1>; rel="first"

[
  {"ID": 1, ...},
  {"ID": 2, ...},
  ...
]
```

[DOCUMENTED -- confirmed from forum posts and Laravel package]

### Last Page Detection

Three ways to detect the last page:

1. No `rel="next"` in the `Link` header [DOCUMENTED]
2. Current `page` >= `Result-Pages` header value [DOCUMENTED]
3. Response array length < `pageSize` [CONFIRMED]

### Full Pagination Loop

```
Request 1: GET /companies/0/jobs/?pageSize=250&page=1
Headers:   Result-Total: 816, Result-Pages: 4, Result-Count: 250
Link:      <...?page=2>; rel="next", <...?page=4>; rel="last"

Request 2: GET /companies/0/jobs/?pageSize=250&page=2
Headers:   Result-Total: 816, Result-Pages: 4, Result-Count: 250
Link:      <...?page=1>; rel="first", <...?page=3>; rel="next", <...?page=4>; rel="last"

Request 3: GET /companies/0/jobs/?pageSize=250&page=3
Headers:   Result-Total: 816, Result-Pages: 4, Result-Count: 250

Request 4: GET /companies/0/jobs/?pageSize=250&page=4
Headers:   Result-Total: 816, Result-Pages: 4, Result-Count: 66
Link:      <...?page=1>; rel="first", <...?page=3>; rel="prev"
           (no "next" link = last page)
```

---

## Worked Examples

### Example 1: List All Jobs with Key Fields

```http
GET /api/v1.0/companies/0/jobs/?columns=ID,Type,Status,DateIssued,Customer,Site&orderby=-DateIssued&pageSize=250&page=1
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

**Key points:**

- `orderby=-DateIssued` sorts newest first [DOCUMENTED]
- `columns=` limits response to specified fields [DOCUMENTED]
- Check `Result-Total` header for total count [DOCUMENTED]
- Continue fetching pages until no `rel="next"` in Link header

---

### Example 2: Filter Invoices by Date Range

```http
GET /api/v1.0/companies/0/customerInvoices/?DateIssued=between(2026-01-01,2026-03-31)&pageSize=250
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

**Key points:**

- `between()` operator provides date range filtering [CONFIRMED -- forum]
- Can also use `gt()`, `lt()`, `ge()`, `le()` for open-ended ranges

---

### Example 3: Navigate Job Sub-resource Hierarchy

```http
GET /api/v1.0/companies/0/jobs/123/sections/
```

Then for each section:

```http
GET /api/v1.0/companies/0/jobs/123/sections/1/costCenters/
```

Then for schedules within a cost center:

```http
GET /api/v1.0/companies/0/jobs/123/sections/1/costCenters/1/schedules/
```

**Key points:**

- simPRO uses deeply nested sub-resources [CONFIRMED -- forum]
- Each level requires the parent IDs in the URL path
- Each sub-resource endpoint supports pagination independently

---

## Gotchas & Counter-Exceptions

1. **Pagination metadata is in headers, not body.** The response body is a bare JSON array. Total count, page info, and navigation links are in `Result-Total`, `Result-Pages`, `Result-Count`, and `Link` headers. [DOCUMENTED]

2. **Column names match UI, not always camelCase.** Some column names use spaces or differ from what you might expect. [DOCUMENTED]

3. **If-Modified-Since + orderby + certain columns = 500.** Remove the problematic column or drop orderby as a workaround. [DOCUMENTED -- forum]

4. **companyID=0 only works for single-company builds.** Always verify with `GET /api/v1.0/companies/` first if unsure. [DOCUMENTED]

5. **Default page size is only 30.** Always explicitly set `pageSize` (up to 250). [DOCUMENTED]

6. **ID column is not filterable on some endpoints.** Test before relying on ID-based queries. [CONFIRMED -- forum]

7. **Comparison operators use function syntax.** Write `gt(5)` not `>5`. The `%` wildcard goes inside the value string. [CONFIRMED -- forum]

---

_Generated from the investigation questionnaire, Phases 5-6._
