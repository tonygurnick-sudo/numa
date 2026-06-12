---
api_name: 'Better Impact (Volunteer Impact)'
api_slug: 'betterimpact'
version: 'v1 (api.betterimpact.com/v1)'
generated_from: '00-api-investigation (2026-05-28) + support articles 9824270, 9824266, 9824303 (fetched 2026-06-10)'
generated_date: '2026-06-10'
update_source: 'official support-article docs — no authenticated live calls made'
line_count_target: '< 300 lines'
---

# Better Impact -- Workspace Agent API Rules

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the Better Impact integration is active.**
> It must stay under 300 lines. Companion files (01a–01d) hold the detailed reference material.
> Facts are tagged [DOCS] (official support articles), [CONFIRMED — live probe 2026-05-28]
> (unauthenticated probes only), or [UNVERIFIED] (inferred). Items the investigation could not
> resolve are kept as [UNKNOWN] — do not guess past them.

## Context

- **API:** Better Impact v1 — volunteer management (Volunteer Impact). The same API serves the
  Donor / Client / Member Impact products; data is module-scoped per API key [DOCS]
- **Base URL:** `https://api.betterimpact.com/v1` — configured in Numa; use **relative URLs**
  like `/organization/users/` (never repeat `/v1`) [DOCS]
- **Auth:** HTTP Basic with an admin-created API-key **username + password pair** —
  **injected automatically by Numa from the user's vault. NEVER set auth headers.** [DOCS]
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **READ-ONLY:** no POST/PUT/PATCH/DELETE endpoints are documented anywhere [DOCS — absence;
  see 01c]. The API is positioned as an export surface ("half of the bridge") [DOCS]
- **Rate limits:** [UNKNOWN — not documented]. Pace conservatively (≤2 req/s sequential)
- **Field casing:** snake_case (`user_id`, `date_updated`) with two documented oddballs:
  `linkedIn_profile_url`, `Instagram_username` [DOCS]. Envelope keys are PascalCase
  (`Header`, `Users`, `TimelogEntries`) [DOCS]
- **IDs:** integers everywhere (`user_id`, `timelog_entry_id`, `organization_id`) [DOCS]

## How to Call

```
connectors(name="request", params={
  "connector": "betterimpact",
  "url": "/organization/users/?page_size=50&page_number=0",
  "method": "GET"
})
```

- Numa injects `Authorization: Basic <base64(username:password)>` from the user's stored
  API-key credentials — **you never see or set them**.
- Relative `url` expands against `https://api.betterimpact.com/v1`.
- GET only — there is nothing to POST (see 01c before promising any write).

## Auth Structure

An ADMIN creates the API key in Better Impact (Configuration → Organization Settings →
Security Settings → API Keys → [+ Create API Key]); the system generates a username +
password pair [DOCS]. The Numa user stores that pair via the inline chat credential card.

- **Module-scoped keys:** the key only returns data for the modules checked at creation
  (Volunteer, Client, Member, Donor, Administrator). A key without the Volunteer module
  simply **omits volunteers from results — no error is raised** [DOCS].
- **Qualifications require Volunteer-module access on the key; custom fields require access to
  the modules set on each field** (intersection logic) — otherwise silently omitted [DOCS].
- **Key deleted/disabled → 401.** The user reconnects Better Impact via the chat credential
  card (admin must issue a new key first). Do not retry. [DOCS + CONFIRMED 401 behaviour]
- Key expiry/rotation policy: [UNKNOWN — not documented].

## Scopes: organization vs enterprise

Every data endpoint exists under two prefixes [DOCS]:

- `/organization/...` — single-organization accounts (the common case; **default to this**)
- `/enterprise/...` — multi-org enterprise tier; adds `organization_ids` filtering and the
  org/report-group lookups. Behaviour when the account lacks the tier is [UNVERIFIED] —
  if `/enterprise/` fails or comes back empty, fall back to `/organization/`.

## Response Envelope

Paginated lists return `{"Header": {...}, "Users": [...]}` or `{"Header": {...},
"TimelogEntries": [...]}` — PascalCase keys [DOCS]. `Header` carries `page_number`,
`page_size`, `page_count`, `total_items_count`, `has_next_page`, `is_last_page`, etc. [DOCS].
`by_id_list` endpoints return a **bare array** of documents (no Header) [DOCS]. Lookup
endpoints return arrays of small objects [DOCS]. Error body shape: [UNKNOWN].

## Capabilities

### CAN

1. List users/volunteers with filters: module, per-module status, `updated_since`; rich
   profile incl. memberships, custom fields, qualifications, background checks [DOCS]
2. Fetch single users and batch-fetch by ID list (max 250 ids) [DOCS]
3. List timelog (hours) entries filtered by user, activity, category, report group,
   approval status, created/worked/updated date windows [DOCS]
4. Download custom-field file attachments (byte stream) [DOCS]
5. Read lookup tables: activity categories (org), organizations + activity report groups
   (enterprise), qualifications, custom field defs, feedback field defs [DOCS]
6. Delta-poll changes via `updated_since` on users and timelog entries [DOCS]

### CANNOT

1. **Write anything** — no create/update/delete endpoints exist for any entity [DOCS — absence]
2. Search users by name or email — no text-search parameter exists; filter is status/module/
   date only, so person lookup = page through + match client-side [DOCS — absence]
3. List activities themselves — only activity *categories*; activity ids/names appear
   denormalized on timelog entries [DOCS — absence]
4. Read schedules, shifts, availability, messages, or Donor/Client-specific entities beyond
   membership status fields on the user record [DOCS — absence]
5. Receive webhooks — none documented; polling only (see 01d) [UNKNOWN — searched, none found]

## Critical Gotchas

1. **Missing modules → EMPTY results, not 403.** A key scoped without a module silently drops
   that module's users/fields. If data the user swears exists comes back empty, **suggest the
   admin check the API key's module checkboxes** before debugging the query. [DOCS]
2. **Never prefix paths with `/v1`** — the base URL already ends in `/v1`. `/v1/organization/...`
   through the connector would produce `/v1/v1/...` [UNVERIFIED failure mode — avoid it].
3. **`page_number` is 0-BASED** (first page is 0, default 0); `page_size` 1–250, default 100 [DOCS].
4. **Envelope keys are PascalCase** (`Header`, `Users`, `TimelogEntries`) while fields inside are
   snake_case — and `by_id_list` returns a bare array with no Header [DOCS].
5. **Datetime params need the .NET round-trip format** `yyyy-MM-ddTHH:mm:ss.fffffffK`, e.g.
   `2026-06-01T00:00:00.0000000Z` [DOCS]. Whether shorter ISO forms are accepted is
   [UNVERIFIED] — always send the full form. Returned datetimes are ISO 8601 UTC [DOCS].
6. **Timelog `approved` defaults to `"true"`** — unapproved hours are excluded unless you ask.
   No documented "both" value: query twice (`approved=true`, then `approved=false`) when the
   user wants everything [DOCS default; two-call workaround UNVERIFIED].
7. **Status filter values are compact lowercase tokens** (`inactiveshortterm`,
   `archivedquit`) but status fields in responses are **localized display strings** — never
   compare a response status to a filter token [DOCS].
8. **No user search param.** "Find Jane Smith" = list users (trim includes, max page_size) and
   match `first_name`/`last_name`/`email_address` client-side; disclose partial scans [DOCS — absence].
9. **Include flags default to `"true"`** (`include_custom_fields`, `include_qualifications`,
   `include_memberships`, `include_verified_volunteers_background_check_results`) — user rows
   are heavy by default. Set them `false` on wide scans; re-fetch one user for full detail [DOCS].
10. **Boolean params are strings** `"true"`/`"false"` in the query string [DOCS].
11. **`hours_worked` is decimal HOURS** (number), not minutes [DOCS].
12. **When `modules` is omitted, modules are inferred from any `{module}_status` params you
    pass** (e.g. `volunteer_status=accepted` implies the volunteer module) [DOCS].
13. **Some lookups are scope-exclusive:** `activity_categories` is organization-only;
    `organizations` and `activity_report_groups` are enterprise-only [DOCS].
14. **Mirror documented trailing slashes** (`/organization/users/` has one; `/organization/
    timelog_entries` does not). Significance is [UNVERIFIED] — copy the forms in this file.
15. **Error bodies are [UNKNOWN]** — only 401 is confirmed (empty/uncaptured body). Read the
    status code first; quote any body verbatim rather than interpreting it.

## Default Parameters

| Parameter            | Default                                    | Reason                                          |
| -------------------- | ------------------------------------------ | ----------------------------------------------- |
| `page_size`          | 50 for chat answers; 250 for drains        | API default 100, max 250 [DOCS]                 |
| `page_number`        | `0` (zero-based)                           | Walk up while `has_next_page` [DOCS]            |
| include flags        | `false` on list scans                      | Rows are heavy with all four includes on [DOCS] |
| `modules`            | `volunteer` for volunteer questions        | Avoid mixing donors/clients into results        |
| `approved` (timelog) | leave default `true`; state it in answers  | Unapproved hours hidden by default [DOCS]       |
| Pacing               | ≤2 req/s sequential                        | Rate limits [UNKNOWN] — fly conservatively      |

## Working Examples

### Example 1: List accepted volunteers (trimmed)

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false&page_size=100&page_number=0"})
```

Response: `{"Header": {..., "total_items_count": N, "has_next_page": ...}, "Users": [...]}` [DOCS].

### Example 2: One user, full profile

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/users/12345"})
```

Includes memberships, custom_fields, qualifications, background_check_results arrays [DOCS].

### Example 3: Hours worked in May 2026 (approved only)

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-05-31T23:59:59.0000000Z&page_size=250&page_number=0"})
```

Sum `hours_worked` client-side; say "approved hours" (default filter) [DOCS].

### Example 4: Lookup activity categories

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/look_up/activity_categories"})
```

Returns `[{"activity_category_id": 1, "name": "..."}]` [DOCS].

## Proxy API Operations (full catalog — the API is small)

All GET, relative paths. Swap `organization` ↔ `enterprise` where both exist [DOCS].

| Operation                    | Path                                                            | Notes                              |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| List users                   | `/organization/users/` · `/enterprise/users/`                   | Filters: modules, statuses, updated_since |
| Single user                  | `/organization/users/{user_id}`                                 | Full profile                       |
| Users by id list             | `/organization/by_id_list/users?ids=1,2,3`                      | Max 250 ids; bare array            |
| Custom-field file            | `/organization/users/{user_id}/custom_fields/{user_custom_field_id}/file` | Byte stream             |
| List timelog entries         | `/organization/timelog_entries`                                 | Date windows, user/activity filters |
| Single timelog entry         | `/organization/timelog_entries/{id}`                            |                                    |
| Timelogs by id list          | `/organization/by_id_list/timelog_entries?ids=...`              | Max 250 ids; bare array            |
| Activity categories          | `/organization/look_up/activity_categories`                     | **Org scope only**                 |
| Organizations                | `/enterprise/look_up/organizations`                             | **Enterprise scope only**          |
| Activity report groups       | `/enterprise/look_up/activity_report_groups`                    | **Enterprise scope only**          |
| Qualifications (defs)        | `/organization/look_up/qualifications`                          | Both scopes                        |
| Custom fields (defs)         | `/organization/look_up/custom_fields`                           | Both scopes                        |
| Feedback fields (defs)       | `/organization/look_up/feedback_fields`                         | Both scopes                        |

## Pagination

- `page_size` (1–250, default 100) + `page_number` (0-based, default 0) [DOCS]
- Loop while `Header.has_next_page == true`; `total_items_count` is the real total [DOCS]
- `by_id_list` endpoints don't paginate — cap at 250 ids per call [DOCS]

## Error Handling

Only 401 is live-confirmed; everything else is [UNKNOWN]/[UNVERIFIED]. Details in 01d.

| Status | Meaning                                        | Action                                                        |
| ------ | ---------------------------------------------- | ------------------------------------------------------------- |
| 401    | Key deleted, disabled, or wrong credentials [DOCS] | **Reconnect via the chat credential card** (admin may need to issue a new key). Do not retry |
| 400    | [UNVERIFIED] — likely bad param/date format    | Re-send datetimes in full round-trip format; check param names |
| 403    | [UNKNOWN if ever used] — module gaps return EMPTY data instead [DOCS] | Treat any 403 body verbatim |
| 404    | Wrong id or path [UNVERIFIED]                  | Verify id via a list query; check path against the catalog     |
| 429    | [UNKNOWN — no documented rate limit]           | Back off 5s → 15s → 60s; halve pacing for the session          |
| 5xx    | Server error                                   | Retry once after 5s (reads are safe — the API is read-only)    |

## Known Limitations

1. **Nothing live-validated through Numa** — all shapes are docs-derived; trust real responses
   over this file and note discrepancies
2. **Read-only** — any "create/update/log/delete" ask must be redirected (see 01c)
3. **No webhooks** — change detection is `updated_since` polling only (see 01d)
4. **No text search** — person lookup is paged scan + client-side match
5. **Rate limits, error bodies, key expiry all [UNKNOWN]** — pace conservatively, quote errors verbatim
6. **Empty ≠ none:** module-scoped keys silently omit data — check key modules on surprising emptiness

---

_Generated 2026-06-10 from official Better Impact support docs. See companion files:_

- _01a-domain-model-reference.md — Entities, scopes, full field tables, status vocabularies_
- _01b-query-patterns.md — Pagination, filters, person lookup, hours reporting, worked examples_
- _01c-mutation-patterns.md — Read-only reality: what users will ask, what to say, alternatives_
- _01d-event-and-error-handling.md — Polling recipes, error triage, reconnect flow_
