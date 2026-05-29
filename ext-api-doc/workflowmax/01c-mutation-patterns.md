---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# WorkflowMax (by Xero) -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operations: create, update, archive/delete,
> and the lookup sequences that precede them. All calls go through the connector's
> `connect_request` proxy (token + `account_id` injected).
>
> **⚠️ LOW-MEDIUM CONFIDENCE.** No write was ever made against a live org. Payload shapes
> below are **[INFERRED]** from the synchub data model, legacy XML schemas, and the community
> Node SDK method set. **Do NOT treat these as drop-in payloads** — confirm exact field names,
> casing, and whether the body is JSON or XML on the first real call. The legacy write tier was
> XML-only; the OAuth2 tier likely accepts JSON with `Content-Type: application/json`, but this
> is unconfirmed. When in doubt, GET an existing record first and mirror its shape.

---

## Write Capabilities Summary

| Operation                 | Supported          | Method | Notes                                                               |
| ------------------------- | ------------------ | ------ | ------------------------------------------------------------------- |
| Create                    | Yes (per entity)   | POST   | `{resource}.api/add` — one record per call [DOCUMENTED via SDK]     |
| Full update               | Yes (per entity)   | PUT    | `{resource}.api/update` — send `UUID` + fields [DOCUMENTED via SDK] |
| Partial update            | No (no PATCH)      | —      | Updates likely replace; send the full intended state                |
| Delete                    | Client only (seen) | DELETE | `client.api/delete` — **destructive** [DOCUMENTED via SDK]          |
| Archive                   | Client only (seen) | POST   | `client.api/archive` — **destructive** [DOCUMENTED via SDK]         |
| Soft delete               | Archive (clients)  | POST   | Prefer archive over hard delete                                     |
| Bulk create/update/delete | No                 | —      | No bulk endpoints — loop single calls, sparingly                    |
| State transitions         | Implicit           | —      | Job state changes are side effects of actions, not a field write    |
| File upload               | [UNKNOWN]          | —      | Client documents exist; upload support unconfirmed                  |

---

## General Mutation Rules

1. **POST** `= /{resource}.api/add` → create. **PUT** `= /{resource}.api/update` → update (include `UUID`).
2. **`account_id` header + Bearer token** on every write (injected by the proxy).
3. **Cross-entity references use the target `UUID`**, never the human `ID`. Resolve UUIDs with a GET first.
4. **Dependency order:** Client → Job → (Task) → Time/Cost. You cannot log time to a job that doesn't exist.
5. **POST is NOT idempotent** — there is no idempotency key. Guard against double-creates: check for an existing record (by name/number) before creating.
6. **Confirm before destructive writes** (archive/delete client, anything financial). See Dangerous Operations.
7. **Check `Status` in the response**, not just HTTP code — a 200 with `Status: "Error"` is a failed write.

---

## Create Patterns

### Create a Client

```http
POST /client.api/add
Content-Type: application/json
Accept: application/json

{
  "Name": "Acme Ltd",
  "Email": "accounts@acme.co.nz",
  "Phone": "+64 9 123 4567",
  "Address": "123 Queen St",
  "City": "Auckland",
  "PostCode": "1010",
  "Country": "New Zealand"
}
```

**Response (200, [INFERRED]):**

```json
{ "Status": "OK", "Client": { "UUID": "a1b2c3d4-0000-1111-2222-333344445555", "Name": "Acme Ltd" } }
```

**Required:** `Name`. **Server-generated:** `UUID`, `WhenCreated`, `WhenModified`. [INFERRED]

---

### Create a Job

> Prerequisite: a Client `UUID`. Resolve it first.

```http
# Step 1 — find/confirm the client UUID
GET /client.api/list?page=1&pagesize=100   # match Name client-side

# Step 2 — create the job
POST /job.api/add
Content-Type: application/json

{
  "Name": "Website Redesign",
  "Description": "Phase 1 discovery",
  "ClientUUID": "a1b2c3d4-0000-1111-2222-333344445555",
  "StartDate": "2026-06-01",
  "DueDate": "2026-07-31",
  "Budget": "12000.00",
  "ManagerUUID": "c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff"
}
```

**Response (200, [INFERRED]):**

```json
{
  "Status": "OK",
  "Job": {
    "ID": "J000124",
    "UUID": "e3b0c442-98fc-1c14-9afb-f4c8996fb1a2",
    "Name": "Website Redesign",
    "State": "Planned"
  }
}
```

**Required:** `Name`, `ClientUUID`. **Server-generated:** `UUID`, `ID`, initial `State`. [INFERRED]

---

### Log a Time Entry

> Prerequisites: an existing Job (and usually a Task) and a Staff `UUID`.

```http
# Step 1 — staff UUID
GET /staff.api/list                        # match Name → UUID client-side

# Step 2 — job UUID/ID (and a task, if the job uses tasks)
GET /job.api/get?uuid={job_uuid}&detailed=true   # read Tasks[] for the TaskUUID

# Step 3 — log the time
POST /time.api/add
Content-Type: application/json

{
  "Job": "J000123",
  "Staff": "0d6d8234-1a2b-4c3d-9e8f-9f1a55667788",
  "Task": "Discovery",
  "Date": "2026-05-27",
  "Minutes": 90,
  "Billable": "Yes",
  "Note": "Stakeholder workshop"
}
```

**Response (200, [INFERRED]):**

```json
{ "Status": "OK", "Time": { "UUID": "7a8b9c0d-1234-5678-9abc-def0ff112233" } }
```

**Required:** `Job`, `Staff`, `Date`, `Minutes` (+ `Task` if the job uses tasks). **Note:** `Date` in
the body uses `YYYY-MM-DD`, unlike the `YYYYMMDD` used by `from`/`to` filters. [INFERRED]

---

## Update Patterns

### Update a Client (PUT — send UUID + full intended state)

```http
# Step 1 — GET the current record to mirror its shape
GET /client.api/get?uuid={client_uuid}

# Step 2 — PUT the full intended state, including UUID
PUT /client.api/update
Content-Type: application/json

{
  "UUID": "a1b2c3d4-0000-1111-2222-333344445555",
  "Name": "Acme Ltd",
  "Email": "ap@acme.co.nz",
  "Phone": "+64 9 123 4567"
}
```

> There is **no PATCH** — assume update is a replace of the supplied fields. To be safe, GET first
> and resend the fields you want to keep, not just the one you're changing. [INFERRED]

**Response (200, [INFERRED]):** `{ "Status": "OK", "Client": { ... } }`

### Update a Job

```http
PUT /job.api/update
Content-Type: application/json

{
  "UUID": "e3b0c442-98fc-1c14-9afb-f4c8996fb1a2",
  "Name": "Website Redesign (Phase 1 + 2)",
  "DueDate": "2026-08-31",
  "Budget": "18000.00"
}
```

> `State` is generally **not** directly writable — job state moves as a side effect of actions
> (starting work, completing, invoicing). Don't try to PUT `State` to flip the lifecycle. [INFERRED]

---

## State Transitions

WorkflowMax has **no explicit transition endpoints** and no writable `State` field on the job.
State changes happen as side effects:

| Desired transition      | How it actually happens                                       |
| ----------------------- | ------------------------------------------------------------- |
| Planned → In Progress   | Logging time/costs against the job (or completing setup)      |
| In Progress → Completed | Marking the job complete in the UI / via the job's own action |
| Completed → Invoiced    | Raising an invoice that covers the job's billable time/costs  |
| any → Cancelled         | Cancelling the job                                            |

> If a user asks the agent to "mark job complete" or "invoice this job" and no documented endpoint
> covers it, **say so** — do not fake a `State` PUT. These are [INFERRED] and need live confirmation.

---

## Delete / Archive Patterns

### Archive a Client (soft, preferred)

```http
POST /client.api/archive?uuid={client_uuid}
```

### Delete a Client (hard, destructive)

```http
DELETE /client.api/delete?uuid={client_uuid}
```

> Returns `Status: OK` on success; may return `Status: Error` (with `ErrorDescription`) if the client
> has dependent jobs/invoices. **Prefer archive over delete.** [DOCUMENTED via SDK that both exist; behaviour INFERRED.]

There is **no documented delete for jobs, invoices, or time entries** via the OAuth2 surface. If a
user asks to delete one, surface that it's not supported and suggest cancel/archive in the UI instead.

---

## Field Validation Rules

| Entity | Field         | Rule                                | Error if violated                |
| ------ | ------------- | ----------------------------------- | -------------------------------- |
| Job    | `ClientUUID`  | Must reference an existing client   | `Status: Error` / "Invalid UUID" |
| Job    | `Name`        | Required                            | `Status: Error` / missing field  |
| Time   | `Job`/`Staff` | Must reference existing job + staff | `Status: Error` / "Invalid UUID" |
| Time   | `Minutes`     | Positive integer                    | `Status: Error`                  |
| Time   | `Date`        | `YYYY-MM-DD`                        | parse/validation error           |
| Client | `Name`        | Required                            | `Status: Error` / missing field  |

[INFERRED — confirm exact error text live.] Cross-entity references that don't resolve are the most
common write failure: always GET the referenced record's `UUID` first.

---

## Server-Side Defaults

| Entity  | Field          | Default             | When applied   |
| ------- | -------------- | ------------------- | -------------- |
| all     | `UUID`         | auto-generated      | create         |
| Job     | `ID`           | next job number     | create         |
| Invoice | `ID`           | next invoice number | create         |
| all     | `WhenCreated`  | current timestamp   | create         |
| all     | `WhenModified` | current timestamp   | create, update |
| Job     | `State`        | `Planned` (approx)  | create         |

[INFERRED]

---

## Worked Examples

### Example 1: Onboard a new client and open their first job

> Client doesn't exist yet → create client → create job under it.

```http
# 1. Create the client
POST /client.api/add
{ "Name": "Riverside Cafe", "Email": "owner@riverside.co.nz", "City": "Wellington" }
# → { "Status": "OK", "Client": { "UUID": "<client_uuid>" } }

# 2. Create a job under the new client
POST /job.api/add
{ "Name": "Brand refresh", "ClientUUID": "<client_uuid>", "DueDate": "2026-07-15", "Budget": "5000.00" }
# → { "Status": "OK", "Job": { "ID": "J000125", "UUID": "<job_uuid>", "State": "Planned" } }
```

**Notes:** Two writes, ordered by dependency. Capture the client `UUID` from step 1 — do not re-list.

### Example 2: Log a billable hour against an existing job

```http
GET /staff.api/list                          # → resolve "Jane Smith" → <staff_uuid>
POST /time.api/add
{ "Job": "J000125", "Staff": "<staff_uuid>", "Task": "Design", "Date": "2026-05-28", "Minutes": 60, "Billable": "Yes" }
# → { "Status": "OK", "Time": { "UUID": "<time_uuid>" } }
```

**Notes:** Confirm the job exists and the task name matches a real task on the job (`detailed=true` GET) before logging.

### Example 3: Correct a client's email (update)

```http
GET /client.api/get?uuid=<client_uuid>       # mirror current shape
PUT /client.api/update
{ "UUID": "<client_uuid>", "Name": "Riverside Cafe", "Email": "accounts@riverside.co.nz", "City": "Wellington" }
# → { "Status": "OK", "Client": { ... } }
```

**Notes:** Resend `Name`/`City` alongside the changed `Email` — update is treated as a replace, not a patch.

---

## Gotchas & Counter-Exceptions

1. **No idempotency key.** A retried POST after a network blip can create a duplicate. Before creating,
   check for an existing record (client by name, job by name+client). After a successful create, never replay it.
2. **No PATCH.** Send the full intended state on update; GET first and mirror the shape so you don't blank fields.
3. **Body format is unconfirmed (JSON vs XML).** The legacy write tier was XML. If a JSON POST is rejected,
   the org/endpoint may require `Content-Type: application/xml` with a `<Job>...</Job>` body. Confirm live.
4. **`Date` body format ≠ filter format.** Bodies use `YYYY-MM-DD`; `from`/`to` filters use `YYYYMMDD`. Don't mix them.
5. **`State` isn't directly writable.** Don't fake job lifecycle transitions with a `State` PUT — they're side effects of actions (see State Transitions).

---

## Dangerous Operations

> The workspace agent MUST confirm with the user before executing these.

| Operation                                 | Why dangerous                                    | Safeguard                                      |
| ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `DELETE /client.api/delete`               | Permanent removal of a client (and its history)  | Confirm explicitly; prefer `archive`           |
| `POST /client.api/archive`                | Removes client from active use; affects its jobs | Confirm explicitly                             |
| Any invoice create/finalise               | Financial consequence — bills a customer         | Human-in-the-loop confirmation, always         |
| Repeated `add` on retry                   | May create duplicate clients/jobs/time           | Check-before-create; never replay a 200'd POST |
| Updating `Budget`/`DueDate` on a live job | Changes commercial terms                         | Confirm the intended values with the user      |

---

_Generated from the investigation questionnaire, Phases 3-4._
