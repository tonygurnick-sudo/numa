---
api_name: Better Impact (Volunteer Impact)
api_slug: betterimpact
doc: domain-model reference (entities, scopes, field tables, status vocabularies)
confidence: docs-derived from official support article 9824270 (2026-06-10), NOT live-validated. Tagged [UNVERIFIED]/[UNKNOWN] where noted; everything else is [DOCS]. GET one real record and mirror what comes back before relying on any field.
companions: 01=api-rules, 01b=query-patterns, 01c=read-only/write-asks, 01d=events+errors
---

# Better Impact — Domain Model Reference

Volunteer-management software (product Volunteer Impact; siblings Donor/Client/Member Impact share the API). **Read-only export surface** (no write endpoints).

## Hierarchy

```
Enterprise (multi-org tier; optional)
  └── Organization (organization_id; has_*_module flags)
        ├── User (user_id — the person; profile fields, photo, QR code)
        │     ├── Membership (per-org; is_volunteer/is_client/... + per-module status)
        │     ├── CustomFieldValue   → def: /look_up/custom_fields (+ file download endpoint)
        │     ├── QualificationValue → def: /look_up/qualifications (levels via options)
        │     └── BackgroundCheckResult (Sterling Volunteers integration)
        ├── TimelogEntry (hours; denormalizes user + activity + org names)
        │     └── RecordedFeedbackField → def: /look_up/feedback_fields
        ├── ActivityCategory (lookup; org scope)
        └── [Activity — NOT directly exposed: ids/names appear only on timelog entries]
Enterprise-only lookups: Organizations, ActivityReportGroups
```

Structural facts:

- **Users are enterprise-level people with per-org memberships.** In enterprise scope one `user_id` carries memberships at multiple orgs; in org scope you see that org's membership only [single-org membership filtering UNVERIFIED].
- **No `/activities` endpoint** — activity ids/names exist only denormalized on timelog entries; only categories + report groups have lookups.
- **Module membership ≠ status:** `is_volunteer:true` + `volunteer_status` (localized "Accepted") describe one membership; a user can also be donor/client/etc.
- **Timelog entries are flat/self-describing** (embed user, activity, category, org names) → most hours reporting needs no joins.

## Scopes

| Scope        | Prefix           | Who                     | Exclusive endpoints                                                                             |
| ------------ | ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| Organization | `/organization/` | Every account (default) | `/look_up/activity_categories`                                                                  |
| Enterprise   | `/enterprise/`   | Multi-org tier          | `/look_up/organizations`, `/look_up/activity_report_groups`; `organization_ids` filter on lists |

Org-tier key behaviour on `/enterprise/` paths (error? empty?) [UNVERIFIED] — default to `/organization/`, switch only when the account is known multi-org.

## ID & convention semantics

- All ids **integer**. PKs: `user_id`, `timelog_entry_id`, `organization_id`, `activity_id`, `custom_field_id`, `qualification_id`, `feedback_field_id`.
- **Record timestamps ISO 8601 UTC strings** (`date_created`, `date_updated`), nullable where marked. Request-side datetimes need the .NET round-trip form (01b).
- **Casing:** snake_case fields, two documented User exceptions — `linkedIn_profile_url`, `Instagram_username` (capital I). Envelope keys PascalCase (`Header`, `Users`, `TimelogEntries`).
- **Localized strings:** membership status fields (`volunteer_status`, `client_status`, …) and reasons return localized display text, not enum tokens. Compare case-insensitively; never feed a response status into a filter param.
- **`user_custom_field_id` ≠ `custom_field_id`:** file-download path takes the id of the user's field _instance_ [exact source field UNVERIFIED — inspect a real user's `custom_fields` array for the instance id].

## Entity catalog (six families, all read-only)

| Entity                                           | Endpoints                                      | Numa relevance                    |
| ------------------------------------------------ | ---------------------------------------------- | --------------------------------- |
| User                                             | list / single / by_id_list / custom-field file | HIGH — the roster                 |
| TimelogEntry                                     | list / single / by_id_list                     | HIGH — hours reporting            |
| ActivityCategory                                 | look_up (org only)                             | Resolve category names ↔ ids      |
| Organization                                     | look_up (enterprise only)                      | Enterprise org map + module flags |
| ActivityReportGroup                              | look_up (enterprise only)                      | Enterprise reporting rollups      |
| Qualification / CustomField / FeedbackField defs | look_up (both scopes)                          | Decode profile + feedback values  |

## User (core profile fields)

| Field                                                                      | Type             | Notes                                                         |
| -------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `user_id`                                                                  | integer          | PK                                                            |
| `first_name`, `last_name`, `legal_first_name`, `middle_name`               | string           |                                                               |
| `title`, `suffix`, `pronouns`                                              | string           | `title` = salutation                                          |
| `address_line_1`, `address_line_2`, `city`, `zip_code`, `state`, `country` | string           | `zip_code`=postal code, `state`=province/county               |
| `email_address`, `secondary_email_address`, `mobile_email_address`         | string           |                                                               |
| `home_phone`, `work_phone`, `work_phone_ext`, `cell_phone`                 | string           | `cell_phone`=mobile                                           |
| `phone_preference`                                                         | string           |                                                               |
| `twitter_username`, `linkedIn_profile_url`, `Instagram_username`           | string           | Inconsistent capitalisation is REAL — copy exactly            |
| `username`                                                                 | string           | SSO username if SSO enabled, else system username             |
| `single_sign_on_enabled`                                                   | boolean          |                                                               |
| `birthday`                                                                 | string           | ISO 8601 UTC, nullable                                        |
| `date_created`, `date_updated`                                             | string           | ISO 8601 UTC                                                  |
| `region`, `region_code`                                                    | string           | Localized region name + language code                         |
| `is_group`, `group_name`                                                   | boolean / string | Profile may represent a group, not a person                   |
| `photo_url_scaled`, `photo_url_original`                                   | string           | Auth/expiry [UNVERIFIED]                                      |
| `timeclock_qr_code_url`                                                    | string           | QR-code image URL                                             |
| `memberships`                                                              | array            | toggle `include_memberships`                                  |
| `custom_fields`                                                            | array            | toggle `include_custom_fields`                                |
| `qualifications`                                                           | array            | toggle `include_qualifications`                               |
| `background_check_results`                                                 | array            | toggle `include_verified_volunteers_background_check_results` |

## Membership (one per org the user belongs to)

| Field                                                                           | Type                  | Notes                                                          |
| ------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------- |
| `organization_member_id`                                                        | integer               | Membership PK                                                  |
| `organization_id`, `organization_name`                                          | integer / string      |                                                                |
| `date_created`, `date_updated`                                                  | string                | ISO 8601 UTC                                                   |
| `is_administrator`                                                              | boolean               |                                                                |
| `administrator_status`                                                          | string                | Localized, nullable                                            |
| `administrator_type`                                                            | string                | Full / Module / Limited, nullable                              |
| `is_volunteer`                                                                  | boolean               |                                                                |
| `volunteer_status`                                                              | string                | Localized, nullable                                            |
| `volunteer_inactive_status_reason`, `volunteer_archived_status_reason`          | string                | Localized, nullable                                            |
| `volunteer_last_status_change`                                                  | string                | ISO 8601 UTC, nullable                                         |
| `volunteer_notes`                                                               | string                | Nullable                                                       |
| `volunteer_application_form`                                                    | integer               | Form number, nullable                                          |
| `volunteer_date_joined`                                                         | string                | ISO 8601 UTC, nullable                                         |
| `volunteer_total_hours`                                                         | number                | **Lifetime hours rollup — free total, no timelog scan needed** |
| `is_client`, `client_status`, `client_date_joined`, `client_last_status_change` | bool / string / dates | Client module                                                  |
| `is_donor`, `donor_status`, `donor_date_joined`, `donor_last_status_change`     | bool / string / dates | Donor module                                                   |
| `is_member`, `member_status`, `member_date_joined`, `member_last_status_change` | bool / string / dates | Member module                                                  |

## Custom Field Value (on user) + Definition (look_up)

Value (in `user.custom_fields`):
| Field | Type | Notes |
| --- | --- | --- |
| `custom_field_id`, `custom_field_name` | integer / string | |
| `custom_field_category_id`, `custom_field_category_name` | integer (nullable) / string | |
| `type` | string | `yes_no`, `short_text`, `number`, `long_text`, `file`, `drop_down`, `date`, `check_box` |
| `value` | varies | boolean (yes_no), string (short/long_text, drop_down, date), number, file URL |
| `value_id` | integer | drop-down only |

Definition (`/look_up/custom_fields`): `custom_field_id`, `name`, `display_order` (1-based per category), `belongs_to_enterprise`, `custom_field_category_id/_name/_display_order`, `options[]` (`custom_field_option_id`, `description`; dropdown only).
**Visibility:** returned only when the key's modules intersect the field's modules — else silently omitted.

## Qualification Value (on user) + Definition (look_up)

Value (in `user.qualifications`): `qualification_id`, `qualification_name`, `qualification_expires` (bool), `value` (selected level text), `value_id` (selected level id), `expiry_date` (ISO 8601 UTC, nullable), `qualification_category_id/_name` (nullable).
Definition (`/look_up/qualifications`): `qualification_id`, `name`, `expires`, `match_type` (`"exact"` or `"ranked"`), `display_order`, `belongs_to_enterprise`, `qualification_category_id/_name/_display_order`, `options[]` (`qualification_option_id`, `description`, `rank`).

- `ranked` orders options by `rank` (levels); `exact` is pick-one [matching semantics UNVERIFIED].
- **Qualifications appear only when the key has Volunteer-module access.**

## Background Check Result (on user)

`result_type_id`, `result_type_name`, `result_type_expires` (bool), `state` (current state string), `needs_review_reason` (blank unless state "needs review"), `effective_date`, `expiry_date` (nullable). Sourced from Sterling Volunteers (First Advantage). `state` vocabulary [UNKNOWN] — present verbatim.

## TimelogEntry

| Field                                                                 | Type                        | Notes                                                                                              |
| --------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `timelog_entry_id`                                                    | integer                     | PK                                                                                                 |
| `date_created`, `date_updated`                                        | string                      | ISO 8601 UTC                                                                                       |
| `timelog_entry_type`                                                  | string                      | `Unknown`, `Logged`, `Timeclock`, `Automatic`                                                      |
| `date_worked`                                                         | string                      | ISO 8601 UTC                                                                                       |
| `hours_worked`                                                        | number                      | **Decimal hours** (not minutes)                                                                    |
| `approved`                                                            | boolean                     | Approval state                                                                                     |
| `clock_start_time`                                                    | string                      | ISO 8601 UTC, nullable (Timeclock entries)                                                         |
| `activity_id`, `activity_name`                                        | integer / string            | Denormalized — no /activities endpoint                                                             |
| `activity_category_id`, `activity_category_name`                      | integer / string            |                                                                                                    |
| `activity_report_group_id`, `activity_report_group_name`              | integer (nullable) / string | Enterprise rollup                                                                                  |
| `organization_id`, `organization_name`                                | integer / string            | (docs type `organization_name` as integer — almost certainly a typo; treat as string [UNVERIFIED]) |
| `user_id`, `first_name`, `last_name`                                  | integer / string            | Whose hours                                                                                        |
| `created_by_user_id`, `created_by_first_name`, `created_by_last_name` | integer (nullable) / string | Who recorded it                                                                                    |
| `recorded_feedback_fields`                                            | array                       | toggle `include_recorded_feedback_fields`                                                          |

Recorded feedback field: `feedback_field_id`, `feedback_field_name`, `value` (string, or number for numeric fields), `value_id` (dropdown only).

## Feedback Field Definition (look_up)

`feedback_field_id`, `name`, `prompt` (text shown to volunteer), `active`, `required`, `belongs_to_enterprise`, `options[]` (`feedback_field_option_id`, `description`; dropdown only).

## Organization (enterprise look_up)

`organization_id`, `name`, `active`, `date_created`, `date_updated`, `has_administrator_module`, `has_client_module`, `has_donor_module`, `has_member_module`, `has_volunteer_module`, `enterprise_region_id`, `enterprise_region_name`.

ActivityCategory (org look_up): `activity_category_id`, `name`.
ActivityReportGroup (enterprise look_up): `activity_report_group_id`, `name`.

## Status vocabularies (filter tokens — lowercase, compact)

**Query-param values**; corresponding response fields hold localized display strings.
| Filter param | Tokens |
| --- | --- |
| `volunteer_status` | `applicant`, `inprocess`, `accepted`, `inactiveshortterm`, `inactivelongterm`, `archiveddidntstart`, `archivedrejected`, `archiveddismissed`, `archivedmoved`, `archivedquit`, `archiveddeceased`, `archivedother` |
| `client_status` | `applicant`, `inprocess` (docs also show `in_process`), `accepted`, `inactive`, `archived` |
| `member_status` | `applicant`, `inprocess` (docs also show `in_process`), `accepted`, `inactive`, `archived` |
| `donor_status` | `prospect`, `active`, `inactive`, `archived` |
| `admin_status` | `active`, `inactive` |
| `modules` | `volunteer`/`vol`, `client`/`cli`, `member`/`mem`, `donor`/`don`, `administrator`/`admin` |

Volunteer lifecycle reading [UNVERIFIED interpretation]: applicant → inprocess → accepted → inactive (short/long) → archived (with reason). "Active volunteers" usually = `volunteer_status=accepted`.

## Domain rules

1. **Read-only** — every entity GET-only (see 01c).
2. **Module scoping shapes every response:** users outside the key's modules absent from lists; qualifications need the Volunteer module; custom fields use module-intersection. Empty data is a key-scope suspect before a query suspect.
3. **`volunteer_total_hours` (membership) = the cheap lifetime-hours answer**; timelog queries only for windowed/filtered totals [rollup freshness UNVERIFIED].
4. **Approval gates hours reporting:** `approved` defaults `"true"` on timelog lists — default answer = "approved hours"; say so.
5. Activity names on timelog entries are point-in-time denormalizations [whether renames backfill UNVERIFIED] — group by `activity_id`, display by name.
6. Definitions (custom fields, qualifications, feedback fields) are workspace-configured — resolve per account via look_ups, never hardcode ids/names.
7. Group profiles exist (`is_group:true`) — don't assume every User is an individual.

## What we do NOT know (read before assuming)

- Error body shape for any 4xx/5xx (only a bodyless 401 probed) [UNKNOWN]
- Rate limits, burst limits, throttle headers [UNKNOWN]
- API-key expiry/rotation policy [UNKNOWN]
- Whether shorter ISO 8601 datetimes are accepted by filter params [UNVERIFIED — send the full round-trip form]
- Enterprise-path behaviour for org-tier keys [UNVERIFIED]
- Photo/QR/file URL auth + lifetime [UNVERIFIED — fetch fresh, never cache]
- `state` vocabulary for background checks; localized status string sets [UNKNOWN]
- Whether `by_id_list` preserves request order or drops unknown ids silently [UNVERIFIED]
