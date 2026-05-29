---
api_name: 'Podio'
api_slug: 'podio'
vendor: 'Citrix Systems (Podio)'
website: 'https://podio.com/'
investigation_started: '2026-05-29'
investigator: 'Claude Code (Opus 4.8) — desk research against public docs'
investigation_status: 'in-progress' # blocked on live call (no test OAuth client yet)
documentation_quality: 'good'
api_types: ['REST']
overall_confidence: 'medium' # DOCUMENTED across the board; no [CONFIRMED] gate satisfied
blockers:
  - 'Phase 2.4 gate (first successful call) not satisfied — no test OAuth client / access token was available during desk research.'
  - 'Item schema is per-app (dynamic) — discovery via GET /app/{app_id} is mandatory before any item read/write; field IDs and types are tenant-defined.'
---

# API Investigation Questionnaire: Podio

> Desk-research fill. Every downstream file cites this. Confidence markers:
> `[CONFIRMED]` live test, `[DOCUMENTED]` from official docs, `[INFERRED]`, `[UNKNOWN]`.

---

## Phase 1: Information Sources

### 1.1 Primary Documentation [REQUIRED]

- **Official API docs URL:** `https://developers.podio.com/` [DOCUMENTED]
- **API reference / endpoint catalog URL:** `https://developers.podio.com/doc` (left nav groups: Items, Applications, Organizations, Spaces, Hooks, Files, Tasks, Comments, Users, etc.) [DOCUMENTED]
- **Authentication guide URL:** `https://developers.podio.com/authentication` [DOCUMENTED]
- **Concepts / conventions URL:** `https://developers.podio.com/index/api` [DOCUMENTED]
- **Rate limits URL:** `https://developers.podio.com/index/limits` [DOCUMENTED]
- **Changelog / release notes URL:** Not published as a dedicated changelog. The API is stable/frozen (Podio is in maintenance mode under Citrix) — no version bumps. [INFERRED]
- **Status page URL:** `https://status.podio.com/` [INFERRED — standard Podio status host]

> **Discovery tip:** The whole reference lives under `developers.podio.com/doc/{area}/{operation}-{numericId}`. Endpoint pages carry a numeric operation ID in the slug.

### 1.2 Supplementary Sources [IMPORTANT]

- **OpenAPI / Swagger spec URL:** None published by Podio. [DOCUMENTED — absence]
- **Postman collection:** No official collection. Community collections exist on the Postman public network. [INFERRED]
- **Official SDKs:**
  - Python: `https://github.com/podio/podio-py` (community-maintained; Podio team sunset active maintenance) [DOCUMENTED]
  - PHP: `https://github.com/podio/podio-php` (official, now `podio-community/podio-php`) [DOCUMENTED]
  - JavaScript: `https://github.com/podio/podio-js` (PlatformJS — Node + browser) [DOCUMENTED]
  - Ruby: `https://github.com/podio/podio-rb` [DOCUMENTED]
  - .NET: `https://github.com/podio/podio-dotnet` [DOCUMENTED]
  - Objective-C: `https://github.com/podio/podio-objc` (PodioKit) [DOCUMENTED]
- **Community forum:** `https://help.podio.com/hc/en-us/community` (Podio Help Centre developer community) [DOCUMENTED]

### 1.3 Documentation Quality Assessment [REQUIRED]

| Area                      | Rating | Notes                                                                            |
| ------------------------- | ------ | -------------------------------------------------------------------------------- |
| Authentication            | 4      | Four flows each have a dedicated page; token shape + Authorization header clear. |
| Endpoint reference        | 4      | Every endpoint has its own page with params + sample response. No "Try it" tool. |
| Request/response examples | 3      | Sample responses present but terse; field-value shapes documented per type.      |
| Error documentation       | 2      | Error JSON shape is inferable from SDKs; no central HTTP-status catalogue page.  |
| Rate limit documentation  | 4      | `/index/limits` is clear: 1000/hr global, 250/hr for "Rate limited" ops, 420.    |
| Pagination documentation  | 3      | `limit`/`offset` per endpoint; no global pagination doc; defaults inline.        |
| Webhook documentation     | 4      | Hooks area + tutorial cover create/verify/event-types/payload well.              |
| SDKs / code examples      | 4      | 6 official SDKs across languages; tutorials section has worked examples.         |
| Changelog / versioning    | 1      | No versioned API path, no changelog. Effectively frozen (maintenance mode).      |

**Overall documentation quality:** good (complete but dated; Podio is no longer actively evolved)

### 1.4 Discovery Status [REQUIRED]

- [x] Found official API documentation
- [x] Found or confirmed no OpenAPI/Swagger spec (confirmed: none)
- [x] Identified authentication method (OAuth 2.0 — server-side authorization_code + refresh_token)
- [x] Found at least one working example (from docs/SDKs; not executed)
- [x] Identified rate limit information (1000/hr; 250/hr heavy; 420 status)
- [x] Identified pagination approach (`limit`/`offset` offset-based)
- [x] Checked for webhook/event support (Hooks API, with verify handshake)
- [x] Checked for official SDKs (6, all on github.com/podio)

---

## Phase 2: API Fundamentals

### 2.1 API Identity [REQUIRED]

- **API name:** Podio API [DOCUMENTED]
- **Vendor / company:** Citrix Systems (Podio product) [DOCUMENTED]
- **Current API version:** Unversioned core API (no `/v1` path). The token endpoint is the only versioned path: `/oauth/token/v2`. [DOCUMENTED]
- **Base URLs:**
  - Production API: `https://api.podio.com` [DOCUMENTED]
  - OAuth authorize (user-facing): `https://podio.com/oauth/authorize` [DOCUMENTED — matches registry]
  - OAuth token: `https://api.podio.com/oauth/token/v2` [DOCUMENTED]
  - Sandbox / testing: No separate host. Podio offers a per-app "sandbox" that supports **GET operations only**; same `api.podio.com` host. [DOCUMENTED]
- **API type:** REST [DOCUMENTED]

> ⚠️ **Registry vs docs mismatch on tokenUrl.** The connector registry sets `tokenUrl: 'https://podio.com/oauth/token'`. Podio's documented token endpoint is `https://api.podio.com/oauth/token/v2`. `podio.com/oauth/token` historically redirected/aliased to the v2 endpoint, but Numa's OAuth wizard should POST to the **documented** `https://api.podio.com/oauth/token/v2` to be safe. Flag this in `04-connection-and-reauth.md` and recommend correcting the registry `tokenUrl`. [DOCUMENTED — discrepancy]

### 2.2 Architecture & Protocol [REQUIRED]

- **Transport:** HTTPS (HTTP/1.1; TLS required) [INFERRED]
- **Data format:** JSON [DOCUMENTED]
- **Content-Type header(s):** `application/json` for writes; `application/x-www-form-urlencoded` for the OAuth token exchange; `multipart/form-data` for file uploads. [DOCUMENTED]
- **Character encoding:** UTF-8 [INFERRED]
- **URL structure pattern:** `https://api.podio.com/{area}/{sub-path}/{id}` — e.g. `https://api.podio.com/item/app/{app_id}/filter` [DOCUMENTED]
- **Versioning strategy:** None on the core API (unversioned). Only OAuth token is `/v2`. [DOCUMENTED]
- **CORS policy:** Not designed for direct browser fetch; the client-side flow exists but the PlatformJS SDK handles browser usage. Direct cross-origin `fetch` is unreliable. [INFERRED]
- **Date/time format:** Dates `YYYY-MM-DD`, datetimes `YYYY-MM-DD HH:MM:SS`, always **UTC** (no offset, no `Z`). IDs and numbers must be JSON integers (not strings); booleans must be real bools. [DOCUMENTED]

**Required headers (all requests):**

| Header          | Value                   | Purpose                                               |
| --------------- | ----------------------- | ----------------------------------------------------- |
| `Authorization` | `OAuth2 {access_token}` | Auth. **`OAuth2` scheme, NOT `Bearer`.** [DOCUMENTED] |
| `Content-Type`  | `application/json`      | For POST/PUT bodies. [DOCUMENTED]                     |

### 2.3 Authentication [REQUIRED]

- **Auth method:** OAuth 2.0 [DOCUMENTED]
- **Auth location:** Header [DOCUMENTED]
- **Auth header format:** `Authorization: OAuth2 {access_token}` — Podio-specific scheme. The literal word is `OAuth2`, **not** `Bearer` and **not** `Zoho-oauthtoken`. [DOCUMENTED]

**For OAuth 2.0:**

- **Grant types supported:** `authorization_code` (server-side flow — the one Numa uses), `refresh_token`, plus `password` (username/password flow) and `app` (app-auth flow). Numa connector = `authorization_code` + `refresh_token`. [DOCUMENTED]
- **Authorization URL:** `https://podio.com/oauth/authorize` [DOCUMENTED — matches registry]
- **Token URL:** `https://api.podio.com/oauth/token/v2` [DOCUMENTED — see §2.1 registry mismatch note]
- **Revocation URL:** No documented OAuth revoke endpoint. Tokens expire naturally; client can be disabled in the Podio API key console. [DOCUMENTED — absence]
- **Authorize request params:** `client_id`, `redirect_uri` (must match the domain registered with the API key), `response_type=code`, optional `scope`, optional `state`. [DOCUMENTED]
- **Token exchange (POST, form-urlencoded):** `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`. [DOCUMENTED]
- **Refresh exchange (POST, form-urlencoded):** `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`. [DOCUMENTED]

**Required scopes:**

| Scope               | Purpose                                                | Required?                                 |
| ------------------- | ------------------------------------------------------ | ----------------------------------------- |
| _(empty / omitted)_ | Token inherits the API client's granted permission set | Default — matches registry (`scopes: ''`) |

Podio's scope model is **coarse**: most server-side integrations omit `scope` entirely, and the access token then carries the full permission set of the authenticating user as scoped by the API client's configuration. Granular per-area scopes are **not** the norm the way they are for Google/Zoho. Numa's registry leaves `scopes: ''` and `extraAuthParams: '{}'`, which is correct for Podio. [DOCUMENTED — scope model; registry confirms empty scopes]

- **Token lifetime:** access token = **8 hours** (28800s; `expires_in` is authoritative); refresh token = **28 days**. [DOCUMENTED]
- **Refresh token behavior:** Standard `refresh_token` grant. A refresh **issues a new access token AND a new refresh token** — the connector MUST persist the rotated `refresh_token` from every refresh response or it will be locked out after the old one's 28-day window. [DOCUMENTED — rotation; treat as INFERRED for exact rotate-vs-reuse, verify on first live refresh]
- **PKCE required?** No. [DOCUMENTED — absence]
- **State parameter:** Supported and recommended (CSRF). Numa's OAuth wizard sends `state`. [DOCUMENTED]
- **Redirect URI restrictions:** The `redirect_uri` domain must match the domain registered when the API key was created in the Podio API console. HTTPS required for production. [DOCUMENTED]

### 2.4 First Successful Call [REQUIRED] -- CRITICAL GATE

**Blocked on desk research.** No live OAuth client (`client_id`/`client_secret`) or access token was available during this investigation. The call below is the exact shape from Podio's docs and is what the agent must attempt as the Phase 2 live-gate before any marker is promoted to [CONFIRMED].

**Endpoint planned for first call** (cheap identity check):

```http
GET /user/status HTTP/1.1
Host: api.podio.com
Authorization: OAuth2 {access_token}
Accept: application/json
```

**Documented response shape** (`/user/status` returns the signed-in user + profile + presence):

```json
{
  "user": {
    "user_id": 123456,
    "mail": "user@example.com",
    "status": "active",
    "locale": "en_GB",
    "timezone": "UTC"
  },
  "profile": {
    "profile_id": 654321,
    "name": "Jane Smith",
    "org_id": 100200
  },
  "presence": { "ref_type": "user", "ref_id": 123456 }
}
```

Alternative, equally cheap: `GET /org/` (list the orgs the user belongs to — anchors the org > space > app > item hierarchy discovery).

- **HTTP status code (expected):** 200 [DOCUMENTED]
- **Response headers of note:** `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining` (returned on every call). [DOCUMENTED]
- **Time to first successful call:** N/A — blocked.
- **Gotchas encountered during setup:** N/A — none observed (desk research). Predicted: (1) using `Bearer` instead of `OAuth2` → 401; (2) POSTing the token exchange to `podio.com/oauth/token` (registry value) instead of `api.podio.com/oauth/token/v2` (docs) — see §2.1; (3) sending datetimes with a `Z`/offset instead of bare `YYYY-MM-DD HH:MM:SS` UTC → validation error; (4) sending IDs as strings → type error.

- [ ] **GATE CHECK: First successful API call completed and documented above** — NOT YET. All downstream docs labelled [DOCUMENTED] until an engineer runs `GET /user/status` against a configured Podio app and promotes markers to [CONFIRMED].

---

## Phase 3: Domain Model & Behavior

> **Critical:** Podio is **discovery-first like Dataverse.** The hierarchy is fixed (Org > Space > App > Item) but the _item schema is per-app and tenant-defined_. There is no global "Lead" or "Deal" entity — each App defines its own fields. You MUST call `GET /app/{app_id}` to learn an app's fields (their `field_id`, `external_id`, `type`, and `config`) before you can read or write items meaningfully.

### 3.1 Core Entities [REQUIRED]

#### Entity: Organization (Org)

- **API resource path:** `/org/` (list), `/org/{org_id}` (get) [DOCUMENTED]
- **Description:** Top-level tenant container. A user belongs to one or more orgs. Owns workspaces (spaces). [DOCUMENTED]
- **CRUD support:** Read (create/update are admin/billing operations rarely used via API). [DOCUMENTED]

| Field    | Type    | Required? | Writable? | Description                  | Example          |
| -------- | ------- | --------- | --------- | ---------------------------- | ---------------- |
| `org_id` | integer | —         | no        | Org identifier               | `100200`         |
| `name`   | string  | —         | no        | Organization name            | `"Acme Pty Ltd"` |
| `url`    | string  | —         | no        | Org URL slug                 | `"acme"`         |
| `status` | string  | —         | no        | `active` / `inactive`        | `"active"`       |
| `spaces` | array   | —         | no        | Embedded spaces (when asked) | `[{...}]`        |

#### Entity: Space (Workspace)

- **API resource path:** `/space/{space_id}` (get), `/org/{org_id}/space/` (list by org), `/space/` (create) [DOCUMENTED]
- **Description:** A workspace within an org. Contains apps and members. [DOCUMENTED]
- **CRUD support:** C, R, U, D [DOCUMENTED]

| Field       | Type    | Required? | Writable?    | Description       | Example        |
| ----------- | ------- | --------- | ------------ | ----------------- | -------------- |
| `space_id`  | integer | —         | no           | Space identifier  | `300400`       |
| `name`      | string  | yes       | yes          | Workspace name    | `"Sales Team"` |
| `org_id`    | integer | yes       | yes (create) | Parent org        | `100200`       |
| `privacy`   | string  | no        | yes          | `open` / `closed` | `"closed"`     |
| `url_label` | string  | —         | no           | URL slug          | `"sales-team"` |

#### Entity: Application (App)

- **API resource path:** `/app/{app_id}` (get definition), `/space/{space_id}/app/` (list by space), `/app/` (create) [DOCUMENTED]
- **Description:** A user-defined data type (a "table") within a space. Defines the fields that its items carry. THIS is where the dynamic schema lives. [DOCUMENTED]
- **CRUD support:** C, R, U, D [DOCUMENTED]

| Field      | Type    | Required? | Writable? | Description                                       | Example                   |
| ---------- | ------- | --------- | --------- | ------------------------------------------------- | ------------------------- |
| `app_id`   | integer | —         | no        | App identifier                                    | `500600`                  |
| `status`   | string  | —         | no        | `active` / `inactive` / `deleted`                 | `"active"`                |
| `space_id` | integer | —         | no        | Parent space                                      | `300400`                  |
| `config`   | object  | —         | no        | `{type, name, item_name, icon, external_id, ...}` | `{name:"Leads", ...}`     |
| `fields`   | array   | —         | partial   | Field definitions (the schema) — see below        | `[{field_id, type, ...}]` |

**Field definition (inside `app.fields[]`):** `field_id` (int), `external_id` (string slug), `type` (text/number/date/category/app/contact/money/image/email/phone/embed/calculation/duration/progress/location/...), `status`, `config` (`{label, description, settings, mapping, required, ...}`). Use `external_id` as the stable key when writing items. [DOCUMENTED]

#### Entity: Item

- **API resource path:** `/item/{item_id}` (get one), `/item/app/{app_id}/filter` (POST — list/filter), `/item/app/{app_id}/` (POST — create), `/item/{item_id}` (PUT — update, DELETE — delete) [DOCUMENTED]
- **Description:** A single record (a "row") in an App. Its `fields` array is shaped by the App definition. [DOCUMENTED]
- **CRUD support:** C, R, U, D [DOCUMENTED]

| Field         | Type          | Required? | Writable?    | Description                                         | Example                   |
| ------------- | ------------- | --------- | ------------ | --------------------------------------------------- | ------------------------- |
| `item_id`     | integer       | —         | no           | Record identifier                                   | `12345`                   |
| `app`         | object        | —         | no           | `{app_id, config:{name, item_name}}`                | `{app_id:500600,...}`     |
| `external_id` | string        | no        | yes (create) | Caller-supplied external key (dedupe by it)         | `"EXT-2024-001"`          |
| `title`       | string        | —         | no           | Derived from the app's "title" field                | `"Project Alpha"`         |
| `fields`      | array<object> | per-app   | yes          | Field values — shape depends on each field's `type` | see 3.5                   |
| `tags`        | array<string> | no        | yes          | Free-text tags                                      | `["urgent"]`              |
| `created_on`  | datetime      | —         | no           | UTC `YYYY-MM-DD HH:MM:SS`                           | `"2026-05-29 10:30:00"`   |
| `created_by`  | object        | —         | no           | `{type:"user", id, name}`                           | `{type:"user",...}`       |
| `link`        | string (url)  | —         | no           | Web URL to the item                                 | `"https://podio.com/..."` |
| `rights`      | array<string> | —         | no           | Caller's permissions on the item                    | `["view","update"]`       |
| `revision`    | integer       | —         | no           | Current revision number                             | `3`                       |

#### Entity: File

- **API resource path:** `/file/{file_id}` (get), `/file/` (POST multipart — upload), `/file/{file_id}` (DELETE) [DOCUMENTED]
- **Description:** An uploaded attachment. Files are uploaded standalone then **attached** to an item via `file_ids` on item create/update. [DOCUMENTED]

#### Entity: Task / Comment / Hook (supporting)

- **Task:** `/task/` — standalone or attached to a ref (item/space). Fields: `text`, `description`, `due_date`, `responsible`, `status` (active/completed). [DOCUMENTED]
- **Comment:** `/comment/{ref_type}/{ref_id}` — comments on items/tasks/etc. [DOCUMENTED]
- **Hook:** `/hook/{ref_type}/{ref_id}/` — webhooks on app/space/app_field. See Phase 7. [DOCUMENTED]

### 3.2 Entity Relationships [IMPORTANT]

```
┌──────────────┐  1:N   ┌──────────────┐  1:N   ┌──────────────┐  1:N   ┌──────────────┐
│ Organization │───────►│    Space     │───────►│  Application │───────►│     Item     │
│   (tenant)   │        │ (workspace)  │        │  (schema)    │        │  (record)    │
└──────────────┘        └──────────────┘        └──────┬───────┘        └──────┬───────┘
                                                       │ defines               │ has
                                                       ▼                       ▼
                                                ┌──────────────┐        ┌──────────────┐
                                                │   Field def  │◄───────│ Field value  │
                                                │ (field_id,   │ shapes │ (type-tagged │
                                                │  type)       │        │  values[])   │
                                                └──────────────┘        └──────┬───────┘
                                                                                │ N:1 (app field)
                                                                                ▼
                                                                        ┌──────────────┐
                                                                        │ related Item │  (app reference field)
                                                                        └──────────────┘

Items can ALSO carry:  Files (file_ids), Tasks, Comments, Tags.
Hooks attach to:       App, Space, or an App Field.
```

App-reference fields (`type:"app"`) make item-to-item relationships across apps — the Podio equivalent of a lookup/foreign key. [DOCUMENTED]

### 3.3 State Machines [IMPORTANT]

Podio has **no built-in record lifecycle state machine** for items (no Stage/Status enforced by the platform). Status, if present, is just a `category` field defined by the app builder — transitions are unconstrained. [DOCUMENTED]

The only platform-level lifecycles:

#### State Machine: App.status

```
[active] ──deactivate──► [inactive] ──reactivate──► [active]
   │
   └──delete──► [deleted]   (soft; recoverable for a window)
```

#### State Machine: Task.status

```
[active] ──complete──► [completed] ──reopen──► [active]
```

| Entity | From   | Trigger    | To        | Reversible? | Side Effects                |
| ------ | ------ | ---------- | --------- | ----------- | --------------------------- |
| App    | active | deactivate | inactive  | yes         | Items hidden from views     |
| App    | active | delete     | deleted   | recoverable | Items soft-deleted with app |
| Task   | active | complete   | completed | yes         | Stream event, notifications |

### 3.4 Business Rules [IMPORTANT]

**Ordering / dependency rules:**

- You cannot create an Item without knowing its App's `app_id` and field schema. Always `GET /app/{app_id}` first. [DOCUMENTED]
- A File must be uploaded (`POST /file/`) before it can be attached to an item via `file_ids`. [DOCUMENTED]
- App-reference field values require valid `item_id`s that the user can access. [DOCUMENTED]

**Field-level rules:**

- Fields are referenced on write by `field_id` (int) OR `external_id` (string). `external_id` is the stable, human-readable key — prefer it. [DOCUMENTED]
- Required fields are declared per-app in `field.config.required`. A create that omits a required field returns a 400/validation error. [DOCUMENTED]
- Datetimes must be `YYYY-MM-DD HH:MM:SS` in UTC — no offset, no `Z`. Dates are `YYYY-MM-DD`. [DOCUMENTED]
- Numeric and ID values must be JSON integers/numbers, not strings; booleans must be real bools. [DOCUMENTED]
- `external_id` on an item is caller-supplied and acts as an idempotency/dedupe key for upsert-style flows (`GET /item/app/{app_id}/external_id/{external_id}`). [DOCUMENTED]

**Cascading effects:**

- Deleting an App soft-deletes its Items. [DOCUMENTED]
- Deleting a Space removes its Apps and their Items. [DOCUMENTED]
- Deleting an Item removes its comments/files associations (files may persist if shared). [INFERRED]

**Uniqueness constraints:**

- `external_id` on an item is unique within its app (used for lookup-by-external-id). [DOCUMENTED]
- App `external_id` and field `external_id` are unique within their parent scope. [DOCUMENTED]

**Computed / read-only fields:**

- `created_on`, `created_by`, `last_event_on`, `revision`, `link`, `rights`, `title` — server-set. [DOCUMENTED]
- `calculation`-type fields are derived; not writable. [DOCUMENTED]

### 3.5 Field Format Reference [IMPORTANT]

The item `fields` array contains one object per populated field: `{field_id, external_id, type, label, values:[...]}`. The `values` shape is **type-specific** — this is the single most error-prone part of the Podio API:

| Field `type`   | `values[]` shape (read)                      | Write value                                 | Notes                                     |
| -------------- | -------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `text`         | `[{value: "..."}]`                           | `"plain or html string"`                    | Has `size` config (small/large)           |
| `number`       | `[{value: "123.45"}]`                        | `123.45`                                    | Read returns string; write a number       |
| `money`        | `[{value: "100.00", currency: "USD"}]`       | `{value: 100.00, currency: "USD"}`          |                                           |
| `date`         | `[{start: "2026-05-29 09:00:00", end: ...}]` | `{start: "YYYY-MM-DD HH:MM:SS", end?: ...}` | UTC; `end` optional                       |
| `category`     | `[{value: {id, text, color}}]`               | `[{category_id: 1}]` or `[1]`               | Single/multi per config; values = opt IDs |
| `app`          | `[{value: {item_id, title, app}}]`           | `[{value: item_id}]` or `[item_id]`         | Item-to-item reference (foreign key)      |
| `contact`      | `[{value: {profile_id, name, ...}}]`         | `[{value: profile_id}]` or `[profile_id]`   | People picker                             |
| `email`        | `[{value: "a@b.com", type: "work"}]`         | `[{value, type}]`                           | Multi-value with sub-types                |
| `phone`        | `[{value: "+64...", type: "mobile"}]`        | `[{value, type}]`                           |                                           |
| `image`/`file` | `[{value: {file_id, link, mimetype, name}}]` | via `file_ids` on item (not in `fields`)    | Attach uploaded files                     |
| `embed`        | `[{embed: {...}, file: {...}}]`              | `{embed: embed_id}`                         | Link previews                             |
| `location`     | `[{value: "addr", lat, lng, ...}]`           | `["formatted address"]`                     |                                           |
| `duration`     | `[{value: 3600}]`                            | `3600`                                      | Seconds                                   |
| `progress`     | `[{value: 75}]`                              | `75`                                        | 0–100                                     |
| `calculation`  | `[{value: ...}]`                             | — (read-only)                               | Derived                                   |

> **Discovery is mandatory.** The set of fields, their `external_id`s, types, required-ness, and category option IDs are all per-app. Always resolve via `GET /app/{app_id}` (or `GET /app/{app_id}/field/{field_id}`) before constructing a write body.

### 3.6 Enum Value Reference [NICE-TO-HAVE]

Category/picklist options are **tenant-defined per field**, not global. There is no built-in global enum. Discover via `app.fields[].config.settings.options` (array of `{id, text, color, status}`). Platform-level fixed enums:

| Entity | Field     | Allowed Values                             |
| ------ | --------- | ------------------------------------------ |
| App    | `status`  | `active`, `inactive`, `deleted`            |
| Space  | `privacy` | `open`, `closed`                           |
| Task   | `status`  | `active`, `completed`                      |
| Hook   | `status`  | `inactive` (pending verify), `active`      |
| Filter | sort dir  | `sort_desc`: `true` (desc) / `false` (asc) |

---

## Phase 4: Endpoint Catalog

### 4.1 Critical Endpoints [REQUIRED]

#### Endpoint: POST /item/app/{app_id}/filter

- **Purpose:** List/filter items in an app with sorting and pagination. The primary read path.
- **Auth:** required.
- **Rate limit:** ⚠️ Marked **"Rate limited"** in the reference → counts against the 250/hr heavy pool, not the 1000/hr general pool. [DOCUMENTED]
- **Idempotent:** yes (read).

**Path parameters:**

| Parameter | Type | Required | Description      |
| --------- | ---- | -------- | ---------------- |
| `app_id`  | int  | yes      | The app to query |

**Request body:**

```json
{
  "sort_by": "created_on",
  "sort_desc": true,
  "filters": {
    "60048452": { "from": "2026-05-01", "to": "2026-05-29" },
    "60048455": [1, 2]
  },
  "limit": 30,
  "offset": 0,
  "remember": false
}
```

- `filters` is keyed by `field_id` (or special keys like `created_on`, `created_by`, `tags`). Value shape depends on field type: category → array of option IDs; date/number → `{from, to}` range; text → substring string. [DOCUMENTED]
- `limit` default 30; practical max **100 per request** (docs note ~500 obtainable only via multiple requests with `offset`). [DOCUMENTED]
- `remember` saves the filter as a saved view; keep `false` for ad-hoc queries. [DOCUMENTED]

**Success response (200):**

```json
{
  "total": 482,
  "filtered": 45,
  "items": [
    {
      "item_id": 12345,
      "app": { "app_id": 500600, "config": { "name": "Leads", "item_name": "Lead" } },
      "external_id": "EXT-2024-001",
      "title": "Project Alpha",
      "link": "https://podio.com/acme/sales-team/apps/leads/items/12345",
      "rights": ["view", "update", "delete"],
      "created_on": "2026-05-15 10:30:00",
      "created_by": { "type": "user", "id": 123456, "name": "Jane Smith" },
      "last_event_on": "2026-05-20 14:20:00",
      "revision": 3,
      "fields": [
        {
          "field_id": 60048450,
          "external_id": "title",
          "type": "text",
          "label": "Title",
          "values": [{ "value": "Project Alpha" }]
        },
        {
          "field_id": 60048455,
          "external_id": "status",
          "type": "category",
          "label": "Status",
          "values": [{ "value": { "id": 1, "text": "Open", "color": "DCEBD8" } }]
        },
        {
          "field_id": 60048460,
          "external_id": "amount",
          "type": "money",
          "label": "Amount",
          "values": [{ "value": "50000.00", "currency": "USD" }]
        }
      ],
      "comment_count": 5,
      "file_count": 2
    }
  ]
}
```

- `total` = all items in app; `filtered` = items matching the filter (use for pagination math). [DOCUMENTED]

**Error responses:**

| Status | error                      | Meaning                    | Recovery                     |
| ------ | -------------------------- | -------------------------- | ---------------------------- |
| 400    | `invalid_value`            | Bad filter key/value shape | Re-check field types via app |
| 401    | `unauthorized` / `expired` | Token expired/invalid      | Refresh token                |
| 403    | `forbidden`                | No access to the app       | Check membership/scope       |
| 404    | `not_found`                | app_id wrong/deleted       | Verify app_id                |
| 420    | (rate limit)               | Heavy-op cap (250/hr) hit  | Backoff per `Retry-After`    |

#### Endpoint: GET /item/{item_id}

- **Purpose:** Fetch one item with full field values.
- **Auth:** required. **Idempotent:** yes.

**Response (200):** the item object shown in 4.1 above (single, not wrapped in an array). [DOCUMENTED]

#### Endpoint: GET /item/app/{app_id}/external_id/{external_id}

- **Purpose:** Resolve an item by its caller-supplied `external_id` — the dedupe/upsert lookup. [DOCUMENTED]
- **Auth:** required. **Idempotent:** yes.

#### Endpoint: POST /item/app/{app_id}/

- **Purpose:** Create one item in an app.
- **Auth:** required. **Idempotent:** no (use `external_id` lookup-then-create for idempotency).
- **Query params:** `silent` (default false — suppress stream/notifications), `hook` (default true — fire webhooks).

**Request body:**

```json
{
  "external_id": "EXT-2024-001",
  "fields": {
    "title": "Project Alpha",
    "status": [1],
    "amount": { "value": 50000, "currency": "USD" },
    "due_date": { "start": "2026-12-31 00:00:00" }
  },
  "tags": ["urgent", "client"],
  "file_ids": [111, 222]
}
```

> `fields` is an object keyed by field `external_id` (preferred) or `field_id`. Each value uses the type-specific **write** shape from 3.5. [DOCUMENTED]

**Success response (200/201):**

```json
{
  "item_id": 54321,
  "title": "Project Alpha",
  "link": "https://podio.com/acme/sales-team/apps/leads/items/54321",
  "revision": 0
}
```

#### Endpoint: PUT /item/{item_id}

- **Purpose:** Update an item. Partial — only fields present in the body change. Omitted fields are untouched; sending an empty array clears a field. [DOCUMENTED]
- **Auth:** required. **Body:** same `{fields, tags, file_ids, ...}` shape as create. **Returns:** new `revision`.

#### Endpoint: DELETE /item/{item_id}

- **Purpose:** Delete an item (soft delete → recoverable for a window).
- **Auth:** required. **Idempotent:** yes (deleting an already-deleted item → 404/no-op). [DOCUMENTED]

#### Endpoint: GET /app/{app_id}

- **Purpose:** Get the app definition — **schema discovery**. Mandatory before any item read/write. Returns `config` + `fields[]` with each field's `field_id`, `external_id`, `type`, `config` (label, required, settings/options). [DOCUMENTED]
- **Auth:** required. **Idempotent:** yes.

#### Endpoint: GET /org/ and GET /org/{org_id}/space/

- **Purpose:** Walk the hierarchy. `GET /org/` lists the user's orgs (and embedded spaces); `GET /org/{org_id}/space/` lists spaces; `GET /space/{space_id}/app/` lists apps in a space. This org → space → app → app schema walk is the discovery sequence. [DOCUMENTED]
- **Auth:** required. **Idempotent:** yes.

#### Endpoint: POST /file/ (multipart) + attach via file_ids

- **Purpose:** Upload a file, then attach via `file_ids` on item create/update. [DOCUMENTED]
- **Auth:** required. multipart/form-data: `source` (binary) + `filename`.

### 4.2 Full Endpoint Index [IMPORTANT]

| Method | Path                                           | Purpose                                   | Auth | Paginated              | Notes                              |
| ------ | ---------------------------------------------- | ----------------------------------------- | ---- | ---------------------- | ---------------------------------- |
| GET    | `/user/status`                                 | Current user + profile (cheap auth check) | yes  | no                     | Phase-2 gate call                  |
| GET    | `/org/`                                        | List user's orgs (+embedded spaces)       | yes  | no                     | Top of hierarchy                   |
| GET    | `/org/{org_id}/space/`                         | List spaces in an org                     | yes  | no                     |                                    |
| GET    | `/space/{space_id}`                            | Get a space                               | yes  | no                     |                                    |
| GET    | `/space/{space_id}/app/`                       | List apps in a space                      | yes  | no                     |                                    |
| GET    | `/app/{app_id}`                                | Get app definition (schema)               | yes  | no                     | **Discovery — call first**         |
| GET    | `/app/{app_id}/field/{field_id}`               | Get one field definition                  | yes  | no                     |                                    |
| POST   | `/item/app/{app_id}/filter`                    | Filter/list items                         | yes  | yes (`limit`/`offset`) | **Rate limited (250/hr)**          |
| POST   | `/item/app/{app_id}/filter/{view_id}`          | Filter by a saved view                    | yes  | yes                    |                                    |
| GET    | `/item/{item_id}`                              | Get one item                              | yes  | no                     |                                    |
| GET    | `/item/app/{app_id}/external_id/{external_id}` | Resolve item by external_id (dedupe)      | yes  | no                     |                                    |
| POST   | `/item/app/{app_id}/`                          | Create item                               | yes  | no                     | `silent`, `hook` query params      |
| PUT    | `/item/{item_id}`                              | Update item (partial)                     | yes  | no                     | Returns new revision               |
| PUT    | `/item/{item_id}/value/{field_id}`             | Update a single field's values            | yes  | no                     |                                    |
| DELETE | `/item/{item_id}`                              | Delete item (soft)                        | yes  | no                     |                                    |
| GET    | `/item/app/{app_id}/count`                     | Count items matching filter               | yes  | no                     |                                    |
| POST   | `/comment/{ref_type}/{ref_id}/`                | Add a comment to an item/task             | yes  | no                     | ref_type=`item`/`task`/...         |
| GET    | `/comment/{ref_type}/{ref_id}/`                | List comments                             | yes  | no                     |                                    |
| POST   | `/task/`                                       | Create a task                             | yes  | no                     |                                    |
| GET    | `/task/`                                       | List tasks (filterable)                   | yes  | yes                    |                                    |
| POST   | `/file/`                                       | Upload a file (multipart)                 | yes  | no                     | Attach via item `file_ids`         |
| GET    | `/file/{file_id}`                              | Get file metadata / download link         | yes  | no                     |                                    |
| POST   | `/hook/{ref_type}/{ref_id}/`                   | Create a webhook                          | yes  | no                     | ref_type=`app`/`space`/`app_field` |
| POST   | `/hook/{hook_id}/verify/request`               | Request the verify code be re-sent        | yes  | no                     |                                    |
| POST   | `/hook/{hook_id}/verify/validate`              | Validate hook with the code               | yes  | no                     | Completes the verify handshake     |
| GET    | `/hook/{ref_type}/{ref_id}/`                   | List hooks on an object                   | yes  | no                     |                                    |
| DELETE | `/hook/{hook_id}`                              | Delete a hook                             | yes  | no                     |                                    |
| POST   | `/oauth/token/v2`                              | Token exchange / refresh                  | no   | no                     | form-urlencoded                    |

### 4.3 Non-REST Endpoints [NICE-TO-HAVE]

None — Podio is pure REST/JSON. No GraphQL, no WebSocket. [DOCUMENTED — absence]

---

## Phase 5: Query & Filter Capabilities

### 5.1 Query Capabilities Summary [REQUIRED]

| Capability                      | Supported?  | Syntax                                                    | Notes                                    |
| ------------------------------- | ----------- | --------------------------------------------------------- | ---------------------------------------- | --------------------- |
| Filter by field value           | yes         | `filters: { "{field_id}": value }` in filter body         | Keyed by **field_id** (int), not name    |
| Filter by date range            | yes         | `filters: { "{date_field_id}": {from, to} }`              | Also `created_on`, `last_edit_on` keys   |
| Full-text search                | partial     | `/search/...` endpoints exist app/space/org-wide          | Separate Search API, not the filter body |
| Sort by field                   | yes         | `sort_by: "{field_id or created_on}"`                     | One sort key                             |
| Sort direction (asc/desc)       | yes         | `sort_desc: true                                          | false`                                   | Boolean, not `-field` |
| Field selection / sparse fields | no (items)  | items always return all fields; `fields=` only on app GET | No sparse-fieldsets on item reads        |
| Include related records         | partial     | app-reference fields embed `{item_id, title}` inline      | One hop only                             |
| Aggregate / count               | yes (count) | `GET /item/app/{app_id}/count` + filter                   | No group-by                              |
| Logical operators (AND/OR)      | AND only    | multiple keys in `filters` are ANDed                      | No OR across fields in one filter        |
| Comparison operators (gt, lt)   | range-only  | `{from, to}` for numbers/dates                            | No standalone `gt`/`lt` operators        |
| Null checks                     | partial     | omit / special handling per field                         | [INFERRED]                               |
| Regex / pattern matching        | no          | substring text match only                                 |                                          |

### 5.2 Filter Syntax [REQUIRED]

**General pattern** (POST body, not query string):

```http
POST /item/app/{app_id}/filter
Content-Type: application/json

{
  "filters": {
    "{category_field_id}": [1, 3],
    "{date_field_id}": { "from": "2026-05-01", "to": "2026-05-29" },
    "{number_field_id}": { "from": 1000, "to": 50000 },
    "{text_field_id}": "acme",
    "created_on": { "from": "2026-05-01 00:00:00", "to": "2026-05-29 23:59:59" },
    "tags": ["urgent"]
  },
  "sort_by": "last_edit_on",
  "sort_desc": true,
  "limit": 100,
  "offset": 0
}
```

**Per-type filter value shapes:**

```
category  → [optionId, optionId]            (OR within the field)
number    → { "from": n, "to": m }          (inclusive range)
date      → { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
text      → "substring"
app (ref) → [itemId, itemId]
contact   → [profileId, profileId]
```

**Combining:** Multiple keys in `filters` are combined with **AND**. There is **no cross-field OR** in a single filter request (a known Podio limitation). For OR, issue multiple requests and merge client-side. [DOCUMENTED]

### 5.3 Sort Syntax [IMPORTANT]

```
"sort_by": "{field_id}"          // a field, or special: created_on, created_by, last_edit_on
"sort_desc": true                // descending; false = ascending
```

Only one sort key per request. Default sort is by `created_on` desc. [DOCUMENTED]

### 5.4 Field Selection [NICE-TO-HAVE]

Item endpoints do **not** support sparse fieldsets — a returned item always carries all its populated fields. Only `GET /app/{app_id}?fields=...` supports the `fields` view param (e.g. `fields=full`) to control how much of the _app definition_ is returned. [DOCUMENTED]

### 5.5 Search Capabilities [IMPORTANT]

- **Global/org search:** `GET /search/v2/...` style endpoints search across an org. [DOCUMENTED]
- **App search:** `POST /search/app/{app_id}/v2` — text search within an app. [DOCUMENTED]
- **Space search:** `POST /search/space/{space_id}/v2`. [DOCUMENTED]
- **Searchable fields:** indexed text content of items, comments, files.
- **Fuzzy matching:** substring/token match; no Levenshtein fuzzy advertised. [INFERRED]
- **Minimum query length:** ≥1 non-whitespace char. [INFERRED]

### 5.6 Common Query Patterns [REQUIRED]

**Pattern 1: List most-recently-edited items in an app (first page)**

```http
POST /item/app/500600/filter
{ "sort_by": "last_edit_on", "sort_desc": true, "limit": 100, "offset": 0 }
```

**Pattern 2: Open leads created this month**

```http
POST /item/app/500600/filter
{
  "filters": {
    "60048455": [1],
    "created_on": { "from": "2026-05-01 00:00:00", "to": "2026-05-31 23:59:59" }
  },
  "limit": 100
}
```

**Pattern 3: Items above a money threshold, newest first**

```http
POST /item/app/500600/filter
{ "filters": { "60048460": { "from": 10000 } }, "sort_by": "created_on", "sort_desc": true }
```

**Pattern 4: Resolve a record by your own external key (idempotent upsert lookup)**

```http
GET /item/app/500600/external_id/EXT-2024-001
```

**Pattern 5: Count matching items without fetching them**

```http
POST /item/app/500600/count
{ "filters": { "60048455": [1, 2] } }
```

---

## Phase 6: Pagination & Bulk Operations

### 6.1 Pagination Model [REQUIRED]

- **Pagination type:** offset-based (`limit` + `offset`). [DOCUMENTED]
- **Default page size:** 30. [DOCUMENTED]
- **Maximum page size:** 100 per request in practice (docs: "up to 500 items by setting the limit to 100" is a misstatement of the multi-request pattern — treat **100 as the per-call max** and page with `offset`). [DOCUMENTED — with caveat]
- **Total count available:** yes — `total` (all items) and `filtered` (items matching) in every filter response. Use `filtered` for the loop bound. [DOCUMENTED]

**Request parameters (in filter body):**

| Parameter | Type | Default | Description               |
| --------- | ---- | ------- | ------------------------- |
| `limit`   | int  | 30      | Items per page (cap 100). |
| `offset`  | int  | 0       | Items to skip.            |

**Response structure:**

```json
{
  "total": 482,
  "filtered": 120,
  "items": [
    /* up to `limit` items */
  ]
}
```

**How to detect last page:** `offset + items.length >= filtered`, OR `items` returns fewer than `limit`. [DOCUMENTED]

### 6.2 Pagination Worked Example [REQUIRED]

```
Page 1: POST /item/app/500600/filter  { "limit": 100, "offset": 0 }
        → { filtered: 250, items: [100] }
Page 2: POST /item/app/500600/filter  { "limit": 100, "offset": 100 }
        → { filtered: 250, items: [100] }
Page 3: POST /item/app/500600/filter  { "limit": 100, "offset": 200 }
        → { filtered: 250, items: [50] }    // 50 < 100 → last page
Stop when offset + len(items) >= filtered (300 >= 250).
```

⚠️ Filter is a **heavy (rate-limited) op** — paging a large app burns the 250/hr pool fast. Page with `limit:100`, not 30, to minimise calls. [DOCUMENTED]

### 6.3 Bulk Operations [IMPORTANT]

| Operation             | Endpoint                                  | Max batch | Notes                                  |
| --------------------- | ----------------------------------------- | --------- | -------------------------------------- |
| Bulk create           | _none_ — create is one item per call      | 1         | Loop `POST /item/app/{app_id}/`        |
| Bulk update           | _none_ for arbitrary items                | 1         | Loop `PUT /item/{item_id}`             |
| Bulk delete           | `POST /item/app/{app_id}/delete` (by IDs) | many      | Accepts an `item_ids` array [INFERRED] |
| Bulk read / batch get | `POST /item/app/{app_id}/filter`          | 100/page  | The read batch mechanism               |

Podio has **no general bulk create/update endpoint** — writes are per-item. This + the 1000/hr (250/hr heavy) cap is the dominant constraint for any sync. [DOCUMENTED — absence of bulk write]

**Partial failure handling:** N/A for single-item writes (each call succeeds or fails atomically). For client-side loops, track per-item results yourself. [INFERRED]

### 6.4 Export / Large Dataset Operations [NICE-TO-HAVE]

- **Async export:** Podio's UI has CSV/Excel export, but there is **no documented async export API** for items. Bulk extraction = paginate `filter`. [DOCUMENTED — absence]
- For large apps, respect the heavy-op rate cap and consider an overnight, offset-paged sweep keyed on `last_edit_on` for incremental pulls.

---

## Phase 7: Real-Time & Event-Driven

### 7.1 Event-Driven Support Summary [REQUIRED]

| Mechanism              | Supported? | Notes                                       |
| ---------------------- | ---------- | ------------------------------------------- |
| Webhooks               | yes        | "Hooks" API — `/hook/{ref_type}/{ref_id}/`. |
| WebSocket              | no         | Not exposed.                                |
| Server-Sent Events     | no         |                                             |
| Long polling           | no         |                                             |
| Change feeds / streams | partial    | `/stream/` activity feeds (read, not push). |

### 7.2 Webhooks [IMPORTANT]

**Setup:**

- **Registration method:** API (`POST /hook/{ref_type}/{ref_id}/`) or the Podio UI. [DOCUMENTED]
- **ref_type / ref_id:** `app` + `app_id`, `space` + `space_id`, or `app_field` + `field_id` (field-scoped). [DOCUMENTED]
- **URL requirements:** HTTPS endpoint; Podio POSTs `application/x-www-form-urlencoded` notifications. [DOCUMENTED]
- **Verification handshake (mandatory):** On create, the hook is `inactive`. Podio immediately POSTs a `type=hook.verify` notification carrying a `code`. Your endpoint must capture the code and call `POST /hook/{hook_id}/verify/validate` with `{ "code": "..." }`. Only then does the hook become `active`. `POST /hook/{hook_id}/verify/request` re-sends the code. [DOCUMENTED]

**Registration request:**

```http
POST /hook/app/500600/
Authorization: OAuth2 ...
Content-Type: application/json

{ "url": "https://example.com/podio/webhook", "type": "item.create" }
```

→ `{ "hook_id": 778899 }` (status `inactive` until verified).

**Event catalog (`type` values):**

| Event                     | Trigger                     | Payload keys                          |
| ------------------------- | --------------------------- | ------------------------------------- |
| `hook.verify`             | Sent once at creation       | `type`, `code`, `hook_id`             |
| `item.create`             | Item created in scope       | `type`, `item_id`, `item_revision_id` |
| `item.update`             | Item updated                | `type`, `item_id`, `item_revision_id` |
| `item.delete`             | Item deleted                | `type`, `item_id`                     |
| `comment.create`          | Comment added               | `type`, `comment_id`, ref ids         |
| `file.change`             | File attached/changed       | `type`, `file_id`                     |
| `app.update`/`app.delete` | App schema/lifecycle change | `type`, `app_id`                      |
| `space.create` etc.       | Space-level changes         | `type`, `space_id`                    |

**Payload format (Podio → your endpoint, form-urlencoded):**

```
type=item.create&item_id=12345&item_revision_id=3&hook_id=778899
```

The payload carries **IDs only, not the full record** — you fetch `GET /item/{item_id}` to get details. [DOCUMENTED]

**Verification / security:**

- **Signature header:** None. Podio does **not** HMAC-sign webhook payloads. [DOCUMENTED — absence]
- **Trust model:** The verify handshake proves _you_ own the URL, but inbound events are not signed. Anyone who learns the URL could spoof events. Mitigate with an unguessable URL path and by re-fetching the referenced item (which is auth-gated) before acting. [INFERRED — security implication]

**Reliability:**

- **Retry policy:** Podio retries failed (non-2xx) deliveries; exact schedule undocumented. [INFERRED]
- **Ordering:** best-effort; not guaranteed.
- **Duplicates:** possible (on retry) — dedupe on `item_revision_id`.

### 7.3 WebSocket / SSE [NICE-TO-HAVE]

Not applicable. [DOCUMENTED — absence]

### 7.4 Polling Fallback [IMPORTANT]

- **Recommended endpoint:** `POST /item/app/{app_id}/filter` sorted by `last_edit_on` desc, filtered `last_edit_on: { from: lastPoll }`. [DOCUMENTED]
- **Interval:** every 15–30 min. Filter is a **heavy op** (250/hr pool) — do NOT poll aggressively. One poll per app per interval.
- **Change detection field:** `last_event_on` / `last_edit_on` (server-set). [DOCUMENTED]
- **Rate-limit impact:** each poll = 1 heavy-pool call. Polling N apps every 15 min = 4N heavy calls/hr; keep N small or widen the interval.

---

## Phase 8: Operational Concerns

### 8.1 Rate Limits [REQUIRED]

**Per user, per API key**, on a rolling **1-hour** window. [DOCUMENTED]

| Scope                      | Limit | Window | Notes                                                                                       |
| -------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------- |
| General API calls          | 1,000 | 1 hr   | Default pool.                                                                               |
| "Rate limited" (heavy) ops | 250   | 1 hr   | Ops marked "Rate limited" in the reference — incl. **`/item/app/{app_id}/filter`**, search. |

- **Rate limit headers (every response):**

| Header                   | Meaning                                 | Example  |
| ------------------------ | --------------------------------------- | -------- |
| `X-Rate-Limit-Limit`     | Ceiling for the call you just made      | `"1000"` |
| `X-Rate-Limit-Remaining` | Calls left in the current 1-hour window | `"843"`  |

- **Rate-limit exceeded response:** HTTP **420** (Podio-specific, NOT 429). [DOCUMENTED]

```json
{
  "error": "rate_limit",
  "error_description": "You have hit the rate limit. Please wait before trying again.",
  "error_detail": null,
  "request": { "url": "https://api.podio.com/item/app/500600/filter", "method": "POST" }
}
```

- **Retry-After header:** present (seconds to wait). [DOCUMENTED]
- **Backoff strategy:** Honour `Retry-After`; otherwise exponential with jitter (base 2s, cap 60s). Because the heavy pool is only 250/hr, prefer wide pages (`limit:100`) and incremental `last_edit_on` filters over full sweeps.

### 8.2 Error Handling [REQUIRED]

**Standard error response format:**

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

The top-level `error` field is a short machine code (e.g. `not_found`, `unauthorized`, `invalid_value`, `forbidden`, `rate_limit`, `server_error`); `error_description` is human-readable; `error_propagate` is a UI hint; `request` echoes the failing call. [DOCUMENTED]

**HTTP status codes:**

| HTTP    | `error` (examples)                         | Meaning               | Retryable? | Recovery                                      |
| ------- | ------------------------------------------ | --------------------- | ---------- | --------------------------------------------- |
| 200     | —                                          | Success               | —          | —                                             |
| 201     | —                                          | Created               | —          | —                                             |
| 204     | —                                          | No content            | —          | treat as success / empty                      |
| 400     | `invalid_value`, `invalid_grant`           | Bad request / body    | no         | Fix body; re-check field types via `GET /app` |
| 401     | `unauthorized`, `invalid_token`, `expired` | Token invalid/expired | yes        | Refresh token; if refresh fails → re-consent  |
| 403     | `forbidden`                                | No permission         | no         | Check space/app membership                    |
| 404     | `not_found`                                | Resource missing      | no         | Verify id / app_id                            |
| 409     | `conflict`                                 | Conflict              | maybe      | Re-read and retry                             |
| 410     | `gone`                                     | Deleted               | no         | —                                             |
| 420     | `rate_limit`                               | Rate limited (Podio)  | yes        | Backoff per `Retry-After`                     |
| 500     | `server_error`                             | Server error          | yes        | Retry with backoff                            |
| 502/503 | `server_error`                             | Gateway / maintenance | yes        | Retry after `Retry-After`                     |

**Validation error format** (field-level write failure):

```json
{
  "error": "invalid_value",
  "error_description": "The value 'tomorrow' is not a valid date",
  "error_detail": { "field": "due_date", "expected": "YYYY-MM-DD HH:MM:SS" },
  "error_parameters": {},
  "error_propagate": true,
  "request": { "url": "https://api.podio.com/item/app/500600/", "method": "POST" }
}
```

[DOCUMENTED — shape from SDKs; exact `error` codes per field may vary, INFERRED for `error_detail` contents]

### 8.3 Idempotency [IMPORTANT]

- **Idempotency key support:** No dedicated idempotency header. [DOCUMENTED — absence]
- **Natural idempotency:** GET/PUT(by item_id)/DELETE are idempotent. POST create is NOT.
- **Recommendation:** set a stable `external_id` on create, and do a `GET /item/app/{app_id}/external_id/{external_id}` lookup-then-create-or-update to make item creation effectively idempotent (Podio's only dedupe primitive).

### 8.4 Async Operations [IMPORTANT]

None. All Podio operations are synchronous request/response. No async job/poll pattern. [DOCUMENTED — absence]

### 8.5 File Handling [IMPORTANT]

- **Upload endpoint:** `POST /file/` — multipart/form-data, fields `source` (binary) + `filename`. Returns a `file_id`. [DOCUMENTED]
- **Attach:** add the returned `file_id`(s) to an item's `file_ids` on create/update (files are not put inside the `fields` body). [DOCUMENTED]
- **Max file size:** governed by the org's plan; commonly ~100 MB per file. [INFERRED]
- **Allowed types:** any. [DOCUMENTED]
- **Download:** `GET /file/{file_id}` returns metadata incl. a `link`; binary is fetched from the file's CDN link. [DOCUMENTED]

> ⚠️ Multipart upload is out of scope for a JSON-only `connect_request` backend (see Phase 9) — flag as a v2 capability.

### 8.6 Concurrency & Consistency [NICE-TO-HAVE]

- **Optimistic locking:** Items carry a `revision` integer that increments on each write. No ETag enforcement on writes — last-write-wins. Use `revision` to detect drift. [DOCUMENTED]
- **Conflict resolution:** caller's responsibility.
- **Consistency:** writes are immediately visible on subsequent reads. [INFERRED]

---

## Phase 9: Platform Integration Assessment

### 9.1 Integration Path Decision [REQUIRED]

| Path                   | When to Use                     | Fits?   | Notes                                               |
| ---------------------- | ------------------------------- | ------- | --------------------------------------------------- |
| Data Connector         | Browsable files/content         | no      | Podio is structured items, not a file tree          |
| Data Connector (Files) | Primarily file storage          | no      | Files exist but are attachments, not the product    |
| **Direct API Only**    | **Action-oriented API surface** | **yes** | LLM calls via `connect_request`; no file-browser UI |
| Hybrid                 | Both browsable AND action       | no      | —                                                   |

**Selected integration path:** **Direct API Only** (Direct API via `connect_request`)

**Justification:** Podio is a structured work-management platform — items (records) in user-defined apps, organised Org > Space > App > Item. These are not meaningfully a browsable file tree, so it does not belong in Files > Remote. The connector is OAuth2 (`authType: 'oauth2'` in the registry) and all interaction happens through the workspace agent's `connect_request` tool, which injects `Authorization: OAuth2 {token}` and issues JSON requests against `https://api.podio.com`. `01-llm-api-rules.md` becomes the agent's mental model; `01a-domain-model-reference.md` must stress the **discovery-first** requirement (resolve app schema via `GET /app/{app_id}` before any item read/write — same posture as the Dataverse connector).

### 9.2 Connector Requirements [IMPORTANT]

Not a Data Connector (Files) path — no `list_files`/`download_file` mapping required. Podio is a fully public REST API; any HTTP client that performs OAuth 2.0 authorization_code and injects `Authorization: OAuth2 {access_token}` can drive the whole surface via `connect_request`.

Requirements for any integrator:

1. OAuth client (`client_id` / `client_secret`) registered in the Podio API console, with the connector's redirect URI added under a domain that matches the registered API-key domain.
2. Use the Podio-specific header scheme `Authorization: OAuth2 {access_token}` (NOT `Bearer`).
3. POST the token exchange/refresh to `https://api.podio.com/oauth/token/v2` (not the registry's `podio.com/oauth/token` — see §2.1; recommend correcting the registry `tokenUrl`).
4. Persist the **rotated `refresh_token`** on every refresh (28-day TTL; access token 8 h).
5. Resolve app schema (`GET /app/{app_id}`) before constructing item read/write bodies — schema is dynamic per app.

> Numa-internal wiring (vault keys, registry entry, commit refs) lives in the connector skill / Numa-side docs — not part of the Podio API surface and not documented here.

### 9.3 Workspace Agent Capabilities [REQUIRED]

**CAN do (in scope):**

1. Walk the hierarchy: list orgs (`GET /org/`), spaces (`GET /org/{org_id}/space/`), apps (`GET /space/{space_id}/app/`).
2. Discover an app's schema: `GET /app/{app_id}` → field IDs, external_ids, types, required, category options.
3. Filter/list/count items in an app with sort + offset pagination (`POST /item/app/{app_id}/filter`, `/count`).
4. Get a single item (`GET /item/{item_id}`) or resolve by `external_id`.
5. Create / update / delete items (one at a time), using the type-correct write shapes.
6. Add comments to items; read activity via filter.

**CANNOT do (out of scope or risky for v1):**

1. Upload/attach files — `connect_request` is JSON-only; multipart upload needs a dedicated handler. (v2)
2. Register webhooks on the user's behalf — requires a Numa-hosted, verifiable public endpoint + the verify handshake.
3. Bulk create/update — Podio has no bulk write API; loops must respect the 250/hr heavy cap. The agent should warn before mass operations.
4. Cross-field OR queries — the filter API is AND-only; the agent must either narrow or merge multiple requests.
5. Org/space/app _creation_ and member management — administrative, gate behind explicit user intent.

**Default parameters:**

| Parameter                | Default                          | Reason                                                          |
| ------------------------ | -------------------------------- | --------------------------------------------------------------- |
| `limit`                  | 100                              | Per-call max; minimise calls against the 250/hr heavy pool.     |
| `offset`                 | 0                                | Start of result set.                                            |
| `sort_by` / `sort_desc`  | `last_edit_on` / `true`          | Freshest-first matches user expectation.                        |
| `silent` (create/update) | `false`                          | Preserve stream notifications / activity unless told otherwise. |
| `hook` (create/update)   | `true`                           | Preserve webhook parity with the UI.                            |
| schema fetch             | always `GET /app/{app_id}` first | Dynamic schema — never assume field IDs/types.                  |

### 9.4 SDK Assessment [NICE-TO-HAVE]

| SDK                        | Language | Quality | Maintained?          | Worth Using? | Notes                                                            |
| -------------------------- | -------- | ------- | -------------------- | ------------ | ---------------------------------------------------------------- |
| podio-py                   | Python   | fair    | community / stale    | No           | Numa uses raw httpx via `connect_request` for all connectors.    |
| podio-php                  | PHP      | good    | community-maintained | No           | Useful as behaviour reference (field write shapes, verify flow). |
| podio-js                   | JS/Node  | good    | low activity         | No           | Good for confirming rate-limit header names + request signing.   |
| podio-rb / -dotnet / -objc | various  | fair    | low activity         | No           | Reference only.                                                  |

Adding an SDK per-connector breaks the framework rule that "all connectors look the same to the framework". SDKs are reference material only.

---

## Phase 10: Generation Instructions

### 10.1 Readiness Checklist [REQUIRED]

- [x] Phase 1 complete: sources identified and quality assessed
- [ ] Phase 2 complete: **auth working and first call documented** — BLOCKED, no test OAuth client during desk research
- [x] Phase 3 complete: hierarchy (Org/Space/App/Item) + File/Task/Comment/Hook documented; dynamic field model captured
- [x] Phase 4 complete: 10+ critical endpoints documented with request/response
- [x] Phase 5 complete: filter/sort/search/pagination patterns documented
- [x] Phase 6 complete: offset pagination documented with worked example; bulk-write absence noted
- [x] Phase 7 complete: Hooks API (with verify handshake) documented
- [x] Phase 8 complete: rate model (1000/250 per hr, 420), error format, file handling documented
- [x] Phase 9 complete: integration path = Direct API Only

**Overall investigation confidence:** medium

**Known gaps that will reduce output quality:**

1. Phase 2 live-gate NOT satisfied — downstream files carry [DOCUMENTED] markers until an engineer runs `GET /user/status` (or `GET /org/`) against a configured Podio app and promotes to [CONFIRMED]. Especially verify: the `OAuth2` header scheme works, refresh-token rotation behavior, and which `tokenUrl` actually succeeds.
2. **Dynamic schema** — every app has its own fields. The agent MUST `GET /app/{app_id}` before reading/writing items; no static field map can be generated. This is the dominant runtime gotcha (Dataverse-style).
3. Exact error-code-per-status catalogue is inferred from SDKs (no single official HTTP-status page); `error_detail` contents are [INFERRED].
4. Webhook payloads are unsigned (no HMAC) and carry IDs only — flagged in 01d; security mitigation is unguessable URL + re-fetch.
5. Registry `tokenUrl` discrepancy (`podio.com/oauth/token` vs documented `api.podio.com/oauth/token/v2`) — verify and correct.

### 10.2 Generation Prompts [REQUIRED]

Generating (all templates):

1. 01-llm-api-rules.md — main prompt, <300 lines (auth `OAuth2` scheme, discovery-first, filter/create/update, rate caps, 420)
2. 01a-domain-model-reference.md — Org/Space/App/Item hierarchy + dynamic field-type value shapes (the per-type read/write table)
3. 01b-query-patterns.md — `POST .../filter` body, AND-only filters, offset pagination, count/search
4. 01c-mutation-patterns.md — create/update/delete item, type-specific write shapes, external_id idempotency
5. 01d-event-and-error-handling.md — Hooks verify handshake + event catalog, error JSON, 420/Retry-After, rate caps
6. 02-api-spec-investigation.md — dev-facing condensed ref
7. ~~03-connector-setup.md~~ — **SKIP** (integration path is Direct API Only, not Data Connector Files)
8. 04-connection-and-reauth.md — Podio API console app creation, redirect-URI domain rule, token exchange/refresh, rotation, tokenUrl correction

### 10.3 Confidence Report [REQUIRED]

| Output Document              | Can Generate? | Confidence | Gaps                                                                                    |
| ---------------------------- | ------------- | ---------- | --------------------------------------------------------------------------------------- |
| 01-llm-api-rules             | yes           | medium     | Phase 2 gate not satisfied; dynamic schema must be stressed                             |
| 01a-domain-model-reference   | yes           | medium     | Item fields are per-app — document the hierarchy + type shapes, not a fixed entity list |
| 01b-query-patterns           | yes           | medium     | AND-only filters; filter is a heavy/rate-limited op                                     |
| 01c-mutation-patterns        | yes           | medium     | Per-type write shapes; no bulk write; external_id is only dedupe                        |
| 01d-event-and-error-handling | yes           | medium     | Unsigned webhooks; error catalogue partly inferred from SDKs                            |
| 02-api-spec-investigation    | yes           | medium     | —                                                                                       |
| 03-connector-setup           | n/a           | —          | Skipped — Direct API Only path                                                          |
| 04-connection-and-reauth     | yes           | medium     | tokenUrl discrepancy + refresh rotation need live confirmation                          |

---

_Investigation blocked on first-live-call gate. Downstream output proceeds at [DOCUMENTED] confidence; a follow-up should run after the first successful `GET /user/status` (or `GET /org/`) against a configured Podio app — at which point verify the `OAuth2` header scheme, the working `tokenUrl`, and refresh-token rotation, then promote markers to [CONFIRMED]._
