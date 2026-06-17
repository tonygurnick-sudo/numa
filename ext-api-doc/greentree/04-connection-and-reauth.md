---
api_name: MYOB Greentree
api_slug: greentree
doc: connection & reauthorization (auth lifecycle, reconnect triggers, disconnect, troubleshooting, connector wiring)
auth_type: per-user HTTP Basic (the user's Greentree login) + account-level ApiKey header (site serial number, admin-managed). NO OAuth, no tokens, no expiry, no refresh.
hosting: customer-hosted; admin sets a per-customer instance_url (required, no registry fallback); company code goes in the per-request path, NOT the instance URL
call_surface: HTTP via connectors(name="request", connector="greentree")
confidence: not live-validated — auth/hosting facts from MYOB Greentree's official KB; status-code/error details [UNVERIFIED]; confirm against a real instance before customer use.
---

# MYOB Greentree — Connection & Reauthorization

## Auth type: dual — `ApiKey` header + HTTP Basic

Every authenticated request needs **BOTH**:

```
ApiKey:        {site serial number}                            ← account-level, admin-managed
Authorization: Basic base64(greentree-user:greentree-password) ← per-user login
Content-Type:  application/json                                ← POST with body (backend sets it)
Accept:        application/json                                ← get JSON not XML (backend sets it)
```

No OAuth flow, no tokens, no expiry, no refresh. Both credentials are long-lived: they work until the user changes their Greentree password or the site serial is reissued. Greentree enforces the Basic-auth user's own permissions server-side, so two Numa users with different roles see different data.

> The `ApiKey` may also be sent as a URL parameter (`?ApiKey=…`) — Numa uses the **header** only, so the key never lands in logs/URLs. Unlike Jiwa, Greentree has no session-token alternative — Basic auth is sent on every request; nothing to keep-alive, nothing to log out.

## 1. Account `ApiKey` — the site serial number (admin, once)

The account-level `ApiKey` is the Greentree **site serial number** — the same value for every user of that site.

1. Open Greentree's **licensing / About** screen (or ask the Greentree administrator) and copy the **site serial number** (docs show values like `23440933`).
2. Enter it in the **Integrations → MYOB Greentree** wizard under "Account configuration", together with the **Instance URL** (see `03-connector-setup.md`).

Saved on the company vault secret `connector-config-greentree` as `api_key`, alongside `api_key_header: ApiKey` and `instance_url`. The only secret material at the company level.

## 2. Per-user connection — inline chat credential card

**No admin step for user credentials.** Each user connects lazily, in chat:

1. The user asks the agent something that needs Greentree (e.g. "list our GL accounts for company 01").
2. The backend finds no `connector-greentree` secret in that user's personal vault and returns a structured `needs_credential` error built from the `credential_fields` snapshot on the connector config.
3. The agent surfaces an **inline credential card** asking for: **Username** (Greentree login username) and **Password** (Greentree password).
4. On submit, credentials are stored as `connector-greentree` in the **user's personal vault** (`username` + `password`). The agent retries and the request succeeds.

From then on, every request that user makes is sent with their own Basic auth — Greentree applies _their_ permissions, not an integration-wide service account. The agent never sees either secret: the backend (`handle_connect_request` in `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) injects `Authorization: Basic …` from the user vault and `ApiKey: …` from the company config on every call. Agents must never set those headers.

## 3. Lifetime, failure diagnosis & reauth triggers

No tokens, no expiry, no refresh — both credentials long-lived until changed. Key isolation rule: a 401 affecting **only one user** = that user's password (reconnect via card); a 401 affecting **all users at once** = the site ApiKey/serial (admin re-saves the wizard); a **connection error** (not 401) affecting all users = the instance URL or reachability (admin re-saves / customer IT). Status codes are [UNVERIFIED] (Greentree's docs don't publish them; these are expected HTTP conventions).

| Trigger / symptom                                                     | Detection                                                                   | Action                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User changed Greentree password                                       | 401, **only that user** affected; stored `connector-greentree` secret stale | next request fails auth → agent re-prompts the inline credential card → user enters new password (overwrites vault secret). No admin; others unaffected                   |
| Site ApiKey / serial reissued (rare — licence reissue)                | 401 for **all** users at once                                               | admin reopens the wizard and **re-saves** with the new serial → updates `api_key` on the existing `connector-config-greentree` (writes merge). User credentials untouched |
| Instance URL changed (host moved/renamed)                             | **connection error** (not 401) for **all** users                            | Numa admin re-saves the wizard with the new instance URL. User logins + ApiKey untouched                                                                                  |
| User lacks Greentree permission                                       | 401/403 or filtered/empty results on some routes                            | adjust the user's permissions **in Greentree** — not a Numa fix                                                                                                           |
| Wrong company code in path                                            | 404 (not auth)                                                              | use the correct company code (`/01/...`); check `/{company}/{Entity}/{id}`                                                                                                |
| Malformed write / business-rule veto                                  | 4xx                                                                         | fix the request payload                                                                                                                                                   |
| Server/Jade error (plugin/report failure, timeout)                    | 5xx                                                                         | customer diagnoses via `ApiTracing`/`ApiLogging` (`apilog.log`)                                                                                                           |
| Instance unreachable (service down, cert expired, firewall/whitelist) | connection refused / TLS error / timeout, not an HTTP status                | infrastructure — see §6; not an auth issue                                                                                                                                |

## 5. Disconnect semantics

| Action                | What is deleted                              | Effect                                                                                                                                                              |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User disconnects**  | `connector-greentree` (their personal vault) | only that user loses access; re-prompted via the card on next chat use. Their Greentree login stays valid — disable it in Greentree if the person is leaving.       |
| **Admin disconnects** | `connector-config-greentree` (company vault) | connector unconfigured for everyone — no instance URL, no ApiKey, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector |

## 6. Troubleshooting checklist (instance-side)

All customer-IT items — Numa cannot fix any remotely:

- [ ] **Instance unreachable** — is the Greentree API running? (Own Windows service, or part of the database service via `ServerApplication<n>=ApiSchema,ApiStartup`; from 2021.4+ it must run inside the DB service.) Correct `ListenPort` (default 9000)? Firewall / IP-whitelist / proxy rule blocking AWS? Is HTTPS published (reverse proxy / Cloudflare, valid cert, public DNS)? An expired cert makes clients refuse the connection.
- [ ] **Wrong company code** — the path segment (`/01/...`) must match the customer's Greentree company. A mismatch is a 404, not an auth failure.
- [ ] **ApiKey wrong** — must be the **site serial number** from licensing/About, not a user value. A wrong serial fails every user.
- [ ] **User permissions** — the Basic user runs with exactly their Greentree permissions; blanket access failures usually mean that user lacks rights to the entity.
- [ ] **Tracing for diagnosis** — the customer can turn on `ApiTracing`/`ApiLogging` in `jadegt.ini` (`[JadeLog]` → `apilog.log`, queried in real time). **Turn it off afterwards** — it grows the log file.

## Numa connector wiring

**Company secret — `connector-config-greentree`** (written by the admin wizard):
| Key | Type | Description |
| --- | --- | --- |
| `instance_url` | Config | customer's API base, e.g. `https://greentree.customer.com.au` — **required** (no registry fallback). Do NOT include the company code. |
| `api_key` | Secret | the site **serial number** (the account-level `ApiKey`) |
| `api_key_header` | Config | `ApiKey` — the header that carries the serial |
| `connector_type` | Config | `username-password` |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card |

**User secret — `connector-greentree`** (written by the chat credential card, per user):
| Key | Type | Description |
| --- | --- | --- |
| `username` | Secret | the user's Greentree login username |
| `password` | Secret | the user's Greentree password |

### Test connection sequence

`GET /{company}/Ping` (Basic + ApiKey backend-injected) → 200 = reachable + ApiKey + login all valid; 401 = bad login OR ApiKey [code UNVERIFIED]; 404 = wrong company code/entity; conn error = unreachable. Then `GET /{company}/GLAccount?page=1&pageSize=1` → 200 + one row [shape UNVERIFIED].

### Auto-reconnect logic

```
on 401:  no tokens to refresh — one of two long-lived credentials is bad.
         all users 401 at once → ApiKey/serial wrong → notify admin to re-save the wizard with the current site serial
         single user 401      → that user's password changed → emit needs_credential → inline card re-prompts that user
on 404:  not auth — check the company code + entity in the relative URL (/{company}/{Entity}/...)
on conn/TLS error: not auth — see §6 troubleshooting checklist
```
