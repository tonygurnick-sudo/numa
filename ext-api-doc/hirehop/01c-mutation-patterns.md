---
api_name: HireHop
api_slug: hirehop
doc: mutation-patterns (companion to 01-llm-api-rules.md — on-demand)
call_surface: HTTP via `numa integrations request`; path = {base_url}{path} incl. .php script; X-TOKEN header
verbs: NO PUT/PATCH/DELETE — everything is GET (reads) or POST (writes) to *.php. Updates are POSTs with partial-merge semantics
confidence: MEDIUM-LOW — params documented, NO write live-tested. Tags [INFERRED]/[UNKNOWN] where below default
---

# HireHop — Mutation Patterns Reference

All write patterns: create, update (partial), status transitions, duplication, attachments, custom fields.

## Write Capabilities Summary

| Operation         | Supported | Method | Notes                                                                         |
| ----------------- | --------- | ------ | ----------------------------------------------------------------------------- |
| Create            | Yes       | POST   | Job (`job=0`), contact, category, attachment                                  |
| Partial update    | Yes       | POST   | `save_job` updates ONLY the params you send — this IS the update mechanism    |
| Full replace      | No        | —      | No PUT/PATCH; all POST with partial semantics                                 |
| Delete            | Limited   | POST   | Attachment delete, empty-category delete. **No job delete** (cancel = status) |
| Soft delete       | Yes       | POST   | Job cancellation is a status change                                           |
| Bulk create       | Partial   | POST   | One job + full `items` map in a single `save_job` call                        |
| Bulk update       | No        | —      | No general bulk update                                                        |
| State transitions | Yes       | POST   | `status_save.php` (numeric status)                                            |
| File upload       | Yes       | POST   | `attach_files_upload.php` (multipart)                                         |

## Common Patterns

### 1. Create a job (with items)

`POST /api/save_job.php` (X-TOKEN, Content-Type: application/json):
`{"job":0,"name":"Jane Smith","company":"Acme Events Ltd","out":"2026-06-10 08:00:00","start":"2026-06-11 00:00:00","end":"2026-06-14 00:00:00","to":"2026-06-15 17:00:00","job_name":"Summer Festival Main Stage","depot":1,"client_id":1023,"items":{"b123":4,"a12":3.5,"c34":2.2}}`
→ `{"ID":53}`

- Required to create: `name`, `out`, `start`. Server-generated: `ID`, status, totals, `COLOUR`.
- **Idempotency: NONE.** `job=0` always creates a new record — re-POSTing produces duplicates. Read-before-write or store the returned `ID` [INFERRED].
- `items` map: key `<prefix><productId>` (`a`=sales,`b`=hire,`c`=labour), value=quantity. `items` is supported on `save_job.php`, NOT the bare `job_save.php` alias.

### 2. Edit a job (partial update)

Pass `job={id}` and ONLY the fields to change; everything else untouched.
`POST /php_functions/job_save.php`: `{"job":52,"job_name":"Renamed Festival Stage"}`
Edit custom fields only: `{"job":52,"custom_fields":{"po":"PO-9982","on_site_contact":"Dave"}}` — updates just those fields, leaves all others as-is.
**Check the lock first.** If `job_data` returns `LOCKED:1`, refuse the write (invoiced/closed jobs are not editable).

### 3. Change job status (state transition)

`POST /frames/status_save.php`: `{"job":52,"status":2,"no_webhook":0}`
→ `{"status":2,"colour":"#3399ff"}`

- Params: `job` (req), `status` (req, numeric), `no_webhook` (non-zero suppresses the status-change webhook).
- Idempotent: setting the same status again is a no-op [INFERRED].
- **Status integers are unverified** — the numeric→label map is NOT published. Before any status write on a tenant, discover the valid integers (read jobs at known statuses, or check the UI). Do not guess [INFERRED].

### 4. Duplicate a job

`POST /php_functions/job_duplicate.php`: `{"id":52,"notes":1,"tasks":1,"supplying":1,"update":1}`

- Params: `id` (source job — **`id`, NOT `job`**), optional `notes`/`tasks`/`supplying`/`update` flags controlling what is copied.
- Response: the new job's `ID` (documented shape) [INFERRED structure].

### 5. Create / edit a contact (client)

`POST /php_functions/contact_save.php`: `{"company":"New Customer Ltd","custom_fields":{"tier":"gold"}}`
Params: contact fields + `custom_fields`. Full param list not fully documented — discovery needed. To edit, pass the contact's ID (param name unverified; likely `id` or `client_id`) [INFERRED].

### 6. Upload a job attachment

`POST /php_functions/attach_files_upload.php` (Content-Type: multipart/form-data) with form fields `job=52` and `file=@contract.pdf`. Job-scoped multipart upload; size/type limits not documented. List via `attach_list.php?job=52`, delete via `attach_delete.php`.

## Field Validation Rules

HireHop enforces these on write (documented as required params; no explicit error strings live-tested).

| Entity | Field              | Rule                                     | Error if violated                  |
| ------ | ------------------ | ---------------------------------------- | ---------------------------------- |
| Job    | name               | Required on create                       | `{"error":3}` (Missing parameters) |
| Job    | out                | Required on create                       | `{"error":3}`                      |
| Job    | start              | Required on create                       | `{"error":3}`                      |
| Job    | (any, when LOCKED) | Locked jobs reject edits                 | error code (unverified)            |
| Job    | items keys         | `<a/b/c><productId>`; product must exist | error code (unverified)            |
| Status | status             | Must be a valid tenant status integer    | error code (unverified)            |
| Token  | token (query)      | Must be URL-encoded                      | auth failure (401/403)             |

Common codes: `3`="Missing parameters"; `327`=rate limit. Full table unpublished [INFERRED].

## Server-Side Defaults

| Entity | Field  | Default                             | When          |
| ------ | ------ | ----------------------------------- | ------------- |
| Job    | ID     | auto-generated integer              | create        |
| Job    | STATUS | initial enquiry status              | create        |
| Job    | COLOUR | derived from status                 | create/update |
| Job    | totals | computed server-side                | create/update |
| Line   | PRICE  | computed from qty × unit × duration | create/update |

## Worked Examples

### Example 1: Create a quote, then confirm it to "Booked"

Step 1 — create: `POST /api/save_job.php`:
`{"job":0,"name":"Jane Smith","company":"Acme Events Ltd","out":"2026-06-10 08:00:00","start":"2026-06-11 00:00:00","items":{"b123":4}}` → `{"ID":53}`
Step 2 — confirm (status integer must be the tenant's "Booked" value): `POST /frames/status_save.php`:
`{"job":53,"status":2}` → `{"status":2,"colour":"#3399ff"}`

- Capture the `ID` from step 1 — no idempotency key, so re-running step 1 makes a second job.
- Verify the "Booked" integer for this tenant before relying on `2`.

### Example 2: Add items to an existing job without touching anything else

`POST /api/save_job.php`: `{"job":52,"items":{"b123":4,"b200":2,"c34":1.5}}`

- Only `job`+`items` sent → dates/name/client unchanged (partial-merge).
- Whether `items` is additive or a full replacement of the supplying list is unverified — confirm on live before bulk edits [INFERRED].

### Example 3: Set custom fields on a job

`POST /php_functions/job_save.php`: `{"job":52,"custom_fields":{"po":"PO-9982","rigging_required":true}}`

- Sending only `custom_fields` updates exactly those and nothing else.
- Custom-field keys must match the tenant's global definitions (`custom_fields_global_load.php`).

## Gotchas

1. No PUT/PATCH/DELETE — all writes are POST to `*.php`. Updates are partial-merge, no "full replace".
2. `save_job` is partial, not full-replace: omitted params are preserved (opposite of a typical REST PUT). Use deliberately for surgical edits.
3. Create is not idempotent: `job=0` always inserts. Store/track the returned `ID` [INFERRED].
4. `items` only on `save_job.php`, not the bare `job_save.php` alias.
5. `job_duplicate.php` uses `id`, not `job`.
6. `status` is numeric and tenant-specific — discover the integers first; a wrong integer silently sets the wrong status [INFERRED].
7. Respect `LOCKED` — never write to a locked (invoiced/closed) job.
8. `no_webhook` on `status_save` suppresses the outgoing webhook — useful for bulk/automated status changes you don't want echoed to subscribers.

## Dangerous Operations (confirm with the user first)

| Operation                        | Why dangerous                                                   | Safeguard                                           |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `status_save.php` → Dispatched   | May auto-generate an invoice; hard to reverse                   | Confirm; verify target status integer first         |
| `status_save.php` → Cancelled    | Effectively cancels the booking                                 | Confirm                                             |
| `save_job` editing items in bulk | May replace the supplying list (additive-vs-replace unverified) | Read job first; confirm scope; verify on a test job |
| `attach_delete.php`              | Permanently removes a job attachment                            | Confirm                                             |
| `categories_delete.php`          | Deletes an (empty) category                                     | Confirm; only works if empty                        |
| `/api/sql_execute.php`           | Raw SQL — deprecated, unsafe                                    | **Never expose to the agent.** Out of scope         |
