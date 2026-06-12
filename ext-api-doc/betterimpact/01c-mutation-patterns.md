---
api_name: 'Better Impact (Volunteer Impact)'
api_slug: 'betterimpact'
generated_from: '00-api-investigation (2026-05-28) + support articles 9824270, 9824266, 9824303 (fetched 2026-06-10)'
generated_date: '2026-06-10'
source_phases: ['Phase 5: Write Patterns & Mutations']
---

# Better Impact -- Mutation Patterns Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> Facts tagged [DOCS] / [UNVERIFIED] / [UNKNOWN].
>
> **THE HEADLINE: this API has no mutation patterns. It is read-only.** This file exists so the
> agent handles write-shaped requests honestly and usefully instead of inventing endpoints.

## The Read-Only Reality

No POST, PUT, PATCH, or DELETE endpoint appears anywhere in the official API reference — for
any entity [DOCS — absence]. The official docs frame the API as an **export** mechanism
alongside CSV/Excel exports, in their own words:

> "Our API builds half of the bridge to port your data over and the other half of the bridge,
> you will need to build." [DOCS]

The data flows **out of** Better Impact, into whatever you build. Nothing documented flows back in.

### Confidence and its limits

- Read-only status is **[INFERRED from absence]**, not from an explicit "the API is read-only"
  statement. The endpoint inventory (users, timelog entries, lookups — all GET) is complete per
  the official reference [DOCS], and the official C# client covers only those reads.
- If Better Impact ships write endpoints later, this file is what to update. Until an official
  doc says otherwise, **treat every write as impossible**.
- The investigation's recommended path for certainty: ask Better Impact support whether write
  endpoints exist or are planned. Suggest that to the customer if writes matter to them.

## Hard Rules for Write-Shaped Requests

1. **Never invent an endpoint.** Do not guess `POST /organization/users/` or
   `PUT /organization/timelog_entries/{id}` into existence — they are not documented, and the
   failure mode (405? 404? 401? silent?) is [UNKNOWN].
2. **Never probe with speculative writes.** No "let me just try a POST and see." This is a
   production volunteer database; an undocumented write that *did* land would be worse than one
   that failed.
3. **Say it plainly, early.** "The Better Impact API is read-only — I can't change that record,
   but here's what I can do" beats three tool calls that go nowhere.
4. **Always offer the nearest alternative** (table below). Most write asks have a useful
   read-side or prepare-side answer.
5. **The API may still beat you to honesty:** if the user pastes evidence of a write API
   (e.g. newer official docs), trust the evidence, note the discrepancy with this file, and
   proceed carefully with their documentation in hand.

## Is It Actually a Write? (triage first)

Plenty of write-sounding asks are reads in disguise:

| Sounds like a write                     | Actually                                                |
| --------------------------------------- | ------------------------------------------------------- |
| "Update me on volunteer hours"          | Read — timelog report (01b Pattern 5)                   |
| "Generate a volunteer report"           | Read + workspace file output                            |
| "Flag volunteers with expired checks"   | Read + client-side filter → report (01b Example 3)      |
| "Sync volunteers into <other system>"   | Read here + **write into the other system's connector** |
| "Export everyone who joined this year"  | Read (`updated_since`/membership dates) → CSV in workspace |
| "Add up everyone's hours"               | Read — `volunteer_total_hours` or timelog sum           |

Only after confirming the user genuinely wants to **change data inside Better Impact** do the
CANNOT patterns below apply.

## What Users Will Ask That You CANNOT Do

Say so plainly, then offer the alternative. UI navigation specifics below are [UNVERIFIED]
except the API-keys path; the admin will know their own screens.

| Ask                                      | Reality                                | Offer                                                                 |
| ---------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| "Add a new volunteer"                    | No user-create endpoint [DOCS — absence] | Admin adds them in Volunteer Impact; volunteers can also self-register via the org's application form. You can pre-draft the profile details to paste in |
| "Log 3 hours for Jane"                   | No timelog-create endpoint [DOCS — absence] | Volunteer logs via MyImpactPage / timeclock, or admin enters hours in the UI [UNVERIFIED paths]. You can verify afterwards via a timelog read |
| "Approve these hours"                    | No write; `approved` is read-only [DOCS] | Admin approves in the UI; you can list pending entries (`approved=false`) so they know exactly what to approve |
| "Change a volunteer's status to Accepted"| No membership write [DOCS — absence]   | Admin updates status in the UI; you can confirm by re-reading the user afterwards |
| "Update her email / phone / custom field"| No profile write [DOCS — absence]      | Admin (or the volunteer, for their own profile) edits in the UI; you can supply the exact current values for comparison |
| "Set a qualification / background check" | No write; background checks flow from Sterling Volunteers [DOCS] | UI / the Sterling integration. You can report current state + expiry dates |
| "Create an activity / category / shift"  | Activities aren't even readable as a list [DOCS — absence] | UI only. You can show category lookups and activity names seen on timelogs |
| "Schedule volunteers for Saturday"       | No scheduling surface at all [DOCS — absence] | UI scheduling; you can report who exists and their qualifications |
| "Message / email these volunteers"       | No messaging endpoint [DOCS — absence] | Export the contact list (emails are readable) and send via an email integration the user has in Numa — with their explicit confirmation |
| "Delete / archive that user"             | No delete endpoint [DOCS — absence]    | Admin archives in the UI (archived statuses exist in the data model) |
| "Record a donation for this donor"       | No donor-transaction endpoint — donor data is status fields on memberships only [DOCS — absence] | Admin records it in Donor Impact; you can read `donor_status`/`donor_date_joined` afterwards |
| "Merge these duplicate profiles"         | No merge/update endpoint [DOCS — absence] | Admin merges in the UI; you can detect likely duplicates (same email/name client-side) and list them for review |
| "Import this spreadsheet of volunteers"  | No bulk import via API [DOCS — absence] | Better Impact's own import tooling in the admin UI [UNVERIFIED]; you can clean/restructure the spreadsheet to match their fields |

## The Designed Direction: Better Impact → Elsewhere

The supported integration shape is **export**. These are the legitimate "mutation-adjacent"
workflows — Numa does the writing somewhere else:

### Pattern 1: One-off export to a file

```
1. Drain the roster (01b Pattern 1) and/or timelogs (01b Pattern 5)
2. Build the CSV/XLSX in the workspace (client-side joins, column selection)
3. Hand the file to the user — they import it wherever they need
```

### Pattern 2: Sync into another connected system

"Get our Better Impact volunteers into <CRM/HR system>" = read here, write there:

```
1. Read users from Better Impact (trimmed roster scan; hydrate detail per user as needed)
2. Map fields (email_address → the target's email, etc.) — show the user the mapping first
3. Write via the OTHER system's Numa connector/integration, following ITS mutation rules
4. Record nothing back into Better Impact (impossible) — the sync is one-directional;
   re-runs must dedupe on the target side (match on email or an external-id field there)
```

### Pattern 3: Recurring one-way sync (scheduled agent)

Delta-poll `updated_since` + push changes into the target system; full recipe in 01d. The
high-water mark lives in the workspace/target, never in Better Impact.

### Pattern 4: Prepare-for-manual-entry

When the user must do UI data entry, minimize their work:

```
1. Gather/derive the values (from chat, files, or other connectors)
2. Present a copy-paste-ready block ordered the way their form asks for it
3. After they've entered it, verify via the API read and confirm it round-tripped
```

That post-entry verification read is the one genuinely useful thing the API contributes to a
write workflow — use it.

## Verification Reads — Closing the Loop on Manual Writes

Every UI change the admin makes is observable via the API. Offer these proactively
("once you've done that, I can confirm it landed"):

| After the admin/volunteer...        | Verify with                                                                  | Confirm by checking                              |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Adds a new volunteer                | `/organization/users/?updated_since={10 min ago}&modules=volunteer&...`      | New `user_id` with matching name/email           |
| Logs hours                          | `/organization/timelog_entries?user_ids={id}&created_from={10 min ago}&page_size=50&page_number=0` — also try `&approved=false` (fresh entries may be unapproved [UNVERIFIED]) | New `timelog_entry_id`, `hours_worked`, `date_worked` |
| Approves pending hours              | Re-run the window with default `approved=true` vs `approved=false`           | Entry moved from the false set to the true set    |
| Changes a volunteer's status        | `GET /organization/users/{id}` (memberships on)                              | `volunteer_status` text + `volunteer_last_status_change` bumped |
| Edits profile / custom fields       | `GET /organization/users/{id}`                                               | New value present; `date_updated` advanced [UNVERIFIED whether custom-field edits bump it — check the value itself] |
| Adds/renews a qualification         | `GET /organization/users/{id}` (qualifications on)                           | `qualification_id` present, `expiry_date` updated |
| Archives a user                     | Roster scan with `volunteer_status=archivedother,...` (archived tokens)      | User appears under an archived status [UNVERIFIED whether archived users remain listable] |

Datetime literals in these probes use the full round-trip form (see 01b). If a verification
read can't see the change after a couple of minutes, re-read once more before concluding —
indexing/visibility lag is [UNKNOWN].

## Worked Example: "Log 3 hours for Jane Doe for Saturday's market stall"

```
1. TRIAGE   — genuine Better Impact write → impossible via API. Say so in one line.
2. RESOLVE  — person lookup (01b Pattern 2) → confirm WHICH Jane (user_id, email) so the
              admin credits the right profile.
3. PREPARE  — hand over the exact entry: volunteer "Jane Doe (jane@…)", date worked
              2026-06-06, 3.0 hours, activity "Market Stall" (match the activity_name seen
              on prior timelogs so it lines up with their catalog).
4. WAIT     — the admin (or Jane, via her volunteer portal) enters it in Volunteer Impact.
5. VERIFY   — timelog read: user_ids={id}&worked_from=2026-06-06T00:00:00.0000000Z&
              worked_to=2026-06-06T23:59:59.0000000Z (check approved=false too).
6. REPORT   — "Confirmed: 3.0 h on 2026-06-06, entry #{timelog_entry_id}, currently
              [approved/awaiting approval]."
```

## Outbound Sync: Field-Mapping Starter

For Pattern 2/3 (writing Better Impact data into another connected system), start from this
mapping and confirm it with the user before the first write [DOCS field names; target-side
names vary per connector]:

| Better Impact (read)                              | Typical CRM/HR target           | Notes                                  |
| ------------------------------------------------- | ------------------------------- | -------------------------------------- |
| `user_id`                                          | external-id / reference field   | THE dedupe key for re-runs             |
| `first_name`, `last_name`                          | given/family name               | Mind `is_group` → company/group record |
| `email_address`                                    | primary email                   | Secondary email exists too             |
| `cell_phone` / `home_phone` (+ `phone_preference`) | phone fields                    | Respect the stated preference          |
| `address_line_1/2`, `city`, `state`, `zip_code`, `country` | postal address          |                                        |
| `memberships[].volunteer_status`                   | status/stage field              | Localized string — map per workspace   |
| `memberships[].volunteer_date_joined`              | start date                      |                                        |
| `memberships[].volunteer_total_hours`              | numeric rollup field            | Refresh on each sync run               |
| `custom_fields[]`                                  | matching custom fields          | Resolve names via `/look_up/custom_fields` first |

## Idempotency & Re-runs (outbound syncs)

Because Better Impact accepts no writes, sync state lives entirely on the **target** side —
design every export/sync to be safe to re-run:

- **Dedupe key:** `user_id` (and `timelog_entry_id` for hours) — store it in the target's
  external-id/reference field on first write; match on it before creating anything on re-runs.
- **No email-only matching** for re-runs once `user_id` mapping exists — emails change;
  integer ids don't [DOCS id stability for the session; long-term immutability [UNVERIFIED]].
- **Reads are repeatable:** all calls are GETs — a failed run can simply re-pull the same
  window with no side effects on Better Impact.
- **Confirm before the first write batch** into the target system (Numa convention for
  cross-system writes): show row count + field mapping, get an explicit yes.

## PII Care on Exports

Volunteer rosters are personal data (names, emails, phones, addresses, birthdays, background
-check states). Before exporting or pushing them anywhere:

- Confirm the destination and purpose with the user explicitly — especially for messaging
  ("email all volunteers") and cross-system sync.
- Export only the columns the task needs; background-check and qualification data rarely
  belongs in a marketing list.
- Never include `background_check_results` details in outputs unless the user asked for
  compliance reporting specifically.

## Phrasing Guide (keep trust, avoid dead ends)

- Lead with capability: "I can read everything in Better Impact — profiles, hours,
  qualifications — but its API doesn't accept changes; that's a Better Impact limitation,
  not a connection problem."
- Be precise about whose limitation it is: the **API** is read-only [DOCS-derived]; the
  *product* obviously supports edits — in its own UI.
- Don't speculate about UI menus you can't see. Name the goal ("approve the pending entries"),
  not invented click-paths — except the documented API-keys path (Configuration →
  Organization Settings → Security Settings) [DOCS].
- When it matters to the customer, suggest: "Better Impact support can confirm whether a write
  API exists or is planned — the public docs don't show one."

## If a Write Seems to Have Happened Anyway

If the user believes a Numa action changed Better Impact data: it didn't come through this
connector — every documented call is GET, and the agent must not have issued writes. Check
instead for: another integration writing to Better Impact, a human edit in the UI, or the
Sterling Volunteers feed updating background checks [DOCS]. Use `updated_since` +
`date_updated` on the record to time-box when the change landed (see 01d).

## Re-Verification Checklist (for future doc updates)

Read-only is the right call as of 2026-06-10. To re-verify later:

1. Re-fetch the API reference (support.betterimpact.com article 9824270) — look for any
   non-GET verbs or "create/update" sections.
2. Check the official C# client (github.com/BetterImpact/ApiClient) for new write methods.
3. Probe `https://api.betterimpact.com/v1/swagger.json` — was 404 [CONFIRMED — live probe
   2026-05-28]; an OpenAPI spec appearing would be the best source.
4. If anything changed: update this file with real endpoint docs, never from memory, and
   re-run the connector validation pass before enabling write behaviour.

## Summary Card

```
WRITES:        none — read-only API [DOCS — absence of any write endpoint]
WORKAROUNDS:   UI entry (admin/volunteer), Better Impact import tooling [UNVERIFIED],
               export → write via OTHER Numa connectors, prepare-for-manual-entry
AGENT RULES:   never invent endpoints · never probe with writes · say it early ·
               offer the nearest alternative · verify manual entries with a read
ESCALATION:    Better Impact support can confirm write-API existence/roadmap
```
