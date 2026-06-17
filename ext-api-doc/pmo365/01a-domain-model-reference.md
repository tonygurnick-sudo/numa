---
api_name: PMO365 (Microsoft Dataverse)
api_slug: pmo365
companion_to: 01-llm-api-rules.md
base_url: '{environment_url}/api/data/v9.2/'
call_surface: 'HTTP via connect_request (not file-browse)'
schema_confidence: 'Every pmo_* table/column name here is ILLUSTRATIVE / [INFERRED] — proprietary + undocumented; confirm each via the paired discovery query / $metadata. NEVER present a pmo_* name as confirmed. Dataverse PLATFORM shape (metadata tables, _x_value lookups, statecode/statuscode, option sets, alternate keys) is [DOCUMENTED] and reliable.'
covers: "Dataverse domain model + the discovery model the agent runs first to learn the tenant's real PMO365 names + statecode/statuscode state machines"
---

# PMO365 — Domain Model Reference

## Dataverse mental model

No global "list all PMO365 tables" endpoint. The catalog is **discovered**, in two layers:

1. **Metadata layer** — describes the schema: `solutions`, `solutioncomponents`, `EntityDefinitions`, `publishers`, `$metadata` (full CSDL). Finds PMO365's tables + their real logical/EntitySet names.
2. **Data layer** — the project/risk/task rows, queried via the table's **EntitySetName** (`GET /{entitysetname}`). EntitySetName is the plural collection name, usually but not always `{logicalname}s` — **always read it from `EntityDefinitions`, never guess.**

Agent's required first move on any unseen PMO365 task: **discovery**, then work against the resolved EntitySetName.

### Naming to keep straight

| Concept                  | What it is                                                                              | Example (illustrative) |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------- |
| **LogicalName**          | singular schema name; lowercase, prefix-qualified; used in `$filter`/`$select`/metadata | `pmo_project`          |
| **EntitySetName**        | plural collection name used in the data-layer URL path                                  | `pmo_projects`         |
| **MetadataId**           | GUID identifying the table definition (metadata queries)                                | `a1b2c3d4-…`           |
| **PrimaryIdAttribute**   | GUID PK column                                                                          | `pmo_projectid`        |
| **PrimaryNameAttribute** | the "name/title" column shown in the UI                                                 | `pmo_name`             |
| **customizationprefix**  | publisher prefix shared by all the solution's custom tables                             | `pmo`                  |

## Discovery Catalog (metadata layer — query FIRST)

Real Dataverse platform endpoints. Send `Accept: application/json` + standard OData headers; for label-bearing reads add `Prefer: odata.include-annotations="*"`.

### `/solutions` — installed solutions; PMO365 is one. Read (write = admin/ALM, not from chat).

| Field                | Type        | Description                                   | Example                                  |
| -------------------- | ----------- | --------------------------------------------- | ---------------------------------------- |
| `solutionid`         | GUID        | PK; feed into `solutioncomponents` filter     | `"3f2504e0-4f89-41d3-9a0c-0305e82c3301"` |
| `uniquename`         | string      | machine name; filter on `contains(...,'pmo')` | `"PMO365Core"`                           |
| `friendlyname`       | string      | display name                                  | `"PMO365"`                               |
| `version`            | string      | installed version                             | `"4.12.0.1"`                             |
| `_publisherid_value` | GUID lookup | publisher → customization prefix              | —                                        |

`GET /solutions?$select=solutionid,uniquename,friendlyname,version&$filter=contains(uniquename,'pmo') or contains(friendlyname,'pmo')`

### `/solutioncomponents` — maps a solution to its objects. Filter on solution id + `componenttype eq 1` (Entity) to list PMO365's tables; `objectid` = each table's **MetadataId**. Read.

| Field                 | Type | Description                                   |
| --------------------- | ---- | --------------------------------------------- |
| `solutioncomponentid` | GUID | PK of the mapping row                         |
| `_solutionid_value`   | GUID | FK to `solutions.solutionid`                  |
| `componenttype`       | int  | component class; **`1` = Entity** (table)     |
| `objectid`            | GUID | for componenttype 1, the table **MetadataId** |

`GET /solutioncomponents?$filter=_solutionid_value eq 3f2504e0-4f89-41d3-9a0c-0305e82c3301 and componenttype eq 1&$select=objectid`

### `/EntityDefinitions` — table-metadata catalog. Resolve a MetadataId to LogicalName/EntitySetName, or list custom tables by prefix. Read (DDL admin-only).

| Field                  | Type            | Description                                  | Example           |
| ---------------------- | --------------- | -------------------------------------------- | ----------------- |
| `MetadataId`           | GUID            | PK; matches `solutioncomponents.objectid`    | `"a1b2c3d4-…"`    |
| `LogicalName`          | string          | singular schema name                         | `"pmo_project"`   |
| `EntitySetName`        | string          | **plural collection name used in data URLs** | `"pmo_projects"`  |
| `DisplayName`          | localized label | human label (needs annotations header)       | `"Project"`       |
| `PrimaryIdAttribute`   | string          | GUID PK column name                          | `"pmo_projectid"` |
| `PrimaryNameAttribute` | string          | the title/name column                        | `"pmo_name"`      |
| `IsCustomEntity`       | bool            | `true` for solution-added tables             | `true`            |

- Resolve one table from a MetadataId: `GET /EntityDefinitions(a1b2c3d4-...)?$select=LogicalName,EntitySetName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`
- List all PMO365 tables once prefix known: `GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity&$filter=startswith(LogicalName,'pmo_')`
- Inspect a table's columns: `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,AttributeType,RequiredLevel,IsValidForCreate,IsValidForUpdate`

### `/publishers` — solution publishers. `customizationprefix` marks a table as PMO365's (e.g. `pmo`); standard tables don't carry it. Read.

| Field                 | Type   | Description                                  | Example          |
| --------------------- | ------ | -------------------------------------------- | ---------------- |
| `publisherid`         | GUID   | PK                                           | —                |
| `customizationprefix` | string | prefix on all the publisher's tables/columns | `"pmo"`          |
| `friendlyname`        | string | publisher display name                       | `"EPM Partners"` |

`GET /publishers?$select=customizationprefix,friendlyname`

> **Full schema dump:** `GET {environment_url}/api/data/v9.2/$metadata` → entire CSDL (all tables, attributes, relationships, option sets). Heavy; reserve for the complete relationship graph, use targeted `EntityDefinitions` queries for day-to-day.

## Expected PMO365 Entity Shape (ILLUSTRATIVE — confirm via discovery)

> Names below are a hypothesis to verify, never fact. Each block names the discovery query that confirms the real names. Relationship/field-shape patterns (`_x_value` lookups, statecode/statuscode, option sets) are [DOCUMENTED] Dataverse behavior and apply once the real table is found.

### Project (e.g. `pmo_project`). Likely EntitySetName `pmo_projects`. Top-level portfolio item; parent of tasks/milestones, risks, issues, benefits, resources, financials. CRUD: C/R/U/D (per Application User's role).

| Field                  | Type                | Writable | Description                                     | Example                                  |
| ---------------------- | ------------------- | -------- | ----------------------------------------------- | ---------------------------------------- |
| `pmo_projectid`        | GUID                | no       | PrimaryIdAttribute (PK)                         | `"7c9e6679-7425-40de-944b-e07fc1f90ae7"` |
| `pmo_name`             | string              | yes      | PrimaryNameAttribute (title)                    | `"ERP Replacement"`                      |
| `pmo_startdate`        | dateonly/datetime   | yes      | planned start                                   | `"2026-06-01"`                           |
| `pmo_finishdate`       | dateonly/datetime   | yes      | planned finish                                  | `"2026-12-15"`                           |
| `_pmo_programid_value` | GUID lookup         | yes      | N:1 → Program/Portfolio (set via `@odata.bind`) | `"…"`                                    |
| `_ownerid_value`       | GUID lookup (owner) | yes      | owning user/team (standard ownership)           | `"…"`                                    |
| `statecode`            | int (state)         | yes      | lifecycle state (see State Machines)            | `0`                                      |
| `statuscode`           | int (status reason) | yes      | sub-status; valid set depends on `statecode`    | `1`                                      |
| `createdon`            | datetime            | no       | server-set on create                            | `"2026-05-29T03:00:00Z"`                 |
| `modifiedon`           | datetime            | no       | server-set on every write (poll target)         | `"2026-05-29T03:00:00Z"`                 |

Relationships (inferred):
| Related (illustrative) | Type | Expression | Notes |
| --- | --- | --- | --- |
| Program/Portfolio | N:1 | `_pmo_programid_value` + nav expand | confirm nav name in `EntityDefinitions/OneToManyRelationships` |
| Task / Milestone | 1:N | `GET /pmo_tasks?$filter=_pmo_projectid_value eq {id}` | child schedule items |
| Risk | 1:N | `GET /pmo_risks?$filter=_pmo_projectid_value eq {id}` | |
| Issue | 1:N | `GET /pmo_issues?$filter=_pmo_projectid_value eq {id}` | |
| Benefit | 1:N | `GET /pmo_benefits?$filter=_pmo_projectid_value eq {id}` | |
| Resource assignment | 1:N / N:M | via assignment/junction table | resources often M:N through a join table |
| Financial / cost line | 1:N | `GET /pmo_financials?$filter=_pmo_projectid_value eq {id}` | |

Confirm names: `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes?$select=LogicalName,AttributeType,RequiredLevel` and `GET /EntityDefinitions(LogicalName='pmo_project')/OneToManyRelationships?$select=ReferencingEntity,ReferencingAttribute,ReferencedEntityNavigationPropertyName`

### Task / Milestone (e.g. `pmo_task` / `pmo_milestone`). A schedule item under a project. Milestone may be a separate table or the same table flagged by an option set (`pmo_type`) — discovery tells you which. CRUD: C/R/U/D.

| Field                      | Type          | Writable | Description                 | Example                    |
| -------------------------- | ------------- | -------- | --------------------------- | -------------------------- |
| `pmo_taskid`               | GUID          | no       | PK                          | —                          |
| `pmo_name`                 | string        | yes      | task title                  | `"Migrate finance module"` |
| `_pmo_projectid_value`     | GUID lookup   | yes      | N:1 → Project               | `"…"`                      |
| `pmo_duedate`              | dateonly      | yes      | target date                 | `"2026-08-30"`             |
| `pmo_percentcomplete`      | int / decimal | yes      | progress 0–100              | `40`                       |
| `_pmo_assignedto_value`    | GUID lookup   | yes      | N:1 → Resource/User         | `"…"`                      |
| `statecode` / `statuscode` | int / int     | yes      | open vs completed lifecycle | `0` / `1`                  |

Confirm whether Milestone is type-flag or separate table: `GET /EntityDefinitions?$select=LogicalName,EntitySetName&$filter=startswith(LogicalName,'pmo_') and (contains(LogicalName,'task') or contains(LogicalName,'milestone'))`

### Risk (e.g. `pmo_risk`).

| Field                      | Type             | Writable | Description                           | Example          |
| -------------------------- | ---------------- | -------- | ------------------------------------- | ---------------- |
| `pmo_riskid`               | GUID             | no       | PK                                    | —                |
| `pmo_name`                 | string           | yes      | risk title                            | `"Vendor delay"` |
| `_pmo_projectid_value`     | GUID lookup      | yes      | N:1 → Project                         | `"…"`            |
| `pmo_probability`          | option set (int) | yes      | likelihood; labels via annotations    | `698030001`      |
| `pmo_impact`               | option set (int) | yes      | severity                              | `698030002`      |
| `pmo_riskscore`            | int / decimal    | maybe    | often computed (probability × impact) | `12`             |
| `statecode` / `statuscode` | int / int        | yes      | e.g. Open → Mitigated → Closed        | —                |

Probability/impact are almost certainly **option sets** (integers). Get labels via `Prefer: odata.include-annotations="*"`, or enumerate: `GET /EntityDefinitions(LogicalName='pmo_risk')/Attributes(LogicalName='pmo_impact')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`.

### Issue · Benefit · Resource · Financial (all illustrative — confirm)

Same pattern: a `pmo_*id` GUID PK, a `pmo_name`, a `_pmo_projectid_value` lookup to the project, option set(s) for categorisation, `statecode`/`statuscode`. Resources are frequently **N:M** through a junction (assignment) table, not a direct lookup. Financials may be one row per cost line or a roll-up table. Discover: `GET /EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName&$filter=startswith(LogicalName,'pmo_') and (contains(LogicalName,'issue') or contains(LogicalName,'benefit') or contains(LogicalName,'resource') or contains(LogicalName,'financ') or contains(LogicalName,'cost'))`. For any N:M, the junction is a collection navigation property: `GET /EntityDefinitions(LogicalName='pmo_resource')/ManyToManyRelationships`.

## Entity Relationship Diagram

> Platform shape is real; PMO365 names illustrative — verify each via discovery.

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

## State Machines

Dataverse models record lifecycle with **two coupled columns** on (almost) every table:

- **`statecode`** — the State (UI "Status"). Custom-table platform default: `0 = Active`, `1 = Inactive`. Some standard tables add more (activities: Open/Completed/Canceled/Scheduled).
- **`statuscode`** — the Status Reason (UI "Status Reason"). Finer option set whose **valid values depend on the current `statecode`**. Each `statecode` has one configured default `statuscode`.

**The coupling is the point:** a `statuscode` is only legal for the `statecode` it's mapped to. The real value→label map is tenant/table-specific — read it per table: `GET /EntityDefinitions(LogicalName='pmo_project')/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`. Returned `OptionSet.Options[].State` tells you which `statecode` each `statuscode` belongs to; `Options[].Value` is the integer you write.

Generic lifecycle (custom-table default):

```
                   set statuscode within Active set
                  ┌───────────────────────────────┐
                  ▼                                 │
[Active (statecode=0)]  ──set statecode=1 (+valid statuscode)──►  [Inactive (statecode=1)]
       (default statuscode, e.g. 1)        ◄──set statecode=0──        (default statuscode, e.g. 2)
```

Transitions:
| From | Action | To | Reversible? | Side Effects |
| --- | --- | --- | --- | --- |
| Active (0) | PATCH `statecode`=0 + valid Active `statuscode` | Active (0) | yes | status-reason change only; workflows may fire |
| Active (0) | PATCH `statecode`=1 + valid Inactive `statuscode` | Inactive (1) | yes | deactivated; often hidden from default views |
| Inactive (1) | PATCH `statecode`=0 + valid Active `statuscode` | Active (0) | yes | reactivated |

> **Always send `statecode` AND `statuscode` together** when changing state. Omitting `statuscode` makes Dataverse pick the configured default — maybe not what you intend. A `statuscode` invalid for the target `statecode` → `400`.

Illustrative PMO365 lifecycles (INFERRED — confirm via the StatusAttributeMetadata query): PMO365 likely overlays custom status reasons on Active/Inactive, e.g. Project `Proposed → Active → On Hold → Completed → Cancelled`, or Risk `Open → Mitigating → Closed` — extra `statuscode` options, possibly with restricted transitions. **Do not assume labels or allowed transitions** — enumerate per table, and respect `400`/transition errors as the source of truth.

Per-state capabilities (generic):
| State | Update? | Delete? | Notes |
| --- | --- | --- | --- |
| Active (0) | yes | yes* | normal editing. *Delete may be blocked by relationship constraints. |
| Inactive (1) | usually yes | yes\* | many tables block edits-other-than-reactivation while inactive; if a write returns `400`, reactivate first. |

## Business Rules

### Ordering / dependency

- **Discovery before data, always.** Resolve the real EntitySetName before any data-layer call; guessing the plural (`pmo_projects` vs `pmo_projectes`) is the #1 `404`.
- A child row (task/risk/issue/benefit/financial) generally needs its parent `_pmo_projectid_value` set on create — confirm `RequiredLevel` via Attributes metadata.
- Setting a lookup uses the navigation property, not `_x_value`: `"pmo_ProjectId@odata.bind": "/pmo_projects(<guid>)"`. The nav property's PascalCase form comes from `ReferencedEntityNavigationPropertyName` in relationship metadata.

### Field-level

- **Lookups read as `_{logicalname}_value`** (raw GUID), **written via the nav property** with `@odata.bind`. The two names differ — read `_pmo_projectid_value`, write `pmo_ProjectId@odata.bind`.
- **Option sets are integers on the wire.** Send the integer; labels come back only with `Prefer: odata.include-annotations="*"` (as `field@OData.Community.Display.V1.FormattedValue`).
- **`statecode` + `statuscode` set together** and a valid pairing.
- **Dates are ISO-8601 UTC.** `dateonly` columns take `"2026-08-30"`; `datetime` take `"2026-08-30T00:00:00Z"`. Confirm `AttributeType` (DateTime vs DateOnly) before formatting.
- Required-ness comes from `RequiredLevel` (`ApplicationRequired`/`SystemRequired` = must supply; `None`/`Recommended` = optional).

### Cascading effects

- **Deletes cascade per the 1:N relationship's `CascadeConfiguration`:** `Cascade` (delete children), `RemoveLink` (null the lookup), or `Restrict` (block parent delete while children exist → `DELETE` errors). Check `OneToManyRelationships` before deleting a parent.
- **Deactivating a parent does not deactivate children** unless a custom process does so.
- Writes may trigger Power Automate flows / plug-ins / business rules — side effects are tenant-specific and invisible to the caller.

### Uniqueness

- **Alternate keys** (if defined) enforce uniqueness on one+ columns and enable key-based addressing/upsert. Optional — a table may have none. Discover: `GET /EntityDefinitions(LogicalName='pmo_project')/Keys?$select=LogicalName,KeyAttributes`.
- The GUID PK (`pmo_*id`) is always unique, server-assigned (you may supply your own GUID on create, but normally let Dataverse generate it).
- Display names (`pmo_name`) are **not** unique unless an alternate key says so.

### Computed / read-only fields

- `createdon`, `modifiedon`, `_createdby_value`, `_modifiedby_value` — server-managed. `_ownerid_value` is server-managed on read but settable on create/PATCH via `"ownerid@odata.bind": "/systemusers(<guid>)"` (or `/teams`); the legacy `Assign` action still works but isn't required on the modern Web API.
- The GUID PK — server-assigned.
- **Calculated / rollup columns** (risk score, cost roll-up) are read-only via the Web API; writes are ignored or error. Identify them by `AttributeTypeName` (`Calculated`/`Rollup` source) in attribute metadata.

## Field Format Reference

| Format            | Pattern                                      | Example                                              | Notes                                                             |
| ----------------- | -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| GUID (record id)  | 8-4-4-4-12 hex                               | `"7c9e6679-7425-40de-944b-e07fc1f90ae7"`             | no braces in JSON; URL form `/{entityset}(<guid>)`                |
| Date (DateOnly)   | `YYYY-MM-DD`                                 | `"2026-08-30"`                                       | for `DateOnly` columns                                            |
| DateTime          | ISO-8601 UTC                                 | `"2026-08-30T09:00:00Z"`                             | Dataverse stores/returns UTC; use `Z`                             |
| Lookup (read)     | `_{logicalname}_value` → GUID                | `"_pmo_projectid_value": "7c9e…"`                    | raw FK GUID                                                       |
| Lookup (write)    | `"{Nav}@odata.bind": "/{targetset}(<guid>)"` | `"pmo_ProjectId@odata.bind": "/pmo_projects(7c9e…)"` | nav name from relationship metadata (PascalCase)                  |
| Option set        | integer                                      | `698030001`                                          | label via annotations header                                      |
| State / Status    | integer pair                                 | `"statecode": 0, "statuscode": 1`                    | valid pairing; set together                                       |
| Money             | bare number                                  | `125000.00`                                          | currency from the row's `transactioncurrencyid`                   |
| Boolean           | `true`/`false`                               | `true`                                               | two-option boolean                                                |
| Alternate-key URL | `/{entityset}(key='value')` or `(k1=…,k2=…)` | `/pmo_projects(pmo_code='ERP-001')`                  | only if an alternate key is defined; multi-column comma-separated |

## Enum Value Reference

There are **no global, documented enum values for PMO365** — every option set and the state/status model are tenant- and table-specific. The platform `statecode` baseline for custom tables is the only thing reliable without discovery.
| Entity | Field | Allowed Values | Default | How to confirm |
| --- | --- | --- | --- | --- |
| any custom table | `statecode` | `0`=Active, `1`=Inactive (platform default; some add more) | `0` | `…/Attributes(LogicalName='statecode')/Microsoft.Dynamics.CRM.StateAttributeMetadata?$expand=OptionSet` |
| any custom table | `statuscode` | integer option set; **valid set depends on `statecode`** | per-state configured | `…/Attributes(LogicalName='statuscode')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$expand=OptionSet($select=Options)` |
| `pmo_risk` | `pmo_impact` | integer option set (e.g. Low/Medium/High) — labels not public | tenant-configured | `…/Attributes(LogicalName='pmo_impact')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet` |
| `pmo_project` | `pmo_type` / category | integer option set — labels not public | tenant-configured | same `PicklistAttributeMetadata` pattern per attribute |

> When the user asks "what statuses can a project have?", **run the StatusAttributeMetadata query and report the actual options** — don't invent labels. The integer→label map and each status's State come straight from `OptionSet.Options`.

## Sources (platform behavior)

- StateCode/StatusCode coupling: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/define-custom-state-model-transitions
- Table definitions / metadata: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/entity-metadata
- Status reason transitions: https://learn.microsoft.com/en-us/power-apps/maker/data-platform/define-status-reason-transitions
