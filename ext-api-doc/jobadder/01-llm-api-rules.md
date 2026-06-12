---
api_name: 'JobAdder'
api_slug: 'jobadder'
version: 'v2 (api.jobadder.com/v2)'
generated_from: 'Official OpenAPI spec (api.jobadder.com/v2/openapi.json, fetched live 2026-06-10) + official OAuth2/Webhooks docs + community spec mirror'
generated_date: '2026-06-10'
update_source: 'Docs/spec-only — no live API calls made through the Numa connector'
line_count_target: '< 300 lines'
---

# JobAdder -- Workspace Agent API Rules

> ⚠️ **Docs-derived — NOT yet live-validated through the Numa connector path.**
>
> **This file is loaded into the workspace agent's context when the JobAdder integration is active.**
> It must stay under 300 lines. Companion files (01a–01d) contain the detailed reference material.
> Tags: [DOCS] = official OpenAPI spec / official docs (fetched 2026-06-10); [SPEC-community] = community
> spec mirror only (github.com/vitaliymashkov/jobadder-api); [UNVERIFIED] = inference.
> Never claim live-confirmed behaviour — nothing here has been exercised with real credentials.

## Context

- **API:** JobAdder API v2 — recruitment ATS/CRM: jobs, candidates, applications, placements, companies, contacts, notes, job ads [DOCS]
- **Base URL:** `https://api.jobadder.com/v2` — configured in Numa; use **relative URLs** like `/jobs?limit=100` [DOCS]
- **Auth:** OAuth2 Bearer token — **injected and refreshed automatically by Numa. NEVER set an Authorization header; you never see the token.**
- **Integration path:** Data Connector — call via the `connectors` MCP tool, `request` operation
- **Rate limits:** publicly undocumented — treat any 429 as authoritative and back off [DOCS — searched spec, none documented]
- **Field casing:** camelCase in bodies/responses (`jobTitle`, `statusId`, `createdAt`) [DOCS]
- **ID format:** integers for core entities (`jobId`, `candidateId`, `companyId`); `applicationId` is int64; `noteId`, `addressId`, `webhookId` are UUIDs [DOCS]

## How to Call

```
connectors(name="request", params={
  "connector": "jobadder",
  "url": "/jobs?active=true&limit=100",
  "method": "GET"
})
```

- Numa injects `Authorization: Bearer <token>` from the user's vault and refreshes the 60-minute access token automatically [DOCS — token lifetime]. **Never add auth headers.**
- POST/PUT: pass JSON in `body` (single objects per the command schemas in 01c). `Content-Type: application/json`.
- No extra mandatory headers — unlike some APIs there is **no version header**; the version is in the URL path (`/v2`, already in the base).

## Auth Structure

OAuth2 Authorization Code grant against `id.jobadder.com` — handled entirely by the Numa platform [DOCS]:

- Admin registers the app in the JobAdder Developer Centre (client id/secret in the company secret); each user connects via the **OAuth redirect flow** (Files > Remote connect or the integration page) — **NOT a chat credential card**.
- Scopes are space-separated, requested at connect time: `read write offline_access` covers nearly everything; granular `read_*`/`write_*` scopes exist per resource (full list in 01a) [DOCS].
- Access tokens last **60 minutes**; `offline_access` enables refresh tokens — Numa refreshes silently [DOCS].
- The token response includes an account-specific `api` base URL (regional shards AU/US/EU exist) — the platform handles base resolution; you always use relative URLs [DOCS; routing behaviour [UNVERIFIED]].
- **401 = expired/revoked grant.** The user must reconnect JobAdder via the OAuth flow. Tell them to reconnect from the integration/Files Remote page; do not retry, do not ask for a token in chat.
- **403 = missing scope.** The connection was granted without the scope the operation needs (e.g. `write` or `write_placement`). Name the operation and likely scope; admin/user must reconnect with broader scopes. Do not retry.

## Capabilities

### CAN

1. Read + search jobs, candidates, applications, placements, companies, contacts, notes, users, job ads, requisitions, interviews, folders, opportunities, submissions, floats [DOCS]
2. Create + update: jobs, candidates, companies, contacts, job ads (drafts), opportunities, folders, notes [DOCS]
3. Drive recruitment workflow: add candidates to a job (creates applications), set application/candidate/job/placement/company/contact **status** via dedicated `PUT .../status` endpoints [DOCS]
4. Update placements (`PUT /placements/{id}`) — but NOT create them (see CANNOT) [DOCS]
5. Filter every list by ids, status, dates (`createdAt>...`, `updatedAt<...`), owner/recruiter; sort with `-` prefix; page with `offset`/`limit` [DOCS]
6. Use `limit=0` to get just `totalCount` — cheap existence/count checks [DOCS]
7. Read configuration lookups: `/jobs/lists/status`, `/candidates/lists/status`, `/categories`, `/worktypes`, `/locations`, `/{entity}/fields/custom` [DOCS]

### CANNOT

1. **Create placements** — no `POST /placements` exists; placements are made in the JobAdder UI. You can only read and update them [DOCS]
2. **Delete core entities** — no DELETE for jobs/candidates/companies/contacts/applications/placements. Deactivate via status instead. (Deletes exist only for: requisitions, webhooks, photos/logos, company addresses, candidate skills/privacy, user tasks) [DOCS]
3. Exceed `limit=1000` per page (default 100) [DOCS]
4. Call anything outside the granted scopes (→ 403) [DOCS]
5. Know numeric rate limits — undocumented; 429 is the only signal [DOCS]
6. Confirm exact runtime response shapes — **nothing validated live yet**; trust what the API actually returns over this file

## Critical Gotchas

1. **"Jobs" are Job Orders.** The job entity is `JobOrder` (`jobId`, `jobTitle`); a **Job Ad** (`/jobads`, `adId`) is the advertisement posted to job boards — different entity, different endpoints [DOCS].
2. **Status values are per-account, keyed by `statusId`.** Never guess ids — fetch `/{entity}/lists/status` first and match by name (see 01b/01c) [DOCS].
3. **Applications are created through the job**: `POST /jobs/{jobId}/applications` with `{"candidateId": [123]}` (array). 409 = candidate already applied [DOCS].
4. **Candidate create dedupes by email** — 409 `Candidate with this email already exists`. Search by email first; the `X-Allow-Duplicates` header can force-create but avoid it [DOCS].
5. **Date filters are prefix-operator strings**: `createdAt=>2026-01-01` (inclusive >), `<` for before; pass the parameter twice for a range. UTC assumed, ISO 8601 [DOCS].
6. **Writes use different shapes than reads**: read returns nested objects (`status: {statusId, name}`); writes take flat ids (`statusId: 123`, `companyId: 456`). GET first, then map to the command shape in 01c [DOCS].
7. **`PUT` updates may be full-replace** — the spec marks all update-command fields optional, but omitted-field behaviour (ignore vs clear) is [UNVERIFIED]. Send the complete intended state of any field group you touch.
8. **No DELETE for most entities** — don't promise deletion; offer a status change [DOCS].
9. **Error body**: `{"message": "...", "errors": [{"code", "message", "fields": []}]}` — quote `message` and `errors[].fields` verbatim [DOCS].
10. Query parameter names appear camelCase in older docs and PascalCase in the current spec (`jobTitle` vs `JobTitle`) — use camelCase as in the examples; case-insensitivity is [UNVERIFIED].

## Default Parameters

| Parameter | Default                                | Reason                                                |
| --------- | -------------------------------------- | ----------------------------------------------------- |
| `limit`   | 100 (API default); max 1000            | `limit=0` returns only `totalCount` [DOCS]            |
| `offset`  | 0; add previous `limit` per page       | Offset paging, `totalCount` in every list [DOCS]      |
| `active`  | `true` for job/application lists       | Users usually mean open jobs [UNVERIFIED preference]  |
| `sort`    | `-updatedAt` for "recent" questions    | `-` prefix = descending [DOCS]                        |
| Pacing    | ≤ ~2 calls/sec, sequential             | Limits unknown — be conservative [UNVERIFIED]         |

## Working Examples

### Example 1: List open jobs, newest first

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/jobs?active=true&sort=-updatedAt&limit=100"})
```

Response: `{"items": [{"jobId": 1234, "jobTitle": "...", "company": {...}, "status": {...}}], "totalCount": 57, "links": {...}}` [DOCS].

### Example 2: Find a candidate by email, then their applications

```
connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates?email=jane.smith@acme.co.nz"})

connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/candidates/8855221/applications"})
```

### Example 3: Create a candidate (handle the 409)

```
connectors(name="request", params={"connector": "jobadder", "method": "POST",
  "url": "/candidates",
  "body": {"firstName": "Jane", "lastName": "Smith", "email": "jane.smith@acme.co.nz",
           "mobile": "+64211234567"}})
```

201 → `CandidateRepresentation` with `candidateId`. 409 → candidate exists: search by email and use the existing record [DOCS].

### Example 4: Add a candidate to a job, then move the application's status

```
connectors(name="request", params={"connector": "jobadder", "method": "POST",
  "url": "/jobs/1234/applications", "body": {"candidateId": [8855221]}})

connectors(name="request", params={"connector": "jobadder", "method": "GET",
  "url": "/applications/lists/status"})

connectors(name="request", params={"connector": "jobadder", "method": "PUT",
  "url": "/applications/9988776655/status", "body": {"statusId": 42}})
```

`PUT .../status` returns 200 on change, **202 if already at that status** (treat as success) [DOCS].

## Proxy API Operations (documented core set)

All paths relative to base. Full catalog in 01a; query params in 01b; write bodies in 01c. [DOCS]

| Operation                  | Method  | Path                                  | Notes                                      |
| -------------------------- | ------- | ------------------------------------- | ------------------------------------------ |
| Find jobs                  | GET     | /jobs                                 | `active`, `companyId`, `statusId`, dates   |
| Get / update job           | GET/PUT | /jobs/{jobId}                         | Create: POST /jobs (`jobTitle` required)   |
| Find candidates            | GET     | /candidates                           | `name`, `email`, `phone`, `keywords`       |
| Get / update candidate     | GET/PUT | /candidates/{candidateId}             | Create: POST /candidates (409 on dupe)     |
| Add candidate(s) to job    | POST    | /jobs/{jobId}/applications            | Body `{"candidateId": [..]}` → applications |
| Find applications          | GET     | /applications                         | `jobId`, `candidateId`, `active`, `statusId` |
| Update application         | PUT     | /applications/{applicationId}         | `{statusId, rating, custom}`               |
| Set application status     | PUT     | /applications/{applicationId}/status  | `{statusId}`; 202 = already set            |
| Find placements            | GET     | /placements                           | Read + PUT only — no create                |
| Find companies / contacts  | GET     | /companies, /contacts                 | POST to create; PUT /{id} to update        |
| Notes (read/add)           | GET/POST| /notes, /{entity}/{id}/notes          | AddNote: `{"type", "text", "<entity>Id": [..]}` |
| Status lookups             | GET     | /{entity}/lists/status                | Resolve `statusId` by name FIRST           |
| Current user               | GET     | /users/current                        | Whoami / connection sanity check           |

## Pagination

- **Offset paging:** `limit` (default 100, max 1000) + `offset` (default 0); every list returns `items`, `totalCount`, and `links` (`first/prev/next/last` URLs) [DOCS]
- Follow `links.next` (relative to base) or compute `offset += limit`; stop when `offset >= totalCount` or an empty page returns
- `limit=0` → count only [DOCS]

## Error Handling

Error body: `ErrorModel {message, errors[{code, message, fields[]}]}` [DOCS]. Details + recovery in 01d.

| Status | Meaning                                  | Action                                                              |
| ------ | ---------------------------------------- | ------------------------------------------------------------------- |
| 400    | Bad request                              | Check param syntax (date prefixes, array params); don't retry unchanged |
| 401    | Expired/revoked OAuth grant              | User reconnects via the OAuth flow (integration page) — NOT a chat credential card; do not retry |
| 403    | Missing OAuth scope                      | Name the op + scope (see 01a); reconnect with broader scopes; do not retry |
| 404    | Wrong id or path                         | Verify entity id and exact documented path                          |
| 409    | Duplicate (candidate email, existing application) | Search for the existing record and use it                   |
| 422    | Validation error                         | Fix fields named in `errors[].fields`; don't retry unchanged        |
| 429    | Rate limited (thresholds undocumented)   | Back off 2s → 10s → 30s → stop; slow down for the session           |
| 5xx    | Server error                             | Retry once after 5s; for writes, check first whether it landed      |

## Known Limitations

1. **Nothing live-validated through Numa** — request/response shapes are spec-derived; trust actual responses over this file and note discrepancies
2. **No placement creation, no entity deletion** — workflow ends at application/status management; placements are UI-made [DOCS]
3. **Rate limits undocumented** — fly conservatively
4. **Webhooks exist** (`POST /webhooks`) but are platform infrastructure, not a chat capability — change detection from chat is polling `updatedAt` (see 01d) [DOCS]
5. **Multipart attachment upload** (`POST .../attachments/{type}`) is untested through the connector's JSON `body` path — treat as unsupported until validated [UNVERIFIED]
6. Account-specific regional API bases exist (AU/US/EU shards) — handled by the platform; if calls 404 oddly across the board, suspect base-URL mismatch and escalate [UNVERIFIED]

---

_Generated 2026-06-10 from the official OpenAPI spec + docs. See companion files:_

- _01a-domain-model-reference.md — Entity catalog, hierarchy, fields, scopes_
- _01b-query-patterns.md — Search params, date filters, sorting, pagination recipes_
- _01c-mutation-patterns.md — Create/update commands, status changes, workflow moves_
- _01d-event-and-error-handling.md — Webhooks, polling, error model, 401/403/429 recovery_
