---
api_name: 'Claris FileMaker Data API'
api_slug: 'filemaker'
generated_from: '00-api-investigation-questionnaire'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Claris FileMaker Data API — Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Read-side operations: the `_find` query language, FileMaker
> find operators, sort, offset/limit pagination, and worked reads.
>
> **Always discover the layout's field names first** (`GET .../layouts/{layout}` — see `01a`). Every
> query criterion and sort key references a field by its exact, case/space-sensitive name. Guessing a
> name yields error `102` (Field is missing). Paths below are relative to
> `https://{server_url}/fmi/data/vLatest`.

---

## Query Capabilities Summary

| Capability                      | Supported | Syntax                                             | Notes                                                                           |
| ------------------------------- | --------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Filter by field value           | Yes       | `{"Field":"value"}` in `query[]`                   | `=value` for exact whole-word match.                                            |
| Filter by date range            | Yes       | `{"Date":"1/1/2025...12/31/2025"}`                 | FileMaker `...` range operator.                                                 |
| Full-text search                | Partial   | `{"Field":"word"}`                                 | Word-based "contains" by default; not arbitrary substring.                      |
| Sort by field                   | Yes       | `sort:[{"fieldName","sortOrder"}]`                 | Multiple sort keys allowed.                                                     |
| Sort direction                  | Yes       | `"ascend"` / `"descend"`                           | Or a value-list name for custom order.                                          |
| Field selection / sparse fields | No        | —                                                  | You get the whole layout's fields; control by choosing a leaner layout.         |
| Include related records         | Yes       | `portal:[...]`                                     | Only portals present on the layout.                                             |
| Aggregate / count               | Partial   | `dataInfo.foundCount` / `totalRecordCount`         | No GROUP BY; counts only.                                                       |
| Logical AND                     | Yes       | same object: `{"A":"x","B":"y"}`                   | Fields within one object are AND-ed.                                            |
| Logical OR                      | Yes       | separate objects in `query[]`                      | Each object in the array is OR-ed.                                              |
| Comparison operators            | Yes       | `<`, `>`, `<=`(`≤`), `>=`(`≥`) prefixing the value | e.g. `{"Stock":"<40"}`.                                                         |
| Null / empty checks             | Yes       | `{"F":"=="}` (empty) / `{"F":"*"}` (non-empty)     | FileMaker operators.                                                            |
| Regex / pattern matching        | No        | —                                                  | Only FileMaker wildcards: `*` (any), `?` (one char), `#` (digit), `@` (letter). |
| Omit (NOT) matches              | Yes       | `{"Field":"x","omit":"true"}`                      | Excludes that matching set.                                                     |

---

## The `_find` Query Language

Find criteria are an **array of request objects** in the `_find` body. The boolean logic is:

- **AND** = multiple fields inside the _same_ object.
- **OR** = multiple _objects_ in the `query[]` array.
- **NOT** = an object with `"omit":"true"` (excludes its matches from the found set).

```json
"query": [
  { "Stock": "<40", "Category": "Tools" },     // (low stock AND Tools)
  { "Category": "Clearance" },                  //   OR (Clearance)
  { "Status": "Discontinued", "omit": "true" }  //   ...but OMIT Discontinued
]
```

### Operators (placed at the START of the value string)

| Operator          | Meaning                                    | Example                                    |
| ----------------- | ------------------------------------------ | ------------------------------------------ |
| `=`               | Exact / whole-word match                   | `{"Account Manager":"=Jane Smith"}`        |
| `==`              | Exact entire-field-content match           | `{"SKU":"==W-001"}`                        |
| `<` `>` `<=` `>=` | Comparison                                 | `{"Stock":"<40"}`                          |
| `...`             | Range (inclusive)                          | `{"Order Date":"01/01/2026...03/31/2026"}` |
| `*`               | Any string (zero+ chars) / non-empty field | `{"Name":"Wid*"}` / `{"Email":"*"}`        |
| `?`               | Exactly one character                      | `{"Code":"A?1"}`                           |
| `#`               | One digit                                  | `{"Phone":"###"}`                          |
| `@`               | One letter                                 | `{"Initial":"@"}`                          |
| `==` (alone)      | Field is empty                             | `{"Notes":"=="}`                           |

Quote-wrap a phrase to match it literally: `{"Name":"\"Widget Pro\""}`.

---

## Sort Syntax

```
# GET (browse) — _sort is URL-encoded JSON
GET .../layouts/Products/records?_sort=[{"fieldName":"Product Name","sortOrder":"ascend"}]

# POST /_find — sort is a JSON array in the body
"sort": [
  { "fieldName": "Stock", "sortOrder": "descend" },
  { "fieldName": "SKU",   "sortOrder": "ascend"  }
]
```

`sortOrder` may also be a **value-list name** to sort by a custom order rather than alphabetic/numeric.

---

## Field Selection

There is **no sparse-fieldset parameter** — every call returns every field on the targeted layout. To return
fewer fields (or different ones), **target a leaner layout**, or use `layout.response` to switch the layout used
for shaping the response. This is exactly why FileMaker customers commonly build dedicated lightweight "API"
layouts. Discover available layouts with `GET .../layouts`.

---

## Including Related (Portal) Data

```json
{
  "query": [{ "Customer ID": "=C-1001" }],
  "portal": ["Line Items", "Notes"],
  "limit.Line Items": "5",
  "offset.Line Items": "1"
}
```

`portal` names a subset of the portals present on the layout. Per-portal pagination uses
`limit.{portal}` / `offset.{portal}` (default offset 1, limit **50**). On the GET browse endpoint the
equivalents are `_limit.{portal}` / `_offset.{portal}` query params. Portal rows return under
`response.data[].portalData`, keyed by the portal name, each row with its own `recordId`/`modId`.

---

## Get by ID / Browse (no criteria)

```
GET .../layouts/{layout}/records/{recordId}      # one record by its server-assigned recordId
GET .../layouts/{layout}/records                  # range/browse, paginated (no filtering)
```

`recordId` is the Data API's row handle from a prior response — **not** a user field. To find by a _business_
key (SKU, email, customer number), use `_find` against that field, not `recordId`.

---

## Pagination

- **Type:** Offset-based, **1-based** (the first record is offset `1`, not `0`).
- **Default page size:** 100 records (50 for portal rows).
- **Max page size:** No documented hard cap; bounded by server memory. Keep `_limit` reasonable (100–500).
- **Total count available:** Yes — `response.dataInfo.foundCount` (matched the query) and `totalRecordCount`
  (whole table). `returnedCount` is how many this page returned.

### Request parameters

| Parameter | Where            | Default | Description           |
| --------- | ---------------- | ------- | --------------------- |
| `_offset` | GET query string | 1       | 1-based first record. |
| `_limit`  | GET query string | 100     | Records per page.     |
| `offset`  | `_find` body     | 1       | 1-based first record. |
| `limit`   | `_find` body     | 100     | Records per page.     |

### Response structure

```json
{
  "response": {
    "data": [ { "recordId": "7", "modId": "1", "fieldData": { ... }, "portalData": {} } ],
    "dataInfo": {
      "database": "Inventory", "layout": "Products", "table": "Products",
      "totalRecordCount": 500, "foundCount": 240, "returnedCount": 100
    }
  },
  "messages": [ { "code": "0", "message": "OK" } ]
}
```

### Last-page detection

`offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` is empty.

### Pagination worked loop

```
Page 1: GET .../records?_offset=1&_limit=100     → dataInfo.foundCount=240, returnedCount=100
Page 2: GET .../records?_offset=101&_limit=100   → returnedCount=100
Page 3: GET .../records?_offset=201&_limit=100   → returnedCount=40  (40 < 100 → last page)
```

For `_find`, increment `offset` by `limit` each call in the same way (body params, no underscore).

---

## Worked Examples

### Example 1: Low-stock products, newest first, first page

> Filtered read with a comparison operator + sort + pagination.

```http
POST /databases/Inventory/layouts/Products/_find
Authorization: Bearer {token}
Content-Type: application/json

{ "query": [ { "Stock": "<40" } ],
  "sort":  [ { "fieldName": "Modified", "sortOrder": "descend" } ],
  "limit": "50", "offset": "1" }
```

```json
{
  "response": {
    "data": [
      {
        "recordId": "7",
        "modId": "1",
        "fieldData": { "Product Name": "Baguette", "Stock": 34, "SKU": "FB3" },
        "portalData": {}
      }
    ],
    "dataInfo": {
      "database": "Inventory",
      "layout": "Products",
      "table": "Products",
      "totalRecordCount": 500,
      "foundCount": 2,
      "returnedCount": 2
    }
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

**Key points:**

- `<40` is a comparison operator on the value string, not a separate param.
- `foundCount` (2) is what matched; `totalRecordCount` (500) is the whole table.

### Example 2: Exact match, excluding a status (AND + OMIT)

> Two criteria objects: one positive exact match, one omit.

```http
POST /databases/CRM/layouts/Customers/_find
Authorization: Bearer {token}

{ "query": [ { "Account Manager": "=Jane Smith" }, { "Status": "Closed", "omit": "true" } ],
  "limit": "100" }
```

**Key points:**

- `=Jane Smith` is whole-word exact; without `=` it would be a looser word-contains match.
- The `omit` object subtracts "Closed" customers from the found set.

### Example 3: Date range, ascending

```http
POST /databases/Sales/layouts/Orders/_find
Authorization: Bearer {token}

{ "query": [ { "Order Date": "01/01/2026...03/31/2026" } ],
  "sort":  [ { "fieldName": "Order Date", "sortOrder": "ascend" } ] }
```

**Key points:**

- `...` is the inclusive range operator.
- If date parsing misbehaves, add `"dateformats": "2"` and pass ISO dates (`2026-01-01...2026-03-31`).

### Example 4: Browse all with pagination + sort (GET)

```http
GET /databases/Inventory/layouts/Products/records?_offset=101&_limit=100&_sort=%5B%7B%22fieldName%22%3A%22SKU%22%2C%22sortOrder%22%3A%22ascend%22%7D%5D
Authorization: Bearer {token}
```

The decoded `_sort` is `[{"fieldName":"SKU","sortOrder":"ascend"}]`. Browse has no filtering — use `_find` to filter.

### Example 5: Parent record with related line items (portal)

```http
POST /databases/Sales/layouts/Orders/_find
Authorization: Bearer {token}

{ "query": [ { "Order Number": "=SO-2026-0042" } ], "portal": [ "Line Items" ], "limit.Line Items": "20" }
```

```json
{
  "response": {
    "data": [
      {
        "recordId": "88",
        "modId": "3",
        "fieldData": { "Order Number": "SO-2026-0042", "Total": 4820.0 },
        "portalData": {
          "Line Items": [{ "recordId": "501", "modId": "0", "Line Items::Item": "Widget", "Line Items::Qty": 10 }]
        }
      }
    ]
  },
  "messages": [{ "code": "0", "message": "OK" }]
}
```

**Key points:**

- Portal rows are keyed by the portal name and use `TableOccurrence::field` keys.
- The line items are only present because a "Line Items" portal exists on the Orders layout.

### Example 6: Empty result (NOT an error)

```http
POST /databases/Inventory/layouts/Products/_find
Authorization: Bearer {token}

{ "query": [ { "SKU": "==NOPE" } ] }
```

```json
{ "response": {}, "messages": [{ "code": "401", "message": "No records match the request" }] }
```

`messages[].code == "401"` from a find = empty result. Report "no matching records"; do not retry or treat as failure.

---

## Counting Without Pulling Records

To get a count cheaply, run the `_find` with `"limit": "1"` and read `response.dataInfo.foundCount` — that is the
full match count regardless of the page size. There is no dedicated `/count` endpoint and no GROUP BY / aggregation.

---

## Gotchas & Counter-Exceptions

1. **`_find` is a POST but read-only.** It is idempotent despite the verb — the query lives in the body because
   it can be large. Do not avoid it for being a POST.
2. **No records found = code `401`, not HTTP 401.** It is a successful, empty result.
3. **Operators are part of the value string**, not separate fields — `{"Stock":"<40"}`, never `{"Stock":40,"op":"<"}`.
4. **You can't select fields** — choose a leaner layout instead of expecting a sparse-fields param.
5. **Field/layout names are exact and URL-encoded** — `Work State` in a path becomes `Work%20State`; in JSON it
   stays `"Work State"`. Discover them; never guess.
6. **Wildcards ≠ regex.** Only `* ? # @` are supported. There is no true substring/regex matching.

---

_Generated from the investigation questionnaire, Phases 5–6. The `dataInfo` envelope and find semantics are
`[DOCUMENTED]`; not live-verified (no reachable per-tenant server)._
