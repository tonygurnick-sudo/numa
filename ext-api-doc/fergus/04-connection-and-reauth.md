# Fergus — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to Fergus.
> Auth type: **PAT** (Personal Access Token). OAuth exists but requires Fergus partner access.

---

## Auth Type: PAT (Self-Service) + OAuth (Partner-Only)

Fergus supports both PAT and OAuth 2.0, but OAuth requires Fergus to register you as a partner (no self-service app creation). **PAT is the only self-service option.**

---

## PAT Authentication (Current)

### 1. Generate a PAT in Fergus

1. Log in to Fergus at `https://app.fergus.com`
2. Navigate to: **Settings > Integrations > Fergus API**
   - Direct URL: `https://app.fergus.com/settings/integrations/fergusapi`
3. In the **"Personal Access Tokens (PAT)"** section, click **"Generate PAT"**
4. Copy the token immediately — it is shown only once
5. Store in Numa connector configuration

### 2. Token Format

| Property           | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Header             | `Authorization: Bearer {PAT}`                                      |
| Token format       | Opaque string with `fergPAT_` prefix                               |
| Token example      | `fergPAT_dfd871b6-0047-...`                                        |
| Lifetime           | **1 year** from creation                                           |
| Scopes/permissions | Full API access (inherited from the company account, not per-user) |
| Limit per account  | Not documented — test if multiple PATs are allowed                 |

### 3. Token Refresh / Rotation

| Property           | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no token extension                       |
| Can extend expiry? | No                                                                     |
| Rotation strategy  | Generate a new PAT before the old one expires, update connector config |

**Rotation timeline:**

| Days before expiry | Action                                 |
| ------------------ | -------------------------------------- |
| 30 days            | Warning in Numa admin settings         |
| 14 days            | Email notification to admin            |
| 0 days             | Token expires, connector stops working |

### 4. Programmatic PAT Management

There is a disconnect endpoint but no documented PAT management API:

```http
# Disconnect and revoke tokens
POST /disconnect
Authorization: Bearer {PAT}
```

PAT creation and listing must be done manually through the Fergus web UI at `app.fergus.com/settings/integrations/fergusapi`.

### 5. Reauthorization Triggers

| Trigger      | Detection                                 | Action                                               |
| ------------ | ----------------------------------------- | ---------------------------------------------------- |
| PAT expired  | 401 response                              | Prompt admin to generate new PAT in Fergus           |
| PAT revoked  | 401 response                              | Prompt admin to generate new PAT                     |
| Rate limited | 429 response with `x-ratelimit-*` headers | Back off and retry after `x-ratelimit-reset` seconds |

---

## OAuth 2.0 (Partner Access Only)

### Current Status

OAuth endpoints exist but are **not self-service**:

| Endpoint  | URL                                        | Status                                                 |
| --------- | ------------------------------------------ | ------------------------------------------------------ |
| Authorize | `https://auth.fergus.com/oauth2/authorize` | Exists, requires registered client_id                  |
| Token     | `https://auth.fergus.com/oauth2/token`     | Exists, returns `invalid_client` for unregistered apps |
| UserInfo  | `https://auth.fergus.com/oauth2/userInfo`  | Exists, requires valid access token                    |
| Revoke    | `https://auth.fergus.com/oauth2/revoke`    | Exists, returns `invalid_client` for unregistered apps |

Backend is **AWS Cognito** (confirmed from community MCP server config: `COGNITO_DOMAIN=auth.fergus.com`).

### How to Enable OAuth

1. Contact Fergus: `integrations@fergus.com`
2. Request: "Register Numa as an OAuth integration partner for auth.fergus.com"
3. If approved, receive:
   - `client_id`
   - `client_secret`
4. Store as company secrets in Numa
5. OAuth flow details (once registered):

| Property               | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| Grant type             | `authorization_code`                                   |
| Authorization URL      | `https://auth.fergus.com/oauth2/authorize`             |
| Token URL              | `https://auth.fergus.com/oauth2/token`                 |
| Refresh URL            | `https://auth.fergus.com/oauth2/token` (same endpoint) |
| Required scopes        | None documented (empty scopes object in spec)          |
| PKCE required?         | Unknown — test after registration                      |
| Token lifetime         | Unknown — test after registration                      |
| Refresh token behavior | Unknown — test after registration                      |

---

## Numa Connector Wiring

### Credentials to Store

| Key           | Type   | Description                           |
| ------------- | ------ | ------------------------------------- |
| `accessToken` | Secret | Personal Access Token (`fergPAT_...`) |

Note: No instance URL needed — Fergus is a single-tenant SaaS. Base URL is always `https://api.fergus.com`.

### Test Connection Sequence

```
1. GET https://api.fergus.com/version (with Bearer token) — verify credentials valid
   Expected: 200 with {"result":"success","data":{"version":"v1"}}
   401: PAT invalid or expired

2. GET https://api.fergus.com/my-company (with Bearer token) — verify company access
   Expected: 200 with company profile data
   401: auth issue
   403: insufficient permissions
```

### Rate Limiting

| Scope       | Limit        | Window   | Notes                                  |
| ----------- | ------------ | -------- | -------------------------------------- |
| Per company | 100 requests | 1 minute | Shared across all tokens and endpoints |

Response headers on every request:

```
x-ratelimit-limit: 100
x-ratelimit-remaining: 97
x-ratelimit-reset: 60
```

On 429: wait `x-ratelimit-reset` seconds before retrying.

### Important Request Rules

- **DELETE requests must NOT include `Content-Type` header.** Sending `Content-Type: application/json` on DELETE causes: `"Body cannot be empty when content-type is set to 'application/json'"`. Either omit `Content-Type` or send `{}`.
- All other requests use `Content-Type: application/json`.

### Auto-Reconnect Logic

```
on 401 response:
  # PAT-based — no auto-refresh possible
  mark connector as "needs reauthorization"
  notify admin: "Fergus token expired — generate new PAT at app.fergus.com/settings/integrations/fergusapi"

on 429 response:
  wait x-ratelimit-reset seconds
  retry request
```
