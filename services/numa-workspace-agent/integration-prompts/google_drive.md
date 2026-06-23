# Google Drive Integration Tips

All Google Drive calls go through the `numa integrations` CLI. Action keys below
are real (`numa integrations pipedream-actions google_drive` lists them). The
auth prop is always required — pass `"googleDrive": {"authProvisionId": "auto"}`
and the proxy resolves the connected account.

Google Drive also has native file-browse commands — `numa integrations
list-files google_drive ...` and `numa integrations download-file google_drive
...` — handy for quick browsing without going through Pipedream actions.

## ⚠️ Upload paths: `/workdir/outputs/` (or `/workdir/uploads/`), never `/workdir/tmp/`

Any file-bearing prop (`filePath` on `upload-file`/`update-file`, and any
`file-ref` prop on any integration) must point at a path under **`/workdir/outputs/`**
or **`/workdir/uploads/`**. Only those directories sync to S3, which is where the
proxy fetches the bytes from. A **`/workdir/tmp/` path fails** with
`Could not resolve workspace file '...' for prop 'filePath'` — tmp is local-only
scratch and never reaches S3. Since downloads land in
`/workdir/tmp/integrations-results/`, you must **`cp` to `/workdir/outputs/`
before re-uploading**:

```bash
cp /workdir/tmp/integrations-results/report.pdf /workdir/outputs/report.pdf
# then use /workdir/outputs/report.pdf as filePath
```

## Searching & discovery

- **`find-file` / `find-folder` need a search term.** Both `nameSearchTerm` and `searchQuery` read optional, but omitting both errors: "You must specify a search query or name." Use `nameSearchTerm` for name-only; `searchQuery` for Drive query language.
- **`search-files` is the power tool** — a full Drive query string (`name contains 'Budget'`, `'FOLDER_ID' in parents`, `trashed = false`, mimeType/date filters, booleans). Prefer it over `find-file` for anything beyond a simple name match. Pass `driveId` to scope to a shared drive, or `includeItemsFromAllDrives: true` to span all drives.
- **`find-spreadsheets`** returns a bonus `url` field (direct Sheets link) the other finders don't.
- **`get-folder-id-for-path`** resolves slash-separated **My Drive** folder paths (`"Projects/2026/Q1"`) to an ID — but it **returns `status: success` with no `ret` field when the path doesn't exist** (and can't resolve shared-drive roots by name). **Check for `ret` in the response**, not just status, or you'll proceed with an undefined folder ID.
- **`get-file` vs `get-file-by-id`** return identical data — only the `fields` param differs (`get-file` takes a flexible string; `get-file-by-id` an enum array). Prefer `get-file`.

## Auth + props-options

```bash
numa integrations pipedream-call google_drive google_drive-find-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"nameSearchTerm":"report"}' -m "Find a file"

numa integrations pipedream-props-options google_drive google_drive-download-file mimeType \
  --google_drive '{"authProvisionId":"auto"}' --props '{"fileId":"abc123"}' -m "List export formats"
```

## Folder-destination prop name varies by action

| Action                                                                      | Destination prop |
| --------------------------------------------------------------------------- | ---------------- |
| `upload-file`, `create-folder`, `create-text-file`, `create-file-from-text` | `parentId`       |
| `move-file`, `list-files`                                                   | `folderId`       |

Check the schema if unsure (`numa integrations pipedream-props google_drive <action>`).

## Uploading & replacing — use the action, never a raw request

- New file → `upload-file` (`parentId` + `filePath`). Replace an existing file's contents → `update-file` (`fileId` + `filePath`; keeps the same `fileId` and version history). `upload-file` also has a hidden `fileId` prop that can replace, but `update-file` is the explicit, version-preserving path.
- **Never upload/overwrite via `numa integrations request`** or a raw `googleapis.com/upload/...` URL — a raw request sends a JSON body, not multipart media, so it overwrites the file with a tiny JSON blob and destroys it (this has actually happened — not hypothetical).
- After any upload/update, verify (re-list or re-download, check size + mimeType) before reporting done.

```bash
numa integrations pipedream-call google_drive google_drive-update-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"fileId":"abc123","filePath":"/workdir/outputs/report_updated.pdf"}' \
  -m "Replace a Drive file's contents"
```

## Creating text files makes Google **Docs**, not plain text

`create-text-file` and `create-file-from-text` both produce a Google Doc
(`application/vnd.google-apps.document`) and strip the `.txt` extension from the
name — regardless of what you set. To put a real `.txt`/binary file in Drive, use
`upload-file` with a file under `/workdir/outputs/`.

## Downloading

```bash
numa integrations pipedream-call google_drive google_drive-download-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"fileId":"abc123"}' \
  --stash-id NEW -m "Download a Drive file"
```

`--stash-id NEW` is required; the file is delivered automatically — reference the
`downloaded_files` path (default `/workdir/tmp/integrations-results/`, scratch).
`cp` to `/workdir/outputs/` if the user wants it as a deliverable. **Google
Workspace files need an export format** — resolve `mimeType` via
`pipedream-props-options` (with `fileId` set): Docs→`.docx`, Sheets→`.xlsx`,
Slides→`.pptx`, or `application/pdf` / `text/plain`.

## Trash / delete / copy

- **`trash-file`** (newer, simpler — takes only `fileId`, no `drive` prop) or **`move-file-to-trash`** (older, has a `drive` prop for shared-drive scoping) — both recoverable, both return metadata with `trashed: true`.
- **`delete-file`** — permanent, no confirmation, works on folders too (deletes contents). Irreversible.
- **`copy-file`** takes only `fileId` (+ optional `drive`) — the copy lands in the **same folder** as the original; `move-file` it afterward if you need it elsewhere.

## Sharing & permissions

- **`share-file`** (newer, cleaner) — `fileId`, `type` (`user`/`group`/`domain`/`anyone`), `role` (`reader`/`commenter`/`writer`), `emailAddress` (for user/group). Prefer it over the older `add-file-sharing-preference` (which gates on `useFileOrFolder` first). Sharing with your own email returns your existing owner permission silently (harmless).
- **`list-permissions`** (`fileId`) → `id`, `type`, `emailAddress`, `role` per permission.

## Comments — `drive` is **required**

`add-comment` and `list-comments` mark `drive` as **required** (not optional, unlike
most actions) — pass it even for My Drive (`"My Drive"` or a drive value from
`pipedream-props-options`). `add-comment` also takes `fileId`, `content`, and an
optional `anchor`.

## Shared drives

- `list-shared-drives` enumerates the account's shared drives (each with its `id`).
- Search within one: pass its `driveId` to `search-files`. Across all: `includeItemsFromAllDrives: true`.
- Shared-drive items carry `driveId` (and a duplicate `teamDriveId`) in results.
- The `drive` prop on most actions accepts the literal `"My Drive"` or a shared-drive ID.

## Direct API requests

Use `numa integrations request google_drive` for bulk/paginated fetches (the
actions strip `nextPageToken`), operations no action covers, or fine field
selection. No special headers needed (unlike Notion). URL-encode the query
(`'`→`%27`, `=`→`%3D`):

```bash
numa integrations request google_drive GET \
  "https://www.googleapis.com/drive/v3/files?q=%27FOLDER_ID%27+in+parents&fields=files(id,name,mimeType)&pageSize=100" \
  -m "List folder contents (paginate via nextPageToken)"
```
