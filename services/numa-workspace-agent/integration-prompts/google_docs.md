# Google Docs Integration Tips

All Google Docs calls go through the `numa integrations` CLI. Action keys follow
`google_docs-<name>` (`numa integrations pipedream-actions google_docs` lists
them). Auth prop: pass `"googleDocs": {"authProvisionId": "auto"}` — it works
across the action set (a couple of schemas name the auth prop `googleDrive` —
`find-document`, `create-document-from-template` — but the proxy normalises the
key, so `googleDocs` is accepted everywhere; verified).

## Finding & reading

- **`find-document`** (`nameSearchTerm` or `searchQuery`, optional `drive`) returns an array of `{id, name, mimeType, kind}`. Use `ret[0].id` as `docId`. `nameSearchTerm` does a tokenised `name contains` match; for an exact match pass a full Drive query in `searchQuery` (it overrides `nameSearchTerm`): `"name = 'Exact Title' and mimeType = 'application/vnd.google-apps.document'"`. `drive` defaults to all drives; resolve shared-drive IDs via `pipedream-props-options … drive` or pass the literal `"My Drive"`.
- **`get-document`** returns a top-level **`textContent`** string — use it for fast text extraction; the nested `body.content` is depth-truncated in action results. Only reach into `body` for block-level structure (indices, styles). With `includeTabsContent: true`, content moves under `Document.tabs[]` and the top-level `body`/`documentStyle` are no longer populated.

## Tabs

Most docs have a single tab, id `t.0`. The `tabIds` / `tabId` props (on
`get-document`, `replace-text`, `insert-*`, `get-tab-content`) are dynamic and
need **`docId` as a parent** in `--configured` or props-options returns nothing:

```bash
numa integrations pipedream-props-options google_docs google_docs-replace-text tabIds \
  --configured '{"googleDocs":{"authProvisionId":"auto"},"docId":"DOC_ID"}' -m "Resolve tab IDs"
```

`get-tab-content` returns the raw block structure (under `documentTab.body`) with no `textContent` shortcut — use `get-document` if you just need text.

## Writing

- **`create-document`** (`title`, `text`, `useMarkdown`, `folderId`) — `useMarkdown: true` renders Markdown (headings, bold, lists). Creates in My Drive root unless `folderId` set. Returns the full document incl. `documentId`.
- **`append-text`** (`docId`, `text`, `appendAtBeginning`) — appends to the end (or start if `appendAtBeginning: true`). **No Markdown** — inserted verbatim.
- **`replace-text`** (`docId`, `replaced` = the search text, `text` = replacement, `enableMarkdown`, `matchCase`) — replaces all matches; `enableMarkdown: true` renders Markdown in the replacement.
- **`insert-text` / `insert-table` / `insert-page-break`** take an `index` (default `1` = the very start of the doc). To add at the end, use `append-text` rather than computing the end index. `insert-table` (`rows`, `columns`) inserts an **empty** table only — see batchUpdate below to fill cells.

## Images

- **`append-image`** (`imageUri` = a public URL, `appendAtBeginning`) — the result includes an `inlineObjects` map keyed by internal IDs (`kix.xxxxxxxxx`); save these to replace the image later.
- **`replace-image`** needs that **`kix.…` object ID** as `imageId` (not a URL/filename) — get it from `inlineObjects` in an `append-image`/`get-document` result, or resolve `imageId` via props-options (with `docId` parent).

## Templates — `create-document-from-template`

Copies a template doc and fills `{{placeholder}}` values. Props: `templateId`,
`name`, `mode` (**`string[]`** — `["Google Doc"]` and/or `["Pdf"]`),
`replaceValues` (object; keys are placeholder names **without** braces),
optional `destinationDrive`/`folderId`.

```bash
numa integrations pipedream-call google_docs google_docs-create-document-from-template \
  --props '{"googleDocs":{"authProvisionId":"auto"},"templateId":"TPL_ID","name":"Generated Doc","mode":["Google Doc"],"replaceValues":{"client_name":"Acme Corp","date":"2026-06-22"}}' \
  -m "Generate doc from template"
```

⚠️ **The template must contain at least one `{{placeholder}}`** — otherwise it
fails with HTTP 400 "Must specify at least one request." It **cannot** be used as
a plain "copy this doc" operation. To build a filled doc when you don't have a
placeholder template: `create-document` (`useMarkdown: true`) then `replace-text`
(`enableMarkdown: true`) — sidesteps the placeholder requirement entirely.

## Deleting — no action, use the Drive API

```bash
numa integrations request google_docs DELETE \
  "https://www.googleapis.com/drive/v3/files/{docId}" -m "Delete document"
```

Empty body / HTTP 204 = success.

## Exporting (Drive export API, via `request`)

```bash
numa integrations request google_docs GET \
  "https://www.googleapis.com/drive/v3/files/{docId}/export?mimeType=application/pdf" \
  -m "Export as PDF"
```

mimeTypes: `text/plain`, `text/html`, `application/pdf`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX).

- **Plain text** comes back directly in `result.text` as UTF-8 **with a BOM** — strip the leading `﻿` before parsing.
- **Binary** (PDF/DOCX) is auto-saved to `/workdir/tmp/integrations-results/` and listed in `downloaded_files`. ⚠️ The saved name is the generic **`proxy-google_docs-binary.<ext>`** (the export endpoint sends no filename hint), so it's **fixed** — `cp`/rename each export before the next call overwrites it. `cp` to `/workdir/outputs/` if the user wants the file.

## Direct Docs API (`request`) — full structure & batchUpdate

The `google_docs` slug also reaches the Docs API. The inline summary in results
**depth-truncates** nested objects — for deep structure (table cell indices, etc.)
read the full saved JSON spill file under `/workdir/tmp/numa-cli/`, or fetch
with a field mask:

```bash
numa integrations request google_docs GET \
  "https://docs.googleapis.com/v1/documents/{docId}?fields=body.content" -m "Full body structure"
```

**Populating table cells** (no action does this — `insert-table` only makes the
skeleton): get the cell paragraph `startIndex` values from the structure above,
then `batchUpdate` with `insertText` requests **in descending index order** (each
insert shifts later positions — highest-first keeps indices valid):

```bash
numa integrations request google_docs POST \
  "https://docs.googleapis.com/v1/documents/{docId}:batchUpdate" \
  --body '{"requests":[
    {"insertText":{"location":{"index":12},"text":"Cell D"}},
    {"insertText":{"location":{"index":10},"text":"Cell C"}},
    {"insertText":{"location":{"index":7},"text":"Cell B"}},
    {"insertText":{"location":{"index":5},"text":"Cell A"}}
  ]}' -m "Populate table cells"
```

The response has one empty `{}` per request in `replies[]` (count them to confirm all landed) plus `writeControl.requiredRevisionId`. Same pattern applies to other Docs API requests (`updateTextStyle`, etc.).

## Pagination (Drive list)

`find-document` returns up to ~100 with no paging. For bulk listing use `request`
and follow `nextPageToken` (it survives the proxy, in `result.nextPageToken`):

```bash
numa integrations request google_docs GET \
  "https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.document%27&pageSize=100&fields=nextPageToken,files(id,name)" \
  -m "List Google Docs"
# next page: &pageToken=<token>
```
