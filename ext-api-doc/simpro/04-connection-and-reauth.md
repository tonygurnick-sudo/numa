# simPRO REST API — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the simPRO REST API.
> Auth type: **OAuth 2.0** (authorization-code flow, **per-build** endpoints) — with a
> documented **API-key / "Direct Access"** alternative for server-to-server use.
> Goal: enough detail that Numa could automate connector setup via script.
>
> simPRO is a **per-build (per-customer-tenant) SaaS** — every OAuth URL and every API URL
> contains the customer's `{build}` subdomain (e.g. `markscompany.simprosuite.com`). There is
> **no shared/central OAuth host**. The verified endpoints come from the official PHP SDK
> `simPRO-Software/simpro-restapi-php/src/OAuth2/Provider.php` (lines 225 + 230) and the
> sibling docs `02-api-spec-investigation.md` and `03-connector-setup.md`. Do not substitute a
> centralized host — see the discrepancy note in §1.

---

## Auth Type: OAuth 2.0 (primary) + API Key / Direct Access (alternative)

simPRO supports **two** access models, both selected when creating the API application under
**System → Setup → API → Applications**:

- **OAuth 2.0 (Option A — primary).** Authorization-code flow with per-build endpoints. The user
  signs in and consents; access is scoped to that user's permissions when the app uses **User
  Token Access** ("3 Legged" OAuth). This is the flow the Numa connector is configured for
  (`authType: 'oauth2'` in `connectorRegistry.ts`, `id: 'simpro'`).
- **API Key / Direct Access (Option B — alternative).** simPRO emits a **long-lived bearer
  token** that is **not** tied to an employee's credentials and grants access to all company
  data. No user consent / redirect dance. Use for server-to-server automation. Treat the token
  like a PAT (capture once, store in the vault, regenerate manually on compromise/expiry). See
  Option B below.

> **Why keep both:** simPRO genuinely ships both. Option A is the documented primary flow for
> Numa. Option B is the correct path for headless/server-to-server scenarios where there is no
> interactive user to consent. The same base API URL and `Authorization: Bearer …` header scheme
> work for either — only how the token is obtained differs.

---

## Option A: OAuth 2.0

### 1. Create the OAuth Application in simPRO

simPRO API applications are created **inside the customer's own build**, not on a central
developer portal. The customer (or an admin with the **Manage Applications** permission) must:

1. Sign in to the simPRO build at `https://{build}.simprosuite.com`
   (`{build}` is the subdomain the customer signs into simPRO at, e.g. `markscompany`).
2. Navigate to: **System → Setup → API → Applications**.
3. Click **"Add"**.
4. Fill in:

   | Field        | Value                                                         | Notes                                                                                                    |
   | ------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
   | Name         | `Numa Integration` (or per-client name)                       | Free text; shown on the consent screen.                                                                  |
   | Description  | Optional                                                      | —                                                                                                        |
   | Access Type  | **OAuth 2.0** (User Token Access)                             | Choose this for Option A. (Choose **Direct Access (API Key)** for Option B.)                             |
   | Grant Type   | `authorization_code`                                          | Standard web-app flow. Other grants in §2.4.                                                             |
   | Redirect URI | the **exact** redirect URI shown in the Numa connector wizard | **Must match byte-for-byte** (incl. trailing slash) on every OAuth request. HTTPS required. [DOCUMENTED] |

5. Save, then copy:
   - **Client ID** — capture immediately. Format: opaque string. [UNKNOWN — exact pattern not documented]
   - **Client Secret** — capture immediately, **shown once**. Format: opaque string. [UNKNOWN — exact pattern not documented]

> **⚠️ Registry discrepancy — fix before going live.** The current Numa connector registry
> entry (`connectorRegistry.ts`, `id: 'simpro'`) hardcodes a **centralized** host:
> `authUrl: 'https://login.simprogroup.com/oauth2/authorize'` and
> `tokenUrl: 'https://login.simprogroup.com/oauth2/token'` with empty `scopes`. The
> SDK-verified, sibling-doc-authoritative endpoints are **per-build**
> (`https://{build}.simprosuite.com/oauth2/login` and `.../oauth2/token`) — and the legacy
> central host `auth.simpro.co` **does not resolve in DNS (NXDOMAIN, verified 2026-05-19)**.
> `login.simprogroup.com` is **not** confirmed by the official PHP SDK and is treated here as
> **[UNKNOWN — unverified]**. The connector must template the build subdomain into the OAuth
> URLs (collect `{build}` from the user at connect time) rather than rely on a fixed host.

### 2. OAuth Flow

| Property          | Value                                                                                                        | Source                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Grant type        | `authorization_code`                                                                                         | [DOCUMENTED — PHP SDK]                   |
| Authorization URL | `https://{build}.simprosuite.com/oauth2/login?client_id={CLIENT_ID}`                                         | [VERIFIED 2026-05-19 — Provider.php:230] |
| Token URL         | `https://{build}.simprosuite.com/oauth2/token`                                                               | [VERIFIED 2026-05-19 — Provider.php:225] |
| Revocation URL    | None documented                                                                                              | [UNKNOWN]                                |
| Redirect URI      | the registered Numa connector redirect URI (exact match)                                                     | [DOCUMENTED]                             |
| Scopes            | Empty / not publicly enumerated — simPRO scopes exist but are not exposed; access is governed by Access Type | [UNKNOWN — scopes not enumerated]        |
| PKCE required?    | Not documented                                                                                               | [UNKNOWN]                                |
| State parameter   | Recommended (CSRF protection); validate on callback                                                          | [DOCUMENTED — SDK code]                  |

> **Scopes:** simPRO does **not** publicly enumerate OAuth scope strings. The registry `scopes`
> field is empty (`''`) and should stay empty unless the build's consent screen presents specific
> scope values — capture them verbatim and update the registry if so. Effective access is decided
> by the application's **Access Type** (Direct vs User Token), not by request-time scope strings.
> [UNKNOWN — scopes not publicly enumerated]

#### 2.1 Authorization Request

```http
GET https://{build}.simprosuite.com/oauth2/login?
  response_type=code&
  client_id={CLIENT_ID}&
  redirect_uri={REDIRECT_URI}&
  state={RANDOM_OPAQUE_STRING}
```

| Parameter       | Required             | Notes                                                                |
| --------------- | -------------------- | -------------------------------------------------------------------- |
| `response_type` | yes                  | Always `code`                                                        |
| `client_id`     | yes                  | From the simPRO API application                                      |
| `redirect_uri`  | yes                  | Must match a registered URI **exactly** (incl. trailing slash)       |
| `state`         | strongly recommended | CSRF protection — validate on callback                               |
| `scope`         | n/a                  | Not used — simPRO scope values are not publicly enumerated [UNKNOWN] |

The user signs in and authorizes. simPRO redirects to
`{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`
(error case: `{REDIRECT_URI}?error={code}&error_description={message}`). [CONFIRMED — SDK]

#### 2.2 Token Exchange

```http
POST https://{build}.simprosuite.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={AUTH_CODE}&
redirect_uri={REDIRECT_URI}&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}
```

[CONFIRMED — SDK code; sibling `02` §Authorization Code Flow]

#### 2.3 Token Response

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

- `access_token` — bearer token, **1-hour** lifetime (`expires_in: 3600`). [CONFIRMED — forum]
- `refresh_token` — opaque string, **persist it immediately** — it is **single-use** and a new
  one is returned on every refresh (see §3). [CONFIRMED — forum]
- `token_type` — `bearer`.

#### 2.4 Other Grant Types

The official PHP SDK (`OAuth2/Provider.php`) enumerates four grant types. Numa uses
`authorization_code`; the others are listed for completeness.

| Grant                       | Use                               | Notes                                                                     |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `authorization_code`        | Standard web-app flow             | Recommended — what the Numa connector uses [DOCUMENTED — PHP SDK]         |
| `client_credentials`        | Server-to-server                  | No user context [DOCUMENTED — PHP SDK]                                    |
| `password` (resource_owner) | Direct username/password exchange | **Deprecated** — legacy clients only [DOCUMENTED — PHP SDK]               |
| `implicit`                  | Browser-only                      | **Deprecated by OAuth 2.1 / RFC 9700**; do not use [DOCUMENTED — PHP SDK] |

> For headless/server-to-server scenarios prefer **Direct Access (Option B)** over
> `client_credentials` — Option B is the path the simPRO admin UI and PHP SDK document for
> non-interactive automation.

---

## 3. Token Refresh

```http
POST https://{build}.simprosuite.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={REFRESH_TOKEN}&
client_id={CLIENT_ID}&
client_secret={CLIENT_SECRET}
```

Response is the same shape as §2.3 — **including a brand-new `refresh_token`**.

| Property                | Value                                                                                         | Source              |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------- |
| Access token lifetime   | **3600 seconds (1 hour)** (`expires_in: 3600`)                                                | [CONFIRMED — forum] |
| Refresh token lifetime  | **14 days**                                                                                   | [CONFIRMED — forum] |
| Refresh token rotation? | **Yes — single-use.** Each refresh returns a NEW `refresh_token`; the old one is invalidated. | [CONFIRMED — forum] |
| Re-consent required?    | When the refresh token is expired (>14 days), already-used, or the user revokes the app       | [CONFIRMED — forum] |

> ⚠️ **The headline operational risk.** Because refresh tokens are **single-use**, the storage
> layer **must persist the new `refresh_token` atomically on every refresh**. If a refresh
> response is lost before persist, the stored token is dead → full re-consent. **Never fire two
> concurrent refreshes with the same token** — one wins, the other kills the shared token. The
> 14-day window is an **idle/inactivity** clock: each successful refresh returns a fresh
> `refresh_token` (rotation), so a connector that refreshes regularly stays alive, but one that
> goes idle for more than 14 days without refreshing will require re-consent.

---

## 4. Token Revocation

```http
# No public token revocation endpoint is documented for simPRO.
```

simPRO does **not** document an OAuth revocation endpoint. [UNKNOWN — `02` lists Revocation URL
as UNKNOWN; SDK exposes no revoke call.]

To disconnect:

- **OAuth:** discard the stored `access_token` + `refresh_token` on the Numa side, **and** the
  customer admin should delete the API application under **System → Setup → API → Applications**
  in their build to fully invalidate the client. (Refresh tokens also expire naturally after 14
  days.)
- **Direct Access (API key):** delete/regenerate the application's API key under the same admin
  screen (see Option B §3).

---

## 5. Reauthorization Triggers (OAuth)

When to prompt the user to reauthorize:

| Trigger                       | Detection                                | Action                                                                 |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Access token expired (1 hour) | 401 on a data call                       | Refresh using refresh token, retry once                                |
| Refresh token expired/used    | Refresh POST returns 401 / error         | Full re-consent flow                                                   |
| Refresh token >14 days old    | Refresh POST returns 401 / error         | Full re-consent flow                                                   |
| User revoked / app deleted    | Refresh fails, or data calls 401         | Full re-consent flow                                                   |
| Wrong Access Type / 403       | 403 on a data call (not a token problem) | Check Direct vs User Token + verify companyID; do **not** loop refresh |

> A **403 is an access-type / permission problem, not an expired token** — it means the
> application's Access Type doesn't grant the resource, or the `companyID` in the path is wrong.
> Do **not** trigger a refresh/reconsent loop for a 403. [CONFIRMED — `01d` recovery playbook]

---

## Option B: API Key / Direct Access (server-to-server)

Use this when there is **no interactive user** to complete an OAuth consent (headless
automation, scheduled syncs). simPRO's **Direct Access** mode issues a **long-lived bearer
token** that is not associated with an employee's credentials and grants access to all company
data — so treat it like a PAT.

### 1. Generate a Direct Access token in simPRO

1. Sign in to the simPRO build at `https://{build}.simprosuite.com`.
2. Navigate to: **System → Setup → API → Applications**. [DOCUMENTED — FAQ]
3. Click **"Add"** and set **Access Type = Direct Access (API Key)**.
4. Save. simPRO emits a **long-lived bearer token** (instead of a client_id/secret OAuth pair).
5. **Copy the token immediately** and store it in the Numa vault.

### 2. Token Format

| Property           | Value                                                                                | Source             |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------ |
| Header             | `Authorization: Bearer {API_KEY}`                                                    | [CONFIRMED — SDK]  |
| Token format       | Opaque long-lived bearer token                                                       | [INFERRED — SDK]   |
| Max lifetime       | Long-lived (no expiry documented; revoke by deleting the application)                | [UNKNOWN]          |
| Scopes/permissions | **Direct Access = all company data** (not tied to a user; bypasses user permissions) | [DOCUMENTED — FAQ] |

The official PHP SDK uses it as:
`(new \simPRO\RestClient\OAuth2\APIKey())->withBuildURL($buildURL)->withToken($token)`
[CONFIRMED — SDK code].

### 3. Token Refresh / Rotation

| Property           | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — Direct Access tokens are static; there is no refresh endpoint      |
| Can extend expiry? | N/A (no documented expiry)                                                    |
| Rotation strategy  | Manual: delete the application (or regenerate its key) in the simPRO admin UI |

If the token stops working:

- On `401`: the key was deleted/regenerated → prompt the customer admin to issue a new Direct
  Access key under **System → Setup → API → Applications** and re-enter it in Numa.
- The old key cannot be recovered — a new one must be created.

### 4. Programmatic Key Management

No public API exists for creating/listing/revoking API keys — Direct Access keys are managed
**only** through the simPRO web UI (**System → Setup → API → Applications**). [UNKNOWN — no
programmatic key-management endpoints documented]

### 5. Reauthorization Triggers (Direct Access)

| Trigger                   | Detection    | Action                                                                  |
| ------------------------- | ------------ | ----------------------------------------------------------------------- |
| Key deleted / regenerated | 401 response | Prompt admin to generate a new Direct Access key in simPRO, re-enter it |
| Insufficient permissions  | 403 response | Verify Access Type is Direct Access and `companyID` in the path         |

---

## Numa Connector Wiring

### Credentials to Store

**OAuth 2.0 (Option A):**

| Key             | Type   | Scope   | Description                                                                     |
| --------------- | ------ | ------- | ------------------------------------------------------------------------------- |
| `build`         | string | Company | The customer's build subdomain (e.g. `markscompany`) — templated into every URL |
| `client_id`     | string | Company | simPRO API application Client ID (from System → Setup → API → Applications)     |
| `client_secret` | secret | Company | simPRO API application Client Secret (shown once — store in the vault)          |
| `access_token`  | secret | User    | 1-hour bearer token; refreshed automatically                                    |
| `refresh_token` | secret | User    | 14-day, **single-use**; **re-persist on every refresh**                         |
| `company_id`    | string | User    | Resolved from `GET /companies/`; required in almost every resource path         |

**Direct Access (Option B):**

| Key          | Type   | Scope   | Description                                                             |
| ------------ | ------ | ------- | ----------------------------------------------------------------------- |
| `build`      | string | Company | The customer's build subdomain — templated into every URL               |
| `api_key`    | secret | Company | Long-lived Direct Access bearer token (treat like a PAT)                |
| `company_id` | string | Company | Resolved from `GET /companies/`; required in almost every resource path |

> The `build`, `client_id`/`client_secret` (or `api_key`) are **company** credentials the admin
> supplies once per client. The OAuth `access_token`/`refresh_token` are **per-user**, captured
> during the user connect flow. `company_id` must be **discovered**, never hardcoded — see the
> test sequence below.

### Test Connection Sequence

```
1. GET https://{build}.simprosuite.com/api/v1.0/companies/
     Authorization: Bearer {access_token | api_key}
     Accept: application/json
   → 200 with [ { "ID": 1, "Name": "..." }, ... ]
     (verifies token validity + build subdomain + lists company IDs)
     Pick the intended company's ID for {company_id}.
     Do NOT hardcode companyId=0 — that is a legacy single-build folklore shortcut.

2. GET https://{build}.simprosuite.com/api/v1.0/companies/{company_id}/customers/?pageSize=1
     Authorization: Bearer {access_token | api_key}
     Accept: application/json
   → 200 with an array of customer objects
     Response headers: Result-Total, Result-Pages, Result-Count
     (verifies the company_id path segment + read access)
```

> Step 1 (`GET /companies/`) is the canonical smoke test from the official PHP SDK
> (`examples/AuthorisationCode.php`), which fetches the company list and uses a real `ID` —
> `$companyArray[count($companyArray)-1]->ID`. [CONFIRMED — SDK]

### Auto-Reconnect Logic

```
on 401 response (data call):
  if auth_type == "oauth":
    refresh_token()                    # POST {build}.simprosuite.com/oauth2/token, grant_type=refresh_token
    persist the NEW refresh_token      # single-use — must save before next call
    retry the original request once
    if refresh fails (token used / >14 days / revoked):
      trigger full re-consent flow
  if auth_type == "direct_access":
    notify admin "simPRO API key invalid — generate a new Direct Access key in System → Setup → API → Applications"
    disable connector until a new key is provided

on 403 response (data call):
  do NOT refresh — this is an access-type / companyID problem
  verify Access Type (Direct vs User Token) and that {company_id} is correct

on 429 response (rate limit — 10 req/sec per build, shared across all consumers):
  back off (exponential from 1s, max ~30s, add jitter); proactively cap at 8 req/sec (80% threshold)
  no Retry-After header is guaranteed — track request rate client-side
```

> **Rate limit reminder:** the 10 req/sec ceiling is **per build (tenant)**, shared across every
> API consumer on that build — not per token. Stagger polling and respect the 80% threshold.
> [CONFIRMED — `01d`, forum + Laravel SDK config]

---

## Quick-Reference URLs

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
| Revocation URL                 | None documented — [UNKNOWN]                                    |

---

_See `02-api-spec-investigation.md` for the full API reference, `03-connector-setup.md` for the
Simpro-side setup walkthrough, `01d-event-and-error-handling.md` for the recovery playbook and
rate-limit detail, and `01-llm-api-rules.md` (+ `01a`–`01d`) for the workspace-agent knowledge
pack. Auth endpoints here are [VERIFIED 2026-05-19] against the official PHP SDK; the registry's
`login.simprogroup.com` host is [UNKNOWN — unverified] and should be migrated to the per-build
pattern._
