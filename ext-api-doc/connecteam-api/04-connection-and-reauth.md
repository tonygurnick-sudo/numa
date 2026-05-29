# Connecteam (API Key) — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to the Connecteam API using an API key.
> Auth type: **API Key** (`X-API-KEY` header). Goal: enough detail that Numa could automate
> connector setup via script.
>
> **Shared API:** same REST API as `connecteam-oauth` (OAuth). Only the auth differs — this
> connector sends a static `X-API-KEY` header; the OAuth connector mints a 24h bearer token. For the
> OAuth flow see `connecteam-oauth/04-connection-and-reauth.md`.

---

## Auth Type: API Key (`X-API-KEY` header)

Connecteam authenticates this connector with a **static, account-level API key** sent in the
`X-API-KEY` request header. There is **no OAuth, no token exchange, no refresh, and no expiry** —
this is the whole simplification over the OAuth connector. The key behaves like a long-lived
password and grants full account access (it carries no per-scope restrictions).

> ℹ️ Connecteam's terminology is "API key" (Settings → API Keys), not "Personal Access Token". The
> mechanics map onto the template's PAT pattern: a single secret string, pasted once, sent on every
> request, with no programmatic refresh.

---

## 1. Generate an API key in Connecteam

1. Log in to the Connecteam web app at `https://app.connecteam.com` as an **account owner**.
   - Only account **owners** can create/manage API keys. Managers/admins cannot.
   - The account must be on the **Expert plan or higher** for the API to be available (the Forms API and some others are **Enterprise-only**).
2. Navigate to: **Settings → API Keys**.
3. Click **"Add API key"**.
4. Give the key a name for identification (e.g. `Numa Integration`).
5. **Copy the key immediately** — treat it as a password; store it directly in the Numa connector's
   `api_token` field. Do not log or echo it.

| Field         | Value                                        | Notes                                      |
| ------------- | -------------------------------------------- | ------------------------------------------ |
| Where         | Connecteam web app → **Settings → API Keys** | Owner-only; not visible to managers/admins |
| Action        | **Add API key**                              | One account can hold multiple keys         |
| Required plan | **Expert** (Forms etc. need **Enterprise**)  | A key on a lower tier is rejected/limited  |
| What you get  | An opaque secret string                      | Capture immediately; store in the vault    |

---

## 2. Key format & headers

| Property           | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| Header             | `X-API-KEY: {api_token}`                                                  |
| Key format         | Opaque secret string (no documented prefix/pattern) — treat as a password |
| Lifetime           | **Does not expire** — static, indefinite validity                         |
| Scopes/permissions | **None** — full account access (no per-feature scoping like OAuth)        |
| Limit per account  | Multiple keys allowed; they **share** the per-account rate-limit quota    |

**Required headers on every authenticated call:**

```
X-API-KEY:    {api_token}
Accept:        application/json
Content-Type:  application/json     ← POST/PUT only
```

> ⚠️ Do **not** send `Authorization: Bearer …` — that is the OAuth (`connecteam-oauth`) path. This
> connector authenticates **only** with `X-API-KEY`.

---

## 3. First successful call — smoke test

After obtaining a key, confirm it with the unversioned `/me` endpoint:

```http
GET https://api.connecteam.com/me
Accept: application/json
X-API-KEY: {api_token}
```

Expected: `200 OK` with the success envelope (shape illustrative — not live-verified):

```json
{
  "requestId": "e40bff49-5e00-4549-a2d2-e339026drtc3",
  "data": {
    "object": {
      "name": "Acme Field Services",
      "ownerEmail": "owner@example.com",
      "plan": "expert"
    }
  }
}
```

> `/me` is the **only** unversioned/unprefixed path — every other endpoint is module-versioned
> (`/users/v1/...`, `/time_clock/v1/...`, `/scheduler/v2/...`).

Follow-up to confirm scope works against real data:

```http
GET https://api.connecteam.com/users/v1/users?limit=1
X-API-KEY: {api_token}
```

Expected: `200 OK` with a `data.users[]` array.

Failure modes:

| Status | Meaning                                                       | Action                                                           |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| 401    | Invalid / revoked `X-API-KEY`                                 | Verify the key; regenerate in Settings → API Keys if revoked     |
| 403    | Plan-gated (below Expert) or feature not on plan (e.g. Forms) | Confirm the account plan (Expert+/Enterprise) and feature access |
| 404    | Wrong path — wrong module/version, or wrong ID type           | Check the underscore path and version; mind int vs UUID vs hex   |
| 429    | Rate limited                                                  | Back off using `x-ratelimit-minute-reset` (no `Retry-After`)     |

---

## 4. Key rotation

API keys do **not** expire, so there is no scheduled refresh. Rotation is manual and out-of-band:

| Property           | Value                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no programmatic rotation endpoint                                                            |
| Can extend expiry? | N/A — keys never expire                                                                                                    |
| Rotation strategy  | Owner creates a **new** key in Settings → API Keys, updates the Numa connector's `api_token`, then **deletes the old** key |

**Recommended rotation flow (zero-downtime):**

1. Owner mints a **new** key in Connecteam (Settings → API Keys → Add API key).
2. Update the connector's `api_token` in Numa with the new key.
3. Confirm with a `GET /me` smoke test.
4. Delete the **old** key in Connecteam.

There is no documented API to list/create/revoke keys programmatically — all key management is done
manually through the Connecteam web UI. [INFERRED — no key-management API found]

---

## 5. Reauthorization triggers

Because the key is static, reauthorization means "an admin pastes a new key" — there is no
auto-refresh path.

| Trigger               | Detection                          | Action                                                                               |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| Key revoked / rotated | 401 response                       | Prompt the owner to generate a new key in Settings → API Keys and re-enter it        |
| Insufficient plan     | 403 across endpoints               | Account is below Expert (or feature is Enterprise-only) — upgrade; nothing to reauth |
| Rate limited          | 429 (or 200 with `*-remaining: 0`) | Back off using `x-ratelimit-minute-reset`; throttle on the remaining headers         |

> There is **no** scope/consent expiry to detect (the key has no scopes) and **no** token-refresh on
> 401 — a 401 means the key itself is bad/revoked, full stop.

---

## Numa Connector Wiring

### Credentials to Store

| Key         | Type   | Description                                                |
| ----------- | ------ | ---------------------------------------------------------- |
| `api_token` | secret | Connecteam account API key, sent as the `X-API-KEY` header |

Notes:

- This is the **single** credential field in the registry entry (`connectorRegistry.ts` →
  `connecteam-api` → `credentialFields[0].key = 'api_token'`).
- **No instance/base URL** is stored — Connecteam is a single shared host; the base URL is fixed at
  `https://api.connecteam.com`.
- `connect_request` injects `api_token` into the `X-API-KEY` header on every proxied call; the
  workspace agent never sees the raw key and never performs any token exchange.

### Test Connection Sequence

```
1. GET https://api.connecteam.com/me (with X-API-KEY) — verify the key is valid
   Expected: 200 with the { requestId, data } envelope
   401: key invalid or revoked
   403: account below Expert plan (API gated)

2. GET https://api.connecteam.com/users/v1/users?limit=1 (with X-API-KEY) — verify real-data access
   Expected: 200 with data.users[]
   403: feature not on the account's plan
```

### Rate Limiting

| Scope       | Per Minute                          | Per Day                                     | Notes                                                      |
| ----------- | ----------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Per account | SBP 5 · Expert 100 · Enterprise 200 | SBP 100 · Expert 10,000 · Enterprise 20,000 | Shared across **all** keys and integrations on the account |

Response headers on every request (six):

```
x-ratelimit-minute-limit: 100
x-ratelimit-minute-remaining: 87
x-ratelimit-minute-reset: 1745625660   ← UTC epoch SECONDS
x-ratelimit-day-limit: 10000
x-ratelimit-day-remaining: 9213
x-ratelimit-day-reset: 1745712000
```

On 429: there is **no `Retry-After`** header — wait until `x-ratelimit-minute-reset` (UTC epoch
seconds) before retrying. The API has also been reported to return **200 with
`x-ratelimit-*-remaining: 0`** instead of 429 — treat the remaining headers as the source of truth
and throttle proactively.

### Auto-Reconnect Logic

```
on 401 response:
  # API-key auth — no auto-refresh is possible (the key is static)
  mark connector as "needs reauthorization"
  notify admin: "Connecteam API key invalid or revoked — generate a new key at
                 app.connecteam.com → Settings → API Keys and update the connector"

on 403 response:
  # plan gate or feature not on plan — not a credential problem
  do NOT auto-retry
  surface: "Connecteam API requires the Expert plan (Forms needs Enterprise). Check the account plan."

on 429 response (or 200 with x-ratelimit-*-remaining: 0):
  wait until x-ratelimit-minute-reset (UTC epoch seconds)
  retry the request with exponential backoff + jitter
```

---

_Auth detail sourced from the Connecteam API-key authentication page
(https://developer.connecteam.com/docs/authentication-1), the rate-limiting and pagination guides,
and the Numa connector registry (`numa-frontend/src/Components/DataConnectors/connectorRegistry.ts` —
the `connecteam-api` entry with a single `api_token` password field). No live API call was made; the
`/me` envelope and error bodies are [DOCUMENTED-shape]/[INFERRED]._
