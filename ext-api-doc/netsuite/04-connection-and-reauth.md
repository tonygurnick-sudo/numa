---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
auth_type: 'oauth2-pkce-public-client'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-04-24'
source_phases: ['Phase 2: Authentication', 'Phase 8: Operational Concerns']
---

# NetSuite MCP — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to NetSuite AI Connector Service.
> Auth type: OAuth 2.0 Authorization Code with PKCE (Public Client — no client secret)
> Goal: enough detail that Numa could automate connector setup via script.

---

## Auth Type: OAuth 2.0 Authorization Code + PKCE

NetSuite MCP uses **per-account OAuth 2.0 with PKCE**. There is no central authorization server — every NetSuite customer has their own account-scoped hostname derived from their Account ID. Numa stores the Account ID as part of the company-level connector config and derives all OAuth endpoints at runtime.

**PAT is not supported for MCP.** NetSuite's Token-Based Authentication (TBA) works for SuiteTalk REST but is **not accepted** by the MCP AI Connector Service. OAuth 2.0 is the only path.

| Property                | Value                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grant type              | `authorization_code`                                                                                                                             |
| PKCE required           | **Yes (S256)** — this is a public client                                                                                                         |
| Client secret           | **None** — public client, no secret stored                                                                                                       |
| Authorization URL       | `https://{account_id}.app.netsuite.com/app/login/oauth2/authorize.nl` _(served from the `.app.netsuite.com` subdomain)_                          |
| Token URL               | `https://{account_id}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` _(served from the `.suitetalk.api.netsuite.com` subdomain)_ |
| Revocation URL          | `https://{account_id}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/revoke`                                                            |
| Scope (MCP only)        | `mcp`                                                                                                                                            |
| Scope (MCP + RESTlets)  | `mcp restlets`                                                                                                                                   |
| Access token format     | JWT (RS256)                                                                                                                                      |
| Access token lifetime   | ~3600 seconds (1 hour)                                                                                                                           |
| Refresh token lifetime  | 100 days (sliding — last use, not issue date)                                                                                                    |
| Refresh token rotation? | **Yes** — every refresh returns a new `refresh_token`; the old one is invalidated immediately                                                    |
| Re-consent required     | After 100 days of inactivity, or when scopes change, or when the Integration Record is deleted/rotated, or when the user revokes access          |

---

## Account ID Normalisation (Critical)

NetSuite hostnames require the Account ID to be **lowercased** with underscores replaced by hyphens:

| Admin enters   | DNS hostname component |
| -------------- | ---------------------- |
| `1234567`      | `1234567`              |
| `1234567_SB1`  | `1234567-sb1`          |
| `TSTDRV123456` | `tstdrv123456`         |

**Rule:** `hostname = account_id.lower().replace('_', '-')`. Apply this on both frontend (at wizard save time when interpolating `<ACCOUNT_ID>` into auth/token URLs) and backend (provider `__init__`). Skipping this step produces DNS resolution failures that look like auth errors.

---

## 1. Create the OAuth Integration Record in NetSuite

The NetSuite admin must create an Integration Record in their account **before** Numa's admin wizard can complete. This is a manual, one-time setup per NetSuite tenant.

### 1.1 Prerequisites (NetSuite admin)

Enable in **Setup > Company > Enable Features**:

- [ ] **SuiteCloud tab:** OAuth 2.0 ✓
- [ ] **SuiteCloud tab:** Server SuiteScript ✓
- [ ] **SuiteCloud tab:** REST Web Services ✓
- [ ] **SuiteCloud tab:** Token-Based Authentication (harmless to leave on; MCP ignores it)

Install the MCP Standard Tools SuiteApp (usually bundled since 2024.2) in **Customization > SuiteBundler > Search & Install Bundles**. Search for `com.netsuite.mcpstandardtools`.

### 1.2 Create a Custom Role (NOT Administrator)

**The Administrator role cannot authenticate to MCP.** Create a dedicated role in **Setup > Users/Roles > Manage Roles > New**:

| Field                  | Value                  |
| ---------------------- | ---------------------- |
| Name                   | `Numa MCP Integration` |
| Single Sign-on Only    | Unchecked              |
| Web Services Only Role | Unchecked              |

On the **Permissions** subtabs add:

| Subtab       | Permission                                                                   | Level       | Required     |
| ------------ | ---------------------------------------------------------------------------- | ----------- | ------------ |
| Setup        | MCP Server Connection                                                        | Full        | Yes          |
| Setup        | OAuth 2.0 Access Tokens                                                      | Full        | Yes          |
| Setup        | Log in using OAuth 2.0 Access Tokens                                         | Full        | Yes          |
| Setup        | REST Web Services                                                            | Full        | Yes          |
| Setup        | User Access Tokens                                                           | Full        | Yes          |
| Lists        | Customers / Vendors / Employees (etc. for whatever data the agent will read) | View / Edit | Per use case |
| Transactions | Sales Order / Invoice / Purchase Order (etc.)                                | View / Full | Per use case |
| Reports      | Financial Statements / Saved Searches                                        | View        | Per use case |

Assign this role to every NetSuite user who will authorize the Numa connector in **Setup > Users/Roles > Manage Users**.

### 1.3 Create the Integration Record

**Setup > Integration > Manage Integrations > New**:

| Field                                  | Value                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Name                                   | `Numa Integration`                                                            |
| State                                  | Enabled                                                                       |
| Concurrency Limit                      | 15 (default; increase via SuiteCloud Plus if needed)                          |
| **Authentication subtab:**             |                                                                               |
| Token-Based Authentication             | Unchecked                                                                     |
| TBA: Authorization Flow                | Unchecked                                                                     |
| OAuth 2.0                              | **Checked**                                                                   |
| OAuth 2.0: Authorization Code Grant    | **Checked**                                                                   |
| OAuth 2.0: Client Credentials Grant    | Unchecked                                                                     |
| **Public Client** _(the key checkbox)_ | **Checked** — disables client_secret generation and forces PKCE               |
| Scope                                  | Check `NetSuite AI Connector Service` (MCP); optionally `REST Web Services`   |
| Redirect URI                           | `https://{client}.numa.arcanum.ai/oauth/callback/netsuite` _(see §1.4 below)_ |

**Save.** NetSuite displays the generated values **once**:

- **Client ID** — a UUID-like string. Copy it now.
- **Client Secret** — **does NOT appear** because Public Client is checked. Confirm the page does not show one.

### 1.4 Getting the Redirect URI for Numa

Every Numa workspace has a fixed redirect URI pattern:

```
https://{client}.numa.arcanum.ai/oauth/callback/netsuite
```

For example:

- `nd-labs` workspace: `https://nd-labs.numa.arcanum.ai/oauth/callback/netsuite`
- `arcanum-demo-greg` workspace: `https://arcanum-demo-greg.numa.arcanum.ai/oauth/callback/netsuite`

The Numa admin wizard displays the exact URI to copy — use that value, not a hand-typed version. NetSuite requires an **exact match** (scheme, host, path, trailing slash). A mismatch yields `invalid_redirect_uri` at the authorize step with no other diagnostic.

---

## 2. OAuth Flow (Authorization Code + PKCE)

### 2.1 PKCE Verifier / Challenge

Generate on the backend at authorize time — do not reuse across flows:

```python
import secrets, hashlib, base64

code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).rstrip(b"=").decode()
code_challenge_method = "S256"
```

Persist `code_verifier` against the OAuth state token (short-lived, ≤10 min) so the token-exchange step can retrieve it.

### 2.2 Authorization Request

```http
GET https://{account_id_normalised}.app.netsuite.com/app/login/oauth2/authorize.nl
    ?response_type=code
    &client_id={client_id}
    &redirect_uri={redirect_uri}
    &scope=mcp
    &state={random_state}
    &code_challenge={code_challenge}
    &code_challenge_method=S256
    &prompt=consent
```

Notes:

- `prompt=consent` is recommended so existing NetSuite sessions do not skip the scope consent screen on re-auth.
- `scope=mcp` is the minimum. Use `scope=mcp restlets` only if you also call RESTlets.
- NetSuite redirects to the NetSuite login page (if not logged in), then the role picker (if the user has multiple roles — they must pick the **Numa MCP Integration** role), then consent, then back to `redirect_uri` with `?code=...&state=...`.

### 2.3 Token Exchange

```http
POST https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={auth_code}
&redirect_uri={redirect_uri}
&client_id={client_id}
&code_verifier={code_verifier}
```

**No `client_secret` header or body field.** Including one returns HTTP 400 `invalid_client`.

Success response:

```json
{
  "access_token": "eyJraWQiOiI...{JWT}",
  "refresh_token": "eyJraWQiOiI...{opaque}",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

Persist in the user vault under `oauth-netsuite` with fields:

| Field           | Source                                                   |
| --------------- | -------------------------------------------------------- |
| `access_token`  | Token response                                           |
| `refresh_token` | Token response                                           |
| `expires_at`    | `now_utc() + expires_in - 60` (60 s safety margin)       |
| `user_email`    | Decode JWT payload `preferred_username` or `email` claim |
| `connected_at`  | `now_utc().isoformat()`                                  |

Do **not** persist `client_id`, `account_id`, or `scope` on the user vault entry. Those live on the **company** vault (`oauth-client-netsuite`) and must be looked up there on every request.

### 2.4 Access Token Response — JWT Claims

NetSuite issues RS256 JWTs. Public signing keys are published at:

```
https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/jwks
```

Noteworthy claims:

| Claim                | Meaning                                           |
| -------------------- | ------------------------------------------------- |
| `sub`                | NetSuite internal user ID                         |
| `aud`                | Integration Record client ID                      |
| `scope`              | Space-separated scopes granted                    |
| `iss`                | `https://{account_id}.suitetalk.api.netsuite.com` |
| `exp`                | Token expiry (Unix seconds)                       |
| `preferred_username` | User email — use for display                      |

Do not attempt to validate the JWT in our code — treat it as opaque for bearer use. Only use `exp` and `preferred_username` from the payload.

---

## 3. Token Refresh

```http
POST https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={current_refresh_token}
&client_id={client_id}
```

Success response:

```json
{
  "access_token": "eyJraWQ...",
  "refresh_token": "eyJraWQ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Refresh tokens rotate.** Always overwrite `refresh_token` in the vault with the new value. If a race condition causes a second refresh to use the old refresh_token, NetSuite returns `401 invalid_grant` and the user must fully re-consent.

Refresh proactively — at least 60 seconds before `expires_at`. On any `401 INVALID_LOGIN` while calling the MCP endpoint, refresh once and retry the original call before escalating to the user.

### Refresh failure modes

| Response                         | Cause                                                  | Action                                     |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `400 invalid_grant`              | Refresh token expired (100-day idle) / already rotated | Delete user secret, trigger re-consent     |
| `400 invalid_client`             | Integration Record deleted or `state` toggled off      | Alert admin, re-consent required           |
| `401 unauthorized_client`        | PKCE flow disabled on the integration                  | Admin must re-enable in integration record |
| `429 CONCURRENCY_LIMIT_EXCEEDED` | Too many simultaneous refreshes                        | Exponential backoff, then retry            |
| `500 UNEXPECTED_ERROR`           | Transient NetSuite error                               | Retry with backoff (1 s, 2 s, 4 s, ...)    |

---

## 4. Token Revocation

NetSuite supports explicit revocation. Call on user disconnect:

```http
POST https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/revoke
Content-Type: application/x-www-form-urlencoded

token={refresh_token}
&token_type_hint=refresh_token
&client_id={client_id}
```

Revoking the refresh token also invalidates all access tokens derived from it. Revocation is fire-and-forget — treat any 2xx/4xx as "revoked" and proceed to delete the user vault entry. Do not block disconnect on the revoke call succeeding.

If the admin deletes the company vault entry (`oauth-client-netsuite`), also iterate all user vault entries for `oauth-netsuite` and call revoke for each before purging them.

---

## 5. Reauthorization Triggers

| Trigger                                 | Detection                                               | Action                                                       |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Access token expired                    | 401 on MCP call, or local `expires_at` passed           | Refresh using refresh token; retry original request once     |
| Refresh token expired (100-day idle)    | 400 `invalid_grant` on refresh                          | Delete user secret, prompt re-consent                        |
| Refresh token already rotated (race)    | 400 `invalid_grant` on refresh                          | Delete user secret, prompt re-consent                        |
| Scopes changed (admin changed registry) | `oauth-client-netsuite.scopes` != token's `scope` claim | Prompt re-consent on next user action                        |
| User revoked access in NetSuite         | 401 + refresh fails                                     | Delete user secret, prompt re-consent                        |
| Integration Record deleted / disabled   | 400 `invalid_client` on refresh or MCP call             | Alert admin; all users must re-consent after admin recreates |
| Admin rotated the client_id             | Mismatch between stored `client_id` and vault           | All existing user tokens invalidated; prompt re-consent      |
| Custom role permissions changed         | 403 `INSUFFICIENT_PERMISSION` on specific tool          | Not a re-consent trigger — surface the failing tool to admin |

---

## 6. Numa Connector Wiring

### 6.1 Credentials to Store

**Company vault entry** — `oauth-client-netsuite` — created/updated by admin via the wizard. Represents the **connector configuration**:

| Key                   | Type   | Source                                         | Notes                                                                                              |
| --------------------- | ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `client_id`           | string | NetSuite Integration Record                    | Required                                                                                           |
| `account_id`          | string | Admin wizard input                             | Stored as entered; normalise to lowercase/hyphens before building URLs                             |
| `account_id_hostname` | string | Derived: `account_id.lower().replace('_','-')` | Cache the normalised form so backend and frontend agree                                            |
| `auth_url`            | string | Wizard save, after `<ACCOUNT_ID>` substitution | `https://{host}.app.netsuite.com/app/login/oauth2/authorize.nl`                                    |
| `token_url`           | string | Wizard save, after `<ACCOUNT_ID>` substitution | Likewise for the token endpoint                                                                    |
| `revoke_url`          | string | Derived                                        | For disconnect flow                                                                                |
| `mcp_url`             | string | Derived                                        | `https://{host}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools` |
| `scopes`              | string | Registry default (`mcp`) or admin override     | Space-separated                                                                                    |
| `display_name`        | string | Registry or admin override                     | "NetSuite"                                                                                         |
| `cache_ttl`           | number | Registry default                               | 3600 (metadata caching)                                                                            |

**User vault entry** — `oauth-netsuite` — created on OAuth callback success. Represents the **user's connection**:

| Key             | Type    | Source                            | Notes                    |
| --------------- | ------- | --------------------------------- | ------------------------ |
| `access_token`  | string  | Token exchange / refresh response | JWT                      |
| `refresh_token` | string  | Token exchange / refresh response | Rotates on every refresh |
| `expires_at`    | ISO8601 | `now + expires_in - 60`           | 60 s safety margin       |
| `user_email`    | string  | `preferred_username` JWT claim    | For display              |
| `connected_at`  | ISO8601 | `now`                             | Audit                    |

**Never store** `client_id`, `account_id`, or `scope` on the user vault entry — always look those up from the company vault at call time.

### 6.2 Test Connection Sequence

```
1. GET https://{host}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/jwks
   → 200 with JSON — verifies account_id is a valid, reachable NetSuite hostname.
   No auth required. Fastest sanity check for the Account ID field.

2. POST {mcp_url}  (with Bearer {access_token})
   body: {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
   → 200 with a list of 11 tools — verifies OAuth token is valid AND the role
     has MCP Server Connection permission AND the SuiteApp is installed.

3. POST {mcp_url}  (with Bearer {access_token})
   body: {"jsonrpc":"2.0","id":1,"method":"tools/call",
          "params":{"name":"ns_getRecordTypeMetadata","arguments":{}}}
   → 200 with record type schemas — verifies the role has read permission on
     at least one record type.
```

Run (1) on Account ID save (admin wizard test button). Run (2) after OAuth callback completes. Run (3) only if (2) succeeded and the user explicitly clicks "Test connection" — it is costlier.

### 6.3 Auto-Reconnect Logic

```
on mcp_call(user, method, args):
  token = load_user_token(user)

  if token.expires_at <= now() + 60s:
    token = refresh_token_pair(user, token.refresh_token)

  response = POST mcp_url with Bearer token.access_token
  if response.status == 401:
    # Token invalidated server-side despite not being locally expired
    try:
      token = refresh_token_pair(user, token.refresh_token)
      response = POST mcp_url with Bearer token.access_token  # retry once
    except InvalidGrant:
      delete_user_secret(user)
      raise NeedsReauth("netsuite")
  if response.status == 403:
    raise InsufficientPermission(...)  # do not re-auth — role issue
  return response


on refresh_token_pair(user, old_refresh_token):
  company = load_company_secret("oauth-client-netsuite")
  body = {
    "grant_type": "refresh_token",
    "refresh_token": old_refresh_token,
    "client_id": company.client_id,
  }
  response = POST company.token_url with body
  if response.status == 400 and error == "invalid_grant":
    raise InvalidGrant  # refresh token expired or rotated
  persist new access_token, refresh_token, expires_at to user vault
  return new token pair
```

Concurrency: serialise refresh per user (Redis/DynamoDB conditional update, or an in-process lock keyed by user_sub). If two MCP calls both detect expiry and race to refresh, the second one's refresh attempt will 400 because the first has already rotated the token.

---

## 7. Common Failure Modes & Admin Guidance

| Symptom                                                        | Likely cause                                             | Fix                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Authorize redirects to a NetSuite 404 / DNS failure            | Account ID typo, or `_` not converted to `-`             | Re-check Account ID; normalise to lowercase/hyphens                                  |
| `invalid_redirect_uri` on authorize                            | Redirect URI in Integration Record doesn't match exactly | Copy from the wizard banner; include/exclude trailing slash consistently             |
| `invalid_client` on token exchange                             | Integration Record disabled or Public Client unchecked   | Admin enables integration and toggles Public Client on                               |
| Consent page shows, but user ends up with no role/permission   | User logged in with Administrator role                   | User must pick the **Numa MCP Integration** role in the role selector                |
| `tools/list` works but every `tools/call` returns 403          | Role lacks MCP Server Connection permission              | Add permission to the custom role                                                    |
| MCP call returns `CONCURRENCY_LIMIT_EXCEEDED` under load       | Account concurrency cap exceeded (default 15)            | Enable SuiteCloud Plus licenses, or reduce parallelism on the Numa side              |
| Refresh suddenly fails after 100+ days with `invalid_grant`    | Refresh token hit the 100-day sliding expiry             | User re-consents. This is normal and unavoidable for inactive connections            |
| After admin re-creates the Integration Record, all users break | New client_id invalidates all existing refresh tokens    | Notify all users to re-consent; there is no way to preserve tokens across a recreate |

---

_Source: NetSuite AI Connector Service FAQ, Oracle OAuth 2.0 for NetSuite docs, and live flow testing against account `5721181`. See `00-api-investigation-questionnaire.md` for the raw research record and `02-api-spec-investigation.md` for the consolidated developer reference._
