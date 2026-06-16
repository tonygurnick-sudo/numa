---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
auth_type: oauth2-pkce-public-client
doc: Numa connector wiring — connection + reauthorization (on-demand)
call_surface: MCP via mcp_call
pat_supported: NO — NetSuite TBA works for SuiteTalk REST but is NOT accepted by MCP. OAuth 2.0 is the only path for MCP.
client_secret: none (public client)
account_id_in_hostname: yes — Numa stores Account ID on the company connector config and derives all OAuth endpoints at runtime
path_version_segment: literal `/v1/` IS in every OAuth/data path (real segment)
---

# NetSuite MCP — Connection & Reauthorization

Setup to connect Numa to NetSuite AI Connector Service. Auth: OAuth 2.0 Authorization Code + PKCE (public client, no secret). Detailed enough to automate connector setup via script.

## Auth model

Per-account OAuth 2.0 with PKCE; no central authorization server — every customer has an account-scoped hostname derived from their Account ID. **PAT/TBA is NOT supported for MCP** (works for SuiteTalk REST only).
| Property | Value |
| --- | --- |
| Grant type | `authorization_code` |
| PKCE | **Required (S256)** — public client |
| Client secret | **None** (public client) |
| Authorize URL | `https://{account_id}.app.netsuite.com/app/login/oauth2/authorize.nl` |
| Token URL | `https://{account_id}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` |
| Revoke URL | `https://{account_id}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/revoke` |
| JWKS URL | `https://{account_id}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/jwks` |
| Scope (MCP) | `mcp`; MCP + RESTlets = `mcp restlets` |
| Access token | JWT (RS256), ~3600s (1 hr) |
| Refresh token | 100 days (sliding — last use, not issue date); **rotates every refresh (old invalidated immediately)** |
| Re-consent | After 100 days inactivity, or scope change, or Integration Record deleted/rotated, or user revokes |

## Account ID normalisation (CRITICAL)

NetSuite hostnames need the Account ID **lowercased with `_` → `-`**:
| Admin enters | DNS hostname component |
| --- | --- |
| `1234567` | `1234567` |
| `1234567_SB1` | `1234567-sb1` |
| `TSTDRV123456` | `tstdrv123456` |

**Rule:** `hostname = account_id.lower().replace('_', '-')`. Apply on both frontend (wizard save, when interpolating `<ACCOUNT_ID>` into auth/token URLs) and backend (provider `__init__`). Skipping → DNS failures that look like auth errors.

## 1. Create the OAuth Integration Record in NetSuite

Manual, one-time per NetSuite tenant; must exist **before** Numa's admin wizard can complete.

### 1.1 Prerequisites (Setup > Company > Enable Features, SuiteCloud tab)

OAuth 2.0 ✓; Server SuiteScript ✓; REST Web Services ✓; Token-Based Authentication (harmless on; MCP ignores it). Install MCP Standard Tools SuiteApp (bundled since 2024.2) via Customization > SuiteBundler > Search & Install Bundles → search `com.netsuite.mcpstandardtools`.

### 1.2 Custom role (NOT Administrator — Administrator cannot authenticate to MCP)

Setup > Users/Roles > Manage Roles > New. Name `Numa MCP Integration`; Single Sign-on Only unchecked; Web Services Only Role unchecked.
Permissions:
| Subtab | Permission | Level | Required |
| --- | --- | --- | --- |
| Setup | MCP Server Connection | Full | Yes |
| Setup | OAuth 2.0 Access Tokens | Full | Yes |
| Setup | Log in using OAuth 2.0 Access Tokens | Full | Yes |
| Setup | REST Web Services | Full | Yes |
| Setup | User Access Tokens | Full | Yes |
| Lists | Customers / Vendors / Employees (etc.) | View / Edit | Per use case |
| Transactions | Sales Order / Invoice / Purchase Order (etc.) | View / Full | Per use case |
| Reports | Financial Statements / Saved Searches | View | Per use case |

Assign this role to every user who will authorize the Numa connector (Setup > Users/Roles > Manage Users).

### 1.3 Integration Record (Setup > Integration > Manage Integrations > New)

| Field                               | Value                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| Name                                | `Numa Integration`                                                    |
| State                               | Enabled                                                               |
| Concurrency Limit                   | 15 (default; raise via SuiteCloud Plus)                               |
| TBA / TBA Authorization Flow        | Unchecked                                                             |
| OAuth 2.0                           | **Checked**                                                           |
| OAuth 2.0: Authorization Code Grant | **Checked**                                                           |
| OAuth 2.0: Client Credentials Grant | Unchecked                                                             |
| **Public Client** (key checkbox)    | **Checked** — disables client_secret, forces PKCE                     |
| Scope                               | `NetSuite AI Connector Service` (MCP); optionally `REST Web Services` |
| Redirect URI                        | `https://{client}.numa.arcanum.ai/oauth/callback/netsuite` (see §1.4) |

Save → NetSuite shows once: **Client ID** (UUID-like — copy now); **Client Secret** does NOT appear (Public Client). Confirm no secret is shown.

### 1.4 Redirect URI for Numa

Fixed pattern `https://{client}.numa.arcanum.ai/oauth/callback/netsuite` (e.g. `https://nd-labs.numa.arcanum.ai/oauth/callback/netsuite`). Copy the exact value the wizard displays — NetSuite requires an **exact match** (scheme, host, path, trailing slash). Mismatch → `invalid_redirect_uri` at authorize with no other diagnostic.

## 2. OAuth flow (Authorization Code + PKCE)

### 2.1 PKCE verifier/challenge (backend, per flow — never reuse)

```python
import secrets, hashlib, base64
code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()
code_challenge_method = "S256"
```

Persist `code_verifier` against the OAuth state token (short-lived, ≤10 min) for the token-exchange step.

### 2.2 Authorization request

```http
GET https://{account_id_normalised}.app.netsuite.com/app/login/oauth2/authorize.nl
    ?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}
    &scope=mcp&state={random_state}&code_challenge={code_challenge}
    &code_challenge_method=S256&prompt=consent
```

- `prompt=consent` recommended so existing sessions don't skip the consent screen on re-auth.
- `scope=mcp` minimum; `scope=mcp restlets` only if also calling RESTlets.
- NetSuite shows login (if needed) → role picker (user MUST pick **Numa MCP Integration** if they have multiple roles) → consent → redirect to `redirect_uri?code=...&state=...`.

### 2.3 Token exchange

```http
POST https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={auth_code}&redirect_uri={redirect_uri}&client_id={client_id}&code_verifier={code_verifier}
```

**No `client_secret`** — including one returns HTTP 400 `invalid_client`. Success: `{"access_token":"eyJ…{JWT}","refresh_token":"eyJ…","expires_in":3600,"token_type":"Bearer"}`.

Persist in the **user vault** under `oauth-netsuite`: `access_token` (token response), `refresh_token` (token response), `expires_at` = `now_utc() + expires_in - 60` (60s safety margin), `user_email` = JWT `preferred_username`/`email` claim, `connected_at` = `now_utc().isoformat()`. **Do NOT** persist `client_id`/`account_id`/`scope` on the user vault — those live on the company vault (`oauth-client-netsuite`), looked up every request.

### 2.4 JWT claims

RS256 JWTs; public keys at the JWKS URL. Claims: `sub` (NetSuite internal user id), `aud` (Integration Record client id), `scope` (space-separated granted scopes), `iss` (`https://{account_id}.suitetalk.api.netsuite.com`), `exp` (expiry, Unix seconds), `preferred_username` (user email — use for display). **Do not validate the JWT** — treat as opaque for bearer use; only read `exp` and `preferred_username`.

## 3. Token refresh

```http
POST https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={current_refresh_token}&client_id={client_id}
```

Success: same shape as token exchange. **Refresh tokens rotate** — always overwrite `refresh_token` in the vault with the new value. A second refresh using the old token returns `401 invalid_grant` and forces full re-consent. Refresh proactively, ≥60s before `expires_at`. On any `401 INVALID_LOGIN` during an MCP call, refresh once and retry before escalating.

### Refresh failure modes

| Response                         | Cause                                                   | Action                                 |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `400 invalid_grant`              | Refresh token expired (100-day idle) or already rotated | Delete user secret, trigger re-consent |
| `400 invalid_client`             | Integration Record deleted or `state` off               | Alert admin, re-consent                |
| `401 unauthorized_client`        | PKCE disabled on the integration                        | Admin re-enables in integration record |
| `429 CONCURRENCY_LIMIT_EXCEEDED` | Too many simultaneous refreshes                         | Exponential backoff, retry             |
| `500 UNEXPECTED_ERROR`           | Transient NetSuite error                                | Retry with backoff (1s,2s,4s,…)        |

## 4. Token revocation (on user disconnect)

```http
POST https://{account_id_normalised}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/revoke
Content-Type: application/x-www-form-urlencoded

token={refresh_token}&token_type_hint=refresh_token&client_id={client_id}
```

Revoking the refresh token also invalidates derived access tokens. Fire-and-forget — treat any 2xx/4xx as "revoked", proceed to delete the user vault entry; don't block disconnect on revoke succeeding. If the admin deletes the company vault (`oauth-client-netsuite`), iterate all `oauth-netsuite` user entries and revoke each before purging.

## 5. Reauthorization triggers

| Trigger                              | Detection                                              | Action                                                       |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| Access token expired                 | 401 on MCP call, or local `expires_at` passed          | Refresh; retry original request once                         |
| Refresh token expired (100-day idle) | 400 `invalid_grant` on refresh                         | Delete user secret, prompt re-consent                        |
| Refresh token already rotated (race) | 400 `invalid_grant` on refresh                         | Delete user secret, prompt re-consent                        |
| Scopes changed                       | `oauth-client-netsuite.scopes` ≠ token's `scope` claim | Prompt re-consent on next user action                        |
| User revoked access in NetSuite      | 401 + refresh fails                                    | Delete user secret, prompt re-consent                        |
| Integration Record deleted/disabled  | 400 `invalid_client` on refresh or MCP call            | Alert admin; all users re-consent after admin recreates      |
| Admin rotated client_id              | Stored `client_id` ≠ vault                             | All user tokens invalidated; prompt re-consent               |
| Custom role permissions changed      | 403 `INSUFFICIENT_PERMISSION` on a tool                | NOT a re-consent trigger — surface the failing tool to admin |

## 6. Numa connector wiring

### 6.1 Credentials to store

**Company vault `oauth-client-netsuite`** (connector config; admin via wizard):
| Key | Type | Value / source |
| --- | --- | --- |
| `client_id` | string | Integration Record (required) |
| `account_id` | string | Wizard input, stored as entered; normalise before building URLs |
| `account_id_hostname` | string | `account_id.lower().replace('_','-')`, cached |
| `auth_url` | string | `https://{host}.app.netsuite.com/app/login/oauth2/authorize.nl` |
| `token_url` | string | token endpoint |
| `revoke_url` | string | revoke endpoint (disconnect) |
| `mcp_url` | string | `https://{host}.suitetalk.api.netsuite.com/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools` |
| `scopes` | string | registry default (`mcp`) or admin override, space-separated |
| `display_name` | string | "NetSuite" |
| `cache_ttl` | number | 3600 (metadata caching) |

**User vault `oauth-netsuite`** (user's connection; on OAuth callback success):
| Key | Type | Value / source |
| --- | --- | --- |
| `access_token` | string | token exchange/refresh (JWT) |
| `refresh_token` | string | token exchange/refresh (rotates every refresh) |
| `expires_at` | ISO8601 | `now + expires_in - 60` (60s margin) |
| `user_email` | string | `preferred_username` claim (display) |
| `connected_at` | ISO8601 | `now` (audit) |

**Never store** `client_id`/`account_id`/`scope` on the user vault — look them up from the company vault at call time.

### 6.2 Test connection sequence

1. `GET https://{host}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/jwks` → 200 JSON. Verifies account_id is a valid reachable hostname. No auth. Fastest Account-ID sanity check — run on Account ID save (wizard test button).
2. `POST {mcp_url}` (Bearer) body `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}` → 200 with 11 tools. Verifies token valid + role has MCP Server Connection + SuiteApp installed. Run after OAuth callback.
3. `POST {mcp_url}` (Bearer) body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ns_getRecordTypeMetadata","arguments":{}}}` → 200 with record-type schemas. Verifies read permission on ≥1 record type. Run only if (2) succeeded and user clicks "Test connection" (costlier).

### 6.3 Auto-reconnect logic

```
on mcp_call(user, method, args):
  token = load_user_token(user)
  if token.expires_at <= now() + 60s:
    token = refresh_token_pair(user, token.refresh_token)
  response = POST mcp_url with Bearer token.access_token
  if response.status == 401:                      # invalidated server-side despite not locally expired
    try:
      token = refresh_token_pair(user, token.refresh_token)
      response = POST mcp_url with Bearer token.access_token   # retry once
    except InvalidGrant:
      delete_user_secret(user); raise NeedsReauth("netsuite")
  if response.status == 403:
    raise InsufficientPermission(...)             # do not re-auth — role issue
  return response

on refresh_token_pair(user, old_refresh_token):
  company = load_company_secret("oauth-client-netsuite")
  response = POST company.token_url with {grant_type:"refresh_token", refresh_token:old_refresh_token, client_id:company.client_id}
  if response.status == 400 and error == "invalid_grant":
    raise InvalidGrant                            # refresh token expired or rotated
  persist new access_token, refresh_token, expires_at to user vault
  return new token pair
```

**Concurrency:** serialise refresh per user (Redis/DynamoDB conditional update, or in-process lock keyed by user_sub). If two calls race to refresh, the second 400s because the first already rotated the token.

## 7. Common failure modes & admin guidance

| Symptom                                                    | Likely cause                                           | Fix                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Authorize → NetSuite 404 / DNS failure                     | Account ID typo, or `_` not converted to `-`           | Re-check Account ID; normalise to lowercase/hyphens                         |
| `invalid_redirect_uri` on authorize                        | Redirect URI in record doesn't match exactly           | Copy from wizard banner; consistent trailing slash                          |
| `invalid_client` on token exchange                         | Integration Record disabled or Public Client unchecked | Admin enables integration + toggles Public Client on                        |
| Consent shows but user has no role/permission              | User logged in with Administrator role                 | User must pick the **Numa MCP Integration** role                            |
| `tools/list` works but every `tools/call` → 403            | Role lacks MCP Server Connection                       | Add permission to the custom role                                           |
| `CONCURRENCY_LIMIT_EXCEEDED` under load                    | Account concurrency cap (default 15) exceeded          | Add SuiteCloud Plus licenses, or reduce Numa-side parallelism               |
| Refresh fails after 100+ days with `invalid_grant`         | Refresh token hit 100-day sliding expiry               | User re-consents (normal for inactive connections)                          |
| After admin re-creates Integration Record, all users break | New client_id invalidates all existing refresh tokens  | Notify all users to re-consent; no way to preserve tokens across a recreate |
