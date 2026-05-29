# Wrike — Connection & Reauthorization Guide

> Setup runbook for connecting Numa to Wrike.
> **Auth type:** OAuth 2.0 (Wrike does not offer a PAT for the v4 API — OAuth is the only path).
> Detailed enough to automate connector setup via script or drive an admin step-by-step.
>
> **Confidence:** DOCUMENTED against developers.wrike.com — not yet verified by a live call.
> Verify the token-response `host` resolution and the rotating refresh-token flow on the
> first real install (especially for an EU-resident test account).

---

## Auth Type: OAuth 2.0 (authorization_code)

Wrike uses the standard `Bearer` scheme on the API side — `Authorization: Bearer {access_token}`
— and a textbook RFC 6749 authorization-code handshake. **Two Wrike-specific twists dominate
everything else in this file:**

1. **The API host is region-specific and comes back in the token response (`host`).** The auth
   endpoints are global (`login.wrike.com`); only the API host varies by data centre. Build the
   API base URL as `https://{host}/api/v4` from the token's `host` field — **never hardcode
   `www.wrike.com`.**
2. **Refresh tokens ROTATE.** Every refresh returns a new access_token AND a new refresh_token,
   invalidating the old pair. Persist the rotated refresh_token every time, or lose access.

---

## 1. Create the OAuth Application in Wrike

The admin does this once per Numa deployment. Unlike Zoho, there is a **single global console**
— no per-region console; the data centre is resolved later from the token response.

### Steps

1. Log in to the Wrike **App Console** at `https://www.wrike.com/appconsole.htm?#/api` with a
   Wrike admin account. (Reachable from the Wrike UI: profile menu → **Apps & Integrations** →
   **API**.)
2. Click **Create** / **New application** and give it a name (e.g. `Numa Integration`).
3. Wrike issues a **Client ID** and **Client Secret** for the app. Copy the secret immediately.
4. In the app's settings, add the **Redirect URI** Numa shows in the connector wizard. Wrike
   does exact matching — copy the string byte-for-byte.
5. (Optional) Set the default permission/scope of the app to match what Numa requests
   (`wsReadOnly` for read; `Default,wsReadWrite` to allow writes).

| Field        | Value                                                                                                      | Notes                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Name     | `Numa Integration`                                                                                         | Shown to users on the consent screen                                                                                                                            |
| Redirect URI | `https://{client-name}.numa.arcanum.ai/oauth/callback/wrike` (copy the exact string the Numa wizard shows) | **Must match exactly.** Required in the token exchange only if it was sent in the authorize request. Use `https://localhost` for local dev. HTTPS is mandatory. |
| Permissions  | `wsReadOnly` (read) or `Default,wsReadWrite` (read + write)                                                | The connector registry currently requests `wsReadOnly`                                                                                                          |

> **Redirect URI rule:** Wrike's `redirect_uri` is _optional on a single-callback app_ but
> _required_ (and must match exactly) once more than one callback is registered. Numa always
> sends it, so register it exactly as the wizard shows. HTTPS only — `https://localhost` is the
> sanctioned local-dev value.

After saving, paste the **Client ID** + **Client Secret** into the Numa admin wizard
(Integrations → Wrike). `oauthSetupSteps` in the registry entry render these instructions
inline.

---

## 2. OAuth Flow

| Property          | Value                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code` (then `refresh_token`)                                                         |
| Authorization URL | `https://login.wrike.com/oauth2/authorize/v4` — **global, all regions**                             |
| Token URL         | `https://login.wrike.com/oauth2/token` — **global, all regions**                                    |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/wrike`                                        |
| Scopes            | `wsReadOnly` (current registry value) — comma-delimited, case-sensitive                             |
| PKCE required?    | No (server-side flow)                                                                               |
| `state`           | Recommended (CSRF) — the Numa wizard sets it                                                        |
| API host          | **Not configured anywhere** — resolved from the token response `host` field (see §2 token response) |

There are **no `extraAuthParams`** for Wrike — no `access_type=offline` / `prompt=consent` style
extras are needed (the registry entry omits `extraAuthParams` accordingly). The refresh token is
issued on the standard authorization-code exchange.

### Authorization request

Numa builds and redirects the user to:

```http
GET https://login.wrike.com/oauth2/authorize/v4?
  response_type=code&
  client_id={client_id}&
  redirect_uri=https%3A%2F%2F{client-name}.numa.arcanum.ai%2Foauth%2Fcallback%2Fwrike&
  scope=wsReadOnly&
  state={random_state}
```

The user signs into Wrike, reviews the scope consent screen, and approves. Wrike redirects back
to our `redirect_uri` with `?code={auth_code}&state={same_state}` — or `?error=...` on denial.
**The authorization code is valid for only 10 minutes** — exchange it promptly.

### Token exchange

Numa backend exchanges the auth code for tokens (form-encoded body):

```http
POST https://login.wrike.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={auth_code}&
redirect_uri=https%3A%2F%2F{client-name}.numa.arcanum.ai%2Foauth%2Fcallback%2Fwrike&
client_id={client_id}&
client_secret={client_secret}
```

### Token response

```json
{
  "access_token": "eyJ0dCI6InAiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJ0dCI6InIiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "host": "www.wrike.com"
}
```

**`host`** is the single most important field. It tells you which Wrike data-centre API host to
call — **save it** alongside the tokens in the user vault, and build every API URL as
`https://{host}/api/v4/...`. For an EU-resident account `host` is e.g. `app-eu.wrike.com`.

> ⚠️ **Do NOT assume `host` is `www.wrike.com`.** Naive hardcoding silently routes EU (and other
> non-US) accounts to the wrong host, where calls fail with `not_authorized` / `resource_not_found`
> that _look_ like token problems but are actually wrong-host problems. Always read `host` from
> this response.

The access token goes into the `Authorization: Bearer {access_token}` header. `token_type` is
`"bearer"` (lowercase) — the API accepts both `Bearer` and `bearer`.

---

## 3. Token Refresh

Before the access token expires (1h), exchange the refresh token for a new pair:

```http
POST https://login.wrike.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={refresh_token}&
client_id={client_id}&
client_secret={client_secret}
```

**Response (a NEW access_token AND a NEW refresh_token):**

```json
{
  "access_token": "eyJ0dCI6InAiLCJhbGciOiJIUzI1NiJ9...NEW",
  "refresh_token": "eyJ0dCI6InIiLCJhbGciOiJIUzI1NiJ9...NEW",
  "token_type": "bearer",
  "expires_in": 3600,
  "host": "www.wrike.com"
}
```

| Property                | Value                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | 1 hour (3600s)                                                                                                             |
| Authorization code TTL  | 10 minutes                                                                                                                 |
| Refresh token lifetime  | No fixed expiry, but **invalidated on every refresh** (rotation)                                                           |
| Refresh token rotation? | **YES** — "the refresh operation returns a new access token and a new refresh token, making the old refresh token invalid" |
| Re-consent required?    | When the app's requested scopes change (e.g. widening `wsReadOnly` → `Default,wsReadWrite`)                                |

> **Rotation implication:** the refresh token is single-use. The backend MUST persist the new
> `refresh_token` from every refresh response (atomically, before the next call). If a refresh
> succeeds but the new token isn't saved — or two requests refresh concurrently with the same old
> token — the connection breaks and the user must reconnect. Serialize refreshes per connection.
> Also re-read `host` from each refresh response and update it if it changed.

---

## 4. Token Revocation

Wrike does **not** expose a public OAuth revocation endpoint. Apps/connections are revoked from
the Wrike admin UI:

- **App level:** delete or disable the app in `https://www.wrike.com/appconsole.htm?#/api`.
- **User level:** the user revokes the connected app from their Wrike account's connected-apps
  settings.

Numa has no visibility into a UI-side revocation — it surfaces as `401 not_authorized` on the
next call (and the refresh also failing). Treat that as "disconnected → re-consent".

---

## 5. Reauthorization Triggers

| Trigger                             | Detection                                                | Action                                                                     |
| ----------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Access token expired                | HTTP 401 `not_authorized` on an API call                 | Backend refreshes via refresh_token; persist the rotated token; retry once |
| Refresh token already rotated/stale | Refresh returns 4xx / `not_authorized`                   | Mark user disconnected; prompt full re-consent                             |
| Concurrent refresh lost the token   | Refresh 4xx after another refresh just succeeded         | Same — reconnect; then serialize refreshes to prevent recurrence           |
| Scopes changed (read → write)       | Writes return 403 `not_allowed` despite a valid token    | Admin widens app scope to `Default,wsReadWrite`; user reconnects           |
| User revoked app in Wrike UI        | 401 on API calls AND refresh fails                       | Disconnect; full re-consent                                                |
| Wrong API host (hardcoded)          | 401 `not_authorized` / 404 that survives a fresh refresh | Verify you're calling `https://{host}/api/v4` using the token's `host`     |

---

## 6. Test connection sequence (vendor-side)

```
1. POST https://login.wrike.com/oauth2/token  (grant=refresh_token)   → 200 + fresh access_token + host
   → persist the NEW refresh_token AND the host immediately
2. GET  https://{host}/api/v4/contacts?me=true                        → 200 + { kind:"contacts", data:[{ me:true, ... }] }
   Header: Authorization: Bearer {access_token}
   → cache data[0].id as <myId> for "my tasks" queries
```

`{host}` comes back as a field in the token/refresh response — use that exact value rather than
computing one yourself. If step 2 returns 401 despite a valid refresh in step 1, the host is
wrong (you're calling the wrong data centre).

### Auto-reconnect logic (recommended)

```
on 401 not_authorized on an API call:
    try refresh_token()                       # serialize per connection
    if refresh returns 200:
        persist NEW refresh_token + host
        retry original call once
    if refresh returns 4xx:
        mark user disconnected — full re-consent required
```

No transient retry loop on 401 — a 4xx from refresh means the refresh token is genuinely dead
(rotated away, or the app/user was revoked). One refresh attempt, then reconnect.

> Numa-internal vault key names / registry wiring details live in the `numa-connectors` skill and
> `03-connector-setup.md` — this file is the vendor-side OAuth runbook only.

---

## 7. Programmatic Token Management

Wrike does NOT expose a "list my tokens" or "create a PAT" API for the v4 surface — OAuth is the
only path, and there is no public revoke endpoint. Everything programmatic happens through the two
endpoints above (`authorize/v4` and `token`). If the user needs different scopes, the only path is:

1. Admin updates the app's permissions in `https://www.wrike.com/appconsole.htm?#/api`
   (and, if widening to write, sets `oauth.scopes` to `Default,wsReadWrite` in the registry).
2. User goes through full re-consent in Numa.

---

_Generated from `00-api-investigation-questionnaire.md` Phase 2 and verified against
[developers.wrike.com/oauth-20-authorization](https://developers.wrike.com/oauth-20-authorization/).
Promote to [CONFIRMED] after a live `GET /api/v4/contacts?me=true` — especially the token-`host`
resolution and the rotating refresh-token flow._
