---
api_name: Google Drive
api_slug: googledrive
companion_of: 01-llm-api-rules.md
base_url: https://www.googleapis.com/drive/v3
call_surface: file-store connector (list-files/search-files/download-file); NOT `numa integrations request`
status: READ-ONLY connector (scope drive.readonly) — NO writes in scope. This file documents the write boundary + what a future read-write variant would need. Everything below is OUT OF SCOPE today.
confidence: doc-based [DOCUMENTED] unless tagged [INFERRED]
source_phases: Phase 3 (Domain Model), Phase 4 (Endpoint Catalog)
---

# Google Drive — Mutation Patterns Reference (read-only boundary)

The connector uses scope `https://www.googleapis.com/auth/drive.readonly` (from `connectorRegistry.ts`). **No** create, rename, move, trash, delete, upload, or permission changes are in scope. Any write call returns `403 insufficientPermissions` even if formed correctly. The provider implements only `list_files`, `download_file`, `get_file_metadata`, `search_files` — no write methods exist.

## Write Capabilities (ALL OUT OF SCOPE under `drive.readonly`)

| Operation          | Via connector? | API method if writes enabled                        | Required scope            |
| ------------------ | -------------- | --------------------------------------------------- | ------------------------- |
| Create file/folder | No             | `POST /files` (+ upload)                            | `drive.file` or `drive`   |
| Upload content     | No             | `POST /upload/drive/v3/files` (multipart/resumable) | `drive.file` / `drive`    |
| Update metadata    | No             | `PATCH /files/{id}`                                 | `drive.file` / `drive`    |
| Rename             | No             | `PATCH /files/{id}` (`name`)                        | `drive.file` / `drive`    |
| Move (reparent)    | No             | `PATCH /files/{id}?addParents=&removeParents=`      | `drive.file` / `drive`    |
| Copy               | No             | `POST /files/{id}/copy`                             | `drive.file` / `drive`    |
| Trash / untrash    | No             | `PATCH /files/{id}` (`trashed`)                     | `drive` (or `drive.file`) |
| Permanent delete   | No             | `DELETE /files/{id}`                                | `drive`                   |
| Empty trash        | No             | `DELETE /files/trash`                               | `drive`                   |
| Share / change ACL | No             | `POST/PATCH/DELETE /files/{id}/permissions`         | `drive` (+ sharing)       |
| Comments / replies | No             | `POST /files/{id}/comments`                         | `drive` / `drive.file`    |

## What the agent CAN do instead

On a "change/move/share/delete" request, do NOT attempt it via this connector:

1. **Download → edit locally → hand back.** Export/download into the workspace, work on the copy, return result for the user to re-upload manually. The Drive original is untouched.
2. **Surface the `webViewLink`** so the user makes the change in Google's UI.
3. **Explain the boundary.** This connector is read-only; a write-enabled integration needs a broader scope + re-consent (and, for restricted scopes, re-verification).

## If writes were enabled (reference only — NOT wired up; do NOT invoke today)

**Create a folder** → response 200 = created File with server-assigned `id`:
`POST /drive/v3/files` + `Content-Type: application/json`
`{"name":"New Folder","mimeType":"application/vnd.google-apps.folder","parents":["1aBcParentId"]}`

**Upload a file (multipart)** — NOTE different host path (`/upload/drive/v3/files`) + `uploadType` (`media`/`multipart`/`resumable`); files > 5 MB should use resumable:
`POST /upload/drive/v3/files?uploadType=multipart` + `Content-Type: multipart/related; boundary=BOUNDARY`, parts = `{"name":"report.pdf","parents":["1aBcParentId"]}` then raw PDF bytes.

**Rename/move (PATCH)** — PATCH is partial (only body fields change). Moving uses `addParents`/`removeParents` **query params**, not a body field (`parents` semantics are additive):
`PATCH /drive/v3/files/1aBcD3eFgH?addParents=1NewParent&removeParents=1OldParent` body `{"name":"Renamed.pdf"}`

**Trash (soft, recoverable) vs permanent delete:**
`PATCH /drive/v3/files/1aBcD3eFgH` body `{"trashed":true}` (soft)
`DELETE /drive/v3/files/1aBcD3eFgH` (permanent, bypasses trash)

## Idempotency & Concurrency (future write variant)

- Reads (all current operations) are naturally idempotent.
- Drive metadata writes have **no** standard idempotency key; resumable uploads are the idempotent path for content.
- Optimistic concurrency: pass an `If-Match`/`ETag`-style precondition where supported, or re-GET `version` and refuse to write if it advanced. [INFERRED — confirm before building writes]

## Dangerous Operations (out of scope today; future variant must treat as confirm-first)

| Operation             | Why dangerous                                     | Safeguard                             |
| --------------------- | ------------------------------------------------- | ------------------------------------- |
| `DELETE /files/{id}`  | Permanent, irreversible — bypasses trash          | Never auto-run; prefer `trashed:true` |
| `DELETE /files/trash` | Purges all trashed files                          | Never auto-run                        |
| Move (reparent)       | Can detach from a shared structure                | Confirm source + target               |
| Permission changes    | Can over-share confidential files (e.g. `anyone`) | Confirm grantee + role explicitly     |
| Trash a folder        | Cascades — trashes all descendants                | Confirm + enumerate affected children |

## Notes

- PATCH null clears a field; omission leaves it — relevant only to the hypothetical write variant. [INFERRED]
