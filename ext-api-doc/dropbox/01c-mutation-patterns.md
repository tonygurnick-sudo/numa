---
api_name: 'Dropbox'
api_slug: 'dropbox'
generated_from: '00-api-investigation-questionnaire'
generated_date: '2026-05-29'
source_phases: ['Phase 3: Domain Model & Behavior', 'Phase 4: Endpoint Catalog']
---

# Dropbox — Mutation Patterns Reference

> Companion to `01-llm-api-rules.md`. Write operations: create, update, delete.
>
> ## ⚠️ This connector is READ-ONLY — there are no mutations.
>
> The connector requests only `files.metadata.read` and `files.content.read`. It cannot upload,
> move, rename, delete, or share anything. **Do not attempt write operations** — they will fail
> with `401 missing_scope` (or `409`), and even if they succeeded they would fall outside what the
> user consented to. If a user asks to modify a file in Dropbox, tell them this integration is
> read-only and they must make the change in Dropbox directly (or an admin must extend the
> connector's scopes — see below).

---

## Write Capabilities Summary

| Operation                  | Supported here | Dropbox endpoint (if scopes added)            | Notes                       |
| -------------------------- | -------------- | --------------------------------------------- | --------------------------- |
| Create / upload            | **No**         | `/2/files/upload` (content host)              | Needs `files.content.write` |
| Upload (large/chunked)     | **No**         | `/2/files/upload_session/*`                   | For files > 150 MB          |
| Update content (overwrite) | **No**         | `/2/files/upload` (`mode: overwrite`)         | Needs `files.content.write` |
| Move / rename              | **No**         | `/2/files/move_v2`                            | Needs `files.content.write` |
| Copy                       | **No**         | `/2/files/copy_v2`                            | Needs `files.content.write` |
| Delete                     | **No**         | `/2/files/delete_v2`                          | Needs `files.content.write` |
| Create folder              | **No**         | `/2/files/create_folder_v2`                   | Needs `files.content.write` |
| Create shared link         | **No**         | `/2/sharing/create_shared_link_with_settings` | Needs `sharing.write`       |
| Restore a revision         | **No**         | `/2/files/restore`                            | Needs `files.content.write` |

Everything above is **out of scope for this connector.** The sections below exist only so the agent
understands _why_ a write fails and what an extension would entail — not as an invitation to try.

---

## Why writes fail today

- **Scope:** the OAuth grant is read-only (`files.metadata.read files.content.read`). A write call
  returns `401` with `error_summary` like `missing_scope/...` (the token lacks the capability),
  not a generic auth error. Refreshing the token will **not** fix it — the scope was never granted.
- **Consent:** the user authorized read access only. Writing would exceed consent.
- **No provider methods:** `dropbox_provider.py` implements only `list_files`, `download_file`,
  `get_file_metadata`, and `search_files`. There is no `upload_file`/`delete_file` code path. 🛠️

---

## What an extension would require (reference only — do not implement ad hoc)

Extending Dropbox to support writes is an **architectural change** that must be decided by a human,
not improvised by the agent. It would involve:

1. **Add scopes** to the registry entry (`files.content.write`, and `sharing.write` for links) and
   re-consent every connected user — adding a scope invalidates existing grants until re-authorized.
2. **Implement provider methods** (`upload_file`, `delete_file`, etc.) on `DropboxProvider`.
3. **Handle the two-host model** — uploads go to `content.dropboxapi.com` with the args in the
   `Dropbox-API-Arg` header and the bytes as the raw body (mirror of download).
4. **Wire HITL confirmation** for destructive ops (delete/move/overwrite) — see Dangerous
   Operations below.

### Illustrative write shapes (for context only)

> These are documented Dropbox shapes. They are **not callable** through this connector.

**Upload (overwrite):** `POST content.dropboxapi.com/2/files/upload`, header
`Dropbox-API-Arg: {"path":"/Reports/Q1.pdf","mode":"overwrite","autorename":false,"mute":false}`,
body = raw bytes. Returns the new `FileMetadata` (with a fresh `rev`).

**Delete:** `POST api.dropboxapi.com/2/files/delete_v2 { "path": "/Reports/old.pdf" }`. Returns the
deleted item's metadata. Soft-deletable/restorable for a retention window via `/2/files/restore`.

**Move/rename:** `POST /2/files/move_v2 { "from_path": "/a/x.pdf", "to_path": "/b/x.pdf" }`.

**Batch writes:** `*_batch` variants (`delete_batch`, `move_batch_v2`, `copy_batch_v2`) run
**asynchronously** — they return an `async_job_id`, and you poll `*/check` until the job reports
`.tag: "complete"` with per-item `success`/`failure` results. Partial failure is normal; inspect
each item. [DOCUMENTED]

---

## Optimistic Concurrency (if writes are ever added)

Dropbox uses `rev` for optimistic concurrency on content writes:

- `upload` with `mode: { ".tag": "update", "update": "<expected_rev>" }` writes only if the file's
  current `rev` still matches — otherwise it `autorename`s a conflict copy or errors. This prevents
  lost updates. [DOCUMENTED]
- For a safe overwrite-if-unchanged flow: `get_metadata` → capture `rev` → `upload` with that
  expected `rev`. If it conflicts, re-read and reconcile.

---

## Dangerous Operations (would-be, if writes existed)

> The connector cannot perform these. Listed so the agent treats any future write capability with
> the right caution and always asks the user first.

| Operation                    | Why dangerous                            | Required safeguard                                 |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `delete_v2` / `delete_batch` | Removes files; cascades on folders       | Explicit user confirmation; prefer move-to-archive |
| `upload` `mode:overwrite`    | Replaces content, bumps `rev`            | Confirm; use expected-`rev` update mode            |
| `move_v2` / rename           | Breaks path-based ids and external links | Confirm; warn that connector ids will change       |
| `create_shared_link`         | Exposes a file outside the org           | Confirm audience/expiry/password                   |

---

## Gotchas & Counter-Exceptions

1. **Do not interpret a read 200 as license to write** — the same token cannot write; the scope
   isn't there.
2. **A write `401` is a scope problem, not a token problem** — do not "retry after refresh"; the
   refresh yields the same read-only token. Report the limitation instead.
3. **If writes are added later, uploads use the content host + header arg** (like download), not a
   JSON body on the api host — a common mistake.

---

_Generated from the investigation questionnaire, Phases 3–4. The connector is read-only; this file
documents the deliberate absence of mutations and the requirements for any future extension._
