---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
vendor: 'Zoho Corporation'
website: 'https://www.zoho.com/crm/'
investigation_started: '2026-04-23'
investigator: 'Claude Code (Opus 4.7) — desk research against public docs'
investigation_status: 'in-progress' # blocked on live call (no test credentials yet)
documentation_quality: 'excellent'
api_types: ['REST']
overall_confidence: 'medium' # DOCUMENTED-level across the board; no [CONFIRMED] gate yet
blockers:
  - 'Phase 2.4 gate (first successful call) not satisfied — no test PAT / OAuth client was available during desk research.'
---

# API Investigation Questionnaire: Zoho CRM

> Desk-research fill. Every downstream file cites this. Confidence markers:
> `[CONFIRMED]` live test, `[DOCUMENTED]` from official docs, `[INFERRED]`, `[UNKNOWN]`.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://www.zoho.com/crm/developer/docs/api/v8/` [DOCUMENTED]
- **API reference / endpoint catalog URL:** same root; left nav lists every endpoint. [DOCUMENTED]
- **Authentication guide URL:** `https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html` [DOCUMENTED]
- **Changelog / release notes URL:** `https://www.zoho.com/crm/developer/docs/api/v8/release-notes.html` [INFERRED — path is standard for Zoho]
- **Status page URL:** `https://status.zoho.com/` (cross-product status) [DOCUMENTED]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** Not published by Zoho. [DOCUMENTED — absence]
- **Postman collection:** `https://developer.zoho.com/postman-collection` (v2 collection available publicly) [INFERRED]
- **Official SDKs:**
  - Python: `https://github.com/zoho/zohocrm-python-sdk-8.0` [DOCUMENTED]
  - Node.js: `https://github.com/zoho/zohocrm-nodejs-sdk-8.0` [DOCUMENTED]
  - Java / PHP / C# / Go also maintained at `github.com/zoho/...` [DOCUMENTED]
- **Community forums:** `https://help.zoho.com/portal/en/community/zoho-crm/zoho-crm-developers` [DOCUMENTED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                            |
| ------------------------- | ------ | ---------------------------------------------------------------- |
| Authentication            | 5      | Every grant type, every region, worked examples.                 |
| Endpoint reference        | 5      | Complete catalog with request/response examples.                 |
| Request/response examples | 5      | curl + JSON for every endpoint.                                  |
| Error documentation       | 4      | Error codes per endpoint; partial 207 behaviour explained.       |
| Rate limit documentation  | 4      | Credit model is clear; concurrency limits per edition published. |
| Pagination documentation  | 5      | `page`/`per_page` + `page_token` for >2000 records both covered. |
| Webhook documentation     | 3      | "Notifications API" exists; docs scattered across modules.       |
| SDKs / code examples      | 5      | 6+ SDKs all actively maintained.                                 |
| Changelog / versioning    | 4      | Release notes + breaking change warnings per version.            |

**Overall documentation quality:** excellent

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no OpenAPI/Swagger spec (confirmed: none published)
- [x] Identified authentication method (OAuth 2.0, authorization_code + refresh_token)
- [x] Found at least one working example (from vendor docs; not executed)
- [x] Identified rate limit information (credit model + concurrency)
- [x] Identified pagination approach (query-string, hybrid page+token)
- [x] Checked for webhook/event support (Notifications API)
- [x] Checked for official SDKs (multiple, well-maintained)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Zoho CRM API [DOCUMENTED]
- **Vendor / company:** Zoho Corporation [DOCUMENTED]
- **Current API version:** `v8` (released October 2024; v7 and v2 still supported for backward compat) [DOCUMENTED]
- **Base URLs (region-pinned):**
  - AU: `https://www.zohoapis.com.au/crm/v8/` [DOCUMENTED]
  - US: `https://www.zohoapis.com/crm/v8/` [DOCUMENTED]
  - EU: `https://www.zohoapis.eu/crm/v8/` [DOCUMENTED]
  - IN: `https://www.zohoapis.in/crm/v8/` [DOCUMENTED]
  - JP: `https://www.zohoapis.jp/crm/v8/` [DOCUMENTED]
  - CN: `https://www.zohoapis.com.cn/crm/v8/` [DOCUMENTED]
  - Sandbox: Same hosts; sandbox mode is a per-org setting activated in the Zoho UI. No separate host. [DOCUMENTED]
- **API type:** REST [DOCUMENTED]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/2 served by Zoho edge) [INFERRED]
- **Data format:** JSON [DOCUMENTED]
- **Content-Type header(s):** `application/json` for writes; multipart/form-data for file uploads [DOCUMENTED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `https://www.zohoapis.{region}/crm/v8/{module}/{id?}/{action?}` [DOCUMENTED]
- **Versioning strategy:** URL path — `/crm/v8/` [DOCUMENTED]
- **CORS policy:** Restricted; browser-origin access requires the Zoho JS SDK which handles CORS via postMessage. Direct browser fetch is blocked. [INFERRED]

**Required headers (all requests):**

| Header          | Value                            | Purpose                              |
| --------------- | -------------------------------- | ------------------------------------ |
| `Authorization` | `Zoho-oauthtoken {access_token}` | Auth. **Not** `Bearer`. [DOCUMENTED] |
| `Content-Type`  | `application/json` (for writes)  |                                      |

### 2.3 Authentication [REQUIRED]

- **Auth method:** OAuth 2.0 [DOCUMENTED]
- **Auth location:** Header [DOCUMENTED]
- **Auth header format:** `Authorization: Zoho-oauthtoken {access_token}` — Zoho-specific scheme, NOT `Bearer`. [DOCUMENTED]

**For OAuth 2.0:**

- **Grant types supported:** `authorization_code`, `refresh_token`, `client_credentials` (via Self Client flow) [DOCUMENTED]
- **Authorization URL (AU):** `https://accounts.zoho.com.au/oauth/v2/auth` [DOCUMENTED]
- **Token URL (AU):** `https://accounts.zoho.com.au/oauth/v2/token` [DOCUMENTED]
- **Revocation URL (AU):** `https://accounts.zoho.com.au/oauth/v2/token/revoke` [DOCUMENTED]
- **Host swaps by region** (accounts host + API host are in the same region): `.com.au` / `.com` / `.eu` / `.in` / `.jp` / `.com.cn` [DOCUMENTED]
- **⚠️ Canada special case:** accounts host is **`accounts.zohocloud.ca`** (NOT `accounts.zoho.ca`); API host is `www.zohoapis.ca`. The naive `accounts.zoho.{region}` substitution pattern breaks for CA. [VERIFIED 2026-05-19 against https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html]

**Required scopes:**

| Scope                           | Purpose                          | Required?         |
| ------------------------------- | -------------------------------- | ----------------- |
| `ZohoCRM.modules.ALL`           | CRUD across all standard modules | Yes (broad path)  |
| `ZohoCRM.modules.{mod}.READ`    | Read-only on a specific module   | Alternative       |
| `ZohoCRM.modules.{mod}.CREATE`  | Create on a specific module      | Alternative       |
| `ZohoCRM.modules.{mod}.UPDATE`  | Update on a specific module      | Alternative       |
| `ZohoCRM.modules.{mod}.DELETE`  | Delete on a specific module      | Alternative       |
| `ZohoCRM.users.READ`            | Read user directory              | Yes (for auth/me) |
| `ZohoCRM.org.READ`              | Read org metadata                | Yes (for setup)   |
| `ZohoCRM.settings.modules.READ` | Read module metadata             | Recommended       |
| `ZohoCRM.settings.fields.READ`  | Read field metadata              | Recommended       |
| `ZohoCRM.notifications.ALL`     | Subscribe/unsubscribe webhooks   | Optional          |
| `ZohoCRM.coql.READ`             | Run COQL queries                 | Optional          |

Numa's default bundle: `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ,ZohoCRM.coql.READ`. [DOCUMENTED — scope names]

- **Token lifetime:** access token = 1 hour (3600s); refresh token = unlimited until revoked. [DOCUMENTED]
- **Refresh token behavior:** Standard `refresh_token` grant; **refresh token is NOT rotated** on use (same refresh token keeps working). [DOCUMENTED]
- **PKCE required?** No (not advertised for server-side flow). [DOCUMENTED]
- **State parameter:** Not required by Zoho but recommended by our OAuth wizard. [INFERRED]
- **Redirect URI restrictions:** Must match exactly what's registered in `api-console.zoho.com.{region}`. HTTPS required for production. [DOCUMENTED]
- **Offline access:** Must pass `access_type=offline` on authorize OR you will NOT receive a refresh_token. Also pass `prompt=consent` to force the consent screen on every call so the user can grant broader scopes on reconnect. [DOCUMENTED]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

**Blocked on desk research.** No live PAT or admin-registered OAuth client was available during this investigation. The call below is the exact shape from Zoho's docs and what the agent must attempt as the Phase 2 live-gate before claiming [CONFIRMED] quality.

**Endpoint planned for first call:**

```http
GET /crm/v8/org HTTP/1.1
Host: www.zohoapis.com.au
Authorization: Zoho-oauthtoken 1000.xxx...xxx
Accept: application/json
```

**Documented response shape** (verbatim from vendor docs):

```json
{
  "org": [
    {
      "country": "AU",
      "photo_id": null,
      "city": "Melbourne",
      "description": "...",
      "mc_status": false,
      "gapps_enabled": false,
      "domain_name": "example_au",
      "translation_enabled": false,
      "street": "...",
      "alias": "...",
      "currency": "AUD",
      "id": "410405000000xxxxxx",
      "state": "VIC",
      "fax": null,
      "employee_count": "50-99",
      "zip": "3000",
      "website": "https://example.com",
      "currency_symbol": "$",
      "mobile": null,
      "currency_locale": "en_AU",
      "primary_zuid": "410405xxx",
      "zia_portal_id": null,
      "time_zone": "Australia/Melbourne",
      "zgid": "410405xxx",
      "country_code": "AU",
      "license_details": {
        "paid_expiry": "...",
        "users_license_purchased": 10,
        "trial_type": null,
        "trial_expiry": null,
        "paid": true,
        "paid_type": "enterprise"
      },
      "phone": "...",
      "company_name": "Example Pty Ltd",
      "primary_email": "admin@example.com",
      "privacy_settings": true,
      "primary_contact_id": "410405xxx",
      "hierarchy_preferences": { "type": "role_hierarchy" },
      "iso_code": "AUD"
    }
  ]
}
```

- **HTTP status code (expected):** 200 [DOCUMENTED]
- **Response headers of note:** `X-API-CREDITS-REMAINING` (appears once >50% of daily allowance consumed) [DOCUMENTED]
- **Time to first successful call:** N/A — blocked.
- **Gotchas encountered during setup:** N/A — none observed during desk research. Predicted: using `Bearer` instead of `Zoho-oauthtoken` (401), using a cross-region accounts host (the auth URL redirects the user; mismatched accounts vs API hosts causes `INVALID_TOKEN` on API calls).

- [ ] **GATE CHECK: First successful API call completed and documented above** — NOT YET. All downstream docs labelled [DOCUMENTED] until an engineer runs this call post-deploy and promotes markers to [CONFIRMED].

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

Zoho CRM is module-based — each "module" is an entity type. Standard modules ship in every org; custom modules are tenant-defined.

#### Entity: Lead

- **API resource name / endpoint path:** `/crm/v8/Leads`
- **Description:** An unqualified prospect. Conversion produces Contact + Account + optional Deal. [DOCUMENTED]
- **CRUD support:** Create, Read, Update, Delete, Upsert [DOCUMENTED]

**Fields (subset of ~40 standard fields):**

| Field              | Type           | Required? | Writable? | Description                              | Example                |
| ------------------ | -------------- | --------- | --------- | ---------------------------------------- | ---------------------- |
| `id`               | string         | —         | no        | Zoho record ID (18-digit numeric string) | `"410405000001234"`    |
| `Last_Name`        | string         | yes       | yes       | Required                                 | `"Smith"`              |
| `First_Name`       | string         | no        | yes       |                                          | `"Jane"`               |
| `Company`          | string         | yes       | yes       | Required on Leads specifically           | `"Acme"`               |
| `Email`            | string (email) | no        | yes       | Default duplicate check field on Leads   | `"jane@acme.example"`  |
| `Phone` / `Mobile` | string         | no        | yes       | International format recommended         | `"+61 3 9000 0000"`    |
| `Lead_Status`      | picklist       | no        | yes       | See enum reference                       | `"Contacted"`          |
| `Lead_Source`      | picklist       | no        | yes       |                                          | `"Web Form"`           |
| `Owner`            | User lookup    | no        | yes       | `{id, name, email}` object               | `{"id":"…","name":…}`  |
| `Created_Time`     | ISO 8601 dt    | —         | no        |                                          | `"2026-04-01T…+10:00"` |
| `Modified_Time`    | ISO 8601 dt    | —         | no        |                                          |                        |
| `Layout`           | Layout lookup  | yes\*     | yes       | Required for multi-layout orgs           | `{"id":"…"}`           |
| `Tag`              | array<object>  | no        | yes       | `[{name, color_code}]`                   |                        |

Full field discovery: `GET /crm/v8/settings/fields?module=Leads`. [DOCUMENTED]

**Relationships:**

| Related Entity | Type | How Expressed                  | Notes                     |
| -------------- | ---- | ------------------------------ | ------------------------- |
| User (Owner)   | N:1  | `Owner` object with `id`       | Every record has an owner |
| Note           | 1:N  | `/Leads/{id}/Notes`            | Related list              |
| Attachment     | 1:N  | `/Leads/{id}/Attachments`      | File uploads              |
| Campaign       | N:M  | Via conversion to Contact/Deal |                           |

#### Entity: Contact

- **API resource name:** `/crm/v8/Contacts`
- **Description:** Individual person at an Account. Survives Lead conversion. [DOCUMENTED]
- **CRUD:** C, R, U, D, Upsert

| Field          | Type           | Required | Writable | Notes                |
| -------------- | -------------- | -------- | -------- | -------------------- |
| `Last_Name`    | string         | yes      | yes      |                      |
| `Email`        | email          | no       | yes      | Default dedupe field |
| `Account_Name` | Account lookup | no       | yes      | `{id, name}`         |
| `Title`        | string         | no       | yes      |                      |
| `Owner`        | User lookup    | no       | yes      |                      |

**Relationships:** N:1 → Account, 1:N → Note/Attachment/Task/Call/Meeting, N:M → Deal via Contact_Roles.

#### Entity: Account

- **API resource name:** `/crm/v8/Accounts`
- **Description:** A customer/prospect company. [DOCUMENTED]
- **CRUD:** C, R, U, D, Upsert

| Field            | Type           | Required | Writable | Notes             |
| ---------------- | -------------- | -------- | -------- | ----------------- |
| `Account_Name`   | string         | yes      | yes      |                   |
| `Phone`          | string         | no       | yes      |                   |
| `Website`        | string(url)    | no       | yes      |                   |
| `Industry`       | picklist       | no       | yes      |                   |
| `Parent_Account` | Account lookup | no       | yes      | Hierarchy support |
| `Owner`          | User lookup    | no       | yes      |                   |

**Relationships:** 1:N → Contacts / Deals / Notes / Activities. Self-reference via `Parent_Account`.

#### Entity: Deal

- **API resource name:** `/crm/v8/Deals`
- **Description:** A sales opportunity. Has Stage (state machine) and Amount. [DOCUMENTED]
- **CRUD:** C, R, U, D, Upsert

| Field          | Type           | Required | Writable | Notes                                       |
| -------------- | -------------- | -------- | -------- | ------------------------------------------- |
| `Deal_Name`    | string         | yes      | yes      |                                             |
| `Stage`        | picklist       | yes      | yes      | Drives `Probability` + `Closing_Date` logic |
| `Amount`       | currency       | no       | yes      |                                             |
| `Closing_Date` | date           | yes      | yes      | `YYYY-MM-DD`                                |
| `Account_Name` | Account lookup | no       | yes      |                                             |
| `Contact_Name` | Contact lookup | no       | yes      | Primary contact                             |
| `Owner`        | User lookup    | no       | yes      |                                             |
| `Probability`  | int (0–100)    | —        | auto     | Derived from Stage                          |

#### Entity: Task

- **API resource name:** `/crm/v8/Tasks`
- **CRUD:** C, R, U, D

| Field      | Type        | Required | Writable | Notes                   |
| ---------- | ----------- | -------- | -------- | ----------------------- |
| `Subject`  | string      | yes      | yes      |                         |
| `Status`   | picklist    | no       | yes      | See enum reference      |
| `Priority` | picklist    | no       | yes      | Low / Normal / High     |
| `Due_Date` | date        | no       | yes      |                         |
| `Who_Id`   | lookup      | no       | yes      | Lead or Contact         |
| `What_Id`  | lookup      | no       | yes      | Account / Deal / custom |
| `Owner`    | User lookup | no       | yes      |                         |

#### Entity: Note

- **API resource name:** `/crm/v8/Notes`
- **CRUD:** C, R, U, D
- **Fields:** `Note_Title`, `Note_Content`, `Parent_Id` (the record the note is attached to), `se_module` (module API name of parent e.g. `"Deals"`), `Owner`. [DOCUMENTED]

#### Entity: User

- **API resource name:** `/crm/v8/users`
- **CRUD:** Read only (admin UI manages users). [DOCUMENTED]
- **Fields:** `id`, `full_name`, `email`, `role`, `profile`, `status`.

### 3.2 Entity Relationships [IMPORTANT]

```
                ┌─────────┐
                │   User  │  (Owner / Creator)
                └────┬────┘
           owns      │
    ┌──────────┬─────┴──────┬──────────┐
    ▼          ▼            ▼          ▼
┌────────┐ ┌─────────┐  ┌─────────┐ ┌─────────┐
│  Lead  │ │ Contact │  │ Account │ │  Deal   │
└────┬───┘ └────┬────┘  └────┬────┘ └────┬────┘
     │          │             │           │
     │  convert │             │           │
     └──────────┴──► Contact  │           │
                │    Account  │◄──────────┘
                │    (Deal)   │  N:1
                ▼             │
            ┌────────┐        │
            │ Note   │────────┘  polymorphic via se_module
            │ Task   │
            │ Attach │
            └────────┘
```

Polymorphic parents: Notes, Tasks, Calls, Meetings, Attachments reference their parent via `Parent_Id` + `se_module` (module api_name). [DOCUMENTED]

### 3.3 State Machines [IMPORTANT]

#### State Machine: Deal.Stage

Stages are fully user-configurable. Standard set:

```
[Qualification] ──► [Needs Analysis] ──► [Proposal] ──► [Negotiation] ──► [Closed Won]
                                                          │
                                                          └──► [Closed Lost]
```

| From           | Trigger        | To              | Reversible? | Side Effects                         |
| -------------- | -------------- | --------------- | ----------- | ------------------------------------ |
| any open stage | update `Stage` | any other stage | yes         | `Probability` recalculated; workflow |
| any open stage | → Closed Won   | Closed Won      | reversible  | Triggers any "on close" workflow     |
| any open stage | → Closed Lost  | Closed Lost     | reversible  | Same                                 |

Zoho's Blueprint feature can restrict allowed transitions per role. If a blueprint is active, transitions outside the permitted path return `INVALID_DATA` with a blueprint-specific message. [DOCUMENTED]

#### State Machine: Lead.Lead_Status

Default values: `Not Contacted`, `Attempted to Contact`, `Contacted`, `Junk`, `Lost Lead`, `Not Qualified`, `Pre-Qualified`, `Contact in Future`. [DOCUMENTED — default picklist]

No enforced state machine on Leads unless a Blueprint is configured.

#### State Machine: Lead Conversion

```
[Lead] ──convert──► [Contact] + [Account] + [Deal? (optional)]
                         │
                         └──► Lead is marked Converted (`Converted: true`) — not deleted.
```

Lead conversion is a dedicated action: `POST /crm/v8/Leads/{id}/actions/convert`. [DOCUMENTED]

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- A Contact cannot be created without a `Last_Name`. [DOCUMENTED]
- A Lead cannot be created without `Last_Name` AND `Company`. [DOCUMENTED]
- `Layout.id` is required when a module has multiple layouts (even if the user wants the default — no server-side fallback). [DOCUMENTED]

**Field-level rules:**

- `Email` is the default duplicate-check field on Leads and Contacts. Hitting a duplicate returns `DUPLICATE_DATA`. [DOCUMENTED]
- Date fields use `YYYY-MM-DD`. Datetime uses ISO 8601 with timezone offset — `Z` is accepted but `+00:00` style is what Zoho emits. [DOCUMENTED]
- Currency fields take a bare number; the org's `currency` is applied server-side. [DOCUMENTED]

**Cascading effects:**

- Deleting a record soft-deletes (trashes) it. Permanent delete requires separate call. [DOCUMENTED]
- Deleting a parent (e.g. Account) does NOT cascade to children; child records become orphans with the parent lookup null. [DOCUMENTED]
- Converting a Lead creates Contact/Account/Deal atomically; failure rolls back. [DOCUMENTED]

**Uniqueness constraints:**

- `Email` is unique per module by default (can be changed via org admin). [DOCUMENTED]
- Zoho's duplicate detection is configurable — override via `duplicate_check_fields` in upsert. [DOCUMENTED]

**Computed / read-only fields:**

- `Created_By`, `Created_Time`, `Modified_By`, `Modified_Time` — server-set. [DOCUMENTED]
- `Probability` (on Deals) — derived from Stage mapping. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

| Format      | Pattern                    | Example                     | Notes                              |
| ----------- | -------------------------- | --------------------------- | ---------------------------------- |
| Date        | `YYYY-MM-DD`               | `2026-04-23`                |                                    |
| DateTime    | ISO 8601 w/ offset         | `2026-04-23T10:00:00+10:00` | Zoho emits offset; accepts `Z` too |
| Currency    | number (no symbol)         | `12345.67`                  | Org currency applied server-side   |
| Phone       | free-form string           | `+61 3 9000 0000`           | Not validated server-side          |
| Record ID   | 18–19 digit numeric string | `"410405000002264040"`      | String, not integer                |
| Layout ID   | 18–19 digit numeric string | `"410405000000123456"`      |                                    |
| Enum values | See 3.6                    | `"Qualification"`           | Case-sensitive picklist values     |

### 3.6 Enum Value Reference [NICE-TO-HAVE]

| Entity | Field         | Default Allowed Values (tenant-customisable)                                                                                                                                                |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead   | `Lead_Status` | `Not Contacted`, `Attempted to Contact`, `Contacted`, `Junk`, `Lost Lead`, `Not Qualified`, `Pre-Qualified`, `Contact in Future`                                                            |
| Lead   | `Lead_Source` | `None`, `Advertisement`, `Cold Call`, `Employee Referral`, `External Referral`, `Online Store`, `Partner`, `Public Relations`, `Trade Show`, `Web Research`                                 |
| Deal   | `Stage`       | `Qualification`, `Needs Analysis`, `Value Proposition`, `Identify Decision Makers`, `Proposal/Price Quote`, `Negotiation/Review`, `Closed Won`, `Closed Lost`, `Closed Lost to Competition` |
| Task   | `Status`      | `Not Started`, `Deferred`, `In Progress`, `Completed`, `Waiting for Input`                                                                                                                  |
| Task   | `Priority`    | `Low`, `Normal`, `High`                                                                                                                                                                     |
| Call   | `Call_Type`   | `Inbound`, `Outbound`, `Missed`                                                                                                                                                             |

Always confirm via `GET /crm/v8/settings/fields?module={Module}` — values are tenant-editable. [DOCUMENTED]

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: GET /crm/v8/{module}

- **Purpose:** List records in a module with optional filtering, sorting, and pagination.
- **Auth:** required
- **Rate limit:** 1 credit per call
- **Idempotent:** yes

**Query parameters:**

| Parameter    | Type   | Required | Default | Description                                                                         |
| ------------ | ------ | -------- | ------- | ----------------------------------------------------------------------------------- |
| `fields`     | CSV    | yes      | —       | Comma-separated field API names (max 50). Without this, returns 400.                |
| `per_page`   | int    | no       | 200     | Max 200.                                                                            |
| `page`       | int    | no       | 1       | 1-based. Mutually exclusive with `page_token`. Hard cap at page × per_page ≤ 2000.  |
| `page_token` | string | no       | —       | Required for beyond-2000 pagination. Obtained from previous `info.next_page_token`. |
| `sort_by`    | string | no       | `id`    | Field API name.                                                                     |
| `sort_order` | enum   | no       | `desc`  | `asc` or `desc`.                                                                    |
| `cvid`       | string | no       | —       | Custom View ID. Mutually exclusive with `sort_by`.                                  |
| `converted`  | enum   | no       | —       | Leads only: `true`/`false`/`both`.                                                  |
| `approved`   | enum   | no       | —       | `true`/`false`/`both`.                                                              |

**Success response (200):**

```json
{
  "data": [
    {
      "id": "410405000002264040",
      "Last_Name": "Smith",
      "Email": "smith@example.com",
      "Owner": { "id": "…", "name": "…", "email": "…" }
    }
  ],
  "info": {
    "per_page": 200,
    "count": 1,
    "page": 1,
    "more_records": false,
    "next_page_token": null,
    "sort_by": "id",
    "sort_order": "desc"
  }
}
```

**Error responses:**

| Status | Error Code               | Meaning                                | Recovery                      |
| ------ | ------------------------ | -------------------------------------- | ----------------------------- |
| 400    | `REQUIRED_PARAM_MISSING` | `fields` not provided                  | Pass `fields=...`             |
| 400    | `INVALID_MODULE`         | Module api_name typo / not enabled     | Check `/settings/modules`     |
| 401    | `INVALID_TOKEN`          | Access token expired                   | Refresh via `/oauth/v2/token` |
| 204    | —                        | No records match (success; empty body) | Treat as zero results         |

[DOCUMENTED]

#### Endpoint: GET /crm/v8/{module}/search

- **Purpose:** Search records by criteria, email, phone, or word.
- **Auth:** required
- **Rate limit:** heavier — counts toward sub-concurrency pool of 10.

**Query parameters (one of criteria/email/phone/word is mandatory; only one processed):**

| Parameter                                 | Type   | Notes                                                                                                                                                                                 |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `criteria`                                | string | `((field:operator:value)and/or(field:operator:value))`. Operators: `equals`, `not_equal`, `starts_with`, `in`, `greater_than`, `greater_equal`, `less_than`, `less_equal`, `between`. |
| `email`                                   | string | Searches all email fields.                                                                                                                                                            |
| `phone`                                   | string | Searches all phone fields.                                                                                                                                                            |
| `word`                                    | string | Global text search.                                                                                                                                                                   |
| `page`                                    | int    | default 1                                                                                                                                                                             |
| `per_page`                                | int    | default/max 200                                                                                                                                                                       |
| `converted`, `approved`, `cvid`, `fields` | —      | Same as list.                                                                                                                                                                         |

**Max retrievable:** 2000 records. [DOCUMENTED]

#### Endpoint: POST /crm/v8/{module}

- **Purpose:** Create one-to-100 records.
- **Auth:** required. Scope: `ZohoCRM.modules.{module}.CREATE`.
- **Idempotent:** no.

**Request body:**

```json
{
  "data": [{ "Last_Name": "Smith", "Company": "Acme", "Email": "smith@acme.example", "Lead_Source": "Web Form" }],
  "trigger": ["approval", "workflow", "blueprint", "pathfinder", "orchestration"]
}
```

`trigger` controls which automations fire. Omit or pass `[]` to skip ALL automations. Default fires all. [DOCUMENTED]

**Success response (200 or 207):**

```json
{
  "data": [
    {
      "code": "SUCCESS",
      "details": { "id": "410405000002264040", "Created_Time": "2026-04-23T10:00:00+10:00" },
      "message": "record added",
      "status": "success"
    }
  ]
}
```

**Partial failure (207 Multi-Status):** per-record status codes — iterate and check each. [DOCUMENTED]

**Per-record error codes:** `DUPLICATE_DATA`, `MANDATORY_NOT_FOUND`, `INVALID_DATA`.

#### Endpoint: POST /crm/v8/{module}/upsert

- **Purpose:** Insert if no dedupe match, update if matched.
- **Body:** same as create plus `duplicate_check_fields: ["Email"]`. If omitted, system defaults to module's configured dedupe fields (Email on Leads/Contacts). [DOCUMENTED]
- **Max per call:** 100 records.

#### Endpoint: PUT /crm/v8/{module}/{id} and PUT /crm/v8/{module}

- **Purpose:** Update. Single-record via `/{id}` (body is `{"data": [{…}]}`). Multi-record via base path with each record carrying its own `id` (max 100).
- **Semantics:** Partial update — unspecified fields are untouched. Sending `null` clears a field. [DOCUMENTED]

#### Endpoint: DELETE /crm/v8/{module}

- **Purpose:** Delete up to 100 records.
- **Query params:** `ids=id1,id2,...` (required), `wf_trigger=true|false` (optional, default true).
- **Single-record variant:** `DELETE /crm/v8/{module}/{id}`.
- **Behaviour:** Soft delete (goes to Recycle Bin). Subforms are auto-removed. [DOCUMENTED]

#### Endpoint: POST /crm/v8/Leads/{id}/actions/convert

- **Purpose:** Convert a Lead to Contact + Account + optional Deal.
- **Cost:** 5 credits. [DOCUMENTED]
- **Body:** conversion options (overwrite, notify, assigned_to, deal: {...}, etc).

#### Endpoint: POST /crm/v8/coql

- **Purpose:** SQL-like cross-module query.
- **Body:** `{"select_query": "select Last_Name, Email from Leads where Company = 'Acme' limit 5"}`.
- **Limits:** max 2000 records per call; max 2 joins; requires `ZohoCRM.coql.READ` scope. [DOCUMENTED]

#### Endpoint: GET /crm/v8/settings/fields?module={module}

- **Purpose:** Discover all fields for a module — required BEFORE write operations to know what's mandatory.
- **Cost:** 1 credit.
- **Response:** list of field definitions with `api_name`, `data_type`, `required`, `json_type`, `pick_list_values`, `lookup`, `length`, `decimal_place`, etc. [DOCUMENTED]

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                            | Purpose                                    | Auth | Paginated | Notes                          |
| ------ | ----------------------------------------------- | ------------------------------------------ | ---- | --------- | ------------------------------ |
| GET    | `/crm/v8/{module}`                              | List records                               | yes  | yes       | `fields` required              |
| GET    | `/crm/v8/{module}/{id}`                         | Get one record                             | yes  | no        | `fields` optional              |
| GET    | `/crm/v8/{module}/search`                       | Search                                     | yes  | yes       | Heavy — sub-concurrency        |
| POST   | `/crm/v8/{module}`                              | Create (≤100)                              | yes  | no        | 207 on partial                 |
| PUT    | `/crm/v8/{module}`                              | Update many (≤100)                         | yes  | no        | `id` per record                |
| PUT    | `/crm/v8/{module}/{id}`                         | Update one                                 | yes  | no        |                                |
| DELETE | `/crm/v8/{module}`                              | Delete many (≤100)                         | yes  | no        | `ids` query                    |
| DELETE | `/crm/v8/{module}/{id}`                         | Delete one                                 | yes  | no        |                                |
| POST   | `/crm/v8/{module}/upsert`                       | Upsert (≤100)                              | yes  | no        | `duplicate_check_fields`       |
| POST   | `/crm/v8/{module}/deleted`                      | — (read via GET with `type=recycle`)       |      |           |                                |
| GET    | `/crm/v8/{module}/deleted?type=recycle`         | List trashed records                       | yes  | yes       |                                |
| POST   | `/crm/v8/coql`                                  | COQL query                                 | yes  | cursor    | `limit N offset M` in query    |
| POST   | `/crm/v8/Leads/{id}/actions/convert`            | Convert Lead                               | yes  | no        | 5 credits                      |
| POST   | `/crm/v8/Leads/actions/mass_convert`            | Mass Lead conversion                       | yes  | no        |                                |
| GET    | `/crm/v8/{module}/{id}/{related}`               | Related list (Notes / Attachments / …)     | yes  | yes       | e.g. `/Deals/{id}/Attachments` |
| POST   | `/crm/v8/{module}/{id}/Attachments`             | Upload attachment                          | yes  | no        | multipart/form-data            |
| GET    | `/crm/v8/{module}/{id}/Attachments/{att_id}`    | Download attachment                        | yes  | no        | binary                         |
| GET    | `/crm/v8/org`                                   | Get org info                               | yes  | no        |                                |
| GET    | `/crm/v8/users`                                 | List users (`?type=CurrentUser\|AllUsers`) | yes  | yes       |                                |
| GET    | `/crm/v8/users/{id}`                            | Get user                                   | yes  | no        |                                |
| GET    | `/crm/v8/settings/modules`                      | List modules                               | yes  | no        |                                |
| GET    | `/crm/v8/settings/modules/{module}`             | Get module details                         | yes  | no        |                                |
| GET    | `/crm/v8/settings/fields?module={module}`       | List fields                                | yes  | no        |                                |
| GET    | `/crm/v8/settings/layouts?module={module}`      | List layouts                               | yes  | no        |                                |
| GET    | `/crm/v8/settings/custom_views?module={module}` | List CVIDs                                 | yes  | no        |                                |
| POST   | `/crm/v8/actions/watch`                         | Subscribe to notifications                 | yes  | no        |                                |
| GET    | `/crm/v8/actions/watch`                         | List notification subscriptions            | yes  | no        |                                |
| DELETE | `/crm/v8/actions/watch?channel_ids=…`           | Unsubscribe from notifications             | yes  | no        |                                |
| POST   | `/crm/bulk/v8/read`                             | Async bulk read (>2000 records)            | yes  | no        | 500 credits                    |
| GET    | `/crm/bulk/v8/read/{job_id}`                    | Poll bulk read job                         | yes  | no        |                                |
| GET    | `/crm/bulk/v8/read/{job_id}/result`             | Download CSV result                        | yes  | no        | binary                         |
| POST   | `/crm/bulk/v8/write`                            | Async bulk write                           | yes  | no        |                                |

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?  | Syntax                                        | Notes                            |
| ------------------------------- | ----------- | --------------------------------------------- | -------------------------------- |
| Filter by field value           | yes         | via `/search?criteria=((Field:equals:Value))` | Search endpoint, not list        |
| Filter by date range            | yes         | `criteria=((Created_Time:between:d1,d2))`     | ISO 8601 with offset; encode `+` |
| Full-text search                | yes         | `/search?word=...`                            | Global module search             |
| Sort by field                   | yes         | `?sort_by=Last_Name&sort_order=asc`           | List endpoint                    |
| Sort direction (asc/desc)       | yes         | `sort_order=asc\|desc`                        |                                  |
| Field selection / sparse fields | yes (req'd) | `?fields=Last_Name,Email`                     | MANDATORY on list                |
| Include related records         | partial     | `?include_child=true` on specific endpoints   | Not universal                    |
| Aggregate / count               | partial     | via COQL: `select count(Id) from Leads`       | Use COQL                         |
| Logical operators (AND/OR)      | yes         | `and`, `or` keywords inside criteria          | `((A)and(B))`                    |
| Comparison operators            | yes         | `equals`, `not_equal`, `greater_than`, etc.   |                                  |
| Null checks                     | partial     | `:equals:null` works for some fields          | [INFERRED]                       |
| Regex / pattern matching        | no          | `starts_with` only                            |                                  |

### 5.2 Filter Syntax [REQUIRED]

**General pattern:**

```
GET /crm/v8/{module}/search?criteria=((field:operator:value)and/or(field:operator:value))
```

**Operator examples:**

```
Lead_Status:equals:Contacted
Last_Name:starts_with:Smith
Created_Time:between:2026-04-01T00:00:00+10:00,2026-04-30T23:59:59+10:00
Amount:greater_than:10000
Email:equals:jane@acme.example
```

**Combining:** `and` / `or`. Nesting with extra parens is supported.

### 5.3 Sort Syntax [IMPORTANT]

```
?sort_by=Modified_Time&sort_order=desc
```

Only one sort field at a time. Default: `sort_by=id&sort_order=desc`. [DOCUMENTED]

### 5.4 Field Selection [NICE-TO-HAVE]

```
?fields=Last_Name,First_Name,Email,Phone,Company,Lead_Status
```

**Mandatory** on `GET /crm/v8/{module}` (list). Optional on `GET /crm/v8/{module}/{id}` (get one). Max 50 field API names. [DOCUMENTED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global search endpoint:** none (search is per-module only).
- **Per-module search:** `GET /crm/v8/{module}/search`.
- **Searchable:** all indexed fields (most are by default; text areas may not be).
- **Fuzzy matching:** `starts_with` supported; no Levenshtein fuzzy matching advertised. [DOCUMENTED]
- **Minimum query length:** `word` param requires ≥1 non-whitespace char. [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: List a page of Leads with minimal fields**

```http
GET /crm/v8/Leads?fields=Last_Name,Email,Phone,Company,Lead_Status&per_page=200&page=1
```

**Pattern 2: Find Deals for a specific Account by name**

```http
GET /crm/v8/Deals/search?criteria=((Account_Name.name:equals:Acme))&fields=Deal_Name,Stage,Amount,Closing_Date
```

**Pattern 3: My tasks due this week**

```http
GET /crm/v8/Tasks/search?criteria=((Owner:equals:USER_ID)and(Due_Date:between:2026-04-21T00:00:00+10:00,2026-04-27T23:59:59+10:00))
```

**Pattern 4: All records modified in the last hour (polling)**

```http
GET /crm/v8/Leads?fields=id,Modified_Time,Last_Name&sort_by=Modified_Time&sort_order=desc&per_page=200
```

Filter client-side by `Modified_Time >= cutoff`. For server-side filtering, use COQL.

**Pattern 5: COQL — count open deals per stage**

```http
POST /crm/v8/coql
{ "select_query": "select Stage, count(Id) from Deals where Stage not in ('Closed Won','Closed Lost') group by Stage" }
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** hybrid — offset-based (`page`+`per_page`) for ≤2000 records, then cursor (`page_token`) beyond that. [DOCUMENTED]
- **Default page size:** 200.
- **Maximum page size:** 200.
- **Total count available:** `info.count` per page only (no global total). Use COQL `count(Id)` for a true total.

**Request parameters:**

| Parameter    | Type   | Default | Description                                                           |
| ------------ | ------ | ------- | --------------------------------------------------------------------- |
| `page`       | int    | 1       | 1-based. Mutually exclusive with `page_token`.                        |
| `per_page`   | int    | 200     | Max 200.                                                              |
| `page_token` | string | —       | Use instead of `page` once you hit record 2000. Supplied in response. |

**Response structure:**

```json
{
  "data": [ … ],
  "info": { "per_page": 200, "count": 200, "page": 1, "more_records": true, "next_page_token": "eyJ…", "sort_by": "id", "sort_order": "desc" }
}
```

**How to detect last page:** `info.more_records === false`. Also `info.next_page_token === null`.

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1 (≤2000):   GET /crm/v8/Leads?fields=id,Email&per_page=200&page=1
                  → info.more_records=true, info.next_page_token=null, still on offset path

Page 10 (at record 1800–2000): GET /crm/v8/Leads?fields=id,Email&per_page=200&page=10
                  → info.more_records=true, info.next_page_token="eyJ..."

Page 11 (beyond 2000): GET /crm/v8/Leads?fields=id,Email&per_page=200&page_token=eyJ...
                  → info.next_page_token="eyJ...2", info.more_records=true

Last page:        info.more_records=false
```

Do NOT send both `page` and `page_token` — the request will 400. [DOCUMENTED]

### 6.3 Bulk Operations [IMPORTANT]

| Operation          | Endpoint                          | Max batch | Notes                        |
| ------------------ | --------------------------------- | --------- | ---------------------------- |
| Bulk create        | `POST /crm/v8/{module}`           | 100       | 207 on partial failure       |
| Bulk update        | `PUT /crm/v8/{module}`            | 100       | Include `id` per record      |
| Bulk upsert        | `POST /crm/v8/{module}/upsert`    | 100       | `duplicate_check_fields`     |
| Bulk delete        | `DELETE /crm/v8/{module}?ids=...` | 100       | Comma-separated IDs          |
| Bulk read (async)  | `POST /crm/bulk/v8/read`          | —         | 500-credit initialise; poll  |
| Bulk write (async) | `POST /crm/bulk/v8/write`         | 25000     | Upload CSV in pre-signed URL |

**Bulk request format (insert):**

```json
{
  "data": [
    { "Last_Name": "Smith", "Company": "Acme", "Email": "jane@acme.example" },
    { "Last_Name": "Doe", "Company": "Initech" }
  ],
  "trigger": ["workflow"]
}
```

**Partial failure handling:** HTTP 207. `data[i].status === "success" | "error"`, `data[i].code`, `data[i].details`, `data[i].message`. Process per-index.

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **Bulk read API:** `POST /crm/bulk/v8/read` — kicks off async CSV export. Returns `{ "data": [{ "details": { "id": "…" } }] }`. Poll `GET /crm/bulk/v8/read/{id}`. When `state=COMPLETED`, download via `GET /crm/bulk/v8/read/{id}/result` (returns zip of CSV).
- **Export format:** CSV within a zip.
- **Async:** yes.
- **Size limits:** up to 200k records per job; max 5 concurrent jobs per org. [DOCUMENTED]
- **Result TTL:** 7 days. [DOCUMENTED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism              | Supported?    | Notes                                           |
| ---------------------- | ------------- | ----------------------------------------------- |
| Webhooks               | yes           | "Notifications API" — `/crm/v8/actions/watch`.  |
| WebSocket              | no            | Not exposed.                                    |
| Server-Sent Events     | no            |                                                 |
| Long polling           | no            |                                                 |
| Change feeds / streams | no (for core) | Zoho Bigin / Projects use queues; CRM does not. |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** API (`POST /crm/v8/actions/watch`) or UI (Setup → Developer Space → Notifications). [DOCUMENTED]
- **URL requirements:** HTTPS required in production; HTTP allowed for dev. No verification ping on create.
- **Subscription lifetime:** max 24 hours by default; must be renewed. Can be extended to a year by re-sending with `channel_expiry` set further in the future. [DOCUMENTED]

**Registration request:**

```http
POST /crm/v8/actions/watch
Authorization: Zoho-oauthtoken …
Content-Type: application/json

{
  "watch": [
    {
      "channel_id": "1001",
      "events": ["Leads.create", "Leads.edit", "Leads.delete"],
      "channel_expiry": "2026-05-23T10:00:00+10:00",
      "notify_url": "https://example.com/zoho/webhook",
      "token": "shared-secret-for-verification"
    }
  ]
}
```

**Event catalog (pattern: `{Module}.{event}`):**

| Event              | Trigger         | Key payload                    |
| ------------------ | --------------- | ------------------------------ |
| `{Module}.create`  | Record created  | `ids[]`, `module`, `operation` |
| `{Module}.edit`    | Record updated  | same                           |
| `{Module}.delete`  | Record deleted  | same                           |
| `{Module}.convert` | Lead conversion | Lead-only                      |

**Payload format (to your endpoint):**

```json
{
  "server_time": 1713849600000,
  "query_params": {},
  "module": "Leads",
  "resource_uri": "https://www.zohoapis.com.au/crm/v8/Leads",
  "ids": ["410405000002264040"],
  "affected_fields": [],
  "operation": "insert",
  "channel_id": "1001",
  "token": "shared-secret-for-verification"
}
```

**Verification:** Zoho does NOT sign payloads with HMAC. You verify by matching the `token` field against what you supplied at registration. **Anyone with your URL can spoof** — keep the token secret and drop requests where it doesn't match. [DOCUMENTED]

**Reliability:**

- **Retry policy:** Zoho retries on non-2xx up to 5 times with exponential backoff (~1m, 5m, 30m, 2h, 10h). [DOCUMENTED]
- **Dead-letter:** none — eventual drop.
- **Ordering:** best-effort; not guaranteed.
- **Duplicates:** possible (on retry).

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

Not applicable. [DOCUMENTED — absence]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended endpoint:** `GET /crm/v8/{module}?fields=id,Modified_Time&sort_by=Modified_Time&sort_order=desc&per_page=200`. Filter by `Modified_Time > last_poll`.
- **Better:** COQL — `select Id, Modified_Time from Leads where Modified_Time > '2026-04-23T09:00:00+10:00' order by Modified_Time desc limit 200`.
- **Interval:** every 5–15 minutes is safe; never below 1 minute to respect concurrency limits.
- **Change detection field:** `Modified_Time` (always server-set).
- **Rate-limit impact:** each poll is 1 credit + consumes one of your concurrency slots.

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

**Credit-based** 24-hour rolling window, NOT requests-per-minute.

| Edition               | Base credits | Per-user | Max limit |
| --------------------- | ------------ | -------- | --------- |
| Free                  | 5,000        | —        | 5,000     |
| Standard / Starter    | 50,000       | +250     | 100,000   |
| Professional          | 50,000       | +500     | 3,000,000 |
| Enterprise / Zoho One | 50,000       | +1,000   | 5,000,000 |
| Ultimate / CRM Plus   | 50,000       | +2,000   | unlimited |

Most ops = 1 credit. Convert Lead = 5. Merge records = 50. Bulk write initialise = 500. [DOCUMENTED]

**Concurrency (simultaneous calls per org per app):**

| Edition      | Concurrent | Sub-concurrency (heavy ops pool) |
| ------------ | ---------- | -------------------------------- |
| Free         | 5          | 10 shared                        |
| Standard     | 10         | 10 shared                        |
| Professional | 15         | 10 shared                        |
| Enterprise   | 20         | 10 shared                        |
| Ultimate     | 25         | 10 shared                        |

"Heavy ops" (counting against the 10-pool): Get Records with cvid, Convert Lead, bulk Insert/Update/Upsert >10 records, Send Mail, Search, COQL Query, Composite APIs. [DOCUMENTED]

**Rate limit headers:**

| Header                    | Meaning                                                               | Example   |
| ------------------------- | --------------------------------------------------------------------- | --------- |
| `X-API-CREDITS-REMAINING` | Remaining credits in the 24h window (appears only when >50% consumed) | `"12345"` |

Standard `X-RATELIMIT-*` headers are NOT returned. Concurrency limits don't expose a header — you see 429 when you exceed. [DOCUMENTED]

**Rate-limit exceeded response:**

```json
{
  "code": "TOO_MANY_REQUESTS",
  "details": {},
  "message": "too many requests. please try again after some time",
  "status": "error"
}
```

Returns HTTP 429. Retry-After header may be present (seconds). [DOCUMENTED]

**Backoff strategy:** exponential with jitter, base 2s, max 60s. Honour `Retry-After` when present.

### 8.2 Error Handling [REQUIRED]

**Standard error response format:**

```json
{
  "code": "INVALID_DATA",
  "details": { "api_name": "Email", "expected_data_type": "string" },
  "message": "the given data is not valid",
  "status": "error"
}
```

**HTTP status codes:**

| HTTP | Error codes (examples)                                                                                               | Meaning                   | Retryable? | Recovery                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- | -------------------------------------------- |
| 200  | —                                                                                                                    | Success                   | —          | —                                            |
| 204  | —                                                                                                                    | No content (empty result) | —          | treat as zero                                |
| 207  | mixed `SUCCESS`/`DUPLICATE_DATA`/`MANDATORY_NOT_FOUND`/`INVALID_DATA`                                                | Partial                   | —          | iterate per record                           |
| 400  | `INVALID_MODULE`, `INVALID_DATA`, `INVALID_QUERY`, `REQUIRED_PARAM_MISSING`, `DUPLICATE_DATA`, `MANDATORY_NOT_FOUND` | Bad request               | no         | fix request                                  |
| 401  | `INVALID_TOKEN`, `AUTHENTICATION_FAILURE`, `OAUTH_SCOPE_MISMATCH`                                                    | Unauthorized              | yes        | refresh token; if refresh fails → re-consent |
| 403  | `NOT_ALLOWED`, `FORBIDDEN`, `UNAPPROVED`                                                                             | Forbidden                 | no         | check scopes / role                          |
| 404  | `INVALID_URL_PATTERN`, `RESOURCE_NOT_FOUND`                                                                          | Not found                 | no         | verify path/ID                               |
| 409  | `DUPLICATE_DATA`, `RECORD_LOCKED`                                                                                    | Conflict                  | maybe      | use upsert or check existing                 |
| 413  | `REQUEST_ENTITY_TOO_LARGE`                                                                                           | Body too big              | no         | split into smaller batches                   |
| 415  | `INVALID_MIME_TYPE`                                                                                                  | Wrong Content-Type        | no         | set `application/json`                       |
| 422  | `INVALID_DATA` (field-level)                                                                                         | Validation failed         | no         | fix per `details`                            |
| 429  | `TOO_MANY_REQUESTS`                                                                                                  | Rate limited              | yes        | backoff + retry                              |
| 500  | `INTERNAL_ERROR`                                                                                                     | Server error              | yes        | retry with backoff                           |
| 502  | `BAD_GATEWAY`                                                                                                        | Gateway error             | yes        | retry                                        |
| 503  | `SERVICE_UNAVAILABLE`                                                                                                | Maintenance               | yes        | retry after Retry-After                      |

**Validation error format:**

```json
{
  "code": "MANDATORY_NOT_FOUND",
  "details": { "api_name": "Last_Name", "json_path": "$.data[0].Last_Name" },
  "message": "required field not found",
  "status": "error"
}
```

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** no dedicated header. [DOCUMENTED]
- **Natural idempotency:** GET/PUT/DELETE by `id` is idempotent; POST is not unless you use `upsert` with `duplicate_check_fields`.
- **Recommendation:** use `/upsert` for any operation that might be retried.

### 8.4 Async Operations [IMPORTANT]

Applies to Bulk Read/Write only.

- **Kickoff:** `POST /crm/bulk/v8/read` returns `{ details: { id: "job_id" } }`.
- **Poll:** `GET /crm/bulk/v8/read/{job_id}`, `state` progresses `ADDED → IN_PROGRESS → COMPLETED | FAILED`.
- **Callback:** optional — `callback.url` + `callback.method` in the request body.
- **Timeout / TTL:** 7 days for result retention.

### 8.5 File Handling [IMPORTANT]

- **Upload endpoint:** `POST /crm/v8/{module}/{id}/Attachments` — multipart/form-data, field name `file`.
- **Max file size:** 20 MB per attachment (Enterprise). 5 MB on Free/Standard. [DOCUMENTED]
- **Allowed types:** any — Zoho stores arbitrary bytes.
- **Download endpoint:** `GET /crm/v8/{module}/{id}/Attachments/{attachment_id}` — returns raw bytes with a `Content-Disposition` header for filename.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** via `Modified_Time`. Zoho does NOT enforce ETag-based locking on writes — last-write-wins.
- **Conflict resolution:** caller's responsibility.
- **Eventual consistency:** writes are immediately visible to subsequent reads within the same region.

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                   | When to Use                     | Fits?   | Notes                                               |
| ---------------------- | ------------------------------- | ------- | --------------------------------------------------- |
| Data Connector         | Browsable files/content         | no      | CRM is structured records, not files                |
| Data Connector (Files) | Primarily file storage          | no      | —                                                   |
| **Direct API Only**    | **Action-oriented API surface** | **yes** | LLM calls via `connect_request`; no file-browser UI |
| Hybrid                 | Both browsable AND action       | no      | —                                                   |

**Selected integration path:** **Direct API Only**

**Justification:** Zoho CRM is a structured-records platform. Records (Leads, Contacts, Deals) are not meaningfully presented as a file tree. `surfaces: ['chat']` in the registry keeps it out of Files > Remote. All interactions happen through the workspace agent's `connect_request` tool, using `01-llm-api-rules.md` as its mental model.

### 9.2 Connector Requirements [IMPORTANT]

Zoho CRM is a fully documented public REST API — any HTTP client that can perform OAuth 2.0 Authorization Code (per-region) and inject `Authorization: Zoho-oauthtoken {token}` headers can drive the entire API surface. There is no special SDK or provider class required to call the API itself.

Requirements for any integrator:

1. OAuth client (`client_id` / `client_secret`) registered in the customer's region-correct Zoho API Console — see §2.3 above for per-region URLs.
2. Use the Zoho-specific header scheme `Authorization: Zoho-oauthtoken {access_token}` (NOT `Bearer`).
3. Pin to the region-correct API host: `www.zohoapis.{region}/crm/v8` (CA: `www.zohoapis.ca`).

> Numa-internal wiring details (vault keys, registry entries, commit references) live in the connector skill or the relevant Numa-side documentation — they are not part of the Zoho API surface and should not be documented here.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do:**

1. List / search / get records in any module (Leads, Contacts, Accounts, Deals, Tasks, Notes, custom).
2. Create / update / upsert / delete records (up to 100 per call).
3. Run COQL queries for cross-module reports and aggregates.
4. Follow related lists (notes on a deal, attachments on a contact).
5. Convert a Lead to Contact/Account/Deal.
6. Discover module and field metadata via `/settings/modules` and `/settings/fields`.

**CANNOT do (out of scope for v1):**

1. Upload attachments — the `connect_request` backend does JSON only; multipart upload would need a separate handler.
2. Subscribe to notifications on behalf of the user — requires a Numa-hosted public webhook endpoint with verification tokens.
3. Trigger blueprint transitions that the signed-in user doesn't have permission for (returns 403).
4. Merge records (50 credits + irreversible) — should be explicit admin tool, not LLM.

**Default parameters:**

| Parameter                 | Default                                    | Reason                                                                            |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `per_page`                | 200                                        | API max — minimise round-trips.                                                   |
| `fields` (list)           | subset of common display fields per module | Avoid the "required fields" 400.                                                  |
| `sort_by`/`sort_order`    | `Modified_Time` / `desc`                   | Freshest-first is the UX the user expects.                                        |
| `trigger` (create/update) | `["workflow"]`                             | Preserve automations without firing approvals/blueprints the user didn't ask for. |
| `wf_trigger` (delete)     | `true`                                     | Preserve workflow parity.                                                         |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                    | Language | Quality | Maintained | Worth using?                                                       |
| ---------------------- | -------- | ------- | ---------- | ------------------------------------------------------------------ |
| zohocrm-python-sdk-8.0 | Python   | good    | yes        | No — Numa uses raw httpx via `connect_request` for all connectors. |
| zohocrm-nodejs-sdk-8.0 | Node     | good    | yes        | No — same.                                                         |

Adding SDK overhead per-connector would break the framework rule "all connectors are the same from the framework perspective".

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 complete: **auth working and first call documented** — BLOCKED, no test credentials during desk research
- [x] Phase 3 complete: core entities (Lead, Contact, Account, Deal, Task, Note, User) with fields documented
- [x] Phase 4 complete: 10+ critical endpoints documented with request/response
- [x] Phase 5 complete: query and filter patterns documented
- [x] Phase 6 complete: pagination model documented with worked example
- [x] Phase 7 complete: Notifications API documented
- [x] Phase 8 complete: credit model, concurrency, and error catalogue documented
- [x] Phase 9 complete: integration path = Direct API Only

**Overall investigation confidence:** medium

**Known gaps that will reduce output quality:**

1. Phase 2 live-gate NOT satisfied — downstream files carry [DOCUMENTED] markers until an engineer promotes them to [CONFIRMED] via a live `GET /crm/v8/org` after the first admin install.
2. Custom-module handling varies per tenant — the docs cover standard modules only. When users hit custom modules the agent must pull `GET /crm/v8/settings/modules` at runtime.
3. Webhook signing: Zoho does NOT HMAC-sign — only a shared `token` echoed in the payload. Weaker than GitHub/Stripe; flagged in 01d.

### 10.2 Generation Prompts [REQUIRED]

Generating now (all templates):

1. 01-llm-api-rules.md — main prompt, <300 lines
2. 01a-domain-model-reference.md — Lead/Contact/Account/Deal/Task/Note/User
3. 01b-query-patterns.md — list/search/COQL/pagination
4. 01c-mutation-patterns.md — create/update/upsert/delete/convert
5. 01d-event-and-error-handling.md — Notifications API, errors, credits
6. 02-api-spec-investigation.md — dev-facing ref
7. ~~03-connector-setup.md~~ — **SKIP** (integration path is Direct API Only, not Data Connector)
8. 04-connection-and-reauth.md — OAuth app creation per region + refresh/revoke

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                                  |
| ---------------------------- | ------------- | ---------- | --------------------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium     | Phase 2 gate not satisfied                                            |
| 01a-domain-model-reference   | yes           | medium     | Custom modules are tenant-specific                                    |
| 01b-query-patterns           | yes           | high       |                                                                       |
| 01c-mutation-patterns        | yes           | high       |                                                                       |
| 01d-event-and-error-handling | yes           | medium     | Webhook security is weaker than documented elsewhere — flagged inline |
| 02-api-spec-investigation    | yes           | medium     |                                                                       |
| 03-connector-setup           | n/a           | —          | Skipped — Direct API Only path                                        |
| 04-connection-and-reauth     | yes           | high       |                                                                       |

---

_Investigation blocked on first-live-call gate. Downstream output proceeds at [DOCUMENTED] confidence; a follow-up `live-verification.md` or an update to this questionnaire should run after the first successful `GET /crm/v8/org` against an arcanum-demo-tony-configured Zoho app._
