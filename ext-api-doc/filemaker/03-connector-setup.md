---
api_name: 'Claris FileMaker Data API'
connector_id: 'filemaker'
auth_type: 'username-password'
tier: 'standard'
category: 'Database'
integration_path: 'direct-api' # Direct API via connect_request — NOT a Files connector
---

# Claris FileMaker — Connector & Integration Setup

> Build / wiring reference for the **Claris FileMaker** connector in Numa. This is a
> **Direct API via `connect_request`** connector (not a Files-Remote connector), so there is
> **no backend `OAuthProvider` class, no `list_files`/`download_file`, and no Files UI**. The
> registry entry below already exists in the codebase and is reproduced here as the source of
> truth.
>
> **Prerequisites:** Read `00-api-investigation-questionnaire.md`, `01-llm-api-rules.md`, and
> the [Numa Connectors documentation](../../documentation/connectors/README.md) first.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (registry `authType: 'username-password'`).

The workspace agent issues authenticated REST calls through Numa's `connect_request` proxy
using the four vaulted credentials. There is no file-browsing surface — FileMaker is
structured database data (records on layouts), not a document tree. This is the same
chat-only, spec-driven pattern as Podio / Zoho / Actionstep / Connecteam.

| Component                | Required?       | Notes                                                                                            |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------ |
| Connector Registry entry | Yes (✅ exists) | `id: 'filemaker'`, `authType: 'username-password'`, 4 credential fields — see §1                 |
| Admin setup wizard       | No (generic)    | The generic username-password credential form renders from `credentialFields`; no bespoke wizard |
| Backend provider class   | **No**          | Not a Files connector — no `lib/oauth-providers/` class, no `list_files`/`download_file`         |
| Workspace agent prompt   | Yes             | `01-llm-api-rules.md` (+ companions) — see §3 for the deploy path                                |
| Feature flag             | Yes (shared)    | `DATA_CONNECTORS_ENABLED` gates connectors + the Secrets Vault (per `numa-frontend/CLAUDE.md`)   |
| i18n keys                | Yes (shared)    | Field labels reuse shared `dataConnectors.fields.*` keys — see §4                                |

---

## 1. Connector Registry Entry (actual, already in the codebase)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> (in the "Tier 2: Username/Password" block).

This is the **verbatim** entry that ships today — reproduced, not invented:

```typescript
{
  id: 'filemaker',
  displayName: 'Claris FileMaker',
  icon: 'bi-database',
  description: 'Custom database application platform',
  category: 'Database',
  authType: 'username-password',
  credentialFields: [
    {
      key: 'server_url',
      label: 'dataConnectors.fields.serverUrl',
      type: 'url',
      placeholder: 'https://myserver.fmi.filemaker-cloud.com',
      required: true,
    },
    {
      key: 'username',
      label: 'dataConnectors.fields.username',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'dataConnectors.fields.password',
      type: 'password',
      placeholder: 'Enter your password',
      required: true,
    },
    {
      key: 'database',
      label: 'dataConnectors.fields.database',
      type: 'text',
      placeholder: 'MyDatabase',
      required: true,
      helpText: 'dataConnectors.fields.databaseHint',
    },
  ],
}
```

### Field-by-field

| `key`        | Type       | Required | Placeholder                                | Maps to / used for                                                                                                                                     |
| ------------ | ---------- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server_url` | `url`      | yes      | `https://myserver.fmi.filemaker-cloud.com` | The FileMaker Server / FileMaker Cloud host. Becomes the `{server_url}` in every base URL `https://{server_url}/fmi/data/vLatest/databases/{database}` |
| `username`   | `text`     | yes      | `admin`                                    | The FileMaker **account** name (needs the `fmrest` extended privilege). Half of the Basic login                                                        |
| `password`   | `password` | yes      | `Enter your password`                      | The account password. Other half of the Basic login. Stored as a secret in the user's vault                                                            |
| `database`   | `text`     | yes      | `MyDatabase`                               | The hosted `.fmp12` solution name → `{database}` path segment. Case-sensitive on some platforms                                                        |

> **What this implies for the backend.** Unlike a `token`/`api-key` connector (single vaulted
> secret used directly as a bearer), `username-password` here is the _input to a login round-trip_.
> The proxy must `POST .../sessions` with `Authorization: Basic base64(username:password)`,
> capture `response.token`, then send `Authorization: Bearer {token}` on every subsequent call,
> and **re-login on FileMaker error `952`**. The token is ephemeral and never persisted. See
> `04-connection-and-reauth.md` for the full session/token exchange.

### Notes on registry shape vs. the generic template

- The template's `03-connector-setup.template.md` cites `numa-frontend/src/Config/connectorRegistry.ts`. The **actual file in this codebase** is `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` — use that path.
- The actual entry uses `key` (not `name`), `label` as an **i18n key** (not literal text), and a `placeholder`. There is **no** `oauthConfig`, `cachingPolicy`, `apiReference`, or `tier` block on this entry — the generic template fields are not present, and you should not add them just to match the template.
- `icon: 'bi-database'` is a Bootstrap Icons class (not an SVG asset path).

---

## 2. Backend Provider Class

**Not applicable.** This is a Direct-API / `connect_request` connector, not a Files-Remote
connector. There is **no** `lib/oauth-providers/filemaker_provider.py`, no registration in
`lib/oauth-providers/__init__.py`, and no `list_files`/`download_file`/`search_files`/
`get_file_metadata` implementation. The workspace agent calls the FileMaker REST endpoints
directly through `connect_request`, guided by `01-llm-api-rules.md`.

The only "backend logic" specific to FileMaker is the **session/token lifecycle** the proxy
performs on the agent's behalf (Basic login → cache token → Bearer → re-login on `952`). That
is documented in `04-connection-and-reauth.md`, not implemented as a Files provider class.

---

## 3. Integration Prompt Deployment (ext-api-doc → S3 → agent)

The `ext-api-doc/filemaker/` markdown files are how the workspace agent learns this API. They
are **deployed to the per-client S3 outputs bucket by the client stack at deploy time** and
loaded into the workspace agent's context when the FileMaker connector is active.

**Deploy path:**

```
ext-api-doc/filemaker/01-llm-api-rules.md  (+ 01a–01d companions)
        │  bundled / uploaded during `make deploy`
        ▼
infra/stacks/numa-client-stack.ts   (S3 upload of ext-api-doc assets)
        │
        ▼
s3://numa-{client}-outputs/...      (per-client outputs bucket)
        │  fetched at runtime when the connector is active
        ▼
numa-workspace-agent                (loads 01-*.md into agent context)
```

**Files that ship to the agent:**

| File                              | Loaded? | Role                                                                                     |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `01-llm-api-rules.md`             | Yes     | Main rules (< 300 lines) — auth, capabilities, gotchas, default params, working examples |
| `01a-domain-model-reference.md`   | Yes     | Structural entities + the runtime **discovery procedure** (no fixed schema)              |
| `01b-query-patterns.md`           | Yes     | `_find` operators, sort, pagination, worked reads                                        |
| `01c-mutation-patterns.md`        | Yes     | create / edit / delete, `modId`, scripts, globals                                        |
| `01d-event-and-error-handling.md` | Yes     | No events; polling; full error playbook                                                  |
| `00-…`, `02-…`, `03-…`, `04-…`    | No      | Developer/build docs — **not** loaded into the agent; they live in the repo for humans   |

> Only the `01-*.md` family is the agent's runtime context. The `00`/`02`/`03`/`04` files
> (this one included) are developer references and are not pushed into the agent prompt.

---

## 4. i18n Keys

FileMaker reuses **shared** data-connector field labels (referenced by the registry as
`label: 'dataConnectors.fields.*'`), so no connector-specific label keys are needed. Confirm
these exist in `numa-frontend/src/locales/en/integrations.json` (or the relevant connector
namespace):

```json
{
  "dataConnectors.fields.serverUrl": "Server URL",
  "dataConnectors.fields.username": "Username",
  "dataConnectors.fields.password": "Password",
  "dataConnectors.fields.database": "Database",
  "dataConnectors.fields.databaseHint": "The hosted FileMaker database (.fmp12) name, e.g. MyDatabase"
}
```

`databaseHint` is the only field with a `helpText` in the entry. If a connector-specific
display name / description is wanted, add `connectors.filemaker.displayName` /
`connectors.filemaker.description`, but the registry currently uses literal `displayName:
'Claris FileMaker'` / `description: 'Custom database application platform'`.

---

## 5. Deployment Checklist

> Files-connector items (provider class, `list_files`, Files Remote UI) are **N/A** here.

### Code

- [x] Registry entry present in `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (already shipped)
- [x] Icon set (`bi-database` Bootstrap Icon — no SVG asset needed)
- [ ] Shared `dataConnectors.fields.*` i18n keys present (incl. `databaseHint`)
- [ ] `01-llm-api-rules.md` (+ `01a`–`01d` companions) written and committed
- [ ] `ext-api-doc/filemaker/01-*.md` included in the client-stack S3 asset upload

### Auth / session lifecycle (the FileMaker-specific work)

- [ ] User connect flow stores `server_url` + `username` + `password` + `database` in the user's vault (secret = `password`)
- [ ] `connect_request` proxy performs Basic login (`POST .../sessions`) and caches the token within its 15-min window
- [ ] Proxy sends `Authorization: Bearer {token}` on subsequent calls
- [ ] Proxy detects FileMaker error `952` (in `messages[].code`) → re-login and retry once
- [ ] Proxy treats HTTP 200 with non-`"0"` `messages[].code` as a logical error (NOT success)
- [ ] User disconnect deletes the user's vaulted credentials

### Workspace Agent

- [ ] Agent loads `01-llm-api-rules.md` when the FileMaker connector is active
- [ ] Agent runs discovery (`GET .../layouts`, `GET .../layouts/{layout}`, `GET .../scripts`) before any read/write
- [ ] Agent can read/query (`GET records`, `POST _find`), respecting offset/limit + FileMaker operators
- [ ] Agent can create/edit/delete single records, respecting `modId` and field validation
- [ ] Agent can run named FileMaker scripts for bulk/complex ops
- [ ] Agent treats FileMaker code `401` (no matches) as an empty result, not a failure

### CI/CD

- [ ] No new Lambda (Direct API via existing `connect_request` proxy) — confirm no `.gitlab-ci.yml` / `package-all.sh` change is required

---

## 6. Testing Plan

> There is no Claris-operated sandbox — every FileMaker server is a private, per-tenant
> install. Real testing requires a reachable FileMaker Server / FileMaker Cloud instance with
> the Data API enabled and an account holding the `fmrest` extended privilege.

### Manual testing sequence

1. **Connect:** As a user, add the FileMaker connector with `server_url`, `username`, `password`, `database`. Confirm the credentials store in the vault.
2. **Login round-trip:** Trigger any agent call; confirm the proxy mints a token (`POST .../sessions` → `response.token`) and uses `Bearer {token}`.
3. **Discover:** Ask the agent to "list the layouts" → `GET .../layouts`. Then "show fields on layout X" → `GET .../layouts/{layout}`.
4. **Read (browse):** "Show the first 20 records on layout X" → `GET .../records?_offset=1&_limit=20`. Confirm pagination via `dataInfo`.
5. **Read (query):** "Find records where Stock < 40, newest first" → `POST .../_find`. Confirm `foundCount` and that an empty find returns FileMaker code `401` (reported as "no matches", not an error).
6. **Create / edit / delete:** Round-trip a record; confirm `recordId` returned on create, `modId` bumps on edit, optimistic-lock rejection on stale `modId`.
7. **Script:** Run a named FileMaker script via `GET .../script/{name}`.
8. **Token expiry:** Idle > 15 min, then make a call; confirm the proxy sees `952`, re-logs in, and retries once transparently.
9. **Disconnect:** Remove the connector; confirm vaulted credentials are deleted.

### Edge cases

- [ ] HTTP 200 with `messages[].code != "0"` handled as a logical error
- [ ] FileMaker `401` (no matches) vs HTTP `401` (bad Basic credentials) distinguished
- [ ] `952` token expiry → silent re-login + single retry
- [ ] Calculation/summary field sent in `fieldData` → rejected (validation error)
- [ ] Tenant field/layout names with spaces and mixed case URL-encoded correctly
- [ ] Required-field / unique-value validation rejections surfaced to the user
- [ ] Container upload attempt → reported as out of scope (multipart vs JSON-only `connect_request`)
- [ ] Session-slot exhaustion under load → reuse one token, log out promptly

---

_Generated from `00-api-investigation-questionnaire.md` and the live registry entry. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _`02-api-spec-investigation.md` — clean dev API reference_
- _`04-connection-and-reauth.md` — username-password session/token exchange & reauth_
- _`01-llm-api-rules.md` (+ `01a`–`01d`) — the agent's runtime mental model_
