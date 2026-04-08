# MYOB Acumatica -- Query Patterns

> **API Version:** 24.200.001 | **Query Language:** OData (subset)
> Companion to `01-llm-api-rules.md`.

---

## Query Capabilities Summary

| Capability                 | Supported | Syntax                                | Notes                                 |
| -------------------------- | --------- | ------------------------------------- | ------------------------------------- |
| Filter by field value      | Yes       | `$filter=Field eq 'Value'`            | Bare field names, single quotes       |
| Filter by date range       | Yes       | `$filter=Date ge datetimeoffset'...'` | ISO 8601 with datetimeoffset prefix   |
| Full-text search           | No        | --                                    | Use `contains()` function per field   |
| Sort by field              | Yes       | `$orderby=Field asc`                  | asc/desc                              |
| Sort direction             | Yes       | `$orderby=Field desc`                 | Default is asc                        |
| Field selection            | Yes       | `$select=Field1,Field2`               | Top-level fields only                 |
| Include related records    | Yes       | `$expand=Details`                     | Detail lines, sub-entities            |
| Aggregation / count        | No        | --                                    | No @odata.count in contract-based API |
| Logical operators (AND/OR) | Yes       | `and`, `or`, `not`                    | --                                    |
| Comparison operators       | Yes       | `eq`, `ne`, `gt`, `ge`, `lt`, `le`    | --                                    |
| Null checks                | Yes       | `Field eq null`                       | --                                    |

---

## OData Filter Syntax

### Fundamental Rule

**[DOCUMENTED]** -- Filters use **bare field names** and **single quotes** for string values.

```
CORRECT:  $filter=Status eq 'Active'
WRONG:    $filter=Status.value eq 'Active'
WRONG:    $filter=Status eq "Active"
```

### Operators

| Operator         | Syntax | Example                                                |
| ---------------- | ------ | ------------------------------------------------------ |
| Equal            | `eq`   | `$filter=Status eq 'Active'`                           |
| Not equal        | `ne`   | `$filter=Status ne 'Closed'`                           |
| Greater than     | `gt`   | `$filter=OrderTotal gt 1000`                           |
| Greater or equal | `ge`   | `$filter=Date ge datetimeoffset'2026-01-01T00:00:00Z'` |
| Less than        | `lt`   | `$filter=Balance lt 500`                               |
| Less or equal    | `le`   | `$filter=Quantity le 10`                               |
| Logical AND      | `and`  | `$filter=Status eq 'Active' and Balance gt 0`          |
| Logical OR       | `or`   | `$filter=Status eq 'Active' or Status eq 'OnHold'`     |
| Logical NOT      | `not`  | `$filter=not contains(CustomerName, 'Test')`           |

### String Functions

| Function      | Example                                     | Notes                               |
| ------------- | ------------------------------------------- | ----------------------------------- |
| `contains`    | `$filter=contains(CustomerName, 'Acme')`    | Case-insensitive on most fields     |
| `startswith`  | `$filter=startswith(CustomerID, 'AC')`      | --                                  |
| `endswith`    | `$filter=endswith(Email, '.com')`           | --                                  |
| `substringof` | `$filter=substringof('corp', CustomerName)` | Older OData syntax, still supported |

### Date Filtering

**[DOCUMENTED]** -- Dates use the `datetimeoffset` literal:

```
$filter=Date ge datetimeoffset'2026-01-01T00:00:00Z' and Date le datetimeoffset'2026-03-31T23:59:59Z'
```

Shorthand (may work on some instances):

```
$filter=Date ge datetime'2026-01-01'
```

### Numeric Filtering

No quotes for numeric values:

```
$filter=OrderTotal gt 1000.00
$filter=Quantity ge 5 and Quantity le 100
```

### Null Checks

```
$filter=Email eq null
$filter=Email ne null
```

---

## Query Parameters Reference

| Parameter  | Purpose                          | Example                                   |
| ---------- | -------------------------------- | ----------------------------------------- |
| `$top`     | Max records to return            | `$top=100`                                |
| `$skip`    | Records to skip (pagination)     | `$skip=200`                               |
| `$filter`  | Filter conditions                | `$filter=Status eq 'Active'`              |
| `$select`  | Choose specific fields           | `$select=CustomerID,CustomerName,Balance` |
| `$orderby` | Sort results                     | `$orderby=CustomerName asc`               |
| `$expand`  | Include related entities/details | `$expand=Details,ShippingAddress`         |
| `$custom`  | Include custom/UDF fields        | `$custom=true`                            |

### `$select` -- Field Selection

Reduces response payload. Only returns specified top-level fields.

```
GET /entity/Default/24.200.001/Customer?$select=CustomerID,CustomerName,Status,Balance&$top=50
```

- Fields still returned in `{"value": ...}` wrapper
- Cannot select nested sub-fields directly (use `$expand` for sub-entities)
- System fields (`id`, `rowNumber`, `note`) always included

### `$expand` -- Related Entities

Includes detail lines, addresses, and sub-entities in the response.

```
GET /entity/Default/24.200.001/SalesOrder?$expand=Details&$top=20
```

Multiple expands:

```
$expand=Details,ShippingAddress,BillingAddress
```

Without `$expand=Details`, line item arrays are omitted from the response.

### `$orderby` -- Sorting

```
$orderby=CustomerName asc              # ascending (default)
$orderby=Date desc                     # descending
$orderby=Status asc, CustomerName asc  # multi-field
```

---

## Pagination

### Pattern: `$top` + `$skip`

```
Page 1: $top=100&$skip=0
Page 2: $top=100&$skip=100
Page 3: $top=100&$skip=200
...
```

### Detecting the Last Page

**[DOCUMENTED]** -- No total count is provided in the response. No `@odata.count`, no `@odata.nextLink`.

```
if (results.length < pageSize) {
    // This is the last page -- no more records
} else {
    // May have more records -- fetch next page
}
```

Source: https://community.acumatica.com/develop-integrations-with-web-services-apis-289/http-rest-api-and-total-count-inclusion-in-response-27874

### Complete Pagination Example (pseudocode)

```python
page_size = 100
skip = 0
all_records = []

while True:
    response = GET(f"/entity/Default/24.200.001/Customer"
                   f"?$top={page_size}&$skip={skip}"
                   f"&$filter=Status eq 'Active'"
                   f"&$orderby=CustomerID asc")

    records = response.json()
    all_records.extend(records)

    if len(records) < page_size:
        break  # last page

    skip += page_size
```

### Important Pagination Notes

- **Always include `$orderby`** when paginating -- without it, record order is not guaranteed and you may get duplicates or miss records
- **Always include `$top`** -- without it, ALL records are returned in one request
- `$skip` values above the total record count return empty arrays (not errors)
- Practical max `$top`: 200-500. Higher values may timeout on large datasets.

---

## Worked Examples

### Example 1: Active Customers with Balance Over $1000

```http
GET /entity/Default/24.200.001/Customer
    ?$top=50
    &$filter=Status eq 'Active' and Balance gt 1000
    &$select=CustomerID,CustomerName,Balance,MainContact
    &$orderby=Balance desc
Authorization: Bearer {token}
```

**Response structure:**

```json
[
  {
    "id": "abc123...",
    "rowNumber": 1,
    "note": null,
    "CustomerID": { "value": "BIGCORP" },
    "CustomerName": { "value": "Big Corporation Ltd" },
    "Balance": { "value": 45230.5 },
    "MainContact": {
      "id": "...",
      "rowNumber": 1,
      "Email": { "value": "accounts@bigcorp.com" }
    }
  }
]
```

### Example 2: Sales Orders for a Specific Customer in Date Range

```http
GET /entity/Default/24.200.001/SalesOrder
    ?$top=100
    &$filter=CustomerID eq 'ACME01' and Date ge datetimeoffset'2026-01-01T00:00:00Z' and Date le datetimeoffset'2026-01-31T23:59:59Z'
    &$expand=Details
    &$orderby=Date desc
Authorization: Bearer {token}
```

### Example 3: Stock Items Running Low

```http
GET /entity/Default/24.200.001/StockItem
    ?$top=100
    &$filter=ItemStatus eq 'Active' and CurrentStockQty lt 10
    &$select=InventoryID,Description,CurrentStockQty,DefaultPrice
    &$orderby=CurrentStockQty asc
Authorization: Bearer {token}
```

### Example 4: Overdue Invoices

```http
GET /entity/Default/24.200.001/SalesInvoice
    ?$top=100
    &$filter=Status eq 'Open' and DueDate lt datetimeoffset'2026-03-30T00:00:00Z'
    &$select=ReferenceNbr,CustomerID,Amount,Balance,DueDate
    &$orderby=DueDate asc
Authorization: Bearer {token}
```

### Example 5: Search Leads by Company Name

```http
GET /entity/Default/24.200.001/Lead
    ?$top=50
    &$filter=contains(CompanyName, 'Tech') and Status ne 'Converted'
    &$select=LeadID,FirstName,LastName,CompanyName,Email,Status
    &$orderby=LastName asc
Authorization: Bearer {token}
```

### Example 6: Recently Modified Records (Polling Pattern)

```http
GET /entity/Default/24.200.001/Customer
    ?$top=100
    &$filter=LastModifiedDateTime gt datetimeoffset'2026-03-30T10:00:00Z'
    &$orderby=LastModifiedDateTime asc
Authorization: Bearer {token}
```

---

## Generic Inquiry Queries

**[DOCUMENTED]** -- Generic Inquiries can be accessed via OData or by extending the contract-based endpoint.

### OData Access (simpler, read-only)

```http
GET /odata/{CompanyName}/{GI_ScreenID}?$top=100&$filter=FieldName eq 'value'
Authorization: Bearer {token}
```

- OData v3 (with limitations)
- Response fields are flat (no `{"value": ...}` wrappers)
- Read-only
- GI must be pre-created and exposed in the Acumatica UI

### Contract-Based Endpoint Access

When a GI is added to the Web Service Endpoint definition:

- Access via the entity API path
- Use `$expand=Result` to get GI data
- Field names match GI column aliases

Source: https://www.acumatica.com/blog/contract-based-apis-in-generic-inquiries/

---

## Common Query Mistakes

| Mistake                              | Correct Version                                                 |
| ------------------------------------ | --------------------------------------------------------------- |
| `$filter=Status.value eq 'Active'`   | `$filter=Status eq 'Active'`                                    |
| `$filter=Status eq "Active"`         | `$filter=Status eq 'Active'`                                    |
| Omitting `$top`                      | Always include `$top=100` (or appropriate limit)                |
| Paginating without `$orderby`        | Always include `$orderby` for deterministic pagination          |
| Using `$select` for nested fields    | Use `$expand` for sub-entities                                  |
| Expecting `@odata.count` in response | Not provided -- use `results.length < $top` to detect last page |
| Using POST for queries               | Use GET with query parameters                                   |

---

_Generated from the investigation questionnaire, Phases 5-6._
