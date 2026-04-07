---
api_name: 'simPRO'
api_slug: 'simpro'
version: 'v1.0'
generated_from: '00-api-investigation'
generated_date: '2026-03-30'
line_count_target: '< 300 lines'
---

# simPRO -- Workspace Agent API Rules

> **This file is loaded into the workspace agent's context when the simPRO integration is active.**
> It must stay under 300 lines. Be precise, not verbose.
> Companion files (01a-01d) contain the detailed reference material.

## Context

- **API:** simPRO REST API v1.0
- **Base URL:** `https://{build}.simprosuite.com/api/v1.0/` (per-tenant subdomain)
- **Auth:** OAuth 2.0 Bearer token (access token: 1hr lifetime; refresh token: 14-day, single-use) [CONFIRMED]
- **Integration path:** Hybrid (Data Connector + Direct API)
- **Rate limits:** 10 requests/second per build, shared across all API consumers [DOCUMENTED]

## Auth Structure

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Token lifecycle:** [CONFIRMED -- forum]

- Access tokens expire in 3600 seconds (1 hour)
- Refresh tokens expire in 14 days; single-use (becomes invalid once used)
- Token URL: `https://auth.simpro.co/oauth/token`
- Refresh: POST with `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`

## URL Structure

All resource endpoints are scoped under a company:

```
/api/v1.0/companies/{companyID}/{resource}/
/api/v1.0/companies/{companyID}/{resource}/{id}
```

- **companyID = 0** for single-company builds (most common) [DOCUMENTED]
- Multi-company builds require the actual company ID from `GET /api/v1.0/companies/`

## Capabilities

### CAN

1. List, get, create, and update jobs, quotes, leads, customers, contacts, sites
2. Filter records using field-value params with comparison operators: `gt()`, `lt()`, `ge()`, `le()`, `ne()`, `between()`, and `%` wildcards [CONFIRMED]
3. Filter by nested fields using dot notation: `?CustomFields.CustomField.ID=35` [CONFIRMED]
4. Select specific fields with `?columns=` parameter to reduce payload size [DOCUMENTED]
5. Sort results with `?orderby=` (prefix `-` for descending, comma for multi-sort) [DOCUMENTED]
6. Monitor changes via `If-Modified-Since` header on list endpoints [DOCUMENTED]
7. Manage webhook subscriptions for real-time event notifications (22 event types) [DOCUMENTED]
8. Get job cost center breakdowns (labor, materials, service fees) via sub-resources [CONFIRMED]

### CANNOT

1. Perform bulk create/update/delete operations (no batch endpoints exist) [CONFIRMED]
2. Execute full-text search (no search endpoint; use field filters + wildcards) [CONFIRMED]
3. Access data across company boundaries without explicit company ID
4. Modify system configuration (status codes, custom fields, security groups)
5. Upload or download file attachments (attachment entities exist but upload API undocumented)

## Critical Gotchas

1. **Company ID is mandatory in every resource path.** Use `0` for single-company builds. [DOCUMENTED]
2. **Rate limit is per-build, not per-key.** All consumers share 10 req/sec. [DOCUMENTED]
3. **PATCH returns 204 even on silent rejection.** Status updates that violate priority hierarchy return 204 but do nothing. Always verify with a GET after PATCH. [CONFIRMED -- forum: known bug]
4. **Status codes are hierarchical.** Cannot set lower-priority status unless "Ignore status priority" is enabled. [DOCUMENTED]
5. **Pagination defaults to 30 results.** Always set `pageSize=250` (max) for large datasets. [DOCUMENTED]
6. **orderby + If-Modified-Since + certain columns = 500.** Avoid combining these three. [DOCUMENTED]
7. **Filter field names matter.** Use `CompanyName` for company customers, not `Name`. ID column is not searchable on some endpoints. [CONFIRMED -- forum]
8. **Job Type has three values:** `Service`, `Project`, or `Prepaid`. [CONFIRMED -- forum]

## Default Parameters

| Parameter | Default | Reason                                                        |
| --------- | ------- | ------------------------------------------------------------- |
| companyID | 0       | Works for single-company builds                               |
| pageSize  | 100     | Balance of performance and data volume                        |
| columns   | (omit)  | Let API return default fields unless user needs specific ones |

## Working Examples

### Example 1: List Jobs with Pagination

```http
GET /api/v1.0/companies/0/jobs/?pageSize=100&page=1&columns=ID,Type,Status,DateIssued,Customer
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

Response: JSON array. Pagination metadata in headers:

- `Result-Total: 816` / `Result-Pages: 9` / `Result-Count: 100`
- `Link: <...?page=2>; rel="next", <...?page=9>; rel="last"`
  [DOCUMENTED]

### Example 2: Filter with Comparison Operators

```http
GET /api/v1.0/companies/0/customerInvoices/?DateIssued=gt(2026-01-01)&pageSize=250
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

Operators: `gt()`, `lt()`, `ge()`, `le()`, `ne()`, `between(start,end)`, `%` wildcard
[CONFIRMED -- forum]

### Example 3: Filter with Wildcards and Nested Fields

```http
GET /api/v1.0/companies/0/customers/individuals/?GivenName=Rose%&FamilyName=A%
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

[CONFIRMED -- forum]

### Example 4: Create a Webhook Subscription

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

[DOCUMENTED]

## Proxy API Operations

| Operation              | Method | Path                                                      | Key Parameters                   |
| ---------------------- | ------ | --------------------------------------------------------- | -------------------------------- |
| List companies         | GET    | `/companies/`                                             | (none)                           |
| List jobs              | GET    | `/companies/{cid}/jobs/`                                  | page, pageSize, columns, orderby |
| Get job                | GET    | `/companies/{cid}/jobs/{id}`                              | columns                          |
| Create job             | POST   | `/companies/{cid}/jobs/`                                  | Body: Type, Customer/Site IDs    |
| Update job             | PATCH  | `/companies/{cid}/jobs/{id}`                              | Body: fields to update           |
| Delete job             | DELETE | `/companies/{cid}/jobs/{id}`                              |                                  |
| List quotes            | GET    | `/companies/{cid}/quotes/`                                | page, pageSize, columns          |
| List leads             | GET    | `/companies/{cid}/leads/`                                 | page, pageSize                   |
| List company customers | GET    | `/companies/{cid}/customers/companies/`                   | page, pageSize                   |
| List individuals       | GET    | `/companies/{cid}/customers/individuals/`                 | page, pageSize                   |
| List contacts          | GET    | `/companies/{cid}/contacts/`                              | page, pageSize                   |
| List sites             | GET    | `/companies/{cid}/sites/`                                 | page, pageSize                   |
| List schedules         | GET    | `/companies/{cid}/schedules/`                             | page, pageSize                   |
| List invoices          | GET    | `/companies/{cid}/customerInvoices/`                      | page, pageSize                   |
| List employees         | GET    | `/companies/{cid}/employees/`                             | page, pageSize                   |
| List catalog           | GET    | `/companies/{cid}/catalogs/`                              | page, pageSize                   |
| List vendors           | GET    | `/companies/{cid}/vendors/`                               | page, pageSize                   |
| List POs               | GET    | `/companies/{cid}/purchaseOrders/`                        | page, pageSize                   |
| Job sections           | GET    | `/companies/{cid}/jobs/{jid}/sections/`                   |                                  |
| Cost centers           | GET    | `/companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/` |                                  |
| Create webhook         | POST   | `/webhooks/`                                              | Body: url, events                |
| List webhooks          | GET    | `/webhooks/`                                              |                                  |

## Pagination

- **Type:** Page-number based [DOCUMENTED]
- **Default page size:** 30; **Max page size:** 250 [DOCUMENTED]
- **Last page detection:** No `rel="next"` in Link header, or `page >= Result-Pages` header value
- **Always read:** `Result-Total`, `Result-Pages`, `Result-Count` response headers

## Error Handling

**Error response format:** [CONFIRMED -- forum]

```json
{
  "status": "error",
  "data": {
    "errors": [{ "path": null, "message": "Error description", "value": null }]
  }
}
```

**Recovery by status:**

| Status | Meaning         | Action                                                   |
| ------ | --------------- | -------------------------------------------------------- |
| 204    | Success (PATCH) | Verify change with GET -- 204 may hide silent rejections |
| 400    | Bad request     | Fix request per `data.errors[].message`                  |
| 401    | Unauthorized    | Refresh token and retry                                  |
| 403    | Forbidden       | Check access type (Direct vs User Token)                 |
| 404    | Not found       | Verify resource ID and company ID                        |
| 429    | Rate limited    | Wait 1+ seconds then retry; respect 10 req/sec limit     |
| 500    | Server error    | Retry with backoff; check for column/filter conflicts    |

## Webhooks

**Payload format:** [CONFIRMED -- forum posts with actual payloads]

```json
{
  "ID": "job.status",
  "build": "{build_name}",
  "name": "Job",
  "action": "status",
  "reference": { "companyID": 0, "jobID": 300555, "statusID": 10 },
  "date_triggered": "2023-01-31T09:05:27+00:00",
  "description": "Status of Job #300555 set to \"Job : In Progress\""
}
```

**22 event types:** job.created/updated/status, job.stage.{pending/progress/complete/invoiced/archived}, quote.created/updated/status, lead.created/updated/status, contact.created/updated, company.customer.created/updated, individual.customer.updated, job.schedule.created/updated, quote.schedule.created/updated

## Known Limitations

1. **PATCH response (204) does not confirm success** -- verify with a subsequent GET [CONFIRMED]
2. **No rate limit response headers** -- cannot detect approaching limit; use 80% threshold [CONFIRMED]
3. **OAuth scopes not enumerated** -- specific scope values are not publicly documented [CONFIRMED]
4. **Daily rate limit undisclosed** -- simPRO enforces daily limits but does not publish the number [DOCUMENTED]
5. **No bulk operations** -- must iterate one-by-one for mass creates/updates [CONFIRMED]

---

_Generated from investigation questionnaire. See companion files for detailed reference:_

- _01a-domain-model-reference.md -- Entity catalog, relationships, state machines_
- _01b-query-patterns.md -- Filtering, search, pagination examples_
- _01c-mutation-patterns.md -- Create, update, delete patterns_
- _01d-event-and-error-handling.md -- Events, webhooks, error recovery_
