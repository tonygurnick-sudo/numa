---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
companion_to: 01-llm-api-rules.md
sibling: totalsynergy-oauth — identical data model (same product); only credential differs. Reconcile if they diverge.
confidence: entity names + resource paths are [DOCUMENTED]/[INFERRED] from KB + UI. EVERY field-level schema is [INFERRED] (JS-rendered Swagger SPA, NO live call made). Assume [INFERRED] 🔬 unless tagged [DOCUMENTED]. 🔬 = confirm on a live tenant by dumping /swagger/ui/index (v2) + /swagger/v4 with a static key before trusting write bodies or field casing.
---

# Total Synergy (API Key) — Domain Model Reference

Full entity catalog, relationships, state machines, business rules.

## Tenancy & path model

Every resource: `https://api.totalsynergy.com/api/v2/Organisation/{Slug}/{Resource}`.

- `{Slug}` is a **path value**, not the hostname. The registry `instance_url` (`https://yourcompany.totalsynergy.com`) is NOT the API base — always call `api.totalsynergy.com`. [DOCUMENTED] 🚩
- Resolve `{Slug}` once with `GET /api/v2/Organisation` or `…/Organisation/MySlug` (access-token header), then reuse. [DOCUMENTED] 🔬 (exact shape)
- A static key is scoped to **one org** and to the **issuing user's role** — no cross-org reads, no data the user can't see in the UI. [DOCUMENTED]

## Entity catalog

### Organisation

Path: `/Organisation`, `/Organisation/MySlug`. Tenant metadata; resolves the `{Slug}` used in every other path. CRUD: Read.

| Field | Type   | Writable | Description                       | Example              |
| ----- | ------ | -------- | --------------------------------- | -------------------- |
| slug  | string | no       | Org identifier used in every path | `"acme-eng"`         |
| name  | string | no       | Display name                      | `"Acme Engineering"` |

> Shape 🔬 — may return a list of accessible orgs, not a single object.

Relationships (all 1:N): Project `…/{Slug}/Projects`, Contact `…/{Slug}/Contacts`, Staff `…/{Slug}/Staff`, Transaction `…/{Slug}/Transactions`.

### Project

Path: `/Organisation/{Slug}/Projects`. Central job/engagement record — the A&E "job". Paged list → `{totalItems, items[]}`. CRUD: Read (+ likely write 🔬).

| Field         | Type        | Required     | Writable | Description                            | Example                      |
| ------------- | ----------- | ------------ | -------- | -------------------------------------- | ---------------------------- |
| id            | string/int  | —            | no       | Unique id; queryable via `criteria.Id` | `"10042"`                    |
| name          | string      | yes (create) | yes 🔬   | Project name                           | `"Riverside Bridge Upgrade"` |
| projectNumber | string      | —            | maybe 🔬 | Human-facing job number                | `"P-2026-014"`               |
| status        | enum/string | —            | yes 🔬   | active / on-hold / closed 🔬           | `"Active"`                   |
| clientId      | string/int  | —            | yes 🔬   | FK → Contact (the client)              | `"551"`                      |
| createdDate   | string      | —            | no       | Date serialised as a string            | `"2026-01-15"`               |

Relationships: Contact(client) N:1 via `clientId`; Stage 1:N `…/Projects/{id}/Stages` 🔬; Task 1:N `…/Projects/{id}/Tasks` 🔬; Transaction 1:N via `projectId` on timesheet/invoice writes.

### Stage

Path: `/Organisation/{Slug}/Projects/{id}/Stages` 🔬. Project breakdown; referenced by `stageId` on timesheet entries. CRUD: Read 🔬. Entire entity 🔬.

| Field     | Type       | Writable | Description    | Example    |
| --------- | ---------- | -------- | -------------- | ---------- |
| id        | string/int | no       | Stage id       | `"3"`      |
| projectId | string/int | no       | Parent project | `"10042"`  |
| name      | string     | no       | Stage name     | `"Design"` |

### Task

Path: `/Organisation/{Slug}/Projects/{id}/Tasks` 🔬. Work item under a project/stage; referenced by `taskId` on timesheet entries. CRUD: Read 🔬. Entire entity 🔬.

| Field   | Type       | Writable | Description  | Example          |
| ------- | ---------- | -------- | ------------ | ---------------- |
| id      | string/int | no       | Task id      | `"17"`           |
| stageId | string/int | no       | Parent stage | `"3"`            |
| name    | string     | no       | Task name    | `"Concept plan"` |

### Contact

Path: `/Organisation/{Slug}/Contacts`. Address book (clients, consultants, suppliers); searchable by `criteria.Id`. CRUD: Read (+ likely write 🔬).

| Field | Type        | Required | Writable | Description                | Example                |
| ----- | ----------- | -------- | -------- | -------------------------- | ---------------------- |
| id    | string/int  | —        | no       | Unique id                  | `"551"`                |
| name  | string      | yes 🔬   | yes 🔬   | Contact / company name     | `"Riverside Council"`  |
| email | string      | —        | yes 🔬   | Primary email              | `"info@riverside.gov"` |
| type  | enum/string | —        | 🔬       | person vs. organisation 🔬 | `"Organisation"`       |

Relationship: Project 1:N via `clientId` (a client → projects).

### Staff

Path: `/Organisation/{Slug}/Staff`. Internal employees/users; referenced by `staffId` on timesheet entries — **list this first** to resolve a valid `staffId` before any timesheet write. CRUD: Read.

| Field | Type       | Writable | Description | Example                 |
| ----- | ---------- | -------- | ----------- | ----------------------- |
| id    | string/int | no       | Staff id    | `"88"`                  |
| name  | string     | no       | Staff name  | `"Jordan Lee"`          |
| email | string     | no       | Email       | `"jordan@acme-eng.com"` |

### Transaction

Path: `/Organisation/{Slug}/Transactions`. Synergy's billing/financial surface — **invoices live here, and timesheet entries are created here.** This is the **rate-limited "Transactions API"** (50/day standard, 20k/day Premium). CRUD: Read + Create.

| Field         | Type           | Required (create) | Writable | Description                  | Example    |
| ------------- | -------------- | ----------------- | -------- | ---------------------------- | ---------- |
| staffId       | string/int     | yes (timesheet)   | yes      | FK → Staff                   | `"88"`     |
| projectId     | string/int     | yes (timesheet)   | yes      | FK → Project                 | `"10042"`  |
| stageId       | string/int     | usually 🔬        | yes      | FK → Stage                   | `"3"`      |
| taskId        | string/int     | usually 🔬        | yes      | FK → Task                    | `"17"`     |
| fromDateAsInt | int (yyyymmdd) | yes 🔬            | yes      | Start date as integer        | `20260526` |
| toDateAsInt   | int (yyyymmdd) | yes 🔬            | yes      | End date as integer          | `20260526` |
| units         | decimal        | yes 🔬            | yes      | Hours/units (field name 🔬)  | `7.5`      |
| timesheetId   | string/int     | —                 | no       | Returned id of created entry | `"990123"` |

> Body field set [INFERRED] from KB naming 🔬. The exact create path under Transactions, the units/hours field name, the invoice-vs-timesheet discriminator, and the response envelope are **🔬 DISCOVER**.

Relationships: Staff N:1 `staffId` (who logged time); Project N:1 `projectId`; Stage/Task N:1 `stageId`/`taskId`.

### Invoice (a Transaction type)

Path: `/Organisation/{Slug}/Transactions` (modelled as a Transaction) 🔬. Customer invoices. How invoices are distinguished from timesheet entries on this endpoint is a key discovery item. CRUD: Read (+ create) 🔬. Entire entity 🔬.

| Field     | Type       | Writable | Description    | Example        |
| --------- | ---------- | -------- | -------------- | -------------- |
| id        | string/int | no       | Invoice id     | `"INV-77"`     |
| projectId | string/int | 🔬       | Project billed | `"10042"`      |
| amount    | decimal    | 🔬       | Invoice amount | `1500.00`      |
| date      | string     | 🔬       | Invoice date   | `"2026-05-29"` |

### Timesheet entry

Created via `POST …/Transactions`; read via `…/Timesheet/Week`. A staff member's logged time against a project/stage/task. CRUD: Read + Create. See **Transaction** for the create body. Read shape via `Timesheet/Week` is 🔬 (query params: week-start, staff).

### Timer

Path: `/Organisation/{Slug}/Timers`. Running/stored timers (on the portal landing). CRUD: Read + write 🔬. Fields 🔬.

### Leaderboard

Path: `/Organisation/{Slug}/Timesheet/Leaderboard`. Aggregate timesheet metric across staff. CRUD: Read. Fields 🔬.

## Entity relationship diagram

```
Organisation({Slug}) ─1:N─▶ Project ─1:N─▶ Stage ─1:N─▶ Task
                              │ N:1                        ▲
        ┌─1:N─▶ Staff         ▼                            │ referenced by stageId/taskId
        │       │      Contact(client) ◀── clientId        │
        │       │ logs time                                │
        └────────▶ Transactions API (rate-limited 50/day std)
                       └─creates─▶ Timesheet entry / Invoice (staffId, projectId, stageId, taskId, …)
```

## State machines

### Project lifecycle (INFERRED 🔬)

`[Active] ──hold──> [On Hold] ──resume──> [Active] ──close──> [Closed/Archived]`

| From    | Action    | To              | Reversible? | Side effects |
| ------- | --------- | --------------- | ----------- | ------------ |
| Active  | hold 🔬   | On Hold         | Yes 🔬      | 🔬           |
| On Hold | resume 🔬 | Active          | —           | 🔬           |
| Active  | close 🔬  | Closed/Archived | No 🔬       | 🔬           |

> Lifecycle [INFERRED] from UI. Exact enum values, allowed transitions, and whether status is API-writable are [UNKNOWN] 🔬. Per-state capabilities unknown 🔬 — whether closed/archived projects reject timesheet writes is undocumented.

## Business rules

- **Resolve `{Slug}` before any other call** (`GET …/Organisation` / `…/Organisation/MySlug`) — every data path needs it. [DOCUMENTED]
- A **timesheet entry** must reference a valid `staffId` + `projectId` (and usually `stageId`/`taskId`) — these must exist first; list Staff/Projects to resolve ids. [INFERRED] 🔬
- Timesheet/invoice creation goes through the **Transactions API** (its own tighter budget: 50/day std, 20k/day Premium). [DOCUMENTED]
- Resources are **tenant-isolated by `{Slug}`** — one key cannot read across orgs; data the user can't see in the UI is invisible through their key. [DOCUMENTED]
- Dates serialise/accept as strings; some endpoints use integer dates `yyyymmdd` (`fromDateAsInt`/`toDateAsInt`). [DOCUMENTED/INFERRED] 🔬
- **No cascading effects / no bulk ops** — Transaction writes are one-at-a-time. [INFERRED]
- Uniqueness: `{Slug}` unique per org [DOCUMENTED]; other constraints (e.g. project number) [UNKNOWN] 🔬.
- Read-only/computed: `id`, `createdDate` server-set [INFERRED] 🔬; created Transaction returns server-assigned `timesheetId` [DOCUMENTED].

## Field format reference

| Format   | Pattern                             | Example         | Notes                                                            | Confidence    |
| -------- | ----------------------------------- | --------------- | ---------------------------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)        | `"2026-05-29"`  | "dates are serialized and delivered in string format"            | [DOCUMENTED]  |
| Int-date | `yyyymmdd` integer (some endpoints) | `20260529`      | `fromDateAsInt`/`toDateAsInt` on timesheet/leave inputs          | [INFERRED] 🔬 |
| ID       | string or integer per resource      | `"12345"`       | Queryable via `criteria.Id`; exact type per resource unconfirmed | [INFERRED] 🔬 |
| Currency | decimal number                      | `1500.00`       | On Transactions/invoices                                         | [INFERRED] 🔬 |
| Slug     | org identifier string in path       | `acme-eng`      | `…/Organisation/{Slug}/…`                                        | [DOCUMENTED]  |
| API key  | opaque string (the access token)    | `<long string>` | Pasted into `api_key`; sent as `access-token` header             | [DOCUMENTED]  |

## Enum value reference

| Entity  | Field  | Allowed values                   | Notes                                                                   |
| ------- | ------ | -------------------------------- | ----------------------------------------------------------------------- |
| Project | status | `Active`, `On Hold`, `Closed` 🔬 | [INFERRED] from UI — confirm on spec before filtering/writing by status |
