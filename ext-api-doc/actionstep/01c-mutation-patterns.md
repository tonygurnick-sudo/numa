---
api_name: Actionstep
api_slug: actionstep
companion_to: 01-llm-api-rules.md
role: write operations — create, update, delete, state transitions
call_surface: HTTP POST/PUT/DELETE via `numa integrations request` to {api_endpoint}/api/rest/{resource}
body_envelope: resource-keyed — wrap payload under a key named after the resource, e.g. {"timeentries":{...}}. A bare {...} body is REJECTED.
auth_scope: writes happen under the connected USER's permissions — a 403 means the user lacks permission, not a bad token.
confidence: doc-based 2026-05-27. Exact field names / required-flags are 🔬 SANDBOX-CONFIRM — verify against live timeentries/filenotes/tasks schemas before production writes.
---

# Actionstep — Mutation Patterns

## Write Capabilities

| Operation         | Supported | Method            | Notes                                          |
| ----------------- | --------- | ----------------- | ---------------------------------------------- |
| Create            | Yes       | POST              | Resource-keyed body                            |
| Full replace      | Yes       | PUT               | `PUT /{resource}/{id}` (full record)           |
| Partial update    | Likely 🔬 | PUT/PATCH         | confirm whether PATCH is supported             |
| Delete            | Yes       | DELETE            | `DELETE /{resource}/{id}`                      |
| Bulk create       | 🔬        | —                 | Not documented                                 |
| State transitions | Yes       | step/status field | Step graph from ActionType                     |
| File upload       | 🔬        | —                 | `actiondocuments` upload mechanism unconfirmed |

## Patterns

**1. Create** — `POST {api_endpoint}/api/rest/timeentries` (`Content-Type: application/vnd.api+json`), body:
`{"timeentries":{"action":123,"minutes":30,"note":"Drafted advice","date":"2026-05-27"}}`
→ 201 `{"timeentries":{"id":555,"action":123,"minutes":30,"note":"Drafted advice"}}`
Body resource-keyed (fields under `"timeentries"`). Required: `action` + a duration (🔬 confirm unit/field name). Server-generated: `id`, `*Timestamp`.

**2. Update** — `PUT {api_endpoint}/api/rest/timeentries/555`, body `{"timeentries":{"note":"Drafted and sent advice"}}`. v1 uses **PUT** for updates. 🔬 Confirm whether a partial PUT is honoured or the full record must be sent. Until confirmed: GET the record, merge your change, PUT the merged object back to avoid clobbering fields.

**3. Delete** — `DELETE {api_endpoint}/api/rest/tasks/777` → 200/204. 🔬 Confirm hard vs soft delete and any cascade behaviour.

**4. Create a record against a matter** — `POST {api_endpoint}/api/rest/filenotes`, body `{"filenotes":{"action":123,"text":"Client called re: settlement."}}`. `action` (the matter id) ties the child record to its matter.

**5. State transition (matter step)** — Matter steps are defined by the matter's **ActionType**. Move a matter by setting its step field (or via the documented step-change action); valid target steps depend on the ActionType's workflow, so read `actiontypes` first. 🔬 Confirm the exact step-change request.

## Field Validation Codes

Validation failures return per-resource numeric codes in the error envelope (see 01d):
| Entity | Codes | Covers |
| --- | --- | --- |
| Action | `A01–A02` | Matter-level validation |
| Participant | `P01–P03` | Contact-level validation |
| Task | `T01–T11` | Task-level validation |
| Time record | `TR01–TR05` | Time-entry validation |

🔬 Map each numeric code → its message from the live `/error-codes/` reference for user-facing text.

## Server-Side Defaults

| Entity | Field        | Default        | When          |
| ------ | ------------ | -------------- | ------------- |
| (all)  | id           | auto-generated | create        |
| (all)  | `*Timestamp` | current time   | create/update |

## Worked Examples

1. **Log 30 min against a matter** — `POST /api/rest/timeentries`, body `{"timeentries":{"action":123,"minutes":30,"note":"Drafted advice","date":"2026-05-27"}}` → 201 `{"timeentries":{"id":555,...}}`. Confirm duration field `minutes`/`units`/`hours` before trusting totals.
2. **Add a file note** — `POST /api/rest/filenotes`, body `{"filenotes":{"action":123,"text":"Client called re: settlement."}}` → 201 `{"filenotes":{"id":901,"action":123}}`.
3. **Close a task** — `PUT /api/rest/tasks/777`, body `{"tasks":{"status":"closed"}}`. Exact status token is 🔬; GET-merge-PUT if partial updates aren't honoured.

## Gotchas

1. **Resource-keyed bodies:** wrap the payload under the resource name (`{"timeentries":{...}}`), matching the read envelope — a bare `{...}` body is rejected.
2. **PUT, not PATCH:** v1 favours PUT; don't assume PATCH semantics until confirmed.
3. **Writes are user-scoped:** a 403 means the connected user lacks permission, not a bad token.

## Dangerous Operations (confirm with the user first)

| Operation                   | Why dangerous                                | Safeguard                               |
| --------------------------- | -------------------------------------------- | --------------------------------------- |
| `DELETE /actions/{id}`      | Removes a matter, may cascade to children    | Confirm with user; prefer status change |
| `DELETE /participants/{id}` | Removes a contact referenced by matters      | Confirm with user                       |
| Matter step change          | Advances workflow; may trigger automations   | Confirm intended target step            |
| `PUT` without merge         | Can blank fields if partial PUT not honoured | GET-merge-PUT                           |
