---
api_name: Claris FileMaker Data API
api_slug: filemaker
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest (real path segment, in the URL — not a label)
companion_to: 01-llm-api-rules.md
scope: read-side — _find query language, find operators, sort, offset/limit pagination, worked reads
confidence: dataInfo envelope + find semantics [DOCUMENTED]; not live-verified (no reachable per-tenant server)
---

# Claris FileMaker Data API — Query Patterns Reference

**Discover the layout's field names first** (`GET /layouts/{layout}` — see `01a`). Every query criterion + sort key references a field by its exact, case/space-sensitive name. Guessing yields error `102` (Field is missing). Paths relative to `https://{server_url}/fmi/data/vLatest`.

## Query Capabilities Summary

| Capability                      | Supported | Syntax                                          | Notes                                                                          |
| ------------------------------- | --------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Filter by field value           | Yes       | `{"Field":"value"}` in `query[]`                | `=value` for exact whole-word match                                            |
| Filter by date range            | Yes       | `{"Date":"1/1/2025...12/31/2025"}`              | FileMaker `...` range operator                                                 |
| Full-text search                | Partial   | `{"Field":"word"}`                              | word-based "contains" by default; not arbitrary substring                      |
| Sort by field                   | Yes       | `sort:[{"fieldName","sortOrder"}]`              | multiple sort keys allowed                                                     |
| Sort direction                  | Yes       | `"ascend"` / `"descend"`                        | or a value-list name for custom order                                          |
| Field selection / sparse fields | No        | —                                               | you get the whole layout's fields; control by choosing a leaner layout         |
| Include related records         | Yes       | `portal:[...]`                                  | only portals present on the layout                                             |
| Aggregate / count               | Partial   | `dataInfo.foundCount` / `totalRecordCount`      | no GROUP BY; counts only                                                       |
| Logical AND                     | Yes       | same object: `{"A":"x","B":"y"}`                | fields within one object are AND-ed                                            |
| Logical OR                      | Yes       | separate objects in `query[]`                   | each object in the array is OR-ed                                              |
| Comparison operators            | Yes       | `<`,`>`,`<=`(`≤`),`>=`(`≥`) prefixing the value | e.g. `{"Stock":"<40"}`                                                         |
| Null / empty checks             | Yes       | `{"F":"=="}` (empty) / `{"F":"*"}` (non-empty)  | FileMaker operators                                                            |
| Regex / pattern matching        | No        | —                                               | only FileMaker wildcards: `*` (any), `?` (one char), `#` (digit), `@` (letter) |
| Omit (NOT) matches              | Yes       | `{"Field":"x","omit":"true"}`                   | excludes that matching set                                                     |

## The `_find` Query Language

Find criteria = an **array of request objects** in the `_find` body. Boolean logic:

- **AND** = multiple fields inside the _same_ object.
- **OR** = multiple _objects_ in `query[]`.
- **NOT** = an object with `"omit":"true"` (excludes its matches from the found set).

```json
"query":[
  {"Stock":"<40","Category":"Tools"},        // (low stock AND Tools)
  {"Category":"Clearance"},                    //   OR (Clearance)
  {"Status":"Discontinued","omit":"true"}      //   ...but OMIT Discontinued
]
```

### Operators (placed at the START of the value string)

| Operator          | Meaning                                    | Example                                    |
| ----------------- | ------------------------------------------ | ------------------------------------------ |
| `=`               | exact / whole-word match                   | `{"Account Manager":"=Jane Smith"}`        |
| `==`              | exact entire-field-content match           | `{"SKU":"==W-001"}`                        |
| `<` `>` `<=` `>=` | comparison                                 | `{"Stock":"<40"}`                          |
| `...`             | range (inclusive)                          | `{"Order Date":"01/01/2026...03/31/2026"}` |
| `*`               | any string (zero+ chars) / non-empty field | `{"Name":"Wid*"}` / `{"Email":"*"}`        |
| `?`               | exactly one character                      | `{"Code":"A?1"}`                           |
| `#`               | one digit                                  | `{"Phone":"###"}`                          |
| `@`               | one letter                                 | `{"Initial":"@"}`                          |
| `==` (alone)      | field is empty                             | `{"Notes":"=="}`                           |

Quote-wrap a phrase to match it literally: `{"Name":"\"Widget Pro\""}`.

## Sort Syntax

```
# GET (browse) — _sort is URL-encoded JSON:
GET /layouts/Products/records?_sort=[{"fieldName":"Product Name","sortOrder":"ascend"}]

# POST /_find — sort is a JSON array in the body:
"sort":[{"fieldName":"Stock","sortOrder":"descend"},{"fieldName":"SKU","sortOrder":"ascend"}]
```

`sortOrder` may also be a **value-list name** to sort by a custom order rather than alphabetic/numeric.

## Field Selection

**No sparse-fieldset parameter** — every call returns every field on the targeted layout. To return fewer/different fields, **target a leaner layout**, or use `layout.response` to switch the layout used for shaping the response. This is why customers commonly build dedicated lightweight "API" layouts. Discover layouts with `GET /layouts`.

## Including Related (Portal) Data

```json
{
  "query": [{ "Customer ID": "=C-1001" }],
  "portal": ["Line Items", "Notes"],
  "limit.Line Items": "5",
  "offset.Line Items": "1"
}
```

`portal` names a subset of the portals present on the layout. Per-portal pagination: `limit.{portal}`/`offset.{portal}` (default offset 1, limit **50**). On GET browse the equivalents are `_limit.{portal}`/`_offset.{portal}` query params. Portal rows return under `response.data[].portalData`, keyed by portal name, each row with its own `recordId`/`modId`.

## Get by ID / Browse (no criteria)

```
GET /layouts/{layout}/records/{recordId}   # one record by its server-assigned recordId
GET /layouts/{layout}/records              # range/browse, paginated (no filtering)
```

`recordId` is the Data API's row handle from a prior response — NOT a user field. To find by a _business_ key (SKU, email, customer number), use `_find` against that field, not `recordId`.

## Pagination

Offset-based, **1-based** (first record = offset `1`). Default page 100 (50 for portal rows); no hard cap, keep `_limit` 100–500. Counts in `response.dataInfo`: `foundCount` (matched query), `totalRecordCount` (whole table), `returnedCount` (this page).

| Parameter | Where            | Default | Description          |
| --------- | ---------------- | ------- | -------------------- |
| `_offset` | GET query string | 1       | 1-based first record |
| `_limit`  | GET query string | 100     | records per page     |
| `offset`  | `_find` body     | 1       | 1-based first record |
| `limit`   | `_find` body     | 100     | records per page     |

Response shape: `{"response":{"data":[{"recordId":"7","modId":"1","fieldData":{...},"portalData":{}}],"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":500,"foundCount":240,"returnedCount":100}},"messages":[{"code":"0","message":"OK"}]}`

**Last-page detection:** `offset + returnedCount - 1 >= foundCount`, OR `returnedCount < limit`, OR `data` empty.

**Worked loop:**

```
Page 1: GET /records?_offset=1&_limit=100     → foundCount=240, returnedCount=100
Page 2: GET /records?_offset=101&_limit=100   → returnedCount=100
Page 3: GET /records?_offset=201&_limit=100   → returnedCount=40  (40 < 100 → last page)
```

For `_find`, increment `offset` by `limit` each call (body params, no underscore).

## Worked Examples

### 1: Low-stock products, newest first, first page (comparison + sort + pagination)

`POST /databases/Inventory/layouts/Products/_find`
`{"query":[{"Stock":"<40"}],"sort":[{"fieldName":"Modified","sortOrder":"descend"}],"limit":"50","offset":"1"}`
→ `{"response":{"data":[{"recordId":"7","modId":"1","fieldData":{"Product Name":"Baguette","Stock":34,"SKU":"FB3"},"portalData":{}}],"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":500,"foundCount":2,"returnedCount":2}},"messages":[{"code":"0","message":"OK"}]}`

- `<40` is a comparison operator on the value string, not a separate param. `foundCount` (2) matched; `totalRecordCount` (500) is the whole table.

### 2: Exact match, excluding a status (AND + OMIT)

`POST /databases/CRM/layouts/Customers/_find`
`{"query":[{"Account Manager":"=Jane Smith"},{"Status":"Closed","omit":"true"}],"limit":"100"}`

- `=Jane Smith` is whole-word exact; without `=` it would be looser word-contains. The `omit` object subtracts "Closed" customers from the found set.

### 3: Date range, ascending

`POST /databases/Sales/layouts/Orders/_find`
`{"query":[{"Order Date":"01/01/2026...03/31/2026"}],"sort":[{"fieldName":"Order Date","sortOrder":"ascend"}]}`

- `...` is the inclusive range operator. If date parsing misbehaves, add `"dateformats":"2"` + ISO dates (`2026-01-01...2026-03-31`).

### 4: Browse all with pagination + sort (GET, `_sort` URL-encoded)

`GET /databases/Inventory/layouts/Products/records?_offset=101&_limit=100&_sort=%5B%7B%22fieldName%22%3A%22SKU%22%2C%22sortOrder%22%3A%22ascend%22%7D%5D`

- Decoded `_sort` = `[{"fieldName":"SKU","sortOrder":"ascend"}]`. Browse has no filtering — use `_find` to filter.

### 5: Parent record with related line items (portal)

`POST /databases/Sales/layouts/Orders/_find`
`{"query":[{"Order Number":"=SO-2026-0042"}],"portal":["Line Items"],"limit.Line Items":"20"}`
→ `{"response":{"data":[{"recordId":"88","modId":"3","fieldData":{"Order Number":"SO-2026-0042","Total":4820.0},"portalData":{"Line Items":[{"recordId":"501","modId":"0","Line Items::Item":"Widget","Line Items::Qty":10}]}}]},"messages":[{"code":"0","message":"OK"}]}`

- Portal rows are keyed by the portal name and use `TableOccurrence::field` keys. Line items present only because a "Line Items" portal exists on the Orders layout.

### 6: Empty result (NOT an error)

`POST /databases/Inventory/layouts/Products/_find` `{"query":[{"SKU":"==NOPE"}]}`
→ `{"response":{},"messages":[{"code":"401","message":"No records match the request"}]}`
`messages[].code == "401"` from a find = empty result. Report "no matching records"; do not retry or treat as failure.

## Counting Without Pulling Records

Run `_find` with `"limit":"1"` and read `response.dataInfo.foundCount` — the full match count regardless of page size. No dedicated `/count` endpoint, no GROUP BY/aggregation.

## Gotchas & Counter-Exceptions

1. **`_find` is a POST but read-only** (idempotent despite the verb — the query lives in the body because it can be large). Do not avoid it for being a POST.
2. **No records found = code `401`, NOT HTTP 401.** A successful, empty result.
3. **Operators are part of the value string**, not separate fields — `{"Stock":"<40"}`, never `{"Stock":40,"op":"<"}`.
4. **You can't select fields** — choose a leaner layout instead of a sparse-fields param.
5. **Field/layout names exact + URL-encoded** — `Work State` in a path → `Work%20State`; in JSON stays `"Work State"`. Discover; never guess.
6. **Wildcards ≠ regex** — only `* ? # @`. No true substring/regex matching.
