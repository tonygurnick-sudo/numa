---
api_name: Motion
connector_id: motion
auth_type: api-key
tier: standard
category: Productivity & Project Management
integration_path: direct-api via connect_request (HTTP `numa integrations request`); NOT a Files connector
base_url: https://api.usemotion.com/v1 (fixed — NO instance/base-URL field)
credential_field: single `api_token` password field
companions: 02=dev-spec, 04=connection-and-reauth
---

# Motion — Connector & Integration Setup

How the `motion` connector is wired into Numa.

## Integration Type

**Direct API via `connect_request`** (HTTP `numa integrations request`), NOT a Files connector. Motion exposes **records** (tasks, projects, workspaces, comments), not a browsable file tree, so there's no `list_files`/`download_file` mapping. The agent issues REST calls through `connect_request`, which injects the stored `api_token` as the `X-API-Key` header. No Python `OAuthProvider` file-browser class, and — because the key is static — no token-mint/refresh layer.

| Component                      | Required? | Notes                                                                 |
| ------------------------------ | --------- | --------------------------------------------------------------------- |
| Connector Registry entry       | **Yes**   | See §1                                                                |
| `credentialFields` array       | **Yes**   | Single `api_token` password field                                     |
| `credentialHeaderMap`          | **Yes**   | `{ 'X-API-Key': 'api_token' }` — load-bearing (Motion rejects Bearer) |
| OAuth config (`oauth` block)   | No        | Not OAuth — no `authUrl`/`tokenUrl`/`scopes`                          |
| Backend `OAuthProvider` class  | No        | Direct-API connector — no `lib/oauth-providers/` class                |
| Workspace agent prompt (`01*`) | **Yes**   | `01-llm-api-rules.md` (+`01a`–`01d`) — loaded when integration active |
| `ext-api-doc/` deploy → S3     | **Yes**   | Synced to the per-client S3 bucket at deploy — see §3                 |
| Feature flag                   | Yes       | `DATA_CONNECTORS_ENABLED` gates connectors + the secrets vault        |
| i18n keys                      | Reused    | Generic field labels (`dataConnectors.fields.*`); none new            |

## 1. Connector Registry Entry

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Proposed entry:

```typescript
{
  id: 'motion',
  displayName: 'Motion',
  icon: 'bi-calendar-check',
  description: 'AI task & project management — tasks, projects, schedules (API key)',
  category: 'Productivity & Project Management',
  authType: 'api-key',
  baseUrl: 'https://api.usemotion.com/v1',
  // Motion authenticates with a static X-API-Key header, NOT
  // Authorization: Bearer. The map tells the generic request path
  // (connect_tools.do_request → _headers_from_fields) which user field
  // rides in which header. Persisted by ApiKeyWizard as credential_header_map.
  credentialHeaderMap: { 'X-API-Key': 'api_token' },
  credentialFields: [
    { key: 'api_token', label: 'dataConnectors.fields.apiToken', type: 'password', placeholder: 'Paste your Motion API key', required: true },
  ],
},
```

| Field                          | Value                                                                 | Notes                                                                                     |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                           | `motion`                                                              | Connector slug; matches this folder name + S3 key prefix                                  |
| `displayName`                  | `Motion`                                                              | Shown in the connector picker                                                             |
| `icon`                         | `bi-calendar-check`                                                   | Bootstrap Icons class (calendar-led product)                                              |
| `description`                  | `AI task & project management — tasks, projects, schedules (API key)` | Picker subtitle                                                                           |
| `category`                     | `Productivity & Project Management`                                   | Picker grouping                                                                           |
| `authType`                     | `api-key`                                                             | Drives the credential-field wizard (password input), **not** an OAuth redirect            |
| `baseUrl`                      | `https://api.usemotion.com/v1`                                        | Fixed single host; persisted to vault `base_url` so relative-path `request` calls resolve |
| `credentialHeaderMap`          | `{ 'X-API-Key': 'api_token' }`                                        | Outbound-header → user-field map; backend builds `X-API-Key: <api_token>` per request     |
| `credentialFields[0].key`      | `api_token`                                                           | Vault key the backend reads + injects as `X-API-Key`                                      |
| `credentialFields[0].type`     | `password`                                                            | Masked input — never displayed back                                                       |
| `credentialFields[0].required` | `true`                                                                | Mandatory; cannot save without it                                                         |

> **`credentialHeaderMap` is load-bearing.** Motion's auth header is **`X-API-Key`** (verified: official docs, `curl -H "X-API-Key: YOUR_API_KEY" https://api.usemotion.com/v1/workspaces`) — **NOT** `Authorization: Bearer`. Without `credentialHeaderMap`, the generic request path falls through to the token branch and emits `Authorization: Bearer <token>`, which Motion rejects (it only honours `X-API-Key`). The map is config-only: `ApiKeyWizard` persists it as `credential_header_map` JSON on the `connector-config-motion` company secret, and `do_request` (`connect_tools.py`) reads it at request time — **no backend redeploy needed**.
>
> **`baseUrl` is required for relative-path calls.** Base URL is **fixed** at `https://api.usemotion.com/v1` — a single shared host, no per-tenant instance URL. The registry `baseUrl` is persisted to the vault as `base_url` by the wizard, so the agent can call `numa integrations request --connector motion --url /tasks`. Without it, relative paths error with "No base URL is configured."
>
> ⚠️ **The `/v1` is in `baseUrl`** — agent paths must NOT start with `/v1` (would double it). And **Custom Fields are on `/beta`**, not `/v1` — the agent passes an absolute `https://api.usemotion.com/beta/…` URL for those (documented in `01`/`01c`).

## 2. Per-user credential model (no admin-supplied secret)

Motion keys are **per user**. Unlike OAuth, there is no admin step that supplies a shared client credential. The admin simply **adds the connector** (and any metadata); each end user pastes **their own** Motion API key into `api_token`, captured in chat and stored in that user's vault. The key carries only that user's Motion permissions — a `403` means the user lacks access, not a bad key.

## 3. How these docs reach the workspace agent

`ext-api-doc/` markdown is **not** bundled into the agent image. It's deployed to a per-client S3 bucket at infra-deploy time and read at runtime.
File: `infra/stacks/numa-client-stack.ts` (search `Sync ext-api-doc files to S3`):

```typescript
const extApiDocPath = path.join(import.meta.dirname, '..', '..', 'ext-api-doc');
// ... every non-_templates file uploads to extApiDocBucket under key "<connector-id>/<filename>"
```

**For this connector:**

- Every file in `ext-api-doc/motion/` uploads to the client's `extApiDocBucket` under key `motion/<filename>` (folder name = connector `id`).
- `_templates/` is excluded — never shipped.
- `sourceHash: Fn.filemd5(...)` → only changed files re-upload on the next deploy.
- When **Motion** is active, the agent loads `motion/01-llm-api-rules.md` plus `01a`–`01d`. The `00`/`02`/`03`/`04` files are developer-facing reference, **not** the agent's runtime context.

## 4. Workspace Agent Prompt Files

Shipped from this folder, loaded when the connector is active:

- `01-llm-api-rules.md` — main agent rules (auth, the rate-limit discipline, paths, operations)
- `01a-domain-model-reference.md` — entity catalog, relationships, business rules
- `01b-query-patterns.md` — read/filter/pagination patterns
- `01c-mutation-patterns.md` — create/update/delete/move patterns
- `01d-event-and-error-handling.md` — polling (no webhooks) & error recovery + rate-limit backoff

Developer reference (not runtime context): `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`, `03-connector-setup.md` (this file), `04-connection-and-reauth.md`.

## 5. Deployment Checklist

**Registry & docs:**

- [ ] Registry entry added (`motion`) with `credentialHeaderMap: { 'X-API-Key': 'api_token' }`
- [ ] `credentialFields` populated (single `api_token` password field)
- [ ] No `oauth` block; `baseUrl` set to `https://api.usemotion.com/v1`
- [x] `ext-api-doc/motion/` agent-rules files (`01*`) authored

**Auth flow:**

- [ ] User pastes their Motion API key into `api_token` (see `04-connection-and-reauth.md`)
- [ ] Key stored in the vault; `connect_request` injects it as `X-API-Key` on every proxied call
- [ ] `GET /users/me` smoke test returns 200 (verifies the key)
- [ ] On 401/403: connector marked "needs reauthorization" → prompt for a fresh key (no auto-refresh — keys are static)
- [ ] Disconnect removes the stored `api_token`

**Functionality (via `connect_request`):**

- [ ] `GET /workspaces` (discover workspace ids first)
- [ ] List tasks scoped by `workspaceId` (+ filters)
- [ ] Create a task (`name`+`workspaceId`), then verify with a GET
- [ ] Get statuses for a workspace (`GET /statuses?workspaceId=…`)
- [ ] Cursor pagination handled (`meta.nextCursor`)
- [ ] **Rate-limit pacing verified** — calls serialized, 429 backoff works (12/min individual!)

**Deploy:**

- [ ] `ext-api-doc/motion/*` synced to `extApiDocBucket` on the next client deploy
- [ ] `DATA_CONNECTORS_ENABLED` enabled for the target client

## 6. Testing Plan

**Manual sequence:**

1. **Setup:** user mints a key in Motion → **Settings → API** (copy it — shown once); paste into the `api_token` field.
2. **Smoke test:** "check the Motion connection" → `GET /users/me` returns 200.
3. **Workspaces:** `GET /workspaces` → capture a `workspaceId`.
4. **Tasks:** `GET /tasks?workspaceId=…&status=To Do` → list open tasks.
5. **Create:** create a task with `name`+`workspaceId`; verify with `GET /tasks/{id}`.
6. **Statuses:** `GET /statuses?workspaceId=…`.
7. **Pagination:** force a multi-page list, follow `meta.nextCursor` to the last page.
8. **Rate limit:** issue a tight burst on an individual key → confirm 429, confirm the agent backs off (no `Retry-After`) instead of hammering.
9. **Reauth:** revoke the key → next call 401 → connector prompts for a new key (no auto-refresh).
10. **Disconnect:** disconnect → stored key removed.

**Edge cases:**

- [ ] Empty result sets / `meta.nextCursor: null` last page
- [ ] `status` + `includeAllStatuses` sent together → 400
- [ ] 429 on an individual key → exponential backoff (no `Retry-After`)
- [ ] Custom Fields on `/beta` (absolute URL) vs core `/v1`
- [ ] Move task POST vs PATCH (405 fallback)
- [ ] Opaque ids handled without coercion; ISO-8601 timestamps parsed (not epoch)
- [ ] 403 on a workspace the user can't access (per-user perms), surfaced clearly

_Deploy mechanism from `infra/stacks/numa-client-stack.ts`. Registry pattern from `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (see the `connecteam-api` sibling for the api-key wizard pattern). See also `04-connection-and-reauth.md` and `documentation/connectors/README.md`._
