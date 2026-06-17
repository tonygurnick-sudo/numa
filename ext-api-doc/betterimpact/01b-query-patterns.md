---
api_name: Better Impact (Volunteer Impact)
api_slug: betterimpact
doc: query patterns (pagination, filters, person lookup, hours reporting, worked examples)
call_surface: connectors(name="request", params={connector:"betterimpact", url (relative, no /v1, no Authorization header), method:"GET"}). Numa injects Basic auth.
confidence: docs-derived (article 9824270, 2026-06-10), NOT live-validated. [UNVERIFIED]/[UNKNOWN] tagged inline; else [DOCS].
companions: 01=api-rules, 01a=domain-model, 01c=read-only/write-asks, 01d=events+errors
---

# Better Impact — Query Patterns

## The envelope (paginated lists)

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
  "Users": []
}
```

- Envelope keys **PascalCase** (`Header`, `Users`, `TimelogEntries`); fields inside snake_case.
- `total_items_count` is the true matching total — report counts without draining.
- `by_id_list` and lookup endpoints return **bare arrays** (no Header).

## Pagination

`page_size` 1–250 (default 100); `page_number` **0-based** (default 0). Loop page 0 upward while `Header.has_next_page == true` (or until `is_last_page`):

```
/organization/users/?page_size=250&page_number=0
/organization/users/?page_size=250&page_number=1   # stop when has_next_page == false
```

Choosing `page_size`: interactive chat 25–50 · roster scan, includes OFF 250 · full-profile pulls (includes on) ≤50 (rows heavy [payload size UNVERIFIED]).

## Filter toolset

**No text search anywhere** — no name/email/keyword param on any endpoint. Filters are exact-token, set, date-window only.

### Users (`/organization/users/`, `/enterprise/users/`)

| Param                                                                                                                         | Form                                                                                                 | Notes                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `modules`                                                                                                                     | `volunteer`/`vol`, `client`/`cli`, `member`/`mem`, `donor`/`don`, `administrator`/`admin`; comma-sep | Omitted → inferred from any `{module}_status` param, else all modules the key has |
| `volunteer_status`                                                                                                            | comma-sep tokens (01a vocab)                                                                         | e.g. `accepted,inprocess`                                                         |
| `client_status`/`member_status`/`donor_status`/`admin_status`                                                                 | comma-sep tokens                                                                                     | Per-module status                                                                 |
| `updated_since`                                                                                                               | datetime                                                                                             | Profiles updated after this moment — the delta-poll primitive                     |
| `organization_ids`                                                                                                            | comma-sep integers                                                                                   | **Enterprise only**                                                               |
| `include_custom_fields`/`include_qualifications`/`include_memberships`/`include_verified_volunteers_background_check_results` | `"true"`/`"false"` (default `"true"`)                                                                | The only "fields" control                                                         |

### Timelog (`/organization/timelog_entries`)

| Param                                                                         | Form                                  | Notes                                |
| ----------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| `user_ids`/`activity_ids`/`activity_category_ids`/`activity_report_group_ids` | comma-sep integers                    | Set filters                          |
| `approved`                                                                    | `"true"` (default) / `"false"`        | No "both" — two calls for everything |
| `worked_from`/`worked_to`                                                     | datetime                              | Reporting window (date worked)       |
| `created_from`/`created_to`                                                   | datetime                              | When the entry was recorded          |
| `updated_since`                                                               | datetime                              | Delta polling                        |
| `include_recorded_feedback_fields`                                            | `"true"`/`"false"` (default `"true"`) |                                      |
| `organization_ids`                                                            | comma-sep integers                    | **Enterprise only**                  |

## Datetime format (request side)

ISO 8601 .NET round-trip ("O") pattern `yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK`, e.g. `2026-06-01T00:00:00.0000000Z`. Shorter forms (`2026-06-01`, `…T00:00:00Z`) [UNVERIFIED] — **always send the full `.0000000Z` form**. If a date filter 400s, encode the URL fully and retry once [UNVERIFIED]. Returned datetimes ISO 8601 UTC.

## Common patterns

### 1: Roster scan (default list read) — every include OFF (four heavy arrays default on)

```
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0"})
```

Report `Header.total_items_count` as the count; drain pages only when you need every row.

### 2: Find a person by name/email (no search param!)

1. Roster scan (Pattern 1) over the relevant module/status — match client-side on `first_name`/`last_name`/`email_address` (case-insensitive, try contains-match).
2. Hit → `GET /organization/users/{user_id}` for full profile.
3. Multiple/zero hits → widen statuses (drop `volunteer_status`), then state what you scanned.
   Always disclose scan scope ("searched the 643 accepted volunteers"). For rosters >1000, ask the user to narrow (status, module) before draining.

### 3: Full profile of one user

```
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/users/12345"})
```

Returns memberships (per-org statuses + `volunteer_total_hours`), custom_fields, qualifications, background_check_results. Single-user include-flag support [UNVERIFIED] — returns the full document; trim nothing, one row.

### 4: Lifetime hours — read the rollup, don't sum timelogs

`memberships[].volunteer_total_hours` = precomputed lifetime total:

```
GET /organization/users/12345 → memberships[0].volunteer_total_hours
```

Query `/timelog_entries` only for a **windowed** or **per-activity** total.

### 5: Hours report for a period

```
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-05-31T23:59:59.0000000Z&include_recorded_feedback_fields=false&page_size=250&page_number=0"})
```

- Drain pages; sum `hours_worked` (decimal hours) client-side.
- Default scope = **approved entries only**. State that. For unapproved too, repeat with `approved=false` and merge [UNVERIFIED two-call workaround].
- Group by `activity_name`/`activity_category_name`/(`first_name`,`last_name`) directly — rows are denormalized, no joins.

### 6: One volunteer's hours this quarter

```
GET /organization/timelog_entries?user_ids=12345&worked_from=2026-04-01T00:00:00.0000000Z&worked_to=2026-06-30T23:59:59.0000000Z&page_size=250&page_number=0
```

### 7: Batch hydration by id list (max 250)

```
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/by_id_list/users?ids=101,102,103"})
```

Returns a **bare array** of full user documents. Chunk >250 ids. Whether unknown ids error or are silently dropped [UNVERIFIED] — reconcile returned `user_id`s against the request list.

### 8: Delta polling (what changed since X?)

`updated_since` on both users and timelog entries:

```
GET /organization/users/?updated_since=2026-06-09T00:00:00.0000000Z&include_custom_fields=false&include_qualifications=false&include_memberships=true&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0
GET /organization/timelog_entries?updated_since=2026-06-09T00:00:00.0000000Z&page_size=250&page_number=0
```

What counts as an "update" (whether membership/custom-field edits bump `date_updated`) [UNVERIFIED]. Full recipes incl. deletion detection: 01d.

### 9: Resolve lookups once per session

```
GET /organization/look_up/activity_categories  → [{activity_category_id, name}]
GET /organization/look_up/custom_fields         → defs + dropdown options
GET /organization/look_up/qualifications        → defs + ranked/exact options
GET /organization/look_up/feedback_fields       → defs + options
```

Tiny, stable — cache in-conversation; also a cheap auth/scope probe.

### 10: Enterprise (multi-org) queries

```
GET /enterprise/look_up/organizations  → org ids, names, has_*_module flags
GET /enterprise/users/?organization_ids=12,14&modules=volunteer&volunteer_status=accepted&...
GET /enterprise/timelog_entries?organization_ids=12&worked_from=...&worked_to=...
```

Memberships array shows the per-org picture for cross-org people. Use `/enterprise/` only when the account is known enterprise tier (01a Scopes).

### 11: Custom-field file download

```
GET /organization/users/{user_id}/custom_fields/{user_custom_field_id}/file
```

Returns a **byte stream**. Binary safety through the connector path [UNVERIFIED] — prefer surfacing the custom field's `value` URL when present; treat this endpoint as fallback (cross-connector precedent: proxy paths can corrupt binaries).

## Worked examples

### "How many active volunteers do we have?"

```
1. GET /organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false&page_size=1&page_number=0
2. Answer = Header.total_items_count — one request, no drain
```

### "Who volunteered the most hours last month?"

```
1. GET /organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-05-31T23:59:59.0000000Z&include_recorded_feedback_fields=false&page_size=250&page_number=0  (+ drain)
2. Group rows by user_id; sum hours_worked; top-N with first_name/last_name from the rows
3. Caption: "approved hours, May 1–31" (approval default + window)
```

### "Which volunteers have a current Working-with-Children check?"

```
1. GET /organization/look_up/qualifications → find qualification_id by name
2. Roster scan with include_qualifications=true (others false), page through
3. Client-side: keep users whose qualifications[] contains that qualification_id AND (expiry_date null OR expiry_date > today)
4. Note: qualifications appear only if the key has Volunteer-module access
```

### "Pull Jane Doe's full profile and hours for this year"

```
1. Pattern 2 → user_id (client-side name match; disclose scan scope)
2. GET /organization/users/{id} → profile + lifetime hours
3. GET /organization/timelog_entries?user_ids={id}&worked_from=2026-01-01T00:00:00.0000000Z&worked_to=2026-12-31T23:59:59.0000000Z&page_size=250&page_number=0
4. Sum hours_worked; per-activity breakdown from activity_name on the rows
```

## Query gotchas

1. **Empty list ≠ no data.** Check in order: (a) API-key module scope (silent filter — suggest admin verify key module checkboxes), (b) status filter too narrow (12 volunteer statuses — `accepted` alone misses applicants/inactive), (c) wrong scope prefix (`/enterprise/` vs `/organization/`), (d) genuinely none (`total_items_count:0`).
2. **`page_number=1` skips the first page** — it's 0-based; off-by-one loses the first `page_size` records.
3. **Filter tokens ≠ response strings.** `volunteer_status=accepted` filters; response says localized "Accepted". Never round-trip response statuses into filters.
4. **A date filter that 400s is probably format** — re-send `2026-06-01T00:00:00.0000000Z` (full round-trip form) before concluding the param is wrong [behaviour UNVERIFIED].
5. **`modules` omitted + a status param present** narrows to that module automatically — surprising when you pass `volunteer_status` and wonder where donors went.
6. **Activity names can't be listed** — to enumerate activities, aggregate distinct `activity_id`/`activity_name` pairs from timelog entries over a window.
7. **Don't drain with includes on.** 250 users × 4 embedded arrays = large payload [size limits UNVERIFIED] — keep scans lean, hydrate individuals on demand.
8. **`worked_from`/`worked_to` vs `created_from`/`created_to`:** hours reports want _worked_; audit ("entered last week") wants _created_. Mixing misstates reports.
9. **Two scopes, one user base:** in enterprise accounts the same `user_id` appears across orgs with multiple memberships — dedupe by `user_id`, attribute hours by `organization_id`.
