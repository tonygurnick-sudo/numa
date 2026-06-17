---
api_name: Rentman
api_slug: rentman
base_url: https://api.rentman.net
path_version_segment: none
call_surface: HTTP via `connectors(name="request", params={connector:"rentman", url, method})` — relative URLs, NO Authorization header (Numa injects the Bearer token)
doc_role: on-demand reference (01b) — pagination, fields/sort/filter/expand, worked read examples
confidence: spec-derived [SPEC] (OpenAPI 1.13.0, 2026-06-10) unless [DOCS]/[UNVERIFIED]. NOT live-validated through Numa.
---

# Rentman — Query Patterns Reference

## The envelope (every successful GET)

`{"data": [...] | {...}, "itemCount": 50, "limit": 50, "offset": 0, "next_page_url": "https://api.rentman.net/contacts?cursor=eyJ..." }` — `next_page_url` cursor-mode only.

`data` = array (collection) or object (`/resource/{id}`). `itemCount` = **items in this response, NOT the total matching count** — there is no documented total-count field, so phrase results as "at least N" unless you drained all pages.

## The four query tools

Query params, combinable on any collection GET:
| Param | Form | Notes |
| --- | --- | --- |
| `fields` | `?fields=id,name,customer` | allowlist of returned fields; `id`/`created`/`modified` always returned |
| `sort` | `?sort=+name,-created` | `+` asc / `-` desc; multi-field unreliable with paging (see gotchas) |
| filters | `?country=gb`, `?folder[isnull]=false`, `?distance[lte]=300` | field name as key; operators in brackets |
| `expand` | `?expand=customer,customer.creator` | inline linked objects; ≤3 levels; link-fields only or 400 |

Filter operators: `[lt] [gt] [lte] [gte] [neq]` (multi-value `neq` = not-in), `[isnull]=true|false|1|0`. Equality = bare param. **No documented free-text/fuzzy search** — name lookups are exact-match filters or client-side matching.

**Not queryable:** GENERATED FIELDs and `custom_<n>` — neither filter nor sort.

## Pagination — two modes

### Mode 1 — cursor (default; sorted by id)

`limit` defaults to 300, max 1500. Response carries `next_page_url` — **follow it verbatim** (it preserves all filters + carries the cursor) until `null`.

```
GET /contacts?limit=100&country=gb
# → next_page_url: "https://api.rentman.net/contacts?country=gb&cursor=eyJhZnRlciI6..."
GET /contacts?country=gb&cursor=eyJhZnRlciI6...   # strip the host, keep everything else
```

- The `cursor` value is opaque — never construct or edit it.
- Docs are internally inconsistent about cursor param names (`cursor` in examples, `cursor_after`/`cursor_limit` in the envelope description) — following `next_page_url` as-is sidesteps it.
- Numa needs relative URLs: drop the `https://api.rentman.net` prefix from `next_page_url`, keep path + query intact [UNVERIFIED — verify the connector accepts the full query string].

### Mode 2 — offset (required for custom sort)

When sorting on anything other than `id`, use `offset` arithmetic; `next_page_url` is unavailable:

```
/contacts?limit=100&sort=+name&offset=0
/contacts?limit=100&sort=+name&offset=100
/contacts?limit=100&sort=+name&offset=200    # stop when itemCount < limit
```

### Choosing `limit`

| Situation                        | limit                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| Interactive chat answer          | 25–50                                                                    |
| Drain/export with trimmed fields | 500–1500                                                                 |
| Wide rows (contacts, equipment)  | ≤300 — 5 MB hard cap; a 400-class error means reduce `limit` or `fields` |

## Common patterns

### Pattern 1: List + trim (the default read)

```
GET /projects?fields=id,name,number,reference,customer&sort=-id&limit=50
```

Always set `fields` on collections — rows are wide (Contact = 72 fields) and generated roll-ups are omitted from lists unless explicitly requested.

### Pattern 2: Get one record, fully expanded

```
GET /projects/123?expand=customer,account_manager,project_type
```

Without `expand`, those fields are path strings (`"/contacts/12"`); with it, full objects.

### Pattern 3: Project drill-down (the money question)

"What's on project X?" walks the satellites:

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

[UNVERIFIED whether single-item GETs include generated fields without `?fields` — request them explicitly either way.]

### Pattern 4: Find a contact by name/email

No fuzzy search — equality filters only:

```
GET /contacts?email_1=jane@acme.example&fields=id,displayname,name,type
# name match: pull candidates, match client-side
GET /contacts?fields=id,displayname,name,firstname,surname,email_1&limit=1500
```

For big address books, drain pages and match case-insensitively client-side; tell the user if you scanned only a subset. String-filter case sensitivity is [UNVERIFIED].

### Pattern 5: Date windows — use `modified`/`created`, NOT period fields

On projects/subprojects, period fields (`planperiod_*`, `usageperiod_*`) are **GENERATED — not filterable**. Workable server-side windows:

```
GET /projects?modified[gte]=2026-06-01T00:00:00&sort=-modified&limit=200      # recently changed
GET /projects?created[gte]=2026-01-01T00:00:00&fields=id,name,number,created  # created this year
```

For "projects happening next week", filter where the dates are REAL fields: `/projectfunctions` (`planperiod_start` is plain there) or crew lines:

```
GET /projectfunctions?planperiod_start[gte]=2026-06-15T00:00:00&planperiod_start[lte]=2026-06-21T23:59:59&fields=id,name,project,subproject,planperiod_start,planperiod_end
```

then resolve `project` links. (`planperiod_*` are plain fields on `/projectcrew` too; GENERATED on `/projectequipment` — don't filter there.) Datetime literal format accepted by filters is [UNVERIFIED] — mirror what the API returns; URL-encode if needed.

### Pattern 6: Unpaid invoices — client-side, by design

`is_paid`, `outstanding_balance`, `date_sent` are GENERATED → not filterable. Pattern:

```
GET /invoices?fields=id,number,displayname,date,expiration,customer,price_invat,total_paid,outstanding_balance,is_paid&sort=-id&limit=300
```

then filter `is_paid == false` in your own reasoning/code. Requesting generated fields via `?fields` is allowed — only _querying_ on them is not.

### Pattern 7: Crew availability for a period

```
GET /crew?active=true&fields=id,displayname,email,external&limit=300
GET /crew/45/crewavailability?start[gte]=2026-06-15T00:00:00&end[lte]=2026-06-21T23:59:59
# status: B = available, N = unavailable, O = unknown
```

Cross-check actual bookings via `/projectcrew?crewmember=/crew/45&planperiod_start[gte]=...` [UNVERIFIED — link fields filter by path string or integer id; try path string first, then bare integer].

### Pattern 8: Equipment stock check

```
GET /equipment?in_archive=false&fields=id,name,code,rental_sales,price,current_quantity,critical_stock_level&limit=500
```

`current_quantity*` are GENERATED — fine to _request_, impossible to _filter_ ("items below critical stock" = client-side comparison).

### Pattern 9: Files on a record (download URLs)

```
GET /projects/123/files?fields=id,readable_name,size,type,url,proxy_url
```

`url`/`proxy_url` are GENERATED download links; lifetime/auth [UNVERIFIED] — fetch fresh each time, present the link or pull the bytes immediately, never cache URLs.

### Pattern 10: Resolve lookups once per session

```
GET /statuses?fields=id,name          → subproject status names (workspace-specific)
GET /projecttypes?fields=id,name
GET /taskstatuses?fields=id,name
GET /ledgercodes?fields=id,displayname
```

Cache in-conversation; tiny and stable.

## Worked examples

### "What equipment is planned on the Smith wedding?"

```
1. GET /projects?fields=id,name,number&sort=-id&limit=300        # find it (client-side name match)
2. GET /projects/812/projectequipment?fields=id,name,quantity,unit_price,is_option,equipment_group&limit=500
3. Group by equipment_group; flag is_option=true rows as "optional"; sum quantity×unit_price
   (label the sum approximate — discounts/factors apply)
```

### "Who's working this weekend?"

```
1. GET /projectcrew?planperiod_start[gte]=2026-06-13T00:00:00&planperiod_start[lte]=2026-06-14T23:59:59&expand=crewmember,function&fields=id,crewmember,function,planperiod_start,planperiod_end,transport
2. Present crew name (crewmember.displayname), function name, times.
```

### Full contact export (cursor drain)

```
url = "/contacts?limit=1500&fields=id,displayname,type,name,email_1,phone_1,country"
while url:
    resp = connectors(request, url)
    rows += resp.data
    url = strip_host(resp.next_page_url)    # null → stop
```

50k/day budget makes full drains cheap (a 10k-contact book = 7 requests).

### "Show me invoice 2026-0042 with its lines"

```
1. GET /invoices?number=2026-0042&fields=id,number,date,price_invat,total_paid,is_paid
2. GET /invoices/{id}/invoicelines
3. Tell the user: lines are accounting lines (ledger/VAT), not the PDF layout.
```

## Query gotchas & counter-exceptions

1. **`itemCount` = page size, not total.** Never report it as "total projects".
2. **Multi-field `sort` + paging misorders pages** — only the first sort field is applied server-side before paging. One sort field when paging; sort the rest client-side.
3. **GENERATED + `limit`/`offset` ⇒ no sorting on that field at all.** `?sort=-is_paid`-style calls fail or misbehave — expect a 400 [UNVERIFIED which].
4. **Expanding a non-link field is a hard 400.** Only fields documented as links (path-string examples like `"/crew/0"`) are expandable.
5. **Filters silently AND together** [UNVERIFIED] — no documented OR. Multiple values on one key are documented only for `neq` (not-in).
6. **Wide resources + high limit can blow the 5 MB cap** — the API errors rather than truncating. Retry with `fields` or smaller `limit`.
7. **Empty result ≠ wrong query** — could be role-scoping by the token's user [DOCS]. If the user insists data exists, suspect the token's role before your filter.
8. **Sub-collection endpoints** (`/projects/{id}/projectequipment`) may omit relevant parent fields ("custom child collections" caveat) — if a field is missing there, fetch the rows from the top-level resource with a filter instead.
