---
api_name: 'Google Drive'
api_slug: 'googledrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Google Drive — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`.
>
> ⚠️ **This connector is READ-ONLY.** It is configured with the `drive.readonly` scope, so **no
> write operations are in scope**: no create, rename, move, trash, delete, upload, or permission
> changes. The agent **cannot** mutate Drive through this connector. This file exists to (a) make
> that boundary explicit and (b) document what enabling writes would require, so a future
> read-write variant can be specced quickly. Treat everything below as **out of scope today**.

---

## Write Capabilities Summary (all OUT OF SCOPE under `drive.readonly`)

| Operation            | Supported via connector? | API method (if writes were enabled)                 | Required scope            |
| -------------------- | ------------------------ | --------------------------------------------------- | ------------------------- |
| Create file / folder | **No**                   | `POST /files` (+ upload)                            | `drive.file` or `drive`   |
| Upload content       | **No**                   | `POST /upload/drive/v3/files` (multipart/resumable) | `drive.file` / `drive`    |
| Update metadata      | **No**                   | `PATCH /files/{id}`                                 | `drive.file` / `drive`    |
| Rename               | **No**                   | `PATCH /files/{id}` (`name`)                        | `drive.file` / `drive`    |
| Move (reparent)      | **No**                   | `PATCH /files/{id}?addParents=&removeParents=`      | `drive.file` / `drive`    |
| Copy                 | **No**                   | `POST /files/{id}/copy`                             | `drive.file` / `drive`    |
| Trash / untrash      | **No**                   | `PATCH /files/{id}` (`trashed`)                     | `drive` (or `drive.file`) |
| Permanent delete     | **No**                   | `DELETE /files/{id}`                                | `drive`                   |
| Empty trash          | **No**                   | `DELETE /files/trash`                               | `drive`                   |
| Share / change ACL   | **No**                   | `POST/PATCH/DELETE /files/{id}/permissions`         | `drive` (+ sharing)       |
| Comments / replies   | **No**                   | `POST /files/{id}/comments`                         | `drive` / `drive.file`    |

> The connector's OAuth scope is `https://www.googleapis.com/auth/drive.readonly` (from
> `connectorRegistry.ts`). Any write call would return `403 insufficientPermissions` even if the
> endpoint were invoked. The provider implements only `list_files`, `download_file`,
> `get_file_metadata`, and `search_files` — no write methods exist.

---

## What the agent CAN do instead

When a user asks to "change", "move", "share", or "delete" a Drive file, do **not** attempt it
through this connector. Options:

1. **Download → edit locally → tell the user.** Export/download the file into the workspace, work on
   the copy, and hand the result back to the user to re-upload manually. The original in Drive is
   untouched.
2. **Surface the `webViewLink`.** Give the user the direct Drive URL so they can make the change in
   Google's UI themselves.
3. **Explain the boundary.** State plainly that the Drive connector is read-only and a write-enabled
   integration would need a broader scope + re-consent (and, for restricted scopes, re-verification).

---

## If writes were enabled (reference only — NOT wired up)

> For a future read-write variant. **Do not invoke these today.**

### Create a folder

```http
POST /drive/v3/files
Authorization: Bearer <token>
Content-Type: application/json

{ "name": "New Folder", "mimeType": "application/vnd.google-apps.folder",
  "parents": ["1aBcParentId"] }
```

**Response (200):** the created File resource with a server-assigned `id`.

### Upload a file (multipart)

```http
POST /upload/drive/v3/files?uploadType=multipart
Authorization: Bearer <token>
Content-Type: multipart/related; boundary=BOUNDARY

--BOUNDARY
Content-Type: application/json
{ "name": "report.pdf", "parents": ["1aBcParentId"] }
--BOUNDARY
Content-Type: application/pdf
<raw bytes>
--BOUNDARY--
```

> Note the **different host path** (`/upload/drive/v3/files`) and `uploadType` (`media` /
> `multipart` / `resumable`). Files > 5 MB should use resumable upload.

### Rename / move (PATCH)

```http
PATCH /drive/v3/files/1aBcD3eFgH?addParents=1NewParent&removeParents=1OldParent
Authorization: Bearer <token>
Content-Type: application/json

{ "name": "Renamed.pdf" }
```

> **PATCH is partial** — only the fields in the body change. Moving uses the `addParents` /
> `removeParents` **query params**, not a body field (because `parents` semantics are additive).

### Trash (soft delete) vs permanent delete

```http
# Soft delete (recoverable) — set the trashed flag
PATCH /drive/v3/files/1aBcD3eFgH
{ "trashed": true }

# Permanent delete (irreversible) — bypasses trash
DELETE /drive/v3/files/1aBcD3eFgH
```

---

## Idempotency & Concurrency (for a future write variant)

- **Reads (all current operations) are naturally idempotent.**
- Drive write requests support an `X-Goog-Api-Client`-style retry but **not** a standard
  idempotency key on metadata writes; resumable uploads are the idempotent path for content.
- Optimistic concurrency: pass an `If-Match`/`ETag`-style precondition where supported, or re-GET
  the `version` field and refuse to write if it advanced. [INFERRED — confirm before building writes]

---

## Dangerous Operations

> All are **out of scope today**; listed so a future write variant treats them as confirm-first.

| Operation             | Why Dangerous                                     | Safeguard                               |
| --------------------- | ------------------------------------------------- | --------------------------------------- |
| `DELETE /files/{id}`  | Permanent, irreversible — bypasses trash entirely | Never auto-run; prefer `trashed:true`   |
| `DELETE /files/trash` | Permanently purges all trashed files              | Never auto-run                          |
| Move (reparent)       | Can detach a file from a shared structure         | Confirm source + target with the user   |
| Permission changes    | Can over-share confidential files (e.g. `anyone`) | Confirm grantee + role explicitly       |
| Trash a folder        | Cascades — trashes all descendants                | Confirm and enumerate affected children |

---

## Gotchas & Counter-Exceptions

1. **`drive.readonly` blocks every write** — even a correctly-formed `POST/PATCH/DELETE` returns
   `403 insufficientPermissions`. Don't attempt writes and report a misleading error.
2. **Moving is not a body field** — reparenting uses `addParents`/`removeParents` query params.
3. **PATCH null clears a field; omission leaves it** — relevant only for the hypothetical write
   variant. [INFERRED]

---

_Generated from the investigation questionnaire, Phases 3–4. The Google Drive connector is read-only;
this file documents the write boundary and a forward reference, not active mutations._
