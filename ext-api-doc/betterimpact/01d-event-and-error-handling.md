---
api_name: 'Better Impact (Volunteer Impact)'
api_slug: 'betterimpact'
generated_from: '00-api-investigation (2026-05-28) + support articles 9824270, 9824266, 9824303 (fetched 2026-06-10)'
generated_date: '2026-06-10'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns', 'Phase 9: Error Handling']
---

# Better Impact -- Event & Error Handling Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> All examples use the Numa `connectors` tool form — relative URLs, **no Authorization header**
> (Numa injects Basic auth from the user's stored API-key credentials). Facts tagged
> [DOCS] / [UNVERIFIED] / [UNKNOWN]. The investigation found NO documentation for error bodies,
> rate limits, or webhooks — those [UNKNOWN]s are preserved here, not papered over.

## Event-Driven Capabilities

| Mechanism           | Platform has it?                  | Available to Numa? | Notes                                          |
| ------------------- | --------------------------------- | ------------------ | ---------------------------------------------- |
| Webhooks (outbound) | Not mentioned anywhere [UNKNOWN — searched, nothing found] | No | Neither the API reference nor any support article |
| WebSocket / SSE     | Not mentioned                     | No                 |                                                |
| Change feed         | No                                | No                 |                                                |
| Polling             | Yes                               | **Yes — the only option** | `updated_since` on users AND timelog entries [DOCS] |

**Bottom line:** "tell me when X changes in Better Impact" = a Numa scheduled agent polling
`updated_since`. Be explicit with the user about the latency floor (your polling cadence).

## Polling: The Delta Recipe

Both list endpoints take `updated_since` (full round-trip datetime — see 01b) [DOCS]:

```
# Each run: pull everything touched since the last high-water mark (minus 5-min overlap)
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/users/?updated_since=2026-06-10T06:00:00.0000000Z&include_custom_fields=false&include_qualifications=false&include_memberships=true&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0"})

connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/timelog_entries?updated_since=2026-06-10T06:00:00.0000000Z&page_size=250&page_number=0"})
```

1. Drain pages while `Header.has_next_page` — the changed set can exceed one page.
2. New high-water mark = max(`date_updated`) seen; persist it in the workspace, advance it
   **only after a fully successful run**.
3. Overlap the window (mark minus 5 min) and dedupe on `user_id`/`timelog_entry_id` +
   `date_updated` — server clock skew vs your mark is [UNVERIFIED].
4. There is **no sort parameter** [DOCS — absence]; order of results is [UNKNOWN] — never
   assume the last row of the last page is the newest. Compute max() over everything.
5. What bumps a user's `date_updated` (membership edits? custom-field edits? qualification
   changes?) is [UNVERIFIED] — poll timelogs separately; treat user-poll coverage of embedded
   arrays as best-effort until observed.

### Deletions are invisible

`updated_since` never reports deletions/archival removal — records just stop appearing
[UNVERIFIED whether archived users still list under archived statuses; deleted ones won't].
When absence matters (mirroring into another system):

```
1. Periodic full-id sweep: roster scan with all includes off (ids + names only are cheap)
2. Diff against your stored id set → missing ids = deleted, archived out of your filter,
   or module-scope change on the key [DOCS module behaviour] — label it "no longer visible
   via the API", not "deleted"
3. Optionally re-check missing ids via /organization/by_id_list/users?ids=... — present
   there but absent from the filtered list ⇒ status/module change, not deletion [UNVERIFIED]
```

### Cadence guidance

Rate limits are [UNKNOWN] — derive cadence from need, not from limit headroom:

| Need                              | Cadence                              |
| --------------------------------- | ------------------------------------ |
| Daily digest (new applicants, hours summary) | 1×/day scheduled agent    |
| "Within the hour" awareness       | 15–60 min                            |
| Anything faster                   | Push back — no webhooks exist; sub-5-min polling of an undocumented-limit API is rude [UNKNOWN limits] |

## Worked Example: "Tell me when someone new applies to volunteer"

```
Scheduled agent, daily. State: high-water mark + seen user_id set (workspace file).
1. GET /organization/users/?modules=volunteer&volunteer_status=applicant&updated_since={mark}&include_memberships=true&include_custom_fields=false&include_qualifications=false&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0   (+ drain)
2. Rows with user_id not in seen-set → new applicants → summarize (name, email, date_created)
3. updated_since also catches status flips INTO applicant [UNVERIFIED]; the status filter
   keeps the result set tiny either way
4. Advance mark; add ids to seen-set
```

## Worked Example: "Weekly hours digest, flagging unapproved entries"

```
Scheduled agent, Monday 07:00.
1. GET /organization/timelog_entries?worked_from={monday-7d}&worked_to={sunday}&page_size=250&page_number=0            (+ drain) → approved hours (default approved=true [DOCS])
2. Same window with &approved=false → pending entries [DOCS param; "both" needs two calls]
3. Digest: total approved hours, top volunteers/activities (group client-side),
   "N entries awaiting approval" with names — approval itself is UI-only (see 01c)
```

## Rate Limits

**[UNKNOWN — no documentation exists]:** no documented request quota, burst limit, or
throttle headers; no 429 behaviour described. Operate conservatively:

- ≤2 req/s sequential; no parallel fan-out against this connector.
- Full drains are paged at 250 — a 5,000-user roster is 20 requests; pause ~1s between pages.
- Treat any 429 (or limit-shaped error text) as authoritative: back off 5s → 15s → 60s,
  halve pacing for the rest of the session, and note the observed behaviour for these docs.

## Error Handling

Only one error fact is live-confirmed: unauthenticated requests → **HTTP 401** (response body
not captured — likely empty) [CONFIRMED — live probe 2026-05-28]. Everything else: the error
body **format is [UNKNOWN]** — when an error carries a body, quote it verbatim; never invent
field meanings.

| Status | Meaning                                            | Action                                                                 |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| 401    | Bad/deleted/disabled API key [DOCS + CONFIRMED]    | **Reconnect flow below.** Do not retry, do not loop                      |
| 400    | [UNVERIFIED] bad parameter — date format is the prime suspect | Re-send datetime params in full round-trip form; check param spelling against 01b |
| 403    | [UNKNOWN if ever issued] — module gaps return EMPTY DATA instead of 403 [DOCS] | If one appears, surface the body verbatim |
| 404    | [UNVERIFIED] wrong id or path                      | Verify the id via a list query; check the path (no `/v1` prefix, exact trailing slash per 01a catalog) |
| 429    | [UNKNOWN — undocumented]                           | Backoff ladder above                                                     |
| 5xx    | Server error                                       | Retry once after 5s — all calls are GETs, retry is safe                  |

### 401 — the reconnect flow

API keys are admin-managed; an admin deleting or disabling the key (Options → Edit/Delete,
"Enabled" unchecked) kills it [DOCS]. On 401:

1. Stop. Do not retry or vary the request.
2. Tell the user: "Your Better Impact connection is no longer valid — the API key was likely
   deleted, disabled, or changed. You'll need new API credentials to reconnect."
3. New key path (admin): Configuration → Organization Settings → Security Settings →
   API Keys → [+ Create API Key] — check **Enabled** and the **module checkboxes** the user
   needs (Volunteer at minimum for volunteer data) [DOCS].
4. The chat credential card re-captures the new username + password into the user's vault.
5. Re-run the original request once after reconnection.

### The module-scope trap (the 403 that never comes)

A key missing a module does **not** error — it silently returns empty/filtered data [DOCS]:

- Volunteers absent from user lists → Volunteer module unchecked on the key
- `qualifications` array always empty → Volunteer module missing [DOCS]
- A custom field never appearing → the key's modules don't intersect the field's modules [DOCS]

**Whenever data the user insists exists comes back empty, say:** "This can happen when the
API key wasn't created with the right module access — ask your Better Impact admin to check
the key's module checkboxes (Configuration → Organization Settings → Security Settings →
API Keys)." Check this BEFORE debugging filters.

## Error Triage Decision Tree

```
Request failed / data looks wrong
├─ 401                       → key dead → reconnect flow; NEVER retry-loop
├─ 400 [UNVERIFIED]          → my request is wrong
│    ├─ datetime param?      → full round-trip form (2026-06-01T00:00:00.0000000Z), retry once
│    └─ param name/value?    → check 01b tables (status tokens, comma-lists, "true"/"false" strings)
├─ 404 [UNVERIFIED]          → id or path
│    ├─ accidentally sent /v1/... ?         → strip it (base URL already has /v1)
│    └─ path typo / wrong scope prefix?     → check 01 catalog; try /organization/ vs /enterprise/
├─ 429 / limit-shaped error  → back off 5s→15s→60s, halve pacing [UNKNOWN limits]
├─ 5xx                       → retry once after 5s (GET-only API — safe)
└─ 200 but EMPTY / missing data
     ├─ module scope on the key?    → THE prime suspect — suggest admin checks key modules [DOCS]
     ├─ status filter too narrow?   → 12 volunteer statuses; try dropping the filter
     ├─ wrong scope prefix?         → org-tier key on /enterprise/ paths [UNVERIFIED behaviour]
     ├─ approved=true default?      → unapproved timelogs hidden; query approved=false too
     └─ truly none                  → Header.total_items_count == 0 with a broad query
```

## Scheduled Sync Recipe (Numa scheduled agent)

```
Trigger:  daily 07:00 (or 15–60 min for urgent flows)
State:    /workdir high-water marks per resource (ISO datetime) + seen-id sets

1. GET /organization/users/?updated_since={mark-5min}&include_memberships=true
   &include_custom_fields=false&include_qualifications=false
   &include_verified_volunteers_background_check_results=false
   &page_size=250&page_number=0                          (+ drain while has_next_page)
2. GET /organization/timelog_entries?updated_since={mark-5min}&page_size=250&page_number=0
   (+ drain; remember: approved=true default — add a second pass with approved=false
   when pending entries matter [DOCS])
3. Diff against stored ids/date_updated → new vs changed; summarize or push downstream
4. Advance marks to max(date_updated) seen — only after the whole run succeeds
5. Weekly: full-id sweep (includes off) to catch records that vanished (see Deletions)
```

Pace page requests ~1s apart — limits are [UNKNOWN]; a 5,000-user roster is 20 pages.

## Connection Health Check

Cheap probe to classify a sick connection before debugging anything else:

```
connectors(name="request", params={"connector": "betterimpact", "method": "GET",
  "url": "/organization/users/?page_size=1&page_number=0&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false"})
```

- 200 with `Header` → auth + connectivity fine; problems are query- or scope-level
  (`total_items_count: 0` on this unfiltered probe ⇒ suspect key module scope [DOCS])
- 401 → reconnect flow
- Anything else → quote status + body verbatim; check the triage tree

`/organization/look_up/custom_fields` is an alternative probe (tiny, no user data), though
its module-scope sensitivity is [UNVERIFIED].

## Counter-Exception Handling

1. **Worked yesterday, 401 today** → an admin deleted/disabled/recreated the API key [DOCS
   key management] — reconnect; don't debug the query.
2. **Counts dropped suddenly** (e.g. volunteers halved) → key module scope changed, or a bulk
   status change in the org — compare `total_items_count` across status filters before alarm.
3. **`updated_since` returns nothing despite known changes** → datetime format silently
   ignored? [UNVERIFIED] — re-send in full round-trip form; widen the window; cross-check one
   known-changed record's `date_updated` directly.
4. **Response JSON keys don't match this file** → trust the API; note discrepancies (these
   docs are not yet live-validated).
5. **Volunteer asks "why didn't Numa see my hours?"** → entry may be unapproved
   (`approved=true` default [DOCS]) — re-query with `approved=false` before saying it's absent.

## Output Formatting Guide

- People: `first_name last_name` (mind `is_group` profiles — show `group_name` [DOCS]).
- Hours: `hours_worked` is decimal hours — render `7.5 h`, sum before rounding.
- Dates: ISO 8601 UTC strings — display as dates (`2026-06-10`) for worked/joined dates;
  timezone conversion is [UNVERIFIED] territory — don't silently shift.
- Statuses: localized display strings — show verbatim, don't normalize to filter tokens.
- Always caption hours reports with window + approval scope: "approved hours, 1–31 May".
- Disclose partial scans on person searches: "checked the 643 accepted volunteers".
