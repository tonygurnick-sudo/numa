---
api_name: 'Workbench International (ERP)'
api_slug: 'workbench'
vendor: 'Workbench International Limited'
website: 'https://www.workbenchcentral.com'
investigation_started: '2026-05-29'
investigator: 'Claude Code (doc-based investigation)'
investigation_status: 'blocked' # public docs sparse; the Swagger reference + token issuance live behind a per-customer instance — field/endpoint detail needs discovery
documentation_quality: 'poor' # vendor confirms "JSON REST API" + "Swagger" publicly, and a Workbench API docs Confluence space (WAPI) exists, but the actual reference, auth-token issuance, endpoints and schemas are not publicly readable — they sit behind each customer's instance
api_types: [REST]
overall_confidence: 'low'
integration_path: 'Direct API (spec-driven, chat-only) via connect_request'
auth_type: 'token'
blockers:
  - 'No bearer token / customer instance_url available at research time — Phase 2 first-call gate NOT satisfied'
  - 'Swagger/OpenAPI spec is served per-instance (e.g. {instance_url}/swagger) and is NOT publicly reachable — endpoint paths, field schemas, pagination and rate limits could not be enumerated'
  - 'How the bearer token is issued/rotated is undocumented publicly (likely generated inside the Workbench instance by an admin/user); must be confirmed against a live tenant'
  - 'Two product lines share the name: cloud "Workbench Online" and the SAP Business One companion "Workbench SBO". The API surface may differ by deployment — confirm which the customer runs'
---

# Workbench International — API Investigation Questionnaire

> **Confidence markers:** `[CONFIRMED]` = verified against a live API call · `[DOCUMENTED]` =
> stated in official Workbench material (workbenchcentral.com / the Workbench docs Confluence) ·
> `[INFERRED]` = deduced from ERP conventions, the module docs, or the integration partners ·
> `[UNKNOWN]` = not yet established, discovery needed.
>
> ⚠️ **This is a documentation-based investigation.** No live Workbench call was made (no bearer
> token and no customer `instance_url` available at research time). **Phase 2's "first successful
> call" gate is therefore NOT satisfied.** Every auth/endpoint/field claim below is `[DOCUMENTED]`,
> `[INFERRED]`, or `[UNKNOWN]` — never `[CONFIRMED]`. Items needing a live run are tagged
> **🔬 DISCOVER**.
>
> 🚩 **Why so much is `[INFERRED]`/`[UNKNOWN]`:** Workbench publicly _states_ it has "a JSON REST
> API which exposes many Workbench functions" and that "Swagger is used to give developers the
> metadata and a code generation facility for all the API methods" — but the **actual reference is
> not public**. There is a dedicated **Workbench API documentation** Confluence space
> (`webwbdoc.atlassian.net/wiki/spaces/WAPI`) and a per-product Xero-API space (`/spaces/XEROAPI`,
> "Workbench Online"), but their pages render client-side and return near-empty/truncated HTML to a
> scraper. The Swagger UI itself is almost certainly served **per customer instance** (the connector
> collects an `instance_url` precisely because each tenant has its own host). So endpoint paths,
> field schemas, pagination, rate limits, and the exact token-issuance flow **cannot be stated as
> fact** from public sources — they must be dumped from the customer's own Swagger once a token +
> instance are in hand. **Do not present any guessed endpoint below as documented.**

---

## Phase 1 — Information Sources

### 1.1 Primary Documentation

| Item                        | Value                                                                                           | Confidence      |
| --------------------------- | ----------------------------------------------------------------------------------------------- | --------------- |
| Vendor                      | Workbench International Limited — Job Costing & Construction Management ERP (NZ / APAC)         | [DOCUMENTED]    |
| Marketing / product site    | https://www.workbenchcentral.com (also workbenchinternational.com, workbenchsbo.com)            | [DOCUMENTED]    |
| API overview ("Technology") | https://www.workbenchcentral.com/technology — confirms "JSON REST API" + "Swagger"              | [DOCUMENTED]    |
| Integration partners        | https://www.workbenchcentral.com/integrationsolutions (Xero, MYOB, JDE, SAP, Business Central…) | [DOCUMENTED]    |
| Workbench API docs space    | https://webwbdoc.atlassian.net/wiki/spaces/WAPI (Confluence — "Workbench API documentation")    | [DOCUMENTED] 🔬 |
| Xero API docs space         | https://webwbdoc.atlassian.net/wiki/spaces/XEROAPI ("Workbench Online")                         | [DOCUMENTED] 🔬 |
| Module docs (Desktop/Web)   | https://workbenchdoc.atlassian.net/wiki (WBJOBCOSTING, WBTIME, WBPURCHASING, WBPACKSLIP, …)     | [DOCUMENTED]    |
| MYOB/Xero technical export  | webwbdoc … /DOC/pages/2196865063/MYOB+Technical (Workbench → MYOB transaction export)           | [DOCUMENTED] 🔬 |
| Support portal (Freshdesk)  | https://wbi.freshdesk.com/support/login                                                         | [DOCUMENTED]    |
| Per-instance Swagger UI     | `{instance_url}/swagger` (e.g. `https://yourcompany.workbench.com/swagger`) — pattern inferred  | [INFERRED] 🔬   |
| Changelog / release notes   | Product update blogs at workbenchcentral.com/blog (e.g. "2022 Q1/Q2 Product Update")            | [DOCUMENTED]    |
| Status page                 | Not located                                                                                     | [UNKNOWN]       |

### 1.2 Supplementary Sources

| Item                  | Value                                                                                                                   | Confidence                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| OpenAPI / Swagger     | **Exists** ("Swagger is used … metadata and a code generation facility"); raw JSON spec is **per-instance**, not public | [DOCUMENTED] / [INFERRED] 🔬 |
| Postman collection    | None located                                                                                                            | [UNKNOWN]                    |
| Official SDKs (Py/JS) | None located — vendor cites **PowerShell** as a scripting example, REST + Swagger codegen otherwise                     | [DOCUMENTED]                 |
| Community / forum     | Vendor forum referenced on the support page; no public Q&A/Stack Overflow tag found                                     | [DOCUMENTED]                 |

> ⚠️ Many "Workbench" hits in search are unrelated products — **Expel Workbench** (security ops),
> Posit/RStudio Workbench, Salesforce Workbench, Azure Blockchain Workbench, Cloudera DSW, CIS
> WorkBench, Verily Workbench. **None of these are Workbench International ERP.** Ignore their auth
> models (the Expel `/login → 13-hour bearer` flow in particular is a different product and must not
> be copied here).

### 1.3 Documentation Quality Assessment

| Area                      | Rating | Notes                                                                                                                    |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Authentication            | 1      | No public description of how the bearer token is issued/rotated. Registry confirms it's a bearer token, nothing more. 🔬 |
| Endpoint reference        | 1      | Swagger exists but is per-instance; not publicly readable. No endpoint paths confirmed. 🔬                               |
| Request/response examples | 1      | None public                                                                                                              |
| Error documentation       | 1      | None public                                                                                                              |
| Rate limit documentation  | 1      | None public                                                                                                              |
| Pagination documentation  | 1      | None public                                                                                                              |
| Webhook documentation     | 1      | None found — appears polling-only                                                                                        |
| SDKs / code examples      | 2      | PowerShell scripting mentioned; Swagger codegen available against the per-instance spec                                  |
| Changelog / versioning    | 2      | Product-update blogs exist; no API version policy published                                                              |

**Overall documentation quality:** **poor.** Workbench's _existence claims_ are clear and credible
(REST/JSON, Swagger codegen, business-rule-preserving, used for partner integrations like Xero/MYOB),
and the module documentation gives a strong picture of the **domain** (Jobs, Timesheets, Purchasing,
AP/AR, GL, Plant, distribution). But the **API reference itself** — endpoints, fields, pagination,
limits, token issuance — is **gated behind each customer's instance** and could not be enumerated
from public sources. This is the same situation as Total Synergy / PrintIQ / Flowingly: narrative is
adequate, reference requires a live tenant.

### 1.4 Discovery Status

- [x] Found official API _existence_ documentation (vendor "Technology" page + WAPI Confluence space)
- [ ] Found or confirmed no OpenAPI/Swagger spec — Swagger **confirmed to exist**, but per-instance and not public 🔬
- [~] Identified authentication method — **bearer token** (per registry + ERP convention); issuance flow UNKNOWN 🔬
- [ ] Found at least one working example — none public 🔬
- [ ] Identified rate limit information — none public 🔬
- [ ] Identified pagination approach — none public 🔬
- [x] Checked for webhook/event support — none found (assume polling)
- [x] Checked for official SDKs — none; PowerShell + Swagger codegen only

---

## Phase 2 — Authentication (HARD GATE — not satisfied)

> The connector is configured as **`authType: token`** with two credential fields:
> a **`bearer_token`** (password field) and an **`instance_url`** (URL field,
> placeholder `https://yourcompany.workbench.com`). This means: the admin/user pastes a
> pre-issued bearer token plus their tenant's base URL; Numa stores both and sends the token as
> `Authorization: Bearer {token}` against `{instance_url}`. There is **no OAuth flow** in the
> registry — no `authUrl`, `tokenUrl`, or `scopes` — consistent with a static, instance-issued token.

| Item                      | Value                                                                                                                                                                                         | Confidence              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Auth method               | **Bearer token** (static, pre-issued), per the connector registry                                                                                                                             | [DOCUMENTED — registry] |
| Auth location             | HTTP header: `Authorization: Bearer {bearer_token}`                                                                                                                                           | [INFERRED]              |
| Base URL                  | Per-customer **`instance_url`** (e.g. `https://yourcompany.workbench.com`)                                                                                                                    | [DOCUMENTED — registry] |
| API path prefix           | Likely `/api` or `/api/v1` under the instance host (ERP/Swagger convention)                                                                                                                   | [INFERRED] 🔬           |
| How the token is obtained | **UNKNOWN publicly** — most likely generated inside the Workbench instance by an admin/user (API key / personal access token), or issued by Workbench support. Confirm against a live tenant. | [UNKNOWN] 🔬            |
| Token lifetime            | UNKNOWN — could be long-lived/static (no refresh field in registry) or expiring                                                                                                               | [UNKNOWN] 🔬            |
| Refresh mechanism         | None in registry (no refresh token field) → treat as **static**; re-issue manually if it expires                                                                                              | [INFERRED] 🔬           |
| Scopes / permission model | UNKNOWN — likely governed by the issuing **user's Workbench role/permissions**, not OAuth scopes                                                                                              | [INFERRED] 🔬           |
| PKCE / state              | N/A (not OAuth)                                                                                                                                                                               | [DOCUMENTED — registry] |
| Multi-tenant routing      | By **`instance_url`** (each customer is a separate host)                                                                                                                                      | [DOCUMENTED — registry] |
| TLS                       | HTTPS only (instance_url field is typed `url`, placeholder is `https://`)                                                                                                                     | [INFERRED]              |

**Registry credential fields (`connectorRegistry.ts`, `id: 'workbench'`):**

```ts
authType: 'token',
credentialFields: [
  { key: 'bearer_token', label: 'dataConnectors.fields.bearerToken', type: 'password',
    placeholder: 'Paste your Workbench bearer token', required: true },
  { key: 'instance_url', label: 'dataConnectors.fields.instanceUrl', type: 'url',
    placeholder: 'https://yourcompany.workbench.com', required: true },
]
```

**Assumed request shape (🔬 DISCOVER the exact path/prefix):**

```http
GET /api/v1/jobs?pageSize=1 HTTP/1.1
Host: yourcompany.workbench.com
Authorization: Bearer <bearer_token>
Accept: application/json
```

### 2.4 First Successful Call — CRITICAL GATE

- [ ] **GATE CHECK: NOT satisfied.** No bearer token and no customer `instance_url` available; no live call made.

Smoke test to run once a token + instance are available (🔬 DISCOVER the real list endpoint):

```http
GET {instance_url}/api/v1/jobs?pageSize=1 HTTP/1.1
Authorization: Bearer <bearer_token>
Accept: application/json
```

**Gotchas anticipated during setup:**

- The **API path prefix is unconfirmed** (`/api`, `/api/v1`, or a Swagger-defined base). Pull
  `{instance_url}/swagger` first to read the real base path and the exact resource names. 🔬
- The connector takes a free-form `instance_url`; ensure it is **normalised** (scheme present, no
  trailing slash) before composing request URLs. Path-join carefully so `{instance_url}/api/...`
  doesn't double-slash.
- Confirm whether the token is sent as `Authorization: Bearer …` (assumed) or a **custom header** —
  some ERPs use `X-Api-Key` / `apikey`. Verify against the live 401/200 behaviour. 🔬
- Two product lines (cloud **Workbench Online** vs **Workbench SBO** for SAP Business One) may
  expose different surfaces. Confirm which the customer runs before trusting any endpoint list. 🔬

---

## Phase 3 — Domain Model & Behaviour

> Workbench is a **job-costing / project-accounting ERP**. The entities below are **[INFERRED]
> from the published module documentation** (Job Costing, Timesheets, Purchasing, AP/AR, GL, Plant)
> and from how Workbench exports transactions to accounting partners (Xero/MYOB). **Exact API
> resource names, field names, types and casing are NOT public** and must be dumped from the
> instance Swagger. 🔬 DISCOVER. "Distribution" in Workbench = the **cost/GL distribution of a
> transaction across job activities and GL accounts** (the lines that split a cost or invoice into
> job/activity/GL postings, including tax) — i.e. the interface that "Interfaces to General Ledger,
> Accounts Payable, Accounts Receivable."

| Entity                | Likely API resource (🔬 confirm)   | CRUD (likely)         | Notes                                                                                   | Confidence                                        |
| --------------------- | ---------------------------------- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Job                   | `jobs`                             | Read (+ likely write) | Central record — the "job"/project that everything is costed against                    | [DOCUMENTED] (concept) / [INFERRED] (resource) 🔬 |
| Activity Code         | `activities` / `activitycodes`     | Read                  | Cost breakdown within a job; transactions post to a job **+ activity**                  | [DOCUMENTED] (concept) 🔬                         |
| Activity Group        | (sub of Activity)                  | Read                  | Grouping of activity codes (per Setup Guide "Jobs – Activity Codes and Groups")         | [DOCUMENTED] (concept) 🔬                         |
| Cost Centre           | `costcentres`                      | Read                  | Org/financial dimension on postings                                                     | [INFERRED] 🔬                                     |
| Transaction           | `transactions` / `jobtransactions` | Read (+ create)       | The cost/revenue posting against a job/activity; carries **distribution** lines to GL   | [DOCUMENTED] (concept) 🔬                         |
| Distribution (line)   | (sub of Transaction)               | Read                  | The split of a transaction into job/activity/GL/tax lines — the "interface to GL/AP/AR" | [DOCUMENTED] (concept) 🔬                         |
| Timesheet             | `timesheets`                       | Read + create         | Personal/daily time entry → job cost capture (WBTIME module)                            | [DOCUMENTED] (module) 🔬                          |
| Purchase Order        | `purchaseorders`                   | Read + create         | Create POs online, send via email (WBPURCHASING module)                                 | [DOCUMENTED] (module) 🔬                          |
| Creditor / AP invoice | `creditors` / `apinvoices`         | Read (+ create)       | Accounts Payable — supplier invoices distributed to jobs/GL                             | [DOCUMENTED] (concept) 🔬                         |
| Debtor / AR / Claim   | `debtors` / `invoices` / `claims`  | Read (+ create)       | Accounts Receivable — client invoices/claims (progress claims, retentions)              | [DOCUMENTED] (concept) 🔬                         |
| GL Account            | `accounts` / `glaccounts`          | Read                  | Chart of accounts / nominal codes that distribution posts to                            | [INFERRED] 🔬                                     |
| Subcontract           | `subcontracts`                     | Read                  | Subcontract management — scope, claim certification, retentions                         | [DOCUMENTED] (module) 🔬                          |
| Plant / Asset         | `plant` / `assets`                 | Read                  | Plant management — asset detail, costing rates (hrs/kms), depreciation, utilisation     | [DOCUMENTED] (module) 🔬                          |
| Supplier / Contact    | `suppliers` / `contacts`           | Read                  | Address book of suppliers/clients referenced by POs, AP and AR                          | [INFERRED] 🔬                                     |
| Employee / Resource   | `employees` / `resources`          | Read                  | People who log timesheets / are charged out                                             | [INFERRED] 🔬                                     |

> Every "likely API resource" name above is a **placeholder [INFERRED]** from the module/UI naming.
> The Swagger dump is the source of truth for actual resource paths, field names and casing. 🔬

**3.1 — Job (likely fields, [INFERRED] 🔬):**

| Field          | Type          | Required?    | Writable? | Notes                                            |
| -------------- | ------------- | ------------ | --------- | ------------------------------------------------ |
| `id` / `jobNo` | string/int    | —            | no        | Job identifier (human "job number" is key in UI) |
| `name`         | string        | yes (create) | yes       | Job/project description                          |
| `status`       | enum/string   | —            | yes       | e.g. active / on-hold / closed 🔬                |
| `clientId`     | string/int    | —            | yes       | FK → Debtor/Contact                              |
| `manager`      | string        | —            | yes       | Job/project manager                              |
| `budget`       | decimal       | —            | maybe     | Job budget (vs actual/forecast)                  |
| `createdDate`  | string (ISO?) | —            | no        | Date format unconfirmed (see 3.5) 🔬             |

**3.2 — Transaction + Distribution (the costing core, [INFERRED] 🔬):**

| Field           | Type       | Notes                                                  |
| --------------- | ---------- | ------------------------------------------------------ |
| `jobId`/`jobNo` | string/int | The job the cost/revenue posts to                      |
| `activityCode`  | string     | Activity within the job                                |
| `glAccount`     | string     | GL/nominal account the distribution line hits          |
| `amount`        | decimal    | Net amount                                             |
| `taxCode`/`tax` | string/dec | Tax code + amount (GST in NZ/AU)                       |
| `date`          | string     | Transaction date (format 🔬)                           |
| `lines[]`       | array      | **Distribution lines** — the job/activity/GL/tax split |

### 3.2 Entity Relationships (inferred)

```
┌──────────┐  1:N   ┌───────────────┐  1:N   ┌─────────────┐
│   Job    │───────▶│ Activity Code  │──┐     │ Cost Centre │
│ (jobNo)  │        │ (in Groups)    │  │     └─────────────┘
└────┬─────┘        └───────────────┘  │            ▲
     │ N:1                              │            │ dimension on
     ▼                                  │            │
┌──────────┐                           │      ┌──────────────────────────┐
│  Debtor  │◀── client                 └─────▶│ Transaction              │
│ (AR/Claim)│                                 │  └─ Distribution lines ───┼──▶ ┌────────────┐
└──────────┘                                  │     (job/activity/GL/tax) │    │ GL Account │
┌──────────┐  creates AP cost                 └──────────────────────────┘    │ (nominal)  │
│ Creditor │─────────────────────────────────────────▲                        └────────────┘
│ (AP inv) │                                          │ feeds
└──────────┘                          ┌───────────────┴──────────────┐
┌──────────────┐  log time/cost       │ Timesheet · Purchase Order ·  │
│ Employee/    │─────────────────────▶│ Subcontract claim · Plant     │
│ Resource     │                      │ usage                          │
└──────────────┘                      └───────────────────────────────┘
```

### 3.3 State Machines

Job lifecycle (open/active → on-hold → closed/archived) and document lifecycles (PO draft →
approved → received → invoiced; AR claim drafted → certified → invoiced → paid) are **[INFERRED]**
from the construction/job-costing domain. Exact enum values and allowed transitions are
**[UNKNOWN]** — discover from the Swagger spec + live records. 🔬

### 3.4 Business Rules (inferred / documented)

- A **transaction must reference a valid Job + Activity Code** (and a GL account on each
  distribution line). These must exist first. [INFERRED] 🔬
- Workbench **retains its own business rules and validations** on API writes — the vendor
  explicitly states the API enables transfer "while retaining the business rules and validations of
  the Workbench application." So writes can be **rejected by domain rules** even when syntactically
  valid. [DOCUMENTED]
- **Distribution** must balance: a cost/invoice is split across job/activity/GL/tax lines that sum
  to the document total. [INFERRED] 🔬
- Data is **tenant-isolated by `instance_url`** — one token/instance cannot read another customer's
  data. [INFERRED]
- Progress **claims / retentions** (AR) follow construction-contract rules (certified amounts,
  retention %). [DOCUMENTED] (module) 🔬 for API exposure.

### 3.5 Field Format Reference

| Format     | Pattern (assumed) | Example                      | Notes                                             | Confidence              |
| ---------- | ----------------- | ---------------------------- | ------------------------------------------------- | ----------------------- |
| Date       | ISO-8601 string   | `"2026-05-29"`               | JSON APIs typically serialise dates as strings 🔬 | [INFERRED] 🔬           |
| Currency   | decimal number    | `1500.00`                    | On transactions / AP / AR / distribution          | [INFERRED] 🔬           |
| Tax        | code + decimal    | `"GST"`, `225.00`            | NZ/AU GST; codes per tenant config 🔬             | [INFERRED] 🔬           |
| Job no     | string/int        | `"J-10042"`                  | Human-facing job number; PK type unconfirmed 🔬   | [INFERRED] 🔬           |
| GL account | string code       | `"6100"`                     | Nominal/GL code on distribution lines 🔬          | [INFERRED] 🔬           |
| Instance   | HTTPS host        | `https://acme.workbench.com` | Per-customer base URL                             | [DOCUMENTED — registry] |

---

## Phase 4 — Endpoint Catalog

- **Base URL (prod):** per-customer **`instance_url`** (e.g. `https://yourcompany.workbench.com`) [DOCUMENTED — registry]
- **API path prefix:** likely `/api` or `/api/v1` (🔬 confirm from `{instance_url}/swagger`) [INFERRED]
- **Sandbox:** Workbench runs a continually-refreshed **sandbox** internally for its own CI; whether customers get a sandbox host is [UNKNOWN] 🔬
- **Auth header:** `Authorization: Bearer {bearer_token}` (assumed) [INFERRED]
- **Swagger UI:** `{instance_url}/swagger` (pattern inferred — **the single most important thing to pull first**) [INFERRED] 🔬

### 4.1 Critical Endpoints

> ⚠️ **No endpoint path below is publicly documented.** They are **[INFERRED]** placeholders using
> REST + ERP-module conventions, to be replaced verbatim from the instance Swagger. **Do not ship
> these as fact.** 🔬 DISCOVER all of Phase 4 from `{instance_url}/swagger`.

#### GET `/api/v1/jobs` — list/search jobs [INFERRED path] 🔬

```http
GET /api/v1/jobs?pageSize=50 HTTP/1.1
Host: yourcompany.workbench.com
Authorization: Bearer <bearer_token>
Accept: application/json
```

**Assumed success response (shape + fields all 🔬 DISCOVER):**

```json
{
  "items": [
    { "id": "10042", "jobNo": "J-10042", "name": "Riverside Bridge Upgrade", "status": "Active", "clientId": "551" }
  ],
  "totalCount": 312,
  "page": 1,
  "pageSize": 50
}
```

#### GET `/api/v1/jobs/{id}` — get one job [INFERRED] 🔬

#### GET `/api/v1/jobs/{id}/transactions` — job cost transactions (with distribution) [INFERRED] 🔬

#### GET `/api/v1/transactions` — list/search transactions [INFERRED] 🔬

#### POST `/api/v1/timesheets` — create a timesheet entry against a job/activity [INFERRED] 🔬

#### GET `/api/v1/purchaseorders` / POST (create PO) [INFERRED] 🔬

#### GET `/api/v1/creditors` (AP) · GET `/api/v1/debtors` / `/invoices` (AR) [INFERRED] 🔬

#### GET `/api/v1/plant` — plant/assets [INFERRED] 🔬

### 4.2 Full Endpoint Index

| Method   | Path (under `{instance_url}`)    | Purpose                           | Auth? | Pagination? | Confidence    |
| -------- | -------------------------------- | --------------------------------- | ----- | ----------- | ------------- |
| GET      | `/swagger` (+ swagger JSON)      | **Self-describing API spec**      | maybe | n/a         | [INFERRED] 🔬 |
| GET      | `/api/v1/jobs`                   | List/search jobs                  | yes   | likely      | [INFERRED] 🔬 |
| GET      | `/api/v1/jobs/{id}`              | Get one job                       | yes   | n/a         | [INFERRED] 🔬 |
| GET      | `/api/v1/jobs/{id}/transactions` | Job transactions + distribution   | yes   | likely      | [INFERRED] 🔬 |
| GET      | `/api/v1/transactions`           | List transactions                 | yes   | likely      | [INFERRED] 🔬 |
| POST     | `/api/v1/transactions`           | Create transaction (cost/revenue) | yes   | n/a         | [INFERRED] 🔬 |
| GET/POST | `/api/v1/timesheets`             | Read/create timesheets            | yes   | likely      | [INFERRED] 🔬 |
| GET/POST | `/api/v1/purchaseorders`         | Read/create purchase orders       | yes   | likely      | [INFERRED] 🔬 |
| GET      | `/api/v1/creditors`              | AP / supplier invoices            | yes   | likely      | [INFERRED] 🔬 |
| GET      | `/api/v1/debtors` / `/invoices`  | AR / client invoices / claims     | yes   | likely      | [INFERRED] 🔬 |
| GET      | `/api/v1/accounts`               | GL / chart of accounts            | yes   | likely      | [INFERRED] 🔬 |
| GET      | `/api/v1/plant`                  | Plant / assets                    | yes   | likely      | [INFERRED] 🔬 |

> **🔬 DISCOVER:** the complete, authoritative endpoint list is the Swagger document served at the
> instance. This table is an _inferred starting hypothesis_, not the catalog.

---

## Phase 5 — Query & Filter Capabilities

| Capability                | Supported? | Syntax (assumed)             | Confidence    |
| ------------------------- | ---------- | ---------------------------- | ------------- |
| Filter by id              | Likely     | `/{resource}/{id}` or `?id=` | [INFERRED] 🔬 |
| Filter by job             | Likely     | `?jobNo=` / `?jobId=`        | [INFERRED] 🔬 |
| Filter by date range      | Likely     | `?fromDate=&toDate=` 🔬      | [INFERRED] 🔬 |
| Filter by status          | Likely     | `?status=`                   | [INFERRED] 🔬 |
| Full-text search          | Unknown    | 🔬                           | [UNKNOWN]     |
| Sort by field / direction | Unknown    | 🔬                           | [UNKNOWN]     |
| Field selection / sparse  | Unknown    | 🔬                           | [UNKNOWN]     |
| Include related records   | Unknown    | (e.g. job → transactions) 🔬 | [UNKNOWN]     |
| Page size                 | Likely     | `?pageSize=` / `?limit=` 🔬  | [INFERRED] 🔬 |

**General filter pattern (entirely [INFERRED] — confirm against Swagger):**

```
GET {instance_url}/api/v1/{resource}?jobNo=J-10042&fromDate=2026-01-01&pageSize=200
```

> **🔬 DISCOVER:** the real query-parameter family (filter names, date params, sort syntax,
> include/expand) from the Swagger spec — this is a major gap.

### 5.6 Common Query Patterns

**Pattern 1 — get one job by number:** `GET {instance_url}/api/v1/jobs?jobNo=J-10042` 🔬
**Pattern 2 — page through transactions for a job:** `GET {instance_url}/api/v1/jobs/10042/transactions?pageSize=200&page=1` 🔬

---

## Phase 6 — Pagination & Bulk

| Item                | Value                                                                | Confidence    |
| ------------------- | -------------------------------------------------------------------- | ------------- |
| Pagination model    | **UNKNOWN** — likely page/offset (`page` + `pageSize`) by convention | [INFERRED] 🔬 |
| Default page size   | UNKNOWN — always send an explicit page size                          | [UNKNOWN] 🔬  |
| Max page size       | UNKNOWN                                                              | [UNKNOWN] 🔬  |
| Total count         | Likely a `totalCount`/`total` field in the envelope                  | [INFERRED] 🔬 |
| Items array         | Likely `items[]` / `data[]`                                          | [INFERRED] 🔬 |
| Last-page detection | `(page * pageSize) >= total`, or short/empty page                    | [INFERRED] 🔬 |

**Assumed envelope (🔬 DISCOVER actual shape):**

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

**Bulk operations:** None documented publicly. Assume one-at-a-time writes through the
business-rule-validated API. [UNKNOWN] 🔬

> **🔬 DISCOVER:** pagination type, param names, default/max page size, total-count field, and
> whether any batch/bulk endpoints exist — all from the Swagger spec + live calls.

---

## Phase 7 — Real-Time & Events

| Mechanism   | Supported? | Notes                                                          | Confidence    |
| ----------- | ---------- | -------------------------------------------------------------- | ------------- |
| Webhooks    | No (found) | None in public material; partner syncs appear poll/batch-based | [INFERRED] 🔬 |
| WebSocket   | No         | —                                                              | [INFERRED]    |
| SSE         | No         | —                                                              | [INFERRED]    |
| Change feed | Unknown    | A "modified since" filter may exist; unconfirmed               | [UNKNOWN] 🔬  |

**Polling fallback:** Assume **polling-only**. Poll list endpoints and diff on a date/modified
field (🔬 DISCOVER which field reliably exposes "modified since"). Keep polling low-frequency until
rate limits are known. [INFERRED] 🔬

---

## Phase 8 — Operational Concerns

### 8.1 Rate Limits

| Scope | Limit   | Window | Confidence   |
| ----- | ------- | ------ | ------------ |
| Any   | UNKNOWN | —      | [UNKNOWN] 🔬 |

- **No public rate-limit documentation.** Limits (if any) are likely per-instance and may be
  configurable by the customer/host. **🔬 DISCOVER** by inspecting response headers
  (`X-RateLimit-*`, `Retry-After`) and triggering throttling on a live tenant. Until then, be
  conservative: cache reads, avoid tight loops.

### 8.2 Error Handling

| HTTP Status | Meaning                              | Retryable? | Recovery                                                       | Confidence    |
| ----------- | ------------------------------------ | ---------- | -------------------------------------------------------------- | ------------- |
| 200         | OK (JSON body)                       | —          | —                                                              | [INFERRED]    |
| 400/422     | Validation / business-rule rejection | No         | Fix payload; Workbench enforces its own validations            | [INFERRED] 🔬 |
| 401         | Unauthorized                         | Yes        | Re-issue/replace the bearer token; check header + instance_url | [INFERRED]    |
| 403         | Forbidden                            | No         | Token's Workbench role lacks permission                        | [INFERRED] 🔬 |
| 404         | Not found                            | No         | Verify resource path / id / instance_url                       | [INFERRED]    |
| 429         | Rate limit (if any)                  | Yes        | Backoff + retry                                                | [UNKNOWN] 🔬  |
| 500         | Server error                         | Yes        | Retry with backoff                                             | [INFERRED]    |

- **Error body schema is NOT published.** Do not fabricate it — discover the real shape (code /
  message / field-level details) by triggering errors (bad token, bad id, invalid distribution). 🔬
- Because Workbench "retains business rules and validations," expect **domain-specific 400/422
  errors** on writes (e.g. unbalanced distribution, closed job, invalid activity). 🔬

### 8.3 Idempotency

- GET is naturally idempotent. **POST (transactions, timesheets, POs, invoices) idempotency is
  UNKNOWN** — no documented idempotency-key header. Treat writes as non-idempotent: track created
  ids client-side before retrying to avoid duplicate financial postings. [INFERRED] 🔬

### 8.5 File Handling

- Workbench has **Document Management** and **Packing Slips** modules, and POs can be emailed — so
  some document/attachment surface may exist. Whether it is exposed via the API (upload/download of
  attachments, invoice/claim PDFs) is **[UNKNOWN]** 🔬. This is a data/ERP API, not a file store.

---

## Phase 9 — Platform Integration Assessment

### 9.1 Integration Path Decision

| Path                   | Fits? | Notes                                                                                                     |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| Data Connector (Files) | No    | Not a file/document browser — no folder/file tree to surface in Files Remote                              |
| Data Connector         | No    | No file-like browsable content as the primary surface                                                     |
| **Direct API Only**    | ✅    | Action/data-oriented ERP: jobs, transactions, financials (AP/AR/GL), distribution, POs, timesheets, plant |
| Hybrid                 | No    | No meaningful file surface to pair with the API                                                           |

**Selected integration path:** **Direct API (spec-driven, chat-only) via `connect_request`.** [DECISION]

**Justification:** Workbench International exposes **structured ERP data** (jobs, cost transactions
and their GL **distribution**, AP/creditors, AR/debtors/claims, purchase orders, timesheets, plant)
— not browsable files/folders — so it is **not** a Files-Remote connector. It mirrors the
Total Synergy / Actionstep / NetSuite / Zoho pattern: a **token (bearer)** connector whose API specs
live in `ext-api-doc/workbench/` and are read by the workspace agent, which calls the API through
the existing **`connect_request`** path using the stored `bearer_token` + `instance_url`. **No
`lib/oauth-providers/` provider class** is needed (that layer is for OAuth file-browsing connectors).
`surfaces: ['chat']`.

> ⚠️ **Viability caveat:** unlike Total Synergy, even the **endpoint catalog and field schemas are
> unconfirmed** here. The connector can authenticate (paste token + instance), but the spec docs
> (`01-*`, `02-*`) cannot be written to a high confidence **until the instance Swagger is dumped**.
> The very first build step must be: with a customer token + `instance_url`, GET
> `{instance_url}/swagger` and backfill Phases 2–6 verbatim.

### 9.3 Workspace Agent Capabilities

**CAN do (in scope, once Swagger is confirmed):**

1. List / search **Jobs**, **Transactions**, **Purchase Orders**, **Creditors (AP)**, **Debtors/AR**,
   **Plant** (read), filtered by job / date / status.
2. Read a job's **cost transactions and their distribution** to activities/GL — answer "what has
   been spent on job X, by activity / GL account?" type questions.
3. (Write, gated) **create timesheets / purchase orders / transactions** through the
   business-rule-validated API — only if the customer enables writes and after HITL confirmation.

**CANNOT do (out of scope / dangerous):**

1. Cross-tenant queries — every call is scoped to one `instance_url`.
2. Blind retries of financial POSTs — no known idempotency key; risks duplicate
   timesheets/invoices/transactions and corrupts job costs.
3. High-frequency polling/bulk sync — rate limits are unknown; stay conservative until measured.

**Default parameters:**

| Parameter   | Default                   | Reason                                               |
| ----------- | ------------------------- | ---------------------------------------------------- |
| `pageSize`  | 200 (read)                | Reasonable batch while limits are unknown 🔬         |
| Auth header | `Authorization: Bearer`   | Per registry (bearer token) — confirm header name 🔬 |
| Base URL    | the stored `instance_url` | Per-tenant routing is mandatory                      |
| Writes      | **off by default**        | Workbench writes are real financial postings         |

### 9.4 SDK Assessment

No official client SDKs located. Vendor cites **PowerShell** scripting and **Swagger codegen**
against the per-instance spec — i.e. generate a client from `{instance_url}/swagger` if needed.
[DOCUMENTED] / [UNKNOWN for packaged SDKs]

---

## Phase 10 — Generation Instructions

### 10.1 Readiness Checklist

- [x] Phase 1 — sources identified, quality assessed (reference is per-instance / Confluence-gated)
- [ ] **Phase 2 — first successful live call: NOT DONE (no token / instance_url)** 🔬🚩
- [~] Phase 2 — auth method known (bearer token + instance_url, per registry); **issuance flow UNKNOWN** 🔬
- [~] Phase 3 — domain catalogued from module docs; **API resource & field names INFERRED**, need Swagger 🔬
- [ ] Phase 4 — **no endpoint confirmed**; inferred hypothesis only — needs Swagger enumeration 🔬
- [ ] Phase 5 — query/filter family unknown 🔬
- [ ] Phase 6 — pagination model unknown 🔬
- [x] Phase 7 — event support assessed (assume none / polling)
- [ ] Phase 8 — rate limits + error-body schema unknown 🔬
- [x] Phase 9 — integration path selected + justified (Direct API via connect_request, token auth)

**Overall investigation confidence:** **low.** The _product, domain, and integration shape_ are
well-established (a real NZ/APAC job-costing ERP with a JSON REST API + Swagger + bearer token +
per-customer instance, and a published module model that defines jobs / transactions / distribution
/ AP / AR / GL / POs / timesheets / plant). But the _API specifics_ — endpoints, field schemas,
pagination, rate limits, token issuance, error format — are **gated behind each customer's instance
Swagger** and could not be verified publicly. This is a **discovery-first** connector.

**Known gaps that will reduce output quality:**

1. **No live token / `instance_url`** — Phase 2 gate unmet; nothing CONFIRMED. 🔬🚩
2. **Per-instance Swagger not dumped** — endpoint paths, field schemas, enums all INFERRED. 🔬
3. **Token issuance/rotation flow** (how the bearer token is generated) is UNKNOWN. 🔬
4. **Pagination, rate limits, error-body schema** all UNKNOWN. 🔬
5. **Which product line** (Workbench Online cloud vs Workbench SBO for SAP B1) the customer runs — may change the API surface. 🔬

### 10.3 Confidence Report

| Output Document              | Can Generate? | Confidence | Gaps                                                                                      |
| ---------------------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------- |
| 01-llm-api-rules             | Partial       | Low        | Auth shape + domain known; endpoints/errors inferred — needs Swagger                      |
| 01a-domain-model-reference   | Partial       | Low-Med    | Entities/relationships solid from module docs; fields inferred                            |
| 01b-query-patterns           | No / Partial  | Low        | Filter + pagination family unknown until Swagger dumped                                   |
| 01c-mutation-patterns        | No / Partial  | Low        | Write payloads (transaction/distribution) inferred only                                   |
| 01d-event-and-error-handling | Partial       | Low        | No webhooks (assumed); error body + rate limits unknown                                   |
| 02-api-spec-investigation    | Partial       | Low        | Documented subset only until Swagger is enumerated                                        |
| 03-connector-setup           | Yes           | Medium     | Path + auth decided (token: bearer_token + instance_url); discovery caveat must be stated |

---

## Appendix — Discovery Playbook (what to run with a live token + instance)

1. From the customer, obtain a **`bearer_token`** and their **`instance_url`** (and confirm whether
   they run **Workbench Online** or **Workbench SBO**).
2. **Pull the Swagger spec first:** open `{instance_url}/swagger` (and fetch the raw OpenAPI JSON,
   e.g. `{instance_url}/swagger/v1/swagger.json` — exact path 🔬). This single step resolves Phases
   2.3 (path prefix), 3 (resources/fields), 4 (endpoint catalog), 5 (query params), 6 (pagination).
3. **Smoke test the gate:** `GET {instance_url}/api/.../jobs?pageSize=1` with
   `Authorization: Bearer <token>` → 200 satisfies Phase 2.
4. Confirm the **auth header** (Bearer vs a custom `X-Api-Key`/`apikey`) by toggling it and watching
   for 401 vs 200.
5. Enumerate the **distribution** model on a real transaction (job/activity/GL/tax line shape) — it
   is the heart of Workbench's "interface to GL/AP/AR".
6. **Trigger errors** (bad token, bad id, unbalanced distribution, closed job) to capture the real
   error-body schema and any rate-limit response (status, `Retry-After`, `X-RateLimit-*`).
7. Establish **token lifetime / rotation** (is it static, or does it expire? is there a re-issue UI?).
8. Backfill every `[INFERRED]`/`[UNKNOWN]` above with `[CONFIRMED]` values from the live spec/calls.
