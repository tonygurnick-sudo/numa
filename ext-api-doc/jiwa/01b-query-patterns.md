---
api_name: 'Jiwa Financials'
api_slug: 'jiwa'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'official OpenAPI spec (816 paths / 1,381 ops) + Jiwa Atlassian wiki — NO live instance tested'
source_phases: ['Phase 5: Query & Filter Capabilities', 'Phase 6: Pagination & Bulk Operations']
---

# Jiwa Financials -- Query Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all read operation patterns including
> AutoQuery filtering, sorting, pagination, field selection, and worked examples.

> ⚠️ **NOT LIVE-VALIDATED.** Everything here is derived from the official OpenAPI spec
> [SPEC] and Jiwa's official wiki [DOCS]. No test instance was available. Inferences are
> tagged [UNVERIFIED]. Expect per-customer differences: enabled plugins, route permissions,
> and Jiwa version (7 vs 8) all change which routes exist and what they return.

> **Auth note:** Examples below use the Numa request form with bare relative paths. The Numa
> backend injects `Authorization: Bearer {api_key}` from the user's vault automatically and
> expands relative URLs against the admin-configured instance URL. Never set auth headers
> yourself; never use an absolute URL.

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Queries/DB_Main?Take=25",
  "method": "GET"
})
```

---

## Query Capabilities Summary

| Capability                 | Supported    | Syntax                                            | Notes                                                              |
| -------------------------- | ------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| Filter by field value      | Yes          | `?AccountNo=10001`                                | On `/Queries/*` routes: every column is a query param [SPEC]       |
| Filter by string pattern   | Yes          | `?NameContains=smith`, `?AccountNoStartsWith=1`   | Per-column `StartsWith` / `EndsWith` / `Contains` / `Like` [SPEC]  |
| Filter by date range       | Yes          | `?LastSavedDateTimeGreaterThan=2026-06-01T00:00:00` | `GreaterThan(OrEqualTo)` / `LessThan(OrEqualTo)` / `Between` [SPEC] |
| Full-text search           | No           | --                                                | No global search; use per-column `Contains` filters                |
| Sort by field              | Yes          | `?OrderBy=AccountNo`                              | `OrderByDesc` for descending [SPEC]                                |
| Field selection            | Yes          | `?Fields=DebtorID,AccountNo,Name`                 | Trims response to listed columns [DOCS]                            |
| Include related records    | No (queries) | --                                                | `/Queries/*` are flat rows; full GET-by-ID returns children        |
| Aggregation / count        | Total only   | `?Include=Total`                                  | Adds `Total` (matching-row count) to the response [DOCS]           |
| Logical operators (AND/OR) | AND default  | Multiple params AND together                      | Parallel `/Queries/OR/...` routes exist [SPEC]; OR semantics [UNVERIFIED] |
| Comparison operators       | Yes          | Suffix conventions per column                     | Numeric/date columns get GT/GTE/LT/LTE/NE/Between/In [SPEC]        |
| Membership (IN list)       | Yes          | `?AccountNoIn=...`                                | Value separator [UNVERIFIED] -- comma is the ServiceStack convention |
| Null checks                | No           | --                                                | Not exposed in spec params                                         |

---

## The Two Read Surfaces

Jiwa has two distinct ways to read data. Pick deliberately:

1. **`/Queries/*` AutoQuery routes (152 ops)** -- read-only, SQL-view/table-backed, flat
   rows, rich filtering, pagination, field selection. **This is the right surface for
   "find / list / report" questions.** Examples: `/Queries/DB_Main` (debtors),
   `/Queries/IN_Main` (inventory), `/Queries/SO_Main` (sales orders),
   `/Queries/SalesOrderList`, `/Queries/DebtorList`, `/Queries/InventoryItemList`,
   `/Queries/DebtorTransactionList`, `/Queries/BackOrderList`, `/Queries/HR_Staff`. [SPEC]
2. **Entity GET routes** -- `/Debtors/{DebtorID}`, `/SalesOrders/{InvoiceID}`,
   `/Inventory/{InventoryID}`, ... Return the **full business DTO including child
   collections** (notes, documents, contact names, delivery addresses, prices, lines,
   payments...). Heavy. Use only when you already have the RecID and need the whole object
   or its children. [DOCS]

Two flavors of AutoQuery route [DOCS]:

- **Table queries** -- every table has a query class: `DB_Main` → `/Queries/DB_Main`,
  `SO_Main` → `/Queries/SO_Main`, `IN_Main` → `/Queries/IN_Main`. Raw table columns.
- **View-backed list queries** -- denormalized views joining several tables for common
  list screens: `/Queries/SalesOrderList` (order + customer + warehouse + delivery info),
  `/Queries/DebtorList`, `/Queries/InventoryItemList`. Prefer these when you need
  human-meaningful columns (e.g. `DebtorName`, `PhysicalWarehouseDescription`) without
  joining client-side.

---

## Response Envelope (AutoQuery) [SPEC]

Every `/Queries/*` response is a `QueryResponse<T>`:

```json
{
  "Offset": 0,
  "Total": 1372,
  "Results": [ { "DebtorID": "0000000061000000001V", "AccountNo": "10001", "Name": "..." } ],
  "Meta": {},
  "ResponseStatus": null
}
```

- `Results` -- array of row objects (trimmed to `Fields` if you passed it).
- `Total` -- count of ALL rows matching the filter, **only populated when you pass
  `Include=Total`** [DOCS]. Without it, expect 0/absent -- don't treat that as "no data".
- `Offset` -- echoes your `Skip`.
- `ResponseStatus` -- error container, null on success (see `01d-event-and-error-handling.md`).

---

## AutoQuery Filtering Conventions

These routes are ServiceStack AutoQuery. Each route exposes ~400-500 query parameters
[SPEC]: every column of the underlying table/view, plus per-column condition variants.
Extracted from the spec (`/Queries/DB_Main` shown; the same pattern holds across all
`/Queries/*` routes -- verified across `DB_Main`, `IN_Main`, `SalesOrderList` in the spec):

### String columns

| Param pattern        | Meaning                              | Example                          |
| -------------------- | ------------------------------------ | -------------------------------- |
| `{Col}`              | Exact match                          | `?AccountNo=10001`               |
| `{Col}StartsWith`    | Prefix match                         | `?AccountNoStartsWith=1`         |
| `{Col}EndsWith`      | Suffix match                         | `?NameEndsWith=Ltd`              |
| `{Col}Contains`      | Substring match                      | `?NameContains=plumb`            |
| `{Col}Like`          | SQL LIKE pattern                     | wildcard char [UNVERIFIED] (`%` per SQL convention) |
| `{Col}Between`       | Range (two values)                   | separator [UNVERIFIED] (comma per ServiceStack convention) |
| `{Col}In`            | Membership in a list                 | separator [UNVERIFIED] (comma per ServiceStack convention) |

### Numeric / date columns

| Param pattern                  | Meaning  |
| ------------------------------ | -------- |
| `{Col}`                        | Equal    |
| `{Col}GreaterThan`             | `>`      |
| `{Col}GreaterThanOrEqualTo`    | `>=`     |
| `{Col}LessThan`                | `<`      |
| `{Col}LessThanOrEqualTo`       | `<=`     |
| `{Col}NotEqualTo`              | `!=`     |
| `{Col}Between` / `{Col}In`     | Range / list |

### Boolean columns

Exact match only: `?AccountOnHold=true`, `?WebAccess=true`. [SPEC]

### Structural parameters (every `/Queries/*` route) [SPEC]

| Parameter     | Type    | Purpose                                                            |
| ------------- | ------- | ------------------------------------------------------------------ |
| `Skip`        | integer | Rows to skip (0-based offset)                                      |
| `Take`        | integer | Rows to return (page size)                                         |
| `OrderBy`     | string  | Sort column(s); comma list [UNVERIFIED for multi-column]           |
| `OrderByDesc` | string  | Sort column(s), descending                                         |
| `Include`     | string  | `Total` adds the matching-row count to the response [DOCS]         |
| `Fields`      | string  | Comma list of columns to return [DOCS]                             |
| `Meta`        | string  | ServiceStack metadata pass-through (rarely needed)                 |

**Combining filters:** multiple parameters AND together on the standard routes. Every
`/Queries/{name}` route has a parallel **`/Queries/OR/{name}`** route with identical
parameters [SPEC] -- the natural reading is that conditions combine with OR there, but the
semantics are [UNVERIFIED]; test on a real instance before relying on OR behavior.

**Date format:** ISO 8601 without timezone -- the wiki examples use
`2017-09-18T00:00:00.000`. [DOCS] Treat values as server-local time; timezone behavior
[UNVERIFIED].

### Row cap: AutoQueryMaxLimit

The `AutoQueryMaxLimit` system setting caps the number of rows any AutoQuery can return
(deliberate DoS guard) [DOCS]. The value is per-customer configuration -- there is **no
documented default you can rely on**. Consequences:

- A large `Take` may be silently clamped. Always read `Total` (via `Include=Total`) and
  page with `Skip`/`Take` rather than trusting one big request.
- If a customer reports truncated results at a consistent row count, that count is almost
  certainly their `AutoQueryMaxLimit`.

---

## DTO-as-URL-Parameters

Jiwa is DTO-in/DTO-out (ServiceStack). For **query and auth requests, the request DTO can
be encoded as URL parameters** instead of a JSON body [DOCS] -- that is exactly what all the
examples here do (`?AccountNoStartsWith=1&Take=5` IS the `DB_MainQuery` DTO, URL-encoded).
For GETs through the Numa connector, always use URL parameters; do not send bodies on GET.

**Content negotiation** [DOCS]: JSON is the default for API clients. `?format=json|xml|csv`
or a `.json`/`.xml`/`.csv` suffix overrides it. You should never need this through the Numa
connector (JSON default), but recognize it in wiki examples -- and note `format=csv` can be
a cheap export trick for tabular query results [UNVERIFIED through the connector].

---

## Common Patterns

### Pattern 1: List & Filter (AutoQuery)

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=5&Fields=DebtorID,AccountNo,Name,EmailAddress&Include=Total",
  "method": "GET"
})
```

This is a real wiki example ("retrieve first 5 customers where the AccountNo starts with
'1', limit which fields are returned") [DOCS]. Response: `QueryResponse` envelope with
`Results` rows containing only the four requested columns.

### Pattern 2: Get by ID (full business object)

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V",
  "method": "GET"
})
```

- The path ID is the entity's **RecID** (`DebtorID` here) -- a 20-character string
  identifier, NOT an account number. Resolve AccountNo → DebtorID via
  `/Queries/DB_Main?AccountNo={no}&Fields=DebtorID` first.
- This is a **full read of the debtor business logic** -- includes notes, documents,
  contact names, delivery addresses, prices, balances, etc. [DOCS]. Large payload; prefer
  `/Queries/*` + `Fields` when you only need a few columns.
- Same shape for `/SalesOrders/{InvoiceID}`, `/Inventory/{InventoryID}`,
  `/Creditors/{CreditorID}`, etc.

### Pattern 3: Get Related / Child Records

Child collections hang off the parent route (plural noun + child ID) [DOCS]:

```
GET /Debtors/{DebtorID}/Notes                  GET /Debtors/{DebtorID}/Notes/{NoteID}
GET /Debtors/{DebtorID}/ContactNames           GET /Debtors/{DebtorID}/DeliveryAddresses
GET /Debtors/{DebtorID}/Documents              GET /Debtors/{DebtorID}/GroupMemberships
GET /Debtors/{DebtorID}/Backorders
GET /SalesOrders/{InvoiceID}/Historys
GET /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines
GET /SalesOrders/{InvoiceID}/Payments          GET /SalesOrders/{InvoiceID}/Notes
```

Alternative: query the child table directly with a parent-ID filter, e.g.
`/Queries/DB_Main`-style table queries exist for child tables too (the wiki names
`DB_NotesQuery`, `DB_DocumentsQuery` -- "return all notes with a given DebtorID") [DOCS].

### Pattern 4: Changed-Since (incremental reads / polling)

Nearly every table carries `LastSavedDateTime` [SPEC], and AutoQuery exposes
`LastSavedDateTimeGreaterThan`:

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Queries/DebtorList?WebAccess=true&LastSavedDateTimeGreaterThan=2026-06-09T00:00:00.000&Fields=AccountNo,Name&Include=Total",
  "method": "GET"
})
```

(Real wiki example: "retrieve web enabled customers that have changed within the last
day".) [DOCS] This is the standard incremental-sync / polling pattern -- see
`01d-event-and-error-handling.md`.

### Pattern 5: Sorting

```
/Queries/SO_Main?OrderBy=InvoiceNo&Take=25
/Queries/DB_Main?OrderByDesc=LastSavedDateTime&Take=20
```

Always set `OrderBy`/`OrderByDesc` when paginating -- without a stable sort, `Skip`/`Take`
pages can overlap or skip rows between requests [UNVERIFIED but standard SQL behavior].

### Pattern 6: Lookup / reference tables

Small reference sets are plain queries: `/Queries/DB_Categories` (all debtor categories),
`/Queries/DB_Categories?CategoryNo=1` (one category number), `/Queries/DB_Classification`,
`/Queries/FX_Currency`, `/Queries/HR_Staff`, `/Queries/FR_Carriers`. [DOCS] [SPEC] These are
cheap; fetch and cache them in-conversation rather than re-querying.

---

## Pagination Handling

### Model [DOCS]

- **Type:** offset (`Skip`) + page size (`Take`)
- **Default page size:** not documented -- ALWAYS pass `Take` explicitly
- **Max rows:** customer's `AutoQueryMaxLimit` (silent clamp)
- **Total count:** only when `Include=Total` is passed → `Total` in the envelope

### Full Pagination Loop

```
Request 1: GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25&Include=Total
Response 1: { "Offset": 0, "Total": 138, "Results": [...25 rows...] }

Request 2: GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25&Skip=25&Include=Total
Response 2: { "Offset": 25, "Total": 138, "Results": [...25 rows...] }

...

Last page: Skip=125 → { "Offset": 125, "Total": 138, "Results": [...13 rows...] }
           ← done when Skip + len(Results) >= Total (or Results comes back short/empty)
```

The wiki confirms this exact flow: "simply setting the Skip property of the request DTO to
25 will have the effect of retrieving the next 25 records" with `Include=Total` providing
the overall count. [DOCS]

### Recommended defaults for the agent

- `Take=25` for display lists, up to `Take=100` for programmatic scans. Don't exceed a few
  hundred -- `AutoQueryMaxLimit` may clamp anyway.
- Always: `Fields=` (only what you need), `OrderBy=` (stable paging), `Include=Total`
  (know when to stop).
- Stop conditions: `Skip + returned >= Total`, or a short/empty `Results` page.

---

## Cache Routes

Routes containing `/Cache` (e.g. `DELETE /Debtors/Cache/{DebtorID}`,
`DELETE /SalesOrders/Cache/{InvoiceID}`, `DELETE /Debtors/Categories/Cache`) appear
throughout the spec. Two things to know:

1. They are **DELETE-only cache-invalidation routes** [SPEC] -- there are no GET `/Cache/`
   read variants in the spec. They evict a cached entry so the next read rebuilds it.
2. They are functional **only when the optional caching plugins are enabled** on the
   customer's instance [DOCS]; the `URLBase` system setting must also be configured for
   cache invalidation (and webhooks) to work [DOCS]. On instances without the caching
   plugin, ignore these routes entirely.

The agent should normally never call them; they exist for Jiwa's own clients. If a customer
complains about stale reads after writes, the caching plugin is the first suspect.

---

## Worked Examples

> URLs/bodies below are reproduced from the official wiki examples pages [DOCS]; the
> response shapes are from the spec [SPEC]. None were executed live.

### Example 1: First 25 sales orders from a warehouse, ordered by invoice number

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Queries/SalesOrderList?PhysicalWarehouseDescription=New South Wales&LogicalWarehouseDescription=Main&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID,AccountNo,DebtorName&OrderBy=InvoiceNo&Include=Total&Take=25",
  "method": "GET"
})
```

```json
{
  "Offset": 0,
  "Total": 412,
  "Results": [
    { "InvoiceID": "000000000800000000NK", "InvoiceNo": "104923", "InvoiceInitDate": "2026-05-30T00:00:00.000",
      "DebtorID": "0000000061000000001V", "AccountNo": "10001", "DebtorName": "Sample Customer Pty Ltd" }
  ]
}
```

**Key points:**

- `SalesOrderList` is the view-backed query -- customer + warehouse columns are already
  joined in (`DebtorName`, `PhysicalWarehouseDescription`), no client-side join needed. [DOCS]
- URL-encode spaces in filter values (`New South Wales` → `New%20South%20Wales`).
- The result rows shown are illustrative [UNVERIFIED]; column NAMES are from the spec.

### Example 2: Find a customer by name fragment, newest first

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Queries/DB_Main?NameContains=smith&OrderByDesc=LastSavedDateTime&Take=10&Fields=DebtorID,AccountNo,Name,EmailAddress,AccountOnHold&Include=Total",
  "method": "GET"
})
```

**Key points:**

- `NameContains` is the substring workhorse -- there is no global free-text search.
- Returns `DebtorID`, which you need for any follow-up entity GET or mutation.
- Case sensitivity follows the SQL Server collation (typically case-insensitive)
  [UNVERIFIED].

### Example 3: Debtor transactions for an account (statement-style question)

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Queries/DebtorTransactionList?AccountNo=10001&OrderByDesc=TranDate&Take=50&Include=Total",
  "method": "GET"
})
```

**Key points:**

- `/Queries/DebtorTransactionList` is the transactions view [SPEC]; exact column names for
  date/amount should be confirmed via a small `Take=1` probe on the customer's instance
  (column sets can differ across Jiwa versions) [UNVERIFIED].
- For balances, prefer the debtor entity GET (`/Debtors/{DebtorID}` returns
  `CurrentBalance` and period balances [SPEC]).

---

## Gotchas & Counter-Exceptions

1. **Empty GET returns 204 No Content, not 200-with-empty-body.** "Will be returned for
   most GET operations -- unless there was nothing to return, then a 204 No Content will be
   returned." [DOCS] Treat 204 as "no data", not an error -- and don't try to JSON-parse the
   empty body.
2. **`Total` is absent unless you ask.** No `Include=Total` → no reliable count. Always pass
   it when paginating.
3. **`AutoQueryMaxLimit` clamps silently.** A `Take=10000` may return far fewer rows with no
   error. Page; never assume one request got everything.
4. **RecIDs are strings and may contain trailing spaces.** Custom-field SettingIDs in
   particular are padded (e.g. `"1ae102b94dc54dfc8a45                "`) and the wiki warns
   the trailing spaces must be preserved/URL-encoded as `%20` in URLs. [DOCS] Never trim IDs
   you got from the API.
5. **Entity GETs are heavy.** `/Debtors/{id}` returns the entire business object graph
   (notes, documents, prices...). For lists or single-column lookups, always use
   `/Queries/*` + `Fields`.
6. **Filters depend on route permissions.** A 403 on a query route means the user's Jiwa
   User Group denies that route -- a Jiwa-side configuration matter, not a malformed
   request. [DOCS] See `01d-event-and-error-handling.md`.
7. **`/Queries/OR/*` semantics are unproven.** The routes exist [SPEC]; do not promise OR
   logic to users until verified on a live instance.
8. **Sales order line data lives under Historys.** Order lines are NOT at
   `/SalesOrders/{id}/Lines` -- they are at
   `/SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines` (snapshot model). [SPEC]
   Get the current `InvoiceHistoryID` from the order GET. See `01c-mutation-patterns.md`.
9. **Plural-noun routes, PascalCase params.** Routes are `/Debtors`, `/SalesOrders`,
   `/Inventory`; all column params are PascalCase exactly as in the spec
   (`AccountNoStartsWith`, not `accountNoStartsWith`). Casing tolerance [UNVERIFIED] --
   match the spec exactly.

---

_Generated from the official Jiwa OpenAPI specification and wiki, Phases 5-6. Not yet
validated against a live instance -- verify before first customer use._
