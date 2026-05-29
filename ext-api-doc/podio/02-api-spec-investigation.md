---
api_name: 'Podio'
api_slug: 'podio'
base_url: 'https://api.podio.com'
version: 'unversioned core API (OAuth token endpoint is /v2)'
spec_format: 'none'
spec_url: ''
docs_url: 'https://developers.podio.com/'
date_researched: '2026-05-29'
---

# Podio -- API Specification & Investigation

> Developer-facing condensed reference. Everything needed to implement or extend the
> Podio integration, in one page. Derived from `00-api-investigation-questionnaire.md`.
>
> Confidence: **medium.** Every fact below is [DOCUMENTED] against Podio's official docs
> (developers.podio.com) but the first-live-call gate has NOT been run — no test OAuth
> client was available during research. Promote markers to [CONFIRMED] after a successful
> `GET /user/status` (or `GET /org/`) against a configured Podio app.

---

## Overview

- **Vendor:** Citrix Systems (Podio product)
- **API version:** Unversioned core API — there is **no `/v1` path**. The OAuth token endpoint is the only versioned path (`/oauth/token/v2`).
- **Base URL:** `https://api.podio.com`
- **Sandbox:** No separate host. Podio offers a per-app "sandbox" that supports **GET operations only**, on the same `api.podio.com` host.
- **API type:** REST
- **Data format:** JSON (writes); `application/x-www-form-urlencoded` for the OAuth token exchange; `multipart/form-data` for file uploads
- **Documentation:** [developers.podio.com](https://developers.podio.com/)
- **API reference:** [developers.podio.com/doc](https://developers.podio.com/doc) — left nav groups by area (Items, Applications, Organizations, Spaces, Hooks, Files, Tasks, Comments, Users)
- **OpenAPI spec:** Not published by Podio
- **Status page:** [status.podio.com](https://status.podio.com/)

**Summary:** Podio is a structured work-management and collaboration platform. The data model is a fixed four-level hierarchy — **Organization > Space > Application > Item** — but the **item schema is per-app and tenant-defined** (an App is a user-built "table"; its Items are the "rows"). There is no global "Lead" or "Deal" entity: each App declares its own fields. This makes Podio **discovery-first, like Microsoft Dataverse** — you must call `GET /app/{app_id}` to learn an app's fields (their `field_id`, `external_id`, `type`, options) before you can read or write items meaningfully. Podio is in maintenance mode under Citrix — the API is stable and effectively frozen (no changelog, no version bumps).

---

## Authentication

### Method: OAuth 2.0

Standard OAuth 2.0 `authorization_code` flow with `refresh_token` rotation. The wire protocol is RFC-6749-standard, but two things are Podio-specific:

1. **The API Authorization header scheme is `OAuth2`, NOT `Bearer`.** Using `Bearer` returns 401.
2. **The rate-limit-exceeded status is `420`, NOT `429`.**

**Header format:**

```
Authorization: OAuth2 {access_token}
```

> The literal scheme word is `OAuth2` (not `Bearer`, not `Zoho-oauthtoken`). Numa's backend handles this via the `authHeaderScheme` field on the connector registry entry — **set `authHeaderScheme: 'OAuth2'`** for this connector (the registry entry as written omits it; see `03-connector-setup.md`). [DOCUMENTED — verified against developers.podio.com/authentication]

### OAuth 2.0 Details

| Parameter         | Value                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Grant types       | `authorization_code` (the flow Numa uses), `refresh_token`; also `password`, `app` (unused)                           |
| Authorization URL | `https://podio.com/oauth/authorize`                                                                                   |
| Token URL         | `https://api.podio.com/oauth/token/v2` ⚠️ (registry says `podio.com/oauth/token` — see below)                         |
| Revocation URL    | **None documented.** Tokens expire naturally; an API client can be disabled in the Podio API console.                 |
| Access token TTL  | 8 hours (`expires_in` = 28800 — treat `expires_in` as authoritative)                                                  |
| Refresh token TTL | 28 days                                                                                                               |
| Refresh rotation  | **Yes** — a refresh issues a new access token AND a new refresh token; persist the rotated `refresh_token` every time |
| PKCE required     | No                                                                                                                    |
| State parameter   | Supported and recommended (CSRF); Numa's OAuth wizard sends `state`                                                   |
| Token exchange    | POST `application/x-www-form-urlencoded` to the Token URL                                                             |

> ⚠️ **Registry vs docs mismatch on `tokenUrl`.** The connector registry sets `tokenUrl: 'https://podio.com/oauth/token'`. Podio's documented token endpoint is `https://api.podio.com/oauth/token/v2`. Historically `podio.com/oauth/token` aliased to the v2 endpoint, but the documented endpoint is the safe one. Recommend correcting the registry `tokenUrl` to `https://api.podio.com/oauth/token/v2`. See `04-connection-and-reauth.md` §3. [DOCUMENTED — discrepancy verified 2026-05-29]

### Required Scopes

Podio's scope model is **coarse** — unlike Google/Zoho, most server-side integrations omit `scope` entirely, and the access token then carries the full permission set of the authenticating user as constrained by the API client's configuration.

| Scope               | Purpose                                               | Required for integration?                 |
| ------------------- | ----------------------------------------------------- | ----------------------------------------- |
| _(empty / omitted)_ | Token inherits the user's full granted permission set | Default — matches registry (`scopes: ''`) |

Numa's registry correctly leaves `scopes: ''` and `extraAuthParams: '{}'`. Granular per-area scopes are not the Podio norm. [DOCUMENTED]

---

## Endpoint Catalog

> ⚠️ **Discovery-first.** `GET /app/{app_id}` is the mandatory prerequisite for any item read/write — it returns each field's `field_id`, `external_id`, `type`, required-ness, and category option IDs. Never hardcode field IDs/types; the schema is per-app.

### Hierarchy / Discovery

| Method | Path                             | Purpose                              | Auth | Paginated | Idempotent |
| ------ | -------------------------------- | ------------------------------------ | ---- | --------- | ---------- |
| GET    | `/user/status`                   | Current user + profile (cheap check) | Yes  | No        | Yes        |
| GET    | `/org/`                          | List user's orgs (+ embedded spaces) | Yes  | No        | Yes        |
| GET    | `/org/{org_id}/space/`           | List spaces in an org                | Yes  | No        | Yes        |
| GET    | `/space/{space_id}`              | Get a space                          | Yes  | No        | Yes        |
| GET    | `/space/{space_id}/app/`         | List apps in a space                 | Yes  | No        | Yes        |
| GET    | `/app/{app_id}`                  | **Get app definition (schema)**      | Yes  | No        | Yes        |
| GET    | `/app/{app_id}/field/{field_id}` | Get one field definition             | Yes  | No        | Yes        |

### Items (the primary surface)

| Method | Path                                           | Purpose                          | Auth | Paginated              | Idempotent |
| ------ | ---------------------------------------------- | -------------------------------- | ---- | ---------------------- | ---------- |
| POST   | `/item/app/{app_id}/filter`                    | Filter / list items              | Yes  | Yes (`limit`/`offset`) | Yes (read) |
| POST   | `/item/app/{app_id}/filter/{view_id}`          | Filter by a saved view           | Yes  | Yes                    | Yes (read) |
| POST   | `/item/app/{app_id}/count`                     | Count items matching a filter    | Yes  | No                     | Yes (read) |
| GET    | `/item/{item_id}`                              | Get one item (full field values) | Yes  | No                     | Yes        |
| GET    | `/item/app/{app_id}/external_id/{external_id}` | Resolve item by your own key     | Yes  | No                     | Yes        |
| POST   | `/item/app/{app_id}/`                          | Create one item                  | Yes  | No                     | No\*       |
| PUT    | `/item/{item_id}`                              | Update item (partial)            | Yes  | No                     | Yes        |
| PUT    | `/item/{item_id}/value/{field_id}`             | Update a single field's values   | Yes  | No                     | Yes        |
| DELETE | `/item/{item_id}`                              | Delete item (soft)               | Yes  | No                     | Yes        |

\* Create is not idempotent — set a stable `external_id` and do a `GET .../external_id/{id}` lookup-then-create-or-update for idempotency (Podio's only dedupe primitive).

### Supporting

| Method | Path                              | Purpose                           | Auth | Notes                              |
| ------ | --------------------------------- | --------------------------------- | ---- | ---------------------------------- |
| POST   | `/comment/{ref_type}/{ref_id}/`   | Add a comment (ref_type=`item`…)  | Yes  |                                    |
| GET    | `/comment/{ref_type}/{ref_id}/`   | List comments                     | Yes  |                                    |
| POST   | `/task/`                          | Create a task                     | Yes  | `text`, `due_date`, `responsible`  |
| GET    | `/task/`                          | List tasks (filterable)           | Yes  | Paginated                          |
| POST   | `/file/`                          | Upload a file (multipart)         | Yes  | Attach via item `file_ids`         |
| GET    | `/file/{file_id}`                 | Get file metadata / download link | Yes  |                                    |
| POST   | `/hook/{ref_type}/{ref_id}/`      | Create a webhook                  | Yes  | ref_type=`app`/`space`/`app_field` |
| POST   | `/hook/{hook_id}/verify/validate` | Validate a hook with the code     | Yes  | Completes the verify handshake     |
| POST   | `/hook/{hook_id}/verify/request`  | Re-send the verify code           | Yes  |                                    |
| GET    | `/hook/{ref_type}/{ref_id}/`      | List hooks on an object           | Yes  |                                    |
| DELETE | `/hook/{hook_id}`                 | Delete a hook                     | Yes  |                                    |
| POST   | `/oauth/token/v2`                 | Token exchange / refresh          | No   | form-urlencoded; backend-only      |

### Full Endpoint Index

| #   | Method | Path                                           | Purpose                       | Notes                           |
| --- | ------ | ---------------------------------------------- | ----------------------------- | ------------------------------- |
| 1   | GET    | `/user/status`                                 | Current user (auth liveness)  | Phase-2 gate call               |
| 2   | GET    | `/org/`                                        | List orgs (+ embedded spaces) | Top of hierarchy                |
| 3   | GET    | `/org/{org_id}/space/`                         | List spaces in org            |                                 |
| 4   | GET    | `/space/{space_id}`                            | Get space                     |                                 |
| 5   | GET    | `/space/{space_id}/app/`                       | List apps in space            |                                 |
| 6   | GET    | `/app/{app_id}`                                | **App schema (discovery)**    | Call FIRST                      |
| 7   | GET    | `/app/{app_id}/field/{field_id}`               | One field definition          |                                 |
| 8   | POST   | `/item/app/{app_id}/filter`                    | Filter/list items             | **HEAVY (250/hr pool)**         |
| 9   | POST   | `/item/app/{app_id}/filter/{view_id}`          | Filter by saved view          | HEAVY                           |
| 10  | POST   | `/item/app/{app_id}/count`                     | Count items                   | HEAVY                           |
| 11  | GET    | `/item/{item_id}`                              | Get one item                  |                                 |
| 12  | GET    | `/item/app/{app_id}/external_id/{external_id}` | Resolve by external_id        | Dedupe / upsert lookup          |
| 13  | POST   | `/item/app/{app_id}/`                          | Create item                   | `silent`, `hook` query params   |
| 14  | PUT    | `/item/{item_id}`                              | Update item (partial)         | Returns new `revision`          |
| 15  | PUT    | `/item/{item_id}/value/{field_id}`             | Update one field              |                                 |
| 16  | DELETE | `/item/{item_id}`                              | Delete item (soft)            |                                 |
| 17  | POST   | `/comment/{ref_type}/{ref_id}/`                | Add comment                   |                                 |
| 18  | POST   | `/task/`                                       | Create task                   |                                 |
| 19  | POST   | `/file/`                                       | Upload file (multipart)       | Out of scope for JSON-only path |
| 20  | POST   | `/hook/{ref_type}/{ref_id}/`                   | Create webhook                | Verify handshake required       |
| 21  | POST   | `/oauth/token/v2`                              | Token exchange / refresh      | Backend-only                    |

---

## Data Models

> The hierarchy is fixed; the **item field set is per-app**. The tables below give the
> platform-fixed envelope fields. The per-app `fields[]` shape is discovered at runtime —
> see "Field Format Reference" below and `01a-domain-model-reference.md`.

### Organization (Org)

| Field    | Type    | Required | Writable | Description                  |
| -------- | ------- | -------- | -------- | ---------------------------- |
| `org_id` | integer | —        | no       | Org identifier               |
| `name`   | string  | —        | no       | Organization name            |
| `url`    | string  | —        | no       | Org URL slug                 |
| `status` | string  | —        | no       | `active` / `inactive`        |
| `spaces` | array   | —        | no       | Embedded spaces (when asked) |

### Space (Workspace)

| Field      | Type    | Required | Writable     | Description       |
| ---------- | ------- | -------- | ------------ | ----------------- |
| `space_id` | integer | —        | no           | Space identifier  |
| `name`     | string  | yes      | yes          | Workspace name    |
| `org_id`   | integer | yes      | yes (create) | Parent org        |
| `privacy`  | string  | no       | yes          | `open` / `closed` |

### Application (App) — the dynamic schema lives here

| Field      | Type    | Required | Writable | Description                                     |
| ---------- | ------- | -------- | -------- | ----------------------------------------------- |
| `app_id`   | integer | —        | no       | App identifier                                  |
| `status`   | string  | —        | no       | `active` / `inactive` / `deleted`               |
| `space_id` | integer | —        | no       | Parent space                                    |
| `config`   | object  | —        | no       | `{type, name, item_name, icon, external_id, …}` |
| `fields`   | array   | —        | partial  | Field **definitions** (the schema) — see below  |

**Field definition** (inside `app.fields[]`): `field_id` (int), `external_id` (string slug — the stable write key), `type` (text/number/date/category/app/contact/money/image/email/phone/embed/calculation/duration/progress/location/…), `status`, `config` (`{label, description, settings, required, …}`).

### Item — a record ("row") in an App

| Field         | Type          | Required | Writable     | Description                                         |
| ------------- | ------------- | -------- | ------------ | --------------------------------------------------- |
| `item_id`     | integer       | —        | no           | Record identifier                                   |
| `app`         | object        | —        | no           | `{app_id, config:{name, item_name}}`                |
| `external_id` | string        | no       | yes (create) | Caller-supplied key (dedupe / upsert)               |
| `title`       | string        | —        | no           | Derived from the app's "title" field                |
| `fields`      | array<object> | per-app  | yes          | Field values — shape depends on each field's `type` |
| `tags`        | array<string> | no       | yes          | Free-text tags                                      |
| `created_on`  | datetime      | —        | no           | UTC `YYYY-MM-DD HH:MM:SS`                           |
| `created_by`  | object        | —        | no           | `{type:"user", id, name}`                           |
| `link`        | string (url)  | —        | no           | Web URL to the item                                 |
| `rights`      | array<string> | —        | no           | Caller's permissions on the item                    |
| `revision`    | integer       | —        | no           | Current revision (increments per write)             |

**Relationships:** `Org 1:N Space 1:N App 1:N Item`. An App's `app`-type field makes **item-to-item references** across apps (the Podio equivalent of a lookup / foreign key). Items also carry Files (`file_ids`), Tasks, Comments, and Tags. Hooks attach to an App, a Space, or an App Field.

### Field Format Reference (the most error-prone part)

The item `fields` array contains one object per populated field: `{field_id, external_id, type, label, values:[…]}`. The `values` shape is **type-specific**, and the **read shape differs from the write shape**:

| Field `type`   | `values[]` shape (READ)                      | WRITE value                               | Notes                               |
| -------------- | -------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `text`         | `[{value: "..."}]`                           | `"plain or html string"`                  | `size` config (small/large)         |
| `number`       | `[{value: "123.45"}]`                        | `123.45`                                  | Read returns string; write a number |
| `money`        | `[{value: "100.00", currency: "USD"}]`       | `{value: 100.00, currency: "USD"}`        |                                     |
| `date`         | `[{start: "2026-05-29 09:00:00", end: …}]`   | `{start: "YYYY-MM-DD HH:MM:SS", end?: …}` | UTC; `end` optional                 |
| `category`     | `[{value: {id, text, color}}]`               | `[{category_id: 1}]` or `[1]`             | Single/multi per config; opt IDs    |
| `app`          | `[{value: {item_id, title, app}}]`           | `[{value: item_id}]` or `[item_id]`       | Item-to-item reference              |
| `contact`      | `[{value: {profile_id, name, …}}]`           | `[{value: profile_id}]` or `[profile_id]` | People picker                       |
| `email`        | `[{value: "a@b.com", type: "work"}]`         | `[{value, type}]`                         | Multi-value with sub-types          |
| `phone`        | `[{value: "+64…", type: "mobile"}]`          | `[{value, type}]`                         |                                     |
| `image`/`file` | `[{value: {file_id, link, mimetype, name}}]` | via `file_ids` on item (not in `fields`)  | Attach uploaded files               |
| `embed`        | `[{embed: {…}, file: {…}}]`                  | `{embed: embed_id}`                       | Link previews                       |
| `location`     | `[{value: "addr", lat, lng, …}]`             | `["formatted address"]`                   |                                     |
| `duration`     | `[{value: 3600}]`                            | `3600`                                    | Seconds                             |
| `progress`     | `[{value: 75}]`                              | `75`                                      | 0–100                               |
| `calculation`  | `[{value: …}]`                               | — (read-only)                             | Derived                             |

**Datetimes are bare UTC: `YYYY-MM-DD HH:MM:SS`** — no `Z`, no offset. Dates are `YYYY-MM-DD`. Numbers/IDs must be JSON integers (not strings); booleans must be real bools.

---

## Pagination

- **Type:** offset-based (`limit` + `offset`), supplied **in the filter request body** (not the query string)
- **Default page size:** 30
- **Max page size:** treat **100** as the per-call ceiling and page with `offset` (the docs' "up to 500" line describes the multi-request pattern, not a single-call max)
- **Total count:** yes — every filter response carries `total` (all items in the app) and `filtered` (items matching the filter); use `filtered` as the loop bound

### Parameters

| Parameter | Type | Default | Description           |
| --------- | ---- | ------- | --------------------- |
| `limit`   | int  | 30      | Items per page (≤100) |
| `offset`  | int  | 0       | Items to skip         |

### Response structure

```json
{
  "total": 482,
  "filtered": 120,
  "items": [
    /* up to `limit` items */
  ]
}
```

### Last page detection

`offset + items.length >= filtered`, OR `items.length < limit`.

> ⚠️ Every filter call is a **heavy (rate-limited) op** drawing from the 250/hr pool. Page with `limit:100` (not the default 30) to minimise calls; prefer incremental `last_edit_on` filters over full sweeps. There is **no bulk write** — create/update are one item per call.

---

## Rate Limits

**Per user, per API key, on a rolling 1-hour window.** [DOCUMENTED — verified against developers.podio.com/index/limits]

| Scope                      | Limit | Window | Notes                                                                                            |
| -------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------ |
| General API calls          | 1,000 | 1 hr   | Default pool                                                                                     |
| "Rate limited" (heavy) ops | 250   | 1 hr   | Ops marked "Rate limited" in the reference — incl. `/item/app/{app_id}/filter`, `/count`, search |

### Headers (returned on every response)

| Header                   | Meaning                                 |
| ------------------------ | --------------------------------------- |
| `X-Rate-Limit-Limit`     | Ceiling for the call you just made      |
| `X-Rate-Limit-Remaining` | Calls left in the current 1-hour window |

### When exceeded

HTTP **420** (Podio-specific — **NOT 429**), with `error: "rate_limit"` and a `Retry-After` header.

```json
{
  "error": "rate_limit",
  "error_description": "You have hit the rate limit. Please wait before trying again.",
  "error_detail": null,
  "request": { "url": "https://api.podio.com/item/app/500600/filter", "method": "POST" }
}
```

### Strategy

1. Honour `Retry-After`.
2. Otherwise exponential backoff with jitter (base 2s, cap 60s).
3. Because the heavy pool is only 250/hr, prefer wide pages (`limit:100`) and incremental `last_edit_on` filters over full sweeps.

---

## Error Handling

### Standard format

```json
{
  "error": "not_found",
  "error_description": "Item with id 99999 could not be found",
  "error_detail": null,
  "error_parameters": {},
  "error_propagate": false,
  "request": {
    "url": "https://api.podio.com/item/99999",
    "query_string": "",
    "method": "GET"
  }
}
```

`error` is a short machine code (`not_found`, `unauthorized`, `invalid_value`, `invalid_grant`, `forbidden`, `rate_limit`, `server_error`); `error_description` is user-safe — surface it verbatim. `error_propagate` is a UI hint; `request` echoes the failing call.

### Status codes

| Status | Common `error`                             | Meaning               | Retryable | Recovery                                               |
| ------ | ------------------------------------------ | --------------------- | --------- | ------------------------------------------------------ |
| 200    | —                                          | Success               | —         | —                                                      |
| 201    | —                                          | Created               | —         | —                                                      |
| 204    | —                                          | No content            | —         | Treat as success / empty                               |
| 400    | `invalid_value`, `invalid_grant`           | Bad request / body    | No        | Fix body; re-check field types via `GET /app/{id}`     |
| 401    | `unauthorized`, `invalid_token`, `expired` | Token invalid/expired | Yes       | Refresh token (rotate stored refresh); else re-consent |
| 403    | `forbidden`                                | No permission         | No        | Check space/app membership                             |
| 404    | `not_found`                                | Resource missing      | No        | Verify `item_id` / `app_id`                            |
| 409    | `conflict`                                 | Conflict              | Maybe     | Re-read and retry                                      |
| 410    | `gone`                                     | Deleted               | No        | —                                                      |
| 420    | `rate_limit`                               | Rate limited (Podio)  | Yes       | Backoff per `Retry-After`                              |
| 5xx    | `server_error`                             | Server error          | Yes       | Retry with backoff                                     |

> ⚠️ Podio returns **420** for rate limiting, not 429. The standard `422` validation-error status is **not** used — field-level write failures come back as **400 `invalid_value`** with an `error_detail` describing the offending field (e.g. `{ "field": "due_date", "expected": "YYYY-MM-DD HH:MM:SS" }`). [DOCUMENTED — `error_detail` contents partly INFERRED from SDK behaviour]

Full reference: `01d-event-and-error-handling.md` § Error Handling.

---

## Webhooks / Events

**Supported** via the Hooks API: `POST /hook/{ref_type}/{ref_id}/` (ref_type = `app` / `space` / `app_field`).

**Verification handshake (mandatory):** On create the hook is `inactive`. Podio immediately POSTs a `type=hook.verify` notification carrying a `code`. Your endpoint must capture it and call `POST /hook/{hook_id}/verify/validate` with `{ "code": "..." }`; only then does the hook become `active`. `POST /hook/{hook_id}/verify/request` re-sends the code.

| Event            | Trigger               | Payload keys (IDs only — re-fetch the item) |
| ---------------- | --------------------- | ------------------------------------------- |
| `hook.verify`    | Once at creation      | `type`, `code`, `hook_id`                   |
| `item.create`    | Item created in scope | `type`, `item_id`, `item_revision_id`       |
| `item.update`    | Item updated          | `type`, `item_id`, `item_revision_id`       |
| `item.delete`    | Item deleted          | `type`, `item_id`                           |
| `comment.create` | Comment added         | `type`, `comment_id`, ref ids               |
| `file.change`    | File attached/changed | `type`, `file_id`                           |

**Payload format** (Podio → your endpoint): `application/x-www-form-urlencoded`, **IDs only — not the full record**. Re-fetch `GET /item/{item_id}` for details.

**Verification / security:** Podio does **NOT** HMAC-sign webhook payloads. The verify handshake only proves you own the URL; inbound events are unsigned and spoofable. Mitigate with an unguessable URL path and by re-fetching the (auth-gated) referenced item before acting.

**Reliability:** Podio retries failed (non-2xx) deliveries (schedule undocumented); ordering is best-effort; duplicates possible — dedupe on `item_revision_id`.

**Numa status:** Numa does not yet host a verifiable public receiver for this connector. **Webhook registration is out of scope from chat** — use polling. Polling fallback: `POST /item/app/{app_id}/filter` sorted/filtered by `last_edit_on` desc every 15–30 min (heavy op — don't poll aggressively).

---

## Known Limitations

1. **Dynamic per-app schema (discovery-first, like Dataverse).** No static field map — `GET /app/{app_id}` before every item read/write. This is the dominant runtime gotcha.
2. **No bulk write API.** Create/update are one item per call; mass operations are loops that burn the rate-limit pool. Warn the user before mass operations.
3. **No idempotency header.** Make create effectively idempotent with a stable `external_id` + `GET .../external_id/{id}` lookup-then-create-or-update (Podio's only dedupe primitive).
4. **Filters are AND-only.** Multiple `filters` keys are ANDed; there is no cross-field OR in a single request — issue multiple requests and merge client-side.
5. **Heavy-op cap of 250/hr** dominates any sync — filter / count / search all draw from it.
6. **Header scheme is `OAuth2`, not `Bearer`**, and rate-limit status is **`420`, not `429`** — both trip up generic clients.
7. **Webhooks are unsigned** (no HMAC) and carry IDs only; **file upload is multipart** (incompatible with a JSON-only `connect_request` path — flag as a v2 capability).
8. **Registry `tokenUrl` discrepancy** (`podio.com/oauth/token` vs documented `api.podio.com/oauth/token/v2`) — verify and correct on first live connect.
9. **No OpenAPI/Swagger spec** and no changelog; the API is in maintenance mode (effectively frozen).
10. **Item reads have no sparse fieldsets** — a returned item always carries all its populated fields; single sort key only.

---

## SDKs & Tooling

| SDK          | Language    | Repository                             | Quality | Notes                                                              |
| ------------ | ----------- | -------------------------------------- | ------- | ------------------------------------------------------------------ |
| podio-py     | Python      | github.com/podio/podio-py              | fair    | Community / stale. Numa uses raw httpx via `connect_request`.      |
| podio-php    | PHP         | github.com/podio/podio-php             | good    | Community-maintained; useful for field write shapes + verify flow. |
| podio-js     | JS/Node     | github.com/podio/podio-js (PlatformJS) | good    | Good for confirming rate-limit header names + request signing.     |
| podio-rb     | Ruby        | github.com/podio/podio-rb              | fair    | Reference only.                                                    |
| podio-dotnet | .NET        | github.com/podio/podio-dotnet          | fair    | Reference only.                                                    |
| podio-objc   | Objective-C | github.com/podio/podio-objc (PodioKit) | fair    | Reference only.                                                    |

**Postman collection:** No official collection (community collections exist on the Postman public network).
**OpenAPI spec:** Not published.

> SDKs are reference material only — Numa drives every connector through `connect_request` so the framework stays uniform. Adding a per-connector SDK would break that.

---

## Integration Path Assessment

**Recommended path:** **Direct API Only** (Direct API via `connect_request`)

**Justification:**

- Podio is a structured work-management platform — Items (records) in user-defined Apps, organised Org > Space > App > Item. These are not meaningfully a browsable file tree, so the connector does not belong in Files > Remote.
- The connector is OAuth2 (`authType: 'oauth2'` in the registry); all interaction happens through the workspace agent's `connect_request` tool, which injects `Authorization: OAuth2 {token}` and issues JSON requests against `https://api.podio.com`.
- `surfaces: ['chat']` (the registry default when `surfaces` is omitted) keeps it out of Files > Remote.
- `01-llm-api-rules.md` is the agent's mental model and must stress the **discovery-first** requirement (resolve app schema via `GET /app/{app_id}` before any item read/write — the same posture as the Dataverse connector).

**Connector compatibility:**

| Connector Method    | API Endpoint                          | Feasibility |
| ------------------- | ------------------------------------- | ----------- |
| `list_files`        | n/a — no file tree (items, not files) | none        |
| `download_file`     | n/a — attachments only, not a tree    | none        |
| `search_files`      | n/a — item search, not file search    | none        |
| `get_file_metadata` | `GET /file/{file_id}` (attachments)   | partial     |

Podio is a fully documented public REST API. Any HTTP client that performs OAuth 2.0 authorization_code, injects `Authorization: OAuth2 {access_token}`, and targets `https://api.podio.com` can drive the entire surface — no vendor SDK required.

> Numa-internal wiring (vault keys, registry entry, commit refs) lives in the Numa connector skill and `03-connector-setup.md` — not in this API reference.

---

_Researched on 2026-05-29. Source: `00-api-investigation-questionnaire.md`. Confidence: **medium** — first-live-call gate not yet satisfied. Promote markers to [CONFIRMED] after a successful `GET /user/status` (or `GET /org/`) against the deployed integration; especially verify the `OAuth2` header scheme works, the working `tokenUrl`, and refresh-token rotation._
