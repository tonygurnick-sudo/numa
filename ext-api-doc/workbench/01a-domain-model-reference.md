---
api_name: 'Workbench International (ERP)'
api_slug: 'workbench'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Workbench International — Domain Model Reference

> Companion to `01-llm-api-rules.md`. The **domain** below is well-grounded in Workbench's published
> module documentation (Job Costing, Activity Codes, Purchasing, AP/AR Invoicing, GL). The **API
> resource names, field names, types and casing are NOT public** and must be dumped from the
> per-instance Swagger.
>
> **Confidence legend:** `[DOCUMENTED]` = stated in Workbench's own material (workbenchcentral.com /
> the Workbench docs Confluence) · `[INFERRED]` = deduced from ERP conventions / the module model ·
> `[UNKNOWN]` = not established, discovery needed (🔬). **No item here is `[CONFIRMED]` — no live call
> was made.** Resource paths shown are `[INFERRED]` placeholders.

---

## What "Distribution" means in Workbench (read this first)

In Workbench, **distribution = the cost/GL distribution of a transaction across job activities and GL
accounts** — the lines that split a cost or invoice into job/activity/GL/tax postings. This is the
"interface to General Ledger, Accounts Payable, Accounts Receivable." `[DOCUMENTED]` (concept)

The key documented rule: **Activity Codes are the cost codes**, and **the Activity Code specifies the
debit GL account** ("Generally the Activity Code specifies the debit GL Account"). So a cost posts to
a **Job + Activity**, and the **GL account follows from the activity → GL mapping**. `[DOCUMENTED]`

Workbench documents an explicit set of **cost transaction types**, all of which require an Activity
Code: **Time, Purchases, Subcontracts, Retentions, Disbursements, Stock, Plant, Internals,
Overheads.** `[DOCUMENTED]` Treat these as the `type` enum on a transaction (exact API casing 🔬).

---

## Entity Catalog

### Job

**Resource path:** `/api/v1/jobs` `[INFERRED]` 🔬
**Description:** The central record — the job/project that everything is costed against. `[DOCUMENTED]` (concept)
**CRUD:** Read (+ likely create/update). `[INFERRED]` 🔬

| Field          | Type          | Required     | Writable | Description                               | Example              |
| -------------- | ------------- | ------------ | -------- | ----------------------------------------- | -------------------- |
| `id` / `jobNo` | string/int    | —            | no       | Job identifier (human "job number" in UI) | `"J-10042"`          |
| `name`         | string        | yes (create) | yes      | Job/project description                   | `"Riverside Bridge"` |
| `status`       | enum/string   | —            | yes      | active / on-hold / closed 🔬              | `"Active"`           |
| `clientId`     | string/int    | —            | yes      | FK → Debtor/Contact                       | `"551"`              |
| `manager`      | string        | —            | yes      | Job/project manager                       | `"Aroha Ngata"`      |
| `budget`       | decimal       | —            | maybe    | Job budget (vs actual/forecast)           | `2500000.00`         |
| `createdDate`  | string (ISO?) | —            | no       | Creation date — format unconfirmed 🔬     | `"2026-01-15"`       |

**Relationships:**

| Related Entity | Type | Expression       | Notes                          |
| -------------- | ---- | ---------------- | ------------------------------ |
| Activity Code  | 1:N  | via transactions | Costs post to a job + activity |
| Transaction    | 1:N  | sub-resource     | `/jobs/{id}/transactions` 🔬   |
| Debtor (AR)    | N:1  | `clientId`       | The job's client/customer      |

---

### Activity Code

**Resource path:** `/api/v1/activities` (or `/activitycodes`) `[INFERRED]` 🔬
**Description:** User-defined cost codes for recording/reporting job cost transactional data;
"required for all the different types of cost transaction". **Specifies the debit GL account.** `[DOCUMENTED]`
**CRUD:** Read. `[INFERRED]` 🔬

| Field         | Type   | Required | Writable | Description                            | Example       |
| ------------- | ------ | -------- | -------- | -------------------------------------- | ------------- |
| `code`        | string | —        | no       | Activity code                          | `"STEEL"`     |
| `description` | string | —        | no       | Cost-type description                  | `"Steelwork"` |
| `glAccount`   | string | —        | no       | Debit GL account this activity maps to | `"6100"`      |
| `group`       | string | —        | no       | Activity Group (per Setup Guide)       | `"Materials"` |

**Relationships:**

| Related Entity | Type | Expression  | Notes                                         |
| -------------- | ---- | ----------- | --------------------------------------------- |
| GL Account     | N:1  | `glAccount` | Activity → debit GL account `[DOCUMENTED]`    |
| Activity Group | N:1  | `group`     | Grouping of activity codes `[DOCUMENTED]`     |
| Transaction    | 1:N  | line ref    | Every cost transaction references an activity |

---

### Transaction (+ Distribution lines)

**Resource path:** `/api/v1/transactions`, `/api/v1/jobs/{id}/transactions` `[INFERRED]` 🔬
**Description:** A cost/revenue posting against a job/activity; carries **distribution lines** that
split it across job/activity/GL/tax. The heart of Workbench's GL/AP/AR interface. `[DOCUMENTED]` (concept)
**CRUD:** Read (+ create, gated). `[INFERRED]` 🔬

| Field       | Type       | Required | Writable | Description                                                                                                   | Example        |
| ----------- | ---------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------- | -------------- |
| `id`        | string     | —        | no       | Transaction id                                                                                                | `"TX-88231"`   |
| `jobNo`     | string/int | yes      | yes      | Job the cost/revenue posts to                                                                                 | `"J-10042"`    |
| `type`      | enum       | yes      | yes      | Time / Purchase / Subcontract / Retention / Disbursement / Stock / Plant / Internal / Overhead `[DOCUMENTED]` | `"Purchase"`   |
| `date`      | string     | yes      | yes      | Transaction date (format 🔬)                                                                                  | `"2026-03-14"` |
| `amount`    | decimal    | yes      | yes      | Net amount                                                                                                    | `4200.00`      |
| `taxCode`   | string     | —        | yes      | Tax code (NZ/AU GST) 🔬                                                                                       | `"GST"`        |
| `taxAmount` | decimal    | —        | yes      | Tax amount                                                                                                    | `630.00`       |
| `lines[]`   | array      | yes      | yes      | **Distribution lines** (see below)                                                                            | —              |

**Distribution line** (sub-object of a transaction) — `[INFERRED]` 🔬:

| Field          | Type    | Description                                       | Example    |
| -------------- | ------- | ------------------------------------------------- | ---------- |
| `activityCode` | string  | Activity within the job                           | `"STEEL"`  |
| `glAccount`    | string  | GL/nominal account this line hits (from activity) | `"6100"`   |
| `costCentre`   | string  | Optional org/financial dimension 🔬               | `"CC-200"` |
| `amount`       | decimal | Net amount of this line                           | `4200.00`  |
| `tax`          | decimal | Tax on this line                                  | `630.00`   |

**Relationships:**

| Related Entity | Type | Expression | Notes                 |
| -------------- | ---- | ---------- | --------------------- |
| Job            | N:1  | `jobNo`    | Parent job            |
| Activity Code  | N:1  | line ref   | Per distribution line |
| GL Account     | N:1  | line ref   | Per distribution line |

---

### Purchase Order

**Resource path:** `/api/v1/purchaseorders` `[INFERRED]` 🔬
**Description:** Create POs online, send via email (WBPURCHASING module). AP invoices can be matched
to a PO (full or partial invoicing). `[DOCUMENTED]` (module)
**CRUD:** Read + create. `[INFERRED]` 🔬

| Field         | Type    | Required | Writable | Description                               | Example      |
| ------------- | ------- | -------- | -------- | ----------------------------------------- | ------------ |
| `id` / `poNo` | string  | —        | no       | PO number                                 | `"PO-3310"`  |
| `supplierId`  | string  | yes      | yes      | FK → Creditor/Supplier                    | `"SUP-77"`   |
| `jobNo`       | string  | —        | yes      | Job the PO is for                         | `"J-10042"`  |
| `status`      | enum    | —        | yes      | draft / approved / received / invoiced 🔬 | `"Approved"` |
| `lines[]`     | array   | yes      | yes      | PO lines (activity/GL split)              | —            |
| `total`       | decimal | —        | no       | PO total                                  | `12450.00`   |

---

### Creditor / AP Invoice

**Resource path:** `/api/v1/creditors` (or `/apinvoices`) `[INFERRED]` 🔬
**Description:** Accounts Payable — "AP Invoices allow for the actual cost to be allocated to the job."
Where a cost relates to a PO, full or partial invoicing against the PO is provided. `[DOCUMENTED]`
**CRUD:** Read (+ create). `[INFERRED]` 🔬

| Field        | Type    | Description                        | Example        |
| ------------ | ------- | ---------------------------------- | -------------- |
| `id`         | string  | AP invoice id                      | `"AP-9001"`    |
| `supplierId` | string  | FK → Supplier                      | `"SUP-77"`     |
| `invoiceNo`  | string  | Supplier's invoice number          | `"INV-4471"`   |
| `date`       | string  | Invoice date                       | `"2026-02-20"` |
| `total`      | decimal | Invoice total (incl. tax)          | `12450.00`     |
| `status`     | enum    | draft / approved / paid 🔬         | `"Approved"`   |
| `lines[]`    | array   | Distribution to jobs/activities/GL | —              |

---

### Debtor / AR Invoice / Claim

**Resource path:** `/api/v1/debtors`, `/api/v1/invoices`, `/api/v1/claims` `[INFERRED]` 🔬
**Description:** Accounts Receivable — client invoices and progress **claims** (with retentions).
"External Invoices … will be updated to the Accounts Receivable System." Charge Types and Retention
Codes drive job sales invoices. `[DOCUMENTED]` (module)
**CRUD:** Read (+ create). `[INFERRED]` 🔬

| Field       | Type    | Description                                 | Example       |
| ----------- | ------- | ------------------------------------------- | ------------- |
| `id`        | string  | AR invoice / claim id                       | `"AR-7001"`   |
| `clientId`  | string  | FK → Debtor (job's client)                  | `"551"`       |
| `jobNo`     | string  | Job being invoiced                          | `"J-10042"`   |
| `type`      | enum    | invoice / progress claim 🔬                 | `"Claim"`     |
| `total`     | decimal | Claimed/invoiced amount                     | `185000.00`   |
| `retention` | decimal | Retention held (construction-contract rule) | `9250.00`     |
| `status`    | enum    | drafted / certified / invoiced / paid 🔬    | `"Certified"` |

---

### Timesheet

**Resource path:** `/api/v1/timesheets` `[INFERRED]` 🔬
**Description:** Personal/daily time entry → job cost capture (WBTIME). A "Time" cost transaction. `[DOCUMENTED]` (module)
**CRUD:** Read + create. `[INFERRED]` 🔬

| Field          | Type    | Required | Writable | Description            | Example        |
| -------------- | ------- | -------- | -------- | ---------------------- | -------------- |
| `id`           | string  | —        | no       | Timesheet entry id     | `"TS-55120"`   |
| `jobNo`        | string  | yes      | yes      | Job time is charged to | `"J-10042"`    |
| `activityCode` | string  | yes      | yes      | Activity (e.g. LABOUR) | `"LABOUR"`     |
| `employeeId`   | string  | yes      | yes      | FK → Employee/Resource | `"E-204"`      |
| `date`         | string  | yes      | yes      | Date worked            | `"2026-05-29"` |
| `hours`        | decimal | yes      | yes      | Hours                  | `7.5`          |

---

### Plant / Asset

**Resource path:** `/api/v1/plant` `[INFERRED]` 🔬
**Description:** Plant management — asset detail, costing rates (hrs/kms), depreciation, utilisation.
Plant usage is a cost transaction type. `[DOCUMENTED]` (module)
**CRUD:** Read. `[INFERRED]` 🔬

| Field  | Type    | Description                | Example          |
| ------ | ------- | -------------------------- | ---------------- |
| `id`   | string  | Plant/asset id             | `"PL-12"`        |
| `name` | string  | Asset description          | `"Excavator 5T"` |
| `rate` | decimal | Charge-out rate (hr/km) 🔬 | `145.00`         |

---

### Supporting entities (read, `[INFERRED]` 🔬)

- **Supplier / Contact** (`/api/v1/suppliers`) — address book of suppliers/clients for POs, AP, AR.
- **Employee / Resource** (`/api/v1/employees`) — people who log timesheets / are charged out.
- **GL Account** (`/api/v1/accounts`) — chart of accounts / nominal codes that distribution posts to.
- **Cost Centre** (`/api/v1/costcentres`) — optional org/financial dimension on postings.
- **Subcontract** (`/api/v1/subcontracts`) — scope, claim certification, retentions.

---

## Entity Relationship Diagram

```
┌──────────┐  1:N (via tx) ┌───────────────┐  N:1   ┌─────────────┐
│   Job    │──────────────▶│ Activity Code  │───────▶│ GL Account  │
│ (jobNo)  │               │ (in Groups)    │ (debit)│ (nominal)   │
└────┬─────┘               └───────┬───────┘        └──────▲──────┘
     │ N:1 (clientId)              │ per line              │ per line
     ▼                            ┌┴──────────────────────┴─────┐
┌──────────┐                      │ Transaction                  │
│  Debtor  │◀── AR/Claim          │  type: Time|Purchase|Subbie  │
│ (client) │   (External Invoice) │  └─ Distribution lines ──────┤
└──────────┘                      │     (job/activity/GL/tax)    │
┌──────────┐  AP cost allocation  └──────────────▲──────────────┘
│ Creditor │─────────────────────────────────────┤ feeds
│ (AP inv) │   (matched to PO, full/partial)      │
└────▲─────┘                          ┌───────────┴───────────────┐
     │ supplierId        ┌────────────┤ Timesheet · Purchase Order │
┌────┴─────┐  charge out │ Employee/  │ Subcontract claim · Plant  │
│ Supplier │             │ Resource   │ usage                       │
└──────────┘             └────────────┴────────────────────────────┘
```

---

## State Machines (`[INFERRED]` from the construction/job-costing domain — enums 🔬)

### Job lifecycle

```
[Active] ──hold──> [On Hold] ──resume──> [Active] ──close──> [Closed] ──archive──> [Archived]
```

| From   | Action  | To       | Reversible? | Side Effects                                       |
| ------ | ------- | -------- | ----------- | -------------------------------------------------- |
| Active | close   | Closed   | maybe       | Closed jobs likely **reject new cost postings** 🔬 |
| Closed | archive | Archived | no          | Read-only                                          |

### Purchase Order lifecycle

```
[Draft] ──approve──> [Approved] ──receive──> [Received] ──invoice──> [Invoiced]
```

### AR Claim lifecycle (construction)

```
[Drafted] ──certify──> [Certified] ──invoice──> [Invoiced] ──pay──> [Paid]
```

> Exact enum values and allowed transitions are `[UNKNOWN]` 🔬 — discover from the Swagger + live records.

---

## Business Rules

### Ordering / Dependency Rules

- A **transaction must reference a valid Job + Activity Code** (and a GL account per distribution line). These must exist first. `[INFERRED]` 🔬
- **Posting to a closed job is likely rejected** — Workbench enforces its own validations on writes. 🔬

### Field-Level / Validation Rules

- **Distribution must balance** — a cost/invoice's lines (job/activity/GL/tax) sum to the document total. `[INFERRED]` 🔬
- **The Activity Code drives the debit GL account** — you do not freely pick a GL account; it follows the activity → GL mapping. `[DOCUMENTED]`
- Workbench **retains its own business rules and validations** on API writes — "while retaining the business rules and validations of the Workbench application." Writes can be rejected by domain rules even when syntactically valid. `[DOCUMENTED]`

### Cascading Effects

- AP/AR postings update GL via distribution. AP cost allocation hits the job's actual cost; External (AR) invoices update Accounts Receivable. `[DOCUMENTED]`

### Tenancy

- Data is **tenant-isolated by `instance_url`** — one token/instance cannot read another customer's data. `[INFERRED]`

### Computed / Read-Only Fields

- `id`/`jobNo`, `total` (sum of lines), `createdDate` are server-side. `[INFERRED]` 🔬

---

## Field Format Reference

| Format     | Pattern (assumed) | Example                      | Notes                                       | Confidence                |
| ---------- | ----------------- | ---------------------------- | ------------------------------------------- | ------------------------- |
| Date       | ISO-8601 string   | `"2026-05-29"`               | JSON APIs typically serialise as strings 🔬 | `[INFERRED]`              |
| Currency   | decimal number    | `1500.00`                    | On transactions / AP / AR / distribution    | `[INFERRED]`              |
| Tax        | code + decimal    | `"GST"`, `225.00`            | NZ/AU GST; codes per tenant config 🔬       | `[INFERRED]`              |
| Job no     | string/int        | `"J-10042"`                  | Human job number; PK type unconfirmed 🔬    | `[INFERRED]`              |
| GL account | string code       | `"6100"`                     | Nominal/GL code on distribution lines 🔬    | `[INFERRED]`              |
| Instance   | HTTPS host        | `https://acme.workbench.com` | Per-customer base URL                       | `[DOCUMENTED — registry]` |

---

## Enum Value Reference

| Entity      | Field    | Allowed Values                                                                                           | Default  | Notes                                               |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| Transaction | `type`   | `Time`, `Purchase`, `Subcontract`, `Retention`, `Disbursement`, `Stock`, `Plant`, `Internal`, `Overhead` | —        | Documented cost types `[DOCUMENTED]`; API casing 🔬 |
| Job         | `status` | `Active`, `On Hold`, `Closed`, `Archived` 🔬                                                             | `Active` | `[INFERRED]`                                        |
| PO          | `status` | `Draft`, `Approved`, `Received`, `Invoiced` 🔬                                                           | `Draft`  | `[INFERRED]`                                        |
| AR Claim    | `status` | `Drafted`, `Certified`, `Invoiced`, `Paid` 🔬                                                            | —        | `[INFERRED]`                                        |

> **Rule:** Never assume casing or enum spelling. The instance Swagger is the source of truth. 🔬

---

_Generated from the investigation questionnaire, Phase 3. Domain is `[DOCUMENTED]`; API shapes are `[INFERRED]`/`[UNKNOWN]` pending Swagger discovery._
