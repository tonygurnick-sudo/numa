---
api_name: 'Connecteam (API Key)'
connector_id: 'connecteam-api'
auth_type: 'api-key'
tier: 'standard'
category: 'HR & Workforce'
integration_path: 'direct-api'
---

# Connecteam (API Key) -- Connector & Integration Setup

> How the `connecteam-api` connector is wired into Numa. **This connector already exists**
> in the registry — this document reproduces and explains the **actual** entry rather than
> proposing a new one.
>
> **Shared API:** This is the same REST API as `connecteam-oauth`. The endpoint catalog,
> data models, and agent rules (`01*.md`) are identical; **only the auth differs** (a static
> `X-API-KEY` header here vs an OAuth bearer token). See
> `connecteam-api/02-api-spec-investigation.md` for the dev reference and
> `connecteam-api/04-connection-and-reauth.md` for the API-key setup/rotation detail.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (not a Files connector).

Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a
browsable file tree, so there is no `list_files`/`download_file` mapping. The workspace agent
issues REST calls through Numa's `connect_request` proxy, which injects the stored `api_token` as
the `X-API-KEY` header. No Python `OAuthProvider` file-browser class is required, and — because the
key is a static secret — there is no token-mint/refresh layer (the simplest of the two Connecteam
connectors to operate).

| Component                      | Required?        | Notes                                                                         |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| Connector Registry entry       | **Yes (exists)** | Already present — see §1 below                                                |
| `credentialFields` array       | **Yes (exists)** | Single `api_token` password field in the registry entry                       |
| OAuth config (`oauth` block)   | No               | Not an OAuth connector — no `authUrl`/`tokenUrl`/`scopes`/`oauthSetupSteps`   |
| Backend `OAuthProvider` class  | No               | Direct-API connector — not a Files browser; no `lib/oauth-providers/` class   |
| Workspace agent prompt (`01*`) | **Yes**          | `01-llm-api-rules.md` (+ `01a`–`01d`) — loaded when the integration is active |
| `ext-api-doc/` deploy → S3     | **Yes**          | These docs are synced to the per-client S3 bucket at deploy — see §3          |
| Feature flag                   | Yes              | `DATA_CONNECTORS_ENABLED` gates connectors + the secrets vault                |
| i18n keys                      | Reused           | Generic connector field labels (`dataConnectors.fields.*`); none new          |

---

## 1. Connector Registry Entry (actual)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

This is the **real, current** entry (not a template). Reproduced verbatim from source:

```typescript
{
  id: 'connecteam-api',
  displayName: 'Connecteam (API Key)',
  icon: 'bi-people',
  description: 'Employee management — time clock, scheduling, and forms (API key)',
  category: 'HR & Workforce',
  authType: 'api-key',
  credentialFields: [
    {
      key: 'api_token',
      label: 'dataConnectors.fields.apiToken',
      type: 'password',
      placeholder: 'Paste your Connecteam API key',
      required: true,
    },
  ],
},
```

**Field-by-field:**

| Field                             | Value                                                               | Notes                                                                                            |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                              | `connecteam-api`                                                    | Connector slug; matches this `ext-api-doc/` folder name and the S3 key prefix.                   |
| `displayName`                     | `Connecteam (API Key)`                                              | Distinguishes it from the sibling `Connecteam (OAuth)` (`connecteam-oauth`).                     |
| `icon`                            | `bi-people`                                                         | Bootstrap Icons class (same icon as `connecteam-oauth`).                                         |
| `description`                     | `Employee management — time clock, scheduling, and forms (API key)` | Shown in the connector picker.                                                                   |
| `category`                        | `HR & Workforce`                                                    | Picker grouping.                                                                                 |
| `authType`                        | `api-key`                                                           | Drives the credential-field wizard (free-text/password inputs), **not** the OAuth redirect flow. |
| `credentialFields[0].key`         | `api_token`                                                         | Vault key the relay reads and injects as the `X-API-KEY` header.                                 |
| `credentialFields[0].label`       | `dataConnectors.fields.apiToken`                                    | i18n key for the field label (reused generic connector label).                                   |
| `credentialFields[0].type`        | `password`                                                          | Masked input — the key is a secret, never displayed back.                                        |
| `credentialFields[0].placeholder` | `Paste your Connecteam API key`                                     | Inline hint in the input.                                                                        |
| `credentialFields[0].required`    | `true`                                                              | The key is mandatory; the connector cannot save without it.                                      |

> **No `oauth` block and no `base_url`/`instance_url` field.** Unlike the sibling `connecteam-oauth`
> (which carries an `oauth` block) and unlike the HireHop / Total Synergy API-key entries (which add
> a second `base_url`/`instance_url` field), this connector needs **only** the single `api_token`.
> The base URL is **fixed** at `https://api.connecteam.com` — Connecteam is a single shared host with
> no per-tenant instance URL.

---

## 2. Sibling connector for cross-reference

> Same file: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

For comparison, the OAuth sibling (`connecteam-oauth`) — same API, different auth:

```typescript
{
  id: 'connecteam-oauth',
  displayName: 'Connecteam (OAuth)',
  icon: 'bi-people',
  description: 'Employee management — time clock, scheduling, and forms (OAuth)',
  category: 'HR & Workforce',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://app.connecteam.com/oauth/authorize',
    tokenUrl: 'https://app.connecteam.com/oauth/token',
    scopes: 'forms.read attachments.write',
  },
  oauthSetupSteps: [
    'Go to Connecteam Developer Portal → Create an integration',
    'Set the redirect URI to the value shown below',
    'Copy the Client ID and Client Secret',
  ],
},
```

The only intended divergence between the two folders' docs is the **auth** section: this connector
attaches `X-API-KEY: {api_token}`; the OAuth connector mints and attaches `Authorization: Bearer
{access_token}`. Keep the `01a`/`01b`/`01c` agent-rules companions in sync across both folders.

---

## 3. How these docs reach the workspace agent

The `ext-api-doc/` markdown is **not** bundled into the agent image. It is deployed to a per-client
S3 bucket at infrastructure-deploy time and read at runtime.

> File: `infra/stacks/numa-client-stack.ts` (search `Sync ext-api-doc files to S3`, ~line 1135)

```typescript
// ── Sync ext-api-doc files to S3 (at END to avoid resource address shifts) ──
const extApiDocPath = path.join(import.meta.dirname, '..', '..', 'ext-api-doc');
if (fs.existsSync(extApiDocPath)) {
  const mdFiles = fs
    .readdirSync(extApiDocPath, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.startsWith('.'))
    .map((f) => path.join(f.parentPath, f.name))
    // _templates/ is dev-only reference material; do not ship to client stacks.
    .filter((source) => path.relative(extApiDocPath, source).split(path.sep)[0] !== '_templates');

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

**What this means for this connector:**

- Every file in `ext-api-doc/connecteam-api/` is uploaded to the client's `extApiDocBucket`
  under the key `connecteam-api/<filename>` (the folder name = the connector `id`).
- `_templates/` is explicitly excluded, so the template files are never shipped.
- `sourceHash: Fn.filemd5(...)` means only changed files re-upload on the next deploy.
- When the **Connecteam (API Key)** integration is active, the workspace agent loads
  `connecteam-api/01-llm-api-rules.md` (the < 300-line agent rules) plus its `01a`–`01d`
  companions from this bucket to ground its API calls. The `00`/`02`/`03`/`04` files are
  developer-facing reference and are **not** the agent's primary runtime context.

---

## 4. Workspace Agent Prompt Files

Shipped from this folder and loaded when the connector is active:

- `01-llm-api-rules.md` — main agent rules (< 300 lines)
- `01a-domain-model-reference.md` — entity catalog, relationships, state machines
- `01b-query-patterns.md` — read/filter/pagination patterns
- `01c-mutation-patterns.md` — create/update/delete patterns
- `01d-event-and-error-handling.md` — webhooks & error recovery

Developer reference (not the agent's runtime context): `00-api-investigation-questionnaire.md`,
`02-api-spec-investigation.md`, `03-connector-setup.md` (this file), `04-connection-and-reauth.md`.

**Consistency rule:** because this is the same API as `connecteam-oauth`, keep `01a`/`01b`/`01c`
aligned across the two folders; only the auth section in `01-llm-api-rules.md` should differ
(`X-API-KEY` here vs `Authorization: Bearer` there).

---

## 5. Deployment Checklist

### Registry & docs

- [x] Registry entry present in `connectorRegistry.ts` (`connecteam-api`)
- [x] `credentialFields` populated (single `api_token` password field)
- [x] No `oauth` block / no `base_url` field (base URL is fixed — correct for this connector)
- [x] `ext-api-doc/connecteam-api/` agent-rules files (`01*`) authored
- [ ] Keep `01a`/`01b`/`01c` in sync with `connecteam-oauth`

### Auth flow

- [ ] Admin/user pastes the Connecteam API key into the `api_token` field (see `04-connection-and-reauth.md`)
- [ ] Key stored in the vault; `connect_request` injects it as `X-API-KEY` on every proxied call
- [ ] `GET /me` smoke test returns 200 (verifies the key + Expert-plan access)
- [ ] On 401/403: connector marked "needs reauthorization" → prompt for a fresh key (no auto-refresh — keys are static)
- [ ] Disconnect removes the stored `api_token`

### Functionality (via `connect_request`)

- [ ] Agent lists users (`GET /users/v1/users`)
- [ ] Agent reads time activities within the 92-day window
- [ ] Agent lists shifts for a scheduler over a date range (V2)
- [ ] Agent lists jobs (UUID ids; `paging` nested under `data`)
- [ ] Agent lists form submissions filtered by user/date (Enterprise plan only)
- [ ] Expert-plan (or higher) tenant confirmed — the API is gated below Expert; Forms is Enterprise-only

### Deploy

- [ ] `ext-api-doc/connecteam-api/*` synced to `extApiDocBucket` on the next client deploy
- [ ] `DATA_CONNECTORS_ENABLED` enabled for the target client

---

## 6. Testing Plan

### Manual sequence

1. **Setup:** in the Connecteam web app, an account owner mints a key at **Settings → API Keys → Add API key**; paste it into the connector's `api_token` field.
2. **Smoke test:** ask the agent to "check the Connecteam connection" → `GET /me` returns 200.
3. **List users:** ask for active employees → `GET /users/v1/users?userStatus=active`.
4. **Time activities:** ask for last-30-days hours for a clock (within the 92-day cap).
5. **Shifts:** ask for this pay-period's shifts on a scheduler (V2).
6. **Jobs:** ask for the job list → verify UUID ids and the `data.paging` location.
7. **Forms:** ask for a form's recent submissions filtered by user (Enterprise plan).
8. **Reauth:** revoke the key in Connecteam → next call 401 → confirm the connector prompts for a new key (no auto-refresh).
9. **Disconnect:** disconnect and verify the stored key is removed.

### Edge cases

- [ ] Empty result sets / `< limit` last page
- [ ] 92-day window exceeded → expect rejection; chunk into ≤ 90-day ranges
- [ ] Rate-limit 429 on a low-tier plan → backoff via `x-ratelimit-minute-reset` (no `Retry-After`)
- [ ] 200 with `x-ratelimit-*-remaining: 0` (community-reported quirk) → throttle on the remaining headers
- [ ] Non-Expert plan → 403 (API gated); Forms request on non-Enterprise → 403
- [ ] Mixed ID types (int users vs UUID jobs vs hex shifts) handled without coercion
- [ ] Invalid/revoked key mid-conversation → 401, surfaced as "reconnect required"

---

_Generated from the investigation questionnaire. Registry entry cited from_
_`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Deploy mechanism cited from_
_`infra/stacks/numa-client-stack.ts`. See also `04-connection-and-reauth.md` and the_
_[Connector Framework Documentation](../../documentation/connectors/README.md)._
