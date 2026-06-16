---
api_name: Xero Accounting API
api_slug: xero
companion_to: 01-llm-api-rules.md
content: entity catalog, relationships, Invoice state machine, business rules, formats, enums
confidence: field sets [DOCUMENTED] from official xero_accounting.yaml OpenAPI spec; live response envelopes (/Date()/ vs ISO per field) not captured against a real token — parse defensively
resource_naming: PascalCase + plural (/Invoices, /Contacts, /Accounts, /Payments, /BankTransactions); IDs are GUIDs; all *ID fields system-set
---

# Xero — Domain Model Reference

## Entity Catalog

### Invoice

Path: `/Invoices`, `/Invoices/{InvoiceID}`. Sales invoices (`ACCREC`, money owed **to** the org) and bills (`ACCPAY`, money the org **owes**); the single most important Xero entity. Read needs `accounting.transactions.read` (in registry); create/update need `accounting.transactions` (NOT in registry). No hard delete — VOIDED/DELETED via status change.

| Field                                     | Type     | Required(write) | Writable    | Description                                             | Example                                  |
| ----------------------------------------- | -------- | --------------- | ----------- | ------------------------------------------------------- | ---------------------------------------- |
| `InvoiceID`                               | GUID     | system          | no          | Unique id                                               | `"297c2dc5-cc47-4afd-8ec8-74990b8761e9"` |
| `Type`                                    | enum     | yes             | on create   | `ACCREC` / `ACCPAY`                                     | `"ACCREC"`                               |
| `InvoiceNumber`                           | string   | no              | yes         | Human number                                            | `"INV-0042"`                             |
| `Reference`                               | string   | no              | yes         | ACCREC reference                                        | `"PO-123"`                               |
| `Contact`                                 | object   | yes             | yes         | `{"ContactID":"..."}` or `{"Name":"..."}`               | —                                        |
| `Date`                                    | date     | no              | yes         | Invoice date                                            | `"2024-06-01"`                           |
| `DueDate`                                 | date     | no              | yes         | Due date                                                | `"2024-06-30"`                           |
| `LineItems`                               | array    | yes             | yes         | Description, Quantity, UnitAmount, AccountCode, TaxType | —                                        |
| `LineAmountTypes`                         | enum     | no              | yes         | `Exclusive` / `Inclusive` / `NoTax`                     | `"Exclusive"`                            |
| `Status`                                  | enum     | no              | via actions | see state machine                                       | `"AUTHORISED"`                           |
| `SubTotal`/`TotalTax`/`Total`             | decimal  | computed        | no          | server-computed totals                                  | `100.00`/`15.00`/`115.00`                |
| `AmountDue`/`AmountPaid`/`AmountCredited` | decimal  | computed        | no          | payment tracking                                        | `115.00`/`0.00`/`0.00`                   |
| `CurrencyCode`                            | string   | no              | yes         | ISO 4217                                                | `"NZD"`                                  |
| `UpdatedDateUTC`                          | datetime | system          | no          | last-modified — **key for incremental sync**            | `"/Date(1717272000000+0000)/"`           |
| `HasAttachments`                          | bool     | system          | no          | attachment flag                                         | `true`                                   |

Relationships: Contact N:1 (nested `Contact.ContactID` — customer for ACCREC, supplier for ACCPAY); Payment 1:N (nested `Payments[]`, applied payments); CreditNote 1:N (nested `CreditNotes[]`, allocated credits); Account N:1 per line (`LineItems[].AccountCode` → GL coding).

### Contact

Path: `/Contacts`, `/Contacts/{ContactID}`. Customers, suppliers, other parties (can be both customer and supplier). Read needs `accounting.contacts.read` (in registry); write needs `accounting.contacts`.

| Field                     | Type     | Writable | Description                           | Example          |
| ------------------------- | -------- | -------- | ------------------------------------- | ---------------- |
| `ContactID`               | GUID     | no       | Unique id                             | `"bd2270c3-..."` |
| `Name`                    | string   | yes      | Display name — **unique per org**     | `"ABC Ltd"`      |
| `ContactNumber`           | string   | yes      | External reference                    | `"C-001"`        |
| `FirstName`/`LastName`    | string   | yes      | Primary person                        | `"Jane"`/`"Doe"` |
| `EmailAddress`            | string   | yes      | Primary email                         | `"jane@abc.com"` |
| `ContactStatus`           | enum     | yes      | `ACTIVE` / `ARCHIVED` / `GDPRREQUEST` | `"ACTIVE"`       |
| `Addresses`/`Phones`      | array    | yes      | address & phone collections           | —                |
| `IsCustomer`/`IsSupplier` | bool     | no       | derived flags                         | `true`           |
| `UpdatedDateUTC`          | datetime | no       | last-modified                         | `"/Date(...)/"`  |

Relationships: 1:N to Invoice (nested `Contact.ContactID` on the invoice).

### Account (Chart of Accounts) — ⚠ needs `accounting.settings.read` (NOT in registry → 403 today)

Path: `/Accounts`, `/Accounts/{AccountID}`. GL accounts. Write needs `accounting.settings`.

| Field               | Type   | Writable        | Description                                                               | Example     |
| ------------------- | ------ | --------------- | ------------------------------------------------------------------------- | ----------- |
| `AccountID`         | GUID   | no              | Unique id                                                                 | —           |
| `Code`              | string | yes             | account code — referenced by `LineItems[].AccountCode`                    | `"200"`     |
| `Name`              | string | yes             | account name                                                              | `"Sales"`   |
| `Type`              | enum   | yes             | `BANK`,`REVENUE`,`EXPENSE`,`CURRENT`,`FIXED`,`EQUITY`,… (full enum below) | `"REVENUE"` |
| `Status`            | enum   | yes             | `ACTIVE` / `ARCHIVED` / `DELETED`                                         | `"ACTIVE"`  |
| `TaxType`           | string | yes             | default tax code                                                          | `"OUTPUT2"` |
| `BankAccountNumber` | string | yes (BANK only) | bank account number                                                       | —           |

Relationships: N:1 from Invoice/BankTransaction line items via `AccountCode`. A `Type=BANK` account is the `BankAccount` on a BankTransaction.

### Payment

Path: `/Payments`, `/Payments/{PaymentID}`. Payments against invoices, bills, credit notes, prepayments/overpayments. Read with `accounting.transactions.read`. Not edited — created or deleted/reversed (status `DELETED`).

| Field         | Type    | Writable | Description                                                         | Example           |
| ------------- | ------- | -------- | ------------------------------------------------------------------- | ----------------- |
| `PaymentID`   | GUID    | no       | Unique id                                                           | —                 |
| `Date`        | date    | yes      | payment date                                                        | `"2024-06-05"`    |
| `Amount`      | decimal | yes      | payment amount                                                      | `50.00`           |
| `Reference`   | string  | yes      | reference                                                           | `"Cheque 123"`    |
| `Invoice`     | object  | yes      | `{"InvoiceID":"..."}` doc being paid                                | —                 |
| `Account`     | object  | yes      | bank/clearing account `{"AccountID":"..."}`                         | —                 |
| `PaymentType` | enum    | no       | `ACCRECPAYMENT`,`ACCPAYPAYMENT`,`ARCREDITPAYMENT`,`APCREDITPAYMENT` | `"ACCRECPAYMENT"` |
| `Status`      | enum    | no       | `AUTHORISED` / `DELETED`                                            | `"AUTHORISED"`    |

Relationships: N:1 to Invoice (nested `Invoice.InvoiceID`); N:1 to Account (bank).

### BankTransaction

Path: `/BankTransactions`, `/BankTransactions/{BankTransactionID}`. Spend-money / receive-money transactions against bank accounts. Distinct from Payments and from imported bank statement lines. Read with `accounting.transactions.read`.

| Field                                | Type     | Writable | Description                                                                                         | Example         |
| ------------------------------------ | -------- | -------- | --------------------------------------------------------------------------------------------------- | --------------- |
| `BankTransactionID`                  | GUID     | no       | Unique id                                                                                           | —               |
| `Type`                               | enum     | yes      | `RECEIVE`,`SPEND`,`RECEIVE-OVERPAYMENT`,`RECEIVE-PREPAYMENT`,`SPEND-OVERPAYMENT`,`SPEND-PREPAYMENT` | `"SPEND"`       |
| `Status`                             | enum     | no       | `AUTHORISED`,`DELETED` (also `DRAFT` in some flows)                                                 | `"AUTHORISED"`  |
| `Contact`                            | object   | yes      | counterparty                                                                                        | —               |
| `BankAccount`                        | object   | yes      | `{"AccountID":"..."}` — must be a `Type=BANK` account                                               | —               |
| `LineItems`                          | array    | yes      | lines                                                                                               | —               |
| `IsReconciled`                       | bool     | no       | reconciliation flag                                                                                 | `false`         |
| `Date`/`SubTotal`/`TotalTax`/`Total` | mixed    | —        | standard amounts                                                                                    | —               |
| `UpdatedDateUTC`                     | datetime | no       | last-modified                                                                                       | `"/Date(...)/"` |

Relationships: N:1 to Account (`BankAccount`), N:1 to Contact, N:1 per line to Account via `AccountCode`.

## Entity Relationship Diagram

```
Connection  (GET /connections → tenantId; scopes ONE tenant via Xero-tenant-id header)
  └─> Organisation  (needs accounting.settings.read — 403 today)
        ├─ Contact ──1:N──> Invoice            (Contact = customer ACCREC / supplier ACCPAY)
        ├─ Account ──N:1(per line)──> Invoice, BankTransaction   (via AccountCode; Type=BANK = BankAccount)
        ├─ Invoice ──1:N──> Payment
        └─ BankTransaction ──N:1──> Account (BankAccount), Contact
```

## Invoice State Machine

```
[DRAFT] --submit--> [SUBMITTED] --approve--> [AUTHORISED] --(payments cover AmountDue)--> [PAID]
   |                     |                          |
   +--delete--> [DELETED]+                          +--void--> [VOIDED]
```

| From            | Action                               | To         | Reversible?           | Side effects                                                        |
| --------------- | ------------------------------------ | ---------- | --------------------- | ------------------------------------------------------------------- |
| DRAFT           | submit for approval                  | SUBMITTED  | yes                   | none                                                                |
| SUBMITTED       | approve                              | AUTHORISED | no                    | becomes real receivable/payable; affects ledger                     |
| AUTHORISED      | apply payment(s) until `AmountDue`=0 | PAID       | via deleting payments | reduces `AmountDue`                                                 |
| DRAFT/SUBMITTED | delete                               | DELETED    | no                    | removed from default lists                                          |
| AUTHORISED      | void                                 | VOIDED     | no                    | reverses ledger impact; **cannot void if payments/credits applied** |

Per-state: DRAFT — update yes, delete yes(→DELETED), actions edit/submit/authorise, fully mutable. SUBMITTED — update yes, delete yes(→DELETED), actions edit/approve. AUTHORISED — update limited (line items largely locked), delete no (void only), actions apply payment/void/attach. PAID — no update/delete, view only; remove payments to revert to AUTHORISED. VOIDED/DELETED — terminal, view only.

Payments & BankTransactions: simpler — `AUTHORISED` → `DELETED` (a status change, not a hard delete).

## Business Rules

- **Tenant scoping (the big one):** every data call targets exactly one tenant via `Xero-tenant-id`. One token may serve many orgs — choose/loop tenants explicitly; no implicit "current tenant".
- Invoice line items reference an existing `AccountCode` (chart of accounts) and `TaxType`.
- Payments reference an existing `InvoiceID` **and** a bank `Account`.
- `Contact.Name` unique within an org (duplicate → `ValidationException`). `InvoiceNumber` conventionally unique but Xero allows duplicates unless org settings forbid.
- Invoice `Total = SubTotal + TotalTax`, computed server-side from line items.
- Voiding an invoice reverses its ledger impact; cannot void if payments/credit notes applied (remove first).
- Computed/read-only (never send as input): `SubTotal`, `TotalTax`, `Total`, `AmountDue`, `AmountPaid`, `AmountCredited`, `UpdatedDateUTC`.
- Idempotency: create endpoints (POST/PUT) accept an `Idempotency-Key` request header (~24h window) for safe retries. See 01c.

## Field Format Reference

| Format                      | Pattern                     | Example                                | Notes                                               |
| --------------------------- | --------------------------- | -------------------------------------- | --------------------------------------------------- |
| Date (request)              | `YYYY-MM-DD`                | `2024-06-01`                           | accepted in JSON request bodies                     |
| DateTime (response, legacy) | `/Date(epoch_ms+tzoffset)/` | `/Date(1717272000000+0000)/`           | Microsoft JSON on many fields — parse defensively   |
| DateTime (`*UTC` fields)    | ISO-like                    | `2024-06-02T10:00:00`                  | `UpdatedDateUTC` etc. — **prefer for sync**         |
| Currency / decimal          | plain decimal               | `100.00`                               | no thousands separators; ISO 4217 in `CurrencyCode` |
| ID                          | GUID v4                     | `297c2dc5-cc47-4afd-8ec8-74990b8761e9` | all `*ID` fields                                    |
| Enum (status/type)          | UPPERCASE                   | `AUTHORISED`, `ACCREC`                 | status/type enums uppercase                         |
| `LineAmountTypes`           | PascalCase                  | `Exclusive`                            | exception — NOT uppercase                           |
| `where` DateTime literal    | `DateTime(y,m,d)`           | `DateTime(2024,06,01)`                 | inside the `where` filter (see 01b)                 |

## Enum Value Reference

All [DOCUMENTED] from the OpenAPI spec.

| Entity          | Field             | Allowed Values                                                                                                                                                                                                     | Default      |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Invoice         | `Type`            | `ACCPAY`, `ACCREC`                                                                                                                                                                                                 | —            |
| Invoice         | `Status`          | `DRAFT`, `SUBMITTED`, `DELETED`, `AUTHORISED`, `PAID`, `VOIDED`                                                                                                                                                    | `DRAFT`      |
| Invoice         | `LineAmountTypes` | `Exclusive`, `Inclusive`, `NoTax`                                                                                                                                                                                  | `Exclusive`  |
| Contact         | `ContactStatus`   | `ACTIVE`, `ARCHIVED`, `GDPRREQUEST`                                                                                                                                                                                | `ACTIVE`     |
| Account         | `Status`          | `ACTIVE`, `ARCHIVED`, `DELETED`                                                                                                                                                                                    | `ACTIVE`     |
| Account         | `Type`            | `BANK`, `CURRENT`, `CURRLIAB`, `DEPRECIATN`, `DIRECTCOSTS`, `EQUITY`, `EXPENSE`, `FIXED`, `INVENTORY`, `LIABILITY`, `NONCURRENT`, `OTHERINCOME`, `OVERHEADS`, `PREPAYMENT`, `REVENUE`, `SALES`, `TERMLIAB`, `PAYG` | —            |
| Payment         | `Status`          | `AUTHORISED`, `DELETED`                                                                                                                                                                                            | `AUTHORISED` |
| Payment         | `PaymentType`     | `ACCRECPAYMENT`, `ACCPAYPAYMENT`, `ARCREDITPAYMENT`, `APCREDITPAYMENT`, `AROVERPAYMENTPAYMENT`, `ARPREPAYMENTPAYMENT`, `APPREPAYMENTPAYMENT`, `APOVERPAYMENTPAYMENT`                                               | —            |
| BankTransaction | `Type`            | `RECEIVE`, `SPEND`, `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT`                                                                                                           | —            |
| BankTransaction | `Status`          | `AUTHORISED`, `DELETED` (`DRAFT` in some flows)                                                                                                                                                                    | —            |
