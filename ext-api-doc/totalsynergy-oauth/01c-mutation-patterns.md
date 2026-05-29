---
api_name: 'Total Synergy (OAuth)'
api_slug: 'totalsynergy-oauth'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Total Synergy (OAuth) — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operations — primarily creating timesheet entries and
> invoices through the **Transactions API**.
>
> 📌 **Same write surface as `totalsynergy-api`** — only the credential differs.
>
> ⚠️ **The dominant write through the documented surface is `POST …/Transactions`.** Other writes
> (create/update Projects, Contacts) are plausible `[INFERRED]` but unconfirmed. **Every body field
> below is `[INFERRED]` 🔬** — confirm against a live tenant's Swagger before writing in production.
>
> 🚨 **Two hard constraints on writes:**
>
> 1. **Tight daily budget** — Transactions are capped at **50/day** (standard), 20k/day (Premium).
> 2. **No idempotency key** — a retried Transaction POST risks **duplicate invoices/entries** _and_
>    burns the budget. Track created `timesheetId`s client-side; never blind-retry.

---

## Write Capabilities Summary

| Operation                              | Supported       | Method     | Notes                                       | Confidence    |
| -------------------------------------- | --------------- | ---------- | ------------------------------------------- | ------------- |
| Create transaction (timesheet/invoice) | Yes             | POST       | `…/Transactions`; rate-limited; returns id  | [DOCUMENTED]  |
| Create Project                         | Likely          | POST       | path/shape 🔬                               | [INFERRED] 🔬 |
| Create Contact                         | Likely          | POST       | path/shape 🔬                               | [INFERRED] 🔬 |
| Update                                 | Unknown         | PUT/PATCH? | method + path unconfirmed                   | [UNKNOWN] 🔬  |
| Delete                                 | Unknown         | DELETE?    | not documented                              | [UNKNOWN] 🔬  |
| Bulk create                            | No              | —          | One-at-a-time only; 50/day cap is binding   | [DOCUMENTED]  |
| State transitions                      | Unknown         | —          | Project status change mechanism unconfirmed | [UNKNOWN] 🔬  |
| File upload                            | No (none found) | —          | Not a document store                        | [INFERRED]    |

---

## Common Patterns

### Pattern 1: Create a timesheet entry (Transactions API)

```http
POST /api/v2/Organisation/acme-eng/Transactions
Host: api.totalsynergy.com
access-token: <accessToken>
Content-Type: application/json

{
  "staffId": "88",
  "projectId": "10042",
  "stageId": "3",
  "taskId": "17",
  "fromDateAsInt": 20260526,
  "toDateAsInt": 20260526,
  "units": 7.5
}
```

**Response (status 🔬):**

```json
{ "timesheetId": "990123" }
```

- **Required fields:** `staffId` + `projectId` (usually `stageId`/`taskId` too) — all must reference
  existing records (resolve them via the Staff/Projects/Stages/Tasks reads first). `[INFERRED]` 🔬
- **Dates:** integer-encoded `yyyymmdd` (`fromDateAsInt` / `toDateAsInt`). `[INFERRED]` 🔬
- **Units field name** (`units` vs `hours` vs `duration`) is unconfirmed. `[INFERRED]` 🔬
- **Server-generated:** `timesheetId`. `[DOCUMENTED]`
- **Rate cost:** 1 of the **50/day** (standard) Transaction budget. `[DOCUMENTED]`

### Pattern 2: Create an invoice (Transactions API)

Invoices are modelled as a **Transaction type** — likely the same `POST …/Transactions` endpoint
with a type discriminator and invoice-specific fields (amount, line items, contact). The exact
discriminator, request body, and response are **`[INFERRED]` 🔬** — do not invent them; confirm
against a live tenant.

```http
POST /api/v2/Organisation/acme-eng/Transactions
access-token: <accessToken>
Content-Type: application/json

{ "type": "Invoice", "projectId": "10042", "contactId": "551", "amount": 1500.00 }   /* shape 🔬 */
```

### Pattern 3: Create / update a Project or Contact (INFERRED)

Plausible by REST convention (`POST …/Projects`, `POST …/Contacts`) but **not confirmed** — no
documented create body. Treat as 🔬 DISCOVER:

```http
POST /api/v2/Organisation/acme-eng/Projects     /* path + body 🔬 */
access-token: <accessToken>
Content-Type: application/json

{ "name": "New Bridge Job", "clientId": "551" }
```

> Do not present this as working until verified. If a user asks to create a Project/Contact and the
> call fails, the create surface may not be exposed — fall back to read-only and tell the user.

---

## Field Validation Rules

No published validation rules or error-code series. `[UNKNOWN]` 🔬 Inferred constraints:

| Entity      | Field          | Rule (inferred)                         | Confidence    |
| ----------- | -------------- | --------------------------------------- | ------------- |
| Transaction | `staffId`      | Must reference an existing Staff record | [INFERRED] 🔬 |
| Transaction | `projectId`    | Must reference an existing Project      | [INFERRED] 🔬 |
| Transaction | `*AsInt` dates | Integer `yyyymmdd`; `from` ≤ `to`       | [INFERRED] 🔬 |
| Transaction | `units`        | Positive decimal (hours/units)          | [INFERRED] 🔬 |

> Map real validation messages from a live tenant once writes are exercised.

---

## Server-Side Defaults

| Entity      | Field         | Default        | When Applied | Confidence   |
| ----------- | ------------- | -------------- | ------------ | ------------ |
| Transaction | `timesheetId` | auto-generated | create       | [DOCUMENTED] |

---

## Worked Examples

### Example 1: Log 7.5 hours against a project task

```http
POST /api/v2/Organisation/acme-eng/Transactions
access-token: <accessToken>
Content-Type: application/json

{ "staffId": "88", "projectId": "10042", "stageId": "3", "taskId": "17",
  "fromDateAsInt": 20260526, "toDateAsInt": 20260526, "units": 7.5 }
```

**Response:** `{ "timesheetId": "990123" }`
**Notes:** resolve `staffId`/`projectId`/`stageId`/`taskId` via reads first; confirm the units
field name; this spends 1 of the 50/day Transaction budget; **do not retry on timeout without
checking** whether the entry was created.

### Example 2: Raise an invoice (shape unconfirmed)

```http
POST /api/v2/Organisation/acme-eng/Transactions
access-token: <accessToken>
Content-Type: application/json

{ "type": "Invoice", "projectId": "10042", "contactId": "551", "amount": 1500.00 }   /* 🔬 */
```

**Notes:** invoice body is `[INFERRED]` 🔬 — verify the discriminator + line-item structure before
production use. Same 50/day budget and no-idempotency caveats as timesheets.

---

## Gotchas & Counter-Exceptions

1. **Token header is `access-token`, not `Authorization: Bearer`** — wrong header → 401 on writes too.
2. **Writes go through `Transactions`, not symmetrical resource paths** — timesheets are **read**
   via `Timesheet/Week` but **created** via `Transactions`.
3. **No idempotency key** — a retried POST can create a **duplicate** invoice/entry. Track created
   `timesheetId`s; on timeout, re-read before retrying.
4. **Tight daily budget (50/day Transactions)** — batch user intent, confirm before each write,
   never loop. There is no per-second window to wait out.
5. **All body field names are inferred** 🔬 — a 400 likely means a wrong field name/shape, not a
   permission problem. Verify against a live spec.

---

## Dangerous Operations

> Confirm with the user before executing these.

| Operation                         | Why Dangerous                                          | Safeguard                                        |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `POST …/Transactions` (invoice)   | Creates a billing/financial record; no undo documented | Confirm amounts/contact with user before sending |
| `POST …/Transactions` (timesheet) | Spends scarce 50/day budget; duplicates on blind retry | Confirm intent; re-read before any retry         |
| Any blind retry of a write        | No idempotency → duplicate financial records           | Track created ids; verify before re-sending      |
| Bulk/looped writes                | Exhausts the daily Transaction cap (50 standard)       | Refuse loops; do one write per explicit request  |

---

_Generated from the investigation questionnaire, Phases 3–4._
