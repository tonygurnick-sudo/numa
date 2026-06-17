---
api_name: MYOB Greentree
api_slug: greentree
doc: mutation patterns (create/update/delete, POST-overload model, actions cancel/hold/approve/report, attachments, sticky notes) — companion to 01-llm-api-rules.md (on-demand)
call_surface: HTTP via connectors(name="request", connector="greentree"); company code first in the path; POST body as `body`. Backend injects auth.
verbs: GET=read, POST=create(no identifier)+update(/{entity}/{ref})+actions(?action=), DELETE=delete. NO PUT/PATCH. JSON POST bodies supported from Greentree 4@8-5 (very old instances may require XML for writes).
confidence: docs-derived (MYOB Greentree official entity docs); NOT live-validated. ALL WRITES UNVERIFIED — no write has been executed against a live instance; field behavior/validation/side-effects unconfirmed. Treat all as [DOCS] unless tagged [UNVERIFIED]; exercise on a test company before first customer use.
---

# MYOB Greentree — Mutation Patterns

## ALL WRITES UNVERIFIED — safety rules

Greentree is a financial system of record — invoices/orders post to the GL, and the API runs with the user's full Greentree permissions. Until this connector is exercised on a test instance:

1. **Confirm every write with the user before executing** — show the exact body.
2. **Start in a test company/database if the customer has one** — the company code is in the path, so point at it by changing `/01/` to the test company's code.
3. **Never retry a timed-out write blindly** — re-read the record first (POST idempotency undocumented; a re-POST may create a duplicate).
4. Treat everything in the Dangerous Operations table as requiring explicit user sign-off.

## The POST-overload model

No PUT/PATCH. POST is overloaded by what's in the path:
| Intent | Method | Path | Notes |
| --- | --- | --- | --- |
| Create | POST | `/{company}/{entity}` (no identifier) | Greentree allocates the identifier — you can't set it |
| Update | POST | `/{company}/{entity}/{identifier}` | partial body updates the existing record |
| Action | POST | `/{company}/{entity}/{identifier}?action=...` | cancel/approve/report/attachment — NOT a field update |
| Delete | DELETE | `/{company}/{entity}/{identifier}` | where supported (e.g. Customer) |

**Critical nuance:** POST-to-identifier is a free-form field update for some entities (`Customer`, `Supplier`, `SOSalesOrder`, `POPurchaseOrder`, `StockItem`, `JCJob`) but **action-only** for others (`ARInvoice` — docs: "Execute actions only (no updates)"). Check the entity's docs page (and `01a`) before assuming POST-to-identifier updates arbitrary fields.

## Identifiers on write

- **Create does not let you choose the identifier.** Docs: "as a client of the API you cannot specify the `<identifier>` for a newly created entity… exceptions to this will be documented with their entity." Capture the allocated key from the create response.
- **Update targets the human key in the path** (`Code`, `Reference`, `AccountNo`), not the `OidString`.
- Human keys on lines (a `StockItem` `Code`, a `GLAccount` `AccountNo`) reference existing masters — resolve via a list GET first (see `01b`) [UNVERIFIED exact line field names].
- `OidString` + `Edition` are server-maintained. `Edition` is a row version; whether Greentree enforces optimistic concurrency on it via the API is [UNVERIFIED] — don't assume it's safe to overwrite a record another user just changed.

## The success shape

- **Create (POST, no identifier):** the saved record incl. the **allocated identifier** + server-computed fields (totals, audit stamps). Capture the key. [UNVERIFIED exact body]
- **Update (POST to identifier):** the updated record. [UNVERIFIED]
- **Delete:** success by status; body shape [UNVERIFIED].
- Docs show XML responses; through the connector you get JSON. Don't echo full records raw (they're large) — summarize the fields asked about.
  > **Merge semantics on update are [UNVERIFIED].** Send only the fields you intend to change. Whether an omitted field is preserved (expected) vs cleared, and how child collections (LineItems) merge, are NOT confirmed — test on a scratch record before bulk edits.

## Common patterns

**1. Create — Customer (master record):**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/Customer","body":{"Name":"New Trade Customer","Status":"Active","Currency":"AUD","Address":{"Address1":"1 Queen Street","Suburb":"Auckland","Email":"ap@example.com","PhoneBH":"09 555 1234"},"CreditLimit":10000}})
```

Response: the saved customer DTO incl. the **allocated `Code`** — capture it. [UNVERIFIED body shape]

**2. Update — POST to the identifier (partial body):**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/Customer/CUST1235","body":{"CreditLimit":15000,"Status":"OnHold"}})
```

Only the fields you send change [UNVERIFIED]. Same pattern updates `Supplier`, `SOSalesOrder`, `POPurchaseOrder`, `StockItem`, `JCJob`. **NOT** `ARInvoice` (actions only).

> Echoing a GET response back as the update body is risky — it carries server-computed/audit fields, and child-collection merge is unverified; a re-sent `LineItems` array could duplicate or wipe lines. Send the minimal change set.

**3. Delete:**

```
connectors(name="request", params={"connector":"greentree","method":"DELETE","url":"/01/Customer/CUST1235"})
```

Supported where documented (e.g. `Customer`). Many transaction documents are NOT deletable once posted — expect rejection (referenced/posted record) [UNVERIFIED]. For "remove from circulation", prefer a status/active-flag change (`Status`/`IsActive`) over a hard delete — confirm with the user.

**4. Create — Purchase order with line items:**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/POPurchaseOrder","body":{"Supplier":"SUPP01","DocumentDate":"2026-06-11T00:00:00","Branch":"MAIN","LineItems":[{"StockItem":"00AOPEN17MONITOR","Quantity":10,"Location":"01.03"},{"StockItem":"1170","Quantity":5}]}})
```

Response: the saved PO incl. allocated `Reference`, `NetAmount`/`TaxAmount` computed from lines. [UNVERIFIED line field names — confirm `StockItem`/`Quantity` against the entity's docs page on the customer's instance]

**5. Create — Sales order, then a lifecycle action:**
Step A — create:

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/SOSalesOrder","body":{"Customer":"CUST1234","DeliveryDate":"2026-06-18T00:00:00","SalesPerson":"JSMITH","CustomerOrderNumber":"PO-9912","LineItems":[{"StockItem":"00AOPEN17MONITOR","Quantity":3}]}})
```

Capture the allocated `Reference`. Step B — put on hold (ACTION, not a field update):

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/SOSalesOrder/SO100001?action=putOnHold","body":{"HoldStatus":"CreditHold"}})
```

`action=putOnHold` requires a `HoldStatus`; `action=takeOffHold` takes an optional `OffHoldStatus`; `action=cancel` requires a `CancelStatus`. These are state transitions, not generic updates — confirm with the user.

**6. Create — AR invoice (create-only via POST; update is action-only):**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/ARInvoice","body":{"Customer":"CUST1234","DocumentDate":"2026-06-11T00:00:00","Branch":"MAIN","LineItems":[{"Account":"4000","Description":"Consulting","NetAmount":1500.00,"TaxCode":"S15"}]}})
```

AR invoice lines are **GL line items** (`GLLineItem`) — they post to GL accounts, optionally with TransactionAnalysis dimensions (Contract/Site/Salesperson) [UNVERIFIED exact line shape]. POST to `/ARInvoice/{Reference}` runs **actions only** (no field update) — e.g. mark printed:

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/ARInvoice/100023?action=setIsPrinted"})
```

`action=setIsPrinted` requires 2021.1+.

**7. Approvals (any approvable entity):**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/POPurchaseOrder/100000?action=approve","body":{"ApprovedBy":"Steve Sampson","Narration":"Please process this transaction"}})
```

`action=approve` (optional `ApprovedBy`/`Narration` — defaults to the API user), `action=reject` (`RejectedBy`/`Narration`), `action=clearApproval` (no body; removes ALL approval details). Read current state with `?includeApprovals=true` on a GET first.

**8. Run a report to PDF (action):**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/CRMSVRequest/1021?action=report&timeout=120","body":{"Name":"CRM SV Inventory Requirements","Parameters":[{"Name":"From Service Request Number","Value":"1021"},{"Name":"To Service Request Number","Value":"1021"}],"Attachment":{"Name":"My Report","Summary":"A nice summary","Type":"Any","ReplaceIfExists":true,"RespondWithAttachment":true}}})
```

`action=report` runs a soft-coded report (`AHFormDefn`); response is a **PDF**. Optionally attach it to the record (`Attachment.RespondWithAttachment=false` to attach without returning). Default 60s timeout; override `timeout=n`. Slow reports can exceed the connector timeout — warn the user.

**9. Attachments (upload / download):**
Upload (multipart/form-data — connector handles encoding):

```
POST /01/StockItem/A0002?action=attachment&type=Image&replaceIfExists=true   (file as multipart/form-data; name+filename from Content-Disposition)
```

Download by name:

```
GET /01/StockItem/A0002?action=attachment&name=desktop.jpg
GET /01/StockItem/A0002?action=attachment&name=desktop.jpg&modifiedSince=2014-06-21T23:34:00
```

Upload modifiers: `name` (replace a named attachment — omit when uploading new), `type`, `replaceIfExists`, `summary`, `isPrimary` (2021.1+), `isWebAccessible` (2021.1+).

**10. Sticky notes (create / update):**

```
connectors(name="request", params={"connector":"greentree","method":"POST","url":"/01/StockItem/A0002","body":{"StickyNotes":[{"Type":"DN","Note":"This is a new Sticky Note"},{"OidString":"8364.13","Type":"RN","Note":"This is now inactive","IsActive":false}]}})
```

Include `OidString` to UPDATE an existing note (cross-checked against the containing entity); omit it to CREATE. Available 2020.1. Confidential/inactive notes can't be READ back via the API.

## Field validation rules

Largely [UNVERIFIED] — Greentree returns an HTTP status with a body describing the problem. The table lists what the docs establish.
| Entity | Field / rule | Notes |
| --- | --- | --- |
| Any create | identifier NOT supplied | Greentree allocates the key (documented exceptions per entity) |
| Customer | (create fields) | Name + Status typical; full field set on the docs page |
| ARInvoice | POST-to-identifier | actions only — no field updates |
| SOSalesOrder | `action=cancel` | requires `CancelStatus` in body |
| SOSalesOrder | `action=putOnHold` | requires `HoldStatus` in body |
| SOSalesOrder | `action=takeOffHold` | optional `OffHoldStatus` |
| POPurchaseOrder | `action=cancel` | 2021.3+ |
| Any approvable | `action=approve`/`reject` | `ApprovedBy`/`RejectedBy` optional (defaults to API user) |
| Any | `action=clearApproval` | no body; removes ALL approval details |
| StockItem | POST create | requires 2021.3+; update is standard |
| GLAccount | `IsPosting=true` | required for an account to receive postings |
| Any update | merge semantics | omit unchanged fields; preserve-vs-clear is [UNVERIFIED] |
| XML whitespace | CR/LF/TAB in posted text | encoded (`&#x0d;` etc.) unless `RetainXmlWhitespace=true` (XML path) |

## Server-side defaults

| Entity    | Field                                                         | Default                 | When                            |
| --------- | ------------------------------------------------------------- | ----------------------- | ------------------------------- |
| All       | identifier (`Code`/`Reference`/`AccountNo`)                   | server-allocated        | create                          |
| All       | OidString / Edition                                           | server-maintained       | create/update                   |
| All       | EntryUser / EntryTimeStamp / ModifiedUser / ModifiedTimeStamp | the API user + now      | create/update                   |
| Documents | NetAmount / TaxAmount                                         | computed from LineItems | create [UNVERIFIED writability] |
| Approval  | ApprovedBy / RejectedBy                                       | the API user if omitted | action                          |

## Worked example: procure-to-receive happy path (UNVERIFIED end to end; company `01`)

```
1. POST /01/Supplier   {"Name":"Acme Components","Status":"Active","Currency":"AUD"}
   → capture allocated Code from the response
2. (resolve a stock item, optional) GET /01/StockItem?analysisCode=MON&listOnly=true&page=1&pageSize=20
3. POST /01/POPurchaseOrder   {"Supplier":"<Code from 1>","DocumentDate":"2026-06-11T00:00:00","LineItems":[{"StockItem":"00AOPEN17MONITOR","Quantity":10}]}
   → capture allocated Reference; NetAmount/TaxAmount computed
4. (after explicit user confirmation) POST /01/POPurchaseOrder/<Reference>?action=approve   {"ApprovedBy":"Steve Sampson"}
   → PO approved
```

- Chain identifiers from responses — never construct them.
- Steps 1-3 are reversible-ish (update/delete where allowed); approval is a workflow transition — confirm first. Posting steps (receipts, AP invoices) hit the GL — treat as irreversible.
- Line field names (`StockItem`, `Quantity`, `Location`) are inferred and **[UNVERIFIED]** — probe the customer's instance with a small read first to confirm the line shape.

> Gotchas recap (all detailed in the sections above): no PUT/PATCH (POST overloaded, some POST-to-identifier are actions); `ARInvoice` POST-to-identifier action-only; can't choose the identifier on create; company code in the path on writes too; actions carry required body fields + version gates; merge semantics unverified (minimal bodies, don't round-trip a GET); writes run with the user's permissions; reports/large postings can outrun the 60s timeout (a timed-out write may have landed — re-read first); deletes limited/often refused (prefer status/flag changes); old instances may require XML (JSON POST needs 4@8-5+).

## Dangerous operations

Destructive, irreversible, or financially significant. Confirm with the user before executing ANY — and given the UNVERIFIED status of all writes, currently confirm before every write, full stop.
| Operation | Why dangerous | Safeguard |
| --- | --- | --- |
| `POST /ARInvoice` (create) | posts a sales invoice to the GL | confirm customer, amounts, lines; quote the total back |
| `POST /SOSalesOrder/{ref}?action=cancel` | cancels an order (needs `CancelStatus`) | confirm order + cancel status; check downstream fulfilment first |
| `POST /POPurchaseOrder/{ref}?action=cancel` | cancels a PO (2021.3+) | confirm; ensure no receipt has been made against it |
| `POST /{entity}/{ref}?action=approve` | advances an approval workflow (financial sign-off) | confirm the user is authorised; quote the document + amount |
| `POST /{entity}/{ref}?action=clearApproval` | removes ALL approval details | confirm explicitly — resets the whole approval chain |
| `DELETE /Customer/{Code}` (and other masters) | hard-deletes a masterfile record | confirm; expect refusal if referenced/posted (don't work around it) |
| `POST /{entity}/{ref}` field update | merge semantics UNVERIFIED — could clear fields or duplicate lines | send minimal body; echo it to the user; test on a scratch record first |
| `POST .../action=putOnHold` / `takeOffHold` | blocks/unblocks trading on the document | confirm hold status; verify business impact |
| `POST /{entity}/{ref}?action=attachment` (replace) | `replaceIfExists=true` overwrites a stored attachment | confirm replacement; back up the existing file first if it matters |
| Any write after a timeout | POST idempotency undocumented — duplicate/partial risk | re-read (list by `modifiedSince`/identifier) before retrying |
