---
api_name: 'Total Synergy (OAuth)'
api_slug: 'totalsynergy-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Total Synergy (OAuth) — Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalog, relationships, and business rules.
>
> 📌 **Same domain model as `totalsynergy-api`** — only the credential acquisition differs. Keep
> the two doc sets consistent.
>
> **Vocabulary:** a job/engagement is a **Project**. Billing/financial records (incl. **invoices**
> and **timesheet entries**) are written through the **Transactions** API. Resources are
> **organisation-scoped**: most paths are `…/Organisation/{Slug}/{Resource}`.
>
> ⚠️ **Field tables below are `[INFERRED]` / 🔬 DISCOVER unless marked `[DOCUMENTED]`.** Synergy
> serialises strongly-typed values (e.g. dates) as **strings** in JSON, but exact key names,
> casing, and required flags are unconfirmed — the reference is a JS-rendered Swagger SPA. Dump
> the OpenAPI spec from a live tenant (`/swagger/ui/index`, `/swagger/v4`) before trusting writes.

---

## Entity Catalog

### Project

**Resource path:** `Organisation/{Slug}/Projects`
**Description:** The central job/engagement record — everything (stages, tasks, timesheets,
transactions/invoices) hangs off a Project. `[DOCUMENTED]`
**CRUD:** GET (list/single via `criteria.Id`) `[DOCUMENTED]`; create/update likely `[INFERRED]` 🔬

| Field           | Type         | Required     | Writable | Description                                 | Example                      |
| --------------- | ------------ | ------------ | -------- | ------------------------------------------- | ---------------------------- |
| `id`            | string / int | —            | no       | Unique project id (query via `criteria.Id`) | `"10042"`                    |
| `name`          | string       | yes (create) | yes      | Project name                                | `"Riverside Bridge Upgrade"` |
| `projectNumber` | string       | no           | maybe 🔬 | Human-facing job number                     | `"P-2026-031"`               |
| `status`        | enum/string  | no           | yes 🔬   | active / on-hold / closed (tokens 🔬)       | `"Active"`                   |
| `clientId`      | string / int | no           | yes      | FK → Contact (the client)                   | `"551"`                      |
| `createdDate`   | string (ISO) | —            | no       | Date serialised as string                   | `"2026-05-01"`               |

**Relationships:**

| Related Entity | Type | Expression                   | Notes                        |
| -------------- | ---- | ---------------------------- | ---------------------------- |
| Organisation   | N:1  | `{Slug}` in path             | Owning tenant                |
| Stage          | 1:N  | `Projects/{id}/Stages` 🔬    | Project breakdown            |
| Task           | 1:N  | `Projects/{id}/Tasks` 🔬     | Under stages                 |
| Contact        | N:1  | `clientId` ref               | The client/customer          |
| Transaction    | 1:N  | `Transactions` (filtered) 🔬 | Invoices + timesheet entries |

---

### Contact

**Resource path:** `Organisation/{Slug}/Contacts`
**Description:** People and organisations in the address book — clients and other parties. `[DOCUMENTED]`
**CRUD:** GET (list/single via `criteria.Id`) `[DOCUMENTED]`; create/update likely `[INFERRED]` 🔬

| Field   | Type         | Required | Writable | Description       | Example               |
| ------- | ------------ | -------- | -------- | ----------------- | --------------------- |
| `id`    | string / int | —        | no       | Unique contact id | `"551"`               |
| `name`  | string       | yes 🔬   | yes 🔬   | Display name      | `"Acme City Council"` |
| `email` | string       | no       | yes 🔬   | Primary email     | `"info@acme.gov"`     |
| `phone` | string       | no       | yes 🔬   | Phone             | `"+61 2 9000 0000"`   |

> All Contact fields beyond `id` are `[INFERRED]` 🔬.

---

### Staff

**Resource path:** `Organisation/{Slug}/Staff`
**Description:** Internal employees/users; referenced by `staffId` on timesheet entries. `[DOCUMENTED]`
**CRUD:** GET (read) `[DOCUMENTED]`

| Field  | Type         | Required | Writable | Description     | Example        |
| ------ | ------------ | -------- | -------- | --------------- | -------------- |
| `id`   | string / int | —        | no       | Unique staff id | `"88"`         |
| `name` | string       | —        | no 🔬    | Staff name      | `"Sam Taylor"` |

> Used to resolve a valid `staffId` before creating a timesheet entry. Fields beyond `id` 🔬.

---

### Organisation

**Resource path:** `Organisation`, `Organisation/MySlug`
**Description:** Tenant metadata; resolves the `{Slug}` used in every other path. **Resolve this
first.** `[DOCUMENTED]`
**CRUD:** GET (read)

| Field  | Type   | Required | Writable | Description                  | Example              |
| ------ | ------ | -------- | -------- | ---------------------------- | -------------------- |
| `slug` | string | —        | no       | Org identifier used in paths | `"acme-eng"`         |
| `name` | string | —        | no       | Org display name             | `"Acme Engineering"` |

> Exact path (`/Organisation` list vs. `/Organisation/MySlug`) + response shape 🔬.

---

### Transaction (invoices + timesheet entries)

**Resource path:** `Organisation/{Slug}/Transactions`
**Description:** Synergy's billing/financial surface. **Invoices** and **timesheet entries** are
both written here via the **rate-limited Transactions API** (50/day standard, 20k/day Premium). `[DOCUMENTED]`
**CRUD:** GET (list) `[INFERRED]` 🔬; POST (create) `[DOCUMENTED]`

| Field           | Type    | Required   | Writable | Description                        | Example    |
| --------------- | ------- | ---------- | -------- | ---------------------------------- | ---------- |
| `timesheetId`   | string  | —          | no       | Server-set id returned on create   | `"990123"` |
| `staffId`       | string  | yes 🔬     | yes      | FK → Staff (who logged the time)   | `"88"`     |
| `projectId`     | string  | yes 🔬     | yes      | FK → Project                       | `"10042"`  |
| `stageId`       | string  | usually 🔬 | yes      | FK → Stage                         | `"3"`      |
| `taskId`        | string  | usually 🔬 | yes      | FK → Task                          | `"17"`     |
| `fromDateAsInt` | int     | yes 🔬     | yes      | Integer-encoded date (`yyyymmdd`)  | `20260526` |
| `toDateAsInt`   | int     | yes 🔬     | yes      | Integer-encoded date (`yyyymmdd`)  | `20260526` |
| `units`         | decimal | yes 🔬     | yes      | Hours/units worked (field name 🔬) | `7.5`      |

> The Transaction request shape, the units/hours field name, and the invoice-vs-timesheet
> distinction (likely a type discriminator) are all `[INFERRED]` 🔬. Confirm before writing.

---

### Stage, Task, Timer, Timesheet read (summary)

| Entity         | Resource (under `Organisation/{Slug}/`)   | Purpose                                 | Confidence    |
| -------------- | ----------------------------------------- | --------------------------------------- | ------------- |
| Stage          | `Projects/{id}/Stages`                    | Project breakdown; `stageId` on entries | [INFERRED] 🔬 |
| Task           | `Projects/{id}/Tasks`                     | Under stages; `taskId` on entries       | [INFERRED] 🔬 |
| Timer          | `Timers`                                  | Running/stored timers                   | [DOCUMENTED]  |
| Timesheet read | `Timesheet/Week`, `Timesheet/Leaderboard` | Weekly entries + aggregate metric       | [DOCUMENTED]  |

> Timesheet entries are **read** via `Timesheet/Week` but **created** via the Transactions API — not symmetrical.

---

## Entity Relationship Diagram

```
┌──────────────┐  1:N   ┌───────────┐  1:N   ┌────────┐  1:N   ┌───────┐
│ Organisation │───────▶│  Project  │───────▶│ Stage  │───────▶│ Task  │
│   ({Slug})   │        └─────┬─────┘        └────────┘        └───────┘
└──────┬───────┘              │ N:1                                 ▲
       │ 1:N                  ▼                                     │ referenced by
       ▼                ┌───────────┐                              │
┌────────────┐         │  Contact  │◀── client                    │
│   Staff    │         │ (client)  │                              │
└────┬───────┘         └───────────┘                              │
     │ logs time                                                  │
     ▼                                                            │
┌──────────────────────────┐  creates   ┌──────────────────────────┐
│   Transactions API       │───────────▶│ Timesheet entry / Invoice │
│ (rate-limited 50/day std)│            │ (staffId, projectId,      │
└──────────────────────────┘            │  stageId, taskId, units)──┘
```

---

## State Machines

### Project lifecycle (INFERRED 🔬)

```
[Active] ──hold──> [On Hold] ──resume──> [Active] ──close──> [Closed / Archived]
```

The lifecycle is `[INFERRED]` from the product UI. **Exact enum tokens and allowed transitions are
`[UNKNOWN]`** — read them from a live spec/tenant before attempting programmatic status changes. 🔬

---

## Business Rules

### Ordering / Dependency Rules

- A **Project must exist** before logging timesheets/transactions against it. `[INFERRED]` 🔬
- A **timesheet entry** must reference a valid `staffId` + `projectId` (usually `stageId`/`taskId`)
  — resolve these via the Staff/Projects/Stages/Tasks reads first. `[INFERRED]` 🔬
- Resources are **tenant-isolated by `{Slug}`** — you cannot read across organisations with one token. `[DOCUMENTED]`

### Field-Level Rules

- Dates are serialised/accepted as **strings**; some endpoints use **integer-encoded dates**
  (`fromDateAsInt` / `toDateAsInt`, `yyyymmdd`). `[DOCUMENTED string serialisation / INFERRED int-date]` 🔬

### Cascading Effects / Rate Constraints

- Timesheet/invoice creation goes through the **Transactions API**, which has its **own, much
  tighter daily budget** (50/day standard, 20k/day Premium). Treat writes as scarce. `[DOCUMENTED]`

### Computed / Read-Only Fields

- `id` / `timesheetId` are server-set on create. `[INFERRED]` 🔬

---

## Field Format Reference

| Format   | Pattern                             | Example        | Notes                                                   | Confidence    |
| -------- | ----------------------------------- | -------------- | ------------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)        | `"2026-05-29"` | "dates are serialized and delivered in string form"     | [DOCUMENTED]  |
| Int-date | `yyyymmdd` integer (some endpoints) | `20260529`     | `fromDateAsInt` / `toDateAsInt`                         | [INFERRED] 🔬 |
| ID       | string or integer per resource      | `"10042"`      | Queryable via `criteria.Id`; exact type per resource 🔬 | [INFERRED] 🔬 |
| Currency | decimal number                      | `1500.00`      | On Transactions/invoices                                | [INFERRED] 🔬 |
| Slug     | org identifier string in path       | `acme-eng`     | `…/Organisation/{Slug}/…`                               | [DOCUMENTED]  |

---

## Enum Value Reference

| Entity  | Field    | Allowed Values                 | Default | Notes                    | Confidence    |
| ------- | -------- | ------------------------------ | ------- | ------------------------ | ------------- |
| Project | `status` | active / on-hold / closed (🔬) | 🔬      | Exact tokens unconfirmed | [INFERRED] 🔬 |

> No other enums could be confirmed without a live spec dump. Do not invent enum tokens. 🔬

---

_Generated from the investigation questionnaire, Phase 3._
