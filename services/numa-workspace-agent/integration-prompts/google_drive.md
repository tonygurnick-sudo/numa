# Google Drive Integration

## Essential First Step
Before performing Google Drive operations, establish context:
- If the user has multiple drives, resolve drive via `configure_props` to see available options (My Drive + any Shared Drives)
- For operations in a specific folder, either resolve `folderId`/`parentId` via `configure_props`, or use `find-folder` to search by name
- To work with a specific file, use `find-file` to search by name, then use the returned `id` in subsequent operations

## Auth Structure
Auth key is `googleDrive` (camelCase):
```json
{"googleDrive": {"authProvisionId": "auto"}, "...other_params": "..."}
```

## Critical Gotchas

- **Searching requires a search term:** Both `nameSearchTerm` and `searchQuery` are marked optional in `find-file` and `find-folder` schemas, but at least one is required. Omitting both returns an error: "You must specify a search query or name."

- **Drive prop defaults to "My Drive" string:** The `drive` prop accepts either the literal string `"My Drive"` for personal drive, or a shared drive ID (e.g., `"0AExf2ajwdD-cUk9PVA"`) from `configure_props`.

- **Downloading files requires stash_id:** Always include `stash_id="NEW"` when calling `google_drive-download-file`. The downloaded file will be saved to `/workdir/session/integrations-results/`.

- **Google Workspace files need export format:** When downloading Google Docs, Sheets, or Slides, resolve `mimeType` via `configure_props` (with `fileId` set) to see available export formats. Common options:
  - `application/pdf`
  - `text/plain`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (Word)

- **Uploading files uses workspace paths directly:** For `google_drive-upload-file`, pass the workspace path in `filePath` (e.g., `/workdir/uploads/report.pdf`). The system converts it to a presigned URL automatically.

- **Folder prop naming varies by action:** Upload uses `parentId`, move uses `folderId`, `list-files` uses `folderId`. Always check the schema for the correct prop name.

- **Sharing files has conditional props:** In `google_drive-add-file-sharing-preference`, you must set `useFileOrFolder` to either `"File"` or `"Folder"` first, then provide the corresponding `fileId` or `folderId`. The `type` prop (`user`, `group`, `domain`, `anyone`) may reveal additional required props.

- **Delete vs Trash:** `google_drive-delete-file` permanently deletes (no recovery). Use `google_drive-move-file-to-trash` for recoverable deletion. Both work on files AND folders.

- **File IDs from search results:** Actions like `find-file`, `find-folder`, and `list-files` return arrays with objects containing `id`, `name`, and `mimeType`. Use the `id` value for subsequent operations.

## Example: Download a File
```json
{
  "googleDrive": {"authProvisionId": "auto"},
  "fileId": "abc123",
  "stash_id": "NEW"
}
```

## Example: Upload a File
```json
{
  "googleDrive": {"authProvisionId": "auto"},
  "parentId": "folder-id-here",
  "filePath": "/workdir/uploads/report.pdf",
  "name": "My Report.pdf"
}
```

## When to Use What

- **"Find a file called X"** -> `find-file` with `nameSearchTerm`
- **"Find a folder called X"** -> `find-folder` with `nameSearchTerm`
- **"List files in folder X"** -> `list-files` with `folderId`
- **"Download this file"** -> `google_drive-download-file` with `stash_id="NEW"`
- **"Upload a file"** -> `google_drive-upload-file` with workspace path
- **"Share file with someone"** -> `google_drive-add-file-sharing-preference`
- **"Move file to trash"** -> `google_drive-move-file-to-trash` (recoverable)
- **"Permanently delete"** -> `google_drive-delete-file` (irreversible)
