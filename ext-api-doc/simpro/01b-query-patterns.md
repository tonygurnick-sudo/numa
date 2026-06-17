---
api_name: simPRO
api_slug: simpro
doc: query-patterns (companion to 01-llm-api-rules.md) — read operations: filter, sort, paginate
base_url: https://{build}.simprosuite.com/api/v1.0/ (/api/v1.0 is a real path segment)
company_scope: paths shown relative to base; prefix /companies/{companyID}/
headers: every request — Host {build}.simprosuite.com, Authorization: Bearer {access_token}
field_casing: PascalCase
confidence: confirmed (forum / SDK) unless tagged [DOCUMENTED]/[UNKNOWN]/[CONFIRMED]
---

# simPRO — Query Patterns

> Examples omit `Host`/`Authorization` (see frontmatter `headers`).

## Query capability matrix

| Capability            | Supported   | Syntax                                                         | Notes                     |
| --------------------- | ----------- | -------------------------------------------------------------- | ------------------------- |
| Filter by field value | yes         | `?FieldName=value`                                             |                           |
| Wildcard              | yes         | `%` in value: `?GivenName=Rose%`                               |                           |
| Comparison operators  | yes         | `gt() lt() ge() le() ne() between()`                           |                           |
| Date range            | yes         | `If-Modified-Since` header OR `?DateIssued=between(start,end)` |                           |
| Nested-field filter   | yes         | dot notation: `?CustomFields.CustomField.ID=35`                |                           |
| Full-text search      | NO          | —                                                              | no search endpoint exists |
| Sort                  | yes         | `?orderby=Field`                                               |                           |
| Sort direction        | yes         | `?orderby=-Field` (`-` prefix = desc)                          |                           |
| Multi-sort            | yes         | `?orderby=Field1,Field2`                                       |                           |
| Field selection       | yes         | `?columns=Field1,Field2`                                       |                           |
| Include related       | partial     | `?columns=CustomFields`                                        |                           |
| Count                 | header only | `Result-Total` response header                                 |                           |
| AND                   | yes         | multiple params AND-combined                                   |                           |
| OR                    | NO          | not supported                                                  |                           |

## Filter syntax

Field-value:

```
?GivenName=Rose%                 wildcard (%=any chars)
?FamilyName=Smith                exact
?CompanyName=Acme%               wildcard on company name
?GivenName=Rose%&FamilyName=A%   AND-combined
```

Comparison operators (function syntax — write `gt(5)`, not `>5`; `%` goes inside the value):
| Operator | Syntax | Example | Meaning |
| --- | --- | --- | --- |
| greater than | `gt(v)` | `?ID=gt(4)` | ID > 4 |
| less than | `lt(v)` | `?DateIssued=lt(2026-01-01)` | before date |
| greater/equal | `ge(v)` | `?DateIssued=ge(2026-01-01)` | on/after date |
| less/equal | `le(v)` | `?DateIssued=le(2026-12-31)` | on/before date |
| not equal | `ne(v)` | `?Status.Name=ne(Archived)` | exclude value |
| not empty | `ne()` | `?Email=ne()` | field not empty |
| between | `between(a,b)` | `?DateIssued=between(2026-01-01,2026-06-30)` | range inclusive |

Nested-field: `?CustomFields.CustomField.ID=35&CustomFields.Value=Yes`
Date via header: `If-Modified-Since: 2026-03-01T00:00:00` → only records modified since (format `YYYY-MM-ddTHH:mm:ss`).

## Patterns

1. **List & filter:** `GET /companies/{cid}/{resource}/?columns={c1},{c2}&orderby={field}&pageSize={n}&page={p}`
   Params (all optional): `page` (int, default 1, 1-indexed) · `pageSize` (int, default 30, max 250) · `columns` (csv field names) · `orderby` (sort field(s), `-` prefix = desc) · `{FieldName}` (filter, optional operators).
2. **Change detection:** `GET /companies/{cid}/{resource}/?pageSize=250` + header `If-Modified-Since: 2026-03-01T00:00:00`. Do NOT combine `If-Modified-Since` with `orderby=DateModified` and columns like `AssignedTo` → 500.
3. **Get by ID:** `GET /companies/{cid}/{resource}/{id}` (optional `?columns=ID,Type,Status,Totals,CustomFields`).
4. **Sub-resources (nested):** `GET /companies/{cid}/jobs/{jid}/sections/` → `.../sections/{sid}/costCenters/` → `.../costCenters/{ccid}/schedules/`. Each level needs parent IDs in the path; each paginates independently. Hierarchy: `Job > Section > CostCenter > (Labor | Materials | Schedule | ContractorJob | ServiceFee)`.
5. **Comparison filter:** `GET /companies/0/customerInvoices/?DateIssued=gt(2026-01-01)&pageSize=250` · `GET /companies/0/jobs/?DateIssued=between(2026-01-01,2026-06-30)&orderby=-DateIssued`
6. **Wildcard name search:** `GET /companies/0/customers/individuals/?GivenName=Rose%&FamilyName=A%&pageSize=100`
7. **Field selection (reduce payload):** `GET /companies/0/jobs/?columns=ID,Status,DateIssued,Customer,Totals&pageSize=100`. Column names generally match the web UI; use `CustomFields` for user-defined fields; sub-resource columns (e.g. site-address detail) NOT available via `columns`; some columns (e.g. "Amount Remaining") are computed on-the-fly.

## Filter gotchas

- `ID` column not searchable on some endpoints — including it may fail; test first.
- Use `CompanyName` (not `Name`) for company customers.
- `If-Modified-Since` + `orderby=DateModified` + certain columns (`AssignedTo`) → HTTP 500. Remove the column or drop orderby.

## Pagination

Page-number based. Default size 30, max 250. Body = bare JSON array (NOT wrapped). All metadata in response HEADERS:

```
HTTP/1.1 200 OK
Result-Total: 816
Result-Pages: 28
Result-Count: 30
Link: <https://{build}.simprosuite.com/api/v1.0/companies/0/catalogs/?page=2>; rel="next", <...?page=28>; rel="last", <...?page=1>; rel="first"

[{"ID":1,...},{"ID":2,...}]
```

Last-page detection (any one): no `rel="next"` in `Link`; OR `page >= Result-Pages`; OR array length < `pageSize`.

Full loop (Result-Total:816, pageSize:250 → 4 pages):

```
page=1 → Result-Count:250; Link: <...?page=2>; rel="next", <...?page=4>; rel="last"
page=2 → Result-Count:250; Link: ...rel="first", <...?page=3>; rel="next", <...?page=4>; rel="last"
page=3 → Result-Count:250
page=4 → Result-Count:66;  Link: ...rel="first", <...?page=3>; rel="prev"  (no "next" = last)
```

## Worked examples

1. **All jobs, key fields, newest first:** `GET /companies/0/jobs/?columns=ID,Type,Status,DateIssued,Customer,Site&orderby=-DateIssued&pageSize=250&page=1`. Check `Result-Total`; fetch pages until no `rel="next"`.
2. **Invoices by date range:** `GET /companies/0/customerInvoices/?DateIssued=between(2026-01-01,2026-03-31)&pageSize=250`. Also use `gt()/lt()/ge()/le()` for open-ended ranges.
3. **Job sub-resource hierarchy:** `GET /companies/0/jobs/123/sections/` → `GET /companies/0/jobs/123/sections/1/costCenters/` → `GET /companies/0/jobs/123/sections/1/costCenters/1/schedules/`. Each level needs parent IDs.

## Cross-cutting gotchas

- Pagination metadata is in headers, not body.
- Column names match the UI, not always camelCase (some use spaces / differ from expected).
- Default page size is only 30 — always set `pageSize` (up to 250).
- `companyID=0` only works on single-company builds; verify with `GET /companies/` if unsure.
- Comparison operators use function syntax (`gt(5)` not `>5`); `%` wildcard goes inside the value string.
