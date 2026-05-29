---
api_name: 'WorkflowMax (by Xero)'
connector_id: 'workflowmax'
auth_type: 'oauth2'
tier: 'standard'
category: 'Project Management'
integration_path: 'direct-api'
---

# WorkflowMax -- Connector & Integration Setup

> Build / reference notes for the WorkflowMax connector in Numa.
>
> **This connector already exists.** This document reproduces and explains the _actual_
> registry entry rather than scaffolding a new one. The integration path is **Direct API via
> the connectors `request` operation** — there is no file-browser surface and no Python
> backend provider class for WorkflowMax.
>
> **Prerequisites:** read `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`,
> and the [Numa Connectors documentation](../../documentation/connectors/README.md).

---

## Integration Type

**Selected path:** Direct API Only (Direct API via `connectors(name="request", …)`).

| Component                | Required?                     | Notes                                                                                           |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Connector Registry entry | **Yes — already present**     | `connectorRegistry.ts`, `id: 'workflowmax'` (reproduced below)                                  |
| Admin setup wizard       | Yes (generic OAuth wizard)    | Uses the shared `OAuthWizard` — no bespoke component                                            |
| Backend provider class   | **No**                        | Direct-API connectors have no `lib/oauth-providers/*` file-browser class                        |
| Workspace agent prompt   | Yes                           | `01-llm-api-rules.md` (+ this folder) — deployed to S3, see §3                                  |
| Feature flag             | Via `DATA_CONNECTORS_ENABLED` | Same master switch as all native connectors / the Secrets Vault                                 |
| i18n keys                | Generic                       | Display strings come from the registry; no per-connector i18n needed for the generic OAuth flow |

---

## 1. Connector Registry Entry (the real one)

> **File:** `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
>
> This is the **actual** entry as it exists in the codebase today (in the
> "Tier 2: OAuth2 (new)" block), reproduced verbatim. Do not paraphrase from the generic
> template — the live values below are what the OAuth wizard and proxy read.

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

**Field-by-field:**

| Field                   | Value                                                           | Notes                                                                           |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                    | `workflowmax`                                                   | Stable connector ID — also the vault secret slug and `ext-api-doc/` folder name |
| `displayName`           | `WorkflowMax`                                                   | Card title in `/integrations`                                                   |
| `icon`                  | `bi-kanban`                                                     | Bootstrap Icons glyph (not an SVG asset)                                        |
| `description`           | `Project management and job tracking for professional services` | Card subtitle                                                                   |
| `category`              | `Project Management`                                            | Groups it with Podio, Wrike, etc.                                               |
| `authType`              | `oauth2`                                                        | Drives the generic `OAuthWizard`                                                |
| `oauth.authUrl`         | `https://oauth.workflowmax2.com/oauth/authorize`                | **WorkflowMax 2** identity host (NOT `login.xero.com`)                          |
| `oauth.tokenUrl`        | `https://oauth.workflowmax2.com/oauth/token`                    | **WorkflowMax 2** token host (NOT `identity.xero.com`)                          |
| `oauth.scopes`          | `openid profile email workflowmax`                              | ⚠️ **omits `offline_access`** — see the gap note below                          |
| `oauth.extraAuthParams` | `{"prompt":"consent"}`                                          | Forces the consent screen so the org is selected and consent is captured        |
| `oauthSetupSteps`       | 4-step admin checklist                                          | Rendered in the wizard as the "create your OAuth app" instructions              |

> **Note — no `surfaces` key.** File-browser connectors (e.g. `googledrive`, `dropbox`,
> `onedrive`) declare `surfaces: ['files', 'chat']` and a `cachingPolicy`. WorkflowMax declares
> neither: it is chat/Direct-API only, with no Files Remote surface. This is intentional and
> correct for a Direct-API connector.

> **⚠️ Scope gap — `offline_access`.** The registry scope string omits `offline_access`.
> WorkflowMax 2 access tokens are short-lived (~12–30 min) and the vendor docs state a refresh
> token is **only** issued when `offline_access` is granted. The official WorkflowMax 2
> authorize example is `scope=openid profile email workflowmax offline_access` + `prompt=consent`.
> **Recommendation:** add `offline_access` to `oauth.scopes` before WorkflowMax goes to a
> customer, otherwise the connection needs full re-consent every few minutes. This is a
> registry change (one line) — flagged here so it isn't lost. See `04-connection-and-reauth.md`.

### Redirect URI

There is no redirect URI literal stored in the registry. Numa generates it per connector
secret at wizard time. From `OAuthWizard.tsx`:

```
{frontendBaseUrl}/oauth/callback/{oauthSecretId}
```

e.g. `https://acme.numa.arcanum.ai/oauth/callback/oauth-client-workflowmax-<id>`. The admin
copies this value out of the wizard and pastes it into the WorkflowMax/Xero developer app's
"OAuth 2.0 redirect URIs". It must match byte-for-byte.

---

## 2. Backend Provider Class — NOT APPLICABLE

Direct-API connectors do **not** get a `lib/oauth-providers/{id}_provider.py` class. That
file/`PROVIDER_REGISTRY` pattern is only for **file-browser** connectors that implement
`list_files` / `download_file` / `search_files` / `get_file_metadata` (Google Drive, OneDrive,
Dropbox, Synergy). WorkflowMax has no browsable file tree, so:

- No provider class.
- No `PROVIDER_REGISTRY` registration.
- No `handleListProviders` / `getProviderConfig` file-browser wiring.

Instead, the workspace agent reaches the API through the generic connectors **`request`**
operation. The proxy reads the OAuth token the user stored at connect time, injects
`Authorization: Bearer {access_token}` (and the required `account_id` header — see the agent
rules in `01-llm-api-rules.md`), and forwards the call. The agent supplies a path/URL and
parameters; it never handles credentials. This is the same wiring as the other Tier-2 OAuth2
business systems (simPRO, Zoho CRM, MYOB).

```
# How the agent calls WorkflowMax (illustrative — see 01-llm-api-rules.md for the real rules):
connectors(name="request", params={
    connector: "workflowmax",
    url: "/job.api/current?detailed=true&page=1&pagesize=100",
    description: "List currently-active WorkflowMax jobs"
})
```

---

## 3. ext-api-doc Deployment (how the agent gets these docs)

The files in this folder (`ext-api-doc/workflowmax/`) are **not** bundled into the agent image.
They are synced to a per-client S3 bucket at deploy time and loaded by the workspace agent at
runtime when the connector is active.

**Mechanism — `infra/stacks/numa-client-stack.ts`** (the `// ── Sync ext-api-doc files to S3 ──`
block near the end of the stack):

1. The stack walks `ext-api-doc/` recursively for every non-dotfile, **excluding `_templates/`**
   (dev-only reference — never shipped).
2. Each file becomes an `S3Object` uploaded to `core.extApiDocBucket` with its relative path as
   the S3 key (`workflowmax/01-llm-api-rules.md`, `workflowmax/02-api-spec-investigation.md`,
   etc.), `contentType: 'text/markdown'`, and a `Fn.filemd5(source)` source hash so re-uploads
   only happen on change.
3. The bucket name/ARN are passed to the workspace agent constructs (`extApiDocBucketName` /
   `extApiDocBucketArn`) so the running agent can read them.

**What the agent actually loads:** `01-*.md` (the LLM API rules + companions) is the file pulled
into the agent's context when the WorkflowMax connector is active. `00-*` (questionnaire),
`02-*` (this dev spec), and `03-*`/`04-*` (these setup docs) are developer-facing reference —
they ship to S3 too, but the agent's working knowledge comes from `01-*`. Keep `01-llm-api-rules.md`
under ~300 lines for that reason.

> **Takeaway:** to change what the agent knows about WorkflowMax, edit `01-llm-api-rules.md`
> (and `01a`–`01d` if present) and redeploy the client stack. Editing `02`/`03`/`04` updates
> the developer reference but does not change the agent's behaviour.

---

## 4. Deployment Checklist

> Tailored for a Direct-API OAuth2 connector. The generic file-connector checklist items
> (Files Remote browse/search/download, provider class, `package-all.sh` Lambda) **do not apply**.

### Code

- [x] Registry entry present in `connectorRegistry.ts` (`id: 'workflowmax'`)
- [x] Icon set (`bi-kanban` — Bootstrap Icons glyph, no SVG asset needed)
- [x] `oauthSetupSteps` written for the admin wizard
- [ ] **Add `offline_access` to `oauth.scopes`** (recommended — see §1 gap note)
- [ ] `ext-api-doc/workflowmax/01-llm-api-rules.md` present and < ~300 lines (it is)
- [ ] `ext-api-doc/workflowmax/02/03/04` present (this set)
- [ ] No backend provider class (correct — Direct API)

### Auth Flow (generic OAuth wizard)

- [ ] Admin completes the WorkflowMax/Xero developer-app setup (`oauthSetupSteps`)
- [ ] Admin pastes the generated redirect URI (`{frontendBaseUrl}/oauth/callback/{oauthSecretId}`) into the app
- [ ] Admin saves Client ID + Client Secret → stored as the company OAuth-client secret in the vault
- [ ] User connect flow completes (consent screen forced by `prompt=consent`) and stores the user token
- [ ] Confirm the access JWT yields an Org ID and the proxy replays it as the `account_id` header
- [ ] Token refresh works (**blocked until `offline_access` is added** — see §1)
- [ ] User disconnect deletes only the user secret; admin disconnect removes the company secret

### Workspace Agent

- [ ] `ext-api-doc/workflowmax/*` synced to the client `extApiDocBucket` (automatic via `numa-client-stack.ts`)
- [ ] Agent can issue `connectors(name="request", connector="workflowmax", …)` and gets a 200
- [ ] Connectivity smoke test (`/staff.api/list` or `GET /staff`) returns staff

### CI/CD

- [ ] No new Lambda — Direct-API connectors add nothing to `.gitlab-ci.yml` / `package-all.sh`
- [ ] Frontend build succeeds (registry change is type-checked)

---

## 5. Manual Testing Sequence

1. **Admin setup:** create the OAuth app in the Xero/WorkflowMax developer portal, paste the
   redirect URI, save Client ID + Secret in the Numa admin connector wizard.
2. **User connect:** as a regular user, connect WorkflowMax; complete the consent screen
   (forced by `prompt=consent`) and pick the org.
3. **Connectivity:** ask the agent to "list WorkflowMax staff" → expect a staff list (lowest-risk call).
4. **Read jobs:** "show me currently active jobs in WorkflowMax" → `GET /job.api/current` (or `GET /job`).
5. **Reporting:** "how many hours did each person log this week?" → `GET /time.api/list?from=…&to=…`.
6. **Token expiry:** wait > token lifetime (~12–30 min), repeat a call. **Without `offline_access`
   this will fail and require re-consent** — that's the gap to fix.
7. **Destructive guard:** ask to "delete a client" → agent must require explicit confirmation
   (`client.api/delete`/`archive` are destructive).
8. **User disconnect:** disconnect, confirm calls now fail with a "reconnect required" path.

### Edge Cases

- [ ] `account_id` header missing → 401/403 (verify the proxy injects it)
- [ ] Expired access token mid-session → refresh (once `offline_access` is added) or reconnect prompt
- [ ] HTTP 200 with `Status: "Error"` body → surfaced as an error, not a success
- [ ] Wrong base host → 404 at host level; try the other host before assuming the resource is wrong
- [ ] Rate-limit / 429 handling (numbers unknown — back off conservatively)

---

_Generated from the investigation questionnaire. See also:_

- _`02-api-spec-investigation.md` — clean developer API reference_
- _`04-connection-and-reauth.md` — OAuth app registration, token refresh, reauth triggers_
- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
