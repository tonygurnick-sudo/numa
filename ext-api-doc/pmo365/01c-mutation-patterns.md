---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
companion_to: 01-llm-api-rules.md
base_url: '{environment_url}/api/data/v9.2/'
call_surface: 'HTTP via connect_request (not file-browse)'
covers: 'OData v4 writes — POST create (204 + OData-EntityId), PATCH update (UPSERT — use If-Match: *), DELETE, @odata.bind lookups, option-set integers, statecode/statuscode transitions, bound actions, alternate-key upsert'
schema_confidence: 'All pmo_* names are ILLUSTRATIVE [INFERRED] — resolve EntitySetName/PrimaryIdAttribute/required columns/lookups/option-set integers via discovery (01, 01b) or $metadata before any write. Platform write behaviour is [DOCUMENTED].'
---

# PMO365 — Mutation Patterns Reference

Every write goes through the Dataverse Web API at `{environment_url}/api/data/v9.2/`, expanded by the backend `connect_request` path. There is no PMO365-specific write surface.

## Write Capabilities Summary

| Operation              | Supported | Method     | Endpoint                                                 | Notes                                                               |
| ---------------------- | --------- | ---------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| Create                 | yes       | POST       | `/{entityset}`                                           | `204 No Content` + `OData-EntityId` header (URL of new row)         |
| Create + return body   | yes       | POST       | `/{entityset}` + `Prefer: return=representation`         | `201 Created` with the new row in the body                          |
| Partial update         | yes       | PATCH      | `/{entityset}({id})`                                     | **UPSERT by default** — send `If-Match: *` to force update-only     |
| Update + return body   | yes       | PATCH      | `/{entityset}({id})` + `Prefer: return=representation`   | `200 OK` with selected columns; pair with `$select`                 |
| Full replace           | no        | —          | —                                                        | Dataverse has no PUT-replace for whole rows; PATCH is partial-merge |
| Single-property update | yes       | PUT        | `/{entityset}({id})/{property}`                          | sets ONE column: body `{"value": …}` → `204`                        |
| Single-property clear  | yes       | DELETE     | `/{entityset}({id})/{property}`                          | clears ONE column → `204`                                           |
| Delete (row)           | yes       | DELETE     | `/{entityset}({id})`                                     | **hard delete, irreversible.** `204` if existed, `404` if not       |
| Upsert (primary key)   | yes       | PATCH      | `/{entityset}({id})`                                     | default PATCH — creates if `{id}` GUID absent                       |
| Upsert (alternate key) | yes       | PATCH      | `/{entityset}(altkey='value')`                           | match on alternate key; `OData-EntityId` echoes the key             |
| State / status change  | yes       | PATCH      | `/{entityset}({id})` set `statecode` + `statuscode`      | state machine — `statuscode` valid set depends on `statecode`       |
| Associate lookup       | yes       | POST/PATCH | `"{nav}@odata.bind"` in body                             | sets a lookup at create or update                                   |
| Disassociate lookup    | yes       | DELETE     | `/{entityset}({id})/{nav}/$ref`                          | removes a single-valued nav reference                               |
| Bound action           | yes       | POST       | `/{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}` | side-effecting ops (Merge, AddToQueue, custom)                      |
| Bulk create/update     | partial   | POST       | `/CreateMultiple`, `/UpdateMultiple`                     | standard tables: support varies per table; elastic always. Confirm. |
| File / image columns   | partial   | PATCH/PUT  | per-column file API                                      | NOT exposed from chat in this iteration                             |

## Patterns

### 1. Create

POST to the entity set. Lookups via `@odata.bind`; option sets are integers. Default success **`204 No Content`** + new row URL in the `OData-EntityId` header.

```
POST {environment_url}/api/data/v9.2/pmo_projects
OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json | Content-Type: application/json
{"pmo_name":"ERP Migration FY26","pmo_plannedstartdate":"2026-07-01","pmo_plannedbudget":250000,"pmo_priority":2,"pmo_PortfolioId@odata.bind":"/pmo_portfolios(8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50)"}
```

Response: `HTTP/1.1 204 No Content` + `OData-EntityId: {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)`

- New GUID lives in the `OData-EntityId` header — **parse it from the header**, the body is empty. For the row in the body, add `Prefer: return=representation` → `201 Created`.
- **Required fields:** tenant-defined. A column is mandatory when `RequiredLevel` is `ApplicationRequired` or `SystemRequired`. Discover: `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,RequiredLevel`. At minimum the `PrimaryNameAttribute` is usually required.
- **Server-generated:** `{primaryid}` GUID, `createdon`, `createdby`, `modifiedon`, `modifiedby`, `ownerid` (defaults to the calling Application User unless set).
- **Idempotency:** POST is **NOT idempotent** — retry creates a duplicate. If retry is possible, use a PATCH upsert keyed on the GUID or an alternate key (Patterns 3a/3b).

### 2. Update (Partial) — the UPSERT gotcha

PATCH the row URL with only the columns you're changing.

> **DANGER — Dataverse PATCH is an UPSERT.** If `{id}` doesn't match an existing row, Dataverse **CREATES a new row with that GUID** instead of failing. **Always send `If-Match: *`** to force update-only.

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
OData-MaxVersion: 4.0 | OData-Version: 4.0 | If-Match: * | Content-Type: application/json
{"pmo_plannedbudget":300000,"pmo_priority":1}
```

Response: `204 No Content`.

- Only included columns change; omitted columns untouched. Sending `null` **clears** a column — except `SystemRequired` columns, which reject `null`.
- `modifiedon`/`modifiedby` server-set on every successful write.
- **Do NOT round-trip a full row you read earlier and PATCH it back.** Dataverse treats every included property as a write even if unchanged — fires plugins/workflows and pollutes audit history. Send only what you intend to change.
- With `If-Match: *`, a non-existent row → **`404 Not Found`** instead of a silent create. For the updated row back, add `Prefer: return=representation` (+ `$select`) → `200 OK`.

### 3a. Upsert (primary-key GUID)

A plain PATCH **is** the upsert: update if the GUID exists, create if not. Omit `If-Match: *` to allow the create branch.

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
OData-MaxVersion: 4.0 | OData-Version: 4.0 | If-None-Match: * | Content-Type: application/json
{"pmo_name":"ERP Migration FY26","pmo_priority":2}
```

- Response is `204` for **both** create and update — status alone doesn't tell you which. Add `Prefer: return=representation` to disambiguate: **`201 Created`** vs **`200 OK`**.
- `If-None-Match: *` = "create only, fail if it already exists" (mirror of `If-Match: *`). If the record exists → **`412 Precondition Failed`**.

### 3b. Upsert (alternate key)

If the table has an alternate key (e.g. an external project code), reference the row by that key instead of a GUID. Ideal for syncing against an external system that doesn't know Dataverse GUIDs.

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(pmo_externalcode='ERP-2026-001')
OData-MaxVersion: 4.0 | OData-Version: 4.0 | Content-Type: application/json
{"pmo_name":"ERP Migration FY26","pmo_plannedbudget":250000}
```

Response: `204 No Content` + `OData-EntityId: {environment_url}/api/data/v9.2/pmo_projects(pmo_externalcode='ERP-2026-001')`

- `OData-EntityId` echoes the **alternate key**, not the GUID.
- **Do NOT put the alternate-key columns in the body.** On update they're ignored; on create Dataverse sets them from the URL. Including them is redundant at best, a `400` at worst.
- Alternate keys are listed in `$metadata` (entity-type annotations). Discover before assuming — most custom tables have **none** by default.

### 4. Delete (row) — DANGEROUS

```
DELETE {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
OData-MaxVersion: 4.0 | OData-Version: 4.0
```

Response: `204 No Content` if the row existed; **`404 Not Found`** if not.

- **HARD delete — irreversible.** No API-level recycle bin; recovery requires an admin database restore, if available.
- **Confirm with the user before deleting.** Prefer a state change (Pattern 5 → Inactive/Cancelled) when the user just wants to "close" or "archive".
- Cascade depends on each relationship's config: children may be cascade-deleted, the delete **blocked** (dependency error), or children orphaned (lookup set null). Check the relationship first.
- To clear a single column instead of deleting the row: `DELETE /pmo_projects({id})/pmo_description` → `204`.

### 5. State Transition (`statecode`/`statuscode`) — DANGEROUS

Two coupled integer option sets. **`statecode`** = high-level state (commonly `0`=Active, `1`=Inactive); **`statuscode`** = finer status whose valid set **depends on the current `statecode`**. Change via a normal PATCH — no separate transition endpoint in the modern Web API.

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
OData-MaxVersion: 4.0 | OData-Version: 4.0 | If-Match: * | Content-Type: application/json
{"statecode":1,"statuscode":2}
```

Response: `204 No Content`.

- **Always set `statuscode` explicitly when changing `statecode`.** `statecode` alone applies that state's default status — maybe not what the user means.
- A `statuscode` invalid for the target `statecode` → `400` status-transition error. Discover legal pairings: `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$select=LogicalName&$expand=OptionSet` — each option carries a `State` tying it to a `statecode`.
- PMO365 frequently defines **extra statuscode options** (e.g. "On Hold", "Cancelled") per state. The integers are tenant-specific — resolve them, never guess.
- Deactivating (`statecode: 1`) typically **makes the row read-only / hidden from active views** without deleting — the safer alternative to DELETE for "close this project". Valid transitions: see the state machine in `01a-domain-model-reference.md`.

### 6. Lookups via `@odata.bind` (associate / disassociate)

Lookups are GUID columns surfaced on read as `_{logicalname}_value`. You do **not** write that read-only field — bind the navigation property.
Set/change on create or update:

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
OData-MaxVersion: 4.0 | OData-Version: 4.0 | If-Match: * | Content-Type: application/json
{"pmo_PortfolioId@odata.bind":"/pmo_portfolios(8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50)","ownerid@odata.bind":"/systemusers(5dbf5efc-4507-e611-80de-5065f38a7b01)"}
```

Clear/disassociate a single-valued lookup: `DELETE {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-...)/pmo_PortfolioId/$ref`

- The bind value is `/{target_entityset}({guid})` — the **target's** entity set (plural), not the nav property name. Get the nav-property name AND the target entity set from `$metadata`; casing is exact and case-sensitive.
- For a **polymorphic** lookup (e.g. `ownerid`, user OR team) the entity set in the bind disambiguates the type (`/systemusers(...)` vs `/teams(...)`).
- Don't PATCH `_pmo_portfolioid_value` directly — that column is read-only.

## Field Validation Rules

> Specific column names below are ILLUSTRATIVE; confirm real rules from attribute metadata / `$metadata`.
> | Entity | Field | Rule | Error if violated |
> | --- | --- | --- | --- |
> | `pmo_project` | primary name attr | `ApplicationRequired` — non-empty string | `400` `0x80040265` "required field missing" |
> | `pmo_project` | any `SystemRequired` | cannot be set to `null` | `400` validation error |
> | `pmo_project` | option set (`pmo_priority`) | must be an **integer** that exists in the column's option set | `400` `0x80040217` invalid option |
> | `pmo_project` | `statuscode` | must be valid for the current/target `statecode` | `400` status-transition error |
> | any | lookup (`@odata.bind`) | target GUID must exist and be the right table | `404` / `400` "Entity ... Does Not Exist" |
> | any | money / decimal | within column precision and min/max | `400` `0x80040217` |
> | any | datetime | ISO-8601; `DateOnly` columns reject a time component | `400` |
> | any | string | within `MaxLength` | `400` length validation |

Confirm rules at runtime: required columns via `GET /EntityDefinitions(LogicalName='{table}')/Attributes?$select=LogicalName,RequiredLevel` (treat `ApplicationRequired`/`SystemRequired` as mandatory); `MaxLength` on `StringAttributeMetadata`; `MinValue`/`MaxValue`/`Precision` on number/money metadata; option-set integers from each `Picklist`/`Status`/`State` attribute's `OptionSet` (see 01a Enum Value Reference). **Write the integer, never the display label.**

## Server-Side Defaults

> Dataverse populates these automatically; don't send on create unless deliberately overriding.
> | Entity | Field | Default | When applied |
> | --- | --- | --- | --- |
> | any | `{table}id` | auto-generated GUID | create (omit it) |
> | any | `createdon` | current UTC timestamp | create |
> | any | `createdby` | calling Application User | create |
> | any | `modifiedon` | current UTC timestamp | create, update |
> | any | `modifiedby` | calling Application User | create, update |
> | any | `ownerid` | calling Application User | create (if unset) |
> | any | `statecode` | `0` (Active) or table default | create (if unset) |
> | any | `statuscode` | the `DefaultStatus` for the `statecode` | create / `statecode` change without explicit `statuscode` |
> | `pmo_project` | option sets | the option set's configured default | create (if unset) |

## Worked Examples

### 1. Create a project, read its GUID from the header

```
POST {environment_url}/api/data/v9.2/pmo_projects
OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json | Content-Type: application/json
{"pmo_name":"Website Replatform","pmo_priority":2}
```

→ `HTTP/1.1 204 No Content` + `OData-EntityId: {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)`

- Parse the GUID `11112222-…-666677778888` from `OData-EntityId` for any follow-up call.
- `pmo_priority: 2` is an **integer** option-set value — confirm `2` exists in that table's priority option set via discovery; the label ("Medium") is never written.
- Want the row back? Add `Prefer: return=representation` → `201 Created` + JSON body.

### 2. Update a project AND re-link its portfolio in one PATCH (with the upsert guard)

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)?$select=pmo_name,pmo_priority,_pmo_portfolioid_value
OData-MaxVersion: 4.0 | OData-Version: 4.0 | If-Match: * | Accept: application/json | Content-Type: application/json | Prefer: return=representation
{"pmo_priority":1,"pmo_PortfolioId@odata.bind":"/pmo_portfolios(8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50)"}
```

→ `200 OK` `{"@odata.context":"{environment_url}/api/data/v9.2/$metadata#pmo_projects/$entity","@odata.etag":"W/\"284531\"","pmo_projectid":"11112222-3333-4444-5555-666677778888","pmo_name":"Website Replatform","pmo_priority":1,"_pmo_portfolioid_value":"8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50"}`

- `Prefer: return=representation` flips `204` → `200` with selected columns — pair with `$select` (keep minimal; it adds a retrieve, costing latency).
- The lookup re-link uses `@odata.bind` on the **nav property** (`pmo_PortfolioId`); the read side returns the flat `_pmo_portfolioid_value`. Different names — normal asymmetry.
- A wrong GUID with `If-Match: *` → clean `404` instead of silent-create.

### 3. Close a project via state transition (instead of deleting)

User says "close the Website Replatform project." Right move = state change, not DELETE. Set both `statecode` and `statuscode`.

```
PATCH {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)
OData-MaxVersion: 4.0 | OData-Version: 4.0 | If-Match: * | Content-Type: application/json
{"statecode":1,"statuscode":2}
```

→ `204 No Content`.

- `statecode: 1` (Inactive) + `statuscode: 2` are ILLUSTRATIVE — resolve the real integer for the user's intended status ("Completed" vs "Cancelled" may be different statuscodes under the same Inactive state) from the `statuscode` attribute metadata before sending.
- Reversible (reactivate by PATCHing `statecode: 0` + a valid active `statuscode`), unlike DELETE — why it's preferred for "close/archive/cancel".

### 4. Invoke a bound action

Side-effecting ops are bound actions: `POST /{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`. You MUST include the full `Microsoft.Dynamics.CRM` namespace or you get `400 Request message has unresolved parameters`.

```
POST {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)/Microsoft.Dynamics.CRM.new_pmo_RecalculateRollup
OData-MaxVersion: 4.0 | OData-Version: 4.0 | Accept: application/json | Content-Type: application/json
{"RecalculateChildren":true}
```

→ `204 No Content` (or `200 OK`).

- `new_pmo_RecalculateRollup` is ILLUSTRATIVE — custom action names and params are per-solution, visible only in `$metadata` (look for `<Action … IsBound="true">`).
- A bound action's first parameter (the entity it's bound to) comes from the **URL**, not the body — the body carries only the action's other parameters.
- Actions with side effects (Merge, BulkDelete, custom state machines) are **dangerous** — confirm with the user and show what the action will do before invoking.

## Gotchas

1. **PATCH is an UPSERT — `If-Match: *` is mandatory for updates.** Without it, a wrong/typo'd GUID creates a ghost row at that GUID instead of erroring. With `If-Match: *`, a non-existent row returns **`404 Not Found`** (the update-only guard) — **not** a `412`. (`412 Precondition Failed` is a different case: `If-None-Match: *` create-only when the row already exists, or an `If-Match: W/"<etag>"` optimistic-concurrency tag mismatch.) Always send `If-Match: *` unless you _intend_ an upsert-create.
2. **`204`, not `200/201`, on create and update.** Default success body is **empty**. Get the new GUID from the **`OData-EntityId` response header**, not the body. Use `Prefer: return=representation` only when you need the row back.
3. **Lookups are `@odata.bind`, not the `_value` field.** Write `"{Nav}@odata.bind": "/{set}({guid})"`; the flat `_{logical}_value` is read-only. Nav-property name ≠ `_value` name, and casing matters.
4. **Option sets are integers, never labels.** `"pmo_priority": 1`, never `"High"`. The integer set is tenant-specific — resolve it; a non-existent integer is a `400`.
5. **`statecode` and `statuscode` are coupled.** Setting `statecode` alone applies the default status. Always pass `statuscode` too, valid for that state, or you get a transition error.
6. **Don't PATCH back a whole row you read.** Every included property counts as a write — fires plugins/workflows and dirties audit history even for unchanged values. Send only what changed.
7. **Delete is hard and irreversible** with no recycle bin. Restricted-cascade relationships **block** the delete; cascade-delete relationships silently remove children. Inspect the relationship first; prefer deactivation (Pattern 5).
8. **Alternate-key values stay in the URL, not the body.** On upsert-update ignored; on upsert-create taken from the URL. In the body = redundant or a `400`.
9. **Custom-action/bound-action names need the full `Microsoft.Dynamics.CRM` namespace** in the URL, or `400 unresolved parameters`. Resolve names and parameters from `$metadata`.
10. **Service-protection limits apply to writes too.** Per user, sliding 5-min window, three facets: **6,000 requests / 5 min**, **1,200,000 ms (20 min)** combined request-execution time / 5 min, **52 concurrent requests**. A burst of creates/updates can hit any of these → **`429` with `Retry-After` (seconds)** — you MUST honour it. Don't tight-loop writes; batch logically and pace them.

## Dangerous Operations

> Destructive, irreversible, or high-side-effect. **Confirm with the user — and show exactly what will happen — before executing.**
> | Operation | Why dangerous | Safeguard |
> | --- | --- | --- |
> | `DELETE /{entityset}({id})` | hard delete, **no recycle bin**, irreversible; may cascade-delete children or be blocked by dependencies | confirm the exact row(s) + count; check cascade; suggest deactivation |
> | `DELETE …/{property}` or `…/{nav}/$ref` | silently clears a column / breaks a relationship link | confirm which field is cleared and that data loss is intended |
> | `statecode`/`statuscode` change | can deactivate a record (read-only/hidden) and trigger state-driven business logic | resolve the intended status integer; confirm "close/cancel/archive" intent; note it's reversible |
> | PATCH **without** `If-Match: *` | UPSERT — a wrong GUID creates a phantom row | always send `If-Match: *` for updates; only omit for a deliberate upsert |
> | Bound actions (Merge, BulkDelete, custom) | reusable side-effecting ops; some merge/delete many rows or fire long-running processes | read the action definition in `$metadata`; describe the effect; confirm before POSTing |
> | Bulk write loops near the rate limit | triggers `429` service-protection throttling; aggressive retries make it worse | pace writes; honour `Retry-After`; never retry a `429` without backing off |
