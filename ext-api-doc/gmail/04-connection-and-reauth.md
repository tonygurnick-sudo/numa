# Gmail — Connection & Reauthorization Guide

> Complete setup for connecting Numa to the Gmail API.
> Auth type: **OAuth 2.0 (Google)** — Authorization Code grant + refresh token. No PAT, no
> machine-to-machine. Detailed enough to automate connector setup and token refresh.
>
> All auth values below match the connector registry entry
> (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'gmail'`) — that
> registry is the source of truth for what Numa actually sends.

---

## Auth Type: OAuth 2.0 (Google)

Every Gmail API call runs under a **user's** OAuth context — the consented mailbox is always
addressed as `users/me`. There is no service-account or client-credentials mode here (Workspace
domain-wide delegation exists but Numa does not use it). One Google Cloud OAuth client can back
Gmail, Google Drive, and Google Calendar (`oauthPlatform: 'google'`); consent is granted per scope.

---

## 1. Create the OAuth Application in Google Cloud Console

These are exactly the steps surfaced to the admin via the registry's `oauthSetupSteps`, expanded.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a
   project (e.g. `numa-gmail-connector`).
2. **Enable the Gmail API:** APIs & Services → **Library** → search "Gmail API" → **Enable**.
3. **Configure the OAuth consent screen:** APIs & Services → **OAuth consent screen**.
   - User type: **External** (or **Internal** if all users are in one Workspace org).
   - Add the scope `https://www.googleapis.com/auth/gmail.readonly` (it is a **restricted** scope).
   - While unverified, add testers under "Test users" (max 100). Production needs verification
     (see the warning below).
4. **Create the OAuth client:** APIs & Services → **Credentials** → **Create Credentials** →
   **OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add the redirect URI shown in Numa's Gmail wizard (see §2 below
     for the format). It must match **exactly** (scheme, host, path — no trailing slash mismatch).
5. **Copy the credentials:**
   - **Client ID** — format `1234567890-abc...apps.googleusercontent.com`
   - **Client Secret** — format `GOCSPX-...` (paste into the wizard immediately; store in the
     company vault)

> **Restricted-scope verification (production blocker).** `gmail.readonly` is a restricted scope.
> An **unverified** app shows an "unverified app" / "Google hasn't verified this app" warning and
> is capped at 100 test users. To remove the warning and the cap, the app must pass **Google's
> OAuth verification**, which for restricted scopes includes an annual third-party **CASA security
> assessment**. Plan for this lead time before any production rollout. This is operational, not a
> code change.

---

## 2. OAuth Flow

| Property          | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Grant type        | `authorization_code`                                             |
| Authorization URL | `https://accounts.google.com/o/oauth2/v2/auth`                   |
| Token URL         | `https://oauth2.googleapis.com/token`                            |
| Revocation URL    | `https://oauth2.googleapis.com/revoke`                           |
| Discovery URL     | `https://accounts.google.com/.well-known/openid-configuration`   |
| Redirect URI      | `<from Numa wizard>` (must be pre-registered in Cloud Console)   |
| Scopes            | `https://www.googleapis.com/auth/gmail.readonly`                 |
| Extra auth params | `access_type=offline`, `prompt=consent` (from `extraAuthParams`) |
| PKCE required?    | No (web-server flow uses the client secret)                      |

### Authorization Request

Numa builds this redirect from the registry `oauth.authUrl` + `scopes` + `extraAuthParams`. The
`access_type=offline` and `prompt=consent` params are what force Google to return a **refresh
token** on every consent — omit them and you get only a 1-hour access token with no refresh.

```http
GET https://accounts.google.com/o/oauth2/v2/auth?
  response_type=code&
  client_id=<CLIENT_ID>&
  redirect_uri=<REDIRECT_URI>&
  scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&
  access_type=offline&
  prompt=consent&
  state=<RANDOM_STATE>
```

> `state` is sent by Numa's OAuth wizard for CSRF protection and is echoed back on the redirect.

### Token Exchange

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=<AUTH_CODE>&
redirect_uri=<REDIRECT_URI>&
client_id=<CLIENT_ID>&
client_secret=<CLIENT_SECRET>
```

### Token Response

```json
{
  "access_token": "ya29.a0Af...",
  "expires_in": 3599,
  "refresh_token": "1//0gF...",
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "token_type": "Bearer"
}
```

> The **`refresh_token` is returned only on the first consent** (and on any consent forced by
> `prompt=consent`). Persist it with the connection — subsequent token responses during refresh
> will **not** include a new refresh token (Google's refresh tokens do not rotate). Use the access
> token as `Authorization: Bearer <access_token>` on every API call.

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

Refresh response (note: **no** `refresh_token` field — reuse the stored one):

```json
{
  "access_token": "ya29.a0Af...new...",
  "expires_in": 3599,
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "token_type": "Bearer"
}
```

| Property                | Value                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | ~3600s (1 hour)                                                                                                                                                |
| Refresh token lifetime  | Long-lived — does not expire on a fixed clock for verified apps                                                                                                |
| Refresh token rotation? | **No** — Google does not return a new refresh token on refresh; keep the original                                                                              |
| Re-consent required?    | When the refresh token is revoked, the user changes their password, the app is unverified and the 7-day testing-mode expiry hits, or the granted scopes change |

> **Testing-mode caveat:** while the OAuth consent screen is in "Testing" (unverified) status,
> Google **expires refresh tokens after 7 days**. Publish/verify the app to get long-lived refresh
> tokens. This catches a lot of "it worked last week, now it 400s" reports during development. 🔬

---

## 4. Token Revocation

```http
POST https://oauth2.googleapis.com/revoke
Content-Type: application/x-www-form-urlencoded

token=<ACCESS_OR_REFRESH_TOKEN>
```

Revoking either token (access or refresh) invalidates the grant; the user must re-consent to
reconnect. A user can also revoke from their Google Account → Security → Third-party access.

---

## 5. Reauthorization Triggers

| Trigger                                | Detection                                                                  | Action                                                 |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| Access token expired                   | 401 `authError` on an API call                                             | Refresh using the refresh token, retry once            |
| Refresh token expired/revoked          | Token endpoint returns `{"error":"invalid_grant"}`                         | Full re-consent flow                                   |
| Scopes changed (e.g. add `gmail.send`) | Admin edits the registry scope; incremental-consent screen on next connect | Full re-consent flow                                   |
| User revoked access                    | 401/403 + refresh fails with `invalid_grant`                               | Full re-consent flow                                   |
| Insufficient scope                     | 403 `insufficientPermissions` (e.g. send under readonly)                   | **Do not retry** — broaden scope + re-consent, or stop |

> Distinguish **401 `authError`** (token stale → refresh) from **403 `insufficientPermissions`**
> (scope missing → re-consent, never retry) from **403 `userRateLimitExceeded`** (quota → back off).
> See `01d` / `02` for the full error matrix.

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type    | Description                                                                 |
| --------------- | ------- | --------------------------------------------------------------------------- |
| `client_id`     | company | Google OAuth client ID (company vault, admin-supplied via wizard)           |
| `client_secret` | company | Google OAuth client secret (company vault, admin-supplied)                  |
| `access_token`  | user    | Per-user access token (~1h); refreshed automatically by `OAuthProvider`     |
| `refresh_token` | user    | Per-user refresh token (long-lived, **non-rotating**; persist the original) |

Token refresh is handled by the `OAuthProvider` base class that `GmailProvider` subclasses — the
provider's data methods just receive a valid `access_token`. There is no per-connection instance
URL or region field (`userId` is always `me`, base URL is the fixed
`https://gmail.googleapis.com/gmail/v1/users/me`).

### Test Connection Sequence (Phase 2 smoke test)

```
1. POST https://oauth2.googleapis.com/token with the auth code
     -> verify access_token AND refresh_token are returned (refresh_token requires
        access_type=offline + prompt=consent)
2. GET https://gmail.googleapis.com/gmail/v1/users/me/labels
     Authorization: Bearer <access_token>
   -> expect 200 and { "labels": [ { "id": "INBOX", ... }, ... ] }
3. (optional) GET .../users/me/messages?maxResults=1
   -> expect 200 with a single { id, threadId } stub
```

> Running steps 2–3 against a real Google account closes the Phase 2 gate flagged in the
> questionnaire (no live call was made at research time). Do it before trusting the connector.

### Auto-Reconnect Logic

```
on 401 (authError) response:
  refresh_token()                         # ~1h access tokens expire often
  retry the original request once
  # do NOT persist a new refresh token — Google does not rotate it

on token endpoint {"error":"invalid_grant"}:
  trigger full re-consent flow            # refresh token revoked/expired (incl. 7-day testing-mode expiry)

on 403 insufficientPermissions:
  stop — required scope not granted (e.g. send under gmail.readonly); broaden scope + re-consent

on 403 userRateLimitExceeded / 429 RESOURCE_EXHAUSTED:
  truncated exponential backoff + jitter (max ~32-64s); Retry-After is unreliable
```

---

## Sources

- Google OAuth (web server flow): https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Token revocation: https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
- Refresh-token expiry / testing mode: https://developers.google.com/identity/protocols/oauth2#expiration
- Registry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id: 'gmail'`)
