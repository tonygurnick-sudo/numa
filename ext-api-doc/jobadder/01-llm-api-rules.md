---
api_name: JobAdder
api_slug: jobadder
base_url: https://api.jobadder.com/v2
path_version_segment: /v2 is a REAL path segment, already in base_url — do NOT add another /v2 (so `https://api.jobadder.com/v2/jobs`, never `.../v2/v2/...`)
urls: ABSOLUTE REQUIRED — pass full `https://api.jobadder.com/v2/...`; the connector does NOT persist a base_url for relative expansion, so a relative `/jobs` fails with "No base URL is configured for connector 'jobadder'"
call_surface: HTTP via `numa integrations request` (connector=jobadder). NOT a file-store connector; NOT MCP.
auth: OAuth2 Bearer — injected + refreshed by Numa; agent NEVER sets Authorization and never sees the token
field_casing: camelCase (`jobTitle`, `statusId`, `createdAt`)
id_format: int (`jobId`,`candidateId`,`companyId`,`contactId`,`placementId`,`userId` int32; `applicationId` int64); uuid (`noteId`,`addressId`,`webhookId`,partner `actionId`)
rate_limit: undocumented (no numbers, no Retry-After confirmed) — treat 429 as authoritative, back off
companions: 01a=domain-model, 01b=query-patterns, 01c=mutation-patterns, 01d=events+errors
confidence: docs-derived from official OpenAPI spec + OAuth2/Webhooks docs (2026-06-10); NOT live-validated through the connector. Tags inline only when non-default: [SPEC-community]=community mirror only (github.com/vitaliymashkov/jobadder-api); [UNVERIFIED]=inference. Trust real responses over this file; never claim live-confirmed behaviour.
---

# JobAdder — API Rules

## Call mechanics (read first)

- Surface: `numa integrations request` with `connector="jobadder"`, full `url`, `method`. POST/PUT pass JSON `body` (single object). `Content-Type: application/json`.
- URLs are ABSOLUTE: `https://api.jobadder.com/v2/jobs?active=true&limit=100`. Relative paths fail (no base_url persisted).
- `/v2` is a real path segment (in the base). No version header.
- Auth: Numa injects + auto-refreshes the 60-min Bearer token. NEVER add an Authorization header; you never see the token.
- 401 = refresh failed / grant revoked → tell user to reconnect JobAdder via Integrations/Files Remote (OAuth redirect, NOT a chat credential card); do not retry.
- 403 = grant lacks the scope (e.g. `write`, `write_placement`) → name the op + likely scope (01a); user/admin re-consents with broader scopes; do not retry.

## CAN

Read + search: jobs, candidates, applications, placements, companies, contacts, notes, users, job ads, requisitions, interviews, folders, opportunities, submissions, floats. Create + update: jobs, candidates, companies, contacts, job ads (drafts), opportunities, folders, notes. Workflow: add candidates to a job (creates applications), set status via dedicated `PUT .../status` on application/candidate/job/placement/company/contact. Update placements (`PUT /placements/{id}`). Filter every list by ids/status/dates/owner/recruiter; sort with `-` prefix; page with `offset`/`limit`. `limit=0` → only `totalCount` (cheap count). Read config lookups: `/{entity}/lists/status`, `/categories`, `/worktypes`, `/locations`, `/{entity}/fields/custom`.

## CANNOT

Create placements (no `POST /placements`; UI-only — read/update only). DELETE core entities (jobs/candidates/companies/contacts/applications/placements — deactivate via status; DELETE exists ONLY for requisitions, webhooks, photos/logos, company addresses, candidate skills/privacy, user tasks). Exceed `limit=1000` (default 100). Call outside granted scopes (→403). Know numeric rate limits (429 is the only signal). Multipart attachment upload via the connector's JSON body — treat as unsupported until validated [UNVERIFIED].

## Critical Gotchas

1. **"Jobs" = Job Orders** (`/jobs`, `jobId`, `jobTitle`). A **Job Ad** (`/jobads`, `adId`) is the board posting — different entity, different endpoints.
2. **Status values are per-account, keyed by `statusId`.** Never guess ids — `GET /{entity}/lists/status` first, match by name (case-insensitive).
3. **Applications are created through the job**: `POST /jobs/{jobId}/applications` body `{"candidateId":[123]}` (array). 409 = candidate already applied.
4. **Candidate create dedupes by email** → 409 `Candidate with this email already exists`. Search by email first. `X-Allow-Duplicates` header can force-create — avoid.
5. **Date filters are prefix-operator strings**: `createdAt=>2026-01-01` (inclusive on/after), `<` for on/before; pass the param TWICE for a range. ISO 8601, UTC assumed. URL-encode operators (`%3E`=`>`, `%3C`=`<`).
6. **Reads return nested objects; writes take flat ids**: read `status:{statusId,name}` → write `statusId:123`. Same for `companyId`, `contactId`, `workTypeId`, `ownerUserId`. GET first, map to the 01c command shape.
7. **`PUT` may be full-replace** — all update-command fields are optional in the spec, but omitted-field behaviour (ignore vs clear) is [UNVERIFIED]. Send the complete intended state of any field group you touch.
8. **Error body**: `{"message":"...","errors":[{"code":"...","message":"...","fields":[]}]}` — quote `message` and `errors[].fields` verbatim.
9. Query param names appear camelCase in old docs, PascalCase in the current spec — use camelCase as in examples; case-insensitivity is [UNVERIFIED].
10. `street` in addresses is an **array** of strings: `"street":["1 Queen St"]`.

## Default Parameters (override only if the user specifies)

| Param    | Default                          | Reason                                          |
| -------- | -------------------------------- | ----------------------------------------------- |
| `limit`  | 100 (API default); max 1000      | `limit=0` → only `totalCount`                   |
| `offset` | 0; add prev `limit` per page     | offset paging; `totalCount` in every list       |
| `active` | `true` for job/application lists | users usually mean open [UNVERIFIED preference] |
| `sort`   | `-updatedAt` for "recent"        | `-` prefix = descending                         |
| Pacing   | ≤ ~2 calls/sec, sequential       | limits unknown — be conservative [UNVERIFIED]   |

## Operations (core set; full catalog 01a, query params 01b, write bodies 01c)

| Operation                 | Method   | Path                                 | Notes                                                      |
| ------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------- |
| Find jobs                 | GET      | /jobs                                | `active`,`companyId`,`statusId`,dates                      |
| Get / update job          | GET/PUT  | /jobs/{jobId}                        | Create: POST /jobs (`jobTitle` required)                   |
| Set job status            | PUT      | /jobs/{jobId}/status                 | `{statusId, note?}`                                        |
| Find candidates           | GET      | /candidates                          | `name`,`email`,`phone`,`keywords`                          |
| Get / update candidate    | GET/PUT  | /candidates/{candidateId}            | Create: POST /candidates (409 on dupe email)               |
| Add candidate(s) to job   | POST     | /jobs/{jobId}/applications           | body `{"candidateId":[..]}` → applications; 409 if applied |
| Find applications         | GET      | /applications                        | `jobId`,`candidateId`,`active`,`statusId`                  |
| Update application        | PUT      | /applications/{applicationId}        | `{statusId,rating,custom}`                                 |
| Set application status    | PUT      | /applications/{applicationId}/status | `{statusId}`; 202 = already set                            |
| Find placements           | GET      | /placements                          | read + PUT only — no create                                |
| Find companies / contacts | GET      | /companies, /contacts                | POST to create; PUT /{id} to update                        |
| Notes (read/add)          | GET/POST | /notes, /{entity}/{id}/notes         | AddNote `{type,text,"<entity>Id":[..]}`                    |
| Status lookups            | GET      | /{entity}/lists/status               | resolve `statusId` by name FIRST                           |
| Current user              | GET      | /users/current                       | whoami / connection sanity check                           |

## Pagination

Offset paging: `limit` (default 100, max 1000) + `offset` (default 0). Every list returns `{items, totalCount, links{first,prev,next,last}}` — `links.*` are ready URLs. Follow `links.next` or `offset += limit`; stop when `offset >= totalCount` or an empty page. `totalCount` is authoritative (exact counts). `limit=0` → count only.

## Errors

Body `ErrorModel {message, errors[{code,message,fields[]}]}` (details + recovery in 01d).
| Status | Meaning | Action |
| --- | --- | --- |
| 400 | Bad request | fix param syntax (date prefixes, array params); don't retry unchanged |
| 401 | Expired/revoked OAuth grant | user reconnects via OAuth flow — NOT a chat card; do not retry |
| 403 | Missing OAuth scope | name op + scope (01a); reconnect broader; do not retry |
| 404 | Wrong id or path | verify entity id + exact documented path |
| 409 | Duplicate (candidate email, existing application) | search for the existing record, use it |
| 422 | Validation error | fix fields named in `errors[].fields`; don't retry unchanged |
| 429 | Rate limited (thresholds undocumented) | back off 2s→10s→30s→stop; slow the session |
| 5xx | Server error | retry once after 5s; for writes, check first whether it landed |

`PUT .../status` returns **200 on change, 202 if already at that status** — both are success; don't re-fire.

## Examples

Call form (every example below is method + absolute URL fed to this; `--body` for POST/PUT):
`numa integrations request jobadder GET "https://api.jobadder.com/v2/jobs?active=true&limit=100" -m "list open jobs"`

1. Open jobs, newest first:
   `GET https://api.jobadder.com/v2/jobs?active=true&sort=-updatedAt&limit=100`
   → `{"items":[{"jobId":1234,"jobTitle":"...","company":{},"status":{}}],"totalCount":57,"links":{}}`

2. Find candidate by email, then their applications:
   `GET https://api.jobadder.com/v2/candidates?email=jane.smith@acme.co.nz`
   `GET https://api.jobadder.com/v2/candidates/8855221/applications`

3. Create a candidate (handle 409):
   `POST https://api.jobadder.com/v2/candidates`
   body `{"firstName":"Jane","lastName":"Smith","email":"jane.smith@acme.co.nz","mobile":"+64211234567"}`
   → 201 `CandidateRepresentation` with `candidateId`. 409 → exists: search by email, use the existing record.

4. Add candidate to a job, then move the application's status:
   `POST https://api.jobadder.com/v2/jobs/1234/applications` body `{"candidateId":[8855221]}`
   `GET https://api.jobadder.com/v2/applications/lists/status`
   `PUT https://api.jobadder.com/v2/applications/9988776655/status` body `{"statusId":42}`
   → 200 on change, 202 if already there (success).
