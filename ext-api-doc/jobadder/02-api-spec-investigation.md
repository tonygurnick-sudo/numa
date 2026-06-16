---
api_name: JobAdder API v2
api_slug: jobadder
base_url: https://api.jobadder.com/v2
path_version_segment: /v2 is a REAL path segment (URL path-versioned); already in base_url; no version header
account_base_override: token response carries an account-specific `api` base URL — use it when it differs from the default (AU/US/EU shards exist)
urls: ABSOLUTE REQUIRED through the connector (`https://api.jobadder.com/v2/...`); OAuthWizard does not persist a base_url for relative expansion (see 03 §5)
call_surface: HTTP via `numa integrations request` (connector=jobadder); native data connector, authType oauth2 — NOT Pipedream, NOT a Files connector
auth: OAuth 2.0 Authorization Code ONLY (no PAT/API-key); 60-min access token; `offline_access` for refresh
spec_format: swagger-2.0 (community mirror only — no official machine-readable download found)
spec_url: https://raw.githubusercontent.com/vitaliymashkov/jobadder-api/master/jobadder-openapi-v2.json
docs_url: https://api.jobadder.com/v2/docs
date_researched: 2026-06-10
confidence: NO AUTHENTICATED CALL was made (no credentials; docs portal JS-rendered; Zendesk KB blocks scripted fetches). Auth + endpoint catalog are docs/mirror-derived. Error bodies, rate limits, webhook mechanics UNKNOWN (§Known Unknowns). Inline tags only when non-default: [SPEC-community]=community mirror only; [UNKNOWN]=not retrievable; [UNVERIFIED]=inference. The machine-readable spec is a third-party snapshot (its embedded auth guide matches the official article verbatim, but may lag the live API). Verify against a real OAuth grant before first customer use.
---

# JobAdder — API Specification & Investigation

Developer reference for JobAdder REST API v2; condensed from `00-api-investigation-questionnaire.md`. Sources: official OAuth2 article (`jobadderapi.zendesk.com`), API portal (`api.jobadder.com/v2/docs`), community OpenAPI mirror (`github.com/vitaliymashkov/jobadder-api`, 197 paths).

## Overview

- **Vendor/product:** JobAdder — recruitment ATS/CRM for agencies and in-house talent teams: jobs, candidates, applications, placements, companies, contacts, job ads, requisitions.
- **API style:** REST, JSON.
- **Base URL:** `https://api.jobadder.com/v2`. The OAuth token response includes an `api` field = the base URL for that account (documented example matches the default).
- **Versioning:** URL path (`/v2`); no version header [SPEC-community].
- **Auth:** OAuth 2.0 Authorization Code only — no PAT/API-key. Access tokens live **60 minutes**; refresh via `offline_access`.
- **Pagination:** `offset`/`limit` (max 1000; `limit=0` = count only) with `totalCount` and hypermedia `links.next` [SPEC-community].
- **Filtering:** per-field params; date filters take `>`/`<` prefixes (inclusive, repeat for a range); `sort` with `-` prefix; `fields` for opt-in extras [SPEC-community].
- **Rate limits:** numbers not retrievable — assume 429 on breach [UNKNOWN].
- **Webhooks:** exist per the official KB article, but detail is 403-walled and absent from the mirror → treat as polling-first.
- **SDKs:** none official.

**Summary:** Classic ATS REST API — 197 paths in 21 groups. Reads are rich (per-field filters, resume keyword search, date-window queries, `totalCount` everywhere); writes follow CRUD + dedicated-status-transition where **transitions return 202** and duplicate creates return **409**.

**Numa integration model:** native data connector (`authType: oauth2`, NOT Pipedream). The agent calls `numa integrations request` with `connector="jobadder"`, absolute `url`, method — e.g. `GET https://api.jobadder.com/v2/jobs?active=true&limit=100`. The backend fetches the user's OAuth token from the vault (`oauth-jobadder`), refreshes it automatically when within 5 min of expiry, and injects `Authorization: Bearer …`. The agent never sees tokens. **Use absolute URLs** — the OAuthWizard does not persist a vault `base_url` for relative-URL expansion (see 03 §5).

## Authentication — OAuth 2.0 Authorization Code (the only method)

| Property              | Value                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorize URL         | `https://id.jobadder.com/connect/authorize`                                                                                                                   |
| Token URL             | `https://id.jobadder.com/connect/token`                                                                                                                       |
| App registration      | JobAdder **Developer Centre** (`developers.jobadder.com`) → Client ID + Client Secret                                                                         |
| Auth code lifetime    | 5 minutes                                                                                                                                                     |
| Access token lifetime | **60 minutes** (`expires_in: 3600`)                                                                                                                           |
| Refresh tokens        | require `offline_access`; the documented refresh example returns a **new** `refresh_token` — treat rotation as the norm and re-persist every refresh response |
| Token type            | `Bearer`                                                                                                                                                      |

**Authorize parameters:** `response_type=code`, `client_id`, `scope` (space-separated), `redirect_uri` (must match a registered URL), `state` (optional CSRF). Denied consent → redirect with `error=access_denied`.

**Token response** (exact example):
`{"access_token":"31ff7431b4c1dde02e386122702f5460","expires_in":3600,"token_type":"Bearer","refresh_token":"e7672885d6da2db1e56d200dd292c801","api":"https://api.jobadder.com/v2"}`

> `api` = the base URL to use for API access for this account. Numa's generic OAuth callback does not capture it; the default host is used. If a tenant surfaces a non-default `api` value, store it as `api_endpoint` on the `oauth-client-jobadder` vault entry (the backend base-URL resolver reads that field).

**Scopes** (space-separated):

- **Broad:** `read` (all reads) · `write` (all writes) · `offline_access` (refresh tokens — must accompany other scopes). **The Numa registry requests `read write offline_access`.**
- **Granular (available, not used by Numa):** `read_job`/`write_job`, `read_candidate`/`write_candidate`, `read_company`/`write_company`, `read_contact`/`write_contact`, `read_placement`/`write_placement`, `read_jobapplication`/`write_jobapplication`, `read_requisition`/`write_requisition`, `read_jobad`/`write_jobad`, `read_user`, `read_usertask`, `read_usergroup`, `read_submission`, `read_float`, per-entity note scopes (`read_job_note`, `write_candidate_note`, …).
- **Partner:** `partner_jobboard` (job-board surface), `partner_ui_action` (partner buttons) — out of Numa scope.

**Failure semantics:**
| Status | Meaning |
| --- | --- |
| 401 | expired/revoked/invalid access token → refresh; if refresh fails, the grant is dead → user reconnects via OAuth redirect [standard OAuth2; UNVERIFIED] |
| 403 | token valid but the **grant lacks the scope** — fix app/grant scopes and re-consent; never a refresh [inferred from scope model; UNVERIFIED] |

## Endpoint Catalog

197 paths in 21 groups [SPEC-community]. Critical paths below are exact; the group index gives coverage breadth.

### Connection probe

| Method | Path             | Purpose                                       |
| ------ | ---------------- | --------------------------------------------- |
| GET    | `/users/current` | authenticated user's details — the smoke test |

### Jobs (job orders)

| Method   | Path                                                                                         | Purpose                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET      | `/jobs`                                                                                      | find jobs (filters: ids, title, company, status, active, owner/recruiter, created/updated/closed dates) |
| POST     | `/jobs`                                                                                      | add a job → 201                                                                                         |
| GET      | `/jobs/{jobId}`                                                                              | get a job                                                                                               |
| PUT      | `/jobs/{jobId}`                                                                              | update a job                                                                                            |
| PUT      | `/jobs/{jobId}/status`                                                                       | **set job status → 202 Accepted (async)**                                                               |
| GET      | `/jobs/{jobId}/applications`                                                                 | applications on a job (`/active` variant)                                                               |
| POST     | `/jobs/{jobId}/applications`                                                                 | add candidates to a job → 409 if already applied                                                        |
| GET      | `/jobs/{jobId}/placements`                                                                   | placements (`/approved` variant)                                                                        |
| GET/POST | `/jobs/{jobId}/notes`                                                                        | notes                                                                                                   |
| GET      | `/jobs/lists/status` · `/jobs/lists/source` · `/jobs/lists/notetype` · `/jobs/fields/custom` | account taxonomies                                                                                      |

### Candidates

| Method   | Path                                                                              | Purpose                                                                         |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET      | `/candidates`                                                                     | find (`name`, `email`, `phone`, **`keywords`**=resume full-text, status, dates) |
| POST     | `/candidates`                                                                     | add → **409 "Candidate with this email already exists"**                        |
| GET/PUT  | `/candidates/{candidateId}`                                                       | get / update (PUT also 409-guards email)                                        |
| PUT      | `/candidates/{candidateId}/status`                                                | status transition → 202                                                         |
| GET/POST | `/candidates/{candidateId}/applications`                                          | applications / add jobs to candidate (409 dupe guard)                           |
| GET      | `/candidates/{candidateId}/skills` · `/availability` · `/placements` · `/floats`  | profile sub-resources                                                           |
| GET/POST | `/candidates/{candidateId}/notes` · `/attachments/{attach}`                       | notes / files                                                                   |
| DELETE   | `/candidates/{candidateId}/privacy`                                               | **GDPR-style erasure — human confirmation mandatory**                           |
| GET      | `/candidates/lists/status` · `/lists/source` · `/lists/rating` · `/fields/custom` | taxonomies                                                                      |

### Applications (job applications)

| Method   | Path                                                            | Purpose                                                                     |
| -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GET      | `/applications`                                                 | find applications                                                           |
| GET/PUT  | `/applications/{applicationId}`                                 | get / update                                                                |
| PUT      | `/applications/{applicationId}/status`                          | stage transition → 202                                                      |
| PUT/POST | `/applications/{applicationId}/review` (+ `/accept`, `/reject`) | review cycle → 202                                                          |
| GET      | `/applications/lists/workflow`                                  | **the account's stage pipeline** — resolve before answering stage questions |
| GET      | `/applications/lists/status` · `/fields/custom`                 | taxonomies                                                                  |

### Placements · Companies · Contacts

| Method   | Path                                                                              | Purpose                                      |
| -------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| GET      | `/placements` · `/placements/{id}`                                                | find / get placements (fees, dates, billing) |
| PUT      | `/placements/{id}` · `/placements/{id}/status`                                    | update / transition (202)                    |
| GET/POST | `/companies` · `/companies/{id}` (+ `/addresses`, `/contacts`, `/jobs`, `/notes`) | company CRUD — **409 on duplicate name**     |
| GET/POST | `/contacts` · `/contacts/{id}` (+ `/notes`, `/attachments`)                       | contact CRUD                                 |
| PUT      | `/companies/{id}/status` · `/contacts/{id}/status`                                | transitions (202)                            |

### Other groups [SPEC-community]

| Group                                          | Paths | Notes                                                         |
| ---------------------------------------------- | ----- | ------------------------------------------------------------- |
| requisitions                                   | 10    | CRUD + submit/approve/reject (202) + history                  |
| jobads                                         | 2     | find; get/update draft ads                                    |
| jobboards                                      | 6     | partner job-board surface (`partner_jobboard`) — out of scope |
| partners                                       | 30    | partner actions (`partner_ui_action`) — out of scope          |
| users                                          | 6     | find, current, get, photo, usergroups, usertasks              |
| notes                                          | 4     | global notes                                                  |
| submissions / floats / usertasks               | 6     | CV submissions, floats, tasks                                 |
| usergroups / useroffices                       | 6     | org structure                                                 |
| categories / countries / locations / worktypes | 4     | reference taxonomies                                          |

**Deprecated:** none documented [UNKNOWN — no public changelog].

## Data Models [SPEC-community]

### Hierarchy

```
Company ──1:N──> Contacts (hiringManager flag)
   └──1:N──> Jobs ──N:1──> Contact
                │
                ├──1:N──> Applications <──N:1── Candidates
                │             └── workflow stages → review → Placement
                ├──1:N──> Placements ──N:1──> Candidate
                └──1:N──> Job Ads · Submissions · Notes · Attachments
Requisitions (approval workflow) → Jobs · Users (recruiters) own everything
```

### Key entities (decision-relevant fields)

| Entity      | Key fields                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job         | `jobId`, `jobTitle`, `company{companyId,name}`, `contact`, `status{statusId,name,active}`, `numberOfJobs`, `workType`, `salary`, `fee`, `owner`, `recruiters[]`, `createdAt`, `updatedAt`, `closedAt` |
| Candidate   | `candidateId`, `firstName`, `lastName`, `email`, `phone`, `mobile`, `status`, `rating`, `seeking`, `employment`, `skillTags[]`, `custom[]`, `updatedAt`                                               |
| Application | `applicationId`, `jobTitle`, `status` (stage), `review`, `candidate{...}`, `job{...}`, `rating`, `source`, `manual`, `updatedAt`                                                                      |
| Placement   | `placementId`, `job{...}`, `candidate{...}`, `approved`, `type` (Permanent/Contract), `status`, `startDate`, `endDate`, `salary`, `contractRate`, `billing`                                           |
| Company     | `companyId`, `name`, `status`, `mainContact`, `primaryAddress`, `parent`                                                                                                                              |
| Contact     | `contactId`, `firstName`, `lastName`, `position`, `email`, `company{...}`, `hiringManager`                                                                                                            |
| User        | `userId`, name/email fields, offices/groups via sub-resources                                                                                                                                         |

**Formats:** integer ids; ISO-8601/RFC 3339 datetimes, UTC assumed; status enums are **per-account lists** — resolve via `GET /{resource}/lists/status` (and `/applications/lists/workflow`) before filtering or transitioning. Custom fields per resource via `GET /{resource}/fields/custom`, values in `custom[]`.

## Pagination

- Type: offset/limit. Default page size [UNKNOWN — observe live]; max 1000 (`limit`).
- Count-only: `limit=0` → just `totalCount`. Total count always present.
- Response: `{"items":[...],"totalCount":480,"links":{"first":"...","prev":"...","next":"...","last":"..."}}`
- Last page: `links.next` absent, or `offset + items.length >= totalCount`.
- Worked: `GET /candidates?limit=100` → items[100], totalCount 480, links.next; page 2 = `{links.next}` (or `offset=100&limit=100`); page 5 items[80], links.next absent → stop.
- Offset paging can skip/duplicate under concurrent writes — prefer `updatedAt=>{cursor}&sort=updatedAt` walks for syncs. Space page-walks (~1s); rate budget unknown.

## Query & Filter Grammar [SPEC-community]

- Repeatable id params: `jobId=1&jobId=2`.
- Date filters: `>`/`<` prefixes, inclusive, repeat for a range — `updatedAt=>2026-06-01&updatedAt=<2026-06-08`.
- Sort: `sort=-updatedAt` (`-` = descending; multiple fields allowed; sortable fields per endpoint, e.g. jobs: jobTitle, status.name, createdAt, updatedAt, closedAt).
- Field expansion: `fields=recruiters&fields=statistics&fields=partnerActions`.
- Resume full-text: `GET /candidates?keywords=python+aws`.

## Rate Limits

| Scope  | Limit     | Window | Notes                                                                                                      |
| ------ | --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| Global | [UNKNOWN] | —      | no numbers in any retrievable source; the walled KB may document per-account limits. Assume 429 on breach. |

- Headers / Retry-After: [UNKNOWN] — capture on the first credentialed call.
- Strategy: treat 429 as authoritative; back off 1s → 5s → 30s → 2m with jitter; never busy-retry; keep bulk walks spaced.

## Error Handling

**Standard error format: [UNKNOWN — needs live testing].** The mirror documents status codes with human-readable descriptions per endpoint but no error body schema. Parse defensively: status code first, then try JSON, fall back to raw text.
| Status | Meaning | Retryable? | Recovery |
| --- | --- | --- | --- |
| 201 | created | — | — |
| 202 | **Accepted — async status transition** | — | re-read the entity to confirm |
| 204 | no content (deletes) | — | — |
| 401 | expired/revoked token [UNVERIFIED] | after refresh | refresh; reconnect via OAuth if refresh fails |
| 403 | missing scope [UNVERIFIED] | no | re-consent with correct scopes |
| 404 | not found ("Job was not found", …) | no | verify id/path |
| 409 | **duplicate** (candidate email, company name, application) | no | find the existing record; update instead of create |
| 422 | validation error | no | fix field values |
| 429 | rate limited [UNVERIFIED] | yes | backoff with jitter |
| 5xx | server error | cautiously | retry once; then surface |

**Idempotency:** no idempotency keys. GET/PUT-by-id safe; POST retries risk duplicates — the 409 guards (candidate email, company name, application) are a partial safety net. After a write timeout, **query before retrying** (e.g. find the candidate by email). Never re-fire a 202 transition — re-read instead.

## Webhooks / Events

**Documented to exist — detail not retrievable.** The official Webhooks KB article (`jobadderapi.zendesk.com/hc/en-us/articles/360022511513`) confirms webhook support with subscriptions reportedly managed via the API, but the article 403-walls scripted fetches and the community mirror carries no webhook endpoints. Event types, payload shapes, signatures, retry policy all [UNKNOWN].

**Consequence for Numa: polling-first.** Every major list endpoint filters on `updatedAt`/`createdAt` with `>` prefixes:
`GET /jobs?updatedAt=>{lastSyncIso}&sort=updatedAt&limit=100` · `GET /candidates?updatedAt=>{lastSyncIso}&sort=updatedAt&limit=100`
Burn down the webhook unknowns from a logged-in browser before designing any event-driven feature.

## SDKs & Tooling

| Surface                  | Status                                | Notes                                                                                                                 |
| ------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Official SDKs            | none                                  | raw REST only                                                                                                         |
| Community OpenAPI mirror | Swagger 2.0 snapshot [SPEC-community] | `github.com/vitaliymashkov/jobadder-api` — endpoint reference; re-validate field-level detail against the live portal |
| Postman collection       | none found                            | —                                                                                                                     |

## Integration Path Assessment

**Recommended path:** Direct API via Numa native data connector (`numa integrations request`), registry `authType: oauth2` — NOT Pipedream, NOT a Files connector. Implemented; see 03 (wiring) and 04 (lifecycle).
**Justification:** OAuth2-only API riding Numa's standard OAuth machinery end-to-end — OAuthWizard for app credentials, redirect flow for per-user grants, automatic Bearer injection + refresh in `connect_tools`/`oauth_tools`. Zero new auth code; the admin contributes the Developer Centre app + metadata only.
**Connector compatibility:** N/A — not a file source.

**Rollout checklist (per customer):**

1. JobAdder admin: register an application in the **Developer Centre** with the Numa redirect URI (`https://{client}.numa.arcanum.ai/oauth/callback/jobadder`); capture Client ID/Secret.
2. Numa admin: add **JobAdder** in Integrations → OAuthWizard → paste Client ID/Secret (scopes default to `read write offline_access`).
3. Each user: click Connect → JobAdder consent screen → done (no chat credential card).
4. Verify: agent runs `GET https://api.jobadder.com/v2/users/current` → 200.
5. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md` with findings.

## Known Unknowns — verify on a credentialed account before customer rollout

1. **Rate limit numbers** — thresholds, headers, `Retry-After` presence.
2. **Error response body shape** — 401/403/404/409/422/429 bodies.
3. **Default page size** when `limit` is omitted.
4. **Webhook mechanics** — event types, subscription API, payloads, signatures (walled KB).
5. **Account-specific `api` base URL** — do non-default hosts occur in practice?
6. **Refresh-token rotation invalidation** — whether the old refresh token dies immediately on use (the doc example shows a new value; the old one's semantics unstated).
7. **Refresh-token absolute lifetime** — undocumented.
8. **Community mirror drift** — diff field-level schemas against the live portal.
9. **Attachment upload mechanics** — multipart format untested; do not expose until verified.
10. **401 vs 400 on bad refresh** — exact failure shape for a dead grant.
