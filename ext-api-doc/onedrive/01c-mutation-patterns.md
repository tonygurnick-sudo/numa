---
api_name: 'OneDrive (Microsoft Graph)'
api_slug: 'onedrive'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases:
  ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog', 'Phase 9: Platform Integration Assessment']
---

# OneDrive (Microsoft Graph) — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operations: create, update, delete, upload.
>
> ## ⛔ This connector is READ-ONLY. There are no mutations in scope.
>
> The OneDrive connector authenticates with **`Files.Read.All`** only, and the shipped provider
> (`lib/oauth-providers/oauth_providers/onedrive_provider.py`) implements **only** `list_files`,
> `download_file`, `get_file_metadata`, and `search_files`. **No write method exists.** Any attempt
> to create, update, move, copy, delete, or upload will fail at the API with `403 accessDenied`
> (insufficient scope) — and there is no proxy/provider code path to even issue such a request.
>
> This file exists for completeness and to document **what Graph _can_ do** (so the boundary is
> explicit) and **what it would take** to add writes later. Do not present any of the operations
> below to the user as available. [CONFIRMED — read-only]

---

## Write Capabilities Summary (as exposed by THIS connector)

| Operation           | Exposed by connector? | Why                                             |
| ------------------- | --------------------- | ----------------------------------------------- |
| Create folder       | ❌ No                 | No write scope; no provider method              |
| Upload file         | ❌ No                 | No write scope; no provider method              |
| Update metadata     | ❌ No                 | No write scope; no provider method              |
| Move / copy         | ❌ No                 | No write scope; no provider method              |
| Delete              | ❌ No                 | No write scope; no provider method              |
| Share / permissions | ❌ No                 | Requires `Files.ReadWrite.All` + `/permissions` |

**If the user asks to create, edit, move, or delete a OneDrive file:** explain that the OneDrive
integration is **read-only** (browse, search, download, inspect metadata). Do not attempt a write.

---

## What Graph supports (FOR REFERENCE ONLY — not wired)

> These are documented Microsoft Graph capabilities. They are **out of scope** and would each
> require switching the connector to a read/write scope (`Files.ReadWrite` / `Files.ReadWrite.All`)
> and adding provider methods. Listed so the limitation is concrete, not vague. [DOCUMENTED]

### Create a folder

```http
POST /me/drive/items/{parent-id}/children
Content-Type: application/json

{ "name": "New Folder", "folder": {}, "@microsoft.graph.conflictBehavior": "rename" }
```

### Upload a small file (≤ 4 MB)

```http
PUT /me/drive/items/{parent-id}:/{filename}:/content
Content-Type: text/plain

<file bytes>
```

### Upload a large file (> 4 MB) — resumable upload session

```http
POST /me/drive/items/{parent-id}:/{filename}:/createUploadSession
{ "item": { "@microsoft.graph.conflictBehavior": "replace" } }
```

…then `PUT` byte ranges to the returned `uploadUrl` with `Content-Range` headers.

### Update metadata (rename / move)

```http
PATCH /me/drive/items/{id}
Content-Type: application/json

{ "name": "Renamed.xlsx", "parentReference": { "id": "{new-parent-id}" } }
```

### Delete (to recycle bin)

```http
DELETE /me/drive/items/{id}
```

### Create a sharing link

```http
POST /me/drive/items/{id}/createLink
{ "type": "view", "scope": "organization" }
```

---

## Concurrency control (if writes were ever added)

Graph supports optimistic concurrency on writes via conditional headers — relevant only if a
read/write variant of this connector is built later:

| Header                              | Effect                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `if-match: {eTag}`                  | Apply the write **only if** the item is unchanged; else `412 Precondition Failed` |
| `if-none-match: {eTag}`             | Create-only / cache-validate; on reads → `304 Not Modified`                       |
| `@microsoft.graph.conflictBehavior` | `fail` / `replace` / `rename` on name collisions                                  |

---

## Dangerous Operations

> All of the following are **blocked** in the current connector (no write scope). If a read/write
> variant is ever introduced, confirm with the user before executing these.

| Operation                      | Why Dangerous                                   | Safeguard                                     |
| ------------------------------ | ----------------------------------------------- | --------------------------------------------- |
| `DELETE /me/drive/items/{id}`  | Removes a file/folder (recycle bin, then purge) | Confirm with user; consider scope of delete   |
| `PATCH parentReference` (move) | Relocates an item; breaks existing links        | Confirm target folder with user               |
| `PUT …/content` (replace)      | Overwrites file content                         | Confirm + prefer `conflictBehavior: rename`   |
| `POST …/createLink` (share)    | Exposes content outside the org                 | Confirm scope (`anonymous` vs `organization`) |

---

## Gotchas & Counter-Exceptions

1. **`403 accessDenied` on any write is expected, not a bug** — the connector holds a read-only
   token. Don't retry; surface "OneDrive is connected read-only."
2. **There is no provider method to call for writes** — even if you constructed a write request, the
   Files Remote layer exposes only browse/search/download/metadata.
3. **Upload is two different APIs by size** (≤ 4 MB simple `PUT` vs resumable session) — noted only
   so a future implementer doesn't assume one path.

---

_Generated from the investigation questionnaire, Phases 3–4 & 9. Connector is read-only — content
beyond the read-only boundary is reference-only and not exposed by Numa._
