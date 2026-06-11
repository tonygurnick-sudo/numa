---
api_name: 'Rentman'
api_slug: 'rentman'
generated_from: 'Live OpenAPI spec (oas.json 1.13.0, fetched 2026-06-10) + support article 360013767839'
generated_date: '2026-06-10'
source_phases: ['Phase 4: Read Patterns & Querying']
---

# Rentman -- Query Patterns Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no Authorization header**
> (Numa injects the Bearer token). Facts tagged [SPEC] / [DOCS] / [UNVERIFIED].

## The Envelope (every successful GET)

```json
{
  "data": [ ... ]  or  { ... },
  "itemCount": 50,
  "limit": 50,
  "offset": 0,
  "next_page_url": "https://api.rentman.net/contacts?cursor=eyJ..."   // cursor paging only
}
```

`data` = array for collections, object for `/resource/{id}` [SPEC]. `itemCount` is **items in this
response**, NOT the total matching count [SPEC] — there is no documented total-count field, so
phrase results as "at least N" unless you drained all pages.

## The Four Query Tools

All are query parameters, combinable on any collection GET [SPEC]:

| Param    | Form                              | Notes                                                       |
| -------- | --------------------------------- | ----------------------------------------------------------- |
| `fields` | `?fields=id,name,customer`        | Allowlist of returned fields; `id`, `created`, `modified` always returned [SPEC] |
| `sort`   | `?sort=+name,-created`            | `+` asc / `-` desc; multi-field unreliable with paging (see gotchas) [SPEC] |
| filters  | `?country=gb`, `?folder[isnull]=false`, `?distance[lte]=300` | Field name as key; operators in brackets [SPEC] |
| `expand` | `?expand=customer,customer.creator` | Inline linked objects; ≤3 levels; link-fields only or 400 [SPEC] |

Filter operators: `[lt]` `[gt]` `[lte]` `[gte]` `[neq]` (multi-value `neq` behaves as not-in),
`[isnull]=true|false|1|0` [SPEC]. Equality is the bare param. **No documented free-text/fuzzy
search exists** — name lookups are exact-match filters or client-side matching [SPEC — absence].

**Not queryable:** GENERATED FIELDs and `custom_<n>` fields — neither filter nor sort [SPEC].

## Pagination

Two modes [SPEC]:

### Mode 1 — cursor (default; sorted by id)

`limit` defaults to 300, max 1500. The response carries `next_page_url` — **follow it verbatim**
(it preserves all your filters and carries the cursor) until it is `null`.

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/contacts?limit=100&country=gb"})
# → next_page_url: "https://api.rentman.net/contacts?country=gb&cursor=eyJhZnRlciI6..."
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/contacts?country=gb&cursor=eyJhZnRlciI6..."})   # strip the host, keep everything else
```

- The `cursor` value is opaque — never construct or edit it [SPEC].
- The docs are internally inconsistent about cursor param names (`cursor` in examples,
  `cursor_after`/`cursor_limit` in the envelope description) — following `next_page_url` as-is
  sidesteps the question entirely [SPEC].
- Numa needs relative URLs: drop the `https://api.rentman.net` prefix from `next_page_url`, keep
  path + query string intact [UNVERIFIED — verify the connector accepts the full query string].

### Mode 2 — offset (required for custom sort)

When you sort on anything other than `id`, use `offset` arithmetic; `next_page_url` is not
available in this mode [SPEC]:

```
/contacts?limit=100&sort=+name&offset=0
/contacts?limit=100&sort=+name&offset=100
/contacts?limit=100&sort=+name&offset=200    # stop when itemCount < limit
```

### Choosing `limit`

| Situation                       | limit                                  |
| ------------------------------- | -------------------------------------- |
| Interactive chat answer         | 25–50                                  |
| Drain/export with trimmed fields | 500–1500                              |
| Wide rows (contacts, equipment) | ≤ 300 — the response hard-caps at 5 MB; a 400-class error means reduce `limit` or `fields` [SPEC] |

## Common Patterns

### Pattern 1: List + trim (the default read)

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects?fields=id,name,number,reference,customer&sort=-id&limit=50"})
```

Always set `fields` on collections — Rentman rows are wide (Contact has 72 fields) and generated
roll-ups are omitted from lists anyway unless explicitly requested [SPEC].

### Pattern 2: Get one record, fully expanded

```
connectors(name="request", params={"connector": "rentman", "method": "GET",
  "url": "/projects/123?expand=customer,account_manager,project_type"})
```

Without `expand`, those fields are path strings (`"/contacts/12"`); with it, full objects [SPEC].

### Pattern 3: Project drill-down (the money question)

"What's on project X?" requires walking the satellites [SPEC]:

```
GET /projects/123                                    → header info
GET /projects/123/subprojects                        → status, discounts, financial flags
GET /projects/123/projectequipment?fields=id,name,quantity,unit_price,equipment,equipment_group&limit=500
GET /projects/123/projectcrew?expand=crewmember&fields=id,crewmember,function,planperiod_start,planperiod_end
GET /projects/123/projectfunctions?fields=id,name,type,amount,planperiod_start,planperiod_end
GET /projects/123/costs                              → extra cost lines
```

For totals, request the generated fields explicitly on the single-item GET:

```
GET /projects/123?fields=id,name,project_total_price,project_rental_price,project_crew_price,already_invoiced
```

[UNVERIFIED whether single-item GETs include generated fields without `?fields` — request them
explicitly either way.]

### Pattern 4: Find a contact by name/email

No fuzzy search — equality filters only [SPEC]:

```
GET /contacts?email_1=jane@acme.example&fields=id,displayname,name,type
# name match: pull candidates and match client-side
GET /contacts?fields=id,displayname,name,firstname,surname,email_1&limit=1500
```

For big address books, drain pages and match case-insensitively client-side; tell the user if you
only scanned a subset. Whether string filters are case-sensitive is [UNVERIFIED].

### Pattern 5: Date windows — use `modified`/`created`, NOT period fields

On projects/subprojects the period fields (`planperiod_*`, `usageperiod_*`) are **GENERATED — not
filterable** [SPEC]. Workable server-side windows:

```
GET /projects?modified[gte]=2026-06-01T00:00:00&sort=-modified&limit=200      # recently changed
GET /projects?created[gte]=2026-01-01T00:00:00&fields=id,name,number,created  # created this year
```

For "projects happening next week", filter where the dates are REAL fields: project functions
(`planperiod_start` is a plain field on `/projectfunctions` [SPEC]) or crew lines:

```
GET /projectfunctions?planperiod_start[gte]=2026-06-15T00:00:00&planperiod_start[lte]=2026-06-21T23:59:59&fields=id,name,project,subproject,planperiod_start,planperiod_end
```

then resolve `project` links. (On `/projectcrew`, `planperiod_*` are plain fields too [SPEC];
on `/projectequipment` they are GENERATED — don't filter there.) Datetime literal format accepted
by filters is [UNVERIFIED] — mirror the format the API returns; URL-encode if needed.

### Pattern 6: Unpaid invoices — client-side, by design

`is_paid`, `outstanding_balance`, `date_sent` are GENERATED → not filterable [SPEC]. Pattern:

```
GET /invoices?fields=id,number,displayname,date,expiration,customer,price_invat,total_paid,outstanding_balance,is_paid&sort=-id&limit=300
```

then filter `is_paid == false` in your own reasoning/code. Requesting generated fields via
`?fields` is allowed — only *querying* on them is not [SPEC].

### Pattern 7: Crew availability for a period

```
GET /crew?active=true&fields=id,displayname,email,external&limit=300
GET /crew/45/crewavailability?start[gte]=2026-06-15T00:00:00&end[lte]=2026-06-21T23:59:59
# status: B = available, N = unavailable, O = unknown [SPEC]
```

Cross-check actual bookings via `/projectcrew?crewmember=/crew/45&planperiod_start[gte]=...`
[UNVERIFIED — whether link fields filter by path string or integer id; try path string first,
then bare integer].

### Pattern 8: Equipment stock check

```
GET /equipment?in_archive=false&fields=id,name,code,rental_sales,price,current_quantity,critical_stock_level&limit=500
```

`current_quantity*` are GENERATED — fine to *request*, impossible to *filter* ("items below
critical stock" = client-side comparison) [SPEC].

### Pattern 9: Files on a record (download URLs)

```
GET /projects/123/files?fields=id,readable_name,size,type,url,proxy_url
```

`url`/`proxy_url` are GENERATED download links [SPEC]; lifetime/auth [UNVERIFIED] — fetch fresh
each time, present the link or pull the bytes immediately, never cache URLs.

### Pattern 10: Resolve lookups once per session

```
GET /statuses?fields=id,name          → subproject status names (workspace-specific)
GET /projecttypes?fields=id,name
GET /taskstatuses?fields=id,name
GET /ledgercodes?fields=id,displayname
```

Cache these in-conversation; they're tiny and stable.

## Worked Examples

### Example 1: "What equipment is planned on the Smith wedding?"

```
1. GET /projects?fields=id,name,number&sort=-id&limit=300        # find it (client-side name match)
2. GET /projects/812/projectequipment?fields=id,name,quantity,unit_price,is_option,equipment_group&limit=500
3. Group by equipment_group; flag is_option=true rows as "optional"; sum quantity×unit_price
   (label the sum approximate — discounts/factors apply [SPEC fields exist])
```

### Example 2: "Who's working this weekend?"

```
1. GET /projectcrew?planperiod_start[gte]=2026-06-13T00:00:00&planperiod_start[lte]=2026-06-14T23:59:59&expand=crewmember,function&fields=id,crewmember,function,planperiod_start,planperiod_end,transport
2. Present crew name (crewmember.displayname), function name, times.
```

### Example 3: Full contact export (cursor drain)

```
url = "/contacts?limit=1500&fields=id,displayname,type,name,email_1,phone_1,country"
while url:
    resp = connectors(request, url)
    rows += resp.data
    url = strip_host(resp.next_page_url)    # null → stop
```

50k/day budget makes full drains cheap (a 10k-contact book = 7 requests) [SPEC].

### Example 4: "Show me invoice 2026-0042 with its lines"

```
1. GET /invoices?number=2026-0042&fields=id,number,date,price_invat,total_paid,is_paid
2. GET /invoices/{id}/invoicelines
3. Note for the user: lines are accounting lines (ledger/VAT), not the PDF layout [SPEC].
```

## Query Gotchas & Counter-Exceptions

1. **`itemCount` = page size, not total.** Never report it as "total projects".
2. **Multi-field `sort` + pagination misorders pages** — only the first sort field is applied
   server-side before paging [SPEC]. One sort field when paging; sort the rest client-side.
3. **GENERATED + `limit`/`offset` ⇒ no sorting on that field at all** [SPEC]. `?sort=-is_paid`
   style calls will fail or misbehave — expect a 400 [UNVERIFIED which].
4. **Expanding a non-link field is a hard 400** [SPEC]. Only fields documented as links
   (path-string examples like `"/crew/0"`) are expandable.
5. **Filters silently AND together** [UNVERIFIED] — there is no documented OR. Multiple values on
   one key are documented only for `neq` (not-in).
6. **Wide resources + high limit can blow the 5 MB cap** — the API errors rather than truncating
   [SPEC]. Retry with `fields` or smaller `limit`.
7. **Empty result ≠ wrong query** — could be role-scoping by the token's user [DOCS]. If the user
   insists data exists, suspect the token's role before your filter.
8. **Sub-collection endpoints** (`/projects/{id}/projectequipment`) may omit relevant parent
   fields ("custom child collections" caveat) [SPEC] — if a field is missing there, fetch the rows
   from the top-level resource with a filter instead.
