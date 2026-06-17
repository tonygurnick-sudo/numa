---
api_name: NetSuite AI Connector Service (MCP)
api_slug: netsuite
doc: on-demand events + error-handling reference (companion to 01-llm-api-rules.md)
call_surface: MCP via mcp_call (error envelopes are REST-style)
confidence: [DOCUMENTED] unless tagged [UNKNOWN]
---

# NetSuite MCP — Event & Error Handling Reference

Event-driven capabilities, error handling, rate limits, recovery playbooks. Companion to `01-llm-api-rules.md`.

## Event-driven capabilities

Webhooks (native) **No** — requires custom SuiteScript User Event Scripts. WebSocket **No**. SSE **No**. Long polling **No**. Change feeds/streams **No**. NetSuite has NO native push-based event system accessible from external clients; all event-driven behavior needs custom SuiteScript inside NetSuite (out of scope for MCP).

**Custom event solutions [DOCUMENTED, out of scope for MCP — cannot be set up via MCP API]:**

- **User Event Scripts** — `beforeLoad` / `beforeSubmit` / `afterSubmit`; can call external webhooks via `https.post()`. Requires SuiteScript dev, admin deploy, subject to governance units.
- **Workflow Action Scripts** — trigger regardless of modification source (UI/API/CSV); configurable via UI without code.
- **Scheduled Scripts** — run on a schedule (15 min, hourly, daily); good for polling-sync; governance-limited.

## Polling fallback

No push events → polling is the only change-detection option.

- Tool: `ns_runCustomSuiteQL`. Change-detection field: `lastmodifieddate` (on most record types). Min interval 60s (stay within concurrency). Each poll consumes one concurrency slot from the shared account pool.
- Tips: filter by `lastmodifieddate` to fetch only changed records; SELECT minimal fields; track the last-poll timestamp; combine multiple record types with `UNION`.
- Template: `{"name":"ns_runCustomSuiteQL","arguments":{"sqlQuery":"SELECT id, companyname, lastmodifieddate FROM customer WHERE lastmodifieddate >= TO_DATE('2026-03-30 14:00:00','YYYY-MM-DD HH24:MI:SS') ORDER BY lastmodifieddate DESC","description":"Find customers modified since last poll timestamp","pageSize":100}}`

## Error format

REST-style envelope (also wraps MCP tool errors):

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

Fields: `type` (W3C RFC ref, always), `title` (HTTP title, always), `status` (always), `o:errorDetails[]` (always) with `.detail` (human text, always), `.o:errorCode` (machine code, always), `.o:errorPath` (JSON path to offending field, sometimes). `o:errorPath` pinpoints the location — e.g. `item.items[0].item` = first line item's item ref invalid; `subsidiary` = subsidiary missing/invalid.

Auth-error example: `{"status":401,"o:errorDetails":[{"detail":"Invalid login attempt. For more details, see the Login Audit Trail.","o:errorCode":"INVALID_LOGIN"}]}`.

**MCP error format [UNKNOWN]** — likely JSON-RPC 2.0: `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Error description"}}`. The exact REST↔MCP error mapping is undocumented.

## Recovery playbook

| Status | Code                       | Meaning                  | Retryable | Action                                                                                        | Max retries |
| ------ | -------------------------- | ------------------------ | --------- | --------------------------------------------------------------------------------------------- | ----------- |
| 400    | INVALID_CONTENT            | Bad field value          | No        | Read `o:errorPath`, fix the field                                                             | 0           |
| 400    | INVALID_REQUEST            | Malformed syntax         | No        | Fix request (check stringified JSON)                                                          | 0           |
| 401    | INVALID_LOGIN              | Token expired/invalid    | Yes       | Refresh OAuth token, retry                                                                    | 1           |
| 403    | (none)                     | Insufficient permissions | No        | Role needs MCP Server Connection + OAuth 2.0 Access Tokens. Administrator role does NOT work. | 0           |
| 404    | NONEXISTENT_ID             | Record not found         | No        | Verify recordType + internal id                                                               | 0           |
| 429    | CONCURRENCY_LIMIT_EXCEEDED | Too many concurrent      | Yes       | Exponential backoff 1s,2s,4s,8s,16s                                                           | 5           |
| 429    | USER_ERROR                 | Frequency limit exceeded | Yes       | Wait 60s, retry                                                                               | 3           |
| 500    | UNEXPECTED_ERROR           | Internal server error    | Yes       | Backoff; note Error ID for support                                                            | 3           |
| 502    | (gateway)                  | Proxy/gateway issue      | Yes       | Retry after 5s                                                                                | 3           |
| 503    | (unavailable)              | Maintenance/overload     | Yes       | Check status.netsuite.com; retry after 30s                                                    | 3           |

## Error code reference

| Code                       | Status | Common cause                          | Fix                                                       |
| -------------------------- | ------ | ------------------------------------- | --------------------------------------------------------- |
| INVALID_CONTENT            | 400    | Wrong data type, invalid reference id | Check metadata for field type; verify reference ids exist |
| INVALID_REQUEST            | 400    | Bad JSON, missing required field      | Validate JSON; check required fields                      |
| INVALID_LOGIN              | 401    | Expired token, wrong credentials      | Refresh OAuth token                                       |
| NONEXISTENT_ID             | 404    | Wrong id or record type               | Verify recordType string + internal id                    |
| CONCURRENCY_LIMIT_EXCEEDED | 429    | Account concurrency limit hit         | Exponential backoff                                       |
| USER_ERROR                 | 429    | Frequency limit exceeded              | Wait and retry                                            |
| UNEXPECTED_ERROR           | 500    | NetSuite internal                     | Retry; if persistent note Error ID, contact support       |

## Rate limits

**Concurrency-based** (not requests/minute) — limit on **simultaneous** requests, shared across ALL integrations (REST, SOAP, MCP).
| Tier | Concurrent limit |
| --- | --- |
| Default | 15 |
| + SuiteCloud Plus | +10 per license |
| Tier 2 / 3 / 4 / 5 | 25 / 35 / 45 / 55 (max) |

Admins can allocate a per-integration cap to the AI Connector Service record (Setup > Integration > Manage Integrations).
**Frequency limits [DOCUMENTED]:** also applied over 60-second and 24-hour windows (exact values not public); account-wide and shared, in addition to concurrency.
**Rate-limit error:** 429 with `{"title":"Bad Request","status":429,"o:errorDetails":[{"detail":"Concurrent request limit exceeded. Request blocked.","o:errorCode":"CONCURRENCY_LIMIT_EXCEEDED"}]}`.
**Rate-limit headers [UNKNOWN]:** no `X-RateLimit-Remaining` / `Retry-After` — manage backoff client-side.
**Backoff:** 429 → 1s, then 2s, 4s, doubling to 30s max; add 0–500ms jitter; after 5 consecutive 429s stop and report to user.

## Request validation headers [DOCUMENTED]

For direct REST calls (applicability to MCP [UNKNOWN]):
| Header | Values | Default | Purpose |
| --- | --- | --- | --- |
| `X-NetSuite-PropertyNameValidation` | ignore / warning / error | warning | Handle unknown field names |
| `X-NetSuite-PropertyValueValidation` | ignore / warning / error | error | Handle invalid field values |

## Counter-exceptions (differ from standard HTTP/REST)

1. **429 returns `"title":"Bad Request"`, not "Too Many Requests"** — don't rely on `title`; check `status`.
2. **No `Retry-After` header on 429** — implement client-side backoff without server guidance.
3. **All MCP tools report `destructiveHint: true`** — ignore; only ns_createRecord/ns_updateRecord actually modify data.

## Output formatting (presenting responses to the user)

| Data type             | Format               | Example                                                                    |
| --------------------- | -------------------- | -------------------------------------------------------------------------- |
| Single record         | Key-value summary    | "Company: Acme Corp, Email: info@acme.com, Balance: $12,345.67"            |
| Record list (SuiteQL) | Markdown table       | Key columns, sorted by relevance                                           |
| Report                | Structured summary   | Headers + data rows                                                        |
| Financial amounts     | Localized currency   | "$1,234.56" or "NZ$1,234.56"                                               |
| Dates                 | Human-readable       | "30 March 2026"                                                            |
| Errors                | Clear action message | "Could not find customer with ID 99999. Verify the ID exists in NetSuite." |
| Empty results         | Helpful message      | "No open invoices found for this customer. The query returned 0 results."  |

**Truncation:** SuiteQL → first 20 rows in a table, note total count; saved search → first page (100), offer to paginate; report → full unless >50 rows then summarize; long text → 200 chars + "…"; record lists → always state total count and whether more results exist.
