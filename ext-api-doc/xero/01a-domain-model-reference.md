---
api_name: 'Xero Accounting API'
api_slug: 'xero'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Xero Accounting API -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Full entity catalog, relationships, the Invoice
> state machine, business rules, formats, and enums the workspace agent references when
> working with Xero data.
>
> **Source of truth:** the official `xero_accounting.yaml` OpenAPI spec
> (https://github.com/XeroAPI/Xero-OpenAPI) + per-resource docs. Field sets are
> `[DOCUMENTED]`; exact live response envelopes (`/Date()/` vs ISO per field) are not yet
> captured against a real token — parse defensively.

---

## Entity Catalog

> Resource names are **PascalCase + plural** (`/Invoices`, `/Contacts`, `/Accounts`,
> `/Payments`, `/BankTransactions`). IDs are GUIDs. All `*ID` fields are system-set.

### Invoice

**Resource path:** `/Invoices`, `/Invoices/{InvoiceID}`
**Description:** Sales invoices (`ACCREC`, money owed **to** the org) and bills (`ACCPAY`, money the org **owes**). The single most important Xero entity.
**CRUD:** Read (with `accounting.transactions.read` — in registry). Create/Update need the write scope `accounting.transactions` (NOT in registry). No hard delete — invoices are VOIDED or DELETED via status change.

| Field                                         | Type     | Required    | Writable    | Description                                             | Example                                  |
| --------------------------------------------- | -------- | ----------- | ----------- | ------------------------------------------------------- | ---------------------------------------- |
| `InvoiceID`                                   | GUID     | system      | no          | Unique id                                               | `"297c2dc5-cc47-4afd-8ec8-74990b8761e9"` |
| `Type`                                        | enum     | yes (write) | on create   | `ACCREC` / `ACCPAY`                                     | `"ACCREC"`                               |
| `InvoiceNumber`                               | string   | no          | yes         | Human-readable number                                   | `"INV-0042"`                             |
| `Reference`                                   | string   | no          | yes         | ACCREC reference                                        | `"PO-123"`                               |
| `Contact`                                     | object   | yes (write) | yes         | `{ "ContactID": "..." }` or `{ "Name": "..." }`         | —                                        |
| `Date`                                        | date     | no          | yes         | Invoice date                                            | `"2024-06-01"`                           |
| `DueDate`                                     | date     | no          | yes         | Due date                                                | `"2024-06-30"`                           |
| `LineItems`                                   | array    | yes (write) | yes         | Description, Quantity, UnitAmount, AccountCode, TaxType | —                                        |
| `LineAmountTypes`                             | enum     | no          | yes         | `Exclusive` / `Inclusive` / `NoTax`                     | `"Exclusive"`                            |
| `Status`                                      | enum     | no          | via actions | See state machine below                                 | `"AUTHORISED"`                           |
| `SubTotal` / `TotalTax` / `Total`             | decimal  | computed    | no          | Server-computed totals                                  | `100.00` / `15.00` / `115.00`            |
| `AmountDue` / `AmountPaid` / `AmountCredited` | decimal  | computed    | no          | Payment tracking                                        | `115.00` / `0.00` / `0.00`               |
| `CurrencyCode`                                | string   | no          | yes         | ISO 4217                                                | `"NZD"`                                  |
| `UpdatedDateUTC`                              | datetime | system      | no          | Last-modified — **key for incremental sync**            | `"/Date(1717272000000+0000)/"`           |
| `HasAttachments`                              | bool     | system      | no          | Attachment flag                                         | `true`                                   |

**Relationships:**

| Related Entity | Type           | Expression                 | Notes                                     |
| -------------- | -------------- | -------------------------- | ----------------------------------------- |
| Contact        | N:1            | nested `Contact.ContactID` | The customer (ACCREC) / supplier (ACCPAY) |
| Payment        | 1:N            | nested `Payments[]`        | Applied payments                          |
| CreditNote     | 1:N            | nested `CreditNotes[]`     | Allocated credits                         |
| Account        | N:1 (per line) | `LineItems[].AccountCode`  | GL coding (chart of accounts)             |

---

### Contact

**Resource path:** `/Contacts`, `/Contacts/{ContactID}`
**Description:** Customers, suppliers, and other parties. A contact can be both customer and supplier.
**CRUD:** Read with `accounting.contacts.read` (in registry). Write needs `accounting.contacts`.

| Field                       | Type     | Required    | Writable | Description                           | Example            |
| --------------------------- | -------- | ----------- | -------- | ------------------------------------- | ------------------ |
| `ContactID`                 | GUID     | system      | no       | Unique id                             | `"bd2270c3-..."`   |
| `Name`                      | string   | yes (write) | yes      | Display name — **unique per org**     | `"ABC Ltd"`        |
| `ContactNumber`             | string   | no          | yes      | External reference                    | `"C-001"`          |
| `FirstName` / `LastName`    | string   | no          | yes      | Primary person                        | `"Jane"` / `"Doe"` |
| `EmailAddress`              | string   | no          | yes      | Primary email                         | `"jane@abc.com"`   |
| `ContactStatus`             | enum     | no          | yes      | `ACTIVE` / `ARCHIVED` / `GDPRREQUEST` | `"ACTIVE"`         |
| `Addresses` / `Phones`      | array    | no          | yes      | Address & phone collections           | —                  |
| `IsCustomer` / `IsSupplier` | bool     | system      | no       | Derived flags                         | `true`             |
| `UpdatedDateUTC`            | datetime | system      | no       | Last-modified                         | `"/Date(...)/"`    |

**Relationships:** 1:N to Invoice (nested `Contact.ContactID` on the invoice).

---

### Account (Chart of Accounts)

**Resource path:** `/Accounts`, `/Accounts/{AccountID}`
**Description:** General-ledger accounts (the chart of accounts).
**CRUD:** Read needs `accounting.settings.read` — **NOT in registry scopes** → 403 today. Write needs `accounting.settings`.

| Field               | Type   | Writable        | Description                                                                     | Example     |
| ------------------- | ------ | --------------- | ------------------------------------------------------------------------------- | ----------- |
| `AccountID`         | GUID   | no              | Unique id                                                                       | —           |
| `Code`              | string | yes             | Account code — referenced by `LineItems[].AccountCode`                          | `"200"`     |
| `Name`              | string | yes             | Account name                                                                    | `"Sales"`   |
| `Type`              | enum   | yes             | `BANK`, `REVENUE`, `EXPENSE`, `CURRENT`, `FIXED`, `EQUITY`, … (full enum below) | `"REVENUE"` |
| `Status`            | enum   | yes             | `ACTIVE` / `ARCHIVED` / `DELETED`                                               | `"ACTIVE"`  |
| `TaxType`           | string | yes             | Default tax code                                                                | `"OUTPUT2"` |
| `BankAccountNumber` | string | yes (BANK only) | Bank account number                                                             | —           |

**Relationships:** N:1 from Invoice/BankTransaction line items via `AccountCode`. A `Type=BANK` account is the `BankAccount` on a BankTransaction.

---

### Payment

**Resource path:** `/Payments`, `/Payments/{PaymentID}`
**Description:** Payments applied against invoices, bills, credit notes, prepayments/overpayments.
**CRUD:** Read with `accounting.transactions.read`. Not edited — created or **deleted/reversed** (status `DELETED`).

| Field         | Type    | Writable | Description                                                            | Example           |
| ------------- | ------- | -------- | ---------------------------------------------------------------------- | ----------------- |
| `PaymentID`   | GUID    | no       | Unique id                                                              | —                 |
| `Date`        | date    | yes      | Payment date                                                           | `"2024-06-05"`    |
| `Amount`      | decimal | yes      | Payment amount                                                         | `50.00`           |
| `Reference`   | string  | yes      | Reference                                                              | `"Cheque 123"`    |
| `Invoice`     | object  | yes      | `{ "InvoiceID": "..." }` the doc being paid                            | —                 |
| `Account`     | object  | yes      | Bank/clearing account `{ "AccountID": "..." }`                         | —                 |
| `PaymentType` | enum    | no       | `ACCRECPAYMENT`, `ACCPAYPAYMENT`, `ARCREDITPAYMENT`, `APCREDITPAYMENT` | `"ACCRECPAYMENT"` |
| `Status`      | enum    | no       | `AUTHORISED` / `DELETED`                                               | `"AUTHORISED"`    |

**Relationships:** N:1 to Invoice (nested `Invoice.InvoiceID`); N:1 to Account (bank).

---

### BankTransaction

**Resource path:** `/BankTransactions`, `/BankTransactions/{BankTransactionID}`
**Description:** Spend-money / receive-money transactions against bank accounts. Distinct from Payments and from imported bank statement lines.
**CRUD:** Read with `accounting.transactions.read`.

| Field                                      | Type     | Writable | Description                                                                                              | Example         |
| ------------------------------------------ | -------- | -------- | -------------------------------------------------------------------------------------------------------- | --------------- |
| `BankTransactionID`                        | GUID     | no       | Unique id                                                                                                | —               |
| `Type`                                     | enum     | yes      | `RECEIVE`, `SPEND`, `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT` | `"SPEND"`       |
| `Status`                                   | enum     | no       | `AUTHORISED`, `DELETED` (also `DRAFT` in some flows)                                                     | `"AUTHORISED"`  |
| `Contact`                                  | object   | yes      | Counterparty                                                                                             | —               |
| `BankAccount`                              | object   | yes      | `{ "AccountID": "..." }` — must be a `Type=BANK` account                                                 | —               |
| `LineItems`                                | array    | yes      | Lines                                                                                                    | —               |
| `IsReconciled`                             | bool     | no       | Reconciliation flag                                                                                      | `false`         |
| `Date` / `SubTotal` / `TotalTax` / `Total` | mixed    | —        | Standard amounts                                                                                         | —               |
| `UpdatedDateUTC`                           | datetime | no       | Last-modified                                                                                            | `"/Date(...)/"` |

**Relationships:** N:1 to Account (`BankAccount`), N:1 to Contact, N:1 per line to Account via `AccountCode`.

---

## Entity Relationship Diagram

```
                ┌──────────────┐
                │  Connection  │  GET /connections → tenantId
                └──────┬───────┘
                       │ scopes ONE tenant (Xero-tenant-id header)
                       ▼
                ┌──────────────┐
                │ Organisation │  (needs accounting.settings.read — 403 today)
                └──────┬───────┘
        ┌──────────────┼───────────────┬───────────────────┐
        ▼              ▼                ▼                   ▼
  ┌──────────┐   ┌──────────┐    ┌──────────┐    ┌──────────────────┐
  │ Contact  │   │ Account  │    │ Invoice  │    │ BankTransaction  │
  └────┬─────┘   └────┬─────┘    └────┬─────┘    └────────┬─────────┘
       │ 1:N          │ N:1            │ 1:N              │ N:1
       │ invoices     │ (per line)     ▼                  ▼
       └─────────────►│           ┌──────────┐    (BankAccount = Account, Type=BANK)
                      └──────────►│ Payment  │
                                  └──────────┘
```

---

## State Machines

### Invoice Lifecycle

```
[DRAFT] ──submit──> [SUBMITTED] ──approve──> [AUTHORISED] ──(payments cover AmountDue)──> [PAID]
   │                     │                          │
   └──delete──> [DELETED]┘                          └──void──> [VOIDED]
```

**Transitions:**

| From            | Action / Trigger                     | To         | Reversible?           | Side Effects                                                        |
| --------------- | ------------------------------------ | ---------- | --------------------- | ------------------------------------------------------------------- |
| DRAFT           | submit for approval                  | SUBMITTED  | yes                   | none                                                                |
| SUBMITTED       | approve                              | AUTHORISED | no                    | becomes a real receivable/payable; affects ledger                   |
| AUTHORISED      | apply payment(s) until `AmountDue`=0 | PAID       | via deleting payments | reduces `AmountDue`                                                 |
| DRAFT/SUBMITTED | delete                               | DELETED    | no                    | removed from default lists                                          |
| AUTHORISED      | void                                 | VOIDED     | no                    | reverses ledger impact; **cannot void if payments/credits applied** |

**Per-state capabilities:**

| State            | Can Update? | Can Delete?    | Available Actions           | Notes                                   |
| ---------------- | ----------- | -------------- | --------------------------- | --------------------------------------- |
| DRAFT            | yes         | yes (→DELETED) | edit, submit, authorise     | fully mutable                           |
| SUBMITTED        | yes         | yes (→DELETED) | edit, approve               |                                         |
| AUTHORISED       | limited     | no (void only) | apply payment, void, attach | line items largely locked               |
| PAID             | no          | no             | view                        | remove payments to revert to AUTHORISED |
| VOIDED / DELETED | no          | no             | view                        | terminal                                |

> Payments and BankTransactions are simpler: `AUTHORISED` → `DELETED` (deletion is a status change, not a hard delete).

---

## Business Rules

### Ordering / Dependency Rules

- **Tenant scoping (the big one):** every data call targets exactly one tenant via `Xero-tenant-id`. One token may be connected to many orgs — loop/choose tenants explicitly. There is no implicit "current tenant".
- Invoice line items reference an existing `AccountCode` (chart of accounts) and `TaxType`.
- Payments reference an existing `InvoiceID` **and** a bank `Account`.

### Field-Level Rules

- `Contact.Name` must be **unique within an org**.
- Invoice `Total = SubTotal + TotalTax`, computed server-side from line items.

### Cascading Effects

- Voiding an invoice reverses its ledger impact; you cannot void if payments or credit notes are applied (remove them first).

### Uniqueness Constraints

- `Contact.Name` unique per org. `InvoiceNumber` is conventionally unique but Xero allows duplicates unless org settings forbid.

### Computed / Read-Only Fields

- `SubTotal`, `TotalTax`, `Total`, `AmountDue`, `AmountPaid`, `AmountCredited`, `UpdatedDateUTC` are all server-computed. Never send them as inputs.

### Idempotency

- Create endpoints (POST/PUT) accept an `Idempotency-Key` request header (~24h window) to safely retry. See 01c.

---

## Field Format Reference

| Format                      | Pattern                     | Example                                | Notes                                               |
| --------------------------- | --------------------------- | -------------------------------------- | --------------------------------------------------- |
| Date (request)              | `YYYY-MM-DD`                | `2024-06-01`                           | Accepted in JSON request bodies                     |
| DateTime (response, legacy) | `/Date(epoch_ms+tzoffset)/` | `/Date(1717272000000+0000)/`           | Microsoft JSON on many fields — parse defensively   |
| DateTime (`*UTC` fields)    | ISO-like                    | `2024-06-02T10:00:00`                  | `UpdatedDateUTC` etc. — **prefer these for sync**   |
| Currency / decimal          | plain decimal               | `100.00`                               | No thousands separators; ISO 4217 in `CurrencyCode` |
| ID                          | GUID v4                     | `297c2dc5-cc47-4afd-8ec8-74990b8761e9` | All `*ID` fields                                    |
| Enum (status/type)          | UPPERCASE                   | `AUTHORISED`, `ACCREC`                 | Status/Type enums are uppercase                     |
| LineAmountTypes             | PascalCase                  | `Exclusive`                            | Exception — NOT uppercase                           |
| `where` DateTime literal    | `DateTime(y,m,d)`           | `DateTime(2024,06,01)`                 | Used inside the `where` filter (see 01b)            |

---

## Enum Value Reference

| Entity          | Field             | Allowed Values                                                                                                                                                                                                     | Default      | Confidence   |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------ |
| Invoice         | `Type`            | `ACCPAY`, `ACCREC`                                                                                                                                                                                                 | —            | [DOCUMENTED] |
| Invoice         | `Status`          | `DRAFT`, `SUBMITTED`, `DELETED`, `AUTHORISED`, `PAID`, `VOIDED`                                                                                                                                                    | `DRAFT`      | [DOCUMENTED] |
| Invoice         | `LineAmountTypes` | `Exclusive`, `Inclusive`, `NoTax`                                                                                                                                                                                  | `Exclusive`  | [DOCUMENTED] |
| Contact         | `ContactStatus`   | `ACTIVE`, `ARCHIVED`, `GDPRREQUEST`                                                                                                                                                                                | `ACTIVE`     | [DOCUMENTED] |
| Account         | `Status`          | `ACTIVE`, `ARCHIVED`, `DELETED`                                                                                                                                                                                    | `ACTIVE`     | [DOCUMENTED] |
| Account         | `Type`            | `BANK`, `CURRENT`, `CURRLIAB`, `DEPRECIATN`, `DIRECTCOSTS`, `EQUITY`, `EXPENSE`, `FIXED`, `INVENTORY`, `LIABILITY`, `NONCURRENT`, `OTHERINCOME`, `OVERHEADS`, `PREPAYMENT`, `REVENUE`, `SALES`, `TERMLIAB`, `PAYG` | —            | [DOCUMENTED] |
| Payment         | `Status`          | `AUTHORISED`, `DELETED`                                                                                                                                                                                            | `AUTHORISED` | [DOCUMENTED] |
| Payment         | `PaymentType`     | `ACCRECPAYMENT`, `ACCPAYPAYMENT`, `ARCREDITPAYMENT`, `APCREDITPAYMENT`, `AROVERPAYMENTPAYMENT`, `ARPREPAYMENTPAYMENT`, `APPREPAYMENTPAYMENT`, `APOVERPAYMENTPAYMENT`                                               | —            | [DOCUMENTED] |
| BankTransaction | `Type`            | `RECEIVE`, `SPEND`, `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT`                                                                                                           | —            | [DOCUMENTED] |
| BankTransaction | `Status`          | `AUTHORISED`, `DELETED` (`DRAFT` in some flows)                                                                                                                                                                    | —            | [DOCUMENTED] |

---

_Generated from the investigation questionnaire, Phase 3. Field sets sourced from the official Xero OpenAPI spec; live response envelopes not yet captured against a real token._
