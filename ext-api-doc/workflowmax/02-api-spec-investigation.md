---
api_name: WorkflowMax (by Xero)
api_slug: workflowmax
generation: WorkflowMax 2 (OAuth2 tier — a product generation LABEL, NOT a URL path segment; do not write /v2/ except on the documented modern write paths below)
base_url: https://api.workflowmax2.com [INFERRED — confirm live; legacy api.workflowmax.com may also serve the same paths]
auth: OAuth2 (authorization_code + refresh_token), Bearer {token} + mandatory account_id header (Org UUID from JWT)
call_surface: HTTP via the connector `request` operation (Direct-API). NOT a file store. No GraphQL/SOAP/WebSocket. No MCP.
spec_format: OpenAPI 3.0.3 (advertised; gated behind auth — not retrieved)
spec_url: https://api-docs.workflowmax.com/v2/workflowmax-api-v2 (interactive API Explorer)
docs_url: https://api-docs.workflowmax.com/v2
date_researched: 2026-05-29
confidence: NO live call made. [CONFIRMED]=verified against source we hold · [DOCUMENTED]=official/vendor docs · [INFERRED]=deduced from SDKs/examples/behaviour · [UNKNOWN]=undetermined. Treat anything not [DOCUMENTED] as provisional; lock down from the first real response.
---

# WorkflowMax (by Xero) — API Specification & Investigation

Condensed dev reference (from `00-api-investigation-questionnaire.md`). Everything needed to integrate, in one place.

## ⚠️ Two API generations — do not conflate

This doc is scoped to the **new "WorkflowMax 2"** generation, because the connector registry points at `oauth.workflowmax2.com`.

| Trait              | Legacy "WorkflowMax by Xero" (v3) — RETIRED      | **New "WorkflowMax 2" (this doc)**                        |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------- |
| Status             | retired ~June 2024 for new connections           | current — `app.workflowmax2.com` users                    |
| Authorize / token  | `login.xero.com` / `identity.xero.com`           | `oauth.workflowmax2.com/oauth/authorize` + `/oauth/token` |
| Org-scoping header | `Xero-tenant-id`                                 | **`account_id`** (Org ID from the access JWT)             |
| Resource base host | `https://api.xero.com/workflowmax/3.0/`          | `https://api.workflowmax2.com/` [INFERRED]                |
| Data format        | XML (`<Response><Status>OK</Status>…`)           | JSON via `Accept: application/json` [INFERRED]            |
| Endpoint shape     | `{resource}.api/{action}` e.g. `job.api/current` | UUID/REST e.g. `GET /job`, `GET /job/{UUID}` [DOCUMENTED] |

> Do NOT wire against `identity.xero.com` / `Xero-tenant-id` / `api.xero.com` — that's the retired generation. The registry is correct: this is WorkflowMax 2.

## Overview

- **Vendor:** Xero Limited (WorkflowMax product line; older artifacts brand it "WorkflowMax by BlueRock").
- **API type:** REST [DOCUMENTED]. PSA / job-management for service businesses (agencies, consultancies, trades). Exposes structured entities — jobs, clients, contacts, invoices, time entries, staff, quotes, purchase orders, suppliers, leads, costs — over OAuth2 REST. **No browsable file tree** — action/query API, not a file store.
- **Base URL:** `https://api.workflowmax2.com/` [INFERRED] (parallels `oauth.workflowmax2.com`; confirm on first live call; legacy `api.workflowmax.com` may also serve the same paths).
- **Data format:** JSON (modern, via `Accept: application/json`) or XML (legacy default / write bodies). [XML legacy default DOCUMENTED; JSON support INFERRED]
- **Sandbox:** no dedicated host — use a free WorkflowMax **trial org** with hand-entered test data [INFERRED].
- **OpenAPI spec:** advertised OpenAPI 3.0.3 via the API Explorer; **not retrievable without auth** (docs portal 403s automated fetch). **Status page:** rolls up under Xero [UNKNOWN].
- **Links:** docs `https://api-docs.workflowmax.com/v2` · Explorer `https://api-docs.workflowmax.com/api-runner/workflowmax/workflowmax-api-v2` · auth guide `https://support.workflowmax.com/hc/en-us/articles/28754786654233-API-authentication`

## Authentication — OAuth 2.0 (authorization_code + refresh_token)

Authorization-code flow on the WorkflowMax 2 identity host. The access token is a **JWT** whose claims include the authenticated **Org ID** — replay that Org ID as the **`account_id` header** on every API call. [DOCUMENTED]

Headers (every call): `Authorization: Bearer {access_token}` · `account_id: {org_uuid}` (Org ID from the JWT) · `Accept: application/json` (omit/use `application/xml` for legacy XML).

| Parameter         | Value                                                                               | Confidence                              |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| Grant type        | `authorization_code` + `refresh_token`                                              | [DOCUMENTED]                            |
| Authorization URL | `https://oauth.workflowmax2.com/oauth/authorize`                                    | [CONFIRMED — registry `oauth.authUrl`]  |
| Token URL         | `https://oauth.workflowmax2.com/oauth/token`                                        | [CONFIRMED — registry `oauth.tokenUrl`] |
| Revocation URL    | not documented                                                                      | [UNKNOWN]                               |
| Token lifetime    | access token ~12-30 min (XeroAPI README ~12m; community Laravel ~30m) — short       | [DOCUMENTED — conflicting, both short]  |
| Refresh           | `grant_type=refresh_token` against token URL; **requires `offline_access` granted** | [DOCUMENTED]                            |
| PKCE              | No (confidential web app — client secret held)                                      | [INFERRED]                              |

Scopes: `openid`, `profile`, `email` (in registry string) · `workflowmax` (**the functional scope** [DOCUMENTED]) · `offline_access` (**issues a refresh token — currently MISSING from registry**).

> **⚠️ KNOWN GAP — `offline_access` missing.** Registry scope string is exactly `openid profile email workflowmax` [CONFIRMED from `connectorRegistry.ts`]. Vendor docs + a community Laravel impl: a refresh token is only issued with `offline_access`; access tokens last ~30 min. Without it the connection dies every ~12-30 min, needing full re-consent. The official WorkflowMax 2 authorize example uses `scope=openid profile email workflowmax offline_access` + `prompt=consent`. **Recommend adding `offline_access` before go-live.** [DOCUMENTED]

Obtaining `account_id` (Org ID): (1) complete the `authorization_code` exchange with params in the **request body** (form-encoded — NOT headers); (2) decode the returned `access_token` JWT to read the org's **Org ID**; (3) send it as the `account_id` header on every call — missing it → 401/403 [DOCUMENTED]. If the JWT contains no Org ID, the exchange was done with params as headers. The connecting staff member must also have **"Authorise 3rd Party Full Access"** on their staff record or calls are rejected. [DOCUMENTED]

## Endpoint Catalog

> Two shapes coexist. Legacy `{resource}.api/{action}` paths are reused + documented in community SDKs; modern v2 REST/UUID paths are in the `api-docs.workflowmax.com/v2` object pages. All paths require live confirmation of base host + format. All endpoints Auth=Yes. **Confidence = [DOCUMENTED] unless a row tags otherwise.** Modern write paths carry literal `/v2/` (label, not a generic version prefix).

| Method | Legacy                          | Modern v2                        | Purpose                          | Pag. | Idmp. | Confidence note                                                                                          |
| ------ | ------------------------------- | -------------------------------- | -------------------------------- | ---- | ----- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/job.api/list`                 | `GET /job`                       | list jobs                        | Yes  | Yes   |                                                                                                          |
| GET    | `/job.api/current`              | —                                | list active jobs only            | Yes  | Yes   |                                                                                                          |
| GET    | `/job.api/get`                  | `GET /job/{UUID}`                | get one job                      | No   | Yes   |                                                                                                          |
| POST   | `/job.api/add`                  | `POST /v2/jobs`                  | create job                       | No   | No    | v2 path from portal                                                                                      |
| PUT    | `/job.api/update`               | `PUT /v2/jobs/{UUID}`            | update job                       | No   | Yes   | v2 path from portal                                                                                      |
| DELETE | —                               | `DELETE /v2/jobs/{UUID}`         | delete job                       | No   | Yes   | v2 path from portal                                                                                      |
| GET    | —                               | `GET /v2/jobs/{UUID}/timesheets` | job timesheets                   | part | Yes   | v2 path from portal                                                                                      |
| GET    | `/client.api/list`              | `GET /client`                    | list clients                     | Yes  | —     |                                                                                                          |
| GET    | `/client.api/get`               | `GET /client/{UUID}`             | get one client                   | No   | —     |                                                                                                          |
| POST   | `/client.api/add`               | —                                | create client                    | No   | —     | via community Node SDK                                                                                   |
| PUT    | `/client.api/update`            | —                                | update client                    | No   | —     | via community Node SDK                                                                                   |
| POST   | `/client.api/archive`           | —                                | **archive client (destructive)** | No   | —     | via community Node SDK                                                                                   |
| DELETE | `/client.api/delete`            | —                                | **delete client (destructive)**  | No   | —     | via community Node SDK                                                                                   |
| GET    | `/contact.api/*` (under client) | —                                | list/manage contacts             | part | —     | [INFERRED]; CRUD via the client resource, not a standalone top-level resource; links via `ClientContact` |
| GET    | `/invoice.api/list`             | `GET /invoice`                   | list invoices                    | Yes  | —     | Airbyte `invoicelist`                                                                                    |
| GET    | `/invoice.api/current`          | —                                | current/outstanding invoices     | Yes  | —     | Airbyte `invoice_current`                                                                                |
| GET    | `/invoice.api/get`              | `GET /invoice/{UUID}`            | get one invoice                  | No   | —     | [INFERRED]                                                                                               |
| GET    | `/time.api/list`                | `GET /time`                      | list time entries                | Yes  | —     | Airbyte `timelist`                                                                                       |
| GET    | `/time.api/get`                 | `GET /time/{UUID}`               | get one time entry               | No   | —     | [INFERRED]                                                                                               |
| POST   | `/time.api/add`                 | —                                | log time                         | No   | —     | [INFERRED]                                                                                               |
| GET    | `/staff.api/list`               | `GET /staff`                     | list staff                       | Yes  | —     | best low-risk first call                                                                                 |
| GET    | `/staff.api/get`                | `GET /staff/{UUID}`              | get one staff                    | No   | —     | [INFERRED]                                                                                               |
| GET    | `/quote.api/list`               | —                                | list quotes                      | —    | —     | [INFERRED]                                                                                               |
| GET    | `/purchaseorder.api/list`       | —                                | list purchase orders             | —    | —     | [INFERRED] Airbyte `purchaseorderlist`                                                                   |
| GET    | `/supplier.api/list`            | —                                | list suppliers                   | —    | —     | [INFERRED] Airbyte `supplierlist`                                                                        |
| GET    | `/lead.api/list`                | —                                | list leads                       | —    | —     | `from`/`to` filters                                                                                      |
| GET    | `/lead.api/current`             | —                                | current leads                    | —    | —     |                                                                                                          |
| GET    | `/lead.api/categories`          | —                                | lead categories                  | —    | —     |                                                                                                          |
| GET    | `/cost.api/list`                | —                                | list costs                       | —    | —     | [INFERRED] Airbyte `costlist`                                                                            |
| GET    | `/categories.api/list`          | —                                | list categories                  | —    | —     | reference data, cacheable                                                                                |

No GraphQL/SOAP/WebSocket surface — REST only [INFERRED].

## Data Models

> Full field tables (types, req/writable, examples) in `01a-domain-model-reference.md`. Below: entity key-fields + relationships + enums (the dev-spec summary). Field-level detail [INFERRED] until confirmed live. Every entity carries a stable `UUID` (link key) + a human `ID` (`J000123`). Casing: PascalCase.

- **Job:** `UUID`,`ID`,`Name`(req),`Description`,`ClientUUID`(req),`State`,`StartDate`,`DueDate`,`Budget`,`ManagerUUID`,`PartnerUUID`,`ApprovedQuoteUUID`. Rel: Client N:1 (`ClientUUID`); JobTask 1:N; Time 1:N; JobCost 1:N; Staff N:M (assignee); Invoice 1:N.
- **Client:** `UUID`,`Name`(req),`Email`,`Address`/`City`/`PostCode`/`Country`,`Phone`,`AccountManagerUUID`,`JobManagerUUID`,`TypePaymentTerm`.
- **Contact:** `UUID`,`Name`,`Email`,`Phone`,`Mobile`,`Position`,`Salutation`,`IsPrimary`. Linked to a client via `ClientContact`.
- **Invoice:** `UUID`/`ID`,`Type`,`Status`,`Date`,`DueDate`,`Amount`,`AmountTax`,`AmountPaid`,`ClientUUID` + `InvoiceTask[]`/`InvoiceCost[]`/`InvoicePayment[]` lines. `Amount`/`AmountTax`/`AmountPaid` are computed/read-only roll-ups.
- **Time:** `UUID`,`JobID`/`JobUUID`,`StaffMemberUUID`,`TaskUUID`,`Date`,`Minutes`,`Billable`,`InvoiceUUID` (set once billed),`Note`.
- **Staff:** `UUID`,`Name`,`Email`,`Phone`,`Mobile`,`Address`,`PayrollCode`. Read-only via the API (list/get).

Job state machine: `[Planned/Quote] --start--> [In Progress] --complete--> [Completed] --invoice--> [Invoiced]` · `--cancel--> [Cancelled]`.

Enums (approx — confirm live): Job.`State` = Planned/In Progress/Completed/Cancelled/Invoiced · Invoice.`Status` = Draft/Approved/Paid · Time.`Billable` = true/false (legacy XML may use Yes/No). Use `/job.api/current` for active jobs rather than filtering `State`; read exact enum casing from a live `job`/`invoice`/`time` payload.

## Pagination

Page-number (`page` 1-based + `pagesize`, default = server commonly 100, max [UNKNOWN]). Total likely via a `totalrecords`/count attribute on the collection (legacy XML exposes one).

| Parameter   | Type | Default | Description                                       |
| ----------- | ---- | ------- | ------------------------------------------------- |
| `page`      | int  | 1       | 1-based page index                                |
| `pagesize`  | int  | server  | records per page                                  |
| `detailed`  | bool | false   | summary vs full detail (embeds child collections) |
| `from`/`to` | date | —       | date-range filter, compact `YYYYMMDD`             |

Response (XML; JSON analogous): `<Response><Status>OK</Status><Jobs page="1" pagesize="100" totalrecords="237"><Job>...</Job></Jobs></Response>`. Last-page: stop when the collection has fewer than `pagesize` items, or `page*pagesize >= totalrecords`. **No bulk endpoints, no async export** — bulk extraction = paginate the `list` endpoints (what Airbyte does).

## Rate Limits

Global [UNKNOWN] — a "Rate Limiting" section exists in the v2 docs nav but numbers are gated/not retrievable. Per-org ~1000/hr + ~10/s [INFERRED — community source, for the **legacy** API, unconfirmed for v2]. Headers [UNKNOWN] — capture on first live 200 and first 429. Exceeded: assume HTTP 429; legacy may return a `200` with `<Status>Error</Status>`. Strategy: exponential backoff + jitter on 429/5xx; cap concurrency; poll ≥15 min given short token life; confirm exact limits from the gated docs/support before high-volume polling.

## Error Handling

> **Gotcha:** legacy returns **HTTP 200** with `<Status>Error</Status>` rather than a 4xx — parsers must inspect the `Status` field, not just the HTTP code. [DOCUMENTED for legacy XML]

Format (legacy envelope, likely on reused endpoints): `{"Status":"Error","ErrorDescription":"Invalid UUID supplied"}` (XML: `<Response><Status>Error</Status><ErrorDescription>...</ErrorDescription></Response>`). Modern JSON errors likely standard HTTP + `{"message":"..."}` [INFERRED].

| Status                 | Meaning                                     | Retryable        | Recovery                                |
| ---------------------- | ------------------------------------------- | ---------------- | --------------------------------------- |
| 200 + `Status:"Error"` | business/validation error in body           | No               | read `ErrorDescription`                 |
| 400                    | bad request                                 | No               | fix params                              |
| 401                    | expired/invalid access token                | Yes              | refresh token, retry                    |
| 403                    | missing `account_id` OR no 3rd-party access | No (until fixed) | add header / enable staff access        |
| 404                    | unknown UUID/resource (or wrong base host)  | No               | verify identifiers; consider other host |
| 429                    | rate limited (assumed)                      | Yes              | backoff + retry                         |
| 5xx                    | server error                                | Yes              | retry with backoff                      |

## Webhooks / Events

No webhook, WebSocket, or SSE support found in docs or any SDK [INFERRED — none]. Use polling with `/{resource}.api/list` + `from`/`to` date filters; entities carry `WhenModified`/`WhenCreated` for change detection. Interval ≥15 min (short token life + unknown rate limits). [`WhenModified`/`WhenCreated` exist: DOCUMENTED]

## Known Limitations

1. **No live verification** — base host (`workflowmax2.com` vs `workflowmax.com`), JSON-vs-XML default, field casing, and `State`/`Status` enums unconfirmed.
2. **Two coexisting generations** — easy to accidentally wire the retired `api.xero.com`/`Xero-tenant-id` flow. This is WorkflowMax 2 (`oauth.workflowmax2.com` + `account_id`).
3. **Short token life + scope gap** — tokens expire ~12-30 min; registry omits `offline_access`; reconnection prompts frequent until added.
4. **No bulk ops, no webhooks** — single-record writes only; polling is the sole change-detection mechanism.
5. **Rate limits unknown** — a "Rate Limiting" section exists but values are gated.

## SDKs & Tooling

| SDK                                        | Language | Repository                                              | Quality | Notes                                                                                   |
| ------------------------------------------ | -------- | ------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| XeroAPI Postman collection (official)      | n/a      | github.com/XeroAPI/workflowmax-postman-oauth2           | Good    | authoritative auth + sample calls; **README documents the retired Xero-tenant-id flow** |
| XeroAPI .NET Core OAuth2 sample (official) | C#       | github.com/XeroAPI/workflowmax-dotnetcore-oauth2-sample | Good    | OAuth2 end-to-end reference                                                             |
| Airbyte source connector                   | Python   | docs.airbyte.com/integrations/sources/workflowmax       | Good    | confirms OAuth2 + 16-stream entity list                                                 |
| `indemandly/workflowmax` (community)       | Node.js  | github.com/indemandly/workflowmax                       | Fair    | legacy apiKey/accountKey XML model; endpoint paths only                                 |
| synchub data model                         | n/a      | synchub.io/connectors/workflowmax/datamodel             | Good    | entity/field discovery                                                                  |

Postman: `https://www.postman.com/xeroapi/xeroapi/collection/miwik51/workflowmax-oauth-2-0`. OpenAPI spec: advertised OpenAPI 3.0.3 — not retrievable without auth.

For Numa we will **not** vendor an SDK — calls go through the connector's `request` operation with hand-built requests, consistent with the other OAuth2 connectors.

## Integration Path Assessment

**Recommended: Direct API Only** (via the connector's `request` operation).

WorkflowMax 2 is a PSA / job-management system exposing structured entities over OAuth2 REST. No browsable file tree → the Files / Data Connector paths do not apply. Wire it like the other Tier-2 OAuth2 business-system connectors (simPRO, Zoho CRM, MYOB): connector stores the OAuth2 token in the user vault; the workspace agent reaches the API via a `connectors(name="request", …)` call; the backend injects `Authorization: Bearer …` + the required `account_id` header and forwards. No bespoke `list_files`/`download_file` surface.

File-connector methods — N/A: `list_files`/`download_file`/`search_files`/`get_file_metadata` all = none (not a file system).

## Unknowns Requiring Live Testing

| Unknown                                             | Impact                | How to verify                                                |
| --------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| Base host (`workflowmax2.com` vs `workflowmax.com`) | every call's URL      | run the official Postman collection / a trial-org call       |
| JSON vs XML default                                 | response parsing      | send `Accept: application/json`; inspect the body            |
| `account_id` header name (exact)                    | auth on every call    | decode the JWT, confirm the literal header name `account_id` |
| Access token lifetime                               | refresh timing        | read `expires_in` in the token response                      |
| Refresh token rotation                              | session management    | refresh once; check whether a new refresh token is returned  |
| `State`/`Status` enum casing                        | filtering & rendering | `GET /job` and `GET /invoice` against a trial org            |
| Rate-limit numbers + 429 shape                      | polling safety        | read the gated "Rate Limiting" docs / open a support ticket  |

_Researched 2026-05-29. Source: `00-api-investigation-questionnaire.md` + vendor docs._
