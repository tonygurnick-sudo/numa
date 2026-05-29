# Connecteam (OAuth) — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the Connecteam API over OAuth 2.0.
> Auth type: **OAuth 2.0**. Goal: enough detail that Numa could automate connector setup via script.
>
> ⚠️ **Read "Open conflict" first.** The Numa connector registry stores an
> `authorization_code`-style config, but Connecteam's **official** OAuth 2.0 docs document
> **`client_credentials` only**. This guide documents both and flags which parts are verified.
>
> **Shared API:** same REST API as `connecteam-api` (API-key). Only the auth differs.

---

## Open conflict — registry vs official docs

| Aspect            | Numa registry (`connecteam-oauth`)                 | Official Connecteam OAuth 2.0 (Beta) docs                         | Confidence                               |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| Grant type        | Implies `authorization_code` (it has an `authUrl`) | **`client_credentials` only** (server-to-server, no user consent) | Registry: [UNKNOWN] · Docs: [DOCUMENTED] |
| Authorization URL | `https://app.connecteam.com/oauth/authorize`       | **None** — a client_credentials flow has no consent endpoint      | [UNKNOWN — unverified]                   |
| Token URL         | `https://app.connecteam.com/oauth/token`           | **`https://api.connecteam.com/oauth/v1/token`**                   | Registry: [UNKNOWN] · Docs: [DOCUMENTED] |
| Client auth       | (standard code exchange, client_secret in body)    | HTTP **Basic** (Client ID = username, Secret = password)          | [DOCUMENTED]                             |
| App registration  | "Developer Portal → Create an integration"         | "Your Name → Integration Center → OAuth 2.0 → Create app"         | [DOCUMENTED — official]                  |
| Scopes            | `forms.read attachments.write`                     | `feature.permission`, e.g. `users.read`, `schedule.write`         | [DOCUMENTED]                             |
| Refresh token     | (implied by code flow)                             | **None** — re-request on expiry                                   | [DOCUMENTED — none]                      |

**Resolution required before build:** confirm with Connecteam whether a 3-legged
`authorization_code` flow exists. If only `client_credentials` is offered, this connector does
not fit Numa's redirect-based OAuth wizard and overlaps with the API-key connector — either fix
the registry endpoints or reframe the connector. **Option A** below is the registry's stated
(unverified) config; **Option A′** is the official documented flow. Build against whichever is
confirmed live.

---

## Option A — `authorization_code` (as configured in the Numa registry) — UNVERIFIED

> This is what `connectorRegistry.ts` currently stores. The endpoints are **unverified** against
> any official Connecteam page. Use only if Connecteam confirms a 3-legged flow exists.

### 1. Create the OAuth Application in Connecteam

Per the registry `oauthSetupSteps`:

1. Log in to Connecteam.
2. Go to the **Connecteam Developer Portal → Create an integration**.
   _(Per official docs the real menu path is **Your Name → Integration Center → OAuth 2.0 → Create app** — verify which the portal actually shows.)_
3. Fill in:
   | Field | Value | Notes |
   |-------|-------|-------|
   | App / Integration Name | `Numa Integration` | Free text |
   | Redirect URI | _(the redirect URI Numa shows in the wizard)_ | Must match exactly |
   | Scopes | `forms.read attachments.write` | Registry value; **immutable after creation** |
4. Save and copy:
   - **Client ID** — capture immediately
   - **Client Secret** — **shown once**, capture immediately

### 2. OAuth Flow (registry config)

| Property          | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| Grant type        | `authorization_code` (implied)                             |
| Authorization URL | `https://app.connecteam.com/oauth/authorize` ⚠️ unverified |
| Token URL         | `https://app.connecteam.com/oauth/token` ⚠️ unverified     |
| Redirect URI      | _(value shown in the Numa wizard)_                         |
| Scopes            | `forms.read attachments.write`                             |
| PKCE required?    | [UNKNOWN]                                                  |

#### Authorization Request

```http
GET https://app.connecteam.com/oauth/authorize?
  response_type=code&
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  scope=forms.read attachments.write&
  state={RANDOM_STATE}
```

#### Token Exchange

```http
POST https://app.connecteam.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}
```

#### Token Response (expected shape; field values per official docs)

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "forms.read attachments.write"
}
```

> Note: even the official flow returns **no `refresh_token`** (see Option A′). If a code flow
> exists, confirm whether it issues one; the safe assumption is that it does not.

---

## Option A′ — `client_credentials` (official Connecteam OAuth 2.0 docs) — DOCUMENTED

> This is the **documented** flow at https://developer.connecteam.com/docs/oauth-20. Machine-to-machine,
> **no user redirect/consent**.

### 1. Create the OAuth Application in Connecteam

1. Log in to Connecteam.
2. Navigate to **Your Name → Integration Center → OAuth 2.0**.
3. Click **Create app**.
4. Fill in:
   | Field | Value | Notes |
   |-------|-------|-------|
   | App Name | `Numa Integration` | Shown for identification |
   | Scopes | minimum required, e.g. `users.read schedule.read forms.read` | `feature.permission` form; **immutable after creation** |
5. Save and copy:
   - **Client ID** — capture immediately
   - **Client Secret** — **shown once**, capture immediately

> **Plan gate:** the public API (and the Integration Center OAuth section) is **Enterprise-plan only**.

### 2. Token Request

| Property              | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| Grant type            | `client_credentials`                                                  |
| Token URL             | `https://api.connecteam.com/oauth/v1/token`                           |
| Client authentication | HTTP **Basic** — `Authorization: Basic base64(clientId:clientSecret)` |
| Body                  | `grant_type=client_credentials` (+ optional `scope=...`)              |
| Content-Type          | `application/x-www-form-urlencoded`                                   |

```http
POST https://api.connecteam.com/oauth/v1/token
Host: api.connecteam.com
Authorization: Basic {base64(clientId:clientSecret)}
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=users.read schedule.read forms.read
```

#### Token Response

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "users.read schedule.read forms.read"
}
```

> **Security:** never send the Client Secret when calling API endpoints — only the access token.
> The secret is used **only** at the token endpoint (Basic auth).

### 3. Authenticated calls

```http
GET https://api.connecteam.com/me
Accept: application/json
Authorization: Bearer {access_token}
```

> **AU data residency:** AU-resident tenants must use `https://api-au.connecteam.com` for **both**
> the token endpoint and API calls.

---

## Scopes

Scope format is `feature.permission`. For read-only chat, request a read scope per module.

| Scope                            | Purpose                                    | Recommend for Numa?                                     |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `users.read`                     | Read users / employees                     | Yes (read-only chat)                                    |
| `schedule.read`                  | Read schedulers & shifts                   | Yes                                                     |
| `timeclock.read` \*              | Read time clocks / activities / timesheets | Yes (\* exact slug unverified)                          |
| `forms.read`                     | Read forms & submissions                   | Yes — in the registry today                             |
| `attachments.write`              | Upload attachments                         | In the registry; a **write** scope — drop for read-only |
| `users.write` / `schedule.write` | Mutations                                  | Only if mutations are enabled                           |
| `schedule.delete`                | Delete shifts                              | Avoid unless explicitly needed                          |

> ⚠️ **Scopes are immutable after app creation.** To change them you must create a **new** app.
> Decide the full read set (plus any required writes) up front. The registry's current
> `forms.read attachments.write` is narrow and write-skewed — reconsider before go-live.

---

## Token Refresh

| Property              | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| Access token lifetime | **86400 s (24 h)** (`expires_in: 86400`)                              |
| Refresh token         | **Not supported** — there is no refresh-token grant                   |
| Refresh mechanism     | Re-request a fresh token from the token endpoint when the old expires |
| Re-consent required?  | No (client_credentials has no user consent)                           |

There is **no** `grant_type=refresh_token` exchange. On expiry, repeat the token request from
the appropriate flow above. Connecteam recommends implementing automatic renewal **before** the
24-hour expiry rather than waiting for a 401.

---

## Token Revocation

No revocation endpoint is documented. [UNKNOWN] To invalidate access, delete or rotate the OAuth
app in the Connecteam Integration Center.

---

## Reauthorization Triggers

| Trigger                   | Detection                  | Action                                                                                                  |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Access token expired      | 401 response               | Re-fetch a token (24 h, no refresh token); retry the call once                                          |
| Insufficient scope        | 403 response               | Scope missing — and scopes are immutable, so **create a new app** with the right scopes, then reconnect |
| Plan downgrade            | 403 across all endpoints   | Tenant is below Enterprise — the API is gated; nothing to reauth                                        |
| Wrong data-residency host | 401 / 404 for an AU tenant | Switch host to `api-au.connecteam.com` and retry                                                        |
| Client Secret rotated     | 401 at token endpoint      | Re-enter the new Client Secret in the admin wizard                                                      |

---

## Numa Connector Wiring

### Credentials to Store

| Key                  | Type   | Description                                                       |
| -------------------- | ------ | ----------------------------------------------------------------- |
| Client ID            | string | OAuth app Client ID (company secret — set by admin)               |
| Client Secret        | secret | OAuth app Client Secret — shown once at creation (company secret) |
| `access_token`       | secret | Short-lived (24 h) bearer token, managed by `connect_request`     |
| (no `refresh_token`) | —      | This API issues no refresh token — re-fetch on expiry             |

`connect_request` injects the bearer token into the `Authorization` header on every proxied call;
the workspace agent never sees the Client Secret or performs the token exchange itself.

### Test Connection Sequence

```
1. Obtain a token (Option A′: POST /oauth/v1/token with Basic auth) — expect 200 + access_token
2. GET /me (with Bearer token) — expect 200 (verifies the credential and Enterprise plan access)
3. GET /users/v1/users?limit=1 — expect 200 (verifies the granted scope works against real data)
```

### Auto-Reconnect Logic

```
on 401 response:
  re-fetch access token from the token endpoint (no refresh-token grant exists)
  retry the original call once
  if it 401s again:
    surface "Connecteam connection expired — reconnect required" to the admin

on 403 response:
  likely a missing scope (immutable) or a non-Enterprise plan
  do NOT auto-retry — prompt the admin to create a new OAuth app with the right scopes,
  or confirm the tenant is on the Enterprise plan
```

---

_Auth detail sourced from the Connecteam OAuth 2.0 (Beta) docs
(https://developer.connecteam.com/docs/oauth-20), the API-key authentication page
(https://developer.connecteam.com/docs/authentication-1), and the Numa connector registry
(`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`). No live OAuth call was
possible; the registry's `app.connecteam.com/oauth/*` endpoints remain [UNKNOWN — unverified]._
