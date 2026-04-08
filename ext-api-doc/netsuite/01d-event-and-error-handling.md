---
api_name: 'NetSuite AI Connector Service (MCP)'
api_slug: 'netsuite'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# NetSuite MCP -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Contains event-driven capabilities assessment,
> error handling patterns, rate limit details, and recovery playbooks.

---

## Event-Driven Capabilities

| Mechanism                | Supported       | Notes                                                       |
| ------------------------ | --------------- | ----------------------------------------------------------- |
| Webhooks                 | **No** (native) | Requires custom SuiteScript User Event Scripts [DOCUMENTED] |
| WebSocket                | No              | Not supported                                               |
| Server-Sent Events (SSE) | No              | Not supported                                               |
| Long polling             | No              | Not a built-in feature                                      |
| Change feeds / streams   | No              | Not supported                                               |

**Summary:** NetSuite has NO native push-based event system accessible from external clients. All event-driven behavior requires custom SuiteScript development within the NetSuite platform, which is outside the scope of the MCP integration.

---

## Custom Event Solutions (Out of Scope for MCP, Documented for Reference)

### User Event Scripts [DOCUMENTED]

SuiteScript User Event Scripts execute during the record lifecycle:

- `beforeLoad` -- Before a record is displayed
- `beforeSubmit` -- Before a record is saved to the database
- `afterSubmit` -- After a record is saved to the database

These can be used to call external webhooks via `https.post()` or `https.post.promise()`.

**Limitations:**

- Requires SuiteScript development within NetSuite
- Must be deployed by a NetSuite administrator
- Script governance units limit execution frequency
- Cannot be set up via the MCP API

### Workflow Action Scripts [DOCUMENTED]

More flexible than User Event Scripts:

- Trigger regardless of how a record is modified (UI, API, CSV import)
- Run as part of NetSuite Workflows
- Can be configured via NetSuite UI without code

### Scheduled Scripts [DOCUMENTED]

For batch processing and retry logic:

- Run on a schedule (every 15 min, hourly, daily, etc.)
- Good for polling-based sync patterns
- Subject to governance unit limits

---

## Polling Fallback

> Since NetSuite has no push-based events, polling is the only option for change detection.

### Recommended Approach

- **Tool:** `ns_runCustomSuiteQL`
- **Change detection field:** `lastmodifieddate` (available on most record types)
- **Recommended interval:** 60 seconds minimum (to stay within concurrency limits)
- **Concurrency budget:** Each poll uses one concurrency slot from the account's shared pool

### Polling Query Template

```json
{
  "name": "ns_runCustomSuiteQL",
  "arguments": {
    "sqlQuery": "SELECT id, companyname, lastmodifieddate FROM customer WHERE lastmodifieddate >= TO_DATE('2026-03-30 14:00:00', 'YYYY-MM-DD HH24:MI:SS') ORDER BY lastmodifieddate DESC",
    "description": "Find customers modified since last poll timestamp",
    "pageSize": 100
  }
}
```

### Efficient Polling Tips

- Filter by `lastmodifieddate` to only retrieve changed records
- Use `SELECT` with minimal fields to reduce payload size
- Track the last poll timestamp and use it in subsequent queries
- Combine multiple record type polls into a single SuiteQL query using UNION if needed
- Monitor concurrency usage -- each poll consumes a slot from the shared account limit

---

## Error Handling

### Standard Error Response Format (REST) [DOCUMENTED]

```json
{
  "type": "https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html",
  "title": "Bad Request",
  "status": 400,
  "o:errorDetails": [
    {
      "detail": "Error while accessing resource: You have entered an Invalid Field Value 9999 for the following field: item",
      "o:errorCode": "INVALID_CONTENT",
      "o:errorPath": "item.items[0].item"
    }
  ]
}
```

**Error fields:**

| Field                          | Type    | Always Present? | Description                                  |
| ------------------------------ | ------- | --------------- | -------------------------------------------- |
| `type`                         | string  | Yes             | W3C RFC reference                            |
| `title`                        | string  | Yes             | HTTP status title                            |
| `status`                       | integer | Yes             | HTTP status code                             |
| `o:errorDetails`               | array   | Yes             | Array of error detail objects                |
| `o:errorDetails[].detail`      | string  | Yes             | Human-readable error description             |
| `o:errorDetails[].o:errorCode` | string  | Yes             | Machine-readable error code                  |
| `o:errorDetails[].o:errorPath` | string  | Sometimes       | JSON path to the field that caused the error |

### MCP Error Response Format [UNKNOWN]

MCP tool errors are likely returned as JSON-RPC 2.0 error responses:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "Error description"
  }
}
```

The exact mapping between NetSuite REST errors and MCP JSON-RPC errors has not been documented.

### Validation Error Format [DOCUMENTED]

```json
{
  "status": 400,
  "o:errorDetails": [
    {
      "detail": "Error while accessing resource: You have entered an Invalid Field Value 9999 for the following field: item",
      "o:errorCode": "INVALID_CONTENT",
      "o:errorPath": "item.items[0].item"
    }
  ]
}
```

The `o:errorPath` field pinpoints the exact location in the request body. For example:

- `item.items[0].item` -- The first line item's item reference is invalid
- `subsidiary` -- The subsidiary field is missing or invalid

### Authentication Error Format [DOCUMENTED]

```json
{
  "status": 401,
  "o:errorDetails": [
    {
      "detail": "Invalid login attempt. For more details, see the Login Audit Trail.",
      "o:errorCode": "INVALID_LOGIN"
    }
  ]
}
```

---

## Recovery Playbook

| HTTP Status | Error Code(s)              | Meaning                          | Retryable? | Recovery Action                                                                                         | Max Retries |
| ----------- | -------------------------- | -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| 400         | INVALID_CONTENT            | Bad field value                  | No         | Read `o:errorPath`, fix the specific field                                                              | 0           |
| 400         | INVALID_REQUEST            | Malformed request syntax         | No         | Fix request format (check stringified JSON)                                                             | 0           |
| 401         | INVALID_LOGIN              | Token expired or invalid         | Yes        | Refresh OAuth 2.0 access token, then retry                                                              | 1           |
| 403         | (no specific code)         | Insufficient permissions         | No         | Check role has MCP Server Connection + OAuth 2.0 Access Tokens. Note: Administrator role does NOT work. | 0           |
| 404         | NONEXISTENT_ID             | Record does not exist            | No         | Verify record type and internal ID                                                                      | 0           |
| 429         | CONCURRENCY_LIMIT_EXCEEDED | Too many concurrent requests     | Yes        | Exponential backoff: 1s, 2s, 4s, 8s, 16s                                                                | 5           |
| 429         | USER_ERROR                 | Frequency limit exceeded         | Yes        | Wait 60 seconds, then retry                                                                             | 3           |
| 500         | UNEXPECTED_ERROR           | Internal server error            | Yes        | Retry with exponential backoff; note Error ID for support                                               | 3           |
| 502         | (gateway error)            | Proxy/gateway issue              | Yes        | Retry after 5 seconds                                                                                   | 3           |
| 503         | (service unavailable)      | NetSuite maintenance or overload | Yes        | Check status.netsuite.com; retry after 30 seconds                                                       | 3           |

---

## Rate Limit Details

### Concurrency Governance [DOCUMENTED]

NetSuite uses a **concurrency-based** governance model, not a traditional requests-per-minute model. The limit is on **simultaneous** requests, shared across ALL integrations (REST, SOAP, MCP).

| Tier              | Concurrent Request Limit | Notes              |
| ----------------- | ------------------------ | ------------------ |
| Default           | 15                       | Base account limit |
| + SuiteCloud Plus | +10 per license          | Purchased add-on   |
| Tier 2            | 25                       |                    |
| Tier 3            | 35                       |                    |
| Tier 4            | 45                       |                    |
| Tier 5            | 55                       | Maximum            |

**Per-integration allocation:** Administrators can allocate a specific concurrency limit to the AI Connector Service integration record via Setup > Integration > Manage Integrations.

### Frequency Limits [DOCUMENTED]

NetSuite also applies frequency-based limits over:

- **60-second windows** -- exact limits not publicly documented
- **24-hour windows** -- exact limits not publicly documented

These are in addition to concurrency limits. The limits are account-wide and shared.

### Rate Limit Error Response [DOCUMENTED]

```json
{
  "type": "https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html",
  "title": "Bad Request",
  "status": 429,
  "o:errorDetails": [
    {
      "detail": "Concurrent request limit exceeded. Request blocked.",
      "o:errorCode": "CONCURRENCY_LIMIT_EXCEEDED"
    }
  ]
}
```

### Rate Limit Headers [UNKNOWN]

NetSuite does not appear to return standard rate limit headers (`X-RateLimit-Remaining`, `Retry-After`). Rate limit information must be managed client-side.

### Backoff Strategy

1. On 429: Wait 1 second, then retry
2. On second 429: Wait 2 seconds
3. On third 429: Wait 4 seconds
4. Continue doubling up to 30 seconds max
5. Add random jitter (0-500ms) to avoid thundering herd
6. After 5 consecutive 429s: stop and report to user

---

## Request Validation Headers [DOCUMENTED]

NetSuite REST supports headers to control validation behavior:

| Header                               | Values                       | Default   | Purpose                            |
| ------------------------------------ | ---------------------------- | --------- | ---------------------------------- |
| `X-NetSuite-PropertyNameValidation`  | `ignore`, `warning`, `error` | `warning` | How to handle unknown field names  |
| `X-NetSuite-PropertyValueValidation` | `ignore`, `warning`, `error` | `error`   | How to handle invalid field values |

**Applicability to MCP:** These headers are for direct REST API calls. Whether they apply to MCP tool calls is [UNKNOWN].

---

## Error Code Reference

> API-specific error codes beyond standard HTTP status codes.

| Error Code                 | HTTP Status | Meaning                      | Common Cause                          | Fix                                                       |
| -------------------------- | ----------- | ---------------------------- | ------------------------------------- | --------------------------------------------------------- |
| INVALID_CONTENT            | 400         | Invalid field value          | Wrong data type, invalid reference ID | Check metadata for field type, verify reference IDs exist |
| INVALID_REQUEST            | 400         | Malformed request            | Bad JSON, missing required field      | Validate JSON structure, check all required fields        |
| INVALID_LOGIN              | 401         | Authentication failure       | Expired token, wrong credentials      | Refresh OAuth token                                       |
| NONEXISTENT_ID             | 404         | Record not found             | Wrong ID, wrong record type           | Verify record type string and internal ID                 |
| CONCURRENCY_LIMIT_EXCEEDED | 429         | Too many concurrent requests | Account concurrency limit hit         | Exponential backoff                                       |
| USER_ERROR                 | 429         | General rate limit           | Frequency limit exceeded              | Wait and retry                                            |
| UNEXPECTED_ERROR           | 500         | Server error                 | NetSuite internal issue               | Retry; if persistent, note Error ID and contact support   |

---

## Counter-Exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **429 returns "Bad Request" title, not "Too Many Requests":**
   - Standard behavior: 429 response has title "Too Many Requests"
   - Actual behavior: NetSuite returns `"title": "Bad Request"` with status 429
   - Impact: Do not rely on the `title` field; check the `status` code

2. **No Retry-After header on 429:**
   - Standard behavior: 429 responses include a `Retry-After` header
   - Actual behavior: NetSuite does not include this header
   - Impact: Must implement client-side backoff without server guidance

3. **All MCP tools report destructiveHint: true:**
   - Standard behavior: Read-only tools would be marked non-destructive
   - Actual behavior: All 11 tools have `destructiveHint: true` in their annotations
   - Impact: Ignore this flag; only ns_createRecord and ns_updateRecord actually modify data

---

## Output Formatting Guide

> How to present API responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type             | Format               | Example                                                                    |
| --------------------- | -------------------- | -------------------------------------------------------------------------- |
| Single record         | Key-value summary    | "Company: Acme Corp, Email: info@acme.com, Balance: $12,345.67"            |
| Record list (SuiteQL) | Markdown table       | Table with key columns, sorted by relevance                                |
| Report output         | Structured summary   | Headers + data rows, formatted for readability                             |
| Financial amounts     | Localized currency   | "$1,234.56" or "NZ$1,234.56"                                               |
| Dates                 | Human-readable       | "30 March 2026"                                                            |
| Errors                | Clear action message | "Could not find customer with ID 99999. Verify the ID exists in NetSuite." |
| Empty results         | Helpful message      | "No open invoices found for this customer. The query returned 0 results."  |

### Truncation Rules

- SuiteQL results: Show first 20 rows in a table, note total count if available
- Saved search results: Show first page (100 results), offer to paginate
- Report output: Show full report unless it exceeds 50 rows, then summarize
- Long text fields: Truncate at 200 characters with "..."
- Record lists: Always state the total count and whether more results are available

---

_Generated from the investigation questionnaire, Phases 7-8._
