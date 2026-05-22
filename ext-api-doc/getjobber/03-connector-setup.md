# Connecting to the Jobber API

> Step-by-step setup for obtaining credentials and getting the first successful API call against Jobber. Pure Jobber-side reference — no Numa-specific wiring.

Jobber is a **single-tenant SaaS** — there is one shared GraphQL endpoint at `https://api.getjobber.com/api/graphql` for every customer. Customer identity comes from the OAuth-issued bearer token.

---

## 1. Product context

|                  |                                                           |
| ---------------- | --------------------------------------------------------- |
| Vendor           | Jobber Software Inc. (Edmonton, Canada)                   |
| Product          | Jobber — home service management for trades/services SMBs |
| Website          | https://getjobber.com                                     |
| API style        | **GraphQL only** (no REST)                                |
| API endpoint     | `POST https://api.getjobber.com/api/graphql`              |
| Developer portal | https://developer.getjobber.com                           |
| Status page      | https://status.getjobber.com                              |

---

## 2. Create a Jobber developer account + register an app

1. Visit https://developer.getjobber.com.
2. Sign up / sign in.
3. Create a new application:

   | Field              | Value                                                                                             |
   | ------------------ | ------------------------------------------------------------------------------------------------- |
   | App name           | Free text — shown on consent screen                                                               |
   | Description        | Free text                                                                                         |
   | OAuth redirect URI | Your application's OAuth callback URL — must match byte-for-byte                                  |
   | Scopes             | Pick the smallest set you need (see §6). Start with read-only scopes; add write scopes as needed. |

4. Jobber issues:
   - **Client ID** — capture immediately
   - **Client Secret** — capture immediately, **shown once**

   Both are required for the OAuth flow.

---

## 3. OAuth 2.0 — Authorization Code flow

### 3.1 Authorize

```
GET https://api.getjobber.com/api/oauth/authorize
  ?client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}
  &response_type=code
  &scope=read_clients read_jobs read_invoices write_clients
  &state={OPAQUE_STRING}
```

| Parameter       | Required   | Notes                                            |
| --------------- | ---------- | ------------------------------------------------ |
| `client_id`     | yes        | From the developer portal                        |
| `redirect_uri`  | yes        | Must match the URI registered on the app exactly |
| `response_type` | yes        | Always `code`                                    |
| `scope`         | yes        | Space-separated scope strings (see §6)           |
| `state`         | yes (CSRF) | Opaque value you echo back from the callback     |

The user signs in to Jobber and consents. Jobber redirects back to:

```
{REDIRECT_URI}?code={AUTH_CODE}&state={STATE}
```

### 3.2 Token exchange

```
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
&grant_type=authorization_code
```

Response (JSON — per Jobber's documented example):

```json
{
  "access_token": "{JWT}",
  "refresh_token": "{string}"
}
```

> ⚠️ Jobber's documented example shows **only** `access_token` and `refresh_token` — no `expires_in`, `token_type`, or `scope` fields. The agent must decode the JWT's `exp` claim to determine expiry. Decode is verification-free on the client side (don't bother validating the signature — just read the payload).
>
> **Access token lifetime: 60 minutes (3,600 s).** [DOCUMENTED 2026-05-19 — developer.getjobber.com/docs/building_your_app/app_authorization]
>
> **Refresh-token rotation is app-configurable.** On the Jobber developer-portal app config there is a "Refresh Token Rotation" toggle: ON → every successful refresh returns a NEW `refresh_token` (persist it!); OFF → the original `refresh_token` keeps working until revoked. Inspect your app's setting; default not documented on the pages I reviewed.

### 3.3 Refresh

```
POST https://api.getjobber.com/api/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&refresh_token={REFRESH_TOKEN}
&grant_type=refresh_token
```

### 3.4 Revoke

```
POST https://api.getjobber.com/api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={ACCESS_TOKEN_OR_REFRESH_TOKEN}
```

---

## 4. Required headers (every authenticated GraphQL call)

```
POST /api/graphql HTTP/2
Host: api.getjobber.com
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16
```

> ⚠️ The `X-JOBBER-GRAPHQL-VERSION` header is **calendar-versioned** and per Jobber's docs is **required for all apps**. Latest active version as of 2026-05-19 is **`2025-04-16`** (verified against `developer.getjobber.com/docs/changelog` + live `POST /api/graphql`). New versions are published only when there's a breaking/dangerous change — irregular cadence. Old versions supported a minimum of 12 months, removed in batches every 6 months (max 18 months from release).

---

## 5. First successful call — smoke test

After obtaining `access_token`:

```http
POST https://api.getjobber.com/api/graphql
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16

{"query": "{ account { id name accountOwner { name { full } } } }"}
```

Expected: `200 OK` with

```json
{ "data": { "account": { "id": "...", "name": "...", "accountOwner": { "name": { "full": "..." } } } } }
```

Failure modes (all verified live 2026-05-19):

| Symptom                                                                        | Cause                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `{"message": "Token not recognized"}`                                          | Bad/expired access token → refresh                                                         |
| `{"message": "GraphQL API version 'X' does not exist"}`                        | Bad version header → use `2025-04-16`                                                      |
| `{"message": "Invalid query"}`                                                 | Malformed GraphQL                                                                          |
| `{"data": null, "errors": [{"extensions": {"code": "UNAUTHENTICATED"}, ...}]}` | Token valid but field requires auth — usually a token-scope problem on this specific field |

---

## 6. OAuth scopes

Scopes follow the `read_<entity>` / `write_<entity>` pattern. Common ones (from registry defaults + naming convention):

- `read_clients`, `write_clients`
- `read_jobs`, `write_jobs`
- `read_invoices`, `write_invoices`
- `read_quotes`, `write_quotes`
- `read_visits`, `write_visits`
- `read_payments`, `write_payments`
- `read_users`, `write_users` (employees)
- `read_account` (account metadata)
- `read_webhooks`, `write_webhooks` (subscribe/manage webhooks)

> The authoritative full scope list lives on the Jobber developer portal. The portal is Cloudflare-protected so it can't be scraped externally — log into developer.getjobber.com for the definitive list. Empirically, requesting a scope that doesn't exist usually fails the authorize redirect with an error.

Use the smallest scope set the integration needs. Adding a write scope requires user re-consent (the existing token does NOT auto-upgrade).

---

## 7. GraphQL — quick orientation

If you've never used GraphQL: it's a single endpoint (`POST /api/graphql`) where every request body is `{"query": "...", "variables": {...}}` and every response is `{"data": {...}, "errors": [...]}`. There are two operation kinds:

- **Query** — reads (the equivalent of multiple REST GETs in one round-trip)
- **Mutation** — writes (the equivalent of POST/PUT/PATCH/DELETE)

Jobber's schema is **fully introspectable** — you can ask the schema what fields each type has:

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

This is preferable to guessing field names. Schema introspection works without authentication.

---

## 8. Rate limits & throttling

[DOCUMENTED 2026-05-19 — developer.getjobber.com/docs/using_jobbers_api/api_rate_limits]

Two independent limits enforced per app per account:

1. **Request rate: 2,500 requests / 5 minutes** (≈8.3 RPS sustained).
2. **Query cost (complexity)** — per-query points budget:
   - Each field = 1 point
   - `edges` / `nodes` / `node` connection fields = 0 points
   - Connection cost = `first` (or `last`) × number of requested fields per node
   - Example: query for `clients(first: 10) { nodes { id firstName lastName email phone } }` = 10 × 5 = 50 points
   - Default max nodes per connection when no `first`/`last` supplied = 100

Excess returns **HTTP 429 + GraphQL `errors[].extensions.code: "THROTTLED"`**. No `Retry-After` or `X-RateLimit-*` headers documented — use exponential backoff (1s, 2s, 4s …).

---

## 9. Webhooks (preferred over polling)

Jobber supports 46 webhook topics — see `01d-event-and-error-handling.md` for the full list. Subscribe with:

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

This requires a token with webhook-management scope. Verify the topic enum via `query { __type(name: "WebHookTopicEnum") { enumValues { name } } }`.

---

## 10. Sandbox / test accounts

Jobber offers a developer test account at app registration time (verify on the portal). Production app submission requires Jobber review — for internal apps used by one company, you can skip the public-app submission and use the credentials directly with that one account.

---

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
