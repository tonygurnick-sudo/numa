---
api_name: 'isolved People Cloud API'
api_slug: 'isolved'
vendor: 'isolved (isolved HCM, LLC — Charlotte, NC, USA)'
website: 'https://www.isolvedhcm.com'
investigation_started: '2026-06-26'
investigator: 'Numa API Investigation Agent (third-party-integration corroboration, 2026-06-26)'
investigation_status: 'blocked' # auth model + capability surface corroborated across third-party integrators; the live /rest reference is login-walled, so token-path, scopes, and exact endpoint paths are NOT confirmed. Phase 2.4 authenticated-call gate NOT passed (no partner credentials).
documentation_quality: 'poor' # public docs are minimal; the authoritative /rest reference sits behind isolved Network partner login
api_types: [REST]
overall_confidence: 'low-medium'
blockers:
  - 'No isolved API Application credentials were available — every call needs a partner client_id/client_secret + a per-client grant, so NO live API call has been made.'
  - 'The authoritative endpoint reference (the per-tenant /rest docs) is behind isolved Network partner login. The token endpoint path, the exact scope/allowed-methods names, exact endpoint paths, pagination, and rate limits all need to be confirmed from those partner docs.'
generated_date: '2026-06-26'
---

# API Investigation Questionnaire: isolved People Cloud

> **Source:** This investigation corroborates isolved's API model across several independent
> third-party integrators that ship public, retrievable connector docs for isolved — **Finch**,
> **Merge**, **CozyROC** (SSIS templates), and **RoboMQ** — plus isolved's own public
> Network-partner pages. These sources agree on the auth model (OAuth2 **client-credentials**,
> per-tenant `*.myisolved.com` host, Bearer token on data calls) and the broad capability surface
> (Employees, Payroll, Deductions, Benefit Enrollment). They do **not** agree on — and mostly do
> not publish — the exact endpoint paths, the exact token-endpoint path, scope names, pagination,
> or rate limits, because those live in isolved's login-walled `/rest` partner reference.
>
> ⚠️ **NO AUTHENTICATED CALL has been made.** Every endpoint needs a partner API Application
> (`client_id`/`client_secret`) AND a per-client access grant inside the customer's isolved
> tenant. No partner credentials were available.
>
> **Confidence markers:** `[CORROBORATED]` = agreed across ≥2 independent third-party integrator
> docs · `[PARTNER-DOC]` = stated by one source / isolved partner material · `[VERIFY WITH PARTNER DOCS]`
> = the authoritative answer is in the login-walled `/rest` reference and was NOT confirmed here ·
> `[INFERRED]` = reasoning from the model · `[UNKNOWN]` = looked, could not find.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Authoritative API reference:** the per-tenant `/rest` docs served from the customer's own
  isolved host (e.g. `https://{tenant}.myisolved.com/rest/...`) — **login-walled behind isolved
  Network partner access.** Not retrievable without a partner account. [VERIFY WITH PARTNER DOCS]
- **isolved Network / Partner program:** the API is gated behind the **isolved Network** partner
  program — a partner registers an "API Application", completes an API Questionnaire, and isolved
  issues a `client_id` + `client_secret`. [PARTNER-DOC]
- **isolved University / Help:** customer-facing help describes the in-tenant admin steps
  (Security → Partner Users → Client Access; Production Utilities → Refresh System Data) needed to
  grant a partner integration access to a Client Code. [PARTNER-DOC]
- **Changelog / status page:** none found publicly [UNKNOWN].

### 1.2 Supplementary Sources [IMPORTANT]

- **Finch** (`tryfinch.com`) — documents isolved as an employment-systems provider; corroborates
  client-credentials auth and the HR/payroll/benefits object surface. [CORROBORATED]
- **Merge** (`merge.dev`) — HRIS unified API; lists isolved with Employees/Payroll/Benefits
  coverage. [CORROBORATED]
- **CozyROC** (SSIS isolved templates) — the most concrete public evidence of the request shape:
  the templates POST `grant_type=client_credentials` to mint a token and then send
  `Authorization: Bearer {{=token.Access}}` on data calls. [CORROBORATED — request shape]
- **RoboMQ** — documents an isolved connector explicitly as **"OAuth Client Credentials"**.
  [CORROBORATED — grant type]
- **Official SDKs / Postman / OpenAPI:** none found publicly [UNKNOWN — checked npm/PyPI/GitHub].

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                                      |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Authentication            | 3      | Grant type + Bearer pattern corroborated; exact token path + scope names walled [VERIFY]   |
| Endpoint reference        | 1      | Object surface known; exact paths live only in the walled `/rest` reference [VERIFY]       |
| Request/response examples | 1      | CozyROC shows the token request; no public data-call examples with real schemas            |
| Error documentation       | 1      | No published error-body schema; allowed-methods 403/404 behaviour is partner lore [VERIFY] |
| Rate limit documentation  | 1      | Nothing published [UNKNOWN]                                                                |
| Pagination documentation  | 1      | Not published [VERIFY WITH PARTNER DOCS]                                                   |
| Webhook documentation     | 1      | No evidence of webhooks; assume polling [UNKNOWN]                                          |
| SDKs / code examples      | 1      | No official SDKs                                                                           |
| Changelog / versioning    | 1      | None found                                                                                 |

**Overall documentation quality:** poor — the public surface establishes the _shape_ of the
integration (auth model, host pattern, object families) but not the _specifics_ (paths, scopes,
pagination, limits). Those require partner access.

### 1.4 Discovery Status [REQUIRED]

- [x] Identified the authentication method (OAuth2 **client-credentials**) [CORROBORATED]
- [x] Identified the host pattern (per-tenant `https://{tenant}.myisolved.com/rest/api`) [CORROBORATED]
- [x] Identified the capability surface (Employees, Payroll, Deductions, Benefit Enrollment) [CORROBORATED]
- [ ] Found the authoritative endpoint reference — **walled behind isolved Network partner login** [VERIFY]
- [ ] Found a machine-readable spec — **none public** [UNKNOWN]
- [ ] Found a working **authenticated** example — **NOT done; no partner credentials** [UNKNOWN]
- [ ] Confirmed the exact token-endpoint path — **NOT confirmed** [VERIFY WITH PARTNER DOCS]
- [ ] Confirmed scopes / allowed-methods whitelist names — **NOT confirmed** [VERIFY WITH PARTNER DOCS]
- [ ] Confirmed pagination + rate limits — **NOT confirmed** [VERIFY WITH PARTNER DOCS]

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** isolved People Cloud API (a.k.a. the isolved `/rest` API) [PARTNER-DOC]
- **Vendor / product:** isolved — HCM / payroll / HR / benefits / time platform for SMB and
  mid-market employers, sold heavily through a partner/reseller network. [CORROBORATED]
- **Current API version:** the `/rest/api` surface; no public version-segment scheme confirmed
  [VERIFY WITH PARTNER DOCS].
- **Base URL(s):** **per-tenant** — `https://{tenant}.myisolved.com/rest/api`, where `{tenant}` is
  the customer's isolved host label (examples seen in partner material: `rkl.myisolved.com`,
  `aee.myisolved.com`). The admin supplies the Instance URL; the API base is that host + `/rest/api`.
  [CORROBORATED — host pattern; exact `/rest/api` suffix VERIFY WITH PARTNER DOCS]
- **API type:** REST, JSON. [CORROBORATED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS; JSON request/response bodies. [INFERRED — standard; VERIFY]
- **URL structure pattern:** `https://{tenant}.myisolved.com/rest/api/{object}[/{id}]` — exact
  object paths NOT confirmed. [VERIFY WITH PARTNER DOCS]
- **Versioning strategy:** unknown; no public version header or path segment confirmed [VERIFY].
- **Required headers (data calls):**

| Header          | Value                   | Purpose                                            |
| --------------- | ----------------------- | -------------------------------------------------- |
| `Authorization` | `Bearer {access_token}` | the minted client-credentials token [CORROBORATED] |
| `Content-Type`  | `application/json`      | POST/PUT bodies [INFERRED]                         |
| `Accept`        | `application/json`      | standard [INFERRED]                                |

### 2.3 Authentication [REQUIRED] — the load-bearing finding

**OAuth 2.0 client-credentials grant. This is a COMPANY-LEVEL service credential, not a per-user
OAuth flow.** [CORROBORATED across CozyROC + RoboMQ + the integrator model]

- The admin's **company-level** `client_id` + `client_secret` (issued by isolved to the partner's
  API Application) are POSTed with `grant_type=client_credentials` to the **token endpoint** →
  isolved returns an **access token** → data calls carry `Authorization: Bearer {access_token}`.
- There is **NO per-user OAuth redirect/consent.** One service credential is shared by all of the
  client account's users. Numa mints the Bearer token server-side and re-mints it on expiry.
- **Evidence:** CozyROC SSIS templates send `Authorization: Bearer {{=token.Access}}` after a
  `client_credentials` token call; RoboMQ documents the connector as "OAuth Client Credentials".

| Property           | Value                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grant type         | `client_credentials` [CORROBORATED]                                                                                                                    |
| Token endpoint     | `{instance}/rest/api/token` — **exact path [VERIFY WITH PARTNER DOCS]** (could be `/token`, `/oauth/token`, `/rest/token`, etc.)                       |
| Token request body | `grant_type=client_credentials` (+ `client_id`/`client_secret`, sent either as form fields or HTTP Basic) [CORROBORATED grant; field placement VERIFY] |
| Credential owner   | the **partner company** (one credential, all users) [CORROBORATED]                                                                                     |
| Per-user consent   | **none** — no authorize URL, no redirect, no refresh token [CORROBORATED]                                                                              |
| Token type         | `Bearer` [CORROBORATED]                                                                                                                                |
| Token lifetime     | a typical OAuth `expires_in` (e.g. 3600s) — **exact value [VERIFY WITH PARTNER DOCS]**                                                                 |
| Refresh            | **none** — client-credentials has no refresh token; re-mint from `client_id`/`client_secret` on expiry [CORROBORATED]                                  |

**Scopes / allowed-methods whitelist (document prominently):** isolved **whitelists, per partner
integration, which methods/objects that integration may call.** A method the integration was not
granted returns **403/404**. The exact scope strings (if scopes are even passed at the token
endpoint) and the whitelist's granularity are **[VERIFY WITH PARTNER DOCS]** — but the _discipline_
is firm: do not assume an object is callable just because it exists in isolved; only the granted
methods work. [CORROBORATED — whitelist concept; exact names VERIFY]

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No isolved partner credentials were available, and no per-client grant
> exists. No `[CONFIRMED]` claims appear anywhere in this pack.

**Planned first call (once a partner credential + per-client grant exist):**

```http
# 1) mint a token (exact path VERIFY WITH PARTNER DOCS)
POST https://{tenant}.myisolved.com/rest/api/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={client_id}&client_secret={client_secret}

# → { "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }   (shape VERIFY)

# 2) smallest authenticated read — list a page of employees (exact path VERIFY WITH PARTNER DOCS)
GET https://{tenant}.myisolved.com/rest/api/employees?employment_status=ACTIVE
Authorization: Bearer {access_token}
Accept: application/json
```

- **Expected:** 200 with a page of employee objects. **403/404** if the integration was not granted
  that method, or the per-client access grant / "Refresh System Data" step has not been done.

- [ ] **GATE CHECK: First successful authenticated API call completed and documented** — **NOT DONE; blocked on partner credentials.**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> isolved is an HCM. The corroborated object families are **Employees, Payroll, Deductions,
> Benefit Enrollment**. Field-level schemas are **[VERIFY WITH PARTNER DOCS]** — do not fabricate
> them; GET a real record and mirror its fields before writing.

#### Entity: Employee (`Employee` object)

- **Path:** `/employees` (exact path VERIFY). The primary object.
- **Documented filter (corroborated):** filter by employment status, e.g.
  `employment_status=ACTIVE` (exact param name/casing/values VERIFY WITH PARTNER DOCS).
- **New hires:** creating an employee posts as a **Pending Employee** — a new hire enters a pending
  state and is finalised inside isolved, rather than appearing immediately as a fully active
  employee. [PARTNER-DOC — VERIFY semantics]
- **Key fields:** name, employee id, employment status, hire/term dates, department/location,
  comp — exact field names [VERIFY WITH PARTNER DOCS].

#### Entity: Payroll

- **Path:** payroll object(s) [VERIFY]. Read of payroll/pay data; write capability (if any) is
  partner-grant-gated. [CORROBORATED surface; paths VERIFY]

#### Entity: Deductions

- **Path:** deductions object(s) [VERIFY]. Read + some write (e.g. setting/maintaining employee
  deductions) subject to the allowed-methods grant. [CORROBORATED surface; paths VERIFY]

#### Entity: Benefit Enrollment

- **Path:** benefit-enrollment object(s) [VERIFY]. Read + some write (benefit elections /
  enrollment) subject to the grant. [CORROBORATED surface; paths VERIFY]

### 3.2 Entity Relationships [IMPORTANT]

```
Client Code (a single isolved company/legal entity inside the tenant)
  └── Employees ──┬── Payroll (pay records / runs)
                  ├── Deductions (per-employee)
                  └── Benefit Enrollment (elections)
```

The **Client Code** is the unit of access — the partner integration is granted access _per Client
Code_, not tenant-wide by default. [PARTNER-DOC]

### 3.3 State Machines [IMPORTANT]

- **New hire → Pending Employee → active employee** — a created employee lands in a pending state
  and is finalised in isolved. [PARTNER-DOC — VERIFY exact states/transitions]
- Other state machines (payroll run lifecycle, enrollment windows) [UNKNOWN — VERIFY].

### 3.4 Business Rules [IMPORTANT]

- **Allowed-methods whitelist is the dominant rule:** an object/method the integration was not
  granted returns 403/404. Capability is defined by the _grant_, not by what the API technically
  exposes. [CORROBORATED]
- **Per-client grant + "Refresh System Data" is mandatory** before any call against a Client Code
  succeeds (Phase 9). [PARTNER-DOC]
- **New hires are Pending** — do not expect an immediately-active employee on create. [PARTNER-DOC]
- Field/enum values (employment status, deduction codes, benefit plan codes) are **client-specific**
  — resolve/verify against the live tenant, never hardcode. [INFERRED]

### 3.5 Field Format Reference [IMPORTANT]

| Format   | Pattern                        | Notes                                               |
| -------- | ------------------------------ | --------------------------------------------------- |
| DateTime | ISO-8601 likely                | [VERIFY WITH PARTNER DOCS]                          |
| ID       | per-object employee/record ids | shape [VERIFY WITH PARTNER DOCS]                    |
| Enums    | client-specific code lists     | employment status, deduction/benefit codes [VERIFY] |
| Token    | opaque Bearer string           | from the client-credentials mint [CORROBORATED]     |

---

## Phase 4: Endpoint Catalog

> ⚠️ **Exact endpoint paths are NOT confirmed and must not be fabricated.** The authoritative
> catalog is the login-walled `/rest` reference. Below is the _object surface_ and the one
> _documented filter_, tagged for verification.

| Object             | Operations (corroborated surface) | Exact path                 | Notes                                                   |
| ------------------ | --------------------------------- | -------------------------- | ------------------------------------------------------- |
| Token (auth)       | POST (mint)                       | `/rest/api/token` [VERIFY] | `grant_type=client_credentials` [CORROBORATED]          |
| Employee           | read; create (→ Pending)          | `/employees` [VERIFY]      | filter `employment_status=ACTIVE` [CORROBORATED filter] |
| Payroll            | read (+ write if granted)         | [VERIFY]                   | grant-gated                                             |
| Deductions         | read + some write                 | [VERIFY]                   | grant-gated                                             |
| Benefit Enrollment | read + some write                 | [VERIFY]                   | grant-gated                                             |

**Deprecated endpoints:** none known [UNKNOWN].

---

## Phase 5: Query & Filter Capabilities

| Capability            | Supported? | Syntax                     | Notes                                             |
| --------------------- | ---------- | -------------------------- | ------------------------------------------------- |
| Filter by field value | yes (some) | `employment_status=ACTIVE` | only this filter is corroborated; others [VERIFY] |
| Filter by id          | likely     | path or query [VERIFY]     | [VERIFY WITH PARTNER DOCS]                        |
| Date-range filter     | [UNKNOWN]  | [VERIFY]                   | not published                                     |
| Full-text search      | [UNKNOWN]  | —                          | none evidenced                                    |
| Sort                  | [UNKNOWN]  | [VERIFY]                   | not published                                     |
| Pagination            | [UNKNOWN]  | [VERIFY]                   | scheme (offset/page/cursor) NOT confirmed         |

> **Only `employment_status=ACTIVE` is corroborated.** Everything else about query grammar must be
> confirmed from partner docs or observed live. Do not assume JobAdder-style `>`/`<` date prefixes.

---

## Phase 6: Pagination & Bulk Operations

- **Pagination type:** **[VERIFY WITH PARTNER DOCS]** — not published. Could be offset/limit, page
  number, or cursor. Observe the first live response envelope before building a paging loop.
- **Bulk operations:** none evidenced [UNKNOWN].

---

## Phase 7: Real-Time & Event-Driven

- **Webhooks:** none evidenced [UNKNOWN]. Assume **polling-first** for change detection.
- **WebSocket / SSE:** none [UNKNOWN].

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

| Scope  | Limit         | Window | Notes                                                     |
| ------ | ------------- | ------ | --------------------------------------------------------- |
| Global | **[UNKNOWN]** | —      | nothing published; capture headers on first call [VERIFY] |

- **Backoff:** treat 429 as authoritative; back off 2s → 10s → 30s with jitter; keep cadence
  conservative until limits are confirmed. [INFERRED — defensive default]

### 8.2 Error Handling [REQUIRED]

**Error-body shape: [UNKNOWN — needs live testing].** Parse defensively (status first, then JSON,
then raw text). Status semantics inferred / corroborated:

| HTTP Status | Meaning                                                                                                               | Recovery                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 401         | token missing/expired/invalid                                                                                         | re-mint the client-credentials token; if mint fails, fix the partner credential |
| 403         | **method not in the integration's allowed-methods whitelist**, OR the per-client grant / Refresh System Data not done | confirm the grant scope + the per-client access steps — NOT a token problem     |
| 404         | wrong path/id, OR an **ungranted** object surfaced as not-found                                                       | verify the path against partner docs; confirm the grant                         |
| 429         | rate limited [INFERRED]                                                                                               | backoff                                                                         |
| 5xx         | isolved-side error                                                                                                    | retry once; then surface                                                        |

> **403 and 404 are the signature failures** of the allowed-methods whitelist + per-client-grant
> model. Treat them as "not granted / not set up", not as "retry harder".

### 8.3 Idempotency & Async [IMPORTANT]

- No idempotency-key support evidenced [UNKNOWN]. GETs idempotent; treat creates as non-idempotent
  and search before retrying after a write timeout. The **Pending Employee** state means a create
  may have landed even if the response was lost. [INFERRED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected path:** **Direct API via the Numa native data connector (`request` operation)** —
registry `authType: oauth2` + `oauthAdapter: 'isolved'` (client-credentials) + `instanceUrlRequired`.
NOT Pipedream, NOT a Files connector (HCM records, not documents).

**Justification:** isolved is an OAuth2 client-credentials API on a per-tenant host. It fits the
native connector `request` surface — the agent issues REST calls and Numa injects a server-side
Bearer token. The credential is **company-level** (one client_id/secret), so there is no per-user
redirect.

> ⚠️ **Implementation status (HONEST):** the **registry entry already exists**
> (`connectorRegistry.ts` → `id: 'isolved'`) and the slug is registered in both native-connector
> lists. But the **backend client-credentials adapter is NOT yet implemented**, and **OAuthWizard
> does not yet collect/persist the Instance URL** for `oauth2` connectors. See `03-connector-setup.md`
> §"Implementation status" — this pack documents the intended design _and_ flags exactly what must
> be built before isolved is functional.

### 9.2 Connector Requirements [IMPORTANT]

- **Auth type:** `oauth2` with `oauthAdapter: 'isolved'` (client-credentials) — admin supplies
  company-level `client_id`/`client_secret`; NO per-user consent.
- **Per-tenant host:** `instanceUrlRequired: true` — the admin supplies the Instance URL
  (`https://{tenant}.myisolved.com`); the API base is that host + `/rest/api`; the token endpoint
  is `{instance}/rest/api/token` [VERIFY exact path].
- **Per-client prerequisite:** the customer's isolved admin grants the partner user access to the
  Client Code (Security → Partner Users → Client Access) and runs Refresh System Data.
- **Category:** HR & Workforce.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN (in scope, subject to the grant):** read Employees (with `employment_status` filter), read
Payroll/Deductions/Benefit Enrollment; create/maintain where the integration is granted write
(new hires post as Pending; deductions; benefit elections). Connection diagnostics via the smallest
granted read.

**CANNOT (encode in LLM rules):** set the `Authorization` header itself (backend-injected); call
objects/methods outside the allowed-methods grant (→403/404 — do not retry-loop); assume an
employee is active immediately after create (Pending); fabricate endpoint paths or the token path.

### 9.4 SDK / MCP Assessment [NICE-TO-HAVE]

No official SDKs, no MCP server, no public OpenAPI — raw REST via the generic `request` proxy.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1: sources identified (third-party integrators + partner pages); authoritative `/rest` reference walled
- [ ] Phase 2 **partial**: auth model corroborated; **first-call gate NOT passed**; token path + scopes [VERIFY]
- [x] Phase 3: object surface corroborated; field schemas + state details [VERIFY]
- [ ] Phase 4 **partial**: object surface known; **exact paths NOT confirmed** [VERIFY]
- [ ] Phases 5–6 **partial**: one filter corroborated; pagination [VERIFY]
- [x] Phase 7: no webhooks evidenced → polling-first
- [ ] Phase 8 **partial**: 403/404 whitelist semantics corroborated; rate limits + error bodies [UNKNOWN]
- [x] Phase 9: integration path selected; implementation gaps flagged

**Overall investigation confidence:** **low-medium** — the auth model, host pattern, capability
surface, and the allowed-methods/per-client-grant discipline are corroborated across independent
integrators; the exact paths, token path, scopes, pagination, and limits are walled and unverified.

**Known gaps that will reduce output quality:**

1. Exact token-endpoint path + token request field placement (form vs Basic) [VERIFY]
2. Exact endpoint paths for every object [VERIFY]
3. Scope / allowed-methods names + granularity [VERIFY]
4. Pagination scheme + default page size [VERIFY]
5. Rate limits + headers [UNKNOWN]
6. Error-body schema [UNKNOWN]
7. Field-level schemas for every object [VERIFY]
8. Token lifetime / whether scopes are passed at the token endpoint [VERIFY]

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire: **01-llm-api-rules** (per-tenant base-URL resolution,
client-credentials Bearer, allowed-methods whitelist discipline, 403/404 handling, do-not-fabricate
paths) · **01a-domain-model-reference** (object families + Pending Employee + Client Code) ·
**01b-query-patterns** (the one corroborated filter; pagination-unknown discipline) ·
**01c-mutation-patterns** (Pending Employee on create; grant-gated writes; confirm-before-write) ·
**01d-event-and-error-handling** (polling-first; 401 re-mint; 403/404 = grant problem) ·
**02-api-spec-investigation** (condensed) · **03-connector-setup** (real registry entry + the
to-be-built adapter/instance-URL gaps) · **04-connection-and-reauth** (NO per-user OAuth;
server-side client-credentials mint + re-mint; partner onboarding + per-client grant).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                        |
| ---------------------------- | ------------- | ---------- | ----------------------------------------------------------- |
| 01-llm-api-rules             | yes           | low-medium | exact paths + token path walled; whitelist discipline solid |
| 01a-domain-model-reference   | yes           | low-medium | object families solid; field schemas [VERIFY]               |
| 01b-query-patterns           | yes           | low        | one filter corroborated; pagination unknown                 |
| 01c-mutation-patterns        | yes           | low        | Pending Employee corroborated; write schemas [VERIFY]       |
| 01d-event-and-error-handling | yes           | low-medium | 403/404 model corroborated; error bodies + limits unknown   |
| 02-api-spec-investigation    | yes           | low-medium | condensed; same gaps                                        |
| 03-connector-setup           | yes           | medium     | registry entry is real; adapter/instance-URL are to-build   |
| 04-connection-and-reauth     | yes           | medium     | client-credentials lifecycle clear; token path [VERIFY]     |

---

_Compiled 2026-06-26 from third-party isolved integrator docs (Finch, Merge, CozyROC, RoboMQ) and
isolved Network partner material. **No authenticated call has been made.** The authoritative `/rest`
reference is login-walled — confirm every `[VERIFY WITH PARTNER DOCS]` item against it before first
customer use._
