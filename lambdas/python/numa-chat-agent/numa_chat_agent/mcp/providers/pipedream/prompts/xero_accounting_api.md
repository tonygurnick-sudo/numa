Xero — Sub-Agent Hints (per action payloads & guardrails)

Contacts

find-or-create-contact / create-update-contact / xero-accounting-update-contact
	•	Require: tenantId.
	•	If you only have an email/name, set Name, optional EmailAddress, and any addresses/phones per schema.
	•	Prefer updating by ContactID; fall back to Name only when necessary.
	•	If creating on write: clearly set Name and any ContactPersons[].  ￼

list-contacts / get-contact
	•	Support paging: loop page=1..n until empty. Use filters (e.g., where, summaryOnly) when exposed to reduce payload.  ￼

Items (Products)

create-item / get-item
	•	Code, Name, track inventory fields as needed; for tracked items, ensure the right account codes exist or rely on defaults.  ￼

Invoices (Sales) & Bills (Purchases)

xero-create-sales-invoice / xero-create-purchase-bill / create-bill
	•	Require: tenantId, Type (ACCREC for sales, ACCPAY for bills), Contact (ContactID or Name), at least one LineItems[].
	•	Set: Date, DueDate, LineAmountTypes, optional InvoiceNumber for idempotency, Status (start with DRAFT).
	•	If authorising immediately, ensure taxes and totals are correct.  ￼

add-line-item-to-invoice
	•	Require: tenantId, target InvoiceID (or invoice number → first resolve to ID).
	•	Append LineItems[] with Description, Quantity, UnitAmount, AccountCode, TaxType as needed.
	•	Keep LineAmountTypes consistent with the invoice.  ￼

find-invoice / get-invoice / list-invoices
	•	Prefer InvoiceID lookups; otherwise filter on InvoiceNumber, ContactID, date ranges, and Status(es).
	•	Use paging with page and consider summaryOnly=true to speed up lists.  ￼

download-invoice
	•	Require: tenantId, InvoiceID. Expect a PDF byte stream/file; capture it, name it predictably (INV-<number>.pdf).  ￼

get-invoice-online-url
	•	Require: tenantId, InvoiceID. Use the returned URL if you need to expose a public link to the customer.  ￼

email-an-invoice
	•	Require: tenantId, InvoiceID.
	•	If the action exposes “mark as sent”, set it when the email is successfully requested. Consider DRAFT → AUTHORISED before email.  ￼

Payments & Bank Transactions

create-payment
	•	Use this to settle an existing invoice/bill/credit note.
	•	Require: tenantId, InvoiceID/CreditNoteID, AccountID (bank), Date, Amount.
	•	Do not also create a BankTransaction for the same settlement. (One or the other.) (Xero pattern)

create-bank-transaction
	•	Use for SPEND/RECEIVE (including *-PREPAYMENT / *-OVERPAYMENT).
	•	Require one of: BankAccountCode or BankAccountId; and one of ContactID or ContactName.
	•	Set: Type, LineItems[] (≥1), Date (YYYY-MM-DD), optional Reference, CurrencyCode, Status, LineAmountTypes, IsReconciled when appropriate.
	•	Validation: throw if neither bank account nor contact provided (the component does this; mirror it).  ￼

Tracking Categories

create-tracking-category / update-tracking-category / delete-tracking-category / update-tracking-category-option / delete-tracking-category-option / list-tracking-categories / get-tracking-category
	•	Require: tenantId; for updates/deletes, the category or option IDs.
	•	Keep names unique per category; validate you’re not deleting a category still used on live docs. (Xero behavior reference)

History & Audit

create-history-note / get-history-of-changes
	•	Require: tenantId, the document type & ID (e.g., InvoiceID).
	•	For notes, provide Details text. Use after state changes for an audit trail.

Bank Reports

get-bank-summary
	•	Require: tenantId, optional date; treat as a summary snapshot. Use when you don’t need raw lines.

get-bank-statements-report
	•	Require: tenantId, bankAccountID.
	•	Strongly recommend from_date and to_date to bound volume. Expect pagination/large outputs; chunk downstream processing.  ￼

Tenancy

get-tenant-connections
	•	Call once per session (or when ambiguous) to list available tenants; pick the correct tenantId. Propagate it to all subsequent calls.  ￼

Files & Attachments

upload-file
	•	Require: tenantId, a file (binary) and the target object to attach to (e.g., an Invoice).
	•	Attach before emailing; keep filenames deterministic (e.g., Quote-1234.pdf).  ￼

Journals

list-manual-journals
	•	Read-only; page through results. Avoid heavy pulls; filter by date updated when available. (Xero paging pattern)  ￼

Low-level escape hatch

make-an-api-call
	•	Always specify: method, path (e.g., /api.xro/2.0/Invoices), and one of params/data.
	•	Ensure the xero-tenant-id header is set via tenantId. Prefer this only for endpoints not wrapped by a dedicated action.  ￼

⸻
