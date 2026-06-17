---
doc: connection-and-reauth (Numa connector wiring)
api: Jobber (GraphQL only — no REST; no PAT/API-key path)
connector_id: getjobber (connectorRegistry.ts) — auth/token URLs + default scopes below are the EXACT registry values; do not substitute
auth: OAuth 2.0 Authorization Code; Bearer {JWT}
tenancy: single-tenant SaaS — ONE shared endpoint https://api.getjobber.com/api/graphql; account identity carried by the bearer token; NO tenant/org id to capture (unlike Xero/MYOB). One token = one Jobber account
version_header: X-JOBBER-GRAPHQL-VERSION = 2025-04-16 (required on every data call; HEADER value, never a path segment) — the unusual, load-bearing detail
confidence: all verified live 2026-05-19 unless tagged [DOCUMENTED]/[UNKNOWN]
---

# Jobber (GraphQL) — Connection & Reauthorization

Jobber is OAuth-only — **no PAT / API-key path** for the current GraphQL API. The legacy REST API used an `API-ACCESS-TOKEN` header but is retired — do NOT implement it (see `02` §SDKs).

## 1. Create the OAuth app in Jobber (mirrors registry `oauthSetupSteps`)

1. Log in to the Jobber Developer Portal `https://developer.getjobber.com` (Cloudflare-protected — log in interactively).
2. Click **Create App**.
3. Fill in:

| Field              | Value                                                 | Notes                                                                                                 |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| App name           | `Numa Integration` (or per-client)                    | Free text — shown on consent screen                                                                   |
| Description        | Free text                                             | Shown on consent screen                                                                               |
| OAuth callback URL | exact redirect URI shown in the Numa connector wizard | Must match byte-for-byte; HTTPS required                                                              |
| Scopes             | smallest set needed (see §6)                          | Registry default: `read_clients read_jobs read_invoices`. Add `write_*` only when needed (re-consent) |

4. Note the **Refresh Token Rotation** toggle setting — it changes refresh behaviour (§3).
5. Copy **Client ID** and **Client Secret** (secret shown ONCE). Both required.

## 2. OAuth flow

| Property       | Value                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| Grant type     | `authorization_code`                                                                    |
| Authorize URL  | `https://api.getjobber.com/api/oauth/authorize` (returns 302; matches registry)         |
| Token URL      | `https://api.getjobber.com/api/oauth/token` (returns 302; matches registry)             |
| Revoke URL     | `https://api.getjobber.com/api/oauth/revoke` [DOCUMENTED — Fundthrough/jobber-ruby SDK] |
| Redirect URI   | registered Numa connector redirect URI (exact match)                                    |
| Scopes         | `read_clients read_jobs read_invoices` (registry default; space-separated)              |
| PKCE required? | Not documented as required — standard web-app code flow uses `client_secret`. [UNKNOWN] |

> Token response has no `scope` field (§2.3), so granted scope can't be read back — track scopes requested at authorize time. Adding a `write_*` scope later requires full re-consent (existing token does NOT auto-upgrade).

### 2.1 Authorization request

```http
GET https://api.getjobber.com/api/oauth/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=read_clients%20read_jobs%20read_invoices&state={RANDOM_STATE}
```

| Param           | Required             | Notes                                                          |
| --------------- | -------------------- | -------------------------------------------------------------- |
| `response_type` | yes                  | Always `code`                                                  |
| `client_id`     | yes                  | From developer-portal app page                                 |
| `redirect_uri`  | yes                  | Must match registered URI exactly                              |
| `scope`         | yes                  | Space-separated, URL-encoded; `read_<entity>`/`write_<entity>` |
| `state`         | strongly recommended | CSRF — opaque value echoed back, validate on callback          |

User consents → `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`. Unlike Xero, the redirect carries NO org/tenant id — the token alone scopes the session to one account; no `GET /connections`-style follow-up.

### 2.2 Token exchange

```http
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

### 2.3 Token response

```json
{ "access_token": "{JWT}", "refresh_token": "{string}" }
```

> Jobber's documented example shows ONLY `access_token` and `refresh_token` — no `expires_in`/`token_type`/`scope`. Verify the live shape on the first exchange; if `expires_in` is absent, decode the JWT `exp` claim for expiry (no signature verification).
>
> - `access_token` — JWT bearer, **60-min (3,600 s)** lifetime [DOCUMENTED].
> - `refresh_token` — opaque string. **Persist it.** Rotation depends on the app's "Refresh Token Rotation" setting (§3).

## 3. Token refresh

```http
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

| Property                | Value                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Access token lifetime   | 60 min (3,600 s) [DOCUMENTED]                                                                                                 |
| Refresh token lifetime  | Not specified [UNKNOWN] — treat `invalid_grant` on refresh as "re-consent required"                                           |
| Refresh token rotation? | App-configurable: ON → NEW `refresh_token` returned on every refresh; OFF → original keeps working until revoked [DOCUMENTED] |
| Re-consent required?    | On failed refresh (stale/expired/revoked), on scope change (e.g. adding `write_clients`), or on user revocation in Jobber     |

> **Rotation safety:** the storage layer must persist the NEW `refresh_token` atomically on every refresh — a lost refresh response means the stored token is dead → re-consent. Rotation is per-app, not globally fixed, so **always re-persist the `refresh_token` from each refresh response** regardless of the toggle (correct whether ON — token changed — or OFF — no-op rewrite). Never fire two concurrent refreshes with the same token.

## 4. Token revocation

```http
POST https://api.getjobber.com/api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={ACCESS_OR_REFRESH_TOKEN}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

Use on user/admin disconnect and connector teardown so a leaked token can't be reused. `03` §3.4 documents the body with ONLY `token=…`; the `client_id`/`client_secret` lines shown for parity with the token endpoint — their requirement is [UNKNOWN — confirm against a live revoke call].

## 5. Reauthorization triggers

| Trigger                                        | Detection                                                                   | Action                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| Access token expired                           | `{"message":"Token not recognized"}` (HTTP 200/401, Shape A) on a data call | Refresh, retry the call once               |
| Access token expired (per-field)               | 200 + `errors[].extensions.code:"UNAUTHENTICATED"` (Shape B)                | Refresh, retry once                        |
| Refresh token expired / rotated-away / revoked | Refresh call fails (`invalid_grant`/non-200)                                | Full re-consent flow                       |
| Scopes changed (e.g. added `write_clients`)    | `errors[].extensions.code:"FORBIDDEN"` on the newly-needed field            | Full re-consent with the updated scope set |
| User revoked access in Jobber                  | Refresh fails, or data calls return Shape A "Token not recognized"          | Full re-consent flow                       |

> A `FORBIDDEN` (Shape B) is a **scope** problem, not an expired token — do NOT enter a refresh/re-consent loop on it blindly. Fix by adding the missing scope and re-consenting once. See `01d` §5.

## 6. Required headers (every authenticated GraphQL call)

Data API is GraphQL-only: every op is `POST /api/graphql`. Beyond the bearer token, Jobber requires the calendar-versioned API-version HEADER on data calls (the unusual, load-bearing detail):

```http
POST /api/graphql HTTP/2
Host: api.getjobber.com
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16
```

| Header                     | Value                   | Required                                                          |
| -------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `Authorization`            | `Bearer {access_token}` | Yes for data (not for unauthenticated `__schema` introspection)   |
| `Content-Type`             | `application/json`      | Yes                                                               |
| `Accept`                   | `application/json`      | Standard                                                          |
| `X-JOBBER-GRAPHQL-VERSION` | `2025-04-16`            | Required for all apps per Jobber's versioning policy [DOCUMENTED] |

> Value is a date `YYYY-MM-DD` (HEADER, never a path segment). Latest active: `2025-04-16`. Unknown value → HTTP 404 `{"message":"GraphQL API version '<X>' does not exist"}`. Supported min 12 / max ~18 months, removed in batches every 6 months — pin a known-valid date, bump deliberately (`02` §Versioning Policy).

## Numa connector wiring

### Credentials to store

| Key             | Type   | Scope   | Description                                                                                                                                    |
| --------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `client_id`     | string | Company | Jobber app Client ID (developer-portal app page)                                                                                               |
| `client_secret` | secret | Company | Jobber app Client Secret (shown once — store in vault)                                                                                         |
| `access_token`  | secret | User    | 60-min JWT bearer; refreshed automatically. Sent as `Authorization: Bearer {…}`                                                                |
| `refresh_token` | secret | User    | Persist on every refresh (rotation is per-app; re-persisting is safe either way — §3)                                                          |
| `scopes`        | string | User    | Space-separated scopes requested at consent. Not returned in the token response — track it so re-consent for a `write_*` scope can be detected |

Client ID/Secret are **company** credentials (admin supplies once per client at connector setup). Tokens + granted scopes are **per-user**, captured during the user connect flow. NO tenant/org id to store — one token scopes the session to one Jobber account.

> `api_version` (`2025-04-16`) is a connector-level constant sent as `X-JOBBER-GRAPHQL-VERSION` on every data call, not a per-user credential. Keep it in connector config so it can be bumped centrally.

### Test connection sequence

```
POST https://api.getjobber.com/api/graphql
  Authorization: Bearer {access_token}
  Content-Type: application/json
  X-JOBBER-GRAPHQL-VERSION: 2025-04-16
  body: {"query": "{ account { id name accountOwner { name { full } } } }"}
→ 200 with { "data": { "account": { "id": "...", "name": "...", ... } } }
```

The lightweight `account` query confirms token validity + version header + account access in one round-trip. 200 with `{"message":"Token not recognized"}` = bad/expired token (refresh); 404 with `"GraphQL API version '…' does not exist"` = wrong version header (fix it — don't refresh).

### Auto-reconnect logic

```
on Shape A {"message":"Token not recognized"} (HTTP 200/401) OR
   Shape B errors[].extensions.code == "UNAUTHENTICATED" (data call):
  refresh_token()                       # POST /api/oauth/token, grant_type=refresh_token
  persist the refresh_token from the response   # re-persist always (rotation may be ON)
  retry the original request once
  if the refresh call fails (invalid_grant / non-200):
    trigger full re-consent flow        # stored refresh token is stale/revoked/expired

on Shape B errors[].extensions.code == "FORBIDDEN" (data call):
  do NOT refresh — scope/permission issue
  if the field needs a scope not yet granted (e.g. write_clients):
    trigger re-consent with the expanded scope set

on HTTP 404 {"message":"GraphQL API version '…' does not exist"}:
  do NOT refresh — fix the X-JOBBER-GRAPHQL-VERSION value (use 2025-04-16)

on HTTP 429 errors[].extensions.code == "THROTTLED":
  no Retry-After header — exponential backoff (1s, 2s, 4s …), then retry
```

(Full error taxonomy + retry pseudocode in `01d` §3–§5.)

## Quick-reference URLs

| Resource             | URL                                                                      | Confidence                       |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Developer portal     | https://developer.getjobber.com                                          | [DOCUMENTED] (Cloudflare-walled) |
| GraphQL endpoint     | `https://api.getjobber.com/api/graphql`                                  | verified                         |
| OAuth authorize      | `https://api.getjobber.com/api/oauth/authorize`                          | verified                         |
| OAuth token          | `https://api.getjobber.com/api/oauth/token`                              | verified                         |
| OAuth revoke         | `https://api.getjobber.com/api/oauth/revoke`                             | [DOCUMENTED — jobber-ruby SDK]   |
| App authorization    | https://developer.getjobber.com/docs/building_your_app/app_authorization | [DOCUMENTED]                     |
| Changelog (versions) | https://developer.getjobber.com/docs/changelog                           | [DOCUMENTED]                     |
| Status page          | https://status.getjobber.com                                             | [DOCUMENTED]                     |

## Known [UNKNOWN]s (not bluffed)

| Unknown                              | How to resolve                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh-token lifetime               | Wait + attempt a refresh; treat refresh failure as "re-consent required"                                                                           |
| Token-response `expires_in` presence | Inspect the first live token exchange. If absent, decode the JWT `exp` claim                                                                       |
| Full scope vocabulary                | Log into developer.getjobber.com (scope-list sub-pages 404'd) or test scope strings against the authorize URL — invalid scopes rejected at consent |
| PKCE requirement                     | Not documented as required for the web-app flow; confirm in the portal app config if building a public/native client                               |
| Revoke endpoint exact body fields    | Confirm against a live revoke call (only `token` is documented)                                                                                    |

See `02` for the API reference, `03` for the Jobber-side setup walkthrough, `01`–`01d` for the workspace-agent knowledge pack.
