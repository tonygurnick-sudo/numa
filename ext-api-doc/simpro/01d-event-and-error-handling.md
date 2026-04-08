---
api_name: 'simPRO'
api_slug: 'simpro'
generated_from: '00-api-investigation'
generated_date: '2026-03-30'
source_phases: ['Phase 7: Real-Time & Event-Driven', 'Phase 8: Operational Concerns']
---

# simPRO -- Event & Error Handling Reference

> Companion to `01-llm-api-rules.md`. Contains event-driven capabilities (webhooks,
> polling), error handling patterns, and recovery playbooks.

---

## Event-Driven Capabilities

| Mechanism                | Supported | Notes                                                    |
| ------------------------ | --------- | -------------------------------------------------------- |
| Webhooks                 | Yes       | 22 event types; registration via API and UI [DOCUMENTED] |
| WebSocket                | No        | Not offered [CONFIRMED]                                  |
| Server-Sent Events (SSE) | No        | Not offered [CONFIRMED]                                  |
| Long polling             | No        | Not offered [CONFIRMED]                                  |
| Change feeds / streams   | No        | Use If-Modified-Since for change detection [DOCUMENTED]  |

---

## Webhooks

### Setup

- **Registration method:** API and UI (System > Setup > API > Webhook Subscriptions) [DOCUMENTED]
- **Registration endpoint:** `POST /api/v1.0/webhooks/` [DOCUMENTED]
- **URL requirements:** HTTPS URL that returns HTTP 200 on delivery [DOCUMENTED -- Rollout guide]

**Register a webhook:**

```http
POST /api/v1.0/webhooks/
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "url": "https://your-endpoint.com/webhook",
  "events": ["job.created", "job.updated", "job.stage.complete"]
}
```

[DOCUMENTED -- Rollout guide]

### Event Catalog (22 events)

| Event Name                  | Trigger                      | Notes                 |
| --------------------------- | ---------------------------- | --------------------- |
| contact.created             | New contact created          | [DOCUMENTED -- forum] |
| contact.updated             | Contact modified             | [DOCUMENTED -- forum] |
| company.customer.created    | New company customer created | [DOCUMENTED -- forum] |
| company.customer.updated    | Company customer modified    | [DOCUMENTED -- forum] |
| individual.customer.updated | Individual customer modified | [DOCUMENTED -- forum] |
| job.created                 | New job created              | [DOCUMENTED -- forum] |
| job.updated                 | Job modified                 | [DOCUMENTED -- forum] |
| job.status                  | Job status code changed      | [DOCUMENTED -- forum] |
| job.stage.pending           | Job enters Pending stage     | [DOCUMENTED -- forum] |
| job.stage.progress          | Job enters Progress stage    | [DOCUMENTED -- forum] |
| job.stage.complete          | Job enters Complete stage    | [DOCUMENTED -- forum] |
| job.stage.invoiced          | Job enters Invoiced stage    | [DOCUMENTED -- forum] |
| job.stage.archived          | Job enters Archived stage    | [DOCUMENTED -- forum] |
| lead.created                | New lead created             | [DOCUMENTED -- forum] |
| lead.updated                | Lead modified                | [DOCUMENTED -- forum] |
| lead.status                 | Lead status changed          | [DOCUMENTED -- forum] |
| quote.created               | New quote created            | [DOCUMENTED -- forum] |
| quote.updated               | Quote modified               | [DOCUMENTED -- forum] |
| quote.status                | Quote status changed         | [DOCUMENTED -- forum] |
| job.schedule.created        | Job schedule created         | [DOCUMENTED -- forum] |
| job.schedule.updated        | Job schedule modified        | [DOCUMENTED -- forum] |
| quote.schedule.created      | Quote schedule created       | [DOCUMENTED -- forum] |
| quote.schedule.updated      | Quote schedule modified      | [DOCUMENTED -- forum] |

### Payload Format [CONFIRMED -- forum posts with actual received payloads]

**Job status webhook payload:**

```json
{
  "ID": "job.status",
  "build": "{build_name}",
  "description": "Status of Job #300555 set to \"Job : In Progress\"",
  "name": "Job",
  "action": "status",
  "reference": {
    "companyID": 0,
    "jobID": 300555,
    "statusID": 10
  },
  "date_triggered": "2023-01-31T09:05:27+00:00"
}
```

**Job schedule created webhook payload:**

```json
{
  "ID": "job.schedule.created",
  "build": "{build_name}",
  "name": "Job schedule",
  "action": "created",
  "reference": {
    "companyID": 0,
    "scheduleID": 123,
    "jobID": 456,
    "sectionID": 1,
    "costCenterID": 1
  },
  "date_triggered": "2023-01-31T09:05:27+00:00",
  "description": "Schedule created for Job #456"
}
```

**Job attachment webhook payload:**

```json
{
  "ID": "job.attachment.created",
  "build": "{build_name}",
  "name": "Job attachment",
  "action": "created",
  "reference": {
    "companyID": 0,
    "ID": 789,
    "folderID": 1,
    "attachmentID": "abc-123",
    "attachmentName": "photo.jpg"
  },
  "date_triggered": "2023-01-31T09:05:27+00:00",
  "description": "..."
}
```

**Standard payload fields:**

| Field          | Type   | Always Present | Description                                                    |
| -------------- | ------ | -------------- | -------------------------------------------------------------- |
| ID             | string | Yes            | Event type identifier (e.g., "job.status") [CONFIRMED]         |
| build          | string | Yes            | Build name that triggered the event [CONFIRMED]                |
| name           | string | Yes            | Human-readable entity name (e.g., "Job") [CONFIRMED]           |
| action         | string | Yes            | Action type (e.g., "status", "created", "updated") [CONFIRMED] |
| reference      | object | Yes            | Entity-specific IDs (varies by event type) [CONFIRMED]         |
| date_triggered | string | Yes            | ISO 8601 timestamp with timezone offset [CONFIRMED]            |
| description    | string | Yes            | Human-readable description of the event [CONFIRMED]            |

**Reference object fields by event type:**

| Event type        | Reference fields                                      |
| ----------------- | ----------------------------------------------------- |
| job.\*            | companyID, jobID, (statusID for job.status)           |
| job.schedule.\*   | companyID, scheduleID, jobID, sectionID, costCenterID |
| job.attachment.\* | companyID, ID, folderID, attachmentID, attachmentName |
| quote.\*          | companyID, quoteID (expected, similar pattern)        |
| lead.\*           | companyID, leadID (expected, similar pattern)         |
| contact.\*        | companyID, contactID (expected, similar pattern)      |
| _.customer._      | companyID, customerID (expected, similar pattern)     |

### Verification / Security

- **Signature header:** None [CONFIRMED -- forum discussion found no signature mechanism]
- **Signature algorithm:** N/A
- **IP allowlist available:** [UNKNOWN]

> **Risk:** Without signature verification, webhook receivers cannot cryptographically verify payloads came from simPRO. Recommend validating webhook source by cross-referencing received data against the API (e.g., GET the referenced job to confirm the status matches).

### Reliability

- **Retry policy:** [UNKNOWN -- not documented]
- **Max retries:** [UNKNOWN]
- **Dead letter / failure notification:** [UNKNOWN]
- **Event ordering guarantee:** [UNKNOWN]
- **Duplicate delivery possible:** Assume yes [CONFIRMED -- safe default]
- **Status update webhooks may fire for silent rejections:** Quote status updates where PATCH silently fails still trigger webhook events [CONFIRMED -- forum]
- **Deduplication strategy:** Use `date_triggered` + event `ID` + `reference` IDs as dedup key

---

## Polling Fallback

> Use this when webhooks are insufficient or as a backup strategy.

### Recommended Approach

- **Endpoint:** `GET /api/v1.0/companies/{companyID}/{resource}/?pageSize=250` with `If-Modified-Since` header
- **Change detection field:** `If-Modified-Since` header (datetime format: YYYY-MM-ddTHH:mm:ss) [DOCUMENTED]
- **Recommended interval:** 60 seconds minimum [CONFIRMED -- must respect 10 req/sec limit]
- **Rate limit budget:** 10 req/sec shared with all other API activity [DOCUMENTED]

### Polling Pattern

```
1. Store last_poll_timestamp = current time
2. Wait 60 seconds (or longer)
3. GET /api/v1.0/companies/0/{resource}/?pageSize=250
   If-Modified-Since: {last_poll_timestamp}
4. Process returned records (paginate through all pages)
5. Update last_poll_timestamp = current time
6. Goto 2
```

### Efficient Polling Tips

- **Use If-Modified-Since:** Only fetch records changed since last poll [DOCUMENTED]
- **Set pageSize=250:** Minimize the number of requests per poll cycle [DOCUMENTED]
- **Select minimal columns:** Use `?columns=ID,DateModified,Status` to reduce response size [DOCUMENTED]
- **Avoid orderby+If-Modified-Since+AssignedTo:** This combination causes 500 errors [DOCUMENTED -- forum]
- **Budget requests:** At 10 req/sec shared limit, stagger resource polling

---

## Error Handling

### Standard Error Response Format [CONFIRMED -- forum post with actual response]

```json
{
  "status": "error",
  "url": "https://xxxxx.simprosuite.com/api/v1.0/...",
  "header": {},
  "data": {
    "errors": [
      {
        "path": null,
        "message": "Invalid route.",
        "value": null
      }
    ]
  }
}
```

**Error response fields:**

| Field                 | Type        | Always Present | Description                                                            |
| --------------------- | ----------- | -------------- | ---------------------------------------------------------------------- |
| status                | string      | Yes            | Always "error" for error responses                                     |
| url                   | string      | Yes            | The request URL that caused the error                                  |
| header                | object      | Yes            | Request headers (echoed back)                                          |
| data.errors           | array       | Yes            | Array of error objects                                                 |
| data.errors[].path    | string/null | Yes            | Field path (null for general errors, field name for validation errors) |
| data.errors[].message | string      | Yes            | Human-readable error message                                           |
| data.errors[].value   | any/null    | Yes            | The problematic value (null for general errors)                        |

### Validation Error Example

```json
{
  "status": "error",
  "url": "https://build.simprosuite.com/api/v1.0/companies/0/jobs/",
  "header": {},
  "data": {
    "errors": [
      {
        "path": "SiteID",
        "message": "Site not found.",
        "value": 999
      },
      {
        "path": "Type",
        "message": "Invalid job type.",
        "value": "InvalidType"
      }
    ]
  }
}
```

> Multiple validation errors can be returned in a single response within the `data.errors` array. [CONFIRMED]

### Recovery Playbook

| HTTP Status | Meaning                    | Retryable? | Recovery Action                                                                               | Max Retries |
| ----------- | -------------------------- | ---------- | --------------------------------------------------------------------------------------------- | ----------- |
| 200         | Success (GET, POST)        | -          | -                                                                                             | -           |
| 204         | No Content (PATCH success) | -          | Verify with GET (may be silent rejection)                                                     | -           |
| 400         | Bad request                | No         | Fix request per `data.errors[].message`                                                       | 0           |
| 401         | Unauthorized               | Yes        | Refresh OAuth token (POST to auth.simpro.co/oauth/token with refresh_token grant), then retry | 1           |
| 403         | Forbidden                  | No         | Check API application permissions (Direct Access vs User Token); verify access type           | 0           |
| 404         | Not found                  | No         | Verify resource ID exists; check companyID is correct (0 for single-company)                  | 0           |
| 405         | Method not allowed         | No         | Verify HTTP method is supported for this endpoint                                             | 0           |
| 409         | Conflict                   | Maybe      | Resource may have been modified concurrently; re-fetch and retry                              | 1           |
| 422         | Validation failed          | No         | Fix fields per `data.errors` array                                                            | 0           |
| 429         | Rate limited               | Yes        | Wait at least 1 second; implement exponential backoff                                         | 3           |
| 500         | Internal error             | Yes        | Retry with exponential backoff; check for known column/filter conflicts                       | 3           |
| 502         | Bad gateway                | Yes        | Retry after 5 seconds                                                                         | 3           |
| 503         | Service unavailable        | Yes        | Check status.simprogroup.com; retry with backoff                                              | 3           |

### Rate Limit Details

| Scope                     | Limit       | Window   | Notes                                                  |
| ------------------------- | ----------- | -------- | ------------------------------------------------------ |
| Per-build (all consumers) | 10 requests | 1 second | Strictly enforced since Aug 2022 [DOCUMENTED -- forum] |
| Per-build (daily)         | [UNKNOWN]   | 24 hours | Exists but number not published [DOCUMENTED]           |

**Rate limit headers:** No standard rate limit headers (X-RateLimit-\*) are returned. [CONFIRMED -- no evidence of rate limit headers in any source]

**Rate limit exceeded response:** HTTP 429 Too Many Requests [DOCUMENTED -- forum]

**Backoff strategy:**

1. Check for `Retry-After` header first (if present, honor it) [UNKNOWN -- not confirmed to exist]
2. Otherwise: exponential backoff starting at 1 second
3. Max delay: 30 seconds
4. Add jitter: random 0-500ms to avoid thundering herd
5. Use 80% threshold: pause proactively at 8 req/sec [DOCUMENTED -- Laravel package config]

**Scope clarification:** The rate limit is per-build (tenant), shared across ALL API consumers on that build. Multi-threaded requests from one integration count toward the same limit as requests from other integrations. [CONFIRMED -- forum]

---

## Counter-Exceptions

> Behaviors that differ from standard HTTP/REST conventions.

1. **Pagination in headers, not body.** simPRO puts all pagination metadata in response headers. The body is a bare JSON array, not wrapped in `{ "data": [...], "pagination": {...} }`. [DOCUMENTED]

2. **Per-build rate limits, not per-key.** The 10 req/sec limit applies to the entire build, not individual API keys. Multiple integrations compete for the same budget. [DOCUMENTED -- forum]

3. **PATCH 204 does not guarantee success.** Status updates that violate priority hierarchy return 204 No Content but silently do nothing. Even worse, quote status PATCH that is silently rejected still triggers a webhook event. [CONFIRMED -- forum]

4. **No rate limit response headers.** Unlike most APIs, simPRO does not include X-RateLimit-Remaining or similar headers. You must track request rate client-side. [CONFIRMED]

5. **Error response includes echoed request headers.** The `header` field in error responses contains the headers from your request, not standard error metadata. [CONFIRMED -- forum]

---

## Output Formatting Guide

> How to present simPRO API responses to the user in the workspace agent.

### Recommended Display Formats

| Data Type  | Format            | Example                                                                                  |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Single job | Key-value summary | "Job #123: Service at Main Office for Acme Corp. Status: Progress. Issued: Jan 15, 2026" |
| Job list   | Markdown table    | Table with ID, Type, Customer, Status, DateIssued columns                                |
| Schedule   | Calendar-style    | "Mar 15, 2026: 8:00 AM - 5:00 PM (John Smith at Job #123)"                               |
| Invoice    | Financial summary | "Invoice #456: $1,500.00 for Acme Corp. Status: Paid"                                    |
| Dates      | Human-readable    | "January 15, 2026" (not "2026-01-15")                                                    |
| Currency   | Localized         | "$1,234.56" (use customer's locale if known)                                             |
| Errors     | Clear message     | "Could not find job #123. Verify the ID and try again."                                  |

### Truncation Rules

- Lists: Show first 10 records, note total count from `Result-Total` header
- Long fields: Truncate at 200 characters with "..."
- Nested records: Show 2 levels deep (job > section; not full cost center hierarchy)
- Custom fields: Show only if user specifically requests them

---

_Generated from the investigation questionnaire, Phases 7-8._
