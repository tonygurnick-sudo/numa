---
api_name: ''
api_slug: ''
generated_from: '00-api-investigation-questionnaire'
generated_date: ''
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# {{api_name}} -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Contains event-driven capabilities (webhooks,
> WebSocket, SSE, polling), error handling patterns, and recovery playbooks.

---

## Event-Driven Capabilities

| Mechanism                | Supported  | Notes     |
| ------------------------ | ---------- | --------- |
| Webhooks                 | {{yes/no}} | {{notes}} |
| WebSocket                | {{yes/no}} | {{notes}} |
| Server-Sent Events (SSE) | {{yes/no}} | {{notes}} |
| Long polling             | {{yes/no}} | {{notes}} |
| Change feeds / streams   | {{yes/no}} | {{notes}} |

---

## Webhooks

> Skip this section if the API does not support webhooks.

### Setup

- **Registration method:** {{API / UI / both}}
- **Registration endpoint:** `{{endpoint}}`
- **URL requirements:** {{HTTPS only / verification required / etc}}

**Register a webhook:**

```http
POST /{{webhook_registration_endpoint}}
Authorization: {{auth}}

{
  "url": "https://your-endpoint.com/webhook",
  "events": ["{{event_1}}", "{{event_2}}"],
  "{{additional_config}}": "{{value}}"
}
```

### Event Catalog

| Event Name | Trigger     | Key Payload Fields | Notes     |
| ---------- | ----------- | ------------------ | --------- |
| {{event}}  | {{trigger}} | {{fields}}         | {{notes}} |

### Payload Format

**Standard webhook payload:**

```json
{
  "event": "{{event_name}}",
  "timestamp": "{{iso_timestamp}}",
  "data": {
    "{{field}}": "{{value}}"
  }
}
```

**Headers sent with webhook:**

| Header     | Value     | Purpose     |
| ---------- | --------- | ----------- |
| {{header}} | {{value}} | {{purpose}} |

### Verification / Security

- **Signature header:** `{{header_name}}`
- **Signature algorithm:** {{HMAC-SHA256 / RSA-SHA256 / etc}}
- **Verification process:**

```
1. Extract signature from header: {{header_name}}
2. Compute HMAC of raw request body using your webhook secret
3. Compare computed signature with received signature
4. Reject if mismatch
```

- **IP allowlist available:** {{yes/no}}
- **IP ranges:** {{list if available}}

### Reliability

- **Retry policy:** {{automatic retries on failure / no retries}}
- **Retry schedule:** {{e.g., "3 retries at 5s, 30s, 5min intervals"}}
- **Max retries:** {{count}}
- **Dead letter / failure notification:** {{yes/no, mechanism}}
- **Event ordering guarantee:** {{strict / best-effort / none}}
- **Duplicate delivery possible:** {{yes/no}}
- **Deduplication strategy:** {{use event ID / idempotency on your end}}

---

## WebSocket / SSE

> Skip this section if the API does not support WebSocket or SSE.

### Connection

- **URL:** `{{ws_or_sse_url}}`
- **Protocol:** {{WebSocket / SSE}}
- **Authentication:** {{how to authenticate the connection}}

**Connection example:**

```
{{connection_example}}
```

### Messages / Events

| Event/Message Type | Direction                           | Payload             | Purpose     |
| ------------------ | ----------------------------------- | ------------------- | ----------- |
| {{type}}           | {{client->server / server->client}} | {{payload_summary}} | {{purpose}} |

### Connection Management

- **Heartbeat / keep-alive:** {{interval and mechanism}}
- **Reconnection strategy:** {{exponential backoff / immediate / etc}}
- **Connection timeout:** {{duration}}
- **Max connections per client:** {{count}}

---

## Polling Fallback

> Use this when the API lacks push-based mechanisms, or as a backup strategy.

### Recommended Approach

- **Endpoint:** `GET /{{resource}}?{{modified_since_param}}={{timestamp}}`
- **Change detection field:** `{{updated_at / version / etag}}`
- **Recommended interval:** {{interval}} (e.g., every 60 seconds)
- **Rate limit budget for polling:** {{requests_per_minute_available}}

### Polling Pattern

```
1. Store last_poll_timestamp = now()
2. Wait {{interval}}
3. GET /{{resource}}?{{modified_since_param}}={{last_poll_timestamp}}
4. Process returned records
5. Update last_poll_timestamp = now()
6. Goto 2
```

### Efficient Polling Tips

- {{tip_1}}: e.g., "Use the `If-None-Match` header with ETag to avoid processing unchanged data"
- {{tip_2}}: e.g., "Filter by `updated_at` to only get changes since last poll"
- {{tip_3}}: e.g., "Request minimal fields using field selection to reduce payload size"

---

## Error Handling

### Standard Error Response Format

```json
{{error_response_example}}
```

**Error fields:**

| Field     | Type     | Always Present? | Description     |
| --------- | -------- | --------------- | --------------- |
| {{field}} | {{type}} | {{yes/no}}      | {{description}} |

### Validation Error Format

> How the API reports field-level validation failures.

```json
{{validation_error_example}}
```

### Recovery Playbook

| HTTP Status | Error Code(s) | Meaning             | Retryable? | Recovery Action                                 | Max Retries |
| ----------- | ------------- | ------------------- | ---------- | ----------------------------------------------- | ----------- |
| 400         | {{codes}}     | Bad request         | No         | Fix request per error details                   | 0           |
| 401         | {{codes}}     | Unauthorized        | Yes        | Refresh auth token, then retry                  | 1           |
| 403         | {{codes}}     | Forbidden           | No         | Check permissions / scopes                      | 0           |
| 404         | {{codes}}     | Not found           | No         | Verify resource exists                          | 0           |
| 409         | {{codes}}     | Conflict            | Maybe      | {{conflict_specific_recovery}}                  | 1           |
| 422         | {{codes}}     | Validation failed   | No         | Fix fields per error details                    | 0           |
| 429         | {{codes}}     | Rate limited        | Yes        | Wait for Retry-After header or {{default_wait}} | 3           |
| 500         | {{codes}}     | Internal error      | Yes        | Retry with exponential backoff                  | 3           |
| 502         | {{codes}}     | Bad gateway         | Yes        | Retry after {{wait}}                            | 3           |
| 503         | {{codes}}     | Service unavailable | Yes        | Retry after Retry-After header                  | 3           |

### Rate Limit Details

| Scope     | Limit     | Window     | Headers          |
| --------- | --------- | ---------- | ---------------- |
| {{scope}} | {{limit}} | {{window}} | {{header_names}} |

**Rate limit headers:**

| Header     | Meaning     | Example       |
| ---------- | ----------- | ------------- |
| {{header}} | {{meaning}} | `{{example}}` |

**Rate limit exceeded response:**

```json
{{rate_limit_error_response}}
```

**Backoff strategy:**

1. Check `Retry-After` header first (if present, honor it)
2. Otherwise: exponential backoff starting at {{initial_delay}}
3. Max delay: {{max_delay}}
4. Add jitter: {{jitter_strategy}}

### Error Code Reference

> API-specific error codes beyond HTTP status codes.

| Error Code | HTTP Status | Meaning     | Common Cause | Fix     |
| ---------- | ----------- | ----------- | ------------ | ------- |
| {{code}}   | {{status}}  | {{meaning}} | {{cause}}    | {{fix}} |

---

## Counter-Exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **{{exception_title}}:** {{details}}
   - Standard behavior: {{what_you_would_expect}}
   - Actual behavior: {{what_actually_happens}}

2. **{{exception_title}}:** {{details}}
   - Standard behavior: {{what_you_would_expect}}
   - Actual behavior: {{what_actually_happens}}

---

## Output Formatting Guide

> How to present API responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type        | Format            | Example                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------- |
| Single record    | Key-value summary | "Name: Acme Corp, Status: Active, Created: Jan 15, 2024"              |
| Record list      | Markdown table    | Table with key columns                                                |
| Long text fields | Quoted block      | > Field content here                                                  |
| Dates            | Human-readable    | "January 15, 2024 at 3:30 PM"                                         |
| Currency         | Localized         | "$1,234.56"                                                           |
| Errors           | Clear message     | "Could not find contact with ID abc123. Verify the ID and try again." |

### Truncation Rules

- Lists: Show first {{max_display}} records, note total count
- Long fields: Truncate at {{max_chars}} characters with "..."
- Nested records: Show {{max_depth}} levels deep

---

_Generated from the investigation questionnaire, Phases 7-8._
