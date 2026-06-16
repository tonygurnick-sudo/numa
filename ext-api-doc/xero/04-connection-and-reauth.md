---
api_name: Xero Accounting API
api_slug: xero
auth_type: OAuth 2.0 (authorization-code flow with offline_access; NO PAT/API-key path)
authorize_host: https://login.xero.com (authorize endpoint)
token_host: https://identity.xero.com (token + refresh + revocation)
note: auth/token endpoints + scopes below are the EXACT values in connectorRegistry.ts (id 'xero'). Do NOT substitute alternatives — Xero splits the authorize host (login.xero.com) from the token host (identity.xero.com); both are load-bearing.
goal: enough detail to automate connector setup via script
---

# Xero — Connection & Reauthorization Guide

Xero is OAuth-only — no PAT/API-key path. (Xero offers a separate `client_credentials` "custom connection" for M2M, but **not** what this connector uses; the registry uses the standard web-app authorization-code flow.)

## 1. Create the OAuth Application in Xero

(expanded from the registry's `oauthSetupSteps`)

1. Log in to the **Xero Developer Portal** (`https://developer.xero.com`) → **My Apps**.
2. Click **"New app"**; select **"Web app"** as the integration type.
3. Fill in:

| Field                      | Value                                                          | Notes                                                                                                                          |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| App name                   | `Numa Integration` (or per-client name)                        | shown on the user's consent screen                                                                                             |
| Company or application URL | your Numa instance URL e.g. `https://<client>.numa.arcanum.ai` | required by Xero                                                                                                               |
| OAuth 2.0 redirect URI     | the **exact** redirect URI shown in the Numa connector wizard  | **must match byte-for-byte** (incl. trailing slash); HTTPS required (except `http://localhost` for dev); multiple URIs allowed |

4. Save, open the app → **Configuration**: copy the **Client ID** (GUID-like string); click **"Generate a secret"** → copy the **Client Secret** immediately (shown once).
5. Webhooks **not** used by this read-only connector — skip the Webhooks tab.

> **Granular-scopes timing:** apps registered **on/after 2 March 2026** must use Xero's new granular scope model. If the consent screen rejects the classic scopes below, capture the exact granular scope strings Xero presents and update the registry `scopes`.

## 2. OAuth Flow

| Property          | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                                        |
| Authorization URL | `https://login.xero.com/identity/connect/authorize`                                         |
| Token URL         | `https://identity.xero.com/connect/token`                                                   |
| Revocation URL    | `https://identity.xero.com/connect/revocation`                                              |
| Redirect URI      | the registered Numa connector redirect URI (exact match)                                    |
| Scopes            | `openid profile email accounting.transactions.read accounting.contacts.read offline_access` |
| PKCE required?    | No for web apps (recommended); required only for the mobile/desktop PKCE flow               |

> `offline_access` is **mandatory** — without it Xero does **not** return a refresh token, and the connector cannot stay connected past the 30-minute access-token lifetime.

### 2.1 Authorization Request

```http
GET https://login.xero.com/identity/connect/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=openid%20profile%20email%20accounting.transactions.read%20accounting.contacts.read%20offline_access&state={RANDOM_STATE}
```

| Parameter       | Required             | Notes                                                        |
| --------------- | -------------------- | ------------------------------------------------------------ |
| `response_type` | yes                  | always `code`                                                |
| `client_id`     | yes                  | from the Xero app Configuration page                         |
| `redirect_uri`  | yes                  | must match a registered URI exactly                          |
| `scope`         | yes                  | space-separated (URL-encoded); must include `offline_access` |
| `state`         | strongly recommended | CSRF protection — validate on callback                       |

The user authenticates, **chooses which organisation(s) to connect**, and consents. Xero redirects back with `?code={AUTH_CODE}&state={STATE}`.

> Unlike MYOB, the redirect does **not** include an org identifier — Xero returns the tenant id(s) only from `GET /connections` after the token exchange (see Test Connection Sequence).

### 2.2 Token Exchange

```http
POST https://identity.xero.com/connect/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=authorization_code&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}
```

> Xero accepts client credentials either as HTTP **Basic** auth (shown) **or** as `client_id`/`client_secret` form fields in the body. Basic auth is the documented default.

### 2.3 Token Response

`{"id_token":"eyJ...","access_token":"eyJ...","expires_in":1800,"token_type":"Bearer","refresh_token":"xeRoReFreshTokenValue...","scope":"openid profile email accounting.transactions.read accounting.contacts.read offline_access"}`

- `access_token` — JWT bearer, **30-minute** lifetime (`expires_in: 1800`).
- `refresh_token` — opaque string, **persist it** (rotates on every refresh — §3).
- `id_token` — OpenID identity token (user claims); not needed for data calls.

## 3. Token Refresh

```http
POST https://identity.xero.com/connect/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}
```

Response is the same shape as §2.3 — **including a brand-new `refresh_token`**.

| Property                | Value                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Access token lifetime   | **30 minutes** (`expires_in: 1800`)                                                                  |
| Refresh token lifetime  | **60 days of inactivity** (each successful refresh resets the 60-day clock)                          |
| Refresh token rotation? | **Yes — one-time-use.** Each refresh returns a NEW refresh token; the old one is invalidated.        |
| Re-consent required?    | on `invalid_grant` (refresh token stale/expired/revoked), on scope change, or after 60 days inactive |

> ⚠️ **The headline operational risk.** Refresh tokens are one-time-use, so the storage layer **must persist the new `refresh_token` atomically on every refresh**. If a refresh response is lost (e.g. crash before persist), Xero allows a **~30-minute grace window** to retry the previous refresh token. After that, the stored token is dead → `invalid_grant` → full re-consent. Never fire two concurrent refreshes with the same token — one wins, kills the other.

## 4. Token Revocation

```http
POST https://identity.xero.com/connect/revocation
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

token={REFRESH_TOKEN}
```

Revoking the refresh token disconnects **all** organisations associated with that token. Use on user/admin disconnect. To disconnect a single org while keeping others, call `DELETE https://api.xero.com/connections/{connectionId}` — `connectionId` is the `id` field from `GET /connections`.

## 5. Reauthorization Triggers

| Trigger                                                | Detection                                              | Action                                   |
| ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------- |
| Access token expired                                   | 401 on a data call                                     | refresh using refresh token, retry once  |
| Refresh token expired/rotated-away                     | refresh returns `invalid_grant`                        | full re-consent flow                     |
| Scopes changed (e.g. added `accounting.settings.read`) | new scope needed → 403 on the new resource             | full re-consent flow with updated scopes |
| User revoked access in Xero                            | refresh returns `invalid_grant`, or data calls 401/403 | full re-consent flow                     |
| 60 days inactive                                       | refresh returns `invalid_grant`                        | full re-consent flow                     |

> A **403 on a data call** (e.g. `/Accounts`) is usually a **scope** problem, not an expired token — do **not** trigger a refresh/reconsent loop for it. With the current read-only scopes, `/Accounts`, `/Items`, `/TaxRates`, `/Organisation`, `/Reports/*` 403 by design. Fix by adding the scope to the registry and re-consenting once, not by retrying.

## Numa Connector Wiring

### Credentials to Store

| Key                       | Type   | Scope   | Description                                                          |
| ------------------------- | ------ | ------- | -------------------------------------------------------------------- |
| `client_id`               | string | Company | Xero app Client ID (OAuth app Configuration page)                    |
| `client_secret`           | secret | Company | Xero app Client Secret (shown once — store in the vault)             |
| `access_token`            | secret | User    | 30-min JWT bearer; refreshed automatically                           |
| `refresh_token`           | secret | User    | rotating, one-time-use; **re-persist on every refresh**              |
| `tenant_id` (per org)     | string | User    | from `GET /connections`; sent as `Xero-tenant-id` on every data call |
| `connection_id` (per org) | string | User    | the `id` field from `/connections`; used for single-org disconnect   |

Client ID/Secret are **company** credentials (admin supplies once per client). Tokens + tenant id(s) are **per-user**, captured during the user connect flow.

### Test Connection Sequence

```
1. GET https://api.xero.com/connections
     Authorization: Bearer {access_token}
     Accept: application/json
   → 200 with [{ id, tenantId, tenantName, ... }]   (verifies token validity + lists orgs)

2. GET https://api.xero.com/api.xro/2.0/Invoices?page=1&summaryOnly=true&pageSize=1
     Authorization: Bearer {access_token}
     Xero-tenant-id: {tenantId from step 1}
     Accept: application/json
   → 200 with { "Status": "OK", "Invoices": [...] }   (verifies tenant header + read scope)
```

> Do **not** smoke-test against `/Organisation` or `/Accounts` — those need `accounting.settings.read` (not in the registry scopes) and would 403, making a valid connection look broken. Use `/Invoices` (covered by `accounting.transactions.read`).

### Auto-Reconnect Logic

```
on 401 (data call):
  refresh_token()                       # POST identity.xero.com/connect/token, grant_type=refresh_token
  persist the NEW refresh_token         # one-time-use — must save before next call
  retry the original request once
  if refresh returns invalid_grant:
    trigger full re-consent flow        # stored refresh token stale/revoked/60-day-expired

on 403 (data call):
  do NOT refresh — scope/permission issue
  if resource needs a scope not in registry (e.g. /Accounts → accounting.settings.read):
    surface "this capability is not enabled for the Xero connector" (config decision)

on 429:
  sleep for the Retry-After header value (seconds), then retry
```

## Quick-Reference URLs

| Resource                      | URL                                                                |
| ----------------------------- | ------------------------------------------------------------------ |
| Developer portal / My Apps    | https://developer.xero.com → My Apps                               |
| OAuth2 overview               | https://developer.xero.com/documentation/guides/oauth2/overview/   |
| Auth-code flow                | https://developer.xero.com/documentation/guides/oauth2/auth-flow/  |
| Scopes (+ granular migration) | https://developer.xero.com/documentation/guides/oauth2/scopes/     |
| Token types / lifetimes       | https://developer.xero.com/documentation/guides/oauth2/token-types |
| Tenants / connections         | https://developer.xero.com/documentation/guides/oauth2/tenants     |
| Rate limits                   | https://developer.xero.com/documentation/guides/oauth2/limits/     |
| Status page                   | https://status.xero.com/                                           |

See `02-api-spec-investigation.md` (API reference), `03-connector-setup.md` (registry entry + `ext-api-doc` deploy), `01-llm-api-rules.md` (+ `01a`–`01d`, the workspace-agent knowledge pack).
