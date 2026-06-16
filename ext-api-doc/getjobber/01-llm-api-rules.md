---
api_name: Jobber
api_slug: getjobber
base_url: https://api.getjobber.com
api_style: GraphQL only (NO REST)
endpoint_path: /api/graphql (the ONE and ONLY path; every op is POST here)
path_version_segment: none — version is a HEADER value, never in the path
http_method: POST (always; reads and writes both)
call_surface: HTTP via `numa integrations request` (POST /api/graphql, JSON body {query, variables})
auth: Bearer {access_token} (OAuth2; access token is a JWT, 60-min lifetime)
version_header: X-JOBBER-GRAPHQL-VERSION = 2025-04-16 (required; calendar-versioned date string)
field_casing: camelCase
id_format: EncodedId (opaque base64-like string; NEVER an integer — never parse/construct/compare)
date_types: ISO8601DateTime (RFC3339 timestamp), ISO8601Date (YYYY-MM-DD)
rate_limit: 2,500 req / 5 min per app per account + per-query cost ceiling (429 → extensions.code "THROTTLED")
confidence: every fact live-confirmed 2026-05-19 unless tagged [DOCUMENTED]/[INFERRED]
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
---

# Jobber — API Rules

## Call shape (read first)

- ONE endpoint: `POST https://api.getjobber.com/api/graphql`. NO REST API. Every read and write is a POST to this single path, body `{"query":"...","variables":{...}}`.
- NO path version segment. `2025-04-16` is a HEADER value (`X-JOBBER-GRAPHQL-VERSION`), never a `/2025-04-16/` path prefix. No per-resource paths (`/clients`, `/jobs` don't exist as URLs — they're GraphQL fields).
- Call surface: HTTP via `numa integrations request`. Method POST, path `/api/graphql`.

```http
POST https://api.getjobber.com/api/graphql
Authorization: Bearer {access_token}
Content-Type: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16

{"query":"...","variables":{...}}
```

- Omitting the version header pins to a server default that may change — always send `2025-04-16`.

## Five rules you must not forget

1. Every list is a Relay Connection. Always select `nodes { ... }` AND `pageInfo { endCursor hasNextPage }`. Paginate: `first: 50, after: "<endCursor>"`. No `pageInfo` → can't continue past page 1.
2. IDs are opaque `EncodedId` strings, not integers. Treat as opaque tokens — never construct, parse, or compare as numbers.
3. Mutations return a Payload, not the entity directly: `{ <entity> { … }, userErrors { message path } }`. 200 OK with non-empty `userErrors` is a FAILURE. Always select and inspect `userErrors`.
4. Cross-entity refs use IDs, not nested objects: create a Job for a client with `clientId: "<EncodedId>"`; convert a Quote via `jobCreateFromQuote(quoteId: ...)`.
5. Custom fields live on a `customFields` field on every major entity. Read with `customFields { ... }`; write via the entity's edit mutation with a `customFields:` arg.

## Defaults at a glance

| Key                   | Value                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint              | `POST https://api.getjobber.com/api/graphql`                                                                                     |
| API version (header)  | `2025-04-16` (required)                                                                                                          |
| Auth                  | `Authorization: Bearer {JWT}`                                                                                                    |
| Access token lifetime | 60 min (3600 s) [DOCUMENTED]                                                                                                     |
| Refresh rotation      | App-configurable: ON → new refresh token each refresh; OFF → original persists                                                   |
| Pagination            | Relay: `first`/`after`/`last`/`before` + `nodes` + `pageInfo` + `totalCount`                                                     |
| Default node cap      | 100 nodes per connection when no `first`/`last`                                                                                  |
| Query cost            | Each field = 1 pt (`edges`/`nodes`/`node` = 0). Connection cost = `first` × fields-per-node. E.g. `first:10` × 5 fields = 50 pts |
| Rate-limit response   | `429` + GraphQL `errors[].extensions.code: "THROTTLED"` — no `Retry-After` header; exponential backoff                           |

## Capabilities

CAN: create/read/update/archive/delete Client, Quote, Job, Visit, Invoice, Payment, Property, Request. Convert Quote→Job, Job→Invoice, Visits→Invoice. Send quotes/invoices via `clientHub`. Read schedules, expenses, timesheets. Subscribe to 46 webhook topics. Read account/user info. Manage automation rules. Run jobber-payments ops.

CANNOT (or hard): direct REST CRUD (no REST API). Bulk import without `clientsImport`/`clientsCreate`. Real-time GraphQL subscriptions (no `Subscription` root — use webhooks). Cross-account queries (every token single-account-scoped).

## Error → action (THREE shapes — handle all)

| Shape                               | Where                                            | Example                                                                                                                         | Action                                             |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Top-level `{"message":"..."}`       | Pre-GraphQL (auth, bad version, malformed query) | `{"message":"Token not recognized"}`                                                                                            | Refresh token / fix headers / fix query            |
| GraphQL `errors` array              | Per-field errors from a valid query              | `{"errors":[{"message":"... was hidden because you are unauthenticated","extensions":{"code":"UNAUTHENTICATED"}}],"data":null}` | Check `extensions.code` + failing path             |
| `userErrors` inside mutation `data` | Business-rule rejection (200 OK!)                | `{"data":{"clientCreate":{"client":null,"userErrors":[{"message":"Email is invalid","path":["emails","0","address"]}]}}}`       | Surface to user; do NOT retry without fixing input |

Verified pre-GraphQL error strings (match verbatim):

- Bad token → `{"message":"Token not recognized"}` (NOT a GraphQL errors envelope).
- Bad version header → `{"message":"GraphQL API version '<X>' does not exist"}`.
- Invalid query syntax → `{"message":"Invalid query"}`.
- Unauthenticated query for protected field → `errors` array with `code: "UNAUTHENTICATED"`.

Full error table + retry logic in `01d`.

## OAuth (Authorization Code)

```
GET https://api.getjobber.com/api/oauth/authorize?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code&scope=read_clients read_jobs read_invoices write_clients&state={OPAQUE}
```

Exchange code at `POST https://api.getjobber.com/api/oauth/token` (form-encoded `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code`). Refresh with `grant_type=refresh_token`. Revoke at `/api/oauth/revoke`.
Scopes use `read_<entity>` / `write_<entity>` (e.g. `read_clients`, `write_jobs`). Full list on the Cloudflare-walled Jobber dev portal (check directly). Adding a `write_*` scope requires re-consent — existing token does NOT auto-upgrade.

## [UNKNOWN] (not bluffed)

- Full scope vocabulary — dev-portal scope-list page 404'd at guessed URLs. Use `read_<entity>`/`write_<entity>`; invalid scopes rejected at consent time.
- Refresh token lifetime — undocumented; rotation is app-configurable (per-app ON/OFF).
- Webhook payload signature — `WebHookPayload` type exists; exact HMAC header name + secret format require a live delivery to verify.

## Hot-path examples

List active clients:

```graphql
query {
  clients(first: 50, filter: { isArchived: false }) {
    nodes {
      id
      firstName
      lastName
      companyName
      email
      balance
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

Open invoices for a customer:

```graphql
query OpenInvoices($clientId: EncodedId!) {
  client(id: $clientId) {
    id
    invoices(first: 50, filter: { invoiceStatus: awaiting_payment }) {
      nodes {
        id
        invoiceNumber
        dueDate
        amounts {
          total
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
```

Jobs scheduled today:

```graphql
query {
  jobs(first: 50, filter: { jobStatus: today }) {
    nodes {
      id
      jobNumber
      title
      client {
        firstName
        lastName
      }
      startAt
      endAt
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

Discover fields on the fly (introspection, no auth needed):

```graphql
query {
  __type(name: "Invoice") {
    fields {
      name
      description
    }
  }
}
```

Create a client (mutation — check `userErrors`):

```graphql
mutation {
  clientCreate(
    input: {
      firstName: "Tony"
      lastName: "Gurnick"
      companyName: "Arcanum AI"
      isCompany: true
      emails: [{ address: "tony@arcanum.ai", primary: true }]
      phones: [{ number: "+64 27 000 0000", primary: true }]
      billingAddress: { street1: "123 Main St", city: "Auckland", province: "AUK", postalCode: "1010", country: "NZ" }
    }
  ) {
    client {
      id
      firstName
      lastName
    }
    userErrors {
      message
      path
    }
  }
}
```

More queries in `01b`, mutations in `01c`.
