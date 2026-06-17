---
api_name: Better Impact (Volunteer Impact)
api_slug: betterimpact
doc: write-shaped requests — the API is READ-ONLY. How to handle write asks honestly + the export-elsewhere workflows.
headline: this API has NO mutation patterns — no POST/PUT/PATCH/DELETE for any entity. Read-only status is [INFERRED from absence], not an explicit "read-only" statement. Treat every write as impossible until an official doc says otherwise.
call_surface: connectors(name="request", ...), GET only. Datetime literals in probes use the full round-trip form (01b).
confidence: docs-derived (article 9824270, 2026-06-10), NOT live-validated. [UNVERIFIED]/[UNKNOWN] tagged inline; else [DOCS].
companions: 01=api-rules, 01a=domain-model, 01b=query-patterns, 01d=events+errors
---

# Better Impact — Read-Only Reality & Write-Ask Handling

## Read-only reality

No POST/PUT/PATCH/DELETE endpoint appears anywhere in the official reference, for any entity. Docs frame the API as **export** alongside CSV/Excel:

> "Our API builds half of the bridge to port your data over and the other half of the bridge, you will need to build."

Data flows **out of** Better Impact; nothing documented flows back in. Endpoint inventory (users, timelog entries, lookups — all GET) is complete per the official reference; the official C# client covers only those reads. If Better Impact ships write endpoints later, update this file from real docs. For certainty, suggest the customer ask Better Impact support whether write endpoints exist or are planned.

## Hard rules for write-shaped requests

1. **Never invent an endpoint.** Don't guess `POST /organization/users/` or `PUT /organization/timelog_entries/{id}` into existence — undocumented; failure mode (405/404/401/silent?) [UNKNOWN].
2. **Never probe with speculative writes.** No "let me just try a POST." Production volunteer database; an undocumented write that _did_ land is worse than one that failed.
3. **Say it plainly, early.** "The Better Impact API is read-only — I can't change that record, but here's what I can do" beats three dead tool calls.
4. **Always offer the nearest alternative** (table below).
5. **Trust user evidence:** if the user pastes proof of a write API (newer official docs), trust it, note the discrepancy, proceed with their docs.

## Is it actually a write? (triage first)

| Sounds like a write                    | Actually                                                   |
| -------------------------------------- | ---------------------------------------------------------- |
| "Update me on volunteer hours"         | Read — timelog report (01b Pattern 5)                      |
| "Generate a volunteer report"          | Read + workspace file output                               |
| "Flag volunteers with expired checks"  | Read + client-side filter → report (01b ex.)               |
| "Sync volunteers into <other system>"  | Read here + **write into the other system's connector**    |
| "Export everyone who joined this year" | Read (`updated_since`/membership dates) → CSV in workspace |
| "Add up everyone's hours"              | Read — `volunteer_total_hours` or timelog sum              |

Only after confirming the user wants to **change data inside Better Impact** do the CANNOT patterns apply.

## What users will ask that you CANNOT do

Say so plainly, then offer the alternative. UI navigation specifics [UNVERIFIED] except the API-keys path; admin knows their own screens.
| Ask | Reality | Offer |
| --- | --- | --- |
| "Add a new volunteer" | No user-create endpoint | Admin adds in Volunteer Impact; volunteers self-register via the org's application form. You can pre-draft the profile details to paste |
| "Log 3 hours for Jane" | No timelog-create endpoint | Volunteer logs via MyImpactPage/timeclock, or admin enters hours in UI [paths UNVERIFIED]. Verify afterwards via a timelog read |
| "Approve these hours" | No write; `approved` read-only | Admin approves in UI; you can list pending (`approved=false`) so they know what to approve |
| "Change a volunteer's status to Accepted" | No membership write | Admin updates in UI; confirm by re-reading the user |
| "Update her email/phone/custom field" | No profile write | Admin (or the volunteer, own profile) edits in UI; you can supply exact current values for comparison |
| "Set a qualification / background check" | No write; background checks flow from Sterling Volunteers | UI / the Sterling integration. You can report current state + expiry |
| "Create an activity / category / shift" | Activities aren't even readable as a list | UI only. You can show category lookups + activity names seen on timelogs |
| "Schedule volunteers for Saturday" | No scheduling surface at all | UI scheduling; you can report who exists + their qualifications |
| "Message / email these volunteers" | No messaging endpoint | Export the contact list (emails readable) and send via an email integration the user has in Numa — with explicit confirmation |
| "Delete / archive that user" | No delete endpoint | Admin archives in UI (archived statuses exist in the data model) |
| "Record a donation for this donor" | No donor-transaction endpoint — donor data is status fields on memberships only | Admin records in Donor Impact; read `donor_status`/`donor_date_joined` afterwards |
| "Merge these duplicate profiles" | No merge/update endpoint | Admin merges in UI; you can detect likely duplicates (same email/name) and list them |
| "Import this spreadsheet of volunteers" | No bulk import via API | Better Impact's own admin-UI import tooling [UNVERIFIED]; you can clean/restructure the spreadsheet to match their fields |

## Designed direction: Better Impact → elsewhere

Supported shape is **export** — the legitimate "mutation-adjacent" workflows; Numa writes somewhere else.

### Pattern 1: One-off export to a file

```
1. Drain the roster (01b Pattern 1) and/or timelogs (01b Pattern 5)
2. Build CSV/XLSX in the workspace (client-side joins, column selection)
3. Hand the file to the user — they import it wherever they need
```

### Pattern 2: Sync into another connected system

"Get our Better Impact volunteers into <CRM/HR system>" = read here, write there:

```
1. Read users (trimmed roster scan; hydrate detail per user as needed)
2. Map fields (email_address → target's email, etc.) — show the user the mapping first
3. Write via the OTHER system's Numa connector, following ITS mutation rules
4. Record nothing back into Better Impact (impossible) — one-directional; re-runs dedupe on the target side (match on email or an external-id field there)
```

### Pattern 3: Recurring one-way sync (scheduled agent)

Delta-poll `updated_since` + push changes into the target; full recipe in 01d. High-water mark lives in the workspace/target, never in Better Impact.

### Pattern 4: Prepare-for-manual-entry

```
1. Gather/derive the values (chat, files, other connectors)
2. Present a copy-paste-ready block ordered the way their form asks
3. After entry, verify via the API read and confirm it round-tripped
```

That post-entry verification read is the one genuinely useful thing the API contributes to a write workflow — use it.

## Verification reads — closing the loop on manual writes

Every UI change is observable via the API. Offer proactively ("once you've done that, I can confirm it landed"). Datetime literals use the full round-trip form (01b); if a verify read can't see the change after a couple minutes, re-read once before concluding — indexing lag [UNKNOWN].
| After the admin/volunteer... | Verify with | Confirm by checking |
| --- | --- | --- |
| Adds a new volunteer | `/organization/users/?updated_since={10 min ago}&modules=volunteer&...` | New `user_id` with matching name/email |
| Logs hours | `/organization/timelog_entries?user_ids={id}&created_from={10 min ago}&page_size=50&page_number=0` — also try `&approved=false` (fresh entries may be unapproved [UNVERIFIED]) | New `timelog_entry_id`, `hours_worked`, `date_worked` |
| Approves pending hours | Re-run the window with default `approved=true` vs `approved=false` | Entry moved from the false set to the true set |
| Changes a volunteer's status | `GET /organization/users/{id}` (memberships on) | `volunteer_status` text + `volunteer_last_status_change` bumped |
| Edits profile / custom fields | `GET /organization/users/{id}` | New value present; `date_updated` advanced [whether custom-field edits bump it UNVERIFIED — check the value itself] |
| Adds/renews a qualification | `GET /organization/users/{id}` (qualifications on) | `qualification_id` present, `expiry_date` updated |
| Archives a user | Roster scan with `volunteer_status=archivedother,...` (archived tokens) | User appears under an archived status [whether archived users remain listable UNVERIFIED] |

## Worked example: "Log 3 hours for Jane Doe for Saturday's market stall"

```
1. TRIAGE  — genuine Better Impact write → impossible via API. Say so in one line.
2. RESOLVE — person lookup (01b Pattern 2) → confirm WHICH Jane (user_id, email).
3. PREPARE — hand over the exact entry: volunteer "Jane Doe (jane@…)", date worked 2026-06-06, 3.0 hours, activity "Market Stall" (match the activity_name seen on prior timelogs).
4. WAIT    — admin (or Jane via her portal) enters it in Volunteer Impact.
5. VERIFY  — timelog read: user_ids={id}&worked_from=2026-06-06T00:00:00.0000000Z&worked_to=2026-06-06T23:59:59.0000000Z (check approved=false too).
6. REPORT  — "Confirmed: 3.0 h on 2026-06-06, entry #{timelog_entry_id}, currently [approved/awaiting approval]."
```

## Outbound sync: field-mapping starter

For Pattern 2/3, start from this mapping and confirm with the user before the first write [target-side names vary per connector]:
| Better Impact (read) | Typical CRM/HR target | Notes |
| --- | --- | --- |
| `user_id` | external-id / reference field | THE dedupe key for re-runs |
| `first_name`, `last_name` | given/family name | Mind `is_group` → company/group record |
| `email_address` | primary email | Secondary email exists too |
| `cell_phone`/`home_phone` (+`phone_preference`) | phone fields | Respect the stated preference |
| `address_line_1/2`, `city`, `state`, `zip_code`, `country` | postal address | |
| `memberships[].volunteer_status` | status/stage field | Localized string — map per workspace |
| `memberships[].volunteer_date_joined` | start date | |
| `memberships[].volunteer_total_hours` | numeric rollup field | Refresh each sync run |
| `custom_fields[]` | matching custom fields | Resolve names via `/look_up/custom_fields` first |

## Idempotency & re-runs (outbound syncs)

Better Impact accepts no writes → sync state lives entirely on the **target** side. Design every export/sync safe to re-run:

- **Dedupe key:** `user_id` (and `timelog_entry_id` for hours) — store in the target's external-id field on first write; match before creating on re-runs.
- **No email-only matching** once `user_id` mapping exists — emails change, integer ids don't [long-term immutability UNVERIFIED].
- **Reads are repeatable** (all GETs) — a failed run re-pulls the same window with no Better Impact side effects.
- **Confirm before the first write batch** into the target (Numa cross-system convention): show row count + field mapping, get explicit yes.

## PII care on exports

Volunteer rosters are personal data (names, emails, phones, addresses, birthdays, background-check states). Before exporting/pushing:

- Confirm destination + purpose explicitly — especially messaging ("email all volunteers") and cross-system sync.
- Export only the columns the task needs.
- Never include `background_check_results` details unless the user asked for compliance reporting specifically.

## Phrasing guide

- Lead with capability: "I can read everything in Better Impact — profiles, hours, qualifications — but its API doesn't accept changes; that's a Better Impact limitation, not a connection problem."
- Be precise: the **API** is read-only; the _product_ supports edits in its own UI.
- Don't invent UI menus you can't see. Name the goal ("approve the pending entries"), not click-paths — except the documented API-keys path (Configuration → Organization Settings → Security Settings).
- When it matters: "Better Impact support can confirm whether a write API exists or is planned — the public docs don't show one."

## If a write seems to have happened anyway

Didn't come through this connector — every documented call is GET. Check instead: another integration writing to Better Impact, a human UI edit, or the Sterling Volunteers feed updating background checks. Time-box the change with `updated_since` + `date_updated` on the record (01d).

## Re-verification checklist (for future doc updates)

Read-only is the right call as of 2026-06-10. To re-verify:

1. Re-fetch the API reference (support.betterimpact.com article 9824270) — look for non-GET verbs or "create/update" sections.
2. Check the official C# client (github.com/BetterImpact/ApiClient) for new write methods.
3. Probe `https://api.betterimpact.com/v1/swagger.json` — was 404 [CONFIRMED — live probe 2026-05-28]; an OpenAPI spec appearing would be the best source.
4. If anything changed: update this file from real endpoint docs (never memory) and re-run connector validation before enabling write behaviour.

## Summary card

```
WRITES:      none — read-only API (no write endpoint documented)
WORKAROUNDS: UI entry (admin/volunteer), Better Impact import tooling [UNVERIFIED],
             export → write via OTHER Numa connectors, prepare-for-manual-entry
AGENT RULES: never invent endpoints · never probe with writes · say it early ·
             offer the nearest alternative · verify manual entries with a read
ESCALATION:  Better Impact support can confirm write-API existence/roadmap
```
