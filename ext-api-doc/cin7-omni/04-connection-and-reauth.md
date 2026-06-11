---
api_name: 'Cin7 Omni'
api_slug: 'cin7-omni'
auth_type: 'username-password (per-user API username + API key, sent as HTTP Basic)'
generated_date: '2026-06-10'
---

# Cin7 Omni — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to Cin7 Omni.
> Auth type: **username-password** — the user's vault holds the Cin7 **API Username** and
> **API Key**, sent as HTTP Basic on every request. No OAuth, no tokens, no expiry.
>
> ⚠️ Cin7 facts below are docs-derived (official help centre + live-retrieved API docs,
> investigation 2026-05-22) — the connector path has not been exercised against a real account.
> ⚠️ **Omni only** — Cin7 Core is a different product/API with its own connector (`cin7-core`).

---

## Auth Type: HTTP Basic (static credentials)

Every authenticated request carries:

```
Authorization: Basic base64(api-username:api-key)   ← injected by the Numa backend
Content-Type:  application/json                     ← POST/PUT with body (backend sets it)
```

There is **no OAuth flow, no token exchange, no expiry, no refresh**. The credentials are
long-lived and checked on every request: they work until the API key is regenerated or the
connection is removed in Cin7.

Unlike ProWorkflow-style per-user logins, Cin7 Omni credentials are **not tied to a Cin7 user
identity** — the API Username is account-level and the key belongs to an *API connection* with its
own per-endpoint permission toggles. Two Numa users pasting the same connection's key get identical
access; per-user separation only exists if the Cin7 admin issues each user their own connection
(see §1).

---

## 1. Create the credentials (Cin7 Omni admin)

1. Log into Cin7 Omni as an **administrator**.
2. Navigate to **Settings → Integrations & API → API v1**.
3. Note the **API Username** shown there — account-level, shared by all connections.
4. Click **Add New API Connection**, give it an App Name (e.g. `Numa`), and copy the generated
   **API Key**.
5. On the connection, toggle the per-endpoint **Create / Read / Update / Write** permissions Numa
   needs (Read on queried entities at minimum; Create/Update only if writes are in scope).
6. Hand the API Username + API Key to the user(s) through a secure channel — they paste them into
   Numa's chat credential card (§2).

**Connection strategy:** Cin7 caps the number of API connections per account (raising it requires
Cin7 support). Where the cap allows, issue **one connection per Numa user** — each gets its own
key, its own permission set, and its own 3/sec · 60/min · 5,000/day budget, and one user's
regenerated key doesn't break the others. Otherwise a single shared "Numa" connection works, with
all users pasting the same pair and sharing one rate-limit budget.

---

## 2. Per-user connection — inline chat credential card

There is **no admin step for user credentials** — the wizard stores metadata only. Each user
connects lazily, in chat:

1. The user asks the agent something that needs Cin7 Omni (e.g. "what's our stock on hand for
   barcode 9400000000001?").
2. The backend finds no `connector-cin7-omni` secret in that user's personal vault and returns a
   structured `needs_credential` error built from the `credential_fields` snapshot on
   `connector-config-cin7-omni`.
3. The agent surfaces this as an **inline credential card** asking for:
   - **Username** — the account's Cin7 **API Username**
   - **API Key** — the API connection's key (stored in the `password` field)
4. On submit, the pair is stored as `connector-cin7-omni` in the **user's personal vault**
   (fields `username` + `password`). The agent retries and the request succeeds.

The agent never sees either value: the backend (`handle_connect_request` in
`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads them via
`_user_connector_basic_creds` and injects `Authorization: Basic ...` on every call. Agents must
never set that header themselves.

---

## 3. Credential lifetime / rotation

| Property            | Value                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| Expiry              | **None** — static credentials, valid until changed in Cin7                  |
| Refresh mechanism   | None needed                                                                  |
| Key regeneration    | **Invalidates the old key immediately** — every Numa user holding it starts getting 401 |
| API Username change | Effectively never (account-level constant)                                   |
| Connection deleted in Cin7 | Same effect as regeneration — 401 everywhere                         |

### Key regenerated (or connection removed) in Cin7

The stored `connector-cin7-omni` secrets go stale and requests return **401**. Recovery is the
same card as first connect: the next Cin7 Omni request from chat fails auth, the agent re-prompts
with the credential card, and the user enters the current API Username + new key (overwriting
their vault secret). No Numa-admin involvement. If multiple users shared the regenerated key,
**each** re-enters it on their next use.

### Permission toggles changed in Cin7

No reconnection needed — permissions are evaluated server-side per request. Newly granted
endpoints start working immediately; revoked ones start returning 403.

---

## 4. Failure diagnosis — 401 vs 403 is the Omni signature

Cin7 Omni's status semantics make diagnosis clean — **provided you don't conflate 401 and 403**:

- **401 Unauthorized** (spec example body `"Unauthorized access"`) — bad credentials: wrong API
  Username, wrong/regenerated key, or deleted connection. Re-prompt the user via the credential
  card.
- **403 Forbidden** (`"Access is forbidden"`) — the credentials are **valid**; the API connection
  simply lacks that endpoint's Create/Read/Update/Write toggle. This is a **Cin7-side
  configuration matter** — fixed in Settings → Integrations & API → API v1 on the connection.
  **Never re-prompt for credentials on a 403**, and never retry — it is not transient.
- **404** — wrong path or id; **400** — validation (batch > 250, rows > 250, duplicate
  StyleCodes, malformed JSON). Neither is an auth problem.
- **429** — rate limited (3/sec, 60/min, 5,000/day per connection). Back off; a daily-budget 429
  will not clear until the window resets.
- **503** — scheduled maintenance; retry after a few minutes.

### Reauthorization triggers

| Trigger                          | Detection                                | Action                                                        |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| API key regenerated / connection removed | 401 on every call for affected users | Each user re-enters credentials via the inline chat card |
| Endpoint permission missing      | 403 on specific endpoints only           | Cin7 admin enables the toggle on the API connection — **not** a Numa fix |
| Rate limited                     | 429                                      | Backoff 1s → 5s → 30s → 2m; defer if the daily budget is gone  |
| Whole-account API issues         | 401/403 for **all** users simultaneously | Check the API connection still exists in Cin7 and the username is right |

---

## 5. Disconnect semantics

| Action                | What is deleted                                | Effect                                                          |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| **User disconnects**  | `connector-cin7-omni` (their personal vault)    | Only that user loses access; re-prompted via the card on next chat use. The Cin7-side key remains valid — remove/regenerate the API connection in Cin7 if access should be truly revoked. |
| **Admin disconnects** | `connector-config-cin7-omni` (company vault)    | Connector unconfigured for everyone — no base URL, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector |

---

## Numa Connector Wiring

### Credentials to store

**Company secret — `connector-config-cin7-omni`** (written by the admin wizard; metadata only,
no credential material):

| Key                 | Type   | Description                                              |
| ------------------- | ------ | --------------------------------------------------------- |
| `base_url`          | Config | `https://api.cin7.com/api` (from the registry)            |
| `connector_type`    | Config | `username-password`                                       |
| `rate_limit_rpm` / `rate_limit_daily` | Config | `60` / `5000`                          |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card     |

**User secret — `connector-cin7-omni`** (written by the chat credential card, per user):

| Key        | Type   | Description                                  |
| ---------- | ------ | --------------------------------------------- |
| `username` | Secret | The account's Cin7 Omni **API Username**      |
| `password` | Secret | The API connection's **API Key**              |

### Test connection sequence

```
1. GET https://api.cin7.com/api/v1/Users?rows=1 (Basic auth)
   Expected: 200 with a JSON array
   401: credentials invalid (username or key) → re-enter via chat card
   403: credentials valid but the key lacks Read on Users → check toggles in Cin7

2. GET https://api.cin7.com/api/v1/Stock?page=1&rows=1 (Basic auth)
   Expected: 200 — proves Read permission on a business entity
   403: enable the Stock permission on the API connection in Cin7
```

### Auto-reconnect logic

```
on 401 response:
  # Nothing to refresh — the static credential pair is bad (key regenerated/removed).
  emit needs_credential → inline chat card re-prompts the user for username + API key

on 403 response:
  do NOT re-prompt — credentials work; the API connection lacks that endpoint's
  permission toggle. Tell the user to ask their Cin7 admin to enable it
  (Settings → Integrations & API → API v1).

on 429 response:
  backoff (1s → 5s → 30s → 2m); if the 5,000/day budget is exhausted, stop and
  tell the user when it resets rather than spinning.
```
