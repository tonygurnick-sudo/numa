---
api_name: 'MYOB Greentree'
api_slug: 'greentree'
auth_type: 'username-password (per-user Basic) + account-level ApiKey header'
generated_date: '2026-06-11'
---

# MYOB Greentree — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to MYOB Greentree.
> Auth type: **per-user HTTP Basic** (the user's Greentree login) **+ an account-level
> `ApiKey` header** (the site serial number, admin-managed). **No OAuth.**
>
> ⚠️ **Not live-validated** — no test instance, no credentials; auth/hosting facts come from
> MYOB Greentree's official Knowledge Base. Status-code/error details below are
> **[UNVERIFIED]** — confirm against a real instance before customer use.

---

## Auth Type: Dual — `ApiKey` header + HTTP Basic

Every authenticated request needs **BOTH** [DOCS]:

```
ApiKey:        {site serial number}                            ← account-level, admin-managed
Authorization: Basic base64(greentree-user:greentree-password) ← per-user login
Content-Type:  application/json                                ← POST with body (backend sets it)
Accept:        application/json                                ← get JSON not XML (backend sets it)
```

There is **no OAuth flow, no tokens, no expiry, no refresh**. Both credentials are long-lived: they
work until the user changes their Greentree password or the site serial is reissued. Greentree
enforces the Basic-auth user's own permissions server-side, so two Numa users with different
Greentree roles see different data through the same connector.

> The `ApiKey` may also be sent as a URL parameter (`?ApiKey=…`) — Numa uses the **header** only,
> so the key never lands in logs or URLs. Unlike Jiwa, Greentree has no session-token alternative —
> Basic auth is sent on every request; nothing to keep-alive, nothing to log out. [DOCS]

---

## 1. Account `ApiKey` — the site serial number (admin, once)

The account-level `ApiKey` is the Greentree **site serial number** — the same value for every user
of that Greentree site. [DOCS]

1. Open Greentree's **licensing / About** screen (or ask the Greentree administrator) and copy the
   **site serial number** (the docs show values like `23440933`).
2. Enter it in the **Integrations → MYOB Greentree** wizard under "Account configuration", together
   with the **Instance URL** (see `03-connector-setup.md`).

It is saved on the company vault secret `connector-config-greentree` as `api_key`, alongside
`api_key_header: ApiKey` and `instance_url`. It is the only secret material at the company level.

---

## 2. Per-user connection — inline chat credential card

There is **no admin step for user credentials**. Each user connects lazily, in chat:

1. The user asks the agent something that needs Greentree (e.g. "list our GL accounts for company 01").
2. The backend finds no `connector-greentree` secret in that user's personal vault and returns a
   structured `needs_credential` error built from the `credential_fields` snapshot on the connector
   config.
3. The agent surfaces this as an **inline credential card** in the chat UI asking for:
   - **Username** — the user's Greentree login username
   - **Password** — their Greentree password
4. On submit, the credentials are stored as `connector-greentree` in the **user's personal vault**
   (fields `username` + `password`). The agent retries and the request succeeds.

From then on, every request that user makes is sent with their own Basic auth — Greentree applies
*their* permissions, not an integration-wide service account.

The agent never sees either secret: the backend (`handle_connect_request` in
`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) injects `Authorization: Basic …` from
the user vault and `ApiKey: …` from the company config on every call. Agents must never set those
headers themselves.

---

## 3. Credential lifetime / rotation

| Property              | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Token expiry          | **None** — no tokens; credentials are long-lived until changed         |
| Refresh mechanism     | None needed                                                            |
| User password change  | Breaks that user's stored credential → 401 → reconnect via chat card    |
| ApiKey (serial) change | Breaks **all** users → admin re-saves the wizard with the new serial   |
| Instance URL change   | Breaks **all** users with **connection errors** (not 401) → admin re-saves the wizard |

### User Greentree password changed

The stored `connector-greentree` secret goes stale and that user's requests start returning 401
(bad Basic auth). Recovery is the same card as first connect: the next Greentree request from chat
fails auth, the agent re-prompts with the credential card, and the user enters the new password
(overwrites the vault secret). No admin involvement; other users are unaffected.

### Admin changed the site ApiKey / serial number

This is rare — the serial changes only if the Greentree licence is reissued. If it does, every
user's requests fail simultaneously (bad ApiKey). Fix: the admin reopens the **Integrations → MYOB
Greentree** wizard and **re-saves** with the new serial — this updates `api_key` on the existing
`connector-config-greentree` secret (company-secret writes merge). User credentials are untouched
and keep working.

### Instance URL changed (customer moved/renamed the API host)

Every user's requests fail with **connection errors** (not 401s). Fix: a Numa admin re-saves the
wizard with the new instance URL. User logins and the ApiKey are untouched.

---

## 4. Failure diagnosis — 401 vs 404 vs unreachable

> ⚠️ Greentree's docs do **not** publish status codes or error bodies — the codes below are the
> expected HTTP conventions and are **[UNVERIFIED]**. Confirm on a live instance and update this
> table.

- **401 (expected for bad auth)** — bad Greentree login **or** wrong `ApiKey` (serial). The two
  cannot be told apart from the status alone (both are auth). To isolate: a *known-good* user's
  request still 401-ing points at the **ApiKey** (admin re-saves the serial); a single user's
  request 401-ing while others work points at **that user's password** (reconnect via the card).
- **404** — wrong **company code**, entity, or identifier in the path. Not an auth problem; check
  the `/{company}/{Entity}/{id}` URL (is the company code right — `01`?).
- **4xx on a write** — malformed payload or a Greentree business-rule veto. Fix the request.
- **5xx** — server/Jade error (plugin or report failure, timeout). The customer can diagnose via
  `ApiTracing`/`ApiLogging` (`apilog.log`).
- **Connection refused / TLS error / timeout** — infrastructure (API service stopped, cert expired,
  firewall/whitelist, wrong instance URL). See §6 — not an auth issue.

### Reauthorization triggers

| Trigger                          | Detection                                        | Action                                                                 |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| User changed Greentree password  | 401; only that user affected                     | Re-prompt the user via the inline chat credential card                 |
| Site ApiKey / serial reissued    | 401 for **all** users at once                    | Admin re-saves the wizard with the new serial                          |
| User lacks Greentree permission  | 401/403 or filtered/empty results on some routes | Adjust the user's permissions **in Greentree** — not a Numa fix        |
| Wrong company code in path       | 404                                              | Use the correct company code (`/01/...`) — not an auth issue           |
| Instance unreachable             | Connection error, not an HTTP status             | Customer IT (service/cert/firewall); admin re-checks the instance URL  |

---

## 5. Disconnect semantics

| Action                | What is deleted                                  | Effect                                                                                                              |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **User disconnects**  | `connector-greentree` (their personal vault)     | Only that user loses access; re-prompted via the card on next chat use. Their Greentree login stays valid — disable it in Greentree if the person is leaving. |
| **Admin disconnects** | `connector-config-greentree` (company vault)     | Connector unconfigured for everyone — no instance URL, no ApiKey, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector |

---

## 6. Troubleshooting checklist (instance-side) [DOCS]

All customer-IT items — Numa cannot fix any of these remotely:

- [ ] **Instance unreachable** — is the Greentree API running? (Own Windows service, or part of the
      database service via `ServerApplication<n>=ApiSchema,ApiStartup`; from 2021.4+ it must run
      inside the DB service.) Correct `ListenPort` (default 9000)? Firewall / IP-whitelist / proxy
      rule blocking AWS? Is HTTPS published (reverse proxy / Cloudflare, valid cert, public DNS)?
      An expired cert makes clients refuse the connection.
- [ ] **Wrong company code** — the path segment (`/01/...`) must match the customer's Greentree
      company. A mismatch is a 404, not an auth failure.
- [ ] **ApiKey wrong** — must be the **site serial number** from licensing/About, not a user value.
      A wrong serial fails every user.
- [ ] **User permissions** — the Basic user runs with exactly their Greentree permissions; blanket
      access failures usually mean that user lacks rights to the entity.
- [ ] **Tracing for diagnosis** — the customer can turn on `ApiTracing`/`ApiLogging` in `jadegt.ini`
      (`[JadeLog]` → `apilog.log`, queried in real time) to see calls/responses. **Turn it off
      afterwards** — it grows the log file.

---

## Numa Connector Wiring

### Credentials to store

**Company secret — `connector-config-greentree`** (written by the admin wizard):

| Key              | Type   | Description                                                                  |
| ---------------- | ------ | --------------------------------------------------------------------------- |
| `instance_url`   | Config | Customer's API base, e.g. `https://greentree.customer.com.au` — **required** (no registry fallback). Do NOT include the company code. |
| `api_key`        | Secret | The site **serial number** (the account-level `ApiKey`)                      |
| `api_key_header` | Config | `ApiKey` — the header that carries the serial                               |
| `connector_type` | Config | `username-password`                                                          |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card                     |

**User secret — `connector-greentree`** (written by the chat credential card, per user):

| Key        | Type   | Description                          |
| ---------- | ------ | ------------------------------------ |
| `username` | Secret | The user's Greentree login username  |
| `password` | Secret | The user's Greentree password        |

### Test connection sequence

```
1. GET {instance_url}/{company}/Ping (Basic + ApiKey, both backend-injected)
   Expected: 200  — reachable, ApiKey valid, user login valid
   401: bad user login OR wrong ApiKey (serial)   [exact code UNVERIFIED]
   404: wrong company code / entity in the path
   Connection error: instance unreachable — not an auth issue

2. GET {instance_url}/{company}/GLAccount?page=1&pageSize=1
   Expected: 200 with one GL account row (response shape UNVERIFIED)
```

### Auto-reconnect logic

```
on 401 response:
  # No tokens to refresh — one of the two long-lived credentials is bad.
  if all users 401 simultaneously:  ApiKey/serial is wrong → notify admin "re-save the
                                     MYOB Greentree wizard with the current site serial number"
  else (single user 401s):          that user's password changed → emit needs_credential →
                                     inline chat card re-prompts the user for their Greentree login

on 404 response:
  not an auth issue — check the company code and entity in the relative URL (/{company}/{Entity}/...)

on connection/TLS error:
  not an auth issue — see the troubleshooting checklist in §6
```
