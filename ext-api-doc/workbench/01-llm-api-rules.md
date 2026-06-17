---
api_name: Workbench International (ERP)
api_slug: workbench
base_url: stored instance_url (per-customer, e.g. https://yourcompany.workbench.com)
route_prefix: discover from Swagger base path (likely /api or /api/v1) — [INFERRED] 🔬
path_version_segment: UNCONFIRMED 🔬 — a "/v1/" may be a real path segment OR absent. Do NOT assume /api/v1 — read the Swagger base path. Examples below use /api/v1 as a PLACEHOLDER only.
auth: Authorization Bearer {bearer_token} [INFERRED 🔬 — verify header; fallback X-Api-Key/apikey]; static, no refresh
field_casing: UNCONFIRMED 🔬 (examples use camelCase as placeholder)
id_format: UNCONFIRMED 🔬 (jobNo human string vs numeric internal id may differ)
rate_limit: UNKNOWN 🔬 — be conservative, cache reads, no tight loops
call_surface: HTTP via `numa integrations request` (spec-driven, chat-only). NOT a Files connector — no list-files/search-files/download-file. No lib/oauth-providers class.
confidence: NOTHING here is live-confirmed. Every path/field/envelope/status is [INFERRED]/[UNKNOWN] 🔬 unless tagged [DOCUMENTED] (= in Workbench's own material). Pull the instance Swagger FIRST; when it contradicts this file, the Swagger wins. Do not invent endpoints.
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Workbench International — API Rules

⚠️ **DISCOVERY-FIRST CONNECTOR.** Workbench states it has "a JSON REST API" with "Swagger … metadata and a code generation facility" `[DOCUMENTED]`, but the reference is served **per-customer instance and is NOT public**. Paths, fields, query params, pagination, rate limits and token issuance are all unverified. **Pull the Swagger before trusting any endpoint here.**

## Call surface

HTTP via `numa integrations request` using stored `bearer_token` + `instance_url`. Chat-only, spec-driven. NOT file-browsing — does NOT support list-files/search-files/download-file.

## Domain (well-grounded `[DOCUMENTED]`)

Job-costing / construction ERP (NZ/APAC): jobs, cost transactions + GL distribution, AP (creditors), AR (debtors/claims), purchase orders, timesheets, plant.

## Paths (read first)

- Base = stored `instance_url`; normalise it (see Gotcha 1).
- API prefix is `[INFERRED]` 🔬 — likely `/api` or `/api/v1`. **All `/api/v1/...` paths below are PLACEHOLDERS.** Whether `/v1/` is a real path segment is UNCONFIRMED — read it from the Swagger base path; do NOT hard-prepend `/api/v1`.
- Call what the Swagger says, not what this file guesses.

## Auth

`Authorization: Bearer {bearer_token}` + `Accept: application/json` `[INFERRED 🔬]`.

- Verify header name: if `Bearer` returns 401 on a known-good path, try `X-Api-Key`/`apikey` 🔬.
- Static token, pre-issued inside the customer's Workbench instance. **No refresh** → on 401 the user must re-issue and re-paste; the agent cannot refresh. Issuance/rotation flow `[UNKNOWN]` 🔬.

## First-Call Playbook (run once per new connection; stop at first failure)

1. **PULL THE SWAGGER (most important step).** `GET {instance_url}/swagger` (UI) + `{instance_url}/swagger/v1/swagger.json` (raw; exact path 🔬). Resolves: prefix, real resource names, field schemas, query params, pagination envelope. Read before any other call. Cannot reach it → `instance_url` wrong/normalisation issue (Gotcha 1).
2. **SMOKE-TEST AUTH.** `GET {instance_url}/{prefix}/jobs?pageSize=1` (real jobs path from Swagger). `200`→auth works, gate satisfied. `401`→token invalid/expired OR wrong header (try `X-Api-Key`). `403`→token valid but issuing user's Workbench role lacks permission. `404` (HTML)→wrong prefix; re-read Swagger base path.

## CAN (once Swagger confirmed)

- Read/search: jobs, transactions (+ GL distribution lines), purchase orders, creditors/AP, debtors/AR + claims, timesheets, plant — filter by job/date/status.
- Answer cost questions ("spent on job X by activity/GL?") by reading a job's transactions and summing distribution lines.
- Create (gated, **HITL only**, off by default): timesheets, purchase orders, cost transactions — via the business-rule-validated API, only if the customer enables writes.

## CANNOT

- Cross-tenant queries — every call is scoped to one `instance_url`; one token cannot see another customer.
- Blind retries of financial POSTs — no known idempotency key; a retry can double-post and corrupt job costs. GET to verify before re-sending.
- High-frequency polling / bulk sync — rate limits unknown; stay slow.

## Gotchas

1. **Normalise `instance_url` first.** Free-form field. Ensure a scheme is present, strip trailing slash so `{instance_url}/{prefix}/...` never double-slashes. Wrong base URL is the #1 cause of "nothing works".
2. **Paths are `[INFERRED]`, not fact.** Call what the instance Swagger says, not `/api/v1/jobs` because this file says so. Treat every path as a hypothesis.
3. **Writes are real financial postings.** Workbench "retains its business rules and validations" on writes `[DOCUMENTED]`, so a syntactically valid POST can still be rejected (closed job, invalid activity, unbalanced distribution). HITL-confirm every write; never auto-retry on ambiguity.
4. **Distribution must balance.** A cost/invoice splits across job/activity/GL/tax lines summing to the document total. `[DOCUMENTED]` rule: **the Activity Code carries the debit GL account** — post to a job + activity; the GL account follows from the activity → GL mapping. Do not invent `glAccount` codes.
5. **Two product lines share the name.** Cloud "Workbench Online" vs SAP Business One companion "Workbench SBO" may expose different surfaces. Confirm which the customer runs 🔬.
6. **`jobNo` ≠ internal `id`.** Human job number ("J-10042") and internal id ("10042") can differ; a filter taking one may reject the other. Capture both from list responses 🔬.
7. **Date format may not be ISO.** A NZ/AU ERP may want `dd/mm/yyyy` on filters even if it returns ISO. If a date filter errors/returns nothing, try the alternate 🔬.

## Defaults (override only if the user specifies)

`pageSize=200` (read; back off if rejected — max unknown 🔬). Always send an explicit `pageSize` — default is unknown, omitting it can silently truncate. Writes **off by default**.

## Operations (every path `[INFERRED]` 🔬 — replace from Swagger)

| Operation               | Method   | Path (under `{instance_url}/{prefix}`) | Key params / notes                                               |
| ----------------------- | -------- | -------------------------------------- | ---------------------------------------------------------------- |
| Read Swagger spec       | GET      | /swagger (+ /swagger/v1/swagger.json)  | **Do this first** — ground truth                                 |
| List/search jobs        | GET      | /jobs                                  | pageSize, page, status; central record                           |
| Get one job             | GET      | /jobs/{id}                             | —                                                                |
| Job transactions        | GET      | /jobs/{id}/transactions                | fromDate, toDate, pageSize; carries distribution lines           |
| List transactions       | GET      | /transactions                          | jobNo, fromDate, toDate                                          |
| Create transaction      | POST     | /transactions                          | body w/ balanced lines[]; write — HITL                           |
| Timesheets              | GET/POST | /timesheets                            | jobNo, employeeId, date; POST write — HITL                       |
| Purchase orders         | GET/POST | /purchaseorders                        | jobNo, supplierId; POST write — HITL; may need approve/send step |
| Creditors / AP invoices | GET      | /creditors                             | supplierId, fromDate                                             |
| Debtors / AR / claims   | GET      | /debtors, /invoices                    | clientId, fromDate                                               |
| GL / chart of accounts  | GET      | /accounts                              | distribution targets                                             |
| Subcontracts            | GET      | /subcontracts                          | scope, claims, retentions                                        |
| Plant / assets          | GET      | /plant                                 | rates, depreciation                                              |
| Suppliers / Employees   | GET      | /suppliers, /employees                 | address book + people                                            |

## Pagination

Type `[INFERRED]` 🔬 — likely page/offset (`page`+`pageSize`), possibly `offset`/`limit`. Send explicit `pageSize` (start 200). Assumed envelope (field names 🔬): `{"items":[…],"totalCount":312,"page":1,"pageSize":50}`. Last page = `(page*pageSize) >= totalCount`, or a short/empty `items[]` page. Verify `items`/`data` and `totalCount`/`total` against a live response. No bulk/batch endpoint documented — paginate one resource at a time.

## Webhooks / Events

No webhook support found `[INFERRED]` 🔬 — partner syncs (Xero/MYOB) appear poll/batch. **Polling only.** Poll list endpoints, diff on a date/modified field (reliable field `[UNKNOWN]` 🔬). Intervals ≥ 15 min until rate limits known. See 01d.

## Errors

Error-body schema `[UNKNOWN]` 🔬 — not published. Do NOT assume a shape. Key off HTTP status, defensively parse the body, surface raw text (ERP domain errors like "distribution does not balance"/"job is closed" are actionable).
Recovery (statuses `[INFERRED]` 🔬): 400/422 fix payload (balance distribution, valid job/activity, open job), don't retry · 401 token invalid/expired or wrong header — user re-issues (no auto-refresh), try `X-Api-Key` · 403 issuing user's role lacks permission · 404 verify path/id + `instance_url` normalisation, re-check Swagger base path · 409 GET current state then decide · 429 honour `Retry-After` then backoff (≤3) · 5xx exponential backoff (≤3). Empty `items[]`/`totalCount:0` is a valid result, not an error. Create may return `200` not `201` — look for a new `id` in the body, don't branch on status alone.

## Examples (paths/fields `[INFERRED]` 🔬 — placeholders, replace from Swagger)

1. List active jobs:
   `GET /api/v1/jobs?status=Active&pageSize=200` → `{"items":[{"id":"10042","jobNo":"J-10042","name":"Riverside Bridge Upgrade","status":"Active","clientId":"551","manager":"Aroha Ngata"}],"totalCount":312,"page":1,"pageSize":50}`

2. Job cost transactions with distribution:
   `GET /api/v1/jobs/10042/transactions?fromDate=2026-01-01&pageSize=200` → `{"items":[{"id":"TX-88231","jobNo":"J-10042","type":"Purchase","date":"2026-03-14","amount":4200.0,"taxCode":"GST","taxAmount":630.0,"lines":[{"activityCode":"STEEL","glAccount":"6100","amount":4200.0,"tax":630.0}]}],"totalCount":47,"page":1,"pageSize":200}`
   → Distribution lives in `lines[]` — sum those for cost-by-activity/GL, not the header `amount`.

3. Create a timesheet (write — HITL required):
   `POST /api/v1/timesheets` body `{"jobNo":"J-10042","activityCode":"LABOUR","employeeId":"E-204","date":"2026-05-29","hours":7.5,"notes":"Formwork, pier 3"}` → `{"id":"TS-55120","jobNo":"J-10042","activityCode":"LABOUR","hours":7.5,"date":"2026-05-29","status":"Submitted"}`

4. AP/creditor invoices for a supplier:
   `GET /api/v1/creditors?supplierId=SUP-77&fromDate=2026-01-01&pageSize=100` → `{"items":[{"id":"AP-9001","supplierId":"SUP-77","invoiceNo":"INV-4471","date":"2026-02-20","total":12450.0,"status":"Approved","lines":[{"jobNo":"J-10042","activityCode":"SUBBIE","glAccount":"6300","amount":12450.0}]}],"totalCount":8,"page":1,"pageSize":100}`
