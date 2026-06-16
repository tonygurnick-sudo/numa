---
api_name: 12d Synergy
api_slug: synergy
doc: write-side / mutation patterns (on-demand companion to 01-llm-api-rules.md)
ground_truth: live Swagger at {instance}/api-docs/api/v1. Verify exact request shapes (JobAttributeUpdateModel, JobChangeAnnouncementModel, IssueTicketModel, ContactModel, FileUploadModel) against Swagger before relying on field names.
no_generic_root_posts: there is NO `POST /api/v1/jobs`, `PUT /api/v1/jobs`, `POST /api/v1/folders`, `POST /api/v1/files`, `POST /api/v1/issues`, `POST /api/v1/workflows`, `POST /api/v1/contacts`. Use the specific named endpoints below.
errors_on_create: plain-string, e.g. "Job Type is required but not defined!". Error response schema is [UNKNOWN] — handle non-2xx defensively, key off HTTP status, log raw body. Do not fabricate error schemas.
confidence: endpoints verified against Swagger where tagged; request bodies [INFERRED] unless confirmed.
---

# 12d Synergy — Mutation Patterns

## Job CRUD

Jobs use named endpoints per operation — NO plain `POST/PUT /api/v1/jobs`, and NO delete endpoint at all.

Create — PREREQUISITE: fetch standard + default attributes first so you know which are required and their types:

```
GET /api/v1/jobs/getStandardAttributes      # includes required flags
GET /api/v1/jobs/getDefaultAttributes        # tenant-specific default values
POST /api/v1/jobs/create
{"Name":"New Motorway Extension","Description":"Phase 1 design for the northern motorway extension","Path":"/Projects/Infrastructure","Type":0,"Attributes":[{"Name":"ProjectManager","Value":"Jane Smith"},{"Name":"Region","Value":"Auckland"}]}
```

Missing required attrs → plain-string error `"Job Type is required but not defined!"`. Always fetch standard attrs and include them.

Update (attribute patch — no top-level `PUT /api/v1/jobs`):

```
POST /api/v1/jobs/updateAttributes            # bulk across jobs
{"EntityIDs":[{"IDString":"100_1"}],"Attributes":[{"Name":"ProjectManager","Value":"John Doe"},{"Name":"Region","Value":"Waikato"}]}
POST /api/v1/jobs/{id}/announceJobChange      # notify watchers / apply workflow on a single job; body = model/change payload
```

Delete — NO delete-job endpoint exists. Jobs can't be deleted via v1 REST. Use archiving attributes (e.g. `Status=Archived`) via `updateAttributes`. True deletion only via the 12d Synergy client/admin console.

Get job attributes — `GET /api/v1/jobs/{id}/true` (`true` = retrieve_attributes; includes attrs in JobModel). No separate `/jobs/{id}/attributes`.

## Task CRUD

Create/update = `POST /api/Tasks` — the ONLY endpoint without the `/v1/` prefix. Same endpoint for both; include `id` to update; no `PUT` variant. TaskItemModel is snake_case.

```
# Create:
POST /api/Tasks  {"name":"Review site survey data","description":"Cross-reference latest survey data with design requirements","due_date_utc":"2026-04-15T00:00:00Z"}
# Update (id set):
POST /api/Tasks  {"id":{"IDString":"500_1"},"name":"Review site survey data - URGENT","description":"...","due_date_utc":"2026-04-10T00:00:00Z","is_closed":false}
# Close:
POST /api/Tasks  {"id":{"IDString":"500_1"},"is_closed":true}
# Reopen:
POST /api/Tasks  {"id":{"IDString":"500_1"},"is_closed":false}
```

Delete — description required as path param, URL-encoded (spaces → `%20`):
`DELETE /api/v1/tasks/500_1/Review%20site%20survey%20data`

## File Operations

No `POST /api/v1/files` root endpoint. Two upload paths:
Simple upload — `POST /api/v1/files/upload`, `Content-Type: multipart/form-data`. FileUploadModel fields (verify in Swagger): `file` (binary), `FolderID` ({IDString}), `FileName`, `Attributes`.
Create file record (no content) — `POST /api/v1/files/createFile`, body FileModel with FolderID, FileName, Attributes.
Chunked upload (large files):

```
POST /api/v1/files/initiateChunkUpload                       → {session_id}
POST /api/v1/files/uploadChunk/{session_id}/{chunk_number}
POST /api/v1/files/finalizeChunkUpload/{session_id}
GET  /api/v1/files/getChunkUploadStatus/{session_id}         # poll progress
```

Checkout → edit → checkin (standard modify workflow):

```
POST /api/v1/files/2000_1/checkout              # locks the file
GET  /api/v1/files/2000_1/true                  # FileModel.LatestVersion (e.g. 3)
POST /api/v1/files/2000_1/download/3/false      # Content-Type: application/octet-stream, empty body → file binary
# (user edits locally)
POST /api/v1/files/2000_1/checkin               # multipart/form-data: file=<updated binary>, Comment="Updated drainage calculations"
```

Rules: one user checks out at a time; checkout fails if already checked out by another user; check-in increments `LatestVersion`; `IsCheckedOut` reflects state.

Download (read path): `GET /api/v1/files/{id}/true` for LatestVersion, then `POST /api/v1/files/{id}/download/{version}/{with_references}` (`Content-Type: application/octet-stream`, empty body). 3 path params: `{version}` int, `{with_references}` bool. Returns binary.

## Folder Operations

Create — note `/create` suffix (`POST /api/v1/folders` plain does NOT exist):
`POST /api/v1/folders/create` `{"Name":"Site Photos","ParentFolderID":{"IDString":"300_1"}}`
Move/Rename/Copy:

```
POST /api/v1/folders/move     {FolderID, NewParentFolderID}
POST /api/v1/folders/rename   {FolderID, NewName}
POST /api/v1/folders/copy     {FolderID, TargetParentFolderID}
```

Delete — NOT exposed in v1. No `DELETE /api/v1/folders/{id}`. Folder lifecycle happens via the 12d Synergy client app; programmatic folder deletion is not achievable through this API.

## Contact Operations

Single `saveContact` endpoint for both create and update — capital `C`, no plain `/api/v1/contacts`, no `PUT`. ContactModel is snake_case (verify exact shape in Swagger):
`POST /api/v1/Contacts/saveContact` `{"ID":{"IDString":"800_1"},"first_name":"John","last_name":"Smith","email":"john.smith@example.com","phone":"+64 21 555 0123","company_id":{"IDString":"50_1"}}`
Omit `ID` for create; include for update.

## Workflow Operations

Workflows aren't "started" by a generic POST — they attach to entities (jobs, issues, tasks) and transition through states. No `POST /api/v1/workflows`.
Discover:

```
GET /api/v1/workflows/all                                                          # definitions
GET /api/v1/workflows/{workflow_id}/{return_all}                                   # detail
GET /api/v1/workflows/getWorkflowInstance/{workflow_id}/{entity_id}/{entity_type}  # instance on an entity
```

Transition — via attribute changes on the owning entity (issue status, task state, job attribute):

```
GET /api/v1/workflows/getRequiredDataCaptureForAttributeWorkflowTransition/{target_type}/{target_id}/{owner_job_id}/{attribute_id}/{next_value_id}
GET /api/v1/workflows/getRequiredWorkflowDataCaptureForTaskStateWorkflowTransition/{task_id}/{next_state_id}/{job_id}
```

Then submit by updating the attribute on the target entity (e.g. `POST /api/v1/tasks/{id}/attributes`).

## Issue Operations

Issues use `/issue-tracking/`, NOT `/issues`. No `POST /api/v1/issues`. Verify `IssueTicketModel` in Swagger.

```
POST /api/v1/issue-tracking/set-issue       {"issue":{"title":"Clash detected at chainage 1450","description":"Stormwater pipe clashes with foundation beam at CH1450","priority":2,"job_id":{"IDString":"100_1"}}}
POST /api/v1/issue-tracking/issues/get      {"job_id":{"IDString":"100_1"},"page":1,"page_size":50}
POST /api/v1/issue-tracking/delete-issue    {"issue_id":{"IDString":"42_1"}}
```

## Multi-step: complete job setup

Note the specific endpoint names — generic root POSTs do NOT exist.

```
# 1. Read required fields
GET /api/v1/jobs/getStandardAttributes
GET /api/v1/jobs/getDefaultAttributes
# 2. Create the job
POST /api/v1/jobs/create  {"Name":"Bridge Replacement - Waikato","Description":"Full bridge replacement design","Type":0,"Attributes":[{"Name":"ProjectManager","Value":"Jane Smith"},{"Name":"Region","Value":"Waikato"}]}
# 3. Folder structure
POST /api/v1/folders/create  {"Name":"Drawings","ParentFolderID":{"IDString":"{job_root_folder}"}}
POST /api/v1/folders/create  {"Name":"Reports","ParentFolderID":{"IDString":"{job_root_folder}"}}
POST /api/v1/folders/create  {"Name":"Correspondence","ParentFolderID":{"IDString":"{job_root_folder}"}}
# 4. Initial tasks (same POST /api/Tasks for create/update)
POST /api/Tasks  {"name":"Site survey","job_id":{"IDString":"100_1"},"due_date_utc":"2026-04-15T00:00:00Z"}
POST /api/Tasks  {"name":"Concept design review","job_id":{"IDString":"100_1"},"due_date_utc":"2026-05-01T00:00:00Z"}
# 5. Upload documents — multipart via folder/checkout-checkin (see File Operations), not a generic POST /api/v1/files.
```

## Mutation response patterns

- Successful create: returns the created entity with its new EntityID, e.g. `{"ID":{"_id":999,"_server_id":1,"_server_guid":"...","IDString":"999_1"},"Name":"..."}`.
- Successful update: returns the updated entity.
- Successful delete: typically `200 OK` or `204 No Content`.
- Errors: schema [UNKNOWN] — check status code, attempt JSON parse, log raw response, present a user-friendly message. Do not fabricate error schemas.

## Idempotency

- POST (create): NOT idempotent — duplicate calls create duplicates; dedupe client-side.
- PUT (update): idempotent.
- DELETE: idempotent in practice — deleting an already-deleted entity should 404 or similar.
- File checkout: NOT idempotent — re-checkout of an already-checked-out file fails.
- File checkin: NOT idempotent — creates a new version each time.
