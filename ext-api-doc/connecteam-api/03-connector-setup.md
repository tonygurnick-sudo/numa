---
api_name: Connecteam (API Key)
connector_id: connecteam-api
auth_type: api-key
tier: standard
category: HR & Workforce
integration_path: direct-api via connect_request (HTTP `numa integrations request`); NOT a Files connector
base_url: https://api.connecteam.com (fixed — NO instance/base-URL field)
credential_field: single `api_token` password field
shared_api: same REST API as connecteam-oauth; endpoint catalog/data models/agent rules (01*) identical, ONLY auth differs (X-API-KEY here vs OAuth bearer)
companions: 02=dev-spec, 04=connection-and-reauth
---

# Connecteam (API Key) — Connector & Integration Setup

How the `connecteam-api` connector is wired into Numa. **This connector already exists** in the registry — this reproduces and explains the **actual** entry.

## Integration Type

**Direct API via `connect_request`** (HTTP `numa integrations request`), NOT a Files connector. Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a browsable file tree, so no `list_files`/`download_file` mapping. The agent issues REST calls through `connect_request`, which injects the stored `api_token` as `X-API-KEY`. No Python `OAuthProvider` file-browser class required, and — because the key is static — no token-mint/refresh layer.

| Component                      | Required?        | Notes                                                                 |
| ------------------------------ | ---------------- | --------------------------------------------------------------------- |
| Connector Registry entry       | **Yes (exists)** | See §1                                                                |
| `credentialFields` array       | **Yes (exists)** | Single `api_token` password field                                     |
| OAuth config (`oauth` block)   | No               | Not OAuth — no `authUrl`/`tokenUrl`/`scopes`/`oauthSetupSteps`        |
| Backend `OAuthProvider` class  | No               | Direct-API connector — no `lib/oauth-providers/` class                |
| Workspace agent prompt (`01*`) | **Yes**          | `01-llm-api-rules.md` (+`01a`–`01d`) — loaded when integration active |
| `ext-api-doc/` deploy → S3     | **Yes**          | Synced to per-client S3 bucket at deploy — see §3                     |
| Feature flag                   | Yes              | `DATA_CONNECTORS_ENABLED` gates connectors + the secrets vault        |
| i18n keys                      | Reused           | Generic field labels (`dataConnectors.fields.*`); none new            |

## 1. Connector Registry Entry (actual)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Verbatim:

```typescript
{
  id: 'connecteam-api',
  displayName: 'Connecteam (API Key)',
  icon: 'bi-people',
  description: 'Employee management — time clock, scheduling, and forms (API key)',
  category: 'HR & Workforce',
  authType: 'api-key',
  baseUrl: 'https://api.connecteam.com',
  // Connecteam authenticates with a static X-API-KEY header, NOT
  // Authorization: Bearer. The map tells the generic request path
  // (connect_tools.do_request → _headers_from_fields) which user field
  // rides in which header. Persisted by ApiKeyWizard as credential_header_map.
  credentialHeaderMap: { 'X-API-KEY': 'api_token' },
  credentialFields: [
    { key: 'api_token', label: 'dataConnectors.fields.apiToken', type: 'password', placeholder: 'Paste your Connecteam API key', required: true },
  ],
},
```

| Field                             | Value                                                               | Notes                                                                                     |
| --------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                              | `connecteam-api`                                                    | Connector slug; matches this folder name + S3 key prefix                                  |
| `displayName`                     | `Connecteam (API Key)`                                              | Distinguishes from sibling `Connecteam (OAuth)` (`connecteam-oauth`)                      |
| `icon`                            | `bi-people`                                                         | Bootstrap Icons class (same as `connecteam-oauth`)                                        |
| `description`                     | `Employee management — time clock, scheduling, and forms (API key)` | Shown in the connector picker                                                             |
| `category`                        | `HR & Workforce`                                                    | Picker grouping                                                                           |
| `authType`                        | `api-key`                                                           | Drives the credential-field wizard (password inputs), **not** OAuth redirect              |
| `baseUrl`                         | `https://api.connecteam.com`                                        | Fixed single host; persisted to vault `base_url` so relative-path `request` calls resolve |
| `credentialHeaderMap`             | `{ 'X-API-KEY': 'api_token' }`                                      | Outbound-header → user-field map; backend builds `X-API-KEY: <api_token>` per request     |
| `credentialFields[0].key`         | `api_token`                                                         | Vault key the backend reads + injects as `X-API-KEY`                                      |
| `credentialFields[0].label`       | `dataConnectors.fields.apiToken`                                    | i18n key (reused generic label)                                                           |
| `credentialFields[0].type`        | `password`                                                          | Masked input — never displayed back                                                       |
| `credentialFields[0].placeholder` | `Paste your Connecteam API key`                                     | Inline hint                                                                               |
| `credentialFields[0].required`    | `true`                                                              | Mandatory; cannot save without it                                                         |

> **`credentialHeaderMap` is load-bearing.** Connecteam's auth header is `X-API-KEY` (verified: official docs, `curl --header 'X-API-KEY: YOUR_API_KEY'` against `https://api.connecteam.com/me`) — NOT `Authorization: Bearer`. Without `credentialHeaderMap`, the generic request path falls through to the token branch and emits `Authorization: Bearer <token>`, which Connecteam rejects (it only honours `X-API-KEY`). The map is config-only: `ApiKeyWizard` persists it as `credential_header_map` JSON on the `connector-config-connecteam-api` company secret, and `do_request` (`connect_tools.py` ~3112-3117) reads it at request time — **no backend redeploy needed**.
>
> **`baseUrl` is required for relative-path calls.** Base URL is **fixed** at `https://api.connecteam.com` — a single shared host, no per-tenant instance URL. The registry `baseUrl` is persisted to the vault as `base_url` by the wizard (`ApiKeyWizard.tsx:189`), so the agent can call `numa integrations request --connector connecteam-api --url /users/v1/users`. Without it, `_resolve_connector_base_url` returns `""` and relative paths error with "No base URL is configured"; the agent would have to pass an absolute URL on every call.

## 2. Sibling connector for cross-reference

Same file. OAuth sibling (`connecteam-oauth`) — same API, different auth:

```typescript
{
  id: 'connecteam-oauth',
  displayName: 'Connecteam (OAuth)',
  icon: 'bi-people',
  description: 'Employee management — time clock, scheduling, and forms (OAuth)',
  category: 'HR & Workforce',
  authType: 'oauth2',
  oauth: { authUrl: 'https://app.connecteam.com/oauth/authorize', tokenUrl: 'https://app.connecteam.com/oauth/token', scopes: 'forms.read attachments.write' },
  oauthSetupSteps: ['Go to Connecteam Developer Portal → Create an integration', 'Set the redirect URI to the value shown below', 'Copy the Client ID and Client Secret'],
},
```

Only intended divergence between the two folders' docs is the **auth** section: this connector attaches `X-API-KEY: {api_token}`; the OAuth connector mints + attaches `Authorization: Bearer {access_token}`. Keep `01a`/`01b`/`01c` in sync across both folders.

## 3. How these docs reach the workspace agent

`ext-api-doc/` markdown is **not** bundled into the agent image. Deployed to a per-client S3 bucket at infra-deploy time, read at runtime.
File: `infra/stacks/numa-client-stack.ts` (search `Sync ext-api-doc files to S3`, ~line 1135):

```typescript
const extApiDocPath = path.join(import.meta.dirname, '..', '..', 'ext-api-doc');
if (fs.existsSync(extApiDocPath)) {
  const mdFiles = fs
    .readdirSync(extApiDocPath, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.startsWith('.'))
    .map((f) => path.join(f.parentPath, f.name))
    .filter((source) => path.relative(extApiDocPath, source).split(path.sep)[0] !== '_templates'); // _templates dev-only
  for (const source of mdFiles) {
    const key = path.relative(extApiDocPath, source); // e.g. "connecteam-api/01-llm-api-rules.md"
    new S3Object(this, `ext-api-doc-${key.replace(/[^a-zA-Z0-9]/g, '-')}`, {
      bucket: core.extApiDocBucket.bucket.bucket,
      key,
      source,
      sourceHash: Fn.filemd5(source),
      contentType: 'text/markdown',
    });
  }
}
```

**For this connector:**

- Every file in `ext-api-doc/connecteam-api/` uploads to the client's `extApiDocBucket` under key `connecteam-api/<filename>` (folder name = connector `id`).
- `_templates/` excluded — never shipped.
- `sourceHash: Fn.filemd5(...)` → only changed files re-upload on the next deploy.
- When **Connecteam (API Key)** is active, the agent loads `connecteam-api/01-llm-api-rules.md` plus `01a`–`01d` companions to ground its API calls. The `00`/`02`/`03`/`04` files are developer-facing reference, **not** the agent's runtime context.

## 4. Workspace Agent Prompt Files

Shipped from this folder and loaded when the connector is active:

- `01-llm-api-rules.md` — main agent rules
- `01a-domain-model-reference.md` — entity catalog, relationships, state machines
- `01b-query-patterns.md` — read/filter/pagination patterns
- `01c-mutation-patterns.md` — create/update/delete patterns
- `01d-event-and-error-handling.md` — webhooks & error recovery

Developer reference (not runtime context): `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`, `03-connector-setup.md` (this file), `04-connection-and-reauth.md`.

**Consistency rule:** same API as `connecteam-oauth` — keep `01a`/`01b`/`01c` aligned across both folders; only the auth section in `01-llm-api-rules.md` differs (`X-API-KEY` here vs `Authorization: Bearer` there).

## 5. Deployment Checklist

**Registry & docs:**

- [x] Registry entry present (`connecteam-api`)
- [x] `credentialFields` populated (single `api_token` password field)
- [x] No `oauth` block / no `base_url` field (base URL fixed — correct)
- [x] `ext-api-doc/connecteam-api/` agent-rules files (`01*`) authored
- [ ] Keep `01a`/`01b`/`01c` in sync with `connecteam-oauth`

**Auth flow:**

- [ ] Admin/user pastes the Connecteam API key into `api_token` (see `04-connection-and-reauth.md`)
- [ ] Key stored in the vault; `connect_request` injects it as `X-API-KEY` on every proxied call
- [ ] `GET /me` smoke test returns 200 (verifies key + Expert-plan access)
- [ ] On 401/403: connector marked "needs reauthorization" → prompt for a fresh key (no auto-refresh — keys are static)
- [ ] Disconnect removes the stored `api_token`

**Functionality (via `connect_request`):**

- [ ] List users (`GET /users/v1/users`)
- [ ] Read time activities within the 92-day window
- [ ] List shifts for a scheduler over a date range (V2)
- [ ] List jobs (UUID ids; `paging` nested under `data`)
- [ ] List form submissions filtered by user/date (Enterprise plan only)
- [ ] Expert-plan (or higher) tenant confirmed — API gated below Expert; Forms Enterprise-only

**Deploy:**

- [ ] `ext-api-doc/connecteam-api/*` synced to `extApiDocBucket` on the next client deploy
- [ ] `DATA_CONNECTORS_ENABLED` enabled for the target client

## 6. Testing Plan

**Manual sequence:**

1. **Setup:** an account owner mints a key at **Settings → API Keys → Add API key**; paste into the `api_token` field.
2. **Smoke test:** "check the Connecteam connection" → `GET /me` returns 200.
3. **List users:** active employees → `GET /users/v1/users?userStatus=active`.
4. **Time activities:** last-30-days hours for a clock (within the 92-day cap).
5. **Shifts:** this pay-period's shifts on a scheduler (V2).
6. **Jobs:** job list → verify UUID ids + the `data.paging` location.
7. **Forms:** a form's recent submissions filtered by user (Enterprise).
8. **Reauth:** revoke the key → next call 401 → connector prompts for a new key (no auto-refresh).
9. **Disconnect:** disconnect → stored key removed.

**Edge cases:**

- [ ] Empty result sets / `< limit` last page
- [ ] 92-day window exceeded → rejection; chunk into ≤90-day ranges
- [ ] 429 on a low-tier plan → backoff via `x-ratelimit-minute-reset` (no `Retry-After`)
- [ ] 200 with `x-ratelimit-*-remaining: 0` (community-reported quirk) → throttle on the remaining headers
- [ ] Non-Expert plan → 403 (API gated); Forms on non-Enterprise → 403
- [ ] Mixed ID types (int users vs UUID jobs vs hex shifts) handled without coercion
- [ ] Invalid/revoked key mid-conversation → 401, surfaced as "reconnect required"

_Registry entry cited from `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Deploy mechanism from `infra/stacks/numa-client-stack.ts`. See also `04-connection-and-reauth.md` and `documentation/connectors/README.md`._
