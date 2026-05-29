---
api_name: 'PMO365'
api_slug: 'pmo365'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# PMO365 -- Mutation Patterns Reference

> OData v4 write patterns against Microsoft Dataverse: POST create (`204` + `OData-EntityId`),
> PATCH update (UPSERT — use `If-Match: *`), DELETE, `@odata.bind` lookups, option-set integers,
> `statecode`/`statuscode` transitions, bound actions, and alternate-key upsert.
> Companion to `01-llm-api-rules.md`.

> **PMO365 has no API of its own.** It is a Dataverse _solution_ — a bundle of custom tables
> (publisher prefix e.g. `pmo_*`) living in the customer's Dataverse environment. Every write
> below goes through the **Microsoft Dataverse Web API** at
> `{environment_url}/api/data/v9.2/`, expanded against the admin-configured `environment_url`
> credential by the backend `connect_request` path. There is no PMO365-specific write surface.

> **Discovery-first, always.** The custom table/column names used in the examples
> (`pmo_project`, `pmo_risk`, `pmo_statuscolour`, …) are **ILLUSTRATIVE only** — PMO365's real
> schema is proprietary and not publicly documented `[INFERRED]`. Before any write, resolve the
> real `EntitySetName`, `PrimaryIdAttribute`, required columns, lookups, and option-set values via
> the discovery queries in `01-llm-api-rules.md` and `01b-query-patterns.md`, or read
> `{environment_url}/api/data/v9.2/$metadata`. Never hard-code a `pmo_*` name as confirmed.

---

## Write Capabilities Summary

| Operation              | Supported | Method     | Endpoint                                                 | Notes                                                                      |
| ---------------------- | --------- | ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Create                 | yes       | POST       | `/{entityset}`                                           | `204 No Content` + `OData-EntityId` header (URL of new row)                |
| Create + return body   | yes       | POST       | `/{entityset}` + `Prefer: return=representation`         | `201 Created` with the new row in the body                                 |
| Partial update         | yes       | PATCH      | `/{entityset}({id})`                                     | **UPSERT by default** — send `If-Match: *` to force update-only            |
| Update + return body   | yes       | PATCH      | `/{entityset}({id})` + `Prefer: return=representation`   | `200 OK` with selected columns; pair with `$select`                        |
| Full replace           | no        | —          | —                                                        | Dataverse has no PUT-replace for whole rows; PATCH is partial-merge        |
| Single-property update | yes       | PUT        | `/{entityset}({id})/{property}`                          | Sets ONE column: body `{"value": …}` → `204`                               |
| Single-property clear  | yes       | DELETE     | `/{entityset}({id})/{property}`                          | Clears ONE column → `204`                                                  |
| Delete (row)           | yes       | DELETE     | `/{entityset}({id})`                                     | **Hard delete, irreversible.** `204` if existed, `404` if not              |
| Upsert (primary key)   | yes       | PATCH      | `/{entityset}({id})`                                     | Default PATCH behaviour — creates if `{id}` GUID absent                    |
| Upsert (alternate key) | yes       | PATCH      | `/{entityset}(altkey='value')`                           | Match on alternate key; `OData-EntityId` echoes the key                    |
| State / status change  | yes       | PATCH      | `/{entityset}({id})` set `statecode` + `statuscode`      | State machine — `statuscode` valid set depends on `statecode`              |
| Associate lookup       | yes       | POST/PATCH | `"{nav}@odata.bind"` in body                             | Sets a lookup to a related row at create or update                         |
| Disassociate lookup    | yes       | DELETE     | `/{entityset}({id})/{nav}/$ref`                          | Removes a single-valued navigation reference                               |
| Bound action           | yes       | POST       | `/{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}` | Side-effecting operations (Merge, AddToQueue, custom actions)              |
| Bulk create/update     | partial   | POST       | `/CreateMultiple`, `/UpdateMultiple`                     | Standard tables: support varies per table; elastic tables always. Confirm. |
| File / image columns   | partial   | PATCH/PUT  | per-column file API                                      | NOT exposed from chat in this iteration                                    |

---

## Common Patterns

### Pattern 1: Create

`POST` to the entity set. Lookups are set with `@odata.bind`; option sets are integers.
Default success is **`204 No Content`** with the new row's URL in the `OData-EntityId` header.

```http
POST {environment_url}/api/data/v9.2/pmo_projects
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Content-Type: application/json

{
  "pmo_name": "ERP Migration FY26",
  "pmo_plannedstartdate": "2026-07-01",
  "pmo_plannedbudget": 250000,
  "pmo_priority": 2,
  "pmo_PortfolioId@odata.bind": "/pmo_portfolios(8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50)"
}
```

> `pmo_projects`, `pmo_name`, `pmo_priority`, `pmo_PortfolioId` are **ILLUSTRATIVE** `[INFERRED]`.
> Resolve the real `EntitySetName`, required columns, lookup navigation properties, and option-set
> integers via discovery / `$metadata` before sending.

**Response (204 No Content):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
OData-EntityId: {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
```

- The new GUID lives in the `OData-EntityId` header — **parse it from the header**, the body is empty.
- To get the created row back in the body instead, add `Prefer: return=representation` → `201 Created` with the JSON.

**Required fields:** entirely tenant-defined. A column is mandatory when its `RequiredLevel` is
`ApplicationRequired` or `SystemRequired`. Discover via
`GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,RequiredLevel`.
At minimum the `PrimaryNameAttribute` (resolved during discovery) is usually required.

**Server-generated fields:** `{primaryid}` GUID (e.g. `pmo_projectid`), `createdon`, `createdby`,
`modifiedon`, `modifiedby`, `ownerid` (defaults to the calling Application User unless set).

**Idempotency:** POST is **NOT idempotent** — retrying creates a duplicate row. If a retry is
possible, use a PATCH upsert keyed on the primary key GUID or an alternate key (Patterns 3a/3b).

---

### Pattern 2: Update (Partial) — the UPSERT gotcha

`PATCH` the row URL with only the columns you are changing.

> **DANGER — Dataverse PATCH is an UPSERT.** If the `{id}` in the URL does not match an existing
> row, Dataverse **CREATES a new row with that GUID** instead of failing. To force update-only and
> avoid an accidental ghost record, **always send `If-Match: *`** on updates.

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *
Content-Type: application/json

{
  "pmo_plannedbudget": 300000,
  "pmo_priority": 1
}
```

**Response (204 No Content):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
```

**Behaviour:**

- Only the included columns change; omitted columns are untouched.
- Sending `null` **clears** a column — except columns whose `RequiredLevel` is `SystemRequired`,
  which reject `null`.
- `modifiedon` / `modifiedby` are server-set on every successful write.
- **Do NOT round-trip a full row you read earlier and PATCH it back.** Dataverse treats every
  included property as a write even when the value is unchanged, firing plugins/workflows and
  polluting audit history. Send only the fields you actually intend to change.
- With `If-Match: *`, if the row does not exist you get **`404 Not Found`** instead of a silent create.
- To get the updated row back, add `Prefer: return=representation` (+ `$select`) → `200 OK` with body.

---

### Pattern 3a: Upsert (primary-key GUID)

A plain PATCH **is** the upsert: update if the GUID exists, create if it doesn't. Useful when an
external system owns the GUID. Omit `If-Match: *` to allow the create branch.

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
If-None-Match: *
Content-Type: application/json

{ "pmo_name": "ERP Migration FY26", "pmo_priority": 2 }
```

- The response is `204` for **both** create and update — you cannot tell which happened from the
  status alone. Add `Prefer: return=representation` to disambiguate: **`201 Created`** vs **`200 OK`**.
- `If-None-Match: *` = "create only, fail if it already exists" (mirror of `If-Match: *`). If the
  record already exists you get **`412 Precondition Failed`**.

---

### Pattern 3b: Upsert (alternate key)

If the table has an alternate key configured (e.g. an external project code), reference the row by
that key instead of a GUID. Ideal for syncing against an external system that doesn't know
Dataverse GUIDs.

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(pmo_externalcode='ERP-2026-001')
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
Content-Type: application/json

{ "pmo_name": "ERP Migration FY26", "pmo_plannedbudget": 250000 }
```

**Response (204 No Content):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
OData-EntityId: {environment_url}/api/data/v9.2/pmo_projects(pmo_externalcode='ERP-2026-001')
```

**Behaviour:**

- Notice the `OData-EntityId` echoes the **alternate key**, not the GUID.
- **Do NOT put the alternate-key columns in the body.** On update they're ignored; on create
  Dataverse sets them from the URL. Including them is at best redundant, at worst a `400`.
- Alternate keys for a table are listed in `$metadata` (entity-type annotations). Discover before
  assuming one exists — most custom tables have **none** by default.

---

### Pattern 4: Delete (row) — DANGEROUS

```http
DELETE {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
```

**Response:** `204 No Content` if the row existed; **`404 Not Found`** if it did not.

**Behaviour:**

- **HARD delete — irreversible.** Dataverse has no API-level recycle bin for table rows. Once
  deleted, the row is gone (recovery requires a database restore by an admin, if even available).
- **Confirm with the user before deleting.** Prefer a state change (Pattern 5 → Inactive /
  Cancelled) over a delete when the user just wants to "close" or "archive" something.
- Cascade behaviour depends on each relationship's cascade configuration: related child rows may be
  cascade-deleted, restricted (the delete is **blocked** with a dependency error), or orphaned
  (lookup set to null). Check the relationship before deleting a parent.
- To clear a single column instead of deleting the row, DELETE the property URL:
  `DELETE /pmo_projects({id})/pmo_description` → `204`.

---

### Pattern 5: State Transition (`statecode` / `statuscode`) — DANGEROUS

Record lifecycle is governed by two coupled integer option sets. **`statecode`** is the high-level
state (commonly `0 = Active`, `1 = Inactive`); **`statuscode`** is the finer status whose valid set
**depends on the current `statecode`**. You change state with a normal PATCH — there is no separate
"transition" endpoint for state in the modern Web API.

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *
Content-Type: application/json

{ "statecode": 1, "statuscode": 2 }
```

**Response (204 No Content):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
```

**Behaviour:**

- **Always set `statuscode` explicitly when you change `statecode`.** If you set `statecode`
  alone, Dataverse applies that state's _default_ status, which may not be what the user means.
- Picking a `statuscode` that isn't valid for the target `statecode` → `400` with a status-transition
  error. Discover the legal pairings from the column metadata:
  `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$select=LogicalName&$expand=OptionSet`
  — each option carries a `State` value tying it to a `statecode`.
- Custom solutions like PMO365 frequently define **extra statuscode options** (e.g. "On Hold",
  "Cancelled") under each state. The integers are tenant-specific — resolve them, never guess.
- Deactivating (`statecode: 1`) typically **makes the row read-only / hidden from active views**
  without deleting it — the safer alternative to DELETE for "close this project".
- **Valid transitions:** see the state machine in `01a-domain-model-reference.md`.

---

### Pattern 6: Lookups via `@odata.bind` (associate / disassociate)

Lookups are GUID columns surfaced on read as `_{logicalname}_value`. You do **not** write that
read-only field — instead bind the navigation property.

**Set / change a lookup on create or update:**

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *
Content-Type: application/json

{
  "pmo_PortfolioId@odata.bind": "/pmo_portfolios(8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50)",
  "ownerid@odata.bind": "/systemusers(5dbf5efc-4507-e611-80de-5065f38a7b01)"
}
```

**Clear / disassociate a single-valued lookup:**

```http
DELETE {environment_url}/api/data/v9.2/pmo_projects(2d6f9b44-7e8a-4c11-bb20-9f0e1d2c3b4a)/pmo_PortfolioId/$ref
Authorization: Bearer {access_token}
```

**Behaviour:**

- The bind value is `/{target_entityset}({guid})` — the **target's** entity set, plural, not the
  navigation property's name. Get the navigation-property name AND the target entity set from
  `$metadata` (relationships); the casing of nav properties is exact and case-sensitive.
- For a **polymorphic** lookup (e.g. `ownerid`, which can be a user OR a team) the entity set in the
  bind disambiguates the type (`/systemusers(...)` vs `/teams(...)`).
- Don't attempt to PATCH `_pmo_portfolioid_value` directly — that column is read-only.

---

## Field Validation Rules

> Dataverse enforces these on write. Specific column names below are **ILLUSTRATIVE** `[INFERRED]`;
> confirm the real rules from attribute metadata / `$metadata`.

| Entity (illustrative) | Field                       | Rule                                                          | Error if violated                           |
| --------------------- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `pmo_project`         | primary name attr           | `ApplicationRequired` — non-empty string                      | `400` `0x80040265` "required field missing" |
| `pmo_project`         | any `SystemRequired`        | cannot be set to `null`                                       | `400` validation error                      |
| `pmo_project`         | option set (`pmo_priority`) | must be an **integer** that exists in the column's option set | `400` `0x80040217` invalid option           |
| `pmo_project`         | `statuscode`                | must be valid for the current/target `statecode`              | `400` status-transition error               |
| any                   | lookup (`@odata.bind`)      | target GUID must exist and be the right table                 | `404` / `400` "Entity ... Does Not Exist"   |
| any                   | money / decimal             | within column precision and min/max                           | `400` `0x80040217`                          |
| any                   | datetime                    | ISO-8601; `DateOnly` columns reject a time component          | `400`                                       |
| any                   | string                      | within `MaxLength`                                            | `400` length validation                     |

**Common validation patterns:**

- **Required columns:** `GET /EntityDefinitions(LogicalName='{table}')/Attributes?$select=LogicalName,RequiredLevel`
  — treat `ApplicationRequired` and `SystemRequired` as mandatory.
- **Max lengths:** `MaxLength` on `StringAttributeMetadata`.
- **Numeric ranges / precision:** `MinValue` / `MaxValue` / `Precision` on number/money metadata.
- **Option-set integers:** the valid set lives in each `Picklist`/`Status`/`State` attribute's
  `OptionSet` — see `01a-domain-model-reference.md` Enum Value Reference and resolve at runtime.
- **Labels are not values:** you write the **integer**, never the display label.

---

## Server-Side Defaults

> Dataverse populates these automatically; do not send them on create unless overriding deliberately.

| Entity        | Field        | Default value                           | When applied                                              |
| ------------- | ------------ | --------------------------------------- | --------------------------------------------------------- |
| any           | `{table}id`  | auto-generated GUID                     | create (omit it)                                          |
| any           | `createdon`  | current UTC timestamp                   | create                                                    |
| any           | `createdby`  | calling Application User                | create                                                    |
| any           | `modifiedon` | current UTC timestamp                   | create, update                                            |
| any           | `modifiedby` | calling Application User                | create, update                                            |
| any           | `ownerid`    | calling Application User                | create (if unset)                                         |
| any           | `statecode`  | `0` (Active) or table default           | create (if unset)                                         |
| any           | `statuscode` | the `DefaultStatus` for the `statecode` | create / `statecode` change without explicit `statuscode` |
| `pmo_project` | option sets  | the option set's configured default     | create (if unset)                                         |

---

## Worked Examples

### Example 1: Create a project, then read its GUID from the header

> Minimal create. The body is empty on `204`; the new row's URL is in `OData-EntityId`.

```http
POST {environment_url}/api/data/v9.2/pmo_projects
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Content-Type: application/json

{ "pmo_name": "Website Replatform", "pmo_priority": 2 }
```

**Response (204):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
OData-EntityId: {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)
```

**Notes:**

- Parse the GUID `11112222-…-666677778888` out of the `OData-EntityId` header for any follow-up call.
- `pmo_priority: 2` is an **integer** option-set value — confirm `2` exists in that table's priority
  option set via discovery before sending; the label ("Medium") is never written.
- Want the row back instead? Add `Prefer: return=representation` → `201 Created` with the JSON body.

---

### Example 2: Update a project AND re-link its portfolio in one PATCH (with the upsert guard)

> Combines a scalar update, an option-set change, and a lookup re-bind. `If-Match: *` guarantees
> update-only — no accidental create if the GUID is wrong.

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)?$select=pmo_name,pmo_priority,_pmo_portfolioid_value
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *
Accept: application/json
Content-Type: application/json
Prefer: return=representation

{
  "pmo_priority": 1,
  "pmo_PortfolioId@odata.bind": "/pmo_portfolios(8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50)"
}
```

**Response (200 OK):**

```json
{
  "@odata.context": "{environment_url}/api/data/v9.2/$metadata#pmo_projects/$entity",
  "@odata.etag": "W/\"284531\"",
  "pmo_projectid": "11112222-3333-4444-5555-666677778888",
  "pmo_name": "Website Replatform",
  "pmo_priority": 1,
  "_pmo_portfolioid_value": "8f2a7c10-4b1e-46d2-9b33-0a1c2d3e4f50"
}
```

**Notes:**

- `Prefer: return=representation` flips the `204` into a `200` with the selected columns — pair it
  with `$select` (keep it minimal; it adds a retrieve, costing latency).
- The lookup re-link uses `@odata.bind` on the **navigation property** (`pmo_PortfolioId`); the read
  side returns the flat `_pmo_portfolioid_value`. They are different names — that asymmetry is normal.
- If the GUID had been wrong, `If-Match: *` turns the silent-create into a clean `404`.

---

### Example 3: Close a project via state transition (instead of deleting it)

> The user says "close the Website Replatform project." The right move is a state change, not a
> DELETE. Set both `statecode` and `statuscode` together.

```http
PATCH {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
If-Match: *
Content-Type: application/json

{ "statecode": 1, "statuscode": 2 }
```

**Response (204):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
```

**Notes:**

- `statecode: 1` (Inactive) + `statuscode: 2` are **ILLUSTRATIVE** `[INFERRED]`. Resolve the real
  integer for the user's intended status ("Completed" vs "Cancelled" may be different statuscodes
  under the same Inactive state) from the `statuscode` attribute metadata before sending.
- This is reversible (reactivate by PATCHing `statecode: 0` + a valid active `statuscode`), unlike a
  DELETE — which is why it's preferred for "close / archive / cancel" intents.

---

### Example 4: Invoke a bound action

> Side-effecting operations are bound actions: `POST /{entityset}({id})/Microsoft.Dynamics.CRM.{ActionName}`.
> You MUST include the full `Microsoft.Dynamics.CRM` namespace or you get
> `400 Request message has unresolved parameters`.

```http
POST {environment_url}/api/data/v9.2/pmo_projects(11112222-3333-4444-5555-666677778888)/Microsoft.Dynamics.CRM.new_pmo_RecalculateRollup
Authorization: Bearer {access_token}
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
Content-Type: application/json

{ "RecalculateChildren": true }
```

**Response (200 OK or 204):**

```http
HTTP/1.1 204 No Content
OData-Version: 4.0
```

**Notes:**

- `new_pmo_RecalculateRollup` is **ILLUSTRATIVE** `[INFERRED]` — custom action names and their
  parameters are defined per solution and visible only in `$metadata` (look for `<Action … IsBound="true">`).
- A bound action's first parameter (the entity it's bound to) comes from the **URL**, not the body —
  the body carries only the action's other parameters.
- Actions with side effects (Merge, BulkDelete, custom state machines) are **dangerous** — confirm
  with the user and show what the action will do before invoking.

---

## Gotchas & Counter-Exceptions

1. **PATCH is an UPSERT — `If-Match: *` is mandatory for updates.** Without it, a wrong/typo'd GUID
   creates a ghost row at that GUID instead of erroring. With `If-Match: *`, a non-existent row
   returns **`404 Not Found`** (the update-only guard prevents the upsert-create) — **not** a `412`.
   (`412 Precondition Failed` is a different case: `If-None-Match: *` create-only when the row
   already exists, or an `If-Match: W/"<etag>"` optimistic-concurrency tag mismatch.) Always send
   `If-Match: *` unless you _intend_ an upsert-create.
2. **`204`, not `200/201`, on create and update.** The default success body is **empty**. Get the
   new GUID from the **`OData-EntityId` response header**, not the body. Use
   `Prefer: return=representation` only when you genuinely need the row back.
3. **Lookups are `@odata.bind`, not the `_value` field.** Write `"{Nav}@odata.bind": "/{set}({guid})"`;
   the flat `_{logical}_value` is read-only. Nav-property name ≠ `_value` name, and casing matters.
4. **Option sets are integers, never labels.** `"pmo_priority": 1`, never `"High"`. The integer set
   is tenant-specific — resolve it; a non-existent integer is a `400`.
5. **`statecode` and `statuscode` are coupled.** Setting `statecode` alone applies the default
   status. Always pass `statuscode` too, and ensure it's valid for that state, or you get a
   transition error.
6. **Don't PATCH back a whole row you read.** Every included property counts as a write — fires
   plugins/workflows and dirties audit history even for unchanged values. Send only what changed.
7. **Delete is hard and irreversible** with no recycle bin. Restricted-cascade relationships will
   _block_ the delete; cascade-delete relationships will silently remove children. Inspect the
   relationship first; prefer deactivation (Pattern 5).
8. **Alternate-key values stay in the URL, not the body.** On upsert-update they're ignored; on
   upsert-create they're taken from the URL. Putting them in the body is redundant or a `400`.
9. **Custom-action/bound-action names need the full `Microsoft.Dynamics.CRM` namespace** in the URL,
   or you get `400 unresolved parameters`. Resolve names and parameters from `$metadata`.
10. **Service-protection limits apply to writes too.** Limits are **per user** over a sliding
    **5-minute** window with three distinct facets: **~6,000 requests / 5 min**, **~20 minutes
    (1,200,000 ms) of combined request-execution time / 5 min**, and a **concurrency cap of ~52
    concurrent requests**. A burst of creates/updates can hit any of these and return **`429` with
    `Retry-After` (seconds)** — you MUST honour that header. Don't tight-loop writes; batch logically
    and pace them.

---

## Dangerous Operations

> Destructive, irreversible, or high-side-effect operations. **Confirm with the user — and show
> exactly what will happen — before executing.**

| Operation                                 | Why dangerous                                                                                               | Safeguard                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DELETE /{entityset}({id})`               | Hard delete, **no recycle bin**, irreversible. May cascade-delete children or be blocked by dependencies.   | Confirm the exact row(s) and count; check the relationship cascade; suggest deactivation instead. |
| `DELETE …/{property}` or `…/{nav}/$ref`   | Silently clears a column / breaks a relationship link.                                                      | Confirm which field is being cleared and that data loss is intended.                              |
| `statecode` / `statuscode` change         | Can deactivate a record (read-only / hidden from active views) and may trigger state-driven business logic. | Resolve the intended status integer; confirm "close/cancel/archive" intent; note it's reversible. |
| PATCH **without** `If-Match: *`           | UPSERT semantics — a wrong GUID creates a phantom row.                                                      | Always send `If-Match: *` for updates; only omit it for a deliberate upsert.                      |
| Bound actions (Merge, BulkDelete, custom) | Reusable side-effecting operations; some merge/delete many rows or fire long-running processes.             | Read the action definition in `$metadata`; describe the effect; confirm before POSTing.           |
| Bulk write loops near the rate limit      | Triggers `429` service-protection throttling; aggressive retries make it worse.                             | Pace writes; honour `Retry-After`; never retry a `429` without backing off.                       |

---

_Generated from `00-api-investigation-questionnaire.md` Phases 3 and 4. Custom `pmo_\*`table/column
names herein are illustrative`[INFERRED]` examples; resolve the real schema via the discovery
queries (`01-llm-api-rules.md`, `01b-query-patterns.md`) and `{environment*url}/api/data/v9.2/$metadata`.*
