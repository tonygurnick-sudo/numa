---
api_name: Better Impact (Volunteer Impact)
api_slug: betterimpact
base_url: https://api.betterimpact.com/v1
base_url_ends_in_v1: true
path_rule: pass paths WITHOUT /v1; base_url already ends in /v1. e.g. pass "/organization/users/" → server hits ".../v1/organization/users/". Prefixing "/v1/..." yourself = "/v1/v1/..." (404).
path_version_segment: already baked into base_url; never add another
call_surface: HTTP via connectors(name="request", params={connector:"betterimpact", url, method}). NOT a file source (no list-files/download-file). MCP n/a.
method: GET only — read-only API, no POST/PUT/PATCH/DELETE anywhere
auth: HTTP Basic, injected by Numa from user vault (username+password = admin-created API key pair). NEVER set Authorization yourself.
field_casing: snake_case fields; PascalCase envelope keys (Header, Users, TimelogEntries). Documented oddballs: linkedIn_profile_url, Instagram_username.
id_format: integer (user_id, timelog_entry_id, organization_id)
rate_limit: UNKNOWN/undocumented — pace ≤2 req/s sequential, no parallel fan-out
integration_path: native data connector (authType username-password)
confidence: every fact is docs-derived (official support articles 9824270/9824266/9824303, 2026-06-10) — NOT live-validated through the connector. Tagged [CONFIRMED] = live unauth probe 2026-05-28; else [UNVERIFIED]/[UNKNOWN]. Trust real responses over this file.
companions: 01a=domain-model, 01b=query-patterns, 01c=read-only/write-asks, 01d=events+errors
---

# Better Impact — API Rules

## Paths (read first)

- Base URL `https://api.betterimpact.com/v1` ALREADY ENDS IN `/v1`. Pass flat paths WITHOUT `/v1`: `/organization/users/`, `/organization/timelog_entries`. `/v1/...` yourself → `/v1/v1/...` → 404. No separate version segment to add.
- Every data endpoint has two scope prefixes: `/organization/...` (single-org — **default**), `/enterprise/...` (multi-org tier only). Use `/enterprise/` only when the account is known enterprise; if it fails or comes back empty, fall back to `/organization/`.
- Mirror documented trailing slashes: `/organization/users/` has one, `/organization/timelog_entries` does not. Significance [UNVERIFIED] — copy the catalog forms.

## Call surface & auth

- HTTP via `connectors(name="request", params={"connector":"betterimpact","url":"/organization/users/?page_size=50&page_number=0","method":"GET"})`. NOT a file source — no list-files/download-file/search-files.
- `url` relative, expands against base URL. `method` always `GET`.
- Numa injects `Authorization: Basic base64(username:password)` from the user's stored API-key pair. Never see or set auth headers.
- Key deleted/disabled → **401** [CONFIRMED behaviour]. Do NOT retry/loop — user reconnects via the chat credential card (admin issues a new key first). See 01d reconnect flow.

## CAN

1. List users/volunteers; filters: module, per-module status, `updated_since`. Profile includes memberships, custom fields, qualifications, background checks.
2. Get single user; batch-fetch by id list (max 250 ids).
3. List timelog (hours) entries; filter by user, activity, category, report group, approval, created/worked/updated windows.
4. Download custom-field file attachments (byte stream).
5. Read lookups: activity categories (org), organizations + activity report groups (enterprise), qualifications, custom-field defs, feedback-field defs.
6. Delta-poll via `updated_since` on users and timelog entries.

## CANNOT

1. **Write anything** — no create/update/delete endpoint for any entity (see 01c). API is an export surface ("half of the bridge").
2. Search users by name/email/keyword — **no text-search param**; person lookup = page + match client-side (gotcha 8).
3. List activities — only activity _categories_; activity ids/names appear denormalized on timelog entries.
4. Read schedules, shifts, availability, messages, or Donor/Client entities beyond membership status fields.
5. Receive webhooks — none; **polling only** (01d).

## Gotchas

1. **Missing modules → EMPTY results, NOT 403.** A key scoped without a module silently drops that module's users/fields. Qualifications need Volunteer-module access; custom fields need module-intersection. If data the user swears exists comes back empty, **first suggest the admin check the API key's module checkboxes**, then debug the query.
2. **Never prefix `/v1`** — base URL already ends in `/v1`; `/v1/...` → `/v1/v1/...`.
3. **`page_number` is 0-BASED** (first page 0, default 0). `page_size` 1–250, default 100. `page_number=1` skips page 1.
4. **Envelope keys PascalCase** (`Header`, `Users`, `TimelogEntries`); fields inside snake_case. `by_id_list` returns a **bare array** (no Header).
5. **Datetime params need the .NET round-trip form** `yyyy-MM-ddTHH:mm:ss.fffffffK`, e.g. `2026-06-01T00:00:00.0000000Z`. Shorter ISO forms [UNVERIFIED] — always send the full form. Returned datetimes are ISO 8601 UTC.
6. **Timelog `approved` defaults to `"true"`** — unapproved hours excluded. No "both" value; query twice (`approved=true`, then `approved=false`) for everything.
7. **Status filter values are compact lowercase tokens** (`inactiveshortterm`, `archivedquit`); response status fields are **localized display strings**. Never feed a response status back into a filter.
8. **No user-search param.** "Find Jane Smith" = list users (max `page_size`, includes off) + match `first_name`/`last_name`/`email_address` client-side; disclose the scan scope.
9. **Include flags default `"true"`** (`include_custom_fields`, `include_qualifications`, `include_memberships`, `include_verified_volunteers_background_check_results`) — user rows are heavy. Set `false` on wide scans; re-fetch one user for full detail.
10. **Boolean params are strings** `"true"`/`"false"`.
11. **`hours_worked` is decimal HOURS** (number), not minutes.
12. **`modules` omitted + a `{module}_status` param present** → modules inferred from it (e.g. `volunteer_status=accepted` implies the volunteer module).
13. **Scope-exclusive lookups:** `activity_categories` org-only; `organizations` and `activity_report_groups` enterprise-only.
14. **Error bodies [UNKNOWN]** — only 401 confirmed (empty body). Read status code first; quote any body verbatim, don't interpret.

## Defaults (override only if the user specifies)

`page_size`=50 (chat) / 250 (drains; max 250) · `page_number`=0 · include flags=`false` on list scans · `modules`=`volunteer` for volunteer questions · `approved`=default `true` (state it) · pacing ≤2 req/s sequential.

## Operations (all GET; swap `organization`↔`enterprise` where both exist)

| Operation              | Path                                                                      | Notes                                     |
| ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| List users             | `/organization/users/` · `/enterprise/users/`                             | Filters: modules, statuses, updated_since |
| Single user            | `/organization/users/{user_id}`                                           | Full profile                              |
| Users by id list       | `/organization/by_id_list/users?ids=1,2,3`                                | Max 250 ids; bare array                   |
| Custom-field file      | `/organization/users/{user_id}/custom_fields/{user_custom_field_id}/file` | Byte stream                               |
| List timelog           | `/organization/timelog_entries`                                           | Date windows, user/activity filters       |
| Single timelog         | `/organization/timelog_entries/{id}`                                      | —                                         |
| Timelogs by id list    | `/organization/by_id_list/timelog_entries?ids=...`                        | Max 250 ids; bare array                   |
| Activity categories    | `/organization/look_up/activity_categories`                               | **Org only**                              |
| Organizations          | `/enterprise/look_up/organizations`                                       | **Enterprise only**                       |
| Activity report groups | `/enterprise/look_up/activity_report_groups`                              | **Enterprise only**                       |
| Qualifications (defs)  | `/organization/look_up/qualifications`                                    | Both scopes                               |
| Custom fields (defs)   | `/organization/look_up/custom_fields`                                     | Both scopes                               |
| Feedback fields (defs) | `/organization/look_up/feedback_fields`                                   | Both scopes                               |

## Pagination

`page_size` (1–250, default 100) + `page_number` (0-based, default 0). `Header` carries `page_number`, `page_size`, `page_count`, `total_items_count`, `has_next_page`, `is_last_page`, etc. Loop while `Header.has_next_page == true`; `total_items_count` = true total (counts without draining). `by_id_list` returns a bare array (no Header) and doesn't paginate — cap 250 ids/call. Lookup endpoints return arrays of small objects. Error body shape [UNKNOWN].

## Errors (only 401 confirmed; rest [UNVERIFIED]/[UNKNOWN] — details 01d)

| Status | Meaning                                                        | Action                                                                           |
| ------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 401    | Key deleted/disabled/wrong creds [DOCS+CONFIRMED]              | Reconnect via chat credential card (admin may need a new key). Do NOT retry      |
| 400    | [UNVERIFIED] bad param/date format                             | Re-send datetimes in full round-trip form; check param names (01b)               |
| 403    | [UNKNOWN if ever used] — module gaps return EMPTY data instead | Treat body verbatim                                                              |
| 404    | [UNVERIFIED] wrong id/path                                     | Verify id via a list; check path (no `/v1`, exact scope prefix + trailing slash) |
| 429    | [UNKNOWN — no documented limit]                                | Back off 5s→15s→60s; halve pacing for the session                                |
| 5xx    | Server error                                                   | Retry once after 5s (GET-only — safe)                                            |

## Examples

1. List accepted volunteers (trimmed):
   `connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false&page_size=100&page_number=0"})`
   → `{"Header":{...,"total_items_count":N,"has_next_page":...},"Users":[...]}`

2. One user, full profile:
   `connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/users/12345"})`
   → `memberships`, `custom_fields`, `qualifications`, `background_check_results` arrays.

3. Hours worked May 2026 (approved only):
   `connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-05-31T23:59:59.0000000Z&page_size=250&page_number=0"})`
   → sum `hours_worked` client-side; caption "approved hours" (default filter).

4. Lookup activity categories:
   `connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/look_up/activity_categories"})`
   → `[{"activity_category_id":1,"name":"..."}]`
