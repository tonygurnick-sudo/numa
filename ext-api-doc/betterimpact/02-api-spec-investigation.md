---
api_name: 'Better Impact (Volunteer Impact) API v1'
api_slug: 'betterimpact'
base_url: 'https://api.betterimpact.com/v1'
version: 'v1 (no changelog or other versions found)'
spec_format: 'none' # no OpenAPI/Swagger spec — confirmed 404 at /swagger.json
spec_url: 'Not available'
docs_url: 'https://support.betterimpact.com/en/articles/9824270-api'
date_researched: '2026-05-28'
generated_date: '2026-06-10'
---

# Better Impact — API Specification & Investigation

> Developer reference for the Better Impact (Volunteer Impact) REST API — the condensed
> output of `00-api-investigation-questionnaire.md`. Researched 2026-05-28 from the official
> support-center articles (API reference 9824270, key creation 9824266, lookups 9824303) and
> the official C# SDK (`BetterImpact/ApiClient`).
>
> ⚠️ **NO AUTHENTICATED CALL has been made** — no credentials were available. Live probes
> confirmed only that endpoints gate on auth (401) and that no Swagger spec exists (404).
> Error response bodies and rate limits are unknown (§Known Unknowns). Verify against a real
> API key before first customer use.
>
> Tags: `[DOCS — S#]` = official documentation source (see the 00 file's source catalog) ·
> `[CONFIRMED]` = live-tested 2026-05-28 · `[INFERRED]` / `[UNVERIFIED]` / `[UNKNOWN]`.

---

## Overview

- **Vendor / product:** Better Impact — volunteer management (Volunteer Impact; the same API
  serves Donor/Client/Member Impact) [DOCS — S1]
- **API style:** REST, JSON, **GET-only / read-only** — positioned as a data **export**
  mechanism ("our API builds half of the bridge…") [DOCS — S1 / INFERRED]
- **Base URL:** `https://api.betterimpact.com/v1/` — single fixed SaaS host [DOCS — S1]
- **Versioning:** URL path `/v1/`; no changelog or other versions found [UNKNOWN]
- **Auth:** **HTTP Basic** — an admin-created API key IS a username + password pair;
  module-scoped (Volunteer/Client/Member/Donor/Administrator) [DOCS — S1, S2]
- **Two scopes:** `enterprise` (multi-org tier, cross-org data) and `organization`
  (single org) — every data endpoint lives under one or both [DOCS — S1]
- **Envelope:** paginated responses wrap data as `{ "Header": {…paging…}, "Users": […] }` —
  PascalCase resource key [DOCS — S1]
- **Pagination:** 0-based `page_number` + `page_size` (1–250, default 100);
  `total_items_count` available [DOCS — S1]
- **Rate limits:** [UNKNOWN — not documented anywhere]
- **Webhooks:** none — delta-poll with `updated_since` [DOCS — S1]
- **Spec:** no OpenAPI/Swagger (404 at `/swagger.json` [CONFIRMED]), no Postman collection

**Summary:** A small, clean, read-only reporting API: users (volunteers/clients/donors/
members/admins with per-org memberships, custom fields, qualifications, background checks),
timelog entries (hours worked, richly filterable), and lookup tables. Strong parameter-based
filtering, no search, no sort, no writes, no events.

**Numa integration model:** Native data connector (`authType: 'username-password'`, NOT
Pipedream, NOT OAuth). The workspace agent calls
`connectors(name="request", params={connector: "betterimpact", url: "/organization/users/?page_size=50", method: "GET"})`.
The backend expands relative URLs against the stored `base_url`
(`https://api.betterimpact.com/v1`) and injects `Authorization: Basic base64(username:password)`
from the user's personal vault (`connector-betterimpact`, fields `username` + `password` —
the admin-generated API-key pair). See `03-connector-setup.md`.

---

## Authentication

### Method: HTTP Basic auth (admin-created API key = username + password pair)

```
Authorization: Basic <base64(username:password)>
```

- **Key creation (Better Impact admin UI)** [DOCS — S2]:
  **Configuration → Organisation Settings → Security Settings → API Keys →
  [+ Create API Key]** → check **Enabled** → check **module checkboxes** (Volunteer, Client,
  Member, Donor, Administrator) → **[Create API Key]** → the system generates the
  **username + password pair**
- **Module scoping:** the key only returns data for modules checked at creation. A key
  without the Volunteer module **silently omits volunteers** from user lists — empty data,
  not an error [DOCS — S1]
- **Key management:** admins **Edit** or **Delete** keys via **[Options]**; "Manage API Keys"
  access can be restricted to Limited Access Admins [DOCS — S2]
- **Expiry:** [UNKNOWN — not documented]; deletion (or unchecking Enabled) invalidates the
  pair → subsequent calls 401
- **No OAuth, no scopes beyond modules, no refresh tokens** [DOCS — S1]
- **Multi-tenancy:** Enterprise scope spans child organisations; Organisation scope is
  single-org [DOCS — S1]. Which scope(s) a given key can call is [UNVERIFIED]

**Failure semantics:**

| Status | Meaning                                                                            |
| ------ | ------------------------------------------------------------------------------------|
| 401    | Missing/invalid/deleted/disabled key pair — [CONFIRMED] on unauthenticated probes; body shape [UNKNOWN] |
| 200 + missing module data | Key lacks the module — **silent filtering**, the defining gotcha [DOCS — S1] |
| 400/403/404/429 | [UNKNOWN — nothing documented]                                            |

---

## Response Envelope (paginated lists)

```json
{
  "Header": {
    "first_item_on_page": 1,
    "has_next_page": true,
    "has_previous_page": false,
    "is_first_page": true,
    "is_last_page": false,
    "last_item_on_page": 100,
    "page_count": 5,
    "page_number": 0,
    "page_size": 100,
    "total_items_count": 437
  },
  "Users": [ ... ]            // or "TimelogEntries": [ ... ] — PascalCase resource key
}
```

[DOCS — S1] ⚠️ Keys are **PascalCase** (`Header`, `Users`, `TimelogEntries`) while field
names inside records are snake_case (with documented exceptions like `linkedIn_profile_url`).
Single-item and lookup response envelopes: [UNVERIFIED — capture on first credentialed call].

---

## Endpoint Catalog

> Complete — the API surface is small. **Every endpoint is GET**, Basic-authed, JSON.
> `{scope}` = `enterprise` | `organization` unless noted [DOCS — S1, S3].

### Users

| Method | Path                                                                    | Purpose                            |
| ------ | ------------------------------------------------------------------------ | ----------------------------------- |
| GET    | `/v1/{scope}/users/`                                                      | List users (filterable; see below)  |
| GET    | `/v1/{scope}/users/{user_id}`                                             | Single user                         |
| GET    | `/v1/{scope}/by_id_list/users?ids={ids}`                                  | Batch by id — **max 250 ids**       |
| GET    | `/v1/{scope}/users/{user_id}/custom_fields/{user_custom_field_id}/file`   | Download a custom-field file        |

**List parameters:** `page_size` (1–250, default 100) · `page_number` (0-based) ·
`include_custom_fields` / `include_qualifications` / `include_memberships` /
`include_verified_volunteers_background_check_results` (boolean strings, default `"true"`) ·
`modules` (comma-sep: `volunteer|vol`, `client|cli`, `member|mem`, `donor|don`,
`administrator|admin`) · per-module status filters (`volunteer_status`, `client_status`,
`donor_status`, `member_status`, `admin_status` — comma-sep enums) · `updated_since`
(ISO 8601) · `organization_ids` (**enterprise only**) [DOCS — S1]

### Timelog Entries

| Method | Path                                                  | Purpose                          |
| ------ | ------------------------------------------------------ | --------------------------------- |
| GET    | `/v1/{scope}/timelog_entries`                          | List hours-worked entries (filterable) |
| GET    | `/v1/{scope}/timelog_entries/{id}`                     | Single entry                      |
| GET    | `/v1/{scope}/by_id_list/timelog_entries?ids={ids}`     | Batch by id — **max 250 ids**     |

**List parameters:** `page_size` / `page_number` · `user_ids` · `activity_ids` ·
`activity_category_ids` · `activity_report_group_ids` (all comma-sep integers) ·
`include_recorded_feedback_fields` (default `"true"`) · `approved` (boolean string) ·
`updated_since` · `created_from`/`created_to` · `worked_from`/`worked_to` (ISO 8601) ·
`organization_ids` (**enterprise only**) [DOCS — S1]

### Lookup / reference data

| Method | Path                                               | Scope availability  |
| ------ | --------------------------------------------------- | -------------------- |
| GET    | `/v1/organization/look_up/activity_categories`      | **Org only**         |
| GET    | `/v1/enterprise/look_up/organizations`              | **Enterprise only**  |
| GET    | `/v1/enterprise/look_up/activity_report_groups`     | **Enterprise only**  |
| GET    | `/v1/{scope}/look_up/qualifications`                | Both                 |
| GET    | `/v1/{scope}/look_up/custom_fields`                 | Both                 |
| GET    | `/v1/{scope}/look_up/feedback_fields`               | Both                 |

### Write surface

**None.** No POST/PUT/PATCH/DELETE endpoints are documented — the API is read-only
[INFERRED from absence; the docs frame it as an export mechanism — DOCS — S1]. Anything that
must change data in Better Impact happens in the Better Impact app, not via this API.

---

## Data Models

### Relationships

```
Organization (enterprise tier) ──┐ per-org membership
User ──< Membership (module flags + per-module status, volunteer_total_hours)
  ├──< CustomField value          (defs → look_up/custom_fields)
  ├──< Qualification              (defs → look_up/qualifications)
  ├──< BackgroundCheckResult      (Sterling Volunteers integration)
  └──< TimelogEntry ──> Activity → ActivityCategory · ActivityReportGroup
            └──< RecordedFeedbackField (defs → look_up/feedback_fields)
```

Relationships are **denormalized ids + names on the child** (`activity_id` +
`activity_name` on a timelog entry) — no expand/link mechanism beyond the `include_*` flags
on user lists [DOCS — S1].

### User (core fields) [DOCS — S1]

| Group    | Fields                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------- |
| Identity | `user_id` (int PK), `first_name`, `last_name`, `legal_first_name`, `middle_name`, `title`, `suffix`, `pronouns` |
| Address  | `address_line_1/2`, `city`, `zip_code`, `state`, `country`, `region`, `region_code`             |
| Contact  | `email_address`, `secondary_email_address`, `mobile_email_address`, `home_phone`, `work_phone` (+`_ext`), `cell_phone`, `phone_preference` |
| Social   | `twitter_username`, `linkedIn_profile_url`, `Instagram_username` — capitalisation inconsistency is **as documented** |
| Account  | `username`, `single_sign_on_enabled` (bool)                                                     |
| Dates    | `birthday` (nullable), `date_created`, `date_updated` — ISO 8601 UTC strings                    |
| Group    | `is_group` (bool — profile represents a group), `group_name`                                    |
| Media    | `photo_url_scaled`, `photo_url_original`, `timeclock_qr_code_url` (URLs)                        |
| Nested   | `memberships[]`, `custom_fields[]`, `qualifications[]`, `background_check_results[]`            |

### Membership (per organisation) [DOCS — S1]

`organization_id`, `is_volunteer` + `volunteer_status` + `volunteer_total_hours`,
`is_client` + `client_status`, `is_donor` + `donor_status`, `is_member` + `member_status`,
`is_administrator`, etc.

**Status enums (fixed per module):**

| Module    | Values                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Volunteer | `applicant`, `inprocess`, `accepted`, `inactiveshortterm`, `inactivelongterm`, `archiveddidntstart`, `archivedrejected`, `archiveddismissed`, `archivedmoved`, `archivedquit`, `archiveddeceased`, `archivedother` |
| Client    | `applicant`, `inprocess`, `accepted`, `inactive`, `archived`                                              |
| Donor     | `prospect`, `active`, `inactive`, `archived`                                                              |
| Member    | `applicant`, `inprocess`, `accepted`, `inactive`, `archived`                                              |
| Admin     | `active`, `inactive`                                                                                      |

### Timelog Entry [DOCS — S1]

`timelog_entry_id`, `date_worked`, `hours_worked` (number), `approved` (bool),
`timelog_entry_type` (`Unknown`/`Logged`/`Timeclock`/`Automatic`), `activity_id`,
`activity_name`, `activity_category_id`, `activity_category_name`,
`activity_report_group_id`, `user_id`, `first_name`, `last_name`, `organization_id`,
`created_by_user_id`, `recorded_feedback_fields[]`

### Custom field types [DOCS — S1]

`yes_no` (bool) · `short_text` · `long_text` · `number` (decimal) · `file` (URL string —
downloadable via the custom-field file endpoint) · `drop_down` (string + `value_id` int) ·
`date` (ISO 8601 UTC) · `check_box`

### Feedback field (on timelog entries) [DOCS — S1]

`feedback_field_id`, `feedback_field_name`, `value` (string or number), `value_id`
(int, dropdown only)

**Formats:** integer ids; ISO 8601 UTC datetime strings on records; datetime **parameters**
require the .NET round-trip ("O") format `yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK`, e.g.
`2024-05-01T00:00:00.0000000Z` [DOCS — S1] — laxer variants [UNVERIFIED]; boolean params as
strings `"true"`/`"false"`; multi-value params comma-separated.

---

## Querying

| Capability             | Syntax                                          | Notes                                       |
| ---------------------- | ------------------------------------------------ | -------------------------------------------- |
| Module filter          | `?modules=volunteer,client`                      | Long or short tokens (`vol`, `cli`, …) [DOCS — S1] |
| Status filter          | `?volunteer_status=accepted,applicant`           | Per-module params; comma = OR [DOCS — S1]    |
| Date filters           | `?worked_from=…&worked_to=…` (timelog); `?updated_since=…` (both) | .NET "O" datetime literals [DOCS — S1] |
| Id filters             | `?user_ids=1,2,3` · `?activity_ids=…`            | Timelog lists [DOCS — S1]                    |
| Payload control        | `?include_custom_fields=false&…`                 | Heavy nested arrays default ON [DOCS — S1]   |
| Org filter             | `?organization_ids=12,13`                        | Enterprise scope only [DOCS — S1]            |
| Full-text search       | —                                                | **Not supported** [UNKNOWN]                  |
| Sort                   | —                                                | **Not supported** — sort client-side [UNKNOWN] |

```http
# Worked examples (all with Authorization: Basic …)
GET /v1/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_verified_volunteers_background_check_results=false&page_size=250
GET /v1/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-06-01T00:00:00.0000000Z&approved=true
GET /v1/organization/timelog_entries?user_ids=12345
GET /v1/organization/by_id_list/users?ids=101,102,103
GET /v1/organization/users/?updated_since=2026-06-01T00:00:00.0000000Z     # delta polling
GET /v1/organization/look_up/activity_categories
```

---

## Pagination

- **Type:** page-number + page-size; **`page_number` is 0-based** [DOCS — S1]
- **`page_size`:** 1–250, default 100 [DOCS — S1]
- **Total count:** yes — `Header.total_items_count` (+ `page_count`) [DOCS — S1]
- **Last-page detection:** `Header.has_next_page == false` / `Header.is_last_page == true`

```
Page 1: GET /v1/organization/users/?page_size=250&page_number=0
Page 2: GET /v1/organization/users/?page_size=250&page_number=1
Stop:   Header.has_next_page == false
```

**Batch reads:** `by_id_list` endpoints take up to **250 comma-separated ids** [DOCS — S1].
No bulk writes (read-only API), no async export.

---

## Rate Limits

**[UNKNOWN — not documented anywhere.]** No numbers, no headers, no 429 reference, nothing
in the support center or the SDK.

- **Strategy until measured:** sequential page-walks at a modest pace (≤2–4 rps); exponential
  backoff (1s → 5s → 30s, jitter) on any throttle-looking response; capture status/headers on
  the first observed throttle and record them here.

---

## Error Handling

**Error body format: [UNKNOWN — needs live testing].** Nothing documented; the live 401
probes' bodies could not be captured. Parse defensively: status code first, then try JSON,
fall back to raw text.

| Status | Known?      | Meaning                                  | Recovery                                       |
| ------ | ----------- | ----------------------------------------- | ------------------------------------------------ |
| 401    | [CONFIRMED] | Missing/invalid/deleted/disabled key pair | Re-enter credentials via the chat card           |
| 200 + missing data | [DOCS — S1] | Module not on the key — silent  | Check the key's module scope in Better Impact    |
| 400/403/404 | [UNKNOWN] | Undocumented                            | Verify path/params/id; capture bodies when seen  |
| 429/5xx | [UNKNOWN]   | Undocumented                              | Backoff + retry once; record observed behaviour  |

**Idempotency:** trivially safe — the entire surface is GET.

---

## Events & Polling

**No webhooks, no streaming** — nothing in any official documentation [UNKNOWN — searched].

**Polling:** `updated_since` on both users and timelog lists is the designed delta-detection
path [DOCS — S1]:

```
GET /v1/{scope}/users/?updated_since={watermark}           → advance from date_updated
GET /v1/{scope}/timelog_entries?updated_since={watermark}
```

Poll conservatively until rate limits are established empirically.

---

## SDKs & Tooling

- **Official C# SDK:** `https://github.com/BetterImpact/ApiClient` — namespace
  `VolunteerSquared.ApiClient` (the product's former name, "Volunteer Squared"); enterprise
  and organisation consumers; unit tests "exercise all endpoints" (good source for response
  shapes); last commit Nov 2025 [DOCS — S4, S5]
- **Other SDKs / Postman / OpenAPI / MCP:** none found [UNKNOWN — searched;
  `/swagger.json` 404 CONFIRMED]
- **Sterling Volunteers:** background-check integration (First Advantage) — results surface
  on user records via the API [DOCS — S1]

---

## Integration Path Assessment

**Recommended path:** **Direct API via Numa native data connector** (`request` operation),
registry `authType: 'username-password'` — NOT Pipedream, NOT OAuth, not a file source.
Implemented; see `03-connector-setup.md` for the real wiring and
`04-connection-and-reauth.md` for lifecycle.

**Justification:** Basic auth with an admin-generated username/password pair rides the
existing username-password backend (`_user_connector_basic_creds` →
`Authorization: Basic …`) with zero new auth code — the ProWorkflow precedent minus the
account-level API key (Better Impact has no extra header). Fixed SaaS base URL, no special
headers, read-only surface.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` do not
apply; custom-field file downloads ride the generic `request` path).

**Rollout checklist (per customer):**

1. Better Impact admin: create an API key (**Configuration → Organisation Settings →
   Security Settings → API Keys**) with the **modules** the team needs checked
2. Numa admin: add **Better Impact** in Integrations (wizard is metadata-only)
3. Each user: paste the key's username + password into the chat credential card on first use
4. Verify: `GET /v1/organization/users/?page_size=1` → 200; capture one bad-credential 401 body
5. Probe module coverage (volunteers, timelogs) — confirm the key's modules match expectations
6. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md`

---

## Known Unknowns — verify on a credentialed account before customer rollout

1. **Error response body shape** — 401 and any 400/403/404 bodies
2. **Rate limits** — numbers, headers, breach status code
3. **Datetime parameter strictness** — is the full .NET "O" literal required, or are
   `2024-05-01` / `…T00:00:00Z` accepted?
4. **Single-item & lookup response envelopes** — wrapped like lists or bare objects?
5. **Key username/password format** — never shown in docs
6. **Enterprise vs organisation key scoping** — which scope(s) one key can call; behaviour
   of org-scope calls on an enterprise account (and vice versa)
7. **Custom-field file download** — content type, disposition, auth on the returned URL

---

_Researched 2026-05-28 (official support articles + C# SDK); reformatted 2026-06-10.
**No authenticated call was possible — docs-derived only.**
Source: `00-api-investigation-questionnaire.md`._
