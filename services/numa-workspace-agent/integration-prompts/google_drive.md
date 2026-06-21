# Google Drive Integration

All Google Drive calls go through the `numa integrations` CLI. Action keys below
are real (`numa integrations pipedream-actions google_drive` lists them). The
auth prop is always required — pass `"googleDrive": {"authProvisionId": "auto"}`
and the proxy resolves the user's connected account.

Google Drive also has native file-browse commands — `numa integrations
list-files google_drive ...` and `numa integrations download-file google_drive
...` — handy for quick browsing without going through Pipedream actions.

## Essential First Step

Before performing Google Drive operations, establish context:

- If the user has multiple drives, resolve the `drive` prop via `pipedream-props-options` to see available options (My Drive + any Shared Drives)
- For operations in a specific folder, either resolve `folderId`/`parentId` via `pipedream-props-options`, or use `find-folder` to search by name
- To work with a specific file, use `find-file` to search by name, then use the returned `id` in subsequent operations

## Auth Structure

Auth key is `googleDrive` (camelCase):

```bash
numa integrations pipedream-call google_drive google_drive-find-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"nameSearchTerm":"report"}' \
  -m "Finding a file on Drive"
```

For `pipedream-props-options`, pass the auth prop as the slug flag:

```bash
numa integrations pipedream-props-options google_drive google_drive-download-file mimeType \
  --google_drive '{"authProvisionId":"auto"}' --props '{"fileId":"abc123"}' \
  -m "Listing export formats"
```

## Critical Gotchas

- **Searching requires a search term:** Both `nameSearchTerm` and `searchQuery` are marked optional in `find-file` and `find-folder` schemas, but at least one is required. Omitting both returns an error: "You must specify a search query or name."

- **Drive prop defaults to "My Drive" string:** The `drive` prop accepts either the literal string `"My Drive"` for personal drive, or a shared drive ID (e.g., `"0AExf2ajwdD-cUk9PVA"`) from `pipedream-props-options`.

- **Downloading files:** Use the `--stash-id NEW` flag on a `pipedream-call` to `google_drive-download-file`. The file is delivered automatically — reference the `downloaded_files` path in the result (default `/workdir/tmp/integrations-results/`, which is scratch — invisible to the user). If the user asked for the file as a deliverable, `cp` it to `/workdir/outputs/`.

- **Google Workspace files need export format:** When downloading Google Docs, Sheets, or Slides, resolve `mimeType` via `pipedream-props-options` (with `fileId` set) to see available export formats. Common options:
  - `application/pdf`
  - `text/plain`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (Word)

- **Uploading & replacing files — ALWAYS use the action, NEVER a raw request:** To upload a NEW file use `google_drive-upload-file`; to REPLACE the contents of an EXISTING file (keeps the same `fileId` and Drive version history) use `google_drive-update-file`. In both, pass the workspace path in `filePath` (e.g., `/workdir/uploads/report.pdf`) — the system converts it to a presigned URL and streams the real bytes. **Never upload or overwrite a file via `numa integrations request` or a raw `googleapis.com/upload/...` URL** — a raw request sends a JSON body, not multipart media, so it overwrites the file with a tiny JSON blob and destroys it (this has actually happened — it is not hypothetical).

- **Folder prop naming varies by action:** Upload uses `parentId`, move uses `folderId`, `list-files` uses `folderId`. Always check the schema for the correct prop name (`numa integrations pipedream-props google_drive <action>`).

- **Sharing files has conditional props:** In `google_drive-add-file-sharing-preference`, you must set `useFileOrFolder` to either `"File"` or `"Folder"` first, then provide the corresponding `fileId` or `folderId`. The `type` prop (`user`, `group`, `domain`, `anyone`) may reveal additional required props.

- **Delete vs Trash:** `google_drive-delete-file` permanently deletes (no recovery). Use `google_drive-move-file-to-trash` for recoverable deletion. Both work on files AND folders.

- **File IDs from search results:** Actions like `find-file`, `find-folder`, and `list-files` return arrays with objects containing `id`, `name`, and `mimeType`. Use the `id` value for subsequent operations.

## Example: Download a File

```bash
numa integrations pipedream-call google_drive google_drive-download-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"fileId":"abc123"}' \
  --stash-id NEW \
  -m "Downloading a Drive file"
```

## Example: Upload a File

```bash
numa integrations pipedream-call google_drive google_drive-upload-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"parentId":"folder-id-here","filePath":"/workdir/uploads/report.pdf","name":"My Report.pdf"}' \
  -m "Uploading a file to Drive"
```

## Example: Replace an Existing File's Contents

Use this to write changes back to a file you downloaded and edited locally. It
keeps the same `fileId` and Drive version history:

```bash
numa integrations pipedream-call google_drive google_drive-update-file \
  --props '{"googleDrive":{"authProvisionId":"auto"},"fileId":"abc123","filePath":"/workdir/tmp/report_updated.pdf"}' \
  -m "Replacing a Drive file's contents"
```

## Use the Download Action for File Bytes, Not a Raw Request

Prefer the built-in download action for binaries — don't pull file or revision
bytes through `numa integrations request`:

- **Uploads:** a raw request sends a JSON body, not multipart media — the upstream stores the JSON instead of your file. Use `google_drive-upload-file` (new) or `google_drive-update-file` (overwrite existing).
- **Downloads / revisions:** fetch bytes via `google_drive-download-file` (with `--stash-id NEW`). The file is delivered automatically — reference the `downloaded_files` path in the result.

After any upload or update, verify it (re-list or re-download and check the size
and mimeType) before telling the user it is done.

## When to Use What

- **"Find a file called X"** -> `google_drive-find-file` with `nameSearchTerm`
- **"Find a folder called X"** -> `google_drive-find-folder` with `nameSearchTerm`
- **"List files in folder X"** -> `google_drive-list-files` with `folderId`
- **"Download this file"** -> `google_drive-download-file` with `--stash-id NEW`
- **"Upload a new file"** -> `google_drive-upload-file` with workspace path in `filePath`
- **"Update / overwrite an existing file"** -> `google_drive-update-file` with `fileId` + workspace path in `filePath` (preserves version history)
- **"Share file with someone"** -> `google_drive-add-file-sharing-preference`
- **"Move file to trash"** -> `google_drive-move-file-to-trash` (recoverable)
- **"Permanently delete"** -> `google_drive-delete-file` (irreversible)
