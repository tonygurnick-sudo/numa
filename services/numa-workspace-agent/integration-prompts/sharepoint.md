# SharePoint Integration Tips

## Critical Limitation: Business Accounts Only

The SharePoint integration **only works with Microsoft 365 business/organizational accounts**. Personal Microsoft accounts (MSA) are not supported and will fail with:

> "This API is not supported for MSA accounts"

**Actions affected:** All site operations (`list-sites`, `search-sites`, `get-site`), search operations (`search-files`, `search-and-filter-files`), and `configure_props` for `siteId` (returns empty arrays).

**Reason:** Personal accounts have OneDrive, not SharePoint. SharePoint is a Microsoft 365 business product.

---

## Before Performing SharePoint Operations

**Establish context first:**

1. Resolve `siteId` via `configure_props` — if multiple sites exist, ask the user which one
2. Most actions require the full siteId (format: `hostname,siteGuid,webGuid`)
3. For file operations, resolve `driveId` after selecting site — each site can have multiple drives (usually "Documents")
4. For list operations, resolve `listId` — this shows both SharePoint lists AND document libraries

## Prop Resolution Chain

Many props depend on earlier selections:

```
siteId → driveId → folderId/fileId
siteId → listId → itemId
siteId → itemId (for Excel files)
```

Always resolve in sequence using `configure_props`.

## Key Tips

- **Site IDs use composite format:** Site IDs look like `hostname,siteGuid,webGuid` (e.g., `contoso.sharepoint.com,abc123...,def456...`). Always use `configure_props` to get valid values.

- **Document libraries vs Lists:** `configure_props` for `listId` returns both document libraries (like "Shared Documents") and custom SharePoint lists. Document libraries contain files; lists contain structured data items.

- **Folder listing without folderId:** Omitting `folderId` in `list-files-in-folder` returns root-level contents of the selected drive.

- **File downloads require `filename` prop and stash_id:** The `download-file` action requires:
  - The `filename` prop (even though not marked optional in schema)
  - `stash_id="NEW"` in the `run_action` call to enable file stashing

  Downloaded files land in `/workdir/tmp/integrations-results/__stash/{filename}` (scratch — hidden from the user's Files page) and are immediately available for reading or further processing. If the user asked for the file as a deliverable, `cp` it to `/workdir/outputs/`.

- **File uploads accept workspace paths:** The `filePath` prop for `upload-file` accepts workspace paths (e.g., `/workdir/uploads/file.txt` or `/workdir/outputs/file.txt`) which are automatically converted to presigned URLs.

- **Global vs site-scoped search:**
  - `search-files` searches across ALL sites (no siteId required)
  - `find-file-by-name` searches within a specific site (requires siteId)

- **Search doesn't support wildcards:** The `find-file-by-name` action doesn't accept wildcards like `*` or `%`. Using them returns a 400 Bad Request error. Use specific search terms, or use `list-files-in-folder` to browse directory contents instead.

- **OData filtering on lists requires indexed columns:** Filtering on non-indexed columns (like `Title` on custom lists) returns error:

  > "Field 'X' cannot be referenced in filter or orderby as it is not indexed"

  Document library columns like `ContentType` are typically indexed and work for filtering. For custom list columns, ensure they're indexed in SharePoint site settings, or retrieve all items and filter client-side.

- **Excel table reading requires actual Table objects:** The `get-excel-table` action only works with properly formatted Excel Tables (created via Insert > Table in Excel). Data in regular cells won't be detected. The `tableName` picker will return empty if no tables exist.

- **New lists only have Title column:** When you create a new list, only the `Title` column exists. `configure_props` for `columnNames` may return empty. Custom columns must be added via SharePoint admin before they appear.

- **create-item uses dynamic column props:** Select columns via `columnNames` array, then provide values as additional props with the column name as the key (e.g., `"Title": "My Item"`).

- **No delete actions in built-in actions:** Use `proxy_request` for delete operations (see below).

## OData Filter Examples

For document libraries (`search-and-filter-files`):

```
fields/ContentType eq 'Document'     # Files only (excludes folders)
fields/FileLeafRef eq 'report.docx'  # Exact filename match
```

For lists (`find-files-with-metadata`):

```
# Only works on indexed columns!
fields/Status eq 'Active'
fields/Modified gt '2024-01-01'
```

## Common Prop Dependencies

| Action                     | Required Props Chain                             |
| -------------------------- | ------------------------------------------------ |
| `list-files-in-folder`     | siteId → driveId → (optional) folderId           |
| `download-file`            | siteId → driveId → fileId + filename (required!) |
| `upload-file`              | siteId → driveId → (optional) uploadFolderId     |
| `create-folder`            | siteId → driveId → (optional) folderId           |
| `create-link`              | siteId → driveId → fileId                        |
| `get-excel-table`          | siteId → itemId → tableName                      |
| `create-list`              | siteId                                           |
| `create-item`              | siteId → listId → columnNames                    |
| `update-item`              | siteId → listId → itemId                         |
| `find-files-with-metadata` | siteId → listId                                  |

## Working JSON Examples

**Download file (use stash_id="NEW" in run_action call):**

```json
{
  "sharepoint": { "authProvisionId": "auto" },
  "siteId": "contoso.sharepoint.com,abc...,def...",
  "driveId": "b!...",
  "fileId": "01ABC123...",
  "filename": "Report.xlsx"
}
```

**Create list item:**

```json
{
  "sharepoint": { "authProvisionId": "auto" },
  "siteId": "contoso.sharepoint.com,abc...,def...",
  "listId": "list-guid-here",
  "columnNames": ["Title"],
  "Title": "My New Item"
}
```

**Upload file to folder:**

```json
{
  "sharepoint": { "authProvisionId": "auto" },
  "siteId": "contoso.sharepoint.com,abc...,def...",
  "driveId": "b!...",
  "uploadFolderId": "folder-id-here",
  "filePath": "/workdir/outputs/report.pdf",
  "filename": "Q4-Report.pdf"
}
```

**Create organization sharing link:**

```json
{
  "sharepoint": { "authProvisionId": "auto" },
  "siteId": "contoso.sharepoint.com,abc...,def...",
  "driveId": "b!...",
  "fileId": "file-id-here",
  "type": "view",
  "scope": "organization"
}
```

## Pagination — Follow `@odata.nextLink`, Never Iterate `$skip`

For bulk Graph fetches via `proxy_request` (drive items, list items, users, etc.), follow the `@odata.nextLink` URL returned on each response until it's absent.

- **Never iterate `$skip=0, 100, 200, ...` manually** — it's a linear scan that costs one approval + one round-trip per page.
- **Built-in actions strip pagination tokens** — `@odata.nextLink` does not survive `run_action`. Use `proxy_request` directly for multi-page fetches.
- **Decide your `$select` set up front** so you don't have to re-walk the same window with different fields.
- **Use `$top` to control page size** (typically 200 for drive items, max 5000 for list items).

## Proxy API for Missing Operations

Use `proxy_request` with `integration_slug: "sharepoint"` for operations not covered by built-in actions:

| Operation          | Method | Endpoint                                                      |
| ------------------ | ------ | ------------------------------------------------------------- |
| Delete file/folder | DELETE | `/drives/{driveId}/items/{itemId}`                            |
| Delete list item   | DELETE | `/sites/{siteId}/lists/{listId}/items/{itemId}`               |
| Delete list        | DELETE | `/sites/{siteId}/lists/{listId}`                              |
| Delete column      | DELETE | `/sites/{siteId}/lists/{listId}/columns/{columnId}`           |
| Copy file          | POST   | `/drives/{driveId}/items/{itemId}/copy`                       |
| Move file          | PATCH  | `/drives/{driveId}/items/{itemId}` (with new parentReference) |
| Get file versions  | GET    | `/drives/{driveId}/items/{itemId}/versions`                   |
| Get permissions    | GET    | `/drives/{driveId}/items/{itemId}/permissions`                |
| Get list columns   | GET    | `/sites/{siteId}/lists/{listId}/columns`                      |
| Add list column    | POST   | `/sites/{siteId}/lists/{listId}/columns`                      |
| List site users    | GET    | `/sites/{siteId}/users`                                       |
| List org users     | GET    | `/users`                                                      |

**Proxy examples:**

Delete a file:

```
proxy_request(
  method="DELETE",
  upstream_url="https://graph.microsoft.com/v1.0/drives/{driveId}/items/{itemId}",
  integration_slug="sharepoint"
)
```

Copy a file:

```
proxy_request(
  method="POST",
  upstream_url="https://graph.microsoft.com/v1.0/drives/{driveId}/items/{itemId}/copy",
  integration_slug="sharepoint",
  body={"parentReference": {"driveId": "...", "id": "target-folder-id"}, "name": "new-filename.txt"}
)
```

Add a column to a list:

```
proxy_request(
  method="POST",
  upstream_url="https://graph.microsoft.com/v1.0/sites/{siteId}/lists/{listId}/columns",
  integration_slug="sharepoint",
  body={"name": "DueDate", "dateTime": {}, "description": "Due date for this item"}
)
```

List organization users:

```
proxy_request(
  method="GET",
  upstream_url="https://graph.microsoft.com/v1.0/users",
  integration_slug="sharepoint"
)
```

Returns array of users with `id`, `displayName`, `mail`, `userPrincipalName`, etc.
