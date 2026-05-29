---
api_name: 'Connecteam API (OAuth)'
connector_id: 'connecteam-oauth'
auth_type: 'oauth2'
tier: 'standard'
category: 'HR & Workforce'
integration_path: 'direct-api'
---

# Connecteam (OAuth) -- Connector & Integration Setup

> How the `connecteam-oauth` connector is wired into Numa. **This connector already exists**
> in the registry — this document reproduces and explains the **actual** entry rather than
> proposing a new one.
>
> **Shared API:** This is the same REST API as `connecteam-api` (API-key). The endpoint catalog,
> data models, and agent rules (`01*.md`) are identical; only the auth differs. See
> `connecteam-oauth/02-api-spec-investigation.md` for the dev reference and
> `connecteam-oauth/04-connection-and-reauth.md` for the OAuth setup/reauth detail.

---

## Integration Type

**Selected path:** Direct API via `connect_request` (not a Files connector).

Connecteam exposes **records** (users, time activities, shifts, form submissions, jobs), not a
browsable file tree, so there is no `list_files`/`download_file` mapping. The workspace agent
issues REST calls through Numa's `connect_request` proxy, which injects the OAuth bearer token
from the user's vault. No Python `OAuthProvider` file-browser class is required.

| Component                      | Required?        | Notes                                                                          |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------ |
| Connector Registry entry       | **Yes (exists)** | Already present — see §1 below                                                 |
| OAuth config (`oauth` block)   | **Yes (exists)** | `authUrl` / `tokenUrl` / `scopes` in the registry entry                        |
| `oauthSetupSteps`              | **Yes (exists)** | Admin wizard text for registering the OAuth app                                |
| Backend `OAuthProvider` class  | No               | Direct-API connector — not a Files browser; no `lib/oauth-providers/` class    |
| Workspace agent prompt (`01*`) | **Yes**          | `01-llm-api-rules.md` (+ `01a`–`01d`) — loaded when the integration is active  |
| `ext-api-doc/` deploy → S3     | **Yes**          | These docs are synced to the per-client S3 bucket at deploy — see §3           |
| Feature flag                   | Yes              | `DATA_CONNECTORS_ENABLED` gates connectors + the secrets vault                 |
| i18n keys                      | Reused           | Generic connector field labels (`dataConnectors.fields.*`); none new for OAuth |

---

## 1. Connector Registry Entry (actual)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

This is the **real, current** entry (not a template). Reproduced verbatim from source:

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

**Field-by-field:**

| Field             | Value                                                             | Notes                                                                                                   |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`              | `connecteam-oauth`                                                | Connector slug; matches this `ext-api-doc/` folder name and the S3 key prefix.                          |
| `displayName`     | `Connecteam (OAuth)`                                              | Distinguishes it from the sibling `Connecteam (API Key)` (`connecteam-api`).                            |
| `icon`            | `bi-people`                                                       | Bootstrap Icons class (same icon as `connecteam-api`).                                                  |
| `description`     | `Employee management — time clock, scheduling, and forms (OAuth)` | Shown in the connector picker.                                                                          |
| `category`        | `HR & Workforce`                                                  | Picker grouping.                                                                                        |
| `authType`        | `oauth2`                                                          | Drives the redirect-based OAuth wizard (vs `api-key`/`token` credential-field wizards).                 |
| `oauth.authUrl`   | `https://app.connecteam.com/oauth/authorize`                      | ⚠️ **Unverified** — see §"Auth conflict" below.                                                         |
| `oauth.tokenUrl`  | `https://app.connecteam.com/oauth/token`                          | ⚠️ **Unverified** — official docs use `https://api.connecteam.com/oauth/v1/token`.                      |
| `oauth.scopes`    | `forms.read attachments.write`                                    | Space-delimited scope string. `attachments.write` is a **write** scope — reconsider for read-only chat. |
| `oauthSetupSteps` | 3-step admin wizard text                                          | Rendered in the admin OAuth-app-registration wizard.                                                    |

> No `credentialFields` array — for `oauth2` connectors the wizard collects Client ID + Client
> Secret via the OAuth flow, not free-text credential fields. (Contrast the sibling
> `connecteam-api` entry, which has a single `api_token` password field.)

### ⚠️ Auth conflict (carry-over from investigation)

The registry's `oauth` block implies an `authorization_code` flow (it has an `authUrl`). The
**official Connecteam OAuth 2.0 docs document `client_credentials` only**, with token endpoint
`https://api.connecteam.com/oauth/v1/token` and HTTP Basic client auth — **no consent/redirect
step**. The `app.connecteam.com/oauth/*` endpoints in the registry could not be verified against
any official page and may be placeholders.

**Action before build:** confirm with Connecteam whether a 3-legged `authorization_code` flow
exists. If only `client_credentials` is available, this connector overlaps heavily with the
API-key (`connecteam-api`) connector and the registry config must be corrected (or the connector
reframed). Full detail in `04-connection-and-reauth.md` §"Open conflict". Do not treat the
registry's auth endpoints as correct until verified.

---

## 2. Sibling connector for cross-reference

> Same file: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

For comparison, the API-key sibling (`connecteam-api`) — same API, different auth:

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

Keep the `01*` agent-rules files for the two folders in sync — only their auth sections diverge.

---

## 3. How these docs reach the workspace agent

The `ext-api-doc/` markdown is **not** bundled into the agent image. It is deployed to a
per-client S3 bucket at infrastructure-deploy time and read at runtime.

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

**What this means for this connector:**

- Every file in `ext-api-doc/connecteam-oauth/` is uploaded to the client's `extApiDocBucket`
  under the key `connecteam-oauth/<filename>` (the folder name = the connector `id`).
- `_templates/` is explicitly excluded, so the template files are never shipped.
- `sourceHash: Fn.filemd5(...)` means only changed files re-upload on the next deploy.
- When the **Connecteam (OAuth)** integration is active, the workspace agent loads
  `connecteam-oauth/01-llm-api-rules.md` (the < 300-line agent rules) plus its `01a`–`01d`
  companions from this bucket to ground its API calls. The `00`/`02`/`03`/`04` files are
  developer-facing reference and are not the agent's primary runtime context.

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

**Consistency rule:** because this is the same API as `connecteam-api`, keep `01a`/`01b`/`01c`
byte-for-byte aligned across the two folders; only the auth section in `01-llm-api-rules.md`
should differ.

---

## 5. Deployment Checklist

### Registry & docs

- [x] Registry entry present in `connectorRegistry.ts` (`connecteam-oauth`)
- [x] `oauth` block populated (`authUrl` / `tokenUrl` / `scopes`)
- [x] `oauthSetupSteps` present for the admin wizard
- [x] `ext-api-doc/connecteam-oauth/` agent-rules files (`01*`) authored
- [ ] **Resolve the OAuth flow conflict** (registry endpoints vs official `client_credentials`) — **blocker**
- [ ] Confirm final `scopes` string (drop `attachments.write` if chat is read-only; add `users.read`/`schedule.read`/`timeclock.read`)
- [ ] Keep `01a`/`01b`/`01c` in sync with `connecteam-api`

### Auth flows (verify once endpoints are confirmed)

- [ ] Admin OAuth-app registration saves Client ID + Secret (company secret) to the vault
- [ ] User connect flow completes (redirect or, if client_credentials, admin-only connect)
- [ ] Token obtained and a `GET /me` smoke test returns 200
- [ ] Token refresh / re-fetch on 401 works (no refresh token — re-request on expiry)
- [ ] User disconnect removes the user secret; admin disconnect removes the company secret

### Functionality (via `connect_request`)

- [ ] Agent lists users (`GET /users/v1/users`)
- [ ] Agent reads time activities within the 92-day window
- [ ] Agent lists shifts for a scheduler over a date range
- [ ] Agent lists form submissions filtered by user/date
- [ ] Enterprise-plan tenant confirmed (API is gated below Enterprise)
- [ ] AU tenant routes to `api-au.connecteam.com`

### Deploy

- [ ] `ext-api-doc/connecteam-oauth/*` synced to `extApiDocBucket` on the next client deploy
- [ ] `DATA_CONNECTORS_ENABLED` enabled for the target client

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** register the OAuth app (per `oauthSetupSteps`), enter Client ID + Secret.
2. **Connect:** complete the OAuth connect flow; verify the token is stored in the vault.
3. **Smoke test:** ask the agent to "check the Connecteam connection" → `GET /me` returns 200.
4. **List users:** ask for active employees → `GET /users/v1/users?userStatus=active`.
5. **Time activities:** ask for last-30-days hours for a clock (within the 92-day cap).
6. **Shifts:** ask for this pay-period's shifts on a scheduler.
7. **Forms:** ask for a form's recent submissions filtered by user.
8. **Reauth:** wait past 24 h (or force a 401) → confirm the token is re-fetched and the call retries.
9. **Disconnect:** disconnect and verify access is revoked.

### Edge cases

- [ ] Empty result sets / `< limit` last page
- [ ] 92-day window exceeded → expect rejection; chunk into ≤ 90-day ranges
- [ ] Rate-limit 429 on a low-tier plan → backoff via `x-ratelimit-minute-reset`
- [ ] AU-resident tenant on the wrong host → 401/404 until switched to `api-au.connecteam.com`
- [ ] Non-Enterprise plan → 403 (API gated)
- [ ] Token expiry mid-conversation → transparent re-fetch + single retry

---

_Generated from the investigation questionnaire. Registry entry cited from_
_`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Deploy mechanism cited from_
_`infra/stacks/numa-client-stack.ts`. See also `04-connection-and-reauth.md` and the_
_[Connector Framework Documentation](../../documentation/connectors/README.md)._
