---
api_name: Jiwa Financials
api_slug: jiwa
doc: mutation-patterns-reference (companion to 01-llm-api-rules.md)
base_url: per-customer self-hosted instance; no shared host. call_surface: HTTP via `numa integrations request` (connector jiwa). verbs PATCH not PUT — Bearer key injected by backend, never set auth.
field_casing: PascalCase
confidence: spec/docs-derived, NOT live-validated. [SPEC]=OpenAPI, [DOCS]=Jiwa wiki worked-examples (Sales Order + Debtor pages), [UNVERIFIED]=inferred.
WARNING: ALL WRITES UNVERIFIED — no write here has been executed against a live Jiwa instance. Bodies are the vendor's own wiki/spec examples; field behavior, validation, and side effects NOT confirmed. Jiwa is a financial system of record (orders post journals + debtor transactions; deletes are hard). Until exercised on a test instance — (1) confirm every write with the user, show the exact body; (2) start in a test company/db if available; (3) never retry a timed-out write blindly — read the entity back first (POSTs not documented as idempotent); (4) treat the Dangerous Operations table as requiring explicit sign-off.
---

# Jiwa Financials — Mutation Patterns

Write operations: create, update, delete, nested child records, the sales-order multi-step flow. Call form: `METHOD /path body {...}` via `numa integrations request` (connector jiwa).

## Write capabilities summary

| Operation         | Supported       | Method | Notes                                                                        |
| ----------------- | --------------- | ------ | ---------------------------------------------------------------------------- |
| Create            | Yes             | POST   | `201 Created`; response = FULL business DTO incl. generated IDs [DOCS]       |
| Partial update    | Yes             | PATCH  | Only provided fields change; children matched by ID (below) [DOCS]           |
| Full replace      | No              | —      | No PUT-replace convention (a lone `PUT .../LineDetails` route exists [SPEC]) |
| Delete            | Yes             | DELETE | `204 No Content`; **hard delete**; `409` if referenced elsewhere [DOCS]      |
| Soft delete       | Status only     | PATCH  | Some entities have status/hold flags (e.g. `AccountOnHold`) instead          |
| Bulk create       | Inline children | POST   | One parent + many children in one body (Lines, Notes, Payments) [DOCS]       |
| Bulk update       | Inline children | PATCH  | Mixed append/update of children in one PATCH [DOCS]                          |
| Bulk delete       | No              | —      | One DELETE per record                                                        |
| State transitions | Yes             | GET(!) | `GET /SalesOrders/{InvoiceID}/Process` posts journals [SPEC] — see below     |
| File upload       | Yes             | POST   | Documents with base64 `FileBinary` [DOCS]                                    |

**Verbs** [DOCS]: GET=read, POST=create, **PATCH=update** (Jiwa does NOT use PUT for updates), DELETE=delete. Success codes: `201` POST, `200` PATCH, `204` DELETE.

## The three success shapes [DOCS][SPEC]

- **POST → 201 Created.** Body = FULL new-entity DTO — generated RecIDs (DebtorID, InvoiceID, line IDs…), defaults applied, computed fields (e.g. line pricing).
- **PATCH → 200 OK.** Body = FULL updated DTO (not a diff).
- **DELETE → 204 No Content.** Body EMPTY — success is the status code alone; do not JSON-parse.

**Never re-GET after a write** — the response already IS the current state, including every generated ID for the next step. Responses are **large** (full object graph) — extract what's needed; don't echo raw.

## RecID semantics

- **RecID** = 20-char opaque string (`0000000061000000001V`, `babce67cdbf64f778536`); some child records use GUIDs (note IDs like `80C3C46B-9D64-4451-BE6B-9CF68C9BCBE3`) [DOCS][SPEC]. Field name varies: `DebtorID`, `InvoiceID`, `InventoryID`, `QuoteID`, `NoteID`, `DocumentID`, `InvoiceLineID`, `InvoiceHistoryID`, `SettingID`.
- **Server-generated on POST** — never supply them; you don't know an ID until the create response returns it [DOCS].
- **`SettingID`s are space-padded** — URL-encode trailing spaces `%20` in paths; never trim/normalize IDs [DOCS].
- Human numbers (`AccountNo`, `InvoiceNo`, `PartNo`) are NOT route keys — resolve to RecIDs via `/Queries/*` first (01b). On creates accepting both a human key and RecID: **RecID wins** [DOCS].
- **Optimistic concurrency:** rows carry a `RowHash`; a record changed between read and save → `409 Conflict` — re-read, re-apply [DOCS].

## Common patterns

### Pattern 1 — Create a Debtor (customer)

Nothing mandatory — "You don't need to provide anything to create a customer — an AccountNo and DebtorID will be generated… however it's usual practice to provide an AccountNo." [DOCS]
`POST /Debtors body {"AccountNo":"NewAccountNo","Name":"A new customer","EmailAddress":"name@example.com","WebAccess":true}`
→ `201` = full debtor DTO (generated `DebtorID`, defaults applied, empty child collections) [DOCS]. Capture `DebtorID` for follow-ups.

Create with children inline (wiki: customer with 2 notes) [DOCS]:
`POST /Debtors body {"AccountNo":"NewAccountNo","Name":"A new customer","EmailAddress":"name@example.com","WebAccess":true,"Notes":[{"NoteText":"Note text 1"},{"NoteText":"Note text 2"}]}`

### Pattern 2 — Update: PATCH with child-collection merge semantics

The single most important write convention. A PATCH body updates only the scalar fields you include; for child collections (`Notes`, `Lines`…), an element **WITH its ID** updates that child, an element **WITHOUT an ID** is **appended as new** [DOCS].

Wiki example — update email + web access, add one note, modify another, in one call [DOCS]:
`PATCH /Debtors/0000000061000000001V body {"EmailAddress":"name2@example.com","WebAccess":false,"Notes":[{"NoteText":"A new note added"},{"NoteID":"DE91CC53-724A-47C6-8920-57AC82BFAD1F","NoteText":"A modified note text"}]}`
→ `200` = full updated entity DTO.

Consequences: echoing a GET response back in a PATCH is dangerous — children that legitimately have IDs are fine (update-in-place), but any reconstructed/ID-stripped child becomes a **duplicate append**. Send only what you intend to change. Whether omitted children are left untouched (expected) vs removed is [UNVERIFIED] — verify before bulk edits. Null-clearing (`"Field":null`) is [UNVERIFIED] — don't send nulls to clear fields until tested; ask the user and test on a scratch record.

### Pattern 3 — Delete

`DELETE /Debtors/0000000061000000001V` → `204 No Content` on success [DOCS][SPEC].

- **Hard delete** — no documented undo.
- `409 Conflict` when business logic refuses: "You can't delete a product because it is used on a sales order." [DOCS] Referenced masterfile records (debtors with transactions, inventory on orders) are undeletable — a safety feature, not an error to work around.
- Child deletes use the nested route: `DELETE /Debtors/{DebtorID}/Notes/{NoteID}`, `DELETE /Debtors/{DebtorID}/ContactNames/{ContactNameID}`, `DELETE /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}` [SPEC].

### Pattern 4 — Child-record CRUD (explicit routes)

Everything doable inline through the parent POST/PATCH also has dedicated child routes [DOCS] — often clearer for single-child operations:

```
POST   /Debtors/{DebtorID}/Notes                        {"NoteText":"This is a new note"}
PATCH  /Debtors/{DebtorID}/Notes/{NoteID}               {"NoteText":"This is an updated note"}
DELETE /Debtors/{DebtorID}/Notes/{NoteID}
POST   /Debtors/{DebtorID}/ContactNames                 {"Title":"Mr.","FirstName":"Fred","Surname":"Bloggs","PrimaryPositionName":"External Accountant","EmailAddress":"Fred@example.com"}
PATCH  /Debtors/{DebtorID}/ContactNames/{ContactNameID} {"DefaultContact":true}
POST   /Debtors/{DebtorID}/DeliveryAddresses            {"Address1":"Unit 1A","Address2":"57 Smith Street","Address3":"Blakeville","Address4":"NSW","Postcode":"2126","IsDefault":true,"Country":"Australia"}
PATCH  /Debtors/{DebtorID}/DeliveryAddresses/{DeliveryAddressID}  {"Country":"Australia"}
POST   /Debtors/{DebtorID}/GroupMemberships             {"GroupDescription":"Default - No Group","StaffUsername":"Admin"}
PATCH  /Debtors/{DebtorID}/GroupMemberships/{GroupMembershipID}   {"IsDefault":true}
```

(All bodies from the wiki Debtor examples page [DOCS].) Adding notes: omitting `NoteType` applies the default note type configured in Jiwa [DOCS].

**Documents (file attachments)** — base64 in `FileBinary` [DOCS]:
`POST /Debtors/0000000061000000001V/Documents body {"Description":"A new document","PhysicalFileName":"Test.png","FileBinary":"<base64-encoded file contents>"}`
`PATCH .../Documents/{DocumentID}` with a new `FileBinary` replaces the content. Keep files small — no documented size limit [UNVERIFIED]; large base64 bodies through the connector untested.

**Custom field values** — per-entity custom fields listed at `GET /{Entity}/CustomFields`, read/written per record [DOCS]:
`PATCH /Debtors/{DebtorID}/CustomFieldValues/{SettingID} body {"Contents":"True"}`
`PATCH /SalesOrders/{InvoiceID}/CustomFieldValues/{SettingID} body {"Contents":"New Contents"}`
`Contents` is always a string. `SettingID` values are space-padded — URL-encode trailing spaces as `%20`, don't trim [DOCS].

### Pattern 5 — Sales Order (the flagship multi-step flow)

Sales orders are the wiki's worked-example centerpiece [DOCS]. Three ways to build one:

**Step A — create the order (lines, comment, payment inline):**
`POST /SalesOrders body {"DebtorID":"00000000080000000002","OrderNo":"1234","SOReference":"Test order","Lines":[{"PartNo":"1170","QuantityOrdered":5},{"CommentLine":true,"CommentText":"This is a comment line"},{"InventoryID":"000000000K00000000BV","QuantityOrdered":2,"DiscountedPrice":15.67,"CustomFieldValues":[{"SettingID":"1ae102b94dc54dfc8a45                ","Contents":"Fragile - do not drop"}]}],"Payments":[{"PaymentRef":"S454873-J5","AmountPaid":50.00}]}`
→ `201` = full sales order DTO (generated `InvoiceID`, current `InvoiceHistoryID` snapshot, per-line `InvoiceLineID`s, pricing computed) [DOCS]. Vendor notes on this body [DOCS]: (1) `DebtorID` or `DebtorAccountNo`; if both, `DebtorID` wins. (2) Lines take `InventoryID` or `PartNo`; if both, `InventoryID` wins. (3) **Omit the price → Jiwa prices the line via its pricing-scheme logic** — send `DiscountedPrice` only to override. (4) `CustomFieldValues` reference a `SettingID` (space-padded!). (5) Omit `PaymentType` → Jiwa-configured default. (6) `InitiatedDate` may be supplied; defaults applied otherwise [UNVERIFIED default].

**Step B — amend the order (one PATCH: new line + adjust line + add note):**
`PATCH /SalesOrders/babce67cdbf64f778536 body {"ExpectedDeliveryDate":"2026-06-15T00:00:00","Lines":[{"PartNo":"1172","QuantityOrdered":5},{"InvoiceLineID":"88a358a2822e4319b9b9","QuantityOrdered":10,"CustomFieldValues":[{"SettingID":"1ae102b94dc54dfc8a45                ","Contents":"Adjustment requested by phone"}]}],"Notes":[{"NoteText":"Customer telephoned and asked for another few hours of labour"}]}`
Line WITH `InvoiceLineID` = update; WITHOUT = append [DOCS].

**Step B-alt — line-level routes (snapshot/Historys model).** Order lines live under the order's current **history snapshot**:

```
POST   /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines  {"PartNo":"1170","QuantityOrdered":5,"DiscountedPrice":15.45}
POST   .../Lines  {"CommentLine":true,"CommentText":"This is a comment line"}
PATCH  /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}  {"QuantityOrdered":6}
DELETE /SalesOrders/{InvoiceID}/Historys/{InvoiceHistoryID}/Lines/{InvoiceLineID}
```

Get `InvoiceHistoryID` from `GET /SalesOrders/{InvoiceID}` or `.../Historys`. To update history-level fields, PATCH the **sales order** (not the Historys route) — values pass through to the current snapshot [DOCS]. A direct `PATCH .../Historys/{InvoiceHistoryID}` exists for fields like `Status` (`{"Status":2}` in the wiki — enum meaning [UNVERIFIED]).

**Step C — process the order (DANGEROUS — posts financials):**
`GET /SalesOrders/000000000800000000NK/Process`
"To process a sales order, a specific route must be called, this then performs the business logic for posting journals and debtor transactions." [DOCS] In the spec this is a **GET** (`GET /SalesOrders/{InvoiceID}/Process`, 200 = "Processed OK", returns the processed SalesOrder DTO) [SPEC].

- **A GET with major side effects.** Never call it in a "read everything" sweep; never auto-retry. Idempotency on re-process [UNVERIFIED] — assume NOT idempotent.
- A financial state transition (journals + debtor transactions). Always confirm with the user first, quoting order number/total.

### Pattern 6 — Sales Quotes (the parallel surface)

Sales quotes mirror the sales order model almost route-for-route [SPEC]:

```
POST   /SalesQuotes                                          # create (QuoteID generated)
GET    /SalesQuotes/{QuoteID}
PATCH  /SalesQuotes/{QuoteID}                                # same child-merge semantics
POST   /SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines
PATCH  /SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines/{QuoteLineID}
DELETE /SalesQuotes/{QuoteID}/Historys/{QuoteHistoryID}/Lines/{QuoteLineID}
```

Everything said about orders (Historys snapshot model, `InventoryID`/`PartNo` resolution, price-omission → pricing scheme, custom field values) applies to quotes by analogy [UNVERIFIED in detail — wiki documents orders; quotes follow the same DTO pattern in the spec]. Quote → order conversion via `POST /SalesQuotes/{QuoteID}/MakeOrder` (or `/MakeOrderB2B`) [SPEC].

### Pattern 7 — Reference-data CRUD (categories etc.)

```
POST   /Debtors/Categories                 {"Description":"Another new category","CategoryNo":1}
PATCH  /Debtors/Categories/{CategoryID}     {"Description":"Another modified category"}
DELETE /Debtors/Categories/{CategoryID}
```

[DOCS] Same shape for classifications, note types, document types, payment types, credit reasons (under their respective parents [SPEC]). Admin-ish masterfile edits — confirm before touching; they affect every record using them.

## Field validation rules

> Largely [UNVERIFIED] — Jiwa returns an HTTP status + plain-text/DTO description (e.g. "product not found") [DOCS]; `DebugMode` adds stack traces. Table lists what docs/spec establish.

| Entity             | Field                        | Rule                                                          | Source |
| ------------------ | ---------------------------- | ------------------------------------------------------------- | ------ |
| Debtor             | (none required)              | POST with empty body valid; AccountNo+DebtorID generated      | [DOCS] |
| Sales Order        | `DebtorID`/`DebtorAccountNo` | One required to resolve the debtor; DebtorID wins if both     | [DOCS] |
| Sales Order line   | `InventoryID`/`PartNo`       | One required (product lines); InventoryID wins if both        | [DOCS] |
| Sales Order line   | `CommentLine: true`          | Makes it a comment line; `CommentText` carries the text       | [DOCS] |
| Sales Order line   | price omitted                | Jiwa computes price from pricing scheme                       | [DOCS] |
| Payment            | `PaymentType` omitted        | Default payment type applied                                  | [DOCS] |
| Note               | `NoteType` omitted           | Default note type applied                                     | [DOCS] |
| Custom field value | `SettingID`                  | Must match an existing custom field; preserve trailing spaces | [DOCS] |
| Any update         | concurrent edit              | `409 Conflict` (optimistic concurrency / RowHash)             | [DOCS] |
| Any delete         | referenced record            | `409 Conflict` with explanation in body                       | [DOCS] |

## Server-side defaults

| Entity      | Field               | Default                                        | When            | Source |
| ----------- | ------------------- | ---------------------------------------------- | --------------- | ------ |
| All         | RecID (`*ID`)       | server-generated 20-char string                | create          | [DOCS] |
| All         | `LastSavedDateTime` | current timestamp                              | create/update   | [SPEC] |
| Debtor      | `AccountNo`         | auto-generated if omitted                      | create          | [DOCS] |
| Sales Order | line price          | pricing-scheme computed when omitted           | create/line add | [DOCS] |
| Sales Order | `PaymentType`       | Jiwa-configured default                        | payment add     | [DOCS] |
| Notes       | `NoteType`          | Jiwa-configured default                        | note add        | [DOCS] |
| Sales Order | `InvoiceNo`         | assigned by business logic [UNVERIFIED timing] | create          | [SPEC] |

## Worked example: quote-to-cash happy path (all bodies from vendor docs)

> Create a customer, raise an order, amend, then process. **UNVERIFIED end to end** — the flow the wiki demonstrates piecewise.

```
1. POST /Debtors  {"AccountNo":"10042","Name":"New Trade Customer","EmailAddress":"ap@example.com"}
   → 201; capture DebtorID from response
2. GET  /Queries/IN_Main?PartNoStartsWith=1170&Fields=InventoryID,PartNo,Description&Take=5
   → resolve the product (optional — Lines accept PartNo directly)
3. POST /SalesOrders  {"DebtorID":"<from 1>","SOReference":"Numa order","Lines":[{"PartNo":"1170","QuantityOrdered":5}]}
   → 201; capture InvoiceID, InvoiceHistoryID, InvoiceLineIDs; pricing computed by Jiwa
4. PATCH /SalesOrders/{InvoiceID}  {"Lines":[{"InvoiceLineID":"<line>","QuantityOrdered":6}]}
   → 200; full updated DTO
5. (After explicit user confirmation) GET /SalesOrders/{InvoiceID}/Process
   → 200 "Processed OK"; journals + debtor transactions posted
```

Each step's response is the full DTO — chain IDs from responses, never construct them. Steps 1–4 reversible-ish (PATCH/DELETE); step 5 is a financial posting — treat as irreversible.

## Worked example: small single-purpose mutations

> The bread-and-butter "user asked for one change" calls.

**Add a note to a sales order** (wiki-documented route family [DOCS][SPEC]):
`POST /SalesOrders/000000000800000000NK/Notes body {"NoteText":"Customer confirmed delivery window Friday AM"}`
→ `201` with the note DTO (capture `NoteID`). Default `NoteType` applied [DOCS].

**Update a debtor custom field value** (wiki body, space-padded SettingID encoded) [DOCS]:
`PATCH /Debtors/0000000061000000001V/CustomFieldValues/53a277cd848541a694d9%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20/ body {"Contents":"True"}`
→ `200` with the custom field value DTO. The wiki's own curl example replaces the SettingID's trailing spaces with `%20` — copy exactly [DOCS].

**Put a customer on hold** (status-flag alternative to deleting) [SPEC field, UNVERIFIED behavior]:
`PATCH /Debtors/0000000061000000001V body {"AccountOnHold":true}`
Confirm with the user first — blocks new sales for the account in Jiwa's business logic [UNVERIFIED exact enforcement].

## Gotchas & counter-exceptions

1. **Updates are PATCH, not PUT.** No PUT-replace; PUT to entity routes will 404/405. (The lone PUT in spec is `PUT /SalesOrders/{InvoiceID}/{InvoiceLineID}/LineDetails` [SPEC].)
2. **Child arrays in PATCH are merge-by-ID.** Omitting the ID appends a duplicate — the #1 way to silently corrupt an order. Always include `InvoiceLineID`/`NoteID` when editing.
3. **`/Process` is a GET with side effects** — posts journals and debtor transactions. Never call speculatively; never auto-retry [DOCS][SPEC].
4. **DELETE returns 204** — empty body. Success is the status code alone [DOCS].
5. **409 means business logic said no** (referenced record, or concurrent/optimistic-concurrency conflict). Read the body text; re-read the record; do NOT blind-retry the same payload [DOCS].
6. **POST/PATCH responses are the full business DTO** — large. That is your confirmation AND your source for generated IDs; don't re-GET immediately after.
7. **Space-padded SettingIDs.** Custom-field IDs keep trailing spaces; URL-encode `%20` in paths and preserve them in bodies [DOCS].
8. **Human keys are conveniences, RecIDs are truth.** `DebtorAccountNo`/`PartNo` are accepted on create but resolved server-side; the RecID always wins on conflict [DOCS].
9. **API-key user's permissions apply to writes too.** A 403 on POST/PATCH/DELETE = the staff member's User Group denies that route — fix in Jiwa, not in the request [DOCS].
10. **Writes may be invisible to cached readers.** If the customer runs the caching plugins, freshly written data can be served stale until invalidated (`DELETE /{Entity}/Cache/{id}` routes exist) [SPEC][UNVERIFIED interplay].

## Dangerous operations

> Destructive, irreversible, or financially significant. Confirm with the user before executing ANY — and given the UNVERIFIED status of all writes, confirm before every write, full stop.

| Operation                                                         | Why dangerous                                                        | Safeguard                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /SalesOrders/{InvoiceID}/Process`                            | Posts journals + debtor transactions (financial state change) [DOCS] | Explicit confirmation quoting order no./total; never auto-retry             |
| `POST /SalesOrders` with `Payments`                               | Records money received against the order                             | Confirm amounts/refs; omit `Payments` unless the user supplied them         |
| `DELETE /Debtors/{DebtorID}`                                      | Hard-deletes a customer masterfile record                            | Confirm; expect 409 if the debtor has history (don't work around it)        |
| `DELETE /SalesOrders/.../Lines/{InvoiceLineID}`                   | Removes an order line                                                | Confirm line identity (show PartNo/qty) before deleting                     |
| `DELETE /Debtors/Categories/{id}` (and other reference data)      | Affects every record using that category/type                        | Confirm; prefer renaming via PATCH                                          |
| `PATCH /SalesOrders/{InvoiceID}` line edits                       | Merge-by-ID: a missing `InvoiceLineID` duplicates the line           | Echo the exact Lines array to the user before sending                       |
| `PATCH .../Historys/{InvoiceHistoryID}` `Status`                  | Order lifecycle change; enum values [UNVERIFIED]                     | Don't change Status until values are verified live                          |
| `PATCH` financial fields (prices, credit limits, `AccountOnHold`) | Direct commercial impact                                             | Confirm; prefer letting pricing-scheme logic price lines (omit price)       |
| `POST/PATCH /Debtors/{id}/Documents` with `FileBinary`            | Replaces stored file content on PATCH                                | Confirm replacement; download/back up first if content matters              |
| Any write after a timeout                                         | POST idempotency undocumented — duplicate risk                       | Read back (e.g. `/Queries/*` by reference/`LastSavedDateTime`) before retry |
