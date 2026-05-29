---
api_name: 'PrintIQ'
api_slug: 'printiq'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
update_source: 'web research only — NO live API access; partner-gated docs'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# PrintIQ -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operation patterns: create, update, delete, state
> transitions, and nested record operations.
>
> ⚠️ **CONFIDENCE: LOW.** No write endpoint is publicly documented. **Every method, path, payload,
> and validation rule below is `[INFERRED]`.** `GetPrice` (a compute call, not a stored-record write)
> is the only operation with public grounding. **Treat every write as high-risk and unverified:**
> confirm with the user before executing, and read the actual response to learn the real contract.

---

## Write Capabilities Summary

| Operation         | Supported  | Method      | Notes                                                   |
| ----------------- | ---------- | ----------- | ------------------------------------------------------- |
| Create            | [INFERRED] | POST        | Quotes, customers (existence likely; shape unverified)  |
| Full replace      | [UNKNOWN]  | PUT         | Update mechanism unverified                             |
| Partial update    | [UNKNOWN]  | PATCH       | Unverified                                              |
| Delete            | [UNKNOWN]  | DELETE      | Not documented — do NOT assume it exists/is safe        |
| Soft delete       | [UNKNOWN]  | —           | Unverified                                              |
| Bulk create       | [UNKNOWN]  | —           | None documented                                         |
| Bulk update       | [UNKNOWN]  | —           | None documented                                         |
| Bulk delete       | [UNKNOWN]  | —           | None documented                                         |
| State transitions | [INFERRED] | POST/action | Quote → order conversion is one-way                     |
| File upload       | [UNKNOWN]  | —           | Artwork moves via punch-out/cXML, not confirmed in REST |

---

## Common Patterns

### Pattern 1: Create (quote / customer) [INFERRED — UNVERIFIED]

```http
POST /api/Quote
Authorization: Bearer {token}
Content-Type: application/json

{
  "customerCode": "CUST001",
  "lines": [
    { "productCode": "BC-350GSM", "quantity": 500,
      "options": { "finish": "Matte Laminate", "sides": "Double Sided" } }
  ]
}
```

**Response (assumed 200/201 — UNVERIFIED):**

```json
{ "quoteNo": "Q-100235", "status": "Draft", "total": 250.0, "currency": "NZD", "createdDate": "2026-05-29T10:05:00Z" }
```

**Required fields:** `[UNKNOWN]` — `customerCode` + `lines` assumed. [INFERRED]
**Server-generated fields:** `quoteNo`, `quoteGuid`, `total`, `createdDate` assumed server-set. [INFERRED]
**Idempotency:** **No idempotency-key support is documented.** A repeated POST likely creates a duplicate quote — guard creates and confirm first. [INFERRED]

---

### Pattern 2: Update (partial) [UNKNOWN]

> Whether PATCH is supported, and on which resources, is unverified.

```http
[INFERRED — UNVERIFIED]
PATCH /api/Quote/{quoteNo}
Authorization: Bearer {token}
Content-Type: application/json

{ "lines": [ { "productCode": "BC-350GSM", "quantity": 1000 } ] }
```

**Behavior:** `[UNKNOWN]`. Whether omitted fields are preserved (PATCH semantics) or wiped (PUT-as-PATCH) is unverified — read the response and re-GET to confirm before relying on it. [INFERRED]

---

### Pattern 3: Update (full replace) [UNKNOWN]

```http
[INFERRED — UNVERIFIED]
PUT /api/Customer/{customerCode}
Authorization: Bearer {token}
Content-Type: application/json

{ "customerCode": "CUST001", "name": "Acme Signs Ltd", "priceList": "Trade", "contacts": [...] }
```

**Behavior:** If PUT is full-replace, omitted fields may be cleared. Re-GET the record first and send back the full object plus your changes. [INFERRED]

---

### Pattern 4: Delete [UNKNOWN — assume unsupported]

**Delete is not documented.** Do NOT call DELETE on PrintIQ resources unless the IQConnect doc pack
explicitly confirms it. Quotes/orders/jobs in a print MIS are usually voided/cancelled (a state
change), not hard-deleted. Prefer a cancel/void action over DELETE. [INFERRED]

---

### Pattern 5: State transition (accept / convert a quote) [INFERRED]

> The most consequential transition: turning a quote into an order/job. This is **one-way** and
> creates production work — always confirm with the user.

**Option A: Dedicated action endpoint (likely):**

```http
[INFERRED — UNVERIFIED]
POST /api/Quote/{quoteNo}/Accept
Authorization: Bearer {token}
```

**Option B: Status field update (alternative):**

```http
[INFERRED — UNVERIFIED]
PATCH /api/Quote/{quoteNo}
Authorization: Bearer {token}

{ "status": "Accepted" }
```

**Valid transitions:** See the state machine in `01a-domain-model-reference.md`. Quote → Order is irreversible. [INFERRED]

---

### Pattern 6: Nested / related record operations [UNKNOWN]

Whether quote lines / contacts / addresses are written inline (nested in the parent body) or via
sub-resource endpoints is unverified. The create examples above assume **inline nested** writes
(`lines[]`, `contacts[]`, `addresses[]`). Confirm against the doc pack. [INFERRED]

---

## Field Validation Rules

> Rules the API enforces on write operations are **`[UNKNOWN]`** — none are public. Anticipated:

| Entity   | Field               | Rule (INFERRED)                             | Error if Violated |
| -------- | ------------------- | ------------------------------------------- | ----------------- |
| Quote    | customerCode        | Must reference an existing customer         | `[UNKNOWN]`       |
| Quote    | lines[].productCode | Must reference a valid product              | `[UNKNOWN]`       |
| Quote    | lines[].options     | Must satisfy the product's required options | `[UNKNOWN]`       |
| Customer | name                | Likely required, non-empty                  | `[UNKNOWN]`       |

**Common validation patterns:** all `[UNKNOWN]` — required fields, max lengths, numeric ranges, regex,
and enum restrictions must be discovered from live validation errors.

---

## Server-Side Defaults (INFERRED)

| Entity | Field       | Default Value          | When Applied   |
| ------ | ----------- | ---------------------- | -------------- |
| Quote  | quoteNo     | auto-generated         | create         |
| Quote  | quoteGuid   | auto-generated         | create         |
| Quote  | status      | `Draft`                | create         |
| Quote  | total       | computed price         | create, update |
| Quote  | createdDate | current timestamp      | create         |
| any    | currency    | from instance settings | create         |

---

## Worked Examples

> ⚠️ All examples are `[INFERRED]` reconstructions, not captured live calls.

### Example 1: Save a quote for 500 business cards [INFERRED]

```http
POST /api/Quote
Host: {instance}.printiq.com
Authorization: Bearer {token}
Content-Type: application/json

{ "customerCode": "CUST001",
  "lines": [ { "productCode": "BC-350GSM", "quantity": 500,
    "options": { "finish": "Matte Laminate", "sides": "Double Sided" } } ] }
```

**Response (assumed):**

```json
{ "quoteNo": "Q-100235", "status": "Draft", "total": 250.0, "currency": "NZD" }
```

**Notes:**

- **Confirm with the user before saving** — a saved quote is visible to staff. [INFERRED]
- Best practice: call `GetPrice` first to show the user the price, then save the quote only on confirmation. [INFERRED]

---

### Example 2: Create a customer [INFERRED]

```http
POST /api/Customer
Host: {instance}.printiq.com
Authorization: Bearer {token}
Content-Type: application/json

{ "name": "Beta Print Co", "priceList": "Trade",
  "contacts": [ { "name": "Jane Doe", "email": "jane@betaprint.co.nz" } ],
  "addresses": [ { "type": "Billing", "line1": "12 Queen St", "city": "Auckland", "country": "NZ" } ] }
```

**Response (assumed):**

```json
{ "customerCode": "CUST014", "name": "Beta Print Co", "accountStatus": "Active" }
```

**Notes:**

- `customerCode` is assumed server-generated; do not send one on create. [INFERRED]
- Check for an existing customer first to avoid duplicates (no dedup behaviour is documented). [INFERRED]

---

### Example 3: Accept a quote (convert to order/job) [INFERRED]

```http
POST /api/Quote/Q-100235/Accept
Host: {instance}.printiq.com
Authorization: Bearer {token}
```

**Response (assumed):**

```json
{ "quoteNo": "Q-100235", "status": "Accepted", "orderNo": "O-55013", "jobNo": "J-100240" }
```

**Notes:**

- **Irreversible and creates production work.** This is a "dangerous" operation — always confirm explicitly. [INFERRED]

---

## Gotchas & Counter-Exceptions

1. **`app_name`/`app_key` belong to AUTH, not writes.** Never put them in a create/update body — they're for the token exchange only. [INFERRED]
2. **No idempotency keys.** Repeated POSTs likely create duplicates. Read-before-write and confirm-first. [INFERRED]
3. **Delete is unconfirmed — prefer cancel/void.** Don't hard-delete print records. [INFERRED]
4. **Quote acceptance is one-way.** Converting a quote to an order/job cannot be undone via API. [INFERRED]
5. **Pricing is recomputed server-side.** Don't send a `total` on create expecting it to stick — printIQ prices the lines itself. [INFERRED]

---

## Dangerous Operations

> Confirm with the user before executing these.

| Operation                   | Why Dangerous                                | Safeguard                                         |
| --------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Accept / convert a quote    | Irreversible; creates production work + cost | Confirm explicitly; restate quote no + total      |
| Create a quote              | Visible to staff; no dedup; no idempotency   | GetPrice + show user first; confirm before saving |
| Create a customer           | No dedup; may duplicate an existing account  | Search/read first; confirm before creating        |
| Any DELETE (if it exists)   | Unconfirmed semantics; possibly cascading    | Do NOT call unless doc pack confirms; prefer void |
| Bulk writes (if discovered) | Large blast radius; undocumented             | Confirm scope explicitly; start with one record   |

---

_Generated from the investigation questionnaire, Phases 3-4 (web research only; no live call). All write detail is inferred — discover the real contract and re-tag before relying on it._
