---
api_name: HireHop
api_slug: hirehop
doc: connection-and-reauth (credential generation & rotation)
auth: API key (static per-user token) — NOT OAuth, no OAuth flow. Prefer header X-TOKEN
base_url: per-tenant credential (e.g. https://myhirehop.com | https://hirehop.net | https://myhirehop.co.uk | vanity domain). NEVER www.hirehop.com (403s API clients)
identity: token + base_url together identify the company; no account/company id param
confidence: MEDIUM — documented from HireHop docs/getting-started guide, NOT live-tested
---

# HireHop — Connection & Reauthorization Guide

Setup, token generation, storage, and rotation. Auth: **API Key (static per-user token)** — no OAuth, no client ID/secret, no redirect URI, no scopes, no refresh flow. Maps to registry `authType: 'api-key'` with fields `api_token` (password) + `base_url` (url) — see `03`.

## 1. Generate an API Token in HireHop

The customer (a HireHop admin) generates it from within HireHop:

1. Log in at the customer's host (`https://myhirehop.com`, `https://hirehop.net`, or `https://myhirehop.co.uk` — whichever they use).
2. Enter **Admin mode** → **Settings → Users** tab.
3. **Strongly recommended:** create a dedicated **"API" user** (e.g. `Numa API`) rather than reusing a person's interactive login (see §3 for why — token stability). Give it only the role/permissions the integration needs (the token inherits the user's permissions).
4. Select that user → open its **Menu** → click **API Token**.
5. Copy the token immediately and store it in the Numa connector config.

A token is unique per user; regenerating from the same menu issues a new token and invalidates the old one. If UI labels differ between releases, the canonical reference is the getting-started guide (`https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/`).

**Base URL:** must be the customer's actual HireHop host — **not** `www.hirehop.com` (marketing site, 403s API clients). Same host they log in at: `https://myhirehop.com`/`https://hirehop.net`/`https://myhirehop.co.uk`, or a vanity/custom domain proxying to the same backend.

## 2. Token Format

| Property           | Value                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Preferred header   | `X-TOKEN: {token}`                                                                                                                   |
| Alt. locations     | `?token={URL-ENCODED}` (query), `token` (POST form field), `"token"` (JSON body)                                                     |
| Token format       | Opaque base64-ish string containing `=`,`+`,`-` (e.g. `dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn`)                                       |
| Lifetime           | "Never expires" by time — **but silently invalidated** on the owning user's next interactive login, or on email/password change (§3) |
| Scopes/permissions | Inherited from the owning HireHop user's role — no per-token scopes                                                                  |
| Tenancy            | Token + `base_url` identify the company; no separate account/company ID param                                                        |

**Prefer the header.** A query-string token MUST be URL-encoded (`=`,`+`,`-`). `X-TOKEN` avoids the encoding pitfall and keeps the secret out of URLs/access logs:
`X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn` + `Content-Type: application/json` (only when sending a JSON body).

## 3. Token Refresh / Rotation

| Property           | Value                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no token-extension API                                               |
| Can extend expiry? | N/A — does not expire by time                                                                      |
| Rotation           | Regenerate from Settings → Users → (API user) → Menu → API Token, then update the connector config |
| Force-invalidate   | Change the API user's password (or have that user log in) — both immediately kill the token        |

### The silent-invalidation trap

The token is **silently invalidated** the moment the owning user (a) logs in interactively through the web UI, OR (b) changes their email or password. After either, the next API call returns **401/403** with no other warning. This is the single most common HireHop integration failure.
**Mitigation (do at onboarding):** dedicate a **non-interactive "API" user** whose token the connector uses, and tell the customer not to log in as that user or change its credentials — keeps the token stable indefinitely.

### Rotation timeline

| Trigger                            | Action                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| Suspected leak                     | Regenerate the token (or change the API user's password), update Numa |
| API user credentials changed       | Token is dead → regenerate immediately                                |
| Connector starts returning 401/403 | Token was invalidated → prompt admin to regenerate and re-enter       |

**Programmatic token management: none.** No API to list, create, or revoke tokens — UI-only via Settings → Users → (user) → Menu → API Token. (Webhook subscriptions are likewise UI-only.)

## 4. Reauthorization Triggers

| Trigger                        | Detection                       | Action                                                                   |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------ |
| Token invalidated              | 401/403 response                | Prompt admin to regenerate in HireHop and re-enter                       |
| User re-logged in / pw changed | 401/403 (silent, §3)            | Same — regenerate; advise dedicating a non-interactive API user          |
| Insufficient permissions       | Application error / 403         | Check the API user's HireHop role; the token inherits its permissions    |
| Rate limited                   | HTTP 429 + body `{"error":327}` | Back off; respect 60/min + 3/s; honour `X-RateLimit-Available` (Unix ts) |

## Numa Connector Wiring

### Credentials to Store

| Key         | Type     | Description                                                                                  |
| ----------- | -------- | -------------------------------------------------------------------------------------------- |
| `api_token` | Secret   | HireHop API token (`password` field). Injected as `X-TOKEN` by `connect_request`.            |
| `base_url`  | URL/text | The customer's HireHop host, e.g. `https://myhirehop.com`. Prepended to every endpoint path. |

Both `required: true`. No client ID/secret, redirect URI, scopes, or instance ID — HireHop is identified entirely by `api_token` + `base_url`.

### Test Connection Sequence

1. `GET {base_url}/php_functions/get_user_info.php` (token via X-TOKEN) — verifies the token is valid and returns the token owner. Expected: 200 with the user object. 401/403: token invalid/invalidated → prompt re-credential. 404: wrong host/path → confirm `base_url` is NOT `www.hirehop.com`. (Endpoint documented; exact response shape not live-verified.)
2. `GET {base_url}/php_functions/get_depots.php` (token via X-TOKEN) — verifies read access to company data. Expected: 200 with an array of `{ID, DEPOT, VIRTUAL}`.

Rationale: `get_user_info.php` is the cheapest "is this token alive and whose is it?" call; `get_depots.php` confirms the token can read the company's data.

### Auto-Reconnect Logic

- **On 401/403:** API-key — no auto-refresh possible (no refresh token, no extension API). Mark the connector "needs reauthorization" and notify the admin: "HireHop token is no longer valid. This usually means the API user logged in or changed its password. Regenerate at Settings → Users → (your API user) → Menu → API Token, and re-enter it."
- **On 429 (body `{"error":327}`):** back off; respect 60 req/min and 3 req/s; retry after the window (`X-RateLimit-Available` is a Unix timestamp of the next allowed request).
- **On 2xx with body `{"error":<code>}`:** application-level error despite an OK HTTP status. Read the code (3=missing parameters), fix the request, do not blindly retry unknown codes.

### Important Request Rules

- Use the stored `base_url`, never `www.hirehop.com` (marketing host 403s API clients).
- Prefer the `X-TOKEN` header. A query-string token MUST be URL-encoded.
- Datetimes are `YYYY-MM-DD hh:mm:ss` with a SPACE (not `T`). System dates UTC; user-entered dates in the depot's timezone.
- Currency is always base currency in/out — do not convert; HireHop applies job/invoice display conversion itself.
- Check `LOCKED` before writing to a job; never expose `/api/sql_execute.php` to the agent.

Companion files: `02-api-spec-investigation.md` (API reference), `03-connector-setup.md` (registry + deploy).
