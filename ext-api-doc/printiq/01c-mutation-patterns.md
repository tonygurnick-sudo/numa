---
api_name: PrintIQ
api_slug: printiq
companion_to: 01-llm-api-rules.md
content: write operations — create, update, delete, state transitions, nested records
confidence: LOW. No write endpoint is publicly documented. Every method, path, payload, and validation rule is [INFERRED]. `GetPrice` (a compute call, not a stored-record write) is the only operation with public grounding. Treat every write as high-risk and unverified: confirm with the user before executing, then read the actual response to learn the real contract.
---

# PrintIQ — Mutation Patterns Reference

## Write Capabilities

| Operation                 | Supported  | Method      | Notes                                                   |
| ------------------------- | ---------- | ----------- | ------------------------------------------------------- |
| Create                    | [INFERRED] | POST        | Quotes, customers (existence likely; shape unverified)  |
| Full replace              | [UNKNOWN]  | PUT         | Update mechanism unverified                             |
| Partial update            | [UNKNOWN]  | PATCH       | Unverified                                              |
| Delete                    | [UNKNOWN]  | DELETE      | Not documented — do NOT assume it exists/is safe        |
| Soft delete               | [UNKNOWN]  | —           | Unverified                                              |
| Bulk create/update/delete | [UNKNOWN]  | —           | None documented                                         |
| State transitions         | [INFERRED] | POST/action | Quote → order conversion is one-way                     |
| File upload               | [UNKNOWN]  | —           | Artwork moves via punch-out/cXML, not confirmed in REST |

## Patterns

### 1. Create (quote / customer) [INFERRED — UNVERIFIED]

```http
POST /api/Quote   Authorization: Bearer {token}   Content-Type: application/json
{ "customerCode": "CUST001", "lines": [ { "productCode": "BC-350GSM", "quantity": 500, "options": { "finish": "Matte Laminate", "sides": "Double Sided" } } ] }
```

→ (assumed 200/201): `{ "quoteNo": "Q-100235", "status": "Draft", "total": 250.0, "currency": "NZD", "createdDate": "2026-05-29T10:05:00Z" }`

- Required fields `[UNKNOWN]` — `customerCode` + `lines` assumed.
- Server-generated: `quoteNo`, `quoteGuid`, `total`, `createdDate` assumed server-set.
- Idempotency: NO idempotency-key support documented — a repeated POST likely creates a duplicate quote. Guard creates and confirm first. [INFERRED]

### 2. Update (partial) [UNKNOWN]

Whether PATCH is supported, and on which resources, is unverified.

```http
[INFERRED — UNVERIFIED] PATCH /api/Quote/{quoteNo}   Authorization: Bearer {token}   Content-Type: application/json
{ "lines": [ { "productCode": "BC-350GSM", "quantity": 1000 } ] }
```

Behavior `[UNKNOWN]` — whether omitted fields are preserved (PATCH) or wiped (PUT-as-PATCH) is unverified; read the response and re-GET to confirm before relying on it. [INFERRED]

### 3. Update (full replace) [UNKNOWN]

```http
[INFERRED — UNVERIFIED] PUT /api/Customer/{customerCode}   Authorization: Bearer {token}   Content-Type: application/json
{ "customerCode": "CUST001", "name": "Acme Signs Ltd", "priceList": "Trade", "contacts": [...] }
```

If PUT is full-replace, omitted fields may be cleared — re-GET first and send the full object plus your changes. [INFERRED]

### 4. Delete [UNKNOWN — assume unsupported]

Delete is NOT documented. Do NOT call DELETE on printIQ resources unless the IQConnect doc pack explicitly confirms it. Print-MIS quotes/orders/jobs are usually voided/cancelled (a state change), not hard-deleted — prefer a cancel/void action over DELETE. [INFERRED]

### 5. State transition (accept / convert a quote) [INFERRED]

The most consequential transition: turning a quote into an order/job. ONE-WAY, creates production work — always confirm with the user.

- Option A (dedicated action, likely): `POST /api/Quote/{quoteNo}/Accept` (Bearer token) `[INFERRED — UNVERIFIED]`
- Option B (status field update, alternative): `PATCH /api/Quote/{quoteNo}` `{ "status": "Accepted" }` `[INFERRED — UNVERIFIED]`
  Valid transitions: see the state machine in 01a. Quote → Order is irreversible. [INFERRED]

### 6. Nested / related record operations [UNKNOWN]

Whether quote lines / contacts / addresses are written inline (nested in the parent body) or via sub-resource endpoints is unverified. The create examples assume **inline nested** writes (`lines[]`, `contacts[]`, `addresses[]`). Confirm against the doc pack. [INFERRED]

## Field Validation (rules the API enforces are `[UNKNOWN]` — none public; anticipated)

| Entity   | Field               | Rule (INFERRED)                             | Error if violated |
| -------- | ------------------- | ------------------------------------------- | ----------------- |
| Quote    | customerCode        | Must reference an existing customer         | `[UNKNOWN]`       |
| Quote    | lines[].productCode | Must reference a valid product              | `[UNKNOWN]`       |
| Quote    | lines[].options     | Must satisfy the product's required options | `[UNKNOWN]`       |
| Customer | name                | Likely required, non-empty                  | `[UNKNOWN]`       |

Required fields, max lengths, numeric ranges, regex, enum restrictions: all `[UNKNOWN]` — discover from live validation errors.

## Server-Side Defaults (INFERRED)

| Entity | Field       | Default                | When applied   |
| ------ | ----------- | ---------------------- | -------------- |
| Quote  | quoteNo     | auto-generated         | create         |
| Quote  | quoteGuid   | auto-generated         | create         |
| Quote  | status      | `Draft`                | create         |
| Quote  | total       | computed price         | create, update |
| Quote  | createdDate | current timestamp      | create         |
| any    | currency    | from instance settings | create         |

## Worked Examples (all `[INFERRED]` reconstructions, NOT live calls)

1. Save a quote for 500 business cards [INFERRED]:
   `POST /api/Quote` (Host {instance}.printiq.com, Bearer token)
   `{ "customerCode": "CUST001", "lines": [ { "productCode": "BC-350GSM", "quantity": 500, "options": { "finish": "Matte Laminate", "sides": "Double Sided" } } ] }`
   → (assumed): `{ "quoteNo": "Q-100235", "status": "Draft", "total": 250.0, "currency": "NZD" }`

- Confirm with the user before saving — a saved quote is visible to staff. [INFERRED]
- Best practice: `GetPrice` first to show the price, save the quote only on confirmation. [INFERRED]

2. Create a customer [INFERRED]:
   `POST /api/Customer` (Bearer token)
   `{ "name": "Beta Print Co", "priceList": "Trade", "contacts": [ { "name": "Jane Doe", "email": "jane@betaprint.co.nz" } ], "addresses": [ { "type": "Billing", "line1": "12 Queen St", "city": "Auckland", "country": "NZ" } ] }`
   → (assumed): `{ "customerCode": "CUST014", "name": "Beta Print Co", "accountStatus": "Active" }`

- `customerCode` assumed server-generated; do NOT send one on create. [INFERRED]
- Check for an existing customer first to avoid duplicates (no dedup behaviour documented). [INFERRED]

3. Accept a quote (convert to order/job) [INFERRED]:
   `POST /api/Quote/Q-100235/Accept` (Bearer token)
   → (assumed): `{ "quoteNo": "Q-100235", "status": "Accepted", "orderNo": "O-55013", "jobNo": "J-100240" }`

- Irreversible and creates production work — always confirm explicitly. [INFERRED]

## Gotchas

1. `app_name`/`app_key` belong to AUTH (token exchange), never to a create/update body. [INFERRED]
2. No idempotency keys — repeated POSTs likely create duplicates. Read-before-write; confirm-first. [INFERRED]
3. Delete unconfirmed — prefer cancel/void; don't hard-delete print records. [INFERRED]
4. Quote acceptance is one-way — converting a quote to an order/job cannot be undone via API. [INFERRED]
5. Pricing is recomputed server-side — don't send a `total` on create expecting it to stick; printIQ prices the lines itself. [INFERRED]

## Dangerous Operations (confirm with the user before executing)

| Operation                   | Why dangerous                                | Safeguard                                         |
| --------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Accept / convert a quote    | Irreversible; creates production work + cost | Confirm explicitly; restate quote no + total      |
| Create a quote              | Visible to staff; no dedup; no idempotency   | GetPrice + show user first; confirm before saving |
| Create a customer           | No dedup; may duplicate an existing account  | Search/read first; confirm before creating        |
| Any DELETE (if it exists)   | Unconfirmed semantics; possibly cascading    | Do NOT call unless doc pack confirms; prefer void |
| Bulk writes (if discovered) | Large blast radius; undocumented             | Confirm scope explicitly; start with one record   |
