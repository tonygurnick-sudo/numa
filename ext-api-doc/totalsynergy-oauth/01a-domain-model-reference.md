---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
companion_to: 01-llm-api-rules.md
scope: entity catalog, relationships, business rules
same_domain_as: totalsynergy-api (only credential acquisition differs — keep both doc sets consistent)
confidence: every field table is [INFERRED] / 🔬 DISCOVER unless tagged [DOCUMENTED]. Synergy serialises typed values (dates) as JSON strings, but exact key names/casing/required-flags are unconfirmed (JS-rendered Swagger SPA). Dump OpenAPI from a live tenant (`/swagger/ui/index`, `/swagger/v4`) before trusting writes.
---

# Total Synergy (OAuth) — Domain Model Reference

Resources are organisation-scoped: most paths are `Organisation/{Slug}/{Resource}`.

## Entities

### Project — `Organisation/{Slug}/Projects` [DOCUMENTED]

Central job/engagement record; stages, tasks, timesheets, transactions/invoices all hang off it. CRUD: GET list/single (via `criteria.Id`) [DOCUMENTED]; create/update [INFERRED] 🔬.

| Field           | Type         | Required     | Writable | Description                           | Example                      |
| --------------- | ------------ | ------------ | -------- | ------------------------------------- | ---------------------------- |
| `id`            | string/int   | —            | no       | Project id (query via `criteria.Id`)  | `"10042"`                    |
| `name`          | string       | yes (create) | yes      | Project name                          | `"Riverside Bridge Upgrade"` |
| `projectNumber` | string       | no           | maybe 🔬 | Human-facing job number               | `"P-2026-031"`               |
| `status`        | enum/string  | no           | yes 🔬   | active / on-hold / closed (tokens 🔬) | `"Active"`                   |
| `clientId`      | string/int   | no           | yes      | FK → Contact (the client)             | `"551"`                      |
| `createdDate`   | string (ISO) | —            | no       | Date serialised as string             | `"2026-05-01"`               |

### Contact — `Organisation/{Slug}/Contacts` [DOCUMENTED]

People/orgs in the address book — clients and other parties. CRUD: GET list/single (via `criteria.Id`) [DOCUMENTED]; create/update [INFERRED] 🔬. All fields beyond `id` are [INFERRED] 🔬.

| Field   | Type       | Required | Writable | Description   | Example               |
| ------- | ---------- | -------- | -------- | ------------- | --------------------- |
| `id`    | string/int | —        | no       | Contact id    | `"551"`               |
| `name`  | string     | yes 🔬   | yes 🔬   | Display name  | `"Acme City Council"` |
| `email` | string     | no       | yes 🔬   | Primary email | `"info@acme.gov"`     |
| `phone` | string     | no       | yes 🔬   | Phone         | `"+61 2 9000 0000"`   |

### Staff — `Organisation/{Slug}/Staff` [DOCUMENTED]

Internal employees/users; referenced by `staffId` on timesheet entries. CRUD: GET read. Resolve a valid `staffId` here before creating a timesheet entry. Fields beyond `id` 🔬.

| Field  | Type       | Required | Writable | Description | Example        |
| ------ | ---------- | -------- | -------- | ----------- | -------------- |
| `id`   | string/int | —        | no       | Staff id    | `"88"`         |
| `name` | string     | —        | no 🔬    | Staff name  | `"Sam Taylor"` |

### Organisation — `Organisation`, `Organisation/MySlug` [DOCUMENTED]

Tenant metadata; resolves the `{Slug}` used in every other path. **Resolve first.** CRUD: GET read. Exact path (`/Organisation` list vs `/Organisation/MySlug`) + response shape 🔬.

| Field  | Type   | Writable | Description                  | Example              |
| ------ | ------ | -------- | ---------------------------- | -------------------- |
| `slug` | string | no       | Org identifier used in paths | `"acme-eng"`         |
| `name` | string | no       | Org display name             | `"Acme Engineering"` |

### Transaction (invoices + timesheet entries) — `Organisation/{Slug}/Transactions` [DOCUMENTED]

Synergy's billing/financial surface. Invoices and timesheet entries both written here via the rate-limited Transactions API (50/day standard, 20k/day Premium). CRUD: GET list [INFERRED] 🔬; POST create [DOCUMENTED]. Request shape, units/hours field name, and invoice-vs-timesheet discriminator all [INFERRED] 🔬 — confirm before writing.

| Field           | Type    | Required   | Writable | Description                        | Example    |
| --------------- | ------- | ---------- | -------- | ---------------------------------- | ---------- |
| `timesheetId`   | string  | —          | no       | Server-set id returned on create   | `"990123"` |
| `staffId`       | string  | yes 🔬     | yes      | FK → Staff (who logged time)       | `"88"`     |
| `projectId`     | string  | yes 🔬     | yes      | FK → Project                       | `"10042"`  |
| `stageId`       | string  | usually 🔬 | yes      | FK → Stage                         | `"3"`      |
| `taskId`        | string  | usually 🔬 | yes      | FK → Task                          | `"17"`     |
| `fromDateAsInt` | int     | yes 🔬     | yes      | Integer-encoded date (`yyyymmdd`)  | `20260526` |
| `toDateAsInt`   | int     | yes 🔬     | yes      | Integer-encoded date (`yyyymmdd`)  | `20260526` |
| `units`         | decimal | yes 🔬     | yes      | Hours/units worked (field name 🔬) | `7.5`      |

### Stage / Task / Timer / Timesheet read (summary)

| Entity         | Resource (under `Organisation/{Slug}/`)   | Purpose                                 | Confidence    |
| -------------- | ----------------------------------------- | --------------------------------------- | ------------- |
| Stage          | `Projects/{id}/Stages`                    | Project breakdown; `stageId` on entries | [INFERRED] 🔬 |
| Task           | `Projects/{id}/Tasks`                     | Under stages; `taskId` on entries       | [INFERRED] 🔬 |
| Timer          | `Timers`                                  | Running/stored timers                   | [DOCUMENTED]  |
| Timesheet read | `Timesheet/Week`, `Timesheet/Leaderboard` | Weekly entries + aggregate metric       | [DOCUMENTED]  |

> Timesheet entries are **read** via `Timesheet/Week` but **created** via Transactions — not symmetrical.

## Relationships

`Organisation ({Slug}) 1→N Project 1→N Stage 1→N Task`. `Project N→1 Contact` (client, via `clientId`). `Staff` logs time → `Transactions` (timesheet entry / invoice) references `staffId`, `projectId`, `stageId`, `taskId`. Stage/Task sub-resource paths 🔬.

## State machine — Project lifecycle (INFERRED 🔬)

`[Active] —hold→ [On Hold] —resume→ [Active] —close→ [Closed/Archived]`. Inferred from the product UI; exact enum tokens + allowed transitions are [UNKNOWN] 🔬 — read from a live spec/tenant before programmatic status changes.

## Business rules

- A Project must exist before logging timesheets/transactions against it [INFERRED] 🔬.
- A timesheet entry must reference a valid `staffId` + `projectId` (usually `stageId`/`taskId`) — resolve via Staff/Projects/Stages/Tasks reads first [INFERRED] 🔬.
- Resources are tenant-isolated by `{Slug}` — cannot read across orgs with one token [DOCUMENTED].
- Dates serialised/accepted as strings; some endpoints use integer-encoded dates (`fromDateAsInt`/`toDateAsInt`, `yyyymmdd`) [DOCUMENTED string / INFERRED int-date 🔬].
- Timesheet/invoice creation goes through Transactions (own tighter daily budget: 50/day std, 20k/day Premium) — treat writes as scarce [DOCUMENTED].
- `id` / `timesheetId` are server-set on create [INFERRED] 🔬.

## Field formats

| Format   | Pattern                             | Example        | Notes                                         | Confidence    |
| -------- | ----------------------------------- | -------------- | --------------------------------------------- | ------------- |
| Date     | ISO-8601 string (serialised)        | `"2026-05-29"` | dates delivered as strings                    | [DOCUMENTED]  |
| Int-date | `yyyymmdd` integer (some endpoints) | `20260529`     | `fromDateAsInt`/`toDateAsInt`                 | [INFERRED] 🔬 |
| ID       | string or integer per resource      | `"10042"`      | query via `criteria.Id`; type per resource 🔬 | [INFERRED] 🔬 |
| Currency | decimal number                      | `1500.00`      | on Transactions/invoices                      | [INFERRED] 🔬 |
| Slug     | org identifier string in path       | `acme-eng`     | `Organisation/{Slug}/…`                       | [DOCUMENTED]  |

## Enums

| Entity  | Field    | Allowed values                 | Default | Confidence    |
| ------- | -------- | ------------------------------ | ------- | ------------- |
| Project | `status` | active / on-hold / closed (🔬) | 🔬      | [INFERRED] 🔬 |

> No other enums confirmable without a live spec dump. Do not invent enum tokens. 🔬
