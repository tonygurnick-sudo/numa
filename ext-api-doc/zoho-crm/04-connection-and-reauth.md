---
api_name: Zoho CRM
api_slug: zoho-crm
doc: connection & reauth runbook (vendor-side; developer/ops — NOT loaded into agent context)
auth_type: OAuth 2.0 authorization_code (no PAT for the CRM API — OAuth is the only path)
auth_header_scheme: Zoho-oauthtoken {token} (NOT Bearer — Bearer → 401 INVALID_TOKEN). OAuth handshake itself is standard RFC 6749.
region_pinned: accounts host, console host, API host all share a region; token from one DC works only against that DC
ca_special_case: CA accounts host = accounts.zohocloud.ca (NOT accounts.zoho.ca)
confidence: verified 2026-04-23 unless tagged
---

# Zoho CRM — Connection & Reauthorization

> Setup runbook for connecting Numa to Zoho CRM. Detailed enough to automate setup or drive an admin step-by-step.

The API uses `Authorization: Zoho-oauthtoken {token}` (NOT `Bearer`) — build the header verbatim; `Bearer` → 401 `INVALID_TOKEN`.

## 1. Create the OAuth Application in Zoho

Admin does this once per Numa deployment, in the Zoho data centre matching the org they connect.

### Per-region hosts

| Region | Developer console                   | Accounts host                  | API host              |
| ------ | ----------------------------------- | ------------------------------ | --------------------- |
| AU     | `https://api-console.zoho.com.au/`  | `accounts.zoho.com.au`         | `www.zohoapis.com.au` |
| US     | `https://api-console.zoho.com/`     | `accounts.zoho.com`            | `www.zohoapis.com`    |
| EU     | `https://api-console.zoho.eu/`      | `accounts.zoho.eu`             | `www.zohoapis.eu`     |
| IN     | `https://api-console.zoho.in/`      | `accounts.zoho.in`             | `www.zohoapis.in`     |
| JP     | `https://api-console.zoho.jp/`      | `accounts.zoho.jp`             | `www.zohoapis.jp`     |
| CN     | `https://api-console.zoho.com.cn/`  | `accounts.zoho.com.cn`         | `www.zohoapis.com.cn` |
| **CA** | `https://api-console.zohocloud.ca/` | **`accounts.zohocloud.ca`** ⚠️ | `www.zohoapis.ca`     |

All three hosts live in the same region. A token minted at `accounts.zoho.com.au` works only against `www.zohoapis.com.au`.

> ⚠️ **Canada special case.** Accounts host = **`accounts.zohocloud.ca`** (NOT `accounts.zoho.ca`). Naive `accounts.zoho.{region}` substitution silently routes CA customers to a non-existent host — OAuth fails at DNS resolution before any error UI. Special-case CA explicitly. [VERIFIED 2026-05-19 — multi-dc.html]

### Steps

1. Log in to `https://api-console.zoho.{region}/` with a Zoho CRM admin account for the target org.
2. Click **Add Client** (or **Get Started** on a fresh console).
3. Pick **Server-based Applications** (Self Client is for headless single-org integrations — not what Numa uses).
4. Fill in:

| Field                    | Value                                                                                                        | Notes                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Client Name              | `Numa Integration`                                                                                           | shown to users on consent                                       |
| Homepage URL             | your Numa frontend URL (e.g. `https://arcanum-demo-tony.numa.arcanum.ai`)                                    | any HTTPS URL — not validated by Zoho                           |
| Authorized Redirect URIs | `https://{client-name}.numa.arcanum.ai/oauth/callback/zoho-crm` (copy the exact string from the Numa wizard) | **byte-for-byte match** — one char off → "Invalid Redirect URI" |

5. Save. Zoho returns: **Client ID** `1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (33 chars after `1000.`) and **Client Secret** 64-char hex (**shown once** — copy immediately).
6. Paste Client ID + Secret into the Numa admin wizard (Data Connectors → Zoho CRM).
7. Non-AU regions: in the wizard's **Advanced** section, swap `accounts.zoho.com.au` in authUrl/tokenUrl for the correct regional host.

## 2. OAuth Flow

| Property          | Value                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                                                                                                     |
| Authorization URL | `https://accounts.zoho.{region}/oauth/v2/auth` — **CA: `https://accounts.zohocloud.ca/oauth/v2/auth`**                                                   |
| Token URL         | `https://accounts.zoho.{region}/oauth/v2/token` — **CA: `https://accounts.zohocloud.ca/oauth/v2/token`**                                                 |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/zoho-crm`                                                                                          |
| Scopes            | `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ,ZohoCRM.coql.READ` (comma-delimited) |
| PKCE              | No                                                                                                                                                       |
| `access_type`     | `offline` — MANDATORY to receive a refresh_token                                                                                                         |
| `prompt`          | `consent` — recommended, forces fresh consent on reconnect                                                                                               |

### Authorization request

Numa redirects the user to:

```http
GET https://accounts.zoho.com.au/oauth/v2/auth?response_type=code&client_id=1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX&redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fzoho-crm&scope=ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ,ZohoCRM.coql.READ&access_type=offline&prompt=consent&state={random_state}
```

User signs in, approves the consent screen → Zoho redirects to `redirect_uri` with `?code={auth_code}&state={same_state}` (or `?error=...` on denial).

### Token exchange

```http
POST https://accounts.zoho.com.au/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={auth_code}&redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fzoho-crm&client_id={client_id}&client_secret={client_secret}
```

Response: `{"access_token":"1000.xxx.xxx","refresh_token":"1000.xxx.xxx","api_domain":"https://www.zohoapis.com.au","token_type":"Bearer","expires_in":3600}`

- **`api_domain`** = which Zoho API host to call — **save it** alongside the tokens in the user vault. Don't assume it matches the admin-configured region (the user may belong to a Zoho org in a different region).
- The `access_token` goes in the `Authorization: Zoho-oauthtoken {access_token}` header.
- `token_type:"Bearer"` is a lie — Zoho ignores it; the CRM API accepts only `Zoho-oauthtoken`.

## 3. Token Refresh

Before the access token expires (1h):

```http
POST https://accounts.zoho.com.au/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={refresh_token}&client_id={client_id}&client_secret={client_secret}
```

Response: `{"access_token":"1000.new.new","api_domain":"https://www.zohoapis.com.au","token_type":"Bearer","expires_in":3600}`

| Property               | Value                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| Access token lifetime  | 1 hour (3600s)                                                                  |
| Refresh token lifetime | unlimited until revoked                                                         |
| Refresh token rotation | **No** — refresh response returns no new refresh token                          |
| Re-consent required?   | when admin changes requested scopes (app-level)                                 |
| Refresh token limit    | 20 active refresh tokens per user per app; 21st issuance invalidates the oldest |

**No rotation implication:** the refresh token from first consent is the ONLY one. Lose it → user must reconnect. Store carefully.

## 4. Token Revocation

Programmatic: `POST https://accounts.zoho.com.au/oauth/v2/token/revoke` form `token={refresh_token_to_revoke}` → `{"status":"success"}`.
Zoho UI: user revokes at `accounts.zoho.{region}/home#connected-apps` (Numa has no visibility into this).
Either way, subsequent calls with revoked tokens return `INVALID_TOKEN`.

## 5. Reauthorization Triggers

| Trigger                                | Detection                                     | Action                                                               |
| -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Access token expired                   | 401 `INVALID_TOKEN` on first API call         | backend refreshes; retry once                                        |
| Refresh token revoked                  | refresh returns 400 `invalid_code` or 401     | mark disconnected; prompt full re-consent                            |
| Refresh token invalidated (>20 issued) | refresh 400                                   | same                                                                 |
| Scopes changed at app level            | any call → 403 `OAUTH_SCOPE_MISMATCH`         | admin updates scopes in `api-console.zoho.{region}`; user reconnects |
| User revoked via Zoho UI               | 401 on refresh AND API calls                  | disconnect; full re-consent                                          |
| Wrong-region host                      | 401 `INVALID_TOKEN` (misleading — not expiry) | check admin authUrl/tokenUrl match the user's Zoho region            |

## 6. Test Connection Sequence (vendor-side)

```
1. GET https://accounts.zoho.{region}/             → 200 (reachability) (CA: GET https://accounts.zohocloud.ca/)
2. POST /oauth/v2/token (grant=refresh_token)      → 200 + fresh access_token
3. GET https://{api_domain}/crm/v8/org             → 200 + { org:[...] }
   Header: Authorization: Zoho-oauthtoken {access_token}
   If this 401s despite a valid refresh, the regional host is wrong.
```

`{api_domain}` comes back in the token response — use that exact value, don't compute one.

### Auto-reconnect logic (recommended)

```
on 401 INVALID_TOKEN on an API call:
    try refresh_token()
    if refresh 200: retry original call once
    if refresh 4xx: mark user disconnected — full re-consent required
```

No transient retries — Zoho refresh tokens don't silently expire, so a 4xx from refresh means the refresh token is genuinely bad (revoked, or the per-user-per-app active-token cap rolled over).

> Numa-internal vault/registry/key-name details have moved to the Numa connector skill — this file is API-vendor-side only.

## 7. Programmatic Token Management

Zoho exposes no "list my tokens" or "create PAT" API — OAuth is the only path; everything programmatic is the three endpoints above (`auth`, `token`, `token/revoke`). To change scopes: (1) admin updates scopes in `api-console.zoho.{region}`; (2) user does full re-consent in Numa.
