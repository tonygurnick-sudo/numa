---
api_name: Xero Accounting API
api_slug: xero
companion_to: 01-llm-api-rules.md
content: write surface — FUTURE reference only; documents what would unlock with write scopes
write_status: DISABLED. Registry scopes are read-only (openid profile email accounting.transactions.read accounting.contacts.read offline_access). Every write here needs a non-.read scope (accounting.transactions / accounting.contacts / accounting.settings) that is NOT granted → any POST/PUT/DELETE returns 403. Do NOT attempt them. If the user asks to create/edit/void an invoice/contact/payment, explain read-only and point to the Xero web UI.
confidence: field sets [DOCUMENTED] from Xero OpenAPI spec but NOT verified against a live write call — treat payloads as templates, test against a Demo Company first
---

# Xero — Mutation Patterns Reference (future / requires write scope)

## Write Capabilities (if write scopes added)

| Operation         | Supported | Method   | Notes                                                                  |
| ----------------- | --------- | -------- | ---------------------------------------------------------------------- |
| Create            | yes       | **PUT**  | **PUT = create new** (see quirks)                                      |
| Create-or-update  | yes       | **POST** | **POST = upsert by id** (include `*ID` to update, omit to create)      |
| Partial update    | partial   | PATCH    | limited resources (e.g. PATCH `/Contacts` to archive)                  |
| Delete            | no (real) | —        | deletes are **status changes** (`VOIDED`/`DELETED`), not HTTP DELETE   |
| Soft delete       | yes       | POST     | set `Status` to `DELETED` (DRAFT/SUBMITTED) or `VOIDED` (AUTHORISED)   |
| Bulk create       | yes       | POST/PUT | send an array, e.g. `{"Invoices":[...]}` (~60 items / 6MB soft limits) |
| Bulk update       | yes       | POST     | each item carries its `*ID`; upsert per item                           |
| State transitions | yes       | POST     | Status field update (no dedicated action endpoints)                    |
| File upload       | yes       | PUT/POST | attachments — needs `accounting.attachments` scope (also not granted)  |

## The Two Quirks You Must Internalise

Xero inverts the usual REST verbs. Getting this wrong creates **duplicate financial records**.

1. **PUT = create a new record.** `PUT /Invoices` always creates; it does NOT update by id.
2. **POST = create OR update (upsert).** `POST /Invoices` with an `InvoiceID` in the body **updates** that invoice; without one it **creates**. This is how you both create and edit.

So: to update, **POST with the id**; for a guaranteed fresh create, PUT (or POST without an id). When in doubt, POST with the id you fetched.

## Idempotency (use on every create)

Send a unique `Idempotency-Key` request header per logical operation; retries with the same key within ~24h return the original result instead of duplicating. Xero POST is not naturally idempotent — always pair creates with a key.

```http
POST /api.xro/2.0/Invoices
Authorization: Bearer {token}
Xero-tenant-id: {tenantId}
Idempotency-Key: numa-invoice-2024-06-15-INV0001
Content-Type: application/json
Accept: application/json
```

## Common Patterns

### Pattern 1: Create an invoice (PUT, or POST without id)

Prerequisites (all must already exist in the tenant): a `ContactID` (or new `Contact.Name`), an `AccountCode` from the chart of accounts, a valid `TaxType`. Reading the chart of accounts needs `accounting.settings.read` — also not granted, so even the lookups are blocked.

```http
POST /api.xro/2.0/Invoices
Xero-tenant-id: {tenantId}
Idempotency-Key: {unique-key}
Content-Type: application/json
Accept: application/json

{"Invoices":[{"Type":"ACCREC","Contact":{"ContactID":"bd2270c3-..."},"Date":"2024-06-15","DueDate":"2024-06-30","LineAmountTypes":"Exclusive","Reference":"PO-123","LineItems":[{"Description":"Consulting — June 2024","Quantity":10.0,"UnitAmount":100.0,"AccountCode":"200","TaxType":"OUTPUT2"}],"Status":"DRAFT"}]}
```

Response (200 OK): `{"Status":"OK","Invoices":[{"InvoiceID":"297c2dc5-cc47-4afd-8ec8-74990b8761e9","InvoiceNumber":"INV-0042","Status":"DRAFT","SubTotal":1000.0,"TotalTax":150.0,"Total":1150.0,"AmountDue":1150.0}]}`

- **Required:** `Type`, `Contact`, `LineItems` (each line needs `AccountCode`; description/quantity/unitamount as applicable).
- **Server-generated:** `InvoiceID`, `InvoiceNumber` (if org auto-numbers), `SubTotal`/`TotalTax`/`Total`/`AmountDue`.
- Use `Idempotency-Key`.

### Pattern 2: Update an invoice (POST with the id)

```http
POST /api.xro/2.0/Invoices
Xero-tenant-id: {tenantId}
Content-Type: application/json

{"Invoices":[{"InvoiceID":"297c2dc5-cc47-4afd-8ec8-74990b8761e9","Reference":"PO-123-revised","DueDate":"2024-07-15"}]}
```

Include the `InvoiceID` → Xero updates that invoice. Only AUTHORISED invoices with no payments can have line items changed; otherwise edits are limited (see invoice state machine in 01a).

### Pattern 3: Approve / void / delete an invoice (state transition via Status)

No dedicated action endpoints — transition by POSTing the id with a new `Status`. Valid transitions: invoice state machine in 01a. Void fails if payments or credit notes are applied — remove first.

```http
# Approve a draft (DRAFT/SUBMITTED → AUTHORISED)
POST /api.xro/2.0/Invoices
{"Invoices":[{"InvoiceID":"297c...","Status":"AUTHORISED"}]}

# Void an authorised invoice (no payments/credits applied)
POST /api.xro/2.0/Invoices
{"Invoices":[{"InvoiceID":"297c...","Status":"VOIDED"}]}

# Delete a draft
POST /api.xro/2.0/Invoices
{"Invoices":[{"InvoiceID":"297c...","Status":"DELETED"}]}
```

### Pattern 4: Create a contact

```http
PUT /api.xro/2.0/Contacts
Xero-tenant-id: {tenantId}
Idempotency-Key: {unique-key}
Content-Type: application/json

{"Contacts":[{"Name":"Acme Ltd","FirstName":"Jane","LastName":"Doe","EmailAddress":"jane@acme.com","Addresses":[{"AddressType":"STREET","City":"Auckland","Country":"New Zealand"}],"Phones":[{"PhoneType":"DEFAULT","PhoneNumber":"09 123 4567"}]}]}
```

`Contact.Name` must be **unique within the org** — a duplicate returns a `ValidationException`.

### Pattern 5: Archive a contact (Status)

```http
POST /api.xro/2.0/Contacts
{"Contacts":[{"ContactID":"bd2270c3-...","ContactStatus":"ARCHIVED"}]}
```

Soft-delete only — there is no hard delete for contacts.

### Pattern 6: Record a payment against an invoice

```http
PUT /api.xro/2.0/Payments
Xero-tenant-id: {tenantId}
Idempotency-Key: {unique-key}
Content-Type: application/json

{"Payments":[{"Invoice":{"InvoiceID":"297c2dc5-..."},"Account":{"AccountID":"f1a2b3c4-..."},"Date":"2024-06-20","Amount":1150.0,"Reference":"Bank transfer"}]}
```

Prerequisites: the `InvoiceID` must be AUTHORISED, and `Account` must be a `Type=BANK` account. Applying a payment that covers `AmountDue` moves the invoice to `PAID`. Deleting the payment (Status → `DELETED`) reverts it to `AUTHORISED`.

## Bulk Create / Update

Array under the resource key. Partial-success depends on `summarizeErrors`:

```http
POST /api.xro/2.0/Invoices?summarizeErrors=false
{"Invoices":[{...},{...},{...}]}
```

- `summarizeErrors=false` → per-item results; failed items carry their own `ValidationErrors[]` and a `StatusAttributeString`, good items still persist (partial success).
- default (`true`) → the **whole batch is rejected** on the first error.
- Soft limits: ~60 items / 6MB request body.

## Field Validation Rules (selected)

| Entity  | Field                     | Rule                                                 | Error if violated                          |
| ------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Invoice | `Contact`                 | must reference an existing `ContactID` or new `Name` | `ValidationException` "Contact required"   |
| Invoice | `LineItems[].AccountCode` | must be an existing active account code              | `ValidationException` invalid account code |
| Invoice | `LineItems[].TaxType`     | must be a valid tax type for the org                 | `ValidationException` invalid tax type     |
| Contact | `Name`                    | unique per org                                       | `ValidationException` duplicate name       |
| Payment | `Invoice`                 | invoice must be AUTHORISED                           | `ValidationException` invalid status       |
| Payment | `Account`                 | must be a `Type=BANK` account                        | `ValidationException` invalid account      |

## Server-Side Defaults

| Entity  | Field                                     | Default             | When applied        |
| ------- | ----------------------------------------- | ------------------- | ------------------- |
| Invoice | `InvoiceID`                               | auto-generated GUID | create              |
| Invoice | `InvoiceNumber`                           | org auto-numbering  | create (if enabled) |
| Invoice | `Status`                                  | `DRAFT`             | create (if omitted) |
| Invoice | `LineAmountTypes`                         | `Exclusive`         | create (if omitted) |
| Invoice | `SubTotal`/`TotalTax`/`Total`/`AmountDue` | computed from lines | create, update      |
| any     | `UpdatedDateUTC`                          | server timestamp    | create, update      |

## Worked Example: create, then mark paid

"Raise a $1,150 invoice for Acme and record their payment." (Only possible with write scopes enabled.)

```http
# 1. Create AUTHORISED invoice (idempotent)
POST /api.xro/2.0/Invoices
Idempotency-Key: numa-acme-INV0042
{"Invoices":[{"Type":"ACCREC","Contact":{"ContactID":"bd2270c3-..."},"Date":"2024-06-15","DueDate":"2024-06-30","LineItems":[{"Description":"Consulting","Quantity":10,"UnitAmount":100,"AccountCode":"200","TaxType":"OUTPUT2"}],"Status":"AUTHORISED"}]}
# → returns InvoiceID 297c..., AmountDue 1150.00

# 2. Record full payment from a bank account
PUT /api.xro/2.0/Payments
Idempotency-Key: numa-acme-PAY0042
{"Payments":[{"Invoice":{"InvoiceID":"297c..."},"Account":{"AccountID":"f1a2b3c4-..."},"Date":"2024-06-20","Amount":1150.0}]}
# → invoice transitions to PAID (AmountDue 0.00)
```

## Gotchas

1. **PUT creates, POST upserts.** The headline quirk — never "PUT to update". To edit, POST with the `*ID`.
2. **No HTTP DELETE.** Removal is a status change (`DELETED`/`VOIDED`).
3. **Computed totals are read-only.** Never send `Total`/`SubTotal`/`AmountDue` — derived from line items.
4. **Always send `Idempotency-Key` on creates** — POST is not naturally idempotent; a retried create without it duplicates the record.
5. **Lookups themselves may be blocked.** Creating an invoice needs a valid `AccountCode`/`TaxType`, but reading `/Accounts` and `/TaxRates` needs `accounting.settings.read` — also not granted. Enabling writes realistically means enabling settings reads too.

## Dangerous Operations

All currently blocked by read-only scopes. If writes are ever enabled, the agent must **confirm with the user before executing** any of these:

| Operation                              | Why dangerous                                      | Safeguard                                        |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| POST/PUT `/Invoices` (create/edit)     | creates real financial records; affects the ledger | confirm payload + tenant; use `Idempotency-Key`  |
| Set `Status:"VOIDED"`/`"DELETED"`      | reverses ledger impact; effectively irreversible   | confirm; check no payments/credits applied first |
| PUT `/Payments` (record payment)       | moves an invoice to PAID; affects bank balances    | confirm invoice id + bank account + amount       |
| Bulk POST with `summarizeErrors=false` | partial success — some persist, some fail silently | surface per-item `ValidationErrors` to the user  |
