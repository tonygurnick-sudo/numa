---
doc: connection-and-reauth
api: QuickBooks Online Accounting API
auth: OAuth 2.0 Authorization Code grant — the ONLY method QBO supports. No API keys, no PAT. (registry authType: 'oauth2')
confidence: all [DOCUMENTED] against Intuit's OAuth 2.0 docs unless tagged; NO [CONFIRMED] live exchange. Verify token lifetimes + Basic-vs-body auth form against a sandbox app.
goal: enough detail to automate connector setup via script.
---

# QuickBooks Online — Connection & Reauthorization

## 1. Create the OAuth Application in Intuit

The OAuth client (Client ID + Client Secret) is created ONCE per Numa client/environment in the Intuit Developer portal; maps to the registry's `oauthSetupSteps`, entered by the admin in the connect wizard.

1. Log in to `https://developer.intuit.com` → Dashboard.
2. Create an app → "QuickBooks Online and Payments".
3. App → Keys & credentials. Two key sets: **Development** keys pair with the sandbox base (`https://sandbox-quickbooks.api.intuit.com`); **Production** keys require Intuit app review/go-live, pair with production (`https://quickbooks.api.intuit.com`).
4. Keys & credentials → Redirect URIs: add Numa's redirect URI (shown in the wizard), one per environment — see §2.
5. App Name = `Numa Integration` (or per client); Redirect URI = Numa connect-wizard URI (byte-for-byte match, HTTPS; `localhost` ok in dev); Scopes = `com.intuit.quickbooks.accounting` (the only scope needed).
6. Copy **Client ID** (stable, safe to display) + **Client Secret** (copy immediately, treat as secret, regeneratable). Admin pastes both into Numa's wizard → stored as the company-wide OAuth-client secret (03 §4).

## 2. OAuth Flow

| Property          | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Grant type        | `authorization_code`                                                           |
| Authorization URL | `https://appcenter.intuit.com/connect/oauth2`                                  |
| Token URL         | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`                    |
| Revocation URL    | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`                     |
| Discovery doc     | `https://developer.api.intuit.com/.well-known/openid_configuration`            |
| Redirect URI      | Numa connect-wizard URI (registered, byte-for-byte)                            |
| Scopes            | `com.intuit.quickbooks.accounting`                                             |
| PKCE required?    | No (confidential client uses `client_secret`; PKCE supported but not required) |

Authorization + Token URLs match the registry `oauth.authUrl`/`oauth.tokenUrl` exactly.
**Redirect URI:** HTTPS required (except `http://localhost` in dev); must match a registered URI byte-for-byte (incl. any trailing slash); register one per environment (dev/sandbox vs production).

### 2a. Authorization Request

```
GET https://appcenter.intuit.com/connect/oauth2?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code&scope=com.intuit.quickbooks.accounting&state={RANDOM_STATE}
```

`client_id`(req), `redirect_uri`(req, exact match), `response_type`(req, always `code`), `scope`(req), `state`(recommended CSRF — Numa sends + verifies).

### 2b. Redirect Response — captures `realmId` (critical)

After consent, Intuit redirects with BOTH the auth `code` AND the company id `realmId`:

```
{REDIRECT_URI}?code=AB11...&state={STATE}&realmId=4620816365212402417
```

`code` = exchange for tokens (short-lived, single-use); `state` = echoed CSRF, **verify it matches** what you sent; `realmId` = **QBO company id, the primary identifier for every API call path — persist it with the tokens**.

`realmId` is NOT in the token response and there is NO "list companies" API for a token. Each authorisation is scoped to exactly one realm. Persist `realmId` per connection; multiple companies = run the whole flow once per company. The single most important QBO-specific detail (analogous to MYOB's `businessId`).

### 2c. Token Exchange (`authorization_code`)

```
POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=authorization_code&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}
```

Intuit expects client credentials as HTTP Basic auth (`Authorization: Basic base64(client_id:client_secret)`). Passing `client_id`/`client_secret` in the body also works for confidential clients, but Basic is the documented form.

### 2d. Token Response

`{"token_type":"bearer","access_token":"eyJ...{access JWT}...","expires_in":3600,"refresh_token":"AB11...{rotating}...","x_refresh_token_expires_in":8640000}`

- `access_token` — Bearer for API calls (1h).
- `expires_in` — `3600` (access token lifetime, seconds).
- `refresh_token` — **rotating**; store this, the old one dies on next refresh.
- `x_refresh_token_expires_in` — refresh token lifetime, seconds (~100 days; `8640000` ≈ 100 days).

## 3. Token Refresh

```
POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}
```

⚠️ **The response contains a NEW `refresh_token` (rotation).** A fresh refresh token is returned ~every 24h and on every exchange; once issued the previous one is invalidated. **Persist the new `refresh_token` from every response** — failing to store it causes `invalid_grant` on the next refresh, forcing a full re-consent.

**Token lifetimes:** access 1h (3600s); refresh ~100 days. Rotation: **yes** (new `refresh_token` ~every 24h + on each exchange, old invalidated). Re-consent: when the refresh token expires (~100d unused) or the user revokes; otherwise rolling refresh keeps the connection alive indefinitely.
[DOCUMENTED] help.developer.intuit.com/s/article/Validity-of-Refresh-Token

## 4. Token Revocation

```
POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke
Content-Type: application/json
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

{ "token": "{ACCESS_OR_REFRESH_TOKEN}" }
```

Revoking either token invalidates the connection; the user must re-consent to reconnect. Used on user disconnect to clean up Intuit-side access.

## 5. Reauthorization Triggers

| Trigger                  | Detection                                           | Action                                           |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------ |
| Access token expired     | 401 + `Fault.type: AuthenticationFault` (code 3200) | refresh using stored refresh token, retry once   |
| Refresh token rotated    | refresh response has a new `refresh_token`          | **persist the new token** (normal, not an error) |
| Refresh token expired    | refresh returns `invalid_grant`                     | full re-consent flow (~100d unused)              |
| Refresh token lost/stale | `invalid_grant` (didn't store the rotated token)    | full re-consent — fix persistence                |
| Scope changed            | 403 + `AuthorizationFault` on a newly-needed call   | full re-consent with the correct scope           |
| User revoked access      | 401/403 and refresh fails                           | full re-consent flow                             |

## Numa Connector Wiring

**Credentials to store:**
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | string (company) | Intuit OAuth Client ID — admin-entered, company-wide |
| `client_secret` | secret (company) | Intuit OAuth Client Secret — admin-entered, company-wide |
| `access_token` | secret (per user) | 1-hour bearer token |
| `refresh_token` | secret (per user) | **rotating** — overwrite on every refresh |
| `realmId` | string (per user) | QBO company id — from OAuth callback, templated into every request path |

Company keys (`client_id`/`client_secret`) entered once by the admin; per-user keys (`access_token`/`refresh_token`/`realmId`) minted when each user completes the OAuth redirect. See 03 §4.

**Test connection sequence:**

```
1. Token check: ensure a non-expired access_token (refresh if expires_in elapsed)
2. Smoke call (with auth):
     GET https://quickbooks.api.intuit.com/v3/company/{realmId}/companyinfo/{realmId}?minorversion=75
     Accept: application/json
   -> expect 200 with { "CompanyInfo": { "CompanyName": "...", ... }, "time": "..." }
```

Note: the `companyinfo` resource id IS the `realmId` (not `"1"`). Omitting `Accept: application/json` may return XML.

**Auto-reconnect logic:**

```
on 401 (AuthenticationFault / code 3200):
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

Endpoints cross-checked against the registry entry (`connectorRegistry.ts`, `id: 'quickbooks'`).
