---
api_name: simPRO
api_slug: simpro
doc: mutation-patterns (companion to 01-llm-api-rules.md) — write operations: create, update, delete, transitions
base_url: https://{build}.simprosuite.com/api/v1.0/ (/api/v1.0 is a real path segment)
company_scope: paths shown relative to base; prefix /companies/{companyID}/
headers: every write — Host {build}.simprosuite.com, Authorization: Bearer {access_token}, Content-Type: application/json
field_casing: PascalCase
confidence: confirmed (SDK / forum / SyncHub) unless tagged [DOCUMENTED]/[UNKNOWN]/[CONFIRMED]
---

# simPRO — Mutation Patterns

> Examples omit `Host`/`Authorization`/`Content-Type` (see frontmatter `headers`).

## Write capability matrix

| Operation                 | Supported | Method    | Notes                                                  |
| ------------------------- | --------- | --------- | ------------------------------------------------------ |
| Create                    | yes       | POST      | returns created resource with `ID`                     |
| Partial update            | yes       | PATCH     | returns 204 No Content                                 |
| Full replace              | yes       | PUT       | used for some updates                                  |
| Delete                    | yes       | DELETE    | may be permission-restricted                           |
| Soft delete               | n/a       | —         | Archive stage = soft delete for jobs                   |
| Bulk create/update/delete | NO        | —         | no bulk endpoints                                      |
| State transition          | yes       | PATCH     | via `StatusID` field                                   |
| File upload               | [UNKNOWN] | [UNKNOWN] | attachment entities exist; upload pattern undocumented |

## Patterns

1. **Create:** `POST /companies/{cid}/{resource}/` body `{"RequiredField1":"value","RelatedEntityID":123,"OptionalField":"value"}` → returns created resource with auto `ID`. FKs are plain integer IDs (`SiteID:1`, `CompanyCustomerID:45`), not nested objects. No idempotency-key support.
2. **Partial update (PATCH):** `PATCH /companies/{cid}/{resource}/{id}` body `{"FieldToUpdate":"new_value"}` → **HTTP 204**. Send only changed fields. **204 is returned even on silent rejection** (e.g. invalid status transition) — always verify with a GET if the change matters. Custom fields may be ignored on a job-create PATCH; apply them after creation.
3. **Full replace (PUT):** `PUT /companies/{cid}/{resource}/{id}` body with all fields. PATCH for partial (most common, confirmed for job status); PUT when the API requires full replacement. When in doubt, prefer PATCH with only changed fields.
4. **Delete:** `DELETE /companies/{cid}/{resource}/{id}`. Jobs: prefer Archive stage over DELETE. Cascading effects and reversibility: [UNKNOWN].
5. **State transition (job status):** `PATCH /companies/{cid}/jobs/{jobID}` body `{"StatusID":10}` → 204. Status codes have a priority hierarchy; cannot set a lower-priority status unless "Ignore status priority" is enabled. 204 returned even if silently rejected. Triggers webhook `job.status` (and possibly `job.stage.{stage}`). Quote status updates have the SAME issue: 204 even when ignored, AND a webhook fires despite no change. Verify: `PATCH jobs/{id} {StatusID:10}` → 204, then `GET jobs/{id}?columns=ID,StatusID,Stage` to confirm.
6. **Nested / related (job hierarchy, build top-down — parent before child):**

```
POST /companies/{cid}/jobs/                                                       create job
POST /companies/{cid}/jobs/{jid}/sections/                                        create section
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/                      create cost center
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/schedules/     create schedule
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/labor/         add labor
POST /companies/{cid}/jobs/{jid}/sections/{sid}/costCenters/{ccid}/catalogs/      add materials
```

Schedule body example: `{"Staff":{"ID":7},"StartDate":"2026-03-15T08:00:00","EndDate":"2026-03-15T17:00:00"}` 7. **Create webhook:** `POST /webhooks/` body `{"url":"https://your-endpoint.com/webhook","events":["job.created","job.updated","job.stage.complete"]}`

## Field validation rules

| Entity             | Field                                     | Rule                                              |
| ------------------ | ----------------------------------------- | ------------------------------------------------- |
| Job                | Type                                      | must be `Service`, `Project`, or `Prepaid`        |
| Job                | CompanyCustomerID or IndividualCustomerID | must reference existing customer                  |
| Job                | SiteID                                    | must reference existing site                      |
| Job                | StatusID                                  | valid status-code ID; priority hierarchy enforced |
| IndividualCustomer | GivenName, FamilyName                     | required on create                                |
| CompanyCustomer    | CompanyName                               | required on create                                |
| Contact            | GivenName, FamilyName                     | required on create                                |
| Webhook            | url                                       | valid HTTPS URL; must return HTTP 200 on delivery |
| Webhook            | events                                    | valid names from the 22 supported events          |

Validation error: `{"status":"error","data":{"errors":[{"path":"SiteID","message":"Site not found.","value":999}]}}`

## Server-side defaults

| Entity  | Field         | Default                             | When              |
| ------- | ------------- | ----------------------------------- | ----------------- |
| All     | ID            | auto-generated int                  | create            |
| Job     | Stage         | Pending (via initial status code)   | create            |
| Job     | CompletedDate | set when job reaches Complete stage | status transition |
| Job     | Totals        | computed from cost-center items     | create, update    |
| Lead    | DateCreated   | current date                        | create            |
| Invoice | DateCreated   | current timestamp                   | create            |

## Worked examples

1. **Create a service job** (`POST /companies/0/jobs/`): `{"Type":"Service","CompanyCustomerID":45,"SiteID":1}`. Customer + Site must exist first. Response includes the created job's `ID`. Optional fields: OrderNo, Description, DateIssued, DueDate, Notes, etc. Custom fields need a separate PATCH after create.
2. **Update job status + verify:** `PATCH /companies/0/jobs/123 {"StatusID":10}` → 204, then `GET /companies/0/jobs/123?columns=ID,StatusID,Stage`. StatusID 10 is illustrative — actual IDs are per-build. Target status must have higher priority than current. 204 may be a silent rejection — always verify. Triggers `job.status` (+ possibly `job.stage.complete`).
3. **Create webhook for job events** (`POST /webhooks/`): `{"url":"https://integration.example.com/simpro/webhooks","events":["job.created","job.updated","job.status","job.stage.progress","job.stage.complete","job.stage.invoiced"]}`. URL must be reachable and return 200. 22 event types — see 01d.

## Gotchas

1. PATCH returns 204 on both success and silent failure. Status updates violating priority return 204 but do nothing; quote-status silent rejection also fires a webhook. Always verify with GET.
2. Custom fields may be ignored on job-create — apply them in a separate PATCH after the POST.
3. Deeply nested sub-resource URLs — a schedule requires the full Job > Section > CostCenter path; you cannot create one without traversing the parent hierarchy.
4. Status-priority enforcement — lower-priority changes silently fail; use a higher-priority status or enable "Ignore status priority" on the target code.
5. No bulk ops — updating 100 jobs = 100 PATCHes; at 10 req/sec that is ≥10s.
6. FK fields use direct integer IDs (`CompanyCustomerID:45`, `SiteID:1`), not nested objects.

## Dangerous operations (confirm with user before executing)

| Operation                     | Why dangerous                                       | Safeguard                           |
| ----------------------------- | --------------------------------------------------- | ----------------------------------- |
| DELETE any resource           | may be irreversible; cascading effects unknown      | confirm; prefer archiving jobs      |
| PATCH Job StatusID → Invoiced | creates financial records (invoice) hard to reverse | confirm intent to invoice           |
| PATCH Job StatusID → Archived | final state; no further actions                     | confirm intent to close permanently |
| DELETE webhook subscription   | stops all event notifications                       | confirm before removing             |
