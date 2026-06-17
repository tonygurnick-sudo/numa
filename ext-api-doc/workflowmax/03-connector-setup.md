---
api_name: WorkflowMax (by Xero)
connector_id: workflowmax
auth_type: oauth2
tier: standard (Tier 2 OAuth2)
category: Project Management
integration_path: direct-api (via connector `request` operation — no file-browser surface, no Python backend provider class)
status: connector ALREADY EXISTS; this doc reproduces + explains the real registry entry
prereqs: 00-api-investigation-questionnaire.md, 02-api-spec-investigation.md, documentation/connectors/README.md
---

# WorkflowMax — Connector & Integration Setup

## Integration Type — Direct API Only (via `connectors(name="request", …)`)

| Component                | Required?                 | Notes                                                                                    |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| Connector Registry entry | **Yes — already present** | `connectorRegistry.ts`, `id: 'workflowmax'` (below)                                      |
| Admin setup wizard       | Yes (generic)             | shared `OAuthWizard` — no bespoke component                                              |
| Backend provider class   | **No**                    | Direct-API connectors have no `lib/oauth-providers/*` file-browser class                 |
| Workspace agent prompt   | Yes                       | `01-llm-api-rules.md` (+ folder) — deployed to S3, see §3                                |
| Feature flag             | `DATA_CONNECTORS_ENABLED` | same master switch as all native connectors / the Secrets Vault                          |
| i18n keys                | Generic                   | display strings come from the registry; no per-connector i18n for the generic OAuth flow |

## 1. Connector Registry Entry (the real one)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, in the "Tier 2: OAuth2 (new)" block. Verbatim — the OAuth wizard + proxy read these live values:

```typescript
{
  id: 'workflowmax',
  displayName: 'WorkflowMax',
  icon: 'bi-kanban',
  description: 'Project management and job tracking for professional services',
  category: 'Project Management',
  authType: 'oauth2',
  oauth: {
    authUrl: 'https://oauth.workflowmax2.com/oauth/authorize',
    tokenUrl: 'https://oauth.workflowmax2.com/oauth/token',
    scopes: 'openid profile email workflowmax',
    extraAuthParams: '{"prompt":"consent"}',
  },
  oauthSetupSteps: [
    'Log in to the Xero Developer portal (developer.xero.com)',
    'Create a new app and select "Web app" as the integration type',
    'Add the redirect URI below under "OAuth 2.0 redirect URIs"',
    'Copy the Client ID and generate a Client Secret',
  ],
},
```

| Field                   | Value                                                           | Notes                                                                         |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                    | `workflowmax`                                                   | stable connector ID — also the vault secret slug + `ext-api-doc/` folder name |
| `displayName`           | `WorkflowMax`                                                   | card title in `/integrations`                                                 |
| `icon`                  | `bi-kanban`                                                     | Bootstrap Icons glyph (no SVG asset)                                          |
| `description`           | `Project management and job tracking for professional services` | card subtitle                                                                 |
| `category`              | `Project Management`                                            | groups with Podio, Wrike, etc.                                                |
| `authType`              | `oauth2`                                                        | drives the generic `OAuthWizard`                                              |
| `oauth.authUrl`         | `https://oauth.workflowmax2.com/oauth/authorize`                | **WorkflowMax 2** identity host (NOT `login.xero.com`)                        |
| `oauth.tokenUrl`        | `https://oauth.workflowmax2.com/oauth/token`                    | **WorkflowMax 2** token host (NOT `identity.xero.com`)                        |
| `oauth.scopes`          | `openid profile email workflowmax`                              | ⚠️ **omits `offline_access`** — see gap note                                  |
| `oauth.extraAuthParams` | `{"prompt":"consent"}`                                          | forces the consent screen (org selection + consent capture)                   |
| `oauthSetupSteps`       | 4-step admin checklist                                          | rendered in the wizard as "create your OAuth app" instructions                |

> **No `surfaces` key.** File-browser connectors (`googledrive`, `dropbox`, `onedrive`) declare `surfaces: ['files', 'chat']` + a `cachingPolicy`. WorkflowMax declares neither — chat/Direct-API only, no Files Remote surface. Intentional + correct for a Direct-API connector.

> **⚠️ Scope gap — `offline_access`.** Registry scope string omits `offline_access`. WorkflowMax 2 access tokens are short-lived (~12-30 min) and vendor docs state a refresh token is **only** issued with `offline_access` granted. Official authorize example: `scope=openid profile email workflowmax offline_access` + `prompt=consent`. **Recommendation: add `offline_access` to `oauth.scopes` before WorkflowMax goes to a customer** (one-line registry change), else the connection needs full re-consent every few minutes. See `04-connection-and-reauth.md`.

### Redirect URI

No literal stored in the registry — Numa generates it per connector secret at wizard time. From `OAuthWizard.tsx`: `{frontendBaseUrl}/oauth/callback/{oauthSecretId}` e.g. `https://acme.numa.arcanum.ai/oauth/callback/oauth-client-workflowmax-<id>`. The admin copies this from the wizard into the WorkflowMax/Xero developer app's "OAuth 2.0 redirect URIs" — must match byte-for-byte.

## 2. Backend Provider Class — NOT APPLICABLE

Direct-API connectors get no `lib/oauth-providers/{id}_provider.py` class. That file/`PROVIDER_REGISTRY` pattern is only for **file-browser** connectors implementing `list_files`/`download_file`/`search_files`/`get_file_metadata` (Google Drive, OneDrive, Dropbox, Synergy). WorkflowMax has no browsable file tree → no provider class, no `PROVIDER_REGISTRY` registration, no `handleListProviders`/`getProviderConfig` wiring.

Instead the agent reaches the API through the generic connectors **`request`** operation. The proxy reads the user's stored OAuth token, injects `Authorization: Bearer {access_token}` + the required `account_id` header (see `01-llm-api-rules.md`), and forwards. The agent supplies a path/URL + params, never handles credentials — same wiring as simPRO, Zoho CRM, MYOB:

```
connectors(name="request", params={
    connector: "workflowmax",
    url: "/job.api/current?detailed=true&page=1&pagesize=100",
    description: "List currently-active WorkflowMax jobs"
})
```

## 3. ext-api-doc Deployment (how the agent gets these docs)

Files in `ext-api-doc/workflowmax/` are **not** bundled into the agent image — they sync to a per-client S3 bucket at deploy time and load at runtime when the connector is active.

Mechanism — `infra/stacks/numa-client-stack.ts` (the `// ── Sync ext-api-doc files to S3 ──` block):

1. Walk `ext-api-doc/` recursively for every non-dotfile, **excluding `_templates/`** (dev-only, never shipped).
2. Each file → an `S3Object` uploaded to `core.extApiDocBucket` with its relative path as the S3 key (`workflowmax/01-llm-api-rules.md`, etc.), `contentType: 'text/markdown'`, `Fn.filemd5(source)` source hash (re-uploads only on change).
3. Bucket name/ARN passed to the workspace agent constructs (`extApiDocBucketName`/`extApiDocBucketArn`).

What the agent loads: `01-*.md` (LLM API rules + companions) is pulled into context when the connector is active. `00-*` (questionnaire), `02-*` (dev spec), `03-*`/`04-*` (setup) are developer-facing — they ship to S3 too but the agent's working knowledge comes from `01-*`. Keep `01-llm-api-rules.md` under ~300 lines.

> **Takeaway:** to change what the agent knows, edit `01-llm-api-rules.md` (+ `01a`–`01d`) and redeploy the client stack. Editing `02`/`03`/`04` updates the developer reference but not the agent's behaviour.

## 4. Deployment Checklist

> Direct-API OAuth2 connector. Generic file-connector items (Files Remote browse/search/download, provider class, `package-all.sh` Lambda) do NOT apply.

**Code:** [x] registry entry present (`id: 'workflowmax'`) · [x] icon `bi-kanban` (no SVG) · [x] `oauthSetupSteps` written · [ ] **add `offline_access` to `oauth.scopes`** (recommended — §1) · [ ] `01-llm-api-rules.md` present + <~300 lines · [ ] `02/03/04` present · [ ] no backend provider class (correct).

**Auth flow (generic OAuth wizard):** [ ] admin completes WorkflowMax/Xero developer-app setup (`oauthSetupSteps`) · [ ] admin pastes the generated redirect URI into the app · [ ] admin saves Client ID + Secret → company OAuth-client secret in the vault · [ ] user connect completes (consent forced by `prompt=consent`), stores user token · [ ] access JWT yields an Org ID, proxy replays it as `account_id` · [ ] token refresh works (**blocked until `offline_access` added**) · [ ] user disconnect deletes only the user secret; admin disconnect removes the company secret.

**Workspace agent:** [ ] `ext-api-doc/workflowmax/*` synced to client `extApiDocBucket` (auto via `numa-client-stack.ts`) · [ ] agent can issue `connectors(name="request", connector="workflowmax", …)` and gets 200 · [ ] connectivity smoke test (`/staff.api/list` or `GET /staff`) returns staff.

**CI/CD:** [ ] no new Lambda — Direct-API connectors add nothing to `.gitlab-ci.yml`/`package-all.sh` · [ ] frontend build succeeds (registry change is type-checked).

## 5. Manual Testing Sequence

1. **Admin setup:** create the OAuth app in the Xero/WorkflowMax developer portal, paste the redirect URI, save Client ID + Secret in the Numa admin connector wizard.
2. **User connect:** as a regular user, connect WorkflowMax; complete the consent screen (forced by `prompt=consent`), pick the org.
3. **Connectivity:** "list WorkflowMax staff" → expect a staff list (lowest-risk call).
4. **Read jobs:** "show me currently active jobs" → `GET /job.api/current` (or `GET /job`).
5. **Reporting:** "how many hours did each person log this week?" → `GET /time.api/list?from=…&to=…`.
6. **Token expiry:** wait > token lifetime (~12-30 min), repeat a call. **Without `offline_access` this fails and requires re-consent** — that's the gap to fix.
7. **Destructive guard:** "delete a client" → agent must require explicit confirmation (`client.api/delete`/`archive` are destructive).
8. **User disconnect:** disconnect, confirm calls now fail with a "reconnect required" path.

**Edge cases:** [ ] `account_id` missing → 401/403 (verify proxy injects it) · [ ] expired access token mid-session → refresh (once `offline_access` added) or reconnect prompt · [ ] HTTP 200 with `Status:"Error"` body → surfaced as an error, not success · [ ] wrong base host → 404 at host level; try the other host first · [ ] rate-limit / 429 (numbers unknown — back off conservatively).

_See also: `02-api-spec-investigation.md` (dev API reference), `04-connection-and-reauth.md` (OAuth app registration, token refresh, reauth triggers), `documentation/connectors/README.md`._
