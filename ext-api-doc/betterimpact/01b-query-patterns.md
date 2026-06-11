---
api_name: 'Better Impact (Volunteer Impact)'
api_slug: 'betterimpact'
generated_from: '00-api-investigation (2026-05-28) + support articles 9824270, 9824266, 9824303 (fetched 2026-06-10)'
generated_date: '2026-06-10'
source_phases: ['Phase 4: Read Patterns & Querying', 'Phase 5: Pagination']
---

# Better Impact -- Query Patterns Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs against
> `https://api.betterimpact.com/v1`, **no Authorization header** (Numa injects Basic auth from
> the user's stored API-key credentials). Facts tagged [DOCS] / [UNVERIFIED] / [UNKNOWN].

## The Envelope (paginated lists) [DOCS]

```json
{
  "Header": {
    "first_item_on_page": 1,
    "has_next_page": true,
    "has_previous_page": false,
    "is_first_page": true,
    "is_last_page": false,
    "last_item_on_page": 100,
    "page_count": 7,
    "page_number": 0,
    "page_size": 100,
    "total_items_count": 643
  },
  "Users": [ ... ]          // or "TimelogEntries": [ ... ]
}
```

- Envelope keys are **PascalCase** (`Header`, `Users`, `TimelogEntries`); fields inside are
  snake_case [DOCS].
- `total_items_count` is the true matching total — use it to report counts without draining [DOCS].
- `by_id_list` endpoints return a **bare JSON array** (no Header) [DOCS].
- Lookup endpoints return bare arrays of small objects [DOCS].

## Pagination [DOCS]

- `page_size`: 1–250, default 100. `page_number`: **0-based**, default 0.
- Loop: request page 0, then increment while `Header.has_next_page == true` (or until
  `is_last_page`).

```
/organization/users/?page_size=250&page_number=0
/organization/users/?page_size=250&page_number=1
...                                                # stop when has_next_page == false
```

Choosing `page_size`:

| Situation                                   | page_size |
| ------------------------------------------- | --------- |
| Interactive chat answer                     | 25–50     |
| Roster scan with includes turned OFF        | 250       |
| Full-profile pulls (all includes on)        | ≤50 — rows are heavy [DOCS fields; payload size [UNVERIFIED]] |

## The Filter Toolset

**No text search exists anywhere** — there is no name/email/keyword parameter on any endpoint
[DOCS — absence]. Filters are exact-token, set, and date-window only:

### Users (`/organization/users/`, `/enterprise/users/`) [DOCS]

| Param | Form | Notes |
| ----- | ---- | ----- |
| `modules` | `volunteer` (or `vol`), `client`/`cli`, `member`/`mem`, `donor`/`don`, `administrator`/`admin`; comma-separated | Omitted → inferred from any `{module}_status` params, else all modules the key has |
| `volunteer_status` | comma-separated tokens (see 01a vocab) | e.g. `accepted,inprocess` |
| `client_status` / `member_status` / `donor_status` / `admin_status` | comma-separated tokens | Per-module status filters |
| `updated_since` | datetime | Profiles updated after this moment — the delta-poll primitive |
| `organization_ids` | comma-separated integers | **Enterprise scope only** |
| `include_custom_fields` / `include_qualifications` / `include_memberships` / `include_verified_volunteers_background_check_results` | `"true"`/`"false"` (default `"true"`) | Payload trimming — the only "fields" control you get |

### Timelog entries (`/organization/timelog_entries`) [DOCS]

| Param | Form | Notes |
| ----- | ---- | ----- |
| `user_ids` / `activity_ids` / `activity_category_ids` / `activity_report_group_ids` | comma-separated integers | Set filters |
| `approved` | `"true"` (default) / `"false"` | No "both" documented — two calls for everything |
| `worked_from` / `worked_to` | datetime | The usual reporting window (date worked) |
| `created_from` / `created_to` | datetime | When the entry was recorded |
| `updated_since` | datetime | Delta polling |
| `include_recorded_feedback_fields` | `"true"`/`"false"` (default `"true"`) | |
| `organization_ids` | comma-separated integers | **Enterprise scope only** |

## Datetime Format (request side) [DOCS]

Filters require ISO 8601 in the .NET round-trip ("O") pattern
`yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK`:

```
2026-06-01T00:00:00.0000000Z
```

Shorter forms (`2026-06-01`, `2026-06-01T00:00:00Z`) are [UNVERIFIED] — **always send the full
form with `.0000000Z`**. URL-encoding the `:` characters is handled by normal URL encoding;
if a date filter 400s, encode the URL fully and retry once [UNVERIFIED]. Returned datetimes
are ISO 8601 UTC strings [DOCS].

## Common Patterns

### Pattern 1: Roster scan (the default list read)

Turn every include OFF — four heavy arrays default to on [DOCS]:

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0"})
```

Report `Header.total_items_count` as the count; drain pages only when you need every row.

### Pattern 2: Find a person by name or email (no search param!)

```
1. Roster scan (Pattern 1) over the relevant module/status — match client-side on
   first_name / last_name / email_address (case-insensitive, try contains-match)
2. Hit → GET /organization/users/{user_id} for the full profile
3. Multiple/zero hits → widen statuses (drop volunteer_status), then say what you scanned
```

Always disclose scan scope: "searched the 643 accepted volunteers" beats a silent partial
answer. For large rosters (>1000), ask the user to narrow (status, module) before draining.

### Pattern 3: Full profile of one user

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/users/12345"})
```

Returns memberships (per-org statuses + `volunteer_total_hours`), custom_fields,
qualifications, background_check_results [DOCS]. Single-user GET include-flag support is
[UNVERIFIED] — it returns the full document; trim nothing, it's one row.

### Pattern 4: Lifetime hours — read the rollup, don't sum timelogs

`memberships[].volunteer_total_hours` is a precomputed lifetime total [DOCS]:

```
GET /organization/users/12345        → memberships[0].volunteer_total_hours
```

Only query `/timelog_entries` when the user wants a **windowed** or **per-activity** total.

### Pattern 5: Hours report for a period

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-05-31T23:59:59.0000000Z&include_recorded_feedback_fields=false&page_size=250&page_number=0"})
```

- Drain pages; sum `hours_worked` (decimal hours) client-side.
- Default scope is **approved entries only** [DOCS]. State that. For unapproved too, repeat
  with `approved=false` and merge [UNVERIFIED two-call workaround].
- Group by `activity_name` / `activity_category_name` / (`first_name`,`last_name`) directly —
  the rows are denormalized, no joins needed [DOCS].

### Pattern 6: One volunteer's hours this quarter

```
GET /organization/timelog_entries?user_ids=12345&worked_from=2026-04-01T00:00:00.0000000Z&worked_to=2026-06-30T23:59:59.0000000Z&page_size=250&page_number=0
```

### Pattern 7: Batch hydration by id list (max 250)

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/by_id_list/users?ids=101,102,103"})
```

Returns a **bare array** of full user documents [DOCS]. Chunk >250 ids into multiple calls.
Whether unknown ids error or are silently dropped is [UNVERIFIED] — reconcile returned
`user_id`s against your request list.

### Pattern 8: Delta polling (what changed since X?)

`updated_since` exists on both users and timelog entries [DOCS]:

```
GET /organization/users/?updated_since=2026-06-09T00:00:00.0000000Z&include_custom_fields=false&include_qualifications=false&include_memberships=true&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0
GET /organization/timelog_entries?updated_since=2026-06-09T00:00:00.0000000Z&page_size=250&page_number=0
```

What counts as an "update" (e.g. whether membership/custom-field edits bump the user's
`date_updated`) is [UNVERIFIED]. Full recipes incl. deletion detection: see 01d.

### Pattern 9: Resolve lookups once per session

```
GET /organization/look_up/activity_categories     → [{activity_category_id, name}]
GET /organization/look_up/custom_fields           → defs + dropdown options
GET /organization/look_up/qualifications          → defs + ranked/exact options
GET /organization/look_up/feedback_fields         → defs + options
```

Tiny, stable — cache in-conversation. They also double as a cheap auth/scope probe.

### Pattern 10: Enterprise (multi-org) queries

```
GET /enterprise/look_up/organizations             → org ids, names, has_*_module flags
GET /enterprise/users/?organization_ids=12,14&modules=volunteer&volunteer_status=accepted&...
GET /enterprise/timelog_entries?organization_ids=12&worked_from=...&worked_to=...
```

Memberships array shows the per-org picture for cross-org people [DOCS]. Only use
`/enterprise/` when the account is known to be enterprise tier (see 01a Scopes).

### Pattern 11: Custom-field file download

```
GET /organization/users/{user_id}/custom_fields/{user_custom_field_id}/file
```

Returns the file as a **byte stream** [DOCS]. Binary safety through the Numa connector path is
[UNVERIFIED] — prefer surfacing the custom field's `value` URL when one is present, and treat
this endpoint as a fallback. (Cross-connector precedent: proxy paths can corrupt binaries.)

## Worked Examples

### Example 1: "How many active volunteers do we have?"

```
1. GET /organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false&page_size=1&page_number=0
2. Answer = Header.total_items_count — one request, no drain [DOCS]
```

### Example 2: "Who volunteered the most hours last month?"

```
1. GET /organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-05-31T23:59:59.0000000Z&include_recorded_feedback_fields=false&page_size=250&page_number=0  (+ drain)
2. Group rows by user_id; sum hours_worked; top-N with first_name/last_name from the rows
3. Caption: "approved hours, May 1–31" (approval default + window)
```

### Example 3: "Which volunteers have a current Working-with-Children check?"

```
1. GET /organization/look_up/qualifications      → find the qualification_id by name
2. Roster scan with include_qualifications=true (others false), page through
3. Client-side: keep users whose qualifications[] contains that qualification_id AND
   (expiry_date is null OR expiry_date > today)
4. Note: qualifications only appear if the API key has Volunteer-module access [DOCS]
```

### Example 4: "Pull Jane Doe's full profile and hours for this year"

```
1. Pattern 2 → user_id (client-side name match; disclose scan scope)
2. GET /organization/users/{id}                        → profile + lifetime hours
3. GET /organization/timelog_entries?user_ids={id}&worked_from=2026-01-01T00:00:00.0000000Z&worked_to=2026-12-31T23:59:59.0000000Z&page_size=250&page_number=0
4. Sum hours_worked; per-activity breakdown from activity_name on the rows
```

## Query Gotchas & Counter-Exceptions

1. **Empty list ≠ no data.** Check, in order: (a) API-key module scope (silently filters —
   suggest the admin verify the key's module checkboxes [DOCS]), (b) status filter too narrow
   (12 volunteer statuses — `accepted` alone misses applicants/inactive), (c) wrong scope
   prefix (`/enterprise/` vs `/organization/`), (d) genuinely none (`total_items_count: 0`).
2. **`page_number=1` skips the first page** — it's 0-based [DOCS]. Off-by-one here silently
   loses the first `page_size` records.
3. **Filter tokens ≠ response strings.** `volunteer_status=accepted` filters; the response says
   a localized "Accepted" (or non-English). Never round-trip response statuses into filters [DOCS].
4. **A date filter that 400s** is probably format: re-send as `2026-06-01T00:00:00.0000000Z`
   (full round-trip form) before concluding the param is wrong [DOCS format; behaviour UNVERIFIED].
5. **`modules` omitted + a status param present** narrows to that module automatically [DOCS] —
   harmless usually, surprising when you pass `volunteer_status` and wonder where donors went.
6. **Activity names can't be listed** — to enumerate activities, aggregate distinct
   `activity_id`/`activity_name` pairs from timelog entries over a window [DOCS — absence].
7. **Don't drain with includes on.** 250 users × 4 embedded arrays is a large payload;
   [UNVERIFIED] size limits — keep scans lean, hydrate individuals on demand.
8. **`worked_from`/`worked_to` vs `created_from`/`created_to`:** hours reports want *worked*;
   audit ("entered last week") wants *created*. Mixing them misstates reports.
9. **Two scopes, one user base:** in enterprise accounts the same `user_id` appears across
   orgs with multiple memberships — dedupe by `user_id`, attribute hours by `organization_id` [DOCS].
