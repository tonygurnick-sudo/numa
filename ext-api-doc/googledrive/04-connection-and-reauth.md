---
api_name: Google Drive
api_slug: googledrive
auth_type: OAuth 2.0 (Authorization Code grant, Google web-server flow) — NO PAT, no service-account mode
oauth_platform: google
base_url: https://www.googleapis.com/drive/v3 (fixed — no instance/region/base-URL field to collect)
redirect_uri: https://<client>.numa.arcanum.ai/oauth/callback/google (slug = PLATFORM `google`, NOT `googledrive`; getOAuthSecretId('googledrive')==='google')
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`
note: all values match the registry entry (connectorRegistry.ts, id:'googledrive')
---

# Google Drive — Connection & Reauthorization Guide

Every Drive call runs under a **user's** Google identity with a bearer access token. Numa's OAuth wizard + relay run authorize/token/refresh; the connector never exposes the client secret to the agent or browser at request time.

> **Platform-shared client (important).** Drive and Gmail both set `oauthPlatform:'google'`, so Numa uses **one Google OAuth client per workspace for the whole `google` platform** — the same Client ID/Secret powers both. The vault secret key and the redirect-URI slug are the platform name `google`, not the connector id `googledrive` (`getOAuthSecretId('googledrive')==='google'`). Set up the Google client **once**; enable both the Drive API and the Gmail API on it if you want both connectors.

## 1. Create the OAuth Application in Google

Self-served in the Google Cloud Console; one per client workspace (per Google Cloud project).

1. Open `https://console.cloud.google.com/`, select/create the project that owns the OAuth client.
2. **Enable the Drive API:** APIs & Services → Library → "Google Drive API" → Enable. (Enable the Gmail API too if you also want Gmail on this client.)
3. **Configure the OAuth consent screen:** APIs & Services → OAuth consent screen.
   - User type: **Internal** (Workspace-only, no verification) or **External**.
   - Add scope `https://www.googleapis.com/auth/drive.readonly`.
   - ⚠️ **RESTRICTED scope.** An **External** app serving non-test production users requires **OAuth app verification AND an annual CASA security assessment**; until done you're limited to test users. Onboarding blocker, not a code change. (Internal Workspace apps avoid verification.) 🔬
4. **Create the client:** APIs & Services → Credentials → Create Credentials → OAuth client ID.

   | Field                   | Value                                                    | Notes                                                                |
   | ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
   | Application type        | **Web application**                                      | Per registry `oauthSetupSteps`                                       |
   | Name                    | `Numa Integration`                                       | Any label                                                            |
   | Authorized redirect URI | `https://<client>.numa.arcanum.ai/oauth/callback/google` | **Must match exactly** — `google` (platform slug), NOT `googledrive` |

5. Save and copy:
   - **Client ID** — format `XXXXXXXXXXXX-xxxxxxxx.apps.googleusercontent.com`
   - **Client Secret** — format `GOCSPX-xxxxxxxxxxxxxxxxxxxx` (store → company vault)

> The redirect URI Numa expects shows in the connector's admin wizard as `<frontendBaseUrl>/oauth/callback/<oauthSecretId>`. For Drive `oauthSecretId=google`, so it renders `https://<client>.numa.arcanum.ai/oauth/callback/google`. Copy it from the wizard verbatim into the Console.

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

> **`access_type=offline` + `prompt=consent` are what guarantee a `refresh_token` comes back.** Without `prompt=consent`, Google omits the refresh token on every consent after the first — which is why the registry sets `extraAuthParams:{"access_type":"offline","prompt":"consent"}`. This applies to every consent below.

**Authorization request:**

```http
GET https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=https%3A%2F%2F<client>.numa.arcanum.ai%2Foauth%2Fcallback%2Fgoogle&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly&access_type=offline&prompt=consent&state=<RANDOM_STATE>
```

**Token exchange:**

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<AUTH_CODE>&redirect_uri=https://<client>.numa.arcanum.ai/oauth/callback/google&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>
```

**Token response:** `{"access_token":"ya29.a0Af...","expires_in":3599,"refresh_token":"1//0gFp...","scope":"https://www.googleapis.com/auth/drive.readonly","token_type":"Bearer"}`

> Store `access_token` + `refresh_token` against the **user** (not the company). The `refresh_token` is only present on a consent where `prompt=consent` was sent — persist it immediately; silent refreshes will NOT return a new one.

## 3. Token Refresh

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>
```

Refresh response (**no** `refresh_token` field — the original is reused): `{"access_token":"ya29.a0Af...new...","expires_in":3599,"scope":"https://www.googleapis.com/auth/drive.readonly","token_type":"Bearer"}`

| Property                | Value                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | ~3600s (1h)                                                                                                                                                                      |
| Refresh token lifetime  | Long-lived — no scheduled expiry (see invalidation cases)                                                                                                                        |
| Refresh token rotation? | **No** — Google does not return a new refresh token on refresh; keep the original. Do NOT overwrite the stored refresh token (unlike Actionstep). Only the access token changes. |
| Re-consent required?    | On revoke/invalid, after 6 months non-use, on scope change, or (External "Testing" apps) after **7 days**                                                                        |

**Refresh-token invalidation cases (each forces full re-consent):**

- User revokes Numa's access at `myaccount.google.com/permissions`.
- Token unused for **6 months**.
- OAuth client's consent screen is **External + Testing** — refresh tokens expire after **7 days** (move app to "In production"/verified to lift this).
- Password change on certain account types can invalidate Drive-scoped tokens.

## 4. Token Revocation

```http
POST https://oauth2.googleapis.com/revoke
Content-Type: application/x-www-form-urlencoded

token=<ACCESS_OR_REFRESH_TOKEN>
```

`200` on success. Revoking either token kills the grant. On user disconnect, revoke the user's token and delete the user secret; leave the **company** OAuth client (`oauth-client-google`) intact — shared with Gmail + other workspace users.

## 5. Reauthorization Triggers

| Trigger                       | Detection                                | Action                                                       |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Access token expired          | `401` (`authError`/`invalidCredentials`) | Refresh with refresh token, retry                            |
| Refresh token expired/revoked | Refresh returns `400 invalid_grant`      | Full re-consent flow                                         |
| User revoked access           | `401`/`403` + refresh `invalid_grant`    | Full re-consent flow                                         |
| Scope changed                 | Admin/registry scope edit                | Full re-consent flow                                         |
| Insufficient permission       | `403 insufficientPermissions`            | Re-consent with needed scope; or file isn't shared with user |

## Numa Connector Wiring

**Credentials to store:**
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | company | Google OAuth Client ID — under the **`google` platform** key (shared with Gmail) |
| `client_secret` | company | Google OAuth Client Secret (company vault, `oauth-client-google`) |
| `access_token` | user | Per-user access token (~1h) |
| `refresh_token` | user | Per-user refresh token (long-lived, **non-rotating**) |

> No instance/region/base-URL field for Drive — base URL fixed at `https://www.googleapis.com/drive/v3` (contrast Synergy/Actionstep, which need an instance URL).

**Test connection sequence (Phase 2 smoke test):**

```
1. POST https://oauth2.googleapis.com/token with the auth code
     -> verify access_token AND refresh_token returned (refresh_token requires prompt=consent)
2. GET https://www.googleapis.com/drive/v3/about?fields=user,storageQuota   (Authorization: Bearer <access_token>)
     -> expect 200 with authenticated user's identity + quota (minimal, read-only)
3. GET https://www.googleapis.com/drive/v3/files?q='root' in parents and trashed=false&pageSize=5&fields=files(id,name,mimeType)   (Authorization: Bearer <access_token>)
     -> expect 200 and a drive#fileList body
```

> Running steps 1–3 against a real Google account closes the **Phase 2 live-call gate** (no live consent captured at research time). Do it before trusting the connector in production. 🔬

**Auto-reconnect logic:**

```
on 401 response:
  try refresh_token()                 # 1h access tokens expire often
  # Google does NOT rotate the refresh token — keep the original; only the access token changes
  if refresh fails (400 invalid_grant — token revoked/expired/6-months-idle/7-day-testing):
    trigger full re-consent flow (user reconnects via OAuth with prompt=consent)
on 403 response:
  if reason in (userRateLimitExceeded, rateLimitExceeded): exponential backoff + jitter, retry  # Retry-After not reliably sent
  elif reason == insufficientPermissions: re-consent with required scope, or file not shared with user
  elif reason == fileNotDownloadable: use GET /files/{id}/export instead of ?alt=media
on 429 response: exponential backoff + jitter, retry
```

## Sources

- OAuth 2.0 web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Scopes / restricted-scope verification: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Token revocation: https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
- Registry entry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id:'googledrive'`)
- Redirect-URI shape: `numa-frontend/src/Components/DataConnectors/wizards/OAuthWizard.tsx` (`${frontendBaseUrl}/oauth/callback/${oauthSecretId}`) + `connectorRegistry.ts:getOAuthSecretId`
