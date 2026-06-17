---
api_name: Workbench International (ERP)
api_slug: workbench
base_url: stored instance_url (per-customer, e.g. https://yourcompany.workbench.com) [DOCUMENTED — registry]
route_prefix: discover from Swagger base path (likely /api or /api/v1) — [INFERRED] 🔬
path_version_segment: UNCONFIRMED 🔬 — do NOT assume /api/v1; read the Swagger base path. /api/v1 below is a PLACEHOLDER.
auth: token (static bearer + per-customer instance_url); no OAuth, no refresh
field_casing: UNCONFIRMED 🔬 (examples use camelCase placeholder)
spec_format: Swagger/OpenAPI — exists per-instance, NOT publicly readable
spec_url: {instance_url}/swagger (UI) · {instance_url}/swagger/v1/swagger.json (raw — exact path 🔬)
docs_url: https://www.workbenchcentral.com/technology
call_surface: HTTP via `numa integrations request` (Direct API, spec-driven, chat-only). NOT a Files connector. No lib/oauth-providers class.
date_researched: 2026-05-29
confidence: NO live call was made (no token, no instance_url) → Phase-2 "first successful call" gate NOT satisfied; nothing is [CONFIRMED]. Every path/field/query-param/pagination/error here is [INFERRED] or [UNKNOWN] 🔬 unless tagged [DOCUMENTED] (= in Workbench's own material) or [DOCUMENTED — registry] (= in the Numa connector registry entry). When the instance Swagger contradicts this file, the Swagger wins.
---

# Workbench International — API Specification & Investigation

⚠️ **DISCOVERY-FIRST API.** Workbench states it has "a JSON REST API which exposes many Workbench functions" and that "Swagger is used to give developers the metadata and a code generation facility for all the API methods" `[DOCUMENTED]` — but the reference is **per-customer instance and NOT publicly reachable**. Pull `{instance_url}/swagger` and backfill before relying on any endpoint, field or envelope below. Items needing a live tenant are tagged 🔬.

## Overview

- **Vendor:** Workbench International Limited (NZ/APAC) `[DOCUMENTED]`
- **Product:** Workbench — job-costing / project-accounting & construction-management ERP `[DOCUMENTED]`
- **API:** REST, JSON `[DOCUMENTED]`. Version per-instance, Swagger-defined — `[UNKNOWN]` publicly 🔬.
- **Base URL:** per-customer `instance_url` (e.g. `https://yourcompany.workbench.com`) `[DOCUMENTED — registry]`. Path prefix likely `/api` or `/api/v1` — `[INFERRED]` 🔬 (read from Swagger base path).
- **OpenAPI/Swagger spec:** exists (vendor states it) but **per-instance**: `{instance_url}/swagger` (UI), `{instance_url}/swagger/v1/swagger.json` (raw — exact path 🔬). Not public.
- **Sandbox:** Workbench runs an internal CI sandbox; whether _customers_ get a sandbox host is `[UNKNOWN]` 🔬.
- **Docs:** [workbenchcentral.com/technology](https://www.workbenchcentral.com/technology) (existence + Swagger claim) `[DOCUMENTED]`. API docs Confluence [webwbdoc.atlassian.net/wiki/spaces/WAPI](https://webwbdoc.atlassian.net/wiki/spaces/WAPI) renders client-side, returns near-empty HTML to a scraper 🔬. Status page not located `[UNKNOWN]`.

**Summary:** NZ/APAC job-costing + construction-management ERP for trade/construction/contracting/distribution. JSON REST API (per-instance Swagger + codegen) surfacing **jobs**, **cost/revenue transactions + GL distribution**, **AP** (creditors/supplier invoices), **AR** (debtors/client invoices/progress claims), **purchase orders**, **timesheets**, **plant/assets**. The API "retains the business rules and validations of the Workbench application" on writes — a syntactically valid POST can be rejected by domain rules.

> ⚠️ **Name collision.** "Workbench" matches many unrelated products — Expel Workbench (security ops, `/login → 13-hour bearer`), Posit/RStudio Workbench, Salesforce Workbench, Azure Blockchain Workbench, Cloudera Data Science Workbench, BMC AMI DevX Workbench. **None are Workbench International ERP.** Do NOT copy their auth models — in particular do NOT import Expel's `/login` bearer flow (surfaced repeatedly in search).

## Authentication

**Method: `token`** (static bearer token + per-customer instance URL) `[DOCUMENTED — registry]`. Connector is `authType: 'token'` with two credential fields: `bearer_token` (password) + `instance_url` (URL). User pastes a pre-issued token + tenant base URL; Numa stores both and sends the token against `{instance_url}`. **No OAuth** — no `authUrl`/`tokenUrl`/`scopes`/refresh token. Setup + rotation: `04-connection-and-reauth.md`.

Header (assumed Bearer; verify name 🔬): `Authorization: Bearer {bearer_token}` + `Accept: application/json`.

| Property             | Value                                                                                                    | Confidence              |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------- |
| Grant type           | n/a (not OAuth) — static pre-issued bearer                                                               | [DOCUMENTED — registry] |
| Auth location        | header `Authorization: Bearer {bearer_token}` — verify; some ERPs use `X-Api-Key`/`apikey`               | [INFERRED] 🔬           |
| Base URL / routing   | per-customer `instance_url` (each tenant a separate host)                                                | [DOCUMENTED — registry] |
| How token obtained   | Generated inside Workbench by an admin/user (API key/PAT) OR issued by support — not documented publicly | [UNKNOWN] 🔬            |
| Token lifetime       | static (no refresh field) or expiring                                                                    | [UNKNOWN] 🔬            |
| Refresh              | None in registry → treat as static; re-issue manually on expiry                                          | [INFERRED] 🔬           |
| Scopes / permissions | Governed by the issuing user's Workbench role, not OAuth scopes                                          | [INFERRED] 🔬           |
| PKCE / state         | n/a (not OAuth)                                                                                          | [DOCUMENTED — registry] |
| TLS                  | HTTPS only (`instance_url` typed `url`, placeholder `https://`)                                          | [INFERRED]              |

**First-call smoke test** (run once a token + instance are in hand — discover the real jobs path from the Swagger first): `GET {instance_url}/{prefix}/jobs?pageSize=1` with `Authorization: Bearer <token>`. `200`→auth works, gate satisfied. `401`→token invalid/expired OR wrong header (try `X-Api-Key`). `403`→issuing user's role lacks permission. `404` (HTML)→wrong prefix; re-read the Swagger base path.

## Endpoint Catalog

⚠️ **No path below is publicly documented.** Every path is an `[INFERRED]` placeholder from REST + Workbench-module naming, to be **replaced verbatim from the instance Swagger**. Do NOT ship these as fact. 🔬

| #   | Method   | Path (under `{instance_url}/{prefix}`)    | Purpose                                                    | Paginated | Idempotent | Key params / notes            |
| --- | -------- | ----------------------------------------- | ---------------------------------------------------------- | --------- | ---------- | ----------------------------- |
| 0   | GET      | `/swagger` (+ `/swagger/v1/swagger.json`) | Self-describing spec — **do this first; the real catalog** | n/a       | Yes        | ground truth                  |
| 1   | GET      | `/jobs`                                   | List/search jobs (central record)                          | likely    | Yes        | `pageSize`, `page`, `status`  |
| 2   | GET      | `/jobs/{id}`                              | Get one job                                                | No        | Yes        | —                             |
| 3   | GET      | `/jobs/{id}/transactions`                 | Job's cost/revenue tx + distribution                       | likely    | Yes        | `fromDate`, `toDate`          |
| 4   | GET      | `/transactions`                           | List/search transactions                                   | likely    | Yes        | `jobNo`, `fromDate`, `toDate` |
| 5   | POST     | `/transactions`                           | Create tx (balanced `lines[]`)                             | No        | **No**     | write — HITL                  |
| 6   | GET/POST | `/timesheets`                             | Read/create timesheets (WBTIME)                            | likely    | POST: No   | write — HITL                  |
| 7   | GET/POST | `/purchaseorders`                         | Read/create POs (WBPURCHASING)                             | likely    | POST: No   | write — HITL                  |
| 8   | GET      | `/creditors`                              | AP / supplier invoices                                     | likely    | Yes        | `supplierId`, `fromDate`      |
| 9   | GET      | `/debtors`, `/invoices`                   | AR / client invoices / claims                              | likely    | Yes        | `clientId`, `fromDate`        |
| 10  | GET      | `/accounts`                               | GL / chart of accounts                                     | likely    | Yes        | distribution targets          |
| 11  | GET      | `/subcontracts`                           | Subcontracts (scope, claims, retentions)                   | likely    | Yes        | —                             |
| 12  | GET      | `/plant`                                  | Plant / assets (rates, depreciation, utilisation)          | likely    | Yes        | —                             |
| 13  | GET      | `/suppliers`, `/contacts`                 | Address book of suppliers/clients                          | likely    | Yes        | —                             |
| 14  | GET      | `/employees`, `/resources`                | People who log timesheets / are charged out                | likely    | Yes        | —                             |

> The authoritative endpoint list **is** the instance Swagger. For scale comparison, the Total Synergy reference (`ext-api-doc/synergy/02-api-spec-investigation.md`) was generated by dumping its per-instance Swagger to **359 paths / 369 operations** — the Workbench equivalent can only be produced once a token + `instance_url` are available. 🔬

## Data Models

Entities are `[DOCUMENTED]` as concepts (Workbench module docs: Job Costing, Timesheets, Purchasing, AP/AR, GL, Subcontracts, Plant), but API resource names, field names, types and casing are `[INFERRED]` — dump the Swagger. 🔬 (Full field tables: `01a-domain-model-reference.md`.)

### Job

| Field         | Type         | Req(create) | Writable | Description                                       |
| ------------- | ------------ | ----------- | -------- | ------------------------------------------------- |
| `id`/`jobNo`  | string/int   | —           | no       | Job identifier (human "job number" is the UI key) |
| `name`        | string       | yes         | yes      | Job/project description                           |
| `status`      | enum/string  | —           | yes      | Active/On-hold/Closed (enum 🔬)                   |
| `clientId`    | string/int   | —           | yes      | FK → Debtor/Contact                               |
| `manager`     | string       | —           | yes      | Job/project manager                               |
| `budget`      | decimal      | —           | maybe    | Job budget (vs actual/forecast)                   |
| `createdDate` | string(ISO?) | —           | no       | Date serialisation 🔬                             |

### Transaction + Distribution lines (the costing core)

| Field                  | Type       | Description                                                                        |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `id`                   | string     | Transaction id                                                                     |
| `jobNo`/`jobId`        | string/int | Job the cost/revenue posts to                                                      |
| `type`                 | string     | e.g. Purchase/Labour/Revenue                                                       |
| `date`                 | string     | Transaction date (format 🔬)                                                       |
| `amount`               | decimal    | Net amount                                                                         |
| `taxCode`/`tax`        | string/dec | Tax code + amount (GST in NZ/AU)                                                   |
| `lines[]`              | array      | **Distribution lines** — split across job/activity/GL/tax `[DOCUMENTED]` (concept) |
| `lines[].activityCode` | string     | Activity within the job the line posts to                                          |
| `lines[].glAccount`    | string     | GL/nominal account the line hits                                                   |
| `lines[].amount`       | decimal    | Net amount of the line                                                             |

**What "distribution" means:** the cost/GL split of a transaction across **job + activity + GL account (+ tax)** — the lines that split a cost/invoice into job-costing and GL postings; Workbench's interface to "General Ledger, Accounts Payable, Accounts Receivable." Documented rule: **the Activity Code carries the debit GL account** — post to a job + activity, GL follows from the activity mapping. Distribution lines must **sum to the document total** (`[INFERRED]` for exact API enforcement 🔬). `[DOCUMENTED]`

### Other entities (resource & fields `[INFERRED]` 🔬)

- **Activity Code / Activity Group** — cost breakdown within a job; transactions post to job + activity `[DOCUMENTED]` (concept).
- **Cost Centre** — org/financial dimension on postings.
- **Timesheet** — personal/daily time entry → job cost capture (WBTIME) `[DOCUMENTED]` (module).
- **Purchase Order** — create POs online, email to suppliers (WBPURCHASING) `[DOCUMENTED]` (module).
- **Creditor / AP invoice** — supplier invoices distributed to jobs/GL `[DOCUMENTED]` (concept).
- **Debtor / AR invoice / Claim** — client invoices, progress claims, retentions `[DOCUMENTED]` (concept).
- **Subcontract** — scope, claim certification, retentions `[DOCUMENTED]` (module).
- **Plant / Asset** — asset detail, costing rates (hrs/kms), depreciation, utilisation `[DOCUMENTED]` (module).
- **Supplier/Contact**, **Employee/Resource** — address book + people.

**Relationships:**

```
┌──────────┐  1:N   ┌───────────────┐  1:N   ┌─────────────┐
│   Job    │───────▶│ Activity Code  │──┐     │ Cost Centre │
│ (jobNo)  │        │ (in Groups)    │  │     └─────────────┘
└────┬─────┘        └───────────────┘  │            ▲ dimension
     │ N:1                              │            │
     ▼                                  │      ┌──────────────────────────┐
┌───────────┐                          └─────▶│ Transaction              │
│  Debtor    │◀── client                       │  └─ Distribution lines ───┼──▶ ┌────────────┐
│ (AR/Claim) │                                  │     (job/activity/GL/tax) │    │ GL Account │
└───────────┘                                  └──────────────────────────┘    │ (nominal)  │
┌──────────┐  creates AP cost                            ▲                       └────────────┘
│ Creditor │─────────────────────────────────────────────┤ feeds
│ (AP inv) │                          ┌───────────────────┴──────────┐
└──────────┘                          │ Timesheet · Purchase Order ·  │
┌──────────────┐  logs time/cost      │ Subcontract claim · Plant     │
│ Employee/    │─────────────────────▶│ usage                          │
│ Resource     │                      └───────────────────────────────┘
└──────────────┘
```

- A transaction must reference a **valid Job + Activity Code**, and a GL account on each distribution line. 🔬
- Data is **tenant-isolated by `instance_url`** — one token/instance cannot read another customer.

(Field formats: Date ISO-8601 string · Currency/Tax decimal · Job no string/int · GL account string code — full table in `01a`. 🔬)

## Pagination

Type `[INFERRED]` 🔬 — likely page/offset (`page`+`pageSize`) by ERP/Swagger convention. Always send an explicit page size. Default + max `[UNKNOWN]` 🔬 (start at 200; back off if rejected). Total likely a `totalCount`/`total` field. Params (assumed): `page` (int, 1-based, default 🔬), `pageSize` (int, items per page — `limit`? 🔬, default 🔬). Assumed envelope (field names 🔬): `{"items":[…],"totalCount":312,"page":1,"pageSize":50}`. Last page = `(page*pageSize) >= totalCount`, or a short/empty `items[]` page. No bulk operations documented — assume one-at-a-time writes through the business-rule-validated API. 🔬

## Rate Limits

`[UNKNOWN]` 🔬 — no public documentation. Limits (if any) likely per-instance, possibly customer/host-configurable. Discover by inspecting response headers (`X-RateLimit-Limit`/`X-RateLimit-Remaining`/`Retry-After`) and triggering throttling on a live tenant. Assume `429` with a `Retry-After` (if enforced). Until then: cache list/metadata reads, avoid tight loops, keep polling low-frequency; exponential backoff on `429`/`5xx`.

## Error Handling

Error-body schema `[UNKNOWN]` 🔬 — not published. Do NOT assume a shape (do not fabricate a `{code, message, errors[]}` envelope). Key off the HTTP status first, then defensively parse the body and surface raw text. Because Workbench "retains its business rules and validations" on writes, expect **domain-specific** `400`/`422` errors (unbalanced distribution, closed job, invalid activity) whose body shape can only be captured by triggering them on a live tenant.

Status codes (all `[INFERRED]` 🔬): 200 OK (JSON body) · 400/422 validation/business-rule rejection → fix payload, don't retry · 401 unauthorized → token invalid/expired or wrong auth header, user re-issues (no auto-refresh) · 403 forbidden → issuing user's role lacks permission · 404 not found → verify path/id + `instance_url` normalisation · 429 rate limited (if any) → honour `Retry-After`, backoff · 5xx → exponential backoff. (Full recovery + retry caps: `01d`.)

**Idempotency:** GET naturally idempotent. **POST (transactions, timesheets, POs, invoices) idempotency `[UNKNOWN]`** — no documented idempotency-key header. Treat writes as **non-idempotent**: track created ids client-side before retrying, to avoid duplicate financial postings. 🔬

## Webhooks / Events

No webhook support found `[INFERRED]` 🔬 — partner syncs (Xero/MYOB/Business Central) appear poll/batch; no webhook/event registration endpoints surface in public material. **Use polling.** Poll list endpoints and diff on a date/modified field — reliable "modified since" field `[UNKNOWN]` 🔬. Intervals ≥ 15 min until rate limits known. (Details: `01d`.)

## SDKs & Tooling

| SDK / Tool           | Language   | Source                                  | Notes                                                         |
| -------------------- | ---------- | --------------------------------------- | ------------------------------------------------------------- |
| Swagger codegen      | any        | `{instance_url}/swagger` (per-instance) | Generate a client from the instance spec `[DOCUMENTED]`       |
| PowerShell scripting | PowerShell | Vendor "Technology" page (example)      | Vendor cites PowerShell as a scripting example `[DOCUMENTED]` |
| Official Py/JS SDK   | —          | —                                       | None located `[UNKNOWN]`                                      |

Postman collection: not located `[UNKNOWN]`. OpenAPI spec: per-instance only.

## Integration Path Assessment

**Recommended path:** Direct API only (spec-driven, chat-only) — HTTP via the connector's `connect_request` / `numa integrations request` path. `[DECISION]`

**Justification:** Workbench exposes **structured ERP data** (jobs, cost transactions + GL distribution, AP/creditors, AR/debtors/claims, POs, timesheets, plant), **not browsable files/folders** — so it is NOT a Files-Remote connector (no folder/file tree). Mirrors the Total Synergy / Actionstep / NetSuite pattern: a token (bearer) connector whose API specs live in `ext-api-doc/workbench/` and are read by the workspace agent, which calls the API via the standard `connect_request` path using the stored `bearer_token` + `instance_url`. **No `lib/oauth-providers/` provider class** (that layer is for OAuth file-browsing connectors). The registry entry sets no `surfaces` array → treated as chat-only.

> ⚠️ **Viability caveat:** unlike Total Synergy (whose Swagger we dumped), even the endpoint catalog and field schemas are unconfirmed for Workbench. The connector can _authenticate_ (paste token + instance), but the spec docs (`01-*`, `02-*`) cannot be raised to high confidence **until the instance Swagger is dumped**. The very first build/test step: with a customer token + `instance_url`, GET `{instance_url}/swagger` and backfill the catalog, fields, pagination and errors verbatim.

**Files-Remote methods (N/A — not a Files connector):** `list_files` / `download_file` / `search_files` / `get_file_metadata` → no endpoint, feasibility none.

## Known Limitations

1. Reference not public — endpoints, field schemas, query params, pagination, error format all gated behind the per-customer instance Swagger; every such claim is `[INFERRED]`/`[UNKNOWN]` 🔬.
2. No live token / `instance_url` at research time — Phase-2 gate unmet; nothing `[CONFIRMED]`.
3. Token issuance/rotation flow undocumented — generation + expiry `[UNKNOWN]` 🔬; no refresh token in registry → static, re-issue manually.
4. No idempotency key known — financial POSTs not safe to blind-retry (risk of duplicate timesheets/invoices/transactions corrupting job costs).
5. Rate limits unknown — be conservative; no tight loops or high-frequency polling until measured.
6. Two product lines share the name — cloud **Workbench Online** vs SAP Business One companion **Workbench SBO** may expose different surfaces; confirm which the customer runs 🔬.
7. Auth header unconfirmed — `Authorization: Bearer` assumed; some ERPs use `X-Api-Key`/`apikey`; verify against live `401`/`200` 🔬.

## Discovery Playbook (run with a live token + instance)

1. Obtain `bearer_token` + `instance_url` (confirm **Workbench Online** vs **Workbench SBO**).
2. **Pull the Swagger first:** `{instance_url}/swagger` + raw `{instance_url}/swagger/v1/swagger.json` (exact path 🔬) → resolves prefix, resource names, field schemas, query params, pagination envelope.
3. **Smoke-test the gate:** `GET {instance_url}/{prefix}/jobs?pageSize=1` → 200.
4. **Confirm the auth header** (Bearer vs `X-Api-Key`/`apikey`) by toggling it (401 vs 200).
5. **Enumerate the distribution model** on a real transaction (job/activity/GL/tax line shape).
6. **Trigger errors** (bad token, bad id, unbalanced distribution, closed job) to capture the real error-body schema + any rate-limit response (status, `Retry-After`, `X-RateLimit-*`).
7. **Establish token lifetime/rotation** (static vs expiring; re-issue UI?).
8. Backfill every `[INFERRED]`/`[UNKNOWN]` here with `[CONFIRMED]` values from the live spec/calls.

## Sources

- Workbench "Technology" page (JSON REST API + Swagger codegen + PowerShell + "retains business rules and validations"): https://www.workbenchcentral.com/technology `[DOCUMENTED]`
- Workbench solutions / construction: https://www.workbenchcentral.com/workbench-solutions , https://www.workbenchcentral.com/construction `[DOCUMENTED]`
- Integration partners (Xero/MYOB/JDE/SAP/Business Central): https://www.workbenchcentral.com/integrationsolutions `[DOCUMENTED]`
- API docs Confluence (renders client-side, not scrapable): https://webwbdoc.atlassian.net/wiki/spaces/WAPI 🔬
- Module docs (Job Costing/Time/Purchasing): https://workbenchdoc.atlassian.net/wiki `[DOCUMENTED]`
- Numa connector registry entry (`id: 'workbench'`): `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` `[DOCUMENTED — registry]`

_Researched 2026-05-29. **Discovery-first connector — re-verify against the instance Swagger before relying on any endpoint, field or envelope above.**_
