---
api_name: 'Workbench International (ERP)'
api_slug: 'workbench'
base_url: '{instance_url} (per-customer, e.g. https://yourcompany.workbench.com)'
version: 'per-instance (Swagger-defined)'
spec_format: 'Swagger / OpenAPI — exists per-instance, NOT publicly readable'
spec_url: '{instance_url}/swagger (UI) · {instance_url}/swagger/v1/swagger.json (raw — exact path 🔬)'
docs_url: 'https://www.workbenchcentral.com/technology'
date_researched: '2026-05-29'
---

# Workbench International — API Specification & Investigation

> Clean developer reference for the Workbench International ERP API. This is the condensed output of
> the investigation questionnaire (`00-api-investigation-questionnaire.md`) — everything a developer
> needs to integrate, in one place.
>
> ⚠️ **DISCOVERY-FIRST API — READ THIS BEFORE TRUSTING ANYTHING BELOW.** Workbench publicly _states_
> it has "a JSON REST API which exposes many Workbench functions" and that "Swagger is used to give
> developers the metadata and a code generation facility for all the API methods" — but the **actual
> reference is served per-customer instance and is NOT publicly reachable.** No live call was made at
> research time (no bearer token, no customer `instance_url`), so **Phase 2's "first successful call"
> gate is NOT satisfied.** Every endpoint path, field name, query parameter, pagination envelope and
> error shape in this document is `[INFERRED]` or `[UNKNOWN]` unless explicitly tagged `[DOCUMENTED]`
> (= stated in Workbench's own published material). **Nothing here is `[CONFIRMED]`.** Items needing a
> live tenant to resolve are tagged **🔬 DISCOVER**. When the instance Swagger contradicts this file,
> the Swagger wins.
>
> **Confidence markers:** `[DOCUMENTED]` = in official Workbench material · `[DOCUMENTED — registry]`
> = stated in the Numa connector registry entry · `[INFERRED]` = deduced from ERP conventions / the
> Workbench module docs · `[UNKNOWN]` = not established, discovery needed.

---

## Overview

- **Vendor:** Workbench International Limited (NZ / APAC) `[DOCUMENTED]`
- **Product:** Workbench — job-costing / project-accounting & construction-management ERP `[DOCUMENTED]`
- **API version:** per-instance, Swagger-defined — **`[UNKNOWN]` publicly** 🔬
- **Base URL:** the per-customer **`instance_url`** (e.g. `https://yourcompany.workbench.com`) `[DOCUMENTED — registry]`
- **API path prefix:** likely `/api` or `/api/v1` under the instance host — **`[INFERRED]` 🔬** (read it from the Swagger base path)
- **Sandbox URL:** Workbench runs a continually-refreshed internal sandbox for its own CI; whether _customers_ get a sandbox host is **`[UNKNOWN]` 🔬**
- **API type:** REST `[DOCUMENTED]`
- **Data format:** JSON `[DOCUMENTED]`
- **Documentation:** [workbenchcentral.com/technology](https://www.workbenchcentral.com/technology) (existence + Swagger claim) `[DOCUMENTED]`
- **API reference:** Workbench API docs Confluence space [`webwbdoc.atlassian.net/wiki/spaces/WAPI`](https://webwbdoc.atlassian.net/wiki/spaces/WAPI) — renders client-side, returns near-empty HTML to a scraper 🔬
- **OpenAPI / Swagger spec:** **Exists** (vendor states it) but is **per-instance**: `{instance_url}/swagger` (UI) and `{instance_url}/swagger/v1/swagger.json` (raw — exact path 🔬). **Not public.**
- **Status page:** Not located `[UNKNOWN]`

**Summary:** Workbench is a New Zealand / APAC job-costing and construction-management ERP used by
trade, construction, contracting and distribution businesses. It exposes a JSON REST API (with a
per-instance Swagger spec and codegen) that surfaces **jobs**, **cost/revenue transactions and their
GL distribution**, **accounts payable** (creditors / supplier invoices), **accounts receivable**
(debtors / client invoices / progress claims), **purchase orders**, **timesheets** and **plant /
assets**. The API "retains the business rules and validations of the Workbench application" on writes
— so a syntactically valid POST can still be rejected by domain rules.

> ⚠️ **Name collision.** "Workbench" matches many unrelated products — Expel Workbench (security ops,
> uses a `/login → 13-hour bearer` flow), Posit/RStudio Workbench, Salesforce Workbench, Azure
> Blockchain Workbench, Cloudera Data Science Workbench, BMC AMI DevX Workbench. **None of these are
> Workbench International ERP.** Do not copy their auth models — in particular do **not** import
> Expel's `/login` bearer flow, which surfaced repeatedly in search.

---

## Authentication

### Method: `token` (static bearer token + per-customer instance URL) `[DOCUMENTED — registry]`

The Numa connector is configured `authType: 'token'` with **two credential fields**: a `bearer_token`
(password) and an `instance_url` (URL). The admin/user pastes a pre-issued bearer token plus their
tenant's base URL; Numa stores both and sends the token against `{instance_url}`. There is **no OAuth
flow** in the registry — no `authUrl`, `tokenUrl`, `scopes` or refresh token — consistent with a
static, instance-issued token. Full setup and rotation: see `04-connection-and-reauth.md`.

**Header format** (assumed Bearer; **`[INFERRED]` — verify the header name** 🔬):

```
Authorization: Bearer {bearer_token}
Accept: application/json
```

**Auth properties:**

| Property                  | Value                                                                                                                           | Confidence              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Grant type                | n/a (not OAuth) — static pre-issued bearer token                                                                                | [DOCUMENTED — registry] |
| Auth location             | HTTP header `Authorization: Bearer {bearer_token}` — **verify; some ERPs use `X-Api-Key`/`apikey`**                             | [INFERRED] 🔬           |
| Base URL / routing        | per-customer **`instance_url`** (each tenant is a separate host)                                                                | [DOCUMENTED — registry] |
| How the token is obtained | Generated inside the Workbench instance by an admin/user (API key / PAT) **OR** issued by support — **not documented publicly** | [UNKNOWN] 🔬            |
| Token lifetime            | **`[UNKNOWN]`** — could be static (no refresh field in registry) or expiring                                                    | [UNKNOWN] 🔬            |
| Refresh mechanism         | None in registry (no refresh token field) → treat as **static**; re-issue manually on expiry                                    | [INFERRED] 🔬           |
| Scopes / permission model | **`[UNKNOWN]`** — almost certainly governed by the issuing **user's Workbench role**, not OAuth scopes                          | [INFERRED] 🔬           |
| PKCE / state              | n/a (not OAuth)                                                                                                                 | [DOCUMENTED — registry] |
| TLS                       | HTTPS only (the `instance_url` field is typed `url`, placeholder `https://`)                                                    | [INFERRED]              |

**First-call smoke test** (run once a token + instance are in hand — **🔬 DISCOVER the real jobs path** from the Swagger first):

```http
GET {instance_url}/api/v1/jobs?pageSize=1 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

`200` → auth works, gate satisfied. `401` → token invalid/expired **or** wrong auth header (try
`X-Api-Key`). `403` → token valid but the issuing user's role lacks permission. `404` (HTML) → wrong
path prefix; re-read the Swagger base path.

---

## Endpoint Catalog

> ⚠️ **No endpoint path below is publicly documented.** Every path is an `[INFERRED]` placeholder
> built from REST + Workbench-module naming conventions, to be **replaced verbatim from the instance
> Swagger** (`{instance_url}/swagger`). **Do not ship these as fact.** 🔬 DISCOVER all of this section.

### Spec discovery (do this first)

| Method | Path                       | Purpose                                             | Auth  | Paginated | Idempotent | Confidence    |
| ------ | -------------------------- | --------------------------------------------------- | ----- | --------- | ---------- | ------------- |
| GET    | `/swagger`                 | Swagger UI — **self-describing API spec**           | maybe | n/a       | Yes        | [INFERRED] 🔬 |
| GET    | `/swagger/v1/swagger.json` | Raw OpenAPI JSON (exact path 🔬) — **ground truth** | maybe | n/a       | Yes        | [INFERRED] 🔬 |

### Jobs (the central record) `[INFERRED]` 🔬

| Method | Path                             | Purpose                                            | Auth | Paginated | Idempotent | Confidence    |
| ------ | -------------------------------- | -------------------------------------------------- | ---- | --------- | ---------- | ------------- |
| GET    | `/api/v1/jobs`                   | List / search jobs                                 | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET    | `/api/v1/jobs/{id}`              | Get one job                                        | Yes  | No        | Yes        | [INFERRED] 🔬 |
| GET    | `/api/v1/jobs/{id}/transactions` | A job's cost/revenue transactions (+ distribution) | Yes  | likely    | Yes        | [INFERRED] 🔬 |

### Transactions & distribution (the costing core) `[INFERRED]` 🔬

| Method | Path                   | Purpose                                                         | Auth | Paginated | Idempotent | Confidence    |
| ------ | ---------------------- | --------------------------------------------------------------- | ---- | --------- | ---------- | ------------- |
| GET    | `/api/v1/transactions` | List / search transactions                                      | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| POST   | `/api/v1/transactions` | Create a cost/revenue transaction (balanced distribution lines) | Yes  | No        | **No**     | [INFERRED] 🔬 |

### Time, purchasing, AP / AR, GL, plant `[INFERRED]` 🔬

| Method   | Path                               | Purpose                                            | Auth | Paginated | Idempotent | Confidence    |
| -------- | ---------------------------------- | -------------------------------------------------- | ---- | --------- | ---------- | ------------- |
| GET/POST | `/api/v1/timesheets`               | Read / create timesheet entries (WBTIME)           | Yes  | likely    | POST: No   | [INFERRED] 🔬 |
| GET/POST | `/api/v1/purchaseorders`           | Read / create purchase orders (WBPURCHASING)       | Yes  | likely    | POST: No   | [INFERRED] 🔬 |
| GET      | `/api/v1/creditors`                | AP — supplier/creditor invoices                    | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET      | `/api/v1/debtors` / `/invoices`    | AR — client invoices & progress claims             | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET      | `/api/v1/accounts`                 | GL / chart of accounts (distribution targets)      | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET      | `/api/v1/subcontracts`             | Subcontract management (scope, claims, retentions) | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET      | `/api/v1/plant`                    | Plant / assets (rates, depreciation, utilisation)  | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET      | `/api/v1/suppliers` / `/contacts`  | Address book of suppliers / clients                | Yes  | likely    | Yes        | [INFERRED] 🔬 |
| GET      | `/api/v1/employees` / `/resources` | People who log timesheets / are charged out        | Yes  | likely    | Yes        | [INFERRED] 🔬 |

### Full Endpoint Index

| #   | Method   | Path                              | Purpose                         | Notes                                |
| --- | -------- | --------------------------------- | ------------------------------- | ------------------------------------ |
| 0   | GET      | `/swagger` (+ `.../swagger.json`) | Self-describing spec            | **Do this first** — the real catalog |
| 1   | GET      | `/api/v1/jobs`                    | List/search jobs                | `pageSize`, `page`, `status` 🔬      |
| 2   | GET      | `/api/v1/jobs/{id}`               | Get one job                     | 🔬                                   |
| 3   | GET      | `/api/v1/jobs/{id}/transactions`  | Job transactions + distribution | `fromDate`, `toDate` 🔬              |
| 4   | GET      | `/api/v1/transactions`            | List transactions               | `jobNo`, `fromDate`, `toDate` 🔬     |
| 5   | POST     | `/api/v1/transactions`            | Create transaction              | Write — HITL; balanced `lines[]` 🔬  |
| 6   | GET/POST | `/api/v1/timesheets`              | Read/create timesheets          | Write — HITL 🔬                      |
| 7   | GET/POST | `/api/v1/purchaseorders`          | Read/create purchase orders     | Write — HITL 🔬                      |
| 8   | GET      | `/api/v1/creditors`               | AP / supplier invoices          | `supplierId`, `fromDate` 🔬          |
| 9   | GET      | `/api/v1/debtors` / `/invoices`   | AR / client invoices / claims   | `clientId`, `fromDate` 🔬            |
| 10  | GET      | `/api/v1/accounts`                | GL / chart of accounts          | Distribution targets 🔬              |
| 11  | GET      | `/api/v1/subcontracts`            | Subcontracts                    | 🔬                                   |
| 12  | GET      | `/api/v1/plant`                   | Plant / assets                  | 🔬                                   |

> **🔬 DISCOVER:** the authoritative endpoint list **is** the Swagger document served at the instance.
> This index is an _inferred starting hypothesis_, not the catalog. The Total Synergy reference for
> comparison (`ext-api-doc/synergy/02-api-spec-investigation.md`) was generated by dumping its
> per-instance Swagger to **359 paths / 369 operations** — the equivalent for Workbench can only be
> produced once a token + `instance_url` are available.

---

## Data Models

> Entities are **`[DOCUMENTED]` as concepts** (they come from Workbench's published module docs: Job
> Costing, Timesheets, Purchasing, AP/AR, GL, Subcontracts, Plant) but the **API resource names, field
> names, types and casing are `[INFERRED]`** — dump the Swagger for the truth. 🔬

### Job

| Field          | Type          | Required (create) | Writable | Description                                           | Confidence    |
| -------------- | ------------- | ----------------- | -------- | ----------------------------------------------------- | ------------- |
| `id` / `jobNo` | string/int    | —                 | no       | Job identifier (the human "job number" is the UI key) | [INFERRED] 🔬 |
| `name`         | string        | yes               | yes      | Job/project description                               | [INFERRED] 🔬 |
| `status`       | enum/string   | —                 | yes      | e.g. Active / On-hold / Closed (enum values 🔬)       | [INFERRED] 🔬 |
| `clientId`     | string/int    | —                 | yes      | FK → Debtor / Contact                                 | [INFERRED] 🔬 |
| `manager`      | string        | —                 | yes      | Job / project manager                                 | [INFERRED] 🔬 |
| `budget`       | decimal       | —                 | maybe    | Job budget (vs actual / forecast)                     | [INFERRED] 🔬 |
| `createdDate`  | string (ISO?) | —                 | no       | Date serialisation unconfirmed (see Field Formats)    | [INFERRED] 🔬 |

### Transaction + Distribution lines (the costing core)

| Field                  | Type       | Description                                                   | Confidence                |
| ---------------------- | ---------- | ------------------------------------------------------------- | ------------------------- |
| `id`                   | string     | Transaction id                                                | [INFERRED] 🔬             |
| `jobNo` / `jobId`      | string/int | The job the cost/revenue posts to                             | [INFERRED] 🔬             |
| `type`                 | string     | e.g. Purchase / Labour / Revenue                              | [INFERRED] 🔬             |
| `date`                 | string     | Transaction date (format 🔬)                                  | [INFERRED] 🔬             |
| `amount`               | decimal    | Net amount                                                    | [INFERRED] 🔬             |
| `taxCode`/`tax`        | string/dec | Tax code + amount (GST in NZ/AU)                              | [INFERRED] 🔬             |
| `lines[]`              | array      | **Distribution lines** — the split across job/activity/GL/tax | [DOCUMENTED] (concept) 🔬 |
| `lines[].activityCode` | string     | Activity within the job that the line posts to                | [INFERRED] 🔬             |
| `lines[].glAccount`    | string     | GL/nominal account the distribution line hits                 | [INFERRED] 🔬             |
| `lines[].amount`       | decimal    | Net amount of the line                                        | [INFERRED] 🔬             |

> **What "distribution" means in Workbench:** the cost/GL distribution of a transaction across **job +
> activity + GL account (+ tax)** — the lines that split a cost or invoice into job-costing and GL
> postings. This is the interface Workbench describes as connecting "to General Ledger, Accounts
> Payable, Accounts Receivable." A `[DOCUMENTED]` rule from the module docs: **the Activity Code
> carries the debit GL account** — you post to a job + activity, and the GL account follows from the
> activity mapping. Distribution lines must **sum to the document total**. `[INFERRED]` for exact API
> enforcement 🔬.

### Other entities (resource & fields `[INFERRED]` 🔬)

- **Activity Code / Activity Group** — cost breakdown within a job; transactions post to a job **+
  activity**. `[DOCUMENTED]` concept.
- **Cost Centre** — org/financial dimension on postings. `[INFERRED]`
- **Timesheet** — personal/daily time entry → job cost capture (WBTIME). `[DOCUMENTED]` module.
- **Purchase Order** — create POs online, email to suppliers (WBPURCHASING). `[DOCUMENTED]` module.
- **Creditor / AP invoice** — supplier invoices distributed to jobs/GL. `[DOCUMENTED]` concept.
- **Debtor / AR invoice / Claim** — client invoices, progress claims, retentions. `[DOCUMENTED]` concept.
- **Subcontract** — scope, claim certification, retentions. `[DOCUMENTED]` module.
- **Plant / Asset** — asset detail, costing rates (hrs/kms), depreciation, utilisation. `[DOCUMENTED]` module.
- **Supplier / Contact**, **Employee / Resource** — address book + people. `[INFERRED]`

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

- A transaction must reference a **valid Job + Activity Code**, and a GL account on each distribution
  line. `[INFERRED]` 🔬
- Data is **tenant-isolated by `instance_url`** — one token/instance cannot read another customer.

### Field Format Reference

| Format     | Pattern (assumed) | Example                      | Confidence              |
| ---------- | ----------------- | ---------------------------- | ----------------------- |
| Date       | ISO-8601 string   | `"2026-05-29"`               | [INFERRED] 🔬           |
| Currency   | decimal number    | `1500.00`                    | [INFERRED] 🔬           |
| Tax        | code + decimal    | `"GST"`, `225.00`            | [INFERRED] 🔬           |
| Job number | string/int        | `"J-10042"`                  | [INFERRED] 🔬           |
| GL account | string code       | `"6100"`                     | [INFERRED] 🔬           |
| Instance   | HTTPS host        | `https://acme.workbench.com` | [DOCUMENTED — registry] |

---

## Pagination

- **Type:** **`[INFERRED]` 🔬** — likely page/offset (`page` + `pageSize`) by ERP/Swagger convention. Confirm from the spec.
- **Default page size:** **`[UNKNOWN]` 🔬** — always send an explicit page size.
- **Max page size:** **`[UNKNOWN]` 🔬** — start at 200; back off if rejected.
- **Total count:** likely a `totalCount`/`total` field in the envelope `[INFERRED]` 🔬

**Parameters (assumed — confirm against Swagger):**

| Parameter  | Type | Default        | Description                  |
| ---------- | ---- | -------------- | ---------------------------- |
| `page`     | int  | `[UNKNOWN]` 🔬 | 1-based page number          |
| `pageSize` | int  | `[UNKNOWN]` 🔬 | Items per page (`limit`?) 🔬 |

**Response structure (assumed envelope — `[INFERRED]` 🔬):**

```json
{
  "items": [
    /* … */
  ],
  "totalCount": 312,
  "page": 1,
  "pageSize": 50
}
```

**Last-page detection:** `(page * pageSize) >= totalCount`, or a short/empty `items[]` page. Verify the
envelope field names (`items`/`data`, `totalCount`/`total`) against a live response. 🔬

**Bulk operations:** None documented. Assume one-at-a-time writes through the business-rule-validated
API. `[UNKNOWN]` 🔬

---

## Rate Limits

| Scope | Limit       | Window | Confidence   |
| ----- | ----------- | ------ | ------------ |
| Any   | `[UNKNOWN]` | —      | [UNKNOWN] 🔬 |

**No public rate-limit documentation.** Limits (if any) are likely per-instance and may be configurable
by the customer/host. **🔬 DISCOVER** by inspecting response headers (`X-RateLimit-*`, `Retry-After`)
and triggering throttling on a live tenant. Until then be conservative: cache reads, avoid tight loops,
keep any polling low-frequency.

**Headers:** `[UNKNOWN]` — watch for `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `Retry-After` on
live responses. 🔬

**When exceeded:** assume `429` with a `Retry-After` (if enforced at all). `[UNKNOWN]` 🔬

**Recommended strategy:** exponential backoff on `429`/`5xx`; cache list/metadata reads.

---

## Error Handling

**Standard error format:** **`[UNKNOWN]` 🔬** — Workbench's error body schema is **not published**. Do
**not** assume a shape (do not fabricate a `{code, message, errors[]}` envelope). Key off the HTTP
status first, then defensively parse the body and surface the raw text. Because Workbench "retains its
business rules and validations" on writes, expect **domain-specific** `400`/`422` errors (unbalanced
distribution, closed job, invalid activity) whose body shape can only be captured by triggering them
on a live tenant.

**Status codes (all `[INFERRED]` 🔬):**

| Status  | Meaning                              | Retryable | Recovery                                                              |
| ------- | ------------------------------------ | --------- | --------------------------------------------------------------------- |
| 200     | OK (JSON body)                       | —         | —                                                                     |
| 400/422 | Validation / business-rule rejection | No        | Fix payload (balance distribution, valid job/activity); don't retry   |
| 401     | Unauthorized                         | Yes       | Token invalid/expired **or** wrong auth header — user re-issues token |
| 403     | Forbidden                            | No        | Issuing user's Workbench role lacks permission                        |
| 404     | Not found                            | No        | Verify path / id and `instance_url` normalisation                     |
| 429     | Rate limited (if any)                | Yes       | Honour `Retry-After`; exponential backoff 🔬                          |
| 5xx     | Server error                         | Yes       | Retry with exponential backoff                                        |

**Idempotency:** GET is naturally idempotent. **POST (transactions, timesheets, POs, invoices)
idempotency is `[UNKNOWN]`** — no documented idempotency-key header. Treat writes as **non-idempotent**:
track created ids client-side before retrying, to avoid duplicate financial postings. `[INFERRED]` 🔬

---

## Webhooks / Events

No webhook support found. Workbench's partner syncs (Xero / MYOB / Business Central) appear poll/batch
based, and no webhook/event registration endpoints surface in public material. `[INFERRED]` 🔬

**Use polling.** Poll list endpoints and diff on a date/modified field — **which field reliably exposes
"modified since" is `[UNKNOWN]` 🔬**. Keep intervals low (≥ 15 min) until rate limits are known.

---

## Known Limitations

1. **Reference not public.** Endpoints, field schemas, query params, pagination and error format are
   all gated behind the per-customer instance Swagger — every such claim here is `[INFERRED]`/`[UNKNOWN]`. 🔬
2. **No live token / `instance_url` at research time.** Phase 2 gate unmet; nothing is `[CONFIRMED]`.
3. **Token issuance/rotation flow is undocumented.** How the bearer token is generated and whether it
   expires is `[UNKNOWN]` 🔬. No refresh token in the registry → treat as static, re-issue manually.
4. **No idempotency key known.** Financial POSTs are not safe to blind-retry — risk of duplicate
   timesheets / invoices / transactions corrupting job costs.
5. **Rate limits unknown.** Be conservative; no tight loops or high-frequency polling until measured.
6. **Two product lines share the name.** Cloud **Workbench Online** vs the SAP Business One companion
   **Workbench SBO** may expose different surfaces — confirm which the customer runs. 🔬
7. **Auth header unconfirmed.** `Authorization: Bearer` is assumed; some ERPs use `X-Api-Key`/`apikey`.
   Verify against live `401`/`200` behaviour. 🔬

---

## SDKs & Tooling

| SDK / Tool           | Language   | Source                                  | Quality | Notes                                                         |
| -------------------- | ---------- | --------------------------------------- | ------- | ------------------------------------------------------------- |
| Swagger codegen      | any        | `{instance_url}/swagger` (per-instance) | n/a     | Generate a client from the instance spec `[DOCUMENTED]`       |
| PowerShell scripting | PowerShell | Vendor "Technology" page (example)      | n/a     | Vendor cites PowerShell as a scripting example `[DOCUMENTED]` |
| Official Py/JS SDK   | —          | —                                       | —       | **None located** `[UNKNOWN]`                                  |

**Postman collection:** Not located `[UNKNOWN]`
**OpenAPI spec:** Per-instance only — `{instance_url}/swagger` (UI) / `.../swagger.json` (raw, path 🔬)

---

## Integration Path Assessment

**Recommended path:** **Direct API Only** (spec-driven, chat-only) via the connector's
`connect_request` proxy path. `[DECISION]`

**Justification:** Workbench exposes **structured ERP data** — jobs, cost transactions and their GL
distribution, AP/creditors, AR/debtors/claims, purchase orders, timesheets, plant — **not browsable
files/folders**. So it is **not** a Files-Remote connector (no folder/file tree to surface). It mirrors
the Total Synergy / Actionstep / NetSuite pattern: a **token (bearer)** connector whose API specs live
in `ext-api-doc/workbench/` and are read by the workspace agent, which calls the API through the
standard **`connect_request`** path using the stored `bearer_token` + `instance_url`. **No
`lib/oauth-providers/` provider class** is required (that layer is for OAuth file-browsing connectors).
The registry entry sets no `surfaces` array; the entry is treated as chat-only.

> ⚠️ **Viability caveat:** unlike Total Synergy (whose Swagger we dumped), even the **endpoint catalog
> and field schemas are unconfirmed** for Workbench. The connector can _authenticate_ (paste token +
> instance), but the spec docs (`01-*`, `02-*`) cannot be raised to high confidence **until the
> instance Swagger is dumped**. The very first build/test step must be: with a customer token +
> `instance_url`, GET `{instance_url}/swagger` and backfill the catalog, fields, pagination and errors
> verbatim.

**Connector compatibility (Files-Remote methods — N/A, this is not a Files connector):**

| Connector Method  | API Endpoint | Feasibility |
| ----------------- | ------------ | ----------- |
| list_files        | —            | none        |
| download_file     | —            | none        |
| search_files      | —            | none        |
| get_file_metadata | —            | none        |

---

## Discovery Playbook (run with a live token + instance)

1. From the customer, obtain a **`bearer_token`** + **`instance_url`** (and confirm **Workbench Online**
   vs **Workbench SBO**).
2. **Pull the Swagger first:** open `{instance_url}/swagger` and fetch the raw OpenAPI JSON
   (`{instance_url}/swagger/v1/swagger.json` — exact path 🔬). This resolves: API path prefix, real
   resource names, field schemas, query params, pagination envelope.
3. **Smoke-test the gate:** `GET {instance_url}/{prefix}/jobs?pageSize=1` with `Authorization: Bearer …` → 200.
4. **Confirm the auth header** (Bearer vs `X-Api-Key`/`apikey`) by toggling it (401 vs 200).
5. **Enumerate the distribution model** on a real transaction (job/activity/GL/tax line shape).
6. **Trigger errors** (bad token, bad id, unbalanced distribution, closed job) to capture the real
   error-body schema + any rate-limit response (status, `Retry-After`, `X-RateLimit-*`).
7. **Establish token lifetime / rotation** (static vs expiring; is there a re-issue UI?).
8. Backfill every `[INFERRED]`/`[UNKNOWN]` here with `[CONFIRMED]` values from the live spec/calls.

---

## Sources

- Workbench "Technology" page (JSON REST API + Swagger codegen + PowerShell + "retains business rules
  and validations"): https://www.workbenchcentral.com/technology `[DOCUMENTED]`
- Workbench solutions / construction pages: https://www.workbenchcentral.com/workbench-solutions ,
  https://www.workbenchcentral.com/construction `[DOCUMENTED]`
- Integration partners (Xero / MYOB / JDE / SAP / Business Central): https://www.workbenchcentral.com/integrationsolutions `[DOCUMENTED]`
- Workbench API docs Confluence (renders client-side, not scrapable): https://webwbdoc.atlassian.net/wiki/spaces/WAPI 🔬
- Module docs (Job Costing / Time / Purchasing): https://workbenchdoc.atlassian.net/wiki `[DOCUMENTED]`
- Numa connector registry entry (`id: 'workbench'`): `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` `[DOCUMENTED — registry]`

_Researched 2026-05-29. Source: `00-api-investigation-questionnaire.md`. **Discovery-first connector —
re-verify against the instance Swagger before relying on any endpoint, field or envelope above.**_
