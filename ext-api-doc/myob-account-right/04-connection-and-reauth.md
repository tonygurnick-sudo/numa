---
doc: connection-and-reauth (Numa connector wiring) — MYOB AccountRight (MYOB Business API v2)
connector_id: myob-account-right (numa-frontend/src/Components/DataConnectors/connectorRegistry.ts:423)
auth_type: oauth2 — Authorization-Code flow, post-March 2025 variant [VERIFIED 2026-05-29 registry:423]. No PAT/API-key user path.
authorize_url: https://secure.myob.com/oauth2/account/authorize [VERIFIED 2026-05-29 registry:425]
token_url: https://secure.myob.com/oauth2/v1/authorize (token exchange AND refresh) [VERIFIED 2026-05-29 registry:426]
two_headers: every data call needs BOTH Authorization: Bearer {access_token} AND x-myobapi-key: {client_id}. Bearer alone → 403 DeveloperInactive.
note: authorize redirect and token exchange both from secure.myob.com but DIFFERENT paths (/oauth2/account/authorize vs /oauth2/v1/authorize) — both load-bearing, do not substitute.
confidence: [DOCUMENTED]/[VERIFIED <date>]/[INFERRED]/[UNKNOWN] inline
---

# MYOB AccountRight — Connection & Reauthorization (Numa wiring)

## Auth Type: OAuth 2.0

MYOB is OAuth-only — no PAT/API-key user path. The "API key" (`client_id`) is a **company-level app credential** (admin supplies once per client), not a per-user token. Per-user auth is always the authorization-code flow below. Registry `authType: 'oauth2'` [VERIFIED 2026-05-29 connectorRegistry.ts:423].

## 1. Create the OAuth Application in MYOB

Mirrors the registry's `oauthSetupSteps`; full version in `03 §2`.

1. https://developer.myob.com → "Register for API Access". MYOB emails my.MYOB login credentials. [DOCUMENTED https://developer.myob.com/api/myob-business-api/api-overview/getting-started/]
2. Accept the **shared sandbox company file** invite inside my.MYOB before testing.
3. my.MYOB → **Developer** tab → **Register App**.
4. Fields: **App name** = `Numa Integration` (or per-client; shown on consent screen). **Redirect URI** = the exact URI from the Numa connector wizard — **byte-for-byte incl. trailing slash**, must equal the `redirect_uri` in the authorize URL.
5. Copy: **API Key** = Client ID (also sent on every call as `x-myobapi-key`); **API Secret** = Client Secret (**shown once**, capture immediately).

> **Post-March-2025 enrolment:** if cloud-hosted and the API key was created after 12 March 2025, also submit the enrolment ticket (https://apisupport.myob.com/hc/en-us/requests/new?ticket_form_id=6175906535311). Without it, the `prompt=consent` redirect behaviour (which returns `businessId`) does not apply. [DOCUMENTED 03 §2]
> **Administrator requirement:** only an Administrator on the company file can complete consent. Non-admins get Access Denied at consent — surface this **before** sending them to the authorize URL. [DOCUMENTED 03 §3.5]

## 2. OAuth Flow

| Property                       | Value                                                                                                                    | Confidence                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Grant type                     | `authorization_code`                                                                                                     | [VERIFIED 2026-05-29 02 §Auth]     |
| Authorization URL              | `https://secure.myob.com/oauth2/account/authorize`                                                                       | [VERIFIED 2026-05-29 registry:425] |
| Token URL (exchange + refresh) | `https://secure.myob.com/oauth2/v1/authorize`                                                                            | [VERIFIED 2026-05-29 registry:426] |
| Revocation URL                 | none documented — revoke manually in `secure.myob.com` (§4)                                                              | [UNKNOWN]                          |
| Redirect URI                   | registered Numa connector redirect URI (exact byte-for-byte)                                                             | [DOCUMENTED 03 §2]                 |
| Scopes                         | space-separated `sme-*` (e.g. `sme-company-file sme-contacts-customer sme-sales`)                                        | [DOCUMENTED 02]                    |
| `prompt` param                 | **`consent` — MANDATORY** (without it the redirect omits `businessId`, and every subsequent call has no base-URL target) | [DOCUMENTED 02/03]                 |
| PKCE required?                 | not documented as used in MYOB's flow                                                                                    | [INFERRED]                         |

### 2.1 Authorization Request

```http
GET https://secure.myob.com/oauth2/account/authorize?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code&scope=sme-company-file%20sme-contacts-customer%20sme-sales&prompt=consent&state={RANDOM_STATE}
```

| Param           | Required             | Notes                                                                     |
| --------------- | -------------------- | ------------------------------------------------------------------------- |
| `client_id`     | yes                  | API key from my.MYOB                                                      |
| `redirect_uri`  | yes                  | match registered URI exactly (incl. trailing slash)                       |
| `response_type` | yes                  | always `code`                                                             |
| `scope`         | yes                  | space-separated (URL-encoded) `sme-*`; `sme-company-file` always required |
| `prompt`        | **yes**              | `consent` — else `businessId` omitted from redirect                       |
| `state`         | strongly recommended | CSRF protection — validate on callback                                    |

The Administrator authenticates, **chooses which company file to connect**, and consents.

### 2.2 Redirect Response

```
{REDIRECT_URI}?code={AUTH_CODE}&scope={GRANTED_SCOPES}&state={OPTIONAL_STATE}&businessId={COMPANY_FILE_GUID}&businessName={COMPANY_FILE_DISPLAY_NAME}
```

> 🔑 `businessId` is the primary identifier for every call — the `{businessId}` in `https://api.myob.com/accountright/{businessId}/`. **Persist it with the tokens.** Captured here and **only** here for cloud files (legacy `GET /accountright/` was removed post-March 2025). Multi-file accounts: run the flow **once per file** (each with `prompt=consent`), store each `businessId`. [DOCUMENTED 02/03 §3.6]

### 2.3 Token Exchange

```http
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&grant_type=authorization_code
```

Credentials are **form fields in the body** (not HTTP Basic). [DOCUMENTED 02/03 §3.3]

### 2.4 Token Response

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "scope": "sme-company-file sme-contacts-customer sme-sales",
  "expires_in": 1200,
  "token_type": "bearer"
}
```

- `access_token` — bearer for API calls; lifetime per `expires_in` (anecdotally ~20 min, see §3).
- `refresh_token` — **rotates on every refresh; persist the new value each time** (§3).
- `scope` — granted scopes (may be narrower than requested).
- `token_type` — `bearer` (lowercase in MYOB's response).
  [DOCUMENTED 02/03 §3.3]

## 3. Token Refresh

```http
POST https://secure.myob.com/oauth2/v1/authorize
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&refresh_token={REFRESH_TOKEN}&grant_type=refresh_token
```

Response = same shape as §2.4, **including a brand-new `refresh_token`**.
| Property | Value | Confidence |
| --- | --- | --- |
| Access token lifetime | trust `expires_in` (anecdotally ~20 min, `expires_in:1200`) | [UNKNOWN — not published] |
| Refresh token lifetime | not published — refresh defensively; treat refresh failure as re-consent signal | [UNKNOWN — not published] |
| Refresh token rotation? | **Yes** — each refresh returns a NEW `refresh_token`; old one dies at once | [DOCUMENTED 02] |
| Re-consent required? | on refresh failure (stale/expired/revoked), scope change, or user revocation | [INFERRED] |

> ⚠️ **Headline operational risk:** refresh tokens are one-time-use — the storage layer **must persist the new `refresh_token` atomically on every refresh**. Never fire two concurrent refreshes with the same token — one wins and invalidates the other, forcing a full re-consent. Exact lifetimes are [UNKNOWN]; trust `expires_in` and refresh on 401, not on a hard-coded TTL.

## 4. Token Revocation

**No officially documented programmatic revocation endpoint.** [UNKNOWN] To revoke, the my.MYOB account holder logs into **https://secure.myob.com** with the authenticating account and revokes the app's access in the web UI — cannot be done via API or the AccountRight program. [DOCUMENTED https://community.myob.com/discussions/accountrightapiquestions/oauth2-refresh-token-revocation/561739]

> A community-reported, RFC-7009-style `POST https://secure.myob.com/oauth2/v1/revoke` exists but is **not** in official docs and MYOB support says revocation must go through the web UI. **Do not rely on it** — treat as [UNKNOWN]. For Numa's "disconnect", delete stored tokens locally and direct the admin to revoke at `secure.myob.com` if a hard server-side revoke is needed.

## 5. Reauthorization Triggers

| Trigger                        | Detection                                            | Action                                                                  |
| ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Access token expired           | `401` on a data call                                 | refresh, persist rotated token, retry once                              |
| Refresh fails (token dead)     | refresh response error/non-200                       | full re-consent (`prompt=consent`)                                      |
| Scopes changed (new data area) | `403 AccessDenied` on a resource needing a new scope | full re-consent with added `sme-*` scope                                |
| User revoked in my.MYOB        | refresh fails, or `401`/`403 AccessDenied`           | full re-consent                                                         |
| Not an Administrator           | `403 AccessDenied` at consent or on calls            | surface "must be a company-file Administrator to connect"               |
| Missing `x-myobapi-key`        | `403 DeveloperInactive`                              | **Not** a reauth issue — fix header / API-key config; do NOT re-consent |

> ⚠️ **403 is ambiguous — inspect body `Name` before reacting:** `RateLimitError` → back off + retry (403, not 429); `DeveloperInactive` → config issue, do NOT re-consent; `AccessDenied` → permission/scope/role, re-consent only if a scope gap. A `401` is the real "token expired" signal driving a refresh. [DOCUMENTED 01d §4; 02]

## Numa Connector Wiring

### Credentials to Store

| Key                          | Type   | Scope   | Description                                                                                    |
| ---------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `client_id` (API key)        | string | Company | MYOB API Key — used both as OAuth `client_id` AND sent as `x-myobapi-key` on every call        |
| `client_secret` (API secret) | secret | Company | MYOB API Secret (shown once — store in vault)                                                  |
| `access_token`               | secret | User    | bearer; refreshed automatically (lifetime per `expires_in`, ~20 min)                           |
| `refresh_token`              | secret | User    | **rotating, one-time-use** — re-persist on every refresh                                       |
| `business_id` (per file)     | string | User    | company-file GUID from OAuth redirect; the `{businessId}` in base URL — required on every call |
| `business_name` (per file)   | string | User    | display name from OAuth redirect; for UI labelling                                             |

Client ID/Secret are **company** credentials (admin supplies once per client). Tokens + `business_id`/`business_name` are **per-user**, captured during connect. Multi-file users: store one `business_id` per file (one OAuth pass each).

### Test Connection Sequence

```
1. (post-token) Confirm businessId was captured from the OAuth redirect.
   If absent → prompt=consent was skipped → re-run the authorize step.
2. GET https://api.myob.com/accountright/{business_id}/Contact/Customer?$top=1
     Authorization: Bearer {access_token}
     x-myobapi-key: {client_id}
     x-myobapi-version: v2
   → 200 OK with { "Count": …, "Items": [ … ], "NextPageLink": … }
     (verifies bearer + API-key header + businessId + read scope)
```

Failure interpretation (from `03 §7`): **401** → token bad/expired → refresh+retry · **403 `RateLimitError`** → hit 8 req/s → back off · **403 `DeveloperInactive`** → `x-myobapi-key` missing/invalid → fix header/API key · **403 `AccessDenied`** → not an Administrator, or scope gap · **400/missing `businessId`** → `prompt=consent` skipped.

> Use `Contact/Customer?$top=1` (covered by `sme-contacts-customer`) as the smoke test — pick a test endpoint covered by scopes you actually requested, else `403 AccessDenied` makes a valid connection look broken.

### Auto-Reconnect Logic

```
on 401 (data call):
  refresh_token()                 # POST secure.myob.com/oauth2/v1/authorize, grant_type=refresh_token
  persist the NEW refresh_token   # one-time-use — MUST save before next call
  retry the original request once
  if refresh fails (non-200): trigger full re-consent (prompt=consent)   # stored token stale/revoked

on 403 (data call): inspect body "Name":
  "RateLimitError"    -> exponential backoff (2^attempt s, up to 3x), retry   # NOT a 429
  "DeveloperInactive" -> do NOT refresh/re-consent; fix x-myobapi-key / API-key config
  "AccessDenied"      -> permission/scope/role:
                           missing sme-* scope -> re-consent with the added scope
                           else surface "must be a company-file Administrator"

on 504 GatewayTimeout: linear backoff (5*attempt s), retry up to 3x   # ~30s server timeout, worse around 20th-5th of month
```

## Quick-Reference URLs

| Resource                      | URL                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Developer portal              | https://developer.myob.com                                                    |
| my.MYOB (AU)                  | https://my.myob.com.au                                                        |
| Authorize endpoint            | https://secure.myob.com/oauth2/account/authorize                              |
| Token / refresh endpoint      | https://secure.myob.com/oauth2/v1/authorize                                   |
| Post-March-2025 flow guide    | https://apisupport.myob.com/hc/en-us/articles/13065472856719                  |
| Authentication overview       | https://developer.myob.com/api/myob-business-api/api-overview/authentication/ |
| Scopes reference              | https://developer.myob.com/api/myob-business-api/api-overview/scopes/         |
| Error messages reference      | https://developer.myob.com/api/myob-business-api/api-overview/error-messages/ |
| Revocation (manual, web only) | https://secure.myob.com                                                       |
| API support centre            | https://apisupport.myob.com/hc/en-us                                          |
| API status page               | https://status.myob.com/                                                      |

_See `02` for the API reference, `03` for MYOB-side credential setup, `01d` for the full error map + retry logic, `01`–`01d` for the workspace-agent knowledge pack._
