---
api_name: JobAdder
api_slug: jobadder
base_url: https://api.jobadder.com/v2
path_version_segment: /v2 is a REAL path segment, already in base_url — do NOT add another /v2 (so `https://api.jobadder.com/v2/candidates`, never `.../v2/v2/...`)
urls: ABSOLUTE REQUIRED — every example below is a full `https://api.jobadder.com/v2/...` URL; relative paths (`/candidates`) fail with "No base URL is configured for connector 'jobadder'"
call_surface: HTTP via `numa integrations request jobadder <METHOD> <absolute-url>` (auth injected by Numa)
field_casing: camelCase
companions: 01=api-rules, 01a=domain-model, 01c=mutations, 01d=events+errors
confidence: docs-derived from official OpenAPI spec (2026-06-10); NOT live-validated. Inline tags only when non-default: [official only]=official spec not the mirror; [SPEC-community]=community mirror only; [UNVERIFIED]=inference. Examples use absolute URLs; Numa injects auth.
---

# JobAdder — Query Patterns

All reads go through the workspace agent's connector request command. **The URL is always absolute** — full `https://api.jobadder.com/v2/...`, including the `/v2` (it's a real path segment, already in the base; never double it). Numa injects + refreshes the OAuth Bearer token; never set an Authorization header.

Call form (memorise this — every recipe below is just method + absolute URL fed to it):

```
numa integrations request jobadder GET "https://api.jobadder.com/v2/candidates?email=jane.smith@acme.co.nz" -m "find candidate by email"
```

## Pagination (offset/limit)

- `limit` — page size. Default 100, max 1000. `limit=0` returns ONLY `totalCount` (no items).
- `offset` — index of first entry. Default 0.
- Envelope: `{"items":[...],"totalCount":<int>,"links":{"first","prev","next","last"}}`. `links.*` are ready URLs for the same query at other offsets.

```
GET https://api.jobadder.com/v2/candidates?limit=100&offset=0      # then offset=100, 200, …
GET https://api.jobadder.com/v2/candidates?limit=100&offset=100
```

Loop rules:

1. Page until `offset >= totalCount` or `items` empty.
2. `totalCount` is authoritative — report exact counts (unlike cursor APIs).
3. Offset paging can skip/duplicate if data changes mid-scan; for full exports sort by a stable field (`createdAt`) [UNVERIFIED but standard].
4. Cheap count: `GET https://api.jobadder.com/v2/jobs?active=true&limit=0` → read `totalCount` only.

## Date Filtering — prefix operators

Date params (`createdAt`,`updatedAt`,`closedAt`,`approvedAt`,`partnerAction.submittedAt`) take ISO 8601 date-times, UTC assumed, with prefix operators:

- `createdAt=2026-06-01T00:00:00Z` — exact instant
- `createdAt=>2026-06-01` — on/after (inclusive)
- `createdAt=<2026-06-01` — on/before (inclusive)
- **Range = pass the param twice**: `?updatedAt=>2026-05-01&updatedAt=<2026-06-01`

URL-encode operators (`%3E`=`>`, `%3C`=`<`) — encode anything ambiguous [UNVERIFIED whether raw `>` survives]:
`GET https://api.jobadder.com/v2/jobs?updatedAt=%3E2026-06-01&sort=-updatedAt&limit=100`

## Sorting

`sort` takes one or more field names; **prefix `-` for descending**:

- Jobs sortable by: `jobTitle`, `status.name`, `createdAt`, `updatedAt`, `closedAt`.
- Other entities expose similar audit-field sorting; if a sort field 400s, drop it and sort client-side [UNVERIFIED for non-job entities].
- "Most recent X" default: `sort=-updatedAt`.

## `fields` and `embed` — opt-in payload extras

- `fields=` adds heavyweight fields excluded from lists. Jobs: `recruiters`, `statistics`, `partnerActions`. Other entities accept their own sets.
- `embed=` inlines related resources. Jobs: `notes`, `applications` (list) / `applications`, `notes` (single GET). Saves N+1 calls but inflates responses — use only when needed.
- `GET https://api.jobadder.com/v2/jobs/1234?embed=applications`

## Repeated (array) parameters

Id and enum filters take multiple values by **repeating the param** [collectionFormat multi]:
`https://api.jobadder.com/v2/jobs?statusId=10&statusId=11&statusId=12` · `https://api.jobadder.com/v2/applications?jobId=1234&jobId=5678`
(Some enum filters like `partnerAction.stage` are documented CSV — when in doubt, repeat; mixed behaviour [UNVERIFIED].)

## Entity Search Parameters (core set)

Paths below are relative to the base for brevity — when you call them, prefix `https://api.jobadder.com/v2`.

### Jobs — `GET /jobs`

| Param                                        | Type         | Notes                                |
| -------------------------------------------- | ------------ | ------------------------------------ |
| `jobId`                                      | int, multi   | fetch specific jobs in one call      |
| `jobTitle`                                   | string       | title match (fuzziness [UNVERIFIED]) |
| `companyId`/`company.companyId`              | int, multi   | jobs for client companies            |
| `company.name`                               | string       | by company name                      |
| `contactId`                                  | int, multi   |                                      |
| `statusId`                                   | int, multi   | from `/jobs/lists/status`            |
| `active`                                     | bool         | open jobs — everyday filter          |
| `userFavourite`                              | bool         | current user's favourites            |
| `folderId`                                   | int64, multi | jobs in folders [official only]      |
| `userId`/`ownerUserId`/`recruiterUserId`     | int, multi   | by owner or recruiter                |
| `createdAt`/`updatedAt`/`closedAt`(+`...By`) | date/int     | prefix operators                     |
| `sort`,`fields`,`embed`,`offset`,`limit`     | —            |                                      |

### Candidates — `GET /candidates`

| Param                                                                | Notes                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| `candidateId` (multi)                                                | batch fetch                                      |
| `name`                                                               | name search                                      |
| `email`                                                              | **the dedupe lookup** — use before any create    |
| `phone`                                                              | phone search                                     |
| `keywords`                                                           | full-text (resume/profile coverage [UNVERIFIED]) |
| `statusId`(multi), `recruiterUserId`(multi), `folderId`              |                                                  |
| `createdAt`/`updatedAt`                                              | prefix operators                                 |
| `sort`, `fields`(`skills,notes,...` [UNVERIFIED]), `offset`, `limit` |                                                  |

### Applications — `GET /applications`

| Param                                                                       | Notes                                         |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| `applicationId`/`candidateId`/`jobId` (all multi)                           | the join filters                              |
| `statusId` (multi)                                                          | from `/applications/lists/status`             |
| `active`                                                                    | in-progress applications                      |
| `rejected`                                                                  | rejected ones                                 |
| `jobTitle`, `keywords`                                                      | text search                                   |
| `review.stage`                                                              | `Submitted`\|`Viewed`\|`Accepted`\|`Rejected` |
| `review.userId`/`review.contactId`/`review.submittedAt`/`review.reviewedAt` | review-loop filters                           |
| `createdAt`/`updatedAt`(+`updatedBy`)                                       | prefix operators                              |

Scoped alternatives: `GET /jobs/{jobId}/applications`(+`/active`), `GET /candidates/{candidateId}/applications`(+`/active`).

### Placements — `GET /placements`

Filters: `placementId`, `type`(`Permanent|Contract|Temporary|Credit`), `statusId`, `candidateId`/`candidate.name`, `companyId`/`company.name`, `jobId`, `applicationId`, `userId`/`ownerUserId`/`recruiterUserId`, `approved`(bool)+`approvedBy`/`approvedAt`, `export`(`Payroll|Timesheets|Onboarding`), `timesheet.period`, dates, `fields`, paging.
Scoped: `/jobs/{id}/placements(/approved)`, `/candidates/{id}/placements(/approved)`, `/companies/{id}/placements(/approved)`.

### Companies — `GET /companies`

`name`, `companyId`/`parentId`/`subsidiaryId` (multi), `statusId`, audit dates, `fields`, paging.

### Contacts — `GET /contacts`

`contactId`(multi), `name`, `email`, `phone`, `companyId`(multi), `hiringManager`(bool), `statusId`, audit dates, `fields`, paging.

### Notes — `GET /notes`

`noteId`, `type`, `reference`, `createdAt`/`updatedAt`, plus one param per linked entity: `candidateId`, `companyId`, `contactId`, `jobId`, `requisitionId`, `applicationId`, `placementId`, `submissionId` (all multi). Scoped: `GET /{entity}/{id}/notes`.

### Users — `GET /users`

`userId`/`officeId`/`groupId` (multi), `include=Inactive,Deleted`. `GET /users/current` = connected user — good first call.

### Job Ads / Submissions / Floats

- `GET /jobads` — mostly partner-action filters + paging; `GET /jobads/{adId}` for detail. Ad `state` = draft/posted/expired lifecycle.
- `GET /submissions?candidateId=&companyId=&jobId=&createdAt=&updatedAt=` — read-only.
- `GET /floats`, `GET /floats/{floatId}` — read-only.

## Lookup-List Queries (cache per session; small lists; match by `name` case-insensitively)

Prefix each with `https://api.jobadder.com/v2`:

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

Status entries carry `active`/`default`/`rejected` flags — `/applications/lists/status` items include `rejected:true` for terminal-rejection statuses (how you distinguish "closed lost" stages).

## Common Recipes

Each line is `numa integrations request jobadder GET <absolute-url>`:

1. **Connection sanity check**: `GET https://api.jobadder.com/v2/users/current`
2. **Status name → id** (cache per session): `GET https://api.jobadder.com/v2/applications/lists/status` → `{"items":[{"statusId":42,"name":"Interview","active":true},...]}`. Match case-insensitively on `name`; if no match, show the user the available names.
3. **Candidate by email (pre-create dedupe)**: `GET https://api.jobadder.com/v2/candidates?email=jane.smith@acme.co.nz` → `totalCount>0` → use the existing `candidateId`; never create a duplicate.
4. **Open jobs for a client company**: `GET https://api.jobadder.com/v2/companies?name=Acme` → companyId 456; then `GET https://api.jobadder.com/v2/companies/456/jobs/active` (or `GET https://api.jobadder.com/v2/jobs?companyId=456&active=true`).
5. **Pipeline for a job (who's applied, by stage)**: `GET https://api.jobadder.com/v2/jobs/1234/applications?limit=500`; group `items` by `status.name` client-side; `status.workflow.stageIndex` gives funnel order.
6. **What changed this week** (polling — see 01d): `GET https://api.jobadder.com/v2/applications?updatedAt=%3E2026-06-03T00:00:00Z&sort=-updatedAt&limit=100`
7. **Placements awaiting approval**: `GET https://api.jobadder.com/v2/placements?approved=false&sort=-createdAt&limit=100`
8. **Full-text candidate search**: `GET https://api.jobadder.com/v2/candidates?keywords=python%20aws&limit=50`. Keyword semantics (AND/OR, resume coverage) [UNVERIFIED] — present as "matches", not exhaustive truth.
9. **Batch-fetch known ids in one call**: `GET https://api.jobadder.com/v2/candidates?candidateId=101&candidateId=102&candidateId=103`. Works on every collection (`jobId=`, `applicationId=`, `companyId=`…) — far cheaper than N single GETs.
10. **Candidate's attachments (metadata only — no upload from chat)**: `GET https://api.jobadder.com/v2/candidates/8855221/attachments` → `items:[{attachmentId,type:"Resume",fileName,fileType,expiry,createdAt}]`. Downloading content (`GET https://api.jobadder.com/v2/candidates/8855221/attachments/{attachmentId}`) returns binary — pass-through via the connector [UNVERIFIED]; report metadata, don't promise file contents.
11. **Upcoming interviews for a user or application**: `GET https://api.jobadder.com/v2/users/1001/interviews` · `GET https://api.jobadder.com/v2/applications/9988776655/interviews` [official spec; query params unmined, start with no filters].

## Read Discipline

1. **Resolve lookups first** (status, category, worktype ids) — they differ per account.
2. **Cache for the session**: `/users/current`, status lists, category/worktype lists.
3. **Batch by repeating id params** instead of N single GETs.
4. **Use scoped sub-resource paths** (`/jobs/{id}/applications`) when you hold the parent id.
5. **Don't over-fetch**: skip `fields=`/`embed=` unless the answer needs them.
6. Large payloads: the API supports an `x-streaming-response` header (release 2026-05-12) — irrelevant through the connector; keep `limit` sensible.
