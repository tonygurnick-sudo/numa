---
api_name: 'Podio'
api_slug: 'podio'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Podio -- Mutation Patterns Reference

> Create / update / delete items, single-field writes, comments, tasks.
> Type-specific write shapes, `external_id` idempotency, no bulk write.
> Companion to `01-llm-api-rules.md`.
>
> **Golden rules:** (1) `GET /app/{app_id}` to learn the schema BEFORE building a write body.
> (2) Write `fields` is an OBJECT keyed by `external_id` (preferred) or `field_id` → type-specific
> write value. (3) There is no bulk write — loop one item per call and respect the 250/1000-per-hr caps.
> Confidence: [DOCUMENTED] from developers.podio.com unless marked; live-gate not yet run.

---

## Write Capabilities Summary

| Operation          | Supported | Method | Endpoint                           | Max batch | Notes                                               |
| ------------------ | --------- | ------ | ---------------------------------- | --------- | --------------------------------------------------- |
| Create item        | yes       | POST   | `/item/app/{app_id}/`              | 1         | `{fields:{…}, tags, file_ids, external_id}`         |
| Update item        | yes       | PUT    | `/item/{item_id}`                  | 1         | **Partial** — only included fields change           |
| Update one field   | yes       | PUT    | `/item/{item_id}/value/{field_id}` | 1         | Single-field write                                  |
| Delete item        | yes       | DELETE | `/item/{item_id}`                  | 1         | Soft delete (recoverable window)                    |
| Bulk delete        | partial   | POST   | `/item/app/{app_id}/delete`        | many      | Accepts an `item_ids` array [INFERRED]              |
| Bulk create/update | **no**    | —      | —                                  | —         | No bulk write API — loop per item                   |
| Upsert             | emulated  | —      | external_id lookup + create/update | 1         | Podio has no native upsert; use external_id         |
| Add comment        | yes       | POST   | `/comment/item/{item_id}/`         | 1         | `{value}`; optional `file_ids`                      |
| Create task        | yes       | POST   | `/task/`                           | 1         | Standalone or attached to a ref                     |
| File upload+attach | yes\*     | POST   | `/file/` then item `file_ids`      | —         | multipart; ⚠️ NOT callable from JSON-only chat (v2) |

---

## Write Body: how `fields` works

On WRITE, `fields` is a JSON **object** keyed by each field's `external_id` (preferred) or `field_id`. Each value uses the **type-specific WRITE shape** (full table in 01a §Field Format Reference):

```json
{
  "fields": {
    "title": "Project Alpha", // text   → plain/html string
    "amount": { "value": 50000, "currency": "USD" }, // money  → {value, currency}
    "status": [1], // category → [option_id]
    "owner": [{ "value": 654321 }], // contact → [{value: profile_id}]
    "related": [{ "value": 12345 }], // app ref → [{value: item_id}]
    "due_date": { "start": "2026-12-31 00:00:00" } // date   → {start, end?} bare UTC
  },
  "tags": ["urgent", "client"],
  "file_ids": [111, 222],
  "external_id": "EXT-2024-001"
}
```

> ⚠️ This is NOT the read shape. On read, `fields` is an array of `{field_id, type, values:[…]}`. Never echo a read body straight back as a write.

---

## Common Patterns

### Pattern 1: Create

```http
POST /item/app/500600/
Authorization: OAuth2 {access_token}
Content-Type: application/json

{
  "external_id": "EXT-2024-001",
  "fields": {
    "title": "Project Alpha",
    "status": [1],
    "amount": { "value": 50000, "currency": "USD" }
  },
  "tags": ["urgent"]
}
```

**Response (200/201):**

```json
{
  "item_id": 54321,
  "title": "Project Alpha",
  "revision": 0,
  "link": "https://podio.com/acme/sales-team/apps/leads/items/54321"
}
```

**Query params on create/update:**

| Param    | Default | Effect                                            |
| -------- | ------- | ------------------------------------------------- |
| `silent` | `false` | `true` → suppress stream activity & notifications |
| `hook`   | `true`  | `false` → do NOT fire webhooks for this write     |

Numa defaults: `silent=false`, `hook=true` (UI parity). Set `silent=true` only for bulk back-loads the user shouldn't be notified about.

**Required fields:** declared per-app in `field.config.required` (from `GET /app/{app_id}`). Omitting a required field → 400 `invalid_value`.

**Idempotency:** POST create is NOT idempotent. Make it safe to retry by setting a stable `external_id` and doing a lookup-then-create-or-update (Pattern 3).

---

### Pattern 2: Update (partial)

Only fields in the body change; omitted fields are untouched; an **empty array `[]` clears** a field.

```http
PUT /item/12345
Content-Type: application/json

{ "fields": { "status": [2], "amount": { "value": 60000, "currency": "USD" } } }
```

**Response:**

```json
{ "revision": 4, "title": "Project Alpha" }
```

The bumped `revision` confirms the write. To clear a field:

```http
PUT /item/12345
{ "fields": { "amount": [] } }
```

---

### Pattern 3: Upsert (emulated via external_id)

Podio has no native upsert. Compose it:

```
1. GET /item/app/500600/external_id/EXT-2024-001
   ├─ 200 → item exists → PUT /item/{item_id}  with the changed fields
   └─ 404 not_found    → POST /item/app/500600/  with external_id + fields
```

This is the recommended pattern for any retry-able or sync workflow — `external_id` is Podio's only dedupe key. (Costs 1 extra read per write; the read is a cheap `GET`, not the heavy filter.)

---

### Pattern 4: Update a single field

When you only want to touch one field and don't want to build the whole `fields` object:

```http
PUT /item/12345/value/60048455
Content-Type: application/json

[{ "value": 2 }]
```

The body is the field's `values` write shape (here, a category option). Useful for status flips.

---

### Pattern 5: Delete

```http
DELETE /item/12345
```

- **Soft delete** — recoverable for a window.
- **Idempotent** — deleting an already-deleted item → 404 / no-op.
- Cascades: deleting an item removes its comment/file associations (shared files may persist [INFERRED]).

**Bulk delete (by IDs):** [INFERRED — verify shape on first live call]

```http
POST /item/app/500600/delete
{ "item_ids": [12345, 12346, 12347] }
```

---

### Pattern 6: Comments & tasks (related writes)

**Add a comment to an item:**

```http
POST /comment/item/12345/
Content-Type: application/json

{ "value": "Spoke with the client — wants to expand to EMEA in Q3." }
```

**Create a task attached to an item:**

```http
POST /task/
Content-Type: application/json

{
  "text": "Prep the Acme proposal",
  "description": "Include EMEA expansion pricing",
  "due_date": "2026-06-15",
  "responsible": 654321,
  "ref_type": "item",
  "ref_id": 12345
}
```

`responsible` is a `profile_id`/`user_id`. `due_date` is `YYYY-MM-DD`. Omit `ref_type`/`ref_id` for a standalone task.

---

## Field Validation Rules

| Rule                     | Detail                                                          | Error if violated         |
| ------------------------ | --------------------------------------------------------------- | ------------------------- |
| Required fields          | Per-app via `field.config.required` (from `GET /app`)           | 400 `invalid_value`       |
| Datetime format          | Bare UTC `YYYY-MM-DD HH:MM:SS` — no `Z`, no offset              | `invalid_value`           |
| Date format              | `YYYY-MM-DD`                                                    | `invalid_value`           |
| Numeric / ID types       | JSON numbers/integers, NOT strings                              | type / `invalid_value`    |
| Booleans                 | Real bools, not `"true"`                                        | `invalid_value`           |
| Category value           | Must be a valid option `id` from the field's `settings.options` | `invalid_value`           |
| App-reference value      | Must be an `item_id` the user can access                        | `forbidden` / `not_found` |
| `external_id` uniqueness | Unique within the app                                           | conflict on duplicate     |
| Calculation fields       | Read-only — never write                                         | `invalid_value`           |

**Discover constraints at runtime:** `GET /app/{app_id}` → each `field.config` carries `required`, `settings.options` (category IDs), `mapping`, etc. Never assume; the schema is tenant-defined.

---

## Server-Side Defaults / Read-Only Fields

| Field                           | Behaviour                          |
| ------------------------------- | ---------------------------------- |
| `item_id`                       | Auto-generated on create           |
| `revision`                      | Starts at 0, increments per write  |
| `created_on`, `created_by`      | Server-set on create               |
| `last_event_on`, `last_edit_on` | Server-set on every write          |
| `title`                         | Derived from the app's title field |
| `link`, `rights`                | Server-computed                    |
| `calculation`-type fields       | Derived; never writable            |

---

## Worked Examples

### Example 1: Minimum viable create

If the app's only required field is `title` (external_id `title`):

```http
POST /item/app/500600/
Content-Type: application/json

{ "fields": { "title": "Quick capture" } }
```

```json
{ "item_id": 54322, "title": "Quick capture", "revision": 0 }
```

Notes: `external_id` omitted (no dedupe). `silent`/`hook` default → notifications fire, webhooks fire.

---

### Example 2: Idempotent upsert by external_id

```http
GET /item/app/500600/external_id/EXT-2024-007
```

→ 404 `not_found`, so create:

```http
POST /item/app/500600/
{ "external_id": "EXT-2024-007", "fields": { "title": "New lead", "status": [1] } }
```

→ `{ "item_id": 54323, "revision": 0 }`. A later run of the same flow finds it (200) and PUTs instead — no duplicate. This is the safe pattern for any sync/retry.

---

### Example 3: Status transition (category flip)

App's "status" field (`60048455`) maps option `1`=Open, `2`=Won. Move an item to Won:

```http
PUT /item/12345
Content-Type: application/json

{ "fields": { "status": [2] } }
```

```json
{ "revision": 5, "title": "Acme renewal" }
```

There's no platform state machine — any option-to-option transition is legal. The app builder's "status" is just a category field.

---

## Gotchas & Counter-Exceptions

1. **Write `fields` is an OBJECT keyed by `external_id`/`field_id`; read `fields` is an ARRAY.** Different shapes — don't round-trip a read body into a write.
2. **No bulk write.** Create/update are one item per call. A 500-row import = 500 POSTs against the 1000/hr pool. Warn the user and pace the loop.
3. **No native upsert / idempotency header.** Use `external_id` lookup-then-create/update (Pattern 3).
4. **PUT is partial; `[]` clears a field.** Omitting a field leaves it; sending `[]` (or `null` for some types) clears it. Don't send a full read body or you may clobber/clear fields unintentionally.
5. **Datetimes are bare UTC.** `"2026-12-31 00:00:00"` — never `...Z` or `...+10:00`.
6. **Category writes use option IDs, not labels.** `"status": [1]`, not `"status": ["Open"]`. Resolve IDs from `app.fields[].config.settings.options`.
7. **Numbers as numbers, IDs as integers.** `{value: 50000}` not `{value: "50000"}`.
8. **`silent`/`hook` query params** ride on the URL, not the body. `POST /item/app/500600/?silent=true`.
9. **File attach is two steps and out of scope here.** Upload (`POST /file/`, multipart) then attach via `file_ids` — multipart isn't supported by the JSON-only request path (v2).

---

## Dangerous Operations

> Confirm with the user before executing.

| Operation                                        | Why dangerous                                                      | Safeguard                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Delete item(s)                                   | Soft delete — recoverable only for a window, then gone             | Confirm count; show a sample; ask if "set status to closed" fits instead                       |
| Bulk create/update loop                          | No bulk API → many calls; can exhaust the 1000/hr (or 250/hr) pool | State the call count; pace the loop; offer `silent=true` to avoid notification spam            |
| Bulk delete by IDs                               | Removes many items at once [INFERRED endpoint]                     | Echo the full `item_ids` list back for confirmation                                            |
| Writing with `hook=true` during a mass back-load | Fires every downstream webhook/automation per item                 | Suggest `hook=false`/`silent=true` for back-loads the user doesn't want to trigger automations |
| Clearing a field (`[]`)                          | Silently wipes data with no undo                                   | Confirm intent; distinguish "clear" from "leave unchanged"                                     |

---

_Generated from `00-api-investigation-questionnaire.md` Phases 3 and 4._
