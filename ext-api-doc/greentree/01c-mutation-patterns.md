---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-11'
update_source: 'MYOB Greentree official docs (api-overview write/action sections + per-entity api-documentation pages) — NO live testing'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# MYOB Greentree -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Covers create, update, delete, the POST-overload model,
> action modifiers (cancel/hold/approve/report), attachments, and sticky notes.

---

## ⚠️⚠️ ALL WRITES ARE UNVERIFIED ⚠️⚠️

> **Docs-derived — NOT yet live-validated through the Numa connector path.** No write in this
> document has been executed against a live Greentree instance. Bodies are constructed from MYOB
> Greentree's official entity docs [DOCS]; field behavior, validation, and side effects are
> NOT confirmed. Greentree is a **financial system of record** — invoices and orders post to the
> GL, and the API runs with the user's full Greentree permissions. Until this connector is
> exercised on a test instance:
>
> 1. **Confirm every write with the user before executing** — show them the exact body.
> 2. **Start in a test company/database if the customer has one** (the company code is in the path
>    — point it at a test company by changing `/01/` to the test company's code).
> 3. **Never retry a timed-out write blindly** — re-read the record first (POST idempotency is
>    undocumented; a re-POST may create a duplicate).
> 4. Treat everything in the Dangerous Operations table as requiring explicit user sign-off.

---

## The POST-Overload Model

Greentree has **no PUT/PATCH**. POST is overloaded by what's in the path [DOCS]:

| Intent              | Method | Path                                  | Notes                                                  |
| ------------------- | ------ | ------------------------------------- | ------------------------------------------------------ |
| Create              | POST   | `/{company}/{entity}` (no identifier) | Greentree allocates the identifier (key) — you can't set it |
| Update              | POST   | `/{company}/{entity}/{identifier}`    | Partial body updates the existing record [DOCS]        |
| Action              | POST   | `/{company}/{entity}/{identifier}?action=...` | cancel/approve/report/attachment — NOT a field update |
| Delete              | DELETE | `/{company}/{entity}/{identifier}`    | Where supported (e.g. Customer) [DOCS]                  |

**Critical nuance:** POST-to-identifier is a free-form field update for some entities
(`Customer`, `Supplier`, `SOSalesOrder`, `POPurchaseOrder`, `StockItem`, `JCJob`) but
**action-only** for others (`ARInvoice` — the docs say "Execute actions only (no updates)"). Check
the entity's docs page (and `01a`) before assuming POST-to-identifier will update arbitrary fields.
[DOCS]

**Verbs** [DOCS]: GET = read, POST = create AND update (and actions), DELETE = delete. JSON POST
bodies are supported from Greentree 4@8-5; very old instances may require XML for writes.

---

## Identifiers on Write

- **Create does not let you choose the identifier.** "As a general rule as a client of the API you
  cannot specify the `<identifier>` for a newly created entity, as it is preferred to allow
  Greentree to allocate these. Note there are exceptions to this which will be documented with
  their entity." [DOCS] Capture the allocated key from the create response.
- **Update targets the human key in the path** (`Code`, `Reference`, `AccountNo`), not the
  `OidString`. [DOCS]
- Human keys on lines (e.g. a `StockItem` `Code`, a `GLAccount` `AccountNo`) reference existing
  masters — resolve them via a list GET first (see `01b`). [DOCS / UNVERIFIED exact line field names]
- `OidString` + `Edition` are server-maintained. `Edition` is a row version — whether Greentree
  enforces optimistic concurrency on it via the API is [UNVERIFIED]; don't assume it's safe to
  overwrite a record another user just changed.

---

## The Success Shape

- **Create (POST, no identifier):** the saved record, including the **allocated identifier** and
  server-computed fields (totals, audit stamps). Capture the key. [DOCS / UNVERIFIED exact body]
- **Update (POST to identifier):** the updated record. [DOCS / UNVERIFIED]
- **Delete:** success by status; body shape [UNVERIFIED].
- The docs show **XML** sample responses; through the Numa connector you get **JSON**. Don't echo
  full records to the user raw — they're large; summarize the fields they asked about. [DOCS]

> **Merge semantics on update are [UNVERIFIED].** Send only the fields you intend to change. Whether
> an omitted field is preserved (expected) vs cleared, and how child collections (LineItems) merge,
> have NOT been confirmed — test on a scratch record before bulk edits.

---

## Common Patterns

### Pattern 1: Create — Customer (master record)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer",
  "method": "POST",
  "body": {
    "Name": "New Trade Customer",
    "Status": "Active",
    "Currency": "AUD",
    "Address": {
      "Address1": "1 Queen Street",
      "Suburb": "Auckland",
      "Email": "ap@example.com",
      "PhoneBH": "09 555 1234"
    },
    "CreditLimit": 10000
  }
})
```

**Response:** the saved customer DTO including the **allocated `Code`** — capture it for follow-up
calls. [DOCS / UNVERIFIED body shape]

### Pattern 2: Update — POST to the identifier (partial body)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer/CUST1235",
  "method": "POST",
  "body": { "CreditLimit": 15000, "Status": "OnHold" }
})
```

Only the fields you send change [DOCS / UNVERIFIED]. Same pattern updates `Supplier`,
`SOSalesOrder`, `POPurchaseOrder`, `StockItem`, `JCJob`. **NOT** `ARInvoice` (actions only). [DOCS]

> Echoing a GET response back as the update body is risky: it carries server-computed and audit
> fields, and the child-collection merge behavior is unverified — a re-sent `LineItems` array could
> duplicate or wipe lines. Send the minimal change set. [UNVERIFIED]

### Pattern 3: Delete

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/Customer/CUST1235",
  "method": "DELETE"
})
```

- DELETE is supported where documented (e.g. `Customer`). Many transaction documents are NOT
  deletable once posted — expect a rejection (referenced/posted record). [DOCS / UNVERIFIED]
- For "remove from circulation", prefer a status/active-flag change (e.g. `Status`/`IsActive`) over
  a hard delete — confirm with the user. [UNVERIFIED enforcement]

### Pattern 4: Create — Purchase order with line items

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/POPurchaseOrder",
  "method": "POST",
  "body": {
    "Supplier": "SUPP01",
    "DocumentDate": "2026-06-11T00:00:00",
    "Branch": "MAIN",
    "LineItems": [
      { "StockItem": "00AOPEN17MONITOR", "Quantity": 10, "Location": "01.03" },
      { "StockItem": "1170", "Quantity": 5 }
    ]
  }
})
```

**Response:** the saved PO including the allocated `Reference`, `NetAmount`/`TaxAmount` computed
from the lines. [DOCS / UNVERIFIED line field names — confirm `StockItem`/`Quantity` against the
entity's docs page on the customer's instance]

### Pattern 5: Create — Sales order, then a lifecycle action

**Step A — create:**

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/SOSalesOrder",
  "method": "POST",
  "body": {
    "Customer": "CUST1234",
    "DeliveryDate": "2026-06-18T00:00:00",
    "SalesPerson": "JSMITH",
    "CustomerOrderNumber": "PO-9912",
    "LineItems": [
      { "StockItem": "00AOPEN17MONITOR", "Quantity": 3 }
    ]
  }
})
```

Capture the allocated `Reference`. [DOCS / UNVERIFIED]

**Step B — put the order on hold (ACTION, not a field update):**

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/SOSalesOrder/SO100001?action=putOnHold",
  "method": "POST",
  "body": { "HoldStatus": "CreditHold" }
})
```

- `action=putOnHold` requires a `HoldStatus` in the body; `action=takeOffHold` takes an optional
  `OffHoldStatus`; `action=cancel` requires a `CancelStatus`. [DOCS]
- These are **state transitions**, not generic updates — confirm with the user. [DOCS]

### Pattern 6: Create — AR invoice (create-only via POST; update is action-only)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/ARInvoice",
  "method": "POST",
  "body": {
    "Customer": "CUST1234",
    "DocumentDate": "2026-06-11T00:00:00",
    "Branch": "MAIN",
    "LineItems": [
      { "Account": "4000", "Description": "Consulting", "NetAmount": 1500.00, "TaxCode": "S15" }
    ]
  }
})
```

- AR invoice lines are **GL line items** (`GLLineItem`) — they post to GL accounts, optionally with
  TransactionAnalysis dimensions (Contract/Site/Salesperson). [DOCS / UNVERIFIED exact line shape]
- **POST to `/ARInvoice/{Reference}` runs actions only** (no field update) — e.g. mark printed:

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/ARInvoice/100023?action=setIsPrinted",
  "method": "POST"
})
```

`action=setIsPrinted` requires 2021.1+. [DOCS]

### Pattern 7: Approvals (any approvable entity)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/POPurchaseOrder/100000?action=approve",
  "method": "POST",
  "body": { "ApprovedBy": "Steve Sampson", "Narration": "Please process this transaction" }
})
```

- `action=approve` (optional `ApprovedBy`/`Narration` — defaults to the API user if omitted),
  `action=reject` (`RejectedBy`/`Narration`), `action=clearApproval` (no body; removes ALL approval
  details). [DOCS]
- Read current approval state with `?includeApprovals=true` on a GET first. [DOCS]

### Pattern 8: Run a report to PDF (action)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/CRMSVRequest/1021?action=report&timeout=120",
  "method": "POST",
  "body": {
    "Name": "CRM SV Inventory Requirements",
    "Parameters": [
      { "Name": "From Service Request Number", "Value": "1021" },
      { "Name": "To Service Request Number", "Value": "1021" }
    ],
    "Attachment": {
      "Name": "My Report", "Summary": "A nice summary", "Type": "Any",
      "ReplaceIfExists": true, "RespondWithAttachment": true
    }
  }
})
```

- `action=report` runs a soft-coded report (`AHFormDefn`); the response is a **PDF**. Optionally
  attach it to the record (`Attachment.RespondWithAttachment=false` to attach without returning).
  [DOCS]
- Default 60s report timeout; override with `timeout=n`. Slow reports can exceed the connector
  timeout — warn the user. [DOCS]

### Pattern 9: Attachments (upload / download)

**Upload** (multipart/form-data — the connector handles the encoding):

```
POST /01/StockItem/A0002?action=attachment&type=Image&replaceIfExists=true
     (file posted as multipart/form-data; name+filename from Content-Disposition)
```

**Download** by name:

```
GET /01/StockItem/A0002?action=attachment&name=desktop.jpg
GET /01/StockItem/A0002?action=attachment&name=desktop.jpg&modifiedSince=2014-06-21T23:34:00
```

Upload modifiers: `name` (replace a named attachment — omit when uploading new), `type`,
`replaceIfExists`, `summary`, `isPrimary` (2021.1+), `isWebAccessible` (2021.1+). [DOCS]

### Pattern 10: Sticky notes (create / update)

```
connectors(name="request", params={
  "connector": "greentree",
  "url": "/01/StockItem/A0002",
  "method": "POST",
  "body": {
    "StickyNotes": [
      { "Type": "DN", "Note": "This is a new Sticky Note" },
      { "OidString": "8364.13", "Type": "RN", "Note": "This is now inactive", "IsActive": false }
    ]
  }
})
```

- Include the `OidString` to UPDATE an existing note (cross-checked against the containing entity);
  omit it to CREATE a new note. Available 2020.1. [DOCS]
- Confidential/inactive notes can't be READ back via the API. [DOCS]

---

## Field Validation Rules

> Largely [UNVERIFIED] — Greentree returns an HTTP status with a body describing the problem. The
> table lists what the docs establish.

| Entity         | Field / rule                       | Notes                                                          | Source |
| -------------- | ---------------------------------- | -------------------------------------------------------------- | ------ |
| Any create     | identifier NOT supplied            | Greentree allocates the key (documented exceptions per entity) | [DOCS] |
| Customer       | (create fields)                    | Name + Status typical; full field set on the docs page         | [DOCS] |
| ARInvoice      | POST-to-identifier                 | Actions only — no field updates                                | [DOCS] |
| SOSalesOrder   | `action=cancel`                    | Requires `CancelStatus` in body                                | [DOCS] |
| SOSalesOrder   | `action=putOnHold`                 | Requires `HoldStatus` in body                                  | [DOCS] |
| SOSalesOrder   | `action=takeOffHold`               | Optional `OffHoldStatus`                                       | [DOCS] |
| POPurchaseOrder| `action=cancel`                    | 2021.3+                                                        | [DOCS] |
| Any approvable | `action=approve`/`reject`          | `ApprovedBy`/`RejectedBy` optional (defaults to API user)      | [DOCS] |
| Any            | `action=clearApproval`             | No body; removes ALL approval details                          | [DOCS] |
| StockItem      | POST create                        | Requires 2021.3+; update is standard                           | [DOCS] |
| GLAccount      | `IsPosting=true`                   | Required for an account to receive postings                    | [DOCS] |
| Any update     | merge semantics                    | Omit unchanged fields; preserve vs clear is UNVERIFIED         | [UNVERIFIED] |
| XML whitespace | CR/LF/TAB in posted text           | Encoded (`&#x0d;` etc.) unless `RetainXmlWhitespace=true`      | [DOCS] (XML path) |

---

## Server-Side Defaults

| Entity      | Field                 | Default                              | When   | Source |
| ----------- | --------------------- | ------------------------------------- | ------ | ------ |
| All         | identifier (`Code`/`Reference`/`AccountNo`) | server-allocated      | create | [DOCS] |
| All         | OidString / Edition   | server-maintained                     | create/update | [DOCS] |
| All         | EntryUser / EntryTimeStamp / ModifiedUser / ModifiedTimeStamp | the API user + now | create/update | [DOCS] |
| Documents   | NetAmount / TaxAmount | computed from LineItems               | create | [DOCS / UNVERIFIED writability] |
| Approval    | ApprovedBy / RejectedBy | the API user if omitted             | action | [DOCS] |

---

## Worked Example: procure-to-receive happy path

> Create a supplier, raise a PO, approve it. **UNVERIFIED end to end** — the pieces are documented;
> the full flow is not. Company `01`.

```
1. POST /01/Supplier               { "Name": "Acme Components", "Status": "Active", "Currency": "AUD" }
   → capture allocated Code from the response

2. (resolve a stock item, optional) GET /01/StockItem?analysisCode=MON&listOnly=true&page=1&pageSize=20

3. POST /01/POPurchaseOrder        { "Supplier": "<Code from 1>", "DocumentDate": "2026-06-11T00:00:00",
                                      "LineItems": [ { "StockItem": "00AOPEN17MONITOR", "Quantity": 10 } ] }
   → capture allocated Reference; NetAmount/TaxAmount computed

4. (after explicit user confirmation)
   POST /01/POPurchaseOrder/<Reference>?action=approve    { "ApprovedBy": "Steve Sampson" }
   → PO approved
```

**Notes:**

- Chain identifiers from responses — never construct them.
- Steps 1-3 are reversible-ish (update/delete where allowed); approval is a workflow transition —
  confirm first. Posting steps (receipts, AP invoices) hit the GL — treat as irreversible.
- Line field names (`StockItem`, `Quantity`, `Location`) are inferred from the entity docs and are
  **[UNVERIFIED]** — probe the customer's instance with a small read first to confirm the exact
  line shape.

---

## Gotchas & Counter-Exceptions

1. **No PUT/PATCH — POST is overloaded.** Create = POST to `/{entity}`; update = POST to
   `/{entity}/{identifier}`; some POST-to-identifier calls are **actions, not updates**. [DOCS]
2. **`ARInvoice` POST-to-identifier is action-only** — you can't update invoice fields that way;
   only run actions like `setIsPrinted`. [DOCS]
3. **You can't choose the new identifier on create** — Greentree allocates it; read it back from the
   response. [DOCS]
4. **The company code is in the path on writes too** — `/01/Customer`, never a body/param. Point at
   a test company by changing the company code. [DOCS]
5. **Actions carry required body fields** — `CancelStatus` (cancel), `HoldStatus` (hold) — and many
   are version-gated (`action=cancel` on PO is 2021.3+, `setIsPrinted` is 2021.1+). [DOCS]
6. **Merge semantics on update are unverified** — send minimal bodies; don't round-trip a full GET
   into a POST; test child-collection (LineItems) merge on a scratch record. [UNVERIFIED]
7. **Writes run with the user's Greentree permissions** — a write the user can't do in Greentree is
   refused. That's a Greentree-side fix, not a request fix. [DOCS]
8. **Reports/large postings can outrun the timeout** — `action=report` defaults to 60s
   (`timeout=n` to extend); a write that times out may STILL have landed — re-read before retrying.
   [DOCS]
9. **Deletes are limited and often refused** — posted/referenced documents typically can't be
   hard-deleted; prefer status/flag changes. [DOCS / UNVERIFIED]
10. **Old instances may require XML for writes** — JSON POST needs Greentree 4@8-5+. Through the
    connector this is normally fine, but a very old site is a risk. [DOCS]

---

## Dangerous Operations

> Destructive, irreversible, or financially significant calls. The workspace agent must confirm
> with the user before executing ANY of these — and given the UNVERIFIED status of all writes,
> should currently confirm before every write, full stop.

| Operation                                          | Why dangerous                                                      | Safeguard                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /ARInvoice` (create)                         | Posts a sales invoice to the GL                                      | Confirm customer, amounts, lines; quote the total back                  |
| `POST /SOSalesOrder/{ref}?action=cancel`           | Cancels an order (needs `CancelStatus`)                              | Confirm order + cancel status; check downstream fulfilment first         |
| `POST /POPurchaseOrder/{ref}?action=cancel`        | Cancels a PO (2021.3+)                                               | Confirm; ensure no receipt has been made against it                      |
| `POST /{entity}/{ref}?action=approve`              | Advances an approval workflow (financial sign-off)                  | Confirm the user is authorised; quote the document + amount              |
| `POST /{entity}/{ref}?action=clearApproval`        | Removes ALL approval details from the record                        | Confirm explicitly — this resets the whole approval chain                |
| `DELETE /Customer/{Code}` (and other masters)      | Hard-deletes a masterfile record                                    | Confirm; expect refusal if referenced/posted (don't work around it)      |
| `POST /{entity}/{ref}` field update                | Merge semantics UNVERIFIED — could clear fields or duplicate lines  | Send minimal body; echo it to the user; test on a scratch record first   |
| `POST .../action=putOnHold` / `takeOffHold`        | Blocks/unblocks trading on the document                             | Confirm hold status; verify business impact                              |
| `POST /{entity}/{ref}?action=attachment` (replace) | `replaceIfExists=true` overwrites a stored attachment               | Confirm replacement; back up the existing file first if it matters       |
| Any write after a timeout                          | POST idempotency undocumented — duplicate/partial risk              | Re-read (list by `modifiedSince`/identifier) before retrying             |

---

_Generated 2026-06-11 from MYOB Greentree's official API documentation (overview write/action
sections + per-entity pages: GLAccount, Customer, Supplier, ARInvoice, StockItem, POPurchaseOrder,
SOSalesOrder, JCJob)._
_**ALL WRITES UNVERIFIED** — exercise on a test company before first customer use._
