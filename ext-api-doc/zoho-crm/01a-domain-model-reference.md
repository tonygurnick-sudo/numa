---
api_name: Zoho CRM
api_slug: zoho-crm
doc: domain model — entity catalogue, relationships, state machines, business rules, enums
base_url: https://{api_domain}/crm/v8 (region-pinned; see 01)
field_casing: PascalCase_With_Underscores
id_format: string 18–19 digit numeric, opaque
confidence: verified 2026-04-23 unless tagged
companion_of: 01-llm-api-rules.md
note: standard modules below; custom modules are tenant-specific — discover via GET /crm/v8/settings/modules at runtime
---

# Zoho CRM — Domain Model

## Entities

### Lead — `/crm/v8/Leads`

Unqualified prospect. Converts to Contact + Account + optional Deal. CRUD + Upsert.

| Field                          | Type            | Req   | Writable | Notes / Example                                      |
| ------------------------------ | --------------- | ----- | -------- | ---------------------------------------------------- |
| `id`                           | string(numeric) | —     | no       | `"410405000002264040"`                               |
| `Last_Name`                    | string          | yes   | yes      | `"Smith"`                                            |
| `First_Name`                   | string          | no    | yes      | `"Jane"`                                             |
| `Company`                      | string          | yes   | yes      | Required on Leads specifically. `"Acme"`             |
| `Email`                        | email           | no    | yes      | Default duplicate-check field. `"jane@acme.example"` |
| `Phone`,`Mobile`               | string          | no    | yes      | `"+61 3 9000 0000"`                                  |
| `Lead_Status`                  | picklist        | no    | yes      | See enums. `"Contacted"`                             |
| `Lead_Source`                  | picklist        | no    | yes      | `"Web Form"`                                         |
| `Owner`                        | User lookup     | no    | yes      | `{id,name,email}`                                    |
| `Layout`                       | Layout lookup   | yes\* | yes      | \*Required if module has >1 layout                   |
| `Tag`                          | array<object>   | no    | yes      | `[{name,color_code}]`                                |
| `Converted`                    | boolean         | —     | no       | Set on successful conversion                         |
| `Created_Time`,`Modified_Time` | ISO 8601 dt     | —     | no       | `"2026-04-01T10:00:00+10:00"`                        |

Relationships: User(Owner) N:1 (`Owner.id`, every Lead has one); Note 1:N (`GET /Leads/{id}/Notes`, polymorphic via `se_module`); Attachment 1:N (`GET /Leads/{id}/Attachments`); Campaign N:M (via conversion); Contact/Account/Deal 1:1 on conversion (`/Leads/{id}/actions/convert`).

### Contact — `/crm/v8/Contacts`

Individual at a company; survives Lead conversion. CRUD + Upsert.

| Field                                                                           | Type           | Req | Writable | Notes                |
| ------------------------------------------------------------------------------- | -------------- | --- | -------- | -------------------- |
| `id`                                                                            | string         | —   | no       |                      |
| `Last_Name`                                                                     | string         | yes | yes      |                      |
| `First_Name`                                                                    | string         | no  | yes      |                      |
| `Email`                                                                         | email          | no  | yes      | Default dedupe field |
| `Phone`                                                                         | string         | no  | yes      |                      |
| `Account_Name`                                                                  | Account lookup | no  | yes      | `{id,name}`          |
| `Title`                                                                         | string         | no  | yes      | `"CTO"`              |
| `Owner`                                                                         | User lookup    | no  | yes      |                      |
| `Mailing_Street`,`Mailing_City`,`Mailing_State`,`Mailing_Zip`,`Mailing_Country` | string         | no  | yes      | Postal address       |

Relationships: N:1 → Account; 1:N → Note/Attachment/Task/Call/Meeting; N:M → Deal via Contact_Roles.

### Account — `/crm/v8/Accounts`

Customer/prospect company. CRUD + Upsert.

| Field            | Type           | Req | Writable | Notes                                      |
| ---------------- | -------------- | --- | -------- | ------------------------------------------ |
| `id`             | string         | —   | no       |                                            |
| `Account_Name`   | string         | yes | yes      | NOT unique by default — duplicates allowed |
| `Phone`          | string         | no  | yes      |                                            |
| `Website`        | url            | no  | yes      |                                            |
| `Industry`       | picklist       | no  | yes      | `"Manufacturing"`                          |
| `Annual_Revenue` | currency       | no  | yes      | Org currency applied                       |
| `Parent_Account` | Account lookup | no  | yes      | Self-reference for hierarchy               |
| `Owner`          | User lookup    | no  | yes      |                                            |

Relationships: 1:N → Contacts/Deals/Notes/Activities; self-reference via `Parent_Account`.

### Deal — `/crm/v8/Deals`

Sales opportunity. CRUD + Upsert.

| Field              | Type           | Req | Writable | Notes                                                   |
| ------------------ | -------------- | --- | -------- | ------------------------------------------------------- |
| `id`               | string         | —   | no       |                                                         |
| `Deal_Name`        | string         | yes | yes      |                                                         |
| `Stage`            | picklist       | yes | yes      | Drives `Probability` + workflow. `"Negotiation/Review"` |
| `Amount`           | currency       | no  | yes      | `45000`                                                 |
| `Closing_Date`     | date           | yes | yes      | `YYYY-MM-DD`                                            |
| `Account_Name`     | Account lookup | no  | yes      |                                                         |
| `Contact_Name`     | Contact lookup | no  | yes      | Primary contact                                         |
| `Owner`            | User lookup    | no  | yes      |                                                         |
| `Probability`      | int 0–100      | —   | auto     | Derived from Stage                                      |
| `Expected_Revenue` | currency       | —   | auto     | `Amount × Probability/100`                              |

Relationships: N:1 → Account; N:1 → Contact (primary); N:M → Contacts via Contact_Roles; 1:N → Notes/Attachments/Tasks.

### Task — `/crm/v8/Tasks` (CRUD)

| Field        | Type               | Req | Writable | Notes                                                                |
| ------------ | ------------------ | --- | -------- | -------------------------------------------------------------------- |
| `Subject`    | string             | yes | yes      |                                                                      |
| `Status`     | picklist           | no  | yes      | See enums                                                            |
| `Priority`   | picklist           | no  | yes      | `Low`/`Normal`/`High`                                                |
| `Due_Date`   | date               | no  | yes      |                                                                      |
| `Who_Id`     | polymorphic lookup | no  | yes      | Lead or Contact                                                      |
| `What_Id`    | polymorphic lookup | no  | yes      | Account/Deal/custom                                                  |
| `$se_module` | string             | no  | yes      | **Required when `What_Id` set** — parent module api_name (`"Deals"`) |
| `Owner`      | User lookup        | no  | yes      |                                                                      |

### Note — `/crm/v8/Notes` (CRUD)

| Field          | Type              | Req | Writable | Notes                                                                     |
| -------------- | ----------------- | --- | -------- | ------------------------------------------------------------------------- |
| `Note_Title`   | string            | no  | yes      | Title or content required                                                 |
| `Note_Content` | string            | no  | yes      | Rich text                                                                 |
| `Parent_Id`    | string(record id) | yes | yes      | Record the note is on                                                     |
| `se_module`    | string            | yes | yes      | Parent module api_name (`"Deals"`) — bare, NOT `$`-prefixed (unlike Task) |
| `Owner`        | User lookup       | no  | yes      |                                                                           |

### User — `/crm/v8/users` (read only; admin UI manages users)

`id` string; `full_name` string; `email`; `role` Role lookup; `profile` Profile lookup; `status` enum `active`/`inactive`/`deleted`.

## State Machines

### Deal.Stage

Tenant-configurable. Default flow: `Qualification → Needs Analysis → Value Proposition → Identify Decision Makers → Proposal/Price Quote → Negotiation/Review → Closed Won | Closed Lost`.

| From     | Trigger        | To          | Reversible         | Side effects                                                                                       |
| -------- | -------------- | ----------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| any open | update `Stage` | any other   | yes                | `Probability`+`Expected_Revenue` recalc; workflows fire                                            |
| any open | → Closed Won   | Closed Won  | yes (with warning) | "on close" workflows/notifications fire; re-opening does NOT auto-undo them — user undoes manually |
| any open | → Closed Lost  | Closed Lost | yes                | same                                                                                               |

Blueprints (if configured) restrict transitions per role; disallowed → `INVALID_DATA` with a blueprint-specific message.

### Lead.Lead_Status

Free transitions unless a Blueprint is configured. Default values: see enums.

### Lead Conversion (terminal)

`POST /Leads/{id}/actions/convert` → creates Contact + Account + (optional) Deal. Atomic — all created or none (if Contact create fails, Account not created). Lead marked `Converted=true`, NOT deleted; still editable but drops from default Leads view. 5 credits.

### Task.Status

`Not Started → In Progress → Completed`; also `In Progress ↔ Waiting for Input`, `Not Started → Deferred`. No enforcement — any transition legal.

## Business Rules

**Required-on-create:** Lead needs `Last_Name`+`Company` (Zoho-specific — Contacts need only `Last_Name`); Account needs `Account_Name`; Deal needs `Deal_Name`+`Stage`+`Closing_Date`; Task needs `Subject`; Note needs `Parent_Id`+`se_module`+one of title/content. Any multi-layout module needs `Layout.id`. `Task.What_Id` must be paired with `$se_module`. Admins can mark extra fields required — confirm per-tenant via `GET /settings/fields?module={M}`.

**Field rules:** `Email` is the default dedupe field on Leads/Contacts (duplicate → `DUPLICATE_DATA`); unique per module by default, configurable per-org. `Account_Name` NOT unique by default. Picklist values (`Lead_Status`,`Stage`,…) are case-sensitive + tenant-specific — discover via `/settings/fields`. `Closing_Date` = `YYYY-MM-DD`. Datetime = ISO 8601 with offset (`Z` accepted, `+HH:MM` emitted). Currency = bare number (org currency applied server-side). `Owner` must be a valid user id in the same org.

**Cascading:** `DELETE /{Module}/{id}` = soft delete (Recycle Bin; list via `?type=recycle`). Deleting a parent does NOT cascade — children become orphans with parent lookup nulled. Lead conversion is atomic. Subforms (nested records) auto-delete with parent.

**Computed / read-only (never writable):** `id`, `Created_By`, `Created_Time`, `Modified_By`, `Modified_Time` (server-set). `Probability`, `Expected_Revenue` on Deals (derived from Stage/Amount). `Full_Name` on Contacts (derived; writable on some orgs, read-only on others — check `/settings/fields`).

## Field Format Reference

| Format      | Pattern                             | Example                       | Notes                               |
| ----------- | ----------------------------------- | ----------------------------- | ----------------------------------- |
| Date        | `YYYY-MM-DD`                        | `2026-04-23`                  |                                     |
| DateTime    | ISO 8601 w/ offset                  | `2026-04-23T10:00:00+10:00`   | `Z` accepted; offset form emitted   |
| Currency    | bare number                         | `12345.67`                    | no symbol; org currency server-side |
| Phone       | free-form string                    | `+61 3 9000 0000`             | not validated                       |
| Record ID   | 18–19 digit numeric string          | `"410405000002264040"`        | always treat as string              |
| Lookup      | `{"id":"…","name":"…"}`             | `{"id":"410405000000123456"}` | only `id` needed on writes          |
| User lookup | `{"id":"…","name":"…","email":"…"}` |                               | as Lookup                           |

## Enum Reference

Default picklist values — confirm via `GET /settings/fields?module={M}` (tenant-customisable).

| Entity  | Field         | Allowed Values                                                                                                                                                                      | Default         |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Lead    | `Lead_Status` | `Not Contacted`,`Attempted to Contact`,`Contacted`,`Junk`,`Lost Lead`,`Not Qualified`,`Pre-Qualified`,`Contact in Future`                                                           | `Not Contacted` |
| Lead    | `Lead_Source` | `None`,`Advertisement`,`Cold Call`,`Employee Referral`,`External Referral`,`Online Store`,`Partner`,`Public Relations`,`Trade Show`,`Web Research`                                  | `None`          |
| Deal    | `Stage`       | `Qualification`,`Needs Analysis`,`Value Proposition`,`Identify Decision Makers`,`Proposal/Price Quote`,`Negotiation/Review`,`Closed Won`,`Closed Lost`,`Closed Lost to Competition` | —               |
| Task    | `Status`      | `Not Started`,`Deferred`,`In Progress`,`Completed`,`Waiting for Input`                                                                                                              | `Not Started`   |
| Task    | `Priority`    | `Low`,`Normal`,`High`                                                                                                                                                               | `Normal`        |
| Call    | `Call_Type`   | `Inbound`,`Outbound`,`Missed`                                                                                                                                                       |                 |
| Account | `Industry`    | tenant-specific; typical: `Manufacturing`,`Retail`,`Technology`,`Healthcare`,`Finance`,`Education`,`Other`                                                                          |                 |
