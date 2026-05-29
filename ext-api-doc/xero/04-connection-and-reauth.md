# Xero Accounting API — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the Xero Accounting API.
> Auth type: **OAuth 2.0** (authorization-code flow with `offline_access`).
> Goal: enough detail that Numa could automate connector setup via script.
>
> The auth/token endpoints and scopes below are the **exact** values in the connector
> registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'xero'`).
> Do not substitute alternatives — Xero splits the authorize host (`login.xero.com`) from the
> token host (`identity.xero.com`), and both are load-bearing.

---

## Auth Type: OAuth 2.0

Xero is OAuth-only — there is no PAT/API-key path. (Xero offers a separate
`client_credentials` "custom connection" for M2M, but that is **not** what this connector
uses; the registry is configured for the standard web-app authorization-code flow.)

---

## 1. Create the OAuth Application in Xero

These steps mirror the registry's `oauthSetupSteps`, expanded.

1. Log in to the **Xero Developer Portal** at `https://developer.xero.com` → **My Apps**.
2. Click **"New app"**.
3. Select **"Web app"** as the integration type.
4. Fill in:

   | Field                      | Value                                                           | Notes                                                                                                                           |
   | -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
   | App name                   | `Numa Integration` (or per-client name)                         | Shown on the user's consent screen.                                                                                             |
   | Company or application URL | your Numa instance URL, e.g. `https://<client>.numa.arcanum.ai` | Required by Xero.                                                                                                               |
   | OAuth 2.0 redirect URI     | the **exact** redirect URI shown in the Numa connector wizard   | **Must match byte-for-byte** (incl. trailing slash). HTTPS required (except `http://localhost` for dev). Multiple URIs allowed. |

5. Save, then open the app and go to **Configuration**:
   - Copy the **Client ID** (a GUID-like string).
   - Click **"Generate a secret"** → copy the **Client Secret** immediately (shown once).
6. (Webhooks are **not** used by this read-only connector — skip the Webhooks tab.)

> **Granular-scopes timing:** apps registered **on/after 2 March 2026** must use Xero's new
> granular scope model. If the consent screen rejects the classic scopes below, capture the
> exact granular scope strings Xero presents and update the registry `scopes` accordingly.

---

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

> `offline_access` is **mandatory** — without it Xero does **not** return a refresh token, and
> the connector cannot stay connected past the 30-minute access-token lifetime.

### 2.1 Authorization Request

```http
GET https://login.xero.com/identity/connect/authorize?
  response_type=code&
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  scope=openid%20profile%20email%20accounting.transactions.read%20accounting.contacts.read%20offline_access&
  state={RANDOM_STATE}
```

| Parameter       | Required             | Notes                                                        |
| --------------- | -------------------- | ------------------------------------------------------------ |
| `response_type` | yes                  | Always `code`                                                |
| `client_id`     | yes                  | From the Xero app Configuration page                         |
| `redirect_uri`  | yes                  | Must match a registered URI exactly                          |
| `scope`         | yes                  | Space-separated (URL-encoded); must include `offline_access` |
| `state`         | strongly recommended | CSRF protection — validate on callback                       |

The user authenticates, **chooses which organisation(s) to connect**, and consents. Xero
redirects back with `?code={AUTH_CODE}&state={STATE}`.

> Unlike MYOB, the redirect does **not** include an org identifier — Xero returns the tenant
> id(s) only from `GET /connections` after the token exchange (see §6).

### 2.2 Token Exchange

```http
POST https://identity.xero.com/connect/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=authorization_code&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}
```

> Xero accepts the client credentials either as HTTP **Basic** auth (shown above) **or** as
> `client_id`/`client_secret` form fields in the body. Basic auth is the documented default.

### 2.3 Token Response

```json
{
  "id_token": "eyJ...",
  "access_token": "eyJ...",
  "expires_in": 1800,
  "token_type": "Bearer",
  "refresh_token": "xeRoReFreshTokenValue...",
  "scope": "openid profile email accounting.transactions.read accounting.contacts.read offline_access"
}
```

- `access_token` — JWT bearer token, **30-minute** lifetime (`expires_in: 1800`).
- `refresh_token` — opaque string, **persist it** (rotates on every refresh — see §3).
- `id_token` — OpenID identity token (user claims); not needed for data calls.

---

## 3. Token Refresh

```http
POST https://identity.xero.com/connect/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

grant_type=refresh_token&
refresh_token={REFRESH_TOKEN}
```

Response is the same shape as §2.3 — **including a brand-new `refresh_token`**.

| Property                | Value                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Access token lifetime   | **30 minutes** (`expires_in: 1800`)                                                                  |
| Refresh token lifetime  | **60 days of inactivity** (each successful refresh resets the 60-day clock)                          |
| Refresh token rotation? | **Yes — one-time-use.** Each refresh returns a NEW refresh token; the old one is invalidated.        |
| Re-consent required?    | On `invalid_grant` (refresh token stale/expired/revoked), on scope change, or after 60 days inactive |

> ⚠️ **The headline operational risk.** Because refresh tokens are one-time-use, the storage
> layer **must persist the new `refresh_token` atomically on every refresh**. If a refresh
> response is lost (e.g. crash before persist), Xero allows a **~30-minute grace window** to
> retry the previous refresh token. After that, the stored token is dead → `invalid_grant` →
> full re-consent. Never fire two concurrent refreshes with the same token — one will win and
> kill the other.

---

## 4. Token Revocation

```http
POST https://identity.xero.com/connect/revocation
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({CLIENT_ID}:{CLIENT_SECRET})

token={REFRESH_TOKEN}
```

Revoking the refresh token disconnects **all** organisations associated with that token. Use on
user/admin disconnect. (To disconnect a single org while keeping others, call
`DELETE https://api.xero.com/connections/{connectionId}` instead — `connectionId` is the `id`
field from `GET /connections`.)

---

## 5. Reauthorization Triggers

| Trigger                                                | Detection                                              | Action                                   |
| ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------- |
| Access token expired                                   | 401 on a data call                                     | Refresh using refresh token, retry once  |
| Refresh token expired/rotated-away                     | Refresh returns `invalid_grant`                        | Full re-consent flow                     |
| Scopes changed (e.g. added `accounting.settings.read`) | new scope needed → 403 on the new resource             | Full re-consent flow with updated scopes |
| User revoked access in Xero                            | Refresh returns `invalid_grant`, or data calls 401/403 | Full re-consent flow                     |
| 60 days inactive                                       | Refresh returns `invalid_grant`                        | Full re-consent flow                     |

> A **403 on a data call** (e.g. `/Accounts`) is usually a **scope** problem, not an expired
> token — do **not** trigger a refresh/reconsent loop for it. With the current read-only scopes,
> `/Accounts`, `/Items`, `/TaxRates`, `/Organisation`, `/Reports/*` will 403 by design. Fix it by
> adding the scope to the registry and re-consenting once, not by retrying.

---

## Numa Connector Wiring

### Credentials to Store

| Key                       | Type   | Scope   | Description                                                          |
| ------------------------- | ------ | ------- | -------------------------------------------------------------------- |
| `client_id`               | string | Company | Xero app Client ID (from the OAuth app Configuration page)           |
| `client_secret`           | secret | Company | Xero app Client Secret (shown once — store in the vault)             |
| `access_token`            | secret | User    | 30-min JWT bearer; refreshed automatically                           |
| `refresh_token`           | secret | User    | Rotating, one-time-use; **re-persist on every refresh**              |
| `tenant_id` (per org)     | string | User    | From `GET /connections`; sent as `Xero-tenant-id` on every data call |
| `connection_id` (per org) | string | User    | The `id` field from `/connections`; used for single-org disconnect   |

The Client ID/Secret are **company** credentials (admin supplies them once per client). The
tokens and tenant id(s) are **per-user**, captured during the user connect flow.

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

> Do **not** smoke-test against `/Organisation` or `/Accounts` — those need
> `accounting.settings.read`, which is not in the registry scopes, so they would 403 and make a
> valid connection look broken. Use `/Invoices` (covered by `accounting.transactions.read`).

### Auto-Reconnect Logic

```
on 401 response (data call):
  refresh_token()                       # POST identity.xero.com/connect/token, grant_type=refresh_token
  persist the NEW refresh_token         # one-time-use — must save before next call
  retry the original request once
  if refresh returns invalid_grant:
    trigger full re-consent flow        # stored refresh token is stale/revoked/60-day-expired

on 403 response (data call):
  do NOT refresh — this is a scope/permission issue
  if the resource needs a scope not in the registry (e.g. /Accounts → accounting.settings.read):
    surface "this capability is not enabled for the Xero connector" (config decision)

on 429 response:
  sleep for the Retry-After header value (seconds), then retry
```

---

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

---

_See `02-api-spec-investigation.md` for the API reference, `03-connector-setup.md` for the
registry entry and `ext-api-doc` deploy mechanism, and `01-llm-api-rules.md` (+ `01a`–`01d`) for
the workspace-agent knowledge pack._
