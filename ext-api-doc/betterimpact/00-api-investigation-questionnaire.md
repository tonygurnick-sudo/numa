---
api_name: 'Better Impact (Volunteer Impact) API v1'
api_slug: 'betterimpact'
vendor: 'Better Impact — volunteer management software (Volunteer Impact; also Donor/Client/Member Impact on the same API)'
website: 'https://betterimpact.com'
investigation_started: '2026-05-28'
investigator: 'Numa API Investigation Agent (official support-center docs + GitHub SDK research, 2026-05-28; reformatted into the standard pack 2026-06-10)'
investigation_status: 'blocked' # docs research complete; Phase 2.4 authenticated-call gate NOT passed (no credentials — only unauthenticated 401 probes)
documentation_quality: 'adequate' # solid endpoint/field reference in support articles, but no OpenAPI spec, no error docs, no rate-limit docs
api_types: [REST]
overall_confidence: 'medium'
blockers:
  - 'No Better Impact credentials were available — every endpoint requires HTTP Basic auth, so no authenticated call has been made (only live 401 probes)'
  - 'Error response BODY format is completely undocumented and was not captured (fetch tool returned empty body on the 401 probes)'
  - 'Rate limits are not documented anywhere'
generated_date: '2026-06-10'
---

# API Investigation Questionnaire: Better Impact (Volunteer Impact)

> **Source:** Official Better Impact support-center research on **2026-05-28** — the API
> reference (9824270), API-key creation (9824266) and API lookup (9824303) articles plus the
> official C# SDK on GitHub — reformatted into the standard connector pack on 2026-06-10.
> Original `[DOCUMENTED — S#]` confidence tags are preserved as `[DOCS — S#]`.
>
> ⚠️ **NO AUTHENTICATED CALL has been made** (no credentials). Live probes confirmed only that
> the base URL exists and endpoints gate on auth (401) — error bodies, envelope behaviour and
> rate limits are NOT live-verified. The Numa connector path has also NOT been live-validated —
> `01-llm-api-rules.md` must open with the not-live-validated banner.
>
> **Markers:** `[DOCS — S#]` = official documentation source S# (see 1.1) · `[CONFIRMED]` =
> live (unauthenticated) test 2026-05-28 · `[INFERRED]` = deduced from patterns/SDK ·
> `[UNVERIFIED]` = plausible but unconfirmed · `[UNKNOWN]` = looked, not found.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

| #   | URL                                                                    | Quality                  | What it covers                                  |
| --- | ---------------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| S1  | `https://support.betterimpact.com/en/articles/9824270-api`             | ★★★★★ primary official   | Full endpoint reference, field schemas, auth     |
| S2  | `https://support.betterimpact.com/en/articles/9824266-create-api-keys` | ★★★★☆ official           | API key creation procedure (admin UI)            |
| S3  | `https://support.betterimpact.com/en/articles/9824303-api-lookup`      | ★★★★☆ official           | Lookup/reference-data endpoints                  |
| S4  | `https://github.com/BetterImpact/ApiClient`                            | ★★★☆☆ official C# SDK    | Reference client, project structure, unit tests  |
| S5  | `https://github.com/BetterImpact`                                      | ★★★☆☆ GitHub org         | Repo inventory                                   |

- **Changelog / status page / webhook guide URLs:** none found [UNKNOWN]

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec:** **none** — confirmed 404 at `api.betterimpact.com/swagger.json`
  [CONFIRMED — live test 2026-05-28]. **Postman collection / MCP server:** none found [UNKNOWN]
- **Official SDKs:** C# only — `BetterImpact/ApiClient` (internal package name
  `VolunteerSquared.ApiClient`, the product's former name). No npm, PyPI or Java SDKs [DOCS — S4, S5]
- **Community sources:** none — no Stack Overflow threads, forum posts, or third-party
  integration guides about the Better Impact API were found [UNKNOWN — searched]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                  |
| ------------------------- | ------ | ----------------------------------------------------------------------- |
| Authentication            | 4      | Basic auth + key-creation procedure clearly documented [DOCS — S1, S2]; key format/expiry not shown |
| Endpoint reference        | 4      | Complete endpoint list with query parameters and field schemas [DOCS — S1, S3] |
| Request/response examples | 3      | Field tables and envelope shape documented; few full worked examples     |
| Errors / rate limits / changelog | 1 | **Nothing** — no error format, no status codes, no limits, no versioning page [UNKNOWN] |
| Pagination documentation  | 4      | page_number/page_size + full response Header envelope documented [DOCS — S1] |
| Webhook documentation     | —      | No webhooks exist [UNKNOWN]                                              |
| SDKs / code examples      | 2      | One official C# SDK with unit tests; no other languages [DOCS — S4]      |

**Overall documentation quality:** adequate — the read surface (endpoints, params, fields,
pagination) is well documented in the support articles; the operational surface (errors, rate
limits, versioning) is entirely undocumented.

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation (support-center articles S1–S3) [DOCS]
- [x] Confirmed no OpenAPI/Swagger spec (404 at `/swagger.json`) [CONFIRMED]
- [x] Identified authentication method (HTTP Basic, admin-created API key pairs) [DOCS — S1, S2]
- [ ] Found at least one working **authenticated** example — **NOT done; no credentials** [UNKNOWN]
- [ ] Identified rate limit information — **none documented** [UNKNOWN]
- [x] Identified pagination approach (0-based page_number + page_size, Header envelope) [DOCS — S1]
- [x] Checked for webhook/event support (none — polling via `updated_since`) [DOCS — S1]
- [x] Checked for official SDKs (C# only) [DOCS — S4, S5]

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Better Impact Volunteer Impact API [DOCS — S1]
- **Vendor / company:** Better Impact (`betterimpact.com`) — volunteer management. The same
  API serves the Volunteer Impact, Donor Impact, Client Impact and Member Impact products [DOCS — S1]
- **Current API version:** v1 [DOCS — S1]; other versions [UNKNOWN — no changelog found]
- **Base URL:** Production `https://api.betterimpact.com/v1/` — single fixed SaaS host
  [DOCS — S1]; sandbox/testing: none documented [UNKNOWN]
- **API type:** REST, JSON responses [DOCS — S1]. **Stability / SLA:** [UNKNOWN]
- **Intended audience:** technical/IT staff in organisations using Better Impact [DOCS — S1, S2]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport / format:** HTTPS; JSON responses [DOCS — S1]
- **URL structure pattern:** scope-prefixed resource paths — every data endpoint exists under
  one (or both) of two scopes [DOCS — S1]:

```
https://api.betterimpact.com/v1/{scope}/{resource}
  scope = enterprise    (multi-organisation tier — data across all child orgs)
  scope = organization  (single organisation)
e.g. GET /v1/organization/users/ · /v1/enterprise/timelog_entries · /v1/organization/look_up/activity_categories
```

- **Versioning:** URL path (`/v1/`). **Required headers (all requests):** only
  `Authorization: Basic <base64(user:pass)>` — the API-key credential pair (see 2.3); no
  other special headers are documented [DOCS — S1]

### 2.3 Authentication [REQUIRED]

**Auth method: HTTP Basic Authentication over HTTPS.** [DOCS — S1]

```
Authorization: Basic <base64(username:password)>
```

[DOCS — S1; header construction confirmed by Basic-auth convention — INFERRED]

- **Credential source:** API keys created by an **administrator** in the Better Impact admin
  UI [DOCS — S2]: **Configuration → Organisation Settings → Security Settings → API Keys
  section → [+ Create API Key]** → check **Enabled** to activate → check the **module
  checkboxes** (Volunteer, Client, Member, Donor, Administrator) → click **[Create API Key]**
  → the system generates a **username + password pair**. Each API key IS that pair — the
  username/password format is not shown in the docs [DOCS — S1; format UNKNOWN]
- **Scope mechanism:** **module-based.** A key only returns data for the modules checked at
  creation — e.g. a key without the Volunteer module checked will not return volunteers in
  user lists. **Missing modules are silently filtered, not an error** [DOCS — S1]
- **Key management:** admins **Edit** or **Delete** keys via the **[Options]** button; access
  to "Manage API Keys" can itself be restricted to Limited Access Admins [DOCS — S2]
- **Expiry / rotation:** [UNKNOWN — not documented]. Deletion invalidates a key; rotation =
  delete (or edit) + create a new pair. **OAuth / SSO:** none — plain Basic only [DOCS — S1]
- **Multi-tenancy:** Enterprise scope spans multiple organisations; Organisation scope is
  single-org [DOCS — S1]. Whether one key serves both scopes (or enterprise keys are created
  at a different admin level) is [UNVERIFIED]

### 2.4 First Successful Call [REQUIRED] — CRITICAL GATE

> ⛔ **GATE NOT PASSED.** No credentials were available. Live unauthenticated probes
> (2026-05-28) confirmed the host and auth gating, but no 200 response has ever been seen:
>
> - `GET https://api.betterimpact.com/v1/organization/users/` → **HTTP 401** [CONFIRMED]
> - `GET https://api.betterimpact.com/v1/organization/look_up/activity_categories` → **HTTP 401** [CONFIRMED]
> - 401 response **body** not captured (fetch tool returned an empty body) [UNKNOWN]

**Endpoint planned for first call (when a key pair is available)** — the cheapest probe;
proves auth + envelope + paging Header in one shot. Follow with one bad-credential request to
capture the real 401 body shape:
`GET /v1/organization/users/?page_size=1&include_custom_fields=false&include_qualifications=false`
with `Authorization: Basic <base64(username:password)>`.

- [ ] **GATE CHECK: First successful authenticated API call completed and documented above** —
  **NOT DONE; blocked on credentials**

---

## Phase 3: Domain Model & Behavior

### 3.1 Core Entities [REQUIRED]

> Better Impact models volunteer operations: **Users** (volunteers/clients/donors/members/
> admins, with per-organisation **Memberships**) log **Timelog Entries** (hours worked)
> against **Activities** (grouped into categories and report groups), enriched by **Custom
> Fields**, **Qualifications** and **Feedback Fields**. All field lists are from S1.

#### Entity: User

- **Endpoints:** `GET /v1/{scope}/users/`, `GET /v1/{scope}/users/{user_id}`,
  `GET /v1/{scope}/by_id_list/users?ids={ids}` (max 250 ids) [DOCS — S1]
- **CRUD support:** **Read only** — no create/update/delete endpoints exist [INFERRED from
  absence of write endpoints in official docs]
- **Core fields** [DOCS — S1]: identity/account — `user_id` (integer PK), `first_name`,
  `last_name`, `legal_first_name`, `middle_name`, `title`, `suffix`, `pronouns`, `username`
  (SSO or system username), `single_sign_on_enabled` (boolean); address — `address_line_1`,
  `address_line_2`, `city`, `zip_code`, `state`, `country`, `region`, `region_code`;
  contact — `email_address`, `secondary_email_address`, `mobile_email_address`, `home_phone`,
  `work_phone` (+`work_phone_ext`), `cell_phone`, `phone_preference`; social —
  `twitter_username`, `linkedIn_profile_url`, `Instagram_username` (⚠️ the inconsistent
  capitalisation is **as documented**); dates — `birthday` (ISO 8601 UTC, may be null),
  `date_created`, `date_updated` (ISO 8601 UTC); group/media — `is_group` (boolean — profile
  represents a group), `group_name`, `photo_url_scaled`, `photo_url_original`,
  `timeclock_qr_code_url` (URLs); nested arrays — `memberships`, `custom_fields`,
  `qualifications`, `background_check_results`

#### Entity: Membership (nested on User)

A user can hold memberships at multiple organisations (enterprise context). Key fields:
`organization_id`, `is_volunteer`, `volunteer_status`, `volunteer_total_hours`, `is_client`,
`client_status`, `is_donor`, `donor_status`, `is_member`, `member_status`,
`is_administrator`, etc. [DOCS — S1]

#### Entity: Timelog Entry

- **Endpoints:** `GET /v1/{scope}/timelog_entries`, `GET /v1/{scope}/timelog_entries/{id}`,
  `GET /v1/{scope}/by_id_list/timelog_entries?ids={ids}` (max 250) [DOCS — S1]
- **CRUD support:** **Read only** [INFERRED]
- **Fields** [DOCS — S1]: `timelog_entry_id`, `date_worked`, `hours_worked` (number),
  `approved` (boolean), `timelog_entry_type` (Unknown/Logged/Timeclock/Automatic),
  `activity_id`, `activity_name`, `activity_category_id`, `activity_category_name`,
  `activity_report_group_id`, `user_id`, `first_name`, `last_name`, `organization_id`,
  `created_by_user_id`, `recorded_feedback_fields` (array)

#### Supporting entities [DOCS — S1, S3]

- **Custom Field** (value on User; definitions via `look_up/custom_fields`). Value types:
  `yes_no` (boolean), `short_text`, `long_text`, `number` (decimal), `file` (URL string —
  downloadable via the custom-field file endpoint, see 8.5), `drop_down` (string +
  `value_id` integer), `date` (ISO 8601 UTC string), `check_box`
- **Feedback Field** (nested on Timelog Entry; definitions via `look_up/feedback_fields`):
  `feedback_field_id`, `feedback_field_name`, `value` (string or number), `value_id`
  (integer, dropdown only)
- **Lookups (reference data):** see Phase 4.3

### 3.2 Entity Relationships [IMPORTANT]

```
Organization (enterprise tier: many per account) ──┐
                                                   │ per-org membership
User ──< Membership (volunteer/client/donor/member/admin status per org)
  ├──< CustomField value  (definition → look_up/custom_fields)
  ├──< Qualification      (definition → look_up/qualifications)
  ├──< BackgroundCheckResult  (Sterling Volunteers integration [DOCS — S1])
  └──< TimelogEntry ──> Activity (id+name denormalized on the entry)
            │               └──> ActivityCategory · ActivityReportGroup
            └──< RecordedFeedbackField (definition → look_up/feedback_fields)
```

Relationships are expressed by **denormalized ids + names on the child record** (e.g. a
timelog entry carries `activity_id` AND `activity_name`) — there is no `expand`/include-link
mechanism beyond the boolean `include_*` flags on user list calls [DOCS — S1].

### 3.3 State Machines [IMPORTANT]

Statuses are **fixed per-module enums on the membership**, not workspace-defined lookups
[DOCS — S1]:

| Module    | Status values                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Volunteer | `applicant`, `inprocess`, `accepted`, `inactiveshortterm`, `inactivelongterm`, `archiveddidntstart`, `archivedrejected`, `archiveddismissed`, `archivedmoved`, `archivedquit`, `archiveddeceased`, `archivedother` |
| Client    | `applicant`, `inprocess`, `accepted`, `inactive`, `archived`                                                         |
| Donor     | `prospect`, `active`, `inactive`, `archived`                                                                         |
| Member    | `applicant`, `inprocess`, `accepted`, `inactive`, `archived`                                                         |
| Admin     | `active`, `inactive`                                                                                                 |

Transitions happen in the Better Impact app only — the API is read-only, so no state can be
moved through it [INFERRED].

### 3.4 Business Rules [IMPORTANT]

- **Read-only API** — no POST/PUT/PATCH/DELETE endpoints are documented anywhere [INFERRED
  from absence]. The docs position the API as an **export** mechanism alongside CSV/Excel:
  *"Our API builds half of the bridge to port your data over and the other half of the
  bridge, you will need to build."* [DOCS — S1]
- **Module filtering is silent:** a key missing a module omits that module's data **without
  any error** — misconfigured keys return incomplete data that looks normal [DOCS — S1]
- **Include flags default ON:** `include_custom_fields` / `include_qualifications` /
  `include_memberships` / `include_verified_volunteers_background_check_results` all default
  `"true"` on user lists — turn them off for lean payloads [DOCS — S1]
- **Enterprise-only parameters:** `organization_ids` exists only on enterprise endpoints [DOCS — S1]

### 3.5 Field Format Reference [IMPORTANT]

| Format    | Pattern                                                  | Example                          | Notes                                          |
| --------- | --------------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| ID        | integer                                                   | `12345`                           | `user_id`, `timelog_entry_id`, `activity_id`, … [DOCS — S1] |
| DateTime  | ISO 8601, .NET round-trip ("O") format — `yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK` | `2024-05-01T00:00:00.0000000Z` | Required for datetime **parameters** [DOCS — S1]; laxer ISO variants [UNVERIFIED]. Timezone UTC (`Z`) [INFERRED from "ISO 8601 UTC" labels] |
| Boolean / multi-value params | string `"true"`/`"false"` / comma-separated | `include_memberships=false` · `modules=volunteer,client` | Boolean strings; comma-sep for ids/modules/statuses [DOCS — S1] |
| Enums     | fixed lowercase tokens                                    | `volunteer_status=accepted`       | See 3.3 [DOCS — S1]                             |

---

## Phase 4: Endpoint Catalog

> All endpoints are **GET**, require Basic auth, return JSON, and exist in `enterprise`
> and/or `organization` scope [DOCS — S1, S3].

### 4.1 Users [DOCS — S1]

- `GET /v1/enterprise/users/` — list all users across the enterprise;
  `GET /v1/organization/users/` — list users in one org
- `GET /v1/{scope}/users/{user_id}` — single user;
  `GET /v1/{scope}/by_id_list/users?ids={ids}` — batch by id list (**max 250 ids**)
- `GET /v1/{scope}/users/{user_id}/custom_fields/{user_custom_field_id}/file` —
  custom-field file download

**List Users query parameters** [DOCS — S1]: `page_size` (1–250, default 100) ·
`page_number` (**0-based**, default 0) · `include_custom_fields` / `include_qualifications` /
`include_memberships` / `include_verified_volunteers_background_check_results` (boolean
strings, default `"true"`) · `organization_ids` (comma-sep integers, **enterprise only**) ·
`modules` (comma-sep: `volunteer`/`vol`, `client`/`cli`, `member`/`mem`, `donor`/`don`,
`administrator`/`admin`) · `volunteer_status` / `client_status` / `donor_status` /
`member_status` / `admin_status` (comma-sep enums — values in 3.3) · `updated_since`
(ISO 8601 — profiles updated after this datetime).

### 4.2 Timelog Entries [DOCS — S1]

- `GET /v1/{scope}/timelog_entries` — list hours-worked entries (filterable);
  `GET /v1/{scope}/timelog_entries/{id}` — single entry
- `GET /v1/{scope}/by_id_list/timelog_entries?ids={ids}` — batch by id list (**max 250 ids**)

**List Timelog Entries query parameters** [DOCS — S1]: `page_size` / `page_number` (as for
users) · `user_ids` · `activity_ids` · `activity_category_ids` · `activity_report_group_ids`
(comma-sep integers) · `include_recorded_feedback_fields` (boolean string, default `"true"`) ·
`approved` (boolean string, default `"true"` — filter by approval status) · `updated_since` ·
`created_from` / `created_to` · `worked_from` / `worked_to` (ISO 8601 datetimes) ·
`organization_ids` (**enterprise only**).

### 4.3 Lookup / Reference Data [DOCS — S1, S3]

All `GET /v1/{scope}/look_up/{resource}`:

- **Org scope only:** `activity_categories` (`/v1/organization/look_up/activity_categories`)
- **Enterprise scope only:** `organizations`, `activity_report_groups`
- **Both scopes:** `qualifications`, `custom_fields`, `feedback_fields`

### 4.4 What the API CANNOT do [INFERRED from absence in official docs]

Create/update/delete **any** record (read-only API); push data into Better Impact; manage
activities, opportunities or schedules; subscribe to real-time events (no webhooks); access
Donor/Client Impact–specific entities beyond membership status on a user record.

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability             | Supported? | Syntax                                  | Notes                                       |
| ---------------------- | ---------- | ---------------------------------------- | -------------------------------------------- |
| Filter by field value  | partial    | dedicated params only                    | modules, statuses, ids — no generic field filter [DOCS — S1] |
| Filter by date range   | yes        | `worked_from`/`worked_to`, `created_from`/`created_to`, `updated_since` | Timelog rich; users only `updated_since` [DOCS — S1] |
| Multi-value (OR)       | yes        | comma-separated                          | ids, modules, statuses [DOCS — S1]           |
| Full-text search       | **no**     | —                                        | No search endpoint anywhere [UNKNOWN]        |
| Sort                   | **no**     | —                                        | No sort parameter documented [UNKNOWN]       |
| Field selection / include related | partial | `include_*` boolean flags (default on) | Toggle heavy nested arrays only: memberships/custom fields/qualifications/background checks [DOCS — S1] |
| Aggregate / count      | partial    | `total_items_count` in paging Header     | Plus `volunteer_total_hours` on memberships [DOCS — S1] |
| Logical AND across params | yes     | multiple query params                    | [INFERRED — standard behaviour, UNVERIFIED]  |

### 5.2 Common Query Patterns [REQUIRED]

```http
# 1 — accepted volunteers, lean payload
GET /v1/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_verified_volunteers_background_check_results=false&page_size=250
# 2 — profiles changed since last sync (delta polling)
GET /v1/organization/users/?updated_since=2026-06-01T00:00:00.0000000Z
# 3 — approved hours worked in a date window (per-volunteer history: add &user_ids=12345)
GET /v1/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-06-01T00:00:00.0000000Z&approved=true
# 4 — batch-fetch specific users (max 250 ids)
GET /v1/organization/by_id_list/users?ids=101,102,103
# 5 — resolve activity category names for reporting
GET /v1/organization/look_up/activity_categories
```

(All with `Authorization: Basic …`. Datetime literals use the .NET "O" format — shorter ISO
forms [UNVERIFIED].)

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Type:** page-number + page-size; **`page_number` is 0-based** [DOCS — S1]
- **`page_size`:** 1–250, default 100 [DOCS — S1]
- **Total count:** yes — `total_items_count` in the response `Header` [DOCS — S1]

**Response envelope for paginated results** [DOCS — S1]:

```json
{
  "Header": {
    "first_item_on_page": 1, "last_item_on_page": 100, "page_count": 5,
    "has_next_page": true, "has_previous_page": false,
    "is_first_page": true, "is_last_page": false,
    "page_number": 0, "page_size": 100, "total_items_count": 437
  },
  "Users": [ ... ]          // or "TimelogEntries": [ ... ]
}
```

⚠️ The data key is the **PascalCase resource name** (`Users` / `TimelogEntries`), and the
envelope key is `Header` — capitalisation matters [DOCS — S1].

### 6.2 Pagination Worked Example / 6.3 Bulk Operations

```
Page 1: GET /v1/organization/users/?page_size=250&page_number=0
Page 2: GET /v1/organization/users/?page_size=250&page_number=1
Stop:   Header.has_next_page == false   (or Header.is_last_page == true)
```

- **Batch read only:** `by_id_list` endpoints accept up to **250 comma-separated ids** per
  request (users, timelog entries) [DOCS — S1]
- No bulk create/update/delete (read-only API); no async export endpoints [INFERRED]

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism                                 | Supported? | Notes                                              |
| ----------------------------------------- | ---------- | --------------------------------------------------- |
| Webhooks / WebSocket / SSE / long polling | **no**     | Not mentioned in any official documentation [UNKNOWN — searched] |

### 7.4 Polling Fallback [IMPORTANT]

- **`updated_since`** on both users and timelog lists is the designed change-detection path
  [DOCS — S1]. Pattern: `GET /v1/{scope}/users/?updated_since={watermark}` per polled
  resource; advance the watermark from `date_updated` on returned records
- **Rate-limit implications:** unknown (no limits documented) — poll conservatively [UNKNOWN]

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

- **Limits / burst / throttle headers / Retry-After:** [UNKNOWN] — **not documented
  anywhere**: no numbers, no headers, no 429 reference
- **Strategy until measured:** exponential backoff on any throttle-looking response;
  sequential, modest page-walks (≤2–4 rps) [recommendation, not docs]

### 8.2 Error Handling [REQUIRED]

**Standard error response format: [UNKNOWN — needs testing with credentials].** Nothing is
documented; the live 401 probes returned bodies the fetch tool could not capture.

| HTTP Status | Known?        | Meaning                                  | Recovery                                  |
| ----------- | ------------- | ----------------------------------------- | ------------------------------------------ |
| 401         | [CONFIRMED]   | Missing/invalid Basic credentials         | Re-enter the key pair (deleted/disabled key, typo) |
| 200 + missing data | [DOCS — S1] | Module not on the key — **silent**, not an error | Check the key's module scope in Better Impact |
| 400/403/404/429/5xx | [UNKNOWN] | Not documented                          | Parse defensively: status first, then try JSON, fall back to raw text |

### 8.3 Idempotency / 8.4 Async Operations [IMPORTANT]

- All documented endpoints are GET — naturally idempotent. No write surface exists, so no
  idempotency-key machinery applies [INFERRED]
- Async operations: none documented [UNKNOWN — nothing suggests any]

### 8.5 File Handling [IMPORTANT]

- **Download only:** `GET /v1/{scope}/users/{user_id}/custom_fields/{user_custom_field_id}/file`
  downloads a custom-field file attachment; `file`-type custom field values are URL strings
  [DOCS — S1]. Response content type / disposition: [UNVERIFIED]. **Upload:** none (read-only API)

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

**Selected integration path:** **Direct API via the Numa native data connector (`request`
operation)** — registry `authType: 'username-password'`, NOT Pipedream, NOT OAuth, NOT a
file source (volunteer-operations records; Files Remote does not apply).

**Justification:** Better Impact auth is an admin-generated **username + password pair sent
as HTTP Basic** — it maps 1:1 onto the existing username-password connector backend
(ProWorkflow precedent): the user's personal vault stores `username` + `password` (= the
API-key pair) and `_user_connector_basic_creds` injects `Authorization: Basic …` on every
call — zero new auth code. Unlike ProWorkflow there is **no account-level admin credential**:
the wizard stores metadata only; the pair is captured per user via the inline chat card.

**Numa request flow:** the agent calls `connectors(name="request", params={connector:
"betterimpact", url: "/organization/users/?page_size=50", method: "GET"})` → the backend
resolves `base_url` (`https://api.betterimpact.com/v1`, from `connector-config-betterimpact`)
and injects `Authorization: Basic …` from the user vault (`connector-betterimpact`:
`username` + `password`) → forwards; the agent never sees the credentials.

### 9.2 Connector Requirements [IMPORTANT]

Not a file connector — `list_files`/`download_file` mapping N/A (custom-field file downloads
ride the generic `request` path).

- **Auth type:** `username-password` — per-user Basic pair in the personal vault, captured
  via the inline chat credential card on first use
- **Per-client config:** none — fixed SaaS base URL from the registry; wizard instance URL
  stays empty. **Category:** Volunteer Management — **Caching:** `projectManagement` preset
- **Better Impact-side prerequisite:** an **administrator** creates an API key (Configuration
  → Organisation Settings → Security Settings → API Keys) with the right **modules** checked,
  and hands the generated username/password pair to the connecting user

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Answer volunteer-ops questions: rosters by module/status, profile details (memberships,
   custom fields, qualifications, background-check results), hours worked with date/activity/
   approval filters, per-volunteer hour histories, activity-category breakdowns
2. Delta-sync style reporting via `updated_since` watermarks; batch-fetch up to 250 records
   by id (`by_id_list`)
3. Resolve reference data via the `look_up` endpoints (categories, qualifications, custom and
   feedback field definitions, enterprise org lists)
4. Connection diagnostics via `GET /v1/organization/users/?page_size=1` (+ includes off)

**CANNOT do (out of scope or dangerous — encode in LLM rules):**

1. Write anything — the API is **read-only** (no volunteer updates, no hour logging, no scheduling)
2. Set the `Authorization` header itself (backend-injected Basic); register webhooks (none
   exist); full-text search (no endpoint)
3. Treat empty module data as proof of absence — **a key missing the module returns empty
   data silently**; suggest checking the key's module scope when results are unexpectedly empty
4. Use 1-based page numbers (`page_number` is 0-based) or `page_size` > 250

**Default parameters:**

| Parameter | Default                                       | Reason                                          |
| --------- | ---------------------------------------------- | ------------------------------------------------ |
| `page_size` | 50–100 for answers; 250 for full walks       | Default 100 with all includes on is heavy        |
| `include_*` | `false` unless the nested data is needed     | Custom fields/qualifications/background checks bloat payloads |
| datetimes | .NET "O" format `…T00:00:00.0000000Z`          | The only documented accepted format [DOCS — S1]  |

### 9.4 SDK Assessment [NICE-TO-HAVE]

- **`BetterImpact/ApiClient` (C#, fair quality, last commit Nov 2025):** reference only.
  Namespace `VolunteerSquared.ApiClient` reflects the product's former name ("Volunteer
  Squared") [INFERRED from SDK namespace]; the latest commit adds unit tests that "exercise
  all endpoints" — the best source of real response-body examples short of credentials
  [DOCS — S4, S5]
- No npm/PyPI/Java SDKs, no Postman collection, no OpenAPI spec, no MCP server [UNKNOWN — searched]

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed; no machine-readable spec exists
- [ ] Phase 2 **partially**: auth model fully documented; **first-call gate NOT passed (no credentials)**
- [x] Phase 3 complete: entities, membership model, status enums, module-scoping rules
- [x] Phase 4 complete: full endpoint catalog (all GET) with parameter reference from S1/S3
- [x] Phase 5 complete: dedicated-parameter filtering documented; no search/sort exists
- [x] Phase 6 complete: 0-based page-number pagination with the Header envelope; 250-id batch reads
- [x] Phase 7 complete: no webhooks → `updated_since` delta polling
- [ ] Phase 8 **partially**: error body format and rate limits entirely [UNKNOWN]
- [x] Phase 9 complete: username-password connector selected (ProWorkflow precedent, minus the account key)

**Overall investigation confidence:** **medium** — the read surface is documented to field
level in official articles; zero authenticated validation, unknown error bodies and unknown
rate limits cap confidence.

**Known gaps that will reduce output quality:**

1. **No authenticated call ever made** — envelope, error bodies, 401 shape, throttle all need a credentialed test
2. **Rate limits undocumented** — bulk page-walks could hit invisible limits; measure empirically
3. **Datetime parameter strictness** — is the .NET "O" literal required, or are `2024-05-01` / `…T00:00:00Z` accepted? [UNVERIFIED]
4. **API-key username/password format** — never shown in docs [UNKNOWN]
5. **Enterprise vs organisation key scoping** — which scope(s) a given key can call [UNVERIFIED]
6. **Error format mining** — the C# SDK unit tests are the best next source for real response/error shapes short of credentials [DOCS — S4]

### 10.2 Generation Prompts [REQUIRED]

Standard pack from this questionnaire (templates in `ext-api-doc/_templates/`):
**01-llm-api-rules** (Phases 2/4/8/9 — open with the not-live-validated banner; mandate
0-based paging, `include_*=false` defaults, the .NET datetime format, read-only surface, the
"empty data may mean key module scope" rule) · **01a-domain-model-reference** (Phase 3) ·
**01b-query-patterns** (Phases 5–6) · **01c-mutation-patterns** (trivial — read-only;
document the absence) · **01d-event-and-error-handling** (Phases 7–8) ·
**02-api-spec-investigation** (all phases condensed) · **03-connector-setup** (Phase 9 —
real wiring) · **04-connection-and-reauth** (Phase 2.3 + lifecycle: admin-managed keys,
delete/disable → 401 → chat card; module-scope edits).

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                  |
| ---------------------------- | ------------- | ---------- | ------------------------------------------------------ |
| 01-llm-api-rules             | yes           | medium     | Error bodies + rate limits unknown                     |
| 01a-domain-model-reference   | yes           | medium-high | Field lists are docs-grade; no live response samples  |
| 01b-query-patterns           | yes           | medium-high | Parameter tables docs-grade; datetime strictness unverified |
| 01c-mutation-patterns        | yes (trivial) | high       | Read-only API — the document records the absence      |
| 01d-event-and-error-handling | yes           | medium     | Polling design solid; error shapes unknown             |
| 02-api-spec-investigation    | yes           | medium-high | No spec file, but articles cover the full catalog     |
| 03-connector-setup           | yes           | high       | Standard username-password connector; wiring is real code |
| 04-connection-and-reauth     | yes           | high       | Key lifecycle simple and documented (admin UI)         |

---

_Originally investigated 2026-05-28 from the official Better Impact support-center articles
(S1–S3) and the official C# SDK (S4–S5); reformatted into the standard connector pack
2026-06-10. **No authenticated call has been made — re-validate flagged items with a real
API key before first customer use.**_
