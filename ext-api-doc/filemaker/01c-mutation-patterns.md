---
api_name: Claris FileMaker Data API
api_slug: filemaker
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest (real path segment, in the URL — not a label)
companion_to: 01-llm-api-rules.md
scope: write-side — create/edit/delete, portal-row writes, per-session globals, running scripts for bulk/business logic
confidence: create/edit/delete + modId + script execution [DOCUMENTED]; validation specifics schema-dependent + [UNKNOWN] until runtime; not live-verified
---

# Claris FileMaker Data API — Mutation Patterns Reference

**Discover before you write** (`GET /layouts/{layout}` — see `01a`). Every key in `fieldData` must be a real, _enterable_ field on the targeted layout: required (`notEmpty`) fields must be present; calc/summary fields must be absent (read-only, error if sent). Paths relative to `https://{server_url}/fmi/data/vLatest`. **HTTP 200 ≠ success — always check `messages[0].code`.**

## Write Capabilities Summary

| Operation                 | Supported            | Method                                        | Notes                                                     |
| ------------------------- | -------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Create                    | Yes                  | POST `/layouts/{layout}/records`              | one record per call; returns new `recordId`               |
| Partial update            | Yes                  | PATCH `/layouts/{layout}/records/{recordId}`  | only included fields change; optional `modId` lock        |
| Full replace              | No (PUT)             | —                                             | no PUT semantics; PATCH is the only edit                  |
| Delete                    | Yes                  | DELETE `/layouts/{layout}/records/{recordId}` | hard delete (subject to schema cascade rules)             |
| Soft delete               | No                   | —                                             | only if the customer's schema models a status field       |
| Bulk create/update/delete | No                   | —                                             | no batch endpoints; loop, or run a server-side **script** |
| State transitions         | Yes (as field edits) | PATCH                                         | statuses are tenant fields; PATCH the field               |
| Set globals               | Yes                  | PATCH `/layouts/{layout}/globals`             | per-session global field values                           |
| Run script                | Yes                  | GET `/layouts/{layout}/script/{name}`         | execute business logic / bulk ops                         |
| File / container upload   | No (out of scope)    | POST `.../containers/...` (multipart)         | `connect_request` is JSON-only                            |

## Pattern 1: Create a Record

`POST /databases/Inventory/layouts/Products/records` `{"fieldData":{"Product Name":"Gadget","Stock":100,"SKU":"G-007"}}`
→ `{"response":{"recordId":"514","modId":"0"},"messages":[{"code":"0","message":"OK"}]}`

- **Required fields:** whatever the layout marks `notEmpty` (discover via metadata). Omitting one ⇒ validation error.
- **Server-generated:** `recordId` (row handle), `modId` starts at `"0"`, plus any auto-enter fields (serials, timestamps).
- **NOT idempotent** — each call inserts a new row. Dedupe client-side (find by a unique key first).
- Omit calc/summary fields + `recordId`/`modId` from the body — read-only / server-assigned.

## Pattern 2: Edit a Record (partial) with optimistic locking

`PATCH /databases/Inventory/layouts/Products/records/514` `{"fieldData":{"Stock":95},"modId":"0"}`
→ `{"response":{"modId":"1"},"messages":[{"code":"0","message":"OK"}]}`

- Only the fields in `fieldData` change; everything else untouched (partial update).
- **`modId` = optimistic locking.** Send the current `modId` (from a prior read); if it no longer matches, the edit is rejected (someone else modified the record). **Omit `modId` to force the write** (last-write-wins).
- A successful edit increments `modId`. Idempotent in effect (re-applying the same body yields the same end state, though `modId` keeps bumping).

## Pattern 3: Delete a Record

`DELETE /databases/Inventory/layouts/Products/records/514`
→ `{"response":{},"messages":[{"code":"0","message":"OK"}]}`

- Hard delete of that one record. Any cascade (related records, portal rows) is governed by the customer's relationship graph "Delete related records" settings — NOT an API flag.
- Deleting an already-gone record returns code `101` (Record is missing). Idempotent in practice.

## Pattern 4: State Transition (status fields)

No dedicated transition endpoint — a business status is just a field. Transition it with a PATCH:
`PATCH /databases/Sales/layouts/Orders/records/88` `{"fieldData":{"Status":"Approved","Approved By":"Jane Smith","Approved Date":"2026-05-29"}}`
Allowed values come from the field's **value list** (discover via `valueLists` in layout metadata); a value outside the list errors if the schema validates against it. If the transition involves logic (notifications, downstream updates), prefer a **script** (Pattern 6) the customer authored to do it atomically.

## Pattern 5: Portal (Related-Record) Writes

Portal rows are created/edited through the **parent record's** PATCH, using `TableOccurrence::field` keys.

**Add a new portal row** (omit `recordId` on the row to create it):
`PATCH /databases/Sales/layouts/Orders/records/88` `{"fieldData":{},"portalData":{"Line Items":[{"Line Items::Item":"Bolt M6","Line Items::Qty":50}]}}`

**Edit an existing portal row** (include the row's `recordId`):
`PATCH /databases/Sales/layouts/Orders/records/88` `{"portalData":{"Line Items":[{"recordId":"501","modId":"0","Line Items::Qty":75}]}}`

**Delete a portal row:** add `"deleteRelated":"Line Items.501"` at the top level of the body (format `PortalName.recordId`). Verify the portal name + related table-occurrence name from layout metadata first.

## Pattern 6: Run a Script (bulk / business logic)

The efficient path for multi-record or complex ops is a **server-side FileMaker script** the customer authored. List with `GET /scripts`, then run:
`GET /databases/Inventory/layouts/Products/script/Recalculate%20Stock?script.param=2026-05`
→ `{"response":{"scriptResult":"OK: 412 records updated","scriptError":"0"},"messages":[{"code":"0","message":"OK"}]}`

- Script name is URL-encoded; a single string argument goes in `script.param`.
- `scriptResult` = whatever the script returns (`Exit Script` value); `scriptError` = the FileMaker error the script itself hit (`"0"`=none). Check **both** plus `messages[].code`.
- Scripts can be **chained** onto a record/find call via `script`, `script.prerequest`, `script.presort` (each with a matching `.param`) — e.g. run validation before a create.

## Pattern 7: Set Per-Session Global Fields

Global fields can be set for the current session (useful as parameters scripts read):
`PATCH /databases/Inventory/layouts/Products/globals` `{"globalFields":{"Products::gCurrentRegion":"APAC"}}`
Globals set this way last only for the session's token; they do not modify stored data and reset when the session ends.

## Field Validation Rules

Schema-defined, enforced server-side on every write. Common failures:
| Rule | Triggers error | Typical code |
| --- | --- | --- |
| Required field (`notEmpty`) missing | omitting a required field on create | `500` (validation) |
| Value-list constraint | value not in the field's value list | `500` |
| Unique value | duplicate of a uniquely-validated field | `504` |
| Type / format | bad date/number for the field type | `500` |
| Read-only field sent | calc/summary field in `fieldData` | error (field not modifiable) |

Discover required fields + value lists from `GET /layouts/{layout}` **before** building the write — there is no "describe required fields" endpoint, and the error messages do not always name the offending field.

## Server-Side Defaults

| Field                                                                   | Default                           | When applied                 |
| ----------------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| `recordId`                                                              | server-assigned integer-as-string | create                       |
| `modId`                                                                 | `"0"`, then increments            | create, then each edit       |
| Auto-enter fields (serial, creation/modification timestamp, created-by) | per schema                        | create / edit, as configured |

You cannot set `recordId`/`modId`; do not send them in `fieldData`.

## Worked Example: Idempotent "upsert" by business key

FileMaker has no native upsert. Compose one (find → create-or-edit):

```
1. POST /layouts/Products/_find   {"query":[{"SKU":"==G-007"}],"limit":"1"}
   - code 401 → not found → go to 2a
   - code 0   → found; capture data[0].recordId + data[0].modId → go to 2b
2a. POST /layouts/Products/records   {"fieldData":{"SKU":"G-007","Product Name":"Gadget","Stock":100}}
2b. PATCH /layouts/Products/records/{recordId}   {"fieldData":{"Stock":95},"modId":"{modId}"}
```

Safe to retry: a re-run finds the existing record and edits it instead of duplicating.

## Gotchas & Counter-Exceptions

1. **HTTP 200 with a non-zero `messages[].code` is a failure.** A create that "returned 200" but has `code:"504"` did NOT insert — read `messages` before reporting success.
2. **`modId` mismatch silently means "someone else edited it".** Decide: re-read + merge, or omit `modId` to overwrite.
3. **No bulk endpoints.** Looping single-record writes is slow + not atomic; prefer a server-side script for >~20 rows.
4. **Portal writes go through the parent PATCH**, not a separate child endpoint, and use `TO::field` keys.
5. **Container upload is multipart → out of scope** for JSON-only `connect_request`. Tell the user it needs a v2 handler.
6. **Deletes can cascade** per the customer's schema, with no API flag to control it — confirm with the user first.

## Dangerous Operations (confirm with the user before executing)

| Operation                 | Why dangerous                                               | Safeguard                                                                     |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Delete record             | hard delete; may cascade to related records per schema      | confirm; show the record's key fields first                                   |
| Force edit (omit `modId`) | overwrites a concurrent change (lost update)                | prefer sending `modId`; only force when the user accepts last-write-wins      |
| Run a script              | executes arbitrary customer logic that can mass-mutate data | confirm the script name + parameter; check `scriptResult`/`scriptError` after |
| Mass mutation via loop    | partial failure leaves data half-changed                    | prefer one atomic script; otherwise track which records succeeded             |
