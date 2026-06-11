---
api_name: 'Jiwa Financials'
api_slug: 'jiwa'
auth_type: 'token (per-user Staff API key, Bearer)'
generated_date: '2026-06-10'
---

# Jiwa Financials — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to Jiwa Financials.
> Auth type: **per-user Staff API key** sent as a Bearer token. No OAuth.
>
> ⚠️ **Not live-validated** — no test instance; auth facts come from Jiwa's official
> wiki and OpenAPI spec ([DOCS]/[SPEC]). Only live observation: unauthenticated requests
> return **401 with an empty body**. Verify against a real instance before customer use.

---

## Auth Type: API key (Bearer)

Every authenticated request carries one header [DOCS]:

```
Authorization: Bearer {staff_api_key}     ← per-user, injected by the Numa backend
Content-Type:  application/json           ← POST/PATCH with body (backend sets it)
```

There is **no auth step** with API keys — no login call, no token exchange, no
refresh. The key is supplied on every request. Keys are bound to a Jiwa **staff
member** and carry exactly that staff member's route permissions, so two Numa users
with different Jiwa user groups see different data through the same connector.

Jiwa also accepts keys via HTTP Basic or as a URL/form parameter [DOCS] — Numa uses
the Bearer header only; never put keys in URLs (they end up in logs).

### Session auth — N/A for Numa

Jiwa's other auth method (`/auth` with username/password → `SessionId` carried as the
`ss-id` cookie or `X-ss-id` header; idle expiry per `SessionExpiryInMinutes`;
`/KeepAlive` to extend) is **not used by Numa** — the backend is stateless and injects
the Bearer key per request. Ignore session/cookie instructions in Jiwa's docs.

---

## 1. Generate a Staff API key (in Jiwa)

Each Numa user needs their **own** Staff API key, created by a Jiwa administrator
(or the user, if permitted) in the **Staff Maintenance** form [DOCS]:

1. Open **Staff Maintenance** in Jiwa and load the staff member's record.
2. On the API Keys section, add a new key. An **expiration date is optional**;
   keys can later be revoked by un-ticking **Enabled**. [DOCS]
3. Copy the key and hand it to the user through a secure channel — they will
   paste it into Numa's chat credential card (§2).

### Staff keys only — never Debtor keys

Jiwa has two key types [DOCS]:

| Key type           | Intended for                          | Use with Numa? |
| ------------------ | ------------------------------------- | -------------- |
| **Staff API key**  | A staff member — alternate to their username/password; full route permissions of that user | ✅ Yes |
| **Debtor API key** | Customers (web portals/storefronts); linked to a debtor **and** a nominated staff user; requests are heavily filtered and the wiki says explicitly not to trust them | ❌ Never |

Wiki security guidance worth enforcing [DOCS]: don't issue API keys to privileged
Jiwa accounts, and keep the key-holder's user group route permissions narrow (§4 —
403s are governed entirely by this).

---

## 2. Per-user connection — inline chat credential card

There is **no admin step for user credentials**. Each user connects lazily, in chat:

1. The user asks the agent something that needs Jiwa (e.g. "what's on hand for part 1172?").
2. The backend finds no `connector-jiwa` secret in that user's personal vault and returns
   a structured `needs_credential` error built from the `credential_fields` snapshot.
3. The agent surfaces this as an **inline credential card** asking for one field:
   **API Key** — the user's personal Jiwa **Staff** API key.
4. On submit, the key is stored as `connector-jiwa` in the **user's personal vault**
   (field `api_key`). The agent retries and the request succeeds.

From then on, every request that user makes runs with their own key — Jiwa applies
*their* staff permissions, not a shared service account. The agent never sees the key:
the backend (`handle_connect_request` in
`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads `api_key` from the
user vault (`_user_connector_token`) and injects `Authorization: Bearer ...` on every
call. Agents must never set that header themselves.

---

## 3. Key lifetime / rotation

| Property            | Value                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| Token format        | Opaque string [SPEC — exact format unverified]                              |
| Expiry              | **None by default** — long-lived; an expiration date *can* be set per key in Jiwa [DOCS] |
| Refresh mechanism   | None — no refresh tokens, no extension endpoint                             |
| Revocation          | Un-tick **Enabled** on the key in Staff Maintenance (or delete it) [DOCS]   |
| Expired/revoked key | Requests fail with **401 Not Authenticated** [DOCS]                         |

**Key revoked or regenerated in Jiwa** — the stored `connector-jiwa` secret goes
stale and that user's requests start returning 401. Recovery is the same card as first
connect: the user obtains a new Staff API key from Jiwa (§1) and re-enters it via the
chat credential card (overwrites the vault secret). No Numa-admin involvement; other
users are unaffected — there is no shared credential to rotate.

**Instance URL changed** (customer moved/renamed the API host) — every user's requests
fail with connection errors (not 401s). Fix: a Numa admin re-saves the **Integrations →
Jiwa Financials** wizard with the new instance URL. User keys are untouched.

---

## 4. Failure diagnosis — 401 vs 403 vs unreachable

Jiwa's status semantics are unusually clean [DOCS]:

- **401 Not Authenticated** — bad, expired, revoked, or disabled API key (observed
  with an **empty body** on the vendor-hosted instance — don't expect a JSON error).
- **403 Forbidden** — the key is **valid**; the staff member's user group does not
  permit that route. This is a **Jiwa-side configuration matter** — fix in Jiwa's User
  Group Maintenance (set "Default REST API Permission" or import the route list from
  `{api}/RestPaths` and allow the route). Nothing in Numa can fix a 403.
- **404** invalid route or missing record; **409** business-logic/concurrency
  conflict — neither is an auth problem.
- **Connection refused / TLS error / timeout** — infrastructure (service stopped,
  cert expired, firewall/whitelist, wrong instance URL). See §6.

### Reauthorization triggers

| Trigger                        | Detection                              | Action                                                          |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| Key revoked / disabled / expired | 401 (empty body) on any call         | User gets a new Staff key in Jiwa → re-enter via chat credential card |
| Route not permitted            | 403 on specific routes                 | Jiwa admin adjusts User Group route permissions — **not** a Numa fix |
| Instance unreachable           | Connection error, not an HTTP status   | Customer IT (service/cert/firewall); admin re-checks instance URL |
| Rate limited                   | Only if the optional REST API Rate Limit plugin is enabled (per-IP) | Back off and retry; ask customer about their plugin config |

---

## 5. Disconnect semantics

| Action                | What is deleted                              | Effect                                                                 |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| **User disconnects**  | `connector-jiwa` (their personal vault)      | Only that user loses access; re-prompted via the card on next chat use. The Jiwa-side key remains valid — revoke it in Staff Maintenance if the person is leaving. |
| **Admin disconnects** | `connector-config-jiwa` (company vault)      | Connector unconfigured for everyone — no instance URL, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector |

---

## 6. Troubleshooting checklist (instance-side, from the wiki's own list) [DOCS]

All customer-IT items — Numa cannot fix any of these remotely:

- [ ] **Instance unreachable** — is the *Jiwa Self Hosted REST API* Windows service
      running? `URLBase` correct (trailing slash required)? Port conflict with another
      listener? Firewall / IP-whitelist / Cloudflare rule blocking AWS?
- [ ] **Certificate expired** — clients refuse the connection outright. Check the
      Windows cert binding (`certlm.msc` / `netsh http show sslcert`) and win-acme renewal.
- [ ] **REST API plugin disabled or failed to compile** — re-check Plugin
      Maintenance; the Windows event log records plugin compile failures.
- [ ] **Service login failing** — can the configured `JiwaUsername` log into Jiwa
      interactively on the server without errors? The service does a normal login at start.
- [ ] **Route permissions never imported** — blanket 403s usually mean the user
      group's "Default REST API Permission" is Undefined and no explicit routes were
      imported from `{api}/RestPaths`.
- [ ] **DebugMode left on** — not a failure, but a security problem: it logs requests
      *including credentials*. Have the customer turn it off.

---

## Numa Connector Wiring

### Credentials to store

**Company secret — `connector-config-jiwa`** (written by the admin wizard; config only, no secret material):

| Key                 | Type   | Description                                                  |
| ------------------- | ------ | ------------------------------------------------------------ |
| `instance_url`      | Config | Customer's API base, e.g. `https://jiwa.customer.com.au` — **required in practice** (no registry fallback) |
| `connector_type`    | Config | `token`                                                      |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card        |

**User secret — `connector-jiwa`** (written by the chat credential card, per user):

| Key       | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| `api_key` | Secret | The user's personal Jiwa **Staff** API key   |

### Test connection sequence

```
1. GET {instance_url}/RestPaths (Bearer key)
   Expected: 200 with the full route list
   401: key invalid/revoked/expired · 403: RestPaths not permitted for the user group
   Connection error: instance unreachable — not an auth issue

2. GET {instance_url}/Queries/DebtorList (Bearer key)
   Expected: 200 with rows (row count capped by AutoQueryMaxLimit)
```

### Auto-reconnect logic

```
on 401 response:
  # No tokens to refresh — the long-lived key is bad.
  emit needs_credential → inline chat card re-prompts the user for a new Staff key
on 403 response:
  do NOT re-prompt — the key works; fix route permissions in Jiwa's User Group Maintenance
on connection/TLS error:
  not an auth issue — see the troubleshooting checklist in §6
```
