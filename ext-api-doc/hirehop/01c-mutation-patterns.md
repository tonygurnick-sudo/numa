---
api_name: 'HireHop'
api_slug: 'hirehop'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# HireHop -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. All write patterns: create, update (partial),
> status transitions, duplication, attachments, custom fields.
>
> **Confidence: MEDIUM-LOW.** `job_save`/`status_save` params are documented; **no write was
> live-tested.** Treat request/response bodies as documented shapes pending live verification.
> Tags: `[DOCUMENTED]`, `[INFERRED]`, `[UNKNOWN]`.

---

## Write Capabilities Summary

| Operation         | Supported | Method | Notes                                                                         |
| ----------------- | --------- | ------ | ----------------------------------------------------------------------------- |
| Create            | Yes       | POST   | Job (`job=0`), contact, category, attachment                                  |
| Partial update    | Yes       | POST   | `job_save` updates ONLY the params you send — this IS the update mechanism    |
| Full replace      | No        | —      | No PUT/PATCH; everything is POST with partial semantics                       |
| Delete            | Limited   | POST   | Attachment delete, empty-category delete. **No job delete** (cancel = status) |
| Soft delete       | Yes       | POST   | Job cancellation is a status change, not a delete                             |
| Bulk create       | Partial   | POST   | One job + its full `items` map in a single `save_job` call                    |
| Bulk update       | No        | —      | No general bulk update across arbitrary records                               |
| State transitions | Yes       | POST   | `status_save.php` (numeric status)                                            |
| File upload       | Yes       | POST   | `attach_files_upload.php` (multipart)                                         |

> **REST note:** HireHop has no PUT/PATCH/DELETE verbs in its public surface. Everything is GET (reads) or POST (writes), targeting `*.php` scripts. Updates are POSTs with partial-merge semantics.

---

## Common Patterns

### Pattern 1: Create a job (with items)

```http
POST /api/save_job.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: dqwejk5...=-7hmn
Content-Type: application/json

{
  "job": 0,
  "name": "Jane Smith",
  "company": "Acme Events Ltd",
  "out": "2026-06-10 08:00:00",
  "start": "2026-06-11 00:00:00",
  "end": "2026-06-14 00:00:00",
  "to": "2026-06-15 17:00:00",
  "job_name": "Summer Festival Main Stage",
  "depot": 1,
  "client_id": 1023,
  "items": { "b123": 4, "a12": 3.5, "c34": 2.2 }
}
```

**Response (documented shape):**

```json
{ "ID": 53 }
```

**Required to create:** `name`, `out`, `start`. [DOCUMENTED]
**Server-generated:** `ID`, status, totals, `COLOUR`. [DOCUMENTED]
**Idempotency:** **None.** `job=0` always creates a new record — re-POSTing produces duplicates. Read-before-write or store the returned `ID`. [INFERRED]
**`items` map:** key `<prefix><productId>` (`a`=sales, `b`=hire, `c`=labour), value = quantity. The `items` param is supported on `save_job.php` (not the bare `job_save.php` alias). [DOCUMENTED]

---

### Pattern 2: Edit a job (partial update)

> Pass `job={id}` and ONLY the fields to change. Everything else is untouched.

```http
POST /php_functions/job_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 52, "job_name": "Renamed Festival Stage" }
```

**Behavior:** Only included params are modified. e.g. sending only `custom_fields` updates _just_ the custom fields and leaves all other fields as-is. [DOCUMENTED]

**Edit custom fields only:**

```http
POST /php_functions/job_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 52, "custom_fields": { "po": "PO-9982", "on_site_contact": "Dave" } }
```

**IMPORTANT — check the lock first.** If `job_data` returns `LOCKED: 1`, refuse the write (invoiced/closed jobs are not editable). [DOCUMENTED]

---

### Pattern 3: Change job status (state transition)

```http
POST /frames/status_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 52, "status": 2, "no_webhook": 0 }
```

**Response (documented shape):**

```json
{ "status": 2, "colour": "#3399ff" }
```

**Params:** `job` (required), `status` (required, numeric), `no_webhook` (non-zero suppresses the status-change webhook). [DOCUMENTED]
**Idempotent:** setting the same status again is a no-op. [INFERRED]

**IMPORTANT — status integers are unverified.** The numeric→label map is NOT published. Before issuing any status write on a tenant, discover the valid integers (read jobs at known statuses, or check the UI). Do not guess. [INFERRED]

---

### Pattern 4: Duplicate a job

```http
POST /php_functions/job_duplicate.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "id": 52, "notes": 1, "tasks": 1, "supplying": 1, "update": 1 }
```

**Params:** `id` (the source job — **note: `id`, not `job`**), optional `notes`, `tasks`, `supplying`, `update` flags controlling what is copied. [DOCUMENTED]
**Response:** the new job's `ID` (documented shape). [INFERRED structure]

---

### Pattern 5: Create / edit a contact (client)

```http
POST /php_functions/contact_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "company": "New Customer Ltd", "custom_fields": { "tier": "gold" } }
```

**Params:** contact fields + `custom_fields`. Full param list is **not fully documented — discovery needed.** To edit, pass the contact's ID (param name unverified; likely `id` or `client_id`). [DOCUMENTED / INFERRED]

---

### Pattern 6: Upload a job attachment

```http
POST /php_functions/attach_files_upload.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: multipart/form-data; boundary=----numa

------numa
Content-Disposition: form-data; name="job"

52
------numa
Content-Disposition: form-data; name="file"; filename="contract.pdf"
Content-Type: application/pdf

<binary>
------numa--
```

Multipart upload, job-scoped. Size/type limits not documented. List via `attach_list.php?job=52`, delete via `attach_delete.php`. [DOCUMENTED]

---

## Field Validation Rules

> HireHop enforces these on write. Most are documented as required params, not as explicit error strings (no live test).

| Entity | Field              | Rule                                     | Error if Violated                   |
| ------ | ------------------ | ---------------------------------------- | ----------------------------------- |
| Job    | name               | Required on create                       | `{"error": 3}` (Missing parameters) |
| Job    | out                | Required on create                       | `{"error": 3}`                      |
| Job    | start              | Required on create                       | `{"error": 3}`                      |
| Job    | (any, when LOCKED) | Locked jobs reject edits                 | error code (unverified)             |
| Job    | items keys         | `<a/b/c><productId>`; product must exist | error code (unverified)             |
| Status | status             | Must be a valid tenant status integer    | error code (unverified)             |
| Token  | token (query)      | Must be URL-encoded                      | auth failure (401/403)              |

**Common error codes:** `3` = "Missing parameters"; `327` = rate limit. Full table not published. [DOCUMENTED / INFERRED]

---

## Server-Side Defaults

| Entity | Field  | Default Value                       | When Applied  |
| ------ | ------ | ----------------------------------- | ------------- |
| Job    | ID     | auto-generated integer              | create        |
| Job    | STATUS | initial enquiry status              | create        |
| Job    | COLOUR | derived from status                 | create/update |
| Job    | totals | computed server-side                | create/update |
| Line   | PRICE  | computed from qty × unit × duration | create/update |

---

## Worked Examples

### Example 1: Create a quote, then confirm it to "Booked"

> Two-step: create the job (enquiry), then move its status.

**Step 1 — create:**

```http
POST /api/save_job.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 0, "name": "Jane Smith", "company": "Acme Events Ltd",
  "out": "2026-06-10 08:00:00", "start": "2026-06-11 00:00:00",
  "items": { "b123": 4 } }
```

Response: `{ "ID": 53 }`

**Step 2 — confirm (status integer must be the tenant's "Booked" value):**

```http
POST /frames/status_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 53, "status": 2 }
```

Response: `{ "status": 2, "colour": "#3399ff" }`

**Notes:**

- Capture the `ID` from step 1 — there is no idempotency key, so re-running step 1 makes a second job.
- Verify the "Booked" integer for this tenant before relying on `2`.

---

### Example 2: Add items to an existing job without touching anything else

```http
POST /api/save_job.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 52, "items": { "b123": 4, "b200": 2, "c34": 1.5 } }
```

**Notes:**

- Because only `job` + `items` are sent, the job's dates/name/client are unchanged (partial-merge). [DOCUMENTED]
- Whether `items` is additive or a full replacement of the supplying list is **unverified — confirm on the live instance** before bulk edits. [INFERRED]

---

### Example 3: Set custom fields on a job

```http
POST /php_functions/job_save.php HTTP/1.1
Host: myhirehop.com
X-TOKEN: {token}
Content-Type: application/json

{ "job": 52, "custom_fields": { "po": "PO-9982", "rigging_required": true } }
```

**Notes:**

- Sending only `custom_fields` updates exactly those fields and nothing else. [DOCUMENTED]
- Custom-field keys must match the tenant's global definitions (`custom_fields_global_load.php`).

---

## Gotchas & Counter-Exceptions

1. **There is no PUT/PATCH/DELETE.** All writes are POST to `*.php`. Updates are POSTs with partial-merge semantics — there is no "full replace". [DOCUMENTED]
2. **`save_job` is partial, not full-replace:** omitted params are preserved. This is the opposite of a typical REST PUT. Use it deliberately for surgical edits. [DOCUMENTED]
3. **Create is not idempotent:** `job=0` always inserts. Store/track the returned `ID`. [INFERRED]
4. **`items` only on `save_job.php`,** not the bare `job_save.php` alias. [DOCUMENTED]
5. **`job_duplicate.php` uses `id`, not `job`.** Easy to get wrong. [DOCUMENTED]
6. **`status` is numeric and tenant-specific** — discover the integers first; a wrong integer silently sets the wrong status. [INFERRED]
7. **Respect `LOCKED`** — never write to a locked (invoiced/closed) job. [DOCUMENTED]
8. **`no_webhook`** on `status_save` suppresses the outgoing webhook — useful for bulk/automated status changes you don't want to echo to subscribers. [DOCUMENTED]

---

## Dangerous Operations

> Confirm with the user before executing these.

| Operation                        | Why Dangerous                                                   | Safeguard                                                        |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `status_save.php` to Dispatched  | May auto-generate an invoice; hard to reverse                   | Confirm with user; verify the target status integer first        |
| `status_save.php` to Cancelled   | Effectively cancels the booking                                 | Confirm with user                                                |
| `save_job` editing items in bulk | May replace the supplying list (additive-vs-replace unverified) | Read the job first; confirm scope; verify behavior on a test job |
| `attach_delete.php`              | Permanently removes a job attachment                            | Confirm with user                                                |
| `categories_delete.php`          | Deletes a (empty) category                                      | Confirm; only works if empty                                     |
| `/api/sql_execute.php`           | Raw SQL — deprecated, unsafe                                    | **Never expose to the agent.** Out of scope.                     |

---

_Generated from the investigation questionnaire (Phases 3-4) + official HireHop docs. NOT live-tested._
