---
api_name: Gmail API
connector_id: gmail
auth: OAuth 2.0 (Google) — Authorization Code grant + refresh token; no PAT, no machine-to-machine
oauth_platform: google
base_url: https://gmail.googleapis.com/gmail/v1/users/me (version /gmail/v1 already in base; userId always me)
registry_scope: https://www.googleapis.com/auth/gmail.readonly
source_of_truth: connectorRegistry.ts (id:'gmail') — values below match it
confidence: [DOCUMENTED]. 🔬 = needs live smoke test.
---

# Gmail — Connection & Reauthorization Guide

Complete setup for connecting Numa to the Gmail API. Every call runs under a **user's** OAuth context — the consented mailbox is always `users/me`. No service-account or client-credentials mode (Workspace domain-wide delegation exists but Numa does not use it). One Google Cloud OAuth client can back Gmail, Drive, and Calendar (`oauthPlatform:'google'`); consent is per-scope.

## 1. Create the OAuth Application in Google Cloud Console

The admin's `oauthSetupSteps`, expanded:

1. Open [Google Cloud Console](https://console.cloud.google.com/), select/create a project (e.g. `numa-gmail-connector`).
2. **Enable the Gmail API:** APIs & Services → **Library** → search "Gmail API" → **Enable**.
3. **Configure the OAuth consent screen:** APIs & Services → **OAuth consent screen**. User type **External** (or **Internal** if all users are in one Workspace org). Add scope `https://www.googleapis.com/auth/gmail.readonly` (a **restricted** scope). While unverified, add testers under "Test users" (max 100).
4. **Create the OAuth client:** APIs & Services → **Credentials** → **Create Credentials** → **OAuth client ID**. Application type **Web application**. **Authorized redirect URIs:** add the redirect URI shown in Numa's Gmail wizard (§2). Must match **exactly** (scheme, host, path — no trailing-slash mismatch).
5. **Copy credentials:** Client ID (`1234567890-abc...apps.googleusercontent.com`) and Client Secret (`GOCSPX-...`) — paste into the wizard immediately; store in the company vault.

> **Restricted-scope verification (production blocker).** `gmail.readonly` is restricted. An unverified app shows a "Google hasn't verified this app" warning and is capped at 100 test users. To remove the warning and cap, pass **Google's OAuth verification**, which for restricted scopes includes an annual third-party **CASA security assessment**. Plan for this lead time before production. Operational, not a code change.

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

**Authorization request** — Numa builds it from registry `oauth.authUrl` + `scopes` + `extraAuthParams`. `access_type=offline` + `prompt=consent` force Google to return a **refresh token** on every consent — omit them and you get only a 1h access token, no refresh:

```http
GET https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=<REDIRECT_URI>&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&access_type=offline&prompt=consent&state=<RANDOM_STATE>
```

`state` is sent by Numa's OAuth wizard for CSRF protection and echoed back on the redirect.

**Token exchange:**

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<AUTH_CODE>&redirect_uri=<REDIRECT_URI>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>
```

**Token response:** `{"access_token":"ya29.a0Af...","expires_in":3599,"refresh_token":"1//0gF...","scope":"https://www.googleapis.com/auth/gmail.readonly","token_type":"Bearer"}`

> The **`refresh_token` is returned only on the first consent** (and any consent forced by `prompt=consent`). Persist it with the connection — subsequent refresh responses will **not** include a new refresh token (Google's refresh tokens do not rotate). Use the access token as `Authorization: Bearer <access_token>` on every API call.

## 3. Token Refresh

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>
```

Refresh response (**no** `refresh_token` field — reuse the stored one): `{"access_token":"ya29.a0Af...new...","expires_in":3599,"scope":"https://www.googleapis.com/auth/gmail.readonly","token_type":"Bearer"}`

| Property                | Value                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | ~3600s (1 hour)                                                                                                                                          |
| Refresh token lifetime  | long-lived — no fixed-clock expiry for verified apps                                                                                                     |
| Refresh token rotation? | **No** — Google does not return a new refresh token on refresh; keep the original                                                                        |
| Re-consent required?    | when the refresh token is revoked, the user changes password, the app is unverified and the 7-day testing-mode expiry hits, or the granted scopes change |

> **Testing-mode caveat:** while the OAuth consent screen is in "Testing" (unverified), Google **expires refresh tokens after 7 days**. Publish/verify the app for long-lived refresh tokens. This causes many "it worked last week, now it 400s" reports during development. 🔬

## 4. Token Revocation

```http
POST https://oauth2.googleapis.com/revoke
Content-Type: application/x-www-form-urlencoded

token=<ACCESS_OR_REFRESH_TOKEN>
```

Revoking either token invalidates the grant; the user must re-consent. A user can also revoke from Google Account → Security → Third-party access.

## 5. Reauthorization Triggers

| Trigger                                | Detection                                                              | Action                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Access token expired                   | 401 `authError` on an API call                                         | refresh using the refresh token, retry once            |
| Refresh token expired/revoked          | token endpoint returns `{"error":"invalid_grant"}`                     | full re-consent flow                                   |
| Scopes changed (e.g. add `gmail.send`) | admin edits registry scope; incremental-consent screen on next connect | full re-consent flow                                   |
| User revoked access                    | 401/403 + refresh fails with `invalid_grant`                           | full re-consent flow                                   |
| Insufficient scope                     | 403 `insufficientPermissions` (e.g. send under readonly)               | **do not retry** — broaden scope + re-consent, or stop |

> Distinguish **401 `authError`** (token stale → refresh) from **403 `insufficientPermissions`** (scope missing → re-consent, never retry) from **403 `userRateLimitExceeded`** (quota → back off). See `01d`/`02` for the full error matrix.

## Numa Connector Wiring

**Credentials to store:**
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | company | Google OAuth client ID (company vault, admin-supplied via wizard) |
| `client_secret` | company | Google OAuth client secret (company vault, admin-supplied) |
| `access_token` | user | per-user access token (~1h); refreshed automatically by `OAuthProvider` |
| `refresh_token` | user | per-user refresh token (long-lived, **non-rotating**; persist the original) |

Token refresh is handled by the `OAuthProvider` base class that `GmailProvider` subclasses — the provider's data methods just receive a valid `access_token`. No per-connection instance URL or region field (`userId` always `me`, base URL fixed at `https://gmail.googleapis.com/gmail/v1/users/me`).

**Test connection sequence (Phase 2 smoke test):**

```
1. POST https://oauth2.googleapis.com/token with the auth code
     -> verify access_token AND refresh_token returned (refresh_token needs access_type=offline + prompt=consent)
2. GET https://gmail.googleapis.com/gmail/v1/users/me/labels  (Authorization: Bearer <access_token>)
     -> expect 200 and { "labels": [ { "id": "INBOX", ... }, ... ] }
3. (optional) GET .../users/me/messages?maxResults=1
     -> expect 200 with a single { id, threadId } stub
```

Running steps 2–3 against a real Google account closes the Phase 2 gate (no live call was made at research time). Do it before trusting the connector.

**Auto-reconnect logic:**

```
on 401 (authError):
  refresh_token(); retry the original request once   # do NOT persist a new refresh token — Google does not rotate it
on token endpoint {"error":"invalid_grant"}:
  trigger full re-consent flow                        # refresh token revoked/expired (incl. 7-day testing-mode expiry)
on 403 insufficientPermissions:
  stop — required scope not granted (e.g. send under gmail.readonly); broaden scope + re-consent
on 403 userRateLimitExceeded / 429 RESOURCE_EXHAUSTED:
  truncated exponential backoff + jitter (max ~32-64s); Retry-After is unreliable
```

## Sources

- developers.google.com/identity/protocols/oauth2/web-server (Google OAuth web server flow; token revocation)
- developers.google.com/workspace/gmail/api/auth/scopes (Gmail scopes)
- developers.google.com/identity/protocols/oauth2#expiration (refresh-token expiry / testing mode)
- Registry: `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` (`id:'gmail'`)
