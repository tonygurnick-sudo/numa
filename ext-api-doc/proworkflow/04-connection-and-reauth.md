---
api_name: 'ProWorkflow'
api_slug: 'proworkflow'
auth_type: 'username-password + account API key'
generated_date: '2026-06-10'
---

# ProWorkflow — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to ProWorkflow.
> Auth type: **username-password (per user) + account API key (admin)**. No OAuth.
> All auth facts below were live-verified against a trial account on 2026-06-10.

---

## Auth Type: Dual — apikey header + HTTP Basic

Every authenticated request needs **BOTH** [CONFIRMED — live API test 2026-06-10]:

```
apikey:        <account API key>                       ← account-level, admin-managed
Authorization: Basic base64(user-email:user-password)  ← per-user login
Content-Type:  application/json                        ← POST/PUT with body (backend sets it)
```

There is **no OAuth flow, no tokens, no expiry, no refresh**. Both credentials are
long-lived: they work until the API key is regenerated or the user changes their
password. ProWorkflow enforces the Basic-auth user's own permissions server-side, so
two Numa users with different ProWorkflow roles see different data through the same
connector.

---

## 1. Account API key (admin, once)

### Option A: ProWorkflow Client Area

1. Log in to ProWorkflow as the **Account Holder** — the Client Area is not visible to
   other users, even admins.
2. Open the **Client Area** and copy the **API key**
   (format `XXXX-XXXX-XXXX-XXXX-XXXXXXX-XXXXXXXX`).

### Option B: Via the API (any user's own login)

```http
GET https://api.proworkflow.net/login?url=<account-slug>
Authorization: Basic base64(email:password)     ← no apikey needed for this one call
```

→ 200 with account details including `apikey`, `accounturl`, `plan`, `permissions`,
and the caller's user id/email. The slug is the path segment of the account's app URL:
for `https://app.proworkflow.com/ArcanumAI` the slug is `arcanumai` (case-insensitive).
[CONFIRMED — tested with `url=arcanumai`]

### Storing it in Numa

The admin enters the key in the **Integrations → ProWorkflow** wizard. It is saved on
the company vault secret `connector-config-proworkflow` as `api_key`, alongside
`api_key_header: apikey` and `base_url: https://api.proworkflow.net`. See
`03-connector-setup.md` for the full field list.

---

## 2. Per-user connection — inline chat credential card

There is **no admin step for user credentials**. Each user connects lazily, in chat:

1. The user asks the agent something that needs ProWorkflow (e.g. "list my projects").
2. The backend finds no `connector-proworkflow` secret in that user's personal vault and
   returns a structured `needs_credential` error built from the `credential_fields`
   snapshot on the connector config.
3. The agent surfaces this as an **inline credential card** in the chat UI asking for:
   - **Username** — the user's ProWorkflow login email
   - **Password** — their ProWorkflow password
4. On submit, the credentials are stored as `connector-proworkflow` in the **user's
   personal vault** (fields `username` + `password`). The agent retries and the request
   succeeds.

From then on, every request that user makes is sent with their own Basic auth —
ProWorkflow applies *their* permissions, not an integration-wide service account.

The agent never sees either secret: the backend (`handle_connect_request` in
`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) injects
`Authorization: Basic ...` from the user vault and `apikey: ...` from the company
config on every call. Agents must never set those headers themselves.

---

## 3. Credential lifetime / rotation

| Property            | Value                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Token expiry        | **None** — no tokens; credentials are long-lived until changed         |
| Refresh mechanism   | None needed                                                            |
| User password change | Breaks that user's stored credential → 401 → reconnect via chat card |
| API key regeneration | Breaks **all** users → admin re-saves the wizard with the new key    |

### User password changed in ProWorkflow

The stored `connector-proworkflow` secret goes stale and requests start returning 401.
Recovery is the same card as first connect: the next ProWorkflow request from chat
fails auth, the agent re-prompts with the credential card, and the user enters the new
password (overwrites the vault secret). No admin involvement.

### Admin rotated/regenerated the account API key

Every user's requests 401 simultaneously. Fix: admin reopens the **Integrations →
ProWorkflow** wizard and re-saves with the new key — this updates `api_key` on the
existing `connector-config-proworkflow` secret. User credentials are untouched and
keep working.

---

## 4. Failure diagnosis — 401 is ambiguous

A bad API key and a bad user password **both** return **401 with an empty body** (no
JSON, no error message) [CONFIRMED — live test]. To tell them apart, test the two
mechanisms independently:

```
on 401:
  1. GET /login?url=<account-slug> with the user's Basic auth ONLY (no apikey):
       200 → the user's password is fine → the ACCOUNT API KEY is wrong/rotated
              → admin re-saves the wizard with the current key
       401 → the USER's credentials are wrong (password changed / account disabled)
              → user reconnects via the inline chat credential card
  2. If both check out individually but combined calls still 401, re-verify the
     apikey header name is exactly `apikey` on the connector config.
```

### Reauthorization triggers

| Trigger                        | Detection                              | Action                                                       |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------ |
| User changed PWF password      | 401 (empty body); `/login` Basic check fails | Re-prompt user via inline chat credential card          |
| Account API key regenerated    | 401 for **all** users; `/login` Basic check passes | Admin re-saves wizard with new key                |
| User lacks permission for data | Empty/filtered results (PWF filters server-side) | Adjust the user's permissions in ProWorkflow        |
| Rate limited                   | 429 + `x-ratelimit-*` headers          | Wait `x-ratelimit-reset` seconds and retry                   |
| Unknown path                   | HTML 404 page (not JSON)               | Endpoint typo — not an auth issue; check the API reference   |

Rate limit context: 500 requests / 30s per account API key, shared by **all** Numa
users on the account (`x-ratelimit-limit: 500`, `x-ratelimit-remaining`,
`x-ratelimit-reset` on every response).

---

## 5. Disconnect semantics

| Action                | What is deleted                                  | Effect                                                       |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| **User disconnects**  | `connector-proworkflow` (their personal vault)   | Only that user loses access; re-prompted on next chat use    |
| **Admin disconnects** | `connector-config-proworkflow` (company vault)   | Connector unconfigured for everyone — no apikey, no base URL; user secrets remain but are inert until an admin re-adds the connector |

---

## Numa Connector Wiring

### Credentials to store

**Company secret — `connector-config-proworkflow`** (written by the admin wizard):

| Key              | Type   | Description                                            |
| ---------------- | ------ | ------------------------------------------------------ |
| `api_key`        | Secret | Account API key (`XXXX-XXXX-...` format)               |
| `api_key_header` | Config | `apikey` — the header that carries the key             |
| `base_url`       | Config | `https://api.proworkflow.net`                          |
| `connector_type` | Config | `username-password`                                    |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card |

**User secret — `connector-proworkflow`** (written by the chat credential card, per user):

| Key        | Type   | Description                       |
| ---------- | ------ | --------------------------------- |
| `username` | Secret | User's ProWorkflow login email    |
| `password` | Secret | User's ProWorkflow password       |

### Test connection sequence

```
1. GET https://api.proworkflow.net/login?url=<account-slug> (Basic auth only)
   Expected: 200 with { apikey, accounturl, plan, permissions }
   401: user credentials invalid

2. GET https://api.proworkflow.net/contacts/me (apikey header + Basic auth)
   Expected: 200 {"status": "Success", ...}
   401 (empty body): apikey invalid (if step 1 passed)
```

### Auto-reconnect logic

```
on 401 response:
  # No tokens to refresh — one of the two long-lived credentials is bad.
  probe GET /login?url=<slug> with user's Basic auth only:
    if 200:  apikey is bad → notify admin "re-save the ProWorkflow wizard with the current API key"
    if 401:  user credential is bad → emit needs_credential → inline chat card re-prompts the user

on 429 response:
  wait x-ratelimit-reset seconds, retry
```
