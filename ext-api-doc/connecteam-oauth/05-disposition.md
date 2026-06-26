---
api_name: Connecteam API (OAuth)
api_slug: connecteam-oauth
auth_type: oauth2 (client_credentials only — see verdict)
verdict: NON-SELF-SERVICE / contact-required — do NOT wire the 3-legged OAuth wizard
decided: 2026-06-24 (TASK-113)
shared_api: same REST API as connecteam-api (API-key); only auth differs
confidence: OAuth grant/token/refresh facts [DOCUMENTED — official developer.connecteam.com]; web-verified below
---

# Connecteam (OAuth) — Build Disposition (TASK-113)

## Verdict

**Leave `connecteam-oauth` as non-self-service (`selfService: false`) and remove it from the
self-service catalogs. Do NOT wire it through Numa's OAuth wizard. The API-key connector
(`connecteam-api`) is the normal and only supported path.**

This is the decision the OAuth `04-connection-and-reauth.md` "Open conflict" section flagged for
resolution. It is now resolved against Connecteam's **official** OAuth 2.0 documentation.

## Why — the registry stored a phantom 3-legged flow

The live registry entry encodes an `authorization_code` (3-legged, redirect-based) flow:

```typescript
oauth: {
  authUrl:  'https://app.connecteam.com/oauth/authorize',   // ❌ does not exist
  tokenUrl: 'https://app.connecteam.com/oauth/token',       // ❌ wrong host/path
  scopes:   'forms.read attachments.write',
}
```

Connecteam's official OAuth 2.0 is **`client_credentials` only** — server-to-server, **no
consent endpoint, no redirect, no refresh token**:

| Aspect            | Registry (as configured)                     | Official Connecteam OAuth 2.0                              |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Grant type        | `authorization_code` (3-legged redirect)     | **`client_credentials` only** (server-to-server)           |
| Authorization URL | `https://app.connecteam.com/oauth/authorize` | **None** — client_credentials has no consent endpoint      |
| Token URL         | `https://app.connecteam.com/oauth/token`     | **`POST https://api.connecteam.com/oauth/v1/token`**       |
| Client auth       | secret in code-exchange body                 | **HTTP Basic** (Client ID = user, Client Secret = pass)    |
| Token lifetime    | (implied long-lived via refresh)             | **86400 s (24 h)**                                         |
| Refresh token     | (implied by code flow)                       | **None** — re-mint on expiry                               |
| Scopes            | `forms.read attachments.write`               | `feature.permission` (e.g. `users.read`, `schedule.write`) |
| App registration  | "Developer Portal → Create an integration"   | "Your Name → Integration Center → OAuth 2.0 → Create app"  |

The registry's `authUrl`/`tokenUrl` point at endpoints that do not exist. Shipping the entry
self-service would render an OAuth **"Connect" button that 404s on authorize** — a violation of
the framework rule "never ship a button that does nothing."

## Why not just fix the endpoints and wire `client_credentials`

Three independent reasons, any one sufficient:

1. **Wizard mismatch.** Numa's `OAuthWizard` is a redirect-based 3-legged flow that requires an
   `authUrl` consent endpoint and exchanges an `authorization_code`. `client_credentials` has **no
   consent step and no redirect** — there is nowhere for the wizard to send the user. It does not
   fit the wizard at all.

2. **Generic path can't mint the token.** The generic request path (`connect_tools.do_request` →
   `get_oauth_token`) only **consumes an already-issued `access_token`** and refreshes via the
   standard OAuth-client record. Connecteam's flow needs a backend that POSTs HTTP-Basic
   `client_credentials` to `https://api.connecteam.com/oauth/v1/token` and **re-mints every 24 h
   (no refresh token)**. That is net-new, custom token-exchange backend code — explicitly NOT
   config-only, and out of scope for a generic-path connector.

3. **Zero added value — fully redundant.** Both surfaces hit the **same REST API**
   (`https://api.connecteam.com`); only auth differs (see `shared_api` across the pack).
   `client_credentials` is **account-level** (one app-wide token, like the API key) — it grants
   **no per-user identity and no capability** the static `X-API-KEY` connector lacks. Building a
   harder second backend for identical access is wasted effort and a second thing to break.

## What to change (registry + catalogs)

Applied by the integrator (patch specs in the structured output, not editable from this pack):

1. `connectorRegistry.ts` `connecteam-oauth`: add `selfService: false`, replace the phantom
   `oauth` endpoints + `oauthSetupSteps` with a contact-required note pointing admins at the
   **API-key** connector. Keep the entry (so the slug stays a known integration and any historical
   memory scopes remain valid) but it no longer appears in the self-service picker.
2. Remove `'connecteam-oauth'` from `NATIVE_CONNECTORS` (`infra/config/connectors.ts`) — the
   catalog-consistency test (`connectorRegistry.test.ts`) **requires** every `selfService: false`
   entry to be absent from `NATIVE_CONNECTORS`, else "non-self-service connector ids" fails.
3. Remove `"connecteam-oauth"` from `_NATIVE_CONNECTOR_SLUGS` (`user_profile.py`) — the Python
   mirror must match `NATIVE_CONNECTORS` exactly (same test, third assertion).

`connecteam-api` is unaffected and remains the live, self-service, config-only path.

## If a customer truly needs OAuth later

Only if a customer requires per-app scoped tokens over the static key, build a **dedicated
`client_credentials` token-mint provider** (HTTP-Basic POST to `api.connecteam.com/oauth/v1/token`,
24 h cache + re-mint, no refresh) as an explicit backend — it is a different auth model from the
generic path and a separate piece of work. Until then, the API-key connector covers every use case.

## Verified vendor facts (sources)

- API-key header is `X-API-KEY`; base URL `https://api.connecteam.com`; example
  `curl --url 'https://api.connecteam.com/me' --header 'X-API-KEY: YOUR_API_KEY'`
  — https://developer.connecteam.com/docs/authentication-1
- OAuth 2.0 is **`client_credentials` only**; token endpoint `POST https://api.connecteam.com/oauth/v1/token`;
  HTTP Basic client auth; **24 h** token (`expires_in: 86400`); **no refresh token**; scopes
  `feature.permission`; app registered at Integration Center → OAuth 2.0 → Create app
  — https://developer.connecteam.com/docs/oauth-20
- API access requires the **Expert plan or higher**; keys created at Settings → API Keys (owner-only)
  — https://developer.connecteam.com/docs/authentication-1
