---
api_name: 'JobAdder'
api_slug: 'jobadder'
generated_from: 'Official OpenAPI spec (api.jobadder.com/v2/openapi.json, fetched live 2026-06-10) + community spec mirror'
generated_date: '2026-06-10'
source_phases: ['Mutation & Workflow Patterns']
---

# JobAdder -- Mutation Patterns

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> [DOCS] = official OpenAPI spec / docs (2026-06-10); [SPEC-community] = community mirror only;
> [UNVERIFIED] = inference. Write bodies below are the spec's command schemas — GET a real record
> first and mirror live field names if anything disagrees.

## Write Rules (read first)

1. **Reads return nested objects; writes take flat ids.** A job's response has
   `"status": {"statusId": 10, "name": "Open"}` — the update body takes `"statusId": 10`.
   Same for `companyId`, `contactId`, `workTypeId`, `ownerUserId` [DOCS].
2. **Resolve account-specific ids before writing**: `statusId` from `/{entity}/lists/status`,
   `categoryId` from `/categories`, `workTypeId` from `/worktypes`, custom `fieldId` from
   `/{entity}/fields/custom`. Never reuse ids across accounts [DOCS].
3. **PUT omitted-field behaviour is [UNVERIFIED]** (ignore vs clear). All update-command fields are
   optional in the spec; until validated, send every field you care about and avoid sending fields
   you don't intend to change with null values.
4. **No DELETE on core entities** — jobs, candidates, companies, contacts, applications, placements
   cannot be deleted via API. Offer a status change (e.g. an inactive/archived status) instead [DOCS].
5. **Confirm with the user before any write**, and echo back ids + key fields after success.
6. **Not idempotent**: POSTs create a new record each call (except candidate-by-email dedupe).
   On a 5xx/timeout after a POST, search before retrying [UNVERIFIED — assume worst case].
7. Dedicated status endpoints return **200 on change, 202 if already at that status** — both are
   success; don't re-fire [DOCS].

## Jobs (JobOrder)

### Create — `POST /jobs` → 201 `JobOrderRepresentation` [DOCS]

Only `jobTitle` is required. Useful fields (AddJobOrderCommand):

```
connectors(name="request", params={"connector": "jobadder", "method": "POST",
  "url": "/jobs",
  "body": {
    "jobTitle": "Senior Platform Engineer",
    "companyId": 456,
    "contactId": 789,
    "jobDescription": "…",
    "statusId": 10,
    "numberOfJobs": 1,
    "workTypeId": 3,
    "category": {"categoryId": 12, "subCategoryId": 121},
    "location": {"locationId": 7, "areaId": 71},
    "salary": {"ratePer": "Year", "rateLow": 140000, "rateHigh": 170000,
               "currency": "NZD", "timePerWeek": 40},
    "start": {"immediate": true},
    "ownerUserId": 1001,
    "recruiterUserId": [1001, 1002]
  }})
```

Also accepted: `workplaceAddressId` (uuid from `/companies/{id}/addresses`), `duration`
(`{period, unit}`), `source`, `skillTags`, `custom` (`[{fieldId, value}]`), `endDate`, `fee`,
`workShift`, `workflowId` [DOCS — last four official spec only].

### Update — `PUT /jobs/{jobId}` → 200 / 404 / 422 [DOCS]

Same shape as create (UpdateJobOrderCommand). 200 body is empty ("Job was successfully updated") —
GET the job afterwards if you need the new state [DOCS].

### Status — `PUT /jobs/{jobId}/status` [DOCS]

```
{"statusId": 11, "note": {"text": "Closed — filled internally"}}   # note optional
```

## Candidates

### Create — `POST /candidates` → 201, **409 on duplicate email** [DOCS]

```
connectors(name="request", params={"connector": "jobadder", "method": "POST",
  "url": "/candidates",
  "body": {
    "firstName": "Jane", "lastName": "Smith",
    "email": "jane.smith@acme.co.nz", "mobile": "+64211234567",
    "address": {"street": ["1 Queen St"], "city": "Auckland",
                "postalCode": "1010", "countryCode": "NZ"},
    "skillTags": ["python", "aws"],
    "seeking": "Yes",
    "statusId": 20,
    "source": "Referral"
  }})
```

- `street` is an **array** [DOCS].
- `seeking` enum: `Yes` | `Maybe` | `No` [DOCS].
- Extended fields: `salutation`, `rating`, `social`, `employment` (`{current, ideal, history[]}`),
  `availability`, `education[]`, `custom`, `recruiterUserId[]`, `summary`, `dateOfBirth`,
  `emergencyContact`/`emergencyPhone`, `unsubscribed` [DOCS — last five official spec only].
- **409 handling**: `GET /candidates?email=...` and reuse the existing record. The
  `X-Allow-Duplicates` request header can force creation [DOCS] — avoid it unless the user
  explicitly wants a duplicate.

### Update — `PUT /candidates/{candidateId}` [DOCS]

Same field set (UpdateCandidateCommand; no `source` on update). Empty 200 body — re-GET if needed.

### Status — `PUT /candidates/{candidateId}/status` [DOCS]

`{"statusId": 21, "note": {...}}` → 200 changed / 202 already set / 404 / 422.

## Applications — the workflow engine

### Add candidate(s) to a job — `POST /jobs/{jobId}/applications` [DOCS]

```
connectors(name="request", params={"connector": "jobadder", "method": "POST",
  "url": "/jobs/1234/applications",
  "body": {"candidateId": [8855221], "source": "LinkedIn"}})
```

- `candidateId` is an **array** — add several at once. Returns 201 with a
  `JobApplicationListRepresentation` (one application per candidate) [DOCS].
- **409 = candidate already has an application** on this job — GET
  `/jobs/1234/applications?candidateId=8855221` and work with the existing one [DOCS].
- Mirror endpoint exists: `POST /candidates/{candidateId}/applications` with `{"jobId": [..]}` [DOCS].

### Move through the funnel — `PUT /applications/{applicationId}/status` [DOCS]

```
# 1. resolve the stage id once per session
GET /applications/lists/status
# 2. set it
connectors(name="request", params={"connector": "jobadder", "method": "PUT",
  "url": "/applications/9988776655/status",
  "body": {"statusId": 42, "note": {"text": "Moved to interview after phone screen"}}})
```

200 = updated; **202 = already at that status** (success, don't retry); 404; 422 [DOCS].

### Update rating / custom fields — `PUT /applications/{applicationId}` [DOCS]

`{"statusId": 42, "rating": 4, "custom": [{"fieldId": 3, "value": "…"}]}` (all optional).

### Client review loop (submit to client) [DOCS]

- `POST /applications/{id}/review` `{"submittedByUserId": 1001}` → 202 — submits for review
- `PUT /applications/{id}/review/accept` `{"contactId": 789, "message": "…"}` → 202 (`contactId` required)
- `PUT /applications/{id}/review/reject` `{"contactId": 789, "reason": "…"}` → 202 (`contactId` required)

This is the client-side accept/reject axis — distinct from the status workflow. Use only when the
user is explicitly running client submissions [DOCS].

## Companies

### Create — `POST /companies` (only `name` required) [DOCS]

```
{"name": "Acme Ltd", "statusId": 1, "ownerUserId": 1001}
```

Extras: `legalName`, `social`, `summary` [DOCS — official only], `parentCompanyId`, `custom`,
`recruiterUserId[]`. `mainContactId` and `primaryAddressId` are **update-only** fields — create the
contact/address first, then `PUT /companies/{companyId}` to link them [DOCS].

### Addresses — `POST /companies/{companyId}/addresses` (`name` required) [DOCS]

```
{"name": "Head Office", "street": ["1 Queen St"], "city": "Auckland",
 "postalCode": "1010", "countryCode": "NZ", "phone": "+6493001234"}
```

→ 201 with uuid `addressId` (usable as a job's `workplaceAddressId`). Update/delete via
`PUT/DELETE /companies/{companyId}/addresses/{addressId}` [DOCS].

### Update / status [DOCS]

`PUT /companies/{companyId}` (UpdateCompanyCommand) · `PUT /companies/{companyId}/status`
`{"statusId": ...}`.

## Contacts

### Create — `POST /contacts` [DOCS]

```
{"firstName": "Sam", "lastName": "Buyer", "position": "Head of Engineering",
 "email": "sam@acme.co.nz", "companyId": 456, "statusId": 1}
```

Extras: `mobile`, `phone`, `salutation`, `social`, `reportsToContactId`, `custom`,
`ownerUserId`, `recruiterUserId[]`, `officeAddressId`, `otherEmail[]`, `summary`, `unsubscribed`
[DOCS — last four official spec only]. Update: `PUT /contacts/{contactId}`; status:
`PUT /contacts/{contactId}/status`.

## Placements — UPDATE ONLY

**There is no `POST /placements`** — placements are created in the JobAdder UI when an application
is placed [DOCS]. You can:

- `PUT /placements/{placementId}` (UpdatePlacementCommand): `jobTitle`, `contactId`, `summary`,
  `statusId`, `paymentType`, `startDate`/`endDate` (`yyyy-MM-dd`), `salary`
  (`{base, superannuation, benefits, total, fee}`), `contractRate` (`{ratePer, hoursPerWeek,
  daysPerWeek, clientRate, candidateRate, onCostsType, onCosts, netMargin}`), `award`,
  `industryCode`, `billing`, `feeSplit` (`Fixed|Percent`), `recruiters[]`, `custom[]` [DOCS]
- `PUT /placements/{placementId}/status` `{"statusId": ...}` [DOCS]

Resolve billing/payroll lookups from `/placements/lists/*` (awards, billingterms, industrycodes,
paymenttypes) before writing those fields [DOCS]. If asked to "create a placement", explain it must
be done in JobAdder and offer to update the application status instead.

## Notes

### Polymorphic create — `POST /notes` (`type` + `text` required) [DOCS]

```
connectors(name="request", params={"connector": "jobadder", "method": "POST",
  "url": "/notes",
  "body": {"type": "General", "text": "Call summary: …",
           "candidateId": [8855221], "jobId": [1234]}})
```

- Entity links are **arrays of ids** — one note can attach to several records at once [DOCS].
- `type` values are account-specific: `GET /{entity}/lists/notetype` [DOCS].
- Scoped alternative: `POST /jobs/{id}/notes`, `/candidates/{id}/notes`, etc. [DOCS].
- Update: `PUT /notes/{noteId}` `{"type", "text"}`. Text limit 65535 chars [DOCS — release notes].

## Requisitions — the one entity with a full lifecycle (and DELETE)

Internal job requests that precede a job order [DOCS]:

- `POST /requisitions` — required: `contactId` (the hiring manager) + `jobTitle`; body mirrors the
  job create shape (`category`, `location`, `salary`, `workTypeId`, `numberOfJobs`, `custom`,
  `workflowId`, `recruiterUserId[]`)
- `PUT /requisitions/{requisitionId}` — update
- `PUT /requisitions/{requisitionId}/submit` — submit for approval
- `PUT /requisitions/{requisitionId}/approve` / `.../reject` — approval decisions
- `GET /requisitions/{requisitionId}/history` — audit trail
- `DELETE /requisitions/{requisitionId}` — the only deletable core-ish entity

An approved requisition links to its created job via `jobOrderId` on the representation [DOCS].

## Job Ads, Folders, Opportunities, Interviews

- `POST /jobads` creates a **draft** ad (`title` + `ownerUserId` required; `jobId` links it to a
  job; `summary`, `bulletPoints[]`, `description` fill the content); `PUT /jobads/{adId}` updates.
  Posting to boards involves the job-board APIs — out of scope for chat; hand drafts back to the
  user [DOCS].
- `POST /folders` `{"folderName": "...", "ownerID": 1001}` (note the `ID` casing — copy exactly);
  `PATCH /folders/{folderId}` updates [DOCS — official only].
- `POST /opportunities` — required: `opportunityTitle`, `companyId`, `stageId` (string, from
  `/opportunities/lists/stages`), `ownerUserIds[]`; optional `contactId`, `workTypeId`, `value`,
  `estimatedClose`, `additionalInformation`. `PUT /opportunities/{opportunityId}` updates [DOCS — official only].
- Interviews are scheduled per application: `POST /applications/{id}/interviews/internal`
  (required: `location`, `interviewersUserIds[]`) or `.../interviews/external` (contact
  interviewers). `startAt`/`endAt` minutes must be **0, 15, 30 or 45** [DOCS — official only].

## Attachments — treat as unsupported for now

Uploads are **multipart/form-data** (`fileData`), e.g.
`POST /candidates/{candidateId}/attachments/{attach}` with `attach` ∈ `Resume`, `FormattedResume`,
`CoverLetter`, `Screening`, `Check`, `Reference`, `License`, `Other` [DOCS]. The Numa connector
`request` path sends JSON bodies — multipart through it is [UNVERIFIED]; don't promise file uploads
until validated. Reading attachment **metadata** (`GET /{entity}/{id}/attachments`) is fine [DOCS].

## What You CANNOT Mutate

| Wish                          | Reality                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| Create a placement            | UI-only; update existing ones [DOCS]                           |
| Delete a job/candidate/company/contact/application/placement | No DELETE; change status [DOCS] |
| Create/modify users           | `/users` read-only [DOCS]                                      |
| Create submissions/floats     | Read-only collections [DOCS]                                   |
| Modify timesheets             | `GET /placements/{id}/timesheets` read-only [DOCS]             |
| Candidate privacy erasure     | `DELETE /candidates/{id}/privacy` exists but is destructive — never call without explicit user confirmation [DOCS] |

## End-to-End Example: source → apply → advance

The canonical "add Jane to the Platform Engineer role and move her to Interview" flow:

```
# 1. Dedupe check
GET /candidates?email=jane.smith@acme.co.nz          → totalCount 0
# 2. Create the candidate
POST /candidates {firstName, lastName, email, mobile} → 201, candidateId 8855221
# 3. Find the job
GET /jobs?jobTitle=Platform%20Engineer&active=true    → jobId 1234
# 4. Create the application
POST /jobs/1234/applications {"candidateId": [8855221]} → 201, applicationId 9988776655
# 5. Resolve the target stage (once per session)
GET /applications/lists/status                        → "Interview" = statusId 42
# 6. Advance
PUT /applications/9988776655/status {"statusId": 42}  → 200
# 7. Verify + log a note
GET /applications/9988776655                          → status.name == "Interview"
POST /notes {"type": "General", "text": "…", "applicationId": [9988776655]}
```

Confirm with the user between steps 2, 4 and 6 — each is an irreversible-ish write [policy].

## Post-Write Verification

PUT endpoints return empty 200 bodies [DOCS]; POSTs return the created representation. After any
empty-bodied success, GET the record and confirm the changed fields before reporting completion —
this is also your defence against the [UNVERIFIED] full-replace semantics. There is **no
idempotency-key mechanism** documented anywhere in the API [DOCS — searched] — your only retry
safety on writes is search-before-recreate.

---

_Companion files: 01-llm-api-rules.md (core rules) · 01a (domain model) · 01b (queries) · 01d (events/errors)._
