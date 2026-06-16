# Xero Accounting API Integration

## Action Keys

All action keys use the form `xero_accounting_api-{name}`. Do not invent or paraphrase action keys. If an operation you need is not named explicitly in this prompt, read `/workdir/tools/integrations/xero_accounting_api/_index.json` to find the exact key. Common keys that the model frequently gets wrong:

- Create a sales invoice → `xero_accounting_api-xero-create-sales-invoice` (the `xero-` prefix is part of the key, not a typo)
- Upload a file attachment → `xero_accounting_api-upload-file` (not `upload-file-to-xero`)
- Direct REST passthrough → `xero_accounting_api-make-an-api-call`

## Essential First Step

Before performing Xero operations, establish context:

- Resolve `tenantId` via `configure_props` or `get-tenant-connections` — if multiple organizations exist, ask the user which one
- For invoice/contact operations, resolve `contactId` via `configure_props` after setting `tenantId`

## Auth Structure

**Auth key varies by action:**

```json
// For xero-create-sales-invoice ONLY:
{"xero": {"authProvisionId": "auto"}, "tenantId": "...", ...}

// For ALL other actions:
{"xeroAccountingApi": {"authProvisionId": "auto"}, "tenantId": "...", ...}
```

Always check the schema's first prop name field to determine which auth key to use.

## Critical Gotchas

### lineItems Format is Inconsistent

Different actions expect different formats for the `lineItems` prop:

**string[] (array of JSON strings):** `xero-create-sales-invoice`, `xero-create-purchase-bill`, `create-bill`, `add-line-item-to-invoice`

```json
{
  "lineItems": [
    "{\"Description\":\"Service fee\",\"Quantity\":\"1\",\"UnitAmount\":\"100.00\",\"AccountCode\":\"200\"}",
    "{\"Description\":\"Consulting\",\"Quantity\":\"2\",\"UnitAmount\":\"150.00\",\"AccountCode\":\"200\"}"
  ]
}
```

**object[] (direct array of objects):** `create-credit-note`, `create-bank-transaction`

```json
{
  "lineItems": [{ "Description": "Credit item", "Quantity": "1", "UnitAmount": "25.00", "AccountCode": "200" }]
}
```

### lineAmountType Casing: "Exclusive", Not "EXCLUSIVE"

`lineAmountTypes` / `lineAmountType` is case-sensitive title case: `"Exclusive"`, `"Inclusive"`, `"NoTax"`. All-caps (`"EXCLUSIVE"`) is rejected with a validation error. Default is `Exclusive` when omitted.

### List Account Codes Before Creating Bills/Invoices

A line item's `AccountCode` must be a real code from the org's chart of accounts (e.g. `200`, `400`) — a guessed code fails validation or, worse, silently posts to the wrong account. Before creating a bill/invoice, list the accounts (`get-accounts`, or `make-an-api-call` on `/Accounts`) and use a real code. If you can't determine the right account, ask rather than guess.

### make-an-api-call Requires Leading Slash

The `relativeUrl` must start with `/` (e.g., `/Invoices`, `/Contacts`, `/Items`). Without it, the URL is malformed:

- `"relativeUrl": "Invoices"` -> `api.xro/2.0Invoices` (404 error)
- `"relativeUrl": "/Invoices"` -> `api.xro/2.0/Invoices`

### AUTHORISED Invoices Require Due Date

When creating invoices with `status: "AUTHORISED"` or `"SUBMITTED"`, the `dueDate` field is required. DRAFT invoices don't require it:

```json
{
  "status": "AUTHORISED",
  "dueDate": "2026-02-28"
}
```

### Invoice Numbers Not Unique Across Types

Sales invoices (ACCREC) and bills (ACCPAY) can share the same invoice number. Use `get-invoice` with `invoiceId` for precision rather than `find-invoice` by number.

### Downloading Invoice PDFs

Include `stash_id="NEW"` when calling `download-invoice`:

```python
mcp__integrations__run_action(
  action_key="xero_accounting_api-download-invoice",
  props='{"xeroAccountingApi":{"authProvisionId":"auto"},"tenantId":"...","invoiceId":"..."}',
  stash_id="NEW"
)
```

The PDF lands in `/workdir/tmp/integrations-results/{invoiceId}.pdf` (scratch — hidden from the user's Files page). If the user asked for the PDF as a deliverable, `cp` it to `/workdir/outputs/`.

### Contact Finder Actions Use String Not Boolean

Both `find-or-create-contact` and `find-contact` use string values `"Yes"` or `"No"` for `createContactIfNotFound`, not boolean:

```json
{ "createContactIfNotFound": "Yes" }
```

### find-invoice: At Least One Search Field Required

Both `invoiceNumber` and `reference` are optional, but at least one must be provided:

```json
{"invoiceNumber": "INV-0020"}
{"reference": "PO-12345"}
```

### create-item: Code is Required, Name is Optional

When creating items, `code` is required but `name` is optional (counterintuitive):

```json
{
  "code": "PROD-001",
  "name": "Product Name",
  "description": "..."
}
```

### create-payment: Hidden Required Fields

All target fields (`invoiceId`, `creditNoteId`, etc.) are marked optional, but at least one is required. Similarly, either `accountId` or `accountCode` must be provided for the payment account.

## Deleting vs Voiding Records

No dedicated delete actions exist. Use `make-an-api-call`, but note the status depends on the current state:

**DRAFT Invoices/Bills -> DELETED:**

```json
{
  "requestMethod": "post",
  "relativeUrl": "/Invoices",
  "requestBody": { "Invoices": [{ "InvoiceID": "...", "Status": "DELETED" }] }
}
```

**AUTHORISED/SUBMITTED Invoices -> VOIDED (cannot be DELETED):**

```json
{
  "requestMethod": "post",
  "relativeUrl": "/Invoices",
  "requestBody": { "Invoices": [{ "InvoiceID": "...", "Status": "VOIDED" }] }
}
```

**Credit Notes (DRAFT only):**

```json
{
  "requestMethod": "post",
  "relativeUrl": "/CreditNotes",
  "requestBody": { "CreditNotes": [{ "CreditNoteID": "...", "Status": "DELETED" }] }
}
```

**Items:**

```json
{
  "requestMethod": "delete",
  "relativeUrl": "/Items/{ItemID}"
}
```

**Contacts:** Cannot be deleted, only archived (`contactStatus: "ARCHIVED"`).

## Emailing Invoices

The `email-an-invoice` action sends the invoice to the contact's email address — you cannot specify a custom recipient. Requirements:

- Invoice must be Type `ACCREC` (sales invoice)
- Status must be `SUBMITTED`, `AUTHORISED`, or `PAID`
- The contact must have an email address set
- Returns empty string on success (no response body)

## Type Reference

### Credit Note Types

- `ACCRECCREDIT` — Customer credit note (reduces accounts receivable)
- `ACCPAYCREDIT` — Supplier credit note (reduces accounts payable)

### Bank Transaction Types

- `RECEIVE` — Money received
- `SPEND` — Money spent
- `RECEIVE-OVERPAYMENT`, `RECEIVE-PREPAYMENT`, `SPEND-OVERPAYMENT`, `SPEND-PREPAYMENT` — For advance payments

## Useful Patterns

### get-contact: Flexible Identifier

The `contactIdentifier` prop accepts either a ContactID (UUID) or ContactNumber (custom identifier):

```json
{"contactIdentifier": "297c2dc5-cc47-4afd-8ec8-74990b8761e9"}
{"contactIdentifier": "CUST100"}
```

### create-history-note: Document Types and Limits

Use `endpoint` for the document type and `guid` for the document ID. The `details` field has a 250 character limit:

```json
{
  "endpoint": "Invoices",
  "guid": "invoice-uuid-here",
  "details": "Note text (max 250 chars)"
}
```

Supported endpoints: BankTransactions, BatchPayments, Contacts, CreditNotes, Invoices, Items, ManualJournals, Overpayments, Payments, Prepayments, PurchaseOrders, RepeatingInvoices, Quotes.

### Uploading File Attachments

**Action key:** `xero_accounting_api-upload-file`. The variant `upload-file-to-xero` does not exist in Pipedream and will return 404.

Use workspace paths directly in `filePathOrUrl` — they're automatically converted:

```python
mcp__integrations__run_action(
  action_key="xero_accounting_api-upload-file",
  props='{"xeroAccountingApi":{"authProvisionId":"auto"},"tenantId":"...","filePathOrUrl":"/workdir/outputs/invoice.pdf","documentType":"Invoices","documentId":"invoice-uuid-here"}'
)
```

### Creating Invoices with New Contacts

Use `contactName` instead of `contactId` to auto-create a contact if it doesn't exist. Works on `xero-create-sales-invoice`, `xero-create-purchase-bill`, `create-credit-note`, and `create-bank-transaction`.

### Discovering Bank Account IDs

For `get-bank-summary` or `create-bank-transaction`, discover bank account IDs via:

```json
{
  "requestMethod": "get",
  "relativeUrl": "/Accounts"
}
```

Then filter for accounts where `Type` is `"BANK"`.
