---
api_name: 'Total Synergy (API Key)'
api_slug: 'totalsynergy-api'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behaviour', 'Phase 4: Endpoint Catalog']
---

# Total Synergy (API Key) — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. All write operation patterns: creating timesheet entries /
> invoices via the Transactions API, plus the rate/idempotency rules that govern them.
>
> 📌 **Same write surface as `totalsynergy-oauth`** — identical Transactions API, identical body
> shape. Only the credential differs (the static key is sent in the same `access-token` header).
>
> ⚠️ **Confidence:** the **fact** that timesheet/invoice creation goes through the Transactions API
> and counts against the 50/day budget is `[DOCUMENTED]`. The **request body** (`staffId`,
> `projectId`, `stageId`, `taskId`, `fromDateAsInt`, `toDateAsInt`, `units`) and the **exact create
> path** are `[INFERRED]` from KB naming — the reference is a JS-rendered Swagger SPA that could not
> be enumerated, and **no live call was made**. Treat write bodies as unconfirmed until dumped from
> `/swagger/ui/index` (v2) with a live static key. **Writes are scarce and not idempotent — confirm
> with the user before each one.**

---

## Write Capabilities Summary

| Operation         | Supported | Method   | Notes                                                                  | Confidence    |
| ----------------- | --------- | -------- | ---------------------------------------------------------------------- | ------------- |
| Create timesheet  | Yes       | POST     | Via `…/Transactions`. Counts against the **50/day** Transaction budget | [DOCUMENTED]  |
| Create invoice    | Yes 🔬    | POST     | Modelled as a Transaction; discriminator/shape unconfirmed             | [INFERRED] 🔬 |
| Update            | Unknown   | —        | No documented update path for Transactions/timesheets                  | [UNKNOWN] 🔬  |
| Delete            | Unknown   | —        | No documented delete path                                              | [UNKNOWN] 🔬  |
| Project write     | Likely 🔬 | POST/PUT | Projects "likely write" per KB; path/body unconfirmed                  | [INFERRED] 🔬 |
| Contact write     | Likely 🔬 | POST/PUT | Contacts "likely write" per KB; path/body unconfirmed                  | [INFERRED] 🔬 |
| Bulk create       | No        | —        | One-at-a-time only; no batch endpoint                                  | [INFERRED]    |
| State transitions | Unknown   | —        | Project lifecycle transitions not documented in the API                | [UNKNOWN] 🔬  |
| File upload       | No        | —        | No file surface (practice-management data API, not a doc store)        | [INFERRED]    |

> 🔬 The only **documented** write is timesheet/invoice creation via Transactions. Project/Contact
> writes are "likely" per KB wording but have no confirmed path/body. Do not perform an inferred
> write without confirming the shape against a live spec.

---

## The Transactions API (the one documented write path)

**All financial/timesheet writes go through `POST …/Organisation/{Slug}/Transactions`.** This
endpoint carries its **own, much tighter rate budget**:

| Tier     | Transactions/day | All calls/day |
| -------- | ---------------- | ------------- |
| Standard | **50**           | 300           |
| Premium  | 20,000           | 60,000        |

- Budget is **per organisation**, not per key — multiple keys for one org share it. `[DOCUMENTED]`
- A timesheet write returns the created **`timesheetId`**. `[DOCUMENTED]`
- **No idempotency key** — a retried POST risks a **duplicate** entry/invoice **and** burns a scarce
  transaction. `[INFERRED]` 🔬

---

## Common Patterns

### Pattern 1: Create a timesheet entry [DOCUMENTED resource; body INFERRED 🔬]

```http
POST /api/v2/Organisation/acme-eng/Transactions
Host: api.totalsynergy.com
access-token: <apiKey>
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

**Response:**

```json
{ "timesheetId": "990123" }
```

- **Required (timesheet):** `staffId`, `projectId` (and usually `stageId` / `taskId`). `[INFERRED]` 🔬
- **Dates:** integer-encoded `yyyymmdd` (`fromDateAsInt` / `toDateAsInt`). `[INFERRED]` 🔬
- **Units field name** (`units` vs. `hours`) is `[INFERRED]` 🔬.
- **Counts against the 50/day Transaction budget.** `[DOCUMENTED]`
- **Not idempotent** — never blind-retry. `[INFERRED]` 🔬

**Pre-flight (resolve foreign keys first):**

```http
GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000     # → staffId
GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042       # → projectId, stages/tasks
```

> A timesheet entry must reference a **valid** `staffId` + `projectId` (+ `stageId`/`taskId`) — they
> must exist first. `[INFERRED]` 🔬

---

### Pattern 2: Create an invoice [INFERRED 🔬]

Invoices are modelled as a **Transaction type**. The exact discriminator (a `type` field? a
different sub-path?) and body are **unconfirmed**.

```http
POST /api/v2/Organisation/acme-eng/Transactions
Host: api.totalsynergy.com
access-token: <apiKey>
Content-Type: application/json

{
  "type": "Invoice",          // 🔬 discriminator unconfirmed
  "projectId": "10042",
  "amount": 1500.00,
  "date": "2026-05-29"
}
```

> Entire body `[INFERRED]` 🔬. **Do not** create an invoice on an inferred body without confirming
> the shape on a live spec — a wrong write here is both a financial error and a wasted transaction.

---

### Pattern 3: Project / Contact writes [INFERRED 🔬]

KB wording says Projects and Contacts are "Read (+ likely write)". No create/update path or body is
documented.

> 🔬 **DISCOVER before attempting.** Until the create/update path and required fields are confirmed
> from the spec, treat Projects and Contacts as **read-only** through this connector.

---

## Idempotency & Retry Rules

- **GET is idempotent** — safe to retry.
- **POST to Transactions is NOT idempotent** — there is no idempotency key. `[INFERRED]` 🔬
- **Before retrying a Transaction POST:**
  1. Check whether you already received a `timesheetId` — if so, the write **succeeded**; do not
     retry.
  2. If the response was a 5xx with no body, **do not blind-retry** — a retry may create a duplicate
     **and** burn another of the 50 daily transactions. Surface the ambiguity to the user.
  3. Track created `timesheetId`s client-side per session so you never re-post the same entry.

---

## Field Validation Rules (inferred — confirm on spec 🔬)

| Entity    | Field                         | Rule (inferred)                              | Confidence    |
| --------- | ----------------------------- | -------------------------------------------- | ------------- |
| Timesheet | `staffId`                     | Must reference an existing Staff record      | [INFERRED] 🔬 |
| Timesheet | `projectId`                   | Must reference an existing Project record    | [INFERRED] 🔬 |
| Timesheet | `stageId` / `taskId`          | Usually required; must belong to the project | [INFERRED] 🔬 |
| Timesheet | `fromDateAsInt`/`toDateAsInt` | Integer `yyyymmdd`                           | [INFERRED] 🔬 |
| Timesheet | `units`                       | Decimal hours (field name unconfirmed)       | [INFERRED] 🔬 |

> All rows `[INFERRED]` 🔬 — none confirmed against a live spec. The error body shape for a failed
> write is `[UNKNOWN]` (see 01d).

---

## Server-Side Defaults

| Entity    | Field         | Default / Behaviour                 | Confidence   |
| --------- | ------------- | ----------------------------------- | ------------ |
| Timesheet | `timesheetId` | Server-assigned, returned on create | [DOCUMENTED] |

---

## Worked Example: log time against a project (full flow)

> Goal: log 7.5h for staff "Jordan Lee" against the "Riverside Bridge Upgrade" project today.

**Step 1 — resolve the org slug (cache for the session):**

```http
GET /api/v2/Organisation/MySlug
access-token: <apiKey>
```

```json
{ "slug": "acme-eng", "name": "Acme Engineering" }
```

**Step 2 — resolve staffId:**

```http
GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000
access-token: <apiKey>
```

```json
{ "totalItems": 24, "items": [{ "id": "88", "name": "Jordan Lee" }] }
```

**Step 3 — resolve projectId (and stage/task if needed):**

```http
GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042
access-token: <apiKey>
```

```json
{ "totalItems": 1, "items": [{ "id": "10042", "name": "Riverside Bridge Upgrade" }] }
```

**Step 4 — confirm with the user, then create the timesheet (1 of 50 daily transactions):**

```http
POST /api/v2/Organisation/acme-eng/Transactions
access-token: <apiKey>
Content-Type: application/json

{ "staffId": "88", "projectId": "10042", "stageId": "3", "taskId": "17",
  "fromDateAsInt": 20260529, "toDateAsInt": 20260529, "units": 7.5 }
```

```json
{ "timesheetId": "990124" }
```

> Record `timesheetId` `990124`. If the POST errors ambiguously, **do not** silently retry —
> re-check via `Timesheet/Week` or ask the user. Each retry costs a transaction and risks a dupe.

---

## Gotchas & Counter-Exceptions

1. **Writes go through the Transactions API and burn the 50/day budget** — confirm before each;
   never loop. `[DOCUMENTED]`
2. **No idempotency** — a retried POST can create a duplicate timesheet/invoice. Track created ids.
   `[INFERRED]` 🔬
3. **Write bodies are `[INFERRED]`** — `staffId`, `units`, `fromDateAsInt` etc. are from KB naming,
   not a verified spec. Prefer reads; confirm write shapes on a live tenant. 🔬
4. **Token header is `access-token`**, not `Authorization: Bearer`. `[DOCUMENTED]`
5. **Call `api.totalsynergy.com`**, never the registry `instance_url`; supply the org `{Slug}` in
   the path. `[DOCUMENTED]` 🚩
6. **No bulk writes** — one record per POST. `[INFERRED]`
7. **Invoice creation is inferred** — discriminator and body unconfirmed; do not create invoices on
   guessed bodies. 🔬

---

## Dangerous Operations

> Operations that are irreversible, financial, or budget-consuming. **Confirm with the user before
> executing.**

| Operation                                   | Why Dangerous                                                     | Safeguard                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST …/Transactions` (timesheet)           | Burns 1 of 50 daily transactions; not idempotent (dupe risk)      | Confirm with user; resolve FKs first; record returned `timesheetId` |
| `POST …/Transactions` (invoice)             | Financial record; inferred body; budget-consuming; not idempotent | Confirm with user; verify body shape on spec **before** sending 🔬  |
| Any retry of a Transaction POST             | May create a duplicate entry/invoice + waste a scarce transaction | Never blind-retry; verify success (got `timesheetId`?) first        |
| Large paginated scan to find a write target | Can exhaust the 300/day read budget before the write even happens | Prefer `criteria.Id` lookups; cache; warn the user about budget     |

---

_Generated from the investigation questionnaire, Phases 3–4. Mirrors `totalsynergy-oauth` (same write surface)._
