---
api_name: 'Wrike'
connector_id: 'wrike'
auth_type: 'oauth2'
tier: 'standard'
category: 'Project Management'
integration_path: 'direct-api'
---

# Wrike -- Connector & Integration Setup

> How the Wrike integration is wired into Numa. The connector **already exists** in the
> registry — this document reproduces and explains the actual entry rather than scaffolding
> a new one.
>
> **Prerequisites:** Read `00-api-investigation-questionnaire.md`, `02-api-spec-investigation.md`,
> and the [Numa Connectors documentation](../../documentation/connectors/README.md). Activate
> the `numa-connectors` skill before changing anything here.

---

## Integration Type

**Selected path:** Direct API Only — the workspace agent calls Wrike through the
`connect_request` tool. There is **no Files > Remote surface** (the registry entry omits
`surfaces`, which defaults to `['chat']`), and **no backend provider class** (those exist
only for file-browsing connectors like Drive/Gmail/OneDrive/Dropbox under
`lib/oauth-providers/`). Wrike is purely action/read-oriented.

| Component                | Required?     | Notes                                                                                                                        |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Connector Registry entry | Yes           | Already present — see §1. `id: 'wrike'`, `authType: 'oauth2'`.                                                               |
| Admin setup wizard       | Yes (generic) | The shared OAuth wizard (`OAuthWizard`) handles it — driven by the registry entry + `oauthSetupSteps`. No bespoke component. |
| Backend provider class   | **No**        | Direct API path — no `lib/oauth-providers/wrike_provider.py`. Calls go through `connect_request`.                            |
| Workspace agent prompt   | Yes           | `01-llm-api-rules.md` (+ `01a`–`01d` companions). See §3.                                                                    |
| Feature flag             | Yes           | `DATA_CONNECTORS_ENABLED` gates the whole connectors/vault surface. No Wrike-specific flag.                                  |
| i18n keys                | Minimal       | Display name/description come from the registry entry; the generic wizard provides the UI strings.                           |

---

## 1. Connector Registry Entry (actual)

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

This is the real, deployed entry (verbatim from `CONNECTOR_REGISTRY`):

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

### Field-by-field

| Field             | Value                                                  | Notes                                                                                      |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `id`              | `wrike`                                                | Slug. Drives the ext-api-doc folder name, vault key prefixes, and the OAuth callback path. |
| `displayName`     | `Wrike`                                                | Shown in the Integrations UI.                                                              |
| `icon`            | `bi-diagram-3`                                         | Bootstrap Icon (org-chart glyph) — not a custom SVG.                                       |
| `description`     | `Enterprise work management and project collaboration` |                                                                                            |
| `category`        | `Project Management`                                   | Groups it with other PM connectors in the picker.                                          |
| `authType`        | `oauth2`                                               | Drives the OAuth wizard branch (vs `token` / `api-key`).                                   |
| `oauth.authUrl`   | `https://login.wrike.com/oauth2/authorize/v4`          | **Global host** — same for all regions. Region only affects the API host (see §2).         |
| `oauth.tokenUrl`  | `https://login.wrike.com/oauth2/token`                 | **Global host.**                                                                           |
| `oauth.scopes`    | `wsReadOnly`                                           | **Read-only.** Widen to `Default,wsReadWrite` for write actions (see §1.1).                |
| `oauthSetupSteps` | 3-step array                                           | Rendered as admin instructions inside the wizard.                                          |

**Notable omissions (and what they default to):**

- **No `extraAuthParams`** — Wrike doesn't need `access_type=offline`/`prompt=consent` style extras (unlike Google/Xero). The authorize request is plain `response_type=code` + `client_id` + `redirect_uri` + `scope` (+ optional `state`).
- **No `authHeaderScheme`** — defaults to `Bearer`. Correct for Wrike (the API uses standard `Authorization: Bearer {token}`). Contrast Zoho, which sets `authHeaderScheme: 'Zoho-oauthtoken'`.
- **No `credentialFields`** — those are only for `token` / `api-key` connectors. OAuth client_id/client_secret are collected by the OAuth wizard, not via `credentialFields`.
- **No `baseUrl`** — deliberately. The Wrike API host is **region-specific and discovered at runtime from the OAuth token response (`host` field)**. There is no static base URL to put here; the backend stores the resolved host at connect time. (See `02-api-spec-investigation.md` and `04-connection-and-reauth.md`.)
- **No `surfaces`** — defaults to `['chat']` ⇒ Direct API only, not in Files > Remote.
- **No `cachingPolicy`** — no remote-browse cache to tune (Direct API path).
- **No `eventTypes`** — Wrike webhooks are not wired into Numa; polling only.

The registry types are defined at the top of the same file (`ConnectorTemplate`, `CredentialFieldDef`, etc.). `oauth.scopes` is a single **string** (Wrike wants comma-delimited scopes), not an array.

### 1.1 To enable writes (scope widening)

Wrike create/update/comment/timelog actions all require `wsReadWrite`. To turn them on:

1. Change `oauth.scopes` to `'Default,wsReadWrite'` in the registry entry.
2. Re-register (or re-consent on) the Wrike OAuth app so the new scope is granted.
3. Have each user **reconnect** — existing read-only tokens won't gain write access.

Until then, any write returns `403 not_allowed` and the agent treats Wrike as read-only
(documented in `01-llm-api-rules.md` and `01c-mutation-patterns.md`).

---

## 2. No Backend Provider Class

Direct API connectors have **no** `lib/oauth-providers/<id>_provider.py` and are **not**
registered in `lib/oauth-providers/__init__.py`. That layer exists only for file-browsing
connectors that implement `list_files` / `download_file` / `search_files` /
`get_file_metadata` and surface in Files > Remote.

For Wrike, the workspace agent issues requests through the **`connect_request`** tool, which:

1. Looks up the connection's stored credentials (access token + the region-resolved `host`).
2. Refreshes the access token automatically on `401` (rotating refresh-token — see §4 and `04-connection-and-reauth.md`).
3. Injects `Authorization: Bearer {access_token}`.
4. Resolves relative paths (`/tasks`, `/folders/{id}/tasks`) against `https://{host}/api/v4`.

The agent never builds an absolute `www.wrike.com` URL or constructs the auth header itself
— it passes relative paths and the backend does the host + auth wiring. This is exactly the
`connect_request` model used by the Zoho CRM connector.

---

## 3. Workspace Agent Prompt Deployment

The agent's knowledge of Wrike comes from the markdown files in this folder
(`ext-api-doc/wrike/`):

- `01-llm-api-rules.md` — main rules, < 300 lines (loaded into agent context when Wrike is active)
- `01a-domain-model-reference.md` — Folder/Project, Task, Comment, Timelog, Contact
- `01b-query-patterns.md` — filters, date-range JSON params, `pageSize`/`nextPageToken`
- `01c-mutation-patterns.md` — create/update/comment/timelog + the `wsReadWrite` gate
- `01d-event-and-error-handling.md` — webhooks/polling, error model, rate limits, backoff

### How these files reach the agent

> File: `infra/stacks/numa-client-stack.ts` (the "Sync ext-api-doc files to S3" block, ~line 1135)

At deploy time, `numa-client-stack.ts` walks the `ext-api-doc/` directory recursively and
uploads every non-dotfile markdown file to the per-client **ext-api-doc S3 bucket**
(`{clientName}-ext-api-doc`, created in `core-numa-infra-construct.ts`). Each file becomes an
`S3Object` keyed by its path relative to `ext-api-doc/` (e.g. `wrike/01-llm-api-rules.md`),
with `contentType: 'text/markdown'` and a `filemd5` source hash so changed files re-upload.

- The `_templates/` directory is **explicitly excluded** from the sync (dev-only reference).
- The bucket name is exposed to the workspace agent via the `EXT_API_DOC_BUCKET_NAME` env var.
- The agent loads the relevant `01-*.md` rules for whichever connector is active — `01-llm-api-rules.md` is the one that must stay ≤300 lines because it's loaded into the live context window.

So: edit the markdown here → `make deploy` (or a client deploy) re-syncs the files to S3 →
the agent picks up the new rules on its next run. No code change is needed to update the
agent's Wrike knowledge, only the markdown.

---

## 4. Token / Auth Wiring (summary)

Full detail is in `04-connection-and-reauth.md`. The Wrike-specific essentials the connector
plumbing must honour:

1. **Region host from the token.** The token-exchange response carries a `host` field
   (`www.wrike.com`, `app-eu.wrike.com`, …). Store it with the credentials; build every API
   URL from it. **Never hardcode `www.wrike.com`.**
2. **Rotating refresh token.** Every refresh returns a NEW access_token AND a NEW
   refresh_token. The backend must persist the rotated refresh_token each time — failing to
   do so loses access on the next refresh.
3. **Auth host is global.** `login.wrike.com` for both authorize and token exchange,
   regardless of region.

---

## 5. Deployment Checklist

Direct API Only — the file-browser checklist items (Files Remote, download, metadata,
per-connector Lambda) do **not** apply. The relevant items:

### Code

- [x] Registry entry present in `connectorRegistry.ts` (`id: 'wrike'`)
- [x] Connector icon set (`bi-diagram-3`, Bootstrap Icon)
- [x] `oauthSetupSteps` populated for the generic OAuth wizard
- [ ] (If enabling writes) widen `oauth.scopes` to `Default,wsReadWrite`
- [x] ext-api-doc prompt files (`01-*.md`) present and ≤300 lines for `01-llm-api-rules.md`
- [N/A] Backend provider class — Direct API path, none needed
- [N/A] Provider registered in `__init__.py` — none needed
- [N/A] Per-connector Lambda / CI matrix entry — none needed

### Auth flow

- [ ] Admin registers a Wrike OAuth app and saves client_id/client_secret via the wizard (company vault)
- [ ] User connect flow completes the authorization_code exchange; backend stores the rotated refresh_token **and** the `host`
- [ ] On `401`, backend refreshes once (persisting the rotated refresh_token) and retries; second `401` ⇒ prompt reconnect
- [ ] User disconnect deletes the user secret only; admin disconnect removes the company OAuth client

### Functionality (workspace agent)

- [ ] Agent runs the identity smoke test `GET /api/v4/contacts?me=true` and caches `data[0].id` for "my tasks"
- [ ] Agent lists/searches tasks, folders/projects, comments, timelogs, contacts (read works under `wsReadOnly`)
- [ ] Agent paginates with `pageSize` + `nextPageToken`
- [ ] (Only with `wsReadWrite`) Agent creates tasks, updates status, posts comments, logs time
- [ ] Agent surfaces `errorDescription` verbatim on failures

---

## 6. Testing Plan

### Manual sequence

1. **Admin setup:** register the Wrike OAuth app, paste client_id/client_secret into the wizard.
2. **User connect:** complete OAuth; confirm the backend stored the token **and** the resolved `host` (test an EU account if available — verify it returns `app-eu.wrike.com`, not `www.wrike.com`).
3. **Identity:** ask the agent "who am I in Wrike?" → expect `GET /api/v4/contacts?me=true`.
4. **Read tasks:** "show my active Wrike tasks" → `GET /tasks?status=Active&responsibles=["<myId>"]`.
5. **Read projects:** "list my Wrike projects and their status" → `GET /folders?project=true`.
6. **Pagination:** trigger a >1000-task account; confirm the agent follows `nextPageToken` and stops correctly.
7. **Token refresh:** wait >1h (or force expiry); confirm a call refreshes and the rotated refresh_token is persisted.
8. **Write gate (under `wsReadOnly`):** ask the agent to create a task → expect a graceful "read-only, reconnect with write scope" message, not a raw `403`.
9. **(With `wsReadWrite`)** create a task, complete it, comment, log time; verify each landed in the Wrike UI.
10. **Disconnect:** confirm subsequent calls fail and prompt reconnect.

### Edge cases

- [ ] EU-resident account (wrong-host failure if `host` is hardcoded)
- [ ] Rotated refresh token (second refresh must use the new token)
- [ ] Empty result sets / `nextPageToken` returned with empty `data`
- [ ] `429` rate-limit handling (no reliable headers — backoff on 429)
- [ ] Write attempt under `wsReadOnly` → `403 not_allowed`
- [ ] Account-level `GET /comments` with a >7-day range → `invalid_parameter`

---

_Generated from `00-api-investigation-questionnaire.md`. Registry entry cited from
`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _`02-api-spec-investigation.md` — dev API reference_
- _`04-connection-and-reauth.md` — OAuth app creation, token-`host`, rotating refresh-token handling_
