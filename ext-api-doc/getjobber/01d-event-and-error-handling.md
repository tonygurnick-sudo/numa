# Events & Error Handling — Jobber (GraphQL)

---

## 1. Webhooks — Jobber's primary event mechanism

Jobber has a full webhook system. **Use it instead of polling** for any change-detection workflow. Subscribe via the `webhookEndpointCreate` mutation and 46 `WebHookTopicEnum` topics.

### Subscribe to topics

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
```

### Full topic list (verified via introspection 2026-05-19)

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

Notably **no `*_UPDATE_<status>` events** — to detect status-specific changes (e.g. quote went from `awaiting_response` to `approved`), subscribe to the broader `QUOTE_UPDATE` (or the special-cased `QUOTE_APPROVED` / `QUOTE_SENT` / `VISIT_COMPLETE` / `JOB_CLOSED`) and inspect the entity in your handler.

### Payload shape (`WebHookPayload` type)

The exact serialised payload format requires testing against a live webhook delivery. The schema confirms the `WebHookPayload` type exists; specific fields (signature, timestamp, attempt counters, payload body) are not introspectable since webhooks are HTTP POST → your endpoint, not GraphQL responses.

Typical conventions to expect (verify on first delivery):

- POST with `application/json` body
- HMAC signature header (verify with the secret issued at app registration time)
- Body contains topic, occurred-at timestamp, and the entity ID — agents typically need to re-fetch the entity via GraphQL to get the current state (don't trust the embedded snapshot to be fresh)

### Idempotency

Webhooks may retry on non-2xx. Track the (topic, entity-id, occurred-at) tuple to dedupe.

### Delete a subscription

```graphql
mutation {
  webhookEndpointDelete(input: { id: "<EncodedId>" }) {
    deletedId
    userErrors {
      message
      path
    }
  }
}
```

---

## 2. Error response format — three distinct shapes

GraphQL has two error layers, AND Jobber adds a third for pre-GraphQL errors. The agent MUST handle all three.

### Shape A: Pre-GraphQL errors (bad token, bad version, malformed request)

NOT in the standard GraphQL `errors` envelope — a flat top-level `message`:

```json
{ "message": "Token not recognized" }
```

Verified live (2026-05-19):

- Bad bearer token → `{"message":"Token not recognized"}` — HTTP 200 or 401
- Bad/missing version header value → `{"message":"GraphQL API version '<X>' does not exist"}` — HTTP 404
- Unparseable JSON / invalid query syntax → `{"message":"Invalid query"}`

### Shape B: GraphQL field errors (auth scope / per-field rejections)

Standard GraphQL `errors` array with `extensions.code`:

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

Other `extensions.code` values to expect (not exhaustively introspectable — observed from Jobber + standard GraphQL conventions):

- `UNAUTHENTICATED` — missing/expired/invalid token
- `FORBIDDEN` — token valid but lacks the scope for this field
- `NOT_FOUND` — referenced ID doesn't exist or isn't visible to this account
- `BAD_USER_INPUT` — malformed arguments
- `INTERNAL_SERVER_ERROR` — Jobber backend error

### Shape C: Business-rule rejections inside mutation responses (`userErrors`)

A mutation that fails validation **returns HTTP 200 with the entity null and a populated `userErrors`**:

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

This is the most-missed failure mode. Always select `userErrors` on every mutation. Treat non-empty `userErrors` as a hard failure — do not retry without correcting the input.

---

## 3. HTTP status → action

| Status | Body shape                                                        | Cause                                                                   | Action                                                                                              |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 200    | `{data, errors?}` with no `errors`                                | success                                                                 | proceed                                                                                             |
| 200    | `{data, errors}` (Shape B)                                        | per-field auth/scope/lookup failure                                     | inspect `extensions.code`; for UNAUTHENTICATED refresh token, for FORBIDDEN surface a scope problem |
| 200    | `{data: {<mutation>: {entity:null, userErrors:[...]}}}` (Shape C) | business-rule rejection                                                 | fix payload, do NOT retry unchanged                                                                 |
| 400    | varies                                                            | malformed query/JSON                                                    | fix syntax                                                                                          |
| 401    | `{message: "Token not recognized"}` (Shape A)                     | bad bearer token                                                        | refresh OAuth token, retry once                                                                     |
| 404    | `{message: "GraphQL API version 'X' does not exist"}`             | wrong `X-JOBBER-GRAPHQL-VERSION` value                                  | use a known-valid version (`2025-04-16` verified)                                                   |
| 429    | `{errors: [{extensions: {code: "THROTTLED"}, ...}]}`              | rate-limit exceeded (2,500 req/5 min OR query-cost ceiling per request) | exponential backoff (1s, 2s, 4s …). No `Retry-After` or `X-RateLimit-*` headers documented          |
| 5xx    | varies                                                            | Jobber server error                                                     | retry with backoff up to 3×; if persistent check https://status.getjobber.com                       |

---

## 4. Retry pseudocode

```
function callWithRetry(query, vars, maxRetries=3):
    for attempt in 1..maxRetries:
        response = POST /api/graphql with query, vars

        # Shape A — pre-GraphQL failure
        if response.status in (401, 404) and response.body.message:
            if "Token not recognized" in response.body.message:
                refreshAccessToken()
                continue
            elif "version" in response.body.message:
                raise ConfigError("Bad X-JOBBER-GRAPHQL-VERSION value")
            else:
                raise UnknownPreGraphQLError(response.body.message)

        # Shape B — GraphQL field errors
        if response.body.errors:
            codes = [e.get("extensions", {}).get("code") for e in response.body.errors]
            if "UNAUTHENTICATED" in codes:
                refreshAccessToken()
                continue
            elif "FORBIDDEN" in codes:
                raise ScopeError(response.body.errors)
            elif "NOT_FOUND" in codes:
                raise NotFound(response.body.errors)
            else:
                # data may still be partially present — caller decides
                return response.body

        # Shape C — mutation userErrors
        # (caller must inspect; cannot generically detect without knowing the mutation name)

        # 429 rate limit
        if response.status == 429:
            wait(2 ** attempt)
            continue

        # 5xx
        if response.status >= 500:
            wait(2 ** attempt)
            continue

        return response.body

    raise MaxRetriesExceeded()
```

---

## 5. Counter-exceptions — when NOT to retry

| Scenario                         | Reason                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shape C `userErrors` populated   | Data error — retrying with same input will fail again                                                             |
| Shape B `FORBIDDEN`              | Scope/permission issue — the OAuth token doesn't have the required scope; user must reconnect with broader scopes |
| Shape A "version does not exist" | Configuration error — fix the header value                                                                        |
| Shape B `BAD_USER_INPUT`         | Same as Shape C — fix the input                                                                                   |

---

## 6. Polling fallback (if you can't use webhooks)

Avoid this — webhooks exist for a reason. But for cases where outbound HTTP isn't viable:

```graphql
# Poll for clients modified since last sync
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

Same pattern works for `jobs`, `invoices`, `quotes`, `payments`. Filter shapes vary per connection — introspect each connection's filter input type before relying on a specific filter key.

Polling cadence: respect whatever rate-limit Jobber enforces (unknown — start with 1/min per endpoint and back off on 429).

---

## 7. Output formatting reference

| Type              | Format                                         | Example                                  |
| ----------------- | ---------------------------------------------- | ---------------------------------------- |
| `EncodedId`       | base64-like opaque string                      | `"Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM0NQ=="` |
| `ISO8601DateTime` | RFC 3339 UTC                                   | `"2026-05-19T14:30:00Z"`                 |
| `ISO8601Date`     | `YYYY-MM-DD`                                   | `"2026-05-19"`                           |
| Currency          | `Float`, currency on separate `currency` field | `1500.00` + `"NZD"`                      |
| `Boolean`         | JSON bool                                      | `true` / `false`                         |
