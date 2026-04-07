---
api_name: 'Fergus'
api_slug: 'fergus'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-03-30'
updated_date: '2026-04-04'
update_source: 'live API testing'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# Fergus -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Contains event-driven capabilities (webhooks,
> polling), error handling patterns, and recovery playbooks.
> **Updated 2026-04-04 with confirmed error response formats from live API testing.**

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                    |
| ------------------------ | --------- | -------------------------------------------------------- |
| Webhooks                 | Uncertain | Listed on API Tracker but not in OpenAPI spec [INFERRED] |
| WebSocket                | No        | Not available                                            |
| Server-Sent Events (SSE) | No        | Not available                                            |
| Long polling             | No        | Not available                                            |
| Change feeds / streams   | No        | Not available                                            |

---

## Webhooks

> Webhooks are listed as a Fergus API feature on API Tracker, along with a "Webhooks management API."
> However, no webhook endpoints appear in the v1 OpenAPI specification fetched from `api.fergus.com/docs/json`.
> This section documents what is known; details should be confirmed with Fergus support.

### What We Know

- **API Tracker lists:** "Webhooks" and "Webhooks management API" as Fergus API features [INFERRED]
- **OpenAPI spec:** No webhook registration, event catalog, or webhook-related endpoints found [CONFIRMED]
- **Possible explanation:** Webhooks may be available through:
  - A separate API surface not included in the public spec
  - The Fergus web UI (Settings > Integrations)
  - A private/partner API requiring registration

### Recommendation

Until webhook details are confirmed:

1. Use polling as the primary change detection mechanism
2. Contact Fergus at `integrations@fergus.com` to request webhook documentation
3. Check https://info.fergus.com/developers for updates

---

## Polling Fallback

> Primary strategy for detecting changes in Fergus data.

### Recommended Approach

**For jobs:**

```http
GET /jobs?sortField=lastModified&sortOrder=desc&pageSize=20
Host: api.fergus.com
Authorization: Bearer {token}
```

- **Change detection field:** `lastModified` on each job
- Store the most recent `lastModified` timestamp and compare on each poll

**For quotes (best option -- has `modifiedAfter` filter):**

```http
GET /jobs/quotes?modifiedAfter=2025-03-29T14:30:00Z
Host: api.fergus.com
Authorization: Bearer {token}
```

- **Change detection field:** `lastModified`
- The `modifiedAfter` parameter returns only quotes modified since the given timestamp
- Note: This overrides `sortField` and `sortOrder`
- **NOTE:** Use `/jobs/quotes`, NOT `/quotes` (which returns 404) [CONFIRMED -- live API test 2026-04-04]

**For invoices:**

```http
GET /customerInvoices?sortField=createdAt&sortOrder=desc&pageSize=20
Host: api.fergus.com
Authorization: Bearer {token}
```

### Polling Pattern

```
1. Store last_poll_timestamp = current UTC time
2. Wait 60 seconds (minimum to stay within rate limits)
3. GET /jobs/quotes?modifiedAfter={last_poll_timestamp}
4. Process returned records
5. Update last_poll_timestamp = current UTC time
6. Goto 2
```

### Rate Limit Budget for Polling [CONFIRMED -- live API test 2026-04-04]

- Total budget: 100 requests/minute per company
- Reserve at least 50% for user-initiated actions
- Polling budget: ~50 requests/minute maximum
- With 1 poll per resource per minute across 5 resources: 5 req/min (safe)
- With pagination: multiply by expected page count

### Efficient Polling Tips

- Use `modifiedAfter` on `/jobs/quotes` to get only changed quotes (most efficient)
- Sort by `lastModified desc` on `/jobs` to put recent changes first
- Use small `pageSize` for polling (10) to minimize data transfer
- Only poll resources the user is actively interested in
- Store high-water mark timestamps per resource type

---

## Error Handling [CONFIRMED -- live API test 2026-04-04]

### Error Response Formats

**IMPORTANT: Error response format varies by HTTP status code.** Not all errors use the same structure. [CONFIRMED -- live API test 2026-04-04]

#### 400 Bad Request / Validation Error [CONFIRMED -- live API test 2026-04-04]

```json
{
  "error": "Bad Request",
  "message": "Validation Failed: [<body>: must have required property 'defaultContact'].",
  "statusCode": 400
}
```

Also for invalid enum values:

```json
{
  "error": "Bad Request",
  "message": "The jobType must be one of 'Quote', 'Estimate', or 'Charge Up'",
  "statusCode": 400
}
```

#### 403 Forbidden [CONFIRMED -- live API test 2026-04-04]

**NOTE: Different format -- no `error` or `statusCode` fields:**

```json
{ "message": "Forbidden" }
```

#### 404 Not Found [CONFIRMED -- live API test 2026-04-04]

```json
{
  "message": "Route GET:/api/partner/quotes?pageSize=3 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

**NOTE:** 404 errors reveal the internal routing path prefix `/api/partner/`. Client-facing paths do not use this prefix.

#### 415 Unsupported Media Type [CONFIRMED -- live API test 2026-04-04]

```json
{
  "error": "FastifyError",
  "message": "Unsupported Media Type: ...",
  "statusCode": 415
}
```

#### DELETE with Content-Type Header [CONFIRMED -- live API test 2026-04-04]

Sending `Content-Type: application/json` on a DELETE request (without body) causes:

```json
{
  "error": "...",
  "message": "Body cannot be empty when content-type is set to 'application/json'",
  "statusCode": 400
}
```

**Fix:** Omit the Content-Type header on DELETE requests, or send an empty JSON body `{}`.

### Error Field Summary

| Field      | Type   | Always Present?     | Description                      |
| ---------- | ------ | ------------------- | -------------------------------- |
| error      | string | No (missing on 403) | HTTP status text or error type   |
| message    | string | Yes                 | Human-readable error description |
| statusCode | number | No (missing on 403) | HTTP status code                 |

### Recovery Playbook [CONFIRMED -- live API test 2026-04-04]

| HTTP Status | Error Code(s)          | Meaning                               | Retryable? | Recovery Action                                                           | Max Retries |
| ----------- | ---------------------- | ------------------------------------- | ---------- | ------------------------------------------------------------------------- | ----------- |
| 303         | Redirect               | Resource already exists               | No         | Follow `location` header to existing resource                             | 0           |
| 400         | Bad Request            | Invalid request or validation failure | No         | Fix request per error message                                             | 0           |
| 401         | Unauthorized           | Invalid or expired auth token         | Yes        | Refresh OAuth token or check PAT validity                                 | 1           |
| 403         | Forbidden              | Insufficient permissions              | No         | Check user/token permissions. Response is just `{"message": "Forbidden"}` | 0           |
| 404         | Not Found              | Resource or endpoint does not exist   | No         | Verify resource ID. Check if endpoint is available (some are 404).        | 0           |
| 409         | Conflict               | Resource state conflict               | Maybe      | Re-read the resource, resolve conflict, retry                             | 1           |
| 415         | Unsupported Media Type | Wrong Content-Type header             | No         | Fix Content-Type. On DELETE: omit Content-Type header entirely.           | 0           |
| 422         | Validation Failed      | Field validation error                | No         | Fix fields per error message details                                      | 0           |
| 429         | Too Many Requests      | Rate limit exceeded                   | Yes        | Wait for `retry-after` header value in seconds                            | 3           |
| 500         | Internal Server Error  | Server error                          | Yes        | Retry with exponential backoff                                            | 3           |
| 502         | Bad Gateway            | Upstream error                        | Yes        | Retry after 5 seconds                                                     | 3           |
| 503         | Service Unavailable    | Service down                          | Yes        | Retry after `retry-after` header if present                               | 3           |

### Special: 303 See Other (Customer/Site Dedup)

When creating a customer or site that already exists, Fergus returns:

```json
{
  "result": "redirect",
  "message": "Customer already exists",
  "location": "/customers/9778208"
}
```

**Recovery:** Follow the `location` URL to GET the existing resource. Do NOT retry the POST.

### Rate Limit Details [CONFIRMED -- live API test 2026-04-04]

| Scope       | Limit        | Window   | Headers                                                           |
| ----------- | ------------ | -------- | ----------------------------------------------------------------- |
| Per company | 100 requests | 1 minute | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` |

**Rate limit headers (present on every response):** [CONFIRMED -- live API test 2026-04-04]

| Header                  | Meaning                                    | Example |
| ----------------------- | ------------------------------------------ | ------- |
| `x-ratelimit-limit`     | Max requests per window                    | `100`   |
| `x-ratelimit-remaining` | Remaining requests in current window       | `87`    |
| `x-ratelimit-reset`     | Seconds until window resets                | `60`    |
| `retry-after`           | Seconds to wait before retrying (429 only) | `15`    |

**Rate limit exceeded response:**

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please retry after the specified time.",
  "statusCode": 429
}
```

Headers on 429 response:

```
HTTP/1.1 429 Too Many Requests
x-ratelimit-limit: 100
x-ratelimit-remaining: 0
x-ratelimit-reset: 42
retry-after: 42
```

**Backoff strategy:**

1. Check `retry-after` header first -- if present, wait exactly that many seconds
2. If no `retry-after`: exponential backoff starting at 2 seconds
3. Max delay: 60 seconds (one full rate limit window)
4. Add jitter: random 0-1 second added to each wait
5. Max retries: 3 for rate limits, then surface error to user

### Proactive Rate Limit Management [CONFIRMED -- live API test 2026-04-04]

Monitor `x-ratelimit-remaining` on every response. When remaining drops below 20:

- Reduce polling frequency
- Batch logical operations (read before write to avoid unnecessary calls)
- Delay non-critical requests

When remaining drops below 5:

- Pause all non-essential requests
- Only allow user-initiated critical operations
- Wait for `x-ratelimit-reset` seconds before resuming

---

## Counter-Exceptions [CONFIRMED -- live API test 2026-04-04]

1. **303 on create is not an error:** POST /customers and POST /sites return 303 when a duplicate exists. This is a normal flow, not an error. Follow the location header.
   - Standard behavior: POST returns 201 (created) or 409 (conflict)
   - Actual behavior: Returns 303 with redirect URL to existing resource

2. **Calendar event update uses POST, returns 200:** Updates to calendar events use POST method (not PUT/PATCH), which is non-standard.
   - Standard behavior: Updates use PUT or PATCH
   - Actual behavior: POST /calendarEvents/{id} with updated body

3. **DELETE /calendarEvents requires a request body:** Even though DELETE typically has no body, this endpoint requires `{"deleteAllRecurring": false}` or `{"deleteAllRecurring": true}`.
   - Standard behavior: DELETE has no body
   - Actual behavior: Body required to specify recurring event behavior

4. **DELETE must NOT include Content-Type header:** Sending `Content-Type: application/json` without a body causes a 400 error. [CONFIRMED -- live API test 2026-04-04]
   - Standard behavior: Content-Type on DELETE is ignored
   - Actual behavior: Error `"Body cannot be empty when content-type is set to 'application/json'"`

5. **403 response has minimal format:** Just `{"message": "Forbidden"}` -- no `error` or `statusCode` fields. [CONFIRMED -- live API test 2026-04-04]

6. **404 reveals internal path prefix:** Error messages show `/api/partner/` prefix in the route. Client-facing paths do not use this prefix. [CONFIRMED -- live API test 2026-04-04]

7. **Job status is transient after creation:** POST returns `"Draft"`, GET returns `"To Price"`. [CONFIRMED -- live API test 2026-04-04]

8. **POST /jobs/{id}/finalise returns 404:** Despite the HATEOAS link being present in job responses. [NEEDS VERIFICATION]

---

## Output Formatting Guide

> How to present Fergus API responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type      | Format                   | Example                                                               |
| -------------- | ------------------------ | --------------------------------------------------------------------- |
| Job            | Summary line             | "J-0042: Kitchen renovation (Quote, To Price) - Smith Plumbing Ltd"   |
| Customer       | Name + contact           | "Smith Plumbing Ltd - Jane Smith (jane@smith.co.nz, +64 9 555 1234)"  |
| Site           | Name + address           | "Main Office - 123 Queen St, Auckland"                                |
| Quote          | Title + status + amount  | "Initial Quote v1 - Published, due in 14 days"                        |
| Time Entry     | User + date + hours      | "Mike Johnson: 8.0hrs on 2025-03-28 - Pipe installation (J-0042)"     |
| Invoice        | Number + amount + status | "INV-001: $2,875.00 (incl. GST) - Overdue, due 2025-03-15"            |
| Calendar Event | Title + time + user      | "Site visit: Apr 1, 9:00-11:00 AM - Mike Johnson"                     |
| Note           | Text + author + date     | "[Pinned] Customer confirmed schedule - by Mike (Mar 28)"             |
| Currency       | Dollar format            | "$2,500.00" (format per company's country)                            |
| Date           | Human-readable           | "March 28, 2025"                                                      |
| DateTime       | Relative or absolute     | "2 hours ago" or "Mar 28, 2025 at 3:30 PM"                            |
| Errors         | Clear message            | "Could not create job: jobType must be Quote, Estimate, or Charge Up" |

### Truncation Rules

- Lists: Show first 10 records, note total count ("Showing 10 of 47 jobs")
- Long descriptions: Truncate at 200 characters with "..."
- Nested records: Show 2 levels deep (e.g., Job > Quote sections, but not line items)
- When paginating: Offer to fetch more if total exceeds displayed count

### Job Status Indicators

| Status         | Display                            |
| -------------- | ---------------------------------- |
| Draft          | [Draft] (transient -- rarely seen) |
| To Price       | [To Price]                         |
| Active         | [Active]                           |
| On Hold        | [On Hold]                          |
| Completed      | [Completed]                        |
| Archived       | [Archived]                         |
| Quote Sent     | [Quote Sent]                       |
| Quote Rejected | [Quote Rejected]                   |

---

_Generated from the investigation questionnaire, Phases 7-8. Updated 2026-04-04 with live API test corrections._
