# LLM Cheat Sheet — Jobber (GraphQL)

> Chat-time reference loaded into the agent context. For depth see `00-…` (investigation), `01a-…` (entities), `01b-…` (queries), `01c-…` (mutations), `01d-…` (events + errors).

---

## Base call shape

```http
POST https://api.getjobber.com/api/graphql
Authorization: Bearer {access_token}
Content-Type: application/json
X-JOBBER-GRAPHQL-VERSION: 2025-04-16

{"query": "...", "variables": {...}}
```

- **GraphQL only.** There is no REST API. Every operation is `POST /api/graphql` with a `query` (read or write) in the JSON body.
- `Authorization: Bearer {token}` — the access token is a JWT.
- `X-JOBBER-GRAPHQL-VERSION`: calendar-versioned. Use `2025-04-16` (verified 2026-05-19). Omitting it works but pins to a server default that may change.

---

## Five rules you must not forget

1. **Every list is a Relay Connection.** Always select `nodes { ... }` AND `pageInfo { endCursor hasNextPage }`. To paginate: `first: 50, after: "<endCursor>"`. Forgetting `pageInfo` means you can't continue past page 1.
2. **IDs are opaque `EncodedId` strings, not integers.** Treat them as opaque tokens — never construct, parse, or compare them as numbers.
3. **Mutations always return a Payload type, not the entity directly.** Pattern: `{ entity { … }, userErrors { message field } }`. Inspect `userErrors` — a 200 OK with non-empty `userErrors` is still a failure.
4. **Cross-entity refs use IDs, not nested objects.** To create a Job for a client, pass `clientId: "<EncodedId>"`. To convert a Quote to a Job, use `jobCreateFromQuote(quoteId: ...)`.
5. **Custom fields live on a `customFields` field on every major entity.** Read with `customFields { ... }`. Write via the entity's edit mutation with a `customFields:` arg.

---

## Defaults at a glance

|                        | Value                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint               | `POST https://api.getjobber.com/api/graphql`                                                                                                        |
| API version (latest)   | `2025-04-16` (required header per Jobber policy)                                                                                                    |
| Auth                   | `Authorization: Bearer {JWT}`                                                                                                                       |
| Access token lifetime  | **60 minutes** (3600 s) [DOCUMENTED]                                                                                                                |
| Refresh token rotation | App-configurable — ON returns new refresh token each refresh; OFF keeps the original                                                                |
| Pagination             | Relay-style: `first`/`after`/`last`/`before` + `nodes` + `pageInfo` + `totalCount`                                                                  |
| Date types             | `ISO8601DateTime` (full timestamp), `ISO8601Date` (date only)                                                                                       |
| ID type                | `EncodedId` — opaque string                                                                                                                         |
| Default node cap       | 100 nodes per connection when no `first`/`last` supplied                                                                                            |
| Rate limit             | **2,500 requests per 5 minutes** + per-query cost ceiling                                                                                           |
| Query cost             | Each field = 1 pt (except `edges`/`nodes`/`node` = 0). Connection cost = `first` × fields-per-node. E.g. `first:10` with 5 fields per node = 50 pts |
| Rate-limit response    | `429` + GraphQL `errors[].extensions.code: "THROTTLED"` — no `Retry-After` header documented; exponential backoff                                   |

---

## Capabilities

**Can:** create/read/update/archive/delete on Client, Quote, Job, Visit, Invoice, Payment, Property, Request. Convert Quote → Job, Job → Invoice, Visits → Invoice. Send quotes/invoices via Jobber's `clientHub`. Read schedules, expenses, timesheets. Subscribe to 46 webhook topics. Read account/user info. Manage automation rules. Run jobber-payments operations.

**Cannot (or hard):** direct REST CRUD (no REST API exists). Bulk import without using `clientsImport` / `clientsCreate`. Real-time chat-style subscriptions (no GraphQL `Subscription` root — use webhooks for events). Cross-account queries (every token is single-account-scoped).

---

## Hot-path query examples

```graphql
# Active clients
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

# Open invoices for a customer
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

# Jobs scheduled for today
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

# Pull schema for a single entity (helps the agent discover fields on the fly)
query {
  __type(name: "Invoice") {
    fields {
      name
      description
    }
  }
}
```

More in `01b-query-patterns.md`.

---

## Hot-path mutation skeleton

```graphql
# Create a client
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

`userErrors` is the critical field — a 200 OK with non-empty `userErrors` means the operation FAILED. Always check it.

Full mutation library + create/convert/edit patterns in `01c-mutation-patterns.md`.

---

## Error → action

GraphQL has **two** error shapes — make sure to handle both:

| Shape                               | Where                                                   | Example                                                                                                                         | Action                                                 |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Top-level `{"message": "..."}`      | Pre-GraphQL errors (auth, bad version, malformed query) | `{"message":"Token not recognized"}`                                                                                            | Refresh token / fix headers / fix query                |
| GraphQL `errors` array              | Per-field errors from a valid query                     | `{"errors":[{"message":"... was hidden because you are unauthenticated","extensions":{"code":"UNAUTHENTICATED"}}],"data":null}` | Check `extensions.code` and the failing path           |
| `userErrors` inside mutation `data` | Business-rule rejections (200 OK!)                      | `{"data":{"clientCreate":{"client":null,"userErrors":[{"message":"Email is invalid","path":["emails","0","address"]}]}}}`       | Surface to user; do NOT retry without fixing the input |

Verified error responses (2026-05-19):

- Bad token → `{"message":"Token not recognized"}` (NOT a GraphQL errors envelope)
- Bad version header → `{"message":"GraphQL API version '<X>' does not exist"}`
- Unauthenticated query for protected field → standard `errors` array with `code: "UNAUTHENTICATED"`
- Invalid query syntax → `{"message":"Invalid query"}`

Full table + retry logic in `01d-event-and-error-handling.md`.

---

## OAuth (Authorization Code)

```
GET https://api.getjobber.com/api/oauth/authorize
  ?client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}
  &response_type=code
  &scope=read_clients read_jobs read_invoices write_clients
  &state={OPAQUE_STRING}
```

Exchange code at `POST https://api.getjobber.com/api/oauth/token` with form-encoded `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code`. Refresh with `grant_type=refresh_token`. Revoke at `/api/oauth/revoke`.

Scopes use the `read_<entity>` / `write_<entity>` pattern (e.g. `read_clients`, `write_jobs`). Full list is on the Jobber dev portal (Cloudflare-walled; check it directly).

---

## Known [UNKNOWN]s (not bluffed)

- **Full scope vocabulary** — Jobber's scope-list sub-page on developer.getjobber.com 404'd at several guessed URLs. Use `read_<entity>` / `write_<entity>` pattern (e.g. `read_clients`, `write_jobs`, `read_invoices`); test unknown scope strings against the authorize URL — invalid scopes are rejected at consent time.
- **Refresh token lifetime** — Jobber's OAuth docs document the 60-min access-token lifetime but don't state refresh-token lifetime. Refresh-rotation is app-configurable (per-app ON/OFF toggle).
- **Webhook payload signature** — schema confirms a `WebHookPayload` type exists; the exact HMAC header name + signing secret format requires hitting a live delivery to verify.
