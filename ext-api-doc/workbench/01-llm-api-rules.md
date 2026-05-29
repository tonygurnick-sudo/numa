---
api_name: 'Workbench International (ERP)'
api_slug: 'workbench'
version: 'per-instance (Swagger-defined)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Workbench International — Workspace Agent API Rules

> **Loaded into the workspace agent when the Workbench integration is active.** Keep under 300 lines.
> Companion files (01a–01d) hold the detailed reference.
>
> ⚠️ **DISCOVERY-FIRST CONNECTOR — READ THIS.** Workbench publishes that it has "a JSON REST API"
> with "Swagger … metadata and a code generation facility for all the API methods", but the **actual
> reference is served per-customer instance and is NOT public.** Endpoint paths, field names, query
> params, pagination, rate limits and the token-issuance flow could **not be verified**. Every path,
> field and envelope in these docs is marked `[INFERRED]` or `[UNKNOWN]` unless tagged `[DOCUMENTED]`
> (= stated in Workbench's own material). **Nothing here is `[CONFIRMED]` against a live call.**
> **Before trusting any endpoint below, pull the instance Swagger** (see First-Call Playbook). When
> the live spec contradicts this file, the live spec wins. Do not invent endpoints.

## Context

- **API:** Workbench International ERP — JSON REST API `[DOCUMENTED]`. Job-costing / construction
  ERP (NZ / APAC): jobs, cost transactions, GL distribution, AP, AR, POs, timesheets, plant.
- **Base URL:** the stored **`instance_url`** (e.g. `https://yourcompany.workbench.com`) `[DOCUMENTED — registry]`.
  API path prefix (`/api`, `/api/v1`, or Swagger-defined) is **`[INFERRED]` 🔬 discover**.
- **Auth:** static **bearer token** + per-tenant `instance_url`, both stored credential fields. No OAuth.
- **Integration path:** **Direct API via `connect_request`** (spec-driven, chat-only). Not a Files connector — no folder/file tree. No `lib/oauth-providers` class.
- **Rate limits:** **`[UNKNOWN]` 🔬** — undocumented. Be conservative; cache reads; no tight loops.

## Auth Structure

Bearer-token auth in the HTTP `Authorization` header against the per-tenant `instance_url`.

```
Authorization: Bearer {bearer_token}
Accept: application/json
```

**Token lifecycle:**

- Token is **pre-issued inside the customer's Workbench instance** (by an admin/user) and pasted into
  the connector. **How it is generated/rotated is `[UNKNOWN]` 🔬** — confirm against a live tenant.
- **No refresh token** in the connector → treat as **static**. On `401`, the user must re-issue and
  re-paste a new token; the agent cannot refresh it.
- **🔬 Verify the header name.** Bearer is assumed `[INFERRED]`. Some ERPs use `X-Api-Key`/`apikey`.
  If `Authorization: Bearer` returns `401` on a known-good path, try the alternate header.

## First-Call Playbook (run once per new connection)

Stop at the first failure. **Step 1 is the most important thing you do.**

```
1. PULL THE SWAGGER. GET {instance_url}/swagger  (UI) and the raw spec
   {instance_url}/swagger/v1/swagger.json   [exact path 🔬].
   This single step resolves: API path prefix, real resource names, field
   schemas, query params, pagination envelope. Read it before any other call.
   Cannot reach it → instance_url wrong/normalisation issue (see Gotcha 1).

2. SMOKE TEST AUTH. GET {instance_url}/{prefix}/jobs?pageSize=1
   (use the real jobs path from the Swagger).
   200 → auth works, gate satisfied.
   401 → token invalid/expired OR wrong auth header (try X-Api-Key).
   403 → token valid but the issuing user's Workbench role lacks permission.
   404 (HTML) → wrong path prefix; re-read the Swagger base path.
```

## Capabilities

### CAN (once Swagger is confirmed)

1. **Read & search** Jobs, cost Transactions (+ their GL **distribution** lines), Purchase Orders,
   Creditors/AP invoices, Debtors/AR invoices & claims, Timesheets, Plant — filter by job / date / status.
2. **Answer cost questions** — "what's been spent on job X, by activity / GL account?" — by reading a
   job's transactions and summing their distribution lines.
3. **Create (gated, HITL only)** timesheets / purchase orders / cost transactions through the
   business-rule-validated API — only if the customer enables writes.

### CANNOT

1. **Cross-tenant queries** — every call is scoped to one `instance_url`. One token cannot see another customer.
2. **Blind retries of financial POSTs** — no known idempotency key; a retry can double-post a
   timesheet/invoice/transaction and corrupt job costs. Verify before re-sending.
3. **High-frequency polling / bulk sync** — rate limits are unknown; stay slow until measured.

## Critical Gotchas

1. **Normalise `instance_url` before composing URLs.** It is free-form. Ensure a scheme is present
   and strip any trailing slash so `{instance_url}/{prefix}/...` never double-slashes. A wrong/odd
   base URL is the #1 cause of "nothing works".
2. **Endpoint paths are `[INFERRED]`, not fact.** Do not call `/api/v1/jobs` because this file says
   so — call what the **instance Swagger** says. Treat every path here as a hypothesis.
3. **Writes are real financial postings.** Workbench "retains its business rules and validations" on
   API writes, so a syntactically valid POST can still be rejected (closed job, invalid activity,
   unbalanced distribution). Always HITL-confirm writes; never auto-retry on ambiguity.
4. **Distribution must balance.** A cost/invoice splits across job/activity/GL/tax lines that sum to
   the document total. A `[DOCUMENTED]` rule: **the Activity Code carries the debit GL account** — you
   post to a job + activity, and the GL account follows from the activity mapping.
5. **Two product lines share the name.** Cloud "Workbench Online" vs the SAP Business One companion
   "Workbench SBO" may expose different surfaces. Confirm which the customer runs before trusting endpoints. 🔬

## Default Parameters

| Parameter   | Default                   | Reason                                               |
| ----------- | ------------------------- | ---------------------------------------------------- |
| `pageSize`  | 200 (read)                | Reasonable batch while limits are unknown 🔬         |
| Auth header | `Authorization: Bearer …` | Per registry (bearer token) — confirm header name 🔬 |
| Base URL    | stored `instance_url`     | Per-tenant routing is mandatory                      |
| Writes      | **off by default**        | Workbench writes are real financial postings         |

## Working Examples

> All paths/fields/envelopes below are `[INFERRED]` 🔬 — placeholders to be replaced from the Swagger.
> Realistic shapes shown so you know what to expect, NOT what to assume.

### Example 1: List jobs (smoke test) — `[INFERRED]` 🔬

```http
GET /api/v1/jobs?pageSize=50&page=1 HTTP/1.1
Host: yourcompany.workbench.com
Authorization: Bearer <bearer_token>
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "10042",
      "jobNo": "J-10042",
      "name": "Riverside Bridge Upgrade",
      "status": "Active",
      "clientId": "551",
      "manager": "Aroha Ngata"
    }
  ],
  "totalCount": 312,
  "page": 1,
  "pageSize": 50
}
```

### Example 2: Job cost transactions with distribution — `[INFERRED]` 🔬

```http
GET /api/v1/jobs/10042/transactions?fromDate=2026-01-01&pageSize=200 HTTP/1.1
Host: yourcompany.workbench.com
Authorization: Bearer <bearer_token>
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "TX-88231",
      "jobNo": "J-10042",
      "type": "Purchase",
      "date": "2026-03-14",
      "amount": 4200.0,
      "taxCode": "GST",
      "taxAmount": 630.0,
      "lines": [{ "activityCode": "STEEL", "glAccount": "6100", "amount": 4200.0, "tax": 630.0 }]
    }
  ],
  "totalCount": 47,
  "page": 1,
  "pageSize": 200
}
```

### Example 3: Create a timesheet (write — HITL required) — `[INFERRED]` 🔬

```http
POST /api/v1/timesheets HTTP/1.1
Host: yourcompany.workbench.com
Authorization: Bearer <bearer_token>
Content-Type: application/json

{ "jobNo": "J-10042", "activityCode": "LABOUR", "employeeId": "E-204",
  "date": "2026-05-29", "hours": 7.5, "notes": "Formwork, pier 3" }
```

```json
{
  "id": "TS-55120",
  "jobNo": "J-10042",
  "activityCode": "LABOUR",
  "hours": 7.5,
  "date": "2026-05-29",
  "status": "Submitted"
}
```

### Example 4: AP / creditor invoices for a supplier — `[INFERRED]` 🔬

```http
GET /api/v1/creditors?supplierId=SUP-77&fromDate=2026-01-01&pageSize=100 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "AP-9001",
      "supplierId": "SUP-77",
      "invoiceNo": "INV-4471",
      "date": "2026-02-20",
      "total": 12450.0,
      "status": "Approved",
      "lines": [{ "jobNo": "J-10042", "activityCode": "SUBBIE", "glAccount": "6300", "amount": 12450.0 }]
    }
  ],
  "totalCount": 8,
  "page": 1,
  "pageSize": 100
}
```

## Proxy API Operations

> Quick reference. **Every path is `[INFERRED]` 🔬 — replace from the instance Swagger.**

| Operation               | Method   | Path (under `{instance_url}`)        | Key Parameters                   | Notes                            |
| ----------------------- | -------- | ------------------------------------ | -------------------------------- | -------------------------------- |
| Read Swagger spec       | GET      | `/swagger` (+ `/swagger/v1/...json`) | —                                | **Do this first** — ground truth |
| List/search jobs        | GET      | `/api/v1/jobs`                       | `pageSize`, `page`, `status`     | Central record                   |
| Get one job             | GET      | `/api/v1/jobs/{id}`                  | —                                |                                  |
| Job transactions        | GET      | `/api/v1/jobs/{id}/transactions`     | `fromDate`, `toDate`, `pageSize` | Carries distribution lines       |
| List transactions       | GET      | `/api/v1/transactions`               | `jobNo`, `fromDate`, `toDate`    |                                  |
| Create transaction      | POST     | `/api/v1/transactions`               | body w/ balanced `lines[]`       | Write — HITL                     |
| Timesheets              | GET/POST | `/api/v1/timesheets`                 | `jobNo`, `employeeId`, `date`    | Write — HITL                     |
| Purchase orders         | GET/POST | `/api/v1/purchaseorders`             | `jobNo`, `supplierId`            | Write — HITL                     |
| Creditors / AP invoices | GET      | `/api/v1/creditors`                  | `supplierId`, `fromDate`         | AP                               |
| Debtors / AR / claims   | GET      | `/api/v1/debtors`, `/invoices`       | `clientId`, `fromDate`           | AR / progress claims             |
| GL / chart of accounts  | GET      | `/api/v1/accounts`                   | —                                | Distribution targets             |
| Plant / assets          | GET      | `/api/v1/plant`                      | —                                | Read                             |

## Pagination

- **Type:** `[INFERRED]` 🔬 — likely page/offset (`page` + `pageSize`). Confirm from Swagger.
- **Default page size:** `[UNKNOWN]` 🔬 — always send an explicit `pageSize`.
- **Max page size:** `[UNKNOWN]` 🔬 — start at 200; back off if rejected.
- **How to paginate:**

```http
GET /api/v1/transactions?jobNo=J-10042&page=1&pageSize=200
```

- **Last-page detection:** `(page * pageSize) >= totalCount`, or a short/empty `items[]` page. Verify the envelope field names (`items`/`data`, `totalCount`/`total`) against a live response. 🔬

## Webhooks / Events

No webhook support found `[INFERRED]` 🔬 — partner syncs (Xero/MYOB) appear poll/batch-based. **Polling
only.** Poll list endpoints and diff on a date/modified field (**which field is reliable is `[UNKNOWN]`
🔬**). Keep intervals low (≥ 15 min) until rate limits are known. See `01d`.

## Error Handling

**Standard error format:** `[UNKNOWN]` 🔬 — Workbench's error body schema is not published. Do **not**
assume a shape. Check the HTTP status first, then defensively parse the body and surface the raw text.

**Recovery by status (statuses `[INFERRED]`):**

| Status  | Meaning                              | Action                                                              |
| ------- | ------------------------------------ | ------------------------------------------------------------------- |
| 400/422 | Validation / business-rule rejection | Fix payload (balance distribution, valid job/activity); don't retry |
| 401     | Unauthorized                         | Token invalid/expired or wrong header — user must re-issue token    |
| 403     | Forbidden                            | Issuing user's Workbench role lacks permission                      |
| 404     | Not found                            | Verify path/id and `instance_url` normalisation                     |
| 429     | Rate limited (if any)                | Honour `Retry-After`; exponential backoff 🔬                        |
| 5xx     | Server error                         | Retry with exponential backoff                                      |

## Known Limitations

1. **Reference not public** — endpoints, fields, pagination, errors all need Swagger discovery. 🔬
2. **No idempotency key known** — financial POSTs are not safe to blind-retry.
3. **Rate limits & token lifetime undocumented** — be conservative; expect manual token re-issue on expiry.

---

_See companion files for detailed reference:_

- _01a-domain-model-reference.md — Entities (Job, Transaction, Distribution, AP/AR, PO, Timesheet, Plant), relationships, state machines_
- _01b-query-patterns.md — Filtering, search, pagination, cost-analysis read patterns_
- _01c-mutation-patterns.md — Create transaction/timesheet/PO, distribution balancing, dangerous ops_
- _01d-event-and-error-handling.md — Polling (no webhooks), error recovery, discovery playbook_
