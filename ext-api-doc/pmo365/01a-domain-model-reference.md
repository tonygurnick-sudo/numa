---
api_name: 'PMO365'
api_slug: 'pmo365'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# PMO365 -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Covers the **Microsoft Dataverse** domain model that
> PMO365 is built on, plus the **discovery model** the agent must run first to learn the
> tenant's actual PMO365 table and column names.
>
> **PMO365 has no API of its own.** It is a Project Portfolio Management (PPM) solution by
> EPM Partners delivered as a Dataverse _solution_ — a bundle of custom tables in the
> customer's Dataverse environment. You integrate by talking to the **Dataverse Web API**
> (OData v4) at `{environment_url}/api/data/v9.2/`.
>
> **HONESTY RULE (read this first).** PMO365's custom table and column names (`pmo_project`,
> `pmo_risk`, …) are **proprietary and NOT publicly documented**. Every PMO365-specific name
> in this file is **ILLUSTRATIVE / [INFERRED]** and is paired with the discovery query that
> confirms the real name at runtime. Never present a `pmo_*` name as confirmed. The Dataverse
> _platform_ shape (metadata tables, `_x_value` lookups, statecode/statuscode, option sets,
> alternate keys) is [DOCUMENTED] and reliable — that part you can trust.

---

## How this domain model works (Dataverse mental model)

Unlike a fixed-schema CRM, **there is no global "list all PMO365 tables" endpoint.** The
catalog is _discovered_, in two layers:

1. **Metadata layer** — describes the schema itself. Tables: `solutions`,
   `solutioncomponents`, `EntityDefinitions`, `publishers`, plus `$metadata` (full CSDL).
   This is how you find PMO365's tables and their real logical/EntitySet names.
2. **Data layer** — the actual project/risk/task rows, queried via the table's
   **EntitySetName** (e.g. `GET /{entitysetname}`). EntitySetName is the _plural_ collection
   name and is usually, but not always, `{logicalname}s`. **Always read it from
   `EntityDefinitions`; never guess it.**

The agent's required first move on any PMO365 task it hasn't seen before is **discovery**
(see the next section), then it works against the resolved EntitySetName.

### Naming you must keep straight

| Concept                  | What it is                                                       | Example (illustrative)          |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------- |
| **LogicalName**          | Singular schema name of a table; lowercase, prefix-qualified     | `pmo_project` _(confirm)_       |
| **EntitySetName**        | Plural collection name used in the data-layer URL path           | `pmo_projects` _(confirm)_      |
| **MetadataId**           | GUID identifying the table definition (used in metadata queries) | `a1b2c3d4-…`                    |
| **PrimaryIdAttribute**   | The GUID PK column of the table                                  | `pmo_projectid` _(confirm)_     |
| **PrimaryNameAttribute** | The "name/title" column shown in the UI                          | `pmo_name` _(confirm)_          |
| **customizationprefix**  | Publisher prefix shared by all of the solution's custom tables   | `pmo` _(confirm via publisher)_ |

---

## Discovery Catalog (metadata layer — query these FIRST)

These are real Dataverse platform endpoints. Run them to turn "PMO365" into concrete table
names before touching any project data. Send `Accept: application/json` and the standard
OData headers; for label-bearing reads add `Prefer: odata.include-annotations="*"`.

### `solutions`

**Resource path:** `/solutions`
**Description:** Installed solutions. PMO365 is one of these; find its `solutionid` here.
**CRUD:** Read (write is admin/ALM territory — not used from chat)

| Field                | Type          | Writable | Description                                    | Example                                  |
| -------------------- | ------------- | -------- | ---------------------------------------------- | ---------------------------------------- |
| `solutionid`         | GUID          | no       | PK; feed into `solutioncomponents` filter      | `"3f2504e0-4f89-41d3-9a0c-0305e82c3301"` |
| `uniquename`         | string        | no       | Machine name; filter on `contains(...,'pmo')`  | `"PMO365Core"` _(confirm)_               |
| `friendlyname`       | string        | no       | Display name                                   | `"PMO365"` _(confirm)_                   |
| `version`            | string        | no       | Installed version                              | `"4.12.0.1"`                             |
| `_publisherid_value` | GUID (lookup) | no       | The publisher → gives the customization prefix | —                                        |

**Discovery query:**

```http
GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')
```

---

### `solutioncomponents`

**Resource path:** `/solutioncomponents`
**Description:** Maps a solution to the objects it contains. Filter on the solution's id and
`componenttype eq 1` (Entity) to list PMO365's tables. `objectid` = each table's **MetadataId**.
**CRUD:** Read

| Field                 | Type | Writable | Description                                                          | Example        |
| --------------------- | ---- | -------- | -------------------------------------------------------------------- | -------------- |
| `solutioncomponentid` | GUID | no       | PK of the mapping row                                                | —              |
| `_solutionid_value`   | GUID | no       | FK to `solutions.solutionid`                                         | —              |
| `componenttype`       | int  | no       | Component class; **`1` = Entity** (table)                            | `1`            |
| `objectid`            | GUID | no       | The component's id — for `componenttype 1`, the table **MetadataId** | `"a1b2c3d4-…"` |

**Discovery query:**

```http
GET /solutioncomponents?$filter=_solutionid_value eq 3f2504e0-4f89-41d3-9a0c-0305e82c3301 and componenttype eq 1&$select=objectid
```

---

### `EntityDefinitions`

**Resource path:** `/EntityDefinitions`
**Description:** The table-metadata catalog. Resolve a MetadataId to a usable
LogicalName/EntitySetName, or list every custom table by prefix once you know it.
**CRUD:** Read (DDL is admin-only)

| Field                  | Type            | Writable | Description                                  | Example                    |
| ---------------------- | --------------- | -------- | -------------------------------------------- | -------------------------- |
| `MetadataId`           | GUID            | no       | PK; matches `solutioncomponents.objectid`    | `"a1b2c3d4-…"`             |
| `LogicalName`          | string          | no       | Singular schema name                         | `"pmo_project"` _(conf.)_  |
| `EntitySetName`        | string          | no       | **Plural collection name used in data URLs** | `"pmo_projects"` _(conf.)_ |
| `DisplayName`          | localized label | no       | Human label (needs annotations header)       | `"Project"`                |
| `PrimaryIdAttribute`   | string          | no       | GUID PK column name                          | `"pmo_projectid"`_(conf.)_ |
| `PrimaryNameAttribute` | string          | no       | The title/name column                        | `"pmo_name"` _(conf.)_     |
| `IsCustomEntity`       | bool            | no       | `true` for solution-added tables             | `true`                     |

**Resolve one table (from a MetadataId):**

```http
GET /EntityDefinitions(a1b2c3d4-...)?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute
```

**List all PMO365 tables once the prefix is known:**

```http
GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')
```

**Inspect a table's columns (attribute metadata):**

```http
GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,AttributeType,RequiredLevel,IsValidForCreate,IsValidForUpdate
```

---

### `publishers`

**Resource path:** `/publishers`
**Description:** Solution publishers. The `customizationprefix` is what marks a table as
PMO365's (e.g. `pmo`). Standard Dataverse/Dynamics tables do **not** carry that prefix.
**CRUD:** Read

| Field                 | Type   | Writable | Description                                      | Example                      |
| --------------------- | ------ | -------- | ------------------------------------------------ | ---------------------------- |
| `publisherid`         | GUID   | no       | PK                                               | —                            |
| `customizationprefix` | string | no       | The prefix on all the publisher's tables/columns | `"pmo"` _(confirm)_          |
| `friendlyname`        | string | no       | Publisher display name                           | `"EPM Partners"` _(confirm)_ |

**Discovery query:**

```http
GET /publishers?$select=customizationprefix,friendlyname
```

> **Full schema dump:** `GET {environment_url}/api/data/v9.2/$metadata` returns the entire
> CSDL (all tables, attributes, relationships, option sets). Heavy; use the targeted
> `EntityDefinitions` queries above for day-to-day work and reserve `$metadata` for when you
> need the complete relationship graph.

---

## Expected PMO365 Entity Shape (ILLUSTRATIVE / [INFERRED] — confirm via discovery)

> **None of the table or column names below are confirmed.** They reflect what a PPM solution
> on Dataverse _typically_ models. Treat them as a hypothesis to verify, never as fact. Each
> block names the discovery query that confirms (or corrects) the real names. The
> _relationships and field-shape patterns_ (lookups as `_x_value`, statecode/statuscode,
> option sets) are [DOCUMENTED] Dataverse behavior and do apply once the real table is found.

### Project _(e.g. `pmo_project` — confirm)_

**Likely EntitySetName:** `pmo_projects` _(read from `EntityDefinitions`)_
**Description (inferred):** Top-level portfolio item; parent of tasks/milestones, risks,
issues, benefits, resources, and financials.
**CRUD:** C / R / U / D (subject to the Application User's security role)

| Field (illustrative)   | Type                | Writable | Description                                          | Example                                  |
| ---------------------- | ------------------- | -------- | ---------------------------------------------------- | ---------------------------------------- |
| `pmo_projectid`        | GUID                | no       | PrimaryIdAttribute (PK)                              | `"7c9e6679-7425-40de-944b-e07fc1f90ae7"` |
| `pmo_name`             | string              | yes      | PrimaryNameAttribute (title)                         | `"ERP Replacement"`                      |
| `pmo_startdate`        | dateonly/datetime   | yes      | Planned start                                        | `"2026-06-01"`                           |
| `pmo_finishdate`       | dateonly/datetime   | yes      | Planned finish                                       | `"2026-12-15"`                           |
| `_pmo_programid_value` | GUID lookup         | yes      | N:1 → Program/Portfolio (set via `@odata.bind`)      | `"…"`                                    |
| `_ownerid_value`       | GUID lookup (owner) | yes      | Owning user/team (standard Dataverse ownership)      | `"…"`                                    |
| `statecode`            | int (state)         | yes\*    | Lifecycle state (see State Machines)                 | `0`                                      |
| `statuscode`           | int (status reason) | yes      | Sub-status; valid set depends on `statecode`         | `1`                                      |
| `createdon`            | datetime            | no       | Server-set on create                                 | `"2026-05-29T03:00:00Z"`                 |
| `modifiedon`           | datetime            | no       | Server-set on every write (poll target — see Events) | `"2026-05-29T03:00:00Z"`                 |

**Relationships (inferred):**

| Related Entity (illustrative) | Type      | Expression                                                 | Notes                                                          |
| ----------------------------- | --------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Program/Portfolio             | N:1       | `_pmo_programid_value` + nav expand                        | Confirm nav name in `EntityDefinitions/OneToManyRelationships` |
| Task / Milestone              | 1:N       | `GET /pmo_tasks?$filter=_pmo_projectid_value eq {id}`      | Child schedule items                                           |
| Risk                          | 1:N       | `GET /pmo_risks?$filter=_pmo_projectid_value eq {id}`      |                                                                |
| Issue                         | 1:N       | `GET /pmo_issues?$filter=_pmo_projectid_value eq {id}`     |                                                                |
| Benefit                       | 1:N       | `GET /pmo_benefits?$filter=_pmo_projectid_value eq {id}`   |                                                                |
| Resource assignment           | 1:N / N:M | via assignment/junction table                              | Resources often M:N through a join table                       |
| Financial / cost line         | 1:N       | `GET /pmo_financials?$filter=_pmo_projectid_value eq {id}` |                                                                |

**Confirm names with:**

```http
GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,AttributeType,RequiredLevel
GET /EntityDefinitions(LogicalName='pmo_project')/OneToManyRelationships?$select=ReferencingEntity,ReferencingAttribute,ReferencedEntityNavigationPropertyName
```

---

### Task / Milestone _(e.g. `pmo_task` / `pmo_milestone` — confirm)_

**Description (inferred):** A schedule item under a project. Milestones may be a separate
table or the same table flagged by an option set (`pmo_type`) — discovery will tell you which.
**CRUD:** C / R / U / D

| Field (illustrative)       | Type          | Writable | Description                  | Example                    |
| -------------------------- | ------------- | -------- | ---------------------------- | -------------------------- |
| `pmo_taskid`               | GUID          | no       | PK                           | —                          |
| `pmo_name`                 | string        | yes      | Task title                   | `"Migrate finance module"` |
| `_pmo_projectid_value`     | GUID lookup   | yes      | N:1 → Project                | `"…"`                      |
| `pmo_duedate`              | dateonly      | yes      | Target date                  | `"2026-08-30"`             |
| `pmo_percentcomplete`      | int / decimal | yes      | Progress 0–100               | `40`                       |
| `_pmo_assignedto_value`    | GUID lookup   | yes      | N:1 → Resource/User          | `"…"`                      |
| `statecode` / `statuscode` | int / int     | yes      | Open vs. completed lifecycle | `0` / `1`                  |

**Confirm whether Milestone is a type-flag or a separate table:**

```http
GET /EntityDefinitions?$select=LogicalName,EntitySetName&$filter=startswith(LogicalName,'pmo_') and (contains(LogicalName,'task') or contains(LogicalName,'milestone'))
```

---

### Risk _(e.g. `pmo_risk` — confirm)_

| Field (illustrative)       | Type             | Writable | Description                                     | Example          |
| -------------------------- | ---------------- | -------- | ----------------------------------------------- | ---------------- |
| `pmo_riskid`               | GUID             | no       | PK                                              | —                |
| `pmo_name`                 | string           | yes      | Risk title                                      | `"Vendor delay"` |
| `_pmo_projectid_value`     | GUID lookup      | yes      | N:1 → Project                                   | `"…"`            |
| `pmo_probability`          | option set (int) | yes      | Likelihood; option set — labels via annotations | `698030001`      |
| `pmo_impact`               | option set (int) | yes      | Severity; option set                            | `698030002`      |
| `pmo_riskscore`            | int / decimal    | maybe    | Often computed (probability × impact)           | `12`             |
| `statecode` / `statuscode` | int / int        | yes      | e.g. Open → Mitigated → Closed                  | —                |

> Probability/impact are almost certainly **option sets** (stored as integers). Pull
> readable labels with `Prefer: odata.include-annotations="*"`, or enumerate the option set
> via `GET /EntityDefinitions(LogicalName='pmo_risk')/Attributes(LogicalName='pmo_impact')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`.

---

### Issue · Benefit · Resource · Financial _(all illustrative — confirm)_

Same pattern: a `pmo_*id` GUID PK, a `pmo_name`, a `_pmo_projectid_value` lookup back to the
project, an option-set or two for categorisation, and `statecode`/`statuscode`. Resources are
frequently modelled **N:M** through a junction (assignment) table rather than a direct lookup.
Financials may be one row per cost line, or a roll-up table. **Do not assume — discover:**

```http
GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName&$filter=startswith(LogicalName,'pmo_') and (contains(LogicalName,'issue') or contains(LogicalName,'benefit') or contains(LogicalName,'resource') or contains(LogicalName,'financ') or contains(LogicalName,'cost'))
```

For any N:M relationship, the junction is exposed as a collection navigation property; read
it from `GET /EntityDefinitions(LogicalName='pmo_resource')/ManyToManyRelationships`.

---

## Entity Relationship Diagram

> Platform shape is real; PMO365 names are illustrative — verify each via discovery.

```
                       (metadata layer — discover first)
      ┌────────────┐   1:N    ┌────────────────────┐  objectid → ┌───────────────────┐
      │  solutions │─────────►│ solutioncomponents │────────────►│ EntityDefinitions │
      └─────┬──────┘          │ (componenttype=1)  │             │ (LogicalName /    │
            │ publisher       └────────────────────┘             │  EntitySetName)   │
            ▼                                                     └───────────────────┘
      ┌────────────┐  customizationprefix = "pmo" (confirm)
      │ publishers │
      └────────────┘
══════════════════════════════════════════════════════════════════════════════════════
                          (data layer — illustrative PMO365 graph)
                              ┌──────────────────┐
                              │  pmo_project (?) │
                              └───┬────┬────┬────┬┘
              1:N    _pmo_projectid_value │    │    │    │     1:N
        ┌──────────────┬─────────────────┘    │    │    └───────────────┐
        ▼              ▼                       ▼    ▼                    ▼
  ┌───────────┐  ┌───────────┐         ┌──────────┐ ┌───────────┐  ┌───────────┐
  │ pmo_task  │  │ pmo_risk  │         │ pmo_issue│ │pmo_benefit│  │pmo_financ.│
  └───────────┘  └───────────┘         └──────────┘ └───────────┘  └───────────┘
                                                          │ N:M (junction)
                                                          ▼
                                                  ┌─────────────────┐
                                                  │  pmo_resource   │
                                                  └─────────────────┘
```

---

## State Machines

Dataverse models record lifecycle with **two coupled columns** on (almost) every table:

- **`statecode`** — the _State_ (shown in the UI as "Status"). For custom tables the platform
  default is `0 = Active`, `1 = Inactive`. Some standard tables add more (e.g. activities have
  `Open / Completed / Canceled / Scheduled`).
- **`statuscode`** — the _Status Reason_ (shown as "Status Reason"). A finer-grained option
  set whose **valid values depend on the current `statecode`**. Each `statecode` has one
  configured _default_ `statuscode`.

**The coupling is the whole point of the state machine.** A `statuscode` value is only legal
for the `statecode` it's mapped to. The real value→label mapping is tenant/table-specific —
read it per table:

```http
GET /EntityDefinitions(LogicalName='pmo_project')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)
```

The returned `OptionSet.Options[].State` tells you which `statecode` each `statuscode` belongs
to, and `Options[].Value` is the integer you write.

### Generic `statecode` / `statuscode` lifecycle (custom table default)

```
                   set statuscode within Active set
                  ┌───────────────────────────────┐
                  ▼                                 │
[Active (statecode=0)]  ──set statecode=1 (+valid statuscode)──►  [Inactive (statecode=1)]
       (default statuscode, e.g. 1)        ◄──set statecode=0──        (default statuscode, e.g. 2)
```

**Transitions:**

| From         | Action / Trigger                                      | To           | Reversible? | Side Effects                                        |
| ------------ | ----------------------------------------------------- | ------------ | ----------- | --------------------------------------------------- |
| Active (0)   | `PATCH` `statecode`=0 + a valid Active `statuscode`   | Active (0)   | yes         | Status-reason change only; workflows may fire       |
| Active (0)   | `PATCH` `statecode`=1 + a valid Inactive `statuscode` | Inactive (1) | yes         | Record deactivated; often hidden from default views |
| Inactive (1) | `PATCH` `statecode`=0 + a valid Active `statuscode`   | Active (0)   | yes         | Reactivated                                         |

> **Always send `statecode` AND a `statuscode` together** when changing state. If you omit
> `statuscode`, Dataverse picks the configured default for that state — which may not be what
> you intend. Sending a `statuscode` that isn't valid for the target `statecode` returns
> `400`.

### Illustrative PMO365 lifecycles (INFERRED — confirm via the StatusAttributeMetadata query)

PMO365 likely overlays **custom status reasons** on the standard Active/Inactive states, e.g.
a Project moving `Proposed → Active → On Hold → Completed → Cancelled`, or a Risk moving
`Open → Mitigating → Closed`. These would appear as extra `statuscode` options, possibly with
restricted transitions configured by the publisher. **Do not assume the labels or the allowed
transitions** — enumerate them per table with the query above, and respect any
`400`/`statecode`-transition errors as the source of truth for what's allowed.

**Per-state capabilities (generic):**

| State        | Can Update? | Can Delete? | Notes                                                                                                       |
| ------------ | ----------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| Active (0)   | yes         | yes\*       | Normal editing. \*Delete may be blocked by relationship constraints.                                        |
| Inactive (1) | usually yes | yes\*       | Many tables block edits-other-than-reactivation while inactive; if a write returns `400`, reactivate first. |

---

## Business Rules

### Ordering / Dependency Rules

- **Discovery before data, always.** Resolve the real EntitySetName from `EntityDefinitions`
  before issuing any data-layer call. Guessing the plural (`pmo_projects` vs `pmo_projectes`)
  is the #1 cause of `404`.
- A child row (task, risk, issue, benefit, financial) generally needs its parent
  `_pmo_projectid_value` set on create — confirm `RequiredLevel` via the Attributes metadata.
- Setting a lookup on create/update uses the navigation property, not the `_x_value` column:
  `"pmo_ProjectId@odata.bind": "/pmo_projects(<guid>)"`. The nav property's PascalCase form
  comes from `ReferencedEntityNavigationPropertyName` in the relationship metadata.

### Field-Level Rules

- **Lookups are read as `_{logicalname}_value`** (the raw GUID) and **written via the
  navigation property** with `@odata.bind`. The two names differ — read `_pmo_projectid_value`,
  write `pmo_ProjectId@odata.bind`.
- **Option-set fields are integers on the wire.** Send the integer; get readable labels back
  only when you pass `Prefer: odata.include-annotations="*"` (they arrive as
  `field@OData.Community.Display.V1.FormattedValue`).
- **`statecode` + `statuscode` must be set together** and must be a valid pairing (see State
  Machines).
- **Dates are ISO-8601 UTC.** `dateonly` columns take `"2026-08-30"`; `datetime` columns take
  `"2026-08-30T00:00:00Z"`. Confirm a column's `AttributeType` (DateTime vs DateOnly) via the
  Attributes metadata before formatting.
- Required-ness comes from `RequiredLevel` in attribute metadata (`ApplicationRequired` /
  `SystemRequired` = must supply; `None` / `Recommended` = optional).

### Cascading Effects

- **Deletes cascade per the relationship's behavior**, configured on the 1:N relationship
  (`CascadeConfiguration`): `Cascade` (delete children), `RemoveLink` (null the lookup), or
  `Restrict` (block the parent delete while children exist → `DELETE` returns an error). Check
  `OneToManyRelationships` metadata before deleting a parent project.
- **Deactivating a parent does not deactivate children** unless a custom process does so.
- Writes may trigger Power Automate flows / plug-ins / business rules registered on the table
  — side effects are tenant-specific and invisible to the API caller.

### Uniqueness Constraints

- **Alternate keys** (if defined on a table) enforce uniqueness on one or more columns and
  enable key-based addressing/upsert (see Field Format Reference). They are _optional_ — a
  table may have none. Discover via
  `GET /EntityDefinitions(LogicalName='pmo_project')/Keys?$select=LogicalName,KeyAttributes`.
- The GUID PK (`pmo_*id`) is always unique and server-assigned (you _may_ supply your own GUID
  on create, but normally let Dataverse generate it).
- Display names (`pmo_name`) are **not** unique unless an alternate key says so.

### Computed / Read-Only Fields

- `createdon`, `modifiedon`, `_createdby_value`, `_modifiedby_value` — server-managed.
  `_ownerid_value` is server-managed on read, but ownership _can_ be set on create/PATCH via
  `"ownerid@odata.bind": "/systemusers(<guid>)"` (or `/teams`); the legacy `Assign` action still
  works but is not required on the modern Web API.
- The GUID PK — server-assigned.
- **Calculated / rollup columns** (e.g. a risk score, a project cost roll-up) are read-only
  via the Web API; writing to them is ignored or errors. Identify them by `AttributeTypeName`
  in attribute metadata (`Calculated` / `Rollup` source type).

---

## Field Format Reference

| Format            | Pattern                                      | Example                                              | Notes                                                                   |
| ----------------- | -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| GUID (record id)  | 8-4-4-4-12 hex                               | `"7c9e6679-7425-40de-944b-e07fc1f90ae7"`             | No braces in JSON; URL form is `/{entityset}(<guid>)`.                  |
| Date (DateOnly)   | `YYYY-MM-DD`                                 | `"2026-08-30"`                                       | For `DateOnly` columns.                                                 |
| DateTime          | ISO-8601 UTC                                 | `"2026-08-30T09:00:00Z"`                             | Dataverse stores/returns UTC; use `Z`.                                  |
| Lookup (read)     | `_{logicalname}_value` → GUID string         | `"_pmo_projectid_value": "7c9e…"`                    | Raw FK GUID.                                                            |
| Lookup (write)    | `"{Nav}@odata.bind": "/{targetset}(<guid>)"` | `"pmo_ProjectId@odata.bind": "/pmo_projects(7c9e…)"` | Nav name from relationship metadata (PascalCase).                       |
| Option set        | integer                                      | `698030001`                                          | Label via `odata.include-annotations` annotations header.               |
| State / Status    | integer pair                                 | `"statecode": 0, "statuscode": 1`                    | Must be a valid pairing; set together.                                  |
| Money             | bare number                                  | `125000.00`                                          | Currency context from the row's `transactioncurrencyid`.                |
| Boolean           | `true` / `false`                             | `true`                                               | Two-option boolean.                                                     |
| Alternate-key URL | `/{entityset}(key='value')` or `(k1=…,k2=…)` | `/pmo_projects(pmo_code='ERP-001')`                  | Only if an alternate key is defined; multi-column keys comma-separated. |

---

## Enum Value Reference

There are **no global, documented enum values for PMO365** — every option set and the
state/status model are tenant- and table-specific. The platform-level `statecode` baseline for
custom tables is the only thing you can rely on without discovery.

| Entity                  | Field                 | Allowed Values                                                          | Default              | How to confirm                                                                                                             |
| ----------------------- | --------------------- | ----------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| any custom table        | `statecode`           | `0` = Active, `1` = Inactive _(platform default; some tables add more)_ | `0` (Active)         | `…/Attributes(LogicalName='statecode')/Microsoft.Dynamics.CRM.StateAttributeMetadata?$expand=OptionSet`                    |
| any custom table        | `statuscode`          | integer option set; **valid set depends on `statecode`**                | per-state configured | `…/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$expand=OptionSet($select=Options)` |
| `pmo_risk` _(inferred)_ | `pmo_impact`          | integer option set (e.g. Low / Medium / High) — **labels not public**   | tenant-configured    | `…/Attributes(LogicalName='pmo_impact')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`                |
| `pmo_project` _(inf.)_  | `pmo_type` / category | integer option set — **labels not public**                              | tenant-configured    | same `PicklistAttributeMetadata` pattern per attribute                                                                     |

> When the user asks "what statuses can a project have?", **run the StatusAttributeMetadata
> query and report the actual options** rather than inventing labels. The integer→label map
> and the State each status belongs to come straight from `OptionSet.Options`.

---

_Generated from `00-api-investigation-questionnaire.md` Phase 3. PMO365-specific table and
field names herein are ILLUSTRATIVE / [INFERRED] — confirm every one via the discovery queries
above. Dataverse platform behavior is [DOCUMENTED]._

_Sources (platform behavior):_

- _[StateCode / StatusCode coupling — learn.microsoft.com: Define custom state model transitions](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/define-custom-state-model-transitions)_
- _[Table definitions / metadata — learn.microsoft.com](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/entity-metadata)_
- _[Status reason transitions — learn.microsoft.com](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/define-status-reason-transitions)_

_Companions:_

- _01-llm-api-rules.md — Workspace agent rules, discovery-first flow, connect_request_
- _01b-query-patterns.md — OData $select/$filter/$expand, lookups, server-driven paging_
- _01c-mutation-patterns.md — Create/PATCH-upsert/delete, @odata.bind, alternate-key upsert_
- _01d-event-and-error-handling.md — Polling, service-protection 429/Retry-After, errors_
