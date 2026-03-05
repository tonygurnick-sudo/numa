# Notion Integration Tips

## Before Performing Notion Operations

Establish context first:

- Use `notion-search` to find available pages and databases — filter by `"page"` or `"data_source"` via the `filter` prop
- For database operations, use `notion-retrieve-database-schema` to understand the property schema before creating/updating entries
- Use `configure_props` to resolve dynamic IDs for `parent`, `parentDataSource`, `pageId`, `blockId`, etc.

## Key Gotchas

**Auth key is `notion` (lowercase):**

```json
{"notion": {"authProvisionId": "auto"}, ...}
```

**"Database" props are named `dataSourceId`/`parentDataSource`:** Notion calls them "databases" in their UI, but Pipedream uses "data source" terminology. Use `dataSourceId` not `databaseId`:

```json
{ "notion": { "authProvisionId": "auto" }, "dataSourceId": "afee9835-099d-..." }
```

**Select properties use plain strings:** When creating/updating database entries via `create-page-from-database`, pass select values as strings, NOT objects:

```json
// Correct
{"properties": {"Status": "In Progress", "Priority": "High"}}

// Wrong - will fail
{"properties": {"Status": {"name": "In Progress"}}}
```

**Date properties use object format:**

```json
{ "properties": { "Due Date": { "start": "2026-02-06" } } }
```

**Rich text properties are plain strings:**

```json
{ "properties": { "Notes": "Plain text content here" } }
```

**`retrieve-block` vs `retrieve-page`:** Use `notion-retrieve-block` to get page content (blocks, children, markdown). Use `notion-retrieve-page` only for page metadata (properties, timestamps). The naming is counterintuitive — `blockId` accepts page IDs.

**Markdown content is supported:** Both `create-page` (`pageContent` prop) and `append-block` (`markdownContents` prop) accept Markdown:

```json
// create-page
{"pageContent": "# Heading\n\n- Item 1\n- Item 2\n\n**Bold text**"}

// append-block (array of strings, each becomes a block)
{"blockTypes": ["markdownContents"], "markdownContents": ["## Section\n\nParagraph content"]}
```

**`append-block` requires `blockTypes` selection:** You must include `blockTypes` array to specify what you're appending:

- `"blockIds"` — append existing blocks
- `"markdownContents"` — create new blocks from Markdown
- `"imageUrls"` — create image blocks

**`query-database` filter is a JSON string:** The `filter` prop expects a stringified JSON object:

```json
{ "filter": "{\"property\":\"Name\",\"title\":{\"contains\":\"search term\"}}" }
```

**`update-page` requires `parentDataSource` first:** To update a database entry, you must provide both `parentDataSource` (the database ID) and `pageId` (the entry ID). The `archived` prop can be used to move pages to Trash.

**`delete-block` archives, doesn't delete:** The `notion-delete-block` action moves items to Notion's Trash (sets `archived: true`). Items can be restored from Trash in Notion's UI.

## Common Filter Examples for `query-database`

```json
// Title contains text
{"filter": "{\"property\":\"Name\",\"title\":{\"contains\":\"meeting\"}}"}

// Select equals value
{"filter": "{\"property\":\"Status\",\"select\":{\"equals\":\"Done\"}}"}

// Date after
{"filter": "{\"property\":\"Due Date\",\"date\":{\"after\":\"2026-01-01\"}}"}

// Checkbox is checked
{"filter": "{\"property\":\"Complete\",\"checkbox\":{\"equals\":true}}"}
```

## Markdown to Block Conversion

The `markdownContents` prop in `append-block` converts markdown to native Notion blocks:

| Markdown      | Notion Block                      | Notes                  |
| ------------- | --------------------------------- | ---------------------- |
| `# Heading`   | `heading_1`                       |                        |
| `## Heading`  | `heading_2`                       |                        |
| `### Heading` | `heading_3`                       |                        |
| ` ```python ` | `code` with language              | Language auto-detected |
| `\| table \|` | `table` with `table_row` children | Full table support     |
| `> quote`     | `quote`                           |                        |
| `- item`      | `bulleted_list_item`              |                        |
| `1. item`     | `numbered_list_item`              |                        |
| `- [ ] todo`  | `to_do` with `checked: false`     |                        |
| `- [x] done`  | `to_do` with `checked: true`      |                        |
| `---`         | `divider`                         |                        |
| `**bold**`    | `annotations.bold: true`          |                        |
| `*italic*`    | `annotations.italic: true`        |                        |
| `~~strike~~`  | `annotations.strikethrough: true` |                        |
| `` `code` ``  | `annotations.code: true`          |                        |
| `[text](url)` | `text.link`                       |                        |

Not supported via markdown: Callouts, toggles, embeds, synced blocks. Use `proxy_request` with the `Notion-Version` header for these.

## Updating Blocks

Use `notion-update-block` with a JSON string in the `content` prop. The JSON must match the block type structure:

**Update code block:**

```json
{
  "content": "{\"code\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"new code here\"}}],\"language\":\"python\"}}"
}
```

**Update table row cells:**

```json
{
  "content": "{\"table_row\":{\"cells\":[[{\"type\":\"text\",\"text\":{\"content\":\"Cell 1\"}}],[{\"type\":\"text\",\"text\":{\"content\":\"Cell 2\"}}]]}}"
}
```

**Toggle checkbox:**

```json
{ "content": "{\"to_do\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"Task text\"}}],\"checked\":true}}" }
```

**Update heading:**

```json
{ "content": "{\"heading_1\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"New heading text\"}}]}}" }
```

## File Uploads

File uploads require a three-step process using Pipedream actions plus `proxy_request`:

### Step 1: Create Upload Session

Use `notion-create-file-upload`:

```json
{
  "notion": { "authProvisionId": "auto" },
  "mode": "single_part",
  "filename": "document.pdf"
}
```

- `mode`: `"single_part"` (< 20MB), `"multi_part"` (> 20MB), or `"external_url"` (import from URL)
- Returns `fileUploadId` (save this for steps 2 and 3)

### Step 2: Send the File

Use `notion-send-file-upload`:

```json
{
  "notion": { "authProvisionId": "auto" },
  "fileUploadId": "file-upload-uuid-here",
  "file": "/workdir/uploads/document.pdf"
}
```

- The `file` prop accepts workspace paths (automatically converted to presigned URLs)
- Wait for status to change from `"pending"` to `"uploaded"`

### Step 3: Attach File to Page

Use `proxy_request` with PATCH — the `Notion-Version` header is required:

```python
mcp__integrations__proxy_request(
  method="PATCH",
  upstream_url="https://api.notion.com/v1/blocks/{page_id}/children",
  integration_slug="notion",
  headers={"x-pd-proxy-Notion-Version": "2022-06-28"},
  body={
    "children": [{
      "type": "file",
      "file": {
        "type": "file_upload",
        "file_upload": {"id": "file-upload-uuid-here"}
      }
    }]
  },
  description="Attach uploaded file to page"
)
```

### External URL Mode (Simplest for Public Files)

For publicly accessible files, skip the send step:

```json
{
  "notion": { "authProvisionId": "auto" },
  "mode": "external_url",
  "filename": "document.pdf",
  "externalUrl": "https://example.com/document.pdf"
}
```

### Gotchas

- **Content-Type mismatch:** If you specify `contentType` in `create-file-upload`, the sent file must match exactly. Omit `contentType` to let it auto-detect.
- **File prop name:** Use `file`, not `filePath` in `send-file-upload`.
- **Notion-Version header required:** All `proxy_request` calls to Notion require the header `{"x-pd-proxy-Notion-Version": "2022-06-28"}`.

## Using `proxy_request` for Notion

Notion's API requires a version header on all requests. When using `proxy_request`, always include:

```
headers={"x-pd-proxy-Notion-Version": "2022-06-28"}
```

The `x-pd-proxy-` prefix tells Pipedream to forward the header as `Notion-Version` to the upstream API.

Example — Create a callout block (not supported via markdown):

```python
mcp__integrations__proxy_request(
  method="PATCH",
  upstream_url="https://api.notion.com/v1/blocks/{page_id}/children",
  integration_slug="notion",
  headers={"x-pd-proxy-Notion-Version": "2022-06-28"},
  body={
    "children": [{
      "type": "callout",
      "callout": {
        "icon": {"type": "emoji", "emoji": "💡"},
        "rich_text": [{"type": "text", "text": {"content": "Important note here"}}]
      }
    }]
  },
  description="Add callout block to page"
)
```

## Workflow Examples

**Create a database entry:**

```json
// notion-create-page-from-database
{
  "notion": { "authProvisionId": "auto" },
  "parentDataSource": "database-uuid-here",
  "templateType": "none",
  "properties": {
    "Name": "Entry Title",
    "Status": "To Do",
    "Due Date": { "start": "2026-03-01" },
    "Notes": "Description text"
  }
}
```

**Get page content as Markdown:**

```json
// notion-retrieve-block
{
  "notion": { "authProvisionId": "auto" },
  "blockId": "page-uuid-here",
  "retrieveChildren": "All Children",
  "retrieveMarkdown": true
}
```

**Search for databases only:**

```json
// notion-search
{
  "notion": { "authProvisionId": "auto" },
  "title": "",
  "filter": "data_source",
  "pageSize": 50
}
```

**Upload and attach a file to a page:**

```
# 1. Create upload session
notion-create-file-upload: mode="single_part", filename="report.pdf"
# Returns: fileUploadId

# 2. Send the file
notion-send-file-upload: fileUploadId="...", file="/workdir/uploads/report.pdf"
# Wait for status: "uploaded"

# 3. Attach to page via proxy
proxy_request: PATCH /v1/blocks/{page_id}/children
  headers: {"x-pd-proxy-Notion-Version": "2022-06-28"}
  body: {"children": [{"type": "file", "file": {"type": "file_upload", "file_upload": {"id": "..."}}}]}
```
