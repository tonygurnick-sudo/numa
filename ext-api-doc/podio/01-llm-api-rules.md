---
api_name: 'Podio'
api_slug: 'podio'
version: 'unversioned core API (OAuth token is /v2)'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
line_count_target: '< 300 lines'
---

# Podio -- Workspace Agent API Rules

> Loaded into the workspace agent's context when the Podio integration is active.
> Companion files (01a–01d) carry the detailed reference. Keep this one ≤300 lines.
> Markers: [DOCUMENTED] from official docs, [INFERRED], [UNKNOWN]. No [CONFIRMED] yet —
> the Phase-2 live-call gate has not been run. Treat everything as DOCUMENTED-not-verified.

## Context

- **API:** Podio API (REST, JSON). Core API is **unversioned** — no `/v1` path. Only the OAuth token endpoint is versioned (`/oauth/token/v2`).
- **Base URL:** `https://api.podio.com`
- **Auth:** OAuth 2.0 (`authorization_code` + `refresh_token`). Header scheme is `OAuth2`, **NOT `Bearer`**.
- **Integration path:** Direct API Only — all interactions through `connect_request`.
- **Rate model:** 1,000 calls/hr general pool; **250 calls/hr** heavy ("Rate limited") pool. Exceeded → HTTP **420** (not 429). See 01d.

## Auth Structure

OAuth 2.0 via the `Authorization` header.

```
Authorization: OAuth2 {access_token}
```

The scheme word is literally `OAuth2`. Using `Bearer` returns 401. [DOCUMENTED]

**Token lifecycle:**

- Access token lives **8 hours** (`expires_in` = 28800; treat `expires_in` as authoritative). [DOCUMENTED]
- Refresh token lives **28 days**. A refresh **issues a new access token AND a new refresh token** — the connector must persist the rotated `refresh_token` on every refresh or it locks out after 28 days. [DOCUMENTED — rotation INFERRED, verify on first live refresh]
- Token exchange/refresh POSTs (form-urlencoded) to `https://api.podio.com/oauth/token/v2`. ⚠️ The connector registry currently sets `tokenUrl: 'https://podio.com/oauth/token'` — the documented endpoint is `api.podio.com/oauth/token/v2`. If the backend honours the registry value, watch for token-exchange failures and flag the registry. [DOCUMENTED — discrepancy]

## Capabilities

### CAN

1. Walk the hierarchy: list orgs (`GET /org/`), spaces (`GET /org/{org_id}/space/`), apps (`GET /space/{space_id}/app/`).
2. **Discover an app's schema** (`GET /app/{app_id}`) → every field's `field_id`, `external_id`, `type`, required-ness, and category option IDs. Mandatory before any item read/write.
3. Filter / list / count items in an app with sort + offset pagination (`POST /item/app/{app_id}/filter`, `/count`).
4. Get one item (`GET /item/{item_id}`) or resolve by your own key (`GET /item/app/{app_id}/external_id/{external_id}`).
5. Create / update / delete items — one at a time — using type-correct write shapes (see 01c + 01a §Field Format).
6. Add comments to items (`POST /comment/item/{item_id}/`); create tasks (`POST /task/`).

### CANNOT

1. **Upload/attach files** — `connect_request` is JSON-only; files need a multipart handler. Ask the user to attach in the Podio UI. (v2 capability.)
2. **Bulk create/update** — Podio has NO bulk write API. Writes are per-item loops, and each filter/write burns the 250/hr or 1000/hr pool. Warn the user before mass operations.
3. **Cross-field OR queries** — the filter API ANDs all keys. For OR, run multiple requests and merge client-side.
4. **Register webhooks** on the user's behalf — needs a Numa-hosted public endpoint + the verify handshake (01d).
5. **Assume field IDs/types** — the schema is per-app and tenant-defined. Never hardcode.

## Critical Gotchas

> Things that will cause errors if you get them wrong.

1. **Header is `OAuth2`, not `Bearer`.** `Authorization: OAuth2 {token}`. Wrong scheme → 401 `unauthorized`. [DOCUMENTED]
2. **Discovery-first (like Dataverse).** There is no global "Lead"/"Deal" entity — each App defines its own fields. Always `GET /app/{app_id}` to learn `field_id`/`external_id`/`type`/options BEFORE building any item read filter or write body. [DOCUMENTED]
3. **Datetimes are bare UTC: `YYYY-MM-DD HH:MM:SS`** — no `Z`, no offset. Dates are `YYYY-MM-DD`. A `Z` or `+10:00` suffix → `invalid_value`. [DOCUMENTED]
4. **Types must be native JSON.** IDs/numbers as JSON integers (not strings), booleans as real bools. Strings where numbers belong → type error. [DOCUMENTED]
5. **Filters are keyed by `field_id` (int), not field name.** Value shape is type-specific: category → `[optionId,…]`; number/date → `{from,to}`; text → substring; app-ref → `[itemId,…]`. Get IDs from `GET /app/{app_id}`. [DOCUMENTED]
6. **Write `fields` is an OBJECT keyed by `external_id` (preferred) or `field_id`** — `{ "status": [1], "amount": {value: 50000, currency: "USD"} }`. Read `fields` is an ARRAY of `{field_id, type, values:[…]}`. The read shape and write shape differ — don't echo a read body back as a write. [DOCUMENTED]
7. **Filter is a HEAVY op.** `POST .../filter`, `/count`, and search count against the **250/hr** pool, not the 1000/hr pool. Page with `limit:100` (not the default 30) to minimise calls. [DOCUMENTED]
8. **Rate-limit status is `420`, not `429`.** Honour `Retry-After`. [DOCUMENTED]
9. **No bulk write, no idempotency header.** Make create idempotent by setting a stable `external_id` and doing a `GET .../external_id/{id}` lookup-then-create-or-update. [DOCUMENTED]
10. **PUT is partial.** Only fields in the body change; omitted fields are untouched; sending an empty array `[]` for a field clears it. [DOCUMENTED]

## Default Parameters

| Parameter                | Default                          | Reason                                                      |
| ------------------------ | -------------------------------- | ----------------------------------------------------------- |
| `limit`                  | 100                              | Per-call max; minimise calls against the 250/hr heavy pool. |
| `offset`                 | 0                                | Start of result set.                                        |
| `sort_by` / `sort_desc`  | `last_edit_on` / `true`          | Freshest-first matches user expectation.                    |
| `silent` (create/update) | `false`                          | Preserve stream notifications unless told otherwise.        |
| `hook` (create/update)   | `true`                           | Preserve webhook parity with the UI.                        |
| schema fetch             | always `GET /app/{app_id}` first | Dynamic schema — never assume field IDs/types.              |

## Working Examples

### Example 1: Identity / liveness check (first call after auth)

```http
GET /user/status HTTP/1.1
Host: api.podio.com
Authorization: OAuth2 {access_token}
```

```json
{
  "user": { "user_id": 123456, "mail": "user@example.com", "status": "active", "timezone": "UTC" },
  "profile": { "profile_id": 654321, "name": "Jane Smith", "org_id": 100200 }
}
```

Alternative cheap call to anchor discovery: `GET /org/` (lists the user's orgs + embedded spaces).

### Example 2: Discover an app's schema (do this BEFORE reading/writing items)

```http
GET /app/500600
```

```json
{
  "app_id": 500600,
  "config": { "name": "Leads", "item_name": "Lead" },
  "fields": [
    { "field_id": 60048450, "external_id": "title", "type": "text", "config": { "label": "Title", "required": true } },
    {
      "field_id": 60048455,
      "external_id": "status",
      "type": "category",
      "config": {
        "label": "Status",
        "settings": {
          "options": [
            { "id": 1, "text": "Open" },
            { "id": 2, "text": "Won" }
          ]
        }
      }
    },
    { "field_id": 60048460, "external_id": "amount", "type": "money", "config": { "label": "Amount" } }
  ]
}
```

Cache `external_id → {field_id, type, options}` for this app, then build filters/writes against it.

### Example 3: Filter items (the primary read — HEAVY op)

```http
POST /item/app/500600/filter
Content-Type: application/json

{ "sort_by": "last_edit_on", "sort_desc": true,
  "filters": { "60048455": [1] }, "limit": 100, "offset": 0 }
```

```json
{
  "total": 482,
  "filtered": 45,
  "items": [
    {
      "item_id": 12345,
      "external_id": "EXT-2024-001",
      "title": "Project Alpha",
      "revision": 3,
      "created_on": "2026-05-15 10:30:00",
      "fields": [
        {
          "field_id": 60048455,
          "external_id": "status",
          "type": "category",
          "values": [{ "value": { "id": 1, "text": "Open" } }]
        },
        {
          "field_id": 60048460,
          "external_id": "amount",
          "type": "money",
          "values": [{ "value": "50000.00", "currency": "USD" }]
        }
      ]
    }
  ]
}
```

`total` = all items in app; `filtered` = items matching the filter (use it for the paging bound).

### Example 4: Create an item (idempotent via external_id)

```http
POST /item/app/500600/
Content-Type: application/json

{
  "external_id": "EXT-2024-001",
  "fields": {
    "title": "Project Alpha",
    "status": [1],
    "amount": { "value": 50000, "currency": "USD" },
    "due_date": { "start": "2026-12-31 00:00:00" }
  },
  "tags": ["urgent"]
}
```

```json
{
  "item_id": 54321,
  "title": "Project Alpha",
  "revision": 0,
  "link": "https://podio.com/acme/sales-team/apps/leads/items/54321"
}
```

`fields` is keyed by `external_id` (preferred) or `field_id`; each value uses the type-specific WRITE shape (01a §Field Format). For true idempotency, `GET /item/app/500600/external_id/EXT-2024-001` first and PUT if it exists.

### Example 5: Update an item (partial)

```http
PUT /item/12345
Content-Type: application/json

{ "fields": { "status": [2] } }
```

```json
{ "revision": 4, "title": "Project Alpha" }
```

Only `status` changes; all other fields untouched. Returns the new `revision`.

## Proxy API Operations

| Operation        | Method | Path                                           | Key params                                | Notes                                |
| ---------------- | ------ | ---------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| Identity check   | GET    | `/user/status`                                 | —                                         | Cheap liveness / auth check          |
| List orgs        | GET    | `/org/`                                        | —                                         | Top of hierarchy (+ embedded spaces) |
| List spaces      | GET    | `/org/{org_id}/space/`                         | —                                         |                                      |
| List apps        | GET    | `/space/{space_id}/app/`                       | —                                         |                                      |
| **App schema**   | GET    | `/app/{app_id}`                                | `fields` (view)                           | **Discovery — call FIRST**           |
| Filter items     | POST   | `/item/app/{app_id}/filter`                    | `filters`, `sort_by`, `limit`, `offset`   | **HEAVY (250/hr)**                   |
| Count items      | POST   | `/item/app/{app_id}/count`                     | `filters`                                 | HEAVY                                |
| Get item         | GET    | `/item/{item_id}`                              | —                                         | Full field values                    |
| Get by external  | GET    | `/item/app/{app_id}/external_id/{external_id}` | —                                         | Dedupe / upsert lookup               |
| Create item      | POST   | `/item/app/{app_id}/`                          | body `{fields, tags, …}`; `silent`,`hook` | One item per call; not idempotent    |
| Update item      | PUT    | `/item/{item_id}`                              | body `{fields, …}`                        | Partial; returns new `revision`      |
| Update one field | PUT    | `/item/{item_id}/value/{field_id}`             | values array                              | Single-field write                   |
| Delete item      | DELETE | `/item/{item_id}`                              | —                                         | Soft delete (recoverable window)     |
| Add comment      | POST   | `/comment/item/{item_id}/`                     | `{value}`                                 | `ref_type` also `task`/etc.          |
| Create task      | POST   | `/task/`                                       | `{text, due_date, responsible, …}`        |                                      |
| Token exchange   | POST   | `/oauth/token/v2`                              | form-urlencoded                           | Backend-only; no auth header         |

## Pagination

- **Type:** offset-based (`limit` + `offset`) in the filter body. [DOCUMENTED]
- **Default page size:** 30. **Max:** treat **100** as the per-call ceiling (page with `offset`).
- **How to paginate:**

```http
POST /item/app/500600/filter   { "limit": 100, "offset": 0 }    → { filtered: 250, items: [100] }
POST /item/app/500600/filter   { "limit": 100, "offset": 100 }  → { filtered: 250, items: [100] }
POST /item/app/500600/filter   { "limit": 100, "offset": 200 }  → { filtered: 250, items: [50] }  // last
```

- **Last page detection:** `offset + items.length >= filtered`, OR `items.length < limit`.
- Each page is a HEAVY call — keep `limit:100` and prefer incremental `last_edit_on` filters over full sweeps.

## Webhooks / Events

Podio has a **Hooks API** (`POST /hook/{ref_type}/{ref_id}/`, ref_type = `app`/`space`/`app_field`), but Numa does **not** yet host a verifiable public receiver for this connector — so registration is out of scope from chat. If the user asks about real-time events, it's polling-only for now.

| Event         | Trigger               | Key payload fields (IDs only — re-fetch the item) |
| ------------- | --------------------- | ------------------------------------------------- |
| `hook.verify` | Once at creation      | `type`, `code`, `hook_id`                         |
| `item.create` | Item created in scope | `type`, `item_id`, `item_revision_id`             |
| `item.update` | Item updated          | `type`, `item_id`, `item_revision_id`             |
| `item.delete` | Item deleted          | `type`, `item_id`                                 |

Setup needs a 2-step verify handshake (Podio POSTs a `code`; you call `POST /hook/{hook_id}/verify/validate`). Payloads are **unsigned** (no HMAC) and carry IDs only. See 01d. **Polling fallback:** `POST /item/app/{app_id}/filter` sorted/filtered by `last_edit_on` every 15–30 min (heavy op — don't poll aggressively).

## Error Handling

**Standard error format:**

```json
{
  "error": "not_found",
  "error_description": "Item with id 99999 could not be found",
  "error_detail": null,
  "error_propagate": false,
  "request": { "url": "https://api.podio.com/item/99999", "method": "GET" }
}
```

`error` is a short machine code (`not_found`, `unauthorized`, `invalid_value`, `forbidden`, `rate_limit`, `server_error`); `error_description` is user-safe — surface it verbatim, don't paraphrase.

**Recovery by status:**

| Status | Meaning                           | Action                                                                   |
| ------ | --------------------------------- | ------------------------------------------------------------------------ |
| 400    | `invalid_value` / `invalid_grant` | Fix body; re-check field types via `GET /app/{app_id}`                   |
| 401    | `unauthorized` / `expired`        | Refresh token (rotate stored refresh_token); retry once; else re-consent |
| 403    | `forbidden`                       | Check space/app membership                                               |
| 404    | `not_found`                       | Verify `item_id` / `app_id`                                              |
| 409    | `conflict`                        | Re-read and retry                                                        |
| 420    | `rate_limit` (Podio)              | Wait `Retry-After`, then retry; prefer wider pages                       |
| 5xx    | `server_error`                    | Retry with exponential backoff (base 2s, cap 60s, jitter)                |

## Known Limitations

1. **Dynamic per-app schema** — no static field map; `GET /app/{app_id}` first, every time.
2. **No bulk write** and **no idempotency header** — per-item loops; use `external_id` lookup-then-create for dedupe.
3. **AND-only filters**, single sort key, no sparse fieldsets on item reads.
4. **Heavy-op cap of 250/hr** dominates any sync — filter/count/search all draw from it.
5. **Webhooks are unsigned** (IDs only) and not yet wired in Numa; file upload is JSON-path-incompatible (v2).
6. **Registry `tokenUrl` discrepancy** (`podio.com/oauth/token` vs documented `api.podio.com/oauth/token/v2`) — verify on first live connect.

---

_Companions:_

- _01a-domain-model-reference.md — Hierarchy (Org/Space/App/Item), dynamic field-type value shapes, state machines_
- _01b-query-patterns.md — Filter body, AND-only filters, offset pagination, count, search_
- _01c-mutation-patterns.md — Create/update/delete, type-specific write shapes, external_id idempotency_
- _01d-event-and-error-handling.md — Hooks verify handshake, error JSON, 420/Retry-After, rate caps_
