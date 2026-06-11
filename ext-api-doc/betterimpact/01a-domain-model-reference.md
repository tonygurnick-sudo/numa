---
api_name: 'Better Impact (Volunteer Impact)'
api_slug: 'betterimpact'
generated_from: '00-api-investigation (2026-05-28) + support articles 9824270, 9824266, 9824303 (fetched 2026-06-10)'
generated_date: '2026-06-10'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 6: Data Model']
---

# Better Impact -- Domain Model Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> Entity and field claims come from the official support-article API reference (article 9824270,
> fetched 2026-06-10) — tagged [DOCS]. Inferences are [UNVERIFIED]; unresolved items stay
> [UNKNOWN]. Field tables here are complete as documented — but GET one real record and mirror
> what actually comes back before relying on any field.

## The Domain in One Paragraph

Better Impact is volunteer-management software (product: **Volunteer Impact**; siblings Donor /
Client / Member Impact share the same API). The core loop: an **Organization** maintains a roster
of **Users** (people — usually volunteers); each user has per-organization **Memberships**
recording which modules they belong to (volunteer/client/donor/member/administrator) and their
status within each; volunteers work **Activities** (grouped into **Activity Categories** and,
at enterprise level, **Activity Report Groups**) and their hours are recorded as **Timelog
Entries**; profiles are enriched with **Custom Fields**, **Qualifications**, and **Background
Check Results**; timelog entries can carry **Feedback Fields** [DOCS]. The API is a **read-only
export surface** over this data [DOCS — absence of write endpoints].

## The Hierarchy

```
Enterprise (multi-org tier; optional)
  └── Organization (organization_id; has_*_module flags)
        ├── User (user_id — the person; profile fields, photo, QR code)
        │     ├── Membership (per-organization; is_volunteer/is_client/... + per-module status)
        │     ├── CustomFieldValue   → def: /look_up/custom_fields  (+ file download endpoint)
        │     ├── QualificationValue → def: /look_up/qualifications (levels via options)
        │     └── BackgroundCheckResult (Sterling Volunteers integration)
        ├── TimelogEntry (hours worked; denormalizes user + activity + org names)
        │     └── RecordedFeedbackField → def: /look_up/feedback_fields
        ├── ActivityCategory (lookup; org scope)
        └── [Activity — NOT directly exposed: ids/names appear only on timelog entries]
Enterprise-only lookups: Organizations, ActivityReportGroups
```

Key structural facts [DOCS]:

- **Users are enterprise-level people with per-org memberships.** In enterprise scope one
  `user_id` can carry memberships at multiple organizations; in organization scope you see that
  org's membership only [DOCS structure; single-org membership filtering [UNVERIFIED]].
- **There is no `/activities` endpoint.** Activities exist as `activity_id`/`activity_name`
  denormalized onto timelog entries; only their categories and report groups have lookups [DOCS].
- **Module membership ≠ status.** `is_volunteer: true` plus `volunteer_status` (e.g. localized
  "Accepted") describe one membership; a user can simultaneously be a donor, client, etc. [DOCS].
- **Timelog entries are flat and self-describing** — they embed user name, activity name,
  category name, and organization id/name, so most hours reporting needs no joins [DOCS].

## Scopes

| Scope          | Path prefix       | Who has it                  | Exclusive endpoints                                  |
| -------------- | ----------------- | --------------------------- | ---------------------------------------------------- |
| Organization   | `/organization/`  | Every account (default)     | `/look_up/activity_categories`                       |
| Enterprise     | `/enterprise/`    | Multi-org enterprise tier   | `/look_up/organizations`, `/look_up/activity_report_groups`; `organization_ids` filter on lists |

What an org-tier key gets from `/enterprise/` paths (error? empty?) is [UNVERIFIED] — default
to `/organization/`, switch to `/enterprise/` only when the user's account is known multi-org.

## ID & Convention Semantics

- All ids are **integers** [DOCS]. Primary keys: `user_id`, `timelog_entry_id`,
  `organization_id`, `activity_id`, `custom_field_id`, `qualification_id`, `feedback_field_id`.
- **Timestamps are ISO 8601 UTC strings** (`date_created`, `date_updated`), nullable where
  marked [DOCS]. Request-side datetimes need the .NET round-trip form (see 01b).
- **Casing:** snake_case fields, with two documented exceptions on User —
  `linkedIn_profile_url` and `Instagram_username` (capital I) [DOCS]. Envelope keys are
  PascalCase: `Header`, `Users`, `TimelogEntries` [DOCS].
- **Localized strings:** membership status fields (`volunteer_status`, `client_status`, …) and
  reasons return localized display text, not enum tokens [DOCS]. Compare case-insensitively and
  never feed a response status back into a filter parameter.
- **`user_custom_field_id` ≠ `custom_field_id`:** the file-download path takes the id of the
  user's field *instance* [DOCS naming; exact source field on the user record [UNVERIFIED] —
  inspect a real user's `custom_fields` array for the instance id].

## Entity Catalog

The whole API is six entity families — all **read-only** [DOCS]:

| Entity                 | Endpoints                                            | Numa relevance                          |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------- |
| User                   | list / single / by_id_list / custom-field file       | HIGH — the roster                        |
| TimelogEntry           | list / single / by_id_list                           | HIGH — hours reporting                   |
| ActivityCategory       | look_up (org only)                                   | Resolve category names ↔ ids             |
| Organization           | look_up (enterprise only)                            | Enterprise org map + module flags        |
| ActivityReportGroup    | look_up (enterprise only)                            | Enterprise reporting rollups             |
| Qualification / CustomField / FeedbackField definitions | look_up (both scopes)         | Decode profile + feedback values         |

## User (core profile fields) [DOCS]

| Field | Type | Notes |
| ----- | ---- | ----- |
| `user_id` | integer | Primary key |
| `first_name`, `last_name`, `legal_first_name`, `middle_name` | string | |
| `title`, `suffix`, `pronouns` | string | `title` = salutation |
| `address_line_1`, `address_line_2`, `city`, `zip_code`, `state`, `country` | string | `zip_code` = postal code, `state` = province/county |
| `email_address`, `secondary_email_address`, `mobile_email_address` | string | |
| `home_phone`, `work_phone`, `work_phone_ext`, `cell_phone` | string | `cell_phone` = mobile |
| `phone_preference` | string | |
| `twitter_username`, `linkedIn_profile_url`, `Instagram_username` | string | Inconsistent capitalisation is REAL — copy exactly |
| `username` | string | SSO username if SSO enabled, else system username |
| `single_sign_on_enabled` | boolean | |
| `birthday` | string | ISO 8601 UTC, nullable |
| `date_created`, `date_updated` | string | ISO 8601 UTC |
| `region`, `region_code` | string | Localized region name + language code |
| `is_group`, `group_name` | boolean / string | Profile may represent a group, not a person |
| `photo_url_scaled`, `photo_url_original` | string | Photo URLs; auth/expiry [UNVERIFIED] |
| `timeclock_qr_code_url` | string | QR-code image URL |
| `memberships` | array | See Membership below (toggle: `include_memberships`) |
| `custom_fields` | array | See Custom Field Value (toggle: `include_custom_fields`) |
| `qualifications` | array | See Qualification Value (toggle: `include_qualifications`) |
| `background_check_results` | array | See Background Check (toggle: `include_verified_volunteers_background_check_results`) |

## Membership (one per organization the user belongs to) [DOCS]

| Field | Type | Notes |
| ----- | ---- | ----- |
| `organization_member_id` | integer | Membership primary key |
| `organization_id`, `organization_name` | integer / string | |
| `date_created`, `date_updated` | string | ISO 8601 UTC |
| `is_administrator` | boolean | |
| `administrator_status` | string | Localized, nullable |
| `administrator_type` | string | Full / Module / Limited, nullable |
| `is_volunteer` | boolean | |
| `volunteer_status` | string | Localized, nullable |
| `volunteer_inactive_status_reason`, `volunteer_archived_status_reason` | string | Localized, nullable |
| `volunteer_last_status_change` | string | ISO 8601 UTC, nullable |
| `volunteer_notes` | string | Nullable |
| `volunteer_application_form` | integer | Form number, nullable |
| `volunteer_date_joined` | string | ISO 8601 UTC, nullable |
| `volunteer_total_hours` | number | **Lifetime hours rollup — free total, no timelog scan needed** |
| `is_client`, `client_status`, `client_date_joined`, `client_last_status_change` | bool / string / dates | Client module |
| `is_donor`, `donor_status`, `donor_date_joined`, `donor_last_status_change` | bool / string / dates | Donor module |
| `is_member`, `member_status`, `member_date_joined`, `member_last_status_change` | bool / string / dates | Member module |

## Custom Field Value (on user) + Definition (look_up) [DOCS]

Value object (in `user.custom_fields`):

| Field | Type | Notes |
| ----- | ---- | ----- |
| `custom_field_id`, `custom_field_name` | integer / string | |
| `custom_field_category_id`, `custom_field_category_name` | integer (nullable) / string | |
| `type` | string | `yes_no`, `short_text`, `number`, `long_text`, `file`, `drop_down`, `date`, `check_box` |
| `value` | varies | boolean (yes_no), string (short/long_text, drop_down, date), number, file URL |
| `value_id` | integer | Drop-down values only |

Definition object (`/look_up/custom_fields`): `custom_field_id`, `name`, `display_order`
(1-based per category), `belongs_to_enterprise`, `custom_field_category_id/_name/
_display_order`, `options[]` (`custom_field_option_id`, `description`; dropdown only) [DOCS].

**Visibility:** a custom field is returned only when the API key's modules intersect the
modules configured on the field — otherwise silently omitted [DOCS].

## Qualification Value (on user) + Definition (look_up) [DOCS]

Value object (in `user.qualifications`): `qualification_id`, `qualification_name`,
`qualification_expires` (boolean), `value` (selected level text), `value_id` (selected level
id), `expiry_date` (ISO 8601 UTC, nullable), `qualification_category_id/_name` (nullable).

Definition object (`/look_up/qualifications`): `qualification_id`, `name`, `expires`,
`match_type` (`"exact"` or `"ranked"`), `display_order`, `belongs_to_enterprise`,
`qualification_category_id/_name/_display_order`, `options[]` (`qualification_option_id`,
`description`, `rank`).

- `ranked` qualifications order their options by `rank` (levels); `exact` ones are
  pick-one [DOCS names; matching semantics [UNVERIFIED]].
- **Qualifications appear only when the key has Volunteer-module access** [DOCS].

## Background Check Result (on user) [DOCS]

`result_type_id`, `result_type_name`, `result_type_expires` (boolean), `state` (current
state string), `needs_review_reason` (blank unless state is "needs review"), `effective_date`,
`expiry_date` (nullable). Sourced from the Sterling Volunteers (First Advantage) integration
[DOCS]. The vocabulary of `state` values is [UNKNOWN] — present verbatim.

## TimelogEntry [DOCS]

| Field | Type | Notes |
| ----- | ---- | ----- |
| `timelog_entry_id` | integer | Primary key |
| `date_created`, `date_updated` | string | ISO 8601 UTC |
| `timelog_entry_type` | string | `Unknown`, `Logged`, `Timeclock`, `Automatic` |
| `date_worked` | string | ISO 8601 UTC |
| `hours_worked` | number | **Decimal hours** (not minutes) |
| `approved` | boolean | Approval state |
| `clock_start_time` | string | ISO 8601 UTC, nullable (Timeclock entries) |
| `activity_id`, `activity_name` | integer / string | Denormalized — no /activities endpoint |
| `activity_category_id`, `activity_category_name` | integer / string | |
| `activity_report_group_id`, `activity_report_group_name` | integer (nullable) / string | Enterprise reporting rollup |
| `organization_id`, `organization_name` | integer / string | (docs list organization_name's type as integer — almost certainly a docs typo; treat as string [UNVERIFIED]) |
| `user_id`, `first_name`, `last_name` | integer / string | Whose hours |
| `created_by_user_id`, `created_by_first_name`, `created_by_last_name` | integer (nullable) / string | Who recorded it |
| `recorded_feedback_fields` | array | Toggle: `include_recorded_feedback_fields` |

Recorded feedback field: `feedback_field_id`, `feedback_field_name`, `value` (string, or
number for numeric fields), `value_id` (dropdown only) [DOCS].

## Feedback Field Definition (look_up) [DOCS]

`feedback_field_id`, `name`, `prompt` (text shown to the volunteer), `active`, `required`,
`belongs_to_enterprise`, `options[]` (`feedback_field_option_id`, `description`; dropdown only).

## Organization (enterprise look_up) [DOCS]

`organization_id`, `name`, `active`, `date_created`, `date_updated`,
`has_administrator_module`, `has_client_module`, `has_donor_module`, `has_member_module`,
`has_volunteer_module`, `enterprise_region_id`, `enterprise_region_name`.

ActivityCategory (org look_up): `activity_category_id`, `name`.
ActivityReportGroup (enterprise look_up): `activity_report_group_id`, `name` [DOCS].

## Status Vocabularies (filter tokens — lowercase, compact) [DOCS]

These are the **query-parameter values**; the corresponding response fields hold localized
display strings instead.

| Filter param | Tokens |
| ------------ | ------ |
| `volunteer_status` | `applicant`, `inprocess`, `accepted`, `inactiveshortterm`, `inactivelongterm`, `archiveddidntstart`, `archivedrejected`, `archiveddismissed`, `archivedmoved`, `archivedquit`, `archiveddeceased`, `archivedother` |
| `client_status` | `applicant`, `inprocess` (docs also show `in_process`), `accepted`, `inactive`, `archived` |
| `member_status` | `applicant`, `inprocess` (docs also show `in_process`), `accepted`, `inactive`, `archived` |
| `donor_status` | `prospect`, `active`, `inactive`, `archived` |
| `admin_status` | `active`, `inactive` |
| `modules` | `volunteer`/`vol`, `client`/`cli`, `member`/`mem`, `donor`/`don`, `administrator`/`admin` |

Volunteer lifecycle reading of the tokens [UNVERIFIED interpretation]: applicant → inprocess →
accepted → inactive (short/long term) → archived (with reason). "Active volunteers" usually
means `volunteer_status=accepted`.

## Domain Rules

1. **The API is read-only** — every entity above is GET-only [DOCS — absence of writes; see 01c].
2. **Module scoping shapes every response:** users outside the key's modules are absent from
   lists; qualifications need the Volunteer module; custom fields use module-intersection
   logic [DOCS]. Empty data is a key-scope suspect before it is a query suspect.
3. **`volunteer_total_hours` (membership) is the cheap lifetime-hours answer**; use timelog
   queries only for windowed/filtered totals [DOCS field; rollup freshness [UNVERIFIED]].
4. **Approval gates hours reporting:** `approved` defaults to `"true"` on timelog lists [DOCS] —
   the default answer is "approved hours"; say so.
5. Activity names on timelog entries are point-in-time denormalizations [UNVERIFIED whether
   renames backfill] — group by `activity_id`, display by name.
6. Definitions (custom fields, qualifications, feedback fields) are workspace-configured —
   resolve per account via look_ups, never hardcode ids or names.
7. Group profiles exist (`is_group: true`) — don't assume every User is an individual [DOCS].

## What We Do NOT Know (read before assuming)

- Error body shape for any 4xx/5xx (only a bodyless 401 was probed) [UNKNOWN]
- Rate limits, burst limits, throttle headers [UNKNOWN]
- API-key expiry/rotation policy [UNKNOWN]
- Whether shorter ISO 8601 datetimes are accepted by filter params [UNVERIFIED — send the
  full round-trip form]
- Enterprise-path behaviour for org-tier keys [UNVERIFIED]
- Photo / QR / file URL authentication and lifetime [UNVERIFIED — fetch fresh, never cache]
- `state` vocabulary for background checks; localized status string sets [UNKNOWN]
- Whether `by_id_list` preserves request order or drops unknown ids silently [UNVERIFIED]
