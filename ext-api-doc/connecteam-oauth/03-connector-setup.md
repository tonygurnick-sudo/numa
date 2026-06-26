---
api_name: Connecteam API (OAuth)
connector_id: connecteam-oauth
auth_type: oauth2
tier: standard
category: HR & Workforce
integration_path: direct-api (HTTP via connect_request; NOT a Files connector)
shared_api: same REST API as connecteam-api (API-key); only auth differs
companions: 02=dev spec, 04=connection/reauth
---

# Connecteam (OAuth) — Connector & Integration Setup

> ⚠️ **DISPOSITION (TASK-113): this connector is NOT self-service — see `05-disposition.md`.**
> Connecteam's official OAuth 2.0 is **`client_credentials` only** (no consent endpoint, no
> redirect, no refresh token); the registry's `authorization_code` `authUrl`/`tokenUrl` are
> phantom endpoints that do not exist. The connector is being set to `selfService: false` and
> removed from the self-service catalogs. **Use the API-key connector (`connecteam-api`) — the
> same REST API, config-only, working today.** The wiring described below documents the _former_
> (incorrect) self-service intent and is retained only for context.

How the `connecteam-oauth` connector is wired into Numa. **This connector already exists** in the registry — this reproduces and explains the **actual** entry rather than proposing a new one.

## Integration Type

**Direct API via `connect_request`** (not a Files connector). Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a browsable file tree — no `list_files`/`download_file` mapping. The agent issues REST calls through `connect_request`, which injects the OAuth bearer token from the user's vault. No Python `OAuthProvider` file-browser class is required.

| Component                      | Required?        | Notes                                                                          |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------ |
| Connector Registry entry       | **Yes (exists)** | §1                                                                             |
| OAuth config (`oauth` block)   | **Yes (exists)** | `authUrl`/`tokenUrl`/`scopes` in the registry entry                            |
| `oauthSetupSteps`              | **Yes (exists)** | Admin wizard text for registering the OAuth app                                |
| Backend `OAuthProvider` class  | No               | Direct-API connector — not a Files browser; no `lib/oauth-providers/` class    |
| Workspace agent prompt (`01*`) | **Yes**          | `01-llm-api-rules.md` (+ `01a`–`01d`) — loaded when the integration is active  |
| `ext-api-doc/` deploy → S3     | **Yes**          | Synced to the per-client S3 bucket at deploy — §3                              |
| Feature flag                   | Yes              | `DATA_CONNECTORS_ENABLED` gates connectors + the secrets vault                 |
| i18n keys                      | Reused           | Generic connector field labels (`dataConnectors.fields.*`); none new for OAuth |

## 1. Connector Registry Entry (actual)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Reproduced verbatim:

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

**Field notes** (values above):
| Field | Notes |
| --- | --- |
| `id` | Connector slug; matches this `ext-api-doc/` folder and the S3 key prefix |
| `displayName` | Distinguishes from sibling `Connecteam (API Key)` (`connecteam-api`) |
| `icon` | Bootstrap Icons (same as `connecteam-api`) |
| `description`/`category` | Shown / grouped in the connector picker |
| `authType` | `oauth2` drives the redirect-based OAuth wizard (vs `api-key`/`token` credential-field wizards) |
| `oauth.authUrl` | ⚠️ **Unverified** — see Auth conflict below |
| `oauth.tokenUrl` | ⚠️ **Unverified** — official docs use `https://api.connecteam.com/oauth/v1/token` |
| `oauth.scopes` | Space-delimited. `attachments.write` is a **write** scope — reconsider for read-only chat |
| `oauthSetupSteps` | Rendered in the admin OAuth-app-registration wizard |

> No `credentialFields` array — for `oauth2` connectors the wizard collects Client ID + Secret via the OAuth flow, not free-text fields. (Contrast `connecteam-api`, which has a single `api_token` password field.)

### ⚠️ Auth conflict (carry-over from investigation)

The registry's `oauth` block implies an `authorization_code` flow (it has an `authUrl`). The **official Connecteam OAuth 2.0 docs document `client_credentials` only**, token endpoint `https://api.connecteam.com/oauth/v1/token`, HTTP Basic client auth — **no consent/redirect step**. The `app.connecteam.com/oauth/*` endpoints could not be verified against any official page and may be placeholders.

**Action before build:** confirm with Connecteam whether a 3-legged `authorization_code` flow exists. If only `client_credentials` is available, this connector overlaps heavily with `connecteam-api` and the registry config must be corrected (or the connector reframed). Full detail in `04-connection-and-reauth.md` §"Open conflict". Do not treat the registry's auth endpoints as correct until verified.

## 2. Sibling connector for cross-reference

Same file. The API-key sibling (`connecteam-api`) — same API, different auth:

```typescript
{
  id: 'connecteam-api',
  displayName: 'Connecteam (API Key)',
  icon: 'bi-people',
  description: 'Employee management — time clock, scheduling, and forms (API key)',
  category: 'HR & Workforce',
  authType: 'api-key',
  credentialFields: [
    { key: 'api_token', label: 'dataConnectors.fields.apiToken', type: 'password', placeholder: 'Paste your Connecteam API key', required: true },
  ],
},
```

Keep the `01*` agent-rules files for the two folders in sync — only their auth sections diverge.

## 3. How these docs reach the workspace agent

`ext-api-doc/` markdown is **not** bundled into the agent image. It is deployed to a per-client S3 bucket at infra-deploy time and read at runtime. File: `infra/stacks/numa-client-stack.ts` (search `Sync ext-api-doc files to S3`, ~line 1135):

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
    const key = path.relative(extApiDocPath, source); // e.g. "connecteam-oauth/01-llm-api-rules.md"
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

- Every file in `ext-api-doc/connecteam-oauth/` uploads to the client's `extApiDocBucket` under key `connecteam-oauth/<filename>` (folder name = connector `id`).
- `_templates/` is excluded — template files never ship.
- `sourceHash: Fn.filemd5(...)` → only changed files re-upload on the next deploy.
- When the **Connecteam (OAuth)** integration is active, the agent loads `connecteam-oauth/01-llm-api-rules.md` plus its `01a`–`01d` companions from this bucket to ground its API calls. The `00`/`02`/`03`/`04` files are developer-facing and not the agent's primary runtime context.

## 4. Workspace Agent Prompt Files

Shipped from this folder and loaded when the connector is active:

- `01-llm-api-rules.md` — main agent rules
- `01a-domain-model-reference.md` — entity catalog, relationships, state machines
- `01b-query-patterns.md` — read/filter/pagination
- `01c-mutation-patterns.md` — create/update/delete
- `01d-event-and-error-handling.md` — webhooks & error recovery

Developer reference (not the agent's runtime context): `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`, `03-connector-setup.md` (this file), `04-connection-and-reauth.md`.

**Consistency rule:** same API as `connecteam-api` → keep `01a`/`01b`/`01c` byte-for-byte aligned across the two folders; only the auth section in `01-llm-api-rules.md` should differ.

## 5. Deployment Checklist

**Registry & docs**

- [x] Registry entry present (`connecteam-oauth`)
- [x] `oauth` block populated (`authUrl`/`tokenUrl`/`scopes`)
- [x] `oauthSetupSteps` present
- [x] `01*` agent-rules files authored
- [ ] **Resolve the OAuth flow conflict** (registry endpoints vs official `client_credentials`) — **blocker**
- [ ] Confirm final `scopes` string (drop `attachments.write` if chat is read-only; add `users.read`/`schedule.read`/`timeclock.read`)
- [ ] Keep `01a`/`01b`/`01c` in sync with `connecteam-api`

**Auth flows (verify once endpoints are confirmed)**

- [ ] Admin OAuth-app registration saves Client ID + Secret (company secret) to the vault
- [ ] User connect flow completes (redirect or, if client_credentials, admin-only connect)
- [ ] Token obtained and a `GET /me` smoke test returns 200
- [ ] Token re-fetch on 401 works (no refresh token — re-request on expiry)
- [ ] User disconnect removes the user secret; admin disconnect removes the company secret

**Functionality (via `connect_request`)**

- [ ] Lists users (`GET /users/v1/users`)
- [ ] Reads time activities within the 92-day window
- [ ] Lists shifts for a scheduler over a date range
- [ ] Lists form submissions filtered by user/date
- [ ] Enterprise-plan tenant confirmed (API gated below Enterprise)
- [ ] AU tenant routes to `api-au.connecteam.com`

**Deploy**

- [ ] `ext-api-doc/connecteam-oauth/*` synced to `extApiDocBucket` on the next client deploy
- [ ] `DATA_CONNECTORS_ENABLED` enabled for the target client

## 6. Testing Plan

**Manual sequence**

1. **Admin setup:** register the OAuth app (per `oauthSetupSteps`), enter Client ID + Secret.
2. **Connect:** complete the OAuth connect flow; verify the token is stored in the vault.
3. **Smoke test:** "check the Connecteam connection" → `GET /me` returns 200.
4. **List users:** active employees → `GET /users/v1/users?userStatus=active`.
5. **Time activities:** last-30-days hours for a clock (within the 92-day cap).
6. **Shifts:** this pay-period's shifts on a scheduler.
7. **Forms:** a form's recent submissions filtered by user.
8. **Reauth:** past 24h (or force a 401) → confirm token re-fetch and call retry.
9. **Disconnect:** disconnect and verify access is revoked.

**Edge cases**

- [ ] Empty result sets / `< limit` last page
- [ ] 92-day window exceeded → expect rejection; chunk into ≤90-day ranges
- [ ] Rate-limit 429 on a low-tier plan → backoff via `x-ratelimit-minute-reset`
- [ ] AU-resident tenant on the wrong host → 401/404 until switched to `api-au.connecteam.com`
- [ ] Non-Enterprise plan → 403 (API gated)
- [ ] Token expiry mid-conversation → transparent re-fetch + single retry

---

_Registry entry cited from `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Deploy mechanism cited from `infra/stacks/numa-client-stack.ts`. See also `04-connection-and-reauth.md` and the [Connector Framework Documentation](../../documentation/connectors/README.md)._
