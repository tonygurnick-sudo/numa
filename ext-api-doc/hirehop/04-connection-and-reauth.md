# HireHop — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to HireHop.
> Auth type: **API Key (static per-user token)** — NOT OAuth. There is no OAuth flow for HireHop.
> Goal: enough detail that Numa could automate connector setup, and that support can talk a customer
> through generating, storing, and rotating the token.
>
> ⚠️ Confidence: MEDIUM — documented from HireHop's official docs/getting-started guide, NOT live-tested.

---

## Auth Type: API Key (Personal/Per-User Token)

HireHop authenticates with a single long-lived token tied to a HireHop **user**. The token resolves the
customer's HireHop company server-side, so the only things Numa stores are the **token** and the
customer's **base URL**. There is no client ID/secret, no redirect URI, no scopes, and no refresh flow.

This maps to the registry entry `authType: 'api-key'` with credential fields `api_token` (password) and
`base_url` (url) — see `03-connector-setup.md`.

---

## 1. Generate an API Token in HireHop

The customer (a HireHop admin) generates the token from within HireHop:

1. Log in to HireHop at the customer's host (e.g. `https://myhirehop.com`, `https://hirehop.net`, or
   `https://myhirehop.co.uk` — whichever they use).
2. Enter **Admin mode** and go to: **Settings → Users** tab.
3. **Strongly recommended:** create a dedicated **"API" user** (e.g. `Numa API`) rather than reusing a
   person's interactive login — see §3 for why this matters for token stability. Give that user only the
   HireHop role/permissions the integration needs (the token inherits the user's permissions).
4. Select that user → open its **Menu** → click **API Token**.
5. Copy the generated token immediately and store it in the Numa connector configuration.

A token is **unique per user**. Regenerating from the same menu issues a new token (and invalidates the
old one).

> **Discovery note:** the exact UI labels/locations can shift between HireHop releases. If the menu path
> differs, the canonical reference is HireHop's REST API getting-started guide
> (`https://www.hirehop.com/blog/hirehop-rest-api-getting-started-guide/`). [DOCUMENTED]

### Find the right Base URL

The `base_url` credential must be the customer's actual HireHop host — **not** `www.hirehop.com`
(the marketing site, which 403s API clients). It is the same host the customer logs in at:

- `https://myhirehop.com`, `https://hirehop.net`, or `https://myhirehop.co.uk`, **or**
- a vanity/custom domain that proxies to the same HireHop backend.

---

## 2. Token Format

| Property           | Value                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Preferred header   | `X-TOKEN: {token}`                                                                                                                       |
| Alt. locations     | `?token={URL-ENCODED}` (query), `token` (POST form field), or `"token"` (JSON body)                                                      |
| Token format       | Opaque base64-ish string containing `=`, `+`, `-` (e.g. `dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn`)                                         |
| Lifetime           | "Never expires" by time — **but silently invalidated** on the owning user's next interactive login, or on email/password change (see §3) |
| Scopes/permissions | Inherited from the owning HireHop user's role — there are no per-token scopes                                                            |
| Tenancy            | Token + `base_url` together identify the company; there is no separate account/company ID param                                          |

**Token placement — prefer the header.** When the token is placed in a query string it **must be
URL-encoded** (it contains `=`, `+`, `-`). Using `X-TOKEN` avoids the encoding pitfall entirely and keeps
the secret out of URLs and access logs:

```
X-TOKEN: dqwejk5GVT65909bHHBN7922pq5hxjm=-7hmn
Content-Type: application/json          ← only when sending a JSON body
```

---

## 3. Token Refresh / Rotation

| Property           | Value                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Refresh mechanism  | **None** — no refresh tokens, no token-extension API                                                   |
| Can extend expiry? | N/A — the token does not expire by time                                                                |
| Rotation strategy  | Regenerate from **Settings → Users → (API user) → Menu → API Token**, then update the connector config |
| Force-invalidate   | Change the API user's password (or have that user log in) — both immediately kill the token            |

### ⚠️ The silent-invalidation trap

The token is **silently invalidated** the moment the owning user:

- logs in interactively through the HireHop web UI, **or**
- changes their **email** or **password**.

After any of those, the next API call returns **401/403** with no other warning. This is the single most
common HireHop integration failure.

**Mitigation (do this at onboarding):** dedicate a **non-interactive "API" user** whose token the
connector uses, and tell the customer not to log in as that user or change its credentials. That keeps the
token stable indefinitely.

### Rotation timeline (operational)

| Trigger                            | Action                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| Suspected leak                     | Regenerate the token (or change the API user's password), update Numa |
| API user credentials changed       | Token is dead → regenerate immediately                                |
| Connector starts returning 401/403 | Token was invalidated → prompt admin to regenerate and re-enter it    |

### Programmatic token management

**None.** There is no API to list, create, or revoke API tokens — token management is UI-only via
**Settings → Users → (user) → Menu → API Token**. (Webhook subscriptions are likewise UI-only.)

---

## 4. Reauthorization Triggers

| Trigger                        | Detection                        | Action                                                                            |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------- |
| Token invalidated              | 401/403 response                 | Prompt admin to regenerate the token in HireHop and re-enter it                   |
| User re-logged in / pw changed | 401/403 (silent, see §3)         | Same — regenerate; advise dedicating a non-interactive API user                   |
| Insufficient permissions       | Application error / 403          | Check the API user's HireHop role; the token inherits its permissions             |
| Rate limited                   | HTTP 429 + body `{"error": 327}` | Back off; respect 60/min + 3/sec; honour `X-RateLimit-Available` (Unix timestamp) |

---

## Numa Connector Wiring

### Credentials to Store

| Key         | Type     | Description                                                                                      |
| ----------- | -------- | ------------------------------------------------------------------------------------------------ |
| `api_token` | Secret   | HireHop API token (the `password` credential field). Injected as `X-TOKEN` by `connect_request`. |
| `base_url`  | URL/text | The customer's HireHop host, e.g. `https://myhirehop.com`. Prepended to every endpoint path.     |

Both are `required: true` in the registry entry. No client ID/secret, redirect URI, scopes, or instance ID
are needed — HireHop is identified entirely by `api_token` + `base_url`.

### Test Connection Sequence

```
1. GET {base_url}/php_functions/get_user_info.php   (token via X-TOKEN)
     — verifies the token is valid and returns the token owner (current user).
     Expected: 200 with the user object.
     401/403: token invalid/invalidated → prompt re-credential.
     404:     wrong host/path → confirm base_url is NOT www.hirehop.com.
     [DOCUMENTED — endpoint exists; exact response shape not live-verified]

2. GET {base_url}/php_functions/get_depots.php       (token via X-TOKEN)
     — verifies read access to company data.
     Expected: 200 with an array of { ID, DEPOT, VIRTUAL }.
     [DOCUMENTED]
```

> Smoke-test rationale: `get_user_info.php` is the cheapest "is this token alive and whose is it?" call;
> `get_depots.php` confirms the token can actually read the company's data.

### Auto-Reconnect Logic

```
on 401/403 response:
  # API-key — no auto-refresh is possible (no refresh token, no extension API)
  mark connector as "needs reauthorization"
  notify admin:
    "HireHop token is no longer valid. This usually means the API user logged in
     or changed its password. Regenerate the token at
     Settings → Users → (your API user) → Menu → API Token, and re-enter it."

on 429 response (body {"error": 327}):
  back off; respect 60 req/min and 3 req/sec
  retry after the window (X-RateLimit-Available is a Unix timestamp of the next allowed request)

on 2xx response with body {"error": <code>}:
  # application-level error even though HTTP looks OK
  read the error code (3 = missing parameters); fix the request; do not blindly retry unknown codes
```

### Important Request Rules

- **Use the stored `base_url`, never `www.hirehop.com`** — the marketing host 403s API clients.
- **Prefer the `X-TOKEN` header.** If a token is ever placed in a query string, it MUST be URL-encoded.
- **Datetimes are `YYYY-MM-DD hh:mm:ss` with a space** (not a `T`). System dates are UTC; user-entered
  dates are in the depot's timezone.
- **Currency is always base currency** in and out — do not convert; HireHop applies job/invoice display
  conversion itself.
- **Check `LOCKED` before writing** to a job, and never expose `/api/sql_execute.php` to the agent.

---

_Researched 2026-05-29 from HireHop's official API docs and REST getting-started guide. NOT live-tested._
_Companion files: `02-api-spec-investigation.md` (API reference), `03-connector-setup.md` (registry + deploy)._
