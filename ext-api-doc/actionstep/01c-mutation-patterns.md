---
api_name: 'Actionstep'
api_slug: 'actionstep'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-27'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Actionstep — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operations: create, update, delete.
>
> ⚠️ Write **bodies are resource-keyed** (the same envelope as reads): wrap the payload in a key
> named after the resource. Exact field names / required flags are **🔬 SANDBOX-CONFIRM** —
> verify against the live `timeentries`/`filenotes`/`tasks` schemas before writing in production.
> Actionstep writes happen under the connected **user's** permissions.

---

## Write Capabilities Summary

| Operation         | Supported | Method                | Notes                                          |
| ----------------- | --------- | --------------------- | ---------------------------------------------- |
| Create            | Yes       | POST                  | Resource-keyed body                            |
| Full replace      | Yes       | PUT                   | `PUT /{resource}/{id}` (full record)           |
| Partial update    | Likely    | PUT/PATCH             | 🔬 confirm whether PATCH is supported          |
| Delete            | Yes       | DELETE                | `DELETE /{resource}/{id}`                      |
| Bulk create       | 🔬        | —                     | Not documented                                 |
| State transitions | Yes       | via step/status field | Step graph from ActionType                     |
| File upload       | 🔬        | —                     | `actiondocuments` upload mechanism unconfirmed |

---

## Common Patterns

### Pattern 1: Create

```http
POST {api_endpoint}/api/rest/timeentries
Authorization: Bearer <token>
Content-Type: application/vnd.api+json

{ "timeentries": { "action": 123, "minutes": 30, "note": "Drafted advice", "date": "2026-05-27" } }
```

**Response (201 Created):**

```json
{ "timeentries": { "id": 555, "action": 123, "minutes": 30, "note": "Drafted advice" } }
```

- **Body is resource-keyed:** wrap fields under `"timeentries"`.
- **Required fields:** `action` + a duration (🔬 confirm unit/field name).
- **Server-generated:** `id`, `*Timestamp`.

### Pattern 2: Update

```http
PUT {api_endpoint}/api/rest/timeentries/555
Authorization: Bearer <token>
Content-Type: application/vnd.api+json

{ "timeentries": { "note": "Drafted and sent advice" } }
```

- Actionstep v1 uses **PUT** for updates. 🔬 Confirm whether a partial PUT (only changed fields)
  is honoured or whether the full record must be sent. Until confirmed, GET the record, merge your
  change, and PUT the merged object back to avoid clobbering fields.

### Pattern 3: Delete

```http
DELETE {api_endpoint}/api/rest/tasks/777
Authorization: Bearer <token>
```

**Response:** 200/204. 🔬 Confirm whether deletes are hard or soft and any cascade behaviour.

### Pattern 4: Create a record against a matter

```http
POST {api_endpoint}/api/rest/filenotes
Content-Type: application/vnd.api+json

{ "filenotes": { "action": 123, "text": "Client called re: settlement." } }
```

- `action` (the matter id) ties the child record to its matter.

### Pattern 5: State transition (matter step)

Matter steps are defined by the matter's **ActionType**. Move a matter by setting its step
field (or via the documented step-change action). The valid target steps depend on the
ActionType's workflow, so read `actiontypes` first. 🔬 Confirm the exact step-change request.

---

## Field Validation Rules

Validation failures return per-resource numeric codes in the error envelope (see `01d`):

| Entity      | Codes       | Examples of what they cover |
| ----------- | ----------- | --------------------------- |
| Action      | `A01–A02`   | Matter-level validation     |
| Participant | `P01–P03`   | Contact-level validation    |
| Task        | `T01–T11`   | Task-level validation       |
| Time record | `TR01–TR05` | Time-entry validation       |

> 🔬 Map each numeric code to its message from the live `/error-codes/` reference when building
> user-facing error messages.

---

## Server-Side Defaults

| Entity | Field        | Default        | When Applied  |
| ------ | ------------ | -------------- | ------------- |
| (all)  | id           | auto-generated | create        |
| (all)  | `*Timestamp` | current time   | create/update |

---

## Worked Examples

### Example 1: Log 30 minutes against a matter

```http
POST {api_endpoint}/api/rest/timeentries
Content-Type: application/vnd.api+json

{ "timeentries": { "action": 123, "minutes": 30, "note": "Drafted advice", "date": "2026-05-27" } }
```

**Response (201):** `{ "timeentries": { "id": 555, ... } }`
**Notes:** confirm whether the duration field is `minutes`/`units`/`hours` before trusting totals.

### Example 2: Add a file note

```http
POST {api_endpoint}/api/rest/filenotes
Content-Type: application/vnd.api+json

{ "filenotes": { "action": 123, "text": "Client called re: settlement." } }
```

**Response (201):** `{ "filenotes": { "id": 901, "action": 123 } }`

### Example 3: Close a task

```http
PUT {api_endpoint}/api/rest/tasks/777
Content-Type: application/vnd.api+json

{ "tasks": { "status": "closed" } }
```

**Notes:** exact status token is 🔬; GET-merge-PUT if partial updates aren't honoured.

---

## Gotchas & Counter-Exceptions

1. **Resource-keyed bodies:** wrap the payload under the resource name (`{"timeentries": {...}}`),
   matching the read envelope — a bare `{...}` body will be rejected.
2. **PUT, not PATCH:** v1 favours PUT; do not assume PATCH semantics until confirmed.
3. **Writes are user-scoped:** a 403 means the connected user lacks permission, not that the
   token is wrong.

---

## Dangerous Operations

> Confirm with the user before executing these.

| Operation                   | Why Dangerous                                | Safeguard                               |
| --------------------------- | -------------------------------------------- | --------------------------------------- |
| `DELETE /actions/{id}`      | Removes a matter and may cascade to children | Confirm with user; prefer status change |
| `DELETE /participants/{id}` | Removes a contact referenced by matters      | Confirm with user                       |
| Matter step change          | Advances workflow; may trigger automations   | Confirm intended target step            |
| `PUT` without merge         | Can blank fields if partial PUT not honoured | GET-merge-PUT                           |

---

_Generated from the investigation questionnaire, Phases 3–4._
