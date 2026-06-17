---
api_name: Dropbox
auth_type: OAuth 2.0 (Authorization Code grant, offline refresh tokens). No PAT path.
registry_source: numa-frontend/src/Components/DataConnectors/connectorRegistry.ts (id dropbox)
---

# Dropbox — Connection & Reauthorization

Every Dropbox call runs under a **user's** OAuth context (`Authorization: Bearer <access_token>`). The connector requests **offline** access (`token_access_type=offline`) so Dropbox issues a long-lived refresh token alongside the short-lived (~4h) access token — without that param the connection dies after the first access token expires.

Registry config driving all of this (id `dropbox`):

```jsonc
{
  "authType": "oauth2",
  "authUrl": "https://www.dropbox.com/oauth2/authorize",
  "tokenUrl": "https://api.dropboxapi.com/oauth2/token",
  "scopes": "files.metadata.read files.content.read",
  "extraAuthParams": { "token_access_type": "offline" },
}
```

## 1. Create the OAuth Application in Dropbox

API credentials are **self-served** by the admin from the Dropbox App Console (no email/approval for basic scopes). These are the `oauthSetupSteps` shown in the Numa admin wizard:

1. Log in at `https://www.dropbox.com/developers/apps` → **Create app**.
2. API: **Scoped access**.
3. Access type: **Full Dropbox** (so the connector can browse the whole account, not just an app-scoped folder).
4. Name the app (e.g. `Numa Integration`), create.
5. **Permissions** tab: enable the two read scopes and **Submit** — `files.metadata.read` (list folders, read metadata, search) + `files.content.read` (download file content). Enable scopes **before** the first user authorizes — Dropbox bakes granted scopes into the issued token, so adding scopes later forces a re-consent.
6. **Settings → OAuth 2 → Redirect URIs:** add the redirect URI shown in the Numa wizard (below), **Add**.
7. From **Settings**, copy: **App key** = OAuth **Client ID** (public, ~15-char string); **App secret** = OAuth **Client Secret** (click _Show_; store in company vault).

**Dev mode vs production:** a new app starts in **Development** and only works for the developer's own account until you click **Enable additional users** / apply for production. Fine for dev-stack testing — connect with the same account that owns the app.

### Redirect URI

Numa generates it per connector connection: `https://<client-name>.numa.arcanum.ai/oauth/callback/<oauthSecretId>` (built as `${frontendBaseUrl}/oauth/callback/${oauthSecretId}` in `wizards/OAuthWizard.tsx`). Exact value is shown in the admin wizard. **Copy it verbatim** into the Dropbox app's Redirect URIs — Dropbox requires an exact match, no wildcards.

## 2. OAuth Flow

| Property          | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Grant type        | `authorization_code`                                               |
| Authorization URL | `https://www.dropbox.com/oauth2/authorize`                         |
| Token URL         | `https://api.dropboxapi.com/oauth2/token`                          |
| Redirect URI      | `<from Numa wizard>` (`/oauth/callback/<id>`)                      |
| Scopes            | `files.metadata.read files.content.read` (space-separated)         |
| Extra params      | `token_access_type=offline` (issues a refresh token)               |
| PKCE              | No (confidential client with secret); supported for public clients |

**Authorization request:**
`GET https://www.dropbox.com/oauth2/authorize?response_type=code&client_id=<APP_KEY>&redirect_uri=<REDIRECT_URI>&scope=files.metadata.read%20files.content.read&token_access_type=offline&state=<RANDOM_STATE>`
`token_access_type=offline` is the critical param — what makes Dropbox return a refresh token (connector supplies it from `extraAuthParams`).

**Token exchange:**

```http
POST https://api.dropboxapi.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<AUTH_CODE>&redirect_uri=<REDIRECT_URI>&client_id=<APP_KEY>&client_secret=<APP_SECRET>
```

Client credentials may alternatively be sent as HTTP Basic auth (`Authorization: Basic base64(app_key:app_secret)`); both forms accepted.

**Token response:**
`{"access_token":"sl.B1a2c3...","token_type":"bearer","expires_in":14400,"refresh_token":"abc123...long-lived...","scope":"files.content.read files.metadata.read","uid":"1234567","account_id":"dbid:AAH4f99T0taNz..."}`
Store **`refresh_token`** (long-lived) and **`access_token`** (~4h). 🔬 confirm `expires_in`≈14400 on a live exchange. `account_id`/`uid` identify the connected account.

## 3. Token Refresh

```http
POST https://api.dropboxapi.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>&client_id=<APP_KEY>&client_secret=<APP_SECRET>
```

Response (**no** new refresh token): `{"access_token":"sl.B9x8y7...","token_type":"bearer","expires_in":14400}`

| Property                | Value                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| Access token lifetime   | ~4h (`expires_in`≈14400s) 🔬                                                |
| Refresh token lifetime  | long-lived — no fixed-clock expiry                                          |
| Refresh token rotation? | **No** — same refresh token reused; keep it stored as-is (do NOT overwrite) |
| Re-consent required?    | only if user/admin revokes access, or scopes change                         |

Unlike Actionstep, the Dropbox refresh token does NOT rotate — no new refresh token in the refresh response.

## 4. Token Revocation

```http
POST https://api.dropboxapi.com/2/auth/token/revoke
Authorization: Bearer <ACCESS_TOKEN>
```

Revokes the current token (and the connection). Use on user disconnect to clean up Dropbox's side. `200` + empty body = success.

## 5. Reauthorization Triggers

| Trigger              | Detection                                     | Action                                                |
| -------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Access token expired | `401`                                         | refresh with refresh token, retry once                |
| Refresh fails        | refresh returns `400`/`401` (`invalid_grant`) | full re-consent flow                                  |
| Scopes changed       | admin edits scopes in registry                | full re-consent (granted scopes baked into the token) |
| User revoked access  | `401`/`403` + refresh fails                   | full re-consent flow                                  |

## Numa Connector Wiring

**Credentials to store:**
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | company | Dropbox **App key** (company vault, admin-supplied) |
| `client_secret` | company | Dropbox **App secret** (company vault) |
| `access_token` | user | per-user access token (~4h) |
| `refresh_token` | user | per-user refresh token (long-lived, **non-rotating**) |
| `account_id` | conn | connected Dropbox account id (`dbid:...`, from token response) |

**Test connection sequence (Phase 2 smoke test):**

```
1. POST https://api.dropboxapi.com/oauth2/token with the auth code
     → verify access_token + refresh_token returned (refresh_token requires token_access_type=offline)
2. POST https://api.dropboxapi.com/2/files/list_folder
     Authorization: Bearer <access_token>
     Content-Type: application/json
     { "path": "", "recursive": false, "limit": 10 }
   → expect 200 + body { "entries":[...], "cursor":"...", "has_more":false }
```

Running step 2 against a live account closes the Phase 2 gate flagged in the questionnaire — do it before trusting the connector in production. **Send `path:""` for root, never `"/"`.**

**Auto-reconnect logic:**

```
on 401:  try refresh_token()                 # ~4h access tokens expire often
         keep the SAME refresh_token         # Dropbox does NOT rotate it
         retry the original request once
         if refresh fails (invalid_grant — refresh token revoked/expired or scopes changed):
           trigger full re-consent flow (user reconnects via OAuth, token_access_type=offline)
on 409:  inspect error.tag / error_summary prefix (NOT the status code)
           path/not_found          → stale path (rename/move) — re-list the parent
           unsupported_file        → Dropbox Paper / cloud doc — skip or use /2/files/export
           path/restricted_content → policy block — skip
on 429:  honor Retry-After header, then exponential backoff + jitter
```

## Sources

- OAuth guide: https://developers.dropbox.com/oauth-guide
- HTTP reference: https://www.dropbox.com/developers/documentation/http/documentation
- App Console: https://www.dropbox.com/developers/apps
- Error handling: https://developers.dropbox.com/error-handling-guide
