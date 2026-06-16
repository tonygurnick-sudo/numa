---
api_name: Workbench International (ERP)
api_slug: workbench
doc: domain model reference (companion to 01-llm-api-rules.md)
confidence: domain is [DOCUMENTED] (Workbench module docs: Job Costing, Activity Codes, Purchasing, AP/AR, GL). API resource names, field names, types, casing are [INFERRED]/[UNKNOWN] — dump the instance Swagger for truth. Default tag is [INFERRED] 🔬 (discover); only NON-default tags ([DOCUMENTED] / [UNKNOWN] 🔬) are marked inline. No item is live-confirmed.
path_note: all resource paths shown are [INFERRED] placeholders; prefix /api/v1 is a guess — read it from the Swagger base path.
---

# Workbench International — Domain Model Reference

## What "Distribution" means (read first)

Distribution = the cost/GL split of a transaction across **job + activity + GL account (+ tax)** — the lines that split a cost or invoice into job-costing and GL postings. This is Workbench's "interface to General Ledger, Accounts Payable, Accounts Receivable." `[DOCUMENTED]`

Key rule: **Activity Codes are the cost codes, and the Activity Code specifies the debit GL account** ("Generally the Activity Code specifies the debit GL Account"). A cost posts to **Job + Activity**; the GL account follows from the activity → GL mapping. `[DOCUMENTED]`

Documented **cost transaction types** (all require an Activity Code): **Time, Purchases, Subcontracts, Retentions, Disbursements, Stock, Plant, Internals, Overheads.** `[DOCUMENTED]` Treat as the `type` enum (API casing 🔬).

## Entity Catalog

Columns: field · type · req(create) · writable · description · example. Resource paths are placeholders.

### Job — `/api/v1/jobs`. Central record everything is costed against. CRUD: Read (+likely create/update).

| Field         | Type         | Req | Writable | Description                               | Example              |
| ------------- | ------------ | --- | -------- | ----------------------------------------- | -------------------- |
| `id`/`jobNo`  | string/int   | —   | no       | Job identifier (human "job number" in UI) | `"J-10042"`          |
| `name`        | string       | yes | yes      | Job/project description                   | `"Riverside Bridge"` |
| `status`      | enum         | —   | yes      | active/on-hold/closed (enum 🔬)           | `"Active"`           |
| `clientId`    | string/int   | —   | yes      | FK → Debtor/Contact                       | `"551"`              |
| `manager`     | string       | —   | yes      | Job/project manager                       | `"Aroha Ngata"`      |
| `budget`      | decimal      | —   | maybe    | Job budget (vs actual/forecast)           | `2500000.00`         |
| `createdDate` | string(ISO?) | —   | no       | Creation date (format 🔬)                 | `"2026-01-15"`       |

Relationships: Activity Code 1:N via transactions (costs post to job+activity); Transaction 1:N sub-resource `/jobs/{id}/transactions`; Debtor(AR) N:1 via `clientId`.

### Activity Code — `/api/v1/activities` (or `/activitycodes`). User-defined cost codes, "required for all the different types of cost transaction". **Specifies the debit GL account.** `[DOCUMENTED]` CRUD: Read.

| Field         | Type   | Description                                     | Example       |
| ------------- | ------ | ----------------------------------------------- | ------------- |
| `code`        | string | Activity code                                   | `"STEEL"`     |
| `description` | string | Cost-type description                           | `"Steelwork"` |
| `glAccount`   | string | Debit GL account this activity maps to          | `"6100"`      |
| `group`       | string | Activity Group (per Setup Guide) `[DOCUMENTED]` | `"Materials"` |

Relationships: GL Account N:1 via `glAccount` (activity → debit GL) `[DOCUMENTED]`; Activity Group N:1 via `group` `[DOCUMENTED]`; Transaction 1:N (every cost tx references an activity).

### Transaction (+ Distribution lines) — `/api/v1/transactions`, `/api/v1/jobs/{id}/transactions`. A cost/revenue posting against a job/activity; carries **distribution lines** splitting it across job/activity/GL/tax. The heart of the GL/AP/AR interface `[DOCUMENTED]` (concept). CRUD: Read (+create, gated).

| Field       | Type       | Req | Writable | Description                                                                                   | Example        |
| ----------- | ---------- | --- | -------- | --------------------------------------------------------------------------------------------- | -------------- |
| `id`        | string     | —   | no       | Transaction id                                                                                | `"TX-88231"`   |
| `jobNo`     | string/int | yes | yes      | Job the cost/revenue posts to                                                                 | `"J-10042"`    |
| `type`      | enum       | yes | yes      | Time/Purchase/Subcontract/Retention/Disbursement/Stock/Plant/Internal/Overhead `[DOCUMENTED]` | `"Purchase"`   |
| `date`      | string     | yes | yes      | Transaction date (format 🔬)                                                                  | `"2026-03-14"` |
| `amount`    | decimal    | yes | yes      | Net amount                                                                                    | `4200.00`      |
| `taxCode`   | string     | —   | yes      | Tax code (NZ/AU GST 🔬)                                                                       | `"GST"`        |
| `taxAmount` | decimal    | —   | yes      | Tax amount                                                                                    | `630.00`       |
| `lines[]`   | array      | yes | yes      | **Distribution lines** (below)                                                                | —              |

Distribution line (sub-object): `activityCode` (string, activity within job, `"STEEL"`) · `glAccount` (string, GL account from activity, `"6100"`) · `costCentre` (string, optional org dimension 🔬, `"CC-200"`) · `amount` (decimal net, `4200.00`) · `tax` (decimal, `630.00`).
Relationships: Job N:1 via `jobNo`; Activity Code N:1 per line; GL Account N:1 per line.

### Purchase Order — `/api/v1/purchaseorders`. Create POs online, send via email (WBPURCHASING). AP invoices match to a PO (full/partial) `[DOCUMENTED]` (module). CRUD: Read + create.

| Field        | Type    | Req | Writable | Description                         | Example      |
| ------------ | ------- | --- | -------- | ----------------------------------- | ------------ |
| `id`/`poNo`  | string  | —   | no       | PO number                           | `"PO-3310"`  |
| `supplierId` | string  | yes | yes      | FK → Creditor/Supplier              | `"SUP-77"`   |
| `jobNo`      | string  | —   | yes      | Job the PO is for                   | `"J-10042"`  |
| `status`     | enum    | —   | yes      | draft/approved/received/invoiced 🔬 | `"Approved"` |
| `lines[]`    | array   | yes | yes      | PO lines (activity/GL split)        | —            |
| `total`      | decimal | —   | no       | PO total                            | `12450.00`   |

### Creditor / AP Invoice — `/api/v1/creditors` (or `/apinvoices`). Accounts Payable — "AP Invoices allow for the actual cost to be allocated to the job." Full/partial invoicing against a PO `[DOCUMENTED]`. CRUD: Read (+create).

| Field        | Type    | Description                        | Example        |
| ------------ | ------- | ---------------------------------- | -------------- |
| `id`         | string  | AP invoice id                      | `"AP-9001"`    |
| `supplierId` | string  | FK → Supplier                      | `"SUP-77"`     |
| `invoiceNo`  | string  | Supplier's invoice number          | `"INV-4471"`   |
| `date`       | string  | Invoice date                       | `"2026-02-20"` |
| `total`      | decimal | Invoice total (incl. tax)          | `12450.00`     |
| `status`     | enum    | draft/approved/paid 🔬             | `"Approved"`   |
| `lines[]`    | array   | Distribution to jobs/activities/GL | —              |

### Debtor / AR Invoice / Claim — `/api/v1/debtors`, `/invoices`, `/claims`. Accounts Receivable — client invoices and progress **claims** (with retentions). "External Invoices … will be updated to the Accounts Receivable System." Charge Types + Retention Codes drive job sales invoices `[DOCUMENTED]` (module). CRUD: Read (+create).

| Field       | Type    | Description                                 | Example       |
| ----------- | ------- | ------------------------------------------- | ------------- |
| `id`        | string  | AR invoice/claim id                         | `"AR-7001"`   |
| `clientId`  | string  | FK → Debtor (job's client)                  | `"551"`       |
| `jobNo`     | string  | Job being invoiced                          | `"J-10042"`   |
| `type`      | enum    | invoice/progress claim 🔬                   | `"Claim"`     |
| `total`     | decimal | Claimed/invoiced amount                     | `185000.00`   |
| `retention` | decimal | Retention held (construction-contract rule) | `9250.00`     |
| `status`    | enum    | drafted/certified/invoiced/paid 🔬          | `"Certified"` |

### Timesheet — `/api/v1/timesheets`. Personal/daily time entry → job cost capture (WBTIME). A "Time" cost transaction `[DOCUMENTED]` (module). CRUD: Read + create.

| Field          | Type    | Req | Writable | Description            | Example        |
| -------------- | ------- | --- | -------- | ---------------------- | -------------- |
| `id`           | string  | —   | no       | Timesheet entry id     | `"TS-55120"`   |
| `jobNo`        | string  | yes | yes      | Job time is charged to | `"J-10042"`    |
| `activityCode` | string  | yes | yes      | Activity (e.g. LABOUR) | `"LABOUR"`     |
| `employeeId`   | string  | yes | yes      | FK → Employee/Resource | `"E-204"`      |
| `date`         | string  | yes | yes      | Date worked            | `"2026-05-29"` |
| `hours`        | decimal | yes | yes      | Hours                  | `7.5`          |

### Plant / Asset — `/api/v1/plant`. Asset detail, costing rates (hrs/kms), depreciation, utilisation. Plant usage is a cost transaction type `[DOCUMENTED]` (module). CRUD: Read.

`id` (string, `"PL-12"`) · `name` (string, `"Excavator 5T"`) · `rate` (decimal charge-out hr/km 🔬, `145.00`).

### Supporting entities (read)

- **Supplier/Contact** `/api/v1/suppliers` — address book of suppliers/clients for POs, AP, AR.
- **Employee/Resource** `/api/v1/employees` — people who log timesheets / are charged out.
- **GL Account** `/api/v1/accounts` — chart of accounts / nominal codes that distribution posts to.
- **Cost Centre** `/api/v1/costcentres` — optional org/financial dimension on postings.
- **Subcontract** `/api/v1/subcontracts` — scope, claim certification, retentions.

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

## State Machines (`[INFERRED]` from the job-costing domain — enums + transitions `[UNKNOWN]` 🔬)

- **Job:** `[Active] ──hold──> [On Hold] ──resume──> [Active] ──close──> [Closed] ──archive──> [Archived]`. Closed jobs likely **reject new cost postings** 🔬; Archived is read-only (not reversible).
- **Purchase Order:** `[Draft] ──approve──> [Approved] ──receive──> [Received] ──invoice──> [Invoiced]`.
- **AR Claim (construction):** `[Drafted] ──certify──> [Certified] ──invoice──> [Invoiced] ──pay──> [Paid]`.

## Business Rules

- A transaction must reference a **valid Job + Activity Code** (+ a GL account per distribution line); these must exist first.
- **Posting to a closed job is likely rejected** — Workbench enforces its own validations on writes 🔬.
- **Distribution must balance** — lines (job/activity/GL/tax) sum to the document total.
- **The Activity Code drives the debit GL account** — do not freely pick a GL account; it follows the activity → GL mapping. `[DOCUMENTED]`
- Workbench **retains its own business rules and validations** on writes — "while retaining the business rules and validations of the Workbench application." Writes can be rejected by domain rules even when syntactically valid. `[DOCUMENTED]`
- **Cascading:** AP cost allocation hits the job's actual cost; External (AR) invoices update Accounts Receivable; both update GL via distribution. `[DOCUMENTED]`
- **Tenancy:** data is tenant-isolated by `instance_url` — one token/instance cannot read another customer's data.
- **Computed/read-only:** `id`/`jobNo`, `total` (sum of lines), `createdDate` are server-side.

## Field Formats & Enum Defaults

- **Formats** (assumed 🔬): Date ISO-8601 string (`"2026-05-29"`; JSON APIs typically serialise dates as strings); Currency decimal (`1500.00`); Tax code+decimal (`"GST"`, `225.00`; NZ/AU GST, codes per tenant config); Job no string/int (`"J-10042"`; human job number, PK type unconfirmed); GL account string code (`"6100"`); Instance HTTPS host (`https://acme.workbench.com`, `[DOCUMENTED — registry]`).
- **Enum defaults** (values listed per entity above): Job `status` default `Active`; PO `status` default `Draft`; Transaction `type` and AR Claim `status` have no default.
- **Rule:** never assume casing or enum spelling — the instance Swagger is the source of truth. 🔬
