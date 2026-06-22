# Notion Integration Tips

## Before Performing Notion Operations

Establish context first:

- Use `notion-search` to find available pages and databases — filter by `"page"` or `"data_source"` via the `filter` prop
- For database operations, use `notion-retrieve-database-schema` to understand the property schema before creating/updating entries
- Use `numa integrations pipedream-props-options notion <action> <prop> --notion '{"authProvisionId":"auto"}'` to resolve dynamic IDs for `parent`, `parentDataSource`, `pageId`, `blockId`, etc.

## Key Gotchas

**Auth key is `notion` (lowercase):**

```json
{"notion": {"authProvisionId": "auto"}, ...}
```

**"Database" props are named `dataSourceId`/`parentDataSource`:** Notion calls them "databases" in their UI, but Pipedream uses "data source" terminology. Use `dataSourceId` not `databaseId`:

```json
{ "notion": { "authProvisionId": "auto" }, "dataSourceId": "<data-source-uuid>" }
```

**Database-entry property formats vary by type** (the `properties` object in `create-page-from-database` / `update-page`) — match each property's Notion type or the action throws `Error converting property … to Notion format`. Always check the schema first (`notion-retrieve-database-schema`):

```json
{
  "Name": "Entry title", // title  → plain string
  "Notes": "Some text", // rich_text → plain string
  "Tag": ["Team 1", "CS"], // multi_select → ARRAY of strings (a bare string fails: "Must be of type string[]")
  "Due Date": { "start": "2026-03-01" } // date → object
}
```

(When writing via `request` instead of the action, use Notion's **native** nested format — see "Direct API requests" below.)

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

**`query-database` mis-serializes omitted optional props (verified bug):**

- Omitting `sorts` sends `null` → `400 body.sorts should be an array or undefined, instead was null`.
- Passing `sorts: []` but omitting `filter` sends an empty filter → `400 body.filter.* should be defined`.

So the action only works when you pass **both** a valid `filter` (a **stringified** JSON object) **and** `sorts: []`:

```json
{ "filter": "{\"property\":\"Name\",\"title\":{\"contains\":\"search term\"}}", "sorts": [] }
```

Easier paths that sidestep the bug: for **all rows unfiltered**, use **`notion-retrieve-database-content`**; for **filtered** queries, use **`request`** (no serialization quirks — and note it takes the real `database_id`, not the `dataSourceId`):

```bash
numa integrations request notion POST "https://api.notion.com/v1/databases/{database_id}/query" \
  --headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}' \
  --body '{"filter":{"property":"Name","title":{"contains":"x"}},"page_size":100}' -m "Query database"
```

**`update-page` requires `parentDataSource` first:** To update a database entry, you must provide both `parentDataSource` (the database ID) and `pageId` (the entry ID). The `archived` prop can be used to move pages to Trash.

**`delete-block` is slow on pages — prefer `request` to archive:** `notion-delete-block` "deletes" by archiving to Trash (`archived: true`, restorable — Notion has no true-delete via API). But on a **page-level block** it's slow (~30s even for a tiny page) and recurses through children, so it risks the **300s Lambda timeout** on large/nested pages. To archive a page reliably and instantly, use `request`:

```bash
numa integrations request notion PATCH "https://api.notion.com/v1/pages/{page_id}" \
  --headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}' \
  --body '{"archived":true}' -m "Archive (trash) page"
```

Likewise `retrieve-block` with `retrieveChildren: "All Children"` + `retrieveMarkdown: true` can hit the 300s limit on large pages — paginate via `request GET /v1/blocks/{id}/children?page_size=100` (follow `next_cursor`) instead.

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

Not supported via markdown: Callouts, toggles, embeds, synced blocks. Use `numa integrations request` with the `Notion-Version` header for these (see "Direct API requests" below).

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

File uploads require a three-step process using Pipedream actions plus a direct `numa integrations request`:

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

Use `numa integrations request` with PATCH — the `Notion-Version` header is required:

```bash
numa integrations request notion PATCH "https://api.notion.com/v1/blocks/{page_id}/children" \
  --headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}' \
  --body '{"children":[{"type":"file","file":{"type":"file_upload","file_upload":{"id":"file-upload-uuid-here"}}}]}' \
  -m "Attach uploaded file to page"
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
- **Notion-Version header required:** All `numa integrations request` calls to Notion require the header `{"x-pd-proxy-Notion-Version": "2022-06-28"}`.

## Direct API requests (`numa integrations request`)

Notion's API requires a version header on all requests. When using `numa integrations request`, always include:

```
--headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}'
```

The `x-pd-proxy-` prefix tells Pipedream to forward the header as `Notion-Version` to the upstream API.

**`request` uses the real Notion `database_id`, NOT the Pipedream `dataSourceId`.** The `id` returned by `notion-search` / `notion-retrieve-database-schema` is a **data-source** id (the actions run Notion's newer data-source API). It returns **404** ("Could not find database with ID") on raw `/v1/databases/{id}` calls. The real `database_id` is in the schema's **`parent.database_id`** field (NOT the root `id`). So to move from an action-discovered DB to a `request` call, read `parent.database_id` from `retrieve-database-schema` first. (Actions keep using `dataSourceId`; only `request` needs the translation.)

**Search via `request` is POST, not GET** — `GET /v1/search` returns `400 Invalid request URL`:

```bash
numa integrations request notion POST "https://api.notion.com/v1/search" \
  --headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}' \
  --body '{"query":"text","filter":{"value":"page","property":"object"},"page_size":50}' -m "Search Notion"
```

**Property format via `request` is Notion-native** (nested objects), unlike the action's simplified shape: `{"properties":{"Tag":{"multi_select":[{"name":"CS"}]}}}` — not `{"Tag":["CS"]}`.

**Rate limit:** Notion allows ~3 requests/sec; back-to-back writes can return `429`. Space rapid write sequences out.

Example — Create a callout block (not supported via markdown):

```bash
numa integrations request notion PATCH "https://api.notion.com/v1/blocks/{page_id}/children" \
  --headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}' \
  --body '{"children":[{"type":"callout","callout":{"icon":{"type":"emoji","emoji":"💡"},"rich_text":[{"type":"text","text":{"content":"Important note here"}}]}}]}' \
  -m "Add callout block to page"
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
    "Tags": ["To Do"],
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

# 3. Attach to page via direct request
numa integrations request notion PATCH "https://api.notion.com/v1/blocks/{page_id}/children" \
  --headers '{"x-pd-proxy-Notion-Version":"2022-06-28"}' \
  --body '{"children":[{"type":"file","file":{"type":"file_upload","file_upload":{"id":"..."}}}]}' \
  -m "Attach file to page"
```
