---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
companion_to: 01-llm-api-rules.md
scope: write operations — creating timesheet entries + invoices via the Transactions API
same_write_surface_as: totalsynergy-api (only credential differs)
confidence: the dominant documented write is `POST Organisation/{Slug}/Transactions`. Other writes (create/update Projects, Contacts) are plausible [INFERRED] but unconfirmed. EVERY body field below is [INFERRED] 🔬 — confirm against a live tenant's Swagger before production.
hard_constraints: (1) tight daily budget — Transactions capped 50/day standard, 20k/day Premium. (2) NO idempotency key — a retried POST risks duplicate invoices/entries AND burns budget. Track created `timesheetId`s client-side; never blind-retry.
---

# Total Synergy (OAuth) — Mutation Patterns Reference

## Write capabilities

| Operation                              | Supported       | Method     | Notes                                       | Confidence    |
| -------------------------------------- | --------------- | ---------- | ------------------------------------------- | ------------- |
| Create transaction (timesheet/invoice) | Yes             | POST       | `…/Transactions`; rate-limited; returns id  | [DOCUMENTED]  |
| Create Project                         | Likely          | POST       | path/shape 🔬                               | [INFERRED] 🔬 |
| Create Contact                         | Likely          | POST       | path/shape 🔬                               | [INFERRED] 🔬 |
| Update                                 | Unknown         | PUT/PATCH? | method + path unconfirmed                   | [UNKNOWN] 🔬  |
| Delete                                 | Unknown         | DELETE?    | not documented                              | [UNKNOWN] 🔬  |
| Bulk create                            | No              | —          | one-at-a-time only; 50/day cap binding      | [DOCUMENTED]  |
| State transitions                      | Unknown         | —          | Project status change mechanism unconfirmed | [UNKNOWN] 🔬  |
| File upload                            | No (none found) | —          | not a document store                        | [INFERRED]    |

## Patterns (all calls carry header `access-token: <token>` + `Content-Type: application/json`)

**1. Create a timesheet entry** — `POST Organisation/acme-eng/Transactions`
body `{"staffId":"88","projectId":"10042","stageId":"3","taskId":"17","fromDateAsInt":20260526,"toDateAsInt":20260526,"units":7.5}`
→ (status 🔬) `{"timesheetId":"990123"}`

- Required: `staffId` + `projectId` (usually `stageId`/`taskId` too) — all must reference existing records (resolve via Staff/Projects/Stages/Tasks reads first) [INFERRED] 🔬.
- Dates: integer-encoded `yyyymmdd` (`fromDateAsInt`/`toDateAsInt`) [INFERRED] 🔬.
- Units field name (`units` vs `hours` vs `duration`) unconfirmed [INFERRED] 🔬.
- Server-generated: `timesheetId` [DOCUMENTED]. Cost: 1 of the 50/day Transaction budget [DOCUMENTED].
- Do NOT retry on timeout without checking whether the entry was created.

**2. Create an invoice** — invoices are a **Transaction type**, likely the same `POST …/Transactions` endpoint with a type discriminator + invoice-specific fields. Discriminator/body/response all [INFERRED] 🔬 — verify the discriminator + line-item structure before production; don't invent them.
`POST Organisation/acme-eng/Transactions` body `{"type":"Invoice","projectId":"10042","contactId":"551","amount":1500.00}` /_ shape 🔬 _/. Same 50/day budget + no-idempotency caveats as timesheets.

**3. Create/update a Project or Contact (INFERRED)** — plausible by REST convention (`POST …/Projects`, `POST …/Contacts`) but **not confirmed** — no documented create body. Treat as 🔬 DISCOVER:
`POST Organisation/acme-eng/Projects` body `{"name":"New Bridge Job","clientId":"551"}` /_ path + body 🔬 _/. Do not present as working until verified. If a create call fails, the surface may not be exposed — fall back to read-only and tell the user.

## Field validation (inferred — no published rules / error codes 🔬)

| Entity      | Field          | Rule (inferred)                         | Confidence    |
| ----------- | -------------- | --------------------------------------- | ------------- |
| Transaction | `staffId`      | must reference an existing Staff record | [INFERRED] 🔬 |
| Transaction | `projectId`    | must reference an existing Project      | [INFERRED] 🔬 |
| Transaction | `*AsInt` dates | integer `yyyymmdd`; `from` ≤ `to`       | [INFERRED] 🔬 |
| Transaction | `units`        | positive decimal (hours/units)          | [INFERRED] 🔬 |

> Map real validation messages from a live tenant once writes are exercised.

## Server-side defaults

| Entity      | Field         | Default        | When   | Confidence   |
| ----------- | ------------- | -------------- | ------ | ------------ |
| Transaction | `timesheetId` | auto-generated | create | [DOCUMENTED] |

## Gotchas

1. Token header is `access-token`, not `Authorization: Bearer` → 401 on writes too.
2. Writes go through `Transactions`, not symmetrical resource paths — timesheets are **read** via `Timesheet/Week` but **created** via `Transactions`.
3. No idempotency key — a retried POST can create a duplicate invoice/entry. Track created `timesheetId`s; on timeout, re-read before retrying.
4. Tight daily budget (50/day Transactions) — batch user intent, confirm before each write, never loop. No per-second window to wait out.
5. All body field names are inferred 🔬 — a 400 likely means a wrong field name/shape, not a permission problem. Verify against a live spec.

## Dangerous operations (confirm with the user first)

| Operation                         | Why dangerous                                          | Safeguard                                    |
| --------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `POST …/Transactions` (invoice)   | creates a billing/financial record; no undo documented | confirm amounts/contact before sending       |
| `POST …/Transactions` (timesheet) | spends scarce 50/day budget; duplicates on blind retry | confirm intent; re-read before any retry     |
| Any blind retry of a write        | no idempotency → duplicate financial records           | track created ids; verify before re-sending  |
| Bulk/looped writes                | exhausts the daily Transaction cap (50 std)            | refuse loops; one write per explicit request |
