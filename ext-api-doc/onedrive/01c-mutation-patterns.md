---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
companion_of: 01-llm-api-rules.md
scope: mutations — N/A, connector is READ-ONLY
confidence: confirmed read-only against shipped provider unless tagged [DOCUMENTED]
---

# OneDrive — Mutation Patterns Reference

## ⛔ READ-ONLY connector — NO mutations in scope

Authenticates with **`Files.Read.All`** only. Shipped provider (`lib/oauth-providers/oauth_providers/onedrive_provider.py`) implements only `list_files`, `download_file`, `get_file_metadata`, `search_files`. **No write method exists.** Any create/update/move/copy/delete/upload → `403 accessDenied` (insufficient scope) — and there is no proxy/provider code path to even issue such a request. `403 accessDenied` on a write is **expected, not a bug** — don't retry; surface "OneDrive is connected read-only."

**If the user asks to create, edit, move, or delete a OneDrive file:** explain the integration is read-only (browse, search, download, inspect metadata). Do not attempt a write.

This file documents the boundary (what Graph _can_ do, FOR REFERENCE ONLY — not wired) and what adding writes would require.

## Not exposed by this connector

| Operation           | Why                                             |
| ------------------- | ----------------------------------------------- |
| Create folder       | no write scope; no provider method              |
| Upload file         | no write scope; no provider method              |
| Update metadata     | no write scope; no provider method              |
| Move / copy         | no write scope; no provider method              |
| Delete              | no write scope; no provider method              |
| Share / permissions | requires `Files.ReadWrite.All` + `/permissions` |

## Graph write APIs (REFERENCE ONLY — out of scope) [DOCUMENTED]

Each would require switching the connector to `Files.ReadWrite` / `Files.ReadWrite.All` and adding provider methods.

**Create folder:** `POST /me/drive/items/{parent-id}/children` body `{"name":"New Folder","folder":{},"@microsoft.graph.conflictBehavior":"rename"}`
**Upload small (≤ 4 MB):** `PUT /me/drive/items/{parent-id}:/{filename}:/content` with `<file bytes>`
**Upload large (> 4 MB), resumable:** `POST /me/drive/items/{parent-id}:/{filename}:/createUploadSession` body `{"item":{"@microsoft.graph.conflictBehavior":"replace"}}` → then `PUT` byte ranges to the returned `uploadUrl` with `Content-Range` headers
**Update metadata (rename/move):** `PATCH /me/drive/items/{id}` body `{"name":"Renamed.xlsx","parentReference":{"id":"{new-parent-id}"}}`
**Delete (→ recycle bin):** `DELETE /me/drive/items/{id}`
**Create sharing link:** `POST /me/drive/items/{id}/createLink` body `{"type":"view","scope":"organization"}`

## Concurrency control (only if writes added later)

| Header                              | Effect                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `if-match: {eTag}`                  | apply write only if item unchanged; else `412 Precondition Failed` |
| `if-none-match: {eTag}`             | create-only / cache-validate; on reads → `304 Not Modified`        |
| `@microsoft.graph.conflictBehavior` | `fail` / `replace` / `rename` on name collisions                   |

## Dangerous operations (blocked now; confirm with user IF a read/write variant is ever built)

| Operation                      | Why dangerous                                 | Safeguard                                     |
| ------------------------------ | --------------------------------------------- | --------------------------------------------- |
| `DELETE /me/drive/items/{id}`  | removes file/folder (recycle bin, then purge) | confirm; consider scope of delete             |
| `PATCH parentReference` (move) | relocates item; breaks existing links         | confirm target folder                         |
| `PUT …/content` (replace)      | overwrites file content                       | confirm; prefer `conflictBehavior: rename`    |
| `POST …/createLink` (share)    | exposes content outside the org               | confirm scope (`anonymous` vs `organization`) |

## Notes

- Upload is two different APIs by size (≤ 4 MB simple `PUT` vs resumable session) — noted so a future implementer doesn't assume one path.
- Content beyond the read-only boundary is reference-only and not exposed by Numa.
