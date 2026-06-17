---
api_name: Podio
api_slug: podio
base_url: https://api.podio.com
path_version_segment: NONE — core API unversioned. /v1 does not exist. Only /oauth/token/v2 is versioned (backend token exchange).
auth: OAuth2 {access_token} — literal scheme "OAuth2", NOT "Bearer"
field_casing: snake_case
id_format: integer
call_surface: HTTP JSON via `connect_request` (Direct API Only). NOT file-browse, NOT MCP. File upload (multipart) unsupported.
spec_format: none (no OpenAPI/Swagger published)
docs_url: https://developers.podio.com/
status_page: https://status.podio.com/
date_researched: 2026-05-29
confidence: medium — all [DOCUMENTED] vs developers.podio.com; first-live-call gate NOT run. Promote to [CONFIRMED] after a successful GET /user/status (or GET /org/) against a configured app — especially verify the OAuth2 scheme, the working tokenUrl, and refresh-token rotation.
---

# Podio — API Specification & Investigation

Developer reference: everything needed to implement or extend the Podio integration.

## Overview

- **Vendor:** Citrix Systems (Podio product). Podio is in maintenance mode under Citrix — the API is stable and effectively frozen (no changelog, no version bumps).
- **API version:** Unversioned core API — there is **no `/v1` path**. The OAuth token endpoint is the only versioned path (`/oauth/token/v2`).
- **Base URL:** `https://api.podio.com`
- **Sandbox:** No separate host. Podio offers a per-app "sandbox" supporting **GET operations only**, on the same `api.podio.com` host.
- **API type:** REST. **Data format:** JSON (writes); `application/x-www-form-urlencoded` for the OAuth token exchange; `multipart/form-data` for file uploads.
- **Docs:** developers.podio.com; reference at developers.podio.com/doc (left nav groups by area: Items, Applications, Organizations, Spaces, Hooks, Files, Tasks, Comments, Users). **OpenAPI spec:** not published.

**Summary:** Structured work-management/collaboration platform. Data model is a FIXED four-level hierarchy — **Organization > Space > Application > Item** — but the **item schema is per-app and tenant-defined** (an App is a user-built "table"; its Items are the "rows"). No global "Lead"/"Deal" entity: each App declares its own fields. This makes Podio **discovery-first, like Microsoft Dataverse** — call `GET /app/{app_id}` to learn an app's fields (`field_id`, `external_id`, `type`, options) before reading/writing items meaningfully.

## Authentication

### Method: OAuth 2.0

Standard `authorization_code` flow with `refresh_token` rotation. Wire protocol is RFC-6749-standard, but two things are Podio-specific:

1. **API Authorization header scheme is `OAuth2`, NOT `Bearer`.** Using `Bearer` returns 401.
2. **Rate-limit-exceeded status is `420`, NOT `429`.**

Header format: `Authorization: OAuth2 {access_token}` — literal scheme word `OAuth2` (not `Bearer`, not `Zoho-oauthtoken`). Numa's backend handles this via the `authHeaderScheme` field on the connector registry — **set `authHeaderScheme: 'OAuth2'`** (the registry entry as written omits it; see 03). [verified vs developers.podio.com/authentication]

### OAuth 2.0 Details

| Parameter         | Value                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Grant types       | `authorization_code` (the flow Numa uses), `refresh_token`; also `password`, `app` (unused)                           |
| Authorization URL | `https://podio.com/oauth/authorize`                                                                                   |
| Token URL         | `https://api.podio.com/oauth/token/v2` ⚠️ (registry says `podio.com/oauth/token` — see below)                         |
| Revocation URL    | **None documented.** Tokens expire naturally; an API client can be disabled in the Podio API console.                 |
| Access token TTL  | 8 hours (`expires_in`=28800 — authoritative)                                                                          |
| Refresh token TTL | 28 days                                                                                                               |
| Refresh rotation  | **Yes** — a refresh issues a new access token AND a new refresh token; persist the rotated `refresh_token` every time |
| PKCE required     | No                                                                                                                    |
| State parameter   | Supported and recommended (CSRF); Numa's wizard sends `state`                                                         |
| Token exchange    | POST `application/x-www-form-urlencoded` to the Token URL                                                             |

⚠️ **Registry vs docs mismatch on `tokenUrl`.** Registry sets `tokenUrl: 'https://podio.com/oauth/token'`. Documented endpoint is `https://api.podio.com/oauth/token/v2`. Historically `podio.com/oauth/token` aliased to v2, but the documented endpoint is the safe one. Recommend correcting the registry to `https://api.podio.com/oauth/token/v2`. See 04 §3. [discrepancy verified 2026-05-29]

### Required Scopes

Podio's scope model is **coarse** — unlike Google/Zoho, most server-side integrations omit `scope` entirely; the access token then carries the full permission set of the authenticating user as constrained by the API client's config.

| Scope               | Purpose                                               | Required?                                 |
| ------------------- | ----------------------------------------------------- | ----------------------------------------- |
| _(empty / omitted)_ | Token inherits the user's full granted permission set | Default — matches registry (`scopes: ''`) |

Numa's registry correctly leaves `scopes: ''` and `extraAuthParams: '{}'`. Granular per-area scopes are not the Podio norm.

## Endpoint Catalog

⚠️ **Discovery-first.** `GET /app/{app_id}` is the mandatory prerequisite for any item read/write — returns each field's `field_id`, `external_id`, `type`, required-ness, category option IDs. Never hardcode; the schema is per-app.

### Hierarchy / Discovery (all GET, Yes auth, idempotent, unpaginated)

| Path                             | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `/user/status`                   | Current user + profile (cheap auth/liveness check)      |
| `/org/`                          | List user's orgs (+ embedded spaces) — top of hierarchy |
| `/org/{org_id}/space/`           | List spaces in an org                                   |
| `/space/{space_id}`              | Get a space                                             |
| `/space/{space_id}/app/`         | List apps in a space                                    |
| `/app/{app_id}`                  | **Get app definition (schema) — call FIRST**            |
| `/app/{app_id}/field/{field_id}` | Get one field definition                                |

### Items (the primary surface)

| Method | Path                                           | Purpose                                        | Paginated              | Idempotent |
| ------ | ---------------------------------------------- | ---------------------------------------------- | ---------------------- | ---------- |
| POST   | `/item/app/{app_id}/filter`                    | Filter / list items — **HEAVY (250/hr)**       | Yes (`limit`/`offset`) | Yes (read) |
| POST   | `/item/app/{app_id}/filter/{view_id}`          | Filter by a saved view — HEAVY                 | Yes                    | Yes (read) |
| POST   | `/item/app/{app_id}/count`                     | Count items matching a filter — HEAVY          | No                     | Yes (read) |
| GET    | `/item/{item_id}`                              | Get one item (full field values)               | No                     | Yes        |
| GET    | `/item/app/{app_id}/external_id/{external_id}` | Resolve item by your own key (dedupe/upsert)   | No                     | Yes        |
| POST   | `/item/app/{app_id}/`                          | Create one item (`silent`,`hook` query params) | No                     | No\*       |
| PUT    | `/item/{item_id}`                              | Update item (partial; returns new `revision`)  | No                     | Yes        |
| PUT    | `/item/{item_id}/value/{field_id}`             | Update a single field's values                 | No                     | Yes        |
| DELETE | `/item/{item_id}`                              | Delete item (soft)                             | No                     | Yes        |

\* Create is not idempotent — set a stable `external_id` and do a `GET .../external_id/{id}` lookup-then-create-or-update (Podio's only dedupe primitive).

### Supporting

| Method   | Path                              | Purpose                                     | Notes                                                         |
| -------- | --------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| POST/GET | `/comment/{ref_type}/{ref_id}/`   | Add / list comments                         | ref_type=`item`…                                              |
| POST/GET | `/task/`                          | Create / list (filterable, paginated) tasks | `text`, `due_date`, `responsible`                             |
| POST     | `/file/`                          | Upload a file (multipart)                   | Attach via item `file_ids`; out of scope for JSON-only path   |
| GET      | `/file/{file_id}`                 | Get file metadata / download link           |                                                               |
| POST     | `/hook/{ref_type}/{ref_id}/`      | Create a webhook                            | ref_type=`app`/`space`/`app_field`; verify handshake required |
| POST     | `/hook/{hook_id}/verify/validate` | Validate a hook with the code               | Completes the verify handshake                                |
| POST     | `/hook/{hook_id}/verify/request`  | Re-send the verify code                     |                                                               |
| GET      | `/hook/{ref_type}/{ref_id}/`      | List hooks on an object                     |                                                               |
| DELETE   | `/hook/{hook_id}`                 | Delete a hook                               |                                                               |
| POST     | `/oauth/token/v2`                 | Token exchange / refresh                    | form-urlencoded; backend-only; no auth header                 |

## Data Models

Hierarchy is fixed; the **item field set is per-app**. Tables below give the platform-fixed envelope fields. The per-app `fields[]` shape is discovered at runtime (see Field Format below and 01a).

### Organization (Org)

`org_id` (int, ro), `name` (string, ro), `url` (string slug, ro), `status` (`active`/`inactive`, ro), `spaces` (array of embedded spaces, ro).

### Space (Workspace)

`space_id` (int, ro), `name` (string, req, writable), `org_id` (int, req, writable on create), `privacy` (`open`/`closed`, writable).

### Application (App) — the dynamic schema lives here

`app_id` (int, ro), `status` (`active`/`inactive`/`deleted`, ro), `space_id` (int, ro), `config` (object `{type,name,item_name,icon,external_id,…}`, ro), `fields` (array of field **definitions** — the schema, partial-writable).
**Field definition** (inside `app.fields[]`): `field_id` (int), `external_id` (string slug — the stable write key), `type` (text/number/date/category/app/contact/money/image/email/phone/embed/calculation/duration/progress/location/…), `status`, `config` (`{label,description,settings,required,…}`).

### Item — a record ("row") in an App

| Field         | Type          | Writable     | Description                                         |
| ------------- | ------------- | ------------ | --------------------------------------------------- |
| `item_id`     | integer       | no           | Record identifier                                   |
| `app`         | object        | no           | `{app_id,config:{name,item_name}}`                  |
| `external_id` | string        | yes (create) | Caller-supplied key (dedupe / upsert)               |
| `title`       | string        | no           | Derived from the app's "title" field                |
| `fields`      | array<object> | yes          | Field values — shape depends on each field's `type` |
| `tags`        | array<string> | yes          | Free-text tags                                      |
| `created_on`  | datetime      | no           | UTC `YYYY-MM-DD HH:MM:SS`                           |
| `created_by`  | object        | no           | `{type:"user",id,name}`                             |
| `link`        | string(url)   | no           | Web URL to the item                                 |
| `rights`      | array<string> | no           | Caller's permissions on the item                    |
| `revision`    | integer       | no           | Current revision (increments per write)             |

**Relationships:** `Org 1:N Space 1:N App 1:N Item`. An App's `app`-type field makes **item-to-item references** across apps (Podio's lookup/foreign key). Items also carry Files (`file_ids`), Tasks, Comments, Tags. Hooks attach to an App, a Space, or an App Field.

### Field Format Reference (the most error-prone part)

The item `fields` array contains one object per populated field: `{field_id, external_id, type, label, values:[…]}`. The `values` shape is **type-specific**, and the **read shape differs from the write shape**:

| `type`         | `values[]` (READ)                        | WRITE value                              | Notes                               |
| -------------- | ---------------------------------------- | ---------------------------------------- | ----------------------------------- |
| `text`         | `[{value:"…"}]`                          | `"plain or html string"`                 | `size` config (small/large)         |
| `number`       | `[{value:"123.45"}]`                     | `123.45`                                 | Read returns string; write a number |
| `money`        | `[{value:"100.00",currency:"USD"}]`      | `{value:100.00,currency:"USD"}`          |                                     |
| `date`         | `[{start:"2026-05-29 09:00:00",end:…}]`  | `{start:"YYYY-MM-DD HH:MM:SS",end?:…}`   | UTC; `end` optional                 |
| `category`     | `[{value:{id,text,color}}]`              | `[{value:option_id}]` or `[option_id]`   | Single/multi per config; opt IDs    |
| `app`          | `[{value:{item_id,title,app}}]`          | `[{value:item_id}]` or `[item_id]`       | Item-to-item reference              |
| `contact`      | `[{value:{profile_id,name,…}}]`          | `[{value:profile_id}]` or `[profile_id]` | People picker                       |
| `email`        | `[{value:"a@b.com",type:"work"}]`        | `[{value,type}]`                         | Multi-value with sub-types          |
| `phone`        | `[{value:"+64…",type:"mobile"}]`         | `[{value,type}]`                         |                                     |
| `image`/`file` | `[{value:{file_id,link,mimetype,name}}]` | via `file_ids` on item (not in `fields`) | Attach uploaded files               |
| `embed`        | `[{embed:{…},file:{…}}]`                 | `{embed:embed_id}`                       | Link previews                       |
| `location`     | `[{value:"addr",lat,lng,…}]`             | `["formatted address"]`                  |                                     |
| `duration`     | `[{value:3600}]`                         | `3600`                                   | Seconds                             |
| `progress`     | `[{value:75}]`                           | `75`                                     | 0–100                               |
| `calculation`  | `[{value:…}]`                            | — (read-only)                            | Derived                             |

**Datetimes are bare UTC `YYYY-MM-DD HH:MM:SS`** — no `Z`, no offset. Dates `YYYY-MM-DD`. Numbers/IDs must be JSON integers (not strings); booleans must be real bools.

## Pagination

- Offset-based (`limit`+`offset`), supplied **in the filter request body** (not the query string).
- Default page size 30; treat **100** as the per-call ceiling and page with `offset` (the docs' "up to 500" line describes the multi-request pattern, not a single-call max).
- Every filter response carries `total` (all items in the app) and `filtered` (items matching the filter); use **`filtered`** as the loop bound.

| Parameter | Type | Default | Description           |
| --------- | ---- | ------- | --------------------- |
| `limit`   | int  | 30      | Items per page (≤100) |
| `offset`  | int  | 0       | Items to skip         |

Response: `{"total":482,"filtered":120,"items":[/* up to limit */]}`. Last page when `offset + items.length >= filtered` OR `items.length < limit`.
⚠️ Every filter call is a **heavy (rate-limited) op** (250/hr). Page `limit:100` (not default 30); prefer incremental `last_edit_on` filters over full sweeps. There is **no bulk write** — create/update are one item per call.

## Rate Limits

**Per user, per API key, on a rolling 1-hour window.** [verified vs developers.podio.com/index/limits]
| Scope | Limit | Window | Notes |
| --- | --- | --- | --- |
| General API calls | 1,000 | 1 hr | Default pool |
| "Rate limited" (heavy) ops | 250 | 1 hr | Ops marked "Rate limited" in the reference — incl. `/item/app/{app_id}/filter`, `/count`, search |

Headers on every response: `X-Rate-Limit-Limit` (ceiling for the call just made), `X-Rate-Limit-Remaining` (calls left in the current 1-hr window).

When exceeded: HTTP **420** (Podio-specific — **NOT 429**), `error:"rate_limit"` + `Retry-After`:

```
{"error":"rate_limit","error_description":"You have hit the rate limit. Please wait before trying again.","error_detail":null,"request":{"url":"https://api.podio.com/item/app/500600/filter","method":"POST"}}
```

**Strategy:** (1) Honour `Retry-After`. (2) Else exponential backoff with jitter (base 2s, cap 60s). (3) Heavy pool is only 250/hr — prefer wide pages (`limit:100`) and incremental `last_edit_on` filters over full sweeps.

## Error Handling

### Standard format

```
{"error":"not_found","error_description":"Item with id 99999 could not be found","error_detail":null,"error_parameters":{},"error_propagate":false,"request":{"url":"https://api.podio.com/item/99999","query_string":"","method":"GET"}}
```

`error` = short machine code (`not_found`, `unauthorized`, `invalid_value`, `invalid_grant`, `forbidden`, `rate_limit`, `server_error`); `error_description` is user-safe — surface verbatim. `error_propagate` is a UI hint; `request` echoes the failing call.

### Status codes

| Status      | Common `error`                             | Meaning                        | Retryable | Recovery                                               |
| ----------- | ------------------------------------------ | ------------------------------ | --------- | ------------------------------------------------------ |
| 200/201/204 | —                                          | Success / created / no content | —         | 204 → success/empty                                    |
| 400         | `invalid_value`, `invalid_grant`           | Bad request / body             | No        | Fix body; re-check field types via `GET /app/{id}`     |
| 401         | `unauthorized`, `invalid_token`, `expired` | Token invalid/expired          | Yes       | Refresh token (rotate stored refresh); else re-consent |
| 403         | `forbidden`                                | No permission                  | No        | Check space/app membership                             |
| 404         | `not_found`                                | Resource missing               | No        | Verify `item_id`/`app_id`                              |
| 409         | `conflict`                                 | Conflict                       | Maybe     | Re-read and retry                                      |
| 410         | `gone`                                     | Deleted                        | No        | —                                                      |
| 420         | `rate_limit`                               | Rate limited (Podio)           | Yes       | Backoff per `Retry-After`                              |
| 5xx         | `server_error`                             | Server error                   | Yes       | Retry with backoff                                     |

⚠️ Podio returns **420** for rate limiting, not 429. The standard `422` validation status is **not** used — field-level write failures come back as **400 `invalid_value`** with an `error_detail` describing the offending field (e.g. `{"field":"due_date","expected":"YYYY-MM-DD HH:MM:SS"}`). [`error_detail` contents partly INFERRED from SDK behaviour]. Full reference: 01d § Error Handling.

## Webhooks / Events

**Supported** via the Hooks API: `POST /hook/{ref_type}/{ref_id}/` (ref_type = `app`/`space`/`app_field`).

**Verification handshake (mandatory):** on create the hook is `inactive`. Podio immediately POSTs a `type=hook.verify` notification carrying a `code`. Your endpoint must capture it and call `POST /hook/{hook_id}/verify/validate` with `{"code":"..."}`; only then does the hook become `active`. `POST /hook/{hook_id}/verify/request` re-sends the code.

| Event            | Trigger               | Payload keys (IDs only — re-fetch the item) |
| ---------------- | --------------------- | ------------------------------------------- |
| `hook.verify`    | Once at creation      | `type`, `code`, `hook_id`                   |
| `item.create`    | Item created in scope | `type`, `item_id`, `item_revision_id`       |
| `item.update`    | Item updated          | `type`, `item_id`, `item_revision_id`       |
| `item.delete`    | Item deleted          | `type`, `item_id`                           |
| `comment.create` | Comment added         | `type`, `comment_id`, ref ids               |
| `file.change`    | File attached/changed | `type`, `file_id`                           |

**Payload:** Podio → your endpoint, `application/x-www-form-urlencoded`, **IDs only — not the full record**. Re-fetch `GET /item/{item_id}` for details.
**Security:** Podio does NOT HMAC-sign webhook payloads. The verify handshake only proves you own the URL; inbound events are unsigned and spoofable. Mitigate with an unguessable URL path and by re-fetching the (auth-gated) referenced item before acting.
**Reliability:** Podio retries failed (non-2xx) deliveries (schedule undocumented); ordering best-effort; duplicates possible — dedupe on `item_revision_id`.
**Numa status:** Numa does not yet host a verifiable public receiver. **Webhook registration is out of scope from chat** — use polling: `POST /item/app/{app_id}/filter` sorted/filtered by `last_edit_on` desc every 15–30 min (heavy op — don't poll aggressively).

## SDKs & Tooling

| SDK          | Language    | Repository                             | Quality | Notes                                                              |
| ------------ | ----------- | -------------------------------------- | ------- | ------------------------------------------------------------------ |
| podio-py     | Python      | github.com/podio/podio-py              | fair    | Community / stale. Numa uses raw httpx via `connect_request`.      |
| podio-php    | PHP         | github.com/podio/podio-php             | good    | Community-maintained; useful for field write shapes + verify flow. |
| podio-js     | JS/Node     | github.com/podio/podio-js (PlatformJS) | good    | Good for confirming rate-limit header names + request signing.     |
| podio-rb     | Ruby        | github.com/podio/podio-rb              | fair    | Reference only.                                                    |
| podio-dotnet | .NET        | github.com/podio/podio-dotnet          | fair    | Reference only.                                                    |
| podio-objc   | Objective-C | github.com/podio/podio-objc (PodioKit) | fair    | Reference only.                                                    |

No official Postman collection (community collections exist). No OpenAPI spec published. SDKs are reference material only — Numa drives every connector through `connect_request` so the framework stays uniform; a per-connector SDK would break that.

## Integration Path Assessment

**Recommended path: Direct API Only** (Direct API via `connect_request`).

- Podio is structured work-management — Items (records) in user-defined Apps, organised Org > Space > App > Item. Not meaningfully a browsable file tree, so the connector does NOT belong in Files > Remote.
- OAuth2 (`authType: 'oauth2'` in the registry); all interaction via the workspace agent's `connect_request` tool, which injects `Authorization: OAuth2 {token}` and issues JSON requests against `https://api.podio.com`.
- `surfaces: ['chat']` (registry default when omitted) keeps it out of Files > Remote.
- 01-llm-api-rules.md is the agent's mental model and must stress **discovery-first** (resolve app schema via `GET /app/{app_id}` before any item read/write — same posture as Dataverse).

**Connector-method compatibility:** `list_files` / `download_file` / `search_files` → none (no file tree; items, not files). `get_file_metadata` → partial (`GET /file/{file_id}` for attachments).

Any HTTP client doing OAuth2 `authorization_code`, injecting `Authorization: OAuth2 {access_token}`, targeting `https://api.podio.com`, can drive the entire surface — no vendor SDK required. Numa-internal wiring (vault keys, registry entry, commit refs) lives in the connector skill and 03 — not here.
