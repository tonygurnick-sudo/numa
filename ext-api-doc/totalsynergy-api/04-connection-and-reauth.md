# Total Synergy (API Key) — Connection & Reauthorization Guide

> Complete setup for connecting Numa to Total Synergy via a **static API key**.
> Auth type: **API key** (long-lived "hard coded key" — the vendor's documented path for batch
> jobs, internal apps, and testing). Detailed enough to automate connector setup once the
> `access-token` header + host/slug concerns (`03-connector-setup.md` §3) are handled.
>
> 📌 **Same API as `totalsynergy-oauth`.** That sibling connector uses the OAuth2 authorization-code
> flow (short-lived access token + ~1-month refresh token, app `ApplicationKey`/`ApplicationSecret`)
> and the **same** `access-token` request header. The only difference is credential acquisition —
> OAuth there, a static key copied from a Synergy user profile here. **This is the lower-friction
> variant** and the documented fallback for OAuth-averse tenants — at the cost of a manually rotated,
> longer-lived secret.
>
> ⚠️ **No live call was made.** All values below are `[DOCUMENTED]` from the developer portal/FAQ or
> `[INFERRED]`; 🔬 items need confirmation on a live tenant. Phase 2's "first successful call" gate
> is **NOT** satisfied — close it with the smoke test in the wiring section.

---

## Auth Type: Static API key (no OAuth, no refresh)

Total Synergy supports a **static, long-lived API key** as an alternative to OAuth. Per the API FAQ:
_"For customers wanting to build batch applications, internal applications or for testing before
deployment, limited duration hard coded keys can be used for static integrations."_ The user
generates the key in their Synergy profile and pastes it into Numa. The key **is** the access token
— it is sent verbatim in the `access-token` header on every call. **There is no authorize redirect,
no code exchange, no refresh token, and no `Oauth2/*` machinery.**

Every Total Synergy API call runs under the **issuing user's** Synergy security context. There is
**no scope system** — data access is whatever that user's Synergy role grants. The key is
**personal**: treat it as a high-value secret.

> 🚩 **Two non-standard requirements (see `03-connector-setup.md` §3).** (1) The credential goes in a
> custom **`access-token`** header — **not** `Authorization: Bearer`, and **not** `X-API-Key`.
> (2) Calls go to the shared host `api.totalsynergy.com` with the org **`{Slug}`** in the path — the
> registry's `instance_url` (`https://yourcompany.totalsynergy.com`) is **not** the API base.

---

## 1. Generate a Static API Key in Total Synergy

The key is generated **per user, in the Synergy web app** — there is no external developer console
and no OAuth application to register.

1. Log in to Total Synergy.
2. Click the **profile icon** (top-right) → **Profile settings**.
3. Click the **ellipsis (⋯)** menu → **API Key**.
4. Synergy offers **two keys with different expiries**:
   | Key option | Lifetime | Notes |
   | ------------ | --------- | ------------------------------------------------------ |
   | 1-year key | ~12 months | Shorter-lived; rotate sooner |
   | 3-year key | ~36 months | Longer-lived; fewer rotations, larger blast radius |
5. **Copy the complete API key** — it is used directly as the access token. Treat it like a
   password.
6. Paste it into Numa's **Total Synergy (API Key)** connector (`api_key` field).

> The key inherits the **role/permissions of the user who generated it.** Data that user cannot see
> in the Synergy UI is not visible through their key. Generate it from a user with the access the
> integration needs (no more). [DOCUMENTED]

---

## 2. Key Format

| Property           | Value                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| Header             | **`access-token: <apiKey>`** — NOT `Authorization: Bearer`, NOT `X-API-Key`        |
| Token format       | Opaque string (exact length / charset unconfirmed) 🔬                              |
| Max lifetime       | **1 year** or **3 years** (user picks at generation time) [DOCUMENTED]             |
| Scopes/permissions | None — inherited from the issuing user's Synergy role [DOCUMENTED]                 |
| Per-org vs per-key | Key is per-user; **rate-limit budget is per-organisation** (extra keys don't help) |

```
access-token: <apiKey>
Content-Type:  application/json     ← POST only
```

---

## 3. Token Refresh / Rotation

| Property           | Value                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Refresh mechanism  | **None** — no refresh tokens, no token-extension endpoint                                            |
| Can extend expiry? | No                                                                                                   |
| Rotation strategy  | Generate a **new** key in the Synergy profile before the old one expires, then re-paste it into Numa |

Because there is no refresh flow, rotation is **manual**. Track the key's creation/expiry and warn
ahead of time:

| Days before expiry | Action                                       |
| ------------------ | -------------------------------------------- |
| 30 days            | Warning in Numa connector / admin settings   |
| 14 days            | Notify the connection owner                  |
| 0 days             | Key expires → connector starts returning 401 |

> ⚠️ **Exact expiry tracking is approximate** — the key's TTL (1yr vs 3yr) depends on which option
> the user chose at generation, and Numa does not receive the expiry date from the API. Record which
> option was chosen when the key is pasted, if the wizard captures it. 🔬

---

## 4. Programmatic Key Management

There is **no documented API for listing, creating, or revoking static keys** — all key management
is done manually in the Synergy web UI (Profile settings → ⋯ → API Key). Regenerating the key in the
profile is assumed to invalidate the prior key (exact behaviour 🔬 confirm).

---

## 5. Reauthorization Triggers

| Trigger                   | Detection                         | Action                                                                                                                                                           |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key expired (1/3-yr)      | 401 response                      | **No refresh possible** — prompt the user to generate a new key in Synergy and re-paste it                                                                       |
| Key revoked / regenerated | 401 response                      | Prompt the user to paste the current key                                                                                                                         |
| Wrong header used         | 401 on a key that should be valid | Verify the key is in **`access-token`**, not `Authorization`/`X-API-Key`                                                                                         |
| Insufficient permissions  | 403/404 (data not visible)        | Check the issuing user's Synergy role; regenerate from a user with the needed access                                                                             |
| Rate limit (daily)        | 429 (?) 🔬                        | **Do NOT** treat as a reauth trigger and **do NOT** retry within the same day — the daily budget won't reset until the next day (suggest the Premium API add-on) |

> Unlike the OAuth sibling, a 401 here is **never** fixed by refreshing — there is no refresh flow.
> Every 401 resolves to "the key is missing, expired, revoked, or in the wrong header." Recovery is
> always a user action (regenerate + re-paste).

---

## Numa Connector Wiring

### Credentials to Store

| Key            | Type | Description                                                                                                                                                                                              |
| -------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key`      | user | The static API key (the access token) — sent verbatim in the `access-token` header                                                                                                                       |
| `instance_url` | conn | Collected by the registry (`https://yourcompany.totalsynergy.com` placeholder) — **misleading**; the real API base is `api.totalsynergy.com` + org `{Slug}`. Reconcile per `03-connector-setup.md` §3 🚩 |
| `org_slug`     | conn | Organisation `{Slug}` for resource paths (resolve via `…/Organisation/MySlug` 🔬). Derive/store separately from `instance_url`                                                                           |

> Contrast with `totalsynergy-oauth`, which stores `application_key` + `application_secret` (company,
> server-side) plus per-user `access_token` + `refresh_token` and runs a token/refresh exchange.
> This connector stores **one long-lived key** and has **no refresh machinery** — far simpler.

### Test Connection Sequence (Phase 2 smoke test — closes the gate)

```
1. GET https://api.totalsynergy.com/api/v2/Organisation           (or /Organisation/MySlug)
     access-token: <apiKey>
   -> verify 200; resolve the org {Slug}; store it on the connection (capture exact response shape 🔬)

2. GET https://api.totalsynergy.com/api/v2/Organisation/{Slug}/Projects?criteria.pagesize=1
     access-token: <apiKey>
   -> expect 200 and { "totalItems": <int>, "items": [ ... ] }
```

Failure modes on the smoke test:

| Status | Meaning                                                    | Action                                                                                                               |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 401    | Key missing / expired / revoked / **sent in wrong header** | Confirm `access-token` header (not `Authorization`/`X-API-Key`); if header is correct, regenerate the key in Synergy |
| 404    | Wrong host or wrong/missing `{Slug}`                       | Confirm calls go to `api.totalsynergy.com` (not `instance_url`); verify the org `{Slug}`                             |
| 429(?) | Daily rate limit hit 🔬                                    | Stop calling — won't reset until next day; suggest Premium                                                           |

> Running steps 1–2 against a live tenant is what closes the Phase 2 gate flagged in the
> questionnaire. Do it before trusting the connector in production.

### Auto-Reconnect Logic

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

---

## Sources

- Static-key acquisition + `access-token` header + limits + base URLs (API FAQ): https://help.totalsynergy.com/en/articles/8696457-api-faq
- Developer portal (endpoints, header): https://developers.totalsynergy.com/
- Premium API (limits / add-on): https://support.totalsynergy.com/hc/en-us/articles/360001631275-Premium-API

_Pair with `02-api-spec-investigation.md` (dev reference), `03-connector-setup.md` (build), and the
`01*` agent rules. Keep consistent with the sibling `totalsynergy-oauth` doc set — only the auth
differs._
