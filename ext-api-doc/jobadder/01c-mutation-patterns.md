---
api_name: JobAdder
api_slug: jobadder
base_url: https://api.jobadder.com/v2
path_version_segment: /v2 is a REAL path segment, already in base_url — do NOT add another
urls: ABSOLUTE REQUIRED (`https://api.jobadder.com/v2/...`); relative paths fail
call_surface: HTTP via `numa integrations request` (connector=jobadder); POST/PUT pass JSON `body` (single object)
field_casing: camelCase
companions: 01=api-rules, 01a=domain-model, 01b=queries, 01d=events+errors
confidence: docs-derived from official OpenAPI spec (2026-06-10); NOT live-validated. Inline tags only when non-default: [official only]=official spec not the mirror; [SPEC-community]=community mirror only; [UNVERIFIED]=inference. Write bodies = the spec's command schemas; GET a real record first and mirror live field names if anything disagrees.
---

# JobAdder — Mutation Patterns

All writes via `numa integrations request` (connector=jobadder), absolute URLs, JSON `body`.

## Write Rules (read first)

1. **Reads return nested objects; writes take flat ids.** Read `"status":{"statusId":10,"name":"Open"}` → write `"statusId":10`. Same for `companyId`,`contactId`,`workTypeId`,`ownerUserId`.
2. **Resolve account-specific ids before writing**: `statusId` from `/{entity}/lists/status`, `categoryId` from `/categories`, `workTypeId` from `/worktypes`, custom `fieldId` from `/{entity}/fields/custom`. Never reuse ids across accounts.
3. **PUT omitted-field behaviour is [UNVERIFIED]** (ignore vs clear). All update-command fields optional in the spec; send every field you care about and avoid sending fields you don't intend to change with null values.
4. **No DELETE on core entities** (jobs, candidates, companies, contacts, applications, placements). Offer a status change (inactive/archived status) instead.
5. **Confirm with the user before any write**; echo ids + key fields after success.
6. **Not idempotent**: POSTs create a new record each call (except candidate-by-email dedupe). On 5xx/timeout after a POST, search before retrying [UNVERIFIED — assume worst case].
7. Dedicated status endpoints return **200 on change, 202 if already at that status** — both success; don't re-fire.

## Jobs (JobOrder)

### Create — `POST /jobs` → 201 `JobOrderRepresentation`

Only `jobTitle` required. AddJobOrderCommand `body`:
`{"jobTitle":"Senior Platform Engineer","companyId":456,"contactId":789,"jobDescription":"…","statusId":10,"numberOfJobs":1,"workTypeId":3,"category":{"categoryId":12,"subCategoryId":121},"location":{"locationId":7,"areaId":71},"salary":{"ratePer":"Year","rateLow":140000,"rateHigh":170000,"currency":"NZD","timePerWeek":40},"start":{"immediate":true},"ownerUserId":1001,"recruiterUserId":[1001,1002]}`
Also accepted: `workplaceAddressId` (uuid from `/companies/{id}/addresses`), `duration` (`{period,unit}`), `source`, `skillTags`, `custom` (`[{fieldId,value}]`), `endDate`, `fee`, `workShift`, `workflowId` [last four official only].

### Update — `PUT /jobs/{jobId}` → 200 / 404 / 422

Same shape as create (UpdateJobOrderCommand). 200 body empty ("Job was successfully updated") — GET the job afterwards if you need the new state.

### Status — `PUT /jobs/{jobId}/status`

`{"statusId":11,"note":{"text":"Closed — filled internally"}}` (note optional).

## Candidates

### Create — `POST /candidates` → 201, **409 on duplicate email**

`{"firstName":"Jane","lastName":"Smith","email":"jane.smith@acme.co.nz","mobile":"+64211234567","address":{"street":["1 Queen St"],"city":"Auckland","postalCode":"1010","countryCode":"NZ"},"skillTags":["python","aws"],"seeking":"Yes","statusId":20,"source":"Referral"}`

- `street` is an **array**. `seeking` enum: `Yes`|`Maybe`|`No`.
- Extended fields: `salutation`, `rating`, `social`, `employment`(`{current,ideal,history[]}`), `availability`, `education[]`, `custom`, `recruiterUserId[]`, `summary`, `dateOfBirth`, `emergencyContact`/`emergencyPhone`, `unsubscribed` [last five official only].
- **409 handling**: `GET /candidates?email=...` and reuse the existing record. `X-Allow-Duplicates` request header can force creation — avoid unless the user explicitly wants a duplicate.

### Update — `PUT /candidates/{candidateId}`

Same field set (UpdateCandidateCommand; no `source` on update). Empty 200 body — re-GET if needed.

### Status — `PUT /candidates/{candidateId}/status`

`{"statusId":21,"note":{...}}` → 200 changed / 202 already set / 404 / 422.

## Applications — the workflow engine

### Add candidate(s) to a job — `POST /jobs/{jobId}/applications`

`{"candidateId":[8855221],"source":"LinkedIn"}`

- `candidateId` is an **array** — add several at once. Returns 201 with `JobApplicationListRepresentation` (one application per candidate).
- **409 = candidate already has an application** on this job — `GET /jobs/1234/applications?candidateId=8855221` and work with the existing one.
- Mirror endpoint: `POST /candidates/{candidateId}/applications` with `{"jobId":[..]}`.

### Move through the funnel — `PUT /applications/{applicationId}/status`

1. Resolve the stage id once per session: `GET /applications/lists/status`.
2. Set it: `PUT /applications/9988776655/status` body `{"statusId":42,"note":{"text":"Moved to interview after phone screen"}}`.
   200 = updated; **202 = already at that status** (success, don't retry); 404; 422.

### Update rating / custom fields — `PUT /applications/{applicationId}`

`{"statusId":42,"rating":4,"custom":[{"fieldId":3,"value":"…"}]}` (all optional).

### Client review loop (submit to client) — distinct from the status workflow; use only when running client submissions

- `POST /applications/{id}/review` `{"submittedByUserId":1001}` → 202 (submits for review)
- `PUT /applications/{id}/review/accept` `{"contactId":789,"message":"…"}` → 202 (`contactId` required)
- `PUT /applications/{id}/review/reject` `{"contactId":789,"reason":"…"}` → 202 (`contactId` required)

## Companies

### Create — `POST /companies` (only `name` required)

`{"name":"Acme Ltd","statusId":1,"ownerUserId":1001}`
Extras: `legalName`, `social`, `summary` [official only], `parentCompanyId`, `custom`, `recruiterUserId[]`. `mainContactId` and `primaryAddressId` are **update-only** — create the contact/address first, then `PUT /companies/{companyId}` to link.

### Addresses — `POST /companies/{companyId}/addresses` (`name` required)

`{"name":"Head Office","street":["1 Queen St"],"city":"Auckland","postalCode":"1010","countryCode":"NZ","phone":"+6493001234"}`
→ 201 with uuid `addressId` (usable as a job's `workplaceAddressId`). Update/delete via `PUT/DELETE /companies/{companyId}/addresses/{addressId}`.

### Update / status

`PUT /companies/{companyId}` (UpdateCompanyCommand) · `PUT /companies/{companyId}/status` `{"statusId":...}`.

## Contacts

### Create — `POST /contacts`

`{"firstName":"Sam","lastName":"Buyer","position":"Head of Engineering","email":"sam@acme.co.nz","companyId":456,"statusId":1}`
Extras: `mobile`, `phone`, `salutation`, `social`, `reportsToContactId`, `custom`, `ownerUserId`, `recruiterUserId[]`, `officeAddressId`, `otherEmail[]`, `summary`, `unsubscribed` [last four official only]. Update: `PUT /contacts/{contactId}`; status: `PUT /contacts/{contactId}/status`.

## Placements — UPDATE ONLY

**No `POST /placements`** — placements are UI-created when an application is placed. You can:

- `PUT /placements/{placementId}` (UpdatePlacementCommand): `jobTitle`, `contactId`, `summary`, `statusId`, `paymentType`, `startDate`/`endDate` (`yyyy-MM-dd`), `salary` (`{base,superannuation,benefits,total,fee}`), `contractRate` (`{ratePer,hoursPerWeek,daysPerWeek,clientRate,candidateRate,onCostsType,onCosts,netMargin}`), `award`, `industryCode`, `billing`, `feeSplit` (`Fixed|Percent`), `recruiters[]`, `custom[]`.
- `PUT /placements/{placementId}/status` `{"statusId":...}`.
  Resolve billing/payroll lookups from `/placements/lists/*` (awards, billingterms, industrycodes, paymenttypes) before writing those fields. If asked to "create a placement", explain it must be done in JobAdder and offer to update the application status instead.

## Notes

### Polymorphic create — `POST /notes` (`type` + `text` required)

`{"type":"General","text":"Call summary: …","candidateId":[8855221],"jobId":[1234]}`

- Entity links are **arrays of ids** — one note can attach to several records at once.
- `type` values are account-specific: `GET /{entity}/lists/notetype`.
- Scoped alternative: `POST /jobs/{id}/notes`, `/candidates/{id}/notes`, etc.
- Update: `PUT /notes/{noteId}` `{"type","text"}`. Text limit 65535 chars.

## Requisitions — the one entity with a full lifecycle (and DELETE)

Internal job requests that precede a job order:

- `POST /requisitions` — required: `contactId` (hiring manager) + `jobTitle`; body mirrors the job create shape (`category`,`location`,`salary`,`workTypeId`,`numberOfJobs`,`custom`,`workflowId`,`recruiterUserId[]`).
- `PUT /requisitions/{requisitionId}` — update.
- `PUT /requisitions/{requisitionId}/submit` — submit for approval.
- `PUT /requisitions/{requisitionId}/approve` / `.../reject` — approval decisions.
- `GET /requisitions/{requisitionId}/history` — audit trail.
- `DELETE /requisitions/{requisitionId}` — the only deletable core-ish entity.
  An approved requisition links to its created job via `jobOrderId` on the representation.

## Job Ads, Folders, Opportunities, Interviews

- `POST /jobads` creates a **draft** ad (`title` + `ownerUserId` required; `jobId` links to a job; `summary`, `bulletPoints[]`, `description` fill content); `PUT /jobads/{adId}` updates. Posting to boards = job-board APIs, out of scope for chat; hand drafts back to the user.
- `POST /folders` `{"folderName":"...","ownerID":1001}` (note the `ID` casing — copy exactly); `PATCH /folders/{folderId}` updates [official only].
- `POST /opportunities` — required: `opportunityTitle`, `companyId`, `stageId` (string, from `/opportunities/lists/stages`), `ownerUserIds[]`; optional `contactId`, `workTypeId`, `value`, `estimatedClose`, `additionalInformation`. `PUT /opportunities/{opportunityId}` updates [official only].
- Interviews per application: `POST /applications/{id}/interviews/internal` (required: `location`, `interviewersUserIds[]`) or `.../interviews/external` (contact interviewers). `startAt`/`endAt` minutes must be **0, 15, 30, or 45** [official only].

## Attachments — treat as unsupported for now

Uploads are **multipart/form-data** (`fileData`), e.g. `POST /candidates/{candidateId}/attachments/{attach}` with `attach` ∈ `Resume`,`FormattedResume`,`CoverLetter`,`Screening`,`Check`,`Reference`,`License`,`Other`. The connector `request` path sends JSON bodies — multipart through it is [UNVERIFIED]; don't promise file uploads until validated. Reading attachment **metadata** (`GET /{entity}/{id}/attachments`) is fine.

## What You CANNOT Mutate

| Wish                                                         | Reality                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Create a placement                                           | UI-only; update existing ones                                                                               |
| Delete a job/candidate/company/contact/application/placement | No DELETE; change status                                                                                    |
| Create/modify users                                          | `/users` read-only                                                                                          |
| Create submissions/floats                                    | read-only collections                                                                                       |
| Modify timesheets                                            | `GET /placements/{id}/timesheets` read-only                                                                 |
| Candidate privacy erasure                                    | `DELETE /candidates/{id}/privacy` exists but is destructive — never call without explicit user confirmation |

## End-to-End Example: source → apply → advance

"Add Jane to the Platform Engineer role and move her to Interview":

```
1. GET /candidates?email=jane.smith@acme.co.nz          → totalCount 0
2. POST /candidates {firstName,lastName,email,mobile}   → 201, candidateId 8855221
3. GET /jobs?jobTitle=Platform%20Engineer&active=true   → jobId 1234
4. POST /jobs/1234/applications {"candidateId":[8855221]} → 201, applicationId 9988776655
5. GET /applications/lists/status                       → "Interview" = statusId 42
6. PUT /applications/9988776655/status {"statusId":42}  → 200
7. GET /applications/9988776655                         → status.name == "Interview"
   POST /notes {"type":"General","text":"…","applicationId":[9988776655]}
```

Confirm with the user between steps 2, 4 and 6 — each is an irreversible-ish write.

## Post-Write Verification

PUT endpoints return empty 200 bodies; POSTs return the created representation. After any empty-bodied success, GET the record and confirm the changed fields before reporting completion — also your defence against the [UNVERIFIED] full-replace semantics. There is **no idempotency-key mechanism** documented — your only retry safety on writes is search-before-recreate.
