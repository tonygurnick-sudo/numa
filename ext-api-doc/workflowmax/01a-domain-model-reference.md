---
api_name: WorkflowMax (by Xero)
api_slug: workflowmax
doc: domain model reference (companion to 01-llm-api-rules.md)
call_surface: HTTP via `numa integrations request`; legacy `/{resource}.api/{action}` paths reused on the OAuth2 tier; modern `/{resource}/{UUID}`
field_casing: PascalCase
id_format: dual — UUID (link key) + human ID (J000123 / INV-001234, display only)
source: synchub data model, Airbyte stream list, legacy WorkflowMax XML schemas, community Node SDK (indemandly/workflowmax)
confidence: every field [INFERRED] (names/casing UNCONFIRMED until a live call) unless tagged [DOCUMENTED]
---

# WorkflowMax — Domain Model Reference

> Field-table columns: Req=required on create, W=writable. Read-only (W=no): `UUID`,`ID`,`WhenCreated`,`WhenModified`, computed amounts. See Field Formats for value patterns. Example UUIDs/strings carrying real info appear inline in Description.

## Entity Catalog

### Job — `/job.api/*` (`list`,`current`,`get`,`add`,`update`) · modern `/job/{UUID}`

The central work container (tasks, time, costs, budget, lifecycle state) — most user questions revolve around it. CRUD: Create/Read/Update; no hard delete (jobs are completed/cancelled).

| Field               | Type     | Req | W       | Description                          |
| ------------------- | -------- | --- | ------- | ------------------------------------ |
| `UUID`              | uuid     | n/a | no      | stable job id (link key)             |
| `ID`                | string   | n/a | no      | human job number (`J000123`)         |
| `Name`              | string   | yes | yes     | job name                             |
| `Description`       | string   | no  | yes     | job description                      |
| `ClientUUID`        | uuid     | yes | yes     | owning client                        |
| `State`             | enum     | n/a | partial | lifecycle state (see State Machines) |
| `StartDate`         | date     | no  | yes     | job start                            |
| `DueDate`           | date     | no  | yes     | job due date                         |
| `Budget`            | decimal  | no  | yes     | job budget (`12000.00`)              |
| `ManagerUUID`       | uuid     | no  | yes     | job manager (staff)                  |
| `PartnerUUID`       | uuid     | no  | yes     | partner/owner (staff)                |
| `ApprovedQuoteUUID` | uuid     | no  | no      | quote this job came from             |
| `WhenCreated`       | datetime | n/a | no      | creation timestamp                   |
| `WhenModified`      | datetime | n/a | no      | last-modified (change detect)        |

Rel: Client N:1 (`ClientUUID`, every job has one) · JobTask 1:N (`Tasks[]` in detail) · Time 1:N (`Job`/`JobUUID` on entries) · JobCost 1:N (`Costs[]` in detail) · Staff N:M (JobAssignee link) · Invoice 1:N.

### Client (ClientDetails) — `/client.api/*` (`list`,`get`,`add`,`update`,`archive`,`delete`) · modern `/client/{UUID}`

A customer org/person; parent of contacts, jobs, invoices. CRUD: Create/Read/Update/Archive/Delete [DOCUMENTED via Node SDK] — Archive + Delete are **destructive, gate behind explicit confirmation**.

| Field                                 | Type     | Req | W   | Description                               |
| ------------------------------------- | -------- | --- | --- | ----------------------------------------- |
| `UUID`                                | uuid     | n/a | no  | client id                                 |
| `Name`                                | string   | yes | yes | client name                               |
| `Email`                               | string   | no  | yes | primary email                             |
| `Phone`                               | string   | no  | yes | phone                                     |
| `Address`/`City`/`PostCode`/`Country` | string   | no  | yes | postal address parts                      |
| `AccountManagerUUID`                  | uuid     | no  | yes | account manager (staff)                   |
| `JobManagerUUID`                      | uuid     | no  | yes | default job manager                       |
| `TypePaymentTerm`                     | string   | no  | yes | payment terms (e.g. `20th of next month`) |
| `WhenModified`                        | datetime | n/a | no  | change-detection field                    |

Rel: Contact 1:N · Job 1:N · Invoice 1:N.

### Contact — managed under the client resource (`/client.api/contact*` style); links via `ClientContact`

A person at a client org. CRUD: Create/Read/Update/Delete (via the client).

| Field        | Type   | Req | W   |
| ------------ | ------ | --- | --- |
| `UUID`       | uuid   | n/a | no  |
| `Name`       | string | yes | yes |
| `Email`      | string | no  | yes |
| `Phone`      | string | no  | yes |
| `Mobile`     | string | no  | yes |
| `Position`   | string | no  | yes |
| `Salutation` | string | no  | yes |
| `IsPrimary`  | bool   | no  | yes |

Rel: Client N:1 (via `ClientContact`).

### Invoice — `/invoice.api/*` (`list`,`current`,`get`) · modern `/invoice/{UUID}`

A bill against a client/job; amounts roll up from line collections. CRUD: Read confirmed; Create (raise from job/time) likely but **financial — confirm with user**.

| Field            | Type    | W       | Description                         |
| ---------------- | ------- | ------- | ----------------------------------- |
| `UUID`           | uuid    | no      | invoice id                          |
| `ID`             | string  | no      | human invoice number (`INV-001234`) |
| `Type`           | string  | partial | invoice type (e.g. `Standard`)      |
| `Status`         | enum    | partial | Draft/Approved/Paid (approx)        |
| `Date`           | date    | partial | invoice date                        |
| `DueDate`        | date    | partial | due date                            |
| `Amount`         | decimal | no      | total (computed from lines)         |
| `AmountTax`      | decimal | no      | tax (computed)                      |
| `AmountPaid`     | decimal | no      | paid to date (computed)             |
| `ClientUUID`     | uuid    | no      | billed client                       |
| `InvoiceTask`    | array   | partial | task line items                     |
| `InvoiceCost`    | array   | partial | cost line items                     |
| `InvoicePayment` | array   | no      | payments applied                    |

Rel: Client N:1 · Job N:1 (the job billed) · Time 1:N (entries get `InvoiceUUID` set once billed).

### Time (Time Entry / Timesheet) — `/time.api/*` (`list`,`get`,`add`) · modern `/time/{UUID}`

A unit of time logged by a staff member against a job (usually a task). CRUD: Create/Read; Update/Delete uncertain.

| Field               | Type        | Req     | W   | Description                                     |
| ------------------- | ----------- | ------- | --- | ----------------------------------------------- |
| `UUID`              | uuid        | n/a     | no  | time-entry id                                   |
| `Job`/`JobUUID`     | uuid/string | yes     | yes | job logged against                              |
| `Staff`/`StaffUUID` | uuid        | yes     | yes | staff who logged it                             |
| `Task`/`TaskUUID`   | uuid        | usually | yes | task within the job                             |
| `Date`              | date        | yes     | yes | date worked (`YYYY-MM-DD`)                      |
| `Minutes`           | int         | yes     | yes | duration in minutes (display as `Minutes/60` h) |
| `Billable`          | bool        | no      | yes | billable flag (`Yes`/`No`)                      |
| `Note`              | string      | no      | yes | free-text note                                  |
| `InvoiceUUID`       | uuid        | n/a     | no  | set (non-null) once invoiced                    |

Rel: Job N:1 · Staff N:1 · Task N:1 · Invoice N:1 (once billed).

### Staff — `/staff.api/list` (+ `get`) · modern `/staff`

A user/employee in the org. Reference data — best connectivity check. CRUD: Read only (writes not exposed). Fields: `UUID`, `Name`, `Email`, `Phone`, `Mobile`, `PayrollCode` (e.g. `PR-014`) — all read-only.

### Secondary entities (lower priority, read-mostly)

| Entity          | Path                   | Key fields                                              | Notes                                                                            |
| --------------- | ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Quote           | `/quote.api/*`         | `UUID`,`ID`,`Type`,`State`,`Date`,`Amount`,`ClientUUID` | wins convert to a Job                                                            |
| Purchase Order  | `/purchaseorder.api/*` | `UUID`,`ID`,`SupplierUUID`,`JobUUID`,`Amount`           | `purchaseorderlist` stream                                                       |
| Supplier        | `/supplier.api/*`      | `UUID`,`Name`,`Email`,`Phone`                           | `supplierlist` stream                                                            |
| Lead            | `/lead.api/*`          | `UUID`,`Name`,`Category`,`Date`,`ClientUUID`            | `list`/`current`/`get`/`add`/`categories`, `from`/`to` [DOCUMENTED via Node SDK] |
| Cost / JobCost  | `/cost.api/*`          | `UUID`,`JobID`,`Description`,`Amount`,`Date`            | `costlist` stream                                                                |
| Task / JobTask  | sub-resource of Job    | `UUID`,`Name`,`EstimatedMinutes`,`JobUUID`              | `tasklist`/`job_tasks` streams                                                   |
| Category        | `/categories.api/list` | `UUID`,`Name`                                           | reference data, cacheable [DOCUMENTED]                                           |
| Client Group    | `/clientgroup*`        | `UUID`,`Name`                                           | `clientgrouplist` stream                                                         |
| Client Document | under client           | `UUID`,`Name`,`FileName`                                | upload/download support UNKNOWN                                                  |

## Entity Relationships

```
Client 1:N → Contact, Job, Invoice
Job 1:N → JobTask, Time, JobCost   Job N:M → Staff (assignee)   Job 1:N → Invoice
Invoice 1:N → InvoiceTask/InvoiceCost/InvoicePayment lines
Time N:1 → Staff (logger)
Quote 1:1 (on win) → Job    Supplier 1:N → PurchaseOrder N:1 → Job    Lead (convert) → Client/Job
```

[INFERRED from synchub relationship tables: `ClientContact`, `JobAssignee`, `JobTaskAssignee`, `Time.InvoiceUUID`.]

## State Machines

### Job Lifecycle

`[Planned/Quote] --start--> [In Progress] --complete--> [Completed] --invoice--> [Invoiced]` · any `--cancel--> [Cancelled]`.

| From        | Action        | To          | Reversible | Side effects                         |
| ----------- | ------------- | ----------- | ---------- | ------------------------------------ |
| Planned     | start         | In Progress | yes        | time/costs can now be logged         |
| In Progress | complete      | Completed   | yes        | often a precondition for invoicing   |
| Completed   | raise invoice | Invoiced    | partial    | billable time/costs flagged invoiced |
| any         | cancel        | Cancelled   | no         | stops further work                   |

Per-state capabilities: Planned — no time, no invoice (set up tasks/budget first) · In Progress — time yes, invoice partial (normal working state) · Completed — time limited, invoice yes (ready to bill) · Invoiced — none (historical) · Cancelled — none (terminal).

> Exact `State` enum strings/casing MUST be read from a live `job.api/list`/`/job` response. `job.api/current` returns only currently-active jobs — exploit this current-vs-historical split instead of a status filter.

### Invoice Status (approx)

`[Draft] --approve--> [Approved] --payment--> [Paid]`. Confirm exact `Status` values live.

## Business Rules

- **Dependency order:** Client before Job; Job (+usually Task) before Time/Cost. Time entries must reference existing `StaffUUID`, `JobUUID`/`Job`, usually a `TaskUUID`.
- **References use the target's `UUID`, never the human `ID`.**
- **Dates:** `from`/`to` list filters use compact `YYYYMMDD`; date fields in bodies use `YYYY-MM-DD`.
- **Cascades:** archiving/deleting a Client affects its Jobs; invoicing flips affected time entries' `InvoiceUUID` from null to the invoice UUID.
- **Uniqueness:** Job `ID` (`J000123`) and Invoice `ID` (`INV-001234`) are unique within the org.
- **Computed/read-only:** `UUID`,`ID`,`WhenCreated`,`WhenModified` server-managed; invoice `Amount`/`AmountTax`/`AmountPaid` roll up from lines — never write them.
- **Access:** connecting staff member must have "Authorise 3rd Party Full Access" on their staff record or the API 403s. [DOCUMENTED]

## Field Formats

| Format        | Pattern                                      | Example                                | Notes                                             |
| ------------- | -------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Date (body)   | `YYYY-MM-DD`                                 | `2026-05-01`                           | modern field values                               |
| Date (filter) | `YYYYMMDD`                                   | `20260501`                             | legacy `from`/`to` [DOCUMENTED]                   |
| DateTime      | ISO-8601                                     | `2026-05-01T09:30:00Z`                 | `WhenCreated`/`WhenModified`                      |
| Currency      | decimal string, org currency, 2dp, no symbol | `12000.00`                             | —                                                 |
| ID (link)     | UUID v4                                      | `e3b0c442-98fc-1c14-9afb-f4c8996fb1a2` | use for relationships [DOCUMENTED]                |
| ID (human)    | prefixed number                              | `J000123` / `INV-001234`               | display only, not a relationship key [DOCUMENTED] |
| Boolean       | `Yes`/`No` (legacy) or `true`/`false`        | `Yes`                                  | confirm representation live                       |

## Enums (approx — confirm live)

| Entity  | Field      | Allowed values                                           |
| ------- | ---------- | -------------------------------------------------------- |
| Job     | `State`    | Planned · In Progress · Completed · Cancelled · Invoiced |
| Invoice | `Status`   | Draft · Approved · Paid                                  |
| Time    | `Billable` | Yes · No (or true/false)                                 |
