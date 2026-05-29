# Total Synergy (OAuth) — Connection & Reauthorization Guide

> Complete setup for connecting Numa to Total Synergy via OAuth 2.0.
> Auth type: **OAuth 2.0** (authorization-code grant — **vendor-custom**, not RFC-6749-standard).
> Detailed enough to automate connector setup and token refresh once a custom adapter exists.
>
> 📌 **Same API as `totalsynergy-api`.** That sibling connector uses a long-lived static key
> (1yr/3yr expiry, copied from a Synergy user profile) and the **same** `access-token` request
> header. The only difference is credential acquisition — OAuth here, static key there. If OAuth is
> too painful for a tenant, the static-key connector is the documented fallback.
>
> ⚠️ **No live call was made.** All values below are `[DOCUMENTED]` from the developer portal/FAQ
> or `[INFERRED]`; 🔬 items need confirmation on a live tenant. Phase 2's "first successful call"
> gate is **NOT** satisfied — close it with the smoke test in the wiring section.

---

## Auth Type: OAuth 2.0 (custom authorization-code flow)

Every Total Synergy API call runs under the authenticating **user's** Synergy security context.
There is **no scope system** — access is whatever the user's Synergy role grants. The flow looks
like authorization-code OAuth but uses **custom parameter names, a custom token endpoint on a
different host, and a custom credential header** (`access-token`, not `Authorization: Bearer`).

> 🚩 **Generic OAuth tooling will not work unmodified.** The committed registry entry
> (`connectorRegistry.ts`, id `totalsynergy-oauth`) declares standard placeholders
> (`app.totalsynergy.com/oauth2/authorize`, `app.totalsynergy.com/oauth2/token`, `scopes: ''`).
> The real endpoints/params/header below must be wired into a Total-Synergy-specific adapter (see
> `03-connector-setup.md` §3) before consent yields a usable token.

---

## 1. Create the OAuth Application in Total Synergy

Application credentials (`ApplicationKey` = public key, `ApplicationSecret` = private key) are
**registered with Total Synergy**. The developer portal exposes a self-service registration page;
some KB articles also direct you to contact support.

1. Log in to Total Synergy and go to the application registration page at
   `https://app.totalsynergy.com/Applications` (the developer portal's "Applications" area).
2. Click to create/register a new application.
3. Fill in:
   | Field | Value | Notes |
   |-------|-------|-------|
   | Application name | `Numa Integration` | |
   | Organisation | `<your org>` | |
   | Callback / Redirect URI | `<from Numa wizard>` | Must match exactly at authorize time |
   | Other fields | as prompted | |
4. Save. Total Synergy auto-generates and shows:
   - **`ApplicationKey`** (public key) — used in both authorize and token requests.
   - **`ApplicationSecret`** (private key) — used **server-side only** in the token/refresh
     exchange; never expose it to the browser. Store in the company vault.

> If the self-service `/Applications` page is unavailable for your tenant, contact Total Synergy
> support (per `oauthSetupSteps` in the registry entry) to have an application registered and the
> redirect URI allow-listed.

---

## 2. OAuth Flow (custom)

| Property          | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                              |
| Authorization URL | `https://app.totalsynergy.com/OAuth2/Authorize`                                   |
| Authorize params  | `ApplicationKey`, `RedirectUri`, `tenant` (+ optional `simple=true`)              |
| Token URL         | `https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken` (POST)                |
| Refresh URL       | `https://api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken` (POST)            |
| Redirect URI      | `<from Numa wizard>` (must match the registered callback)                         |
| Scopes            | **none** — Total Synergy has no OAuth scope system                                |
| PKCE required?    | No (server-side `ApplicationSecret` exchange instead) [INFERRED]                  |
| `state` param     | Not documented 🔬 (use one anyway for CSRF protection if the adapter allows)      |
| Credential header | **`access-token: <accessToken>`** on every API call — NOT `Authorization: Bearer` |

### Authorization Request

> Note the **custom** param names — `ApplicationKey` / `RedirectUri` / `tenant`, **not**
> `client_id` / `redirect_uri` / `response_type` / `scope`.

```http
GET https://app.totalsynergy.com/OAuth2/Authorize?
  ApplicationKey=<APPLICATION_KEY>&
  RedirectUri=<REDIRECT_URI>&
  tenant=
```

After the user logs in and consents, Synergy redirects to `RedirectUri` with a `code`:

```
<REDIRECT_URI>?code=XXXXXXXX
```

**Desktop variant (DOCUMENTED):** set `RedirectUri=https://desktop` and watch the embedded browser
for a navigation to `https://desktop/?code=XXXX`, then extract the code. (Not relevant to Numa's
web flow, but documents the vendor convention.)

### Token Exchange

> Server-side only — needs the `ApplicationSecret`. Note casing: `applicationKey` (lower a) vs.
> `ApplicationSecret` (upper A), exactly as documented. POST to the **`api.` host under
> `/api/v2/`**, not the `app.` host.

```http
POST https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken
Content-Type: application/x-www-form-urlencoded

applicationKey=<APPLICATION_KEY>&
ApplicationSecret=<APPLICATION_SECRET>&
code=<AUTH_CODE>&
grant_type=authorization_code
```

### Token Response

```json
{
  "accessToken": "<token>",
  "refreshToken": "<token>",
  "expiresIn": 3600
}
```

> 🔬 **Exact field names/casing are INFERRED** — confirm on a live tenant (the response may use
> `access_token` / `refresh_token` / `expires_in`, or a wrapping envelope). The documented facts
> are: the response contains an access token + a `refreshToken` good for **~1 month**, and the
> access token TTL is returned in the response (exact value not published 🔬).

---

## 3. Using the Token (every API call)

```http
GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects?criteria.pagesize=50
access-token: <accessToken>
```

- The token goes in the **`access-token`** header. `Authorization: Bearer` → 401.
- Every resource path needs the org **`{Slug}`** — distinct from the `tenant` used at authorize
  time. Resolve it first via `GET …/Organisation` or `…/Organisation/MySlug` 🔬, then store it with
  the connection.

---

## 4. Token Refresh

> Same host/casing rules as the token exchange. Documented body uses
> `grant_type=authorization_code` on refresh (matching the vendor's example) — confirm on a live
> tenant whether `refresh_token` is also accepted as the grant type. 🔬

```http
POST https://api.totalsynergy.com/api/v2/Oauth2/RefreshAccessToken
Content-Type: application/x-www-form-urlencoded

applicationKey=<APPLICATION_KEY>&
ApplicationSecret=<APPLICATION_SECRET>&
refreshToken=<REFRESH_TOKEN>&
grant_type=authorization_code
```

| Property                | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Access token lifetime   | Short-lived; TTL returned in the token response (exact value 🔬)      |
| Refresh token lifetime  | **~1 month** [DOCUMENTED]                                             |
| Refresh token rotation? | Unknown 🔬 — not stated whether refresh returns a _new_ refresh token |
| Re-consent required?    | When the refresh token expires (≥1 month idle) or the app is revoked  |

> If refresh **does** rotate the refresh token, always overwrite the stored value with the one from
> each refresh response, or the next refresh fails. Treat this as the default until confirmed. 🔬

---

## 5. Token Revocation

No dedicated revocation endpoint is documented (🔬 confirm). Treat refresh-token expiry/revocation
(or admin de-registration of the application) as the end of the connection and trigger a full
re-consent.

---

## 6. Reauthorization Triggers

| Trigger                         | Detection                           | Action                                                     |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Access token expired            | 401 response                        | Refresh via `RefreshAccessToken`, then retry               |
| Refresh token expired           | Refresh returns 4xx (≥1 month idle) | Full re-consent flow                                       |
| App credentials changed/revoked | 401 + refresh fails                 | Full re-consent flow (re-register app if needed)           |
| User revoked access             | 401/403 + refresh fails             | Full re-consent flow                                       |
| Wrong header used               | 401 on a token that should be valid | Verify the token is in `access-token`, not `Authorization` |

> ⚠️ Rate-limit 429s are **daily** — do **not** treat a 429 as a reauth trigger and do not retry
> within the same day; the budget won't reset until the next day (suggest the Premium add-on).

---

## Numa Connector Wiring

### Credentials to Store

| Key                  | Type    | Description                                                                       |
| -------------------- | ------- | --------------------------------------------------------------------------------- |
| `application_key`    | company | OAuth `ApplicationKey` (public key) — company vault, admin-supplied               |
| `application_secret` | company | OAuth `ApplicationSecret` (private key) — company vault, server-side only         |
| `access_token`       | user    | Per-user access token (short-lived; sent in the `access-token` header)            |
| `refresh_token`      | user    | Per-user refresh token (~1 month; overwrite on refresh if it rotates 🔬)          |
| `org_slug`           | conn    | Organisation `{Slug}` for resource paths (resolve via `…/Organisation/MySlug` 🔬) |
| `tenant`             | conn    | Tenant value used at authorize time (may be blank) 🔬                             |

> Contrast with `totalsynergy-api`, which stores a single long-lived `api_key` (user) plus an
> `instance_url` (conn) and no refresh machinery.

### Test Connection Sequence (Phase 2 smoke test — closes the gate)

```
1. POST https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken
     applicationKey=... ApplicationSecret=... code=... grant_type=authorization_code
   -> verify an accessToken + refreshToken are returned (capture exact field casing 🔬)

2. GET https://api.totalsynergy.com/api/v2/Organisation            (or /Organisation/MySlug)
     access-token: <accessToken>
   -> resolve the org {Slug}; store it on the connection

3. GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1
     access-token: <accessToken>
   -> expect 200 and { "totalItems": <int>, "items": [ ... ] }
```

> Running steps 1–3 against a live tenant is what closes the Phase 2 gate flagged in the
> questionnaire. Do it before trusting the connector in production.

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

---

## Sources

- OAuth flow (authorize/token/refresh, `access-token` header, app registration): https://developers.totalsynergy.com/
- API FAQ (auth, rate limits, pagination, base URLs): https://help.totalsynergy.com/en/articles/8696457-api-faq
- App registration: https://app.totalsynergy.com/Applications

_Pair with `02-api-spec-investigation.md` (dev reference), `03-connector-setup.md` (build), and the
`01*` agent rules. Keep consistent with the sibling `totalsynergy-api` doc set._
