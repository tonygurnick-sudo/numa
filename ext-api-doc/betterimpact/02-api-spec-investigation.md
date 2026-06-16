---
api_name: Better Impact (Volunteer Impact)
api_slug: betterimpact
base_url: https://api.betterimpact.com/v1
base_url_ends_in_v1: true
path_note: catalog paths below show the raw SERVER paths WITH /v1 (e.g. /v1/organization/users/). The connector base_url already includes /v1, so the AGENT passes paths WITHOUT /v1 (e.g. /organization/users/). See 01/03.
path_version_segment: /v1/ is baked into base_url; no changelog, no other versions found
spec_format: none — no OpenAPI/Swagger (confirmed 404 at /swagger.json); no Postman collection
docs_url: https://support.betterimpact.com/en/articles/9824270-api
call_surface: native data connector, request operation — connectors(name="request", params={connector:"betterimpact", url, method:"GET"}). NOT Pipedream, NOT OAuth, not a file source.
auth: HTTP Basic — admin-created API key IS a username+password pair; module-scoped
confidence: docs-derived (official support articles 9824270/9824266/9824303 + official C# SDK), researched 2026-05-28, reformatted 2026-06-10. NO authenticated call made. [CONFIRMED] = live probe 2026-05-28 (only: endpoints gate on auth → 401; /swagger.json → 404); else [DOCS]/[INFERRED]/[UNVERIFIED]/[UNKNOWN]. Verify against a real key before first customer use.
---

# Better Impact — API Specification & Investigation

Developer reference — condensed output of `00-api-investigation-questionnaire.md`. `[DOCS — S#]` = official doc source (00 file's source catalog).

## Overview

- **Vendor/product:** Better Impact — volunteer management (Volunteer Impact; same API serves Donor/Client/Member Impact) [S1]
- **Style:** REST, JSON, **GET-only / read-only** — positioned as a data **export** mechanism ("our API builds half of the bridge…") [S1/INFERRED]
- **Base URL:** `https://api.betterimpact.com/v1/` — single fixed SaaS host [S1]
- **Versioning:** path `/v1/`; no changelog or other versions found [UNKNOWN]
- **Auth:** **HTTP Basic** — admin-created API key IS a username+password pair; module-scoped (Volunteer/Client/Member/Donor/Administrator) [S1,S2]
- **Two scopes:** `enterprise` (multi-org tier, cross-org) and `organization` (single org) — every data endpoint under one or both [S1]
- **Envelope:** paginated responses wrap data as `{"Header":{…paging…},"Users":[…]}` — PascalCase resource key [S1]
- **Pagination:** 0-based `page_number` + `page_size` (1–250, default 100); `total_items_count` available [S1]
- **Rate limits:** [UNKNOWN — undocumented]
- **Webhooks:** none — delta-poll with `updated_since` [S1]
- **Spec:** no OpenAPI/Swagger (404 at `/swagger.json` [CONFIRMED]), no Postman collection

**Summary:** small, clean, read-only reporting API — users (volunteers/clients/donors/members/admins with per-org memberships, custom fields, qualifications, background checks), timelog entries (hours, richly filterable), lookup tables. Strong parameter filtering; no search, no sort, no writes, no events.

**Numa integration model:** native data connector (`authType:'username-password'`, NOT Pipedream/OAuth). Agent calls `connectors(name="request", params={connector:"betterimpact", url:"/organization/users/?page_size=50", method:"GET"})`. Backend expands relative URLs against stored `base_url` (`https://api.betterimpact.com/v1`) and injects `Authorization: Basic base64(username:password)` from the user's vault (`connector-betterimpact`, fields `username`+`password` — admin-generated API-key pair). See `03-connector-setup.md`.

## Authentication — HTTP Basic (admin-created API key = username+password pair)

`Authorization: Basic <base64(username:password)>`

- **Key creation (admin UI)** [S2]: **Configuration → Organisation Settings → Security Settings → API Keys → [+ Create API Key]** → check **Enabled** → check **module checkboxes** (Volunteer/Client/Member/Donor/Administrator) → **[Create API Key]** → system generates the **username+password pair**.
- **Module scoping:** key returns data only for modules checked at creation. No Volunteer module → **silently omits volunteers** (empty data, not error) [S1].
- **Key management:** admins **Edit**/**Delete** via **[Options]**; "Manage API Keys" access restrictable to Limited Access Admins [S2].
- **Expiry:** [UNKNOWN]; deletion (or unchecking Enabled) invalidates the pair → calls 401.
- **No OAuth, no scopes beyond modules, no refresh tokens** [S1].
- **Multi-tenancy:** Enterprise scope spans child orgs; Organisation scope single-org [S1]. Which scope(s) a given key can call [UNVERIFIED].

**Failure semantics:**
| Status | Meaning |
| --- | --- |
| 401 | Missing/invalid/deleted/disabled key pair — [CONFIRMED] on unauth probes; body shape [UNKNOWN] |
| 200 + missing module data | Key lacks the module — **silent filtering**, the defining gotcha [S1] |
| 400/403/404/429 | [UNKNOWN — nothing documented] |

## Response envelope (paginated lists)

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
  "Users": []
}
```

[S1] Keys **PascalCase** (`Header`, `Users`, `TimelogEntries`); field names inside snake_case (with documented exceptions like `linkedIn_profile_url`). Single-item and lookup envelopes [UNVERIFIED — capture on first credentialed call].

## Endpoint catalog

Complete — surface is small. **Every endpoint GET**, Basic-authed, JSON. `{scope}` = `enterprise`|`organization` unless noted [S1,S3]. (Paths show raw server `/v1/...`; agent omits `/v1` — see frontmatter `path_note`.)

### Users

| Method | Path                                                                    | Purpose                      |
| ------ | ----------------------------------------------------------------------- | ---------------------------- |
| GET    | `/v1/{scope}/users/`                                                    | List users (filterable)      |
| GET    | `/v1/{scope}/users/{user_id}`                                           | Single user                  |
| GET    | `/v1/{scope}/by_id_list/users?ids={ids}`                                | Batch by id — **max 250**    |
| GET    | `/v1/{scope}/users/{user_id}/custom_fields/{user_custom_field_id}/file` | Download a custom-field file |

**List params:** `page_size` (1–250, default 100) · `page_number` (0-based) · `include_custom_fields`/`include_qualifications`/`include_memberships`/`include_verified_volunteers_background_check_results` (boolean strings, default `"true"`) · `modules` (comma-sep: `volunteer|vol`, `client|cli`, `member|mem`, `donor|don`, `administrator|admin`) · per-module status filters (`volunteer_status`, `client_status`, `donor_status`, `member_status`, `admin_status` — comma-sep enums) · `updated_since` (ISO 8601) · `organization_ids` (**enterprise only**) [S1]

### Timelog entries

| Method | Path                                               | Purpose                                |
| ------ | -------------------------------------------------- | -------------------------------------- |
| GET    | `/v1/{scope}/timelog_entries`                      | List hours-worked entries (filterable) |
| GET    | `/v1/{scope}/timelog_entries/{id}`                 | Single entry                           |
| GET    | `/v1/{scope}/by_id_list/timelog_entries?ids={ids}` | Batch by id — **max 250**              |

**List params:** `page_size`/`page_number` · `user_ids` · `activity_ids` · `activity_category_ids` · `activity_report_group_ids` (comma-sep integers) · `include_recorded_feedback_fields` (default `"true"`) · `approved` (boolean string) · `updated_since` · `created_from`/`created_to` · `worked_from`/`worked_to` (ISO 8601) · `organization_ids` (**enterprise only**) [S1]

### Lookup / reference data

| Method | Path                                            | Scope               |
| ------ | ----------------------------------------------- | ------------------- |
| GET    | `/v1/organization/look_up/activity_categories`  | **Org only**        |
| GET    | `/v1/enterprise/look_up/organizations`          | **Enterprise only** |
| GET    | `/v1/enterprise/look_up/activity_report_groups` | **Enterprise only** |
| GET    | `/v1/{scope}/look_up/qualifications`            | Both                |
| GET    | `/v1/{scope}/look_up/custom_fields`             | Both                |
| GET    | `/v1/{scope}/look_up/feedback_fields`           | Both                |

### Write surface

**None.** No POST/PUT/PATCH/DELETE documented — read-only [INFERRED from absence; docs frame it as export — S1]. Data changes happen in the Better Impact app, not via the API.

## Data models

### Relationships

```
Organization (enterprise tier) ──┐ per-org membership
User ──< Membership (module flags + per-module status, volunteer_total_hours)
  ├──< CustomField value         (defs → look_up/custom_fields)
  ├──< Qualification             (defs → look_up/qualifications)
  ├──< BackgroundCheckResult     (Sterling Volunteers integration)
  └──< TimelogEntry ──> Activity → ActivityCategory · ActivityReportGroup
            └──< RecordedFeedbackField (defs → look_up/feedback_fields)
```

Relationships = **denormalized ids + names on the child** (`activity_id`+`activity_name` on a timelog entry) — no expand/link mechanism beyond the `include_*` flags on user lists [S1].

### User (core fields) [S1]

| Group    | Fields                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity | `user_id` (int PK), `first_name`, `last_name`, `legal_first_name`, `middle_name`, `title`, `suffix`, `pronouns`                            |
| Address  | `address_line_1/2`, `city`, `zip_code`, `state`, `country`, `region`, `region_code`                                                        |
| Contact  | `email_address`, `secondary_email_address`, `mobile_email_address`, `home_phone`, `work_phone` (+`_ext`), `cell_phone`, `phone_preference` |
| Social   | `twitter_username`, `linkedIn_profile_url`, `Instagram_username` — capitalisation inconsistency is **as documented**                       |
| Account  | `username`, `single_sign_on_enabled` (bool)                                                                                                |
| Dates    | `birthday` (nullable), `date_created`, `date_updated` — ISO 8601 UTC strings                                                               |
| Group    | `is_group` (bool — profile is a group), `group_name`                                                                                       |
| Media    | `photo_url_scaled`, `photo_url_original`, `timeclock_qr_code_url` (URLs)                                                                   |
| Nested   | `memberships[]`, `custom_fields[]`, `qualifications[]`, `background_check_results[]`                                                       |

### Membership (per organisation) [S1]

`organization_id`, `is_volunteer`+`volunteer_status`+`volunteer_total_hours`, `is_client`+`client_status`, `is_donor`+`donor_status`, `is_member`+`member_status`, `is_administrator`, etc.

**Status enums (fixed per module):**
| Module | Values |
| --- | --- |
| Volunteer | `applicant`, `inprocess`, `accepted`, `inactiveshortterm`, `inactivelongterm`, `archiveddidntstart`, `archivedrejected`, `archiveddismissed`, `archivedmoved`, `archivedquit`, `archiveddeceased`, `archivedother` |
| Client | `applicant`, `inprocess`, `accepted`, `inactive`, `archived` |
| Donor | `prospect`, `active`, `inactive`, `archived` |
| Member | `applicant`, `inprocess`, `accepted`, `inactive`, `archived` |
| Admin | `active`, `inactive` |

### Timelog entry [S1]

`timelog_entry_id`, `date_worked`, `hours_worked` (number), `approved` (bool), `timelog_entry_type` (`Unknown`/`Logged`/`Timeclock`/`Automatic`), `activity_id`, `activity_name`, `activity_category_id`, `activity_category_name`, `activity_report_group_id`, `user_id`, `first_name`, `last_name`, `organization_id`, `created_by_user_id`, `recorded_feedback_fields[]`

### Custom field types [S1]

`yes_no` (bool) · `short_text` · `long_text` · `number` (decimal) · `file` (URL string — downloadable via the custom-field file endpoint) · `drop_down` (string + `value_id` int) · `date` (ISO 8601 UTC) · `check_box`

### Feedback field (on timelog entries) [S1]

`feedback_field_id`, `feedback_field_name`, `value` (string or number), `value_id` (int, dropdown only)

**Formats:** integer ids; ISO 8601 UTC datetime strings on records; datetime **parameters** require the .NET round-trip ("O") format `yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK`, e.g. `2024-05-01T00:00:00.0000000Z` [S1] — laxer variants [UNVERIFIED]; boolean params as strings `"true"`/`"false"`; multi-value params comma-separated.

## Querying

| Capability       | Syntax                                                            | Notes                                          |
| ---------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Module filter    | `?modules=volunteer,client`                                       | Long or short tokens (`vol`, `cli`, …) [S1]    |
| Status filter    | `?volunteer_status=accepted,applicant`                            | Per-module params; comma = OR [S1]             |
| Date filters     | `?worked_from=…&worked_to=…` (timelog); `?updated_since=…` (both) | .NET "O" datetime literals [S1]                |
| Id filters       | `?user_ids=1,2,3` · `?activity_ids=…`                             | Timelog lists [S1]                             |
| Payload control  | `?include_custom_fields=false&…`                                  | Heavy nested arrays default ON [S1]            |
| Org filter       | `?organization_ids=12,13`                                         | Enterprise only [S1]                           |
| Full-text search | —                                                                 | **Not supported** [UNKNOWN]                    |
| Sort             | —                                                                 | **Not supported** — sort client-side [UNKNOWN] |

```http
# Worked examples (all with Authorization: Basic …; raw server /v1/ paths)
GET /v1/organization/users/?modules=volunteer&volunteer_status=accepted&include_custom_fields=false&include_qualifications=false&include_verified_volunteers_background_check_results=false&page_size=250
GET /v1/organization/timelog_entries?worked_from=2026-05-01T00:00:00.0000000Z&worked_to=2026-06-01T00:00:00.0000000Z&approved=true
GET /v1/organization/timelog_entries?user_ids=12345
GET /v1/organization/by_id_list/users?ids=101,102,103
GET /v1/organization/users/?updated_since=2026-06-01T00:00:00.0000000Z     # delta polling
GET /v1/organization/look_up/activity_categories
```

## Pagination

- **Type:** page-number + page-size; **`page_number` 0-based** [S1]
- **`page_size`:** 1–250, default 100 [S1]
- **Total count:** `Header.total_items_count` (+ `page_count`) [S1]
- **Last-page:** `Header.has_next_page == false` / `Header.is_last_page == true`

```
Page 1: GET /v1/organization/users/?page_size=250&page_number=0
Page 2: GET /v1/organization/users/?page_size=250&page_number=1
Stop:   Header.has_next_page == false
```

**Batch reads:** `by_id_list` takes up to **250 comma-separated ids** [S1]. No bulk writes (read-only), no async export.

## Rate limits

**[UNKNOWN — undocumented everywhere]:** no numbers, headers, or 429 reference in the support center or SDK.

- **Strategy until measured:** sequential page-walks at modest pace (≤2–4 rps); exponential backoff (1s→5s→30s, jitter) on any throttle-looking response; capture status/headers on the first observed throttle and record here.

## Error handling

**Error body format [UNKNOWN — needs live testing].** Nothing documented; live 401 probe bodies could not be captured. Parse defensively: status code first, then try JSON, fall back to raw text.
| Status | Known? | Meaning | Recovery |
| --- | --- | --- | --- |
| 401 | [CONFIRMED] | Missing/invalid/deleted/disabled key pair | Re-enter credentials via chat card |
| 200 + missing data | [S1] | Module not on the key — silent | Check the key's module scope in Better Impact |
| 400/403/404 | [UNKNOWN] | Undocumented | Verify path/params/id; capture bodies when seen |
| 429/5xx | [UNKNOWN] | Undocumented | Backoff + retry once; record observed behaviour |

**Idempotency:** trivially safe — the entire surface is GET.

## Events & polling

**No webhooks, no streaming** — nothing in any official doc [UNKNOWN — searched].
**Polling:** `updated_since` on both users and timelog lists is the designed delta path [S1]:

```
GET /v1/{scope}/users/?updated_since={watermark}           → advance from date_updated
GET /v1/{scope}/timelog_entries?updated_since={watermark}
```

Poll conservatively until rate limits established empirically.

## SDKs & tooling

- **Official C# SDK:** `https://github.com/BetterImpact/ApiClient` — namespace `VolunteerSquared.ApiClient` (former product name "Volunteer Squared"); enterprise + organisation consumers; unit tests "exercise all endpoints" (good source for response shapes); last commit Nov 2025 [S4,S5].
- **Other SDKs / Postman / OpenAPI / MCP:** none found [UNKNOWN — searched; `/swagger.json` 404 CONFIRMED].
- **Sterling Volunteers:** background-check integration (First Advantage) — results surface on user records via the API [S1].

## Integration path assessment

**Recommended:** Direct API via Numa native data connector (`request` operation), registry `authType:'username-password'` — NOT Pipedream/OAuth, not a file source. Implemented; see `03-connector-setup.md` (wiring) and `04-connection-and-reauth.md` (lifecycle).

**Justification:** Basic auth with an admin-generated username/password pair rides the existing username-password backend (`_user_connector_basic_creds` → `Authorization: Basic …`) with zero new auth code — the ProWorkflow precedent minus the account-level API key (Better Impact has no extra header). Fixed SaaS base URL, no special headers, read-only surface.

**Connector compatibility:** N/A — not a file source (`list_files`/`download_file` don't apply; custom-field file downloads ride the generic `request` path).

**Rollout checklist (per customer):**

1. Better Impact admin: create an API key (Configuration → Organisation Settings → Security Settings → API Keys) with the **modules** the team needs checked.
2. Numa admin: add **Better Impact** in Integrations (wizard is metadata-only).
3. Each user: paste the key's username+password into the chat credential card on first use.
4. Verify: `GET /v1/organization/users/?page_size=1` → 200; capture one bad-credential 401 body.
5. Probe module coverage (volunteers, timelogs) — confirm the key's modules match expectations.
6. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md`.

## Known unknowns — verify on a credentialed account before customer rollout

1. **Error response body shape** — 401 and any 400/403/404 bodies
2. **Rate limits** — numbers, headers, breach status code
3. **Datetime parameter strictness** — is the full .NET "O" literal required, or are `2024-05-01` / `…T00:00:00Z` accepted?
4. **Single-item & lookup response envelopes** — wrapped like lists or bare objects?
5. **Key username/password format** — never shown in docs
6. **Enterprise vs organisation key scoping** — which scope(s) one key can call; org-scope calls on an enterprise account (and vice versa)
7. **Custom-field file download** — content type, disposition, auth on the returned URL
