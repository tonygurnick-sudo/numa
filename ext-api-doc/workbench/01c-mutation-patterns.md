---
api_name: Workbench International (ERP)
api_slug: workbench
doc: mutation patterns (write-side; companion to 01-llm-api-rules.md)
confidence: writes are real financial postings. Workbench "retains the business rules and validations of the Workbench application" on writes [DOCUMENTED] — a syntactically valid request can still be rejected by domain rules. No write endpoint/payload/status below is verified — all [INFERRED] 🔬. Pull the instance Swagger and HITL-confirm every write. Writes are OFF by default.
path_note: /api/v1 prefix is a placeholder — read the real prefix from the Swagger base path.
call_surface: HTTP via `numa integrations request`. Not a Files connector.
---

# Workbench International — Mutation Patterns

## Golden rules for writes

1. **HITL every write.** Confirm exact job, activity, amounts, dates with the user before POSTing — these touch job costs, AP/AR, GL.
2. **No blind retries.** No known idempotency key 🔬. If a POST times out or the response is ambiguous, do NOT resend — first GET to check whether the record was created. Re-posting can double a timesheet/invoice/transaction and corrupt job costs.
3. **Distribution must balance.** Line amounts (job/activity/GL/tax) sum to the document total 🔬. Compute and verify client-side before sending.
4. **Activity drives the GL account.** Don't invent a `glAccount` — it follows the activity → GL mapping `[DOCUMENTED]`. Read the activity (or let the server derive it) rather than guessing.
5. **Closed jobs likely reject postings.** Check job `status` first 🔬.

## Write Capabilities (`[INFERRED]` 🔬)

| Operation          | Supported      | Method      | Notes                                                              |
| ------------------ | -------------- | ----------- | ------------------------------------------------------------------ |
| Create transaction | likely         | POST        | Cost/revenue tx with distribution lines                            |
| Create timesheet   | likely         | POST        | "Time" cost capture (WBTIME)                                       |
| Create PO          | likely         | POST        | WBPURCHASING — create + email                                      |
| Update             | `[UNKNOWN]` 🔬 | PUT/PATCH   | Some ERPs only allow create + reverse                              |
| Delete / reverse   | `[UNKNOWN]` 🔬 | DELETE/POST | Financial systems usually **reverse**, not hard-delete             |
| Bulk write         | no (found)     | —           | No batch endpoint documented                                       |
| File upload        | `[UNKNOWN]` 🔬 | —           | Doc Management / Packing Slips modules exist; API exposure unknown |

**Update/delete especially uncertain** — many ERPs forbid editing a posted transaction and require a **reversal** entry instead. Confirm from the Swagger before offering edit/delete 🔬.

## Common Patterns (`[INFERRED]` 🔬)

**1 — Create a cost transaction (with distribution):** `POST /api/v1/transactions`
body `{"jobNo":"J-10042","type":"Purchase","date":"2026-05-29","amount":4200.00,"taxCode":"GST","taxAmount":630.00,"lines":[{"activityCode":"STEEL","glAccount":"6100","amount":4200.00,"tax":630.00}]}`
→ `{"id":"TX-90011","jobNo":"J-10042","type":"Purchase","amount":4200.0,"status":"Posted","date":"2026-05-29"}`
Required (assumed): `jobNo`, `type`, `date`, `amount`, balanced `lines[]`. Server-generated: `id`, `status`, GL postings. Idempotency: none known — verify via GET before any retry. 🔬

**2 — Create a timesheet entry:** `POST /api/v1/timesheets`
body `{"jobNo":"J-10042","activityCode":"LABOUR","employeeId":"E-204","date":"2026-05-29","hours":7.5,"notes":"Formwork, pier 3"}`
→ `{"id":"TS-55120","jobNo":"J-10042","activityCode":"LABOUR","hours":7.5,"status":"Submitted"}`

**3 — Create a purchase order:** `POST /api/v1/purchaseorders`
body `{"supplierId":"SUP-77","jobNo":"J-10042","lines":[{"description":"Reinforcing steel","activityCode":"STEEL","glAccount":"6100","quantity":10,"unitPrice":420.00,"amount":4200.00}]}`
→ `{"id":"PO-3310","poNo":"PO-3310","supplierId":"SUP-77","status":"Draft","total":4200.0}`
A separate approve/send step (`POST /api/v1/purchaseorders/{id}/approve` or `/send`) may be required to action the PO 🔬.

**4 — Update / reverse (UNCONFIRMED):** `PATCH /api/v1/transactions/{id}` (may not exist; posted entries often immutable) · `POST /api/v1/transactions/{id}/reverse` (financial systems commonly reverse instead of edit). Do NOT assume edit/delete works — discover the real mechanism (edit vs reverse vs none) from the Swagger before offering it 🔬.

## Distribution balancing (the thing that gets writes rejected)

Before sending any transaction/invoice with `lines[]`:

```python
net_total = round(sum(l["amount"] for l in lines), 2)
tax_total = round(sum(l.get("tax", 0) for l in lines), 2)
assert net_total == round(header_amount, 2), "distribution net does not balance"
assert tax_total == round(header_tax, 2),    "distribution tax does not balance"
for l in lines:
    assert l["activityCode"], "every line needs an activity code"
    # glAccount follows from the activity → GL mapping; do not invent codes
```

If the activity's GL mapping is unknown, **omit `glAccount`** and let the server derive it from the activity (preferred) rather than guessing 🔬.

## Field Validation Rules (`[INFERRED]` 🔬; exact messages + field-level error format `[UNKNOWN]` — surface raw response)

| Entity      | Field          | Rule                          | Error if violated (expected)         |
| ----------- | -------------- | ----------------------------- | ------------------------------------ |
| Transaction | `jobNo`        | Existing, non-closed job      | 400/422 domain rejection             |
| Transaction | `lines[]`      | Sum to header `amount` (+tax) | 400/422 "distribution unbalanced" 🔬 |
| Transaction | `activityCode` | Valid activity for the job    | 400/422 invalid activity             |
| Timesheet   | `hours`        | Positive number               | 400                                  |
| PO          | `supplierId`   | Existing supplier             | 400/422                              |

## Server-Side Defaults (`[INFERRED]` 🔬, applied on create)

Transaction `id` server-generated · Transaction `status` `Posted`/`Draft` 🔬 · Transaction `glAccount` derived from activity · Timesheet `status` `Submitted` 🔬 · PO `status` `Draft` 🔬.

## Worked Example: AP invoice allocated to a job

"Record a $12,450 subcontractor invoice from SUP-77 against job J-10042, activity SUBBIE."
`POST /api/v1/creditors` body `{"supplierId":"SUP-77","invoiceNo":"INV-4471","date":"2026-05-29","total":12450.00,"taxCode":"GST","lines":[{"jobNo":"J-10042","activityCode":"SUBBIE","glAccount":"6300","amount":12450.00}]}`
→ (assumed 201/200) `{"id":"AP-9050","supplierId":"SUP-77","invoiceNo":"INV-4471","total":12450.0,"status":"Draft"}`

- This is the documented "AP Invoices allow for the actual cost to be allocated to the job" flow `[DOCUMENTED]` — `lines[]` distribution allocates cost to the job/activity/GL.
- If the cost relates to a PO, there may be a PO-match field/endpoint (full/partial invoicing) 🔬.

## Gotchas

1. **Posted ≠ editable.** A posted transaction may be immutable; "update" might mean **reverse + re-post**. Confirm before offering an edit 🔬.
2. **GL account is derived, not chosen.** Sending a `glAccount` conflicting with the activity's mapping may be rejected or silently overridden. Prefer letting the activity drive it.
3. **Tax handling is tenant-specific.** GST codes/rates come from tenant config; don't hard-code 🔬.
4. **`201` vs `200` on create is unknown.** Don't branch on status code alone — inspect the body for a new `id` 🔬.

## Dangerous Operations

| Operation                    | Why dangerous                                 | Safeguard                                            |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Create transaction / AP / AR | Real financial posting; affects job cost + GL | HITL confirm; verify distribution balances           |
| Retry an ambiguous POST      | No idempotency key → duplicate posting        | GET to check existence first; never blind-retry      |
| Create timesheet             | Adds real labour cost to a job                | HITL confirm job/activity/hours                      |
| Approve / send a PO          | Commits spend; emails the supplier            | HITL confirm before approve/send                     |
| Edit/delete a posted entry   | May be unsupported; could corrupt the ledger  | Confirm reverse-vs-edit semantics from Swagger first |
