---
api_name: Total Synergy (API Key)
api_slug: totalsynergy-api
auth_type: api-key (static, long-lived "hard coded key" — vendor's documented path for batch jobs, internal apps, testing)
base_url: https://api.totalsynergy.com/api/v2/ (shared host; org {Slug} in the path — NOT the registry instance_url)
auth_header: access-token: <apiKey> — NOT Authorization: Bearer, NOT X-API-Key (either → 401)
refresh: NONE — no refresh tokens, no token-extension endpoint. Rotation is manual (regenerate + re-paste).
sibling: totalsynergy-oauth — same API + same access-token header, behind OAuth2 (short-lived access token + ~1-month refresh, app ApplicationKey/ApplicationSecret). Only credential acquisition differs.
confidence: values are [DOCUMENTED] from the developer portal/FAQ or [INFERRED]; 🔬 = confirm on a live tenant. NO live call made — Phase 2's "first successful call" gate is NOT satisfied; close it with the smoke test below.
---

# Total Synergy (API Key) — Connection & Reauthorization Guide

Setup for connecting Numa to Total Synergy via a static API key. The key **is** the access token — sent verbatim in the `access-token` header on every call. No authorize redirect, no code exchange, no refresh token, no `Oauth2/*` machinery. Every call runs under the **issuing user's** Synergy security context; there is **no scope system** (access = that user's role). The key is **personal** — treat it as a high-value secret.

> 🚩 Two non-standard requirements (see `03-connector-setup.md` §3): (1) credential goes in a custom **`access-token`** header (not `Authorization: Bearer`, not `X-API-Key`); (2) calls go to the shared host `api.totalsynergy.com` with the org **`{Slug}`** in the path — the registry `instance_url` (`https://yourcompany.totalsynergy.com`) is NOT the API base.

## 1. Generate a static API key in Total Synergy

Per user, in the Synergy web app — no external developer console, no OAuth app to register.

1. Log in to Total Synergy.
2. Profile icon (top-right) → **Profile settings**.
3. Ellipsis (⋯) menu → **API Key**.
4. Synergy offers two keys:
   | Key option | Lifetime | Notes |
   | --- | --- | --- |
   | 1-year key | ~12 months | Shorter-lived; rotate sooner |
   | 3-year key | ~36 months | Longer-lived; fewer rotations, larger blast radius |
5. **Copy the complete API key** — used directly as the access token. Treat it like a password.
6. Paste into Numa's **Total Synergy (API Key)** connector (`api_key` field).

> The key inherits the **role/permissions of the user who generated it.** Data that user can't see in the UI is invisible through their key. Generate from a user with the access the integration needs (no more). [DOCUMENTED]

## 2. Key format

| Property           | Value                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| Header             | **`access-token: <apiKey>`** — NOT `Authorization: Bearer`, NOT `X-API-Key`        |
| Token format       | Opaque string (exact length/charset unconfirmed) 🔬                                |
| Max lifetime       | **1 year** or **3 years** (user picks at generation) [DOCUMENTED]                  |
| Scopes/permissions | None — inherited from the issuing user's Synergy role [DOCUMENTED]                 |
| Per-org vs per-key | Key is per-user; **rate-limit budget is per-organisation** (extra keys don't help) |

```
access-token: <apiKey>
Content-Type:  application/json     ← POST only
```

## 3. Token refresh / rotation

| Property           | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no token-extension endpoint                                         |
| Can extend expiry? | No                                                                                                |
| Rotation strategy  | Generate a **new** key in the Synergy profile before the old one expires, then re-paste into Numa |

Rotation is **manual**. Track creation/expiry and warn ahead:
| Days before expiry | Action |
| --- | --- |
| 30 days | Warning in Numa connector / admin settings |
| 14 days | Notify the connection owner |
| 0 days | Key expires → connector starts returning 401 |

> ⚠️ Expiry tracking is approximate — TTL (1yr vs 3yr) depends on which option the user chose, and Numa does not receive the expiry date from the API. Record which option was chosen when the key is pasted, if the wizard captures it. 🔬

## 4. Programmatic key management

**No documented API for listing, creating, or revoking static keys** — all management is manual in the Synergy web UI (Profile settings → ⋯ → API Key). Regenerating the key is assumed to invalidate the prior key (exact behaviour 🔬 confirm).

## 5. Reauthorization triggers

| Trigger                   | Detection                         | Action                                                                                                                                                    |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key expired (1/3-yr)      | 401                               | **No refresh possible** — prompt the user to generate a new key in Synergy and re-paste it                                                                |
| Key revoked / regenerated | 401                               | Prompt the user to paste the current key                                                                                                                  |
| Wrong header used         | 401 on a key that should be valid | Verify the key is in **`access-token`**, not `Authorization`/`X-API-Key`                                                                                  |
| Insufficient permissions  | 403/404 (data not visible)        | Check the issuing user's Synergy role; regenerate from a user with the needed access                                                                      |
| Rate limit (daily)        | 429 (?) 🔬                        | **Do NOT** treat as a reauth trigger; **do NOT** retry within the same day — the daily budget won't reset until next day (suggest the Premium API add-on) |

> A 401 here is **never** fixed by refreshing — every 401 resolves to "the key is missing, expired, revoked, or in the wrong header." Recovery is always a user action (regenerate + re-paste).

## Numa connector wiring

### Credentials to store

| Key            | Type | Description                                                                                                                                                                                              |
| -------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key`      | user | The static API key (the access token) — sent verbatim in the `access-token` header                                                                                                                       |
| `instance_url` | conn | Collected by the registry (`https://yourcompany.totalsynergy.com` placeholder) — **misleading**; the real API base is `api.totalsynergy.com` + org `{Slug}`. Reconcile per `03-connector-setup.md` §3 🚩 |
| `org_slug`     | conn | Organisation `{Slug}` for resource paths (resolve via `…/Organisation/MySlug` 🔬). Derive/store separately from `instance_url`                                                                           |

> Contrast `totalsynergy-oauth`: it stores `application_key` + `application_secret` (company, server-side) plus per-user `access_token` + `refresh_token` and runs a token/refresh exchange. This connector stores **one long-lived key** with **no refresh machinery** — far simpler.

### Test connection sequence (Phase 2 smoke test — closes the gate)

```
1. GET https://api.totalsynergy.com/api/v2/Organisation           (or /Organisation/MySlug)
     access-token: <apiKey>
   -> verify 200; resolve the org {Slug}; store it on the connection (capture exact response shape 🔬)

2. GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1
     access-token: <apiKey>
   -> expect 200 and { "totalItems": <int>, "items": [ ... ] }
```

Running steps 1–2 against a live tenant closes the Phase 2 gate flagged in the questionnaire. Do it before trusting the connector in production.

**Smoke-test failure modes:**
| Status | Meaning | Action |
| --- | --- | --- |
| 401 | Key missing / expired / revoked / **sent in wrong header** | Confirm `access-token` header (not `Authorization`/`X-API-Key`); if header is correct, regenerate the key in Synergy |
| 404 | Wrong host or wrong/missing `{Slug}` | Confirm calls go to `api.totalsynergy.com` (not `instance_url`); verify the org `{Slug}` |
| 429 (?) 🔬 | Daily rate limit hit | Stop calling — won't reset until next day; suggest Premium |

### Auto-reconnect logic

```
on 401 response:
  # API-key based — NO auto-refresh is possible (there is no refresh flow)
  verify the key is sent in the `access-token` header (NOT Authorization: Bearer, NOT X-API-Key)  # #1 gotcha
  if header is correct:
    mark connector as "needs reauthorization"
    notify the user: "Total Synergy API key expired or revoked — generate a new key in Synergy
      (Profile settings → ⋯ → API Key) and re-paste it"
    disable the connector until a new key is provided

on 429 response (daily rate limit):
  do NOT retry within the same day  # budget is daily, not per-second
  surface "rate limit reached for today"; suggest the Premium API add-on
```

## Sources

- Static-key acquisition + `access-token` header + limits + base URLs (API FAQ): https://help.totalsynergy.com/en/articles/8696457-api-faq
- Developer portal (endpoints, header): https://developers.totalsynergy.com/
- Premium API (limits / add-on): https://support.totalsynergy.com/hc/en-us/articles/360001631275-Premium-API

Pair with `02-api-spec-investigation.md` (dev reference), `03-connector-setup.md` (build), and the `01*` agent rules. Keep consistent with the sibling `totalsynergy-oauth` doc set — only the auth differs.
