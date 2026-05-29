---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
vendor: 'Xero Limited (WorkflowMax product, rebuilt as "WorkflowMax 2" / app.workflowmax2.com)'
website: 'https://www.workflowmax.com'
investigation_started: '2026-05-29'
investigator: 'Claude Code (numa-connectors research subagent)'
investigation_status: 'in-progress' # not-started | in-progress | blocked | complete
documentation_quality: 'adequate' # excellent | good | adequate | poor | nonexistent
api_types: [REST] # REST | GraphQL | SOAP | gRPC | WebSocket | SSE
overall_confidence: 'medium' # high | medium | low
blockers:
  - 'No live OAuth2 credentials — could not make a first authenticated call (Phase 2 GATE not passed)'
  - 'Two coexisting API generations (legacy XML *.api/* endpoints vs new v2 UUID/JSON REST) — must confirm which the workflowmax2.com OAuth2 tier actually serves'
  - 'Official docs at api-docs.workflowmax.com and support.workflowmax.com return 403 to automated fetch; details gathered from search snippets, the XeroAPI Postman repo, Airbyte, synchub data model, and community SDKs'
---

# API Investigation Questionnaire: WorkflowMax (by Xero)

> This questionnaire drives the entire API integration package generation process.
> Fill it out thoroughly — every downstream document is generated from the answers here.
>
> **Reading note for reviewers:** WorkflowMax has TWO product/API generations that are easy to conflate. This document is scoped to the **new WorkflowMax 2** product (`app.workflowmax2.com`) which authenticates via **`oauth.workflowmax2.com`** — exactly matching our connector registry entry. The original WorkflowMax (apiKey + accountKey query params, `api.workflowmax.com`) was retired in June 2024 and is **not** what we are building. Where the modern API still reuses legacy XML resource shapes, that is called out explicitly.
>
> **Confidence markers** — tag every answer:
>
> - `[CONFIRMED]` — Verified by testing against live API
> - `[DOCUMENTED]` — Stated in official documentation
> - `[INFERRED]` — Deduced from examples, SDKs, or behavior
> - `[UNKNOWN]` — Could not determine; note what was tried

---

## Phase 1: Information Sources

> **Why:** Establishes the research foundation.

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL (modern v2):** `https://api-docs.workflowmax.com/` (and `/v2`, `/job`, `/overview`) — [DOCUMENTED] (returns 403 to automated fetch; indexed via search)
- **API reference / endpoint catalog URL:** `https://api-docs.workflowmax.com/api-runner/workflowmax/workflowmax-api-v2` (interactive API Explorer) — [DOCUMENTED]
- **Authentication guide URL:** `https://support.workflowmax.com/hc/en-us/articles/28754786654233-API-authentication` — [DOCUMENTED]
- **API support hub:** `https://support.workflowmax.com/hc/en-us/sections/24554424390937-API` — [DOCUMENTED]
- **Changelog / release notes URL:** `https://api-docs.workflowmax.com/changelog/workflowmax/workflowmax-api-v2` and `https://www.workflowmax.com/api/v3/api-changes` — [DOCUMENTED]
- **Legacy XeroAPI overview (still useful for entity shapes):** `https://developer.xero.com/documentation/api/workflowmax/overview-workflowmax` — [DOCUMENTED] (403 to automated fetch)
- **Status page URL:** Not separately published for WorkflowMax; service status rolls up under Xero — [UNKNOWN]

> **Discovery tip:** The modern docs site (`api-docs.workflowmax.com`) is a Bump.sh-style portal and OpenAPI 3.0.3 is advertised — request the spec via the API Explorer once you have credentials.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** Advertised as OpenAPI 3.0.3 (per FindAPIs listing) and exposed through the API Explorer; legacy v1 spec mirrored at `https://app.swaggerhub.com/apis-docs/WorkflowMax-BlueRock/WorkflowMax-BlueRock-OpenAPI3/0.1` — [DOCUMENTED]
- **Postman collection (OFFICIAL — most valuable):** `https://github.com/XeroAPI/workflowmax-postman-oauth2` and the public Postman workspace `https://www.postman.com/xeroapi/xeroapi/collection/miwik51/workflowmax-oauth-2-0` — [DOCUMENTED]
- **Official .NET Core OAuth2 sample:** `https://github.com/XeroAPI/workflowmax-dotnetcore-oauth2-sample` (uses the WorkflowMax **v3** API + OAuth2) — [DOCUMENTED]
- **Official SDK repositories:**
  - Python: No official SDK. Community sync tooling (Airbyte source connector) exists — [DOCUMENTED]
  - Node.js: Community wrapper `https://github.com/indemandly/workflowmax` (legacy apiKey/accountKey XML model) — [DOCUMENTED]
  - Other: Airbyte source connector `https://docs.airbyte.com/integrations/sources/workflowmax` (OAuth2, 16 streams) — [DOCUMENTED]
- **Third-party data model reference:** `https://www.synchub.io/connectors/workflowmax/datamodel` — [DOCUMENTED] (good for entity/field discovery)
- **Community forums:** Xero Developer community (`community.xero.com/developer`), historical `developer.xero.com/community-forum-archive` — [DOCUMENTED]

> **Discovery tip:** The official XeroAPI Postman collection is the single best artifact — it contains the real auth flow (`Connections` call) and example resource calls. Import it and run against a trial org.

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                                         |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Authentication            | 4      | Modern OAuth2 flow is clearly written in the support article + Postman repo. [DOCUMENTED]                     |
| Endpoint reference        | 3      | New v2 docs portal exists but is gated; legacy method pages (workflowmax.com/api/v3/\*) now 404/redirect.     |
| Request/response examples | 2      | Hard to retrieve without auth; XML envelope shape known, modern JSON shapes only partially inferred.          |
| Error documentation       | 2      | Legacy `<Response><Status>Error</Status><ErrorDescription>` shape known; modern HTTP/JSON errors uncertain.   |
| Rate limit documentation  | 2      | A "Rate Limiting" section exists in the v2 docs nav but exact numbers not publicly captured. [UNKNOWN]        |
| Pagination documentation  | 3      | `page` + `pagesize` (legacy) and `detailed` flag documented in community SDKs/snippets. [DOCUMENTED/INFERRED] |
| Webhook documentation     | 1      | No evidence of webhooks. [INFERRED — none]                                                                    |
| SDKs / code examples      | 3      | Official .NET sample + Postman; no first-party Python/Node SDK.                                               |
| Changelog / versioning    | 3      | Changelog page exists for v2.                                                                                 |

**Overall documentation quality:** adequate — the auth story is solid, but the modern endpoint/field reference is behind a 403 wall and the legacy method pages have been taken down, leaving a gap that only live testing can close.

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (modern v2 portal + auth support article)
- [x] Found or confirmed an OpenAPI/Swagger spec is advertised (OpenAPI 3.0.3) — not retrieved without auth
- [x] Identified authentication method (OAuth2 authorization_code + refresh, `account_id` header)
- [ ] Found at least one working example **from a live call** (no credentials — GATE not passed)
- [ ] Identified rate limit numbers (section exists, values [UNKNOWN])
- [x] Identified pagination approach (`page`/`pagesize`, `detailed`)
- [x] Checked for webhook/event support (none found)
- [x] Checked for official SDKs (.NET sample + Postman; no Python/Node first-party)

---

## Phase 2: API Fundamentals

> **Why:** Without clear auth and a working first call, nothing else matters.

### 2.1 API Identity [REQUIRED]

- **API name:** WorkflowMax API (modern "WorkflowMax 2" generation, OAuth2-secured)
- **Vendor / company:** Xero Limited (WorkflowMax product line; the rebuilt product is sometimes branded "WorkflowMax by BlueRock" in older spec artifacts)
- **Current API version:** v2 is the current modern generation on `api-docs.workflowmax.com`; legacy resource methods were versioned v1/v3 under the old `*.api/*` scheme — [DOCUMENTED]
- **Base URL(s):**
  - Production (modern, OAuth2): `https://api.workflowmax2.com/` — [INFERRED] (parallels the `oauth.workflowmax2.com` auth host in our registry; **must be confirmed** against the Postman collection, which is the authority)
  - Production (legacy/compat resource paths reused by the OAuth2 tier): historically `https://api.workflowmax.com/{resource}.api/{action}` — [DOCUMENTED for legacy; reuse-under-OAuth2 is INFERRED]
  - Sandbox / testing: No dedicated sandbox host — use a free WorkflowMax **trial org** with hand-entered test data — [INFERRED]
- **API type:** REST — [DOCUMENTED]

> **CRITICAL OPEN QUESTION:** The single most important thing to confirm on the first live call is the **exact production base host** for the OAuth2 tier (`api.workflowmax2.com` vs `api.workflowmax.com`) and **whether responses are XML or JSON** (see 2.2). Both are resolvable in five minutes with the official Postman collection + a trial org.

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTP/1.1 over TLS — [INFERRED]
- **Data format:** **Dual / version-dependent.** The legacy resource API is REST-**XML** (responses wrapped in `<Response><Status>OK</Status>…`). The modern OAuth2 tier accepts `Accept: application/json` and the Airbyte connector treats it as JSON. **Most likely the same resource endpoints can return either XML or JSON via the `Accept` header — confirm.** — [DOCUMENTED that XML is the legacy default; JSON support INFERRED from `Accept: application/json` usage in the auth docs + Airbyte]
- **Content-Type header(s):** `application/json` (modern) or `application/xml` / `text/xml` (legacy/writes) — [INFERRED]
- **Character encoding:** UTF-8 — [INFERRED]
- **URL structure pattern:**

```
Legacy (XML, reused under OAuth2):   https://{base}/{resource}.api/{action}[?params]
  e.g.  GET https://{base}/job.api/list?page=1&pagesize=100

Modern v2 (JSON, UUID-addressed):    https://{base}/{resource}/{UUID}
  e.g.  GET https://{base}/job/{jobUUID}
```

[DOCUMENTED for legacy shape; modern v2 UUID shape DOCUMENTED from api-docs.workflowmax.com/v2 object URLs]

- **Versioning strategy:** Path/host segmentation between generations; no per-request version header observed — [INFERRED]
- **CORS policy:** Not designed for browser-direct calls — irrelevant for Numa (we call server-side via the proxy) — [INFERRED]
- **Required headers (all requests):**

| Header          | Value                                   | Purpose                                                                           |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `Authorization` | `Bearer {access_token}`                 | OAuth2 bearer token [DOCUMENTED]                                                  |
| `account_id`    | `{org_uuid}`                            | Identifies which WorkflowMax org the call targets (decoded from JWT) [DOCUMENTED] |
| `Accept`        | `application/json`                      | Request JSON (omit/`application/xml` for legacy XML) [DOCUMENTED]                 |
| `Content-Type`  | `application/json` or `application/xml` | For POST/PUT bodies [INFERRED]                                                    |

### 2.3 Authentication [REQUIRED]

> **This is the single most important section.** Verified against our connector registry entry below.

- **Auth method:** OAuth 2.0 — [DOCUMENTED]
- **Auth location:** Header (`Authorization: Bearer …`) plus the `account_id` header — [DOCUMENTED]
- **Auth header format:**

```
Authorization: Bearer {access_token}
account_id: {org_uuid}
Accept: application/json
```

**For OAuth 2.0:**

- **Grant type(s) supported:** `authorization_code` + `refresh_token` — [DOCUMENTED]
- **Authorization URL:** `https://oauth.workflowmax2.com/oauth/authorize` — [DOCUMENTED — matches connector registry `oauth.authUrl`]
- **Token URL:** `https://oauth.workflowmax2.com/oauth/token` — [DOCUMENTED — matches connector registry `oauth.tokenUrl`]
- **Revocation URL:** Not documented — [UNKNOWN]
- **Required scopes:**

| Scope            | Purpose                       | Required?                                   |
| ---------------- | ----------------------------- | ------------------------------------------- |
| `openid`         | OpenID Connect identity       | Yes (in registry scope string)              |
| `profile`        | Basic profile claims          | Yes (in registry scope string)              |
| `email`          | Email claim                   | Yes (in registry scope string)              |
| `workflowmax`    | Access to the WorkflowMax API | **Yes — the functional scope** [DOCUMENTED] |
| `offline_access` | Issue a refresh token         | Strongly recommended — **see gap note**     |

> **Connector registry scope string is exactly:** `openid profile email workflowmax` ([CONFIRMED — read from `connectorRegistry.ts`]).
>
> **⚠️ GAP / RECOMMENDATION:** The registry scope string **omits `offline_access`**. Vendor docs are explicit that a refresh token is only issued when `offline_access` is requested, and that **access tokens are short-lived (~12–30 min)**. Without `offline_access` the connector will need a full re-consent every few minutes. Recommend adding `offline_access` to the registry scopes before go-live. — [DOCUMENTED that offline_access governs refresh tokens; the registry omission is CONFIRMED from source.]

- **Token lifetime:** Access token ~**12 minutes** per the XeroAPI Postman README; one community source cites ~30 minutes. Treat as **short-lived (≤30 min)** and refresh aggressively. — [DOCUMENTED — conflicting figures, both short]
- **Refresh token behavior:** Manual refresh via the token endpoint with `grant_type=refresh_token` (requires `offline_access` to have been granted). Refresh token rotation behavior (whether a new refresh token is returned each time, à la Xero) — [INFERRED likely, given the shared Xero identity platform; confirm.]
- **PKCE required?** Not required for confidential web apps (we hold a client secret). — [INFERRED]
- **State parameter required?** Recommended (CSRF). Registry sets `extraAuthParams = {"prompt":"consent"}` ([CONFIRMED from source]); `prompt=consent` forces the consent screen so the org is (re)selected and a refresh token is reliably issued. — [DOCUMENTED]
- **Redirect URI restrictions:** Must be HTTPS and pre-registered in the Xero/WorkflowMax developer app. — [DOCUMENTED]

**Obtaining the `account_id` (Org ID) — critical flow detail:**

1. Complete `authorization_code` exchange (parameters in the **body**, form-encoded — not headers).
2. The returned `access_token` is a **JWT**; decode it to read the authenticated org's **Org ID**.
3. Pass that Org ID as the **`account_id` request header** on every subsequent API call.

[DOCUMENTED] If the JWT contains no Org ID, the token exchange was done incorrectly (params sent as headers instead of body). The user must also have **"Authorise 3rd Party Full Access"** enabled on their WorkflowMax staff record, or the API will reject calls. — [DOCUMENTED]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

> **This is a hard gate.** Not passed — no live credentials available in this research pass.

**Planned first call (to run once credentials exist):**

```http
GET /staff.api/list HTTP/1.1
Host: {confirm: api.workflowmax2.com}
Authorization: Bearer {access_token}
account_id: {org_uuid}
Accept: application/json
```

**Expected response (legacy XML envelope shown; JSON equivalent expected with `Accept: application/json`):**

```xml
<Response>
  <Status>OK</Status>
  <StaffList>
    <Staff>
      <UUID>0d6d8234-...-9f1a</UUID>
      <Name>Jane Smith</Name>
      <Email>jane@example.co.nz</Email>
    </Staff>
  </StaffList>
</Response>
```

- **HTTP status code:** Expected 200 — [INFERRED]
- **Time to first successful call:** N/A — not yet attempted
- **Gotchas anticipated during setup:** (1) confirming `api.workflowmax2.com` vs `api.workflowmax.com`; (2) remembering the `account_id` header (calls 401/403 without it); (3) `offline_access` missing from registry scopes; (4) staff record must have 3rd-party full access enabled.

- [ ] **GATE CHECK: First successful API call completed and documented above** — **NOT PASSED.** Needs a trial org + registered app credentials.

---

## Phase 3: Domain Model & Behavior

> **Why:** The entity model is what makes the workspace-agent prompt actually useful. Entities/fields below are drawn from the synchub data model, the Airbyte stream list, and legacy WorkflowMax XML schemas. Field-level details are [INFERRED] until confirmed against a live call.

### 3.1 Core Entities [REQUIRED]

#### Entity: Job

- **API resource name / endpoint path:** legacy `job.api/*` (`list`, `current`, `get`, `add`, `update`); modern `/job/{UUID}` — [DOCUMENTED]
- **Description:** The central work container — a piece of client work with tasks, time, costs, budget and a lifecycle state.
- **CRUD support:** Create / Read / Update (Delete not exposed via the documented surface; jobs are completed/cancelled, not hard-deleted) — [INFERRED]

**Fields:**

| Field               | Type        | Required? | Writable? | Description                     | Example Value       |
| ------------------- | ----------- | --------- | --------- | ------------------------------- | ------------------- |
| `UUID`              | string/uuid | n/a       | No        | Stable job identifier           | `e3b0c442-...-1a2b` |
| `ID`                | string      | n/a       | No        | Human job number                | `J000123`           |
| `Name`              | string      | Yes       | Yes       | Job name                        | `Website Redesign`  |
| `Description`       | string      | No        | Yes       | Job description                 | `Phase 1 discovery` |
| `ClientUUID`        | uuid        | Yes       | Yes       | Owning client                   | `a1b2...`           |
| `State`             | enum        | n/a       | partial   | Lifecycle state (see 3.3)       | `In Progress`       |
| `StartDate`         | date        | No        | Yes       | Job start                       | `2026-05-01`        |
| `DueDate`           | date        | No        | Yes       | Job due date                    | `2026-06-30`        |
| `Budget`            | decimal     | No        | Yes       | Job budget                      | `12000.00`          |
| `ManagerUUID`       | uuid        | No        | Yes       | Job manager (staff)             | `c3d4...`           |
| `PartnerUUID`       | uuid        | No        | Yes       | Partner/owner (staff)           | `d5e6...`           |
| `ApprovedQuoteUUID` | uuid        | No        | No        | Quote this job was created from | `f7a8...`           |

[INFERRED from synchub `JobDetails` + legacy XML; confirm field casing/availability via live GET.]

**Relationships:**

| Related Entity | Relationship Type | How Expressed                     | Notes                         |
| -------------- | ----------------- | --------------------------------- | ----------------------------- |
| Client         | many-to-one       | `ClientUUID`                      | Every job belongs to a client |
| JobTask        | one-to-many       | sub-resource                      | Tasks within a job            |
| Time           | one-to-many       | `JobID`/`JobUUID` on time entries | Time logged against the job   |
| JobCost        | one-to-many       | `JobID`                           | Costs/disbursements           |
| Staff          | many-to-many      | JobAssignee link                  | Assigned staff                |
| Invoice        | one-to-many       | invoice references job            | Invoices raised for the job   |

#### Entity: Client (ClientDetails)

- **API resource name / endpoint path:** legacy `client.api/*` (`list`, `get`, `add`, `update`, `archive`, `delete`, plus contact mgmt); modern `/client/{UUID}` — [DOCUMENTED]
- **Description:** A customer organisation/person you do work for.
- **CRUD support:** Create / Read / Update / Archive / Delete — [DOCUMENTED from community Node SDK method set]

**Fields:**

| Field                                 | Type   | Required? | Writable? | Description             | Example Value         |
| ------------------------------------- | ------ | --------- | --------- | ----------------------- | --------------------- |
| `UUID` / `RemoteID`                   | uuid   | n/a       | No        | Client identifier       | `a1b2...`             |
| `Name`                                | string | Yes       | Yes       | Client name             | `Acme Ltd`            |
| `Email`                               | string | No        | Yes       | Primary email           | `accounts@acme.co.nz` |
| `Address`/`City`/`PostCode`/`Country` | string | No        | Yes       | Postal address parts    | `Auckland` / `1010`   |
| `Phone`                               | string | No        | Yes       | Phone                   | `+64 9 123 4567`      |
| `AccountManagerUUID`                  | uuid   | No        | Yes       | Account manager (staff) | `c3d4...`             |
| `JobManagerUUID`                      | uuid   | No        | Yes       | Default job manager     | `d5e6...`             |
| `TypePaymentTerm`                     | string | No        | Yes       | Payment terms           | `20th of next month`  |

[INFERRED from synchub `ClientDetails`.]

#### Entity: Contact

- **Endpoint path:** managed under the client resource (`client.api/contact*` style); contacts link to clients via `ClientContact` — [DOCUMENTED]
- **Description:** A person at a client org.
- **CRUD support:** Create / Read / Update / Delete (via client) — [INFERRED]
- **Key fields:** `UUID`, `Name`, `Email`, `Phone`, `Mobile`, `Position`, `Salutation`, `IsPrimary` — [INFERRED from synchub `Contact`]

#### Entity: Invoice

- **API resource name / endpoint path:** legacy `invoice.api/*` (`list`, `current`, `get`); modern `/invoice/{UUID}` — [DOCUMENTED — `invoice_current` + `invoicelist` are Airbyte streams]
- **Description:** A bill raised against a client/job.
- **CRUD support:** Read; Create likely supported (raise invoice from job/time) — [INFERRED]
- **Key fields:** `UUID`/`ID`, `Type`, `Status`, `Date`, `DueDate`, `Amount`, `AmountTax`, `AmountPaid`, `ClientUUID`, plus `InvoiceTask[]`/`InvoiceCost[]`/`InvoicePayment[]` line collections — [INFERRED from synchub `Invoice`]

#### Entity: Time (Time Entry / Timesheet)

- **API resource name / endpoint path:** legacy `time.api/*` (`list`, `get`, `add`); modern `/time/{UUID}` — [DOCUMENTED — `timelist` is an Airbyte stream]
- **Description:** A unit of time logged by a staff member against a job/task.
- **CRUD support:** Create / Read / (Update/Delete uncertain) — [INFERRED]
- **Key fields:** `UUID`, `JobID`/`JobUUID`, `StaffMemberUUID`, `TaskUUID`, `Date`, `Minutes`, `Billable`, `InvoiceUUID` (set once billed), optional `Note` — [INFERRED from synchub `Time`]

#### Entity: Staff

- **API resource name / endpoint path:** legacy `staff.api/list` (and `get`); modern `/staff` — [DOCUMENTED — `stafflist` is an Airbyte stream; Node SDK exposes `staff.list()`]
- **Description:** A user/employee in the WorkflowMax org.
- **CRUD support:** Read (list/get). Write generally not exposed. — [INFERRED]
- **Key fields:** `UUID`, `Name`, `Email`, `Phone`, `Mobile`, `Address`, `PayrollCode` — [INFERRED from synchub `Staff`]

#### Secondary entities (lower priority, present in data model / Airbyte streams)

- **Quote** (`quote.api/*`; fields `UUID`/`ID`, `Type`, `State`, `Date`, `Amount`, `ClientUUID`) — [INFERRED]
- **Purchase Order** (`purchaseorder.api/*`; `purchaseorderlist` stream) — [INFERRED]
- **Supplier** (`supplier.api/*`; `supplierlist` stream) — [INFERRED]
- **Lead** (`lead.api/*` with `list`/`current`/`get`/`add`/`categories`; `from`/`to` date filters) — [DOCUMENTED via Node SDK]
- **Cost** (`cost.api/*`; `costlist` stream) — [INFERRED]
- **Task / JobTask** (`tasklist`, `job_tasks` streams) — [INFERRED]
- **Category** (`categories.api/list`) — [DOCUMENTED via Node SDK]
- **Client Group, Client Document** (`clientgrouplist`, `clients_documents` streams) — [INFERRED]

### 3.2 Entity Relationships [IMPORTANT]

```
                         ┌───────────┐
                         │  Client   │
                         └─────┬─────┘
                  1:N          │            1:N
        ┌──────────────────────┼───────────────────────┐
        ▼                      ▼                         ▼
   ┌─────────┐           ┌──────────┐              ┌──────────┐
   │ Contact │           │   Job    │              │ Invoice  │
   └─────────┘           └────┬─────┘              └────┬─────┘
                              │ 1:N                     │ 1:N
              ┌───────────────┼───────────┐            ▼
              ▼               ▼           ▼      ┌──────────────┐
        ┌──────────┐   ┌───────────┐ ┌────────┐ │ Invoice line │
        │ JobTask  │   │   Time    │ │ JobCost│ │ (Task/Cost/  │
        └────┬─────┘   └─────┬─────┘ └────────┘ │  Payment)    │
             │ N:M           │ N:1               └──────────────┘
             ▼               ▼
        ┌──────────┐   ┌───────────┐
        │  Staff   │◄──┤  Staff    │
        └──────────┘   └───────────┘

  Quote ──1:1 (on win)──► Job        Supplier ──1:N──► PurchaseOrder ──N:1──► Job
  Lead  ──(convert)────► Client/Job
```

[INFERRED from synchub relationship tables: `ClientContact`, `JobAssignee`, `JobTaskAssignee`, and `Time.InvoiceUUID`.]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Job

```
[Planned/Quote] --start--> [In Progress] --complete--> [Completed] --invoice--> [Invoiced]
                                  \
                                   --cancel--> [Cancelled]
```

| From State  | Action/Trigger | To State    | Reversible? | Side Effects                         |
| ----------- | -------------- | ----------- | ----------- | ------------------------------------ |
| Planned     | start          | In Progress | yes         | Time/costs can now be logged         |
| In Progress | complete       | Completed   | yes         | Often a precondition for invoicing   |
| Completed   | raise invoice  | Invoiced    | partial     | Billable time/costs flagged invoiced |
| any         | cancel         | Cancelled   | no          | Stops further work                   |

[INFERRED — exact `State` enum values must be read from a live `job.api/list`/`/job` response. `job.api/current` returns only currently-active jobs, implying a current-vs-historical split.]

### 3.4 Business Rules [IMPORTANT]

- **Ordering / dependency rules:** Must create a Client before a Job; a Job (and usually a Task) before logging Time/Cost. — [INFERRED]
- **Field-level rules:** Time entries reference an existing `StaffMemberUUID`, `JobUUID`/`JobID`, and usually a `TaskUUID`. — [INFERRED]
- **Cascading effects:** Archiving/deleting a Client affects its Jobs; invoicing flips time entries' `InvoiceUUID`. — [INFERRED]
- **Uniqueness constraints:** Job `ID` and Invoice `ID` (human numbers) are unique within the org. — [INFERRED]
- **Computed / read-only fields:** `UUID`, `ID`, invoice `Amount`/`AmountTax`/`AmountPaid` (rolled up from lines), `WhenCreated`/`WhenModified`. — [INFERRED]
- **Access rule:** API calls require the acting user to have **"Authorise 3rd Party Full Access"** on their staff record. — [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                                                 | Example                    | Notes                                                         |
| ----------- | ------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| Date        | `YYYY-MM-DD` (modern) / `YYYYMMDD` (legacy `from`/`to`) | `2026-05-01` / `20260501`  | Legacy date-range filters use compact `YYYYMMDD` [DOCUMENTED] |
| DateTime    | ISO-8601                                                | `2026-05-01T09:30:00Z`     | [INFERRED]                                                    |
| Currency    | Decimal string, org currency                            | `12000.00`                 | No embedded currency symbol [INFERRED]                        |
| ID format   | UUID (`UUID`) + human number (`ID`)                     | `e3b0...` / `J000123`      | Use `UUID` for relationships [DOCUMENTED]                     |
| Enum values | Title-case strings                                      | `In Progress`, `Completed` | Confirm exact casing live [INFERRED]                          |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity  | Field      | Allowed Values                                                    | Default | Notes                     |
| ------- | ---------- | ----------------------------------------------------------------- | ------- | ------------------------- |
| Job     | `State`    | Planned / In Progress / Completed / Cancelled / Invoiced (approx) | —       | [INFERRED — confirm live] |
| Invoice | `Status`   | Draft / Approved / Paid (approx)                                  | —       | [INFERRED — confirm live] |
| Time    | `Billable` | true / false                                                      | —       | [INFERRED]                |

---

## Phase 4: Endpoint Catalog

> **Why:** Core of the API spec doc. Paths below follow the legacy `{resource}.api/{action}` convention that the OAuth2 tier still reuses; the modern v2 UUID/JSON variants are noted where known. **All paths require live confirmation of the base host + format.**

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /job.api/list

- **Purpose:** List jobs (paged). Use `/job.api/current` for only active jobs.
- **Authentication required:** yes (Bearer + `account_id`)
- **Rate limit:** global (see Phase 8) — [UNKNOWN exact]
- **Idempotent:** yes

**Query parameters:**

| Parameter   | Type | Required | Default  | Description                                                               |
| ----------- | ---- | -------- | -------- | ------------------------------------------------------------------------- |
| `page`      | int  | No       | 1        | Page number [DOCUMENTED]                                                  |
| `pagesize`  | int  | No       | (server) | Records per page [DOCUMENTED]                                             |
| `detailed`  | bool | No       | false    | Return full job detail vs summary [INFERRED]                              |
| `from`/`to` | date | No       | —        | `YYYYMMDD` date-range filter (created/modified) [DOCUMENTED via Node SDK] |

**Success response (XML; JSON expected with `Accept: application/json`):**

```xml
<Response>
  <Status>OK</Status>
  <Jobs>
    <Job>
      <ID>J000123</ID>
      <UUID>e3b0c442-...-1a2b</UUID>
      <Name>Website Redesign</Name>
      <State>In Progress</State>
      <Client><UUID>a1b2...</UUID><Name>Acme Ltd</Name></Client>
      <StartDate>2026-05-01</StartDate>
      <DueDate>2026-06-30</DueDate>
    </Job>
  </Jobs>
</Response>
```

**Error responses:**

| Status                         | Error Code           | Meaning                                             | Recovery                   |
| ------------------------------ | -------------------- | --------------------------------------------------- | -------------------------- |
| 401                            | (token)              | Missing/expired access token                        | Refresh token, retry       |
| 403                            | (access)             | `account_id` missing or user lacks 3rd-party access | Add header / enable access |
| 200 + `<Status>Error</Status>` | `<ErrorDescription>` | Business/validation error returned in envelope      | Read description           |

#### Endpoint: GET /job.api/get?uuid={uuid} (modern: GET /job/{uuid})

- **Purpose:** Retrieve a single job with tasks/costs detail.
- **Auth:** yes. **Idempotent:** yes.
- **Path/query:** legacy passes `uuid` as query param; modern uses it as a path segment. — [DOCUMENTED]

#### Endpoint: GET /client.api/list (modern: GET /client, GET /client/{uuid})

- **Purpose:** List/Read clients. CRUD also: `client.api/add`, `client.api/update`, `client.api/archive`, `client.api/delete`. — [DOCUMENTED via Node SDK]
- **Auth:** yes.

#### Endpoint: GET /time.api/list (modern: GET /time)

- **Purpose:** List time entries; `time.api/add` to log time.
- **Common filter:** by `from`/`to` date and/or staff/job. — [INFERRED]
- **Auth:** yes.

#### Endpoint: GET /invoice.api/list (and /invoice.api/current)

- **Purpose:** List invoices / current invoices. — [DOCUMENTED — Airbyte `invoicelist` + `invoice_current`]
- **Auth:** yes.

#### Endpoint: GET /staff.api/list (modern: GET /staff)

- **Purpose:** List staff — good low-risk first call for connectivity validation. — [DOCUMENTED]
- **Auth:** yes.

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path (legacy)             | Purpose                 | Auth? | Pagination? | Notes                                    |
| ------ | ------------------------- | ----------------------- | ----- | ----------- | ---------------------------------------- |
| GET    | `/job.api/list`           | List jobs               | Yes   | Yes         | `page`/`pagesize`/`detailed`/`from`/`to` |
| GET    | `/job.api/current`        | List active jobs only   | Yes   | Yes         | [DOCUMENTED]                             |
| GET    | `/job.api/get`            | Get one job             | Yes   | No          | `uuid` param                             |
| POST   | `/job.api/add`            | Create job              | Yes   | No          | [DOCUMENTED via Node SDK]                |
| PUT    | `/job.api/update`         | Update job              | Yes   | No          | [DOCUMENTED via Node SDK]                |
| GET    | `/client.api/list`        | List clients            | Yes   | Yes         | [DOCUMENTED]                             |
| GET    | `/client.api/get`         | Get one client          | Yes   | No          | [DOCUMENTED]                             |
| POST   | `/client.api/add`         | Create client           | Yes   | No          | [DOCUMENTED]                             |
| PUT    | `/client.api/update`      | Update client           | Yes   | No          | [DOCUMENTED]                             |
| POST   | `/client.api/archive`     | Archive client          | Yes   | No          | [DOCUMENTED]                             |
| DELETE | `/client.api/delete`      | Delete client           | Yes   | No          | [DOCUMENTED]                             |
| GET    | `/contact.api/*`          | Contacts (under client) | Yes   | partial     | [INFERRED]                               |
| GET    | `/invoice.api/list`       | List invoices           | Yes   | Yes         | [DOCUMENTED]                             |
| GET    | `/invoice.api/current`    | Current invoices        | Yes   | Yes         | [DOCUMENTED]                             |
| GET    | `/invoice.api/get`        | Get one invoice         | Yes   | No          | [INFERRED]                               |
| GET    | `/time.api/list`          | List time entries       | Yes   | Yes         | [DOCUMENTED]                             |
| POST   | `/time.api/add`           | Log time                | Yes   | No          | [INFERRED]                               |
| GET    | `/staff.api/list`         | List staff              | Yes   | Yes         | [DOCUMENTED]                             |
| GET    | `/quote.api/list`         | List quotes             | Yes   | Yes         | [INFERRED]                               |
| GET    | `/purchaseorder.api/list` | List purchase orders    | Yes   | Yes         | [INFERRED — `purchaseorderlist`]         |
| GET    | `/supplier.api/list`      | List suppliers          | Yes   | Yes         | [INFERRED — `supplierlist`]              |
| GET    | `/lead.api/list`          | List leads              | Yes   | Yes         | [DOCUMENTED — `from`/`to`]               |
| GET    | `/lead.api/current`       | Current leads           | Yes   | Yes         | [DOCUMENTED]                             |
| GET    | `/lead.api/categories`    | Lead categories         | Yes   | No          | [DOCUMENTED]                             |
| GET    | `/cost.api/list`          | List costs              | Yes   | Yes         | [INFERRED — `costlist`]                  |
| GET    | `/categories.api/list`    | List categories         | Yes   | No          | [DOCUMENTED]                             |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

Not applicable — REST only, no GraphQL/WebSocket. — [INFERRED]

---

## Phase 5: Query & Filter Capabilities

> **Why:** Users will ask "show me all jobs for client X that are overdue."

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?             | Syntax                   | Notes                                      |
| ------------------------------- | ---------------------- | ------------------------ | ------------------------------------------ |
| Filter by field value           | Limited                | resource-specific params | Not a general query language [INFERRED]    |
| Filter by date range            | Yes                    | `from`/`to` (`YYYYMMDD`) | On list endpoints [DOCUMENTED]             |
| Full-text search                | Limited / [UNKNOWN]    | —                        | No general search endpoint found           |
| Sort by field                   | [UNKNOWN]              | —                        | Not documented; likely server-ordered      |
| Sort direction (asc/desc)       | [UNKNOWN]              | —                        | —                                          |
| Field selection / sparse fields | Partial                | `detailed=true/false`    | Coarse summary vs detail toggle [INFERRED] |
| Include related records         | Partial                | `detailed=true`          | Detail mode embeds tasks/costs [INFERRED]  |
| Aggregate / count               | [UNKNOWN]              | —                        | —                                          |
| Logical operators (AND/OR)      | No                     | —                        | [INFERRED]                                 |
| Comparison operators            | No (except date range) | —                        | [INFERRED]                                 |
| Null checks                     | No                     | —                        | [INFERRED]                                 |
| Regex / pattern matching        | No                     | —                        | [INFERRED]                                 |

### 5.2 Filter Syntax [REQUIRED]

```
# Date-range filter (legacy, compact dates)
GET /job.api/list?from=20260101&to=20261231&page=1&pagesize=100

# Active-only via dedicated endpoint rather than a status filter
GET /job.api/current
```

- Multiple filters: AND only (each param narrows). — [INFERRED]
- Nesting: not supported. — [INFERRED]

### 5.3 Sort Syntax [IMPORTANT]

Not documented. Results assumed server-default ordered. Sort client-side after paging. — [UNKNOWN]

### 5.4 Field Selection [NICE-TO-HAVE]

`detailed=true` returns full objects (with child collections); omit/`false` for summaries. No per-field selection. — [INFERRED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none found — [UNKNOWN]
- **Per-resource search:** date-range + `current` variants only — [DOCUMENTED]
- **Fuzzy matching:** not supported — [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: All jobs modified/created this year, page 1**

```http
GET /job.api/list?from=20260101&to=20261231&page=1&pagesize=100
```

**Pattern 2: Currently active jobs only**

```http
GET /job.api/current?detailed=true
```

**Pattern 3: This week's time entries for staff reporting**

```http
GET /time.api/list?from=20260525&to=20260531
```

**Pattern 4: Outstanding/current invoices**

```http
GET /invoice.api/current
```

---

## Phase 6: Pagination & Bulk Operations

> **Why:** Getting pagination wrong means missing data.

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** page-number (`page` + `pagesize`) — [DOCUMENTED]
- **Default page size:** server default (commonly 100) — [INFERRED]
- **Maximum page size:** [UNKNOWN] — confirm live
- **Total count available:** Likely returned in the response envelope (legacy XML often exposes count/total attributes) — [INFERRED]

**Request parameters:**

| Parameter  | Type | Default | Description        |
| ---------- | ---- | ------- | ------------------ |
| `page`     | int  | 1       | 1-based page index |
| `pagesize` | int  | server  | Records per page   |

**Response structure (XML; JSON analogous):**

```xml
<Response>
  <Status>OK</Status>
  <Jobs page="1" pagesize="100" totalrecords="237">
    <Job> ... </Job>
  </Jobs>
</Response>
```

[INFERRED — confirm whether count attributes exist and their exact names.]

**How to detect last page:**

```
Stop when the returned collection has fewer than `pagesize` items,
or when page * pagesize >= totalrecords (if a total is provided).
```

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: GET /job.api/list?page=1&pagesize=100
Page 2: GET /job.api/list?page=2&pagesize=100
Page 3: GET /job.api/list?page=3&pagesize=100
Last:   returned <Jobs> has < 100 children  → stop
```

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint | Max Batch Size | Notes                          |
| --------------------- | -------- | -------------- | ------------------------------ |
| Bulk create           | none     | —              | One entity per call [INFERRED] |
| Bulk update           | none     | —              | [INFERRED]                     |
| Bulk delete           | none     | —              | [INFERRED]                     |
| Bulk read / batch get | none     | —              | Use list + pagination          |

No bulk endpoints found. Partial-failure handling N/A. — [INFERRED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

No async export endpoint. Bulk extraction = paginate the `list` endpoints (this is exactly what Airbyte's connector does). — [INFERRED]

---

## Phase 7: Real-Time & Event-Driven

> **Why:** Without webhooks, polling is the only option.

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                | Supported?      | Notes                                                   |
| ------------------------ | --------------- | ------------------------------------------------------- |
| Webhooks                 | No (none found) | No webhook registration surface in docs/SDKs [INFERRED] |
| WebSocket                | No              | [INFERRED]                                              |
| Server-Sent Events (SSE) | No              | [INFERRED]                                              |
| Long polling             | No              | [INFERRED]                                              |
| Change feeds / streams   | No              | [INFERRED]                                              |

### 7.2 Webhooks [IMPORTANT] (if supported)

Not supported. — [INFERRED]

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

Not applicable.

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended polling endpoint:** `/{resource}.api/list` with `from`/`to` date-range filters.
- **Recommended polling interval:** Conservative (e.g. ≥15 min) to respect undocumented rate limits and short token lifetimes.
- **"Modified since" filter available:** Via `from`/`to` date filters; entities carry `WhenModified` for change detection (per synchub data model). — [DOCUMENTED]
- **Change detection field(s):** `WhenModified` (and `WhenCreated`). — [DOCUMENTED]
- **Rate-limit implications:** Each poll spends quota; combine with `detailed=false` summaries and only fetch detail on changed UUIDs. — [INFERRED]

---

## Phase 8: Operational Concerns

> **Why:** These cause production incidents when wrong.

### 8.1 Rate Limits [REQUIRED]

| Scope        | Limit     | Window | Notes                                                                                             |
| ------------ | --------- | ------ | ------------------------------------------------------------------------------------------------- |
| Global       | [UNKNOWN] | —      | A "Rate Limiting" section exists in the v2 docs but exact numbers not publicly captured           |
| Per-endpoint | [UNKNOWN] | —      | —                                                                                                 |
| Per-org      | [UNKNOWN] | —      | One community SDK doc cited ~1000/hour + ~10/sec for the **legacy** API — [INFERRED, unconfirmed] |

- **Rate limit headers:** [UNKNOWN] — capture response headers on the first live 200 and first 429.
- **Rate limit exceeded response:** Assume HTTP **429**; legacy may instead return a `<Response><Status>Error</Status>` envelope. — [INFERRED]
- **Retry-After header:** [UNKNOWN]
- **Backoff strategy:** Exponential backoff + jitter on 429/5xx; cap concurrency. — [INFERRED, standard practice]

> **ACTION:** Confirm exact limits from `api-docs.workflowmax.com` "Rate Limiting" section (auth-gated) or a support ticket before high-volume polling.

### 8.2 Error Handling [REQUIRED]

**Standard error response format (legacy XML envelope — still likely on reused endpoints):**

```xml
<Response>
  <Status>Error</Status>
  <ErrorDescription>Invalid UUID supplied</ErrorDescription>
</Response>
```

> **Gotcha:** Legacy WorkflowMax frequently returns **HTTP 200** with `<Status>Error</Status>` in the body rather than a 4xx. **Parsers must inspect `Status`, not just the HTTP code.** — [DOCUMENTED for legacy]

**Modern JSON error format:** Likely standard HTTP status + JSON `{ "message": "..." }`, but **not confirmed**. — [INFERRED]

**Error codes reference:**

| HTTP Status | Error Code               | Meaning                                     | Retryable?       | Recovery Action            |
| ----------- | ------------------------ | ------------------------------------------- | ---------------- | -------------------------- |
| 200         | `<Status>Error</Status>` | Business/validation error in body           | No               | Read `<ErrorDescription>`  |
| 400         | —                        | Bad request                                 | No               | Fix params                 |
| 401         | —                        | Expired/invalid access token                | Yes              | Refresh token, retry       |
| 403         | —                        | Missing `account_id` or no 3rd-party access | No (until fixed) | Add header / enable access |
| 404         | —                        | Unknown UUID/resource                       | No               | Verify identifiers         |
| 429         | —                        | Rate limited (assumed)                      | Yes              | Backoff + retry            |
| 500/502/503 | —                        | Server error                                | Yes              | Retry with backoff         |

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No documented idempotency key. — [INFERRED]
- **Naturally idempotent:** GET yes; PUT (`update`) yes; DELETE yes; POST (`add`) no — guard against double-creates at the connector layer. — [INFERRED]

### 8.4 Async Operations [IMPORTANT]

No async/long-running operations observed — all calls are synchronous. — [INFERRED]

### 8.5 File Handling [IMPORTANT]

- Client documents exist as an entity (`clients_documents` stream / `ClientDocument`). Whether the API supports document **upload/download** is **[UNKNOWN]** — confirm via the v2 docs.
- WorkflowMax is **not** a file-storage system; document handling (if present) is metadata-centric, not a browsable file tree. — [INFERRED]

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** No explicit ETag/RowVersion observed (unlike sibling MYOB API). — [INFERRED]
- **Consistency:** Assume read-after-write consistency within the org. — [INFERRED]

---

## Phase 9: Platform Integration Assessment

> **Why:** Determines which Numa integration path to use.

### 9.1 Integration Path Decision [REQUIRED]

| Path                       | When to Use                                         | Fits?   | Notes                                                           |
| -------------------------- | --------------------------------------------------- | ------- | --------------------------------------------------------------- |
| **Data Connector**         | API has file-like content to browse/search/download | No      | WorkflowMax is structured job/PSA data, not browsable files     |
| **Data Connector (Files)** | API is primarily a file storage/document system     | No      | Not a file system                                               |
| **Direct API Only**        | API is action-oriented (no browsable content)       | **Yes** | Jobs, clients, time, invoices = structured action/query surface |
| **Hybrid**                 | Browsable content AND actions                       | No      | —                                                               |

**Selected integration path:** **Direct API via `connect_request`** (Direct API Only).

**Justification:** WorkflowMax 2 is a professional-services automation (PSA) / job-management system exposing structured entities (jobs, clients, contacts, time entries, invoices, staff) over OAuth2 REST. There is no browsable file tree, so the Files / Data Connector paths do not apply. This connector should be wired exactly like the other Tier-2 OAuth2 business-system connectors (e.g. simPRO, Zoho CRM, MYOB): the connector stores the OAuth2 token in the user vault, and the workspace agent reaches the API by issuing a **`connect_request`** that injects the `Authorization: Bearer …` token (plus the required `account_id` header) and forwards the call to the WorkflowMax base URL. No bespoke connector method surface (`list_files`/`download_file`) is needed.

### 9.2 Connector Requirements [IMPORTANT] (if Data Connector path)

Not applicable — Direct API path. The standard file-connector method table (`list_files`, `download_file`, etc.) is intentionally left empty.

- **Auth type for connector:** OAuth 2.0 (authorization_code + refresh) — matches registry `authType: 'oauth2'`.
- **Connector category:** project-management / PSA (registry category: `Project Management`).
- **Caching appropriate:** Light caching of slow-changing reference data (staff, categories, client list) is reasonable; do not cache time/job state aggressively (it changes constantly). — [INFERRED]

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. List and read jobs, clients, contacts, invoices, time entries, staff, quotes, purchase orders, suppliers, leads, and costs.
2. Answer reporting/analytical questions: WIP, overdue jobs, time logged per staff/job in a date range, outstanding invoices.
3. Create/update low-risk records where confirmed safe (e.g. create a job, log a time entry, update a client) — gated behind explicit user intent.

**CANNOT do (out of scope or dangerous):**

1. Delete clients/jobs or archive records without explicit, confirmed user instruction (destructive — `client.api/delete`/`archive` exist).
2. Issue/finalise invoices or anything with financial/billing consequences without a human-in-the-loop confirmation.
3. Bulk mutations (no bulk endpoints; avoid hammering single-record writes that could trip undocumented rate limits).

**Default parameters:**

| Parameter   | Default                    | Reason                                                   |
| ----------- | -------------------------- | -------------------------------------------------------- |
| `pagesize`  | 100                        | Balance call count vs payload; raise only if needed      |
| `detailed`  | false                      | Cheaper summaries first; fetch detail per-UUID on demand |
| Accept      | `application/json`         | Prefer JSON for easier parsing where supported           |
| Date format | `YYYYMMDD` for `from`/`to` | Matches legacy filter expectation                        |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                                        | Language | Quality | Maintained? | Worth Using?                  | Notes                                             |
| ------------------------------------------ | -------- | ------- | ----------- | ----------------------------- | ------------------------------------------------- |
| XeroAPI Postman collection (official)      | n/a      | Good    | Yes         | Yes (for discovery/testing)   | Authoritative auth + sample calls; not a code SDK |
| XeroAPI .NET Core OAuth2 sample (official) | C#       | Good    | Yes         | Reference only                | Demonstrates v3 API + OAuth2 end-to-end           |
| `indemandly/workflowmax` (community)       | Node.js  | Fair    | Unclear     | No (legacy apiKey/accountKey) | Useful only to learn legacy endpoint paths        |
| Airbyte source connector                   | Python   | Good    | Yes         | Reference only                | Confirms OAuth2 endpoints + 16-stream entity list |

For Numa we will **not** vendor an SDK — calls go through `connect_request` with hand-built requests, consistent with the other OAuth2 connectors.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 complete: auth documented, **but first live call NOT made (GATE not passed)**
- [x] Phase 3 complete: core entities + relationships documented (fields mostly [INFERRED])
- [x] Phase 4 complete: 6 critical endpoints + index documented (paths need live confirmation)
- [x] Phase 5 complete: query/filter patterns documented
- [x] Phase 6 complete: pagination model documented with worked example
- [x] Phase 7 complete: event-driven assessed (no webhooks; polling fallback)
- [ ] Phase 8 complete: error format documented; **rate-limit numbers [UNKNOWN]**
- [x] Phase 9 complete: integration path selected (Direct API via `connect_request`)

**Overall investigation confidence:** medium

**Known gaps that will reduce output quality:**

1. **No live call** — base host (`api.workflowmax2.com` vs `api.workflowmax.com`), JSON-vs-XML default, exact field names/casing, and `State`/`Status` enum values are unconfirmed.
2. **Rate limits unknown** — a "Rate Limiting" section exists in the gated v2 docs but values were not retrievable.
3. **Registry scope gap** — `offline_access` is missing from the connector's scope string, which (per vendor docs) prevents refresh-token issuance against short-lived (~12–30 min) access tokens. Should be fixed before go-live.

### 10.2 Generation Prompts [REQUIRED]

Standard generation prompts apply (Output Set 1 LLM Knowledge Pack, Output Set 2 Developer Reference, Output Set 3 Build Instructions). For `03-connector-setup.md`, note the integration path is **Direct API via `connect_request`** (no file-connector method mapping) and ensure the `account_id` header + the `offline_access` scope recommendation are carried through.

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence  | Gaps                                                                     |
| ---------------------------- | ------------- | ----------- | ------------------------------------------------------------------------ |
| 01-llm-api-rules             | Yes           | Medium      | Base host + JSON/XML default unconfirmed; rate limits unknown            |
| 01a-domain-model-reference   | Yes           | Medium      | Field names/casing & enums [INFERRED]                                    |
| 01b-query-patterns           | Yes           | Medium      | Sort unsupported/unknown; pagination total field name unconfirmed        |
| 01c-mutation-patterns        | Partial       | Low-Med     | Write payload shapes not seen live; validation rules [INFERRED]          |
| 01d-event-and-error-handling | Yes           | Medium      | No webhooks (clear); rate-limit numbers + 429 shape unconfirmed          |
| 02-api-spec-investigation    | Yes           | Medium      | Consolidates the above; flag all [INFERRED]/[UNKNOWN]                    |
| 03-connector-setup           | Yes           | Medium-High | Auth flow well understood; fix `offline_access` scope; confirm base host |

---

## Appendix A: Top Risks & What to Verify First (live)

1. **Base host + data format** — Run the official XeroAPI Postman collection against a trial org. Confirm whether the OAuth2 tier serves `api.workflowmax2.com` or `api.workflowmax.com`, and whether `Accept: application/json` yields JSON or the legacy `<Response>` XML.
2. **`account_id` header** — Confirm the JWT contains the Org ID and that the header name is literally `account_id`. Calls 401/403 without it.
3. **Scope fix** — Add `offline_access` to the registry scope string; verify a refresh token is returned and that `grant_type=refresh_token` renews the ~12–30 min access token.
4. **Enum values + field casing** — Capture a real `job`/`invoice`/`time` payload to lock down `State`/`Status` enums and exact field names before the LLM rules are finalised.
5. **Rate limits + 429 shape** — Read the gated "Rate Limiting" docs section or open a support ticket; capture headers on the first 200 and first 429.
6. **3rd-party access requirement** — Document for end users that the connecting staff member must have "Authorise 3rd Party Full Access" enabled.

---

## Appendix B: Source Catalogue

| URL                                                                                 | Quality                 | Used For                                            |
| ----------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------- |
| https://support.workflowmax.com/hc/en-us/articles/28754786654233-API-authentication | ⭐⭐⭐⭐ Official       | OAuth2 flow, `account_id` header, token lifetime    |
| https://github.com/XeroAPI/workflowmax-postman-oauth2                               | ⭐⭐⭐⭐ Official       | Auth endpoints, Connections call, sample requests   |
| https://github.com/XeroAPI/workflowmax-dotnetcore-oauth2-sample                     | ⭐⭐⭐⭐ Official       | v3 API + OAuth2 working sample                      |
| https://api-docs.workflowmax.com/ (+ /v2, /job, /overview, /changelog)              | ⭐⭐⭐ Official (gated) | Modern v2 endpoint/object reference (403 to fetch)  |
| https://www.postman.com/xeroapi/xeroapi/collection/miwik51/workflowmax-oauth-2-0    | ⭐⭐⭐ Official         | Public Postman workspace                            |
| https://docs.airbyte.com/integrations/sources/workflowmax                           | ⭐⭐⭐ Third-party      | OAuth2 endpoints, 16-stream entity list             |
| https://www.synchub.io/connectors/workflowmax/datamodel                             | ⭐⭐⭐ Third-party      | Entity + field discovery (Job/Client/Time/Invoice…) |
| https://github.com/indemandly/workflowmax                                           | ⭐⭐ Community SDK      | Legacy endpoint paths, XML envelope, `from`/`to`    |
| https://findapis.com/en/api/workflowmax                                             | ⭐⭐ Third-party        | OpenAPI 3.0.3 advertised, XML format, REST          |
| https://developer.xero.com/documentation/api/workflowmax/overview-workflowmax       | ⭐⭐⭐ Official (gated) | Legacy entity shapes (Not Authorized to fetch)      |

**Not found / unresolved:**

- No public OpenAPI/Swagger spec retrievable without auth (advertised as OpenAPI 3.0.3).
- No published rate-limit numbers (section exists but gated).
- No webhook support found.
- No first-party Python/Node SDK.
- Definitive base host for the OAuth2 tier (`api.workflowmax2.com` vs `api.workflowmax.com`) not confirmable without a live call.
