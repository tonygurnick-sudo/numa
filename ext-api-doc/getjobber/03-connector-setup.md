---
doc: connector-setup (Jobber-side; no Numa wiring)
api: Jobber (GraphQL only — no REST)
tenancy: single-tenant SaaS — ONE shared endpoint https://api.getjobber.com/api/graphql for every customer; account identity carried entirely by the OAuth bearer token (no tenant/org id to capture)
auth: OAuth 2.0 Authorization Code
confidence: all verified live 2026-05-19 unless tagged [DOCUMENTED]/[UNKNOWN]
---

# Connecting to the Jobber API

## 1. Product context

|                  |                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Vendor           | Jobber Software Inc. (Edmonton, Canada)                                                     |
| Product          | Jobber — home service management for trades/services SMBs                                   |
| API style        | GraphQL only (no REST)                                                                      |
| API endpoint     | `POST https://api.getjobber.com/api/graphql`                                                |
| Developer portal | https://developer.getjobber.com (Cloudflare-protected — log in interactively, can't scrape) |
| Status page      | https://status.getjobber.com                                                                |

## 2. Create a developer account + register an app

1. Visit https://developer.getjobber.com, sign up / sign in.
2. Create a new application:

| Field              | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| App name           | Free text — shown on consent screen                                       |
| Description        | Free text                                                                 |
| OAuth redirect URI | Your callback URL — must match byte-for-byte                              |
| Scopes             | Smallest set needed (see §6). Start read-only; add write scopes as needed |

3. Jobber issues **Client ID** and **Client Secret** (secret shown ONCE — capture immediately). Both required for OAuth.

## 3. OAuth 2.0 — Authorization Code flow

### 3.1 Authorize

```
GET https://api.getjobber.com/api/oauth/authorize?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code&scope=read_clients read_jobs read_invoices write_clients&state={OPAQUE_STRING}
```

| Param           | Required   | Notes                                  |
| --------------- | ---------- | -------------------------------------- |
| `client_id`     | yes        | From developer portal                  |
| `redirect_uri`  | yes        | Must match registered URI exactly      |
| `response_type` | yes        | Always `code`                          |
| `scope`         | yes        | Space-separated (see §6)               |
| `state`         | yes (CSRF) | Opaque value echoed back from callback |

User consents → redirects to `{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}`.

### 3.2 Token exchange

```
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&code={AUTH_CODE}&redirect_uri={REDIRECT_URI}&grant_type=authorization_code
```

Response (Jobber's documented example — only these two fields):

```json
{ "access_token": "{JWT}", "refresh_token": "{string}" }
```

> No `expires_in`/`token_type`/`scope` shown. Decode the JWT `exp` claim for expiry (no signature verification — just read the payload).
> **Access token lifetime: 60 min (3,600 s)** [DOCUMENTED 2026-05-19].
> **Refresh-token rotation is app-configurable** ("Refresh Token Rotation" toggle): ON → every refresh returns a NEW `refresh_token` (persist it!); OFF → original keeps working until revoked. Default not documented.

### 3.3 Refresh

```
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&refresh_token={REFRESH_TOKEN}&grant_type=refresh_token
```

### 3.4 Revoke

```
POST https://api.getjobber.com/api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={ACCESS_TOKEN_OR_REFRESH_TOKEN}
```

## 4. Required headers (every authenticated GraphQL call)

```
POST /api/graphql HTTP/2
Host: api.getjobber.com
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16
```

> `X-JOBBER-GRAPHQL-VERSION` is calendar-versioned (date `YYYY-MM-DD`), required for all apps. Latest active 2026-05-19: `2025-04-16`. A HEADER value, never a path segment. New versions published only on breaking changes (irregular); supported min 12 / max 18 months, removed in batches every 6 months. Unknown value → HTTP 404 `{"message":"GraphQL API version '<X>' does not exist"}`.

## 5. First call — smoke test

```http
POST https://api.getjobber.com/api/graphql
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16

{"query": "{ account { id name accountOwner { name { full } } } }"}
```

Expected `200`: `{ "data": { "account": { "id": "...", "name": "...", "accountOwner": { "name": { "full": "..." } } } } }`.

Failure modes (verified live, match verbatim):
| Symptom | Cause |
| --- | --- |
| `{"message":"Token not recognized"}` | Bad/expired access token → refresh |
| `{"message":"GraphQL API version 'X' does not exist"}` | Bad version header → use `2025-04-16` (do NOT refresh) |
| `{"message":"Invalid query"}` | Malformed GraphQL |
| `{"data":null,"errors":[{"extensions":{"code":"UNAUTHENTICATED"},...}]}` | Token valid but field requires auth — usually a token-scope problem on this field |

## 6. OAuth scopes

`read_<entity>` / `write_<entity>` pattern. Common:
`read_clients`/`write_clients`, `read_jobs`/`write_jobs`, `read_invoices`/`write_invoices`, `read_quotes`/`write_quotes`, `read_visits`/`write_visits`, `read_payments`/`write_payments`, `read_users`/`write_users` (employees), `read_account` (account metadata), `read_webhooks`/`write_webhooks` (subscribe/manage webhooks).

> Authoritative full list on the Cloudflare-walled dev portal — log in for it. Requesting a non-existent scope usually fails the authorize redirect. Use the smallest set needed; adding a write scope requires user re-consent (existing token does NOT auto-upgrade).

## 7. GraphQL — quick orientation

Single endpoint `POST /api/graphql`; every request body `{"query":"...","variables":{...}}`, every response `{"data":{...},"errors":[...]}`. Two operation kinds: **Query** (reads — multiple REST GETs in one round-trip), **Mutation** (writes — POST/PUT/PATCH/DELETE equivalent). Schema fully introspectable (no auth) — prefer it to guessing field names:

```graphql
{
  __type(name: "Quote") {
    fields {
      name
      description
      type {
        name
      }
    }
  }
}
```

## 8. Rate limits & throttling [DOCUMENTED 2026-05-19 — developer.getjobber.com/docs/using_jobbers_api/api_rate_limits]

Two independent limits per app per account:

1. **Request rate: 2,500 requests / 5 minutes** (≈8.3 RPS sustained).
2. **Query cost (complexity):** each field = 1 pt; `edges`/`nodes`/`node` = 0 pt; connection cost = `first` (or `last`) × fields-per-node. E.g. `clients(first:10){ nodes { id firstName lastName email phone } }` = 10 × 5 = 50 pts. Default max nodes when no `first`/`last` = 100.

Excess → **HTTP 429 + GraphQL `errors[].extensions.code:"THROTTLED"`**. No `Retry-After`/`X-RateLimit-*` headers; exponential backoff (1s, 2s, 4s …).

## 9. Webhooks (preferred over polling)

46 topics — full list in `01d`. Subscribe (requires token with webhook-management scope):

```graphql
mutation {
  webhookEndpointCreate(
    input: {
      url: "https://your-app.example/jobber/webhooks"
      topics: [CLIENT_CREATE, INVOICE_UPDATE, JOB_CLOSED, QUOTE_APPROVED]
    }
  ) {
    webhookEndpoint {
      id
      url
      topics
      active
    }
    userErrors {
      message
      path
    }
  }
}
```

Verify the topic enum: `query { __type(name: "WebHookTopicEnum") { enumValues { name } } }`.

## 10. Sandbox / test accounts

Jobber offers a developer test account at app-registration time (verify on the portal). Production public-app submission requires Jobber review; for an internal single-company app, skip submission and use the credentials directly.

## 11. Quick-reference URLs

| Resource           | URL                                             |
| ------------------ | ----------------------------------------------- |
| Developer portal   | https://developer.getjobber.com                 |
| GraphQL endpoint   | `https://api.getjobber.com/api/graphql`         |
| OAuth authorize    | `https://api.getjobber.com/api/oauth/authorize` |
| OAuth token        | `https://api.getjobber.com/api/oauth/token`     |
| OAuth revoke       | `https://api.getjobber.com/api/oauth/revoke`    |
| Status page        | https://status.getjobber.com                    |
| Public help centre | https://help.getjobber.com                      |
