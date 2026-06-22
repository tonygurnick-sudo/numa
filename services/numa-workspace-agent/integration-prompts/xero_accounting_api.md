# Xero Accounting API Integration

## Action Keys

All action keys use the form `xero_accounting_api-{name}`. Do not invent or paraphrase action keys. If an operation you need is not named explicitly in this prompt, read `/workdir/tools/integrations/xero_accounting_api/_index.json` to find the exact key. Common keys that the model frequently gets wrong:

- Create a sales invoice → `xero_accounting_api-xero-create-sales-invoice` (the `xero-` prefix is part of the key, not a typo)
- Create a purchase bill (full-featured) → `xero_accounting_api-xero-create-purchase-bill`
- Create a purchase bill (simpler, contact by ID) → `xero_accounting_api-create-bill`
- Upload a file attachment → `xero_accounting_api-upload-file` (not `upload-file-to-xero`)
- Direct REST passthrough → `xero_accounting_api-make-an-api-call`

## Essential First Step

Before performing Xero operations, establish context:

- Resolve `tenantId` via `numa integrations pipedream-props-options xero_accounting_api <action> tenantId --xeroAccountingApi '{"authProvisionId":"auto"}'` or `get-tenant-connections` — if multiple organizations exist, ask the user which one
- For invoice/contact operations, resolve `contactId` via `pipedream-props-options` (pass `tenantId` in the configured props) after setting `tenantId`

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

Different actions expect different formats for the `lineItems` prop (verified against the live schemas):

**string[] (array of JSON strings):** `xero-create-sales-invoice`, `create-bill`, `add-line-item-to-invoice`

```json
{
  "lineItems": [
    "{\"Description\":\"Service fee\",\"Quantity\":\"1\",\"UnitAmount\":\"100.00\",\"AccountCode\":\"200\"}",
    "{\"Description\":\"Consulting\",\"Quantity\":\"2\",\"UnitAmount\":\"150.00\",\"AccountCode\":\"200\"}"
  ]
}
```

**`object` (array of objects):** `create-credit-note`, `create-bank-transaction`

```json
{
  "lineItems": [{ "Description": "Credit item", "Quantity": "1", "UnitAmount": "25.00", "AccountCode": "200" }]
}
```

**`any` (either form works):** `xero-create-purchase-bill` — its schema type is `any`; an object array `[{...}]` is the cleanest. (The other create-bill, `create-bill`, is `string[]`.)

### ⚠️ `add-line-item-to-invoice` REPLACES line items — it does not append

Despite the name, this action **overwrites the invoice's entire `LineItems` set** with the array you pass — any existing lines are lost (this is how Xero's Invoices endpoint works: the collection is replaced wholesale). To genuinely _add_ a line: `get-invoice` first, take its existing `LineItems`, merge in the new one(s), and pass the **full** combined set.

### lineAmountType Casing: "Exclusive", Not "EXCLUSIVE"

`lineAmountTypes` / `lineAmountType` is case-sensitive title case: `"Exclusive"`, `"Inclusive"`, `"NoTax"`. All-caps (`"EXCLUSIVE"`) is rejected with a validation error. Default is `Exclusive` when omitted.

### List Account Codes Before Creating Bills/Invoices

A line item's `AccountCode` must be a real code from the org's chart of accounts (e.g. `200`, `400`) — a guessed code fails validation or, worse, silently posts to the wrong account. Before creating a bill/invoice, list the accounts (`get-accounts`, or `make-an-api-call` on `/Accounts`) and use a real code. If you can't determine the right account, ask rather than guess.

### make-an-api-call: leading slash + `queryString` must be an OBJECT

The `relativeUrl` must start with `/` (e.g., `/Invoices`, `/Contacts`, `/Items`). Without it, the URL is malformed:

- `"relativeUrl": "Invoices"` -> `api.xro/2.0Invoices` (404 error)
- `"relativeUrl": "/Invoices"` -> `api.xro/2.0/Invoices`

`queryString` is labelled a string in the schema but **must be passed as a JSON object** — a plain string fails with `target must be an object` (verified):

```json
{ "queryString": { "where": "Type==\"BANK\"" } }   // ✓
{ "queryString": "where=Type==\"BANK\"" }            // ✗ "target must be an object"
```

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

### get-invoice-online-url is ACCREC-only (silent failure on bills)

`get-invoice-online-url` only works for **ACCREC** (sales) invoices. Called on an **ACCPAY** bill it doesn't error — it returns an empty `ret: {}` with a "No invoice found" summary. Don't offer an online URL for purchase bills.

### Downloading Invoice PDFs

Pass `--stash-id NEW` when calling `download-invoice`:

```bash
numa integrations pipedream-call xero_accounting_api xero_accounting_api-download-invoice \
  --props '{"xeroAccountingApi":{"authProvisionId":"auto"},"tenantId":"...","invoiceId":"..."}' \
  --stash-id NEW -m "Download invoice PDF"
```

The PDF is delivered into the workspace automatically — its path is reported under `downloaded_files` in the result (default `/workdir/tmp/integrations-results/`, scratch — hidden from the user's Files page). If the user asked for the PDF as a deliverable, `cp` it to `/workdir/outputs/`.

### Contact Finder Actions Use String Not Boolean

Both `find-or-create-contact` and `find-contact` use string values `"Yes"` or `"No"` for `createContactIfNotFound`, not boolean:

```json
{ "createContactIfNotFound": "Yes" }
```

(`find-contact` searches by name or `accountNumber`; `find-or-create-contact` searches by name or `emailAddress`.)

### create-update-contact: pass `contactStatus` explicitly

`contactStatus` has `default: "ACTIVE"` but is **not** marked optional in the schema — pass it explicitly (`"ACTIVE"` to create/keep active, `"ARCHIVED"` to archive) to avoid validation errors.

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

**Attachments — UI-only to delete (scope limitation, verified):** the **Accounting API** has no attachment-delete (`DELETE /…/Attachments/{filename}` via `make-an-api-call` fails). Xero's separate **Files API** (`https://api.xero.com/files.xro/1.0/Files/{FileId}`) _does_ support `DELETE` and the proxy routes to it, **but this integration's OAuth token isn't scoped for the Files API** — a `files.xro` call returns `401 AuthorizationUnsuccessful` (verified; the connector only holds `accounting.*` scopes). So removing an attachment isn't possible through this integration — it's a manual Xero-UI action. `get-history-of-changes` returns `[]` for DELETED records — history isn't retrievable after deletion.

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

```bash
numa integrations pipedream-call xero_accounting_api xero_accounting_api-upload-file \
  --props '{"xeroAccountingApi":{"authProvisionId":"auto"},"tenantId":"...","filePathOrUrl":"/workdir/outputs/invoice.pdf","documentType":"Invoices","documentId":"invoice-uuid-here"}' \
  -m "Upload file attachment to Xero"
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

Then filter the result client-side for accounts where `Type` is `"BANK"`. (A server-side `where` filter works too, but only via the object `queryString` form — `{"queryString": {"where": "Type==\"BANK\""}}` — see the make-an-api-call gotcha above; client-side filtering is simpler and more reliable.)
