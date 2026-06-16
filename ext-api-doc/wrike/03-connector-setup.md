---
api_name: Wrike
connector_id: wrike
auth_type: oauth2
tier: standard
category: Project Management
integration_path: direct-api
call_surface: HTTP via `numa integrations request` (connector wrike; backend handler connect_request). NOT file-browse (no list-files/search-files/download-file), NOT MCP. surfaces defaults to ['chat'].
base_url: https://{host}/api/v4 — {host} resolved at runtime from the OAuth token-response `host` field; NOT a static registry value. NEVER hardcode www.wrike.com.
prereqs: read 00-questionnaire + 02-api-spec; activate the `numa-connectors` skill before changing anything here.
---

# Wrike — Connector & Integration Setup

How Wrike is wired into Numa. The connector **already exists** in the registry — this reproduces and explains the actual entry, not a new scaffold.

## Integration Type

**Direct API Only** — the workspace agent calls Wrike via `numa integrations request` (connector `wrike`; backend handler `connect_request`). **No Files > Remote surface** (registry omits `surfaces` → defaults to `['chat']`) and **no backend provider class** (those exist only for file-browsing connectors like Drive/Gmail/OneDrive/Dropbox under `lib/oauth-providers/`). Purely action/read-oriented.

| Component                | Required?     | Notes                                                                                        |
| ------------------------ | ------------- | -------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes           | already present (§1). `id:'wrike'`, `authType:'oauth2'`                                      |
| Admin setup wizard       | Yes (generic) | shared `OAuthWizard`, driven by the registry entry + `oauthSetupSteps`. No bespoke component |
| Backend provider class   | **No**        | Direct API path — no `lib/oauth-providers/wrike_provider.py`                                 |
| Workspace agent prompt   | Yes           | `01-llm-api-rules.md` (+ `01a`–`01d`). See §3                                                |
| Feature flag             | Yes           | `DATA_CONNECTORS_ENABLED` gates the whole connectors/vault surface. No Wrike-specific flag   |
| i18n keys                | Minimal       | display name/description from the registry entry; generic wizard provides UI strings         |

## 1. Connector Registry Entry (actual)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. Verbatim from `CONNECTOR_REGISTRY`:

```typescript
{
  id: 'wrike',
  displayName: 'Wrike',
  icon: 'bi-diagram-3',
  description: 'Enterprise work management and project collaboration',
  category: 'Project Management',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://login.wrike.com/oauth2/authorize/v4',
    tokenUrl: 'https://login.wrike.com/oauth2/token',
    scopes: 'wsReadOnly',
  },
  oauthSetupSteps: [
    'Go to Wrike Developer Portal → Create App',
    'Set the redirect URI to the value shown below',
    'Copy the Client ID and Client Secret',
  ],
},
```

| Field             | Value                                                  | Notes                                                                         |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `id`              | `wrike`                                                | slug — drives the ext-api-doc folder, vault key prefixes, OAuth callback path |
| `displayName`     | `Wrike`                                                | shown in the Integrations UI                                                  |
| `icon`            | `bi-diagram-3`                                         | Bootstrap Icon (org-chart glyph)                                              |
| `description`     | `Enterprise work management and project collaboration` |                                                                               |
| `category`        | `Project Management`                                   | groups it with other PM connectors                                            |
| `authType`        | `oauth2`                                               | drives the OAuth wizard branch (vs `token`/`api-key`)                         |
| `oauth.authUrl`   | `https://login.wrike.com/oauth2/authorize/v4`          | **global host** — same for all regions; region only affects the API host (§2) |
| `oauth.tokenUrl`  | `https://login.wrike.com/oauth2/token`                 | **global host**                                                               |
| `oauth.scopes`    | `wsReadOnly`                                           | **read-only.** Widen to `Default,wsReadWrite` for writes (§1.1)               |
| `oauthSetupSteps` | 3-step array                                           | rendered as admin instructions in the wizard                                  |

**Omissions (and defaults):**

- No `extraAuthParams` — Wrike needs no `access_type=offline`/`prompt=consent` extras (unlike Google/Xero). Authorize is plain `response_type=code` + `client_id` + `redirect_uri` + `scope` (+ optional `state`).
- No `authHeaderScheme` — defaults to `Bearer` (correct; Wrike uses standard `Authorization: Bearer {token}`). Contrast Zoho's `Zoho-oauthtoken`.
- No `credentialFields` — those are only for `token`/`api-key` connectors. OAuth client_id/secret are collected by the OAuth wizard.
- **No `baseUrl`** — deliberate. The API host is region-specific and discovered at runtime from the token-response `host` field; the backend stores the resolved host at connect time. (See `02`, `04`.)
- No `surfaces` — defaults to `['chat']` ⇒ Direct API only, not in Files > Remote.
- No `cachingPolicy` — no remote-browse cache (Direct API path).
- No `eventTypes` — Wrike webhooks are not wired into Numa; polling only.

`oauth.scopes` is a single **string** (Wrike wants comma-delimited scopes), not an array.

### 1.1 To enable writes (scope widening)

Wrike create/update/comment/timelog actions require `wsReadWrite`. To turn them on: (1) change `oauth.scopes` to `'Default,wsReadWrite'` in the registry entry; (2) re-register / re-consent the Wrike OAuth app for the new scope; (3) have each user **reconnect** (existing read-only tokens won't gain write access). Until then any write returns `403 not_allowed` and the agent treats Wrike as read-only (per `01`, `01c`).

## 2. No Backend Provider Class

Direct API connectors have **no** `lib/oauth-providers/<id>_provider.py` and are **not** registered in `lib/oauth-providers/__init__.py` — that layer is only for file-browsing connectors implementing `list_files`/`download_file`/`search_files`/`get_file_metadata` in Files > Remote.

For Wrike the agent issues requests via `numa integrations request` (connector `wrike`); the backend handler `connect_request`:

1. Looks up the connection's stored credentials (access token + the region-resolved `host`).
2. Refreshes the access token automatically on `401` (rotating refresh-token — §4, `04`).
3. Injects `Authorization: Bearer {access_token}`.
4. Resolves relative paths (`/api/v4/tasks`, `/api/v4/folders/{id}/tasks`) against `https://{host}/api/v4`.

The agent never builds an absolute `www.wrike.com` URL or the auth header — it passes relative paths; the backend does host + auth wiring. Same model as the Zoho CRM connector.

## 3. Workspace Agent Prompt Deployment

The agent's Wrike knowledge comes from the markdown in this folder (`ext-api-doc/wrike/`): `01-llm-api-rules.md` (main rules, ≤300 lines, loaded into live agent context when Wrike is active), `01a` (domain model), `01b` (query patterns), `01c` (mutations + `wsReadWrite` gate), `01d` (events/errors).

How they reach the agent (`infra/stacks/numa-client-stack.ts`, the "Sync ext-api-doc files to S3" block, ~line 1135): at deploy time `numa-client-stack.ts` walks `ext-api-doc/` recursively and uploads every non-dotfile markdown to the per-client **ext-api-doc S3 bucket** (`{clientName}-ext-api-doc`, from `core-numa-infra-construct.ts`). Each file becomes an `S3Object` keyed by its path relative to `ext-api-doc/` (e.g. `wrike/01-llm-api-rules.md`), `contentType: 'text/markdown'`, with a `filemd5` source hash so changed files re-upload. `_templates/` is excluded (dev-only). Bucket name exposed via `EXT_API_DOC_BUCKET_NAME`. The agent loads the relevant `01-*.md` rules for the active connector; `01-llm-api-rules.md` must stay ≤300 lines because it loads into the live context window.

So: edit the markdown here → `make deploy` (or a client deploy) re-syncs to S3 → the agent picks up new rules on its next run. No code change needed.

## 4. Token / Auth Wiring (summary; full detail in `04`)

1. **Region host from the token.** Token-exchange response carries `host` (`www.wrike.com`, `app-eu.wrike.com`, …). Store it with the credentials; build every API URL from it. Never hardcode `www.wrike.com`.
2. **Rotating refresh token.** Every refresh returns a NEW access_token + NEW refresh_token. Backend must persist the rotated refresh_token each time, or lose access on the next refresh.
3. **Auth host is global.** `login.wrike.com` for both authorize and token exchange, all regions.

## 5. Deployment Checklist

Direct API Only — file-browser items (Files Remote, download, metadata, per-connector Lambda) do NOT apply.

**Code:** [x] registry entry present (`id:'wrike'`) · [x] icon set (`bi-diagram-3`) · [x] `oauthSetupSteps` populated · [ ] (if enabling writes) widen `oauth.scopes` to `Default,wsReadWrite` · [x] ext-api-doc prompt files (`01-*.md`) present, `01-llm-api-rules.md` ≤300 lines · [N/A] backend provider class · [N/A] provider in `__init__.py` · [N/A] per-connector Lambda / CI matrix entry.

**Auth flow:** [ ] admin registers a Wrike OAuth app + saves client_id/secret via the wizard (company vault) · [ ] user connect completes the authorization_code exchange; backend stores the rotated refresh_token **and** the `host` · [ ] on `401`, backend refreshes once (persisting the rotated refresh_token) + retries; second `401` ⇒ prompt reconnect · [ ] user disconnect deletes the user secret only; admin disconnect removes the company OAuth client.

**Functionality (workspace agent):** [ ] runs identity smoke test `GET /api/v4/contacts?me=true`, caches `data[0].id` for "my tasks" · [ ] lists/searches tasks, folders/projects, comments, timelogs, contacts (read works under `wsReadOnly`) · [ ] paginates with `pageSize`+`nextPageToken` · [ ] (only with `wsReadWrite`) creates tasks, updates status, posts comments, logs time · [ ] surfaces `errorDescription` verbatim on failures.

## 6. Testing Plan

**Manual:** (1) admin setup — register the OAuth app, paste client_id/secret. (2) user connect — complete OAuth; confirm backend stored token **and** resolved `host` (test an EU account if available — expect `app-eu.wrike.com`, not `www.wrike.com`). (3) identity — "who am I in Wrike?" → `GET /api/v4/contacts?me=true`. (4) read tasks — "show my active Wrike tasks" → `GET /api/v4/tasks?status=Active&responsibles=["<myId>"]`. (5) read projects — "list my Wrike projects and their status" → `GET /api/v4/folders?project=true`. (6) pagination — >1000-task account; confirm the agent follows `nextPageToken` and stops correctly. (7) token refresh — wait >1h / force expiry; confirm a call refreshes and the rotated refresh_token is persisted. (8) write gate under `wsReadOnly` — ask to create a task → expect a graceful "read-only, reconnect with write scope" message, not a raw `403`. (9) with `wsReadWrite` — create a task, complete it, comment, log time; verify each landed in the Wrike UI. (10) disconnect — confirm subsequent calls fail + prompt reconnect.

**Edge cases:** [ ] EU-resident account (wrong-host failure if `host` is hardcoded) · [ ] rotated refresh token (second refresh must use the new token) · [ ] empty result sets / `nextPageToken` returned with empty `data` · [ ] `429` rate-limit handling (no reliable headers — backoff on 429) · [ ] write attempt under `wsReadOnly` → `403 not_allowed` · [ ] account-level `GET /api/v4/comments` with a >7-day range → `invalid_parameter`.

_See also: [Connector Framework Documentation](../../documentation/connectors/README.md); `02` (dev API reference); `04` (OAuth app creation, token-`host`, rotating refresh-token)._
