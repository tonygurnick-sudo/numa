---
api_name: 'Xero Accounting API'
api_slug: 'xero'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Xero Accounting API -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`.
>
> ## ⚠️ WRITES ARE DISABLED IN THIS CONNECTOR (read-only as configured)
>
> The registry scopes are **read-only**:
> `openid profile email accounting.transactions.read accounting.contacts.read offline_access`.
>
> Every write below requires a non-`.read` scope (`accounting.transactions`,
> `accounting.contacts`, `accounting.settings`) that is **not granted**. As shipped, any
> POST/PUT/DELETE here returns **403 Forbidden** — do not attempt them. If the user asks to
> create/edit/void an invoice, contact, or payment, explain it is read-only and point them
> to the Xero web UI.
>
> This file documents the write surface for a **future** decision to enable writes. Field
> sets are `[DOCUMENTED]` from the Xero OpenAPI spec but **not verified against a live
> write call** — treat payloads as templates, not drop-ins, and test against a Demo Company
> first.

---

## Write Capabilities Summary (if write scopes are added)

| Operation         | Supported | Method   | Notes                                                                       |
| ----------------- | --------- | -------- | --------------------------------------------------------------------------- |
| Create            | yes       | **PUT**  | **PUT = create new** in Xero (see quirk below)                              |
| Create-or-update  | yes       | **POST** | **POST = upsert by id** (include the `*ID` to update, omit it to create)    |
| Partial update    | partial   | PATCH    | Limited resources (e.g. PATCH `/Contacts` to archive)                       |
| Delete            | no (real) | —        | Deletes are **status changes** (`VOIDED` / `DELETED`), not HTTP DELETE      |
| Soft delete       | yes       | POST     | Set `Status` to `DELETED` (DRAFT/SUBMITTED) or `VOIDED` (AUTHORISED)        |
| Bulk create       | yes       | POST/PUT | Send an array, e.g. `{ "Invoices": [ ... ] }` (~60 items / 6MB soft limits) |
| Bulk update       | yes       | POST     | Each item carries its `*ID`; upsert per item                                |
| State transitions | yes       | POST     | Status field update (no dedicated action endpoints)                         |
| File upload       | yes       | PUT/POST | Attachments — needs `accounting.attachments` scope (also not granted)       |

---

## The Two Quirks You Must Internalise

> Xero inverts the usual REST verbs. Getting this wrong creates **duplicate financial records**.

1. **PUT = create a new record.** `PUT /Invoices` always creates. It does NOT update by id.
2. **POST = create OR update (upsert).** `POST /Invoices` with an `InvoiceID` in the body **updates** that invoice; without one it **creates**. This is how you both create and edit.

So: to update, **POST with the id**; to guarantee a fresh create, PUT (or POST without an id). When in doubt, POST with the id you fetched.

---

## Idempotency (use it on every create)

Xero supports an `Idempotency-Key` request header on create endpoints. Send a unique key per logical operation; retries with the same key within ~24h return the original result instead of duplicating.

```http
POST /api.xro/2.0/Invoices
Authorization: Bearer {token}
Xero-tenant-id: {tenantId}
Idempotency-Key: numa-invoice-2024-06-15-INV0001
Content-Type: application/json
Accept: application/json
```

Always pair creates with an idempotency key — Xero POST is not naturally idempotent.

---

## Common Patterns

### Pattern 1: Create an invoice (PUT or POST without id)

**Prerequisites (all must already exist in the tenant):** a `ContactID` (or new `Contact.Name`), an `AccountCode` from the chart of accounts, and a valid `TaxType`. **Note:** reading the chart of accounts needs `accounting.settings.read` — which is also not granted today, so even the lookups are blocked as configured.

```http
POST /api.xro/2.0/Invoices
Xero-tenant-id: {tenantId}
Idempotency-Key: {unique-key}
Content-Type: application/json
Accept: application/json

{
  "Invoices": [
    {
      "Type": "ACCREC",
      "Contact": { "ContactID": "bd2270c3-..." },
      "Date": "2024-06-15",
      "DueDate": "2024-06-30",
      "LineAmountTypes": "Exclusive",
      "Reference": "PO-123",
      "LineItems": [
        {
          "Description": "Consulting — June 2024",
          "Quantity": 10.0,
          "UnitAmount": 100.0,
          "AccountCode": "200",
          "TaxType": "OUTPUT2"
        }
      ],
      "Status": "DRAFT"
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "Status": "OK",
  "Invoices": [
    {
      "InvoiceID": "297c2dc5-cc47-4afd-8ec8-74990b8761e9",
      "InvoiceNumber": "INV-0042",
      "Status": "DRAFT",
      "SubTotal": 1000.0,
      "TotalTax": 150.0,
      "Total": 1150.0,
      "AmountDue": 1150.0
    }
  ]
}
```

**Required fields:** `Type`, `Contact`, `LineItems` (each line needs `AccountCode`; description/quantity/unitamount as applicable).
**Server-generated:** `InvoiceID`, `InvoiceNumber` (if org auto-numbers), `SubTotal`/`TotalTax`/`Total`/`AmountDue`.
**Idempotency:** use `Idempotency-Key`.

---

### Pattern 2: Update an invoice (POST with the id)

```http
POST /api.xro/2.0/Invoices
Xero-tenant-id: {tenantId}
Content-Type: application/json

{
  "Invoices": [
    {
      "InvoiceID": "297c2dc5-cc47-4afd-8ec8-74990b8761e9",
      "Reference": "PO-123-revised",
      "DueDate": "2024-07-15"
    }
  ]
}
```

**Behavior:** Include the `InvoiceID` → Xero updates that invoice. Only AUTHORISED invoices with no payments can have line items changed; otherwise edits are limited (see the invoice state machine in 01a).

---

### Pattern 3: Approve / void an invoice (state transition via Status)

There are **no dedicated action endpoints** — you transition by POSTing the id with a new `Status`.

```http
# Approve a draft (DRAFT/SUBMITTED → AUTHORISED)
POST /api.xro/2.0/Invoices
{ "Invoices": [ { "InvoiceID": "297c...", "Status": "AUTHORISED" } ] }

# Void an authorised invoice (no payments/credits applied)
POST /api.xro/2.0/Invoices
{ "Invoices": [ { "InvoiceID": "297c...", "Status": "VOIDED" } ] }

# Delete a draft
POST /api.xro/2.0/Invoices
{ "Invoices": [ { "InvoiceID": "297c...", "Status": "DELETED" } ] }
```

Valid transitions: see the Invoice state machine in `01a-domain-model-reference.md`. Void fails if payments or credit notes are applied — remove them first.

---

### Pattern 4: Create a contact

```http
PUT /api.xro/2.0/Contacts
Xero-tenant-id: {tenantId}
Idempotency-Key: {unique-key}
Content-Type: application/json

{
  "Contacts": [
    {
      "Name": "Acme Ltd",
      "FirstName": "Jane",
      "LastName": "Doe",
      "EmailAddress": "jane@acme.com",
      "Addresses": [ { "AddressType": "STREET", "City": "Auckland", "Country": "New Zealand" } ],
      "Phones": [ { "PhoneType": "DEFAULT", "PhoneNumber": "09 123 4567" } ]
    }
  ]
}
```

**Validation:** `Contact.Name` must be **unique within the org** — a duplicate returns a `ValidationException`.

---

### Pattern 5: Archive a contact (PATCH or Status)

```http
POST /api.xro/2.0/Contacts
{ "Contacts": [ { "ContactID": "bd2270c3-...", "ContactStatus": "ARCHIVED" } ] }
```

Soft-delete only — there is no hard delete for contacts.

---

### Pattern 6: Record a payment against an invoice

```http
PUT /api.xro/2.0/Payments
Xero-tenant-id: {tenantId}
Idempotency-Key: {unique-key}
Content-Type: application/json

{
  "Payments": [
    {
      "Invoice": { "InvoiceID": "297c2dc5-..." },
      "Account": { "AccountID": "f1a2b3c4-..." },
      "Date": "2024-06-20",
      "Amount": 1150.0,
      "Reference": "Bank transfer"
    }
  ]
}
```

**Prerequisites:** the `InvoiceID` must be AUTHORISED, and `Account` must be a `Type=BANK` account. Applying a payment that covers `AmountDue` moves the invoice to `PAID`. Deleting the payment (Status → `DELETED`) reverts it to `AUTHORISED`.

---

## Bulk Create / Update

Send an array under the resource key. Partial-success behaviour depends on `SummarizeErrors`:

```http
POST /api.xro/2.0/Invoices?summarizeErrors=false
{ "Invoices": [ { ... }, { ... }, { ... } ] }
```

- `summarizeErrors=false` → per-item results; failed items carry their own `ValidationErrors[]` and a `StatusAttributeString`, good items still persist (partial success).
- default (`true`) → the **whole batch is rejected** on the first error.
- Soft limits: ~60 items / 6MB request body.

---

## Field Validation Rules (selected)

| Entity  | Field                     | Rule                                                 | Error if Violated                          |
| ------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Invoice | `Contact`                 | must reference an existing `ContactID` or new `Name` | `ValidationException` "Contact required"   |
| Invoice | `LineItems[].AccountCode` | must be an existing active account code              | `ValidationException` invalid account code |
| Invoice | `LineItems[].TaxType`     | must be a valid tax type for the org                 | `ValidationException` invalid tax type     |
| Contact | `Name`                    | unique per org                                       | `ValidationException` duplicate name       |
| Payment | `Invoice`                 | invoice must be AUTHORISED                           | `ValidationException` invalid status       |
| Payment | `Account`                 | must be a `Type=BANK` account                        | `ValidationException` invalid account      |

---

## Server-Side Defaults

| Entity  | Field                                     | Default Value       | When Applied        |
| ------- | ----------------------------------------- | ------------------- | ------------------- |
| Invoice | `InvoiceID`                               | auto-generated GUID | create              |
| Invoice | `InvoiceNumber`                           | org auto-numbering  | create (if enabled) |
| Invoice | `Status`                                  | `DRAFT`             | create (if omitted) |
| Invoice | `LineAmountTypes`                         | `Exclusive`         | create (if omitted) |
| Invoice | `SubTotal`/`TotalTax`/`Total`/`AmountDue` | computed from lines | create, update      |
| any     | `UpdatedDateUTC`                          | server timestamp    | create, update      |

---

## Worked Example: create, then mark paid

> "Raise a $1,150 invoice for Acme and record their payment." (Only possible with write scopes enabled.)

```http
# 1. Create AUTHORISED invoice (idempotent)
POST /api.xro/2.0/Invoices
Idempotency-Key: numa-acme-INV0042
{ "Invoices": [ {
    "Type": "ACCREC",
    "Contact": { "ContactID": "bd2270c3-..." },
    "Date": "2024-06-15", "DueDate": "2024-06-30",
    "LineItems": [ { "Description": "Consulting", "Quantity": 10, "UnitAmount": 100, "AccountCode": "200", "TaxType": "OUTPUT2" } ],
    "Status": "AUTHORISED"
} ] }
# → returns InvoiceID 297c..., AmountDue 1150.00

# 2. Record full payment from a bank account
PUT /api.xro/2.0/Payments
Idempotency-Key: numa-acme-PAY0042
{ "Payments": [ {
    "Invoice": { "InvoiceID": "297c..." },
    "Account": { "AccountID": "f1a2b3c4-..." },
    "Date": "2024-06-20", "Amount": 1150.0
} ] }
# → invoice transitions to PAID (AmountDue 0.00)
```

---

## Gotchas & Counter-Exceptions

1. **PUT creates, POST upserts.** The headline quirk — never "PUT to update". To edit, POST with the `*ID`.
2. **No HTTP DELETE.** Removal is a status change (`DELETED`/`VOIDED`). DELETE verbs are not the deletion path.
3. **Computed totals are read-only.** Never send `Total`/`SubTotal`/`AmountDue` — they're derived from line items.
4. **Always send `Idempotency-Key` on creates** — POST is not naturally idempotent; a retried create without it duplicates the record.
5. **Lookups themselves may be blocked.** Creating an invoice needs a valid `AccountCode`/`TaxType`, but reading `/Accounts` and `/TaxRates` needs `accounting.settings.read` — also not granted. Enabling writes realistically means enabling settings reads too.

---

## Dangerous Operations

> All currently blocked by read-only scopes. If writes are ever enabled, the workspace
> agent must **confirm with the user before executing** any of these.

| Operation                              | Why Dangerous                                              | Safeguard                                                 |
| -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| POST/PUT `/Invoices` (create/edit)     | Creates real financial records; affects the ledger         | Confirm payload + tenant with user; use `Idempotency-Key` |
| Set `Status: "VOIDED"` / `"DELETED"`   | Reverses ledger impact; effectively irreversible           | Confirm; check no payments/credits applied first          |
| PUT `/Payments` (record payment)       | Moves an invoice to PAID; affects bank balances            | Confirm invoice id + bank account + amount with user      |
| Bulk POST with `summarizeErrors=false` | Partial success — some records persist, some fail silently | Surface per-item `ValidationErrors` to the user           |

---

_Generated from the investigation questionnaire, Phases 3-4. Writes are out-of-scope with the current read-only registry scopes; payloads are spec-sourced templates, not live-verified._
