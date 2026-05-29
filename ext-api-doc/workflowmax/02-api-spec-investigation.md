---
api_name: 'WorkflowMax (by Xero)'
api_slug: 'workflowmax'
base_url: 'https://api.workflowmax2.com/ (modern v2 — INFERRED; confirm live)'
version: 'WorkflowMax 2 (OAuth2 tier)'
spec_format: 'OpenAPI 3.0.3 (advertised; gated behind auth — not retrieved)'
spec_url: 'https://api-docs.workflowmax.com/v2/workflowmax-api-v2 (interactive API Explorer)'
docs_url: 'https://api-docs.workflowmax.com/v2'
date_researched: '2026-05-29'
---

# WorkflowMax (by Xero) -- API Specification & Investigation

> Clean developer reference for the WorkflowMax API. This document is the condensed
> output of the investigation questionnaire (`00-api-investigation-questionnaire.md`) --
> everything a developer needs to integrate, in one place.
>
> **Confidence: medium. No live call was made in this research pass.** Confidence markers
> are used throughout: `[CONFIRMED]` (verified against source we hold), `[DOCUMENTED]`
> (stated in official/vendor docs), `[INFERRED]` (deduced from SDKs/examples/behaviour),
> `[UNKNOWN]` (could not determine). Treat anything not `[DOCUMENTED]` as provisional and
> lock it down from the first real response.

---

## ⚠️ Read this first: two API generations

WorkflowMax has **two coexisting API generations** that are trivially easy to conflate. This
document is scoped to the **new "WorkflowMax 2"** generation, because that is what our
connector registry actually points at (`oauth.workflowmax2.com`).

| Trait              | Legacy "WorkflowMax by Xero" (v3)                | **New "WorkflowMax 2" (this doc)**                            |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------- |
| Status             | Retired ~June 2024 for new connections           | Current — what `app.workflowmax2.com` users get               |
| Authorize / token  | `login.xero.com` / `identity.xero.com`           | `oauth.workflowmax2.com/oauth/authorize` + `/oauth/token`     |
| Org-scoping header | `Xero-tenant-id`                                 | **`account_id`** (Org ID decoded from the access JWT)         |
| Resource base host | `https://api.xero.com/workflowmax/3.0/`          | `https://api.workflowmax2.com/` **[INFERRED — confirm]**      |
| Data format        | XML (`<Response><Status>OK</Status>…`)           | JSON via `Accept: application/json` **[INFERRED]**            |
| Endpoint shape     | `{resource}.api/{action}` e.g. `job.api/current` | UUID/REST e.g. `GET /job`, `GET /job/{UUID}` **[DOCUMENTED]** |

> **Do not** wire this connector against `identity.xero.com` / `Xero-tenant-id` / `api.xero.com`.
> Those belong to the retired generation. The registry is correct: this is WorkflowMax 2.

---

## Overview

- **Vendor:** Xero Limited (WorkflowMax product line; older spec artifacts brand it "WorkflowMax by BlueRock")
- **API version:** WorkflowMax 2 / v2 (the modern generation served from `api-docs.workflowmax.com/v2`)
- **Base URL:** `https://api.workflowmax2.com/` — **[INFERRED]** (parallels the `oauth.workflowmax2.com` auth host; **confirm on first live call** — the legacy host `api.workflowmax.com` may also serve the same resource paths)
- **Sandbox URL:** No dedicated sandbox host — use a free WorkflowMax **trial org** with hand-entered test data — [INFERRED]
- **API type:** REST — [DOCUMENTED]
- **Data format:** JSON (modern, via `Accept: application/json`) or XML (legacy default / write bodies) — [DOCUMENTED that XML is the legacy default; JSON support INFERRED]
- **Documentation:** [https://api-docs.workflowmax.com/v2](https://api-docs.workflowmax.com/v2)
- **API reference / Explorer:** [https://api-docs.workflowmax.com/api-runner/workflowmax/workflowmax-api-v2](https://api-docs.workflowmax.com/api-runner/workflowmax/workflowmax-api-v2)
- **Auth guide:** [https://support.workflowmax.com/hc/en-us/articles/28754786654233-API-authentication](https://support.workflowmax.com/hc/en-us/articles/28754786654233-API-authentication)
- **OpenAPI spec:** Advertised as OpenAPI 3.0.3 and exposed through the API Explorer — **not retrievable without auth** (docs portal 403s automated fetch)
- **Status page:** Not separately published; rolls up under Xero — [UNKNOWN]

**Summary:** WorkflowMax is a professional-services automation (PSA) / job-management system
for service businesses (agencies, consultancies, trades). The API exposes structured
business entities — jobs, clients, contacts, invoices, time entries, staff, quotes,
purchase orders, suppliers, leads, costs — over OAuth2 REST. There is no browsable file
tree; this is an action/query API, not a file store.

---

## Authentication

### Method: OAuth 2.0 (authorization_code + refresh_token)

OAuth 2.0 authorization-code flow on the WorkflowMax 2 identity host. The access token is a
**JWT** whose claims include the authenticated **Org ID** — that Org ID must be replayed as
the **`account_id` request header** on every API call. [DOCUMENTED]

**Header format (every authenticated call):**

```
Authorization: Bearer {access_token}
account_id: {org_uuid}            ← the Org ID, decoded from the access-token JWT
Accept: application/json          ← request JSON; omit/use application/xml for legacy XML
```

**For OAuth 2.0:**

| Parameter         | Value                                                                                                | Confidence                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Grant type        | `authorization_code` + `refresh_token`                                                               | [DOCUMENTED]                                              |
| Authorization URL | `https://oauth.workflowmax2.com/oauth/authorize`                                                     | [CONFIRMED — matches connector registry `oauth.authUrl`]  |
| Token URL         | `https://oauth.workflowmax2.com/oauth/token`                                                         | [CONFIRMED — matches connector registry `oauth.tokenUrl`] |
| Revocation URL    | Not documented                                                                                       | [UNKNOWN]                                                 |
| Token lifetime    | **Access token ~12–30 min** (XeroAPI README: ~12 min; community Laravel impl: ~30 min) — short-lived | [DOCUMENTED — conflicting figures, both short]            |
| Refresh mechanism | `grant_type=refresh_token` against the token URL; **requires `offline_access` to have been granted** | [DOCUMENTED]                                              |
| PKCE required     | No (confidential web app — we hold a client secret)                                                  | [INFERRED]                                                |

**Required scopes:**

| Scope            | Purpose                       | Required for Integration?                       |
| ---------------- | ----------------------------- | ----------------------------------------------- |
| `openid`         | OpenID Connect identity       | Yes (in registry scope string)                  |
| `profile`        | Basic profile claims          | Yes (in registry scope string)                  |
| `email`          | Email claim                   | Yes (in registry scope string)                  |
| `workflowmax`    | Access to the WorkflowMax API | **Yes — the functional scope** [DOCUMENTED]     |
| `offline_access` | Issues a refresh token        | **Should be — currently MISSING from registry** |

> **⚠️ KNOWN GAP — `offline_access` is missing from the registry scope string.**
> The connector registry scope string is exactly `openid profile email workflowmax`
> ([CONFIRMED — read from `connectorRegistry.ts`]). Vendor docs and a community Laravel
> implementation are explicit: _"you need the `offline_access` scope to get a refresh token —
> access tokens only last ~30 min."_ Without it, the connection dies every ~12–30 min and
> needs full re-consent. **Recommend adding `offline_access` to the registry scopes before
> go-live.** The official WorkflowMax 2 authorize example uses
> `scope=openid profile email workflowmax offline_access` + `prompt=consent`. [DOCUMENTED]

**Obtaining the `account_id` (Org ID):**

1. Complete the `authorization_code` exchange (parameters in the **request body**, form-encoded — **not** headers).
2. The returned `access_token` is a JWT; decode it to read the authenticated org's **Org ID**.
3. Send that Org ID as the **`account_id` header** on every subsequent API call. Missing it → 401/403. [DOCUMENTED]

> If the JWT contains no Org ID, the token exchange was done incorrectly (params sent as
> headers instead of body). The connecting staff member must also have **"Authorise 3rd Party
> Full Access"** enabled on their WorkflowMax staff record, or calls are rejected. [DOCUMENTED]

---

## Endpoint Catalog

> Two shapes coexist on the WorkflowMax 2 tier. The legacy `{resource}.api/{action}` paths
> are reused and well-documented in community SDKs; the modern v2 REST/UUID paths are visible
> in the `api-docs.workflowmax.com/v2` object pages. **All paths require live confirmation of
> the base host + format.**

### Jobs

| Method | Path (legacy)      | Path (modern v2)                 | Purpose               | Auth | Paginated | Idempotent | Confidence                         |
| ------ | ------------------ | -------------------------------- | --------------------- | ---- | --------- | ---------- | ---------------------------------- |
| GET    | `/job.api/list`    | `GET /job`                       | List jobs             | Yes  | Yes       | Yes        | [DOCUMENTED]                       |
| GET    | `/job.api/current` | —                                | List active jobs only | Yes  | Yes       | Yes        | [DOCUMENTED]                       |
| GET    | `/job.api/get`     | `GET /job/{UUID}`                | Get one job           | Yes  | No        | Yes        | [DOCUMENTED]                       |
| POST   | `/job.api/add`     | `POST /v2/jobs`                  | Create job            | Yes  | No        | No         | [DOCUMENTED — v2 path from portal] |
| PUT    | `/job.api/update`  | `PUT /v2/jobs/{UUID}`            | Update job            | Yes  | No        | Yes        | [DOCUMENTED — v2 path from portal] |
| DELETE | —                  | `DELETE /v2/jobs/{UUID}`         | Delete job            | Yes  | No        | Yes        | [DOCUMENTED — v2 path from portal] |
| GET    | —                  | `GET /v2/jobs/{UUID}/timesheets` | Job timesheets        | Yes  | partial   | Yes        | [DOCUMENTED — v2 path from portal] |

### Clients

| Method | Path (legacy)         | Path (modern v2)     | Purpose                          | Auth | Paginated | Confidence                          |
| ------ | --------------------- | -------------------- | -------------------------------- | ---- | --------- | ----------------------------------- |
| GET    | `/client.api/list`    | `GET /client`        | List clients                     | Yes  | Yes       | [DOCUMENTED]                        |
| GET    | `/client.api/get`     | `GET /client/{UUID}` | Get one client                   | Yes  | No        | [DOCUMENTED]                        |
| POST   | `/client.api/add`     | —                    | Create client                    | Yes  | No        | [DOCUMENTED via community Node SDK] |
| PUT    | `/client.api/update`  | —                    | Update client                    | Yes  | No        | [DOCUMENTED via community Node SDK] |
| POST   | `/client.api/archive` | —                    | **Archive client (destructive)** | Yes  | No        | [DOCUMENTED via community Node SDK] |
| DELETE | `/client.api/delete`  | —                    | **Delete client (destructive)**  | Yes  | No        | [DOCUMENTED via community Node SDK] |

### Contacts

| Method | Path                            | Purpose              | Auth | Paginated | Confidence |
| ------ | ------------------------------- | -------------------- | ---- | --------- | ---------- |
| GET    | `/contact.api/*` (under client) | List/manage contacts | Yes  | partial   | [INFERRED] |

> Contacts link to clients via a `ClientContact` relationship; CRUD is performed through the
> client resource rather than a standalone top-level contact resource. [INFERRED from synchub data model]

### Invoices

| Method | Path (legacy)          | Path (modern v2)      | Purpose                      | Auth | Paginated | Confidence                               |
| ------ | ---------------------- | --------------------- | ---------------------------- | ---- | --------- | ---------------------------------------- |
| GET    | `/invoice.api/list`    | `GET /invoice`        | List invoices                | Yes  | Yes       | [DOCUMENTED — Airbyte `invoicelist`]     |
| GET    | `/invoice.api/current` | —                     | Current/outstanding invoices | Yes  | Yes       | [DOCUMENTED — Airbyte `invoice_current`] |
| GET    | `/invoice.api/get`     | `GET /invoice/{UUID}` | Get one invoice              | Yes  | No        | [INFERRED]                               |

### Time entries

| Method | Path (legacy)    | Path (modern v2)   | Purpose            | Auth | Paginated | Confidence                        |
| ------ | ---------------- | ------------------ | ------------------ | ---- | --------- | --------------------------------- |
| GET    | `/time.api/list` | `GET /time`        | List time entries  | Yes  | Yes       | [DOCUMENTED — Airbyte `timelist`] |
| GET    | `/time.api/get`  | `GET /time/{UUID}` | Get one time entry | Yes  | No        | [INFERRED]                        |
| POST   | `/time.api/add`  | —                  | Log time           | Yes  | No        | [INFERRED]                        |

### Staff

| Method | Path (legacy)     | Path (modern v2)    | Purpose       | Auth | Paginated | Confidence                              |
| ------ | ----------------- | ------------------- | ------------- | ---- | --------- | --------------------------------------- |
| GET    | `/staff.api/list` | `GET /staff`        | List staff    | Yes  | Yes       | [DOCUMENTED — best low-risk first call] |
| GET    | `/staff.api/get`  | `GET /staff/{UUID}` | Get one staff | Yes  | No        | [INFERRED]                              |

### Full Endpoint Index (secondary resources)

| #   | Method | Path (legacy)             | Purpose              | Notes / Confidence                       |
| --- | ------ | ------------------------- | -------------------- | ---------------------------------------- |
| 1   | GET    | `/quote.api/list`         | List quotes          | [INFERRED]                               |
| 2   | GET    | `/purchaseorder.api/list` | List purchase orders | [INFERRED — Airbyte `purchaseorderlist`] |
| 3   | GET    | `/supplier.api/list`      | List suppliers       | [INFERRED — Airbyte `supplierlist`]      |
| 4   | GET    | `/lead.api/list`          | List leads           | [DOCUMENTED — `from`/`to` filters]       |
| 5   | GET    | `/lead.api/current`       | Current leads        | [DOCUMENTED]                             |
| 6   | GET    | `/lead.api/categories`    | Lead categories      | [DOCUMENTED]                             |
| 7   | GET    | `/cost.api/list`          | List costs           | [INFERRED — Airbyte `costlist`]          |
| 8   | GET    | `/categories.api/list`    | List categories      | [DOCUMENTED — reference data, cacheable] |

> **No GraphQL / SOAP / WebSocket surface.** REST only. [INFERRED]

---

## Data Models

> Field names/casing below are drawn from the synchub data model, the Airbyte stream list,
> and legacy WorkflowMax XML schemas. Field-level detail is **[INFERRED]** until confirmed
> against a live payload. Entities carry both a stable `UUID` (use for relationships) and a
> human number `ID` (e.g. `J000123`).

### Job

| Field               | Type        | Required | Writable | Description                     |
| ------------------- | ----------- | -------- | -------- | ------------------------------- |
| `UUID`              | string/uuid | n/a      | no       | Stable job identifier           |
| `ID`                | string      | n/a      | no       | Human job number (`J000123`)    |
| `Name`              | string      | yes      | yes      | Job name                        |
| `Description`       | string      | no       | yes      | Job description                 |
| `ClientUUID`        | uuid        | yes      | yes      | Owning client                   |
| `State`             | enum        | n/a      | partial  | Lifecycle state (see below)     |
| `StartDate`         | date        | no       | yes      | Job start (`YYYY-MM-DD`)        |
| `DueDate`           | date        | no       | yes      | Job due date                    |
| `Budget`            | decimal     | no       | yes      | Job budget (`12000.00`)         |
| `ManagerUUID`       | uuid        | no       | yes      | Job manager (staff)             |
| `PartnerUUID`       | uuid        | no       | yes      | Partner/owner (staff)           |
| `ApprovedQuoteUUID` | uuid        | no       | no       | Quote this job was created from |

**Relationships:** Job → Client (many-to-one via `ClientUUID`); Job → JobTask (one-to-many);
Job → Time (one-to-many); Job → JobCost (one-to-many); Job ↔ Staff (many-to-many via assignee links);
Job → Invoice (one-to-many).

### Client

| Field                                 | Type   | Required | Writable | Description             |
| ------------------------------------- | ------ | -------- | -------- | ----------------------- |
| `UUID`                                | uuid   | n/a      | no       | Client identifier       |
| `Name`                                | string | yes      | yes      | Client name             |
| `Email`                               | string | no       | yes      | Primary email           |
| `Address`/`City`/`PostCode`/`Country` | string | no       | yes      | Postal address parts    |
| `Phone`                               | string | no       | yes      | Phone                   |
| `AccountManagerUUID`                  | uuid   | no       | yes      | Account manager (staff) |
| `JobManagerUUID`                      | uuid   | no       | yes      | Default job manager     |
| `TypePaymentTerm`                     | string | no       | yes      | Payment terms           |

### Contact

`UUID`, `Name`, `Email`, `Phone`, `Mobile`, `Position`, `Salutation`, `IsPrimary`. Linked to a
client via `ClientContact`. [INFERRED]

### Invoice

`UUID`/`ID`, `Type`, `Status`, `Date`, `DueDate`, `Amount`, `AmountTax`, `AmountPaid`,
`ClientUUID`, plus `InvoiceTask[]` / `InvoiceCost[]` / `InvoicePayment[]` line collections.
`Amount`/`AmountTax`/`AmountPaid` are computed/read-only roll-ups. [INFERRED]

### Time (time entry)

`UUID`, `JobID`/`JobUUID`, `StaffMemberUUID`, `TaskUUID`, `Date`, `Minutes`, `Billable`,
`InvoiceUUID` (set once billed), optional `Note`. [INFERRED]

### Staff

`UUID`, `Name`, `Email`, `Phone`, `Mobile`, `Address`, `PayrollCode`. Read-only via the API
(list/get); writes generally not exposed. [INFERRED]

### Job state machine

```
[Planned/Quote] --start--> [In Progress] --complete--> [Completed] --invoice--> [Invoiced]
                                 \
                                  --cancel--> [Cancelled]
```

| Field            | Allowed Values (approx)                                  | Confidence                |
| ---------------- | -------------------------------------------------------- | ------------------------- |
| Job.`State`      | Planned / In Progress / Completed / Cancelled / Invoiced | [INFERRED — confirm live] |
| Invoice.`Status` | Draft / Approved / Paid                                  | [INFERRED — confirm live] |
| Time.`Billable`  | true / false (legacy XML may use `Yes`/`No`)             | [INFERRED]                |

> Use `/job.api/current` for active jobs (a dedicated endpoint) rather than filtering on
> `State`. The exact enum casing must be read from a live `job` / `invoice` / `time` payload.

---

## Pagination

- **Type:** page-number (`page` + `pagesize`) — [DOCUMENTED]
- **Default page size:** server default (commonly 100) — [INFERRED]
- **Max page size:** [UNKNOWN] — confirm live
- **Total count:** likely a `totalrecords`/count attribute on the collection (legacy XML exposes one) — [INFERRED]

**Parameters:**

| Parameter   | Type | Default | Description                                       |
| ----------- | ---- | ------- | ------------------------------------------------- |
| `page`      | int  | 1       | 1-based page index                                |
| `pagesize`  | int  | server  | Records per page                                  |
| `detailed`  | bool | false   | Summary vs full detail (embeds child collections) |
| `from`/`to` | date | —       | Date-range filter, compact `YYYYMMDD`             |

**Response structure (XML; JSON analogous):**

```xml
<Response>
  <Status>OK</Status>
  <Jobs page="1" pagesize="100" totalrecords="237">
    <Job> ... </Job>
  </Jobs>
</Response>
```

**Last page detection:** stop when the returned collection has **fewer than `pagesize`**
items, or when `page * pagesize >= totalrecords` (if a total is returned). [INFERRED]

> **No bulk endpoints and no async export.** Bulk extraction = paginate the `list` endpoints
> (exactly what Airbyte's connector does). [INFERRED]

---

## Rate Limits

| Scope   | Limit            | Window | Confidence                                                                                               |
| ------- | ---------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Global  | [UNKNOWN]        | —      | A "Rate Limiting" section exists in the v2 docs nav but exact numbers are gated and were not retrievable |
| Per-org | ~1000/hr + ~10/s | —      | [INFERRED — one community source cites these for the **legacy** API; unconfirmed for v2]                 |

**Headers:** [UNKNOWN] — capture response headers on the first live 200 and first 429.

**When exceeded:** Assume HTTP **429**; legacy endpoints may instead return a `200` with a
`<Status>Error</Status>` envelope. [INFERRED]

**Recommended strategy:** Exponential backoff + jitter on 429/5xx; cap concurrency; poll
conservatively (≥15 min) given the short token life. Confirm exact limits from the gated
"Rate Limiting" docs section or a support ticket before high-volume polling.

---

## Error Handling

> **Gotcha:** Legacy WorkflowMax frequently returns **HTTP 200** with `<Status>Error</Status>`
> in the body rather than a 4xx. **Parsers must inspect the `Status` field, not just the HTTP
> code.** [DOCUMENTED for legacy XML]

**Standard error format (legacy envelope — still likely on reused endpoints):**

```json
{ "Status": "Error", "ErrorDescription": "Invalid UUID supplied" }
```

XML equivalent: `<Response><Status>Error</Status><ErrorDescription>...</ErrorDescription></Response>`

Modern JSON errors are likely standard HTTP status + a `{ "message": "..." }` body, but this
is **not confirmed**. [INFERRED]

**Status codes:**

| Status                  | Meaning                                     | Retryable        | Recovery                                |
| ----------------------- | ------------------------------------------- | ---------------- | --------------------------------------- |
| 200 + `Status: "Error"` | Business/validation error in body           | No               | Read `ErrorDescription`                 |
| 400                     | Bad request                                 | No               | Fix params                              |
| 401                     | Expired/invalid access token                | Yes              | Refresh token, retry                    |
| 403                     | Missing `account_id` OR no 3rd-party access | No (until fixed) | Add header / enable staff access        |
| 404                     | Unknown UUID/resource (or wrong base host)  | No               | Verify identifiers; consider other host |
| 429                     | Rate limited (assumed)                      | Yes              | Backoff + retry                         |
| 5xx                     | Server error                                | Yes              | Retry with backoff                      |

---

## Webhooks / Events

**No webhook, WebSocket, or SSE support found** in the docs or any SDK. [INFERRED — none]

Use polling with `/{resource}.api/list` + `from`/`to` date-range filters. Entities carry
`WhenModified` / `WhenCreated` for change detection. Recommended interval: **≥15 min** (short
token life + unknown rate limits). [DOCUMENTED that `WhenModified`/`WhenCreated` exist]

---

## Known Limitations

1. **No live verification.** Base host (`api.workflowmax2.com` vs `api.workflowmax.com`),
   JSON-vs-XML default, exact field casing, and `State`/`Status` enum values are unconfirmed.
2. **Two coexisting generations.** Easy to accidentally wire the retired `api.xero.com` /
   `Xero-tenant-id` flow. This connector is WorkflowMax 2 (`oauth.workflowmax2.com` +
   `account_id`). Don't mix them.
3. **Short token life + scope gap.** Access tokens expire in ~12–30 min and the registry
   omits `offline_access`; reconnection prompts will be frequent until that scope is added.
4. **No bulk ops, no webhooks.** Single-record writes only; polling is the sole change-detection
   mechanism.
5. **Rate limits unknown.** A "Rate Limiting" section exists but values are gated.

---

## SDKs & Tooling

| SDK                                        | Language | Repository                                                      | Quality | Notes                                                                                         |
| ------------------------------------------ | -------- | --------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| XeroAPI Postman collection (official)      | n/a      | https://github.com/XeroAPI/workflowmax-postman-oauth2           | Good    | Authoritative auth + sample calls; **note: README documents the retired Xero-tenant-id flow** |
| XeroAPI .NET Core OAuth2 sample (official) | C#       | https://github.com/XeroAPI/workflowmax-dotnetcore-oauth2-sample | Good    | Reference for OAuth2 end-to-end                                                               |
| Airbyte source connector                   | Python   | https://docs.airbyte.com/integrations/sources/workflowmax       | Good    | Confirms OAuth2 + 16-stream entity list                                                       |
| `indemandly/workflowmax` (community)       | Node.js  | https://github.com/indemandly/workflowmax                       | Fair    | Legacy apiKey/accountKey XML model; endpoint paths only                                       |
| synchub data model                         | n/a      | https://www.synchub.io/connectors/workflowmax/datamodel         | Good    | Entity/field discovery                                                                        |

**Postman collection:** https://www.postman.com/xeroapi/xeroapi/collection/miwik51/workflowmax-oauth-2-0
**OpenAPI spec:** Advertised OpenAPI 3.0.3 — not retrievable without auth.

For Numa we will **not** vendor an SDK — calls go through the connectors `request` operation
with hand-built requests, consistent with the other OAuth2 connectors.

---

## Integration Path Assessment

**Recommended path:** **Direct API Only** (via the connectors `request` proxy operation).

**Justification:** WorkflowMax 2 is a PSA / job-management system exposing structured entities
(jobs, clients, contacts, time, invoices, staff) over OAuth2 REST. There is no browsable file
tree, so the Files / Data Connector paths do not apply. Wire it like the other Tier-2 OAuth2
business-system connectors (simPRO, Zoho CRM, MYOB): the connector stores the OAuth2 token in
the user vault, and the workspace agent reaches the API by issuing a `connectors(name="request", …)`
call. The backend injects `Authorization: Bearer …` (plus the required `account_id` header) and
forwards the call. No bespoke `list_files`/`download_file` surface is needed.

**Connector compatibility (file-connector methods — N/A for this API):**

| Connector Method  | API Endpoint | Feasibility              |
| ----------------- | ------------ | ------------------------ |
| list_files        | —            | none — not a file system |
| download_file     | —            | none                     |
| search_files      | —            | none                     |
| get_file_metadata | —            | none                     |

---

## Unknowns Requiring Live Testing

| Unknown                                             | Impact                | How to Verify                                                |
| --------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| Base host (`workflowmax2.com` vs `workflowmax.com`) | Every call's URL      | Run the official Postman collection / a trial-org call       |
| JSON vs XML default                                 | Response parsing      | Send `Accept: application/json`; inspect the body            |
| `account_id` header name (exact)                    | Auth on every call    | Decode the JWT, confirm the literal header name `account_id` |
| Access token lifetime                               | Refresh timing        | Read `expires_in` in the token response                      |
| Refresh token rotation                              | Session management    | Refresh once; check whether a new refresh token is returned  |
| `State` / `Status` enum casing                      | Filtering & rendering | `GET /job` and `GET /invoice` against a trial org            |
| Rate-limit numbers + 429 shape                      | Polling safety        | Read the gated "Rate Limiting" docs / open a support ticket  |

---

_Researched on 2026-05-29. Source: `00-api-investigation-questionnaire.md` + vendor docs._
