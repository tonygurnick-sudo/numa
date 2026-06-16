---
api_name: Better Impact
api_slug: betterimpact
doc: connection & reauthorization (setup, rotation, failure diagnosis, disconnect, polling)
auth_type: username-password — user's vault holds an admin-generated API key pair (username+password), sent as HTTP Basic on every request. No OAuth, no refresh tokens, no expiry handling.
base_url: https://api.betterimpact.com/v1
confidence: Better Impact facts are docs-derived (official support articles, 2026-05-28); the connector path is unexercised — see `02-api-spec-investigation.md` §Known Unknowns. [UNKNOWN]/[UNVERIFIED]/[INFERRED] tagged inline.
---

# Better Impact — Connection & Reauthorization

## Auth type: HTTP Basic (admin-created API key pair)

Every authenticated request carries `Authorization: Basic base64(username:password)` — injected by the Numa backend. **No OAuth handshake, no token exchange, no refresh, no documented expiry**: the credential is a static pair generated when a Better Impact administrator creates an API key. Two shaping facts:

- **The pair is an artifact of key creation, not a person's login.** A Better Impact admin creates the key in the admin UI; the system generates the username+password. Not tied to any individual Better Impact user.
- **Access is module-scoped, filtering silent.** The key returns data only for the modules (Volunteer/Client/Member/Donor/Administrator) checked at creation. A key without the Volunteer module returns **empty volunteer data with a 200**, not an error — the single most confusing failure mode.

## 1. Create the API key (Better Impact side — admin only)

1. Log into Better Impact as an **administrator** ("Manage API Keys" access restrictable to specific Limited Access Admins).
2. Navigate to **Configuration → Organisation Settings → Security Settings** → **API Keys** section → **[+ Create API Key]**.
3. Check **Enabled**; check the **module checkboxes** for the data Numa should reach — Volunteer at minimum for rosters and hours.
4. **[Create API Key]** → system generates the **username+password pair**. Copy both.

Manage later: each key has **[Options]** → **Edit** (rename, enable/disable, change modules) and **Delete**.

**Key strategy:** Better Impact does not tie keys to people, so one shared pair works — but **one key per Numa user** is the better default: a deletion/rotation then disconnects only that user, and per-user keys can carry different module scopes. With a single shared pair, every rotation is a company-wide reconnect.

## 2. Per-user connection — inline chat credential card

**No admin step for user credentials in Numa** — the wizard stores metadata only (`connector-config-betterimpact`; `03-connector-setup.md` §4). Each user connects lazily, in chat:

1. The user asks the agent something needing Better Impact (e.g. "how many volunteer hours last month?").
2. Backend finds no `connector-betterimpact` secret in that user's vault, returns a structured `needs_credential` error built from the `credential_fields` snapshot on `connector-config-betterimpact`.
3. The agent surfaces an **inline credential card** asking for **Username** and **Password** — the pair generated when the admin created the API key (hint text points there; _not_ the user's Better Impact login).
4. On submit, the pair is stored as `connector-betterimpact` in the **user's vault** (`username`+`password`) via `POST /api/pat/betterimpact/credentials`; the request retries and succeeds.

The agent never sees the credentials: the backend (`handle_connect_request` in `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads them via `_user_connector_basic_creds` and injects `Authorization: Basic …` on every call. Agents never set that header; Better Impact requires no other special headers.

## 3. Credential lifetime / rotation

| Property              | Value                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expiry                | [UNKNOWN]; treat as static until deleted/disabled                                                                                                                                        |
| Refresh               | None — no refresh mechanism exists                                                                                                                                                       |
| Rotation / revocation | **Delete** (or uncheck **Enabled** on) the key via [Options] — calls 401 immediately [disable behaviour INFERRED; verify]; create a new key (new pair), users re-enter via the chat card |
| Scope changes         | **Edit** the key's module checkboxes — takes effect on the existing pair, **silently** changing returned data; no re-entry needed                                                        |

### Key deleted or disabled in Better Impact

The stored `connector-betterimpact` secret goes stale → requests **401**. Recovery is the same card as first connect: the next Better Impact request fails auth, the agent re-prompts, the user pastes the new pair (overwriting their vault secret). No Numa-admin involvement. If multiple users shared one key, **each** re-enters on next use — the key-per-user strategy avoids this.

### Key modules edited in Better Impact

**No auth failure at all** — the pair keeps working, but data for removed modules silently disappears (and added modules silently appear). If results shrink with no 401, check the key's module checkboxes before suspecting the connector.

## 4. Failure diagnosis

- **401 Unauthorized** — bad credentials: mistyped, deleted, or disabled key pair. Re-prompt via the credential card. The **only confirmed auth failure** (observed on live unauth probes; body shape [UNKNOWN]).
- **200 with empty/missing data on a populated org** — the defining gotcha: the key's **module scope** doesn't cover that data. No Volunteer module → no volunteers, no error, no warning. Fix in Better Impact (edit the key's modules), never in Numa. Suggest checking key module scope whenever results unexpectedly empty.
- **400/403/404** — undocumented [UNKNOWN]; verify the path (scope prefix `organization` vs `enterprise`!), parameter names, and datetime format (.NET "O" literal, e.g. `2026-06-01T00:00:00.0000000Z`) before assuming auth.
- **Enterprise vs organisation scope errors** — calling `/v1/enterprise/...` from a single-org account (or vice versa) has undocumented behaviour [UNVERIFIED]; default to `organization` scope unless the customer is enterprise tier.
- **Throttling** — no rate limits documented [UNKNOWN]. Back off 1s → 5s → 30s with jitter. **5xx** — retry once with backoff, then surface.

Raw error **bodies** are undocumented — diagnose from the status code first; body text is supporting evidence only.

### Reauthorization triggers

| Trigger                | Detection                                            | Action                                                                             |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Key deleted / disabled | 401 on every call for users holding the pair         | User re-enters the new pair via the inline chat card                               |
| Key modules edited     | Data appears/disappears with valid auth (200)        | Fix the key's module checkboxes in Better Impact — **not** a Numa fix, no re-entry |
| Wrong scope prefix     | Errors/empty on `enterprise` vs `organization` paths | Use the scope matching the account tier — request change, not reauth               |
| Rate limited           | Throttle response (limits [UNKNOWN])                 | Backoff with jitter; space page-walks                                              |

## 5. Disconnect semantics

| Action                | What is deleted                                 | Effect                                                                                                                                                        |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User disconnects**  | `connector-betterimpact` (their vault)          | Only that user loses access; re-prompted via the card on next chat use. The Better Impact key itself stays valid — delete it in Better Impact to truly revoke |
| **Admin disconnects** | `connector-config-betterimpact` (company vault) | Connector unconfigured for everyone — no base URL, no credential-card schema; user secrets remain but inert until an admin re-adds the connector              |

## Numa connector wiring

### Credentials to store

**Company secret — `connector-config-betterimpact`** (admin wizard; metadata only):
| Key | Type | Description |
| --- | --- | --- |
| `base_url` | Config | `https://api.betterimpact.com/v1` (from the registry) |
| `connector_type` | Config | `username-password` |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card |

**User secret — `connector-betterimpact`** (chat credential card, per user):
| Key | Type | Description |
| --- | --- | --- |
| `username` | Secret | API-key **username** (generated by Better Impact) |
| `password` | Secret | API-key **password** (generated by Better Impact) |

### Test connection sequence

```
1. GET https://api.betterimpact.com/v1/organization/users/?page_size=1&include_custom_fields=false&include_qualifications=false
   200 with { "Header": {...}, "Users": [...] } — auth + envelope proven
   401: pair invalid/deleted/disabled → re-enter via chat card
2. GET /v1/organization/timelog_entries?page_size=1   (module-sensitive probe)
   200 — proves the key's modules cover hours data
   200 with empty data despite hours existing → module gap; edit the key in Better Impact
```

### Auto-reconnect logic

```
on 401 response:
  # Nothing to refresh — the static pair is dead (key deleted or disabled).
  emit needs_credential → inline chat card re-prompts for username + password
on 200 with unexpectedly empty data:
  do NOT re-prompt — suspect the key's MODULE scope (or the enterprise/organization
  scope prefix); fix in Better Impact / fix the path.
on throttle response (limits undocumented):
  backoff with jitter (1s → 5s → 30s); keep page-walks sequential — never busy-retry.
```

## Events & polling

**Webhooks: none.** Event needs met by **polling** with `updated_since` watermarks on `/users/` and `/timelog_entries` (advance from `date_updated` on returned records). The API is **read-only** — no write surface to reauthorize; everything that changes data happens in the Better Impact app.
