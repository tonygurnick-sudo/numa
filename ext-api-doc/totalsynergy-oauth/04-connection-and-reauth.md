---
api_name: Total Synergy (OAuth)
api_slug: totalsynergy-oauth
scope: connecting Numa to Total Synergy via OAuth 2.0 + token refresh
auth: OAuth 2.0 authorization-code grant — **vendor-custom**, not RFC-6749-standard (custom param names, custom token endpoint on a different host, custom credential header `access-token`)
credential_header: `access-token: <token>` on every API call — NOT `Authorization: Bearer`
sibling: totalsynergy-api (same API; long-lived static key 1yr/3yr copied from a Synergy user profile, same `access-token` header). Documented fallback if OAuth is too painful for a tenant.
confidence: endpoints/params/header [DOCUMENTED] + re-verified 2026-06-24 against developers.totalsynergy.com. Token-RESPONSE field casing is NOT published (🔬) — the adapter normalises both camelCase and snake_case. NO live token exchange made (no vendor app credentials) — Phase 2 "first successful call" gate still open; close it with the smoke test below once an app is registered.
adapter_status: SHIPPED — the `totalsynergy` OAuth adapter (oauth-auth-handler authorize/exchange/refresh + connect_tools.py / oauth_tools.py outbound `access-token` header) implements the custom flow. The registry now declares the REAL endpoints + `oauthAdapter: 'totalsynergy'` + `authHeaderScheme: 'access-token'`. See 03-connector-setup.md §3.
---

# Total Synergy (OAuth) — Connection & Reauthorization Guide

Every API call runs under the authenticating **user's** Synergy security context. **No scope system** — access is whatever the user's Synergy role grants.

## 1. Create the OAuth Application

`ApplicationKey` (public key) + `ApplicationSecret` (private key) are registered with Total Synergy via the self-service page at `https://app.totalsynergy.com/Applications` (or contact support, per `oauthSetupSteps`).

1. Log in → application registration page.
2. Create/register a new application.
3. Fill: Application name `Numa Integration`; Organisation `<your org>`; Callback/Redirect URI `<from Numa wizard>` (must match exactly at authorize time); other fields as prompted.
4. Save. Total Synergy generates + shows:
   - **`ApplicationKey`** (public) — used in both authorize and token requests.
   - **`ApplicationSecret`** (private) — used **server-side only** in token/refresh; never expose to the browser. Store in the company vault.

## 2. OAuth Flow (custom)

| Property          | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                              |
| Authorization URL | `https://app.totalsynergy.com/OAuth2/Authorize`                                   |
| Authorize params  | `ApplicationKey`, `RedirectUri`, `tenant` (+ optional `simple=true`)              |
| Token URL         | `https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken` (POST)                |
| Refresh URL       | `https://api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken` (POST)            |
| Redirect URI      | `<from Numa wizard>` (must match the registered callback)                         |
| Scopes            | **none**                                                                          |
| PKCE required?    | No (server-side `ApplicationSecret` exchange instead) [INFERRED]                  |
| `state` param     | not documented 🔬 (use one anyway for CSRF protection if the adapter allows)      |
| Credential header | **`access-token: <accessToken>`** on every API call — NOT `Authorization: Bearer` |

### Authorization Request

> Custom param names — `ApplicationKey` / `RedirectUri` / `tenant`, NOT `client_id` / `redirect_uri` / `response_type` / `scope`.

```http
GET https://app.totalsynergy.com/OAuth2/Authorize?ApplicationKey=<APPLICATION_KEY>&RedirectUri=<REDIRECT_URI>&tenant=
```

After login + consent, Synergy redirects to `<REDIRECT_URI>?code=XXXXXXXX`.
**Desktop variant (DOCUMENTED):** set `RedirectUri=https://desktop` and watch the embedded browser for navigation to `https://desktop/?code=XXXX`, then extract the code. (Not Numa's web flow, but documents the vendor convention.)

### Token Exchange

> Server-side only — needs `ApplicationSecret`. Note casing: `applicationKey` (lower a) vs `ApplicationSecret` (upper A), exactly as documented. POST to the **`api.` host under `/api/v2/`**, NOT the `app.` host.

```http
POST https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken
Content-Type: application/x-www-form-urlencoded

applicationKey=<APPLICATION_KEY>&ApplicationSecret=<APPLICATION_SECRET>&code=<AUTH_CODE>&grant_type=authorization_code
```

**Token Response:** `{"accessToken":"<token>","refreshToken":"<token>","expiresIn":3600}`

> 🔬 Exact field names/casing are INFERRED — confirm on a live tenant (may be `access_token` / `refresh_token` / `expires_in`, or a wrapping envelope). Documented facts: the response contains an access token + a `refreshToken` good for **~1 month**, and the access-token TTL is returned in the response (exact value not published 🔬).

## 3. Using the Token (every API call)

```http
GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects?criteria.pagesize=50
access-token: <accessToken>
```

- Token goes in the **`access-token`** header. `Authorization: Bearer` → 401.
- Every resource path needs the org **`{Slug}`** — distinct from the `tenant` used at authorize time. Resolve first via `GET Organisation` or `Organisation/MySlug` 🔬, then store it with the connection.

## 4. Token Refresh

> Same host/casing rules as token exchange. Documented body uses `grant_type=authorization_code` on refresh (matching the vendor's example) — confirm on a live tenant whether `refresh_token` is also accepted as the grant type 🔬.

```http
POST https://api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken
Content-Type: application/x-www-form-urlencoded

applicationKey=<APPLICATION_KEY>&ApplicationSecret=<APPLICATION_SECRET>&refreshToken=<REFRESH_TOKEN>&grant_type=authorization_code
```

| Property                | Value                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Access token lifetime   | short-lived; TTL returned in token response (exact value 🔬)         |
| Refresh token lifetime  | **~1 month** [DOCUMENTED]                                            |
| Refresh token rotation? | unknown 🔬 — not stated whether refresh returns a NEW refresh token  |
| Re-consent required?    | when the refresh token expires (≥1 month idle) or the app is revoked |

> If refresh **does** rotate the refresh token, always overwrite the stored value with the one from each refresh response, or the next refresh fails. Treat this as the default until confirmed 🔬.

## 5. Token Revocation

No dedicated revocation endpoint documented (🔬 confirm). Treat refresh-token expiry/revocation (or admin de-registration of the app) as the end of the connection → trigger a full re-consent.

## 6. Reauthorization Triggers

| Trigger                         | Detection                           | Action                                                 |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Access token expired            | 401                                 | refresh via `RefreshAccessToken`, then retry           |
| Refresh token expired           | refresh returns 4xx (≥1 month idle) | full re-consent flow                                   |
| App credentials changed/revoked | 401 + refresh fails                 | full re-consent (re-register app if needed)            |
| User revoked access             | 401/403 + refresh fails             | full re-consent flow                                   |
| Wrong header used               | 401 on a token that should be valid | verify token is in `access-token`, not `Authorization` |

> ⚠️ Rate-limit 429s are **daily** — do NOT treat a 429 as a reauth trigger and do NOT retry within the same day; budget won't reset until the next day (suggest Premium).

## Numa Connector Wiring

### Credentials to store

| Key                  | Scope   | Description                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------------- |
| `application_key`    | company | OAuth `ApplicationKey` (public) — company vault, admin-supplied                 |
| `application_secret` | company | OAuth `ApplicationSecret` (private) — company vault, server-side only           |
| `access_token`       | user    | per-user access token (short-lived; sent in the `access-token` header)          |
| `refresh_token`      | user    | per-user refresh token (~1 month; overwrite on refresh if it rotates 🔬)        |
| `org_slug`           | conn    | organisation `{Slug}` for resource paths (resolve via `Organisation/MySlug` 🔬) |
| `tenant`             | conn    | tenant value used at authorize time (may be blank) 🔬                           |

> Contrast `totalsynergy-api`: a single long-lived `api_key` (user) + an `instance_url` (conn), no refresh machinery.

### Test Connection Sequence (Phase 2 smoke test — closes the gate)

```
1. POST https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken
     applicationKey=... ApplicationSecret=... code=... grant_type=authorization_code
   -> verify accessToken + refreshToken returned (capture exact field casing 🔬)
2. GET https://api.totalsynergy.com/api/v2/Organisation            (or /Organisation/MySlug)
     access-token: <accessToken>
   -> resolve the org {Slug}; store on the connection
3. GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1
     access-token: <accessToken>
   -> expect 200 and { "totalItems": <int>, "items": [ ... ] }
```

> Running steps 1–3 against a live tenant closes the Phase 2 gate flagged in the questionnaire. Do it before trusting the connector in production.

### Auto-Reconnect Logic

```
on 401 response:
  verify token is sent in the `access-token` header (NOT Authorization: Bearer)  # #1 gotcha
  try refresh via POST .../api/v2/Oauth2/RefreshAccessToken
  if refresh returns a new refresh_token: overwrite the stored one (rotation 🔬)
  if refresh fails (refresh token expired/revoked):
    trigger full re-consent flow (user reconnects via OAuth2/Authorize)
on 429 response (daily rate limit):
  do NOT retry within the same day  # budget is daily, not per-second
  surface "rate limit reached for today"; suggest the Premium API add-on
```

## Sources

OAuth flow (authorize/token/refresh, `access-token` header, app registration) https://developers.totalsynergy.com/ · API FAQ https://help.totalsynergy.com/en/articles/8696457-api-faq · App registration https://app.totalsynergy.com/Applications. Pair with `02-api-spec-investigation.md` (dev reference), `03-connector-setup.md` (build), the `01*` agent rules; keep consistent with the sibling `totalsynergy-api` doc set.
