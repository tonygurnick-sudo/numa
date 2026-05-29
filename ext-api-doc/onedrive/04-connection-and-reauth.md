# OneDrive (Microsoft Graph) — Connection & Reauthorization Guide

> Complete setup for connecting Numa to OneDrive via Microsoft Graph.
> Auth type: **OAuth 2.0** (Authorization Code grant, Microsoft Entra `/common` multi-tenant).
> Detailed enough to automate connector setup and token refresh.

---

## Auth Type: OAuth 2.0

Every OneDrive call runs under a **user's** Microsoft Entra (Azure AD) security context, obtained via
the Authorization Code grant. The connector requests **read-only** `Files.Read.All` plus
`offline_access` (for a refresh token). There is no PAT / API-key path for OneDrive.

All values below are the **shipped registry values** (see `03-connector-setup.md`) — the registry is
the source of truth; do not invent alternatives.

---

## 1. Create the OAuth Application in Microsoft Entra (Azure Portal)

The admin self-registers an app in the Azure Portal and supplies the resulting **Client ID** and
**Client Secret** to the Numa wizard (these are the `oauthSetupSteps` from the registry):

1. Go to **Azure Portal → App registrations → New registration**
   (`https://portal.azure.com` → Microsoft Entra ID → App registrations).
2. Set a **Name** (e.g. `Numa OneDrive Integration`) and choose **"Accounts in any organizational
   directory"** — this is the multi-tenant `/common` audience, so any work/school (and personal)
   Microsoft account can connect.
3. Under **Redirect URIs**, add the redirect URI shown in the Numa connector wizard, with platform
   type **Web** (not "Single-page application").
4. Go to **Certificates & secrets → New client secret** → copy the **Value** (the secret string —
   **not** the Secret ID; the Value is shown only once).
5. Copy the **Application (client) ID** from the **Overview** page.

| Field           | Value                                                             | Notes                                       |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| Account type    | Accounts in any organizational directory                          | Multi-tenant → `/common` endpoint           |
| Redirect URI    | `<from Numa wizard>` (type **Web**)                               | Must match exactly                          |
| API permissions | Microsoft Graph → `Files.Read.All` (delegated) + `offline_access` | Delegated, read-only                        |
| Client ID       | `<Application (client) ID>` (GUID)                                | Overview page                               |
| Client Secret   | `<secret Value>`                                                  | Certificates & secrets → copy the **Value** |

> **Admin consent:** `Files.Read.All` is a delegated scope; for organizational tenants the tenant
> admin may need to grant admin consent. Personal accounts consent at first connect.

---

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
| PKCE required?    | Recommended by Entra; confidential web-app flow (client secret) used here        |

### Authorization Request

```http
GET https://login.microsoftonline.com/common/oauth2/v2.0/authorize?
  response_type=code&
  client_id=<CLIENT_ID>&
  redirect_uri=<REDIRECT_URI>&
  response_mode=query&
  scope=https%3A%2F%2Fgraph.microsoft.com%2FFiles.Read.All%20offline_access&
  state=<RANDOM_STATE>
```

> `response_mode=query` (the registry's `extraAuthParams`) makes Entra return the auth code as a URL
> query parameter rather than a fragment, so the connector backend can read it on redirect.

### Token Exchange

```http
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=<AUTH_CODE>&
redirect_uri=<REDIRECT_URI>&
client_id=<CLIENT_ID>&
client_secret=<CLIENT_SECRET>&
scope=https%3A%2F%2Fgraph.microsoft.com%2FFiles.Read.All%20offline_access
```

### Token Response

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

> `refresh_token` is present **only because** `offline_access` was requested. Persist it — it is how
> long-lived sessions stay connected without re-prompting the user.

---

## 3. Token Refresh

```http
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=<REFRESH_TOKEN>&
client_id=<CLIENT_ID>&
client_secret=<CLIENT_SECRET>&
scope=https%3A%2F%2Fgraph.microsoft.com%2FFiles.Read.All%20offline_access
```

| Property                | Value                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- |
| Access token lifetime   | ~60–90 min (Entra default; variable per tenant/conditional-access policy)        |
| Refresh token lifetime  | Sliding ~90-day inactivity window (work/school); rotates on each refresh         |
| Refresh token rotation? | **Yes** — a new `refresh_token` is returned; persist it, overwriting the old one |
| Re-consent required?    | When the refresh token expires (≥~90 days idle), is revoked, or scopes change    |

> Because the refresh token **rotates**, always overwrite the stored refresh token with the one from
> each refresh response, or the next refresh will fail. Conditional Access / sign-in frequency
> policies can shorten access-token lifetime well below 60 min on some tenants.

---

## 4. Token Revocation

There is **no per-app OAuth revoke endpoint** that the connector calls. Tokens are revoked in
Microsoft Entra:

- A user can revoke at `https://account.microsoft.com/` (or via "Sign out everywhere").
- A tenant admin can revoke refresh tokens / sessions in Entra ID.
- Programmatic revocation is via Graph (`POST /users/{id}/revokeSignInSessions`) — not used by this
  read-only connector.

Treat refresh failure (Entra returns a 400/401 with `invalid_grant`) as "connection ended" → trigger
a full re-consent.

---

## 5. Reauthorization Triggers

| Trigger               | Detection                                     | Action                                         |
| --------------------- | --------------------------------------------- | ---------------------------------------------- |
| Access token expired  | `401 InvalidAuthenticationToken` from Graph   | Refresh using refresh token, retry             |
| Refresh token expired | Token endpoint returns `400 invalid_grant`    | Full re-consent flow                           |
| User/admin revoked    | `401`/`403` + refresh returns `invalid_grant` | Full re-consent flow                           |
| Scopes changed        | Admin edits scopes in the connector config    | Full re-consent flow                           |
| Insufficient scope    | `403 accessDenied`                            | Re-consent (e.g. admin consent for org tenant) |

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type    | Description                                                        |
| --------------- | ------- | ------------------------------------------------------------------ |
| `client_id`     | company | Azure Application (client) ID — company vault, admin-supplied      |
| `client_secret` | company | Azure client secret **Value** — company vault                      |
| `access_token`  | user    | Per-user Graph access token (~60–90 min)                           |
| `refresh_token` | user    | Per-user refresh token (~90-day sliding, **rotating** — overwrite) |

> No region/instance field is needed — the Graph base host is fixed at
> `https://graph.microsoft.com/v1.0` (global cloud only).

### Test Connection Sequence (Phase 2 smoke test)

```
1. POST token endpoint with the auth code
     -> verify access_token + refresh_token returned (refresh_token requires offline_access)
2. GET https://graph.microsoft.com/v1.0/me/drive
     Authorization: Bearer <access_token>
     Accept: application/json
   -> expect 200 and a drive object: { "id": "...", "driveType": "business|personal", "quota": {...} }
3. GET https://graph.microsoft.com/v1.0/me/drive/root/children?$top=1
     Authorization: Bearer <access_token>
   -> expect 200 and { "value": [ ... ] } (optionally @odata.nextLink)
```

> Running this against a live tenant is what closes the Phase 2 gate from the questionnaire. (The
> shipped provider already exercises these calls in production, so the gate is "satisfied by
> production code"; a fresh curl is still the cleanest confirmation for a new client setup.)

### Auto-Reconnect Logic

```
on 401 response (InvalidAuthenticationToken):
  try refresh_token()             # access tokens expire every ~60-90 min
  persist the NEW refresh_token   # rotation — must overwrite the stored one
  if refresh fails (invalid_grant — refresh token expired/revoked):
    trigger full re-consent flow (user reconnects via OAuth)
on 403 response (accessDenied):
  surface "insufficient permission" — may need tenant admin consent for Files.Read.All
on 429/503 response:
  honor Retry-After header; else exponential backoff (provider retries up to 3x)
```

---

## Sources

- Auth concepts (MSAL / Entra v2.0): https://learn.microsoft.com/graph/auth/auth-concepts
- Permissions reference (`Files.Read.All`): https://learn.microsoft.com/graph/permissions-reference
- App registration: https://learn.microsoft.com/entra/identity-platform/quickstart-register-app
- Auth code flow: https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow
- Registry values: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`
