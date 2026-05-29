# Podio — Connection & Reauthorization Guide

> Setup runbook for connecting Numa to Podio.
> **Auth type:** OAuth 2.0 (`authorization_code`). Podio has no PAT/API-key path for the REST API.
> Detailed enough to automate connector setup via script or drive an admin step-by-step.
>
> Vendor-side only — Numa-internal vault/registry wiring lives in `03-connector-setup.md` and the connector skill.
> Confidence: **medium** — first-live-call gate not yet run. Verify the `OAuth2` header scheme, the working
> `tokenUrl`, and refresh-token rotation on the first successful connect, then promote markers to [CONFIRMED].

---

## Auth Type: OAuth 2.0 (authorization_code)

The OAuth handshake is RFC-6749-standard, but **two Podio-specific quirks** bite generic clients:

1. **API calls use `Authorization: OAuth2 {access_token}` — NOT `Bearer`.** Wrong scheme → 401 `unauthorized`. (The token exchange/refresh requests themselves carry no auth header.)
2. **The documented token endpoint is `https://api.podio.com/oauth/token/v2`** — different host (`api.podio.com`) and a `/v2` suffix — even though the authorize endpoint is on `podio.com`. The connector registry currently points `tokenUrl` at `https://podio.com/oauth/token`; see §3.

---

## 1. Create the OAuth Application in Podio

The admin does this once per Numa deployment, in the Podio API console.

### Steps

1. Sign in to Podio with an account that can create API keys, and open **`https://podio.com/settings/api`** (the "API Keys" / "Manage API keys" page — also reachable from the Podio Developer Portal `https://developers.podio.com/` → **API Keys**).
2. Click **Generate API Key** (a.k.a. "Add a new API key" / "Create a new API client application").
3. Fill in:

   | Field              | Value                                                                          | Notes                                                                                                  |
   | ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
   | Application name   | `Numa Integration`                                                             | Shown to users on the consent screen                                                                   |
   | Full name / Domain | The **domain** of your redirect URI — e.g. `arcanum-demo-tony.numa.arcanum.ai` | ⚠️ Podio validates the redirect-URI **domain** against this. The path can vary; the domain must match. |

4. Save. Podio issues:
   - **Client ID** — a short alphanumeric string (e.g. `numa-integration`-style slug or a generated id). Capture it.
   - **Client Secret** — a long opaque string. **Shown once — copy immediately.**

5. Paste Client ID + Client Secret into the Numa admin OAuth wizard (Integrations → Podio).
6. The wizard shows the exact **Redirect URI** to register — copy it back into the Podio API key's domain/return-URL field if Podio asks for the full URL. The redirect URI Numa uses is:

   ```
   https://{client-name}.numa.arcanum.ai/oauth/callback/{oauthSecretId}
   ```

   (`{oauthSecretId}` is generated per Numa OAuth secret — copy the literal value the wizard displays; do not hand-build it from the slug.)

> **Redirect-URI domain rule (the #1 setup gotcha).** Podio does NOT do byte-for-byte redirect-URI matching the way Google/Zoho do — instead it checks that the redirect URI's **domain** matches the domain registered with the API key. If the key is registered for `arcanum-demo-tony.numa.arcanum.ai`, any HTTPS redirect on that host is accepted. A mismatched domain fails the authorize step. HTTPS is required for production. [DOCUMENTED]

---

## 2. OAuth Flow

| Property          | Value                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                                                          |
| Authorization URL | `https://podio.com/oauth/authorize`                                                                           |
| Token URL         | `https://api.podio.com/oauth/token/v2` ⚠️ (registry says `https://podio.com/oauth/token` — see §3)            |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/{oauthSecretId}`                                        |
| Scopes            | _(empty)_ — Podio's scope model is coarse; omit `scope` and the token inherits the user's full permission set |
| PKCE required?    | No                                                                                                            |
| State parameter   | Yes — recommended for CSRF; Numa's wizard sends it                                                            |

### Authorization request

Numa builds and redirects the user to:

```http
GET https://podio.com/oauth/authorize?
  response_type=code&
  client_id={client_id}&
  redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2F{oauthSecretId}&
  state={random_state}
```

`scope` is omitted (empty in the registry). The user signs into Podio, reviews the consent screen, and approves. Podio redirects back to the `redirect_uri` with `?code={auth_code}&state={same_state}` — or `?error=...` on denial.

### Token exchange

Numa's backend exchanges the auth code for tokens (form-urlencoded, **no** Authorization header):

```http
POST https://api.podio.com/oauth/token/v2
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
client_id={client_id}&
client_secret={client_secret}&
code={auth_code}&
redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2F{oauthSecretId}
```

### Token response

```json
{
  "access_token": "f3a8b1c2d4e5...",
  "token_type": "bearer",
  "expires_in": 28800,
  "refresh_token": "9d7e6f5a4b3c...",
  "ref": { "type": "user", "id": 123456 }
}
```

| Field           | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `access_token`  | Put it in `Authorization: OAuth2 {access_token}` on every API call (NOT `Bearer`).             |
| `token_type`    | Says `"bearer"` — **ignore it.** The Podio API only accepts the `OAuth2` scheme, not `Bearer`. |
| `expires_in`    | 28800 (8 hours) — authoritative; compute expiry from this rather than assuming.                |
| `refresh_token` | 28-day TTL. **Rotated on every refresh — always persist the latest one** (see §3).             |
| `ref`           | The authenticated principal (`{type, id}`).                                                    |

The access token goes in `Authorization: OAuth2 {access_token}` — verify with `GET /user/status` (see §6).

---

## 3. Token Refresh

Before the access token expires (8h), exchange the refresh token for a new pair (form-urlencoded, no auth header):

```http
POST https://api.podio.com/oauth/token/v2
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
client_id={client_id}&
client_secret={client_secret}&
refresh_token={refresh_token}
```

**Response:**

```json
{
  "access_token": "a1b2c3d4...new...",
  "token_type": "bearer",
  "expires_in": 28800,
  "refresh_token": "z9y8x7w6...NEW...",
  "ref": { "type": "user", "id": 123456 }
}
```

| Property                | Value                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | 8 hours (28800s; `expires_in` is authoritative)                                                                      |
| Refresh token lifetime  | 28 days                                                                                                              |
| Refresh token rotation? | **Yes** — the refresh response returns a **new** `refresh_token`. **You MUST persist the rotated value every time.** |
| Re-consent required?    | When the refresh token expires unused (28 days), is invalidated, or the user/admin disables the API client.          |

> ⚠️ **Rotation is the trap.** Because each refresh issues a new refresh token, the connector must overwrite the stored `refresh_token` on **every** refresh. If you keep refreshing using the original token (or fail to persist the rotated one), you get locked out once the old token's 28-day window lapses and the user must reconnect. [DOCUMENTED — rotation behaviour; treat the exact rotate-vs-reuse semantics as INFERRED until confirmed on the first live refresh.]
>
> ⚠️ **`tokenUrl` discrepancy.** The connector registry sets `tokenUrl: 'https://podio.com/oauth/token'`, but the documented endpoint is `https://api.podio.com/oauth/token/v2`. `podio.com/oauth/token` historically aliased to v2, but POST to the **documented** endpoint to be safe, and recommend correcting the registry (`03-connector-setup.md` §3). If token exchange/refresh fails unexpectedly (404, redirect, or `invalid_grant` on an otherwise-valid code), this is the first thing to check.

---

## 4. Token Revocation

Podio publishes **no OAuth revoke endpoint**. There is no `POST /oauth/token/revoke` equivalent.

- **Tokens expire naturally** — access tokens after 8h, refresh tokens after 28 days of non-use.
- **To force-revoke**, the admin disables (or deletes) the API client in the Podio API console (`https://podio.com/settings/api`). All tokens minted by that client stop working.
- A user can also remove the app's access from their Podio account settings; Numa has no visibility into that — the next API call simply returns 401.

In all cases, subsequent calls with the dead token return **401 `unauthorized`**, and a refresh attempt returns **400 `invalid_grant`**.

---

## 5. Reauthorization Triggers

When to prompt the user to reauthorize:

| Trigger                         | Detection                                                             | Action                                                                                |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Access token expired            | HTTP 401 `unauthorized` / `expired` on an API call                    | Backend refreshes via `refresh_token`; **persist rotated token**; retry the call once |
| Refresh token expired (28 days) | Refresh returns 400 `invalid_grant`                                   | Mark user disconnected; prompt full re-consent flow                                   |
| Refresh token not persisted     | Refresh returns 400 `invalid_grant` (using a stale/old refresh token) | Same as above — a rotation bug; full re-consent                                       |
| User removed app access         | 401 on API calls AND 400 on refresh                                   | Disconnect; full re-consent                                                           |
| Admin disabled the API client   | 401 on every call; refresh 400                                        | Admin re-enables / re-creates the client; user reconnects                             |
| Wrong header scheme (`Bearer`)  | Persistent 401 despite a fresh, valid token                           | Bug — fix to `Authorization: OAuth2 {token}` (set `authHeaderScheme: 'OAuth2'`)       |
| Wrong token endpoint            | Token exchange/refresh fails (404/redirect/`invalid_grant`)           | POST to `https://api.podio.com/oauth/token/v2`; correct the registry `tokenUrl`       |

---

## 6. Test connection sequence (vendor-side)

```
1. POST https://api.podio.com/oauth/token/v2  (grant=refresh_token)   → 200 + fresh access_token + ROTATED refresh_token
2. GET  https://api.podio.com/user/status                            → 200 + { user: {...}, profile: {...} }
   Header: Authorization: OAuth2 {access_token}
   (Cheap auth/liveness check. Alternative: GET /org/ to also anchor hierarchy discovery.)
3. GET  https://api.podio.com/org/                                   → 200 + [ { org_id, name, spaces:[...] }, ... ]
```

If step 2 returns 401 despite a fresh token from step 1, the header scheme is wrong — confirm it is `OAuth2`, not `Bearer`.

### Auto-reconnect logic (recommended)

```
on 401 (unauthorized / expired) on an API call:
    try refresh_token()                       # POST api.podio.com/oauth/token/v2
    if refresh returns 200:
        persist the NEW access_token AND the NEW (rotated) refresh_token
        retry the original call once
    if refresh returns 4xx (invalid_grant):
        mark user disconnected — full re-consent required

on 420 (rate_limit):                          # NOTE: Podio uses 420, not 429
    honour Retry-After; otherwise exponential backoff (base 2s, cap 60s, jitter)
    do NOT treat as an auth failure
```

No transient retries for refresh failures — a 400 `invalid_grant` from refresh means the refresh token is genuinely dead (expired, not-persisted, or revoked), so go straight to re-consent.

> Numa-internal vault key names and the registry entry live in `03-connector-setup.md` and the Numa connector skill — this file is vendor-side only.

---

## 7. Programmatic Token Management

Podio exposes **no** user-facing "list my tokens" or "create a PAT" API — OAuth `authorization_code` + `refresh_token` is the only path. Everything programmatic happens through the two endpoints above:

- **Authorize:** `https://podio.com/oauth/authorize`
- **Token (exchange + refresh):** `https://api.podio.com/oauth/token/v2`

If the user asks how to change permissions: Podio's scope model is coarse (the token carries the user's full granted set), so there is no scope to "add". To change _what the integration can reach_, change the authenticating user's membership/permissions inside Podio (org/space/app access), then reconnect.

---

_Generated from `00-api-investigation-questionnaire.md` Phase 2. Auth facts verified 2026-05-29 against developers.podio.com/authentication and /index/limits. First-live-call gate not yet satisfied — promote to [CONFIRMED] after a successful `GET /user/status`._
