---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
scope: connection + reauthorization (OAuth2 setup, token refresh, revocation, reconnect)
auth: OAuth 2.0 (Authorization Code grant, Microsoft Entra `/common` multi-tenant) — no PAT/API-key path
base_url: https://graph.microsoft.com/v1.0
values_source: shipped registry (connectorRegistry.ts) — source of truth; do not invent alternatives
---

# OneDrive (Microsoft Graph) — Connection & Reauthorization Guide

Every OneDrive call runs under a **user's** Microsoft Entra (Azure AD) security context via the Authorization Code grant. Connector requests **read-only** `Files.Read.All` + `offline_access` (refresh token). No PAT/API-key path.

## 1. Create the OAuth App in Microsoft Entra (Azure Portal)

Admin self-registers an app and supplies the resulting **Client ID** + **Client Secret** to the Numa wizard (the registry `oauthSetupSteps`):

1. **Azure Portal → App registrations → New registration** (`https://portal.azure.com` → Microsoft Entra ID → App registrations).
2. Set a **Name** (e.g. `Numa OneDrive Integration`), choose **"Accounts in any organizational directory"** — the multi-tenant `/common` audience, so any work/school (and personal) Microsoft account can connect.
3. Under **Redirect URIs**, add the URI shown in the Numa wizard, platform type **Web** (not "Single-page application").
4. **Certificates & secrets → New client secret** → copy the **Value** (the secret string — **not** the Secret ID; shown only once).
5. Copy the **Application (client) ID** from the **Overview** page.

| Field           | Value                                                             | Notes                                       |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| Account type    | Accounts in any organizational directory                          | multi-tenant → `/common`                    |
| Redirect URI    | `<from Numa wizard>` (type **Web**)                               | must match exactly                          |
| API permissions | Microsoft Graph → `Files.Read.All` (delegated) + `offline_access` | delegated, read-only                        |
| Client ID       | `<Application (client) ID>` (GUID)                                | Overview page                               |
| Client Secret   | `<secret Value>`                                                  | Certificates & secrets → copy the **Value** |

**Admin consent:** `Files.Read.All` is a delegated scope; for organizational tenants the tenant admin may need to grant admin consent. Personal accounts consent at first connect.

## 2. OAuth Flow

| Property          | Value                                                                            |
| ----------------- | -------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (refresh via `refresh_token`)                               |
| Authorization URL | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`                 |
| Token URL         | `https://login.microsoftonline.com/common/oauth2/v2.0/token`                     |
| Discovery URL     | `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration` |
| Redirect URI      | `<from Numa wizard>` (registered as **Web** in Azure)                            |
| Scopes            | `https://graph.microsoft.com/Files.Read.All offline_access`                      |
| Extra auth params | `response_mode=query` (registry `extraAuthParams`)                               |
| PKCE              | recommended by Entra; confidential web-app flow (client secret) used here        |

Authorization request:

```
GET https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=<REDIRECT_URI>&response_mode=query&scope=https%3A%2F%2Fgraph.microsoft.com%2FFiles.Read.All%20offline_access&state=<RANDOM_STATE>
```

`response_mode=query` makes Entra return the auth code as a URL query param (not a fragment), so the connector backend can read it on redirect.

Token exchange:

```
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<AUTH_CODE>&redirect_uri=<REDIRECT_URI>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&scope=https%3A%2F%2Fgraph.microsoft.com%2FFiles.Read.All%20offline_access
```

Token response:

```json
{
  "token_type": "Bearer",
  "scope": "https://graph.microsoft.com/Files.Read.All",
  "expires_in": 3599,
  "ext_expires_in": 3599,
  "access_token": "<JWT>",
  "refresh_token": "<opaque>"
}
```

`refresh_token` is present **only because** `offline_access` was requested. Persist it — it keeps long-lived sessions connected without re-prompting.

## 3. Token Refresh

```
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&scope=https%3A%2F%2Fgraph.microsoft.com%2FFiles.Read.All%20offline_access
```

| Property                | Value                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| Access token lifetime   | ~60–90 min (Entra default; variable per tenant/conditional-access)           |
| Refresh token lifetime  | sliding ~90-day inactivity (work/school); rotates on each refresh            |
| Refresh token rotation? | **Yes** — a new `refresh_token` is returned; persist it, overwriting the old |
| Re-consent required?    | when refresh token expires (≥~90 days idle), is revoked, or scopes change    |

Because the refresh token **rotates**, always overwrite the stored refresh token with the one from each refresh response, or the next refresh fails. Conditional Access / sign-in frequency policies can shorten access-token lifetime below 60 min on some tenants.

## 4. Token Revocation

**No per-app OAuth revoke endpoint** is called by the connector. Tokens are revoked in Microsoft Entra:

- User revokes at `https://account.microsoft.com/` (or "Sign out everywhere").
- Tenant admin revokes refresh tokens / sessions in Entra ID.
- Programmatic: Graph `POST /users/{id}/revokeSignInSessions` — not used by this read-only connector.

Treat refresh failure (Entra returns `400`/`401` with `invalid_grant`) as "connection ended" → trigger full re-consent.

## 5. Reauthorization Triggers

| Trigger               | Detection                                     | Action                                         |
| --------------------- | --------------------------------------------- | ---------------------------------------------- |
| Access token expired  | `401 InvalidAuthenticationToken` from Graph   | refresh using refresh token, retry             |
| Refresh token expired | token endpoint returns `400 invalid_grant`    | full re-consent flow                           |
| User/admin revoked    | `401`/`403` + refresh returns `invalid_grant` | full re-consent flow                           |
| Scopes changed        | admin edits scopes in connector config        | full re-consent flow                           |
| Insufficient scope    | `403 accessDenied`                            | re-consent (e.g. admin consent for org tenant) |

## Numa Connector Wiring

Credentials to store:
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | company | Azure Application (client) ID — company vault, admin-supplied |
| `client_secret` | company | Azure client secret **Value** — company vault |
| `access_token` | user | per-user Graph access token (~60–90 min) |
| `refresh_token` | user | per-user refresh token (~90-day sliding, **rotating** — overwrite) |

No region/instance field — Graph base host is fixed at `https://graph.microsoft.com/v1.0` (global cloud only).

Test connection sequence (Phase 2 smoke test):

```
1. POST token endpoint with the auth code
     -> verify access_token + refresh_token returned (refresh_token requires offline_access)
2. GET https://graph.microsoft.com/v1.0/me/drive
     Authorization: Bearer <access_token>; Accept: application/json
   -> expect 200 + drive object: {"id":"...","driveType":"business|personal","quota":{...}}
3. GET https://graph.microsoft.com/v1.0/me/drive/root/children?$top=1
     Authorization: Bearer <access_token>
   -> expect 200 + {"value":[...]} (optionally @odata.nextLink)
```

This closes the Phase 2 gate. (The shipped provider already exercises these calls in production; a fresh curl is the cleanest confirmation for a new client setup.)

Auto-reconnect logic:

```
on 401 (InvalidAuthenticationToken):
  try refresh_token()             # access tokens expire every ~60-90 min
  persist the NEW refresh_token   # rotation — must overwrite the stored one
  if refresh fails (invalid_grant — refresh token expired/revoked):
    trigger full re-consent flow (user reconnects via OAuth)
on 403 (accessDenied):
  surface "insufficient permission" — may need tenant admin consent for Files.Read.All
on 429/503:
  honor Retry-After header; else exponential backoff (provider retries up to 3x)
```

## Sources

- Auth concepts (MSAL / Entra v2.0): https://learn.microsoft.com/graph/auth/auth-concepts
- Permissions reference (`Files.Read.All`): https://learn.microsoft.com/graph/permissions-reference
- App registration: https://learn.microsoft.com/entra/identity-platform/quickstart-register-app
- Auth code flow: https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow
- Registry values: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
