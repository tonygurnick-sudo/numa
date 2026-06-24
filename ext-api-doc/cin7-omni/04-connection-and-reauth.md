---
api_name: Cin7 Omni
api_slug: cin7-omni
base_url: https://api.cin7.com/api
auth_type: username-password — vault holds API Username + API Key, sent as HTTP Basic on every request. No OAuth, no tokens, no expiry, no refresh.
call_surface: HTTP via Numa native data connector, `request` operation
doc_role: connection lifecycle — first connect, rotation, 401-vs-403 diagnosis, reauth, disconnect
confidence: Cin7 facts are docs-derived (help centre + live API docs, 2026-05-22); the connector path is NOT yet exercised against a real account.
---

# Cin7 Omni — Connection & Reauthorization

> ⚠️ **Omni only** — Cin7 Core is a different product/API with its own connector (`cin7-core`).

## Auth type: HTTP Basic (static credentials)

Every authenticated request carries (both injected by the Numa backend):

```
Authorization: Basic base64(api-username:api-key)
Content-Type:  application/json     ← POST/PUT with body
```

**No OAuth flow, no token exchange, no expiry, no refresh.** Credentials are long-lived and checked on every request — they work until the API key is regenerated or the connection is removed in Cin7.

Unlike ProWorkflow-style per-user logins, Omni credentials are **not tied to a Cin7 user identity** — the API Username is account-level and the key belongs to an _API connection_ with its own per-endpoint permission toggles. Two Numa users pasting the same connection's key get identical access; per-user separation only exists if the Cin7 admin issues each user their own connection (§1).

## 1. Create credentials (Cin7 Omni admin)

1. Log into Cin7 Omni as an **administrator**.
2. **Settings → Integrations & API → API v1**.
3. Note the **API Username** — account-level, shared by all connections.
4. **Add New API Connection** → App Name (e.g. `Numa`) → copy the generated **API Key**.
5. Toggle the connection's per-endpoint **Create / Read / Update / Write** permissions Numa needs (Read on queried entities at minimum; Create/Update only if writes are in scope).
6. Hand the API Username + API Key to the user(s) via a secure channel — they paste them into Numa's chat credential card (§2).

**Connection strategy:** Cin7 caps API connections per account (raising it needs Cin7 support). Where the cap allows, issue **one connection per Numa user** — each gets its own key, permission set, and 3/sec · 60/min · 5,000/day budget, and one user's regenerated key doesn't break others. Otherwise a single shared "Numa" connection works, all users pasting the same pair and sharing one budget.

## 2. Per-user connection — inline chat credential card

**No admin step for user credentials** — the wizard stores metadata only. Each user connects lazily, in chat:

1. The user asks the agent something needing Cin7 Omni (e.g. "what's our stock on hand for barcode 9400000000001?").
2. The backend finds no `connector-cin7-omni` secret in that user's personal vault and returns a structured `needs_credential` error built from the `credential_fields` snapshot on `connector-config-cin7-omni`.
3. The agent surfaces an **inline credential card** asking for: **Username** (the account's Cin7 API Username) and **API Key** (the connection's key, stored in the `password` field).
4. On submit, the pair is stored as `connector-cin7-omni` in the **user's personal vault** (fields `username`+`password`). The agent retries and the request succeeds.

The agent never sees either value: the backend (`handle_connect_request` in `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads them in `do_request` — the `elif declared == "username-password":` branch calls `_basic_from_fields` over the user's vault fields — and injects `Authorization: Basic ...` on every call. Agents must never set that header.

## 3. Credential lifetime / rotation

| Property                   | Value                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Expiry                     | **None** — static, valid until changed in Cin7                                          |
| Refresh                    | none needed                                                                             |
| Key regeneration           | **invalidates the old key immediately** — every Numa user holding it starts getting 401 |
| API Username change        | effectively never (account-level constant)                                              |
| Connection deleted in Cin7 | same effect as regeneration — 401 everywhere                                            |

- **Key regenerated / connection removed:** stored `connector-cin7-omni` secrets go stale → **401**. Recovery is the same card as first connect — the next request fails auth, the agent re-prompts, the user enters the current API Username + new key (overwriting their vault secret). No Numa-admin involvement. If multiple users shared the key, **each** re-enters on next use.
- **Permission toggles changed in Cin7:** no reconnection needed — permissions are evaluated server-side per request. Newly granted endpoints work immediately; revoked ones start returning 403.

## 4. Failure diagnosis — 401 vs 403 is the Omni signature

Clean diagnosis **provided you don't conflate 401 and 403**:

- **401 Unauthorized** (`"Unauthorized access"`) — bad credentials: wrong API Username, wrong/regenerated key, or deleted connection. Re-prompt via the credential card.
- **403 Forbidden** (`"Access is forbidden"`) — credentials **valid**; the connection lacks that endpoint's Create/Read/Update/Write toggle. A **Cin7-side configuration matter** — fixed in Settings → Integrations & API → API v1 on the connection. **Never re-prompt for credentials on a 403, never retry** — it's not transient.
- **404** — wrong path/id; **400** — validation (batch>250, rows>250, duplicate StyleCodes, malformed JSON). Neither is auth.
- **429** — rate limited (3/sec, 60/min, 5,000/day per connection). Back off 1s→5s→30s→2m; a daily-budget 429 won't clear until the window resets.
- **503** — scheduled maintenance; retry after a few minutes.

### Reauthorization triggers

| Trigger                                  | Detection                            | Action                                                                  |
| ---------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| API key regenerated / connection removed | 401 on every call for affected users | each user re-enters credentials via the inline chat card                |
| Endpoint permission missing              | 403 on specific endpoints only       | Cin7 admin enables the toggle — **not** a Numa fix                      |
| Rate limited                             | 429                                  | backoff 1s→5s→30s→2m; defer if the daily budget is gone                 |
| Whole-account API issues                 | 401/403 for **all** users at once    | check the API connection still exists in Cin7 and the username is right |

## 5. Disconnect semantics

| Action                | What is deleted                              | Effect                                                                                                                                                                  |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User disconnects**  | `connector-cin7-omni` (their personal vault) | only that user loses access; re-prompted via the card on next chat use. The Cin7-side key remains valid — remove/regenerate the API connection in Cin7 to truly revoke. |
| **Admin disconnects** | `connector-config-cin7-omni` (company vault) | connector unconfigured for everyone — no base URL, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector                    |

## Numa connector wiring

**Company secret `connector-config-cin7-omni`** (admin wizard; metadata only, no credential material):
| Key | Type | Description |
| --- | --- | --- |
| `base_url` | Config | `https://api.cin7.com/api` (from the registry) |
| `connector_type` | Config | `username-password` |
| `rate_limit_rpm` / `rate_limit_daily` | Config | `60` / `5000` |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card |

**User secret `connector-cin7-omni`** (chat credential card, per user):
| Key | Type | Description |
| --- | --- | --- |
| `username` | Secret | the account's Cin7 Omni **API Username** |
| `password` | Secret | the API connection's **API Key** |

### Test connection sequence

```
1. GET https://api.cin7.com/api/v1/Users?rows=1 (Basic auth)
   200 (JSON array)           — credentials valid, permission present
   401                        — credentials invalid (username or key) → re-enter via chat card
   403                        — credentials valid but the key lacks Read on Users → check toggles in Cin7
2. GET https://api.cin7.com/api/v1/Stock?page=1&rows=1 (Basic auth)
   200                        — proves Read permission on a business entity
   403                        — enable the Stock permission on the API connection in Cin7
```

### Auto-reconnect logic

```
on 401: nothing to refresh — the static credential pair is bad (key regenerated/removed).
        emit needs_credential → inline chat card re-prompts the user for username + API key.
on 403: do NOT re-prompt — credentials work; the connection lacks that endpoint's toggle.
        Tell the user to ask their Cin7 admin to enable it (Settings → Integrations & API → API v1).
on 429: backoff (1s→5s→30s→2m); if the 5,000/day budget is exhausted, stop and tell the user
        when it resets rather than spinning.
```
