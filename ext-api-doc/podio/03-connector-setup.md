---
api_name: 'Podio'
connector_id: 'podio'
auth_type: 'oauth2'
tier: 'standard'
category: 'project-management'
integration_path: 'direct-api'
---

# Podio -- Connector & Integration Setup

> How the Podio connector is wired into Numa. This connector **already exists** in the
> registry — this document reproduces and explains the **actual** entry plus how the
> `ext-api-doc/podio/` files reach the workspace agent at runtime.
>
> **Integration path: Direct API Only.** Podio is structured work-management data
> (Items in user-defined Apps), not a browsable file tree — so there is **no** Files >
> Remote surface, no backend provider class, and no `list_files`/`download_file` mapping.
> Everything happens through the workspace agent's `connect_request` tool.

---

## Integration Type

**Selected path:** Direct API Only (Direct API via `connect_request`)

| Component                | Required? | Notes                                                                                                                 |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes ✅    | Already present — see §1                                                                                              |
| OAuth setup wizard       | Yes ✅    | Generic `OAuthWizard.tsx` drives it from the registry's `oauth` + `oauthSetupSteps` fields                            |
| Backend provider class   | **No**    | Direct-API connectors have no `OAuthProvider` subclass — no file-browsing, no `lib/oauth-providers/podio_provider.py` |
| Workspace agent prompt   | Yes ✅    | `01-llm-api-rules.md` (+ companions) — loaded when the connector is active                                            |
| Feature flag             | Yes       | `DATA_CONNECTORS_ENABLED` gates the whole connectors + vault surface (see frontend CLAUDE.md)                         |
| i18n keys                | No        | Display strings come from the registry's `displayName`/`description`; the generic wizard supplies the rest            |

---

## 1. Connector Registry Entry (the real, current entry)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
> (the entry lives in the `CONNECTOR_REGISTRY: ConnectorTemplate[]` array)

This is the entry **as it exists in the codebase today** — reproduced verbatim:

```typescript
{
  id: 'podio',
  displayName: 'Podio',
  icon: 'bi-grid-3x3-gap',
  description: 'Flexible work management and collaboration platform',
  category: 'Project Management',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://podio.com/oauth/authorize',
    tokenUrl: 'https://podio.com/oauth/token',
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

| Field                   | Value                                                 | Notes                                                                                                                                  |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `podio`                                               | Connector slug; matches this `ext-api-doc/podio/` folder.                                                                              |
| `displayName`           | `Podio`                                               |                                                                                                                                        |
| `icon`                  | `bi-grid-3x3-gap`                                     | Bootstrap Icons class (not an SVG path) — the grid-of-tiles glyph fits Podio's app-grid model.                                         |
| `description`           | `Flexible work management and collaboration platform` |                                                                                                                                        |
| `category`              | `Project Management`                                  | Same bucket as WorkflowMax, simPRO, Jobber.                                                                                            |
| `authType`              | `oauth2`                                              | Drives the generic `OAuthWizard.tsx`.                                                                                                  |
| `oauth.authUrl`         | `https://podio.com/oauth/authorize`                   | ✅ Matches Podio docs.                                                                                                                 |
| `oauth.tokenUrl`        | `https://podio.com/oauth/token`                       | ⚠️ **Discrepancy** — see §3. Documented endpoint is `https://api.podio.com/oauth/token/v2`.                                            |
| `oauth.scopes`          | `''` (empty)                                          | ✅ Correct — Podio's scope model is coarse; server-side integrations omit `scope` (the token inherits the user's full permission set). |
| `oauth.extraAuthParams` | `'{}'`                                                | ✅ Nothing extra needed (no `access_type`/`prompt` like Google/Zoho).                                                                  |
| `oauthSetupSteps`       | 4-step list                                           | Rendered in the admin wizard as the "how to create the OAuth app" checklist.                                                           |

### Fields NOT set (and whether they should be)

| Optional field     | Currently | Recommendation                                                                                                                                                                                                                                                                                      |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authHeaderScheme` | _(unset)_ | ⚠️ **Should be `'OAuth2'`.** Podio rejects `Bearer` with 401. The field defaults to `Bearer` when omitted, so the request path will use the wrong scheme unless this is set. Add `authHeaderScheme: 'OAuth2'`. (Persisted to the company vault at wizard-save time — picked up without a redeploy.) |
| `surfaces`         | _(unset)_ | OK as-is. Default is `['chat']` — correct for a Direct-API connector. Do **not** add `'files'`.                                                                                                                                                                                                     |
| `baseUrl`          | _(unset)_ | Not required for the registry; the API base (`https://api.podio.com`) is documented in `01-llm-api-rules.md` for the agent.                                                                                                                                                                         |
| `cachingPolicy`    | _(unset)_ | Optional. `CACHING_PRESETS.projectManagement` (1800s) would be reasonable, but caching is a Files-Remote-browse concern and Direct-API connectors don't use `useRemoteBrowse` — leaving it unset is fine.                                                                                           |
| `eventTypes`       | _(unset)_ | Leave unset — webhooks aren't wired in Numa for this connector (see `01d` / §webhooks).                                                                                                                                                                                                             |

> The `ConnectorTemplate` interface (top of `connectorRegistry.ts`) defines every available field. The Zoho CRM entry is the reference for setting `authHeaderScheme` on a non-`Bearer` OAuth connector (`authHeaderScheme: 'Zoho-oauthtoken'`).

---

## 2. Redirect URI

The admin copies the redirect URI from the **OAuth wizard UI** — it is **not** built from the connector slug. The wizard constructs it from the per-deployment OAuth secret ID:

> `numa-frontend/src/Components/DataConnectors/wizards/OAuthWizard.tsx`
> `value = ${frontendBaseUrl}/oauth/callback/${oauthSecretId}`

So the registered redirect URI looks like:

```
https://{client-name}.numa.arcanum.ai/oauth/callback/{oauthSecretId}
```

The admin must paste **exactly** the string the wizard displays into the Podio API client's "Domain / Return URL" — Podio matches the redirect-URI **domain** against the domain registered with the API key (see `04-connection-and-reauth.md` §1). HTTPS is required for production.

---

## 3. tokenUrl discrepancy (action required)

The registry sets:

```typescript
tokenUrl: 'https://podio.com/oauth/token',
```

Podio's **documented** token endpoint (verified 2026-05-29 against developers.podio.com/authentication) is:

```
https://api.podio.com/oauth/token/v2
```

Historically `podio.com/oauth/token` aliased/redirected to the v2 endpoint, but the documented host is the safe one. **Recommended fix** (confirm on the first live connect before changing):

```typescript
oauth: {
  authUrl: 'https://podio.com/oauth/authorize',
  tokenUrl: 'https://api.podio.com/oauth/token/v2',   // ← corrected
  scopes: '',
  extraAuthParams: '{}',
},
authHeaderScheme: 'OAuth2',                            // ← add this
```

If the backend honours the current registry value and token exchange fails (e.g. an unexpected redirect or 404 on the token POST), this discrepancy is the first thing to check.

---

## 4. How the `ext-api-doc/podio/` files reach the agent

This is the deployment path for the prompt/reference files in this folder — there is **no** separate "deploy the prompt" step beyond a normal client deploy.

### 4.1 Sync to S3 (at deploy time)

`infra/stacks/numa-client-stack.ts` walks the repo's `ext-api-doc/` directory at synth time and creates one `S3Object` per file (excluding `_templates/`, which is dev-only reference material and must not ship):

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

The destination bucket is created in `infra/constructs/core-numa-infra-construct.ts` as `${numaClient}-ext-api-doc` (a `PrivateBucket`). So every `.md` file in `ext-api-doc/podio/` (00, 01, 01a–01d, 02, 03, 04) lands at S3 key `podio/<filename>.md` in that per-client bucket on the next `make deploy` / `cdktf deploy`.

### 4.2 Which files the agent loads

The workspace agent loads the **`01-*.md`** rule files (the LLM-facing companions: `01-llm-api-rules.md` and `01a`–`01d`) into its context when the Podio connector is active. The other files in this folder are for humans:

- `00-api-investigation-questionnaire.md` — research worksheet (not loaded by the agent)
- `02-api-spec-investigation.md` — developer reference (this folder's clean dev ref; not loaded by the agent)
- `03-connector-setup.md` — this file (build/wiring doc; not loaded by the agent)
- `04-connection-and-reauth.md` — auth runbook (not loaded by the agent)

The `admin-data-connector-settings-get` Lambda also lists the `ext-api-doc` bucket to report **which connectors have prompt docs available** (see `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts` ~line 444) — so simply having `podio/01-*.md` present in the bucket makes the connector "documented" from the admin UI's perspective.

---

## 5. Deployment Checklist

> Direct-API connector — the Files-Remote checklist items do not apply. This is the
> trimmed list relevant to Podio.

### Registry / config

- [x] Registry entry present in `connectorRegistry.ts` (`id: 'podio'`)
- [x] Icon set (`bi-grid-3x3-gap` Bootstrap Icons class)
- [x] `authType: 'oauth2'` with `oauth.authUrl` / `oauth.scopes` / `extraAuthParams` correct
- [ ] **Add `authHeaderScheme: 'OAuth2'`** (Podio rejects `Bearer`) — §1, §3
- [ ] **Correct `oauth.tokenUrl` to `https://api.podio.com/oauth/token/v2`** (confirm on first live connect) — §3
- [x] `surfaces` left at default `['chat']` (do NOT add `'files'`)

### Prompt docs (this folder)

- [x] `01-llm-api-rules.md` present (< 300 lines)
- [x] `01a`–`01d` companions present
- [x] `02-api-spec-investigation.md` present (dev reference)
- [x] `04-connection-and-reauth.md` present (auth runbook)
- [ ] Files reach the per-client `${numaClient}-ext-api-doc` S3 bucket on next deploy (automatic — §4)

### Auth flow (vendor-side detail in `04-connection-and-reauth.md`)

- [ ] Admin creates a Podio API client in the Podio Developer Portal, domain matches the redirect URI
- [ ] Admin pastes Client ID + Client Secret into the Numa OAuth wizard
- [ ] User connect flow completes the `authorization_code` exchange
- [ ] Token refresh works **and persists the rotated `refresh_token`** (28-day TTL; access token 8h)
- [ ] First live call `GET /user/status` (or `GET /org/`) returns 200 → promote `ext-api-doc` markers to [CONFIRMED]

### Workspace agent (Direct-API verification)

- [ ] Agent can walk the hierarchy: `GET /org/` → `GET /org/{id}/space/` → `GET /space/{id}/app/`
- [ ] Agent discovers an app's schema via `GET /app/{app_id}` before any item read/write
- [ ] Agent can filter items (`POST /item/app/{app_id}/filter`) with correct field-type filter shapes
- [ ] Agent can create/update an item with type-correct write shapes (object keyed by `external_id`)
- [ ] Agent honours the 250/hr heavy-op cap and 420 backoff

---

## 6. Testing Plan (Direct-API)

### Manual sequence

1. **Admin setup:** create the Podio API client, paste Client ID/Secret into the wizard.
2. **User connect:** complete the OAuth redirect; confirm tokens stored in the user vault.
3. **Liveness:** ask the agent to "check my Podio connection" → `GET /user/status` returns the user.
4. **Discovery:** "list my Podio workspaces and apps" → `GET /org/`, `/space/{id}/app/`.
5. **Schema:** "what fields does the Leads app have?" → `GET /app/{app_id}`; agent reports `external_id`/`type`/options.
6. **Read:** "show me open leads created this month" → `POST /item/app/{app_id}/filter` with a category + `created_on` filter.
7. **Write:** "create a lead titled X with amount Y" → agent fetches schema first, then `POST /item/app/{app_id}/` with type-correct values.
8. **Update:** "mark lead 12345 as Won" → `PUT /item/12345` partial update; agent reports the new `revision`.
9. **Disconnect:** user disconnects → user vault secret deleted; subsequent calls re-prompt.

### Edge cases

- [ ] Expired access token → backend refreshes, rotates and persists the new `refresh_token`, retries once
- [ ] `Bearer` scheme used by mistake → 401 (validates the need for `authHeaderScheme: 'OAuth2'`)
- [ ] Datetime sent with a `Z`/offset → 400 `invalid_value` (must be bare UTC `YYYY-MM-DD HH:MM:SS`)
- [ ] Heavy-op cap hit on a large filter sweep → 420 + `Retry-After` backoff
- [ ] Cross-field OR query requested → agent issues multiple filters and merges client-side
- [ ] Create with a duplicate `external_id` → agent does lookup-then-update instead of a second create

---

_Generated from `00-api-investigation-questionnaire.md` (Phase 9). See also:_

- _`02-api-spec-investigation.md` — developer API reference_
- _`04-connection-and-reauth.md` — OAuth setup & reauthorization runbook_
- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
