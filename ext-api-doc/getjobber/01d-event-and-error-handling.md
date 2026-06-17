---
doc: events-and-error-handling
api: Jobber (GraphQL)
endpoint: POST https://api.getjobber.com/api/graphql
confidence: all verified live 2026-05-19 unless tagged otherwise
---

# Events & Error Handling — Jobber (GraphQL)

## 1. Webhooks — Jobber's primary event mechanism

Full webhook system. Use instead of polling for change-detection. Subscribe via `webhookEndpointCreate` + 46 `WebHookTopicEnum` topics.

```graphql
mutation Subscribe {
  webhookEndpointCreate(
    input: { url: "https://your-app.example/jobber/webhooks", topics: [CLIENT_CREATE, INVOICE_UPDATE, JOB_CLOSED] }
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
mutation Delete {
  webhookEndpointDelete(input: { id: "<EncodedId>" }) {
    deletedId
    userErrors {
      message
      path
    }
  }
}
```

### Full topic list (introspection 2026-05-19)

| Group           | Topics                                                                                 |
| --------------- | -------------------------------------------------------------------------------------- |
| App lifecycle   | `APP_CONNECT`, `APP_DISCONNECT`                                                        |
| Client (CRM)    | `CLIENT_CREATE`, `CLIENT_UPDATE`, `CLIENT_DESTROY`                                     |
| Property        | `PROPERTY_CREATE`, `PROPERTY_UPDATE`, `PROPERTY_DESTROY`                               |
| Request (lead)  | `REQUEST_CREATE`, `REQUEST_UPDATE`, `REQUEST_DESTROY`                                  |
| Quote           | `QUOTE_CREATE`, `QUOTE_UPDATE`, `QUOTE_DESTROY`, `QUOTE_SENT`, `QUOTE_APPROVED`        |
| Job             | `JOB_CREATE`, `JOB_UPDATE`, `JOB_DESTROY`, `JOB_CLOSED`                                |
| Visit           | `VISIT_CREATE`, `VISIT_UPDATE`, `VISIT_DESTROY`, `VISIT_COMPLETE`                      |
| Invoice         | `INVOICE_CREATE`, `INVOICE_UPDATE`, `INVOICE_DESTROY`                                  |
| Payment         | `PAYMENT_CREATE`, `PAYMENT_UPDATE`, `PAYMENT_DESTROY`                                  |
| Payout          | `PAYOUT_CREATE`, `PAYOUT_UPDATE`, `PAYOUT_DESTROY`                                     |
| Timesheet       | `TIMESHEET_CREATE`, `TIMESHEET_UPDATE`, `TIMESHEET_DESTROY`                            |
| Expense         | `EXPENSE_CREATE`, `EXPENSE_UPDATE`, `EXPENSE_DESTROY`                                  |
| Product/Service | `PRODUCT_OR_SERVICE_CREATE`, `PRODUCT_OR_SERVICE_UPDATE`, `PRODUCT_OR_SERVICE_DESTROY` |
| User            | `USER_CREATE`, `USER_UPDATE`                                                           |
| Tracking        | `ON_MY_WAY_TRACKING_LINK_REQUEST`                                                      |
| Marketing       | `MARKETING_ITEM_UPDATE`                                                                |

No `*_UPDATE_<status>` events — to detect status-specific changes (e.g. quote `awaiting_response`→`approved`), subscribe to broader `QUOTE_UPDATE` (or the special-cased `QUOTE_APPROVED`/`QUOTE_SENT`/`VISIT_COMPLETE`/`JOB_CLOSED`) and inspect the entity in your handler.

### Payload (`WebHookPayload` type — not introspectable; HTTP POST to your endpoint, verify on first delivery)

- POST with `application/json` body.
- HMAC signature header (verify with the secret issued at app registration).
- Body carries topic, occurred-at timestamp, entity ID — re-fetch the entity via GraphQL for current state (don't trust the embedded snapshot to be fresh).
- Idempotency: webhooks retry on non-2xx. Dedupe on the (topic, entity-id, occurred-at) tuple.

## 2. Error response format — THREE shapes (handle all)

GraphQL has two error layers; Jobber adds a third for pre-GraphQL errors.

### Shape A — Pre-GraphQL (bad token, bad version, malformed request)

NOT in the standard `errors` envelope — flat top-level `message`:

```json
{ "message": "Token not recognized" }
```

Verified strings (match verbatim):

- Bad bearer token → `{"message":"Token not recognized"}` — HTTP 200 or 401.
- Bad/missing version header value → `{"message":"GraphQL API version '<X>' does not exist"}` — HTTP 404.
- Unparseable JSON / invalid query syntax → `{"message":"Invalid query"}`.

### Shape B — GraphQL field errors (auth scope / per-field rejections)

Standard `errors` array with `extensions.code`:

```json
{
  "data": null,
  "errors": [
    {
      "message": "The field clients on an object of type Query was hidden because you are unauthenticated",
      "locations": [{ "line": 1, "column": 3 }],
      "path": ["clients"],
      "extensions": { "code": "UNAUTHENTICATED" }
    }
  ]
}
```

`extensions.code` values (observed + standard GraphQL): `UNAUTHENTICATED` (missing/expired/invalid token), `FORBIDDEN` (valid token, lacks scope for this field), `NOT_FOUND` (ID doesn't exist / not visible to this account), `BAD_USER_INPUT` (malformed args), `INTERNAL_SERVER_ERROR` (Jobber backend).

### Shape C — Business-rule rejection inside mutation `data` (`userErrors`)

HTTP 200 with entity null and populated `userErrors` — the most-missed failure mode. Always select `userErrors`; treat non-empty as a hard failure, do not retry without fixing the input.

```json
{
  "data": {
    "clientCreate": {
      "client": null,
      "userErrors": [{ "message": "Email is invalid", "path": ["emails", "0", "address"] }]
    }
  }
}
```

## 3. HTTP status → action

| Status | Body shape                                                | Cause                                              | Action                                                                                |
| ------ | --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 200    | `{data, errors?}` no `errors`                             | success                                            | proceed                                                                               |
| 200    | `{data, errors}` (B)                                      | per-field auth/scope/lookup failure                | inspect `extensions.code`; UNAUTHENTICATED → refresh token; FORBIDDEN → scope problem |
| 200    | `{data:{<mutation>:{entity:null, userErrors:[...]}}}` (C) | business-rule rejection                            | fix payload, do NOT retry unchanged                                                   |
| 400    | varies                                                    | malformed query/JSON                               | fix syntax                                                                            |
| 401    | `{message:"Token not recognized"}` (A)                    | bad bearer token                                   | refresh OAuth token, retry once                                                       |
| 404    | `{message:"GraphQL API version 'X' does not exist"}`      | wrong `X-JOBBER-GRAPHQL-VERSION`                   | use a known-valid version (`2025-04-16`)                                              |
| 429    | `{errors:[{extensions:{code:"THROTTLED"}}]}`              | rate limit (2,500 req/5 min OR query-cost ceiling) | exponential backoff (1s,2s,4s…). No `Retry-After`/`X-RateLimit-*` headers documented  |
| 5xx    | varies                                                    | Jobber server error                                | retry w/ backoff up to 3×; if persistent check https://status.getjobber.com           |

## 4. Retry pseudocode

```
function callWithRetry(query, vars, maxRetries=3):
    for attempt in 1..maxRetries:
        response = POST /api/graphql with query, vars
        # Shape A — pre-GraphQL
        if response.status in (401, 404) and response.body.message:
            if "Token not recognized" in response.body.message: refreshAccessToken(); continue
            elif "version" in response.body.message: raise ConfigError("Bad X-JOBBER-GRAPHQL-VERSION value")
            else: raise UnknownPreGraphQLError(response.body.message)
        # Shape B — GraphQL field errors
        if response.body.errors:
            codes = [e.get("extensions", {}).get("code") for e in response.body.errors]
            if "UNAUTHENTICATED" in codes: refreshAccessToken(); continue
            elif "FORBIDDEN" in codes: raise ScopeError(response.body.errors)
            elif "NOT_FOUND" in codes: raise NotFound(response.body.errors)
            else: return response.body   # data may be partially present — caller decides
        # Shape C — mutation userErrors: caller must inspect (can't detect without knowing mutation name)
        if response.status == 429: wait(2 ** attempt); continue
        if response.status >= 500: wait(2 ** attempt); continue
        return response.body
    raise MaxRetriesExceeded()
```

## 5. When NOT to retry

| Scenario                         | Reason                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Shape C `userErrors` populated   | Data error — same input fails again                                               |
| Shape B `FORBIDDEN`              | Scope/permission — token lacks the scope; user must reconnect with broader scopes |
| Shape A "version does not exist" | Config error — fix the header value                                               |
| Shape B `BAD_USER_INPUT`         | Same as Shape C — fix the input                                                   |

## 6. Polling fallback (avoid — webhooks exist; use only when outbound HTTP isn't viable)

```graphql
query {
  clients(first: 50, filter: { updatedAfter: "<last_sync_iso>" }, sort: { key: updated_at, direction: ascending }) {
    nodes {
      id
      firstName
      lastName
      updatedAt
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
```

Same pattern for `jobs`, `invoices`, `quotes`, `payments` (filter shapes vary — introspect each connection's filter input). Cadence: start 1/min per endpoint, back off on 429.

## 7. Output formatting reference

| Type              | Format                              | Example                                  |
| ----------------- | ----------------------------------- | ---------------------------------------- |
| `EncodedId`       | base64-like opaque string           | `"Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM0NQ=="` |
| `ISO8601DateTime` | RFC3339 UTC                         | `"2026-05-19T14:30:00Z"`                 |
| `ISO8601Date`     | `YYYY-MM-DD`                        | `"2026-05-19"`                           |
| Currency          | `Float` + separate `currency` field | `1500.00` + `"NZD"`                      |
| `Boolean`         | JSON bool                           | `true` / `false`                         |
