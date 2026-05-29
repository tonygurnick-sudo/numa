# Jobber (GraphQL) — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the Jobber API.
> Auth type: **OAuth 2.0** (Authorization Code flow).
> Goal: enough detail that Numa could automate connector setup via script.
>
> The auth/token endpoints and default scopes below are the **exact** values in the connector
> registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`, `id: 'getjobber'`).
> Do not substitute alternatives — Jobber's data API is **GraphQL-only** and every data call also
> requires the `X-JOBBER-GRAPHQL-VERSION` header (see §6), which is unusual and load-bearing.

---

## Auth Type: OAuth 2.0

Jobber is OAuth-only — there is **no PAT / API-key path** for the current GraphQL API. (The legacy
REST API used an `API-ACCESS-TOKEN` header, but that API is retired — do not implement it. See
`02-api-spec-investigation.md` §SDKs.) [VERIFIED 2026-05-19]

Jobber is a **single-tenant SaaS**: there is one shared GraphQL endpoint
(`https://api.getjobber.com/api/graphql`) for every customer. Customer/account identity is carried
entirely by the OAuth-issued bearer token — there is no tenant/org id to capture separately (unlike
Xero or MYOB). One token = one Jobber account. [VERIFIED 2026-05-19 — `03-connector-setup.md` §intro]

---

## 1. Create the OAuth Application in Jobber

These steps mirror the registry's `oauthSetupSteps`, expanded.

1. Log in to the **Jobber Developer Portal** at `https://developer.getjobber.com`.
   [DOCUMENTED https://developer.getjobber.com] The portal is Cloudflare-protected, so it can't be
   scraped externally — you must log in interactively.
2. Click **"Create App"** (New Application).
3. Fill in:

   | Field              | Value                                                         | Notes                                                                                                                          |
   | ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
   | App name           | `Numa Integration` (or per-client name)                       | Free text — shown on the user's consent screen.                                                                                |
   | Description        | Free text                                                     | Shown on the consent screen.                                                                                                   |
   | OAuth callback URL | the **exact** redirect URI shown in the Numa connector wizard | **Must match byte-for-byte.** HTTPS required.                                                                                  |
   | Scopes             | the smallest set you need (see §6 / §Numa Connector Wiring)   | Registry default: `read_clients read_jobs read_invoices`. Start read-only; add `write_*` scopes only when needed (re-consent). |

4. Check the **"Refresh Token Rotation"** toggle on the app config and note its setting — it changes
   refresh behaviour (see §3). [DOCUMENTED 2026-05-19 — developer.getjobber.com/docs/building_your_app/app_authorization]
5. Save, then copy:
   - **Client ID** — capture immediately.
   - **Client Secret** — capture immediately (**shown once**).

   Both are required for the OAuth flow. [VERIFIED 2026-05-19 — `03-connector-setup.md` §2]

---

## 2. OAuth Flow

| Property          | Value                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Grant type        | `authorization_code`                                                                       |
| Authorization URL | `https://api.getjobber.com/api/oauth/authorize` [VERIFIED — returns 302; matches registry] |
| Token URL         | `https://api.getjobber.com/api/oauth/token` [VERIFIED — returns 302; matches registry]     |
| Revocation URL    | `https://api.getjobber.com/api/oauth/revoke` [DOCUMENTED — Fundthrough/jobber-ruby SDK]    |
| Redirect URI      | the registered Numa connector redirect URI (exact match)                                   |
| Scopes            | `read_clients read_jobs read_invoices` (registry default; space-separated)                 |
| PKCE required?    | Not documented as required — standard web-app code flow uses `client_secret`. [UNKNOWN]    |

> The token response does **not** contain a `scope` field (see §2.3), so the granted scope set can't
> be read back from the exchange — track the scopes you requested at authorize time. Adding a `write_*`
> scope later requires a full re-consent (the existing token does **not** auto-upgrade).
> [DOCUMENTED 2026-05-19 — `03-connector-setup.md` §6]

### 2.1 Authorization Request

```http
GET https://api.getjobber.com/api/oauth/authorize?
  response_type=code&
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  scope=read_clients%20read_jobs%20read_invoices&
  state={RANDOM_STATE}
```

| Parameter       | Required             | Notes                                                                                   |
| --------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `response_type` | yes                  | Always `code`                                                                           |
| `client_id`     | yes                  | From the Jobber developer-portal app page                                               |
| `redirect_uri`  | yes                  | Must match the URI registered on the app exactly                                        |
| `scope`         | yes                  | Space-separated scope strings (URL-encoded); `read_<entity>` / `write_<entity>` pattern |
| `state`         | strongly recommended | CSRF protection — opaque value echoed back, validate on callback                        |

The user signs in to Jobber and consents. Jobber redirects back with:

```
{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}
```

> Unlike Xero, the redirect carries **no** org/tenant identifier — the token alone scopes the
> session to one account. There is no `GET /connections`-style follow-up. [VERIFIED 2026-05-19]

### 2.2 Token Exchange

```http
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}
```

[DOCUMENTED 2026-05-19 — `03-connector-setup.md` §3.2]

### 2.3 Token Response

```json
{
  "access_token": "{JWT}",
  "refresh_token": "{string}"
}
```

> ⚠️ Jobber's **documented example shows only** `access_token` and `refresh_token` — **no**
> `expires_in`, `token_type`, or `scope` fields. [DOCUMENTED 2026-05-19] Verify the live shape on the
> first real exchange; if `expires_in` is genuinely absent, the connector **must decode the JWT `exp`
> claim** (no signature verification needed — just read the payload) to determine expiry rather than
> relying on a returned lifetime.
>
> - `access_token` — a **JWT** bearer token, **60-minute (3,600 s)** lifetime.
>   [DOCUMENTED 2026-05-19 — developer.getjobber.com/docs/building_your_app/app_authorization]
> - `refresh_token` — opaque string. **Persist it.** Whether it rotates depends on the app's
>   "Refresh Token Rotation" setting (see §3).

---

## 3. Token Refresh

```http
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={REFRESH_TOKEN}&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}
```

[DOCUMENTED 2026-05-19 — `03-connector-setup.md` §3.3]

| Property                | Value                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access token lifetime   | **60 minutes (3,600 s)** [DOCUMENTED 2026-05-19]                                                                                                                                                       |
| Refresh token lifetime  | **Not specified** in Jobber's OAuth docs. [UNKNOWN] — observe live, or treat `invalid_grant` on refresh as "re-consent required".                                                                      |
| Refresh token rotation? | **App-configurable** via the per-app "Refresh Token Rotation" toggle: ON → a NEW `refresh_token` is returned on every refresh; OFF → the original keeps working until revoked. [DOCUMENTED 2026-05-19] |
| Re-consent required?    | On a failed refresh (stale/expired/revoked refresh token), on scope change (e.g. adding `write_clients`), or on user revocation in Jobber.                                                             |

> ⚠️ **Rotation safety.** If the connected app has rotation **ON**, the storage layer must persist the
> NEW `refresh_token` atomically on every refresh — a lost refresh response means the stored token is
> dead → re-consent. Because the rotation behaviour is per-app and not globally fixed, the safest
> implementation **always re-persists the `refresh_token` from each refresh response** regardless of
> the toggle: that is correct whether rotation is ON (token changed) or OFF (token is unchanged, so the
> re-write is a no-op). Never fire two concurrent refreshes with the same token.

---

## 4. Token Revocation

```http
POST https://api.getjobber.com/api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={ACCESS_OR_REFRESH_TOKEN}&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}
```

[DOCUMENTED — Fundthrough/jobber-ruby SDK; endpoint per `00-api-investigation-questionnaire.md` §Phase 2
and `03-connector-setup.md` §3.4.] `03-connector-setup.md` §3.4 documents the revoke body with **only**
`token=…`; the `client_id`/`client_secret` lines above are shown for parity with the token endpoint but
their requirement is [UNKNOWN — confirm against a live revoke call].

Use on user/admin disconnect. Revoke on connector teardown so a leaked token can't be reused.

---

## 5. Reauthorization Triggers

| Trigger                                        | Detection                                                                    | Action                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Access token expired                           | `{"message": "Token not recognized"}` (HTTP 200/401, Shape A) on a data call | Refresh using refresh token, retry the call once |
| Access token expired (per-field)               | 200 + `errors[].extensions.code: "UNAUTHENTICATED"` (Shape B)                | Refresh using refresh token, retry the call once |
| Refresh token expired / rotated-away / revoked | Refresh call fails (`invalid_grant` / non-200)                               | Full re-consent flow                             |
| Scopes changed (e.g. added `write_clients`)    | `errors[].extensions.code: "FORBIDDEN"` on the newly-needed field            | Full re-consent flow with the updated scope set  |
| User revoked access in Jobber                  | Refresh fails, or data calls return Shape A "Token not recognized"           | Full re-consent flow                             |

> A `FORBIDDEN` GraphQL error (Shape B) is a **scope** problem, not an expired token — do **not** enter
> a refresh/re-consent loop on it blindly. Fix it by adding the missing scope to the requested set and
> re-consenting once. See `01d-event-and-error-handling.md` §5 (when NOT to retry).
> [VERIFIED 2026-05-19]

---

## 6. Required Headers — every authenticated GraphQL call

Jobber's data API is **GraphQL-only**: every operation is `POST /api/graphql`. In addition to the
bearer token, Jobber **requires a calendar-versioned API-version header on data calls** — this is the
unusual, load-bearing detail for this connector.

```http
POST /api/graphql HTTP/2
Host: api.getjobber.com
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16
```

| Header                     | Value                   | Required                                                                              |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `Authorization`            | `Bearer {access_token}` | Yes for data (not for unauthenticated `__schema` introspection) [VERIFIED 2026-05-19] |
| `Content-Type`             | `application/json`      | Yes                                                                                   |
| `Accept`                   | `application/json`      | Standard                                                                              |
| `X-JOBBER-GRAPHQL-VERSION` | `2025-04-16`            | **Required for all apps** per Jobber's versioning policy [DOCUMENTED 2026-05-19]      |

> The `X-JOBBER-GRAPHQL-VERSION` value is a date (`YYYY-MM-DD`). **Latest active: `2025-04-16`**
> [VERIFIED 2026-05-19 — against developer.getjobber.com/docs/changelog + a live POST to /api/graphql].
> Sending an unknown value returns **HTTP 404** `{"message":"GraphQL API version '<X>' does not exist"}`.
> Versions are supported a minimum of 12 months (max ~18), removed in batches every 6 months — pin a
> known-valid date and bump it deliberately. [DOCUMENTED 2026-05-19 — `02-api-spec-investigation.md` §Versioning Policy]

---

## Numa Connector Wiring

### Credentials to Store

| Key             | Type   | Scope   | Description                                                                                                                                         |
| --------------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client_id`     | string | Company | Jobber app Client ID (from the developer-portal app page).                                                                                          |
| `client_secret` | secret | Company | Jobber app Client Secret (shown once — store in the vault).                                                                                         |
| `access_token`  | secret | User    | 60-min JWT bearer; refreshed automatically. Sent as `Authorization: Bearer {…}`.                                                                    |
| `refresh_token` | secret | User    | Persist on every refresh (rotation is per-app; re-persisting is safe either way — see §3).                                                          |
| `scopes`        | string | User    | The space-separated scopes requested at consent. Not returned in the token response — track it so re-consent for a `write_*` scope can be detected. |

The Client ID/Secret are **company** credentials (admin supplies them once per client during connector
setup). The tokens and granted scopes are **per-user**, captured during the user connect flow. There is
**no** tenant/org id to store — one token scopes the session to one Jobber account.

> `api_version` (`2025-04-16`) is a connector-level constant sent as `X-JOBBER-GRAPHQL-VERSION` on every
> data call, not a per-user credential. Keep it in connector config so it can be bumped centrally.

### Test Connection Sequence

```
1. POST https://api.getjobber.com/api/graphql
     Authorization: Bearer {access_token}
     Content-Type: application/json
     X-JOBBER-GRAPHQL-VERSION: 2025-04-16
     body: {"query": "{ account { id name accountOwner { name { full } } } }"}
   → 200 with { "data": { "account": { "id": "...", "name": "...", ... } } }
     (verifies token validity + version header + account access in one round-trip)
```

> Use the lightweight `account` query for the smoke test — it confirms the token, the version header,
> and account visibility together. A `200` with `{"message": "Token not recognized"}` means a
> bad/expired token (refresh); a `404` with `"GraphQL API version '…' does not exist"` means the
> version header is wrong (fix it — don't refresh the token). [VERIFIED 2026-05-19 — `03-connector-setup.md` §5]

### Auto-Reconnect Logic

```
on Shape A {"message": "Token not recognized"} (HTTP 200/401) OR
   Shape B errors[].extensions.code == "UNAUTHENTICATED" (data call):
  refresh_token()                       # POST /api/oauth/token, grant_type=refresh_token
  persist the refresh_token from the response   # re-persist always (rotation may be ON)
  retry the original request once
  if the refresh call fails (invalid_grant / non-200):
    trigger full re-consent flow        # stored refresh token is stale/revoked/expired

on Shape B errors[].extensions.code == "FORBIDDEN" (data call):
  do NOT refresh — this is a scope/permission issue
  if the field needs a scope not yet granted (e.g. write_clients):
    trigger re-consent with the expanded scope set

on HTTP 404 {"message": "GraphQL API version '…' does not exist"}:
  do NOT refresh — fix the X-JOBBER-GRAPHQL-VERSION value (use 2025-04-16)

on HTTP 429 errors[].extensions.code == "THROTTLED":
  no Retry-After header is documented — exponential backoff (1s, 2s, 4s …), then retry
```

(Full error taxonomy and retry pseudocode in `01d-event-and-error-handling.md` §3–§5.)

---

## Quick-Reference URLs

| Resource             | URL                                                                      | Confidence                       |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Developer portal     | https://developer.getjobber.com                                          | [DOCUMENTED] (Cloudflare-walled) |
| GraphQL endpoint     | `https://api.getjobber.com/api/graphql`                                  | [VERIFIED 2026-05-19]            |
| OAuth authorize      | `https://api.getjobber.com/api/oauth/authorize`                          | [VERIFIED 2026-05-19]            |
| OAuth token          | `https://api.getjobber.com/api/oauth/token`                              | [VERIFIED 2026-05-19]            |
| OAuth revoke         | `https://api.getjobber.com/api/oauth/revoke`                             | [DOCUMENTED — jobber-ruby SDK]   |
| App authorization    | https://developer.getjobber.com/docs/building_your_app/app_authorization | [DOCUMENTED 2026-05-19]          |
| Changelog (versions) | https://developer.getjobber.com/docs/changelog                           | [DOCUMENTED 2026-05-19]          |
| Status page          | https://status.getjobber.com                                             | [DOCUMENTED]                     |

---

## Known [UNKNOWN]s (not bluffed)

| Unknown                              | How to resolve                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Refresh-token lifetime               | Wait + attempt a refresh; observe expiry. Treat refresh failure as "re-consent required".                                                                          |
| Token-response `expires_in` presence | Inspect the first live token exchange. If absent, decode the JWT `exp` claim for expiry.                                                                           |
| Full scope vocabulary                | Log into developer.getjobber.com (scope-list sub-pages 404'd externally) or test scope strings against the authorize URL — invalid scopes are rejected at consent. |
| PKCE requirement                     | Not documented as required for the web-app flow; confirm in the portal app config if building a public/native client.                                              |
| Revoke endpoint exact body fields    | Confirm against a live revoke call (only `token` is documented).                                                                                                   |

---

_See `02-api-spec-investigation.md` for the API reference, `03-connector-setup.md` for the Jobber-side
setup walkthrough, and `01-llm-api-rules.md` (+ `01a`–`01d`) for the workspace-agent knowledge pack._
