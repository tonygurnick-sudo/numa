# QuickBooks Online — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the QuickBooks Online Accounting API.
> Auth type: **OAuth 2.0 (Authorization Code grant)** — the only method QBO supports. No API keys, no PAT.
> Goal: enough detail that Numa could automate connector setup via script.
>
> Confidence: all values below are `[DOCUMENTED]` against Intuit's official OAuth 2.0 docs unless marked otherwise. No `[CONFIRMED]` live exchange was performed.

---

## Auth Type: OAuth 2.0

QuickBooks Online uses OAuth 2.0 Authorization Code. There is no PAT option for the Accounting API. The connector registry reflects this (`authType: 'oauth2'`).

---

## 1. Create the OAuth Application in Intuit

The OAuth client (Client ID + Client Secret) is created **once per Numa client/environment** in the Intuit Developer portal. These map to the registry's `oauthSetupSteps` and are entered by the admin in the connect wizard.

1. Log in to the **Intuit Developer portal** at `https://developer.intuit.com` → **Dashboard**.
2. Click **Create an app** and select **"QuickBooks Online and Payments"**.
3. Open the app → **Keys & credentials**. There are two key sets:
   - **Development** keys — pair with the **sandbox** base URL (`https://sandbox-quickbooks.api.intuit.com`).
   - **Production** keys — require Intuit app review/go-live, pair with the **production** base URL (`https://quickbooks.api.intuit.com`).
4. Under **Keys & credentials → Redirect URIs**, add Numa's redirect URI (shown in the connect wizard) — see §2 for the requirements. Add one per environment.
5. Fill in:
   | Field | Value | Notes |
   | ------------ | ---------------------------------- | ------------------------------------------------------ |
   | App Name | `Numa Integration` (or per client) | — |
   | Redirect URI | Numa connect-wizard URI | Must match byte-for-byte (HTTPS; `localhost` ok in dev) |
   | Scopes | `com.intuit.quickbooks.accounting` | The only scope this connector needs |
6. Copy:
   - **Client ID** — stable, safe to display.
   - **Client Secret** — copy immediately; treat as a secret. (Regeneratable from the dashboard.)

> The admin pastes Client ID + Client Secret into Numa's connect wizard; Numa stores them as the **company-wide OAuth-client secret** in the vault (see `03-connector-setup.md` §4).

[DOCUMENTED] https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

---

## 2. OAuth Flow

| Property          | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Grant type        | `authorization_code`                                                           |
| Authorization URL | `https://appcenter.intuit.com/connect/oauth2`                                  |
| Token URL         | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`                    |
| Revocation URL    | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`                     |
| Discovery doc     | `https://developer.api.intuit.com/.well-known/openid_configuration`            |
| Redirect URI      | Numa connect-wizard URI (must match registered, byte-for-byte)                 |
| Scopes            | `com.intuit.quickbooks.accounting`                                             |
| PKCE required?    | No (confidential client uses `client_secret`; PKCE supported but not required) |

> Authorization URL and Token URL match the registry entry `oauth.authUrl` / `oauth.tokenUrl` exactly.

### Redirect URI requirements

- **HTTPS required** (except `http://localhost` for development).
- Must match a redirect URI registered in the Intuit app's **Keys & credentials** _byte-for-byte_ (including any trailing slash).
- Register one redirect URI per environment (dev/sandbox vs production).

### 2a. Authorization Request

```http
GET https://appcenter.intuit.com/connect/oauth2?
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  response_type=code&
  scope=com.intuit.quickbooks.accounting&
  state={RANDOM_STATE}
```

| Parameter       | Required    | Notes                                                 |
| --------------- | ----------- | ----------------------------------------------------- |
| `client_id`     | yes         | From the Intuit app dashboard                         |
| `redirect_uri`  | yes         | Must match registered URI exactly                     |
| `response_type` | yes         | Always `code`                                         |
| `scope`         | yes         | `com.intuit.quickbooks.accounting`                    |
| `state`         | recommended | CSRF token — Numa's OAuth layer sends and verifies it |

### 2b. Redirect Response — captures `realmId` (critical)

After the user consents, Intuit redirects back with **both** the auth `code` **and** the company id `realmId`:

```
{REDIRECT_URI}?code=AB11...&state={STATE}&realmId=4620816365212402417
```

| Parameter | Description                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `code`    | Authorization code — exchange for tokens (short-lived, single-use)                                      |
| `state`   | Echoed CSRF token — **verify it matches** what you sent                                                 |
| `realmId` | **QuickBooks company id — the primary identifier for every API call path.** Persist it with the tokens. |

> `realmId` is **not** in the token response and there is **no** "list companies" API for a token. Each authorisation is scoped to exactly one realm. Persist `realmId` per connection; to connect multiple companies, run the whole flow once per company. This is the single most important QBO-specific detail — analogous to MYOB's `businessId`.

### 2c. Token Exchange (`authorization_code`)

```http
POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=authorization_code&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}
```

> Intuit expects the client credentials as **HTTP Basic auth** (`Authorization: Basic base64(client_id:client_secret)`). Passing `client_id`/`client_secret` in the body also works for confidential clients, but Basic is the documented form.

### 2d. Token Response

```json
{
  "token_type": "bearer",
  "access_token": "eyJ...{access JWT}...",
  "expires_in": 3600,
  "refresh_token": "AB11...{rotating}...",
  "x_refresh_token_expires_in": 8640000
}
```

| Field                        | Meaning                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `access_token`               | Bearer token for API calls (1 hour)                                 |
| `expires_in`                 | `3600` — access token lifetime in seconds                           |
| `refresh_token`              | **Rotating** — store this; the old one dies on next refresh         |
| `x_refresh_token_expires_in` | Refresh token lifetime in seconds (~100 days; `8640000` ≈ 100 days) |

---

## 3. Token Refresh

```http
POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=refresh_token&
refresh_token={REFRESH_TOKEN}
```

> ⚠️ **The response contains a NEW `refresh_token` (rotation).** A fresh refresh token is returned roughly every 24 hours and on every exchange; once issued, the previous one is invalidated. **Persist the new `refresh_token` from every response** — failing to store it causes `invalid_grant` on the next refresh, which forces a full re-consent.

| Property                | Value                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | 1 hour (3600 s)                                                                                                                                 |
| Refresh token lifetime  | ~100 days                                                                                                                                       |
| Refresh token rotation? | **Yes** — new `refresh_token` returned ~every 24h and on each exchange; old one invalidated                                                     |
| Re-consent required?    | When the refresh token expires (~100 days unused) or the user revokes access; otherwise rolling refresh keeps the connection alive indefinitely |

[DOCUMENTED] https://help.developer.intuit.com/s/article/Validity-of-Refresh-Token

---

## 4. Token Revocation

```http
POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke
Content-Type: application/json
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

{ "token": "{ACCESS_OR_REFRESH_TOKEN}" }
```

Revoking either token invalidates the connection; the user must re-consent to reconnect. Used on user disconnect to clean up Intuit-side access.

---

## 5. Reauthorization Triggers

| Trigger                  | Detection                                           | Action                                             |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------- |
| Access token expired     | 401 + `Fault.type: AuthenticationFault` (code 3200) | Refresh using the stored refresh token, retry once |
| Refresh token rotated    | Refresh response has a new `refresh_token`          | **Persist the new token** (not an error — normal)  |
| Refresh token expired    | Refresh returns `invalid_grant`                     | Full re-consent flow (~100 days unused)            |
| Refresh token lost/stale | `invalid_grant` (didn't store the rotated token)    | Full re-consent flow — fix persistence             |
| Scope changed            | 403 + `AuthorizationFault` on a newly-needed call   | Full re-consent with the correct scope             |
| User revoked access      | 401/403 and refresh fails                           | Full re-consent flow                               |

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type              | Description                                                                                 |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `client_id`     | string (company)  | Intuit OAuth Client ID — admin-entered, company-wide                                        |
| `client_secret` | secret (company)  | Intuit OAuth Client Secret — admin-entered, company-wide                                    |
| `access_token`  | secret (per user) | 1-hour bearer token                                                                         |
| `refresh_token` | secret (per user) | **Rotating** — overwrite on every refresh                                                   |
| `realmId`       | string (per user) | QuickBooks company id — captured from the OAuth callback, templated into every request path |

> Company-wide keys (`client_id`/`client_secret`) are entered once by the admin. Per-user keys (`access_token`/`refresh_token`/`realmId`) are minted when each user completes the OAuth redirect. See `03-connector-setup.md` §4.

### Test Connection Sequence

```
1. Token check: ensure a non-expired access_token (refresh if expires_in elapsed)
2. Smoke call (with auth):
     GET https://quickbooks.api.intuit.com/v3/company/{realmId}/companyinfo/{realmId}?minorversion=75
     Accept: application/json
   -> expect 200 with { "CompanyInfo": { "CompanyName": "...", ... }, "time": "..." }
```

> Note the `companyinfo` resource id **is** the `realmId` (not `"1"`). Omitting `Accept: application/json` may return XML.

### Auto-Reconnect Logic

```
on 401 response (AuthenticationFault / code 3200):
  try refresh_token()                      # POST grant_type=refresh_token
  if refresh succeeds:
    persist NEW refresh_token (rotation!)  # critical — old token is dead
    persist new access_token
    retry the original request once
  if refresh fails (invalid_grant):
    trigger full re-consent flow           # redirect user to authorize URL again
    re-capture realmId from the callback

# QuickBooks is OAuth-only — there is no PAT path.
```

---

_Auth values documented against Intuit's OAuth 2.0 guide; endpoints cross-checked against the connector registry entry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'quickbooks'`). No `[CONFIRMED]` live exchange performed — verify token lifetimes and the exact Basic-vs-body auth form against a sandbox app._
