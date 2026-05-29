# Dropbox — Connection & Reauthorization Guide

> Complete setup for connecting Numa to Dropbox.
> Auth type: **OAuth 2.0** (Authorization Code grant, offline refresh tokens). No PAT path.
> Detailed enough to automate connector setup and token refresh.

---

## Auth Type: OAuth 2.0

Every Dropbox API call runs under a **user's** OAuth context (`Authorization: Bearer <access_token>`).
The connector requests **offline** access (`token_access_type=offline`) so Dropbox issues a
long-lived refresh token alongside the short-lived (~4h) access token — without that parameter the
connection dies after the first access token expires.

The registry config that drives all of this (source of truth —
`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, id `dropbox`):

```jsonc
{
  "authType": "oauth2",
  "authUrl": "https://www.dropbox.com/oauth2/authorize",
  "tokenUrl": "https://api.dropboxapi.com/oauth2/token",
  "scopes": "files.metadata.read files.content.read",
  "extraAuthParams": { "token_access_type": "offline" },
}
```

---

## 1. Create the OAuth Application in Dropbox

API credentials are **self-served** by the admin from the Dropbox App Console (no email/approval
needed for basic scopes). These are the `oauthSetupSteps` shown in the Numa admin wizard:

1. Log in at `https://www.dropbox.com/developers/apps` and click **Create app**.
2. Choose **Scoped access** as the API.
3. Choose **Full Dropbox** as the access type (so the connector can browse the whole account, not
   just an app-scoped folder).
4. Name the app (e.g. `Numa Integration`) and create it.
5. On the app's **Permissions** tab, enable the two read scopes and **Submit**:
   | Scope | Why |
   |-----------------------|------------------------------------------|
   | `files.metadata.read` | list folders, read metadata, search |
   | `files.content.read` | download file content |
   > Enable scopes **before** the first user authorizes — Dropbox bakes granted scopes into the
   > issued token, so adding scopes later forces a re-consent.
6. On the **Settings** tab, under **OAuth 2 → Redirect URIs**, add the redirect URI shown in the
   Numa wizard (see below), then **Add**.
7. From **Settings**, copy:
   - **App key** = OAuth **Client ID** (public, ~15-char string)
   - **App secret** = OAuth **Client Secret** (click _Show_; store in the company vault)

> **Dev mode vs production:** a new app starts in **Development** and only works for the developer's
> own account until you click **Enable additional users** / apply for production. For dev-stack
> testing this is fine — connect with the same Dropbox account that owns the app.

### Redirect URI

Numa generates the redirect URI per connector connection as:

```
https://<client-name>.numa.arcanum.ai/oauth/callback/<oauthSecretId>
```

The exact value is shown in the admin OAuth wizard (built as
`${frontendBaseUrl}/oauth/callback/${oauthSecretId}` in `wizards/OAuthWizard.tsx`). **Copy it
verbatim** into the Dropbox app's Redirect URIs — Dropbox requires an exact match, no wildcards.

---

## 2. OAuth Flow

| Property          | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Grant type        | `authorization_code`                                               |
| Authorization URL | `https://www.dropbox.com/oauth2/authorize`                         |
| Token URL         | `https://api.dropboxapi.com/oauth2/token`                          |
| Redirect URI      | `<from Numa wizard>` (`/oauth/callback/<id>`)                      |
| Scopes            | `files.metadata.read files.content.read` (space-separated)         |
| Extra params      | `token_access_type=offline` (issues a refresh token)               |
| PKCE required?    | No (confidential client with secret); supported for public clients |

### Authorization Request

```http
GET https://www.dropbox.com/oauth2/authorize?
  response_type=code&
  client_id=<APP_KEY>&
  redirect_uri=<REDIRECT_URI>&
  scope=files.metadata.read%20files.content.read&
  token_access_type=offline&
  state=<RANDOM_STATE>
```

> `token_access_type=offline` is the critical parameter — it is what makes Dropbox return a
> refresh token. The connector supplies it from `extraAuthParams`.

### Token Exchange

```http
POST https://api.dropboxapi.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=<AUTH_CODE>&
redirect_uri=<REDIRECT_URI>&
client_id=<APP_KEY>&
client_secret=<APP_SECRET>
```

> Client credentials may alternatively be sent as HTTP Basic auth
> (`Authorization: Basic base64(app_key:app_secret)`); both forms are accepted.

### Token Response

```json
{
  "access_token": "sl.B1a2c3...",
  "token_type": "bearer",
  "expires_in": 14400,
  "refresh_token": "abc123...long-lived...",
  "scope": "files.content.read files.metadata.read",
  "uid": "1234567",
  "account_id": "dbid:AAH4f99T0taNz..."
}
```

> Store **`refresh_token`** (long-lived) and **`access_token`** (~4h). 🔬 Confirm `expires_in` ≈
> 14400 on a live exchange. `account_id` / `uid` identify the connected account.

---

## 3. Token Refresh

```http
POST https://api.dropboxapi.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=<REFRESH_TOKEN>&
client_id=<APP_KEY>&
client_secret=<APP_SECRET>
```

Refresh response (note: **no** new refresh token is returned):

```json
{ "access_token": "sl.B9x8y7...", "token_type": "bearer", "expires_in": 14400 }
```

| Property                | Value                                                           |
| ----------------------- | --------------------------------------------------------------- |
| Access token lifetime   | ~4 hours (`expires_in` ≈ 14400s) 🔬                             |
| Refresh token lifetime  | Long-lived — does not expire on a fixed clock                   |
| Refresh token rotation? | **No** — the same refresh token is reused; keep it stored as-is |
| Re-consent required?    | Only if the user/admin revokes access, or the scopes change     |

> Unlike Actionstep, the Dropbox refresh token does **not** rotate — there is no new refresh token
> in the refresh response, so do not overwrite the stored one.

---

## 4. Token Revocation

```http
POST https://api.dropboxapi.com/2/auth/token/revoke
Authorization: Bearer <ACCESS_TOKEN>
```

Revokes the current token (and the connection). Use on user disconnect to clean up Dropbox's side.
A `200` with empty body indicates success.

---

## 5. Reauthorization Triggers

| Trigger              | Detection                                     | Action                                                         |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| Access token expired | `401` response                                | Refresh with refresh token, retry once                         |
| Refresh fails        | Refresh returns `400`/`401` (`invalid_grant`) | Full re-consent flow                                           |
| Scopes changed       | Admin edits scopes in registry                | Full re-consent flow (granted scopes are baked into the token) |
| User revoked access  | `401`/`403` + refresh fails                   | Full re-consent flow                                           |

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type    | Description                                                    |
| --------------- | ------- | -------------------------------------------------------------- |
| `client_id`     | company | Dropbox **App key** (company vault, admin-supplied)            |
| `client_secret` | company | Dropbox **App secret** (company vault)                         |
| `access_token`  | user    | Per-user access token (~4h)                                    |
| `refresh_token` | user    | Per-user refresh token (long-lived, **non-rotating**)          |
| `account_id`    | conn    | Connected Dropbox account id (`dbid:...`, from token response) |

### Test Connection Sequence (Phase 2 smoke test)

```
1. POST https://api.dropboxapi.com/oauth2/token with the auth code
     -> verify access_token + refresh_token returned (refresh_token requires token_access_type=offline)
2. POST https://api.dropboxapi.com/2/files/list_folder
     Authorization: Bearer <access_token>
     Content-Type: application/json
     { "path": "", "recursive": false, "limit": 10 }
   -> expect 200 and a body: { "entries": [...], "cursor": "...", "has_more": false }
```

> Running step 2 against a live account is what closes the Phase 2 gate flagged in the questionnaire
> — do it before trusting the connector in production. **Send `path: ""` for the root, never `"/"`.**

### Auto-Reconnect Logic

```
on 401 response:
  try refresh_token()                 # ~4h access tokens expire often
  keep the SAME refresh_token         # Dropbox does NOT rotate it
  retry the original request once
  if refresh fails (invalid_grant — refresh token revoked/expired or scopes changed):
    trigger full re-consent flow (user reconnects via OAuth, token_access_type=offline)

on 409 response:
  inspect error.tag / error_summary prefix (NOT the status code)
    path/not_found      -> stale path (rename/move) — re-list the parent
    unsupported_file    -> Dropbox Paper / cloud doc — skip or use /2/files/export
    path/restricted_content -> policy block — skip

on 429 response:
  honor Retry-After header, then exponential backoff + jitter
```

---

## Sources

- OAuth guide: https://developers.dropbox.com/oauth-guide
- HTTP reference: https://www.dropbox.com/developers/documentation/http/documentation
- App Console: https://www.dropbox.com/developers/apps
- Error handling: https://developers.dropbox.com/error-handling-guide
