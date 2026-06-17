---
api_name: Rentman
api_slug: rentman
base_url: https://api.rentman.net
path_version_segment: none
call_surface: HTTP via `connectors(name="request", params={connector:"rentman", url, method, body})` — relative URLs, NO Authorization header (Numa injects the Bearer token), JSON in `body`
doc_role: on-demand reference (01c) — what is writable, create/update/delete patterns
confidence: spec-derived [SPEC] (OpenAPI 1.13.0, 2026-06-10) unless [DOCS]/[UNVERIFIED]. NO write has been executed against a real workspace — verify each one with a read-back.
---

# Rentman — Mutation Patterns Reference

## Write capabilities summary

From the spec's declared methods. Anything not listed under a write column is **read-only — don't attempt, don't improvise paths.**

| Entity                                | Create (POST)                                                       | Update (PUT)             | Delete          |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------ | --------------- |
| Project                               | `/projects`                                                         | ✗ **none**               | ✗               |
| Subproject                            | `/projects/{id}/subprojects`                                        | ✗ **none**               | ✗               |
| Project request                       | `/projectrequests`                                                  | `/projectrequests/{id}`  | ✓               |
| Project request equipment             | `/projectrequests/{id}/projectrequestequipment`                     | ✓                        | ✓               |
| Project function                      | `/projects/{id}/projectfunctions`                                   | ✗                        | ✗               |
| Project function group                | `/projects/{id}/projectfunctiongroups`                              | ✗                        | ✗               |
| Project cost                          | `/projects/{id}/costs`                                              | `/costs/{id}`            | ✓               |
| Contact                               | `/contacts`                                                         | `/contacts/{id}`         | ✓               |
| Contact person                        | `/contacts/{id}/contactpersons`                                     | `/contactpersons/{id}`   | ✓               |
| Equipment                             | `/equipment`                                                        | `/equipment/{id}`        | ✗ **no delete** |
| Serial number                         | `/equipment/{id}/serialnumbers`                                     | `/serialnumbers/{id}`    | ✓               |
| Accessory / Alternative / Set content | `/equipment/{id}/...`                                               | item path                | ✓               |
| Supplier link                         | `/equipment/{id}/suppliers`                                         | `/suppliers/{id}`        | ✓               |
| Stock movement                        | `/equipment/{id}/stockmovements`                                    | `/stockmovements/{id}`   | ✓               |
| Payment                               | `/invoices/{id}/payments`                                           | `/payments/{id}`         | ✗ **no delete** |
| Task                                  | `/tasks` (or `/{parent}/{id}/tasks`)                                | `/tasks/{id}`            | ✓               |
| Subtask                               | `/tasks/{id}/subtasks`                                              | `/subtasks/{id}`         | ✓               |
| Task assignment                       | `/tasks/{id}/taskassignments`                                       | `/taskassignments/{id}`  | ✓               |
| Task status                           | `/taskstatuses`                                                     | `/taskstatuses/{id}`     | ✓               |
| Appointment                           | `/appointments`                                                     | `/appointments/{id}`     | ✓               |
| Appointment crew                      | `/appointments/{id}/appointmentcrew`                                | `/appointmentcrew/{id}`  | ✓               |
| Crew availability                     | `/crew/{id}/crewavailability`                                       | `/crewavailability/{id}` | ✓               |
| Time registration                     | `/timeregistration`                                                 | `/timeregistration/{id}` | ✓               |
| Leave request                         | `/leaverequest` (+ lines via `/leaverequest/{id}/timeregistration`) | `/leaverequest/{id}`     | ✗               |
| Leave mutation                        | `/leavemutation`                                                    | ✗ **immutable**          | ✗               |
| Vehicle                               | `/vehicles` (or `/stocklocations/{id}/vehicles`)                    | `/vehicles/{id}`         | ✓               |
| Folder                                | `/folders`                                                          | `/folders/{id}`          | ✗               |

**Read-only (never write):** invoices, invoicelines, quotes, contracts, purchaseorders (+costs), crew members, projectcrew, projectequipment, projectequipmentgroup, projectvehicles, files, file_folders, repairs, subrentals, stock locations, statuses, rates, ledgercodes, taxclasses, leavetypes, invitations, timeregistration activities.

## General rules (apply to every write)

1. **Read-first.** GET an existing sibling, mirror its field names and formats. Request schemas are authoritative for _which_ fields are writable; one real record for _formats_.
2. **Linked references are path strings** in write bodies: `{"subproject":"/subprojects/7","taxclass":"/taxclasses/2"}`. Plain-integer exceptions: polymorphic `item` (+`itemtype` string) on tasks/files.
3. **PUT merge semantics are [UNVERIFIED]** — full-replace vs partial-merge undocumented. Safe protocol: GET → build the PUT body from the Request-schema fields with current values, overriding only what changes → PUT → GET again and diff.
4. **Success = 200 with the entity under `data`** (POST and PUT); **DELETE returns no body**.
5. **Never invent enum values.** Enums are exact strings, some with spaces (`'Track stock'`, `'Virtual package'`, `'Physical equipment'`).
6. **`custom` writes:** pass `{"custom":{"custom_3":"value"}}` — confirm key↔label mapping with the user first; keys are workspace-specific.
7. **No idempotency mechanism** [SPEC — absence]. A timed-out POST may have landed: search for the would-be record before re-POSTing (see 01d).
8. **Confirm destructive/financial actions** (deletes, payments, stock movements) before executing.

## Create patterns

### Pattern 1: Contact (+ contact person)

```
POST /contacts  body: {"type":"company","name":"Acme Productions","email_1":"office@acme.example","phone_1":"+64 9 555 1234","country":"nz","visit_city":"Auckland"}
# → data.id = 451
POST /contacts/451/contactpersons  body: {"firstname":"Jane","lastname":"Smith","email":"jane@acme.example","function":"Production Manager"}
```

`type` ∈ `private | company`; country codes lowercase ISO-3166 (`nz`, `gb`); `code` auto-generates if omitted. No documented dedupe/upsert — search by `email_1` first, flag any likely duplicate.

### Pattern 2: Project + subproject — know the limits

`ProjectRequest` (the project write schema) has only **`name`, `reference`, `number`, `custom`**. You cannot set customer, dates, or account manager at creation, and there is **no PUT to add them later** — UI-only.

```
POST /projects  body: {"name":"Acme Conference 2026","reference":"ACME-CONF"}
# → data.id = 901; a default subproject may be auto-created [UNVERIFIED] — check:
GET /projects/901/subprojects
# extra phases (subproject body: name + custom only):
POST /projects/901/subprojects  body: {"name":"Day 2 — Breakouts"}
```

**If the user wants a fully-specified job created, prefer Pattern 3** and say why: a bare `/projects` POST creates an empty shell they must finish in the UI.

### Pattern 3: Project request — the designed intake path

Free-text fields, no entity matching needed; the user converts it to a project in the Rentman UI where matching is interactive.

```
POST /projectrequests  body: {"name":"Wedding — Smith / 14 Jun","planperiod_start":"2026-06-14T08:00:00","planperiod_end":"2026-06-15T01:00:00","contact_name":"Smith Family","contact_person_first_name":"Robert","contact_person_lastname":"Smith","contact_person_email":"rob@example.com","location_name":"Old Barn Venue","location_mailing_city":"Auckland","remark":"Quote requested via Numa chat","price":4500}
```

Required: `planperiod_start`, `planperiod_end`. Optional `linked_contact":"/contacts/451"` if already matched. Raw equipment lines: POST `/projectrequests/{id}/projectrequestequipment` — Rentman matches them to catalog items during conversion.

### Pattern 4: Task (color is required)

```
POST /projects/901/tasks  body: {"name":"Confirm rigging plot","color":"#1171e4","priority":"high_priority","deadline":"2026-06-12T17:00:00"}
# assign it:
POST /tasks/77/taskassignments  body: {"crew":"/crew/45"}
```

`color` is the only required field — hex string [UNVERIFIED format]. Tasks can also be created under contacts, equipment, invoices, etc. via their `/{id}/tasks` paths.

### Pattern 5: Appointment + crew

```
POST /appointments  body: {"name":"Site visit — Old Barn","start":"2026-06-11T10:00:00","end":"2026-06-11T11:30:00","location":"Old Barn Venue","is_plannable":false}
POST /appointments/33/appointmentcrew  body: {"crewmember":"/crew/45"}
```

`start`/`end` required. AppointmentCrew body field name (`crewmember` vs `crew`) is [UNVERIFIED] — GET an existing appointmentcrew row first and mirror it.

### Pattern 6: Crew availability

```
POST /crew/45/crewavailability  body: {"start":"2026-06-14T00:00:00","end":"2026-06-14T23:59:59","status":"N","remark":"Family commitment"}
```

`start`/`end` required; `status` ∈ `B` (available) / `N` (unavailable) / `O` (unknown).

### Pattern 7: Record a payment on an invoice — financial, confirm first

```
POST /invoices/210/payments  body: {"moment":"2026-06-10T00:00:00","amount":2587.50,"description":"Bank transfer ref 884213","payment_import_source":"publicapi"}
```

`moment` required; use `payment_import_source:"publicapi"` for API-recorded payments [enum confirmed; semantics [UNVERIFIED]]. **No DELETE on payments** — a wrong amount needs a PUT fix or UI intervention; double-check with the user first. Verify after: `GET /invoices/210?fields=id,total_paid,outstanding_balance,is_paid`.

### Pattern 8: Stock movement (manual corrections only)

```
POST /equipment/12/stockmovements  body: {"date":"2026-06-10T09:00:00","amount":-2,"description":"Damaged at Smith wedding","stock_location":"/stocklocations/1"}
```

`date` required; only `manual` movements writable, **bulk items only** (serialized stock is not API-adjustable). Sign convention of `amount` is [UNVERIFIED] — check an existing movement first.

### Pattern 9: Time registration & leave

```
POST /timeregistration  body: {"crewmember":"/crew/45","start":"2026-06-09T08:00:00","end":"2026-06-09T16:30:00","break_duration":30,"remark":"Warehouse prep"}
```

`duration` auto-calculates for worked hours; `break_duration`/`travel_time` units [UNVERIFIED — leave mutations document seconds; mirror an existing row]. Leave: POST `/leaverequest`, then its lines via `/leaverequest/{id}/timeregistration`; the line's leave type must require approval; editable only while `pending`; crew member immutable once created. Leave mutations are write-once — corrections are a new opposite mutation.

## Update patterns

### Pattern 10: Update a contact (read → merge → write → verify)

```
1. GET /contacts/451                          → current state
2. PUT /contacts/451  body: Request-schema fields with current values, your changes applied
   e.g. {..., "phone_1":"+64 21 555 000", ...}
3. GET /contacts/451?fields=id,phone_1,modified  → confirm the change (and updateHash moved)
```

Until PUT merge semantics are verified, never send a minimal one-field body on a record you haven't just read — if PUT is full-replace, omitted fields may be cleared [UNVERIFIED].

### Pattern 11: Equipment update (no delete exists)

```
PUT /equipment/12  body: {..., "in_archive":true, ...}
```

"Remove" equipment = archive it (`in_archive:true`) — the API has **no equipment DELETE**.

### Pattern 12: Complete a task

```
GET /tasks/77 → mirror body; PUT /tasks/77 with "completed_at":"2026-06-10T14:00:00"
```

Whether `status` must also change (and to which workspace `/taskstatuses` value) is [UNVERIFIED] — read a completed task in the same workspace and copy its shape.

## Delete patterns

```
DELETE /tasks/77
# success: 200/2xx with empty body; verify with GET → expect 404
```

- Confirm with the user, restate what will be deleted (`displayname`, id) before the call.
- Cascade behaviour (e.g. deleting a contact with projects) is [UNVERIFIED] — expect a 400 if blocked; never pre-delete children to force it without explicit user instruction.
- **No DELETE for:** projects, subprojects, equipment, payments, folders, leave requests/mutations.

## What users will ask that you CANNOT do

Say so plainly and offer the nearest alternative:
| Ask | Reality | Offer |
| --- | --- | --- |
| "Change the project's customer/dates" | no project PUT | do it in Rentman UI; you can update satellites |
| "Add equipment to the project" | `projectequipment` read-only | project request w/ equipment lines, or UI |
| "Plan Jane on Saturday's show" | `projectcrew` read-only | set her availability + a task for the planner |
| "Create/send an invoice or quote" | both read-only | record a payment; report invoice status |
| "Upload this file to the project" | `/files` GET-only | Numa stores it; user attaches in Rentman |
| "Delete that old project" | no project DELETE | UI only |

## Safe mutation workflow (every write)

```
1. RESOLVE   — find the exact target id via a read; show the user displayname + id
2. PREVIEW   — state what you will change/create; confirm for money/deletes
3. MIRROR    — GET a sibling/current record; copy field formats exactly
4. WRITE     — one call; do NOT auto-retry 5xx/timeouts on POST
5. VERIFY    — GET the result; diff against intent; report data.id and what changed
6. RECOVER   — on timeout/5xx: search for the record before re-POSTing (no idempotency keys)
```
