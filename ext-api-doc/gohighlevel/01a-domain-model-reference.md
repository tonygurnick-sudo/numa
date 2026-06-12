---
api_name: 'GoHighLevel'
api_slug: 'gohighlevel'
generated_from: '00-api-investigation (GoHighLevel, 2026-05-04) + official marketplace docs'
generated_date: '2026-06-10'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# GoHighLevel -- Domain Model Reference

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> Entity and field claims come from the official marketplace docs, MCP tool list, and SDK README
> (investigation 2026-05-04) — tagged [DOCS]. Inferences are tagged [UNVERIFIED].
> Exact field lists per entity were NOT extractable without credentials — treat field tables as
> indicative, GET a real record and mirror what comes back.

## The Multi-Tenant Hierarchy

GoHighLevel's defining structural fact: everything lives inside a **Location** (sub-account), and
Locations live inside a **Company** (agency) [DOCS].

```
Company (Agency)
  └── Location (Sub-account)   ← the primary API boundary; PIT tokens are scoped here
        ├── Contacts ── tags, tasks, notes, custom field values, followers
        ├── Conversations ── Messages (SMS / email / call)
        ├── Opportunities ──> Pipeline ──> Stage
        ├── Calendars ── Calendar Events / Appointments
        ├── Workflows (automations)
        ├── Forms / Surveys / Funnels
        ├── Invoices / Orders / Transactions (Payments)
        ├── Custom Fields (definitions, per-location)
        └── Users (also exist at agency level)
```

Consequences for the agent [DOCS]:

- `locationId` is required on almost every list/search call and on most create bodies — it scopes ALL data.
- The Numa connection's PIT was created inside one specific location; data in other locations of the
  same agency is out of reach (expect 403/404) [DOCS — PIT is location-scoped].
- Always resolve `locationId` first via `GET /locations/search` (see 01b) and reuse it for the session.

## ID Semantics

- All entity ids are **opaque strings** (e.g. locationId `110411007T`, contact ids look UUID-ish in
  SDK examples) [DOCS]. Never parse or fabricate ids.
- Pagination cursors pair an **epoch-milliseconds timestamp** (`startAfter`) with a **record id**
  (`startAfterId`) [DOCS].
- Field casing is **camelCase** throughout (`firstName`, `pipelineId`, `dateAdded`) [DOCS].

## First Five Minutes With a New Connection

The discovery sequence that grounds everything else (all reads, cheap, safe):

```
1. GET /locations/search                       → locationId + location name (confirm with user)
2. GET /opportunities/pipelines?locationId=…   → pipeline + stage ids/names (cache for the session)
3. GET /contacts/?locationId=…&limit=1         → ONE real contact: learn the actual field names,
                                                 date formats, and envelope shape — this record is
                                                 your ground truth for every field table below
4. (if relevant) GET /locations/{loc}/customFields → custom field definitions [UNVERIFIED path]
```

Why step 3 matters: field lists in this file are indicative, not authoritative [DOCS — interactive
docs not fetchable]. One real record resolves more unknowns than any amount of doc reading.

## Entity Catalog

Endpoint families documented in the marketplace docs nav + official SDK services list [DOCS].
"Numa relevance" = how likely a chat user is to need it.

| Entity family            | What it is                                      | Numa relevance |
| ------------------------ | ----------------------------------------------- | -------------- |
| Contacts                 | People/leads — CRUD, upsert, search, tags, tasks, notes, followers, bulk | Core |
| Conversations            | SMS/email/call threads + messages, send         | Core           |
| Opportunities            | Deals in pipelines; search, CRUD, stage moves   | Core           |
| Pipelines (under Opportunities) | Stage containers for opportunities       | Core           |
| Calendars                | Booking calendars, groups, resources, events, appointments | Core  |
| Locations (Sub-accounts) | Tenant units; get, search, custom fields        | Core (lookup)  |
| Payments                 | Orders, transactions, subscriptions, integrations | High         |
| Invoices                 | Invoice CRUD + lifecycle                        | High           |
| Users                    | Agency/location users                           | Medium         |
| Workflows                | Automations — list (+ add contact to workflow [UNVERIFIED]) | Medium |
| Custom Fields / Values   | Per-location field definitions                  | Medium         |
| Forms / Surveys          | Form + survey definitions and submissions (read) | Medium        |
| Tags                     | Contact labels (also managed via /contacts/{id}/tags) | Medium   |
| Tasks / Notes            | Per-contact to-dos and notes                    | Medium         |
| Companies                | Agency-level records                            | Low (PIT is location-scoped) |
| Funnels                  | Funnel definitions (read)                       | Low            |
| Blogs                    | Blog sites, posts, authors, categories          | Low            |
| Social Planner           | Social posts, accounts, statistics              | Low            |
| Emails (templates)       | Email template CRUD                             | Low            |
| Media Storage            | File upload/manage                              | Low — binary via connector untested |
| Objects / Associations   | Custom objects + contact relationships          | Low            |
| Courses / Snapshots / Campaigns / SaaS / Voice AI / Phone System / Products / Proposals | Specialised modules | Low |

All families above are [DOCS] (docs navigation + SDK services). Per-family endpoint paths beyond the
core set in `01-llm-api-rules.md` are not pinned — discover by GETting and reading the response.

## Key Entities

### Location (Sub-account) [DOCS]

| Field        | Notes                                            |
| ------------ | ------------------------------------------------ |
| `id` / `locationId` | The tenant key — required nearly everywhere |
| `companyId`  | Owning agency                                    |
| `name`       | Display name — show this when asking the user which location to use |

Endpoints: `GET /locations/search`, `GET /locations/{locationId}` [DOCS].

### Contact [DOCS — field names from docs/SDK examples]

The center of the CRM. Lives in exactly one location.

| Field           | Type     | Notes                                                        |
| --------------- | -------- | ------------------------------------------------------------ |
| `id`            | string   | Read-only                                                    |
| `locationId`    | string   | Required on create                                           |
| `firstName`, `lastName`, `name` | string | `name` appears as a combined field in SDK examples |
| `email`         | string   | Dedupe key for upsert (with phone) per location settings     |
| `phone`         | string   | **E.164 format** (`+15551234567`) [UNVERIFIED — community best practice] |
| `tags`          | string[] | Also mutable via `/contacts/{id}/tags`                       |
| `customFields`  | array    | Values for per-location custom field definitions [UNVERIFIED shape] |
| `country`       | string   | Restricted value list — see /docs/other/country [DOCS]       |
| `dateAdded`, `dateUpdated` | datetime | [UNVERIFIED names] — GET a record to confirm before relying on them |
| `source`        | string   | Lead source [UNVERIFIED]                                     |

Sub-resources: tasks (`/contacts/{id}/tasks`), tags (`/contacts/{id}/tags`), notes, followers [DOCS].

Endpoints: `POST /contacts/` (create), `POST /contacts/upsert`, `GET/PUT/DELETE /contacts/{contactId}`,
`GET /contacts/` (list — deprecated but documented), `/contacts/search` (preferred, shape [UNVERIFIED]) [DOCS].

### Opportunity [DOCS]

A deal. Belongs to one pipeline, sits in one stage.

| Field         | Notes                                                     |
| ------------- | ---------------------------------------------------------- |
| `id`          | Read-only                                                  |
| `name`        | Deal title                                                 |
| `locationId`  |                                                            |
| `pipelineId`  | Which pipeline                                             |
| `stageId` / `pipelineStageId` | Current stage — exact field name [UNVERIFIED]; mirror the GET response |
| `status`      | open / won / lost / abandoned [UNVERIFIED exact values]    |
| `contactId`   | The person the deal is attached to                         |
| `monetaryValue` | Deal value [UNVERIFIED name]                             |

Endpoints: `GET /opportunities/search`, `GET /opportunities/pipelines`, `GET/PUT /opportunities/{id}` [DOCS].
Create/delete endpoints exist in the SDK service but paths are [UNVERIFIED] — see 01c.

### Pipeline [DOCS]

| Field      | Notes                                             |
| ---------- | -------------------------------------------------- |
| `id`       | Use as `pipelineId` on opportunities               |
| `name`     |                                                    |
| `stages[]` | Ordered stage list — each stage has `id` + `name`; you need a stage id to move a deal |

`GET /opportunities/pipelines?locationId=...` returns all pipelines with stages — fetch once, cache for the session.

### Conversation & Message [DOCS]

| Entity       | Fields (indicative)                                                |
| ------------ | ------------------------------------------------------------------ |
| Conversation | `id`, `contactId`, `locationId`, `type` (SMS/email/call thread)    |
| Message      | `id`, `conversationId`, `type`, `body`, `direction` (inbound/outbound) |

Endpoints: `GET /conversations/search`, `GET /conversations/{id}/messages`,
`POST /conversations/messages` (send — a REAL outbound SMS/email; always confirm with the user) [DOCS].

### Calendar & Appointment [DOCS]

| Entity      | Fields (indicative)                                          |
| ----------- | ------------------------------------------------------------- |
| Calendar    | `id`, `locationId`, `name`; also groups and resources         |
| Appointment / Event | `id`, `calendarId`, `contactId`, `startTime`, `endTime` |

`GET /calendars/events` **requires one of `userId`, `groupId`, or `calendarId`** (per the MCP tool
description) [DOCS] — list calendars/users first, then query events.

### Payments: Order & Transaction [DOCS]

| Entity      | Fields (indicative)                                  |
| ----------- | ----------------------------------------------------- |
| Order       | `id`, `locationId`, `contactId`, `total`, `status`    |
| Transaction | paginated list, supports filtering [DOCS — MCP tool]  |

Endpoints: `GET /payments/orders/{id}`, `GET /payments/transactions` [DOCS]. Read-only scopes
(`payments/orders.readonly`, `payments/transactions.readonly`) [DOCS].

### Invoice [DOCS — family documented, fields unpinned]

`id`, `locationId`, `contactId`, `status`, `total` [UNVERIFIED field names]. Full CRUD + lifecycle
endpoints exist per the SDK services list; paths [UNVERIFIED] — explore read-first.

### Workflow [DOCS]

`id`, `locationId`, `name`, `status`. Read via the workflows family; "add contact to workflow"
trigger endpoints are referenced in docs nav but paths are [UNVERIFIED].

### User [DOCS]

`id`, `companyId`, `email`, `name`, `role`. Useful for resolving `userId` for calendar event queries.

### Task & Note (contact sub-resources) [DOCS — families documented]

| Entity | Fields (indicative)                                            | Notes                          |
| ------ | --------------------------------------------------------------- | ------------------------------ |
| Task   | `id`, `contactId`, `title`, `body`, `dueDate`, `completed` [UNVERIFIED names] | `GET /contacts/{id}/tasks` documented [DOCS]; create path [UNVERIFIED] |
| Note   | `id`, `contactId`, `body`, `dateAdded` [UNVERIFIED names]       | Notes family in contacts docs nav [DOCS]; paths [UNVERIFIED] |

Both hang off a contact, not the location directly — resolve the contact first.

### Custom Field [DOCS]

Per-location definitions: `id`, `locationId`, `name`, `fieldKey`, `dataType`.
`GET /locations/{locationId}/customFields` exists per the MCP tool (`locations_get-custom-fields`);
exact REST path [UNVERIFIED] — the MCP tool name implies a locations-scoped route.

Reading contact custom-field values requires joining against these definitions (values likely
reference the field `id`/`fieldKey` [UNVERIFIED]) — fetch definitions once, then decode.

### Company (Agency) [DOCS]

`id`, `name`. Top of the hierarchy. Mostly out of reach for a location-scoped PIT.

## Entity Relationships

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

All relationship edges [DOCS] (docs structure); cardinalities are the natural CRM reading [UNVERIFIED edge cases, e.g. shared users].

## Domain Rules

| Rule | Source |
| ---- | ------ |
| `locationId` scopes all data and is required on almost every call | [DOCS] |
| A PIT is created inside one location and only sees that location | [DOCS] |
| Upsert dedupe: depends on the location's "Allow Duplicate Contact" setting; if email and phone match *different* contacts, the configured priority field decides which record gets updated | [DOCS] |
| `country` values are restricted — see https://marketplace.gohighlevel.com/docs/other/country | [DOCS] |
| Phone numbers should be normalized to E.164 before writing | [UNVERIFIED — community best practice] |
| The `Version` header changes the response schema — pin one value per session | [DOCS] |
| `GET /contacts/` is deprecated in favour of `/contacts/search` | [DOCS] |
| Tags are free-form strings; adding an existing tag is presumably a no-op | [UNVERIFIED] |

## Scopes ↔ Entities

Scopes are chosen when the Private Integration is created; a missing scope = 403 on that family [DOCS].
Naming pattern: `{family}.readonly` / `{family}.write`, with sub-scopes like `calendars/events.readonly` [DOCS].

| To do this…                         | The PIT needs (docs naming)                        |
| ----------------------------------- | --------------------------------------------------- |
| Read / write contacts               | `contacts.readonly` / `contacts.write`              |
| Read / write conversations + messages | `conversations.readonly` / `conversations.write` (+ message sub-scopes shown in MCP docs) |
| Read / write opportunities          | `opportunities.readonly` / `opportunities.write`    |
| Read calendars + events             | `calendars.readonly`, `calendars/events.readonly` (write variants exist) |
| Read payments                       | `payments/orders.readonly`, `payments/transactions.readonly` |
| Resolve locations                   | `locations.readonly` ("View Locations")             |
| Read custom fields                  | "View Custom Fields"                                |
| Read forms / surveys                | "View Forms" etc.                                   |

The MCP docs' recommended PIT scope set ("View Contacts", "Edit Contacts", "View Conversations", …)
is a good default checklist when the user creates their integration [DOCS]. Exact scope slugs for
every family live on /docs/Authorization/Scopes (not fully captured — page requires a browser) [DOCS].

## Field Format Reference

| Format        | Value                                  | Notes                                       |
| ------------- | -------------------------------------- | -------------------------------------------- |
| IDs           | opaque strings                         | Never synthesize [DOCS]                      |
| Field casing  | camelCase                              | `firstName`, `locationId` [DOCS]             |
| Timestamps    | epoch ms in pagination cursors; ISO-8601 strings observed in webhook payloads (`2025-06-25T06:57:06.225Z`) | Entity-body date format [UNVERIFIED] — mirror GETs |
| Phone         | E.164 (`+64211234567`)                 | [UNVERIFIED — best practice]                 |
| Country       | Restricted list (docs/other/country)   | [DOCS]                                       |
| List envelope | `{ "<collection>": [...], "meta": {...} }` | e.g. `contacts` key [DOCS]               |
| Single-record envelope | `{ "contact": {...} }`-style wrapper | Inferred from SDK (`contact.contact.name`) [UNVERIFIED for other entities] |

## What We Do NOT Know (read before assuming)

1. **Exact field lists per entity** — docs are interactive/Swagger-based and were not fetchable.
   Always GET a real record first and mirror its fields on writes.
2. **Enum values** (opportunity status, conversation type, invoice status) — [UNVERIFIED].
3. **`/contacts/search` request shape** (GET-with-params vs POST-with-filter-body) — [UNVERIFIED]; see 01b.
4. **Required-field sets on create** beyond `locationId` — [UNVERIFIED]; expect 400/422 to teach you.
5. **Custom field value write format** — [UNVERIFIED].
6. Anything tagged [UNVERIFIED] above survives only until the first real response contradicts it —
   trust the API, note the discrepancy.

---

_Generated 2026-06-10 from the 2026-05-04 docs investigation. Companion to `01-llm-api-rules.md`.
See `01b-query-patterns.md` for reads and `01c-mutation-patterns.md` for writes._
