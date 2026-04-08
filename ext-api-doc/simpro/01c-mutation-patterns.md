---
api_name: 'simPRO'
api_slug: 'simpro'
generated_from: '00-api-investigation'
generated_date: '2026-03-30'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# simPRO -- Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Contains all write operation patterns including
> create, update, delete, state transitions, and nested record operations.

---

## Write Capabilities Summary

| Operation         | Supported | Method    | Notes                                                         |
| ----------------- | --------- | --------- | ------------------------------------------------------------- |
| Create            | Yes       | POST      | Returns created resource with ID [CONFIRMED -- SDK, forum]    |
| Partial update    | Yes       | PATCH     | Returns 204 No Content [CONFIRMED -- forum]                   |
| Full replace      | Yes       | PUT       | Used for some updates [CONFIRMED -- Rollout guide]            |
| Delete            | Yes       | DELETE    | May be restricted by permissions [CONFIRMED -- Rollout guide] |
| Soft delete       | N/A       | N/A       | Archive stage serves as soft delete for jobs [CONFIRMED]      |
| Bulk create       | No        | N/A       | No bulk endpoints [CONFIRMED]                                 |
| Bulk update       | No        | N/A       | No bulk endpoints [CONFIRMED]                                 |
| Bulk delete       | No        | N/A       | No bulk endpoints [CONFIRMED]                                 |
| State transitions | Yes       | PATCH     | Via StatusID field update [CONFIRMED -- forum]                |
| File upload       | [UNKNOWN] | [UNKNOWN] | Attachment entities exist; upload pattern undocumented        |

---

## Common Patterns

### Pattern 1: Create

> Create a new resource with required fields.

```http
POST /api/v1.0/companies/{companyID}/{resource}/
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "RequiredField1": "value",
  "RelatedEntityID": 123,
  "OptionalField": "value"
}
```

**Response:** Returns created resource with auto-generated ID [CONFIRMED -- forum: `job.ID`]

**Notes:**

- Related entities are referenced by their ID field (e.g., `SiteID: 1`, `CompanyCustomerID: 45`) [CONFIRMED -- SyncHub data model]
- Server generates the ID field [CONFIRMED]
- No idempotency key support documented [CONFIRMED]

---

### Pattern 2: Partial Update with PATCH

> simPRO uses PATCH for partial updates. Send only the fields you want to change.

```http
PATCH /api/v1.0/companies/{companyID}/{resource}/{id}
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "FieldToUpdate": "new_value"
}
```

**Response:** HTTP 204 No Content [CONFIRMED -- forum]

**Critical behavior:**

- PATCH returns 204 even if the update was silently rejected (e.g., invalid status transition) [CONFIRMED -- forum: known bug]
- Always verify with a GET after PATCH if the change matters [CONFIRMED -- forum]
- PATCH on custom fields may be ignored when creating a new job (apply after creation) [CONFIRMED -- forum]

---

### Pattern 3: Full Replace with PUT

> Some updates may use PUT for full replacement.

```http
PUT /api/v1.0/companies/{companyID}/{resource}/{id}
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "FieldToUpdate": "new_value",
  "OtherField": "existing_value"
}
```

**Response:** [CONFIRMED -- Rollout guide uses PUT for updates]

**When to use PUT vs PATCH:**

- PATCH for partial updates (most common, confirmed for job status) [CONFIRMED -- forum]
- PUT when the API requires full resource replacement
- When in doubt, prefer PATCH and include only changed fields

---

### Pattern 4: Delete

```http
DELETE /api/v1.0/companies/{companyID}/{resource}/{id}
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

**Behavior:**

- Jobs: prefer Archive stage over DELETE when possible [CONFIRMED]
- Cascading effects on child resources: [UNKNOWN]
- Reversibility: [UNKNOWN]

---

### Pattern 5: State Transition (Job Status)

> Update a job's status to move it through the workflow.

```http
PATCH /api/v1.0/companies/{companyID}/jobs/{jobID}
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "StatusID": 10
}
```

[CONFIRMED -- forum discusses PATCH for job status with StatusID]

**Response:** HTTP 204 No Content [CONFIRMED]

**Rules:**

- Status codes have a priority hierarchy [DOCUMENTED]
- Cannot set to a lower-priority status unless "Ignore status priority" is enabled [DOCUMENTED]
- PATCH returns 204 even if status change was silently rejected [CONFIRMED -- forum: known bug]
- Triggers webhook: `job.status` and possibly `job.stage.{stage}` [DOCUMENTED]
- Quote status updates have the same issue: 204 returned even when status is ignored, AND a webhook event fires despite the status not changing [CONFIRMED -- forum]

**Verification pattern:**

```
1. PATCH /companies/{cid}/jobs/{id}  (StatusID: 10)  -> 204
2. GET /companies/{cid}/jobs/{id}?columns=ID,StatusID,Stage  -> verify StatusID is 10
```

---

### Pattern 6: Nested / Related Record Operations

> simPRO uses deeply nested sub-resource URLs for child records.

**Create a schedule under a job cost center:**

```http
POST /api/v1.0/companies/{companyID}/jobs/{jobID}/sections/{sectionID}/costCenters/{ccID}/schedules/
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "Staff": {"ID": 7},
  "StartDate": "2026-03-15T08:00:00",
  "EndDate": "2026-03-15T17:00:00"
}
```

[CONFIRMED -- sub-resource pattern confirmed in forum]

**Key hierarchy for Jobs:**

```
POST /companies/{cid}/jobs/                                              -> Create job
POST /companies/{cid}/jobs/{jid}/sections/                               -> Create section
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/             -> Create cost center
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/schedules/ -> Create schedule
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/labor/     -> Add labor
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/catalogs/  -> Add materials
```

> **Build top-down:** You must create each parent before its children. [DOCUMENTED -- forum]

---

### Pattern 7: Create Webhook Subscription

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

---

## Field Validation Rules

> Rules the API enforces on write operations.

| Entity             | Field                                     | Rule                                                      | Source                       |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| Job                | Type                                      | Must be `Service`, `Project`, or `Prepaid`                | [CONFIRMED -- forum]         |
| Job                | CompanyCustomerID or IndividualCustomerID | Must reference existing customer                          | [CONFIRMED -- SyncHub model] |
| Job                | SiteID                                    | Must reference existing site                              | [CONFIRMED -- SyncHub model] |
| Job                | StatusID                                  | Must be valid status code ID; priority hierarchy enforced | [DOCUMENTED]                 |
| IndividualCustomer | GivenName, FamilyName                     | Required on create                                        | [CONFIRMED -- SyncHub model] |
| CompanyCustomer    | CompanyName                               | Required on create                                        | [CONFIRMED -- SyncHub model] |
| Contact            | GivenName, FamilyName                     | Required on create                                        | [CONFIRMED -- SyncHub model] |
| Webhook            | url                                       | Must be valid HTTPS URL; must return HTTP 200 on delivery | [DOCUMENTED]                 |
| Webhook            | events                                    | Must be valid event names from the 22 supported events    | [DOCUMENTED]                 |

**Validation error format:** [CONFIRMED -- forum]

```json
{
  "status": "error",
  "data": {
    "errors": [{ "path": "SiteID", "message": "Site not found.", "value": 999 }]
  }
}
```

---

## Server-Side Defaults

> Fields the server populates automatically on create/update.

| Entity  | Field         | Default Value                       | When Applied                                   |
| ------- | ------------- | ----------------------------------- | ---------------------------------------------- |
| All     | ID            | auto-generated int                  | create                                         |
| Job     | Stage         | Pending (via initial status code)   | create [CONFIRMED]                             |
| Job     | CompletedDate | set when job reaches Complete stage | status transition [CONFIRMED -- SyncHub model] |
| Job     | Totals        | computed from cost center items     | create, update [CONFIRMED -- SyncHub model]    |
| Lead    | DateCreated   | current date                        | create [CONFIRMED -- SyncHub model]            |
| Invoice | DateCreated   | current timestamp                   | create [CONFIRMED -- SyncHub model]            |

---

## Worked Examples

### Example 1: Create a New Job

> Create a service job for an existing company customer at an existing site.

```http
POST /api/v1.0/companies/0/jobs/
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "Type": "Service",
  "CompanyCustomerID": 45,
  "SiteID": 1
}
```

**Notes:**

- Customer and Site must exist beforehand [CONFIRMED -- SyncHub model shows FK fields]
- Response includes the created job's ID [CONFIRMED -- forum]
- Additional fields (OrderNo, Description, DateIssued, DueDate, Notes, etc.) can be included [CONFIRMED -- SyncHub model]
- Custom fields may need a separate PATCH after creation [CONFIRMED -- forum]

---

### Example 2: Update Job Status with Verification

> Move a job from Progress to Complete by updating its status code.

```http
PATCH /api/v1.0/companies/0/jobs/123
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "StatusID": 10
}
```

**Then verify:**

```http
GET /api/v1.0/companies/0/jobs/123?columns=ID,StatusID,Stage
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
```

**Notes:**

- StatusID 10 is an example -- actual IDs are per-build configuration [CONFIRMED]
- The status must have higher priority than the current status [DOCUMENTED]
- PATCH returns 204 even on silent rejection -- always verify [CONFIRMED -- forum]
- Triggers webhook: `job.status` and possibly `job.stage.complete` [DOCUMENTED]

---

### Example 3: Create Webhook for Job Events

```http
POST /api/v1.0/webhooks/
Host: {build}.simprosuite.com
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "url": "https://integration.example.com/simpro/webhooks",
  "events": [
    "job.created",
    "job.updated",
    "job.status",
    "job.stage.progress",
    "job.stage.complete",
    "job.stage.invoiced"
  ]
}
```

**Notes:**

- The URL must be reachable and return HTTP 200 [DOCUMENTED -- Rollout guide]
- 22 event types available (see 01d-event-and-error-handling.md for full list)

---

## Gotchas & Counter-Exceptions

1. **PATCH returns 204 on both success and silent failure.** Status updates that violate priority return 204 but do nothing. Quote status updates have the same issue AND trigger a webhook despite no change. Always verify with GET. [CONFIRMED -- forum]

2. **Custom fields may be ignored on job creation PATCH.** Apply custom fields in a separate PATCH after the initial POST create. [CONFIRMED -- forum]

3. **Deeply nested sub-resource URLs.** Creating a schedule requires the full path: Job ID > Section ID > CostCenter ID. You cannot create a schedule without first traversing the parent hierarchy. [DOCUMENTED -- forum]

4. **Status priority enforcement.** Lower-priority status changes silently fail. You must either use a higher-priority status or ensure "Ignore status priority" is enabled on the target status code. [DOCUMENTED]

5. **No bulk operations.** To update 100 jobs, you must make 100 individual PATCH requests. At 10 req/sec rate limit, this takes minimum 10 seconds. [CONFIRMED]

6. **FK fields use direct IDs, not nested objects.** The SyncHub data model confirms fields like `CompanyCustomerID: 45` and `SiteID: 1` -- plain integer FKs. [CONFIRMED -- SyncHub model]

---

## Dangerous Operations

> Operations that are destructive, irreversible, or have significant side effects.
> The workspace agent should confirm with the user before executing these.

| Operation                      | Why Dangerous                                                   | Safeguard                                                     |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| DELETE any resource            | May be irreversible; cascading effects unknown                  | Always confirm with user; prefer archiving jobs over deleting |
| PATCH Job StatusID to Invoiced | Creates financial records (invoice) that may be hard to reverse | Confirm user intends to invoice the job                       |
| PATCH Job StatusID to Archived | Final state; no further actions possible                        | Confirm user intends to close permanently                     |
| DELETE webhook subscription    | Stops all event notifications                                   | Confirm before removing                                       |

---

_Generated from the investigation questionnaire, Phases 3-4._
