---
api_name: 'JobAdder'
api_slug: 'jobadder'
auth_type: 'oauth2 (Authorization Code + refresh_token; 60-minute access tokens)'
generated_date: '2026-06-10'
---

# JobAdder — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to JobAdder.
> Auth type: **OAuth 2.0 Authorization Code** — admin registers a Developer Centre app once;
> each user consents via the browser redirect flow. **There is no PAT path and no chat
> credential card** — tokens are minted and refreshed entirely by the OAuth machinery.
>
> ⚠️ JobAdder facts are docs-derived (investigation 2026-06-10) — the connector path has not
> been exercised against a real account. Endpoint/auth URLs below are the **exact** values in
> the connector registry (`connectorRegistry.ts`, `id: 'jobadder'`).

---

## Auth Type: OAuth 2.0 (Authorization Code + refresh)

| Property               | Value                                                              |
| ---------------------- | -------------------------------------------------------------------|
| Authorize URL          | `https://id.jobadder.com/connect/authorize`                         |
| Token URL              | `https://id.jobadder.com/connect/token` (exchange **and** refresh)  |
| Scopes (registry)      | `read write offline_access` — space-separated                       |
| Auth code lifetime     | 5 minutes — exchange promptly                                       |
| Access token lifetime  | **60 minutes** (`expires_in: 3600`)                                 |
| Refresh tokens         | Issued only with `offline_access`; refresh responses carry a **new** refresh token — Numa re-persists it on every refresh |
| Redirect URI           | `https://{client}.numa.arcanum.ai/oauth/callback/jobadder` — must match the Developer Centre app byte-for-byte |

Every API call carries `Authorization: Bearer {access_token}`, injected by the Numa backend
(`connect_tools.py` → `get_oauth_token`). Agents never set that header. The token response
also includes an `api` field (the account's API base URL) — not captured by the generic
callback today; the default `https://api.jobadder.com/v2` host is used (see
`03-connector-setup.md` §5).

---

## 1. Register the OAuth app (JobAdder side — once per client)

1. Sign in to the **JobAdder Developer Centre** (`developers.jobadder.com`).
2. **Register an application** for Numa.
3. Add the redirect URI shown in the Numa OAuthWizard:
   `https://{client}.numa.arcanum.ai/oauth/callback/jobadder` (exact match required).
4. Copy the **Client ID** and **Client Secret** from the application page.

## 2. Admin + per-user connection flows

**Admin (once):** Integrations → JobAdder → OAuthWizard → paste Client ID/Secret → save.
This writes the `oauth-client-jobadder` company secret (`client_id`, `client_secret`,
`auth_url`, `token_url`, `scopes`). No user credential is collected anywhere in the wizard.

**Each user (per person):** connection is a **browser OAuth redirect, not a chat card**:

1. The user clicks **Connect** on the JobAdder integration card (or is sent there by the
   agent after a `needs_credential` response in chat).
2. `ConnectorsService.connect('jobadder')` → `GET /api/oauth/jobadder/authorize`
   (`oauth-auth-handler` Lambda) builds the authorize URL from the company secret —
   `response_type=code`, `client_id`, `redirect_uri`, `scope=read write offline_access`,
   `state` (+ PKCE S256 `code_challenge`) — and the browser navigates to
   `id.jobadder.com/connect/authorize`.
3. The user signs in to JobAdder and consents. JobAdder redirects back to
   `/oauth/callback/jobadder?code=…&state=…` (auth code valid 5 minutes).
4. The callback handler validates state, exchanges the code at the token URL
   (`grant_type=authorization_code` + `client_id`/`client_secret` + `code_verifier`), and
   writes the **`oauth-jobadder`** entry in the **user's personal vault**:
   `access_token`, `refresh_token`, `expires_at` (now + `expires_in`).
5. The user's next chat request to JobAdder succeeds — the backend injects the Bearer token.

If consent is denied, JobAdder redirects back with `error=access_denied` and no tokens are
stored; the user can retry from the same card.

---

## 3. Token lifetime / automatic refresh

| Property             | Value                                                                       |
| -------------------- | ----------------------------------------------------------------------------|
| Access token expiry  | 60 minutes; `expires_at` stored on the user secret                           |
| Refresh trigger      | `get_oauth_token` refreshes when within a **5-minute buffer** of `expires_at` — before the request, not after a 401 |
| Refresh request      | `POST {token_url}` form-encoded: `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token` |
| Rotation             | The documented refresh example returns a **new** `refresh_token`; Numa persists `new_token_data.get("refresh_token", old)` back to the vault on every refresh — correct whether or not rotation occurs |
| Refresh failure      | Non-200 from the token endpoint → no token returned → the request surfaces `needs_credential` / 401; the user **reconnects via the OAuth redirect** (§2). No admin involvement. |
| Refresh-token lifetime | Undocumented [UNKNOWN] — treat any refresh failure as "re-consent required"  |

> Concurrency note: with rotation in play, never fire two refreshes with the same refresh
> token. The vault write-back persists the latest pair; a lost refresh response means the
> stored token may be dead → the user re-consents (cheap — one redirect).

---

## 4. Failure diagnosis — 401 vs 403

- **401 Unauthorized** — the access token is expired/revoked **and refresh failed** (user
  revoked the grant in JobAdder, the Developer Centre app was deleted/regenerated, or the
  refresh token aged out). Recovery: the user reconnects via the OAuth redirect — same flow
  as first connect, overwriting `oauth-jobadder`. **Not** fixable by retrying.
- **403 Forbidden** — the token is **valid** but the grant **lacks the scope** for that
  endpoint (admin narrowed scopes from the `read write offline_access` default, or a write
  was attempted on a read-only grant). Fix the scopes on the app/wizard, then **users
  re-consent** — existing grants do not auto-upgrade. **Never re-prompt a reconnect loop on
  403**; it is not a credential problem.
- **404** — wrong path or id (integer ids; also check the record exists in *this* account);
  **409** — duplicate (candidate email, company name, application): look up the existing
  record and update instead; **422** — validation. Not auth problems.
- **429** — rate limited; budget unpublished. Back off 1s → 5s → 30s → 2m with jitter.
- **5xx** — retry once with backoff, then surface.

Raw error **bodies** are undocumented — diagnose from the status code first.

### Reauthorization triggers

| Trigger                                  | Detection                              | Action                                                  |
| ---------------------------------------- | -------------------------------------- | --------------------------------------------------------|
| Access token expired (normal)            | Pre-empted by the 5-min refresh buffer | None — automatic                                         |
| Grant revoked / refresh token dead       | Refresh fails → 401 / needs_credential | User reconnects via OAuth redirect (Integrations card)   |
| Client secret regenerated in Dev Centre  | All refreshes fail for everyone        | Admin re-runs the wizard (new secret); **all users re-consent** |
| Scope missing                            | 403 on specific endpoints              | Fix scopes → users re-consent — not a Numa-side fix      |
| Redirect URI changed/mismatched          | Authorize redirect errors              | Align the Dev Centre app URI with the wizard value       |
| Rate limited                             | 429                                    | Backoff with jitter; space page-walks                    |

---

## 5. Disconnect semantics

| Action                | What is deleted                                | Effect                                                       |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------|
| **User disconnects**  | `oauth-jobadder` (their personal vault)        | Only that user loses access; reconnect = redo the redirect flow. The JobAdder-side grant may remain until revoked in JobAdder. |
| **Admin disconnects** | `oauth-client-jobadder` (company vault)        | Connector unconfigured for everyone — no client credentials means no new grants **and no refreshes**; existing user tokens die within 60 minutes. Re-adding requires the wizard + user re-consent. |

---

## Numa Connector Wiring

### Credentials stored

**Company secret — `oauth-client-jobadder`** (written by the OAuthWizard):

| Key                        | Type   | Description                                            |
| -------------------------- | ------ | -------------------------------------------------------|
| `client_id`                | Config | Developer Centre application Client ID                  |
| `client_secret`            | Secret | Developer Centre application Client Secret              |
| `auth_url` / `token_url`   | Config | `id.jobadder.com/connect/authorize` / `…/connect/token` |
| `scopes`                   | Config | `read write offline_access`                             |

**User secret — `oauth-jobadder`** (written by the OAuth callback, per user):

| Key             | Type   | Description                                             |
| --------------- | ------ | ---------------------------------------------------------|
| `access_token`  | Secret | 60-minute Bearer token                                    |
| `refresh_token` | Secret | Rotated on refresh; re-persisted every time               |
| `expires_at`    | Config | ISO timestamp; drives the 5-minute pre-refresh buffer     |

### Test connection sequence

```
1. GET https://api.jobadder.com/v2/users/current
   Expected: 200 with the authenticated user — token + account confirmed
   401: grant dead → reconnect via OAuth redirect
   403: scope missing → fix scopes, re-consent

2. GET https://api.jobadder.com/v2/jobs?active=true&limit=1
   Expected: 200 with { items: [...], totalCount } — read scope proven on real data
```

### Auto-reconnect logic

```
before each request:
  token = get_oauth_token("jobadder", user_sub)
  # refreshes automatically when expires_at − now ≤ 5 min,
  # persisting the rotated refresh_token back to the vault

on refresh failure or 401:
  # grant revoked / refresh token dead — nothing to retry
  surface needs_credential → user reconnects via the OAuth redirect flow

on 403:
  do NOT reconnect-loop — the grant lacks that endpoint's scope.
  Fix scopes (wizard / Dev Centre app), then users re-consent.

on 429:
  backoff with jitter (1s → 5s → 30s → 2m); budget unpublished — never busy-retry.
```

---

## Events & future surfaces

- **Webhooks:** JobAdder documents webhook support (official KB article), but the article is
  not retrievable headlessly and the community spec carries no webhook endpoints — event
  types, payloads, and signatures are unknown. Until investigated from a logged-in browser,
  event needs are met by **polling** with `updatedAt=>{cursor}` filters (see
  `02-api-spec-investigation.md` §Webhooks).
- **Partner surfaces** (`partner_jobboard`, `partner_ui_action` scopes) are a different
  product integration — out of scope for this connector.
