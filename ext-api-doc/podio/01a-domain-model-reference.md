---
api_name: 'Podio'
api_slug: 'podio'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior']
---

# Podio -- Domain Model Reference

> Companion to `01-llm-api-rules.md`. The Podio **hierarchy is fixed** (Org → Space → App → Item),
> but the **item schema is per-app and tenant-defined** — discovery-first, like Dataverse.
> There is no global "Lead"/"Deal" entity; each App defines its own fields. You MUST call
> `GET /app/{app_id}` to learn an app's fields (their `field_id`, `external_id`, `type`, `config`)
> before reading or writing items meaningfully.
>
> Confidence: everything below is [DOCUMENTED] from developers.podio.com unless marked otherwise.
> The Phase-2 live-call gate has NOT been run — no markers are [CONFIRMED].

---

## Entity Catalog

### Organization (Org)

**Resource path:** `/org/` (list), `/org/{org_id}` (get)
**Description:** Top-level tenant container. A user belongs to one or more orgs. Owns workspaces (spaces).
**CRUD:** Read (create/update are admin/billing ops, rarely via API).

| Field    | Type    | Required | Writable | Description                  | Example          |
| -------- | ------- | -------- | -------- | ---------------------------- | ---------------- |
| `org_id` | integer | —        | no       | Org identifier               | `100200`         |
| `name`   | string  | —        | no       | Organization name            | `"Acme Pty Ltd"` |
| `url`    | string  | —        | no       | Org URL slug                 | `"acme"`         |
| `status` | string  | —        | no       | `active` / `inactive`        | `"active"`       |
| `spaces` | array   | —        | no       | Embedded spaces (when asked) | `[{...}]`        |

**Relationships:** 1:N → Space.

---

### Space (Workspace)

**Resource path:** `/space/{space_id}` (get), `/org/{org_id}/space/` (list by org), `/space/` (create)
**Description:** A workspace within an org. Contains apps and members.
**CRUD:** C / R / U / D

| Field       | Type    | Required     | Writable | Description       | Example        |
| ----------- | ------- | ------------ | -------- | ----------------- | -------------- |
| `space_id`  | integer | —            | no       | Space identifier  | `300400`       |
| `name`      | string  | yes          | yes      | Workspace name    | `"Sales Team"` |
| `org_id`    | integer | yes (create) | yes      | Parent org        | `100200`       |
| `privacy`   | string  | no           | yes      | `open` / `closed` | `"closed"`     |
| `url_label` | string  | —            | no       | URL slug          | `"sales-team"` |

**Relationships:** N:1 → Org; 1:N → App.

---

### Application (App)

**Resource path:** `/app/{app_id}` (get definition), `/space/{space_id}/app/` (list by space), `/app/` (create)
**Description:** A user-defined data type (a "table") within a space. **Defines the fields its items carry — this is where the dynamic schema lives.**
**CRUD:** C / R / U / D

| Field      | Type    | Required | Writable | Description                                     | Example                 |
| ---------- | ------- | -------- | -------- | ----------------------------------------------- | ----------------------- |
| `app_id`   | integer | —        | no       | App identifier                                  | `500600`                |
| `status`   | string  | —        | no       | `active` / `inactive` / `deleted`               | `"active"`              |
| `space_id` | integer | —        | no       | Parent space                                    | `300400`                |
| `config`   | object  | —        | no       | `{type, name, item_name, icon, external_id, …}` | `{name:"Leads", …}`     |
| `fields`   | array   | —        | partial  | Field definitions (the schema) — see below      | `[{field_id, type, …}]` |

**Field definition (inside `app.fields[]`):** `field_id` (int), `external_id` (string slug), `type` (text / number / date / category / app / contact / money / image / email / phone / embed / calculation / duration / progress / location / …), `status`, `config` (`{label, description, settings, mapping, required, …}`). **Use `external_id` as the stable key when writing items** — `field_id`s differ per app, but `external_id` is a readable, stable slug.

**Relationships:** N:1 → Space; 1:N → Item; defines → Field; a Field of `type:"app"` references Items in another App.

---

### Item

**Resource path:** `/item/{item_id}` (get), `/item/app/{app_id}/filter` (POST list/filter), `/item/app/{app_id}/` (POST create), `/item/{item_id}` (PUT update, DELETE delete)
**Description:** A single record (a "row") in an App. Its `fields` array is shaped by the App definition.
**CRUD:** C / R / U / D

| Field         | Type          | Required | Writable     | Description                                         | Example                 |
| ------------- | ------------- | -------- | ------------ | --------------------------------------------------- | ----------------------- |
| `item_id`     | integer       | —        | no           | Record identifier                                   | `12345`                 |
| `app`         | object        | —        | no           | `{app_id, config:{name, item_name}}`                | `{app_id:500600, …}`    |
| `external_id` | string        | no       | yes (create) | Caller-supplied external key (dedupe by it)         | `"EXT-2024-001"`        |
| `title`       | string        | —        | no           | Derived from the app's "title" field                | `"Project Alpha"`       |
| `fields`      | array<object> | per-app  | yes          | Field values — shape depends on each field's `type` | see Field Format below  |
| `tags`        | array<string> | no       | yes          | Free-text tags                                      | `["urgent"]`            |
| `created_on`  | datetime      | —        | no           | UTC `YYYY-MM-DD HH:MM:SS`                           | `"2026-05-29 10:30:00"` |
| `created_by`  | object        | —        | no           | `{type:"user", id, name}`                           | `{type:"user", …}`      |
| `link`        | string (url)  | —        | no           | Web URL to the item                                 | `"https://podio.com/…"` |
| `rights`      | array<string> | —        | no           | Caller's permissions on the item                    | `["view","update"]`     |
| `revision`    | integer       | —        | no           | Current revision (increments on each write)         | `3`                     |

> **Read vs write shape of `fields` differ.** On READ, `fields` is an array of `{field_id, external_id, type, label, values:[…]}`. On WRITE (create/update), `fields` is an **object** keyed by `external_id` (or `field_id`) → type-specific write value. Do not POST a read body back as a write.

**Relationships:** N:1 → App; via `type:"app"` fields → other Items (foreign-key style); 1:N → Comment / File / Task (attached by ref).

---

### File

**Resource path:** `/file/{file_id}` (get), `/file/` (POST multipart upload), `/file/{file_id}` (DELETE)
**Description:** An uploaded attachment. Files are uploaded standalone, then **attached** to an item via `file_ids` on item create/update (NOT inside the `fields` body).
**CRUD:** C (multipart) / R / D. ⚠️ Upload is out of scope for the JSON-only `connect_request` backend — v2.

| Field      | Type    | Description       |
| ---------- | ------- | ----------------- |
| `file_id`  | integer | File identifier   |
| `name`     | string  | Filename          |
| `mimetype` | string  | MIME type         |
| `size`     | integer | Bytes             |
| `link`     | string  | CDN download link |

---

### Task / Comment / Hook (supporting)

| Entity      | Path                            | Notes                                                                                                                       |
| ----------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Task**    | `/task/`                        | Standalone or attached to a ref. Fields: `text`, `description`, `due_date`, `responsible`, `status` (`active`/`completed`). |
| **Comment** | `/comment/{ref_type}/{ref_id}/` | Comments on items/tasks/etc. `ref_type` = `item` / `task` / …; body `{value}`.                                              |
| **Hook**    | `/hook/{ref_type}/{ref_id}/`    | Webhooks on `app` / `space` / `app_field`. Created `inactive` until verified (01d).                                         |

---

## Entity Relationship Diagram

```
┌──────────────┐  1:N   ┌──────────────┐  1:N   ┌──────────────┐  1:N   ┌──────────────┐
│ Organization │───────►│    Space     │───────►│  Application │───────►│     Item     │
│   (tenant)   │        │ (workspace)  │        │  (schema)    │        │  (record)    │
└──────────────┘        └──────────────┘        └──────┬───────┘        └──────┬───────┘
                                                       │ defines               │ has typed
                                                       ▼                       ▼ values
                                                ┌──────────────┐        ┌──────────────┐
                                                │  Field def   │◄───────│ Field value  │
                                                │ (field_id,   │ shapes │ (type-tagged │
                                                │  external_id,│        │  values[])   │
                                                │  type)       │        └──────┬───────┘
                                                └──────────────┘               │ type:"app"
                                                                               ▼ (N:1 ref)
                                                                        ┌──────────────┐
                                                                        │ related Item │  (foreign key)
                                                                        └──────────────┘

Items also carry:  Files (via file_ids), Tasks, Comments, Tags.
Hooks attach to:   App, Space, or an App Field.
```

App-reference fields (`type:"app"`) are the Podio equivalent of a lookup/foreign key — they link an item to items in another app, across the whole org as permissions allow.

---

## State Machines

Podio has **no built-in record lifecycle** for items — no platform-enforced Stage/Status. If an app has a "Status", it's just a `category` field the app builder defined; transitions are unconstrained. The only platform-level lifecycles are on App and Task.

### App.status

```
[active] ──deactivate──► [inactive] ──reactivate──► [active]
   │
   └──delete──► [deleted]   (soft; recoverable for a window)
```

| From   | Trigger    | To       | Reversible? | Side Effects                |
| ------ | ---------- | -------- | ----------- | --------------------------- |
| active | deactivate | inactive | yes         | Items hidden from views     |
| active | delete     | deleted  | recoverable | Items soft-deleted with app |

### Task.status

```
[active] ──complete──► [completed] ──reopen──► [active]
```

| From   | Trigger  | To        | Reversible? | Side Effects                |
| ------ | -------- | --------- | ----------- | --------------------------- |
| active | complete | completed | yes         | Stream event, notifications |

**Per-state capabilities:**

| Entity | State     | Can Update? | Can Delete? | Notes                                   |
| ------ | --------- | ----------- | ----------- | --------------------------------------- |
| App    | active    | yes         | yes         |                                         |
| App    | inactive  | yes         | yes         | Items hidden until reactivated          |
| App    | deleted   | no          | —           | Soft-deleted; recoverable for a window  |
| Task   | active    | yes         | yes         |                                         |
| Task   | completed | yes         | yes         | Reopen by setting status back to active |

---

## Business Rules

### Ordering / Dependency Rules

- You cannot meaningfully create/read an Item without knowing its App's `app_id` and field schema. Always `GET /app/{app_id}` first.
- A File must be uploaded (`POST /file/`) before it can be attached via `file_ids`.
- App-reference field values require valid `item_id`s the user can access.
- A Hook is created `inactive` and only becomes `active` after the verify handshake (01d).

### Field-Level Rules

- Fields are referenced on write by `field_id` (int) OR `external_id` (string). **Prefer `external_id`** — stable and readable.
- Required fields are declared per-app in `field.config.required`. A create omitting a required field → 400 `invalid_value` / validation error.
- Datetimes must be `YYYY-MM-DD HH:MM:SS` in **UTC** — no offset, no `Z`. Dates are `YYYY-MM-DD`.
- Numeric/ID values must be JSON integers/numbers (not strings); booleans must be real bools.
- `external_id` on an item is caller-supplied and acts as the dedupe/upsert key (`GET /item/app/{app_id}/external_id/{external_id}`).

### Cascading Effects

- Deleting an App soft-deletes its Items.
- Deleting a Space removes its Apps and their Items.
- Deleting an Item removes its comment/file associations (shared files may persist). [INFERRED]

### Uniqueness Constraints

- `external_id` on an item is unique within its app (used for lookup-by-external-id).
- App `external_id` and field `external_id` are unique within their parent scope.

### Computed / Read-Only Fields

- `created_on`, `created_by`, `last_event_on`, `last_edit_on`, `revision`, `link`, `rights`, `title` — server-set.
- `calculation`-type fields are derived; not writable.

---

## Field Format Reference

The item `fields` array (on READ) contains one object per populated field:
`{field_id, external_id, type, label, values:[…]}`. The `values` shape is **type-specific** — this is the single most error-prone part of the Podio API. The WRITE column is what you put in the create/update `fields` object (keyed by `external_id`).

| Field `type`   | `values[]` shape (READ)                     | WRITE value                               | Notes                                     |
| -------------- | ------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `text`         | `[{value:"…"}]`                             | `"plain or html string"`                  | Has `size` config (small/large)           |
| `number`       | `[{value:"123.45"}]`                        | `123.45`                                  | Read returns STRING; write a NUMBER       |
| `money`        | `[{value:"100.00", currency:"USD"}]`        | `{value:100.00, currency:"USD"}`          |                                           |
| `date`         | `[{start:"2026-05-29 09:00:00", end:…}]`    | `{start:"YYYY-MM-DD HH:MM:SS", end?:…}`   | UTC; `end` optional                       |
| `category`     | `[{value:{id, text, color}}]`               | `[{value: option_id}]` or `[option_id]`   | Single/multi per config; values = opt IDs |
| `app` (ref)    | `[{value:{item_id, title, app}}]`           | `[{value: item_id}]` or `[item_id]`       | Item-to-item reference (foreign key)      |
| `contact`      | `[{value:{profile_id, name, …}}]`           | `[{value: profile_id}]` or `[profile_id]` | People picker                             |
| `email`        | `[{value:"a@b.com", type:"work"}]`          | `[{value, type}]`                         | Multi-value with sub-types                |
| `phone`        | `[{value:"+64…", type:"mobile"}]`           | `[{value, type}]`                         |                                           |
| `image`/`file` | `[{value:{file_id, link, mimetype, name}}]` | via item `file_ids` (NOT in `fields`)     | Attach uploaded files                     |
| `embed`        | `[{embed:{…}, file:{…}}]`                   | `{embed: embed_id}`                       | Link previews                             |
| `location`     | `[{value:"addr", lat, lng, …}]`             | `["formatted address"]`                   |                                           |
| `duration`     | `[{value:3600}]`                            | `3600`                                    | Seconds                                   |
| `progress`     | `[{value:75}]`                              | `75`                                      | 0–100                                     |
| `calculation`  | `[{value:…}]`                               | — (read-only)                             | Derived                                   |

> **Discovery is mandatory.** Field set, `external_id`s, types, required-ness, and category option IDs are all per-app. Resolve via `GET /app/{app_id}` (or `GET /app/{app_id}/field/{field_id}`) before constructing any read filter or write body.

### Date/time & scalar formats

| Format    | Pattern               | Example                       | Notes                            |
| --------- | --------------------- | ----------------------------- | -------------------------------- |
| Date      | `YYYY-MM-DD`          | `2026-05-29`                  | No time component                |
| DateTime  | `YYYY-MM-DD HH:MM:SS` | `2026-05-29 10:30:00`         | **UTC only — no `Z`, no offset** |
| Money     | `{value, currency}`   | `{value:100, currency:"USD"}` | Number value + ISO currency      |
| Record ID | integer               | `12345`                       | JSON integer, not a string       |
| Boolean   | native bool           | `true`                        | Not `"true"`                     |

---

## Enum Value Reference

Category/picklist options are **tenant-defined per field** — there is no global enum. Discover via `app.fields[].config.settings.options` (`[{id, text, color, status}]`); filter/write using the option `id`. Platform-level fixed enums:

| Entity | Field     | Allowed Values                           | Default    | Notes                         |
| ------ | --------- | ---------------------------------------- | ---------- | ----------------------------- |
| App    | `status`  | `active`, `inactive`, `deleted`          | `active`   |                               |
| Space  | `privacy` | `open`, `closed`                         | `closed`   |                               |
| Task   | `status`  | `active`, `completed`                    | `active`   |                               |
| Hook   | `status`  | `inactive` (pending verify), `active`    | `inactive` | Becomes `active` after verify |
| Filter | sort dir  | `sort_desc: true` (desc) / `false` (asc) | desc       | Boolean, not `-field`         |

---

_Generated from `00-api-investigation-questionnaire.md` Phase 3._
