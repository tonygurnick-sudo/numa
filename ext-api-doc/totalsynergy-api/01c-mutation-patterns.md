---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
companion_to: 01-llm-api-rules.md
sibling: totalsynergy-oauth — identical write surface (same Transactions API + body shape); only credential differs.
confidence: the FACT that timesheet/invoice creation goes through Transactions and counts against the 50/day budget is [DOCUMENTED]. The request BODY (staffId, projectId, stageId, taskId, fromDateAsInt, toDateAsInt, units) and exact create path are [INFERRED] from KB naming. NO live call made. 🔬 = confirm on a live tenant (dump /swagger/ui/index v2). Writes are scarce + NOT idempotent — confirm with the user before each.
---

# Total Synergy (API Key) — Mutation Patterns Reference

Write operations: creating timesheet entries / invoices via the Transactions API, plus the rate/idempotency rules. HTTP via `numa integrations request`, `access-token: <apiKey>` + `Content-Type: application/json` header.

## Write capabilities summary

| Operation         | Supported | Method   | Notes                                                                  | Confidence    |
| ----------------- | --------- | -------- | ---------------------------------------------------------------------- | ------------- |
| Create timesheet  | Yes       | POST     | Via `…/Transactions`. Counts against the **50/day** Transaction budget | [DOCUMENTED]  |
| Create invoice    | Yes 🔬    | POST     | Modelled as a Transaction; discriminator/shape unconfirmed             | [INFERRED] 🔬 |
| Update            | Unknown   | —        | No documented update path for Transactions/timesheets                  | [UNKNOWN] 🔬  |
| Delete            | Unknown   | —        | No documented delete path                                              | [UNKNOWN] 🔬  |
| Project write     | Likely 🔬 | POST/PUT | "Likely write" per KB; path/body unconfirmed                           | [INFERRED] 🔬 |
| Contact write     | Likely 🔬 | POST/PUT | "Likely write" per KB; path/body unconfirmed                           | [INFERRED] 🔬 |
| Bulk create       | No        | —        | One-at-a-time only; no batch endpoint                                  | [INFERRED]    |
| State transitions | Unknown   | —        | Project lifecycle transitions not documented in the API                | [UNKNOWN] 🔬  |
| File upload       | No        | —        | No file surface (data API, not a doc store)                            | [INFERRED]    |

> The only **documented** write is timesheet/invoice creation via Transactions. Project/Contact writes are "likely" per KB wording but have no confirmed path/body — treat as read-only until 🔬. Do NOT perform an inferred write without confirming the shape on a live spec.

## The Transactions API (the one documented write path)

**All financial/timesheet writes go through `POST …/Organisation/{Slug}/Transactions`.** Its own tighter budget:

| Tier     | Transactions/day | All calls/day |
| -------- | ---------------- | ------------- |
| Standard | **50**           | 300           |
| Premium  | 20,000           | 60,000        |

- Budget is **per organisation**, not per key — multiple keys for one org share it. [DOCUMENTED]
- A timesheet write returns the created **`timesheetId`**. [DOCUMENTED]
- **No idempotency key** — a retried POST risks a duplicate entry/invoice AND burns a scarce transaction. [INFERRED] 🔬

## Pattern 1: Create a timesheet entry [DOCUMENTED resource; body INFERRED 🔬]

`POST /api/v2/Organisation/acme-eng/Transactions` (+ `access-token`, `Content-Type: application/json`)
body: `{"staffId":"88","projectId":"10042","stageId":"3","taskId":"17","fromDateAsInt":20260526,"toDateAsInt":20260526,"units":7.5}`
→ `{"timesheetId":"990123"}`

- **Required (timesheet):** `staffId`, `projectId` (and usually `stageId`/`taskId`) 🔬. Dates integer-encoded `yyyymmdd` (`fromDateAsInt`/`toDateAsInt`) 🔬. Units field name (`units` vs `hours`) 🔬.
- Counts against the **50/day** Transaction budget [DOCUMENTED]. **Not idempotent** — never blind-retry 🔬.
- **Pre-flight (resolve FKs first):** a timesheet entry must reference valid `staffId`+`projectId` (+`stageId`/`taskId`) which must exist first 🔬.
  `GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000` → `staffId`
  `GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042` → `projectId`, stages/tasks

## Pattern 2: Create an invoice [INFERRED 🔬]

Invoices are modelled as a **Transaction type**. The discriminator (a `type` field? a different sub-path?) and body are unconfirmed.
`POST /api/v2/Organisation/acme-eng/Transactions`
body: `{"type":"Invoice","projectId":"10042","amount":1500.00,"date":"2026-05-29"}` // `type` discriminator 🔬

> Entire body [INFERRED] 🔬. Do NOT create an invoice on an inferred body without confirming the shape on a live spec — a wrong write is both a financial error and a wasted transaction.

## Pattern 3: Project / Contact writes [INFERRED 🔬]

KB wording says Projects and Contacts are "Read (+ likely write)". No create/update path or body is documented. **DISCOVER before attempting** — until the path + required fields are confirmed, treat Projects and Contacts as **read-only** through this connector. 🔬

## Idempotency & retry rules

- **GET is idempotent** — safe to retry (mind the budget).
- **POST to Transactions is NOT idempotent** — no idempotency key. [INFERRED] 🔬
- Before retrying a Transaction POST:
  1. Got a `timesheetId`? → the write **succeeded**; do not retry.
  2. 5xx with no body → **do not blind-retry** (may create a duplicate + burn another of the 50 daily transactions). Surface the ambiguity to the user.
  3. Track created `timesheetId`s client-side per session so you never re-post the same entry.

## Field validation rules (inferred — confirm on spec 🔬)

| Entity    | Field                         | Rule (inferred)                              |
| --------- | ----------------------------- | -------------------------------------------- |
| Timesheet | `staffId`                     | Must reference an existing Staff record      |
| Timesheet | `projectId`                   | Must reference an existing Project record    |
| Timesheet | `stageId` / `taskId`          | Usually required; must belong to the project |
| Timesheet | `fromDateAsInt`/`toDateAsInt` | Integer `yyyymmdd`                           |
| Timesheet | `units`                       | Decimal hours (field name unconfirmed)       |

> All rows [INFERRED] 🔬. The error body shape for a failed write is [UNKNOWN] (see 01d).

## Server-side defaults

`timesheetId` is server-assigned, returned on create. [DOCUMENTED]

## Worked example: log time against a project (full flow)

Goal: log 7.5h for staff "Jordan Lee" against "Riverside Bridge Upgrade" today.

1. **Resolve the org slug (cache it):** `GET /api/v2/Organisation/MySlug` → `{"slug":"acme-eng","name":"Acme Engineering"}`
2. **Resolve staffId:** `GET /api/v2/Organisation/acme-eng/Staff?criteria.pagesize=1000` → `{"totalItems":24,"items":[{"id":"88","name":"Jordan Lee"}]}`
3. **Resolve projectId (+ stage/task if needed):** `GET /api/v2/Organisation/acme-eng/Projects?criteria.Id=10042` → `{"totalItems":1,"items":[{"id":"10042","name":"Riverside Bridge Upgrade"}]}`
4. **Confirm with the user, then create (1 of 50 daily transactions):**
   `POST /api/v2/Organisation/acme-eng/Transactions`
   body: `{"staffId":"88","projectId":"10042","stageId":"3","taskId":"17","fromDateAsInt":20260529,"toDateAsInt":20260529,"units":7.5}`
   → `{"timesheetId":"990124"}`

> Record `timesheetId` `990124`. If the POST errors ambiguously, **do not** silently retry — re-check via `Timesheet/Week` or ask the user. Each retry costs a transaction and risks a dupe.

## Gotchas

1. **Writes burn the 50/day Transaction budget** — confirm before each; never loop. [DOCUMENTED]
2. **No idempotency** — a retried POST can create a duplicate. Track created ids. [INFERRED] 🔬
3. **Write bodies are [INFERRED]** (`staffId`, `units`, `fromDateAsInt`, …) from KB naming, not a verified spec. Prefer reads; confirm write shapes on a live tenant. 🔬
4. **Token header is `access-token`**, not `Authorization: Bearer` (or `X-API-Key`). [DOCUMENTED]
5. **Call `api.totalsynergy.com`**, never the registry `instance_url`; supply org `{Slug}` in the path. [DOCUMENTED] 🚩
6. **No bulk writes** — one record per POST. [INFERRED]
7. **Invoice creation is inferred** — discriminator + body unconfirmed; don't create invoices on guessed bodies. 🔬

## Dangerous operations (confirm with the user before executing)

| Operation                                   | Why dangerous                                                     | Safeguard                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST …/Transactions` (timesheet)           | Burns 1 of 50 daily transactions; not idempotent (dupe risk)      | Confirm with user; resolve FKs first; record returned `timesheetId` |
| `POST …/Transactions` (invoice)             | Financial record; inferred body; budget-consuming; not idempotent | Confirm with user; verify body shape on spec **before** sending 🔬  |
| Any retry of a Transaction POST             | May create a duplicate + waste a scarce transaction               | Never blind-retry; verify success (got `timesheetId`?) first        |
| Large paginated scan to find a write target | Can exhaust the 300/day read budget before the write happens      | Prefer `criteria.Id` lookups; cache; warn the user about budget     |
