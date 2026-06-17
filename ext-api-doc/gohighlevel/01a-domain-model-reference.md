---
api_name: GoHighLevel
api_slug: gohighlevel
base_url: https://services.leadconnectorhq.com
path_version_segment: none (version is the Version header, never a path)
auth: Bearer PIT (backend-injected); Version header mandatory every call
field_casing: camelCase
id_format: opaque strings (never parse/synthesize)
tenant_key: locationId (required almost everywhere)
call_surface: HTTP via `numa integrations request`. NOT a file-store connector.
confidence: docs-derived [DOCS] from the 2026-05-04 investigation, NOT live-validated. Field lists are INDICATIVE — GET a real record and mirror its fields. Non-default markers [UNVERIFIED]/[INFERRED] inline.
companions: 01=api-rules, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# GoHighLevel — Domain Model

## Hierarchy (the defining structural fact)

Everything lives inside a **Location** (sub-account); Locations live inside a **Company** (agency).

```
Company (Agency)
  └── Location (Sub-account)   ← primary API boundary; PIT scoped here
        ├── Contacts ── tags, tasks, notes, custom field values, followers
        ├── Conversations ── Messages (SMS/email/call)
        ├── Opportunities ──> Pipeline ──> Stage
        ├── Calendars ── Calendar Events / Appointments
        ├── Workflows (automations)
        ├── Forms / Surveys / Funnels
        ├── Invoices / Orders / Transactions (Payments)
        ├── Custom Fields (per-location definitions)
        └── Users (also exist at agency level)
```

Consequences: `locationId` scopes ALL data, required on almost every list/search call and most create bodies. The PIT was created in ONE location; other locations' data → 403/404. Resolve `locationId` first via `GET /locations/search` (01b) and reuse it for the session.

## ID & casing semantics

- All ids = opaque strings (locationId `110411007T`; contact ids look UUID-ish in SDK examples). Never parse or fabricate.
- Pagination cursors pair an epoch-ms timestamp (`startAfter`) with a record id (`startAfterId`).
- camelCase throughout (`firstName`, `pipelineId`, `dateAdded`).

## First five minutes with a new connection (all reads, cheap, safe)

```
1. GET /locations/search                       → locationId + name (confirm with user)
2. GET /opportunities/pipelines?locationId=…   → pipeline + stage ids/names (cache)
3. GET /contacts/?locationId=…&limit=1         → ONE real contact: actual field names, date formats,
                                                 envelope shape — ground truth for every field table
4. (if relevant) GET /locations/{loc}/customFields → custom field definitions [UNVERIFIED path]
```

Step 3 matters: field lists here are indicative, not authoritative — one real record resolves more unknowns than any doc reading.

## Entity catalog

"Numa relevance" = how likely a chat user needs it. Per-family paths beyond the core set in 01 are not pinned — discover by GETting and reading the response.
| Entity family | What it is | Relevance |
| --- | --- | --- |
| Contacts | People/leads — CRUD, upsert, search, tags, tasks, notes, followers, bulk | Core |
| Conversations | SMS/email/call threads + messages, send | Core |
| Opportunities | Deals in pipelines; search, CRUD, stage moves | Core |
| Pipelines (under Opportunities) | Stage containers for opportunities | Core |
| Calendars | Booking calendars, groups, resources, events, appointments | Core |
| Locations (Sub-accounts) | Tenant units; get, search, custom fields | Core (lookup) |
| Payments | Orders, transactions, subscriptions, integrations | High |
| Invoices | Invoice CRUD + lifecycle | High |
| Users | Agency/location users | Medium |
| Workflows | Automations — list (+ add contact to workflow [UNVERIFIED]) | Medium |
| Custom Fields / Values | Per-location field definitions | Medium |
| Forms / Surveys | Definitions and submissions (read) | Medium |
| Tags | Contact labels (also via /contacts/{id}/tags) | Medium |
| Tasks / Notes | Per-contact to-dos and notes | Medium |
| Companies | Agency-level records | Low (PIT is location-scoped) |
| Funnels | Funnel definitions (read) | Low |
| Blogs | Blog sites, posts, authors, categories | Low |
| Social Planner | Posts, accounts, statistics | Low |
| Emails (templates) | Template CRUD | Low |
| Media Storage | File upload/manage | Low — binary via connector untested |
| Objects / Associations | Custom objects + contact relationships | Low |
| Courses/Snapshots/Campaigns/SaaS/Voice AI/Phone System/Products/Proposals | Specialised | Low |

## Key entities (field lists indicative — mirror a GET)

### Location

| Field               | Notes                                    |
| ------------------- | ---------------------------------------- |
| `id` / `locationId` | tenant key — required nearly everywhere  |
| `companyId`         | owning agency                            |
| `name`              | show when asking the user which location |

Endpoints: `GET /locations/search`, `GET /locations/{locationId}`.

### Contact (center of the CRM; in exactly one location)

| Field                         | Type     | Notes                                                    |
| ----------------------------- | -------- | -------------------------------------------------------- |
| `id`                          | string   | read-only                                                |
| `locationId`                  | string   | required on create                                       |
| `firstName`,`lastName`,`name` | string   | `name` = combined field in SDK examples                  |
| `email`                       | string   | dedupe key for upsert (with phone) per location settings |
| `phone`                       | string   | E.164 (`+15551234567`) [UNVERIFIED — best practice]      |
| `tags`                        | string[] | also mutable via /contacts/{id}/tags                     |
| `customFields`                | array    | values for per-location definitions [UNVERIFIED shape]   |
| `country`                     | string   | restricted list — docs/other/country                     |
| `dateAdded`,`dateUpdated`     | datetime | [UNVERIFIED names] — GET to confirm                      |
| `source`                      | string   | lead source [UNVERIFIED]                                 |

Sub-resources: tasks (`/contacts/{id}/tasks`), tags (`/contacts/{id}/tags`), notes, followers.
Endpoints: `POST /contacts/`, `POST /contacts/upsert`, `GET/PUT/DELETE /contacts/{contactId}`, `GET /contacts/` (deprecated but documented), `/contacts/search` (preferred, shape [UNVERIFIED]).

### Opportunity (a deal; one pipeline, one stage)

| Field                         | Notes                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `id`                          | read-only                                               |
| `name`                        | deal title                                              |
| `locationId`                  |                                                         |
| `pipelineId`                  | which pipeline                                          |
| `stageId` / `pipelineStageId` | current stage — exact name [UNVERIFIED]; mirror the GET |
| `status`                      | open/won/lost/abandoned [UNVERIFIED exact values]       |
| `contactId`                   | person the deal is attached to                          |
| `monetaryValue`               | deal value [UNVERIFIED name]                            |

Endpoints: `GET /opportunities/search`, `GET /opportunities/pipelines`, `GET/PUT /opportunities/{id}`. Create/delete exist in the SDK service but paths [UNVERIFIED] — see 01c.

### Pipeline

| Field      | Notes                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| `id`       | use as `pipelineId` on opportunities                                    |
| `name`     |                                                                         |
| `stages[]` | ordered; each stage has `id`+`name`; you need a stage id to move a deal |

`GET /opportunities/pipelines?locationId=...` returns all pipelines with stages — fetch once, cache.

### Conversation & Message

| Entity       | Fields (indicative)                                                    |
| ------------ | ---------------------------------------------------------------------- |
| Conversation | `id`, `contactId`, `locationId`, `type` (SMS/email/call)               |
| Message      | `id`, `conversationId`, `type`, `body`, `direction` (inbound/outbound) |

Endpoints: `GET /conversations/search`, `GET /conversations/{id}/messages`, `POST /conversations/messages` (send — REAL outbound SMS/email; always confirm).

### Calendar & Appointment

| Entity            | Fields (indicative)                                     |
| ----------------- | ------------------------------------------------------- |
| Calendar          | `id`, `locationId`, `name`; also groups and resources   |
| Appointment/Event | `id`, `calendarId`, `contactId`, `startTime`, `endTime` |

`GET /calendars/events` **requires one of `userId`, `groupId`, or `calendarId`** — list calendars/users first.

### Payments: Order & Transaction

| Entity      | Fields (indicative)                                |
| ----------- | -------------------------------------------------- |
| Order       | `id`, `locationId`, `contactId`, `total`, `status` |
| Transaction | paginated list, supports filtering                 |

Endpoints: `GET /payments/orders/{id}`, `GET /payments/transactions`. Read-only scopes (`payments/orders.readonly`, `payments/transactions.readonly`).

### Invoice

`id`, `locationId`, `contactId`, `status`, `total` [UNVERIFIED names]. Full CRUD + lifecycle endpoints exist per the SDK; paths [UNVERIFIED] — explore read-first.

### Workflow

`id`, `locationId`, `name`, `status`. Read via the workflows family; "add contact to workflow" trigger paths [UNVERIFIED].

### User

`id`, `companyId`, `email`, `name`, `role`. Use to resolve `userId` for calendar event queries.

### Task & Note (contact sub-resources)

| Entity | Fields (indicative)                                                      | Notes                                                           |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Task   | `id`,`contactId`,`title`,`body`,`dueDate`,`completed` [UNVERIFIED names] | `GET /contacts/{id}/tasks` documented; create path [UNVERIFIED] |
| Note   | `id`,`contactId`,`body`,`dateAdded` [UNVERIFIED names]                   | notes family in contacts docs nav; paths [UNVERIFIED]           |

Both hang off a contact — resolve the contact first.

### Custom Field (per-location definitions)

`id`, `locationId`, `name`, `fieldKey`, `dataType`. `GET /locations/{locationId}/customFields` per the MCP tool (`locations_get-custom-fields`); exact REST path [UNVERIFIED]. Reading contact custom-field values requires joining against these (values likely reference field `id`/`fieldKey` [UNVERIFIED]) — fetch definitions once, then decode.

### Company (Agency)

`id`, `name`. Top of the hierarchy; mostly out of reach for a location-scoped PIT.

## Relationships

```
Company 1 ──< Location
Location 1 ──< Contact ──< Task / Note / Tag(s) / CustomFieldValue / Follower
Location 1 ──< Pipeline 1 ──< Stage
Contact  1 ──< Opportunity >── Pipeline + Stage   (contactId, pipelineId, stageId)
Contact  1 ──< Conversation 1 ──< Message
Location 1 ──< Calendar 1 ──< Appointment >── Contact
Contact  1 ──< Invoice / Order / Transaction
Location 1 ──< Workflow / Form / Survey / Funnel / CustomField definition
Company  1 ──< User (users may also be location-scoped)
```

Cardinalities are the natural CRM reading [UNVERIFIED edge cases, e.g. shared users].

## Domain rules

- `locationId` scopes all data; required on almost every call.
- A PIT is created in one location and only sees that location.
- Upsert dedupe depends on the location's "Allow Duplicate Contact" setting; if email and phone match _different_ contacts, the configured priority field decides which record is updated.
- `country` values are restricted — marketplace.gohighlevel.com/docs/other/country.
- Phone numbers should be normalized to E.164 before writing [UNVERIFIED — best practice].
- The `Version` header changes the response schema — pin one value per session.
- `GET /contacts/` is deprecated in favour of `/contacts/search`.
- Tags are free-form strings; adding an existing tag is presumably a no-op [UNVERIFIED].

## Scopes ↔ entities

Scopes are chosen when the Private Integration is created; a missing scope = 403 on that family. Naming: `{family}.readonly` / `{family}.write`, with sub-scopes like `calendars/events.readonly`.
| To do this… | PIT needs (docs naming) |
| --- | --- |
| Read/write contacts | `contacts.readonly` / `contacts.write` |
| Read/write conversations + messages | `conversations.readonly` / `conversations.write` (+ message sub-scopes) |
| Read/write opportunities | `opportunities.readonly` / `opportunities.write` |
| Read calendars + events | `calendars.readonly`, `calendars/events.readonly` (write variants exist) |
| Read payments | `payments/orders.readonly`, `payments/transactions.readonly` |
| Resolve locations | `locations.readonly` ("View Locations") |
| Read custom fields | "View Custom Fields" |
| Read forms/surveys | "View Forms" etc. |
The MCP docs' recommended set ("View Contacts", "Edit Contacts", "View Conversations", …) is a good default checklist when the user creates their integration. Exact slugs for every family live on /docs/Authorization/Scopes (page requires a browser).

## Field formats

| Format                 | Value                                                                                     | Notes                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| IDs                    | opaque strings                                                                            | never synthesize                                                           |
| Field casing           | camelCase                                                                                 | `firstName`, `locationId`                                                  |
| Timestamps             | epoch ms in pagination cursors; ISO-8601 in webhook payloads (`2025-06-25T06:57:06.225Z`) | entity-body date format [UNVERIFIED] — mirror GETs                         |
| Phone                  | E.164 (`+64211234567`)                                                                    | [UNVERIFIED — best practice]                                               |
| Country                | restricted list (docs/other/country)                                                      |                                                                            |
| List envelope          | `{"<collection>":[...],"meta":{...}}`                                                     | e.g. `contacts` key                                                        |
| Single-record envelope | `{"contact":{...}}`-style wrapper                                                         | inferred from SDK (`contact.contact.name`) [UNVERIFIED for other entities] |

## What we do NOT know (read before assuming)

1. Exact field lists per entity — GET a real record first and mirror its fields on writes.
2. Enum values (opportunity status, conversation type, invoice status) [UNVERIFIED].
3. `/contacts/search` request shape (GET-with-params vs POST-with-filter-body) [UNVERIFIED] — see 01b.
4. Required-field sets on create beyond `locationId` [UNVERIFIED] — expect 400/422 to teach you.
5. Custom field value write format [UNVERIFIED].
6. Anything tagged [UNVERIFIED] survives only until the first real response contradicts it — trust the API, note the discrepancy.
