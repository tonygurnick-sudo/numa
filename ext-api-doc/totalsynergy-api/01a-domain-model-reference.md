---
api_name: 'Total Synergy (API Key)'
api_slug: 'totalsynergy-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behaviour']
---

# Total Synergy (API Key) — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Full entity catalog, relationships, state machines, and
> business rules the workspace agent references when working with Total Synergy data.
>
> 📌 **Same data model as `totalsynergy-oauth`** — identical product, identical entities. Only the
> credential acquisition differs (static key vs. OAuth). If this file and the OAuth one diverge,
> reconcile them.
>
> ⚠️ **Confidence:** Entity _names_ and resource _paths_ are `[DOCUMENTED]`/`[INFERRED]` from KB
> articles and product UI. Every **field-level** schema below is `[INFERRED]` — the reference is a
> JS-rendered Swagger SPA that could not be enumerated, and **no live call was made**. Items tagged
> **🔬** must be confirmed against a live tenant by dumping `/swagger/ui/index` (v2) and
> `/swagger/v4` with a static key before you trust write bodies or exact field casing.

---

## Tenancy & Path Model

Every data resource lives under an **organisation** identified by a `{Slug}` in the path:

```
https://api.totalsynergy.com/api/v2/Organisation/{Slug}/{Resource}
```

- `{Slug}` is a **path value**, not the hostname. The registry's `instance_url`
  (`https://yourcompany.totalsynergy.com`) is **not** the API base — always call
  `api.totalsynergy.com`. `[DOCUMENTED]` 🚩
- Resolve `{Slug}` once with `GET /api/v2/Organisation` or `…/Organisation/MySlug` using the
  `access-token` header, then reuse it for every other path. `[DOCUMENTED]` 🔬 (exact response shape)
- A static key is **scoped to one organisation** and to the **issuing user's role** — you cannot
  read across orgs, and you cannot see data the user can't see in the Synergy UI. `[DOCUMENTED]`

---

## Entity Catalog

### Organisation

**Resource path:** `/Organisation`, `/Organisation/MySlug`
**Description:** Tenant metadata. Resolves the `{Slug}` used in every other path.
**CRUD:** Read

| Field | Type   | Required | Writable | Description                       | Example              |
| ----- | ------ | -------- | -------- | --------------------------------- | -------------------- |
| slug  | string | —        | no       | Org identifier used in every path | `"acme-eng"`         |
| name  | string | —        | no       | Display name of the organisation  | `"Acme Engineering"` |

> Field names/shape `[INFERRED]` 🔬 — may return a list of orgs the key can access rather than a single object.

**Relationships:**

| Related Entity | Type | Expression                           | Notes                          |
| -------------- | ---- | ------------------------------------ | ------------------------------ |
| Project        | 1:N  | `…/Organisation/{Slug}/Projects`     | All projects belong to one org |
| Contact        | 1:N  | `…/Organisation/{Slug}/Contacts`     |                                |
| Staff          | 1:N  | `…/Organisation/{Slug}/Staff`        |                                |
| Transaction    | 1:N  | `…/Organisation/{Slug}/Transactions` |                                |

---

### Project

**Resource path:** `/Organisation/{Slug}/Projects`
**Description:** Central job/engagement record — the architecture/engineering "job". Paged list
returns `totalItems` + `items[]`.
**CRUD:** Read (+ likely write 🔬)

| Field         | Type         | Required     | Writable | Description                            | Example                      |
| ------------- | ------------ | ------------ | -------- | -------------------------------------- | ---------------------------- |
| id            | string / int | —            | no       | Unique id; queryable via `criteria.Id` | `"10042"`                    |
| name          | string       | yes (create) | yes 🔬   | Project name                           | `"Riverside Bridge Upgrade"` |
| projectNumber | string       | —            | maybe 🔬 | Human-facing job number                | `"P-2026-014"`               |
| status        | enum/string  | —            | yes 🔬   | active / on-hold / closed 🔬           | `"Active"`                   |
| clientId      | string / int | —            | yes 🔬   | FK → Contact (the client)              | `"551"`                      |
| createdDate   | string       | —            | no       | Date serialised as a string            | `"2026-01-15"`               |

> All field names/types `[INFERRED]` 🔬. Synergy serialises strongly-typed values (e.g. dates) as
> **strings** in JSON, but exact key names and casing are unconfirmed.

**Relationships:**

| Related Entity   | Type | Expression                              | Notes                       |
| ---------------- | ---- | --------------------------------------- | --------------------------- |
| Contact (client) | N:1  | `clientId` on Project                   | The project's client        |
| Stage            | 1:N  | `…/Projects/{id}/Stages` 🔬             | Project breakdown           |
| Task             | 1:N  | `…/Projects/{id}/Tasks` 🔬              | Under Stages                |
| Transaction      | 1:N  | `projectId` on timesheet/invoice writes | Time + billing reference it |

---

### Stage

**Resource path:** `/Organisation/{Slug}/Projects/{id}/Stages` 🔬
**Description:** A breakdown of a project. Referenced by `stageId` on timesheet entries.
**CRUD:** Read 🔬

| Field     | Type         | Required | Writable | Description    | Example    |
| --------- | ------------ | -------- | -------- | -------------- | ---------- |
| id        | string / int | —        | no       | Stage id       | `"3"`      |
| projectId | string / int | —        | no       | Parent project | `"10042"`  |
| name      | string       | —        | no       | Stage name     | `"Design"` |

> Entire entity `[INFERRED]` 🔬 — path and fields unconfirmed.

---

### Task

**Resource path:** `/Organisation/{Slug}/Projects/{id}/Tasks` 🔬
**Description:** Work item under a project/stage. Referenced by `taskId` on timesheet entries.
**CRUD:** Read 🔬

| Field   | Type         | Required | Writable | Description  | Example          |
| ------- | ------------ | -------- | -------- | ------------ | ---------------- |
| id      | string / int | —        | no       | Task id      | `"17"`           |
| stageId | string / int | —        | no       | Parent stage | `"3"`            |
| name    | string       | —        | no       | Task name    | `"Concept plan"` |

> Entire entity `[INFERRED]` 🔬.

---

### Contact

**Resource path:** `/Organisation/{Slug}/Contacts`
**Description:** People & organisations in the address book (clients, consultants, suppliers).
Searchable by `criteria.Id`.
**CRUD:** Read (+ likely write 🔬)

| Field | Type         | Required | Writable | Description                | Example                |
| ----- | ------------ | -------- | -------- | -------------------------- | ---------------------- |
| id    | string / int | —        | no       | Unique id                  | `"551"`                |
| name  | string       | yes 🔬   | yes 🔬   | Contact / company name     | `"Riverside Council"`  |
| email | string       | —        | yes 🔬   | Primary email              | `"info@riverside.gov"` |
| type  | enum/string  | —        | 🔬       | person vs. organisation 🔬 | `"Organisation"`       |

> Fields `[INFERRED]` 🔬.

**Relationships:**

| Related Entity | Type | Expression            | Notes               |
| -------------- | ---- | --------------------- | ------------------- |
| Project        | 1:N  | `clientId` on Project | A client → projects |

---

### Staff

**Resource path:** `/Organisation/{Slug}/Staff`
**Description:** Internal employees/users. Referenced by `staffId` on timesheet entries — list this
first to resolve a valid `staffId` before any timesheet write.
**CRUD:** Read

| Field | Type         | Required | Writable | Description | Example                 |
| ----- | ------------ | -------- | -------- | ----------- | ----------------------- |
| id    | string / int | —        | no       | Staff id    | `"88"`                  |
| name  | string       | —        | no       | Staff name  | `"Jordan Lee"`          |
| email | string       | —        | no       | Email       | `"jordan@acme-eng.com"` |

> Fields `[INFERRED]` 🔬.

---

### Transaction

**Resource path:** `/Organisation/{Slug}/Transactions`
**Description:** Synergy's billing/financial surface. **Invoices** live here, and **timesheet
entries** are created here. This is the **rate-limited "Transactions API"** (50/day standard,
20k/day Premium).
**CRUD:** Read + Create

| Field         | Type           | Required (create) | Writable | Description                  | Example    |
| ------------- | -------------- | ----------------- | -------- | ---------------------------- | ---------- |
| staffId       | string / int   | yes (timesheet)   | yes      | FK → Staff                   | `"88"`     |
| projectId     | string / int   | yes (timesheet)   | yes      | FK → Project                 | `"10042"`  |
| stageId       | string / int   | usually 🔬        | yes      | FK → Stage                   | `"3"`      |
| taskId        | string / int   | usually 🔬        | yes      | FK → Task                    | `"17"`     |
| fromDateAsInt | int (yyyymmdd) | yes 🔬            | yes      | Start date as integer        | `20260526` |
| toDateAsInt   | int (yyyymmdd) | yes 🔬            | yes      | End date as integer          | `20260526` |
| units         | decimal        | yes 🔬            | yes      | Hours/units (field name 🔬)  | `7.5`      |
| timesheetId   | string / int   | —                 | no       | Returned id of created entry | `"990123"` |

> Body field set `[INFERRED]` from KB naming 🔬. The exact create path under Transactions, the
> units/hours field name, the invoice vs. timesheet discriminator, and the response envelope are
> **🔬 DISCOVER**.

**Relationships:**

| Related Entity | Type | Expression           | Notes                |
| -------------- | ---- | -------------------- | -------------------- |
| Staff          | N:1  | `staffId`            | Who logged the time  |
| Project        | N:1  | `projectId`          | Which project        |
| Stage / Task   | N:1  | `stageId` / `taskId` | Where on the project |

---

### Invoice (a Transaction type)

**Resource path:** `/Organisation/{Slug}/Transactions` (modelled as a Transaction) 🔬
**Description:** Customer invoices, modelled as a Transaction type. Exact path/shape unconfirmed.
**CRUD:** Read (+ create) 🔬

| Field     | Type         | Required | Writable | Description    | Example        |
| --------- | ------------ | -------- | -------- | -------------- | -------------- |
| id        | string / int | —        | no       | Invoice id     | `"INV-77"`     |
| projectId | string / int | —        | 🔬       | Project billed | `"10042"`      |
| amount    | decimal      | —        | 🔬       | Invoice amount | `1500.00`      |
| date      | string       | —        | 🔬       | Invoice date   | `"2026-05-29"` |

> Entire entity `[INFERRED]` 🔬 — how invoices are distinguished from timesheet entries on the
> Transactions endpoint is a key discovery item.

---

### Timesheet entry

**Resource path:** Created via `POST …/Transactions`; read via `…/Timesheet/Week`.
**Description:** A staff member's logged time against a project/stage/task. Written through the
Transactions API (rate-limited); read through `Timesheet/Week`.
**CRUD:** Read + Create

See **Transaction** above for the create body. Read shape via `Timesheet/Week` is 🔬 (query params:
week-start, staff).

---

### Timer

**Resource path:** `/Organisation/{Slug}/Timers`
**Description:** Running/stored timers (referenced on the portal landing).
**CRUD:** Read + write 🔬

> Fields `[INFERRED]`/`[UNKNOWN]` 🔬.

---

### Leaderboard

**Resource path:** `/Organisation/{Slug}/Timesheet/Leaderboard`
**Description:** Aggregate timesheet metric across staff.
**CRUD:** Read

> Fields `[UNKNOWN]` 🔬.

---

## Entity Relationship Diagram

```
┌──────────────┐  1:N   ┌───────────┐  1:N   ┌────────┐  1:N   ┌───────┐
│ Organisation │───────▶│  Project  │───────▶│ Stage  │───────▶│ Task  │
│   ({Slug})   │        └───────────┘        └────────┘        └───────┘
└──────────────┘              │ N:1                                  ▲
       │ 1:N                  ▼                                      │ referenced by
       ▼                ┌───────────┐                               │
┌────────────┐         │  Contact   │◀── client                     │
│   Staff    │         │ (client)   │                               │
└────┬───────┘         └───────────┘                               │
     │ logs time                                                    │
     ▼                                                              │
┌──────────────────────────┐   creates   ┌──────────────────────────┐
│  Transactions API        │────────────▶│ Timesheet entry / Invoice │
│ (rate-limited 50/day std) │             │ (staffId, projectId,      │
└──────────────────────────┘             │  stageId, taskId, …)──────┘
```

---

## State Machines

### Project Lifecycle (INFERRED 🔬)

```
[Active] ──hold──> [On Hold] ──resume──> [Active] ──close──> [Closed/Archived]
```

**Transitions:**

| From    | Action / Trigger | To              | Reversible? | Side Effects |
| ------- | ---------------- | --------------- | ----------- | ------------ |
| Active  | hold 🔬          | On Hold         | Yes 🔬      | 🔬           |
| On Hold | resume 🔬        | Active          | —           | 🔬           |
| Active  | close 🔬         | Closed/Archived | No 🔬       | 🔬           |

> The lifecycle is `[INFERRED]` from the product UI. Exact enum values, allowed transitions, and
> whether status is API-writable are **[UNKNOWN]** 🔬 — discover from the spec.

**Per-State Capabilities:** Unknown 🔬 — whether closed/archived projects reject timesheet writes is
not documented.

---

## Business Rules

### Ordering / Dependency Rules

- Resolve the org `{Slug}` (`GET …/Organisation` / `…/Organisation/MySlug`) **before any other
  call** — every data path needs it. `[DOCUMENTED]`
- A **timesheet entry** must reference a valid `staffId` + `projectId` (and usually `stageId` /
  `taskId`) — these must exist first. List Staff / Projects to resolve ids. `[INFERRED]` 🔬
- Timesheet/invoice creation goes through the **Transactions API**, which carries its **own, much
  tighter rate budget** (50/day standard, 20k/day Premium). `[DOCUMENTED]`

### Field-Level Rules

- Resources are **tenant-isolated by `{Slug}`** — one key cannot read across organisations.
  `[DOCUMENTED]`
- The static key inherits the **issuing user's role/permissions** — data the user cannot see in the
  Synergy UI is invisible through their key. `[DOCUMENTED]`
- Dates are serialised/accepted as **strings**; some endpoints use **integer-encoded dates**
  (`fromDateAsInt` / `toDateAsInt`, `yyyymmdd`). `[DOCUMENTED / INFERRED]` 🔬

### Cascading Effects

- None documented. No bulk operations; Transaction writes are one-at-a-time. `[INFERRED]`

### Uniqueness Constraints

- `{Slug}` is unique per organisation. `[DOCUMENTED]`
- Other uniqueness constraints (e.g. project number) `[UNKNOWN]` 🔬.

### Computed / Read-Only Fields

- `id` and `createdDate` are server-set / read-only. `[INFERRED]` 🔬
- Created Transaction returns a server-assigned `timesheetId`. `[DOCUMENTED]`

---

## Field Format Reference

| Format   | Pattern                                    | Example         | Notes                                                            | Confidence    |
| -------- | ------------------------------------------ | --------------- | ---------------------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)               | `"2026-05-29"`  | "dates are serialized and delivered in string format"            | [DOCUMENTED]  |
| Int-date | `yyyymmdd`-style integer on some endpoints | `20260529`      | `fromDateAsInt` / `toDateAsInt` on timesheet/leave inputs        | [INFERRED] 🔬 |
| ID       | string or integer per resource             | `"12345"`       | Queryable via `criteria.Id`; exact type per resource unconfirmed | [INFERRED] 🔬 |
| Currency | decimal number                             | `1500.00`       | On Transactions/invoices                                         | [INFERRED] 🔬 |
| Slug     | org identifier string in path              | `acme-eng`      | `…/Organisation/{Slug}/…`                                        | [DOCUMENTED]  |
| API key  | opaque string (the access token)           | `<long string>` | Pasted into the `api_key` field; sent as `access-token` header   | [DOCUMENTED]  |

---

## Enum Value Reference

| Entity  | Field  | Allowed Values                   | Default | Notes                                       |
| ------- | ------ | -------------------------------- | ------- | ------------------------------------------- |
| Project | status | `Active`, `On Hold`, `Closed` 🔬 | —       | **[INFERRED]** from UI — confirm on spec 🔬 |

> All enum values are `[INFERRED]` 🔬 — none confirmed against a live spec. Do not present these as
> authoritative; discover the real values before filtering or writing by status.

---

_Generated from the investigation questionnaire, Phase 3. Mirrors `totalsynergy-oauth` (same data model)._
