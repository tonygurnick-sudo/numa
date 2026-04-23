---
api_name: 'Zoho CRM'
api_slug: 'zoho-crm'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-04-23'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Zoho CRM -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. Entity catalogue, relationships, state machines,
> and business rules for the standard Zoho CRM modules. Custom modules are tenant-specific —
> discover via `GET /crm/v8/settings/modules` at runtime.

---

## Entity Catalog

### Lead

**Resource path:** `/crm/v8/Leads`
**Description:** Unqualified prospect. Converts to Contact + Account + optional Deal.
**CRUD:** Create / Read / Update / Delete / Upsert

| Field           | Type               | Required | Writable | Description                        | Example                       |
| --------------- | ------------------ | -------- | -------- | ---------------------------------- | ----------------------------- |
| `id`            | string (numeric)   | —        | no       | 18-19 digit record ID              | `"410405000002264040"`        |
| `Last_Name`     | string             | yes      | yes      | Required on create                 | `"Smith"`                     |
| `First_Name`    | string             | no       | yes      |                                    | `"Jane"`                      |
| `Company`       | string             | yes      | yes      | Required on Leads specifically     | `"Acme"`                      |
| `Email`         | email              | no       | yes      | Default duplicate-check field      | `"jane@acme.example"`         |
| `Phone`         | string             | no       | yes      |                                    | `"+61 3 9000 0000"`           |
| `Mobile`        | string             | no       | yes      |                                    |                               |
| `Lead_Status`   | picklist           | no       | yes      | See enum reference                 | `"Contacted"`                 |
| `Lead_Source`   | picklist           | no       | yes      |                                    | `"Web Form"`                  |
| `Owner`         | User lookup object | no       | yes      | `{id, name, email}`                | `{"id":"…","name":"…"}`       |
| `Layout`        | Layout lookup      | yes\*    | yes      | Required if module has >1 layout   | `{"id":"…"}`                  |
| `Tag`           | array<object>      | no       | yes      | `[{name, color_code}]`             |                               |
| `Converted`     | boolean            | —        | no       | Set on successful Lead conversion  | `true`                        |
| `Created_Time`  | ISO 8601 dt        | —        | no       |                                    | `"2026-04-01T10:00:00+10:00"` |
| `Modified_Time` | ISO 8601 dt        | —        | no       | Updated server-side on every write |                               |

**Relationships:**

| Related Entity       | Type              | Expression                        | Notes                       |
| -------------------- | ----------------- | --------------------------------- | --------------------------- |
| User (Owner)         | N:1               | `Owner.id`                        | Every Lead has an owner     |
| Note                 | 1:N               | `GET /Leads/{id}/Notes`           | Polymorphic via `se_module` |
| Attachment           | 1:N               | `GET /Leads/{id}/Attachments`     | File uploads                |
| Campaign             | N:M               | Related via conversion            |                             |
| Contact/Account/Deal | 1:1 on conversion | via `/Leads/{id}/actions/convert` | Creates downstream records  |

---

### Contact

**Resource path:** `/crm/v8/Contacts`
**Description:** Individual at a company. Survives Lead conversion.
**CRUD:** C / R / U / D / Upsert

| Field                                                                               | Type           | Required | Writable | Description          | Example                    |
| ----------------------------------------------------------------------------------- | -------------- | -------- | -------- | -------------------- | -------------------------- |
| `id`                                                                                | string         | —        | no       |                      | `"410405000002264050"`     |
| `Last_Name`                                                                         | string         | yes      | yes      |                      | `"Smith"`                  |
| `First_Name`                                                                        | string         | no       | yes      |                      | `"Jane"`                   |
| `Email`                                                                             | email          | no       | yes      | Default dedupe field | `"jane@acme.example"`      |
| `Phone`                                                                             | string         | no       | yes      |                      |                            |
| `Account_Name`                                                                      | Account lookup | no       | yes      | `{id, name}`         | `{"id":"…","name":"Acme"}` |
| `Title`                                                                             | string         | no       | yes      |                      | `"CTO"`                    |
| `Owner`                                                                             | User lookup    | no       | yes      |                      |                            |
| `Mailing_Street`, `Mailing_City`, `Mailing_State`, `Mailing_Zip`, `Mailing_Country` | string         | no       | yes      | Postal address       |                            |

**Relationships:** N:1 → Account; 1:N → Note / Attachment / Task / Call / Meeting; N:M → Deal via Contact_Roles.

---

### Account

**Resource path:** `/crm/v8/Accounts`
**Description:** A customer/prospect company.
**CRUD:** C / R / U / D / Upsert

| Field            | Type           | Required | Writable | Description                  | Example                  |
| ---------------- | -------------- | -------- | -------- | ---------------------------- | ------------------------ |
| `id`             | string         | —        | no       |                              |                          |
| `Account_Name`   | string         | yes      | yes      |                              | `"Acme Pty Ltd"`         |
| `Phone`          | string         | no       | yes      |                              |                          |
| `Website`        | string (url)   | no       | yes      |                              | `"https://acme.example"` |
| `Industry`       | picklist       | no       | yes      |                              | `"Manufacturing"`        |
| `Annual_Revenue` | currency       | no       | yes      | Org currency applied         |                          |
| `Parent_Account` | Account lookup | no       | yes      | Self-reference for hierarchy |                          |
| `Owner`          | User lookup    | no       | yes      |                              |                          |

**Relationships:** 1:N → Contacts / Deals / Notes / Activities. Self-reference via `Parent_Account`.

---

### Deal

**Resource path:** `/crm/v8/Deals`
**Description:** A sales opportunity.
**CRUD:** C / R / U / D / Upsert

| Field              | Type           | Required | Writable | Description                         | Example                |
| ------------------ | -------------- | -------- | -------- | ----------------------------------- | ---------------------- |
| `id`               | string         | —        | no       |                                     |                        |
| `Deal_Name`        | string         | yes      | yes      |                                     | `"Acme – Q2 renewal"`  |
| `Stage`            | picklist       | yes      | yes      | Drives `Probability` + workflow     | `"Negotiation/Review"` |
| `Amount`           | currency       | no       | yes      |                                     | `45000`                |
| `Closing_Date`     | date           | yes      | yes      | `YYYY-MM-DD`                        | `"2026-06-30"`         |
| `Account_Name`     | Account lookup | no       | yes      |                                     |                        |
| `Contact_Name`     | Contact lookup | no       | yes      | Primary contact                     |                        |
| `Owner`            | User lookup    | no       | yes      |                                     |                        |
| `Probability`      | int (0–100)    | —        | auto     | Derived from Stage mapping          | `70`                   |
| `Expected_Revenue` | currency       | —        | auto     | Derived: `Amount × Probability/100` |                        |

**Relationships:** N:1 → Account; N:1 → Contact (primary); N:M → Contacts via Contact_Roles; 1:N → Notes / Attachments / Tasks.

---

### Task

**Resource path:** `/crm/v8/Tasks`
**CRUD:** C / R / U / D

| Field        | Type               | Required | Writable | Description                                      | Example                |
| ------------ | ------------------ | -------- | -------- | ------------------------------------------------ | ---------------------- |
| `Subject`    | string             | yes      | yes      |                                                  | `"Review site survey"` |
| `Status`     | picklist           | no       | yes      | See enum reference                               | `"Not Started"`        |
| `Priority`   | picklist           | no       | yes      | `Low` / `Normal` / `High`                        | `"High"`               |
| `Due_Date`   | date               | no       | yes      |                                                  | `"2026-04-30"`         |
| `Who_Id`     | polymorphic lookup | no       | yes      | Lead or Contact                                  | `{"id":"…"}`           |
| `What_Id`    | polymorphic lookup | no       | yes      | Account / Deal / custom                          |                        |
| `$se_module` | string             | no       | yes      | Required when `What_Id` is set — module api_name | `"Deals"`              |
| `Owner`      | User lookup        | no       | yes      |                                                  |                        |

---

### Note

**Resource path:** `/crm/v8/Notes`
**CRUD:** C / R / U / D

| Field          | Type               | Required | Writable | Description                                |
| -------------- | ------------------ | -------- | -------- | ------------------------------------------ |
| `Note_Title`   | string             | no       | yes      | Either title or content required           |
| `Note_Content` | string             | no       | yes      | Rich text supported                        |
| `Parent_Id`    | string (record id) | yes      | yes      | ID of the record the note is on            |
| `se_module`    | string             | yes      | yes      | API name of parent module (e.g. `"Deals"`) |
| `Owner`        | User lookup        | no       | yes      |                                            |

---

### User

**Resource path:** `/crm/v8/users`
**CRUD:** Read only (admin UI manages users)

| Field       | Type           | Description                       |
| ----------- | -------------- | --------------------------------- |
| `id`        | string         |                                   |
| `full_name` | string         |                                   |
| `email`     | email          |                                   |
| `role`      | Role lookup    |                                   |
| `profile`   | Profile lookup |                                   |
| `status`    | enum           | `active` / `inactive` / `deleted` |

---

## Entity Relationship Diagram

```
                  ┌──────────┐
                  │   User   │  (Owner on every module)
                  └────┬─────┘
          owns         │
     ┌────────┬────────┼─────────┬──────────┐
     ▼        ▼        ▼         ▼          ▼
 ┌────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐
 │  Lead  │ │ Contact │ │ Account │ │  Deal  │ │  Task   │
 └───┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ └────┬────┘
     │            │           │         │           │
     │ convert    │           │ N:1     │           │
     └────────────┼───► Contact  ◄──────┼───────────┘
                  │     Account         │
                  │     (Deal)          │
                  ▼                     ▼
              ┌────────┐           ┌─────────┐
              │  Note  │           │ Attach  │
              └────────┘           └─────────┘
              (polymorphic via Parent_Id + se_module)
```

---

## State Machines

### Deal.Stage

Stages are tenant-configurable. Default (out-of-the-box) set:

```
[Qualification] ─► [Needs Analysis] ─► [Value Proposition] ─► [Identify Decision Makers]
                                                                       │
                                                                       ▼
                      [Proposal/Price Quote] ◄─── [Negotiation/Review] ─► [Closed Won]
                                                                    │
                                                                    └─► [Closed Lost]
```

| From           | Trigger                      | To              | Reversible? | Side Effects                                                |
| -------------- | ---------------------------- | --------------- | ----------- | ----------------------------------------------------------- |
| any open stage | update `Stage`               | any other stage | yes         | `Probability` and `Expected_Revenue` recalc; workflows fire |
| any open       | update `Stage` → Closed Won  | Closed Won      | yes         | "On close" workflows / notifications                        |
| any open       | update `Stage` → Closed Lost | Closed Lost     | yes         | Same                                                        |

Blueprints, if configured for the org, restrict allowed transitions per role. Disallowed transitions return `INVALID_DATA` with a blueprint-specific message.

**Per-stage capabilities:**

| State       | Can Update?        | Can Delete? | Notes                                                                            |
| ----------- | ------------------ | ----------- | -------------------------------------------------------------------------------- |
| Any open    | yes                | yes         |                                                                                  |
| Closed Won  | yes (with warning) | yes         | Re-opening clears "on close" workflow side effects NOT — user must undo manually |
| Closed Lost | yes                | yes         |                                                                                  |

### Lead.Lead_Status

Default values: `Not Contacted`, `Attempted to Contact`, `Contacted`, `Junk`, `Lost Lead`, `Not Qualified`, `Pre-Qualified`, `Contact in Future`. Free transitions unless a Blueprint is configured.

### Lead Conversion (terminal action)

```
[Lead] ──POST /Leads/{id}/actions/convert──► Creates Contact + Account + (optional) Deal
                                              │
                                              └─► Lead is marked Converted=true, NOT deleted.
```

Conversion is atomic — all three downstream records are created or none are. Lead becomes read-mostly after conversion; attributes still editable but it disappears from the default Leads view.

### Task.Status

```
[Not Started] ─► [In Progress] ─► [Completed]
     │                │
     │                └────────► [Waiting for Input]
     │                                  │
     └────► [Deferred]                  └──► [In Progress]
```

No hard enforcement — any transition is legal.

---

## Business Rules

### Ordering / Dependency Rules

- Cannot create a **Contact** without `Last_Name`.
- Cannot create a **Lead** without `Last_Name` AND `Company` (Zoho-specific — Contacts don't need `Company`).
- Cannot create any record in a multi-layout module without supplying `Layout.id`.
- Notes/Tasks/Attachments require `Parent_Id` + `se_module` (the module the parent belongs to).
- `Task.What_Id` must be paired with `$se_module` naming the parent module.

### Field-Level Rules

- `Email` is the default duplicate-check field on Leads and Contacts. Creating with a duplicate email returns per-record `DUPLICATE_DATA`.
- Picklist (`Lead_Status`, `Stage`, …) values are case-sensitive and tenant-specific — discover via `GET /settings/fields?module={Module}`.
- `Closing_Date` on Deals must be `YYYY-MM-DD`.
- Datetime fields accept ISO 8601 with timezone offset; Zoho emits `+HH:MM` form and accepts `Z`.
- Currency fields take raw numbers (no symbol); org currency applied server-side.
- `Owner` on any record must be a valid user ID in the same org.

### Cascading Effects

- `DELETE /{Module}/{id}` → soft delete (record goes to Recycle Bin; accessible via `?type=recycle` list).
- Deleting a parent (e.g. Account) does **not** cascade to children — child records become orphans with the parent lookup nulled.
- Lead conversion is atomic: if Contact create fails, Account is not created either.
- Subforms (nested records inside a record) are auto-deleted with the parent.

### Uniqueness Constraints

- `Email` is unique per module by default (Leads, Contacts). Configurable per-org.
- `Account_Name` is NOT unique by default — two Accounts with the same name can coexist.

### Computed / Read-Only Fields

- `id`, `Created_By`, `Created_Time`, `Modified_By`, `Modified_Time` — server-set; never writable.
- `Probability`, `Expected_Revenue` on Deals — derived from `Stage` and `Amount`.
- `Full_Name` on Contacts — derived from First + Last name; writable on some orgs, read-only on others (check `/settings/fields` per tenant).

---

## Field Format Reference

| Format      | Pattern                                  | Example                       | Notes                                       |
| ----------- | ---------------------------------------- | ----------------------------- | ------------------------------------------- |
| Date        | `YYYY-MM-DD`                             | `2026-04-23`                  |                                             |
| DateTime    | ISO 8601 with offset                     | `2026-04-23T10:00:00+10:00`   | `Z` accepted; offset form emitted           |
| Currency    | bare number                              | `12345.67`                    | No symbol; org currency applied server-side |
| Phone       | free-form string                         | `+61 3 9000 0000`             | Not validated                               |
| Record ID   | 18–19 digit numeric string               | `"410405000002264040"`        | Always treat as string                      |
| Lookup      | `{"id": "…", "name": "…"}` object        | `{"id":"410405000000123456"}` | Only `id` is needed on writes               |
| User lookup | `{"id": "…", "name": "…", "email": "…"}` | same as Lookup                |                                             |

---

## Enum Value Reference

Default picklist values — confirm with `GET /settings/fields?module={Module}` since each tenant can customise.

| Entity  | Field         | Allowed Values                                                                                                                                                                              | Default         |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Lead    | `Lead_Status` | `Not Contacted`, `Attempted to Contact`, `Contacted`, `Junk`, `Lost Lead`, `Not Qualified`, `Pre-Qualified`, `Contact in Future`                                                            | `Not Contacted` |
| Lead    | `Lead_Source` | `None`, `Advertisement`, `Cold Call`, `Employee Referral`, `External Referral`, `Online Store`, `Partner`, `Public Relations`, `Trade Show`, `Web Research`                                 | `None`          |
| Deal    | `Stage`       | `Qualification`, `Needs Analysis`, `Value Proposition`, `Identify Decision Makers`, `Proposal/Price Quote`, `Negotiation/Review`, `Closed Won`, `Closed Lost`, `Closed Lost to Competition` | —               |
| Task    | `Status`      | `Not Started`, `Deferred`, `In Progress`, `Completed`, `Waiting for Input`                                                                                                                  | `Not Started`   |
| Task    | `Priority`    | `Low`, `Normal`, `High`                                                                                                                                                                     | `Normal`        |
| Call    | `Call_Type`   | `Inbound`, `Outbound`, `Missed`                                                                                                                                                             |                 |
| Account | `Industry`    | tenant-specific; typical: `Manufacturing`, `Retail`, `Technology`, `Healthcare`, `Finance`, `Education`, `Other`                                                                            |                 |

---

_Generated from `00-api-investigation-questionnaire.md` Phase 3._
