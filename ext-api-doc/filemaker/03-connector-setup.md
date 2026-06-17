---
api_name: Claris FileMaker Data API
connector_id: filemaker
auth_type: username-password
tier: standard
category: Database
call_surface: Direct API via connect_request — NOT a Files connector (no OAuthProvider class, no list_files/download_file, no Files UI). NOT MCP.
base_url: https://{server_url}/fmi/data/vLatest/databases/{database}
path_version_segment: vLatest (real path segment, in the URL — not a label)
prerequisites: read 00-api-investigation-questionnaire.md, 01-llm-api-rules.md, documentation/connectors/README.md
---

# Claris FileMaker — Connector & Integration Setup

Build / wiring reference for the **Claris FileMaker** connector in Numa: a **Direct API via `connect_request`** connector (not Files-Remote), so **no backend `OAuthProvider` class, no `list_files`/`download_file`, no Files UI**. The registry entry below already exists in the codebase and is the source of truth.

## Integration Type

**Path:** Direct API via `connect_request` (registry `authType: 'username-password'`). The workspace agent issues authenticated REST calls through Numa's `connect_request` proxy using the four vaulted credentials. No file-browsing surface — FileMaker is structured database data (records on layouts), not a document tree. Same chat-only, spec-driven pattern as Podio / Zoho / Actionstep / Connecteam.

| Component                | Required?       | Notes                                                                                                                       |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes (✅ exists) | `id:'filemaker'`, `authType:'username-password'`, 4 credential fields — see §1                                              |
| Admin setup wizard       | No (generic)    | the generic username-password credential form renders from `credentialFields`; no bespoke wizard                            |
| Backend provider class   | **No**          | not a Files connector — no `lib/oauth-providers/` class, no `list_files`/`download_file`/`search_files`/`get_file_metadata` |
| Workspace agent prompt   | Yes             | `01-llm-api-rules.md` (+ companions) — see §3                                                                               |
| Feature flag             | Yes (shared)    | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault                                                              |
| i18n keys                | Yes (shared)    | field labels reuse shared `dataConnectors.fields.*` keys — see §4                                                           |

## 1. Connector Registry Entry (verbatim, already in the codebase)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (in the "Tier 2: Username/Password" block).

```typescript
{
  id: 'filemaker',
  displayName: 'Claris FileMaker',
  icon: 'bi-database',
  description: 'Custom database application platform',
  category: 'Database',
  authType: 'username-password',
  credentialFields: [
    { key: 'server_url', label: 'dataConnectors.fields.serverUrl', type: 'url', placeholder: 'https://myserver.fmi.filemaker-cloud.com', required: true },
    { key: 'username', label: 'dataConnectors.fields.username', type: 'text', placeholder: 'admin', required: true },
    { key: 'password', label: 'dataConnectors.fields.password', type: 'password', placeholder: 'Enter your password', required: true },
    { key: 'database', label: 'dataConnectors.fields.database', type: 'text', placeholder: 'MyDatabase', required: true, helpText: 'dataConnectors.fields.databaseHint' },
  ],
}
```

**Field-by-field:**
| `key` | Type | Required | Placeholder | Maps to / used for |
| --- | --- | --- | --- | --- |
| `server_url` | `url` | yes | `https://myserver.fmi.filemaker-cloud.com` | FileMaker Server / Cloud host. Becomes `{server_url}` in `https://{server_url}/fmi/data/vLatest/databases/{database}` |
| `username` | `text` | yes | `admin` | FileMaker **account** name (needs the `fmrest` extended privilege). Half of the Basic login |
| `password` | `password` | yes | `Enter your password` | account password; other half of the Basic login. Stored as a secret in the user's vault |
| `database` | `text` | yes | `MyDatabase` | hosted `.fmp12` solution name → `{database}` path segment. Case-sensitive on some platforms |

> **Backend implication.** Unlike a `token`/`api-key` connector (single vaulted secret used directly as a bearer), `username-password` here is the _input to a login round-trip_: the proxy must `POST /sessions` with `Authorization: Basic base64(username:password)`, capture `response.token`, send `Authorization: Bearer {token}` on every subsequent call, and **re-login on FileMaker error `952`**. The token is ephemeral and never persisted. Full exchange in `04-connection-and-reauth.md`.

**Registry shape vs. generic template:** the template cites `numa-frontend/src/Config/connectorRegistry.ts` — the **actual file** is `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`; use that. The entry uses `key` (not `name`), `label` as an **i18n key** (not literal text), and a `placeholder`. There is **no** `oauthConfig`/`cachingPolicy`/`apiReference`/`tier` block — do not add them. `icon: 'bi-database'` is a Bootstrap Icons class (not an SVG asset path).

## 2. Backend Provider Class

**Not applicable.** Direct-API / `connect_request` connector, not Files-Remote. No `lib/oauth-providers/filemaker_provider.py`, no registration in `lib/oauth-providers/__init__.py`, no `list_files`/`download_file`/`search_files`/`get_file_metadata`. The agent calls the FileMaker REST endpoints directly through `connect_request`, guided by `01-llm-api-rules.md`. The only FileMaker-specific "backend logic" is the **session/token lifecycle** the proxy performs (Basic login → cache token → Bearer → re-login on `952`), documented in `04-connection-and-reauth.md`.

## 3. Integration Prompt Deployment (ext-api-doc → S3 → agent)

The `ext-api-doc/filemaker/` markdown files are how the agent learns this API. They are **deployed to the per-client S3 outputs bucket by the client stack at deploy time** and loaded into the agent's context when the FileMaker connector is active.

```
ext-api-doc/filemaker/01-llm-api-rules.md (+ 01a–01d)
  │  bundled/uploaded during `make deploy`
  ▼ infra/stacks/numa-client-stack.ts (S3 upload of ext-api-doc assets)
  ▼ s3://numa-{client}-outputs/...  (per-client outputs bucket)
  │  fetched at runtime when the connector is active
  ▼ numa-workspace-agent  (loads 01-*.md into agent context)
```

**Files that ship to the agent:**
| File | Loaded? | Role |
| --- | --- | --- |
| `01-llm-api-rules.md` | Yes | main rules — auth, capabilities, gotchas, defaults, examples |
| `01a-domain-model-reference.md` | Yes | structural entities + runtime **discovery procedure** (no fixed schema) |
| `01b-query-patterns.md` | Yes | `_find` operators, sort, pagination, worked reads |
| `01c-mutation-patterns.md` | Yes | create/edit/delete, `modId`, scripts, globals |
| `01d-event-and-error-handling.md` | Yes | no events; polling; full error playbook |
| `00-…`, `02-…`, `03-…`, `04-…` | No | developer/build docs — **not** loaded into the agent; live in the repo for humans |

> Only the `01-*.md` family is the agent's runtime context. The `00`/`02`/`03`/`04` files (this one included) are developer references, not pushed into the agent prompt.

## 4. i18n Keys

FileMaker reuses **shared** data-connector field labels (`label: 'dataConnectors.fields.*'`), so no connector-specific label keys are needed. Confirm these exist in `numa-frontend/src/locales/en/integrations.json` (or the relevant connector namespace):

```json
{
  "dataConnectors.fields.serverUrl": "Server URL",
  "dataConnectors.fields.username": "Username",
  "dataConnectors.fields.password": "Password",
  "dataConnectors.fields.database": "Database",
  "dataConnectors.fields.databaseHint": "The hosted FileMaker database (.fmp12) name, e.g. MyDatabase"
}
```

`databaseHint` is the only field with a `helpText`. For a connector-specific display name/description, add `connectors.filemaker.displayName` / `connectors.filemaker.description`, but the registry currently uses literal `displayName: 'Claris FileMaker'` / `description: 'Custom database application platform'`.

## 5. Deployment Checklist

> Files-connector items (provider class, `list_files`, Files Remote UI) are **N/A**.

**Code:**

- [x] Registry entry in `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (shipped)
- [x] Icon set (`bi-database` Bootstrap Icon — no SVG asset)
- [ ] Shared `dataConnectors.fields.*` i18n keys present (incl. `databaseHint`)
- [ ] `01-llm-api-rules.md` (+ `01a`–`01d`) written and committed
- [ ] `ext-api-doc/filemaker/01-*.md` included in the client-stack S3 asset upload

**Auth / session lifecycle (the FileMaker-specific work):**

- [ ] User connect flow stores `server_url` + `username` + `password` + `database` in the user's vault (secret = `password`)
- [ ] `connect_request` proxy performs Basic login (`POST /sessions`) and caches the token within its 15-min window
- [ ] Proxy sends `Authorization: Bearer {token}` on subsequent calls
- [ ] Proxy detects FileMaker error `952` (in `messages[].code`) → re-login and retry once
- [ ] Proxy treats HTTP 200 with non-`"0"` `messages[].code` as a logical error (NOT success)
- [ ] User disconnect deletes the user's vaulted credentials

**Workspace Agent:**

- [ ] Loads `01-llm-api-rules.md` when the connector is active
- [ ] Runs discovery (`GET /layouts`, `GET /layouts/{layout}`, `GET /scripts`) before any read/write
- [ ] Can read/query (`GET records`, `POST _find`), respecting offset/limit + FileMaker operators
- [ ] Can create/edit/delete single records, respecting `modId` + field validation
- [ ] Can run named FileMaker scripts for bulk/complex ops
- [ ] Treats FileMaker code `401` (no matches) as an empty result, not a failure

**CI/CD:**

- [ ] No new Lambda (Direct API via existing `connect_request` proxy) — confirm no `.gitlab-ci.yml` / `package-all.sh` change is required

## 6. Testing Plan

> No Claris-operated sandbox — every FileMaker server is a private, per-tenant install. Real testing needs a reachable FileMaker Server / Cloud instance with the Data API enabled and an account holding the `fmrest` extended privilege.

**Manual sequence:**

1. **Connect:** add the connector with `server_url`/`username`/`password`/`database`; confirm credentials store in the vault.
2. **Login round-trip:** trigger any agent call; confirm the proxy mints a token (`POST /sessions` → `response.token`) and uses `Bearer {token}`.
3. **Discover:** "list the layouts" → `GET /layouts`; "show fields on layout X" → `GET /layouts/{layout}`.
4. **Read (browse):** "show first 20 records on layout X" → `GET /records?_offset=1&_limit=20`; confirm pagination via `dataInfo`.
5. **Read (query):** "find records where Stock < 40, newest first" → `POST /_find`; confirm `foundCount` and that an empty find returns FileMaker code `401` (reported as "no matches", not an error).
6. **Create/edit/delete:** round-trip a record; confirm `recordId` returned on create, `modId` bumps on edit, optimistic-lock rejection on stale `modId`.
7. **Script:** run a named script via `GET /script/{name}`.
8. **Token expiry:** idle > 15 min, then call; confirm the proxy sees `952`, re-logs in, retries once transparently.
9. **Disconnect:** remove the connector; confirm vaulted credentials are deleted.

**Edge cases:**

- [ ] HTTP 200 with `messages[].code != "0"` handled as a logical error
- [ ] FileMaker `401` (no matches) vs HTTP `401` (bad Basic credentials) distinguished
- [ ] `952` token expiry → silent re-login + single retry
- [ ] Calc/summary field sent in `fieldData` → rejected (validation error)
- [ ] Tenant field/layout names with spaces + mixed case URL-encoded correctly
- [ ] Required-field / unique-value validation rejections surfaced to the user
- [ ] Container upload attempt → reported as out of scope (multipart vs JSON-only `connect_request`)
- [ ] Session-slot exhaustion under load → reuse one token, log out promptly

_See also: `documentation/connectors/README.md`; `02-api-spec-investigation.md` (clean dev API reference); `04-connection-and-reauth.md` (username-password session/token exchange & reauth); `01-llm-api-rules.md` (+ `01a`–`01d`) (the agent's runtime mental model)._
