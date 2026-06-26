---
api_name: Podio
connector_id: podio
auth_type: oauth2
auth_header_scheme: OAuth2 (must be set; defaults to Bearer if omitted → Podio 401)
base_url: https://api.podio.com
path_version_segment: none (core API unversioned; only /oauth/token/v2 versioned)
tier: standard
category: project-management
integration_path: Direct API Only — HTTP JSON via `connect_request`. No Files>Remote surface, no backend provider class, no list_files/download_file.
---

# Podio — Connector & Integration Setup

How the Podio connector is wired into Numa. This connector **already exists** in the registry — this doc reproduces and explains the actual entry plus how `ext-api-doc/podio/` files reach the workspace agent at runtime. Everything happens through the agent's `connect_request` tool (Podio is structured work-management data — Items in user-defined Apps — not a browsable file tree).

## Integration Type

**Direct API Only** (Direct API via `connect_request`).

| Component                | Required? | Notes                                                                                                                 |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes ✅    | Already present — see §1                                                                                              |
| OAuth setup wizard       | Yes ✅    | Generic `OAuthWizard.tsx` drives it from the registry's `oauth` + `oauthSetupSteps` fields                            |
| Backend provider class   | **No**    | Direct-API connectors have no `OAuthProvider` subclass — no file-browsing, no `lib/oauth-providers/podio_provider.py` |
| Workspace agent prompt   | Yes ✅    | `01-llm-api-rules.md` (+ companions) — loaded when the connector is active                                            |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` gates the whole connectors + vault surface (see frontend CLAUDE.md)                         |
| i18n keys                | No        | Display strings come from the registry's `displayName`/`description`; the generic wizard supplies the rest            |

## 1. Connector Registry Entry (the real, current entry)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (entry lives in the `CONNECTOR_REGISTRY: ConnectorTemplate[]` array). Verbatim as in the codebase today:

```typescript
{
  id: 'podio',
  displayName: 'Podio',
  icon: 'bi-grid-3x3-gap',
  description: 'Flexible work management and collaboration platform',
  category: 'Project Management',
  authType: 'oauth2',
  authHeaderScheme: 'OAuth2', // Podio rejects Bearer with 401 (TASK-108)
  oauth: {
    authUrl: 'https://podio.com/oauth/authorize',
    tokenUrl: 'https://api.podio.com/oauth/token/v2', // corrected (TASK-108)
    scopes: '',
    extraAuthParams: '{}',
  },
  oauthSetupSteps: [
    'Go to Podio Developer Portal → API Keys',
    'Create a new API client application',
    'Set the redirect URI to the value shown below',
    'Copy the Client ID and Client Secret',
  ],
},
```

### Field-by-field

| Field                   | Value                                                 | Notes                                                                                                                                 |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `podio`                                               | Connector slug; matches this `ext-api-doc/podio/` folder                                                                              |
| `displayName`           | `Podio`                                               |                                                                                                                                       |
| `icon`                  | `bi-grid-3x3-gap`                                     | Bootstrap Icons class (not an SVG path) — the grid-of-tiles glyph fits Podio's app-grid model                                         |
| `description`           | `Flexible work management and collaboration platform` |                                                                                                                                       |
| `category`              | `Project Management`                                  | Same bucket as WorkflowMax, simPRO, Jobber                                                                                            |
| `authType`              | `oauth2`                                              | Drives the generic `OAuthWizard.tsx`                                                                                                  |
| `oauth.authUrl`         | `https://podio.com/oauth/authorize`                   | ✅ Matches Podio docs                                                                                                                 |
| `oauth.tokenUrl`        | `https://api.podio.com/oauth/token/v2`                | ✅ Corrected (TASK-108) to Podio's documented token endpoint                                                                          |
| `oauth.scopes`          | `''` (empty)                                          | ✅ Correct — Podio's scope model is coarse; server-side integrations omit `scope` (the token inherits the user's full permission set) |
| `oauth.extraAuthParams` | `'{}'`                                                | ✅ Nothing extra needed (no `access_type`/`prompt` like Google/Zoho)                                                                  |
| `oauthSetupSteps`       | 4-step list                                           | Rendered in the admin wizard as the "how to create the OAuth app" checklist                                                           |

### Fields NOT set (and whether they should be)

| Optional field     | Currently             | Recommendation                                                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authHeaderScheme` | `'OAuth2'` (TASK-108) | ✅ **Set to `'OAuth2'`.** Podio rejects `Bearer` with 401; the field defaults to `Bearer` when omitted. The OAuthWizard persists it to the company vault (`oauth-client-podio.fields.auth_header_scheme`) at save time, and `connect_tools._auth_header_scheme()` reads it back at request time — no redeploy needed. |
| `surfaces`         | _(unset)_             | OK as-is. Default `['chat']` — correct for a Direct-API connector. Do **not** add `'files'`.                                                                                                                                                                                                                          |
| `baseUrl`          | _(unset)_             | Not required for the registry; the API base (`https://api.podio.com`) is documented in 01-llm-api-rules.md for the agent                                                                                                                                                                                              |
| `cachingPolicy`    | _(unset)_             | Optional. `CACHING_PRESETS.projectManagement` (1800s) would be reasonable, but caching is a Files-Remote-browse concern and Direct-API connectors don't use `useRemoteBrowse` — leaving it unset is fine                                                                                                              |
| `eventTypes`       | _(unset)_             | Leave unset — webhooks aren't wired in Numa for this connector (see 01d / §webhooks)                                                                                                                                                                                                                                  |

The `ConnectorTemplate` interface (top of `connectorRegistry.ts`) defines every available field. The Zoho CRM entry is the reference for setting `authHeaderScheme` on a non-`Bearer` OAuth connector (`authHeaderScheme: 'Zoho-oauthtoken'`).

## 2. Redirect URI

The admin copies the redirect URI from the **OAuth wizard UI** — it is **not** built from the connector slug. The wizard constructs it from the per-deployment OAuth secret ID:

> `numa-frontend/src/Components/DataConnectors/wizards/OAuthWizard.tsx` — `value = ${frontendBaseUrl}/oauth/callback/${oauthSecretId}`

Registered redirect URI looks like: `https://{client-name}.numa.arcanum.ai/oauth/callback/{oauthSecretId}`

The admin pastes **exactly** the string the wizard displays into the Podio API client's "Domain / Return URL" — Podio matches the redirect-URI **domain** against the domain registered with the API key (see 04 §1). HTTPS is required for production.

## 3. tokenUrl + auth scheme (FIXED — TASK-108)

The registry previously set `tokenUrl: 'https://podio.com/oauth/token'` with no `authHeaderScheme`. Podio's **documented** token endpoint (verified 2026-05-29 and re-confirmed 2026-06-24 against developers.podio.com/authentication) is `https://api.podio.com/oauth/token/v2`, and the API requires the `OAuth2` Authorization scheme (`Bearer` → 401). Both are now corrected in the registry:

```typescript
authHeaderScheme: 'OAuth2',                            // ← added (Bearer → 401)
oauth: {
  authUrl: 'https://podio.com/oauth/authorize',
  tokenUrl: 'https://api.podio.com/oauth/token/v2',   // ← corrected host + /v2 suffix
  scopes: '',
  extraAuthParams: '{}',
},
```

`tokenUrl` flows into the company vault `oauth-client-podio` entry at wizard-save time and is read by `oauth-auth-handler.getProviderConfig` (`fields.token_url`) at exchange/refresh time. `authHeaderScheme` is persisted as `auth_header_scheme` on the same entry and read by `connect_tools._auth_header_scheme()` at request time. Neither requires a Python/Node redeploy — admins re-saving the wizard (or a fresh connect) picks up the new values.

If token exchange ever fails (unexpected redirect or 404 on the token POST) or live calls 401 with a fresh token, this is the first thing to re-check.

## 4. How the `ext-api-doc/podio/` files reach the agent

The deployment path for the prompt/reference files in this folder — there is **no** separate "deploy the prompt" step beyond a normal client deploy.

### 4.1 Sync to S3 (at deploy time)

`infra/stacks/numa-client-stack.ts` walks the repo's `ext-api-doc/` directory at synth time and creates one `S3Object` per file (excluding `_templates/`, dev-only reference that must not ship):

> `infra/stacks/numa-client-stack.ts` — "Sync ext-api-doc files to S3" block (~line 1135)

```typescript
const extApiDocPath = path.join(import.meta.dirname, '..', '..', 'ext-api-doc');
// … readdir recursive, skip dotfiles and _templates/ …
for (const source of mdFiles) {
  const key = path.relative(extApiDocPath, source); // e.g. "podio/01-llm-api-rules.md"
  new S3Object(this, `ext-api-doc-${key.replace(/[^a-zA-Z0-9]/g, '-')}`, {
    bucket: core.extApiDocBucket.bucket.bucket, // `${numaClient}-ext-api-doc`
    key,
    source,
    sourceHash: Fn.filemd5(source),
    contentType: 'text/markdown',
  });
}
```

Destination bucket created in `infra/constructs/core-numa-infra-construct.ts` as `${numaClient}-ext-api-doc` (a `PrivateBucket`). Every `.md` file in `ext-api-doc/podio/` (00, 01, 01a–01d, 02, 03, 04) lands at S3 key `podio/<filename>.md` in that per-client bucket on the next `make deploy` / `cdktf deploy`.

### 4.2 Which files the agent loads

The workspace agent loads the **`01-*.md`** rule files (`01-llm-api-rules.md` and `01a`–`01d`) into its context when the Podio connector is active. The others are for humans:

- `00-api-investigation-questionnaire.md` — research worksheet (not loaded by the agent)
- `02-api-spec-investigation.md` — developer reference (not loaded by the agent)
- `03-connector-setup.md` — this file (build/wiring doc; not loaded by the agent)
- `04-connection-and-reauth.md` — auth runbook (not loaded by the agent)

The `admin-data-connector-settings-get` Lambda also lists the `ext-api-doc` bucket to report **which connectors have prompt docs available** (`infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` ~line 444) — so having `podio/01-*.md` present makes the connector "documented" from the admin UI's perspective.

## 5. Deployment Checklist

Direct-API connector — Files-Remote checklist items do not apply.

**Registry / config:**

- [x] Registry entry present (`id: 'podio'`); icon `bi-grid-3x3-gap`; `authType: 'oauth2'` with `oauth.authUrl`/`oauth.scopes`/`extraAuthParams` correct
- [x] **`authHeaderScheme: 'OAuth2'` added** (Podio rejects `Bearer`) — TASK-108, §1, §3
- [x] **`oauth.tokenUrl` corrected to `https://api.podio.com/oauth/token/v2`** (confirm on first live connect) — TASK-108, §3
- [x] `surfaces` left at default `['chat']` (do NOT add `'files'`)

**Prompt docs (this folder):**

- [x] `01-llm-api-rules.md` + `01a`–`01d` companions present; `02` dev reference; `04` auth runbook present
- [ ] Files reach the per-client `${numaClient}-ext-api-doc` S3 bucket on next deploy (automatic — §4)

**Auth flow (vendor detail in 04):**

- [ ] Admin creates a Podio API client (domain matches the redirect URI); pastes Client ID + Secret into the Numa OAuth wizard
- [ ] User connect flow completes the `authorization_code` exchange
- [ ] Token refresh works **and persists the rotated `refresh_token`** (28-day TTL; access token 8h)
- [ ] First live call `GET /user/status` (or `GET /org/`) returns 200 → promote `ext-api-doc` markers to [CONFIRMED]

**Workspace agent (Direct-API verification):**

- [ ] Agent walks the hierarchy: `GET /org/` → `GET /org/{id}/space/` → `GET /space/{id}/app/`
- [ ] Agent discovers an app's schema via `GET /app/{app_id}` before any item read/write
- [ ] Agent filters items (`POST /item/app/{app_id}/filter`) with correct field-type filter shapes
- [ ] Agent creates/updates an item with type-correct write shapes (object keyed by `external_id`)
- [ ] Agent honours the 250/hr heavy-op cap and 420 backoff

## 6. Testing Plan (Direct-API)

**Manual sequence:**

1. **Admin setup:** create the Podio API client, paste Client ID/Secret into the wizard.
2. **User connect:** complete the OAuth redirect; confirm tokens stored in the user vault.
3. **Liveness:** "check my Podio connection" → `GET /user/status` returns the user.
4. **Discovery:** "list my Podio workspaces and apps" → `GET /org/`, `/space/{id}/app/`.
5. **Schema:** "what fields does the Leads app have?" → `GET /app/{app_id}`; agent reports `external_id`/`type`/options.
6. **Read:** "show me open leads created this month" → `POST /item/app/{app_id}/filter` with a category + `created_on` filter.
7. **Write:** "create a lead titled X with amount Y" → agent fetches schema first, then `POST /item/app/{app_id}/` with type-correct values.
8. **Update:** "mark lead 12345 as Won" → `PUT /item/12345` partial update; agent reports the new `revision`.
9. **Disconnect:** user disconnects → user vault secret deleted; subsequent calls re-prompt.

**Edge cases:**

- [ ] Expired access token → backend refreshes, rotates and persists the new `refresh_token`, retries once
- [ ] `Bearer` scheme used by mistake → 401 (validates the need for `authHeaderScheme: 'OAuth2'`)
- [ ] Datetime sent with a `Z`/offset → 400 `invalid_value` (must be bare UTC `YYYY-MM-DD HH:MM:SS`)
- [ ] Heavy-op cap hit on a large filter sweep → 420 + `Retry-After` backoff
- [ ] Cross-field OR query requested → agent issues multiple filters and merges client-side
- [ ] Create with a duplicate `external_id` → agent does lookup-then-update instead of a second create

See also: `02-api-spec-investigation.md` (developer API reference), `04-connection-and-reauth.md` (OAuth setup & reauth runbook), [Connector Framework Documentation](../../documentation/connectors/README.md).
