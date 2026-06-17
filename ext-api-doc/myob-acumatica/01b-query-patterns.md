---
doc: query-patterns
api_version: 24.200.001
query_language: OData (subset, v3-era)
companion_of: 01-llm-api-rules.md
base_path: /entity/Default/24.200.001/{Entity}
confidence: [DOCUMENTED] unless tagged
---

# MYOB Acumatica — Query Patterns

## Capabilities

| Capability              | Supported | Syntax / note                                          |
| ----------------------- | --------- | ------------------------------------------------------ |
| Filter by field value   | Yes       | `$filter=Field eq 'Value'` (bare names, single quotes) |
| Filter by date range    | Yes       | `$filter=Date ge datetimeoffset'...'` (ISO 8601)       |
| Full-text search        | No        | use `contains()` per field                             |
| Sort                    | Yes       | `$orderby=Field asc` / `desc` (default asc)            |
| Field selection         | Yes       | `$select=Field1,Field2` (top-level only)               |
| Include related records | Yes       | `$expand=Details` (detail lines, sub-entities)         |
| Aggregation / count     | No        | no `@odata.count` in contract-based API                |
| Logical ops             | Yes       | `and`, `or`, `not`                                     |
| Comparison ops          | Yes       | `eq`, `ne`, `gt`, `ge`, `lt`, `le`                     |
| Null checks             | Yes       | `Field eq null` / `Field ne null`                      |

## Filter syntax (fundamental rule)

Bare field names + single quotes for strings.
`CORRECT: $filter=Status eq 'Active'` · `WRONG: $filter=Status.value eq 'Active'` · `WRONG: $filter=Status eq "Active"`

Operators (worked):
| Op | Example |
| --- | --- |
| eq | `$filter=Status eq 'Active'` |
| ne | `$filter=Status ne 'Closed'` |
| gt | `$filter=OrderTotal gt 1000` |
| ge | `$filter=Date ge datetimeoffset'2026-01-01T00:00:00Z'` |
| lt | `$filter=Balance lt 500` |
| le | `$filter=Quantity le 10` |
| and | `$filter=Status eq 'Active' and Balance gt 0` |
| or | `$filter=Status eq 'Active' or Status eq 'OnHold'` |
| not | `$filter=not contains(CustomerName, 'Test')` |

String functions:
| Fn | Example | Notes |
| --- | --- | --- |
| contains | `$filter=contains(CustomerName, 'Acme')` | case-insensitive on most fields |
| startswith | `$filter=startswith(CustomerID, 'AC')` | — |
| endswith | `$filter=endswith(Email, '.com')` | — |
| substringof | `$filter=substringof('corp', CustomerName)` | older OData syntax, still supported |

Dates use the `datetimeoffset` literal:
`$filter=Date ge datetimeoffset'2026-01-01T00:00:00Z' and Date le datetimeoffset'2026-03-31T23:59:59Z'`
Shorthand (may work on some instances): `$filter=Date ge datetime'2026-01-01'`.
Numerics: no quotes — `$filter=OrderTotal gt 1000.00`, `$filter=Quantity ge 5 and Quantity le 100`.

## Query parameters

| Param      | Purpose                                            | Example                                   |
| ---------- | -------------------------------------------------- | ----------------------------------------- |
| `$top`     | max records (ALWAYS include; omitting returns ALL) | `$top=100`                                |
| `$skip`    | offset for pagination                              | `$skip=200`                               |
| `$filter`  | filter conditions                                  | `$filter=Status eq 'Active'`              |
| `$select`  | choose top-level fields (reduces payload)          | `$select=CustomerID,CustomerName,Balance` |
| `$orderby` | sort (ALWAYS include when paginating)              | `$orderby=CustomerName asc`               |
| `$expand`  | include related entities/details                   | `$expand=Details,ShippingAddress`         |
| `$custom`  | include custom/UDF fields                          | `$custom=true`                            |

- `$select`: still returns `{"value":...}` wrappers; cannot select nested sub-fields (use `$expand`); system fields (`id`, `rowNumber`, `note`) always included.
- `$expand`: without `$expand=Details`, line-item arrays are omitted. Multi: `$expand=Details,ShippingAddress,BillingAddress`.
- `$orderby`: multi-field `$orderby=Status asc, CustomerName asc`.

## Pagination

`$top` + `$skip`: page1 `$top=100&$skip=0`, page2 `$skip=100`, page3 `$skip=200`…
No total count, no `@odata.count`, no `@odata.nextLink`. **Last page when `results.length < $top`.** `$skip` past total → `[]` (not error). Practical max `$top` 200–500 (higher may timeout). Always pair with `$orderby` — without it order is non-deterministic → duplicates/missed records.
Source: community.acumatica.com/develop-integrations-with-web-services-apis-289/http-rest-api-and-total-count-inclusion-in-response-27874

Pseudocode:

```python
page_size, skip, all_records = 100, 0, []
while True:
    records = GET(f"/entity/Default/24.200.001/Customer?$top={page_size}&$skip={skip}&$filter=Status eq 'Active'&$orderby=CustomerID asc").json()
    all_records.extend(records)
    if len(records) < page_size: break  # last page
    skip += page_size
```

## Worked examples

1. Active customers, balance > $1000:
`GET /entity/Default/24.200.001/Customer?$top=50&$filter=Status eq 'Active' and Balance gt 1000&$select=CustomerID,CustomerName,Balance,MainContact&$orderby=Balance desc`Response shape:`[{"id":"abc123...","rowNumber":1,"note":null,"CustomerID":{"value":"BIGCORP"},"CustomerName":{"value":"Big Corporation Ltd"},"Balance":{"value":45230.5},"MainContact":{"id":"...","rowNumber":1,"Email":{"value":"accounts@bigcorp.com"}}}]`

2. Sales orders for a customer in date range:
   `GET /entity/Default/24.200.001/SalesOrder?$top=100&$filter=CustomerID eq 'ACME01' and Date ge datetimeoffset'2026-01-01T00:00:00Z' and Date le datetimeoffset'2026-01-31T23:59:59Z'&$expand=Details&$orderby=Date desc`

3. Stock items running low:
   `GET /entity/Default/24.200.001/StockItem?$top=100&$filter=ItemStatus eq 'Active' and CurrentStockQty lt 10&$select=InventoryID,Description,CurrentStockQty,DefaultPrice&$orderby=CurrentStockQty asc`

4. Overdue invoices:
   `GET /entity/Default/24.200.001/SalesInvoice?$top=100&$filter=Status eq 'Open' and DueDate lt datetimeoffset'2026-03-30T00:00:00Z'&$select=ReferenceNbr,CustomerID,Amount,Balance,DueDate&$orderby=DueDate asc`

5. Search leads by company:
   `GET /entity/Default/24.200.001/Lead?$top=50&$filter=contains(CompanyName, 'Tech') and Status ne 'Converted'&$select=LeadID,FirstName,LastName,CompanyName,Email,Status&$orderby=LastName asc`

6. Recently modified (polling):
   `GET /entity/Default/24.200.001/Customer?$top=100&$filter=LastModifiedDateTime gt datetimeoffset'2026-03-30T10:00:00Z'&$orderby=LastModifiedDateTime asc`

## Generic Inquiry queries

Two access modes:

- **OData (simpler, read-only):** `GET /odata/{CompanyName}/{GI_ScreenID}?$top=100&$filter=FieldName eq 'value'`. OData v3 (limitations); response fields are FLAT (no `{"value":...}` wrappers); GI must be pre-created + exposed in the Acumatica UI.
- **Contract-based endpoint:** when a GI is added to the Web Service Endpoint definition, access via the entity API path; use `$expand=Result` to get GI data; field names match GI column aliases.
  Source: acumatica.com/blog/contract-based-apis-in-generic-inquiries/

## Common query mistakes

| Mistake                            | Correct                                    |
| ---------------------------------- | ------------------------------------------ |
| `$filter=Status.value eq 'Active'` | `$filter=Status eq 'Active'` (bare field)  |
| `$filter=Status eq "Active"`       | single quotes                              |
| Omitting `$top`                    | always `$top=100` (or limit)               |
| Paginating without `$orderby`      | always `$orderby` for deterministic order  |
| `$select` for nested fields        | use `$expand`                              |
| Expecting `@odata.count`           | not provided — use `results.length < $top` |
| POST for queries                   | GET with query params                      |
