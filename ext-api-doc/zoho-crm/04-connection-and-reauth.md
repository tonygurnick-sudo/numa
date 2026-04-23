# Zoho CRM — Connection & Reauthorization Guide

> Setup runbook for connecting Numa to Zoho CRM.
> **Auth type:** OAuth 2.0 (Zoho does not offer PAT for CRM API.)
> Detailed enough to automate connector setup via script or drive an admin step-by-step.

---

## Auth Type: OAuth 2.0 (authorization_code)

Zoho uses its own bearer scheme on the API side — `Authorization: Zoho-oauthtoken {token}` — but the OAuth handshake itself is standard RFC 6749. The backend injects the `Zoho-oauthtoken` header automatically (see `connectorRegistry.ts` → `authHeaderScheme`).

---

## 1. Create the OAuth Application in Zoho

The admin does this once per Numa deployment. The app is registered in the Zoho data centre that matches the org they want to connect.

### Per-region developer consoles

| Region | Developer console                  | Accounts host          | API host              |
| ------ | ---------------------------------- | ---------------------- | --------------------- |
| AU     | `https://api-console.zoho.com.au/` | `accounts.zoho.com.au` | `www.zohoapis.com.au` |
| US     | `https://api-console.zoho.com/`    | `accounts.zoho.com`    | `www.zohoapis.com`    |
| EU     | `https://api-console.zoho.eu/`     | `accounts.zoho.eu`     | `www.zohoapis.eu`     |
| IN     | `https://api-console.zoho.in/`     | `accounts.zoho.in`     | `www.zohoapis.in`     |
| JP     | `https://api-console.zoho.jp/`     | `accounts.zoho.jp`     | `www.zohoapis.jp`     |
| CN     | `https://api-console.zoho.com.cn/` | `accounts.zoho.com.cn` | `www.zohoapis.com.cn` |

All three hosts (console, accounts, API) live in the same region. A token minted at `accounts.zoho.com.au` only works against `www.zohoapis.com.au`.

### Steps

1. Log in to `https://api-console.zoho.{region}/` with a Zoho CRM admin account for the target org.
2. Click **Add Client** (or **Get Started** on a fresh console).
3. Pick **Server-based Applications** as the client type. (Self Client is for headless, single-org integrations — not what Numa uses.)
4. Fill in:

   | Field                    | Value                                                                                                                                                                                      | Notes                                                              |
   | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
   | Client Name              | `Numa Integration`                                                                                                                                                                         | Shown to users on consent                                          |
   | Homepage URL             | Your Numa frontend URL (e.g. `https://arcanum-demo-tony.numa.arcanum.ai`)                                                                                                                  | Any HTTPS URL — not validated by Zoho                              |
   | Authorized Redirect URIs | `https://{client-name}.numa.arcanum.ai/oauth/callback/zoho-crm` (copy the exact string shown in the Numa wizard — Zoho does byte-for-byte matching, one char off = "Invalid Redirect URI") | **Must match exactly** what the wizard shows; copy from the wizard |

5. Save. Zoho returns:
   - **Client ID** — typically `1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (33 characters after `1000.`)
   - **Client Secret** — 64-char hex string. **Shown once** — copy immediately.

6. Paste Client ID + Client Secret into the Numa admin wizard (Data Connectors → Zoho CRM).
7. For non-AU regions: in the wizard's **Advanced** section, swap `accounts.zoho.com.au` in the authUrl and tokenUrl for the correct regional host.

---

## 2. OAuth Flow

| Property          | Value                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Grant type        | `authorization_code`                                                                                                                   |
| Authorization URL | `https://accounts.zoho.{region}/oauth/v2/auth`                                                                                         |
| Token URL         | `https://accounts.zoho.{region}/oauth/v2/token`                                                                                        |
| Redirect URI      | `https://{client-name}.numa.arcanum.ai/oauth/callback/zoho-crm`                                                                        |
| Scopes            | `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ,ZohoCRM.coql.READ` |
| PKCE required?    | No                                                                                                                                     |
| Access type       | `offline` (MANDATORY to receive a refresh_token)                                                                                       |
| Prompt            | `consent` (recommended — forces fresh consent on reconnect)                                                                            |

### Authorization request

Numa builds and redirects the user to:

```http
GET https://accounts.zoho.com.au/oauth/v2/auth?
  response_type=code&
  client_id=1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX&
  redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fzoho-crm&
  scope=ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ,ZohoCRM.coql.READ&
  access_type=offline&
  prompt=consent&
  state={random_state}
```

The user signs into Zoho, reviews the scope consent screen, and approves. Zoho redirects back to our `redirect_uri` with `?code={auth_code}&state={same_state}` — or `?error=...` on denial.

### Token exchange

Numa backend exchanges the auth code for tokens:

```http
POST https://accounts.zoho.com.au/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={auth_code}&
redirect_uri=https%3A%2F%2Farcanum-demo-tony.numa.arcanum.ai%2Foauth%2Fcallback%2Fzoho-crm&
client_id={client_id}&
client_secret={client_secret}
```

### Token response

```json
{
  "access_token": "1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "refresh_token": "1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "api_domain": "https://www.zohoapis.com.au",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**`api_domain`** tells you which Zoho API host to call — **save it** alongside the tokens in the user vault. Don't assume it matches the region the admin configured (the user may belong to a different Zoho org in a different region).

The access token is what you put in the `Authorization: Zoho-oauthtoken {access_token}` header.

`token_type` in the response says `"Bearer"` but that's a lie — Zoho ignores it and the actual CRM API only accepts `Zoho-oauthtoken`.

---

## 3. Token Refresh

Before the access token expires (1h), exchange the refresh token for a new access token:

```http
POST https://accounts.zoho.com.au/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={refresh_token}&
client_id={client_id}&
client_secret={client_secret}
```

**Response:**

```json
{
  "access_token": "1000.new.new",
  "api_domain": "https://www.zohoapis.com.au",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

| Property               | Value                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Access token lifetime  | 1 hour (3600s)                                                                                |
| Refresh token lifetime | Unlimited until revoked                                                                       |
| Refresh token rotation | **No** — the refresh response does NOT return a new refresh token                             |
| Re-consent required?   | When admin changes requested scopes (app-level)                                               |
| Refresh token limit    | Zoho caps at 20 active refresh tokens per user per app. 21st issuance invalidates the oldest. |

**Implication of no rotation:** the refresh token you got at first consent is the ONLY refresh token. Lose it and the user must reconnect. Store it carefully.

---

## 4. Token Revocation

Two paths:

**Revoke programmatically:**

```http
POST https://accounts.zoho.com.au/oauth/v2/token/revoke
Content-Type: application/x-www-form-urlencoded

token={refresh_token_to_revoke}
```

**Response:** `{ "status": "success" }` on success.

**Revoke from Zoho UI:** User can revoke at `accounts.zoho.{region}/home#connected-apps`. Numa has no visibility into this.

In both cases, subsequent calls with the revoked tokens return `INVALID_TOKEN`.

---

## 5. Reauthorization Triggers

| Trigger                                | Detection                                           | Action                                                               |
| -------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| Access token expired                   | HTTP 401 `INVALID_TOKEN` on first API call          | Backend refreshes via refresh_token; retry once                      |
| Refresh token revoked                  | Refresh call returns 400 with `invalid_code` or 401 | Mark user as disconnected; prompt full re-consent flow               |
| Refresh token invalidated (>20 issued) | Refresh 400                                         | Same as above                                                        |
| Scopes changed at app level            | Any API call returns 403 `OAUTH_SCOPE_MISMATCH`     | Admin updates scopes in `api-console.zoho.{region}`; user reconnects |
| User revoked via Zoho UI               | HTTP 401 on refresh AND API calls                   | Disconnect; full re-consent                                          |
| Token used against wrong region host   | HTTP 401 `INVALID_TOKEN` (misleading — not expiry)  | Check admin-configured authUrl/tokenUrl match the user's Zoho region |

---

## 6. Numa Connector Wiring

### Credentials to store

**Company vault entry** (`oauth-client-zoho-crm`, written by the admin wizard):

| Key                  | Type   | Description                                      |
| -------------------- | ------ | ------------------------------------------------ |
| `client_id`          | string | From Zoho API Console                            |
| `client_secret`      | string | From Zoho API Console (one-time display)         |
| `auth_url`           | string | `https://accounts.zoho.{region}/oauth/v2/auth`   |
| `token_url`          | string | `https://accounts.zoho.{region}/oauth/v2/token`  |
| `scopes`             | string | Comma-separated scope list                       |
| `extra_auth_params`  | JSON   | `{"access_type":"offline","prompt":"consent"}`   |
| `auth_header_scheme` | string | `Zoho-oauthtoken` (auto-persisted from registry) |
| `display_name`       | string | `Zoho CRM`                                       |
| `icon`               | string | `bi-person-rolodex`                              |

**Per-user vault entry** (`oauth-zoho-crm`, written on user connect):

| Key             | Type   | Description                                               |
| --------------- | ------ | --------------------------------------------------------- |
| `access_token`  | string | Current access token (refreshed every ~55min by backend)  |
| `refresh_token` | string | Long-lived refresh token                                  |
| `expires_at`    | ISO dt | Computed from `expires_in`; used to decide refresh timing |
| `api_domain`    | string | From token response — actual API host for this user       |
| `user_email`    | string | For display only                                          |
| `connected_at`  | ISO dt | Audit                                                     |

### Test connection sequence

```
1. GET https://accounts.zoho.{region}/                       → 200 (basic reachability)
2. POST /oauth/v2/token (grant=refresh_token)                → 200 + fresh access_token
3. GET https://{api_domain}/crm/v8/org                       → 200 + { org: [...] }
   Header: Authorization: Zoho-oauthtoken {access_token}
   If this returns 401 despite a valid refresh, the regional host is wrong.
```

### Auto-reconnect logic

```
on 401 INVALID_TOKEN on an API call:
    try refresh_token()
    if refresh returns 200:
        retry original call once
    if refresh returns 4xx:
        mark user disconnected
        raise "zoho-crm-reauth-required" — UI prompts user to reconnect
```

No transient retries — Zoho refresh tokens don't silently expire, so a 4xx from refresh means the refresh token is genuinely bad (revoked or the 20-token limit rolled over).

---

## 7. Programmatic Token Management

Zoho does NOT expose a user-facing "list my tokens" or "create new PAT" API — OAuth is the only path. Everything programmatic happens through the three endpoints above (`auth`, `token`, `token/revoke`).

If the user asks how to change scopes, the only path is:

1. Admin updates scopes in `api-console.zoho.{region}`.
2. User goes through full re-consent in Numa.

---

_Generated from `00-api-investigation-questionnaire.md` Phase 2._
