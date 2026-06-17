---
api_name: Dropbox
api_slug: dropbox
doc: mutation-patterns (companion to 01-llm-api-rules.md)
status: ⚠️ READ-ONLY CONNECTOR — NO MUTATIONS. This file documents the deliberate absence of writes and the requirements of any future extension.
confidence: facts [DOCUMENTED]; provider-verified 🛠️ where noted.
---

# Dropbox — Mutation Patterns (none — read-only)

Connector requests only `files.metadata.read files.content.read`. It cannot upload, move, rename, delete, or share. **Do not attempt writes** — they fail with `401 missing_scope` (or `409`), and even on success would fall outside user consent. If a user asks to modify a Dropbox file: tell them this integration is read-only — change it in Dropbox directly, or an admin must extend the connector's scopes (below).

## Write capabilities (all out of scope here)

| Operation                      | Supported | Dropbox endpoint (if scopes added)               | Needs                 |
| ------------------------------ | --------- | ------------------------------------------------ | --------------------- |
| Create / upload                | No        | `content/2/files/upload`                         | `files.content.write` |
| Upload large/chunked (>150 MB) | No        | `content/2/files/upload_session/*`               | `files.content.write` |
| Update content (overwrite)     | No        | `content/2/files/upload` (`mode:overwrite`)      | `files.content.write` |
| Move / rename                  | No        | `api/2/files/move_v2`                            | `files.content.write` |
| Copy                           | No        | `api/2/files/copy_v2`                            | `files.content.write` |
| Delete                         | No        | `api/2/files/delete_v2`                          | `files.content.write` |
| Create folder                  | No        | `api/2/files/create_folder_v2`                   | `files.content.write` |
| Create shared link             | No        | `api/2/sharing/create_shared_link_with_settings` | `sharing.write`       |
| Restore a revision             | No        | `api/2/files/restore`                            | `files.content.write` |

## Why writes fail today

- **Scope:** OAuth grant is read-only. A write returns `401` with `error_summary` `missing_scope/...` — refreshing the token will NOT fix it (the scope was never granted).
- **Consent:** the user authorized read access only; writing exceeds consent.
- **No provider methods:** `dropbox_provider.py` implements only `list_files`, `download_file`, `get_file_metadata`, `search_files` — no `upload_file`/`delete_file` code path. 🛠️

## What an extension would require (reference only — do NOT implement ad hoc; architectural change for a human to decide)

1. **Add scopes** to the registry entry (`files.content.write`, plus `sharing.write` for links) and re-consent every connected user — adding a scope invalidates existing grants until re-authorized.
2. **Implement provider methods** (`upload_file`, `delete_file`, etc.) on `DropboxProvider`.
3. **Handle the two-host model** — uploads go to `content.dropboxapi.com` with args in the `Dropbox-API-Arg` header and bytes as the raw body (mirror of download), NOT a JSON body on the api host.
4. **Wire HITL confirmation** for destructive ops (delete/move/overwrite) — see Dangerous Operations.

### Illustrative write shapes (documented Dropbox shapes; NOT callable through this connector)

- **Upload (overwrite):** `POST content/2/files/upload`, header `Dropbox-API-Arg: {"path":"/Reports/Q1.pdf","mode":"overwrite","autorename":false,"mute":false}`, body=raw bytes. Returns new `FileMetadata` (fresh `rev`).
- **Delete:** `POST api/2/files/delete_v2 {"path":"/Reports/old.pdf"}`. Returns deleted item's metadata. Soft-deletable/restorable for a retention window via `/2/files/restore`.
- **Move/rename:** `POST api/2/files/move_v2 {"from_path":"/a/x.pdf","to_path":"/b/x.pdf"}`.
- **Batch writes:** `*_batch` variants (`delete_batch`, `move_batch_v2`, `copy_batch_v2`) run **asynchronously** — return an `async_job_id`; poll `*/check` until `.tag:"complete"` with per-item `success`/`failure`. Partial failure is normal; inspect each item.

## Optimistic concurrency (if writes are ever added)

Dropbox uses `rev` for content-write concurrency: `upload` with `mode:{".tag":"update","update":"<expected_rev>"}` writes only if the file's current `rev` still matches — otherwise it `autorename`s a conflict copy or errors (prevents lost updates). Safe overwrite-if-unchanged: `get_metadata` → capture `rev` → `upload` with that expected `rev`; on conflict, re-read and reconcile.

## Dangerous operations (would-be; connector cannot perform these — listed so any future write capability is treated with caution and always asks the user first)

| Operation                  | Why dangerous                            | Required safeguard                                 |
| -------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `delete_v2`/`delete_batch` | removes files; cascades on folders       | explicit user confirmation; prefer move-to-archive |
| `upload` `mode:overwrite`  | replaces content, bumps `rev`            | confirm; use expected-`rev` update mode            |
| `move_v2`/rename           | breaks path-based ids and external links | confirm; warn connector ids will change            |
| `create_shared_link`       | exposes a file outside the org           | confirm audience/expiry/password                   |

## Gotchas

1. A read `200` is NOT license to write — the same token cannot write; the scope isn't there.
2. A write `401` is a **scope** problem, not a token problem — do NOT "retry after refresh" (refresh yields the same read-only token). Report the limitation.
3. If writes are added later, uploads use the content host + header arg (like download), not a JSON body on the api host — a common mistake.
