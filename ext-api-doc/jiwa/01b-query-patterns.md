---
api_name: Jiwa Financials
api_slug: jiwa
doc: query-patterns-reference (companion to 01-llm-api-rules.md)
base_url: per-customer self-hosted instance; no shared host. call_surface: HTTP via `numa integrations request` (connector jiwa). Bearer key injected by backend — never set auth, never use absolute URLs.
field_casing: PascalCase (params exactly as in spec: AccountNoStartsWith, not accountNoStartsWith)
confidence: spec/docs-derived, NOT live-validated. [SPEC]=OpenAPI, [DOCS]=Jiwa wiki, [UNVERIFIED]=inferred. Expect drift per plugins / route permissions / Jiwa version (7 vs 8).
---

# Jiwa Financials — Query Patterns

Read operations: AutoQuery filtering, sorting, pagination, field selection. Call form: `GET /Queries/DB_Main?Take=25` (relative url via `numa integrations request`). GETs never carry a body — encode the query DTO as URL params.

## Query capabilities summary

| Capability               | Supported    | Syntax                                              | Notes                                                           |
| ------------------------ | ------------ | --------------------------------------------------- | --------------------------------------------------------------- |
| Filter by field value    | Yes          | `?AccountNo=10001`                                  | Every column of a `/Queries/*` route is a query param [SPEC]    |
| Filter by string pattern | Yes          | `?NameContains=smith`, `?AccountNoStartsWith=1`     | Per-column StartsWith/EndsWith/Contains/Like [SPEC]             |
| Filter by date range     | Yes          | `?LastSavedDateTimeGreaterThan=2026-06-01T00:00:00` | GreaterThan(OrEqualTo)/LessThan(OrEqualTo)/Between [SPEC]       |
| Full-text search         | No           | —                                                   | No global search; use per-column `Contains`                     |
| Sort by field            | Yes          | `?OrderBy=AccountNo`                                | `OrderByDesc` for descending [SPEC]                             |
| Field selection          | Yes          | `?Fields=DebtorID,AccountNo,Name`                   | Trims response to listed columns [DOCS]                         |
| Include related records  | No (queries) | —                                                   | `/Queries/*` are flat rows; full GET-by-ID returns children     |
| Aggregation / count      | Total only   | `?Include=Total`                                    | Adds `Total` (matching-row count) [DOCS]                        |
| Logical AND/OR           | AND default  | Multiple params AND together                        | `/Queries/OR/...` twins exist [SPEC]; OR semantics [UNVERIFIED] |
| Comparison operators     | Yes          | Suffix per column                                   | Numeric/date columns get GT/GTE/LT/LTE/NE/Between/In [SPEC]     |
| Membership (IN list)     | Yes          | `?AccountNoIn=...`                                  | Comma separator (ServiceStack convention) [UNVERIFIED]          |
| Null checks              | No           | —                                                   | Not exposed in spec params                                      |

## The two read surfaces

1. **`/Queries/*` AutoQuery routes (152 ops)** — read-only, SQL-view/table-backed, flat rows, rich filtering, pagination, field selection. **The right surface for find/list/report questions.** E.g. `/Queries/DB_Main` (debtors), `/Queries/IN_Main` (inventory), `/Queries/SO_Main` (sales orders), `/Queries/SalesOrderList`, `/Queries/DebtorList`, `/Queries/InventoryItemList`, `/Queries/DebtorTransactionList`, `/Queries/BackOrderList`, `/Queries/HR_Staff` [SPEC].
2. **Entity GET routes** — `/Debtors/{DebtorID}`, `/SalesOrders/{InvoiceID}`, `/Inventory/{InventoryID}`… Return the **full business DTO including child collections** (notes, documents, contact names, delivery addresses, prices, lines, payments). Heavy. Use only when you have the RecID and need the whole object or its children [DOCS].

Two AutoQuery flavors [DOCS]:

- **Table queries** — every table has a query class: `DB_Main` → `/Queries/DB_Main`, `SO_Main` → `/Queries/SO_Main`, `IN_Main` → `/Queries/IN_Main`. Raw table columns.
- **View-backed list queries** — denormalized views joining several tables: `/Queries/SalesOrderList` (order + customer + warehouse + delivery), `/Queries/DebtorList`, `/Queries/InventoryItemList`. Prefer these for human-meaningful columns (`DebtorName`, `PhysicalWarehouseDescription`) without client-side joining.

## Response envelope (AutoQuery) [SPEC]

Every `/Queries/*` response is a `QueryResponse<T>`:
`{"Offset":0,"Total":1372,"Results":[{"DebtorID":"0000000061000000001V","AccountNo":"10001","Name":"..."}],"Meta":{},"ResponseStatus":null}`

- `Results` — row objects (trimmed to `Fields` if passed).
- `Total` — count of ALL rows matching the filter, **only populated with `Include=Total`** [DOCS]; without it expect 0/absent — don't read that as "no data".
- `Offset` — echoes your `Skip`. `ResponseStatus` — error container, null on success (see 01d).

## AutoQuery filtering conventions

ServiceStack AutoQuery. Each route exposes ~400–500 query params [SPEC]: every column of the table/view plus per-column condition variants (verified across `DB_Main`, `IN_Main`, `SalesOrderList` in the spec).

**String columns:**

| Param             | Meaning              | Example                                             |
| ----------------- | -------------------- | --------------------------------------------------- |
| `{Col}`           | Exact match          | `?AccountNo=10001`                                  |
| `{Col}StartsWith` | Prefix               | `?AccountNoStartsWith=1`                            |
| `{Col}EndsWith`   | Suffix               | `?NameEndsWith=Ltd`                                 |
| `{Col}Contains`   | Substring            | `?NameContains=plumb`                               |
| `{Col}Like`       | SQL LIKE             | wildcard char [UNVERIFIED] (`%` per SQL convention) |
| `{Col}Between`    | Range (two values)   | separator [UNVERIFIED] (comma per ServiceStack)     |
| `{Col}In`         | Membership in a list | separator [UNVERIFIED] (comma per ServiceStack)     |

**Numeric/date columns:** `{Col}` (equal), `{Col}GreaterThan` (>), `{Col}GreaterThanOrEqualTo` (>=), `{Col}LessThan` (<), `{Col}LessThanOrEqualTo` (<=), `{Col}NotEqualTo` (!=), `{Col}Between` / `{Col}In`.

**Boolean columns:** exact match only — `?AccountOnHold=true`, `?WebAccess=true` [SPEC].

**Structural params (every `/Queries/*` route) [SPEC]:** `Skip` (rows to skip, 0-based), `Take` (page size), `OrderBy` (sort columns; comma list [UNVERIFIED for multi-column]), `OrderByDesc` (descending), `Include` (`Total` adds match count [DOCS]), `Fields` (comma list of columns [DOCS]), `Meta` (ServiceStack metadata pass-through, rarely needed).

**Combining filters:** multiple params AND together on standard routes. Every `/Queries/{name}` has a parallel **`/Queries/OR/{name}`** with identical params [SPEC] — natural reading is OR-combine, but semantics [UNVERIFIED]; test before relying on OR.

**Date format:** ISO 8601 without timezone — wiki examples use `2017-09-18T00:00:00.000` [DOCS]. Treat as server-local time; timezone behavior [UNVERIFIED].

**Row cap — `AutoQueryMaxLimit`:** system setting caps rows any AutoQuery returns (DoS guard) [DOCS]. Per-customer value — **no documented default**. A large `Take` may be silently clamped; always read `Total` (`Include=Total`) and page with `Skip`/`Take`. A consistent truncated row count = almost certainly the customer's `AutoQueryMaxLimit`.

## DTO-as-URL-parameters

Jiwa is DTO-in/DTO-out (ServiceStack). For query/auth requests the DTO can be URL-params instead of a JSON body [DOCS] — what these examples do (`?AccountNoStartsWith=1&Take=5` IS the `DB_MainQuery` DTO, URL-encoded). For GETs through Numa, always use URL params; never send a body on GET.

**Content negotiation** [DOCS]: JSON is default for API clients. `?format=json|xml|csv` or a `.json`/`.xml`/`.csv` suffix overrides it. Never needed through Numa (JSON default), but recognize it in wiki examples; `format=csv` can be a cheap export trick for tabular results [UNVERIFIED through the connector].

## Common patterns

**1 — List & filter (AutoQuery):**
`GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=5&Fields=DebtorID,AccountNo,Name,EmailAddress&Include=Total`
Real wiki example ("first 5 customers where AccountNo starts with '1', limited fields") [DOCS]. Response: `QueryResponse` with `Results` rows containing only the four requested columns.

**2 — Get by ID (full business object):** `GET /Debtors/0000000061000000001V`

- Path ID is the entity's **RecID** (`DebtorID`), NOT an account number. Resolve AccountNo → DebtorID via `GET /Queries/DB_Main?AccountNo={no}&Fields=DebtorID` first.
- Full read of the debtor business object — notes, documents, contact names, delivery addresses, prices, balances [DOCS]. Large payload; prefer `/Queries/*` + `Fields` for a few columns.
- Same shape: `/SalesOrders/{InvoiceID}`, `/Inventory/{InventoryID}`, `/Creditors/{CreditorID}`.

**3 — Get related / child records:** child collections hang off the parent route (plural noun + child ID) [DOCS]:

```
GET /Debtors/{DebtorID}/Notes                  GET /Debtors/{DebtorID}/Notes/{NoteID}
GET /Debtors/{DebtorID}/ContactNames           GET /Debtors/{DebtorID}/DeliveryAddresses
GET /Debtors/{DebtorID}/Documents              GET /Debtors/{DebtorID}/GroupMemberships
GET /Debtors/{DebtorID}/Backorders
GET /SalesOrders/{InvoiceID}/Historys
GET /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines
GET /SalesOrders/{InvoiceID}/Payments          GET /SalesOrders/{InvoiceID}/Notes
```

Alternative: query the child table directly with a parent-ID filter — table queries exist for child tables too (wiki names `DB_NotesQuery`, `DB_DocumentsQuery` — "return all notes with a given DebtorID") [DOCS].

**4 — Changed-since (incremental reads / polling):** nearly every table carries `LastSavedDateTime` [SPEC]; AutoQuery exposes `LastSavedDateTimeGreaterThan`:
`GET /Queries/DebtorList?WebAccess=true&LastSavedDateTimeGreaterThan=2026-06-09T00:00:00.000&Fields=AccountNo,Name&Include=Total`
Real wiki example ("web-enabled customers changed within the last day") [DOCS]. Standard incremental-sync/polling pattern — see 01d.

**5 — Sorting:** `/Queries/SO_Main?OrderBy=InvoiceNo&Take=25`, `/Queries/DB_Main?OrderByDesc=LastSavedDateTime&Take=20`. Always set `OrderBy`/`OrderByDesc` when paginating — without a stable sort, `Skip`/`Take` pages can overlap or skip rows [UNVERIFIED but standard SQL behavior].

**6 — Lookup / reference tables:** small reference sets are plain queries — `/Queries/DB_Categories` (all debtor categories), `/Queries/DB_Categories?CategoryNo=1`, `/Queries/DB_Classification`, `/Queries/FX_Currency`, `/Queries/HR_Staff`, `/Queries/FR_Carriers` [DOCS][SPEC]. Cheap; fetch and cache in-conversation rather than re-query.

## Pagination

Offset (`Skip`) + page size (`Take`). **No documented default page size — ALWAYS pass `Take`.** Max rows = customer's `AutoQueryMaxLimit` (silent clamp). Total count only when `Include=Total` is passed → `Total` in the envelope [DOCS].

```
Request 1: GET /Queries/DB_Main?AccountNoStartsWith=1&OrderBy=AccountNo&Take=25&Include=Total
           → { "Offset": 0, "Total": 138, "Results": [...25 rows...] }
Request 2: ...&Skip=25  → { "Offset": 25, "Total": 138, "Results": [...25 rows...] }
Last page: ...&Skip=125 → { "Offset": 125, "Total": 138, "Results": [...13 rows...] }
           ← done when Skip + len(Results) >= Total (or Results comes back short/empty)
```

Wiki confirms this flow: "setting the Skip property of the request DTO to 25 retrieves the next 25 records" with `Include=Total` providing the count [DOCS].

**Agent defaults:** `Take=25` for display lists, up to `Take=100` for programmatic scans (don't exceed a few hundred — `AutoQueryMaxLimit` may clamp). Always: `Fields=` (only what's needed), `OrderBy=` (stable paging), `Include=Total` (know when to stop). Stop when `Skip + returned >= Total`, or a short/empty `Results` page.

## Cache routes

Routes containing `/Cache` (e.g. `DELETE /Debtors/Cache/{DebtorID}`, `DELETE /SalesOrders/Cache/{InvoiceID}`, `DELETE /Debtors/Categories/Cache`) appear throughout the spec:

1. **DELETE-only cache-invalidation routes** [SPEC] — no GET `/Cache/` read variants. Evict a cached entry so the next read rebuilds it.
2. Functional **only when the optional caching plugins are enabled** [DOCS]; the `URLBase` system setting must also be configured (for cache invalidation and webhooks) [DOCS]. Without the caching plugin, ignore these routes.

The agent should normally never call them (they exist for Jiwa's own clients). If a customer reports stale reads after writes, the caching plugin is the first suspect.

## Worked examples

> URLs from official wiki examples [DOCS]; response shapes from spec [SPEC]; none executed live.

**1 — First 25 sales orders from a warehouse, ordered by invoice number:**
`GET /Queries/SalesOrderList?PhysicalWarehouseDescription=New South Wales&LogicalWarehouseDescription=Main&Fields=InvoiceID,InvoiceNo,InvoiceInitDate,DebtorID,AccountNo,DebtorName&OrderBy=InvoiceNo&Include=Total&Take=25`
→ `{"Offset":0,"Total":412,"Results":[{"InvoiceID":"000000000800000000NK","InvoiceNo":"104923","InvoiceInitDate":"2026-05-30T00:00:00.000","DebtorID":"0000000061000000001V","AccountNo":"10001","DebtorName":"Sample Customer Pty Ltd"}]}`

- `SalesOrderList` is the view-backed query — customer + warehouse columns already joined (`DebtorName`, `PhysicalWarehouseDescription`), no client-side join [DOCS].
- URL-encode spaces in filter values (`New South Wales` → `New%20South%20Wales`).
- Result rows illustrative [UNVERIFIED]; column NAMES from spec.

**2 — Find a customer by name fragment, newest first:**
`GET /Queries/DB_Main?NameContains=smith&OrderByDesc=LastSavedDateTime&Take=10&Fields=DebtorID,AccountNo,Name,EmailAddress,AccountOnHold&Include=Total`

- `NameContains` is the substring workhorse — no global free-text search.
- Returns `DebtorID`, needed for any follow-up entity GET or mutation.
- Case sensitivity follows the SQL Server collation (typically case-insensitive) [UNVERIFIED].

**3 — Debtor transactions for an account (statement-style):**
`GET /Queries/DebtorTransactionList?AccountNo=10001&OrderByDesc=TranDate&Take=50&Include=Total`

- `/Queries/DebtorTransactionList` is the transactions view [SPEC]; confirm exact date/amount column names via a small `Take=1` probe (column sets differ across Jiwa versions) [UNVERIFIED].
- For balances, prefer the debtor entity GET (`/Debtors/{DebtorID}` returns `CurrentBalance` and period balances [SPEC]).

## Gotchas & counter-exceptions

1. **Empty GET returns 204 No Content, not 200-with-empty-body.** "Will be returned for most GET operations — unless there was nothing to return, then a 204 No Content" [DOCS]. Treat 204 as "no data", not an error; don't JSON-parse the empty body.
2. **`Total` is absent unless you ask** (`Include=Total`). No count otherwise — always pass it when paginating.
3. **`AutoQueryMaxLimit` clamps silently.** A `Take=10000` may return far fewer rows with no error. Page; never assume one request got everything.
4. **RecIDs are strings and may contain trailing spaces.** Custom-field SettingIDs are padded (`"1ae102b94dc54dfc8a45                "`); the wiki warns trailing spaces must be preserved/URL-encoded as `%20` [DOCS]. Never trim IDs from the API.
5. **Entity GETs are heavy.** `/Debtors/{id}` returns the entire business object graph. For lists or single-column lookups, always use `/Queries/*` + `Fields`.
6. **Filters depend on route permissions.** A 403 on a query route = the user's User Group denies it — a Jiwa-side config matter, not a malformed request [DOCS]. See 01d.
7. **`/Queries/OR/*` semantics are unproven.** Routes exist [SPEC]; don't promise OR logic until verified live.
8. **Sales order line data lives under Historys**, not at `/SalesOrders/{id}/Lines` — at `/SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines` (snapshot model) [SPEC]. Get the current `InvoiceHistoryID` from the order GET. See 01c.
9. **Plural-noun routes, PascalCase params.** Routes are `/Debtors`, `/SalesOrders`, `/Inventory`; all column params are PascalCase exactly as in spec (`AccountNoStartsWith`). Casing tolerance [UNVERIFIED] — match spec exactly.
