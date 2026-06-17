---
api_name: Podio
api_slug: podio
base_url: https://api.podio.com
path_version_segment: none (core API unversioned; only /oauth/token/v2 is versioned)
call_surface: HTTP JSON via `connect_request` (not file-browse, not MCP)
confidence: all [DOCUMENTED] (developers.podio.com) unless tagged [INFERRED]
companion_of: 01-llm-api-rules.md
scope: hierarchy entities, dynamic field-type value shapes, state machines
---

# Podio — Domain Model Reference

Hierarchy is FIXED: **Org → Space → App → Item**. The item schema is **per-app and tenant-defined** — discovery-first, like Dataverse. No global "Lead"/"Deal" entity; each App defines its own fields. You MUST `GET /app/{app_id}` to learn an app's fields (`field_id`, `external_id`, `type`, `config`) before reading/writing items meaningfully.

## Entity Catalog

### Organization (Org)

Path: `/org/` (list), `/org/{org_id}` (get). Top-level tenant container; a user belongs to ≥1 orgs; owns spaces. CRUD: Read (create/update are admin/billing, rarely via API). Relationships: 1:N → Space. All fields read-only:

| Field    | Type    | Description                  | Example          |
| -------- | ------- | ---------------------------- | ---------------- |
| `org_id` | integer | Org identifier               | `100200`         |
| `name`   | string  | Organization name            | `"Acme Pty Ltd"` |
| `url`    | string  | Org URL slug                 | `"acme"`         |
| `status` | string  | `active`/`inactive`          | `"active"`       |
| `spaces` | array   | Embedded spaces (when asked) | `[{...}]`        |

### Space (Workspace)

Path: `/space/{space_id}` (get), `/org/{org_id}/space/` (list by org), `/space/` (create). A workspace within an org; contains apps + members. CRUD: C/R/U/D. Relationships: N:1 → Org; 1:N → App.

| Field       | Type    | Required     | Writable | Description      | Example        |
| ----------- | ------- | ------------ | -------- | ---------------- | -------------- |
| `space_id`  | integer | —            | no       | Space identifier | `300400`       |
| `name`      | string  | yes          | yes      | Workspace name   | `"Sales Team"` |
| `org_id`    | integer | yes (create) | yes      | Parent org       | `100200`       |
| `privacy`   | string  | no           | yes      | `open`/`closed`  | `"closed"`     |
| `url_label` | string  | —            | no       | URL slug         | `"sales-team"` |

### Application (App) — the dynamic schema lives here

Path: `/app/{app_id}` (get definition), `/space/{space_id}/app/` (list by space), `/app/` (create). A user-defined data type (a "table") within a space; defines the fields its items carry. CRUD: C/R/U/D. Relationships: N:1 → Space; 1:N → Item; defines → Field; a Field of `type:"app"` references Items in another App.

| Field      | Type    | Writable | Description                                | Example               |
| ---------- | ------- | -------- | ------------------------------------------ | --------------------- |
| `app_id`   | integer | no       | App identifier                             | `500600`              |
| `status`   | string  | no       | `active`/`inactive`/`deleted`              | `"active"`            |
| `space_id` | integer | no       | Parent space                               | `300400`              |
| `config`   | object  | no       | `{type,name,item_name,icon,external_id,…}` | `{name:"Leads",…}`    |
| `fields`   | array   | partial  | Field definitions (the schema)             | `[{field_id,type,…}]` |

**Field definition** (inside `app.fields[]`): `field_id` (int), `external_id` (string slug), `type` (text/number/date/category/app/contact/money/image/email/phone/embed/calculation/duration/progress/location/…), `status`, `config` (`{label,description,settings,mapping,required,…}`). **Use `external_id` as the stable write key** — `field_id`s differ per app, but `external_id` is a readable, stable slug.

### Item — a record ("row") in an App

Path: `/item/{item_id}` (get), `/item/app/{app_id}/filter` (POST list/filter), `/item/app/{app_id}/` (POST create), `/item/{item_id}` (PUT update, DELETE delete). Its `fields` array is shaped by the App definition. CRUD: C/R/U/D. Relationships: N:1 → App; via `type:"app"` fields → other Items (foreign-key style); 1:N → Comment/File/Task (attached by ref).

| Field         | Type          | Required | Writable     | Description                                         | Example                 |
| ------------- | ------------- | -------- | ------------ | --------------------------------------------------- | ----------------------- |
| `item_id`     | integer       | —        | no           | Record identifier                                   | `12345`                 |
| `app`         | object        | —        | no           | `{app_id,config:{name,item_name}}`                  | `{app_id:500600,…}`     |
| `external_id` | string        | no       | yes (create) | Caller-supplied external key (dedupe by it)         | `"EXT-2024-001"`        |
| `title`       | string        | —        | no           | Derived from the app's "title" field                | `"Project Alpha"`       |
| `fields`      | array<object> | per-app  | yes          | Field values — shape depends on each field's `type` | see Field Format        |
| `tags`        | array<string> | no       | yes          | Free-text tags                                      | `["urgent"]`            |
| `created_on`  | datetime      | —        | no           | UTC `YYYY-MM-DD HH:MM:SS`                           | `"2026-05-29 10:30:00"` |
| `created_by`  | object        | —        | no           | `{type:"user",id,name}`                             | `{type:"user",…}`       |
| `link`        | string(url)   | —        | no           | Web URL to the item                                 | `"https://podio.com/…"` |
| `rights`      | array<string> | —        | no           | Caller's permissions on the item                    | `["view","update"]`     |
| `revision`    | integer       | —        | no           | Current revision (increments per write)             | `3`                     |

**Read vs write shape of `fields` differ.** READ: array of `{field_id, external_id, type, label, values:[…]}`. WRITE (create/update): an **object** keyed by `external_id` (or `field_id`) → type-specific write value. Do NOT POST a read body back as a write.

### File

Path: `/file/{file_id}` (get), `/file/` (POST multipart upload), `/file/{file_id}` (DELETE). Uploaded standalone, then **attached** to an item via `file_ids` on item create/update (NOT inside the `fields` body). CRUD: C(multipart)/R/D. ⚠️ Upload is out of scope for the JSON-only `connect_request` surface — v2.

| Field      | Type    | Description       |
| ---------- | ------- | ----------------- |
| `file_id`  | integer | File identifier   |
| `name`     | string  | Filename          |
| `mimetype` | string  | MIME type         |
| `size`     | integer | Bytes             |
| `link`     | string  | CDN download link |

### Task / Comment / Hook (supporting)

| Entity      | Path                            | Notes                                                                                                                       |
| ----------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Task**    | `/task/`                        | Standalone or attached to a ref. Fields: `text`, `description`, `due_date`, `responsible`, `status` (`active`/`completed`). |
| **Comment** | `/comment/{ref_type}/{ref_id}/` | On items/tasks/etc. `ref_type` = `item`/`task`/…; body `{value}`.                                                           |
| **Hook**    | `/hook/{ref_type}/{ref_id}/`    | Webhooks on `app`/`space`/`app_field`. Created `inactive` until verified (01d).                                             |

## Entity Relationship Diagram

```
Organization 1:N Space 1:N Application 1:N Item
(tenant)         (workspace)  (schema)        (record)

Application defines → Field def (field_id, external_id, type)
Item has typed → Field value (type-tagged values[])
A Field of type:"app" → references a related Item in another app (N:1 foreign key, across the org as permissions allow)

Items also carry: Files (via file_ids), Tasks, Comments, Tags.
Hooks attach to: App, Space, or an App Field.
```

## State Machines

Podio has **no built-in item lifecycle** — no platform-enforced Stage/Status. An app's "Status" is just a `category` field the builder defined; transitions are unconstrained. Only App and Task have platform lifecycles.

### App.status

`[active] ⇄ [inactive]` (deactivate/reactivate); `[active] → [deleted]` (delete; soft, recoverable for a window).

| From   | Trigger    | To       | Reversible? | Side Effects                |
| ------ | ---------- | -------- | ----------- | --------------------------- |
| active | deactivate | inactive | yes         | Items hidden from views     |
| active | delete     | deleted  | recoverable | Items soft-deleted with app |

### Task.status

`[active] ⇄ [completed]` (complete/reopen).

| From   | Trigger  | To        | Reversible? | Side Effects                |
| ------ | -------- | --------- | ----------- | --------------------------- |
| active | complete | completed | yes         | Stream event, notifications |

**Per-state capabilities:** App `active`/`inactive` → update yes, delete yes (inactive: items hidden until reactivated); App `deleted` → no update (soft-deleted, recoverable for a window). Task `active`/`completed` → update yes, delete yes (reopen by setting status back to active).

## Business Rules

**Ordering/Dependency:** Cannot meaningfully create/read an Item without its App's `app_id` + field schema — `GET /app/{app_id}` first. A File must be uploaded (`POST /file/`) before attaching via `file_ids`. App-reference values require valid `item_id`s the user can access. A Hook is created `inactive`, becomes `active` only after the verify handshake (01d).

**Field-level:** Reference on write by `field_id` (int) OR `external_id` (string) — **prefer `external_id`** (stable, readable). Required fields per-app in `field.config.required`; create omitting one → 400 `invalid_value`/validation error. Datetimes `YYYY-MM-DD HH:MM:SS` in UTC — no offset, no `Z`; dates `YYYY-MM-DD`. Numeric/ID values JSON integers/numbers (not strings); booleans real bools. `external_id` on an item is caller-supplied and is the dedupe/upsert key (`GET /item/app/{app_id}/external_id/{external_id}`).

**Cascading:** Deleting an App soft-deletes its Items. Deleting a Space removes its Apps + their Items. Deleting an Item removes its comment/file associations (shared files may persist [INFERRED]).

**Uniqueness:** item `external_id` unique within its app (lookup key). App `external_id` and field `external_id` unique within their parent scope.

**Computed/Read-only (server-set):** `created_on`, `created_by`, `last_event_on`, `last_edit_on`, `revision`, `link`, `rights`, `title`. `calculation`-type fields are derived; not writable.

## Field Format Reference

The item `fields` array (READ) contains one object per populated field: `{field_id, external_id, type, label, values:[…]}`. The `values` shape is **type-specific** — the single most error-prone part of the API. WRITE column = what you put in the create/update `fields` object (keyed by `external_id`).

| `type`         | `values[]` (READ)                        | WRITE value                              | Notes                                     |
| -------------- | ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `text`         | `[{value:"…"}]`                          | `"plain or html string"`                 | `size` config (small/large)               |
| `number`       | `[{value:"123.45"}]`                     | `123.45`                                 | Read returns STRING; write a NUMBER       |
| `money`        | `[{value:"100.00",currency:"USD"}]`      | `{value:100.00,currency:"USD"}`          |                                           |
| `date`         | `[{start:"2026-05-29 09:00:00",end:…}]`  | `{start:"YYYY-MM-DD HH:MM:SS",end?:…}`   | UTC; `end` optional                       |
| `category`     | `[{value:{id,text,color}}]`              | `[{value:option_id}]` or `[option_id]`   | Single/multi per config; values = opt IDs |
| `app` (ref)    | `[{value:{item_id,title,app}}]`          | `[{value:item_id}]` or `[item_id]`       | Item-to-item reference (foreign key)      |
| `contact`      | `[{value:{profile_id,name,…}}]`          | `[{value:profile_id}]` or `[profile_id]` | People picker                             |
| `email`        | `[{value:"a@b.com",type:"work"}]`        | `[{value,type}]`                         | Multi-value with sub-types                |
| `phone`        | `[{value:"+64…",type:"mobile"}]`         | `[{value,type}]`                         |                                           |
| `image`/`file` | `[{value:{file_id,link,mimetype,name}}]` | via item `file_ids` (NOT in `fields`)    | Attach uploaded files                     |
| `embed`        | `[{embed:{…},file:{…}}]`                 | `{embed:embed_id}`                       | Link previews                             |
| `location`     | `[{value:"addr",lat,lng,…}]`             | `["formatted address"]`                  |                                           |
| `duration`     | `[{value:3600}]`                         | `3600`                                   | Seconds                                   |
| `progress`     | `[{value:75}]`                           | `75`                                     | 0–100                                     |
| `calculation`  | `[{value:…}]`                            | — (read-only)                            | Derived                                   |

**Discovery mandatory.** Field set, `external_id`s, types, required-ness, category option IDs are all per-app. Resolve via `GET /app/{app_id}` (or `GET /app/{app_id}/field/{field_id}`) before constructing any read filter or write body.

### Date/time & scalar formats

| Format    | Pattern               | Example                      | Notes                            |
| --------- | --------------------- | ---------------------------- | -------------------------------- |
| Date      | `YYYY-MM-DD`          | `2026-05-29`                 | No time                          |
| DateTime  | `YYYY-MM-DD HH:MM:SS` | `2026-05-29 10:30:00`        | **UTC only — no `Z`, no offset** |
| Money     | `{value,currency}`    | `{value:100,currency:"USD"}` | Number value + ISO currency      |
| Record ID | integer               | `12345`                      | JSON integer, not a string       |
| Boolean   | native bool           | `true`                       | Not `"true"`                     |

## Enum Value Reference

Category/picklist options are **tenant-defined per field** — no global enum. Discover via `app.fields[].config.settings.options` (`[{id,text,color,status}]`); filter/write using the option `id`. Platform-level fixed enums:

| Entity | Field     | Allowed Values                          | Default    | Notes                         |
| ------ | --------- | --------------------------------------- | ---------- | ----------------------------- |
| App    | `status`  | `active`, `inactive`, `deleted`         | `active`   |                               |
| Space  | `privacy` | `open`, `closed`                        | `closed`   |                               |
| Task   | `status`  | `active`, `completed`                   | `active`   |                               |
| Hook   | `status`  | `inactive` (pending verify), `active`   | `inactive` | Becomes `active` after verify |
| Filter | sort dir  | `sort_desc:true` (desc) / `false` (asc) | desc       | Boolean, not `-field`         |
