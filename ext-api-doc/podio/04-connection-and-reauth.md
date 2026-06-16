---
api_name: Podio
api_slug: podio
auth_type: oauth2 (authorization_code) — no PAT/API-key path for the REST API
auth_header_scheme: OAuth2 {access_token} — NOT Bearer (Bearer → 401)
authorize_url: https://podio.com/oauth/authorize
token_url: https://api.podio.com/oauth/token/v2 (registry currently says podio.com/oauth/token — §3)
access_token_ttl: 8h (expires_in=28800, authoritative)
refresh_token_ttl: 28 days, ROTATED on every refresh — must persist the new one
confidence: medium — first-live-call gate not yet run. Verify the OAuth2 scheme, working tokenUrl, and refresh rotation on the first connect, then promote markers to [CONFIRMED].
note: vendor-side only — Numa-internal vault/registry wiring lives in 03-connector-setup.md and the connector skill.
---

# Podio — Connection & Reauthorization Guide

Setup runbook for connecting Numa to Podio. **Auth: OAuth 2.0 (`authorization_code`)** — Podio has no PAT/API-key path for the REST API. RFC-6749-standard handshake, but **two Podio-specific quirks** bite generic clients:

1. **API calls use `Authorization: OAuth2 {access_token}` — NOT `Bearer`.** Wrong scheme → 401 `unauthorized`. (Token exchange/refresh requests carry no auth header.)
2. **The documented token endpoint is `https://api.podio.com/oauth/token/v2`** — different host (`api.podio.com`) and a `/v2` suffix — even though the authorize endpoint is on `podio.com`. The registry currently points `tokenUrl` at `https://podio.com/oauth/token`; see §3.

## 1. Create the OAuth Application in Podio

Admin does this once per Numa deployment, in the Podio API console.

1. Sign in to Podio with an account that can create API keys, open **`https://podio.com/settings/api`** (the "API Keys" page — also reachable from the Developer Portal `https://developers.podio.com/` → **API Keys**).
2. Click **Generate API Key** ("Add a new API key" / "Create a new API client application").
3. Fill in:

   | Field              | Value                                                                          | Notes                                                                                                  |
   | ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
   | Application name   | `Numa Integration`                                                             | Shown to users on the consent screen                                                                   |
   | Full name / Domain | The **domain** of your redirect URI — e.g. `arcanum-demo-tony.numa.arcanum.ai` | ⚠️ Podio validates the redirect-URI **domain** against this. The path can vary; the domain must match. |

4. Save. Podio issues: **Client ID** (short alphanumeric string/slug — capture it) and **Client Secret** (long opaque string — **shown once, copy immediately**).
5. Paste Client ID + Client Secret into the Numa admin OAuth wizard (Integrations → Podio).
6. The wizard shows the exact **Redirect URI** to register — copy it back into the Podio API key's domain/return-URL field if Podio asks for the full URL:
   `https://{client-name}.numa.arcanum.ai/oauth/callback/{oauthSecretId}`
   (`{oauthSecretId}` is generated per Numa OAuth secret — copy the literal value the wizard displays; do not hand-build it from the slug.)

> **Redirect-URI domain rule (the #1 setup gotcha).** Podio does NOT do byte-for-byte redirect-URI matching like Google/Zoho — it checks that the redirect URI's **domain** matches the domain registered with the API key. If the key is registered for `arcanum-demo-tony.numa.arcanum.ai`, any HTTPS redirect on that host is accepted. A mismatched domain fails the authorize step. HTTPS required for production.

## 2. OAuth Flow

| Property          | Value                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                                                       |
| Authorization URL | `https://podio.com/oauth/authorize`                                                                        |
| Token URL         | `https://api.podio.com/oauth/token/v2` ⚠️ (registry says `https://podio.com/oauth/token` — §3)             |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/{oauthSecretId}`                                     |
| Scopes            | _(empty)_ — Podio's scope model is coarse; omit `scope`, the token inherits the user's full permission set |
| PKCE required?    | No                                                                                                         |
| State parameter   | Yes — recommended for CSRF; Numa's wizard sends it                                                         |

**Authorization request** — Numa redirects to: `GET https://podio.com/oauth/authorize?response_type=code&client_id={client_id}&redirect_uri={url-encoded redirect_uri}&state={random_state}` (`scope` omitted, empty in registry). User signs in, consents, approves. Podio redirects back to `redirect_uri` with `?code={auth_code}&state={same_state}` — or `?error=...` on denial.

**Token exchange** — backend POSTs the auth code (form-urlencoded, **no** Authorization header):

```
POST https://api.podio.com/oauth/token/v2     Content-Type: application/x-www-form-urlencoded
grant_type=authorization_code&client_id={client_id}&client_secret={client_secret}&code={auth_code}&redirect_uri={url-encoded redirect_uri}
```

**Token response:** `{"access_token":"f3a8b1c2d4e5...","token_type":"bearer","expires_in":28800,"refresh_token":"9d7e6f5a4b3c...","ref":{"type":"user","id":123456}}`
| Field | Meaning |
| --- | --- |
| `access_token` | Put in `Authorization: OAuth2 {access_token}` on every API call (NOT `Bearer`) |
| `token_type` | Says `"bearer"` — **ignore it.** The API only accepts the `OAuth2` scheme |
| `expires_in` | 28800 (8h) — authoritative; compute expiry from this rather than assuming |
| `refresh_token` | 28-day TTL. **Rotated on every refresh — always persist the latest one** (§3) |
| `ref` | The authenticated principal (`{type, id}`) |

Verify with `GET /user/status` (§6).

## 3. Token Refresh

Before the access token expires (8h), POST the refresh token (form-urlencoded, no auth header): `POST https://api.podio.com/oauth/token/v2` body `grant_type=refresh_token&client_id={client_id}&client_secret={client_secret}&refresh_token={refresh_token}`.
**Response:** same shape as token exchange, with a **new** `access_token` AND a **new** (rotated) `refresh_token`: `{"access_token":"a1b2c3d4...new...","token_type":"bearer","expires_in":28800,"refresh_token":"z9y8x7w6...NEW...","ref":{...}}`

| Property                | Value                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Access token lifetime   | 8h (28800s; `expires_in` authoritative)                                                                      |
| Refresh token lifetime  | 28 days                                                                                                      |
| Refresh token rotation? | **Yes** — the response returns a **new** `refresh_token`. **You MUST persist the rotated value every time.** |
| Re-consent required?    | When the refresh token expires unused (28 days), is invalidated, or the user/admin disables the API client   |

> ⚠️ **Rotation is the trap.** Each refresh issues a new refresh token — the connector must overwrite the stored `refresh_token` on **every** refresh. Keep refreshing with the original (or fail to persist the rotated one) and you get locked out once the old token's 28-day window lapses; the user must reconnect. [rotation DOCUMENTED; exact rotate-vs-reuse semantics INFERRED until confirmed on first live refresh.]
>
> ⚠️ **`tokenUrl` discrepancy.** Registry sets `tokenUrl: 'https://podio.com/oauth/token'`, but the documented endpoint is `https://api.podio.com/oauth/token/v2`. `podio.com/oauth/token` historically aliased to v2, but POST to the **documented** endpoint to be safe, and correct the registry (03 §3). If token exchange/refresh fails unexpectedly (404, redirect, or `invalid_grant` on an otherwise-valid code), check this first.

## 4. Token Revocation

Podio publishes **no OAuth revoke endpoint** (no `POST /oauth/token/revoke` equivalent).

- Tokens expire naturally — access after 8h, refresh after 28 days of non-use.
- To force-revoke: admin disables (or deletes) the API client in the Podio API console (`https://podio.com/settings/api`) — all tokens minted by that client stop working.
- A user can also remove the app's access from their Podio account settings; Numa has no visibility — the next API call simply returns 401.

In all cases, subsequent calls with the dead token return **401 `unauthorized`**, and a refresh attempt returns **400 `invalid_grant`**.

## 5. Reauthorization Triggers

| Trigger                         | Detection                                                     | Action                                                                          |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Access token expired            | HTTP 401 `unauthorized`/`expired` on an API call              | Backend refreshes via `refresh_token`; **persist rotated token**; retry once    |
| Refresh token expired (28 days) | Refresh returns 400 `invalid_grant`                           | Mark user disconnected; prompt full re-consent flow                             |
| Refresh token not persisted     | Refresh returns 400 `invalid_grant` (stale/old refresh token) | Same as above — a rotation bug; full re-consent                                 |
| User removed app access         | 401 on API calls AND 400 on refresh                           | Disconnect; full re-consent                                                     |
| Admin disabled the API client   | 401 on every call; refresh 400                                | Admin re-enables / re-creates the client; user reconnects                       |
| Wrong header scheme (`Bearer`)  | Persistent 401 despite a fresh, valid token                   | Bug — fix to `Authorization: OAuth2 {token}` (set `authHeaderScheme: 'OAuth2'`) |
| Wrong token endpoint            | Token exchange/refresh fails (404/redirect/`invalid_grant`)   | POST to `https://api.podio.com/oauth/token/v2`; correct the registry `tokenUrl` |

## 6. Test connection sequence (vendor-side)

```
1. POST https://api.podio.com/oauth/token/v2  (grant=refresh_token)  → 200 + fresh access_token + ROTATED refresh_token
2. GET  https://api.podio.com/user/status                            → 200 + {user:{...}, profile:{...}}
   Header: Authorization: OAuth2 {access_token}
   (Cheap auth/liveness check. Alternative: GET /org/ to also anchor hierarchy discovery.)
3. GET  https://api.podio.com/org/                                   → 200 + [{org_id, name, spaces:[...]}, ...]
```

If step 2 returns 401 despite a fresh token from step 1, the header scheme is wrong — confirm it is `OAuth2`, not `Bearer`.

**Auto-reconnect logic (recommended):**

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

## 7. Programmatic Token Management

Podio exposes **no** user-facing "list my tokens" or "create a PAT" API — OAuth `authorization_code` + `refresh_token` is the only path. Everything programmatic happens through two endpoints:

- **Authorize:** `https://podio.com/oauth/authorize`
- **Token (exchange + refresh):** `https://api.podio.com/oauth/token/v2`

To change permissions: Podio's scope model is coarse (the token carries the user's full granted set), so there is no scope to "add". To change _what the integration can reach_, change the authenticating user's membership/permissions inside Podio (org/space/app access), then reconnect.
