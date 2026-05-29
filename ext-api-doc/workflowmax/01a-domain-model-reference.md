---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# WorkflowMax (by Xero) -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Full entity catalog, relationships, state machines,
> and business rules the workspace agent references when working with WorkflowMax data.
>
> **Source:** synchub data model, Airbyte stream list, legacy WorkflowMax XML schemas,
> community Node SDK (`indemandly/workflowmax`). **All fields [INFERRED] unless tagged
> otherwise — field names and casing are UNCONFIRMED until a live call is captured.**
> Both `UUID` (stable, use for links) and `ID` (human number) exist on most entities.

---

## Entity Catalog

### Job

**Resource path:** legacy `/job.api/*` (`list`, `current`, `get`, `add`, `update`) · modern `/job/{UUID}`
**Description:** The central work container — a piece of client work with tasks, time, costs, a budget, and a lifecycle state. This is the entity most user questions revolve around.
**CRUD:** Create / Read / Update. No hard delete — jobs are completed/cancelled, not deleted. [INFERRED]

| Field               | Type     | Required | Writable | Description                           | Example                                  |
| ------------------- | -------- | -------- | -------- | ------------------------------------- | ---------------------------------------- |
| `UUID`              | uuid     | n/a      | no       | Stable job identifier (use for links) | `"e3b0c442-98fc-1c14-9afb-f4c8996fb1a2"` |
| `ID`                | string   | n/a      | no       | Human job number                      | `"J000123"`                              |
| `Name`              | string   | yes      | yes      | Job name                              | `"Website Redesign"`                     |
| `Description`       | string   | no       | yes      | Job description                       | `"Phase 1 discovery"`                    |
| `ClientUUID`        | uuid     | yes      | yes      | Owning client                         | `"a1b2c3d4-...-5555"`                    |
| `State`             | enum     | n/a      | partial  | Lifecycle state (see State Machines)  | `"In Progress"`                          |
| `StartDate`         | date     | no       | yes      | Job start                             | `"2026-05-01"`                           |
| `DueDate`           | date     | no       | yes      | Job due date                          | `"2026-06-30"`                           |
| `Budget`            | decimal  | no       | yes      | Job budget                            | `"12000.00"`                             |
| `ManagerUUID`       | uuid     | no       | yes      | Job manager (staff)                   | `"c3d4...-aaaa"`                         |
| `PartnerUUID`       | uuid     | no       | yes      | Partner/owner (staff)                 | `"d5e6...-bbbb"`                         |
| `ApprovedQuoteUUID` | uuid     | no       | no       | Quote this job was created from       | `"f7a8...-cccc"`                         |
| `WhenCreated`       | datetime | n/a      | no       | Creation timestamp                    | `"2026-05-01T09:30:00Z"`                 |
| `WhenModified`      | datetime | n/a      | no       | Last-modified (use for change detect) | `"2026-05-27T14:02:11Z"`                 |

**Relationships:**

| Related Entity | Type | Expression                         | Notes                         |
| -------------- | ---- | ---------------------------------- | ----------------------------- |
| Client         | N:1  | `ClientUUID`                       | Every job belongs to a client |
| JobTask        | 1:N  | sub-resource / `Tasks[]` in detail | Tasks within a job            |
| Time           | 1:N  | `Job`/`JobUUID` on time entries    | Time logged against the job   |
| JobCost        | 1:N  | `JobID` / `Costs[]` in detail      | Costs / disbursements         |
| Staff          | N:M  | JobAssignee link                   | Assigned staff                |
| Invoice        | 1:N  | invoice references the job         | Invoices raised for the job   |

---

### Client (ClientDetails)

**Resource path:** legacy `/client.api/*` (`list`, `get`, `add`, `update`, `archive`, `delete`) · modern `/client/{UUID}`
**Description:** A customer organisation or person you do work for. Parent of contacts, jobs, and invoices.
**CRUD:** Create / Read / Update / Archive / Delete. [DOCUMENTED via community Node SDK method set] — Archive and Delete are **destructive**, gate behind explicit confirmation.

| Field                                 | Type     | Required | Writable | Description             | Example                  |
| ------------------------------------- | -------- | -------- | -------- | ----------------------- | ------------------------ |
| `UUID`                                | uuid     | n/a      | no       | Client identifier       | `"a1b2c3d4-...-5555"`    |
| `Name`                                | string   | yes      | yes      | Client name             | `"Acme Ltd"`             |
| `Email`                               | string   | no       | yes      | Primary email           | `"accounts@acme.co.nz"`  |
| `Phone`                               | string   | no       | yes      | Phone                   | `"+64 9 123 4567"`       |
| `Address`/`City`/`PostCode`/`Country` | string   | no       | yes      | Postal address parts    | `"Auckland"` / `"1010"`  |
| `AccountManagerUUID`                  | uuid     | no       | yes      | Account manager (staff) | `"c3d4...-aaaa"`         |
| `JobManagerUUID`                      | uuid     | no       | yes      | Default job manager     | `"d5e6...-bbbb"`         |
| `TypePaymentTerm`                     | string   | no       | yes      | Payment terms           | `"20th of next month"`   |
| `WhenModified`                        | datetime | n/a      | no       | Change-detection field  | `"2026-05-20T10:00:00Z"` |

**Relationships:** Contact (1:N), Job (1:N), Invoice (1:N).

---

### Contact

**Resource path:** managed under the client resource (`/client.api/contact*` style); contacts link to clients via `ClientContact`.
**Description:** A person at a client organisation.
**CRUD:** Create / Read / Update / Delete (via the client). [INFERRED]

| Field        | Type   | Required | Writable | Description          | Example               |
| ------------ | ------ | -------- | -------- | -------------------- | --------------------- |
| `UUID`       | uuid   | n/a      | no       | Contact identifier   | `"b2c3...-d4e5"`      |
| `Name`       | string | yes      | yes      | Contact name         | `"Jordan Lee"`        |
| `Email`      | string | no       | yes      | Email                | `"jordan@acme.co.nz"` |
| `Phone`      | string | no       | yes      | Phone                | `"+64 9 123 4567"`    |
| `Mobile`     | string | no       | yes      | Mobile               | `"+64 21 555 0000"`   |
| `Position`   | string | no       | yes      | Job title            | `"Marketing Manager"` |
| `Salutation` | string | no       | yes      | Salutation           | `"Ms"`                |
| `IsPrimary`  | bool   | no       | yes      | Primary contact flag | `"Yes"`               |

**Relationships:** Client (N:1 via `ClientContact`).

---

### Invoice

**Resource path:** legacy `/invoice.api/*` (`list`, `current`, `get`) · modern `/invoice/{UUID}`
**Description:** A bill raised against a client/job. Amounts roll up from line collections.
**CRUD:** Read confirmed. Create (raise from job/time) likely but **financial — confirm with user**. [INFERRED]

| Field            | Type    | Required | Writable | Description                      | Example          |
| ---------------- | ------- | -------- | -------- | -------------------------------- | ---------------- |
| `UUID`           | uuid    | n/a      | no       | Invoice identifier               | `"c3d4...-e5f6"` |
| `ID`             | string  | n/a      | no       | Human invoice number             | `"INV-001234"`   |
| `Type`           | string  | n/a      | partial  | Invoice type                     | `"Standard"`     |
| `Status`         | enum    | n/a      | partial  | Draft / Approved / Paid (approx) | `"Approved"`     |
| `Date`           | date    | no       | partial  | Invoice date                     | `"2026-05-31"`   |
| `DueDate`        | date    | no       | partial  | Due date                         | `"2026-06-20"`   |
| `Amount`         | decimal | n/a      | no       | Total (computed from lines)      | `"3450.00"`      |
| `AmountTax`      | decimal | n/a      | no       | Tax (computed)                   | `"450.00"`       |
| `AmountPaid`     | decimal | n/a      | no       | Paid to date (computed)          | `"0.00"`         |
| `ClientUUID`     | uuid    | n/a      | no       | Billed client                    | `"a1b2...-5555"` |
| `InvoiceTask`    | array   | n/a      | partial  | Task line items                  | `[ ... ]`        |
| `InvoiceCost`    | array   | n/a      | partial  | Cost line items                  | `[ ... ]`        |
| `InvoicePayment` | array   | n/a      | no       | Payments applied                 | `[ ... ]`        |

**Relationships:** Client (N:1), Job (N:1, the job billed), Time (1:N — time entries get `InvoiceUUID` set once billed).

---

### Time (Time Entry / Timesheet)

**Resource path:** legacy `/time.api/*` (`list`, `get`, `add`) · modern `/time/{UUID}`
**Description:** A unit of time logged by a staff member against a job (and usually a task).
**CRUD:** Create / Read. Update/Delete uncertain. [INFERRED]

| Field               | Type        | Required | Writable | Description                      | Example          |
| ------------------- | ----------- | -------- | -------- | -------------------------------- | ---------------- |
| `UUID`              | uuid        | n/a      | no       | Time-entry identifier            | `"7a8b...-ff11"` |
| `Job`/`JobUUID`     | uuid/string | yes      | yes      | Job the time is logged against   | `"J000123"`      |
| `Staff`/`StaffUUID` | uuid        | yes      | yes      | Staff member who logged the time | `"0d6d...-9f1a"` |
| `Task`/`TaskUUID`   | uuid        | usually  | yes      | Task within the job              | `"...-task01"`   |
| `Date`              | date        | yes      | yes      | Date the time was worked         | `"2026-05-27"`   |
| `Minutes`           | int         | yes      | yes      | Duration in minutes              | `90`             |
| `Billable`          | bool        | no       | yes      | Billable flag (`Yes`/`No`)       | `"Yes"`          |
| `Note`              | string      | no       | yes      | Free-text note                   | `"Workshop"`     |
| `InvoiceUUID`       | uuid        | n/a      | no       | Set once the time is invoiced    | `null`           |

**Relationships:** Job (N:1), Staff (N:1), Task (N:1), Invoice (N:1 once billed).

---

### Staff

**Resource path:** legacy `/staff.api/list` (and `get`) · modern `/staff`
**Description:** A user/employee in the WorkflowMax org. Reference data — good for the connectivity check.
**CRUD:** Read only (list/get). Writes not exposed. [INFERRED]

| Field            | Type   | Required | Writable | Description       | Example             |
| ---------------- | ------ | -------- | -------- | ----------------- | ------------------- |
| `UUID`           | uuid   | n/a      | no       | Staff identifier  | `"0d6d...-9f1a"`    |
| `Name`           | string | n/a      | no       | Staff name        | `"Jane Smith"`      |
| `Email`          | string | n/a      | no       | Email             | `"jane@acme.co.nz"` |
| `Phone`/`Mobile` | string | n/a      | no       | Contact numbers   | `"+64 21 ..."`      |
| `PayrollCode`    | string | n/a      | no       | Payroll reference | `"PR-014"`          |

---

### Secondary entities (lower priority)

> Present in the synchub model / Airbyte streams. Field detail [INFERRED]; treat as read-mostly.

| Entity          | Resource path          | Key fields                                              | Notes                                                                            |
| --------------- | ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Quote           | `/quote.api/*`         | `UUID`,`ID`,`Type`,`State`,`Date`,`Amount`,`ClientUUID` | Wins convert to a Job [INFERRED]                                                 |
| Purchase Order  | `/purchaseorder.api/*` | `UUID`,`ID`,`SupplierUUID`,`JobUUID`,`Amount`           | `purchaseorderlist` stream [INFERRED]                                            |
| Supplier        | `/supplier.api/*`      | `UUID`,`Name`,`Email`,`Phone`                           | `supplierlist` stream [INFERRED]                                                 |
| Lead            | `/lead.api/*`          | `UUID`,`Name`,`Category`,`Date`,`ClientUUID`            | `list`/`current`/`get`/`add`/`categories`, `from`/`to` [DOCUMENTED via Node SDK] |
| Cost / JobCost  | `/cost.api/*`          | `UUID`,`JobID`,`Description`,`Amount`,`Date`            | `costlist` stream [INFERRED]                                                     |
| Task / JobTask  | sub-resource of Job    | `UUID`,`Name`,`EstimatedMinutes`,`JobUUID`              | `tasklist`/`job_tasks` streams [INFERRED]                                        |
| Category        | `/categories.api/list` | `UUID`,`Name`                                           | Reference data; cacheable [DOCUMENTED]                                           |
| Client Group    | `/clientgroup*`        | `UUID`,`Name`                                           | `clientgrouplist` stream [INFERRED]                                              |
| Client Document | under client           | `UUID`,`Name`,`FileName`                                | Upload/download support UNKNOWN                                                  |

---

## Entity Relationship Diagram

```
                          ┌───────────┐
                          │  Client   │
                          └─────┬─────┘
                 1:N            │            1:N
       ┌──────────────────────┼───────────────────────┐
       ▼                      ▼                         ▼
  ┌─────────┐           ┌──────────┐              ┌──────────┐
  │ Contact │           │   Job    │              │ Invoice  │
  └─────────┘           └────┬─────┘              └────┬─────┘
                             │ 1:N                     │ 1:N
             ┌───────────────┼───────────┐            ▼
             ▼               ▼           ▼      ┌──────────────────┐
       ┌──────────┐   ┌───────────┐ ┌────────┐ │ Invoice line     │
       │ JobTask  │   │   Time    │ │ JobCost│ │ (Task/Cost/Pay)  │
       └────┬─────┘   └─────┬─────┘ └────────┘ └──────────────────┘
            │ N:M           │ N:1
            ▼               ▼
       ┌──────────┐   ┌───────────┐
       │  Staff   │◄──┤   Staff   │
       └──────────┘   └───────────┘

 Quote ──1:1 (on win)──► Job        Supplier ──1:N──► PurchaseOrder ──N:1──► Job
 Lead  ──(convert)─────► Client/Job
```

[INFERRED from synchub relationship tables: `ClientContact`, `JobAssignee`, `JobTaskAssignee`, `Time.InvoiceUUID`.]

---

## State Machines

### Job Lifecycle

```
[Planned/Quote] ──start──> [In Progress] ──complete──> [Completed] ──invoice──> [Invoiced]
                                 \
                                  ──cancel──> [Cancelled]
```

**Transitions:**

| From        | Action / Trigger | To          | Reversible? | Side Effects                         |
| ----------- | ---------------- | ----------- | ----------- | ------------------------------------ |
| Planned     | start            | In Progress | yes         | Time/costs can now be logged         |
| In Progress | complete         | Completed   | yes         | Often a precondition for invoicing   |
| Completed   | raise invoice    | Invoiced    | partial     | Billable time/costs flagged invoiced |
| any         | cancel           | Cancelled   | no          | Stops further work                   |

**Per-State Capabilities:**

| State       | Can log time? | Can invoice? | Notes                       |
| ----------- | ------------- | ------------ | --------------------------- |
| Planned     | no            | no           | Set up tasks/budget first   |
| In Progress | yes           | partial      | Normal working state        |
| Completed   | limited       | yes          | Ready to bill               |
| Invoiced    | no            | —            | Billed; treat as historical |
| Cancelled   | no            | no           | Terminal                    |

> **[INFERRED]** Exact `State` enum strings/casing MUST be read from a live `job.api/list` /
> `/job` response. `job.api/current` returns only currently-active jobs, implying a
> current-vs-historical split that you can exploit instead of a status filter.

### Invoice Status (approx)

```
[Draft] ──approve──> [Approved] ──payment──> [Paid]
```

[INFERRED — confirm exact `Status` values live.]

---

## Business Rules

### Ordering / Dependency Rules

- Must create a **Client** before a **Job**.
- Must have a **Job** (and usually a **Task**) before logging **Time** or **Cost**.
- Time entries must reference an existing `StaffUUID`, `JobUUID`/`Job`, and usually a `TaskUUID`.

### Field-Level Rules

- Cross-entity references use the target's `UUID`, never its human `ID`.
- Dates on `from`/`to` list filters use compact `YYYYMMDD`; date fields in bodies use `YYYY-MM-DD`.

### Cascading Effects

- Archiving/deleting a Client affects its Jobs.
- Invoicing flips affected time entries' `InvoiceUUID` from null to the invoice's UUID.

### Uniqueness Constraints

- Job `ID` (e.g. `J000123`) and Invoice `ID` (e.g. `INV-001234`) are unique within the org.

### Computed / Read-Only Fields

- `UUID`, `ID`, `WhenCreated`, `WhenModified` are server-managed.
- Invoice `Amount`/`AmountTax`/`AmountPaid` roll up from line collections — never write them directly.

### Access Rule

- The connecting staff member must have **"Authorise 3rd Party Full Access"** enabled on their
  WorkflowMax staff record, or the API rejects calls (403). [DOCUMENTED]

---

## Field Format Reference

| Format        | Pattern                               | Example                                | Notes                                              |
| ------------- | ------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Date (body)   | `YYYY-MM-DD`                          | `2026-05-01`                           | Modern field values [INFERRED]                     |
| Date (filter) | `YYYYMMDD`                            | `20260501`                             | Legacy `from`/`to` filters [DOCUMENTED]            |
| DateTime      | ISO-8601                              | `2026-05-01T09:30:00Z`                 | `WhenCreated`/`WhenModified` [INFERRED]            |
| Currency      | Decimal string, org currency, 2 dp    | `12000.00`                             | No currency symbol embedded [INFERRED]             |
| ID (link)     | UUID v4                               | `e3b0c442-98fc-1c14-9afb-f4c8996fb1a2` | Use for relationships [DOCUMENTED]                 |
| ID (human)    | Prefixed number                       | `J000123` / `INV-001234`               | Display only — not a relationship key [DOCUMENTED] |
| Boolean       | `Yes`/`No` (legacy) or `true`/`false` | `Yes`                                  | Confirm representation live [INFERRED]             |

---

## Enum Value Reference

| Entity  | Field      | Allowed Values (approx)                                  | Default | Notes                     |
| ------- | ---------- | -------------------------------------------------------- | ------- | ------------------------- |
| Job     | `State`    | Planned · In Progress · Completed · Cancelled · Invoiced | —       | [INFERRED — confirm live] |
| Invoice | `Status`   | Draft · Approved · Paid                                  | —       | [INFERRED — confirm live] |
| Time    | `Billable` | Yes · No (or true/false)                                 | —       | [INFERRED]                |

---

_Generated from the investigation questionnaire, Phase 3._
