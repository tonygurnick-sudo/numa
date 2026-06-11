---
api_name: 'JobAdder'
api_slug: 'jobadder'
auth_type: 'oauth2 (admin-registered Developer Centre app + per-user OAuth grants)'
generated_date: '2026-06-10'
---

# JobAdder — Connector & Integration Setup

> How the JobAdder connector is wired into Numa: registry entry, admin OAuthWizard flow,
> vault storage, and backend auth injection. The wiring below is the real implementation;
> the JobAdder side has NOT been live-validated (no credentials yet).

---

## 1. Product context

|              |                                                                       |
| ------------ | ----------------------------------------------------------------------|
| Vendor       | JobAdder (Sydney, Australia) — recruitment ATS/CRM                     |
| Product      | Jobs, candidates, applications, placements, companies, contacts       |
| App URL      | `app.jobadder.com` (Developer Centre: `developers.jobadder.com`)      |
| API base URL | `https://api.jobadder.com/v2` (token response may carry an account-specific `api` base) |
| Rate limits  | Not published anywhere retrievable — assume 429 on breach; back off   |

⚠️ **OAuth2 only** — JobAdder has no PAT/API-key path. Access tokens expire after **60
minutes**; the `offline_access` scope provides refresh tokens, and the backend refreshes
automatically. Users never paste anything into chat.

---

## 2. Auth model — admin app + per-user OAuth grants

Two credentials, two owners:

- **Company secret `oauth-client-jobadder`** — the JobAdder Developer Centre application's
  **Client ID + Client Secret**, entered once by the admin via the OAuthWizard, plus the
  auth/token URLs and scopes.
- **User secret `oauth-jobadder`** — each user's `access_token` / `refresh_token` /
  `expires_at`, minted by their own OAuth consent (redirect flow). Per-user grants mean each
  user sees exactly what their JobAdder account allows.

Every API call carries `Authorization: Bearer {access_token}`, injected by the Numa backend.
The agent never sets that header and never sees a token. There are no other special headers
(no version header — contrast GoHighLevel/Jobber).

---

## 3. Connector Registry entry

> File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```typescript
{
  id: 'jobadder',
  displayName: 'JobAdder',
  icon: 'bi-person-badge',
  description: 'Recruitment ATS — jobs, candidates, applications, placements',
  category: 'Recruitment',
  authType: 'oauth2',
  baseUrl: 'https://api.jobadder.com/v2',
  cachingPolicy: CACHING_PRESETS.projectManagement,
  oauth: {
    authUrl: 'https://id.jobadder.com/connect/authorize',
    tokenUrl: 'https://id.jobadder.com/connect/token',
    // `read write` cover nearly all GET/POST operations; offline_access
    // is required for refresh tokens (access tokens expire after 60 min).
    scopes: 'read write offline_access',
  },
  oauthSetupSteps: [
    'Go to the JobAdder Developer Centre (developers.jobadder.com) → register an application',
    'Add the redirect URI below to the application',
    'Copy the Client ID and Client Secret from the application page',
  ],
}
```

Notes:

- `authType: 'oauth2'` routes the connector to the **OAuthWizard** (admin) and the **OAuth
  redirect flow** (users) — same machinery as QuickBooks/Xero/Jobber.
- **No `credentialFields`** — there is no per-user typed credential and no admin instance
  URL; JobAdder is a fixed-host SaaS. The wizard collects only the OAuth client pair.
- `oauth.scopes` defaults the wizard's scopes field; admins can narrow to granular
  `read_*`/`write_*` scopes, at the cost of 403s outside the set.
- The slug is listed in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (OAuth2 group) for
  the unified Integrations catalog, and mirrored in
  `lambdas/python/workspace-chat-tools/tools/user_profile.py` → `_NATIVE_CONNECTOR_SLUGS`
  (memory-scope validation). Per the comment in `connectors.ts`, the two lists must move
  together in the same commit — both already include `jobadder`.

---

## 4. Admin setup (Integrations → JobAdder → OAuthWizard)

> File: `numa-frontend/src/Components/DataConnectors/wizards/OAuthWizard.tsx`

1. Open **Integrations**, pick **JobAdder**, start the wizard.
2. Follow `oauthSetupSteps`: register an application in the **JobAdder Developer Centre**
   (`developers.jobadder.com`), add the wizard-displayed redirect URI —
   **`https://{client}.numa.arcanum.ai/oauth/callback/jobadder`** (`{frontendBaseUrl}/oauth/callback/{providerId}`,
   byte-for-byte) — and copy the **Client ID** and **Client Secret** from the application page.
3. Paste Client ID + Secret into the wizard; scopes prefill from the registry
   (`read write offline_access`). Optional: display name/icon/description, rate-limit
   overrides, extra auth params (none needed for JobAdder).
4. Save → the wizard writes the company secret. The final "test" step routes through
   `ConnectorsService.connect('jobadder')`, which kicks off a real OAuth redirect — i.e. the
   admin's own user grant doubles as the connection test.

### 4.1 What gets stored — company secret `oauth-client-jobadder`

One company-vault secret (category "OAuth Clients"), fields:

| Field                          | Value                                                                     |
| ------------------------------ | --------------------------------------------------------------------------|
| `client_id` / `client_secret`  | From the Developer Centre application (written on create; **never overwritten** on later wizard edits) |
| `auth_url`                     | `https://id.jobadder.com/connect/authorize`                                |
| `token_url`                    | `https://id.jobadder.com/connect/token` (also used by the backend refresher) |
| `scopes`                       | `read write offline_access` (or the admin's narrowed set)                  |
| `display_name`, `icon`, `description` | Registry defaults / admin overrides                                 |
| `rate_limit_rpm` / `rate_limit_daily` | Only if the admin enters overrides (JobAdder publishes no numbers)  |

No `auth_header_scheme` (standard Bearer) and no `extra_auth_params`.

### 4.2 Prerequisite on the JobAdder side

A JobAdder administrator must be able to register applications in the Developer Centre. The
redirect URI must match exactly — a mismatch fails the authorize redirect. Scope changes
later require users to re-consent (existing grants do not auto-upgrade).

---

## 5. Backend request flow (oauth-workspace-tools)

> Files: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py` (request path),
> `tools/oauth_tools.py` (`get_oauth_token`, `_refresh_access_token`)

The agent calls
`connectors(name="request", params={connector: "jobadder", url: "https://api.jobadder.com/v2/jobs?active=true&limit=100", method: "GET"})`.
`handle_connect_request` then:

1. `get_oauth_token("jobadder", user_sub)` reads the user's consolidated vault: prefers a
   `connector-jobadder` PAT entry (never exists for this connector), then falls back to
   **`oauth-jobadder`** — the OAuth token entry.
2. If `expires_at` is within the **5-minute buffer**, it auto-refreshes:
   `_refresh_access_token` posts `grant_type=refresh_token` to the `token_url` stored on
   `oauth-client-jobadder` (with that secret's `client_id`/`client_secret`), persists the new
   `access_token` + **rotated `refresh_token`** + `expires_at` back to the vault, and returns
   the fresh token.
3. Builds `Authorization: Bearer {access_token}` (default Bearer scheme) and forwards the
   request. The agent never sees the token.
4. No token and no refresh path → the structured `needs_credential` error. For an OAuth
   connector this is **not** a fillable chat card (there is no field to type) — the agent
   tells the user to connect JobAdder via the Integrations page, where the OAuth redirect
   flow runs (see `04-connection-and-reauth.md` §2).

> ⚠️ **Base-URL wiring note (real behaviour):** `_resolve_connector_base_url` expands
> relative URLs from vault fields (`base_url`/`api_endpoint`/`instance_url` on
> `connector-config-jobadder` or `oauth-client-jobadder`). The OAuthWizard does **not**
> persist a `base_url` (only the ApiKeyWizard does), so a relative `/jobs` would fail with
> "No base URL is configured for connector 'jobadder'". **Agents must use absolute URLs**
> (`https://api.jobadder.com/v2/...`). If a tenant's token response ever carries a
> non-default `api` host, add it as `api_endpoint` on `oauth-client-jobadder` — the resolver
> already reads that field.

---

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (needs only the read scope)
GET https://api.jobadder.com/v2/users/current
→ 200 with the authenticated user's details — grant valid
→ 401 — token expired AND refresh failed (grant revoked) → reconnect via OAuth
→ 403 — grant lacks the scope (admin narrowed scopes) → fix scopes, re-consent
```

From chat: ask the agent to "list my open JobAdder jobs". If the user has not connected,
the agent directs them to Integrations → JobAdder → Connect; after consent the request
succeeds (`GET .../jobs?active=true`). Then spot-check candidates, applications, and
placements to confirm scope coverage before real use.
