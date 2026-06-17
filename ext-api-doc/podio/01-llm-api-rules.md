---
api_name: Podio
api_slug: podio
base_url: https://api.podio.com
path_construction: pass FLAT paths verbatim (e.g. /item/12345). Connector prepends nothing.
path_version_segment: NONE — core API is unversioned. /v1 does NOT exist. ONLY versioned path is /oauth/token/v2 (backend-only token exchange, never an agent call).
auth: OAuth2 {access_token} — literal scheme word is "OAuth2", NOT "Bearer". Bearer → 401.
field_casing: snake_case
id_format: integer (JSON int, never a string)
rate_limit: 1000/hr general pool; 250/hr HEAVY pool (filter, count, search). Exceeded → HTTP 420 (NOT 429), Retry-After header.
call_surface: HTTP via `connect_request` (JSON only). NOT file-browse (no list-files/download-file). NOT MCP. File upload (multipart) is unsupported — v2.
integration_path: Direct API Only
confidence: every fact is [DOCUMENTED] (developers.podio.com, 2026-05-29) — NOT yet live-confirmed. Inline markers only for [INFERRED].
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Podio — API Rules

## Paths (read first)

- Base `https://api.podio.com`. Pass FLAT paths exactly: `/item/12345`, `/app/{app_id}`. Connector adds nothing.
- NO version segment. Core API is unversioned — `/v1/...` → 404. The only `/v2` is `/oauth/token/v2` (backend token exchange; never an agent call).
- Surface = HTTP JSON via `connect_request`. No file-browse, no MCP. Multipart file upload unsupported (v2).

## Auth

`Authorization: OAuth2 {access_token}` — literal `OAuth2`, NOT `Bearer`. `Bearer` → 401 `unauthorized`.

- Access token: 8h (`expires_in`=28800, authoritative). Refresh token: 28 days.
- Refresh ROTATES: each refresh issues a NEW access token AND a NEW refresh token — persist the rotated `refresh_token` every time or lock out after 28 days. [rotation INFERRED, verify on first live refresh]
- Token exchange/refresh: `POST /oauth/token/v2` (form-urlencoded, no auth header) — backend-only.

## CAN

Walk hierarchy: list orgs (`GET /org/`), spaces (`GET /org/{org_id}/space/`), apps (`GET /space/{space_id}/app/`). Discover an app's schema (`GET /app/{app_id}`) → every field's `field_id`, `external_id`, `type`, required-ness, category option IDs. Filter/list/count items (`POST /item/app/{app_id}/filter`, `/count`). Get one item (`GET /item/{item_id}`) or by your key (`GET /item/app/{app_id}/external_id/{external_id}`). Create/update/delete items one at a time with type-correct write shapes (01c, 01a §Field Format). Add comments (`POST /comment/item/{item_id}/`); create tasks (`POST /task/`).

## CANNOT

Upload/attach files (`connect_request` is JSON-only; multipart needed — ask user to attach in Podio UI; v2). Bulk create/update (NO bulk write API — per-item loops, each burns the pool). Cross-field OR (filter ANDs all keys — run multiple requests, merge client-side). Register webhooks on the user's behalf (needs a Numa-hosted public receiver + verify handshake — 01d; polling-only for now). Assume field IDs/types (per-app, tenant-defined — never hardcode).

## Critical Gotchas

1. **Header is `OAuth2`, not `Bearer`.** Wrong scheme → 401 `unauthorized`.
2. **Discovery-first (like Dataverse).** No global "Lead"/"Deal" entity — each App defines its own fields. `GET /app/{app_id}` to learn `field_id`/`external_id`/`type`/options BEFORE any item filter or write.
3. **Datetimes are bare UTC `YYYY-MM-DD HH:MM:SS`** — no `Z`, no offset. Dates `YYYY-MM-DD`. A `Z`/`+10:00` suffix → `invalid_value`.
4. **Native JSON types.** IDs/numbers as JSON integers/numbers (not strings); booleans as real bools. String where number belongs → type error.
5. **Filters keyed by `field_id` (int), NOT name.** Value shape is type-specific: category → `[optionId,…]`; number/date → `{from,to}`; text → substring; app-ref → `[itemId,…]`. IDs from `GET /app/{app_id}`.
6. **Write `fields` is an OBJECT keyed by `external_id` (preferred) or `field_id`** — `{"status":[1],"amount":{"value":50000,"currency":"USD"}}`. Read `fields` is an ARRAY of `{field_id,type,values:[…]}`. Read shape ≠ write shape — don't echo a read body back as a write.
7. **Filter is HEAVY.** `POST .../filter`, `/count`, search count against the **250/hr** pool, not 1000/hr. Page with `limit:100` (not default 30).
8. **Rate-limit status is `420`, not `429`.** Honour `Retry-After`.
9. **No bulk write, no idempotency header.** Make create idempotent: set a stable `external_id`, do `GET .../external_id/{id}` lookup-then-create-or-update.
10. **PUT is partial.** Only body fields change; omitted untouched; an empty array `[]` clears a field.

## Defaults (override only if the user specifies)

`limit=100` (minimise heavy-pool calls), `offset=0`, `sort_by=last_edit_on`, `sort_desc=true`, `silent=false` (preserve notifications), `hook=true` (UI webhook parity). Always `GET /app/{app_id}` first — never assume field IDs/types.

## Operations

| Operation        | Method | Path                                         | Key params / notes                                                             |
| ---------------- | ------ | -------------------------------------------- | ------------------------------------------------------------------------------ |
| Identity check   | GET    | /user/status                                 | cheap liveness / auth check                                                    |
| List orgs        | GET    | /org/                                        | top of hierarchy (+ embedded spaces)                                           |
| List spaces      | GET    | /org/{org_id}/space/                         | —                                                                              |
| List apps        | GET    | /space/{space_id}/app/                       | —                                                                              |
| **App schema**   | GET    | /app/{app_id}                                | **discovery — call FIRST**                                                     |
| Filter items     | POST   | /item/app/{app_id}/filter                    | `filters`,`sort_by`,`limit`,`offset`; **HEAVY (250/hr)**                       |
| Count items      | POST   | /item/app/{app_id}/count                     | `filters`; HEAVY                                                               |
| Get item         | GET    | /item/{item_id}                              | full field values                                                              |
| Get by external  | GET    | /item/app/{app_id}/external_id/{external_id} | dedupe / upsert lookup                                                         |
| Create item      | POST   | /item/app/{app_id}/                          | body `{fields,tags,…}`; `silent`,`hook` query params; one/call; not idempotent |
| Update item      | PUT    | /item/{item_id}                              | body `{fields,…}`; partial; returns new `revision`                             |
| Update one field | PUT    | /item/{item_id}/value/{field_id}             | values array; single-field write                                               |
| Delete item      | DELETE | /item/{item_id}                              | soft delete (recoverable window)                                               |
| Add comment      | POST   | /comment/item/{item_id}/                     | `{value}`                                                                      |
| Create task      | POST   | /task/                                       | `{text,due_date,responsible,…}`                                                |
| Token exchange   | POST   | /oauth/token/v2                              | form-urlencoded; backend-only; no auth header                                  |

## Pagination

Offset-based (`limit`+`offset`) in the filter body. Default 30; treat **100** as per-call ceiling. Response carries `total` (all items in app) and `filtered` (matching the filter) — loop against **`filtered`**.

```
POST /item/app/500600/filter {"limit":100,"offset":0}    → {filtered:250, items:[100]}
POST /item/app/500600/filter {"limit":100,"offset":100}  → {filtered:250, items:[100]}
POST /item/app/500600/filter {"limit":100,"offset":200}  → {filtered:250, items:[50]}  // last
```

Last page when `offset + items.length >= filtered` OR `items.length < limit`. Each page is a HEAVY call — keep `limit:100`, prefer incremental `last_edit_on` filters over full sweeps.

## Webhooks / Events

Podio has a Hooks API (`POST /hook/{ref_type}/{ref_id}/`, ref_type = `app`/`space`/`app_field`), but Numa does NOT yet host a verifiable public receiver — registration is out of scope from chat. Polling-only for now. Setup needs a 2-step verify handshake (Podio POSTs a `code`; you `POST /hook/{hook_id}/verify/validate`). Payloads are **unsigned** (no HMAC) and carry IDs only — re-fetch the item. See 01d. Polling fallback: `POST /item/app/{app_id}/filter` sorted/filtered by `last_edit_on` every 15–30 min (heavy op — don't poll aggressively). Events: `hook.verify`(code,hook_id), `item.create`/`item.update`(item_id,item_revision_id), `item.delete`(item_id).

## Error Handling

Format: `{"error":"not_found","error_description":"Item with id 99999 could not be found","error_detail":null,"error_propagate":false,"request":{"url":"https://api.podio.com/item/99999","method":"GET"}}`
`error` = short machine code (`not_found`,`unauthorized`,`invalid_value`,`invalid_grant`,`forbidden`,`rate_limit`,`conflict`,`server_error`); `error_description` is user-safe — surface verbatim, don't paraphrase.

| Status | error                           | Action                                                                   |
| ------ | ------------------------------- | ------------------------------------------------------------------------ |
| 400    | `invalid_value`/`invalid_grant` | Fix body; re-check field types via `GET /app/{app_id}`                   |
| 401    | `unauthorized`/`expired`        | Refresh token (rotate stored refresh_token); retry once; else re-consent |
| 403    | `forbidden`                     | Check space/app membership                                               |
| 404    | `not_found`                     | Verify `item_id`/`app_id`                                                |
| 409    | `conflict`                      | Re-read and retry                                                        |
| 420    | `rate_limit` (Podio, NOT 429)   | Wait `Retry-After`; widen pages; backoff                                 |
| 5xx    | `server_error`                  | Exponential backoff (base 2s, cap 60s, jitter)                           |

## Examples

### 1: Identity / liveness (first call after auth)

`GET /user/status` (header `Authorization: OAuth2 {access_token}`)
→ `{"user":{"user_id":123456,"mail":"user@example.com","status":"active","timezone":"UTC"},"profile":{"profile_id":654321,"name":"Jane Smith","org_id":100200}}`
Alternative cheap anchor: `GET /org/` (lists orgs + embedded spaces).

### 2: Discover schema (BEFORE reading/writing items)

`GET /app/500600`
→ `{"app_id":500600,"config":{"name":"Leads","item_name":"Lead"},"fields":[{"field_id":60048450,"external_id":"title","type":"text","config":{"label":"Title","required":true}},{"field_id":60048455,"external_id":"status","type":"category","config":{"label":"Status","settings":{"options":[{"id":1,"text":"Open"},{"id":2,"text":"Won"}]}}},{"field_id":60048460,"external_id":"amount","type":"money","config":{"label":"Amount"}}]}`
Cache `external_id → {field_id, type, options}` for the app, then build filters/writes against it.

### 3: Filter items (primary read — HEAVY op)

`POST /item/app/500600/filter` body `{"sort_by":"last_edit_on","sort_desc":true,"filters":{"60048455":[1]},"limit":100,"offset":0}`
→ `{"total":482,"filtered":45,"items":[{"item_id":12345,"external_id":"EXT-2024-001","title":"Project Alpha","revision":3,"created_on":"2026-05-15 10:30:00","fields":[{"field_id":60048455,"external_id":"status","type":"category","values":[{"value":{"id":1,"text":"Open"}}]},{"field_id":60048460,"external_id":"amount","type":"money","values":[{"value":"50000.00","currency":"USD"}]}]}]}`
`total` = all items in app; `filtered` = items matching (the paging bound).

### 4: Create an item (idempotent via external_id)

`POST /item/app/500600/` body `{"external_id":"EXT-2024-001","fields":{"title":"Project Alpha","status":[1],"amount":{"value":50000,"currency":"USD"},"due_date":{"start":"2026-12-31 00:00:00"}},"tags":["urgent"]}`
→ `{"item_id":54321,"title":"Project Alpha","revision":0,"link":"https://podio.com/acme/sales-team/apps/leads/items/54321"}`
`fields` keyed by `external_id` (preferred) or `field_id`; each value uses the type-specific WRITE shape (01a §Field Format). For true idempotency, `GET /item/app/500600/external_id/EXT-2024-001` first and PUT if it exists.

### 5: Update an item (partial)

`PUT /item/12345` body `{"fields":{"status":[2]}}`
→ `{"revision":4,"title":"Project Alpha"}`
Only `status` changes; all other fields untouched. Returns the new `revision`.
