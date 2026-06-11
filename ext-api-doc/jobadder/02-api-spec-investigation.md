---
api_name: 'JobAdder API v2'
api_slug: 'jobadder'
base_url: 'https://api.jobadder.com/v2 (token response carries an account-specific `api` base URL — use it when it differs)'
version: 'v2 (URL path-versioned; no version header)'
spec_format: 'swagger-2.0 (community mirror only — no official machine-readable download found)'
spec_url: 'https://raw.githubusercontent.com/vitaliymashkov/jobadder-api/master/jobadder-openapi-v2.json'
docs_url: 'https://api.jobadder.com/v2/docs'
date_researched: '2026-06-10'
generated_date: '2026-06-10'
---

# JobAdder — API Specification & Investigation

> Developer reference for the JobAdder REST API v2 — the condensed output of
> `00-api-investigation-questionnaire.md`. Compiled from the official OAuth2 article
> (`jobadderapi.zendesk.com`), the API portal (`api.jobadder.com/v2/docs`), and the community
> OpenAPI mirror (`github.com/vitaliymashkov/jobadder-api`, 197 paths).
>
> ⚠️ **NO AUTHENTICATED CALL has been made** — no credentials were available; the docs portal
> is JS-rendered and the Zendesk KB blocks scripted fetches. Auth and the endpoint catalog are
> docs/mirror-derived ([DOCS] / [SPEC-community]); error bodies, rate limits, and webhook
> mechanics are unknown (§Known Unknowns). Verify against a real OAuth grant before first
> customer use.
>
> ⚠️ The machine-readable spec is a **third-party snapshot** — high fidelity (its embedded
> auth guide matches the official article verbatim) but possibly lagging the live API.

---

## Overview

- **Vendor / product:** JobAdder — recruitment ATS/CRM for agencies and in-house talent
  teams: jobs, candidates, applications, placements, companies, contacts, job ads,
  requisitions [DOCS]
- **API style:** REST, JSON [DOCS]
- **Base URL:** `https://api.jobadder.com/v2` — the OAuth token response includes an `api`
  field with the base URL to use for that account (documented example matches the default)
  [DOCS — OAuth2 article]
- **Versioning:** URL path (`/v2`); no version header [SPEC-community]
- **Auth:** OAuth 2.0 Authorization Code **only** — no PAT/API-key path. Access tokens live
  **60 minutes**; refresh via `offline_access` [DOCS]
- **Pagination:** `offset`/`limit` (max **1000**; `limit=0` = count only) with `totalCount`
  and hypermedia `links.next` [SPEC-community]
- **Filtering:** per-field params; date filters take `>`/`<` prefixes (inclusive, repeat for
  a range); `sort` with `-` prefix; `fields` for opt-in extras [SPEC-community]
- **Rate limits:** numbers **not retrievable** — assume 429 on breach [UNKNOWN]
- **Webhooks:** exist per the official KB article, but detail is 403-walled and absent from
  the mirror → treat as polling-first [DOCS/UNKNOWN]
- **SDKs:** none official

**Summary:** A classic ATS REST API: 197 paths in 21 groups. Reads are rich (per-field
filters, resume keyword search, date-window queries, totalCount everywhere); writes follow a
CRUD + dedicated-status-transition pattern where **transitions return 202 Accepted** and
duplicate creates return **409 Conflict**.

**Numa integration model:** Native data connector (`authType: oauth2`, NOT Pipedream). The
workspace agent calls
`connectors(name="request", params={connector: "jobadder", url: "https://api.jobadder.com/v2/jobs?active=true&limit=100", method: "GET"})`.
The backend fetches the user's OAuth token from the vault (`oauth-jobadder`), refreshes it
automatically when within 5 minutes of expiry, and injects `Authorization: Bearer …`. The
agent never sees tokens. **Use absolute URLs** — the OAuthWizard does not persist a vault
`base_url` for relative-URL expansion (see `03-connector-setup.md` §5).

---

## Authentication

### Method: OAuth 2.0 Authorization Code (the only method)

| Property              | Value                                                       |
| --------------------- | ------------------------------------------------------------ |
| Authorize URL         | `https://id.jobadder.com/connect/authorize` [DOCS]            |
| Token URL             | `https://id.jobadder.com/connect/token` [DOCS]                |
| App registration      | JobAdder **Developer Centre** (`developers.jobadder.com`) → Client ID + Client Secret [DOCS] |
| Auth code lifetime    | 5 minutes [DOCS]                                              |
| Access token lifetime | **60 minutes** (`expires_in: 3600`) [DOCS]                    |
| Refresh tokens        | Require the `offline_access` scope; the documented refresh example returns a **new** `refresh_token` — treat rotation as the norm and re-persist every refresh response [DOCS] |
| Token type            | `Bearer` [DOCS]                                               |

**Authorize parameters** [DOCS]: `response_type=code`, `client_id`, `scope`
(space-separated), `redirect_uri` (must match a registered URL), `state` (optional CSRF).
Denied consent → redirect with `error=access_denied`.

**Token response** [DOCS — exact example]:

```json
{
  "access_token": "31ff7431b4c1dde02e386122702f5460",
  "expires_in": 3600,
  "token_type": "Bearer",
  "refresh_token": "e7672885d6da2db1e56d200dd292c801",
  "api": "https://api.jobadder.com/v2"
}
```

> `api` = **the base URL to use for API access** for this account [DOCS]. Numa's generic
> OAuth callback does not capture it; the default host is used. If a tenant ever surfaces a
> non-default `api` value, store it as `api_endpoint` on the `oauth-client-jobadder` vault
> entry (the backend's base-URL resolver already reads that field).

**Scopes** (space-separated) [DOCS + SPEC-community]:

- **Broad:** `read` (all reads) · `write` (all writes) · `offline_access` (refresh tokens —
  must accompany other scopes). **The Numa registry requests `read write offline_access`.**
- **Granular (available, not used by Numa):** `read_job`/`write_job`,
  `read_candidate`/`write_candidate`, `read_company`/`write_company`,
  `read_contact`/`write_contact`, `read_placement`/`write_placement`,
  `read_jobapplication`/`write_jobapplication`, `read_requisition`/`write_requisition`,
  `read_jobad`/`write_jobad`, `read_user`, `read_usertask`, `read_usergroup`,
  `read_submission`, `read_float`, per-entity note scopes (`read_job_note`,
  `write_candidate_note`, …)
- **Partner:** `partner_jobboard` (job-board surface), `partner_ui_action` (partner buttons) —
  out of Numa scope

**Failure semantics:**

| Status | Meaning                                                                          |
| ------ | --------------------------------------------------------------------------------- |
| 401    | Expired/revoked/invalid access token → refresh; if the refresh fails, the grant is dead → user reconnects via the OAuth redirect [UNVERIFIED — standard OAuth2] |
| 403    | Token valid but the **grant lacks the scope** — fix the app/grant scopes and re-consent; never a refresh [UNVERIFIED — inferred from the scope model] |

---

## Endpoint Catalog

> 197 paths in 21 groups [SPEC-community]. Critical paths below are exact; the group index
> gives coverage breadth.

### Connection probe

| Method | Path             | Purpose                                     |
| ------ | ---------------- | -------------------------------------------- |
| GET    | `/users/current` | Authenticated user's details — the smoke test |

### Jobs (job orders)

| Method | Path                            | Purpose                                        |
| ------ | ------------------------------- | ----------------------------------------------- |
| GET    | `/jobs`                         | Find jobs (filters: ids, title, company, status, active, owner/recruiter, created/updated/closed dates) |
| POST   | `/jobs`                         | Add a job → 201                                 |
| GET    | `/jobs/{jobId}`                 | Get a job                                       |
| PUT    | `/jobs/{jobId}`                 | Update a job                                    |
| PUT    | `/jobs/{jobId}/status`          | **Set job status → 202 Accepted (async)**       |
| GET    | `/jobs/{jobId}/applications`    | Applications on a job (`/active` variant)       |
| POST   | `/jobs/{jobId}/applications`    | Add candidates to a job → 409 if already applied |
| GET    | `/jobs/{jobId}/placements`      | Placements (`/approved` variant)                |
| GET/POST | `/jobs/{jobId}/notes`         | Notes                                           |
| GET    | `/jobs/lists/status` · `/jobs/lists/source` · `/jobs/lists/notetype` · `/jobs/fields/custom` | Account taxonomies |

### Candidates

| Method | Path                                   | Purpose                                       |
| ------ | -------------------------------------- | ---------------------------------------------- |
| GET    | `/candidates`                          | Find candidates (`name`, `email`, `phone`, **`keywords`** = resume full-text, status, dates) |
| POST   | `/candidates`                          | Add → **409 "Candidate with this email already exists"** |
| GET/PUT | `/candidates/{candidateId}`           | Get / update (PUT also 409-guards email)       |
| PUT    | `/candidates/{candidateId}/status`     | Status transition → 202                        |
| GET/POST | `/candidates/{candidateId}/applications` | Applications / add jobs to candidate (409 dupe guard) |
| GET    | `/candidates/{candidateId}/skills` · `/availability` · `/placements` · `/floats` | Profile sub-resources |
| GET/POST | `/candidates/{candidateId}/notes` · `/attachments/{attach}` | Notes / files          |
| DELETE | `/candidates/{candidateId}/privacy`    | **GDPR-style erasure — human confirmation mandatory** |
| GET    | `/candidates/lists/status` · `/lists/source` · `/lists/rating` · `/fields/custom` | Taxonomies |

### Applications (job applications)

| Method | Path                                     | Purpose                                  |
| ------ | ---------------------------------------- | ----------------------------------------- |
| GET    | `/applications`                          | Find applications                         |
| GET/PUT | `/applications/{applicationId}`         | Get / update                              |
| PUT    | `/applications/{applicationId}/status`   | Stage transition → 202                    |
| PUT/POST | `/applications/{applicationId}/review` (+ `/accept`, `/reject`) | Review cycle → 202 |
| GET    | `/applications/lists/workflow`           | **The account's stage pipeline** — resolve before answering stage questions |
| GET    | `/applications/lists/status` · `/fields/custom` | Taxonomies                         |

### Placements · Companies · Contacts

| Method | Path                                  | Purpose                                       |
| ------ | ------------------------------------- | ---------------------------------------------- |
| GET    | `/placements` · `/placements/{id}`    | Find / get placements (fees, dates, billing)   |
| PUT    | `/placements/{id}` · `/placements/{id}/status` | Update / transition (202)             |
| GET/POST | `/companies` · `/companies/{id}` (+ `/addresses`, `/contacts`, `/jobs`, `/notes`) | Company CRUD — **409 on duplicate name** |
| GET/POST | `/contacts` · `/contacts/{id}` (+ `/notes`, `/attachments`) | Contact CRUD          |
| PUT    | `/companies/{id}/status` · `/contacts/{id}/status` | Transitions (202)                 |

### Other groups [SPEC-community]

| Group        | Paths | Notes                                                          |
| ------------ | ----- | --------------------------------------------------------------- |
| requisitions | 10    | CRUD + submit/approve/reject (202) + history                    |
| jobads       | 2     | Find; get/update draft ads                                      |
| jobboards    | 6     | Partner job-board surface (`partner_jobboard`) — out of scope   |
| partners     | 30    | Partner actions (`partner_ui_action`) — out of scope            |
| users        | 6     | find, current, get, photo, usergroups, usertasks                |
| notes        | 4     | Global notes                                                    |
| submissions / floats / usertasks | 6 | CV submissions, floats, tasks                   |
| usergroups / useroffices | 6 | Org structure                                           |
| categories / countries / locations / worktypes | 4 | Reference taxonomies            |

**Deprecated:** none documented [UNKNOWN — no public changelog].

---

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

| Entity      | Key fields                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| Job         | `jobId`, `jobTitle`, `company{companyId,name}`, `contact`, `status{statusId,name,active}`, `numberOfJobs`, `workType`, `salary`, `fee`, `owner`, `recruiters[]`, `createdAt`, `updatedAt`, `closedAt` |
| Candidate   | `candidateId`, `firstName`, `lastName`, `email`, `phone`, `mobile`, `status`, `rating`, `seeking`, `employment`, `skillTags[]`, `custom[]`, `updatedAt` |
| Application | `applicationId`, `jobTitle`, `status` (stage), `review`, `candidate{...}`, `job{...}`, `rating`, `source`, `manual`, `updatedAt` |
| Placement   | `placementId`, `job{...}`, `candidate{...}`, `approved`, `type` (Permanent/Contract), `status`, `startDate`, `endDate`, `salary`, `contractRate`, `billing` |
| Company     | `companyId`, `name`, `status`, `mainContact`, `primaryAddress`, `parent`          |
| Contact     | `contactId`, `firstName`, `lastName`, `position`, `email`, `company{...}`, `hiringManager` |
| User        | `userId`, name/email fields, offices/groups via sub-resources                     |

**Formats:** integer ids; ISO-8601/RFC 3339 datetimes, **UTC assumed**; status enums are
**per-account lists** — resolve via `GET /{resource}/lists/status` (and
`/applications/lists/workflow`) before filtering or transitioning. Custom fields per resource
via `GET /{resource}/fields/custom`, values in `custom[]`.

---

## Pagination

- **Type:** offset/limit [SPEC-community]
- **Default page size:** [UNKNOWN — observe live] — **Max:** 1000 (`limit`)
- **Count-only:** `limit=0` returns just `totalCount`
- **Total count:** always present

**Response structure:**

```json
{
  "items": [ ... ],
  "totalCount": 480,
  "links": { "first": "...", "prev": "...", "next": "...", "last": "..." }
}
```

**Last page detection:** `links.next` absent, or `offset + items.length >= totalCount`.

**Worked example:**

```
Page 1: GET /candidates?limit=100                  → items[100], totalCount 480, links.next
Page 2: GET {links.next}                           (or offset=100&limit=100)
Page 5: items[80], links.next absent → stop
```

Offset paging can skip/duplicate under concurrent writes — prefer
`updatedAt=>{cursor}&sort=updatedAt` walks for syncs. Space page-walks (~1s); the rate budget
is unknown.

---

## Query & Filter Grammar [SPEC-community]

- **Repeatable id params:** `jobId=1&jobId=2`
- **Date filters:** `>`/`<` prefixes, inclusive, repeat for a range —
  `updatedAt=>2026-06-01&updatedAt=<2026-06-08`
- **Sort:** `sort=-updatedAt` (prefix `-` = descending; multiple fields allowed; sortable
  fields enumerated per endpoint, e.g. jobs: jobTitle, status.name, createdAt, updatedAt, closedAt)
- **Field expansion:** `fields=recruiters&fields=statistics&fields=partnerActions`
- **Resume full-text:** `GET /candidates?keywords=python+aws`

---

## Rate Limits

| Scope  | Limit         | Window | Notes                                                      |
| ------ | ------------- | ------ | ----------------------------------------------------------- |
| Global | **[UNKNOWN]** | —      | No numbers in any retrievable source; the walled KB may document per-account limits. Assume 429 on breach. |

- **Headers / Retry-After:** [UNKNOWN] — capture on the first credentialed call
- **Strategy:** treat 429 as authoritative; back off 1s → 5s → 30s → 2m with jitter; never
  busy-retry; keep bulk walks spaced

---

## Error Handling

**Standard error format: [UNKNOWN — needs live testing].** The mirror documents status codes
with human-readable descriptions per endpoint but no error body schema. Parse defensively:
status code first, then try JSON, fall back to raw text.

| Status | Meaning                                                       | Retryable? | Recovery                                            |
| ------ | -------------------------------------------------------------- | ---------- | ----------------------------------------------------|
| 201    | Created                                                        | —          | —                                                    |
| 202    | **Accepted — async status transition**                          | —          | Re-read the entity to confirm                        |
| 204    | No content (deletes)                                            | —          | —                                                    |
| 401    | Expired/revoked token [UNVERIFIED]                              | After refresh | Refresh; reconnect via OAuth if refresh fails     |
| 403    | Missing scope [UNVERIFIED]                                      | No         | Re-consent with correct scopes                       |
| 404    | Not found ("Job was not found", …)                              | No         | Verify id/path                                       |
| 409    | **Duplicate** (candidate email, company name, application)      | No         | Find the existing record; update instead of create   |
| 422    | Validation error                                                | No         | Fix field values                                     |
| 429    | Rate limited [UNVERIFIED]                                       | Yes        | Backoff with jitter                                  |
| 5xx    | Server error                                                    | Cautiously | Retry once; then surface                             |

**Idempotency:** no idempotency keys. GET/PUT-by-id safe; POST retries risk duplicates — the
409 guards (candidate email, company name, application) are a partial safety net. After a
write timeout, **query before retrying** (e.g. find the candidate by email). Never re-fire a
202 transition — re-read instead.

---

## Webhooks / Events

**Documented to exist — detail not retrievable.** The official Webhooks KB article
(`jobadderapi.zendesk.com/hc/en-us/articles/360022511513`) confirms webhook support with
subscriptions reportedly managed via the API, but the article 403-walls scripted fetches and
the community mirror carries no webhook endpoints. Event types, payload shapes, signatures,
and retry policy are all [UNKNOWN].

**Consequence for Numa: polling-first.** JobAdder polls well — every major list endpoint
filters on `updatedAt`/`createdAt` with `>` prefixes:

```
GET /jobs?updatedAt=>{lastSyncIso}&sort=updatedAt&limit=100
GET /candidates?updatedAt=>{lastSyncIso}&sort=updatedAt&limit=100
```

Burn down the webhook unknowns from a logged-in browser before designing any event-driven
feature.

---

## SDKs & Tooling

| Surface | Status | Notes |
| ------- | ------ | ----- |
| Official SDKs | **none** | Raw REST only |
| Community OpenAPI mirror | Swagger 2.0 snapshot [SPEC-community] | `github.com/vitaliymashkov/jobadder-api` — endpoint reference; re-validate field-level detail against the live portal |
| Postman collection | none found | — |

---

## Integration Path Assessment

**Recommended path:** **Direct API via Numa native data connector** (`request` operation),
registry `authType: oauth2` — NOT Pipedream, NOT a Files connector. Implemented; see
`03-connector-setup.md` for the real wiring and `04-connection-and-reauth.md` for lifecycle.

**Justification:** OAuth2-only API riding Numa's standard OAuth machinery end-to-end —
OAuthWizard for the app credentials, redirect flow for per-user grants, automatic Bearer
injection + refresh in `connect_tools`/`oauth_tools`. Zero new auth code; the admin
contributes the Developer Centre app and metadata only.

**Connector compatibility:** N/A — not a file source.

**Rollout checklist (per customer):**

1. JobAdder admin: register an application in the **Developer Centre** with the Numa redirect
   URI (`https://{client}.numa.arcanum.ai/oauth/callback/jobadder`); capture Client ID/Secret
2. Numa admin: add **JobAdder** in Integrations → OAuthWizard → paste Client ID/Secret
   (scopes default to `read write offline_access`)
3. Each user: click Connect → JobAdder consent screen → done (no chat credential card)
4. Verify: agent runs `GET https://api.jobadder.com/v2/users/current` → 200
5. Burn down §Known Unknowns on the first connected account; update `01-llm-api-rules.md`
   with findings

---

## Known Unknowns — verify on a credentialed account before customer rollout

1. **Rate limit numbers** — thresholds, headers, `Retry-After` presence
2. **Error response body shape** — 401/403/404/409/422/429 bodies
3. **Default page size** when `limit` is omitted
4. **Webhook mechanics** — event types, subscription API, payloads, signatures (walled KB)
5. **Account-specific `api` base URL** — do non-default hosts occur in practice?
6. **Refresh-token rotation invalidation** — whether the old refresh token dies immediately
   on use (the doc example shows a new value; semantics of the old one unstated)
7. **Refresh-token absolute lifetime** — undocumented
8. **Community mirror drift** — diff field-level schemas against the live portal
9. **Attachment upload mechanics** — multipart format untested; do not expose until verified
10. **401 vs 400 on bad refresh** — exact failure shape for a dead grant

---

_Researched 2026-06-10 (official OAuth2 article, API portal, community OpenAPI mirror).
**No authenticated call was possible — docs/mirror-derived only.**
Source: `00-api-investigation-questionnaire.md`._
