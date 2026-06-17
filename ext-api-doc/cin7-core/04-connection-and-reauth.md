---
api_name: Cin7 Core
api_slug: cin7-core
auth_type: api-key with credentialHeaderMap — user vault holds Account ID + Application Key, sent as the two custom headers api-auth-accountid + api-auth-applicationkey on every request. No OAuth, no tokens, no expiry, no refresh, no Authorization header.
base_url: https://inventory.dearsystems.com/externalapi/v2
call_surface: HTTP via `numa integrations request cin7-core <METHOD> <relative-url>` (native connector)
auth_failure_code: 403 (NOT 401) = bad/revoked credentials
role: connection & reauthorization lifecycle
confidence: Cin7 facts docs-derived (official Apiary blueprint, live 2026-05-22); connector path NOT exercised against a real account. Core only — Cin7 Omni is a different product/API (connector `cin7-omni`).
---

# Cin7 Core — Connection & Reauthorization Guide

## Auth type: custom headers (static credentials)

Every authenticated request carries:

```
api-auth-accountid:      <account-id>          ← injected by the Numa backend
api-auth-applicationkey: <application-key>     ← injected by the Numa backend
Content-Type:            application/json      ← POST/PUT with body (backend sets it)
```

**No OAuth flow, no token exchange, no expiry, no refresh** — and no `Authorization` header. Credentials are long-lived and checked on every request: they work until the API Application is deleted or regenerated in Cin7 Core.

The credential pair is **per API Application, not per Cin7 user** — two Numa users pasting the same Application's pair get identical access and share its 60/min budget. Per-user separation only exists if each user is given their own Application (§1). The **Account ID is per company**: in multi-company setups the pair only reaches the company it was created in.

## 1. Create the credentials (Cin7 Core side)

1. Log into Cin7 Core at `inventory.dearsystems.com` (the right **company** in multi-company setups).
2. **Integrations → API**.
3. **New Application**, give it a name (e.g. `Numa`).
4. Copy the **Account ID** and the generated **Application Key**.
5. Hand both to the user(s) via a secure channel — they paste them into Numa's chat credential card (§2).

**Application strategy:** rate limits are **per Application Key** — each Application gets its own 60/min budget. Where practical, issue **one Application per Numa user**: each gets its own key and budget, and one user's regenerated key doesn't break others. Otherwise a single shared "Numa" Application works, all users pasting the same pair and sharing one 60/min budget. (Unlike Omni, no per-endpoint permission toggles — a valid pair grants the Application's full API access.)

## 2. Per-user connection — inline chat credential card

**No admin step for user credentials** — the wizard stores metadata only. Each user connects lazily, in chat:

1. The user asks the agent something needing Cin7 Core (e.g. "how many widgets in the Auckland warehouse?").
2. The backend finds no `connector-cin7-core` secret in that user's personal vault, returns a structured `needs_credential` error built from the `credential_fields` snapshot on `connector-config-cin7-core`.
3. The agent surfaces this as an **inline credential card** asking for **Account ID** (Cin7 Core → Integrations → API) and **Application Key** (the API Application's key, a password field).
4. On submit, the pair is stored as `connector-cin7-core` in the **user's personal vault** (fields `account_id` + `application_key`). The agent retries and the request succeeds.

The agent never sees either value: the backend (`handle_connect_request` in `lambdas/python/oauth-workspace-tools/tools/connect_tools.py`) reads them via `_user_connector_header_creds` — resolving the admin-stored `credential_header_map`, building **both** custom headers, all-or-nothing (a partial pair counts as not connected) — and injects them on every call. Agents must never set those headers themselves.

## 3. Credential lifetime / rotation

| Property                       | Value                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Expiry                         | **None** — static credentials, valid until changed in Cin7 Core                                   |
| Refresh mechanism              | None needed                                                                                       |
| Key regeneration / app deleted | **Invalidates the old key immediately** — every Numa user holding it starts getting auth failures |
| Account ID change              | Effectively never (per-company constant)                                                          |

**Key regenerated (or Application deleted) in Cin7 Core:** the stored `connector-cin7-core` secrets go stale and requests start failing auth — Cin7 Core returns **403** for bad credentials (treat an unexpected 401 the same way). Recovery is the same card as first connect: the next Cin7 Core request from chat fails, the agent re-prompts with the credential card, and the user enters the Account ID + new Application Key (overwriting their vault secret). No Numa-admin involvement. If multiple users shared the regenerated key, **each** re-enters it on their next use.

**Webhooks stopped firing (customer's own endpoints):** not a credential problem — Cin7 Core silently sets `IsActive:false` on a webhook after 6 failed deliveries. Check `GET /webhooks`, reactivate via PUT. Webhooks also require the **Automation module add-on**.

## 4. Failure diagnosis — 403 means BAD CREDENTIALS in Core

Cin7 Core inverts the usual 401/403 semantics — the exact opposite of Cin7 Omni:

- **403 Forbidden** — **authentication failure**: wrong/revoked Account ID or Application Key, or the pair belongs to a different company. Re-prompt the user via the credential card. No per-endpoint permission model in Core, so 403 is never "missing permission toggle" (that's Omni). Never retry-loop a 403 — not transient.
- **404 Not Found** — almost always a **misspelled endpoint name** (`/Products` instead of `/Product` — names are singular and exact), or a missing `/externalapi/v2` prefix. NOT an auth problem; don't re-prompt.
- **400** — validation (e.g. Customer POST missing one of its 7 required fields, malformed JSON). Fix the payload.
- **405** — write attempted on a read-only endpoint (e.g. the `…List` endpoints).
- **429** — rate limited (60/min per Application Key). Back off 1s → 5s → 30s → 2m; the budget resets within the minute window.
- **200 with an `Errors` array** — partial success (e.g. Disassembly). Surface the errors; do not treat as clean success. **204** = success, empty body.

### Reauthorization triggers

| Trigger                             | Detection                                  | Action                                                                                   |
| ----------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Application Key regenerated/deleted | 403 on every call for affected users       | Each user re-enters credentials via the inline chat card                                 |
| Wrong company's Account ID          | 403 (or empty/foreign data) from first use | Re-enter with the correct company's Account ID                                           |
| Rate limited                        | 429                                        | Backoff; pace ~1 req/sec                                                                 |
| Webhook auto-deactivated            | `IsActive:false` on `GET /webhooks`        | Reactivate via PUT; investigate the receiving endpoint — **not** a Numa credential issue |
| Whole-account API issues            | 403 for **all** users simultaneously       | Check the API Application still exists in Cin7 Core                                      |

## 5. Disconnect semantics

| Action                | What is deleted                              | Effect                                                                                                                                                                           |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User disconnects**  | `connector-cin7-core` (their personal vault) | Only that user loses access; re-prompted via the card on next chat use. The Cin7-side Application stays valid — delete it in Cin7 Core to truly revoke access.                   |
| **Admin disconnects** | `connector-config-cin7-core` (company vault) | Connector unconfigured for everyone — no base URL, no `credential_header_map`, no credential-card schema; user secrets remain but are inert until an admin re-adds the connector |

## Numa connector wiring

### Credentials to store

**Company secret — `connector-config-cin7-core`** (written by the admin wizard; metadata only, no credential material):
| Key | Type | Description |
| --- | --- | --- |
| `base_url` | Config | `https://inventory.dearsystems.com/externalapi/v2` (from the registry) |
| `connector_type` | Config | `api-key` |
| `rate_limit_rpm` | Config | `60` |
| `credential_header_map` | Config | `{"api-auth-accountid":"account_id","api-auth-applicationkey":"application_key"}` |
| `credential_fields` | Config | JSON snapshot driving the inline chat credential card |

**User secret — `connector-cin7-core`** (written by the chat credential card, per user):
| Key | Type | Description |
| --- | --- | --- |
| `account_id` | Secret | The company's Cin7 Core **Account ID** |
| `application_key` | Secret | The API Application's **Application Key** |

### Test connection sequence

```
1. GET /me   (both custom headers injected)
   200: company/account details — credential pair valid
   403: credential pair invalid (Account ID or Application Key) → re-enter via chat card
   404: wrong path — check the /externalapi/v2 prefix, NOT an auth failure

2. GET /Product?page=1&limit=1
   200 with {"Products":[...],"Total":n} — proves business-data access
```

### Auto-reconnect logic

```
on 403:
  # Nothing to refresh — the static credential pair is bad (key regenerated/
  # deleted, or wrong company). In Core, 403 = AUTH failure, not permissions.
  emit needs_credential → inline chat card re-prompts for Account ID + Application Key

on 404:
  do NOT re-prompt — a 404 doesn't test credentials; it's a wrong endpoint
  name (singular, exact: /Product not /Products) or a wrong path prefix.

on 429:
  backoff (1s → 5s → 30s → 2m); the 60/min window resets quickly — pace ~1 req/sec rather than bursting.
```
