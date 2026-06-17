---
api_name: Actionstep
api_slug: actionstep
role: connection + reauthorization — OAuth flow, token refresh, revocation, reauth triggers, connector wiring
auth_type: OAuth 2.0 authorization-code ONLY — no PAT, no machine-to-machine/client-credentials; every call runs under a USER's context
authorize_url: https://go.actionstep.com/api/oauth/authorize (staging go.actionstepstaging.com)
token_url: https://api.actionstep.com/api/oauth/token (staging api.actionstepstaging.com)
token_response_carries: api_endpoint (region base URL — store + use for every API call) + orgkey (org id)
token_lifetimes: access 28800s (8h); refresh 21 days and ROTATES on every refresh — persist the new one
confidence: doc-based 2026-05-27; items tagged 🔬 are SANDBOX-CONFIRM
---

# Actionstep — Connection & Reauthorization

OAuth 2.0 **Authorization Code grant only** — no PAT, no machine-to-machine. Every call runs under a **user's** security context (no service-account / client-credentials mode). The token exchange returns a region-specific base URL (`api_endpoint`) and org id (`orgkey`) that must be stored with the connection.

## 1. Create the OAuth Application in Actionstep

API credentials are **issued by Actionstep**, not self-served from a developer portal.

1. Email `api@actionstep.com` (or your Actionstep account manager), request API credentials for your firm/integration.
2. Provide the **redirect URI** Numa will use (the value shown in the connector's admin wizard).
3. Actionstep issues + registers:

| Field                  | Value                            | Notes                                   |
| ---------------------- | -------------------------------- | --------------------------------------- |
| App / integration name | `Numa Integration`               |                                         |
| Redirect URI           | `<from Numa wizard>`             | Must match exactly                      |
| Scopes                 | resource names (space-separated) | e.g. `actions participants timerecords` |
| Client ID              | `<issued>`                       |                                         |
| Client Secret          | `<issued>`                       | Store securely (company vault)          |

**Staging vs production:** to test against an Actionstep **sandbox**, request staging credentials and point the wizard's auth/token URLs at `go.actionstepstaging.com` / `api.actionstepstaging.com`. Production uses `go.actionstep.com` / `api.actionstep.com`.

## 2. OAuth Flow

| Property          | Value                                            |
| ----------------- | ------------------------------------------------ |
| Grant type        | `authorization_code`                             |
| Authorization URL | `https://go.actionstep.com/api/oauth/authorize`  |
| Token URL         | `https://api.actionstep.com/api/oauth/token`     |
| Redirect URI      | `<from Numa wizard>`                             |
| Scopes            | space-separated resource names; `all` = wildcard |
| PKCE required?    | Not documented (🔬 confirm)                      |

**Authorization request:**

```http
GET https://go.actionstep.com/api/oauth/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=<REDIRECT_URI>&scope=actions%20participants%20timerecords&state=<RANDOM_STATE>
```

**Token exchange:**

```http
POST https://api.actionstep.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<AUTH_CODE>&redirect_uri=<REDIRECT_URI>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>
```

**Token response:** `{"access_token":"<JWT>","token_type":"bearer","expires_in":28800,"refresh_token":"<token>","api_endpoint":"https://ap-southeast-2.actionstep.com","orgkey":"<org>"}`

**Store `api_endpoint` + `orgkey`** with the connection. `api_endpoint` is the base URL for every subsequent API call (region-specific). 🔬 Confirm whether `token_type` is returned lowercase `bearer`.

## 3. Token Refresh

```http
POST https://api.actionstep.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>
```

| Property                | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Access token lifetime   | 28800s (8 hours)                                             |
| Refresh token lifetime  | 21 days                                                      |
| Refresh token rotation? | **Yes** — a new refresh token is returned; persist it        |
| Re-consent required?    | When the refresh token expires (≥21 days idle) or is revoked |

Because the refresh token **rotates**, always overwrite the stored refresh token with the one from each refresh response, or the next refresh fails.

## 4. Token Revocation

No dedicated revocation endpoint is documented (🔬 confirm). Treat refresh-token expiry/revocation as the end of the connection and trigger a full re-consent.

## 5. Reauthorization Triggers

| Trigger               | Detection               | Action                             |
| --------------------- | ----------------------- | ---------------------------------- |
| Access token expired  | 401 response            | Refresh using refresh token, retry |
| Refresh token expired | Refresh returns 4xx     | Full re-consent flow               |
| Scopes changed        | Admin edits scopes      | Full re-consent flow               |
| User revoked access   | 401/403 + refresh fails | Full re-consent flow               |

## Numa Connector Wiring

Credentials to store:
| Key | Type | Description |
| --- | --- | --- |
| `client_id` | company | OAuth client id (company vault, admin-supplied) |
| `client_secret` | company | OAuth client secret (company vault) |
| `access_token` | user | Per-user access token (8h) |
| `refresh_token` | user | Per-user refresh token (21d, **rotating**) |
| `api_endpoint` | conn | Region base URL (from token response; also a wizard field) |
| `orgkey` | conn | Organisation id (from token response) |

**Test connection sequence (Phase 2 smoke test):**

```
1. POST token endpoint with the auth code -> verify access_token + api_endpoint returned
2. GET {api_endpoint}/api/rest/actions?pageSize=1
     Authorization: Bearer <access_token>
     Accept: application/vnd.api+json
   -> expect 200 and a resource-keyed body: { "actions": [...], "meta": { "paging": {...} } }
```

Running this against a live sandbox closes the Phase 2 gate flagged in the questionnaire — do it before trusting the connector in production.

**Auto-reconnect logic:**

```
on 401 response:
  try refresh_token()            # 8h access tokens expire often
  persist the NEW refresh_token  # rotation — must overwrite
  if refresh fails (refresh token expired/revoked):
    trigger full re-consent flow (user reconnects via OAuth)
on 429 response:
  exponential backoff + jitter; serialise bursty calls (limits are session/orgkey-based)
```

## Sources

- https://docs.actionstep.com/authentication/
- https://docs.actionstep.com/api-scopes/
- https://docs.actionstep.com/api-limits/
