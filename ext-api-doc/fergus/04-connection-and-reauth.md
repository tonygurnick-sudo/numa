---
api_name: Fergus
api_slug: fergus
base_url: https://api.fergus.com (single-tenant SaaS — always this host; no instance URL needed)
route_prefix_injected_by_connector: /api/partner
path_version_segment: none ("v1" is a label, never a path segment; /v1/... → 404)
auth: Bearer {token} — PAT (self-service, current) + OAuth 2.0 (partner-only)
field_casing: camelCase
id_format: integer
call_surface: HTTP via `numa integrations request` (NOT a file-store connector)
confidence: every fact live-API-confirmed 2026-04-04 unless tagged [INFERRED] or [VERIFIED <date>]
---

# Fergus — Connection & Reauthorization

Connecting Numa to Fergus. Fergus supports PAT and OAuth 2.0, but OAuth requires Fergus to register you as a partner (no self-service app creation). **PAT is the only self-service option.**

## PAT Authentication (current)

### 1. Generate a PAT in Fergus

1. Log in at `https://app.fergus.com`.
2. Go to **Settings > Integrations > Fergus API** (direct: `https://app.fergus.com/settings/integrations/fergusapi`).
3. In **"Personal Access Tokens (PAT)"**, click **"Generate PAT"**.
4. Copy the token immediately — shown only once.
5. Store in Numa connector configuration.

### 2. Token format

| Property          | Value                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Header            | `Authorization: Bearer {PAT}`                                                                                               |
| Format            | opaque string, `fergPAT_` prefix                                                                                            |
| Example           | `fergPAT_dfd871b6-0047-...`                                                                                                 |
| Lifetime          | ~1 year from creation [INFERRED — one observed PAT (2026-04-04 → 2027-04-04); not documented on Fergus's side; approximate] |
| Scopes            | full API access (company account, not per-user)                                                                             |
| Limit per account | not documented — test if multiple PATs allowed                                                                              |

### 3. Refresh / rotation

| Property           | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Refresh mechanism  | None — no refresh tokens, no extension                             |
| Can extend expiry? | No                                                                 |
| Rotation           | generate a new PAT before the old expires, update connector config |

Rotation timeline: 30 days before expiry → warning in Numa admin settings; 14 days → email to admin; 0 days → token expires, connector stops working.

### 4. Programmatic PAT management

Disconnect endpoint exists but no documented PAT management API: `POST /disconnect` with `Authorization: Bearer {PAT}` revokes tokens. PAT creation/listing must be done manually in the Fergus UI at `app.fergus.com/settings/integrations/fergusapi`.

### 5. Reauthorization triggers

| Trigger      | Detection                     | Action                                            |
| ------------ | ----------------------------- | ------------------------------------------------- |
| PAT expired  | 401                           | prompt admin to generate new PAT in Fergus        |
| PAT revoked  | 401                           | prompt admin to generate new PAT                  |
| Rate limited | 429 + `x-ratelimit-*` headers | back off, retry after `x-ratelimit-reset` seconds |

## OAuth 2.0 (partner access only)

Endpoints exist but are NOT self-service:
| Endpoint | URL | Status |
|---|---|---|
| Authorize | `https://auth.fergus.com/oauth2/authorize` | exists, requires registered client_id |
| Token | `https://auth.fergus.com/oauth2/token` | exists, returns `invalid_client` for unregistered apps |
| UserInfo | `https://auth.fergus.com/oauth2/userInfo` | exists, requires valid access token |
| Revoke | `https://auth.fergus.com/oauth2/revoke` | exists, returns `invalid_client` for unregistered apps |

Backend is AWS Cognito (community MCP config: `COGNITO_DOMAIN=auth.fergus.com`).

To enable: contact `integrations@fergus.com`, request "Register Numa as an OAuth integration partner for auth.fergus.com". If approved, receive `client_id` + `client_secret`; store as company secrets in Numa.
OAuth flow (once registered): grant `authorization_code`; Authorize `https://auth.fergus.com/oauth2/authorize`; Token + Refresh `https://auth.fergus.com/oauth2/token`; required scopes none documented (empty scopes object); PKCE/token lifetime/refresh behavior all unknown — test after registration.

## Numa Connector Wiring

### Credentials to store

| Key           | Type   | Description                           |
| ------------- | ------ | ------------------------------------- |
| `accessToken` | Secret | Personal Access Token (`fergPAT_...`) |

No instance URL needed — single-tenant SaaS; base URL always `https://api.fergus.com`.

### Test connection sequence

1. `GET https://api.fergus.com/version` (Bearer token) — verify credentials. 200 with `{"message":"<version-string>"}` [VERIFIED 2026-05-19 against OpenAPI spec — response is `{"message":string}`, NOT a `{result,data}` envelope]. 401: PAT invalid/expired.
2. `GET https://api.fergus.com/company` (Bearer token) — verify company access. 200 with company profile (schema `GetCompanyResponse`); endpoint is `/company`, `/my-company` does NOT exist [VERIFIED 2026-05-19]. 401: auth issue. 403: insufficient permissions.

### Rate limiting

Per company: 100 requests / 1 minute, shared across all tokens and endpoints. Headers on every response: `x-ratelimit-limit:100`, `x-ratelimit-remaining:97`, `x-ratelimit-reset:60`. On 429: wait `x-ratelimit-reset` seconds before retrying.

### Important request rules

- DELETE must NOT include `Content-Type` header. Sending `Content-Type: application/json` on DELETE causes `"Body cannot be empty when content-type is set to 'application/json'"`. Omit `Content-Type` or send `{}`.
- All other requests use `Content-Type: application/json`.

### Auto-reconnect logic

- on 401: PAT-based, no auto-refresh possible → mark connector "needs reauthorization" → notify admin: "Fergus token expired — generate new PAT at app.fergus.com/settings/integrations/fergusapi".
- on 429: wait `x-ratelimit-reset` seconds → retry request.
