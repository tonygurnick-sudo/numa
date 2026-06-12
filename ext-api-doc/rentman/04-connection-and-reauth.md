---
api_name: 'Rentman'
api_slug: 'rentman'
auth_type: 'token (per-user workspace API token / JWT, sent as Bearer)'
generated_date: '2026-06-10'
---

# Rentman — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to Rentman.
> Auth type: **token** — the user's vault holds a long-lived **Rentman API token** (a JWT),
> sent as `Authorization: Bearer` on every request. No OAuth flow, no refresh tokens, no scopes.
>
> ⚠️ Rentman facts are spec/docs-derived (live spec fetch 2026-06-10) — the connector path has
> not been exercised against a real account. See `02-api-spec-investigation.md` §Known Unknowns.

---

## Auth Type: Bearer JWT (long-lived static token)

Every authenticated request carries:

```
Authorization: Bearer eyJ0eXAiOiJKV1Qi…      ← injected by the Numa backend
Content-Type: application/json               ← standard; nothing else is required
```

There is **no OAuth handshake, no token exchange, no refresh**. The token is a static JWT,
valid **10 years** for newly created tokens (older tokens: 5 years), checked on every request.

Two facts shape everything else:

- **The token is personalized and role-scoped.** It is unique to the Rentman user who generated
  it, and **API access is determined by that user's Rentman role** — there are no API scopes to
  configure. A warehouse-role token will not see what an admin-role token sees.
- **Only the last generated token is valid.** Regenerating in Rentman instantly invalidates the
  previous token — regeneration is both the rotation and the revocation mechanism.

---

## 1. Generate the token (Rentman side)

1. Log into Rentman with the account whose **role** matches the access Numa should have.
2. Navigate to **Configuration → Account → Integrations**.
3. If the API shows as deactivated, click **Connect** in the "API" field.
4. Click **Show token** and copy the JWT.
5. To rotate later: **Regenerate token** on the same screen — *"the old token will be
   invalidated"*.

**Token strategy:** the natural default is **each Numa user generates their own token** from
their own Rentman login — API permissions then mirror each person's real Rentman role, and a
regeneration only disconnects that one user. A single shared service-account token is possible
(everyone pastes the same JWT) but flattens permissions to that account's role and makes every
regeneration a company-wide reconnect. Rentman's own security guidance: treat the token like a
password — never email or screenshot it; if it ever had to be shared, regenerate afterwards.

---

## 2. Per-user connection — inline chat credential card

There is **no admin step for user credentials** — the wizard stores metadata only
(`connector-config-rentman`; see `03-connector-setup.md` §4). Each user connects lazily, in chat:

1. The user asks the agent something that needs Rentman (e.g. "what projects are on this week?").
2. The backend finds no `connector-rentman` secret in that user's personal vault and returns a
   structured `needs_credential` error built from the `credential_fields` snapshot on
   `connector-config-rentman`.
3. The agent surfaces this as an **inline credential card** asking for one field: **API Token**
   — with hint text pointing at Rentman → Configuration → Account → Integrations → API →
   Show token.
4. On submit, the token is stored as `connector-rentman` in the **user's personal vault**
   (field `api_key`). The agent retries and the request succeeds.

The agent never sees the token: the backend (`handle_connect_request` in
`lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads it via
`_user_connector_token` and injects `Authorization: Bearer eyJ…` on every call. Agents never
set that header themselves; Rentman requires no other special headers.

---

## 3. Credential lifetime / rotation

| Property              | Value                                                                       |
| --------------------- | ----------------------------------------------------------------------------|
| Expiry                | **10 years** (new tokens; older tokens 5 years) — effectively static         |
| Refresh               | None — no refresh mechanism exists                                           |
| Rotation              | **Regenerate token** in Rentman → Configuration → Account → Integrations → API — the old token stops working immediately |
| Revocation            | Same action — regeneration IS revocation (one active token per user)         |
| Permission changes    | The user's Rentman **role** is evaluated server-side per request — role edits apply to the existing token without re-pasting [INFERRED from the role-based model; verify] |

### Token regenerated in Rentman

The stored `connector-rentman` secret goes stale and requests return **401**. Recovery is the
same card as first connect: the next Rentman request from chat fails auth, the agent re-prompts
with the credential card, and the user pastes the new token (overwriting their vault secret).
No Numa-admin involvement. If multiple users shared one service-account token, **each** of them
re-enters it on next use — the per-user-token strategy avoids exactly this.

### User leaves the company / loses Rentman access

Their token stops authorizing (account deactivated) → 401s for that Numa user only. Other
users are unaffected — another argument for per-user tokens over a shared one.

---

## 4. Failure diagnosis

- **401 Unauthorized** — bad credentials: wrong, regenerated, or deactivated token. Re-prompt
  the user via the credential card. This is the **only auth failure the spec documents**.
- **403 Forbidden** — **not declared anywhere in the Rentman spec.** What a role-denied call
  returns is [UNKNOWN] — it may surface as 401, 404, or silently filtered data. If a user with
  a known-good token gets 404s/empty results on data that exists, suspect their **Rentman role**
  before suspecting the connector — that is fixed in Rentman's user management, never in Numa.
- **400 Bad Request** — malformed query: expanding a non-link field, filtering a GENERATED or
  `custom_*` field, bad relational-operator syntax. Fix the request, don't re-prompt.
- **404** — wrong path or id (integer ids; check the resource exists and the role can see it).
- **Throttling** — limits are 10 req/s, 50,000 req/day, 20 concurrent; the breach status code
  is undocumented [UNKNOWN]. Back off 1s → 5s → 30s with jitter on any throttle-looking
  response; keep page-walks ~150 ms apart.
- **5xx (500/502)** — server error; retry once with backoff, then surface.
- **5 MB response error** — reduce `limit` or trim `?fields`; not an auth issue.

Raw error **bodies** are undocumented — diagnose from the status code first; body text is
supporting evidence only.

### Reauthorization triggers

| Trigger                                  | Detection                              | Action                                                  |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Token regenerated / account deactivated  | 401 on every call for that user        | User re-enters the token via the inline chat card        |
| Role lacks access                        | 404 / empty / unexpected results with valid auth | Fix the user's role in Rentman — **not** a Numa fix |
| Rate limited                             | throttle response (status [UNKNOWN])   | Backoff with jitter; space page-walks                     |
| Oversized response                       | 5 MB error                             | Lower `limit` / use `?fields` — request change, not reauth |

---

## 5. Disconnect semantics

| Action                | What is deleted                              | Effect                                                       |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| **User disconnects**  | `connector-rentman` (their personal vault)   | Only that user loses access; re-prompted via the card on next chat use. The Rentman token itself remains valid — regenerate it in Rentman if access should be truly revoked. |
| **Admin disconnects** | `connector-config-rentman` (company vault)   | Connector unconfigured for everyone — no base URL, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector |

---

## Numa Connector Wiring

### Credentials to store

**Company secret — `connector-config-rentman`** (written by the admin wizard; metadata only):

| Key                 | Type   | Description                                            |
| ------------------- | ------ | ------------------------------------------------------- |
| `base_url`          | Config | `https://api.rentman.net` (from the registry)           |
| `connector_type`    | Config | `token`                                                  |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card    |

**User secret — `connector-rentman`** (written by the chat credential card, per user):

| Key       | Type   | Description                                |
| --------- | ------ | ------------------------------------------- |
| `api_key` | Secret | The **Rentman API token** (long-lived JWT)  |

### Test connection sequence

```
1. GET https://api.rentman.net/projects?limit=1&fields=id,name,number
   Expected: 200 with { "data": [...], "itemCount": 1 } — auth + envelope proven
   401: token invalid/regenerated → re-enter via chat card

2. GET /invoices?limit=1&fields=id,number   (or another role-sensitive module)
   Expected: 200 — proves the generating user's role covers financials
   404/empty despite data existing → role gap; fix in Rentman user management
```

### Auto-reconnect logic

```
on 401 response:
  # Nothing to refresh — the static token is dead (regenerated or account deactivated).
  emit needs_credential → inline chat card re-prompts the user for the token

on 404 / empty with valid auth:
  do NOT re-prompt — suspect the generating user's Rentman ROLE; fix in Rentman.

on throttle response (status undocumented):
  backoff with jitter (1s → 5s → 30s); budget 10 rps / 50k day — never busy-retry.
```

---

## Events & future surfaces

- **Webhooks: none.** Rentman documents no webhooks or streaming. Event needs are met by
  **polling** with `modified[gte]` watermarks and the per-item `updateHash` (designed for
  change detection).
- **First-party MCP server (beta) — the FEAT-209 customer's actual ask.** Rentman runs
  `mcp.rentman.net` (MCP endpoint `/mcp`) with **OAuth 2.1 + PKCE and dynamic client
  registration** (`/authorize`, `/token`, `/register`) — a completely different auth model
  from this connector's static JWT. Numa's MCP surface today is **NetSuite-only**; generic
  remote-MCP auth is a platform feature to spike separately. When it lands, the MCP server
  becomes the preferred second surface — until then, this REST token connector carries the
  workload. Do not attempt to route `mcp.rentman.net` through the NetSuite-specific path.
- **Current RMS** (`api.current-rms.com`) is requested on the same FEAT-209 card — a separate
  rental platform and a **separate connector candidate**, out of scope for this pack.
