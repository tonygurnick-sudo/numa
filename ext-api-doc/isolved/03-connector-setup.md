---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — admin supplies the Instance URL)
path_version_segment: none confirmed; base ends at /rest/api [VERIFY WITH PARTNER DOCS]
urls: relative preferred through the connector once the Instance URL is wired; absolute per-tenant on fallback (§wiring)
call_surface: HTTP via `numa integrations request` (connector=isolved); native data connector
auth: OAuth2 CLIENT-CREDENTIALS via `oauthAdapter:'isolved'` — company-level service credential, NO per-user OAuth, NO refresh token
confidence: the registry entry below is the REAL Numa entry (verbatim from connectorRegistry.ts). The backend client-credentials adapter and OAuthWizard Instance-URL collection are NOT yet implemented — flagged explicitly in §"Implementation status". isolved-side facts are partner-corroborated, not live-validated.
---

# isolved — Connector & Integration Setup

How the `isolved` connector is wired into Numa: registry entry, the company-level client-credentials
model, the per-tenant Instance URL, the per-client grant, vault storage, and the deploy path. **The
registry entry already exists**; this reproduces and explains the actual entry **and flags the
backend pieces that still need building** before it works end-to-end.

## 1. Product context

|                |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| Vendor         | isolved (isolved HCM, LLC — Charlotte, NC) — HCM / payroll / HR / benefits / time            |
| Product        | Employees, Payroll, Deductions, Benefit Enrollment (read + grant-gated write)                |
| App URL        | per-tenant `https://{tenant}.myisolved.com` (e.g. `rkl.myisolved.com`, `aee.myisolved.com`)  |
| API base URL   | **per-tenant** `https://{tenant}.myisolved.com/rest/api` (admin supplies the Instance URL)   |
| Token endpoint | `{instance}/rest/api/token` — exact path **[VERIFY WITH PARTNER DOCS]**                      |
| Auth           | OAuth2 **client-credentials** — company-level `client_id`/`client_secret`; no per-user OAuth |
| Rate limits    | not published — assume 429 on breach; back off                                               |

⚠️ **Company-level service credential, not per-user OAuth.** One `client_id`/`client_secret` (issued
by isolved to the partner's API Application) mints a Bearer token server-side, shared by all users.
There is no authorize URL, no consent screen, no refresh token, and **no chat credential card** —
users paste nothing. The admin enters the company credential + the per-tenant Instance URL once.

## 2. Auth model — company service credential + per-tenant host + per-client grant

Three things, three owners:

- **Company credential (the partner's isolved API Application):** `client_id` + `client_secret`,
  issued by isolved to the Arcanum/Numa partner integration after the isolved Network onboarding
  (§4). Entered once by the admin. Mints the Bearer token via `grant_type=client_credentials`.
- **Per-tenant Instance URL:** `https://{tenant}.myisolved.com`, supplied by the admin. The API base
  is that host + `/rest/api`; the token endpoint is `{instance}/rest/api/token` [VERIFY path].
- **Per-client access grant (inside the customer's isolved tenant):** the customer's isolved admin
  grants the partner user access to each **Client Code** and runs **Refresh System Data** (§4.3).
  Without this, calls against that Client Code 403/404.

Every data call carries `Authorization: Bearer {access_token}`, minted + injected by the backend.
The agent never sets that header and never sees the token.

## 3. Connector Registry entry (actual — verbatim)

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (entry `id: 'isolved'`):

```typescript
{
  id: 'isolved',
  displayName: 'isolved',
  icon: 'bi-people-fill',
  description: 'HCM — employees, payroll, time and benefits (isolved People Cloud)',
  category: 'HR & Workforce',
  authType: 'oauth2',
  // Per-tenant host: isolved is served at {tenant}.myisolved.com, so the admin
  // sets the Instance URL; the API base is <instance>/rest/api.
  instanceUrlRequired: true,
  // isolved uses OAuth2 CLIENT-CREDENTIALS, NOT authorization-code: the admin's
  // company-level client_id/client_secret mint a Bearer token server-side —
  // one service credential shared by all users (no per-user redirect/consent).
  // `oauthAdapter:'isolved'` selects that client-credentials token exchange in
  // oauth-auth-handler/oauth_tools, which builds the token endpoint as
  // <instance>/rest/api/token from the admin's Instance URL.
  oauthAdapter: 'isolved',
  oauth: {
    authUrl: '',
    tokenUrl: '',
    scopes: '',
  },
  oauthSetupSteps: [
    'Join the isolved Network Partner program and submit the API Questionnaire to register this integration; isolved issues an API Application client_id and client_secret.',
    'Paste the client_id as Client ID and the client_secret as Client Secret here.',
    'Enter your isolved Instance URL (e.g. https://yourco.myisolved.com) as the Instance URL — the API base is that host + /rest/api.',
    'For each client, your isolved admin grants the partner user access: Security → Partner Users → Client Access → add the Client Code, then run Production Utilities → Refresh System Data.',
  ],
}
```

Field notes:

- **`authType: 'oauth2'`** — routes to the OAuthWizard (admin). But isolved does **not** use the
  authorization-code redirect — `oauthAdapter: 'isolved'` is meant to switch the backend to the
  client-credentials token exchange (see §"Implementation status").
- **`instanceUrlRequired: true`** — the admin **must** supply a per-tenant Instance URL. The wizard
  should block save on a blank value. (`instanceUrlRequired`/`instanceUrlOptional` are defined on
  `ConnectorTemplate` in `connectorRegistry.ts`.)
- **`oauthAdapter: 'isolved'`** — selects the isolved client-credentials token-mint path in the
  backend. The mechanism exists (`oauth_adapter` is read in both `oauth-auth-handler/index.ts` and
  `oauth_tools.py`), but **only `'totalsynergy'` is implemented today** — `'isolved'` must be added
  (see §"Implementation status").
- **`oauth: { authUrl: '', tokenUrl: '', scopes: '' }`** — empty on purpose: there's no fixed
  authorize/token URL (the token endpoint is built per-tenant from the Instance URL) and isolved's
  scope/allowed-methods are granted on the isolved side per integration, not requested here.
- The slug is registered in **both** native-connector lists (`infra/config/connectors.ts` →
  `NATIVE_CONNECTORS`, and `lambdas/python/workspace-chat-tools/tools/user_profile.py` →
  `_NATIVE_CONNECTOR_SLUGS`) — both already include `isolved`. (Note: in `connectors.ts` it currently
  sits under the `// API key` comment group, which is a cosmetic mislabel — it's an `oauth2`
  client-credentials connector; the comment groups don't affect behaviour, but consider moving it.)

## 4. Admin / partner onboarding

### 4.1 Become an isolved Network partner (one-time, partner-level)

isolved's API is gated behind the **isolved Network** partner program:

1. Join the isolved Network Partner program.
2. Submit the **API Questionnaire** to register this integration.
3. isolved registers an **API Application** for the integration and issues a **`client_id`** +
   **`client_secret`** (the company-level service credential). isolved also configures the
   **allowed-methods whitelist** for the integration (which objects/methods it may call).

> This is a partner-level step done once for the Numa integration, not per customer. The resulting
> `client_id`/`client_secret` is what the admin pastes in §4.2.

### 4.2 Numa admin setup (Integrations → isolved)

1. Open **Integrations**, pick **isolved**, start the wizard.
2. Follow `oauthSetupSteps`:
   - Paste the **`client_id`** as Client ID and the **`client_secret`** as Client Secret.
   - Enter the **Instance URL** (`https://{tenant}.myisolved.com`) — the API base is that host +
     `/rest/api`; the token endpoint is `{instance}/rest/api/token` [VERIFY path].
3. Save → the company credential + Instance URL are written to the company vault (§5).

### 4.3 Per-client grant (inside the customer's isolved tenant — required, per Client Code)

Before any call against a customer's Client Code succeeds, the customer's **isolved admin** must:

1. **Security → Partner Users → Client Access** → add the partner user's access to the **Client
   Code**.
2. **Production Utilities → Refresh System Data** — propagate the new access.

Until both are done, calls against that Client Code return **403/404** (01d). A tenant with several
Client Codes needs this per Client Code.

## 5. What gets stored (vault)

> ⚠️ **Storage shape depends on the backend pieces in §"Implementation status".** The intended
> model:

**Company config / OAuth-client entry (admin-entered, written once):**

| Field                         | Value                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `client_id` / `client_secret` | the partner API Application credential (client-credentials) [secret]      |
| `instance_url`                | `https://{tenant}.myisolved.com` — the per-tenant host the admin entered  |
| `oauth_adapter`               | `isolved` — selects the client-credentials token-mint path                |
| (derived) token endpoint      | `{instance_url}/rest/api/token` [VERIFY path] — built from `instance_url` |

**Minted token (server-side, transient — not admin-entered):** the access token from the
client-credentials mint, cached with its expiry and re-minted from `client_id`/`client_secret` when
expired. **No refresh token** (client-credentials has none).

**Base-URL resolution:** the backend `_resolve_connector_base_url` (in
`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads vault fields in priority
`api_endpoint` → `instance_url` → `base_url` (from the `connector-config-{slug}` then
`oauth-client-{slug}` entries). Persisting the admin's Instance URL as **`instance_url`** lets the
agent issue **relative** URLs (`/employees?...`) that expand to `{instance}/rest/api/...`. If nothing
is persisted, relative calls error with **"No base URL is configured for connector 'isolved'"** and
the agent must use absolute per-tenant URLs (01/04).

## 6. Implementation status — what's REAL vs TO-BE-BUILT

**Real today:**

- ✅ Registry entry (`id: 'isolved'`) with `authType: 'oauth2'`, `instanceUrlRequired: true`,
  `oauthAdapter: 'isolved'`, empty `oauth` URLs, and the `oauthSetupSteps`.
- ✅ Slug registered in both native-connector lists (`NATIVE_CONNECTORS` + `_NATIVE_CONNECTOR_SLUGS`).
- ✅ The `oauthAdapter` mechanism (`oauth_adapter` is read in `oauth-auth-handler/index.ts` and
  `oauth_tools.py`).
- ✅ `_resolve_connector_base_url` already reads `instance_url` — so relative URLs _would_ resolve
  once the Instance URL is persisted.
- ✅ The S3 deploy of these `ext-api-doc/isolved/*` files (§7).

**Must be built before isolved works end-to-end:**

1. **Client-credentials token-mint adapter for `'isolved'`.** Today only `oauth_adapter ==
'totalsynergy'` is handled in `oauth-auth-handler/index.ts` and `oauth_tools.py`; an unrecognised
   adapter falls through to the standard authorization-code path (which fails here — `oauth.authUrl`/
   `tokenUrl` are empty). Add an `isolved` branch that:
   - builds the token endpoint as `{instance_url}/rest/api/token` [VERIFY exact path],
   - POSTs `grant_type=client_credentials` with the company `client_id`/`client_secret` (form-field
     vs HTTP Basic [VERIFY]),
   - caches the token + expiry, and **re-mints on expiry** (no refresh token).
2. **Instance-URL collection for `oauth2` connectors in OAuthWizard.** Today only `ApiKeyWizard`
   renders/persists an Instance URL (`instance_url` → `connector-config-{slug}`); `OAuthWizard`
   ignores `instanceUrlRequired`. Either teach `OAuthWizard` to collect + persist the Instance URL
   when `instanceUrlRequired`/`instanceUrlOptional` is set, or route this connector's admin setup
   through a wizard that does. Persist it where `_resolve_connector_base_url` reads it (`instance_url`
   on `connector-config-isolved` or `oauth-client-isolved`).

> Until #1 and #2 land, the connector is registered and visible but not functional. This pack
> documents the **intended** runtime behaviour for the workspace agent so the `01*` rules are ready
> the moment the backend is wired.

## 7. How these docs reach the workspace agent

`ext-api-doc/` markdown is **not** bundled into the agent image — it's synced to a per-client S3
bucket at infra-deploy time and read at runtime.

File: `infra/stacks/numa-client-stack.ts` (search `Sync ext-api-doc files to S3`):

```typescript
const extApiDocPath = path.join(import.meta.dirname, '..', '..', 'ext-api-doc');
// ...reads every file under ext-api-doc/, EXCLUDES _templates/, and uploads each to
// the client's extApiDocBucket under key "<connector-id>/<filename>" with Fn.filemd5
// sourceHash so only changed files re-upload.
```

For this connector:

- Every file in `ext-api-doc/isolved/` uploads under key `isolved/<filename>` (folder = connector
  `id`).
- `_templates/` is excluded — never shipped.
- `sourceHash: Fn.filemd5(...)` → only changed files re-upload on the next deploy.
- When **isolved** is active, the agent loads `isolved/01-llm-api-rules.md` + the `01a`–`01d`
  companions. The `00`/`02`/`03`/`04` files are developer-facing reference, **not** runtime context.

## 8. Deployment checklist

**Registry & docs:**

- [x] Registry entry present (`isolved`, `authType: oauth2`, `instanceUrlRequired`, `oauthAdapter: 'isolved'`)
- [x] Slug in both native-connector lists (`NATIVE_CONNECTORS` + `_NATIVE_CONNECTOR_SLUGS`)
- [x] `ext-api-doc/isolved/` agent-rules files (`01*`) authored
- [ ] (optional) move the slug from the `// API key` comment group to an OAuth2/client-credentials group in `connectors.ts`

**Backend (to-be-built — §6):**

- [ ] Add the `isolved` client-credentials adapter to `oauth-auth-handler/index.ts` + `oauth_tools.py`
- [ ] Build the token endpoint as `{instance}/rest/api/token` [VERIFY] and re-mint on expiry (no refresh)
- [ ] Collect + persist the Instance URL (`instance_url`) for this `oauth2` connector

**Auth flow:**

- [ ] Partner: isolved Network onboarding → API Application → `client_id`/`client_secret` + allowed-methods grant
- [ ] Admin: paste `client_id`/`client_secret` + Instance URL; stored in the company vault
- [ ] Customer isolved admin: Security → Partner Users → Client Access (per Client Code) + Refresh System Data
- [ ] Smallest granted read returns 200 (e.g. `GET /employees?employment_status=ACTIVE`)
- [ ] On 401 (mint failure): admin re-checks the company `client_id`/`client_secret` (no per-user reauth)
- [ ] On 403/404: confirm the allowed-methods grant + per-client access/Refresh (01d)

**Deploy:**

- [ ] `ext-api-doc/isolved/*` synced to `extApiDocBucket` on the next client deploy
- [ ] `DATA_CONNECTORS_ENABLED` enabled for the target client

## 9. Testing plan

1. **Backend smoke (post-build):** confirm the `isolved` adapter mints a token from a test
   `client_id`/`client_secret` against a sandbox/partner tenant and caches+re-mints it.
2. **Base-URL resolution:** with the Instance URL persisted, a relative `GET /employees?...` resolves
   to `{instance}/rest/api/employees?...`; without it, the agent gets "No base URL is configured".
3. **List employees:** `GET /employees?employment_status=ACTIVE` → 200 with a page of employees.
4. **Per-client setup negative test:** before the Client Access grant + Refresh System Data, expect
   403/404 on that Client Code; after, expect 200.
5. **Allowed-methods negative test:** call an object the integration was NOT granted → expect 403/404;
   confirm the agent reports it as a grant problem, not a retry.
6. **New hire:** `POST /employees` (if write granted) → confirm the record lands as **Pending**, and
   the agent reports "pending", not "active".
7. **401 path:** disable/rotate the company credential → next call 401 → connector surfaces an admin
   credential fix (no per-user reconnect).

_Registry entry cited verbatim from `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
(`id: 'isolved'`). Native-connector lists: `infra/config/connectors.ts`,
`lambdas/python/workspace-chat-tools/tools/user_profile.py`. Backend gaps confirmed against
`lambdas/node/oauth-auth-handler/index.ts`, `lambdas/python/oauth-workspace-tools/tools/oauth_tools.py`,
and `.../connect_tools.py` (`_resolve_connector_base_url`). Deploy mechanism from
`infra/stacks/numa-client-stack.ts`. See also `04-connection-and-reauth.md` and
`documentation/connectors/README.md`._
