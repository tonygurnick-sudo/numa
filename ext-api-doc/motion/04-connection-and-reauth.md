---
api_name: Motion
api_slug: motion
base_url: https://api.usemotion.com/v1 (fixed — NO instance/base-URL stored)
auth: API Key — `X-API-Key: {api_token}` header (static per-user key; NOT Authorization: Bearer)
call_surface: HTTP via `numa integrations request` (connect_request proxy)
credential_field: single `api_token` (secret); connect_request injects it as X-API-Key
confidence: [DOCUMENTED] from docs.usemotion.com getting-started + rate-limits unless tagged [INFERRED]; NO live call — the /users/me envelope + error bodies are [DOCUMENTED-shape]/[INFERRED].
---

# Motion — Connection & Reauthorization Guide

Connecting Numa to the Motion API via an API key. Detailed enough to automate connector setup via script.

## Auth Type: API Key (`X-API-Key` header)

Motion authenticates with a **static, per-user API key** in the `X-API-Key` request header. **No OAuth, no token exchange, no refresh, no documented expiry** — the whole simplification. The key behaves like a long-lived password and carries the issuing user's own Motion permissions.

> ℹ️ The key is **per user**, not per account/org. Each Numa user who wants Motion access pastes their own key. There is no admin-supplied shared secret (unlike OAuth).

## 1. Generate an API key in Motion

1. Log in to **Motion** (web app at app.usemotion.com).
2. Go to **Settings → API**.
3. **Create an API key.**
4. **Copy the key immediately** — Motion shows it **only once** for security ("Be sure to copy the key, as it will only be shown once"). Treat it as a password; store in the connector's `api_token` field. Don't log/echo it.

| Field         | Value                                           | Notes                                |
| ------------- | ----------------------------------------------- | ------------------------------------ |
| Where         | web app → **Settings → API**                    | Per-user                             |
| Action        | **Create an API key**                           | Shown **once** — capture immediately |
| Required plan | None for API access; rate tier scales with plan | Individual 12/min · Team 120/min     |
| What you get  | An opaque secret string                         | Store in the vault `api_token` field |

## 2. Key format & headers

| Property          | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Header            | `X-API-Key: {api_token}`                                             |
| Key format        | Opaque secret string (no documented prefix) — treat as a password    |
| Lifetime          | No documented expiry — static, indefinite [INFERRED]                 |
| Scope/permissions | The issuing **user's** permissions (no separate scope model)         |
| Per account       | Per-user key; rate limit is shared per **account** (individual/team) |

Required headers on every authenticated call:

```
X-API-Key:     {api_token}
Accept:        application/json
Content-Type:  application/json     ← POST/PATCH only
```

> ⚠️ Do **not** send `Authorization: Bearer …`. Motion authenticates **only** with `X-API-Key`. The docs are explicit: "Pass in your API key as a X-API-Key header."

## 3. First successful call — smoke test

Confirm the key with `GET /users/me`:

```http
GET https://api.usemotion.com/v1/users/me
Accept: application/json
X-API-Key: {api_token}
```

Expected `200 OK` (shape illustrative — not live-verified):

```json
{ "id": "user_456", "name": "Jane Doe", "email": "jane@acme.com" }
```

Follow-up against real data (the docs' own example, and the natural "first" call since everything is workspace-scoped):

```http
GET https://api.usemotion.com/v1/workspaces
X-API-Key: {api_token}
```

Expected `200 OK` with a `{ "meta": {...}, "workspaces": [...] }` body.

Failure modes:
| Status | Meaning | Action |
| --- | --- | --- |
| 401 | Invalid / revoked `X-API-Key` | Verify the key; regenerate in Settings → API if revoked |
| 403 | The user lacks access to the resource/workspace | Per-user permissions — not a credential problem |
| 404 | Wrong path — likely a doubled `/v1` (base already ends in `/v1`) | Drop the leading `/v1` from the path |
| 429 | Rate limited (12/min individual, 120 team) | **No `Retry-After`** — back off exponentially; serialize calls |

## 4. Key rotation

Keys have no documented expiry, so there's no scheduled refresh. Rotation is manual, out-of-band:
| Property | Value |
| --- | --- |
| Refresh mechanism | **None** — no refresh tokens, no programmatic rotation endpoint |
| Can extend expiry? | N/A — no documented expiry |
| Rotation strategy | User creates a **new** key in Settings → API, updates the connector's `api_token`, deletes the old key |

**Zero-downtime rotation flow:**

1. User mints a **new** key (Settings → API).
2. Update the connector's `api_token` in Numa with the new key.
3. Confirm with a `GET /users/me` smoke test.
4. Delete the **old** key in Motion.

No documented API to list/create/revoke keys programmatically — all key management is manual via the web UI. [INFERRED — no key-management API found]

## 5. Reauthorization triggers

The key is static, so reauthorization means "the user pastes a new key" — no auto-refresh path.
| Trigger | Detection | Action |
| --- | --- | --- |
| Key revoked / rotated | 401 response | Prompt the user to generate a new key in Settings → API and re-enter it |
| No access to resource | 403 | Per-user permissions — the user needs access in Motion; nothing to reauth |
| Rate limited | 429 | Back off exponentially (no `Retry-After`); serialize and slow down |

> No scope/consent expiry to detect (no scopes) and no token-refresh on 401 — a 401 means the key itself is bad/revoked, full stop.

## Numa Connector Wiring

### Credentials to store

| Key         | Type   | Description                                             |
| ----------- | ------ | ------------------------------------------------------- |
| `api_token` | secret | Motion per-user API key, sent as the `X-API-Key` header |

- The **single** credential field (`connectorRegistry.ts` → `motion` → `credentialFields[0].key = 'api_token'`).
- **No instance/base URL** stored beyond the fixed `https://api.usemotion.com/v1` (persisted as `base_url`).
- `connect_request` injects `api_token` into the `X-API-Key` header on every proxied call; the agent never sees the raw key, never performs token exchange.

### Test Connection Sequence

```
1. GET /users/me (with X-API-Key) — verify the key is valid
   200: { id, name, email }   ·   401: key invalid/revoked
2. GET /workspaces (with X-API-Key) — verify real-data access + capture workspaceId
   200: { meta, workspaces[] }   ·   403: user lacks access to any workspace (rare)
```

### Rate Limiting ⚠️

| Scope       | Per Minute               | Notes                                                 |
| ----------- | ------------------------ | ----------------------------------------------------- |
| Per account | Individual 12 · Team 120 | Enterprise higher. Shared across the account's usage. |

**No `Retry-After` header.** On 429, wait and retry with exponential backoff + jitter (start ~5 s individual / ~1 s team, cap ~60 s). **Serialize every request** and pace proactively — this low limit is the connector's defining operational constraint (see `01d`).

### Auto-Reconnect Logic

```
on 401:  # API-key auth — no auto-refresh possible (key is static)
  mark connector "needs reauthorization"
  notify user: "Motion API key invalid or revoked — generate a new key at
                app.usemotion.com → Settings → API and update the connector"
on 403:  # the user's key lacks access to that resource — not a credential problem
  do NOT auto-retry
  surface: "Your Motion account doesn't have access to that workspace/resource."
on 429:  # no Retry-After
  wait with exponential backoff + jitter (start ~5s individual / ~1s team, cap ~60s)
  serialize subsequent calls; give up after ~5 tries and tell the user to wait a minute
```

_Auth detail sourced from the Motion getting-started cookbook (`X-API-Key` header, key minted in Settings → API, shown once), the rate-limits cookbook (12/min individual · 120/min team, no `Retry-After`), and the api-reference. No live API call — the `/users/me` envelope + error bodies are [DOCUMENTED-shape]/[INFERRED]._
