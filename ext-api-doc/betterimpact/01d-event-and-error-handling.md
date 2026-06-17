---
api_name: Better Impact (Volunteer Impact)
api_slug: betterimpact
doc: events, polling recipes, error triage, reconnect flow
call_surface: connectors(name="request", ...), GET only. Relative urls (no /v1), no Authorization header (Numa injects Basic auth). Datetimes in full round-trip form (01b).
confidence: docs-derived (article 9824270, 2026-06-10), NOT live-validated. NO docs found for error bodies, rate limits, or webhooks — those [UNKNOWN]s are preserved, not papered over. Only 401 is [CONFIRMED — live unauth probe 2026-05-28].
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01c=read-only/write-asks
---

# Better Impact — Event & Error Handling

## Event-driven capabilities

| Mechanism           | Platform has it?                            | To Numa?                  | Notes                                         |
| ------------------- | ------------------------------------------- | ------------------------- | --------------------------------------------- |
| Webhooks (outbound) | Not mentioned anywhere [UNKNOWN — searched] | No                        | Neither API reference nor any support article |
| WebSocket / SSE     | Not mentioned                               | No                        |                                               |
| Change feed         | No                                          | No                        |                                               |
| Polling             | Yes                                         | **Yes — the only option** | `updated_since` on users AND timelog entries  |

**Bottom line:** "tell me when X changes in Better Impact" = a Numa scheduled agent polling `updated_since`. State the latency floor (your polling cadence).

## Polling: the delta recipe

Both list endpoints take `updated_since` (full round-trip datetime — 01b):

```
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/users/?updated_since=2026-06-10T06:00:00.0000000Z&include_custom_fields=false&include_qualifications=false&include_memberships=true&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0"})
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/timelog_entries?updated_since=2026-06-10T06:00:00.0000000Z&page_size=250&page_number=0"})
```

1. Drain pages while `Header.has_next_page` — the changed set can exceed one page.
2. New high-water mark = max(`date_updated`) seen; persist in the workspace, advance **only after a fully successful run**.
3. Overlap the window (mark minus 5 min) and dedupe on `user_id`/`timelog_entry_id` + `date_updated` — server clock skew vs your mark [UNVERIFIED].
4. **No sort parameter** — result order [UNKNOWN]; never assume the last row of the last page is newest. Compute max() over everything.
5. What bumps a user's `date_updated` (membership/custom-field/qualification edits?) [UNVERIFIED] — poll timelogs separately; treat user-poll coverage of embedded arrays as best-effort until observed.

### Deletions are invisible

`updated_since` never reports deletions/archival removal — records just stop appearing [whether archived users still list under archived statuses UNVERIFIED; deleted ones won't]. When absence matters (mirroring into another system):

```
1. Periodic full-id sweep: roster scan with all includes off (ids + names are cheap)
2. Diff against your stored id set → missing ids = deleted, archived out of your filter, or module-scope change on the key — label "no longer visible via the API", NOT "deleted"
3. Optionally re-check missing ids via /organization/by_id_list/users?ids=... — present there but absent from the filtered list ⇒ status/module change, not deletion [UNVERIFIED]
```

### Cadence guidance (rate limits [UNKNOWN] — derive cadence from need)

| Need                                         | Cadence                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Daily digest (new applicants, hours summary) | 1×/day scheduled agent                                                          |
| "Within the hour" awareness                  | 15–60 min                                                                       |
| Anything faster                              | Push back — no webhooks; sub-5-min polling of an undocumented-limit API is rude |

## Worked example: "Tell me when someone new applies to volunteer"

```
Scheduled agent, daily. State: high-water mark + seen user_id set (workspace file).
1. GET /organization/users/?modules=volunteer&volunteer_status=applicant&updated_since={mark}&include_memberships=true&include_custom_fields=false&include_qualifications=false&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0  (+ drain)
2. Rows with user_id not in seen-set → new applicants → summarize (name, email, date_created)
3. updated_since also catches status flips INTO applicant [UNVERIFIED]; the status filter keeps the result set tiny
4. Advance mark; add ids to seen-set
```

## Worked example: "Weekly hours digest, flagging unapproved entries"

```
Scheduled agent, Monday 07:00.
1. GET /organization/timelog_entries?worked_from={monday-7d}&worked_to={sunday}&page_size=250&page_number=0  (+ drain) → approved hours (default approved=true)
2. Same window with &approved=false → pending entries ("both" needs two calls)
3. Digest: total approved hours, top volunteers/activities (group client-side), "N entries awaiting approval" with names — approval itself is UI-only (01c)
```

## Rate limits

**[UNKNOWN — no documentation]:** no documented quota, burst limit, or throttle headers; no 429 behaviour described. Operate conservatively:

- ≤2 req/s sequential; no parallel fan-out against this connector.
- Full drains paged at 250 — a 5,000-user roster is 20 requests; pause ~1s between pages.
- Treat any 429 (or limit-shaped error text) as authoritative: back off 5s → 15s → 60s, halve pacing for the session, and note the observed behaviour for these docs.

## Error handling

Only 401 live-confirmed: unauthenticated requests → **HTTP 401** (body not captured — likely empty) [CONFIRMED — live probe 2026-05-28]. All other error **body formats [UNKNOWN]** — quote any body verbatim; never invent field meanings.
| Status | Meaning | Action |
| --- | --- | --- |
| 401 | Bad/deleted/disabled API key [DOCS + CONFIRMED] | **Reconnect flow below.** Do not retry, do not loop |
| 400 | [UNVERIFIED] bad parameter — date format is the prime suspect | Re-send datetimes in full round-trip form; check param spelling (01b) |
| 403 | [UNKNOWN if ever issued] — module gaps return EMPTY DATA instead | If one appears, surface the body verbatim |
| 404 | [UNVERIFIED] wrong id or path | Verify the id via a list query; check the path (no `/v1` prefix, exact trailing slash per 01a catalog) |
| 429 | [UNKNOWN — undocumented] | Backoff ladder above |
| 5xx | Server error | Retry once after 5s — all calls are GETs, retry is safe |

### 401 — the reconnect flow

API keys are admin-managed; an admin deleting/disabling the key (Options → Edit/Delete, "Enabled" unchecked) kills it. On 401:

1. Stop. Do not retry or vary the request.
2. Tell the user: "Your Better Impact connection is no longer valid — the API key was likely deleted, disabled, or changed. You'll need new API credentials to reconnect."
3. New key path (admin): Configuration → Organization Settings → Security Settings → API Keys → [+ Create API Key] — check **Enabled** and the **module checkboxes** the user needs (Volunteer at minimum).
4. Chat credential card re-captures the new username + password into the user's vault.
5. Re-run the original request once after reconnection.

### The module-scope trap (the 403 that never comes)

A key missing a module does **not** error — silently returns empty/filtered data:

- Volunteers absent from user lists → Volunteer module unchecked on the key
- `qualifications` array always empty → Volunteer module missing
- A custom field never appearing → the key's modules don't intersect the field's modules

**Whenever data the user insists exists comes back empty, say:** "This can happen when the API key wasn't created with the right module access — ask your Better Impact admin to check the key's module checkboxes (Configuration → Organization Settings → Security Settings → API Keys)." Check this BEFORE debugging filters.

## Error triage decision tree

```
Request failed / data looks wrong
├─ 401                       → key dead → reconnect flow; NEVER retry-loop
├─ 400 [UNVERIFIED]          → my request is wrong
│    ├─ datetime param?      → full round-trip form (2026-06-01T00:00:00.0000000Z), retry once
│    └─ param name/value?    → check 01b tables (status tokens, comma-lists, "true"/"false" strings)
├─ 404 [UNVERIFIED]          → id or path
│    ├─ accidentally sent /v1/... ? → strip it (base URL already has /v1)
│    └─ path typo / wrong scope?    → check 01 catalog; try /organization/ vs /enterprise/
├─ 429 / limit-shaped error  → back off 5s→15s→60s, halve pacing [UNKNOWN limits]
├─ 5xx                       → retry once after 5s (GET-only API — safe)
└─ 200 but EMPTY / missing data
     ├─ module scope on the key?  → THE prime suspect — suggest admin checks key modules
     ├─ status filter too narrow? → 12 volunteer statuses; try dropping the filter
     ├─ wrong scope prefix?       → org-tier key on /enterprise/ paths [UNVERIFIED]
     ├─ approved=true default?    → unapproved timelogs hidden; query approved=false too
     └─ truly none                → Header.total_items_count == 0 with a broad query
```

## Scheduled sync recipe (Numa scheduled agent)

```
Trigger:  daily 07:00 (or 15–60 min for urgent flows)
State:    /workdir high-water marks per resource (ISO datetime) + seen-id sets

1. GET /organization/users/?updated_since={mark-5min}&include_memberships=true&include_custom_fields=false&include_qualifications=false&include_verified_volunteers_background_check_results=false&page_size=250&page_number=0  (+ drain while has_next_page)
2. GET /organization/timelog_entries?updated_since={mark-5min}&page_size=250&page_number=0  (+ drain; approved=true default — add a second pass with approved=false when pending entries matter)
3. Diff against stored ids/date_updated → new vs changed; summarize or push downstream
4. Advance marks to max(date_updated) seen — only after the whole run succeeds
5. Weekly: full-id sweep (includes off) to catch records that vanished (see Deletions)
```

Pace page requests ~1s apart — limits [UNKNOWN]; a 5,000-user roster is 20 pages.

## Connection health check

Cheap probe to classify a sick connection before debugging:

```
connectors(name="request", params={"connector":"betterimpact","method":"GET","url":"/organization/users/?page_size=1&page_number=0&include_custom_fields=false&include_qualifications=false&include_memberships=false&include_verified_volunteers_background_check_results=false"})
```

- 200 with `Header` → auth + connectivity fine; problems are query/scope-level (`total_items_count:0` on this unfiltered probe ⇒ suspect key module scope)
- 401 → reconnect flow
- Anything else → quote status + body verbatim; check the triage tree

`/organization/look_up/custom_fields` is an alternative probe (tiny, no user data); module-scope sensitivity [UNVERIFIED].

## Counter-exception handling

1. **Worked yesterday, 401 today** → an admin deleted/disabled/recreated the key — reconnect; don't debug the query.
2. **Counts dropped suddenly** (volunteers halved) → key module scope changed, or a bulk status change — compare `total_items_count` across status filters before alarm.
3. **`updated_since` returns nothing despite known changes** → datetime format silently ignored? [UNVERIFIED] — re-send full round-trip form; widen the window; cross-check one known-changed record's `date_updated` directly.
4. **Response JSON keys don't match this file** → trust the API; note discrepancies (docs not yet live-validated).
5. **Volunteer asks "why didn't Numa see my hours?"** → entry may be unapproved (`approved=true` default) — re-query with `approved=false` before saying absent.

## Output formatting guide

- People: `first_name last_name` (mind `is_group` — show `group_name`).
- Hours: `hours_worked` is decimal hours — render `7.5 h`, sum before rounding.
- Dates: ISO 8601 UTC strings — display as dates (`2026-06-10`) for worked/joined; timezone conversion [UNVERIFIED] — don't silently shift.
- Statuses: localized display strings — show verbatim, don't normalize to filter tokens.
- Always caption hours reports with window + approval scope: "approved hours, 1–31 May".
- Disclose partial scans on person searches: "checked the 643 accepted volunteers".
