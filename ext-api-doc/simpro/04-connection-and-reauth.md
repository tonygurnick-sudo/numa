---
api_name: simPRO
api_slug: simpro
doc: connection & reauthorization guide (Numa connector wiring)
base_url: https://{build}.simprosuite.com/api/v1.0/ (/api/v1.0 is a real path segment)
auth: OAuth 2.0 authorization_code (primary) + Direct Access API key (alternative)
oauth_host: per-build https://{build}.simprosuite.com — NO central host
registry_id: simpro (connectorRegistry.ts, authType 'oauth2')
confidence: auth endpoints [VERIFIED 2026-05-19] vs official PHP SDK Provider.php:225,230; others as tagged
---

# simPRO — Connection & Reauthorization

simPRO is a **per-build (per-customer-tenant) SaaS** — every OAuth URL and API URL contains the customer's `{build}` subdomain (e.g. `markscompany.simprosuite.com`). There is NO shared/central OAuth host. Verified endpoints come from the official PHP SDK `simPRO-Software/simpro-restapi-php/src/OAuth2/Provider.php` (lines 225+230) and siblings 02/03. Do NOT substitute a centralized host (see §A1 discrepancy).

Two access models, both selected when creating the API app under **System → Setup → API → Applications**:

- **OAuth 2.0 (A — primary):** authorization-code flow, per-build endpoints. User signs in + consents; access scoped to that user's permissions under **User Token Access** ("3-legged"). This is what the Numa connector is configured for (`connectorRegistry.ts`, `id:'simpro'`, `authType:'oauth2'`).
- **Direct Access / API Key (B — alternative):** long-lived bearer token NOT tied to an employee, grants access to all company data; no consent/redirect. For headless/server-to-server. Treat like a PAT.
  Same base API URL + `Authorization: Bearer …` for both — only how the token is obtained differs.

---

## Option A: OAuth 2.0

### A1. Create the OAuth application

Customer (or admin with **Manage Applications**): sign in to `https://{build}.simprosuite.com` → **System → Setup → API → Applications** → **Add**:
| Field | Value | Notes |
| --- | --- | --- |
| Name | `Numa Integration` (or per-client) | shown on consent screen |
| Description | optional | |
| Access Type | **OAuth 2.0** (User Token Access) | (Direct Access = Option B) |
| Grant Type | `authorization_code` | other grants in §A2.4 |
| Redirect URI | exact URI from the Numa connector wizard | byte-for-byte match (incl. trailing slash), HTTPS |
Save → copy **Client ID** + **Client Secret** (shown once; format opaque string [UNKNOWN — exact pattern]).

> ⚠️ **Registry discrepancy — fix before going live.** Current `connectorRegistry.ts` (`id:'simpro'`) hardcodes a centralized host: `authUrl:'https://login.simprogroup.com/oauth2/authorize'`, `tokenUrl:'https://login.simprogroup.com/oauth2/token'`, empty `scopes`. The SDK-verified authoritative endpoints are **per-build** (`https://{build}.simprosuite.com/oauth2/login` and `/oauth2/token`); the legacy central `auth.simpro.co` is NXDOMAIN (verified 2026-05-19); `login.simprogroup.com` is **[UNKNOWN — unverified]**, not confirmed by the SDK. The connector must template `{build}` (collected from the user at connect time) into the OAuth URLs, not rely on a fixed host.

### A2. OAuth flow

| Property          | Value                                                                                                                                                                                                                 | Source                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Grant type        | `authorization_code`                                                                                                                                                                                                  | PHP SDK                                  |
| Authorization URL | `https://{build}.simprosuite.com/oauth2/login?client_id={CLIENT_ID}`                                                                                                                                                  | [VERIFIED 2026-05-19 — Provider.php:230] |
| Token URL         | `https://{build}.simprosuite.com/oauth2/token`                                                                                                                                                                        | [VERIFIED 2026-05-19 — Provider.php:225] |
| Revocation URL    | none documented                                                                                                                                                                                                       | [UNKNOWN]                                |
| Redirect URI      | registered Numa connector URI (exact match)                                                                                                                                                                           |                                          |
| Scopes            | empty/not publicly enumerated — access governed by Access Type, NOT request-time scope strings; keep `scopes:''` unless the build's consent screen presents specific values (then capture verbatim + update registry) | [UNKNOWN]                                |
| PKCE required?    | not documented                                                                                                                                                                                                        | [UNKNOWN]                                |
| State parameter   | recommended (CSRF); validate on callback                                                                                                                                                                              | SDK                                      |

A2.1 Authorization request:

```
GET https://{build}.simprosuite.com/oauth2/login?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&state={RANDOM_OPAQUE_STRING}
```

`response_type` (req, always `code`) · `client_id` (req) · `redirect_uri` (req, exact match incl. trailing slash) · `state` (strongly recommended, CSRF — validate on callback) · `scope` (n/a — not enumerated).
User authorizes → `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}` (error: `?error={code}&error_description={message}`).

A2.2 Token exchange:

```
POST https://{build}.simprosuite.com/oauth2/token   (Content-Type: application/x-www-form-urlencoded)
grant_type=authorization_code&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

A2.3 Token response: `{"access_token":"...","refresh_token":"...","expires_in":3600,"token_type":"bearer"}`

- `access_token` — bearer, 1-hour lifetime (`expires_in:3600`).
- `refresh_token` — opaque, **single-use**; persist immediately (a new one is returned on every refresh — see §3).
- `token_type` — `bearer`.

A2.4 Grant types (Numa uses `authorization_code`; others for completeness):
| Grant | Use | Notes |
| --- | --- | --- |
| `authorization_code` | standard web-app | recommended — what Numa uses |
| `client_credentials` | server-to-server | no user context |
| `password` (resource_owner) | direct user/pass | **deprecated**, legacy only |
| `implicit` | browser-only | **deprecated by OAuth 2.1 / RFC 9700**; do not use |

> For headless/server-to-server prefer **Direct Access (Option B)** over `client_credentials` — Option B is the documented non-interactive path.

---

## 3. Token refresh

```
POST https://{build}.simprosuite.com/oauth2/token   (Content-Type: application/x-www-form-urlencoded)
grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

Response = same shape as A2.3, **including a brand-new `refresh_token`**.
| Property | Value |
| --- | --- |
| Access token lifetime | 3600s (1 hour) |
| Refresh token lifetime | 14 days |
| Rotation | **Yes — single-use.** Each refresh returns a NEW `refresh_token`; the old is invalidated. |
| Re-consent when | refresh token expired (>14 days), already-used, or user revokes the app |

> ⚠️ **Headline operational risk.** Refresh tokens are single-use → the storage layer **must persist the new `refresh_token` atomically on every refresh**. If a refresh response is lost before persist, the stored token is dead → full re-consent. **Never fire two concurrent refreshes with the same token** — one wins, the other kills the shared token. The 14-day window is an idle/inactivity clock: a connector that refreshes regularly stays alive; idle >14 days without refreshing → re-consent.

## 4. Token revocation

No public revocation endpoint is documented [UNKNOWN]. To disconnect:

- OAuth: discard stored `access_token` + `refresh_token` Numa-side, AND the customer admin deletes the API application under **System → Setup → API → Applications** to fully invalidate the client (refresh tokens also expire naturally after 14 days).
- Direct Access: delete/regenerate the application's API key under the same admin screen (Option B §3).

## 5. Reauthorization triggers (OAuth)

| Trigger                    | Detection                        | Action                                                             |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| Access token expired (1hr) | 401 on a data call               | refresh, retry once                                                |
| Refresh token expired/used | refresh POST → 401/error         | full re-consent                                                    |
| Refresh token >14 days old | refresh POST → 401/error         | full re-consent                                                    |
| User revoked / app deleted | refresh fails, or data calls 401 | full re-consent                                                    |
| Wrong Access Type / 403    | 403 on a data call               | check Direct vs User Token + verify companyID; do NOT loop refresh |

> A **403 is an access-type/permission problem, not an expired token** (Access Type doesn't grant the resource, or wrong `companyID`). Do NOT trigger refresh/reconsent for a 403.

---

## Option B: API Key / Direct Access (server-to-server)

Use when there is **no interactive user** to consent (headless automation, scheduled syncs). Direct Access issues a long-lived bearer token not tied to an employee, granting access to all company data — treat like a PAT.

### B1. Generate the token

Sign in to `https://{build}.simprosuite.com` → **System → Setup → API → Applications** → **Add**, set **Access Type = Direct Access (API Key)** → Save → Simpro emits a long-lived bearer token (instead of client_id/secret) → copy immediately, store in the Numa vault.

### B2. Token format

| Property     | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| Header       | `Authorization: Bearer {API_KEY}`                                           |
| Format       | opaque long-lived bearer token [INFERRED]                                   |
| Max lifetime | long-lived, no expiry documented; revoke by deleting the app [UNKNOWN]      |
| Scopes       | Direct Access = all company data (not user-tied; bypasses user permissions) |

SDK usage: `(new \simPRO\RestClient\OAuth2\APIKey())->withBuildURL($buildURL)->withToken($token)`.

### B3. Refresh / rotation

None — Direct Access tokens are static; no refresh endpoint, no documented expiry. Rotate manually: delete/regenerate the key in the simPRO admin UI. On 401 the key was deleted/regenerated → prompt the customer admin to issue a new Direct Access key and re-enter it (old key unrecoverable).

### B4. Programmatic key management

No public API for creating/listing/revoking API keys — managed ONLY via the simPRO web UI (System → Setup → API → Applications) [UNKNOWN].

### B5. Reauthorization triggers (Direct Access)

| Trigger                  | Detection | Action                                                     |
| ------------------------ | --------- | ---------------------------------------------------------- |
| Key deleted/regenerated  | 401       | prompt admin to generate a new Direct Access key, re-enter |
| Insufficient permissions | 403       | verify Access Type = Direct Access + `companyID` in path   |

---

## Numa connector wiring

### Credentials to store

OAuth 2.0 (Option A):
| Key | Type | Scope | Description |
| --- | --- | --- | --- |
| `build` | string | Company | build subdomain (e.g. `markscompany`) — templated into every URL |
| `client_id` | string | Company | API app Client ID |
| `client_secret` | secret | Company | API app Client Secret (shown once) |
| `access_token` | secret | User | 1-hour bearer; auto-refreshed |
| `refresh_token` | secret | User | 14-day, single-use; re-persist on every refresh |
| `company_id` | string | User | resolved from `GET /companies/`; required in nearly every path |

Direct Access (Option B):
| Key | Type | Scope | Description |
| --- | --- | --- | --- |
| `build` | string | Company | build subdomain — templated into every URL |
| `api_key` | secret | Company | long-lived Direct Access bearer token (treat like a PAT) |
| `company_id` | string | Company | resolved from `GET /companies/`; required in nearly every path |

> `build`, `client_id`/`client_secret` (or `api_key`) are **company** credentials the admin supplies once per client. OAuth `access_token`/`refresh_token` are **per-user**, captured during connect. `company_id` must be discovered, never hardcoded.

### Test connection sequence

```
1. GET https://{build}.simprosuite.com/api/v1.0/companies/
     Authorization: Bearer {access_token | api_key}
     Accept: application/json
   → 200 with [{"ID":1,"Name":"..."}, ...]
     (verifies token + build subdomain + lists company IDs) Pick the intended company's ID.
     Do NOT hardcode companyId=0 — legacy single-build folklore shortcut.
2. GET https://{build}.simprosuite.com/api/v1.0/companies/{company_id}/customers/?pageSize=1
     Authorization: Bearer {access_token | api_key}
     Accept: application/json
   → 200 with array of customer objects; headers Result-Total, Result-Pages, Result-Count
     (verifies the company_id path segment + read access)
```

Step 1 is the canonical SDK smoke test (`examples/AuthorisationCode.php`: `$companyArray[count($companyArray)-1]->ID`).

### Auto-reconnect logic

```
on 401 (data call):
  if oauth:
    refresh_token()                # POST {build}.simprosuite.com/oauth2/token, grant_type=refresh_token
    persist NEW refresh_token       # single-use — save before next call
    retry original request once
    if refresh fails (used / >14 days / revoked): trigger full re-consent
  if direct_access:
    notify admin "simPRO API key invalid — generate a new Direct Access key in System → Setup → API → Applications"
    disable connector until a new key is provided
on 403 (data call):
  do NOT refresh — access-type / companyID problem; verify Access Type (Direct vs User Token) + {company_id}
on 429 (rate limit — 10 req/sec per build, shared across all consumers):
  exponential backoff (from 1s, max ~30s, +jitter); proactively cap at 8 req/sec (80% threshold); no guaranteed Retry-After — track rate client-side
```

> The 10 req/sec ceiling is per build (tenant), shared across every consumer — not per token. Stagger polling.

## Quick-reference URLs

| Resource                       | URL                                                            |
| ------------------------------ | -------------------------------------------------------------- |
| Developer portal               | https://developer.simprogroup.com                              |
| API documentation              | https://developer.simprogroup.com/apidoc/                      |
| API forum                      | https://apiforum.simprogroup.com                               |
| Status page                    | https://status.simprogroup.com                                 |
| Customer build URL             | `https://{build}.simprosuite.com`                              |
| OAuth login (per-build)        | `https://{build}.simprosuite.com/oauth2/login?client_id={CID}` |
| OAuth token (per-build)        | `https://{build}.simprosuite.com/oauth2/token`                 |
| Base API URL                   | `https://{build}.simprosuite.com/api/v1.0/`                    |
| Official PHP SDK               | https://github.com/simPRO-Software/simpro-restapi-php          |
| Community Laravel SDK (active) | https://github.com/stitch-digital/laravel-simpro-api           |
| Revocation URL                 | none documented [UNKNOWN]                                      |

_See 02 (full API reference), 03 (Simpro-side setup), 01d (recovery playbook + rate-limit detail), 01 + 01a–01d (workspace-agent knowledge pack). Auth endpoints [VERIFIED 2026-05-19] vs official PHP SDK; the registry's `login.simprogroup.com` host is [UNKNOWN — unverified] and should migrate to the per-build pattern._
