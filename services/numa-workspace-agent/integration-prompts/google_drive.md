# Google Drive Integration

## Essential First Step

Before performing Google Drive operations, establish context:

- If the user has multiple drives, resolve drive via `configure_props` to see available options (My Drive + any Shared Drives)
- For operations in a specific folder, either resolve `folderId`/`parentId` via `configure_props`, or use `find-folder` to search by name
- To work with a specific file, use `find-file` to search by name, then use the returned `id` in subsequent operations

## Auth Structure

Auth key is `googleDrive` (camelCase):

```json
{ "googleDrive": { "authProvisionId": "auto" }, "...other_params": "..." }
```

## Critical Gotchas

- **Searching requires a search term:** Both `nameSearchTerm` and `searchQuery` are marked optional in `find-file` and `find-folder` schemas, but at least one is required. Omitting both returns an error: "You must specify a search query or name."

- **Drive prop defaults to "My Drive" string:** The `drive` prop accepts either the literal string `"My Drive"` for personal drive, or a shared drive ID (e.g., `"0AExf2ajwdD-cUk9PVA"`) from `configure_props`.

- **Downloading files requires stash_id:** Always include `stash_id="NEW"` when calling `google_drive-download-file`. The downloaded file lands in `/workdir/tmp/integrations-results/` (scratch — invisible to the user). If the user asked for the file as a deliverable, `cp` it to `/workdir/outputs/`.

- **Google Workspace files need export format:** When downloading Google Docs, Sheets, or Slides, resolve `mimeType` via `configure_props` (with `fileId` set) to see available export formats. Common options:
  - `application/pdf`
  - `text/plain`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (Word)

- **Uploading & replacing files — ALWAYS use the action, NEVER the raw API:** To upload a NEW file use `google_drive-upload-file`; to REPLACE the contents of an EXISTING file (keeps the same `fileId` and Drive version history) use `google_drive-update-file`. In both, pass the workspace path in `filePath` (e.g., `/workdir/uploads/report.pdf`) — the system converts it to a presigned URL and streams the real bytes. **Never upload or overwrite a file via `proxy_request` or a raw `googleapis.com/upload/...` URL.** `proxy_request` sends a JSON body, not multipart media, so it overwrites the file with a tiny JSON blob and destroys it (this has actually happened — it is not hypothetical).

- **Folder prop naming varies by action:** Upload uses `parentId`, move uses `folderId`, `list-files` uses `folderId`. Always check the schema for the correct prop name.

- **Sharing files has conditional props:** In `google_drive-add-file-sharing-preference`, you must set `useFileOrFolder` to either `"File"` or `"Folder"` first, then provide the corresponding `fileId` or `folderId`. The `type` prop (`user`, `group`, `domain`, `anyone`) may reveal additional required props.

- **Delete vs Trash:** `google_drive-delete-file` permanently deletes (no recovery). Use `google_drive-move-file-to-trash` for recoverable deletion. Both work on files AND folders.

- **File IDs from search results:** Actions like `find-file`, `find-folder`, and `list-files` return arrays with objects containing `id`, `name`, and `mimeType`. Use the `id` value for subsequent operations.

## Example: Download a File

```json
{
  "googleDrive": { "authProvisionId": "auto" },
  "fileId": "abc123",
  "stash_id": "NEW"
}
```

## Example: Upload a File

```json
{
  "googleDrive": { "authProvisionId": "auto" },
  "parentId": "folder-id-here",
  "filePath": "/workdir/uploads/report.pdf",
  "name": "My Report.pdf"
}
```

## Example: Replace an Existing File's Contents

Use this to write changes back to a file you downloaded and edited locally. It
keeps the same `fileId` and Drive version history:

```json
{
  "googleDrive": { "authProvisionId": "auto" },
  "fileId": "abc123",
  "filePath": "/workdir/tmp/report_updated.pdf"
}
```

## Never Use proxy_request for Files

`proxy_request` (the raw "API Request" tool) is unsafe for binary in BOTH
directions and will silently corrupt files:

- **Uploads:** it sends a JSON body, not multipart media — the upstream stores
  the JSON instead of your file. Use `google_drive-upload-file` (new) or
  `google_drive-update-file` (overwrite existing).
- **Downloads / revisions:** fetch bytes via `google_drive-download-file` (with
  `stash_id="NEW"`). Do not pull file or revision bytes through `proxy_request`.

After any upload or update, verify it (re-list or re-download and check the size
and mimeType) before telling the user it is done.

## When to Use What

- **"Find a file called X"** -> `find-file` with `nameSearchTerm`
- **"Find a folder called X"** -> `find-folder` with `nameSearchTerm`
- **"List files in folder X"** -> `list-files` with `folderId`
- **"Download this file"** -> `google_drive-download-file` with `stash_id="NEW"`
- **"Upload a new file"** -> `google_drive-upload-file` with workspace path in `filePath`
- **"Update / overwrite an existing file"** -> `google_drive-update-file` with `fileId` + workspace path in `filePath` (preserves version history)
- **"Share file with someone"** -> `google_drive-add-file-sharing-preference`
- **"Move file to trash"** -> `google_drive-move-file-to-trash` (recoverable)
- **"Permanently delete"** -> `google_drive-delete-file` (irreversible)
