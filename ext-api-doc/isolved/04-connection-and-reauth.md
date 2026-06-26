---
api_name: isolved People Cloud
api_slug: isolved
base_url: https://{tenant}.myisolved.com/rest/api   (PER-TENANT — from the admin's Instance URL)
urls: relative preferred (`/employees`) once the Instance URL is wired; absolute per-tenant on fallback (see 03)
call_surface: HTTP via `numa integrations request` (connector=isolved)
auth: OAuth 2.0 CLIENT-CREDENTIALS — company-level Bearer minted SERVER-SIDE from client_id/client_secret; re-minted on expiry; NO per-user OAuth, NO refresh token, NO chat credential card
confidence: the auth lifecycle (company credential → client-credentials mint → re-mint on expiry) is corroborated across third-party integrators; the exact token-endpoint path, token lifetime, and error bodies are [VERIFY WITH PARTNER DOCS]. The backend adapter is NOT yet built (see 03 §"Implementation status"). NOT live-validated.
---

# isolved — Connection & Reauthorization Guide

isolved uses OAuth 2.0 **client-credentials**. There is **NO per-user OAuth** — no authorize URL, no
consent screen, no redirect, no refresh token, and **no chat credential card**. Numa mints a
**company-level** Bearer token **server-side** from the admin's `client_id`/`client_secret` and
re-mints it on expiry. Detailed enough to automate connector setup via script.

## Auth Type: OAuth 2.0 client-credentials (company-level service credential)

| Property         | Value                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Grant type       | `client_credentials`                                                                                            |
| Credential       | a **company-level** `client_id` + `client_secret` (the partner's isolved API Application)                       |
| Per-user consent | **none** — one credential serves all users; no per-user redirect/grant                                          |
| Token endpoint   | `{instance}/rest/api/token` — built from the per-tenant Instance URL; **exact path [VERIFY WITH PARTNER DOCS]** |
| Token request    | POST `grant_type=client_credentials` + `client_id`/`client_secret` (form fields or HTTP Basic [VERIFY])         |
| Token response   | `{ "access_token": "...", "token_type": "Bearer", "expires_in": <s> }` — exact shape/lifetime [VERIFY]          |
| Data-call header | `Authorization: Bearer {access_token}` — backend-injected                                                       |
| Refresh          | **none** — client-credentials has no refresh token; **re-mint** from `client_id`/`client_secret`                |

Every API call carries `Authorization: Bearer {access_token}`, minted + injected by the backend.
Agents never set that header and never see the token. Users never paste anything into chat.

## 1. Obtain the company credential (isolved Network — partner-level, one-time)

The credential is issued by isolved to the **partner integration**, not per customer:

1. Join the **isolved Network Partner** program.
2. Submit the **API Questionnaire** to register this integration.
3. isolved registers an **API Application** and issues a **`client_id`** + **`client_secret`**, and
   configures the integration's **allowed-methods whitelist** (which objects/methods it may call).

## 2. Admin connection (Numa side — once)

There is no per-user flow. The admin connects once:

1. **Integrations → isolved → wizard.**
2. Paste the **`client_id`** (Client ID) and **`client_secret`** (Client Secret).
3. Enter the **Instance URL** (`https://{tenant}.myisolved.com`). The API base is that host +
   `/rest/api`; the token endpoint is `{instance}/rest/api/token` [VERIFY path].
4. Save → the company credential + Instance URL are written to the company vault (03 §5).

> **No per-user step.** Once the admin has connected, every user in the client account uses the same
> company-level token. A user who "isn't connected" is not a thing here — if calls fail it's the
> company credential, the Instance URL, or the per-client grant (below), never a per-user consent.

## 3. Per-client grant (customer's isolved tenant — required, per Client Code)

Before any call against a customer's Client Code succeeds, the customer's **isolved admin** must:

1. **Security → Partner Users → Client Access** → add the partner user's access to the **Client
   Code**.
2. **Production Utilities → Refresh System Data**.

Until both are done, calls against that Client Code 403/404 (01d). Repeat per Client Code in the
tenant.

## 4. Token lifetime / automatic re-mint (no refresh token)

| Property            | Value                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token expiry | a typical `expires_in` (e.g. 3600s) — exact value **[VERIFY WITH PARTNER DOCS]**                                                                     |
| Re-mint trigger     | on/near expiry, the backend re-runs the client-credentials mint with the company `client_id`/`client_secret`                                         |
| Refresh token       | **none** — client-credentials issues no refresh token; "refresh" = re-mint                                                                           |
| Re-mint request     | POST `{instance}/rest/api/token` `grant_type=client_credentials` + `client_id`/`client_secret`                                                       |
| Re-mint failure     | non-2xx from the token endpoint → no token → request surfaces a credential error → **admin** fixes the company credential (NOT a per-user reconnect) |

> Because there's no refresh token and no per-user state, token management is simpler than an
> authorization-code connector: the backend just re-mints from the company secret whenever the cached
> token is missing/expired. The only thing that can permanently break minting is the **company
> credential** itself (rotated/disabled/revoked) or a wrong **Instance URL / token path**.

## 5. Reauthorization triggers

There is no per-user grant to expire, so "reauthorization" means an **admin** fixes the company
credential, the Instance URL, or the per-client grant — never a user reconnect.

| Trigger                                                    | Detection                           | Action                                                                                  |
| ---------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| Access token expired (normal)                              | pre-empted by re-mint               | none — automatic re-mint from the company secret                                        |
| Company `client_id`/`client_secret` wrong/disabled/rotated | mint fails → 401 / credential error | admin updates the company credential in the connector config; **no per-user reconnect** |
| Wrong Instance URL / token path                            | mint fails, or everything 401/404   | admin fixes the Instance URL; verify the token path `[VERIFY WITH PARTNER DOCS]`        |
| Per-client access not granted                              | 403/404 for one Client Code         | customer isolved admin: Client Access grant + Refresh System Data (§3)                  |
| Method not in allowed-methods grant                        | 403/404 on a specific object/method | isolved adjusts the integration's grant (partner/isolved-side) — not a Numa action      |
| Rate limited                                               | 429 (limits unpublished)            | backoff with jitter; space calls                                                        |

## 6. Failure diagnosis — 401 vs 403/404 (they mean different things)

- **401 Unauthorized** — the **server-side token mint failed**: the company `client_id`/`client_secret`
  is wrong/disabled/revoked, or the Instance URL / token path is wrong. **Fix = admin checks the
  company credential / Instance URL.** Not fixable by retrying, and **not** a per-user reconnect.
- **403 Forbidden / 404 Not Found** — the token is fine, but either (a) the integration's
  **allowed-methods grant** doesn't include that object/method, or (b) the \*\*per-client access grant
  - Refresh System Data** hasn't been done for that Client Code. **Fix = the grant / per-client
    setup**, not the credential. **Never reconnect-loop on 403/404.\*\*
- **422** — validation (e.g. a client-specific code that doesn't exist, or an out-of-window benefit
  enrollment). Fix the body/code (resolve codes from live records, 01a/01c).
- **429** — rate limited (limits unpublished). Back off with jitter.

Raw error **bodies** are undocumented `[VERIFY WITH PARTNER DOCS]` — diagnose from the status code
first.

## 7. Disconnect semantics

| Action                | What is removed                                                     | Effect                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin disconnects** | the company credential (`client_id`/`client_secret`) + Instance URL | connector unconfigured for everyone — no company credential means no token mint, so **all** users lose access immediately. Re-adding requires re-entering the credential + Instance URL. |
| (No user disconnect)  | —                                                                   | there is no per-user grant to remove; access is entirely company-level                                                                                                                   |

## Numa Connector Wiring

### Credentials stored (company-level)

| Key                           | Type   | Description                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------------ |
| `client_id` / `client_secret` | secret | the partner's isolved API Application credential (client-credentials)    |
| `instance_url`                | config | `https://{tenant}.myisolved.com` — per-tenant host; base = + `/rest/api` |
| `oauth_adapter`               | config | `isolved` — selects the client-credentials mint path (03 §6)             |

- **No per-user secret** (no `oauth-isolved` user entry, no refresh token).
- The minted access token is cached server-side with its expiry and re-minted on demand.
- `_resolve_connector_base_url` reads `instance_url` (priority `api_endpoint` → `instance_url` →
  `base_url`), so the agent can issue relative `/employees?...` URLs once it's persisted (03 §5).

### Test connection sequence

```
1. (internal) mint a token: POST {instance}/rest/api/token  grant_type=client_credentials
   200: token minted → company credential + Instance URL OK
   non-2xx: mint failed → admin checks client_id/client_secret + Instance URL/token path

2. GET /employees?employment_status=ACTIVE   (relative; backend injects Bearer)
   200: real-data access proven (grant + per-client setup OK)
   401: token mint failed (company credential) → admin fix
   403/404: allowed-methods grant missing OR per-client Client Access/Refresh not done (§3)
```

### Auto-reconnect logic

```
before each request:
  token = mint-or-reuse(company client_id/client_secret, {instance}/rest/api/token)
  # re-mints automatically when the cached token is missing/expired (no refresh token)

on mint failure / 401:
  # company credential wrong/disabled, or Instance URL/token path wrong — NOT per-user
  surface an ADMIN credential error → admin updates client_id/client_secret or Instance URL
  # there is NO per-user OAuth redirect and NO chat credential card

on 403/404:
  do NOT reconnect-loop — the integration lacks the allowed-methods grant,
  or the per-client Client Access grant + Refresh System Data isn't done.
  Point at the grant / per-client setup (§3).

on 429:
  backoff with jitter (2s → 10s → 30s); limits unpublished — never busy-retry.
```

## Events & future surfaces

- **Webhooks:** none evidenced `[VERIFY WITH PARTNER DOCS]` — change detection is polling-first, and
  there's no confirmed change/updated filter (only `employment_status`), so syncs likely mean
  full-list + client-side diff (01d). For recurring needs, suggest a Numa scheduled agent.
- **Implementation status:** the client-credentials mint adapter (`oauth_adapter == 'isolved'`) and
  OAuthWizard Instance-URL collection are **not yet built** — see `03-connector-setup.md`
  §"Implementation status". This lifecycle describes the **intended** behaviour.

_Auth model corroborated across third-party isolved integrators (Finch, Merge, CozyROC, RoboMQ) +
isolved Network partner material; the token-endpoint path, token lifetime, and error bodies are
[VERIFY WITH PARTNER DOCS]. Registry/native-list facts from `connectorRegistry.ts`,
`infra/config/connectors.ts`, `user_profile.py`; backend gaps from `oauth-auth-handler/index.ts`,
`oauth_tools.py`, `connect_tools.py`. **No authenticated call has been made** — confirm every
[VERIFY WITH PARTNER DOCS] item against the login-walled `/rest` reference before first customer use._
