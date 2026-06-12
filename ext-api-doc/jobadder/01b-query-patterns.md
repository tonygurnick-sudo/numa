---
api_name: 'JobAdder'
api_slug: 'jobadder'
generated_from: 'Official OpenAPI spec (api.jobadder.com/v2/openapi.json, fetched live 2026-06-10) + community spec mirror'
generated_date: '2026-06-10'
source_phases: ['Query & Read Patterns']
---

# JobAdder -- Query Patterns

> ⚠️ Docs-derived — NOT yet live-validated through the Numa connector path.
> [DOCS] = official OpenAPI spec / docs (2026-06-10); [SPEC-community] = community mirror only;
> [UNVERIFIED] = inference. All examples use the Numa `connectors` request tool — auth is injected,
> URLs are relative to `https://api.jobadder.com/v2`.

## Pagination (offset/limit)

Every collection endpoint pages the same way [DOCS]:

- `limit` — page size. **Default 100, max 1000.** `limit=0` returns ONLY `totalCount` (no items).
- `offset` — index of the first entry. Default 0.
- Response envelope: `{"items": [...], "totalCount": <int>, "links": {"first", "prev", "next", "last"}}`.
  `links.*` are ready-made URLs for the same query at other offsets.

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates?limit=100&offset=0"})
# next page:
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates?limit=100&offset=100"})
```

Loop rules:

1. Page until `offset >= totalCount` or `items` comes back empty.
2. `totalCount` is authoritative — you can report exact counts (unlike cursor APIs).
3. Offset paging can skip/duplicate records if data changes mid-scan — for full exports, sort by a
   stable field (`createdAt`) [UNVERIFIED but standard offset-paging behaviour].
4. Cheap count: `GET /jobs?active=true&limit=0` → read `totalCount` only [DOCS].

## Date Filtering — prefix operators

Date params (`createdAt`, `updatedAt`, `closedAt`, `approvedAt`, `partnerAction.submittedAt`)
take ISO 8601 date-times, **UTC assumed**, with prefix operators [DOCS — param descriptions]:

- `createdAt=2026-06-01T00:00:00Z` — exact instant
- `createdAt=>2026-06-01` — on/after (inclusive)
- `createdAt=<2026-06-01` — on/before (inclusive)
- **Range = pass the parameter twice**: `?updatedAt=>2026-05-01&updatedAt=<2026-06-01`

URL-encode the operators when building strings manually (`%3E` = `>`, `%3C` = `<`) — the connector
passes your `url` through, so encode anything ambiguous [UNVERIFIED whether raw `>` survives].

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/jobs?updatedAt=%3E2026-06-01&sort=-updatedAt&limit=100"})
```

## Sorting

`sort` takes one or more field names; **prefix `-` for descending** [DOCS]:

- Jobs sortable by: `jobTitle`, `status.name`, `createdAt`, `updatedAt`, `closedAt` [DOCS]
- Other entities expose similar audit-field sorting; exact lists per endpoint are in the spec —
  if a sort field 400s, drop it and sort client-side [UNVERIFIED for non-job entities]
- "Most recent X" default: `sort=-updatedAt`

## `fields` and `embed` — opt-in payload extras

- `fields=` adds heavyweight fields excluded from list payloads. Jobs: `recruiters`, `statistics`,
  `partnerActions` [DOCS]. Other entities accept their own sets — same pattern.
- `embed=` inlines related resources. Jobs: `notes`, `applications` (list) / `applications`, `notes`
  (single GET) [DOCS]. Saves N+1 follow-up calls but inflates responses — use only when you need it.

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/jobs/1234?embed=applications"})
```

## Repeated (array) parameters

Id and enum filters accept multiple values by **repeating the parameter** [DOCS — collectionFormat multi]:

```
/jobs?statusId=10&statusId=11&statusId=12
/applications?jobId=1234&jobId=5678
```

(Some enum filters like `partnerAction.stage` are documented CSV — when in doubt, repeat the param;
mixed behaviour is [UNVERIFIED].)

## Entity Search Parameters (core set)

### Jobs — `GET /jobs` [DOCS]

| Param        | Type      | Notes                                       |
| ------------ | --------- | -------------------------------------------- |
| `jobId`      | int, multi| Fetch specific jobs in one call              |
| `jobTitle`   | string    | Title match (fuzziness [UNVERIFIED])         |
| `companyId` / `company.companyId` | int, multi | Jobs for client companies |
| `company.name` | string  | By company name                              |
| `contactId`  | int, multi|                                              |
| `statusId`   | int, multi| From `/jobs/lists/status`                    |
| `active`     | bool      | Open jobs — the everyday filter              |
| `userFavourite` | bool   | Current user's favourites                    |
| `folderId`   | int64, multi | Jobs in folders [DOCS — official only]    |
| `userId` / `ownerUserId` / `recruiterUserId` | int, multi | By owner or recruiter |
| `createdAt` / `updatedAt` / `closedAt` (+`...By`) | date / int | Prefix operators above |
| `sort`, `fields`, `embed`, `offset`, `limit` | — |                            |

### Candidates — `GET /candidates` [DOCS]

| Param       | Notes                                                        |
| ----------- | ------------------------------------------------------------- |
| `candidateId` (multi) | Batch fetch                                         |
| `name`      | Name search                                                   |
| `email`     | **The dedupe lookup** — use before any create                 |
| `phone`     | Phone search                                                  |
| `keywords`  | Full-text search (resume/profile coverage [UNVERIFIED])       |
| `statusId` (multi), `recruiterUserId` (multi), `folderId`     |          |
| `createdAt` / `updatedAt` | Prefix operators                                |
| `sort`, `fields` (`skills,notes,...` [UNVERIFIED]), `offset`, `limit` |  |

### Applications — `GET /applications` [DOCS]

| Param       | Notes                                                         |
| ----------- | -------------------------------------------------------------- |
| `applicationId` / `candidateId` / `jobId` (all multi) | The join filters |
| `statusId` (multi) | From `/applications/lists/status`                       |
| `active`    | In-progress applications                                       |
| `rejected`  | Rejected ones                                                  |
| `jobTitle`, `keywords` | Text search                                         |
| `review.stage` | `Submitted` \| `Viewed` \| `Accepted` \| `Rejected`          |
| `review.userId` / `review.contactId` / `review.submittedAt` / `review.reviewedAt` | Review-loop filters |
| `createdAt` / `updatedAt` (+`updatedBy`) | Prefix operators                 |

Scoped alternatives: `GET /jobs/{jobId}/applications` (+`/active`),
`GET /candidates/{candidateId}/applications` (+`/active`) [DOCS].

### Placements — `GET /placements` [DOCS]

Filters: `placementId`, `type` (`Permanent|Contract|Temporary|Credit`), `statusId`,
`candidateId`/`candidate.name`, `companyId`/`company.name`, `jobId`, `applicationId`,
`userId`/`ownerUserId`/`recruiterUserId`, `approved` (bool) + `approvedBy`/`approvedAt`,
`export` (`Payroll|Timesheets|Onboarding`), `timesheet.period`, dates, `fields`, paging.

Scoped: `/jobs/{id}/placements(/approved)`, `/candidates/{id}/placements(/approved)`,
`/companies/{id}/placements(/approved)` [DOCS].

### Companies — `GET /companies` [DOCS]

`name`, `companyId`/`parentId`/`subsidiaryId` (multi), `statusId`, audit dates, `fields`, paging.

### Contacts — `GET /contacts` [DOCS]

`contactId` (multi), `name`, `email`, `phone`, `companyId` (multi), `hiringManager` (bool),
`statusId`, audit dates, `fields`, paging.

### Notes — `GET /notes` [DOCS]

`noteId`, `type`, `reference`, `createdAt`/`updatedAt`, plus one param per linked entity:
`candidateId`, `companyId`, `contactId`, `jobId`, `requisitionId`, `applicationId`, `placementId`,
`submissionId` (all multi). Scoped: `GET /{entity}/{id}/notes`.

### Users — `GET /users` [DOCS]

`userId`/`officeId`/`groupId` (multi), `include=Inactive,Deleted`. `GET /users/current` = the
connected user — good first call to sanity-check a connection.

### Job Ads / Submissions / Floats [DOCS]

- `GET /jobads` — mostly partner-action filters + paging; `GET /jobads/{adId}` for detail.
  Ad `state` indicates draft/posted/expired lifecycle.
- `GET /submissions?candidateId=&companyId=&jobId=&createdAt=&updatedAt=` — read-only.
- `GET /floats`, `GET /floats/{floatId}` — read-only.

## Lookup-List Queries (cache these per session)

All return small unpaged-ish lists — fetch once, match by `name` case-insensitively [DOCS]:

```
/jobs/lists/status            /candidates/lists/status        /applications/lists/status
/placements/lists/status      /companies/lists/status         /contacts/lists/status
/applications/lists/workflow  /categories                     /worktypes
/locations                    /countries                      /opportunities/lists/stages
/{entity}/lists/notetype      /{entity}/lists/source          /candidates/lists/rating
/candidates/lists/salutation  /{entity}/lists/attachmentcategory
/placements/lists/{awards|billingterms|industrycodes|paymenttypes}
/{entity}/fields/custom       (custom field definitions incl. allowed values)
```

Status entries carry `active`/`default`/`rejected` flags — e.g. `/applications/lists/status` items
include `rejected: true` for terminal-rejection statuses, which is how you distinguish "closed lost"
stages [DOCS].

## Common Recipes

### 1. Connection sanity check (start of session)

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/users/current"})
```

### 2. Resolve a status name → id (cache per session)

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/applications/lists/status"})
# → {"items": [{"statusId": 42, "name": "Interview", "active": true, ...}, ...]}
```

Match case-insensitively on `name`; if no match, show the user the available names [DOCS shape].

### 3. Find a candidate by email (pre-create dedupe)

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates?email=jane.smith@acme.co.nz"})
```

`totalCount > 0` → use the existing `candidateId`; never create a duplicate.

### 4. Open jobs for a client company

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/companies?name=Acme"})                       # → companyId 456
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/companies/456/jobs/active"})                 # or /jobs?companyId=456&active=true
```

### 5. Pipeline for a job (who's applied, by stage)

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/jobs/1234/applications?limit=500"})
```

Group `items` by `status.name` client-side; `status.workflow.stageIndex` gives funnel order [DOCS].

### 6. What changed this week (polling pattern — see 01d)

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/applications?updatedAt=%3E2026-06-03T00:00:00Z&sort=-updatedAt&limit=100"})
```

### 7. Placements awaiting approval

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/placements?approved=false&sort=-createdAt&limit=100"})
```

### 8. Full-text candidate search

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates?keywords=python%20aws&limit=50"})
```

Keyword semantics (AND/OR, resume coverage) are [UNVERIFIED] — present results as "matches", not
exhaustive truth.

### 9. Batch-fetch known ids in one call

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates?candidateId=101&candidateId=102&candidateId=103"})
```

Works on every collection (`jobId=`, `applicationId=`, `companyId=`, ...) — far cheaper than N
single GETs [DOCS].

### 10. Candidate's attachments (metadata only — no upload from chat)

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates/8855221/attachments"})
# → items: [{attachmentId, type: "Resume", fileName, fileType, expiry, createdAt, ...}]
```

Downloading file content (`GET .../attachments/{attachmentId}`) returns binary — pass-through
behaviour via the connector is [UNVERIFIED]; report metadata, don't promise file contents.

### 11. Upcoming interviews for a user or application

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/users/1001/interviews"})
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/applications/9988776655/interviews"})
```

[DOCS — official spec; query params unmined, start with no filters]

## Read Discipline

1. **Resolve lookups first** (status, category, worktype ids) — they differ per account [DOCS].
2. **Cache for the session**: `/users/current`, status lists, category/worktype lists.
3. **Batch by repeating id params** (`?candidateId=1&candidateId=2`) instead of N single GETs [DOCS].
4. **Use scoped sub-resource paths** (`/jobs/{id}/applications`) when you already hold the parent id —
   simpler than collection filters.
5. **Don't over-fetch**: skip `fields=`/`embed=` unless the answer needs them.
6. Large payloads: the API supports an `x-streaming-response` header for direct JSON streaming
   (release note 2026-05-12) — irrelevant through the connector; just keep `limit` sensible [DOCS].

---

_Companion files: 01-llm-api-rules.md (core rules) · 01a (domain model) · 01c (mutations) · 01d (events/errors)._
