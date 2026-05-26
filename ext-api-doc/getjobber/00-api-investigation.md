# API Investigation — Jobber (GraphQL)

**Date:** 2026-05-19
**API:** Jobber Developer API — GraphQL only
**Status:** Verified live against introspectable schema at `https://api.getjobber.com/api/graphql`

> **Reading order:** start with `01-llm-api-rules.md` (cheat sheet). Deep reference in this file. Domain model in `01a-…`. Read/write patterns in `01b-…` and `01c-…`. Webhooks + errors in `01d-…`. Numa-side wiring in `03-…`.

---

## Phase 1 — Identity

|                      |                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vendor               | Jobber Software Inc. (Edmonton, Canada)                                                                        |
| Product              | Jobber — home service management (CRM + scheduling + invoicing)                                                |
| API name             | Jobber API                                                                                                     |
| API style            | **GraphQL only** (no REST). The legacy REST API was retired.                                                   |
| Endpoint             | `POST https://api.getjobber.com/api/graphql` [VERIFIED 2026-05-19]                                             |
| Developer portal     | https://developer.getjobber.com (Cloudflare-protected; not externally scrape-able)                             |
| Schema introspection | **Enabled and unauthenticated** for type/field listing. Real data queries require OAuth. [VERIFIED 2026-05-19] |
| Status page          | https://status.getjobber.com                                                                                   |

---

## Phase 2 — Authentication

|                        |                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth type              | OAuth 2.0 Authorization Code                                                                                                                                                                                                                                                                         |
| Authorize URL          | `https://api.getjobber.com/api/oauth/authorize` [VERIFIED — returns 302; matches registry]                                                                                                                                                                                                           |
| Token URL              | `https://api.getjobber.com/api/oauth/token` [VERIFIED — returns 302]                                                                                                                                                                                                                                 |
| Revoke URL             | `https://api.getjobber.com/api/oauth/revoke` [DOCUMENTED — Fundthrough/jobber-ruby SDK]                                                                                                                                                                                                              |
| Auth header            | `Authorization: Bearer {access_token}`                                                                                                                                                                                                                                                               |
| Access token format    | JWT                                                                                                                                                                                                                                                                                                  |
| Access token lifetime  | **60 minutes (3600 s)** — default expiration time [DOCUMENTED — developer.getjobber.com/docs/building_your_app/app_authorization, 2026-05-19]                                                                                                                                                        |
| Refresh token lifetime | Not specified in the OAuth docs page reviewed [UNKNOWN]                                                                                                                                                                                                                                              |
| Refresh rotation       | **App-configurable per Jobber app** — there is a "Refresh Token Rotation" setting on each app. ON → a new `refresh_token` is returned on every refresh. OFF → the original `refresh_token` keeps working. [DOCUMENTED 2026-05-19]                                                                    |
| Token response shape   | `{ "access_token": "{JWT}", "refresh_token": "{string}" }` per Jobber's documented example. Unusually for OAuth, **no `expires_in` / `token_type` / `scope` fields are shown** in their example — the agent must rely on the JWT `exp` claim for expiry. Verify on first real exchange. [DOCUMENTED] |
| Scopes                 | Scope names follow `read_<entity>` / `write_<entity>` pattern. Registry default: `read_clients read_jobs read_invoices`. Full list documented at developer.getjobber.com (sub-paths I tried for scopes returned 404; check the dev portal directly when logged in).                                  |

### App registration

1. Sign in to the Jobber Developer Portal at https://developer.getjobber.com.
2. Create a new application.
3. Configure name, description, OAuth callback URL, requested scopes.
4. Jobber issues a `client_id` + `client_secret`.

---

## Phase 3 — Required headers (every authenticated call)

```
POST /api/graphql HTTP/2
Host: api.getjobber.com
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16
```

| Header                           | Required?                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization`                  | yes (for data; not for `__schema` introspection)                      | Bearer JWT                                                                                                                                                                                                                                                                                                                                                                                          |
| `Content-Type: application/json` | yes                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                     |
| `X-JOBBER-GRAPHQL-VERSION`       | **REQUIRED for all apps** per Jobber's versioning policy [DOCUMENTED] | Calendar-versioned (`YYYY-MM-DD`). **Latest active: `2025-04-16`** [VERIFIED 2026-05-19 — confirmed against the Jobber changelog at developer.getjobber.com/docs/changelog and live POST to /api/graphql]. New versions are published only when there's a breaking/dangerous change. Old versions supported a minimum of 12 months, removed in batches every 6 months (max 18 months from release). |

---

## Phase 4 — Schema scale (verified 2026-05-19 via introspection)

|                                     | Count     |
| ----------------------------------- | --------- |
| Query fields                        | **348**   |
| Mutation fields                     | **556**   |
| Domain object types                 | **1,973** |
| Webhook topics (`WebHookTopicEnum`) | **46**    |

This is a very large schema — Jobber's surface area covers core CRM/jobs/invoicing plus Jobber Payments, AI Receptionist, Capital loans, Automations, Marketing, Bookkeeping, and platform-level concerns (Account, Subscription, Apps).

For an integrator, only a small core is usually relevant — see §6 below.

---

## Phase 5 — Pagination (Relay-style)

Every list field returns a Connection type with the standard Relay pagination shape.

```graphql
query {
  clients(first: 50, after: "<endCursor>") {
    nodes {
      id
      firstName
      lastName
    }
    pageInfo {
      endCursor
      hasNextPage
      hasPreviousPage
    }
    totalCount # available on most connections
  }
}
```

| Arg                  | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `first: N`           | Forward page size                                            |
| `after: "<cursor>"`  | Page forward from cursor                                     |
| `last: N`            | Backward page size                                           |
| `before: "<cursor>"` | Page backward from cursor                                    |
| `offset: N`          | Offset-based pagination (also supported on most connections) |

`PageInfo` fields verified via `__type(name:"PageInfo")`: `endCursor`, `hasNextPage`, `hasPreviousPage`. [VERIFIED 2026-05-19]

---

## Phase 6 — Core entities (representative — full type list is 1,973)

| Entity                 | Type name  | Field count         | Key fields                                                                                                                                                                                                                                                             |
| ---------------------- | ---------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client (customer)      | `Client`   | 55                  | `id`, `firstName`, `lastName`, `companyName`, `isCompany`, `isLead`, `isArchived`, `balance`, `billingAddress`, `emails`, `phones`, `clientProperties` → `PropertyConnection`, `jobs` → `JobConnection`, `invoices` → `InvoiceConnection`, `customFields`, `createdAt` |
| Property (job site)    | `Property` | 15                  | `id`, `address`, `client`, `taxRate`, `jobs` → `JobConnection`, `quotes`, `requests`, `customFields`                                                                                                                                                                   |
| Quote                  | `Quote`    | 46                  | `id`, `client`, `lineItems`, `amounts`, `discount`, `message`, `clientHubUri`, `lastTransitioned`, `jobs` → `JobConnection`, `customFields`                                                                                                                            |
| Job                    | `Job`      | 57                  | `id`, `client`, `jobNumber`, `jobStatus` (enum), `jobType` (enum), `startAt`, `endAt`, `completedAt`, `billingType`, `lineItems`, `visits`, `invoices`, `customFields`, `invoiceSchedule`                                                                              |
| Visit                  | `Visit`    | 36                  | `id`, `job`, `client`, `property`, `assignedUsers`, `startAt`, `endAt`, `isComplete`, `completedAt`, `lineItems`, `notes`                                                                                                                                              |
| Invoice                | `Invoice`  | 52                  | `id`, `client`, `invoiceNumber`, `invoiceStatus` (enum), `issuedDate`, `dueDate`, `amounts`, `lineItems`, `jobs`, `customFields`                                                                                                                                       |
| Payment                | `Payment`  | 8                   | `id`, `amount`, `currency`, `date`, `invoiceNumber`, `invoiceUrl`, `platform`, `success`                                                                                                                                                                               |
| User (employee)        | `User`     | 44                  | `id`, `name`, `email`, `phone`, `isAccountAdmin`, `isAccountOwner`, `labourRate`, `assignedColor`, `customFields`                                                                                                                                                      |
| Account (tenant)       | `Account`  | 40                  | `id`, `name`, `accountOwner`, `companyDetails`, `billingInformation`, `inTrial`, `industry`, `countryCode`, `crews` → `CrewConnection`                                                                                                                                 |
| Request (inbound lead) | `Request`  | (see introspection) | Lead-capture form submissions; convert to Quote/Job                                                                                                                                                                                                                    |

### Status enums (verified via introspection)

| Enum                    | Values                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobStatusTypeEnum`     | `requires_invoicing`, `archived`, `late`, `today`, `upcoming`, `action_required`, `on_hold`, `unscheduled`, `active`, `expiring_within_30_days` |
| `InvoiceStatusTypeEnum` | `draft`, `awaiting_payment`, `paid`, `past_due`, `bad_debt`, `sent_not_due`                                                                     |
| `QuoteStatusTypeEnum`   | `draft`, `awaiting_response`, `archived`, `approved`, `converted`, `changes_requested`                                                          |
| `WebHookTopicEnum`      | 46 values — see `01d-event-and-error-handling.md`                                                                                               |

### Cross-entity relationships

```
Account (tenant)
  └── Users, Crews, Settings
Client
  ├── Properties (job sites) ──┐
  ├── Jobs                     ├── Visits (scheduled appointments on Jobs)
  ├── Quotes ──converts──> Job ┘
  ├── Requests (lead intake) ──converts──> Quote
  ├── Invoices (one-off OR generated from Jobs/Quotes/Visits)
  └── Payments (recorded against Invoices)
```

Quote → Job → Visit → Invoice is the typical pipeline. Custom Fields exist on every major entity (`customFields` field returns a list of `{key, value}` pairs).

---

## Phase 7 — Rate limits

[DOCUMENTED 2026-05-19 — developer.getjobber.com/docs/using_jobbers_api/api_rate_limits]

Jobber enforces **two** independent limits:

### 7.1 Request rate

**2,500 requests per 5 minutes** (i.e. 2,500 / 300 s ≈ 8.3 RPS sustained). Per-app, per account.

### 7.2 Query cost (complexity)

Each query is scored against a "points budget":

- Scalar fields and leaf object fields = **1 point each**
- `edges`, `nodes`, `node` connection fields = **0 points**
- Connection cost = `first` (or `last`) × number of requested fields per node

**Example from Jobber docs:** a query for 10 nodes each with 5 fields costs `10 × 5 = 50 points`.

Default node cap when no `first`/`last` is supplied = **100 nodes**. There is a maximum points budget per query (exact ceiling not stated on the page reviewed — use bounded `first` values).

### 7.3 Excess behaviour

- HTTP status: `429 Too Many Requests`
- Response envelope: standard GraphQL `errors` array with `extensions.code: "THROTTLED"`
- No `Retry-After` or `X-RateLimit-*` headers documented on the rate-limit page reviewed. Use exponential backoff (1s, 2s, 4s…).

---

## Phase 8 — Webhooks

Fully supported via the `webhookEndpointCreate` / `webhookEndpointDelete` mutations and 46 `WebHookTopicEnum` topics. See `01d-event-and-error-handling.md` for the topic list and payload shape (the `WebHookPayload` type exists in the schema).

---

## Phase 9 — SDKs and community resources

| Resource                           | URL                                        | Notes                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official dev portal                | https://developer.getjobber.com            | Cloudflare-protected                                                                                                                                     |
| Status page                        | https://status.getjobber.com               |                                                                                                                                                          |
| `Fundthrough/jobber-ruby` Ruby SDK | https://github.com/Fundthrough/jobber-ruby | **Outdated** — calls the deprecated REST API (`X-API-VERSION: 3.3.0`, `API-ACCESS-TOKEN` header). Do NOT use as a reference for the current GraphQL API. |
| Live GraphQL endpoint              | `https://api.getjobber.com/api/graphql`    | Introspection unauthenticated; data requires OAuth                                                                                                       |

There is no widely-maintained third-party GraphQL SDK as of this audit — most integrators build directly against the GraphQL endpoint.

---

## Phase 10 — Confidence summary

|                                                                                                                           | Items                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [VERIFIED] live against `/api/graphql` introspection + live HTTP                                                          | core endpoint, version header (`2025-04-16` works), error shapes, all entity types/fields, all mutation names, status enums, webhook topics, pagination shape                                                                                                                                               |
| [DOCUMENTED] via developer.getjobber.com (sub-pages reachable via WebFetch despite the home page being Cloudflare-walled) | OAuth URLs, **access token lifetime (60 min)**, **refresh-token rotation toggle (per-app)**, token response example shape, **rate limits (2,500/5min + query-cost system)**, **version policy (12-mo minimum, 18-mo max, batched 6-mo removal)**, full active version list (17 versions back to 2022-05-23) |
| [UNKNOWN]                                                                                                                 | exact refresh token lifetime, full scope vocabulary (sub-pages I tried 404'd), webhook signature header name + HMAC secret format, query-cost ceiling per request                                                                                                                                           |

Resolve remaining unknowns by:

1. Logging into the dev portal (any account) and copy-pasting relevant pages, OR
2. Asking Jobber's developer support, OR
3. Making a first real OAuth call with the customer's app and observing live behaviour (rate-limit headers, token `expires_in`).
