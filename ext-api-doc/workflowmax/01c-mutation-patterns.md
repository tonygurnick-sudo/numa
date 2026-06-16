---
api_name: WorkflowMax (by Xero)
api_slug: workflowmax
doc: mutation patterns reference (companion to 01-llm-api-rules.md)
call_surface: HTTP via `numa integrations request`; proxy injects token + account_id
body_format: UNCONFIRMED — legacy write tier was XML-only; OAuth2 tier likely accepts JSON with `Content-Type: application/json`. If a JSON POST is rejected, retry with `application/xml` + `<Job>...</Job>` body. When in doubt, GET an existing record first and mirror its shape.
field_casing: PascalCase
confidence: LOW-MEDIUM — no live write made; payload shapes [INFERRED] from synchub model, legacy XML schemas, community Node SDK. NOT drop-in payloads — confirm field names/casing/format on first real call. [DOCUMENTED] = vendor/SDK-stated.
---

# WorkflowMax — Mutation Patterns Reference

## Write Capabilities

| Operation                 | Supported          | Method | Notes                                                                           |
| ------------------------- | ------------------ | ------ | ------------------------------------------------------------------------------- |
| Create                    | Yes (per entity)   | POST   | `{resource}.api/add` — one record per call [DOCUMENTED via SDK]                 |
| Full update               | Yes (per entity)   | PUT    | `{resource}.api/update` — send `UUID` + fields [DOCUMENTED via SDK]             |
| Partial update            | No (no PATCH)      | —      | update likely replaces; send full intended state                                |
| Delete                    | Client only (seen) | DELETE | `client.api/delete` — **destructive** [DOCUMENTED via SDK]                      |
| Archive                   | Client only (seen) | POST   | `client.api/archive` — **destructive**, prefer over delete [DOCUMENTED via SDK] |
| Bulk create/update/delete | No                 | —      | no bulk endpoints — loop single calls, sparingly                                |
| State transitions         | Implicit           | —      | job state changes are side effects of actions, not a field write                |
| File upload               | [UNKNOWN]          | —      | client documents exist; upload support unconfirmed                              |

## General Mutation Rules

1. **POST** = `/{resource}.api/add` (create); **PUT** = `/{resource}.api/update` (update, include `UUID`).
2. `account_id` header + Bearer token on every write (proxy-injected).
3. **Cross-entity references use the target `UUID`, never the human `ID`.** Resolve UUIDs with a GET first.
4. **Dependency order:** Client → Job → (Task) → Time/Cost. Cannot log time to a job that doesn't exist.
5. **POST is NOT idempotent** (no idempotency key). Guard against double-creates: check for an existing record (by name/number) before creating; never replay a 200'd POST.
6. **Confirm before destructive writes** (archive/delete client, anything financial — see Dangerous Operations).
7. **Check body `Status`, not just HTTP code** — a 200 with `Status:"Error"` is a failed write.

## Create Patterns

**Create a Client** — `POST /client.api/add`, `Content-Type: application/json`:
`{"Name":"Acme Ltd","Email":"accounts@acme.co.nz","Phone":"+64 9 123 4567","Address":"123 Queen St","City":"Auckland","PostCode":"1010","Country":"New Zealand"}`
→ `{"Status":"OK","Client":{"UUID":"a1b2c3d4-0000-1111-2222-333344445555","Name":"Acme Ltd"}}`. Required: `Name`. Server-generated: `UUID`,`WhenCreated`,`WhenModified`.

**Create a Job** (prereq: a Client `UUID` — resolve first via `GET /client.api/list?page=1&pagesize=100`, match `Name` client-side) — `POST /job.api/add`:
`{"Name":"Website Redesign","Description":"Phase 1 discovery","ClientUUID":"a1b2c3d4-0000-1111-2222-333344445555","StartDate":"2026-06-01","DueDate":"2026-07-31","Budget":"12000.00","ManagerUUID":"c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff"}`
→ `{"Status":"OK","Job":{"ID":"J000124","UUID":"e3b0c442-98fc-1c14-9afb-f4c8996fb1a2","Name":"Website Redesign","State":"Planned"}}`. Required: `Name`,`ClientUUID`. Server-generated: `UUID`,`ID`,initial `State`.

**Log a Time Entry** (prereqs: existing Job + usually a Task + a Staff `UUID`). Step 1 `GET /staff.api/list` (match Name → UUID); step 2 `GET /job.api/get?uuid={job_uuid}&detailed=true` (read `Tasks[]` for the `TaskUUID`); step 3 `POST /time.api/add`:
`{"Job":"J000123","Staff":"0d6d8234-1a2b-4c3d-9e8f-9f1a55667788","Task":"Discovery","Date":"2026-05-27","Minutes":90,"Billable":"Yes","Note":"Stakeholder workshop"}`
→ `{"Status":"OK","Time":{"UUID":"7a8b9c0d-1234-5678-9abc-def0ff112233"}}`. Required: `Job`,`Staff`,`Date`,`Minutes` (+`Task` if the job uses tasks). `Date` body uses `YYYY-MM-DD`, unlike the `YYYYMMDD` of `from`/`to` filters.

## Update Patterns

No PATCH — update is a replace of supplied fields. GET first and resend the fields you want to keep, not just the one you're changing.

**Update a Client** — `GET /client.api/get?uuid={client_uuid}` to mirror shape, then `PUT /client.api/update`:
`{"UUID":"a1b2c3d4-0000-1111-2222-333344445555","Name":"Acme Ltd","Email":"ap@acme.co.nz","Phone":"+64 9 123 4567"}`
→ `{"Status":"OK","Client":{...}}`.

**Update a Job** — `PUT /job.api/update`:
`{"UUID":"e3b0c442-98fc-1c14-9afb-f4c8996fb1a2","Name":"Website Redesign (Phase 1 + 2)","DueDate":"2026-08-31","Budget":"18000.00"}`
`State` is NOT directly writable — don't PUT `State` to flip the lifecycle (see State Transitions).

## State Transitions

No explicit transition endpoints and no writable `State` field. State changes happen as side effects:
| Desired transition | How it actually happens |
| --- | --- |
| Planned → In Progress | logging time/costs against the job (or completing setup) |
| In Progress → Completed | marking the job complete in the UI / via the job's own action |
| Completed → Invoiced | raising an invoice covering the job's billable time/costs |
| any → Cancelled | cancelling the job |

> If a user asks to "mark job complete" or "invoice this job" and no documented endpoint covers it, **say so** — do not fake a `State` PUT.

## Delete / Archive Patterns

- **Archive a Client (soft, preferred):** `POST /client.api/archive?uuid={client_uuid}`
- **Delete a Client (hard, destructive):** `DELETE /client.api/delete?uuid={client_uuid}`

Returns `Status: OK` on success; may return `Status: Error` (+ `ErrorDescription`) if the client has dependent jobs/invoices. **Prefer archive over delete.** No documented delete for jobs/invoices/time entries via the OAuth2 surface — if asked, surface that it's unsupported and suggest cancel/archive in the UI.

## Field Validation Rules

| Entity | Field         | Rule                                | Error if violated                |
| ------ | ------------- | ----------------------------------- | -------------------------------- |
| Job    | `ClientUUID`  | must reference an existing client   | `Status: Error` / "Invalid UUID" |
| Job    | `Name`        | required                            | `Status: Error` / missing field  |
| Time   | `Job`/`Staff` | must reference existing job + staff | `Status: Error` / "Invalid UUID" |
| Time   | `Minutes`     | positive integer                    | `Status: Error`                  |
| Time   | `Date`        | `YYYY-MM-DD`                        | parse/validation error           |
| Client | `Name`        | required                            | `Status: Error` / missing field  |

Confirm exact error text live. Cross-entity references that don't resolve are the most common write failure — always GET the referenced record's `UUID` first.

## Server-Side Defaults

| Entity  | Field          | Default             | When applied   |
| ------- | -------------- | ------------------- | -------------- |
| all     | `UUID`         | auto-generated      | create         |
| Job     | `ID`           | next job number     | create         |
| Invoice | `ID`           | next invoice number | create         |
| all     | `WhenCreated`  | current timestamp   | create         |
| all     | `WhenModified` | current timestamp   | create, update |
| Job     | `State`        | `Planned` (approx)  | create         |

## Worked Examples

**1. Onboard a client + open their first job** — two writes, dependency-ordered; capture the client `UUID` from step 1, don't re-list:
`POST /client.api/add` `{"Name":"Riverside Cafe","Email":"owner@riverside.co.nz","City":"Wellington"}` → `{"Status":"OK","Client":{"UUID":"<client_uuid>"}}`
`POST /job.api/add` `{"Name":"Brand refresh","ClientUUID":"<client_uuid>","DueDate":"2026-07-15","Budget":"5000.00"}` → `{"Status":"OK","Job":{"ID":"J000125","UUID":"<job_uuid>","State":"Planned"}}`

**2. Log a billable hour against an existing job** — confirm the job exists and the task name matches a real task (`detailed=true` GET) before logging:
`GET /staff.api/list` → resolve "Jane Smith" → `<staff_uuid>`
`POST /time.api/add` `{"Job":"J000125","Staff":"<staff_uuid>","Task":"Design","Date":"2026-05-28","Minutes":60,"Billable":"Yes"}` → `{"Status":"OK","Time":{"UUID":"<time_uuid>"}}`

**3. Correct a client's email (update)** — resend `Name`/`City` alongside the changed `Email` (replace, not patch):
`GET /client.api/get?uuid=<client_uuid>` then `PUT /client.api/update` `{"UUID":"<client_uuid>","Name":"Riverside Cafe","Email":"accounts@riverside.co.nz","City":"Wellington"}` → `{"Status":"OK","Client":{...}}`

## Gotchas

1. **No idempotency key.** A retried POST after a network blip can duplicate. Check-before-create (client by name; job by name+client); never replay a POST that returned `Status: OK`.
2. **No PATCH.** Send full intended state on update; GET first and mirror so you don't blank fields.
3. **Body format unconfirmed (JSON vs XML).** Legacy write tier was XML. JSON POST rejected → retry with `Content-Type: application/xml` + `<Job>...</Job>` body.
4. **`Date` body format ≠ filter format.** Bodies use `YYYY-MM-DD`; `from`/`to` filters use `YYYYMMDD`.
5. **`State` isn't directly writable** — don't fake lifecycle transitions with a `State` PUT (side effects of actions).

## Dangerous Operations (MUST confirm with the user first)

| Operation                                 | Why dangerous                                    | Safeguard                                      |
| ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `DELETE /client.api/delete`               | permanent removal of a client + its history      | confirm explicitly; prefer `archive`           |
| `POST /client.api/archive`                | removes client from active use; affects its jobs | confirm explicitly                             |
| Any invoice create/finalise               | financial — bills a customer                     | human-in-the-loop confirmation, always         |
| Repeated `add` on retry                   | may create duplicate clients/jobs/time           | check-before-create; never replay a 200'd POST |
| Updating `Budget`/`DueDate` on a live job | changes commercial terms                         | confirm intended values with the user          |
