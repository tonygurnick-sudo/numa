---
api_name: 'Jiwa Financials'
api_slug: 'jiwa'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-06-10'
update_source: 'official OpenAPI spec + Jiwa Atlassian wiki worked examples (Sales Order + Debtor pages) — NO live instance tested'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Jiwa Financials -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all write operation patterns including
> create, update, delete, nested child records, and the sales order multi-step flow.

---

## ⚠️⚠️ ALL WRITES ARE UNVERIFIED ⚠️⚠️

> **No write in this document has been executed against a live Jiwa instance.** Request
> bodies are reproduced from Jiwa's official wiki examples pages [DOCS] and the OpenAPI spec
> [SPEC] -- they are the vendor's own examples, but field behavior, validation, and side
> effects have NOT been confirmed by us. Jiwa is a **financial system of record**: sales
> orders post journals and debtor transactions; deletes are hard. Until this connector has
> been exercised against a test instance:
>
> 1. **Confirm every write with the user before executing** -- show them the exact body.
> 2. **Start in a test company/database if the customer has one.**
> 3. **Never retry a timed-out write blindly** -- read the entity back first to see whether
>    the write landed (POSTs are not documented as idempotent).
> 4. Treat everything in the Dangerous Operations table as requiring explicit user sign-off.

---

## Write Capabilities Summary

| Operation         | Supported | Method | Notes                                                                       |
| ----------------- | --------- | ------ | ---------------------------------------------------------------------------- |
| Create            | Yes       | POST   | `201 Created`; response = the FULL business DTO incl. generated IDs [DOCS]   |
| Partial update    | Yes       | PATCH  | Only provided fields change; children matched by ID (see below) [DOCS]       |
| Full replace      | No        | --     | No PUT-replace convention. (A lone `PUT .../LineDetails` route exists [SPEC]) |
| Delete            | Yes       | DELETE | `204 No Content`; **hard delete**; `409` if referenced elsewhere [DOCS]      |
| Soft delete       | Status only | PATCH | Some entities have status/hold flags (e.g. `AccountOnHold`) instead          |
| Bulk create       | Inline children | POST | One parent + many children in one body (Lines, Notes, Payments) [DOCS]   |
| Bulk update       | Inline children | PATCH | Mixed append/update of children in one PATCH [DOCS]                      |
| Bulk delete       | No        | --     | One DELETE per record                                                        |
| State transitions | Yes       | GET(!) | `GET /SalesOrders/{InvoiceID}/Process` posts journals [SPEC] -- see below    |
| File upload       | Yes       | POST   | Documents with base64 `FileBinary` [DOCS]                                    |

**Verbs** [DOCS]: GET = read, POST = create, **PATCH = update** (Jiwa does not use PUT for
updates), DELETE = delete. Success codes: `201` POST, `200` PATCH, `204` DELETE.

---

## The Three Success Shapes [DOCS] [SPEC]

```
POST   → HTTP 201 Created
         Body: the FULL business DTO of the new entity -- generated RecIDs (DebtorID,
         InvoiceID, line IDs...), defaults applied, business-logic-computed fields
         (e.g. line pricing) all included.

PATCH  → HTTP 200 OK
         Body: the FULL updated business DTO (not a diff, not just the changed fields).

DELETE → HTTP 204 No Content
         Body: EMPTY. Success is the status code alone -- do not JSON-parse.
```

Two practical consequences:

- **Never re-GET after a write** -- the response already IS the current state, including
  every generated ID you need for the next step.
- **POST/PATCH responses are large** (full object graph). Extract what you need; don't echo
  them to the user raw.

---

## Identifiers: RecID Semantics

- Most entities are keyed by a **RecID**: a 20-character string identifier (e.g.
  `0000000061000000001V`, `babce67cdbf64f778536`). Some child records use GUIDs (e.g. note
  IDs like `80C3C46B-9D64-4451-BE6B-9CF68C9BCBE3`). [DOCS] [SPEC]
- **RecIDs are server-generated on POST.** You cannot supply them; you don't know an
  entity's ID until the create response returns it. [DOCS]
- The entity's RecID field name varies: `DebtorID` (debtors), `InvoiceID` (sales orders),
  `InventoryID` (inventory), `QuoteID` (quotes), `NoteID`, `DocumentID`,
  `InvoiceLineID`, `InvoiceHistoryID`, `SettingID` (custom fields)...
- **Some IDs carry trailing spaces** -- custom-field `SettingID`s are space-padded and the
  wiki explicitly notes the trailing spaces must be kept (URL-encode as `%20` in paths).
  [DOCS] Never trim or normalize IDs.
- Human-facing numbers (`AccountNo`, `InvoiceNo`, `PartNo`) are NOT route keys. Resolve
  them to RecIDs via `/Queries/*` first (see `01b-query-patterns.md`). Several creates
  accept the human key as a convenience (`DebtorAccountNo`, `PartNo`) -- when both the
  RecID and the human key are provided, **the RecID wins** [DOCS].
- **Optimistic concurrency:** rows carry a `RowHash`; if a record changes between your read
  and your save, the API returns `409 Conflict`. Re-read and re-apply. [DOCS]

---

## Common Patterns

### Pattern 1: Create -- Debtor (customer)

Nothing is mandatory -- "You don't need to provide anything to create a customer -- an
AccountNo and DebtorID will be generated for you -- however it's usual practice to provide
an AccountNo." [DOCS]

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors",
  "method": "POST",
  "body": {
    "AccountNo": "NewAccountNo",
    "Name": "A new customer",
    "EmailAddress": "name@example.com",
    "WebAccess": true
  }
})
```

**Response (`201 Created`):** the **full debtor DTO** -- including the generated `DebtorID`,
defaults applied by business logic, and (empty) child collections. [DOCS] Capture
`DebtorID` from the response for follow-up calls.

**Create with children inline** (wiki example: customer with 2 notes) [DOCS]:

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors",
  "method": "POST",
  "body": {
    "AccountNo": "NewAccountNo",
    "Name": "A new customer",
    "EmailAddress": "name@example.com",
    "WebAccess": true,
    "Notes": [
      { "NoteText": "Note text 1" },
      { "NoteText": "Note text 2" }
    ]
  }
})
```

---

### Pattern 2: Update -- PATCH with child-collection merge semantics

The single most important write convention in this API. A PATCH body:

- updates only the scalar fields you include;
- for child collections (`Notes`, `Lines`, ...): an element **WITH its ID** updates that
  existing child; an element **WITHOUT an ID** is **appended as a new child**. [DOCS]

Wiki example -- update email + web access, add one note, modify another, in one call [DOCS]:

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V",
  "method": "PATCH",
  "body": {
    "EmailAddress": "name2@example.com",
    "WebAccess": false,
    "Notes": [
      { "NoteText": "A new note added" },
      { "NoteID": "DE91CC53-724A-47C6-8920-57AC82BFAD1F", "NoteText": "A modified note text" }
    ]
  }
})
```

**Response (`200 OK`):** the full updated entity DTO.

**Consequences:**

- Echoing a GET response back in a PATCH is dangerous in a different way than usual:
  children that legitimately have IDs are fine (update-in-place), but any
  reconstructed/ID-stripped child becomes a **duplicate append**. Send only what you intend
  to change.
- Whether omitted children are left untouched (expected) vs removed is [UNVERIFIED] --
  expected ServiceStack/Jiwa behavior is untouched, and the wiki examples imply it, but
  verify before bulk edits.
- Null-clearing semantics (`"Field": null`) are [UNVERIFIED]. Until tested, do not send
  nulls to clear fields; ask the user and test on a scratch record.

---

### Pattern 3: Delete

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V",
  "method": "DELETE"
})
```

**Response:** `204 No Content` on success. [DOCS] [SPEC]

**Behavior:**

- **Hard delete** -- no documented undo.
- `409 Conflict` when business logic refuses: "You can't delete a product because it is
  used on a sales order." [DOCS] Expect referenced masterfile records (debtors with
  transactions, inventory on orders) to be undeletable -- this is a safety feature, not an
  error to work around.
- Child deletes use the nested route:
  `DELETE /Debtors/{DebtorID}/Notes/{NoteID}`,
  `DELETE /Debtors/{DebtorID}/ContactNames/{ContactNameID}`,
  `DELETE /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}`. [SPEC]

---

### Pattern 4: Child-record CRUD (explicit routes)

Everything that can be done inline through the parent POST/PATCH can also be done through
dedicated child routes [DOCS] -- often clearer for single-child operations:

```
POST   /Debtors/{DebtorID}/Notes                          { "NoteText": "This is a new note" }
PATCH  /Debtors/{DebtorID}/Notes/{NoteID}                 { "NoteText": "This is an updated note" }
DELETE /Debtors/{DebtorID}/Notes/{NoteID}

POST   /Debtors/{DebtorID}/ContactNames                   { "Title": "Mr.", "FirstName": "Fred", "Surname": "Bloggs",
                                                            "PrimaryPositionName": "External Accountant",
                                                            "EmailAddress": "Fred@example.com" }
PATCH  /Debtors/{DebtorID}/ContactNames/{ContactNameID}   { "DefaultContact": true }

POST   /Debtors/{DebtorID}/DeliveryAddresses              { "Address1": "Unit 1A", "Address2": "57 Smith Street",
                                                            "Address3": "Blakeville", "Address4": "NSW",
                                                            "Postcode": "2126", "IsDefault": true, "Country": "Australia" }
PATCH  /Debtors/{DebtorID}/DeliveryAddresses/{DeliveryAddressID}   { "Country": "Australia" }

POST   /Debtors/{DebtorID}/GroupMemberships               { "GroupDescription": "Default - No Group", "StaffUsername": "Admin" }
PATCH  /Debtors/{DebtorID}/GroupMemberships/{GroupMembershipID}    { "IsDefault": true }
```

(All bodies above are from the wiki Debtor examples page [DOCS].) When adding notes,
omitting `NoteType` applies the default note type configured in Jiwa. [DOCS]

**Documents (file attachments)** -- base64 in `FileBinary` [DOCS]:

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V/Documents",
  "method": "POST",
  "body": {
    "Description": "A new document",
    "PhysicalFileName": "Test.png",
    "FileBinary": "<base64-encoded file contents>"
  }
})
```

`PATCH .../Documents/{DocumentID}` with a new `FileBinary` replaces the content. Keep files
small -- there is no documented size limit [UNVERIFIED]; large base64 bodies through the
connector are untested.

**Custom field values** -- per-entity custom fields are listed at
`GET /{Entity}/CustomFields` and read/written per record [DOCS]:

```
PATCH /Debtors/{DebtorID}/CustomFieldValues/{SettingID}    { "Contents": "True" }
PATCH /SalesOrders/{InvoiceID}/CustomFieldValues/{SettingID}   { "Contents": "New Contents" }
```

`Contents` is always a string. Remember: `SettingID` values are space-padded -- URL-encode
trailing spaces as `%20` and do not trim. [DOCS]

---

### Pattern 5: Sales Order -- the flagship multi-step flow

Sales orders are the worked-example centerpiece of the wiki [DOCS]. Three ways to build one:

**Step A -- create the order (lines, comment, payment inline):**

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/SalesOrders",
  "method": "POST",
  "body": {
    "DebtorID": "00000000080000000002",
    "OrderNo": "1234",
    "SOReference": "Test order",
    "Lines": [
      { "PartNo": "1170", "QuantityOrdered": 5 },
      { "CommentLine": true, "CommentText": "This is a comment line" },
      { "InventoryID": "000000000K00000000BV", "QuantityOrdered": 2, "DiscountedPrice": 15.67,
        "CustomFieldValues": [ { "SettingID": "1ae102b94dc54dfc8a45                ", "Contents": "Fragile - do not drop" } ] }
    ],
    "Payments": [
      { "PaymentRef": "S454873-J5", "AmountPaid": 50.00 }
    ]
  }
})
```

**Response (`201 Created`):** the full sales order DTO -- including the generated
`InvoiceID`, the current `InvoiceHistoryID` (snapshot), per-line `InvoiceLineID`s, and all
pricing computed by business logic. [DOCS]

Vendor notes on this exact body [DOCS]:

1. `DebtorID` **or** `DebtorAccountNo` may be provided; if both, `DebtorID` wins.
2. Lines take `InventoryID` **or** `PartNo`; if both, `InventoryID` wins.
3. **Omit the price and Jiwa prices the line via its normal pricing-scheme logic** -- only
   send `DiscountedPrice` when the user explicitly wants to override price.
4. `CustomFieldValues` reference a `SettingID` (space-padded!).
5. Omit `PaymentType` on payments and the Jiwa-configured default payment type is used.
6. (From the create-order wiki example: `InitiatedDate` may be supplied; defaults applied
   otherwise [UNVERIFIED exact default].)

**Step B -- amend the order (one PATCH: new line + adjust line + add note):**

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/SalesOrders/babce67cdbf64f778536",
  "method": "PATCH",
  "body": {
    "ExpectedDeliveryDate": "2026-06-15T00:00:00",
    "Lines": [
      { "PartNo": "1172", "QuantityOrdered": 5 },
      { "InvoiceLineID": "88a358a2822e4319b9b9", "QuantityOrdered": 10,
        "CustomFieldValues": [ { "SettingID": "1ae102b94dc54dfc8a45                ", "Contents": "Adjustment requested by phone" } ] }
    ],
    "Notes": [
      { "NoteText": "Customer telephoned and asked for another few hours of labour" }
    ]
  }
})
```

Line WITH `InvoiceLineID` = update; line WITHOUT = append. [DOCS]

**Step B-alt -- line-level routes (snapshot/Historys model).** Order lines live under the
order's current **history snapshot**:

```
POST   /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines
       { "PartNo": "1170", "QuantityOrdered": 5, "DiscountedPrice": 15.45 }
POST   .../Lines    { "CommentLine": true, "CommentText": "This is a comment line" }
PATCH  /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}
       { "QuantityOrdered": 6 }
DELETE /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}
```

Get `InvoiceHistoryID` from `GET /SalesOrders/{InvoiceID}` or `.../Historys`. To update
history-level fields, the wiki says to PATCH the **sales order** (not the Historys route) --
values pass through to the current snapshot [DOCS]. A direct
`PATCH .../Historys/{InvoiceHistoryID}` exists for fields like `Status`
(`{ "Status": 2 }` in the wiki -- enum meaning [UNVERIFIED]).

**Step C -- process the order (DANGEROUS -- posts financials):**

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/SalesOrders/000000000800000000NK/Process",
  "method": "GET"
})
```

"To process a sales order, a specific route must be called, this then performs the
business logic for posting journals and debtor transactions." [DOCS] In the spec this is a
**GET** (`GET /SalesOrders/{InvoiceID}/Process`, 200 = "Processed OK", returns the
processed SalesOrder DTO) [SPEC].

- **A GET with major side effects.** Never call it as part of a "read everything" sweep,
  and never auto-retry it. Idempotency on re-process [UNVERIFIED] -- assume NOT idempotent.
- This is a financial state transition (journals + debtor transactions). Always confirm
  with the user first, and quote the order number/total back to them.

---

### Pattern 6: Sales Quotes -- the parallel surface

Sales quotes mirror the sales order model almost route-for-route [SPEC]:

```
POST   /SalesQuotes                                          # create (QuoteID generated)
GET    /SalesQuotes/{QuoteID}
PATCH  /SalesQuotes/{QuoteID}                                # same child-merge semantics
POST   /SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines
PATCH  /SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines/{QuoteLineID}
DELETE /SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines/{QuoteLineID}
```

Everything said about orders (Historys snapshot model, `InventoryID`/`PartNo` resolution,
price omission → pricing scheme, custom field values) applies to quotes by analogy
[UNVERIFIED in detail -- the wiki documents orders; quotes follow the same DTO pattern in
the spec]. Quote → order conversion: no single documented "convert" route was found in the
spec; [UNVERIFIED] whether one exists under another name -- do not promise this capability.

---

### Pattern 7: Reference-data CRUD (categories etc.)

```
POST   /Debtors/Categories     { "Description": "Another new category", "CategoryNo": 1 }
PATCH  /Debtors/Categories/{CategoryID}    { "Description": "Another modified category" }
DELETE /Debtors/Categories/{CategoryID}
```

[DOCS] Same shape for classifications, note types, document types, payment types, credit
reasons (under their respective parents in the spec [SPEC]). These are admin-ish
masterfile edits -- confirm before touching them; they affect every record that uses them.

---

## Field Validation Rules

> Largely [UNVERIFIED] -- Jiwa returns HTTP status codes with a plain-text/DTO description
> of the problem (e.g. "product not found") [DOCS], and `DebugMode` adds stack traces. The
> table lists what the docs/spec establish.

| Entity       | Field                    | Rule                                                            | Source |
| ------------ | ------------------------ | ---------------------------------------------------------------- | ------ |
| Debtor       | (none required)          | POST with empty body is valid; AccountNo+DebtorID generated      | [DOCS] |
| Sales Order  | `DebtorID`/`DebtorAccountNo` | One required to resolve the debtor; DebtorID wins if both    | [DOCS] |
| Sales Order line | `InventoryID`/`PartNo` | One required (product lines); InventoryID wins if both        | [DOCS] |
| Sales Order line | `CommentLine: true`  | Makes it a comment line; `CommentText` carries the text         | [DOCS] |
| Sales Order line | price omitted        | Jiwa computes price from pricing scheme                          | [DOCS] |
| Payment      | `PaymentType` omitted    | Default payment type applied                                     | [DOCS] |
| Note         | `NoteType` omitted       | Default note type applied                                        | [DOCS] |
| Custom field value | `SettingID`        | Must match an existing custom field; preserve trailing spaces    | [DOCS] |
| Any update   | concurrent edit          | `409 Conflict` (optimistic concurrency / RowHash)                | [DOCS] |
| Any delete   | referenced record        | `409 Conflict` with explanation in body                          | [DOCS] |

---

## Server-Side Defaults

| Entity      | Field             | Default                                  | When    | Source |
| ----------- | ----------------- | ----------------------------------------- | ------- | ------ |
| All         | RecID (`*ID`)     | server-generated 20-char string           | create  | [DOCS] |
| All         | `LastSavedDateTime` | current timestamp                       | create/update | [SPEC] |
| Debtor      | `AccountNo`       | auto-generated if omitted                 | create  | [DOCS] |
| Sales Order | line price        | pricing-scheme computed when omitted      | create/line add | [DOCS] |
| Sales Order | `PaymentType`     | Jiwa-configured default                   | payment add | [DOCS] |
| Notes       | `NoteType`        | Jiwa-configured default                   | note add | [DOCS] |
| Sales Order | `InvoiceNo`       | assigned by business logic [UNVERIFIED timing] | create | [SPEC] |

---

## Worked Example: quote-to-cash happy path (all bodies from vendor docs)

> Create a customer, raise an order for them, amend it, then process. **UNVERIFIED end to
> end** -- this is the flow the wiki demonstrates piecewise.

```
1. POST /Debtors                       { "AccountNo": "10042", "Name": "New Trade Customer", "EmailAddress": "ap@example.com" }
   → 201; capture DebtorID from response

2. GET  /Queries/IN_Main?PartNoStartsWith=1170&Fields=InventoryID,PartNo,Description&Take=5
   → resolve the product (optional -- Lines accept PartNo directly)

3. POST /SalesOrders                   { "DebtorID": "<from 1>", "SOReference": "Numa order",
                                         "Lines": [ { "PartNo": "1170", "QuantityOrdered": 5 } ] }
   → 201; capture InvoiceID, InvoiceHistoryID, InvoiceLineIDs; pricing computed by Jiwa

4. PATCH /SalesOrders/{InvoiceID}      { "Lines": [ { "InvoiceLineID": "<line>", "QuantityOrdered": 6 } ] }
   → 200; full updated DTO

5. (After explicit user confirmation)
   GET /SalesOrders/{InvoiceID}/Process
   → 200 "Processed OK"; journals + debtor transactions posted
```

**Notes:**

- Each step's response is the full DTO -- chain IDs from responses, never construct them.
- Steps 1-4 are reversible-ish (PATCH/DELETE); step 5 is a financial posting -- treat as
  irreversible.

---

## Worked Example: small single-purpose mutations (full Numa form)

> The bread-and-butter "user asked for one change" calls, shown end to end.

**Add a note to a sales order** (wiki-documented route family [DOCS] [SPEC]):

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/SalesOrders/000000000800000000NK/Notes",
  "method": "POST",
  "body": { "NoteText": "Customer confirmed delivery window Friday AM" }
})
```

Response: `201` with the note DTO (capture `NoteID`). Default `NoteType` applied. [DOCS]

**Update a debtor custom field value** (wiki body, space-padded SettingID encoded) [DOCS]:

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V/CustomFieldValues/53a277cd848541a694d9%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20/",
  "method": "PATCH",
  "body": { "Contents": "True" }
})
```

Response: `200` with the custom field value DTO. Note the wiki's own curl example replaces
the SettingID's trailing spaces with `%20` -- copy that exactly. [DOCS]

**Put a customer on hold** (status-flag alternative to deleting) [SPEC field, UNVERIFIED
behavior]:

```
connectors(name="request", params={
  "connector": "jiwa",
  "url": "/Debtors/0000000061000000001V",
  "method": "PATCH",
  "body": { "AccountOnHold": true }
})
```

Confirm with the user first -- this blocks new sales for the account in Jiwa's business
logic [UNVERIFIED exact enforcement].

---

## Gotchas & Counter-Exceptions

1. **Updates are PATCH, not PUT.** There is no PUT-replace; sending PUT to entity routes
   will 404/405. (The lone PUT in the spec is
   `PUT /SalesOrders/{InvoiceID}/{InvoiceLineID}/LineDetails` [SPEC].)
2. **Child arrays in PATCH are merge-by-ID.** Omitting the ID appends a duplicate -- the #1
   way to silently corrupt an order. Always include `InvoiceLineID`/`NoteID` when editing.
3. **`/Process` is a GET with side effects.** It posts journals and debtor transactions.
   Never call speculatively; never auto-retry. [DOCS] [SPEC]
4. **DELETE returns 204** -- empty body. Success is the status code alone. [DOCS]
5. **409 means business logic said no** (referenced record, or concurrent edit /
   optimistic-concurrency conflict). Read the body text; re-read the record; do NOT retry
   the same payload blindly. [DOCS]
6. **POST/PATCH responses are the full business DTO** -- large. That is your confirmation
   AND your source for generated IDs; don't re-GET immediately after.
7. **Space-padded SettingIDs.** Custom-field IDs keep trailing spaces; URL-encode `%20`
   in paths and preserve them in bodies. [DOCS]
8. **Human keys are conveniences, RecIDs are truth.** `DebtorAccountNo`/`PartNo` are
   accepted on create but resolved server-side; the RecID always wins on conflict. [DOCS]
9. **API-key user's permissions apply to writes too.** A 403 on POST/PATCH/DELETE means the
   staff member's User Group denies that route -- fix in Jiwa, not in the request. [DOCS]
10. **Writes may be invisible to cached readers.** If the customer runs the caching
    plugins, freshly written data can be served stale elsewhere until invalidated
    (`DELETE /{Entity}/Cache/{id}` routes exist for this) [SPEC] [UNVERIFIED interplay].

---

## Dangerous Operations

> Destructive, irreversible, or financially significant calls. The workspace agent must
> confirm with the user before executing ANY of these -- and given the UNVERIFIED status of
> all writes, should currently confirm before every write, full stop.

| Operation                                          | Why dangerous                                                          | Safeguard                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /SalesOrders/{InvoiceID}/Process`             | Posts journals + debtor transactions (financial state change) [DOCS]    | Explicit user confirmation quoting order no./total; never auto-retry        |
| `POST /SalesOrders` with `Payments`                | Records money received against the order                                | Confirm amounts/refs; omit `Payments` unless the user supplied them          |
| `DELETE /Debtors/{DebtorID}`                       | Hard-deletes a customer masterfile record                                | Confirm; expect 409 if the debtor has history (do not work around it)        |
| `DELETE /SalesOrders/.../Lines/{InvoiceLineID}`    | Removes an order line                                                    | Confirm line identity (show PartNo/qty) before deleting                      |
| `DELETE /Debtors/Categories/{id}` (and other reference data) | Affects every record using that category/type                | Confirm; prefer renaming via PATCH                                           |
| `PATCH /SalesOrders/{InvoiceID}` line edits        | Merge-by-ID semantics: a missing `InvoiceLineID` duplicates the line     | Echo the exact Lines array to the user before sending                        |
| `PATCH .../Historys/{InvoiceHistoryID}` `Status`   | Order lifecycle change; enum values [UNVERIFIED]                         | Do not change Status until values are verified on a live instance            |
| `PATCH` financial fields (prices, credit limits, `AccountOnHold`) | Direct commercial impact                                  | Confirm; prefer letting pricing-scheme logic price lines (omit price)        |
| `POST/PATCH /Debtors/{id}/Documents` with `FileBinary` | Replaces stored file content on PATCH                               | Confirm replacement; download/back up first if content matters               |
| Any write after a timeout                          | POST idempotency undocumented -- duplicate risk                          | Read back (e.g. `/Queries/*` by reference/`LastSavedDateTime`) before retry  |

---

_Generated from the official Jiwa OpenAPI specification and the wiki worked-example pages
(Sales Order API Operations, Debtor API Operations), Phases 3-4._
_**ALL WRITES UNVERIFIED** -- exercise on a test instance before first customer use._
