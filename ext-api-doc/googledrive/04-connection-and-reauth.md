# Google Drive — Connection & Reauthorization Guide

> Complete setup for connecting Numa to Google Drive.
> Auth type: **OAuth 2.0** (Authorization Code grant — Google web-server flow). No PAT, no
> service-account mode in this connector.
> Detailed enough to automate connector setup and token refresh.
> All values match the registry entry (`connectorRegistry.ts`, `id: 'googledrive'`).

---

## Auth Type: OAuth 2.0

Every Drive call runs under a **user's** Google identity, carrying a bearer access token. Numa's
OAuth wizard + relay run the authorize / token / refresh dance; the connector never exposes the
client secret to the agent or the browser at request time.

> **Platform-shared client (important).** Drive and Gmail both set `oauthPlatform: 'google'`.
> Numa therefore uses **one Google OAuth client per workspace for the whole `google` platform** —
> the same Client ID/Secret powers both Drive and Gmail. The vault secret key and the redirect-URI
> slug are the **platform** name `google`, not the connector id `googledrive`
> (`getOAuthSecretId('googledrive') === 'google'`). Set up the Google client **once**; enable both
> the Drive API and the Gmail API on it if you want both connectors.

---

## 1. Create the OAuth Application in Google

Google OAuth clients are **self-served** in the Google Cloud Console. Create one per client
workspace (per Google Cloud project).

1. Open the **Google Cloud Console** at `https://console.cloud.google.com/` and select (or create)
   the project that will own the OAuth client.
2. **Enable the Drive API:** APIs & Services → **Library** → search "Google Drive API" → **Enable**.
   (If you also want Gmail on this client, enable the Gmail API here too.)
3. **Configure the OAuth consent screen:** APIs & Services → **OAuth consent screen**.
   - User type: **Internal** (Workspace-only, no verification needed) or **External**.
   - Add the scope `https://www.googleapis.com/auth/drive.readonly`.
   - ⚠️ This is a **RESTRICTED** scope. For an **External** app serving non-test users in
     production, Google requires **OAuth app verification AND an annual CASA security assessment**.
     Until that completes you are limited to test users. Plan for this — it is an onboarding
     blocker, not a code change. (Internal Workspace apps avoid verification.)
4. **Create the client:** APIs & Services → **Credentials** → **Create Credentials** →
   **OAuth client ID**.

   | Field                   | Value                                                    | Notes                                                                        |
   | ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
   | Application type        | **Web application**                                      | Per the registry `oauthSetupSteps`                                           |
   | Name                    | `Numa Integration`                                       | Any label                                                                    |
   | Authorized redirect URI | `https://<client>.numa.arcanum.ai/oauth/callback/google` | **Must match exactly** — note `google`, the platform slug, not `googledrive` |

5. Save and copy:
   - **Client ID** — format `XXXXXXXXXXXX-xxxxxxxx.apps.googleusercontent.com`
   - **Client Secret** — format `GOCSPX-xxxxxxxxxxxxxxxxxxxx` (store securely → company vault)

> The redirect URI Numa expects is shown in the connector's admin wizard as
> `<frontendBaseUrl>/oauth/callback/<oauthSecretId>`. For Drive, `oauthSecretId` is `google`, so it
> renders `https://<client>.numa.arcanum.ai/oauth/callback/google`. Copy it from the wizard
> verbatim into the Google Cloud Console.

---

## 2. OAuth Flow

| Property          | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Grant type        | `authorization_code`                                               |
| Authorization URL | `https://accounts.google.com/o/oauth2/v2/auth`                     |
| Token URL         | `https://oauth2.googleapis.com/token`                              |
| Revocation URL    | `https://oauth2.googleapis.com/revoke`                             |
| Discovery URL     | `https://accounts.google.com/.well-known/openid-configuration`     |
| Redirect URI      | `https://<client>.numa.arcanum.ai/oauth/callback/google`           |
| Scopes            | `https://www.googleapis.com/auth/drive.readonly`                   |
| Extra auth params | `access_type=offline`, `prompt=consent` (from `extraAuthParams`)   |
| PKCE required?    | No (Google supports it; not required for confidential web clients) |

### Authorization Request

```http
GET https://accounts.google.com/o/oauth2/v2/auth?
  response_type=code&
  client_id=<CLIENT_ID>&
  redirect_uri=https%3A%2F%2F<client>.numa.arcanum.ai%2Foauth%2Fcallback%2Fgoogle&
  scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly&
  access_type=offline&
  prompt=consent&
  state=<RANDOM_STATE>
```

> `access_type=offline` + `prompt=consent` are what guarantee a **`refresh_token`** comes back.
> Without `prompt=consent`, Google omits the refresh token on every consent after the first — which
> is exactly why the registry sets `extraAuthParams: {"access_type":"offline","prompt":"consent"}`.

### Token Exchange

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=<AUTH_CODE>&
redirect_uri=https://<client>.numa.arcanum.ai/oauth/callback/google&
client_id=<CLIENT_ID>&
client_secret=<CLIENT_SECRET>
```

### Token Response

```json
{
  "access_token": "ya29.a0Af...",
  "expires_in": 3599,
  "refresh_token": "1//0gFp...",
  "scope": "https://www.googleapis.com/auth/drive.readonly",
  "token_type": "Bearer"
}
```

> Store `access_token` and `refresh_token` against the **user** (not the company). The
> `refresh_token` is only present on a consent where `prompt=consent` was sent — persist it
> immediately; subsequent silent refreshes will **not** return a new one.

---

## 3. Token Refresh

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=<REFRESH_TOKEN>&
client_id=<CLIENT_ID>&
client_secret=<CLIENT_SECRET>
```

Refresh response (note: **no** `refresh_token` field — the original is reused):

```json
{
  "access_token": "ya29.a0Af...new...",
  "expires_in": 3599,
  "scope": "https://www.googleapis.com/auth/drive.readonly",
  "token_type": "Bearer"
}
```

| Property                | Value                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Access token lifetime   | ~3600s (1 hour)                                                                                                                      |
| Refresh token lifetime  | Long-lived — does not expire on a schedule (see re-consent triggers below)                                                           |
| Refresh token rotation? | **No** — Google does **not** return a new refresh token on refresh; keep using the original                                          |
| Re-consent required?    | When the refresh token is revoked/invalid, after 6 months of non-use, on scope change, or (External "Testing" apps) after **7 days** |

> Unlike Actionstep (rotating refresh tokens), Google's refresh token is stable — do **not**
> overwrite the stored refresh token from a refresh response (there isn't one). Only the
> access token changes.

**Refresh-token invalidation cases to be aware of** (each forces a full re-consent):

- The user revokes Numa's access at `myaccount.google.com/permissions`.
- The token is unused for **6 months**.
- The OAuth client's consent screen is in **External + Testing** status — refresh tokens expire
  after **7 days** (move the app to "In production" / verified to lift this).
- Password change on certain account types can invalidate Drive-scoped tokens.

---

## 4. Token Revocation

```http
POST https://oauth2.googleapis.com/revoke
Content-Type: application/x-www-form-urlencoded

token=<ACCESS_OR_REFRESH_TOKEN>
```

`200` on success. Revoking either token kills the grant — on a user disconnect, revoke the user's
token and delete the user secret. Leave the **company** OAuth client (`oauth-client-google`)
intact — it is shared with Gmail and the other users in the workspace.

---

## 5. Reauthorization Triggers

When to prompt the user to reauthorize:

| Trigger                       | Detection                                  | Action                                                                   |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| Access token expired          | `401` (`authError` / `invalidCredentials`) | Refresh with the refresh token, retry                                    |
| Refresh token expired/revoked | Refresh returns `400 invalid_grant`        | Full re-consent flow                                                     |
| User revoked access           | `401`/`403` + refresh `invalid_grant`      | Full re-consent flow                                                     |
| Scope changed                 | Admin/registry scope edit                  | Full re-consent flow                                                     |
| Insufficient permission       | `403 insufficientPermissions`              | Re-consent with the needed scope; or the file isn't shared with the user |

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type    | Description                                                                             |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| `client_id`     | company | Google OAuth Client ID — stored under the **`google` platform** key (shared with Gmail) |
| `client_secret` | company | Google OAuth Client Secret (company vault, `oauth-client-google`)                       |
| `access_token`  | user    | Per-user access token (~1h)                                                             |
| `refresh_token` | user    | Per-user refresh token (long-lived, **non-rotating**)                                   |

> There is **no** instance/region/base-URL field for Drive — the base URL is fixed at
> `https://www.googleapis.com/drive/v3`. (Contrast Synergy/Actionstep, which need an instance URL.)

### Test Connection Sequence (Phase 2 smoke test)

```
1. POST https://oauth2.googleapis.com/token with the auth code
     -> verify access_token AND refresh_token returned (refresh_token requires prompt=consent)
2. GET https://www.googleapis.com/drive/v3/about?fields=user,storageQuota
     Authorization: Bearer <access_token>
   -> expect 200 with the authenticated user's identity + quota (minimal, read-only)
3. GET https://www.googleapis.com/drive/v3/files?q='root'%20in%20parents%20and%20trashed%3Dfalse&pageSize=5&fields=files(id,name,mimeType)
     Authorization: Bearer <access_token>
   -> expect 200 and a drive#fileList body
```

> Running steps 1–3 against a real Google account is what closes the **Phase 2 live-call gate**
> flagged in the questionnaire (no live consent was captured at research time). Do it before
> trusting the connector in production.

### Auto-Reconnect Logic

```
on 401 response:
  try refresh_token()                 # 1h access tokens expire often
  # Google does NOT rotate the refresh token — keep the original; only the access token changes
  if refresh fails (400 invalid_grant — token revoked/expired/6-months-idle/7-day-testing):
    trigger full re-consent flow (user reconnects via OAuth with prompt=consent)
on 403 response:
  if reason in (userRateLimitExceeded, rateLimitExceeded):
    exponential backoff + jitter, retry          # Retry-After not reliably sent
  elif reason == insufficientPermissions:
    re-consent with the required scope, or the file is not shared with the user
  elif reason == fileNotDownloadable:
    use GET /files/{id}/export instead of ?alt=media
on 429 response:
  exponential backoff + jitter, retry
```

---

## Sources

- OAuth 2.0 web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Scopes / restricted-scope verification: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Token revocation: https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
- Registry entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'googledrive'`)
- Redirect-URI shape: `numa-frontend/src/Components/DataConnectors/wizards/OAuthWizard.tsx`
  (`${frontendBaseUrl}/oauth/callback/${oauthSecretId}`) + `connectorRegistry.ts:getOAuthSecretId`
