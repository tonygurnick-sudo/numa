---
api_name: simPRO
api_slug: simpro
doc: events + error handling (companion to 01-llm-api-rules.md) — webhooks, polling, errors, recovery
base_url: https://{build}.simprosuite.com/api/v1.0/ (/api/v1.0 is a real path segment)
headers: Host {build}.simprosuite.com, Authorization: Bearer {access_token}
confidence: confirmed (forum payloads / SDK / Laravel pkg) unless tagged [DOCUMENTED]/[UNKNOWN]/[INFERRED]/[CONFIRMED]
---

# simPRO — Event & Error Handling

## Event mechanisms

| Mechanism            | Supported | Notes                                        |
| -------------------- | --------- | -------------------------------------------- |
| Webhooks             | yes       | 22 event types; register via API + UI        |
| WebSocket            | NO        | —                                            |
| SSE                  | NO        | —                                            |
| Long polling         | NO        | —                                            |
| Change feeds/streams | NO        | use `If-Modified-Since` for change detection |

## Webhooks

Register: `POST /webhooks/` (or UI: System > Setup > API > Webhook Subscriptions). URL must be HTTPS and return 200 on delivery.
`POST /webhooks/` body `{"url":"https://your-endpoint.com/webhook","events":["job.created","job.updated","job.stage.complete"]}`

### 22 events

| Event                                                         | Trigger                                   |
| ------------------------------------------------------------- | ----------------------------------------- |
| contact.created / contact.updated                             | contact created / modified                |
| company.customer.created / company.customer.updated           | company customer created / modified       |
| individual.customer.updated                                   | individual customer modified              |
| job.created / job.updated                                     | job created / modified                    |
| job.status                                                    | job status code changed                   |
| job.stage.pending / progress / complete / invoiced / archived | job enters that stage                     |
| lead.created / lead.updated / lead.status                     | lead created / modified / status changed  |
| quote.created / quote.updated / quote.status                  | quote created / modified / status changed |
| job.schedule.created / job.schedule.updated                   | job schedule created / modified           |
| quote.schedule.created / quote.schedule.updated               | quote schedule created / modified         |

### Payloads [confirmed — actual received payloads]

job.status: `{"ID":"job.status","build":"{build_name}","name":"Job","action":"status","reference":{"companyID":0,"jobID":300555,"statusID":10},"date_triggered":"2023-01-31T09:05:27+00:00","description":"Status of Job #300555 set to \"Job : In Progress\""}`
job.schedule.created: `{"ID":"job.schedule.created","build":"{build_name}","name":"Job schedule","action":"created","reference":{"companyID":0,"scheduleID":123,"jobID":456,"sectionID":1,"costCenterID":1},"date_triggered":"2023-01-31T09:05:27+00:00","description":"Schedule created for Job #456"}`
job.attachment.created: `{"ID":"job.attachment.created","build":"{build_name}","name":"Job attachment","action":"created","reference":{"companyID":0,"ID":789,"folderID":1,"attachmentID":"abc-123","attachmentName":"photo.jpg"},"date_triggered":"2023-01-31T09:05:27+00:00","description":"..."}`

Standard fields (all always present): `ID` (string, event type e.g. "job.status") · `build` (string) · `name` (string, human entity name e.g. "Job") · `action` (string, e.g. "status"/"created"/"updated") · `reference` (object, entity-specific IDs) · `date_triggered` (string, ISO 8601 with tz offset) · `description` (string).

Reference fields by event:
| Event type | reference fields |
| --- | --- |
| job._ | companyID, jobID, (statusID for job.status) |
| job.schedule._ | companyID, scheduleID, jobID, sectionID, costCenterID |
| job.attachment._ | companyID, ID, folderID, attachmentID, attachmentName |
| quote._ | companyID, quoteID (expected) |
| lead._ | companyID, leadID (expected) |
| contact._ | companyID, contactID (expected) |
| _.customer._ | companyID, customerID (expected) |

### Security / reliability

- Signature header: NONE — receivers cannot cryptographically verify origin. Validate by cross-referencing against the API (GET the referenced job, confirm status matches). IP allowlist: [UNKNOWN].
- Retry policy / max retries / dead-letter / event ordering: [UNKNOWN].
- Duplicate delivery: assume yes. Dedup key = `date_triggered` + event `ID` + `reference` IDs.
- Silently-rejected quote-status PATCH still fires a webhook event despite no change.

## Polling fallback

`GET /companies/{cid}/{resource}/?pageSize=250` + header `If-Modified-Since: {last_poll}` (format `YYYY-MM-ddTHH:mm:ss`). Interval ≥60s (respect 10 req/sec). Loop: store last_poll → wait → GET with If-Modified-Since → paginate all pages → update last_poll → repeat.
Tips: select minimal columns (`?columns=ID,DateModified,Status`); avoid `orderby`+`If-Modified-Since`+`AssignedTo` (→500); stagger resource polling within the 10 req/sec shared budget.

## Errors

Format: `{"status":"error","url":"https://xxxxx.simprosuite.com/api/v1.0/...","header":{},"data":{"errors":[{"path":null,"message":"Invalid route.","value":null}]}}`
Fields (all always present): `status` (always "error") · `url` (request URL) · `header` (echoes YOUR request headers — not error metadata) · `data.errors[]` array of `{path (field name | null for general), message (human), value (problematic value | null)}`. Multiple validation errors can return in one `data.errors` array, e.g.:
`{"status":"error","url":"https://build.simprosuite.com/api/v1.0/companies/0/jobs/","header":{},"data":{"errors":[{"path":"SiteID","message":"Site not found.","value":999},{"path":"Type","message":"Invalid job type.","value":"InvalidType"}]}}`

### Recovery playbook

| HTTP | Meaning                    | Retryable | Action                                                                                        | Max retries |
| ---- | -------------------------- | --------- | --------------------------------------------------------------------------------------------- | ----------- |
| 200  | Success (GET/POST)         | -         | -                                                                                             | -           |
| 204  | No Content (PATCH success) | -         | verify with GET — may be silent rejection                                                     | -           |
| 400  | Bad request                | no        | fix per `data.errors[].message`                                                               | 0           |
| 401  | Unauthorized               | yes       | refresh OAuth token (`POST {build}.simprosuite.com/oauth2/token`, refresh_token grant), retry | 1           |
| 403  | Forbidden                  | no        | check Access Type (Direct vs User Token); do NOT loop refresh                                 | 0           |
| 404  | Not found                  | no        | verify resource ID; check companyID (0 for single-company)                                    | 0           |
| 405  | Method not allowed         | no        | verify HTTP method supported for endpoint                                                     | 0           |
| 409  | Conflict                   | maybe     | concurrent modification — re-fetch and retry                                                  | 1           |
| 422  | Validation failed          | no        | fix fields per `data.errors`                                                                  | 0           |
| 429  | Rate limited               | yes       | wait ≥1s; exponential backoff                                                                 | 3           |
| 500  | Internal error             | yes       | backoff; check column/filter conflicts                                                        | 3           |
| 502  | Bad gateway                | yes       | retry after 5s                                                                                | 3           |
| 503  | Service unavailable        | yes       | check status.simprogroup.com; backoff                                                         | 3           |

### Rate limit

| Scope                     | Limit       | Window   | Notes                                    |
| ------------------------- | ----------- | -------- | ---------------------------------------- |
| Per-build (ALL consumers) | 10 requests | 1 second | strictly enforced since Aug 2022         |
| Per-build (daily)         | [UNKNOWN]   | 24h      | exists but number unpublished [INFERRED] |

Per-build (tenant), shared across ALL consumers/threads/integrations — NOT per-key. No rate-limit headers (no `X-RateLimit-*`); track rate client-side. Exceeded → HTTP 429.
Backoff: honor `Retry-After` if present ([UNKNOWN if returned]); else exponential from 1s, max 30s, +0–500ms jitter; cap proactively at 8 req/sec (80% threshold, per Laravel pkg config).

## Counter-exceptions (differ from standard REST)

1. Pagination metadata in HEADERS, not body. Body = bare JSON array (not `{"data":[...],"pagination":{...}}`).
2. Rate limit per-build, not per-key — integrations compete for the same budget.
3. PATCH 204 ≠ guaranteed success — priority-violating status updates return 204 but do nothing; rejected quote-status PATCH still fires a webhook.
4. No rate-limit response headers — track client-side.
5. Error response echoes your request headers in the `header` field.

## Output formatting (for user display)

| Data       | Format            | Example                                                                                  |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Single job | key-value summary | "Job #123: Service at Main Office for Acme Corp. Status: Progress. Issued: Jan 15, 2026" |
| Job list   | markdown table    | ID, Type, Customer, Status, DateIssued columns                                           |
| Schedule   | calendar-style    | "Mar 15, 2026: 8:00 AM – 5:00 PM (John Smith at Job #123)"                               |
| Invoice    | financial summary | "Invoice #456: $1,500.00 for Acme Corp. Status: Paid"                                    |
| Dates      | human-readable    | "January 15, 2026" (not "2026-01-15")                                                    |
| Currency   | localized         | "$1,234.56" (customer locale if known)                                                   |
| Errors     | clear message     | "Could not find job #123. Verify the ID and try again."                                  |

Truncation: lists → first 10 records + note `Result-Total`; long fields → 200 chars + "..."; nested → 2 levels (job > section, not full cost-center tree); custom fields → only on request.
