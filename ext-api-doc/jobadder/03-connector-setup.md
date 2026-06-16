---
api_name: JobAdder
api_slug: jobadder
base_url: https://api.jobadder.com/v2
path_version_segment: /v2 is a REAL path segment, already in base_url; no version header
urls: ABSOLUTE REQUIRED through the connector (`https://api.jobadder.com/v2/...`); OAuthWizard does NOT persist a base_url for relative expansion (§5)
call_surface: HTTP via `numa integrations request` (connector=jobadder); native data connector, authType oauth2 (admin-registered Developer Centre app + per-user OAuth grants)
auth: OAuth2 only — no PAT/API-key; 60-min access tokens, auto-refreshed via `offline_access`
confidence: connector wiring below is the real Numa implementation; the JobAdder side is NOT live-validated (no credentials yet).
---

# JobAdder — Connector & Integration Setup

How the JobAdder connector is wired into Numa: registry entry, admin OAuthWizard flow, vault storage, backend auth injection.

## 1. Product context

|              |                                                                                         |
| ------------ | --------------------------------------------------------------------------------------- |
| Vendor       | JobAdder (Sydney, Australia) — recruitment ATS/CRM                                      |
| Product      | jobs, candidates, applications, placements, companies, contacts                         |
| App URL      | `app.jobadder.com` (Developer Centre: `developers.jobadder.com`)                        |
| API base URL | `https://api.jobadder.com/v2` (token response may carry an account-specific `api` base) |
| Rate limits  | not published anywhere retrievable — assume 429 on breach; back off                     |

⚠️ **OAuth2 only** — no PAT/API-key path. Access tokens expire after **60 minutes**; `offline_access` provides refresh tokens, refreshed automatically by the backend. Users never paste anything into chat.

## 2. Auth model — admin app + per-user OAuth grants

Two credentials, two owners:

- **Company secret `oauth-client-jobadder`** — the Developer Centre app's **Client ID + Client Secret**, entered once by the admin via the OAuthWizard, plus auth/token URLs and scopes.
- **User secret `oauth-jobadder`** — each user's `access_token` / `refresh_token` / `expires_at`, minted by their own OAuth consent (redirect flow). Per-user grants → each user sees exactly what their JobAdder account allows.

Every API call carries `Authorization: Bearer {access_token}`, injected by the backend. The agent never sets that header and never sees a token. No other special headers (no version header — contrast GoHighLevel/Jobber).

## 3. Connector Registry entry

File: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

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
    // `read write` cover nearly all GET/POST; offline_access is required for
    // refresh tokens (access tokens expire after 60 min).
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

- `authType: 'oauth2'` routes to the **OAuthWizard** (admin) and the **OAuth redirect flow** (users) — same machinery as QuickBooks/Xero/Jobber.
- **No `credentialFields`** — no per-user typed credential, no admin instance URL; JobAdder is a fixed-host SaaS. The wizard collects only the OAuth client pair.
- `oauth.scopes` defaults the wizard's scopes field; admins can narrow to granular `read_*`/`write_*` scopes, at the cost of 403s outside the set.
- The slug is in `infra/config/connectors.ts` → `NATIVE_CONNECTORS` (OAuth2 group), mirrored in `lambdas/python/workspace-chat-tools/tools/user_profile.py` → `_NATIVE_CONNECTOR_SLUGS` (memory-scope validation). Per the comment in `connectors.ts`, the two lists must move together in the same commit — both already include `jobadder`.

## 4. Admin setup (Integrations → JobAdder → OAuthWizard)

File: `numa-frontend/src/Components/DataConnectors/wizards/OAuthWizard.tsx`

1. Open **Integrations**, pick **JobAdder**, start the wizard.
2. Follow `oauthSetupSteps`: register an application in the **Developer Centre** (`developers.jobadder.com`), add the wizard-displayed redirect URI — **`https://{client}.numa.arcanum.ai/oauth/callback/jobadder`** (`{frontendBaseUrl}/oauth/callback/{providerId}`, byte-for-byte) — and copy **Client ID** + **Client Secret**.
3. Paste Client ID + Secret; scopes prefill from the registry (`read write offline_access`). Optional: display name/icon/description, rate-limit overrides, extra auth params (none needed).
4. Save → the wizard writes the company secret. The final "test" step routes through `ConnectorsService.connect('jobadder')`, kicking off a real OAuth redirect — the admin's own user grant doubles as the connection test.

### 4.1 What gets stored — company secret `oauth-client-jobadder` (category "OAuth Clients")

| Field                                 | Value                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `client_id` / `client_secret`         | from the Developer Centre app (written on create; **never overwritten** on later wizard edits) |
| `auth_url`                            | `https://id.jobadder.com/connect/authorize`                                                    |
| `token_url`                           | `https://id.jobadder.com/connect/token` (also used by the backend refresher)                   |
| `scopes`                              | `read write offline_access` (or the admin's narrowed set)                                      |
| `display_name`, `icon`, `description` | registry defaults / admin overrides                                                            |
| `rate_limit_rpm` / `rate_limit_daily` | only if the admin enters overrides (JobAdder publishes no numbers)                             |

No `auth_header_scheme` (standard Bearer) and no `extra_auth_params`.

### 4.2 Prerequisite on the JobAdder side

A JobAdder administrator must be able to register applications in the Developer Centre. The redirect URI must match exactly — a mismatch fails the authorize redirect. Scope changes later require users to re-consent (existing grants do not auto-upgrade).

## 5. Backend request flow (oauth-workspace-tools)

Files: `lambdas/python/oauth-workspace-tools/tools/connect_tools.py` (request path), `tools/oauth_tools.py` (`get_oauth_token`, `_refresh_access_token`).

The agent calls `numa integrations request` with `connector="jobadder"`, `url="https://api.jobadder.com/v2/jobs?active=true&limit=100"`, `method="GET"`. `handle_connect_request` then:

1. `get_oauth_token("jobadder", user_sub)` reads the user's consolidated vault: prefers a `connector-jobadder` PAT entry (never exists for this connector), then falls back to **`oauth-jobadder`** — the OAuth token entry.
2. If `expires_at` is within the **5-minute buffer**, auto-refreshes: `_refresh_access_token` posts `grant_type=refresh_token` to `token_url` on `oauth-client-jobadder` (with that secret's `client_id`/`client_secret`), persists the new `access_token` + **rotated `refresh_token`** + `expires_at` back to the vault, returns the fresh token.
3. Builds `Authorization: Bearer {access_token}` (default Bearer scheme) and forwards. The agent never sees the token.
4. No token and no refresh path → the structured `needs_credential` error. For an OAuth connector this is **not** a fillable chat card (no field to type) — the agent tells the user to connect JobAdder via Integrations, where the OAuth redirect flow runs (see 04 §2).

> ⚠️ **Base-URL wiring (real behaviour):** `_resolve_connector_base_url` expands relative URLs from vault fields (`base_url`/`api_endpoint`/`instance_url` on `connector-config-jobadder` or `oauth-client-jobadder`). The OAuthWizard does **not** persist a `base_url` (only the ApiKeyWizard does), so a relative `/jobs` fails with **"No base URL is configured for connector 'jobadder'"**. **Agents must use absolute URLs** (`https://api.jobadder.com/v2/...`). If a tenant's token response ever carries a non-default `api` host, add it as `api_endpoint` on `oauth-client-jobadder` — the resolver already reads that field.

## 6. Smoke test after setup

```http
# Cheapest authenticated probe (needs only the read scope)
GET https://api.jobadder.com/v2/users/current
→ 200 with the authenticated user's details — grant valid
→ 401 — token expired AND refresh failed (grant revoked) → reconnect via OAuth
→ 403 — grant lacks the scope (admin narrowed scopes) → fix scopes, re-consent
```

From chat: ask the agent to "list my open JobAdder jobs". If not connected, the agent directs them to Integrations → JobAdder → Connect; after consent the request succeeds (`GET .../jobs?active=true`). Then spot-check candidates, applications, placements to confirm scope coverage before real use.
