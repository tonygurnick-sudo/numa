# OneNote Integration Tips

All OneNote calls go through the `numa integrations` CLI. Action keys follow
`onenote-<name>` (`numa integrations pipedream-actions onenote` lists them).
It's the Microsoft Graph OneNote API under the hood. Auth prop: pass
`"app": {"authProvisionId": "auto"}` — it works across the action set (the
`list-*-id-options` actions name the auth prop `onenote` in their schema, but the
proxy normalises the key, so `app` is accepted everywhere; verified).

## ⚠️ Page-level actions need a scope this connection may not have

Verified on a connected personal account: **page actions return 403** (Graph error
`40004` — the token lacks `Notes.Read` / `Notes.ReadWrite`). Affected:
`search-pages`, `get-page`, `get-page-content`, `list-page-id-options`, and any
direct `request` to `…/onenote/pages/…`. **Notebook/section listing and
`create-page`/`create-section`/`create-notebook` all work** — so you can _write_ a
page but not read or edit it back through this connection.

This is a token-scope limitation. Don't burn calls retrying page reads — if the
connection carries `Notes.Read`/`Notes.ReadWrite` they'd work, but on a token
without them there's no `request` workaround (the proxy uses the same token).

## What works (notebooks & sections)

- **`search-notebooks`** / **`search-sections`** — list notebooks/sections. `search-notebooks` with `"expand": "sections"` returns each notebook's sections embedded — a whole nav tree in one call.
- **`list-notebook-id-options`** / **`list-section-id-options`** — label/value pairs.
- **`create-notebook`** / **`create-section`** (needs `notebookId`) / **`create-page`** (needs `sectionId` + `html`).
- `notebookId` resolves via props-options: `numa integrations pipedream-props-options onenote onenote-create-section notebookId --configured '{"app":{"authProvisionId":"auto"}}'`.

## `search` rejects hyphens — use `filter` instead

The `search` prop uses OData search-token syntax, which rejects `-` (and other punctuation): `search: "NUMA-CLI-TEST"` → `400 BadRequest: character '-' is not valid`. Use the `filter` prop with an OData expression:

```json
{ "filter": "contains(displayName, 'NUMA')" } // ✓
```

## Notebook naming restrictions

OneNote rejects names containing any of `? * \ / : < > |` (error `20115`). This bites ISO timestamps — `2026-06-22T06:53Z` fails on the colons. Use a date-only stamp (`2026-06-22`).

## Notebook ID formats — two shapes, both valid

Older notebooks: `0-{hex}!{int}` (e.g. `0-8E…!142`). Newly created: `0-{hex}!s{uuid-hex}`. Both work identically as `notebookId` in follow-up calls.

## `create-page` — HTML must be a full document

`html` must be a complete document; the `<title>` becomes the page title:

```json
{
  "app": { "authProvisionId": "auto" },
  "sectionId": "0-…!s…",
  "html": "<!DOCTYPE html><html><head><title>My Page</title></head><body><h1>Heading</h1><p>Content</p></body></html>"
}
```

## Deleting

- **Notebooks:** the OneNote API (`DELETE /me/onenote/notebooks/{id}`) returns **404** on personal/consumer accounts. But a notebook is just a OneDrive folder — delete it via the **OneDrive driveItems API**, using the notebook id with the **`0-` prefix stripped**:
  ```bash
  # notebook id 0-8E…!s…  →  drive item id 8E…!s…
  numa integrations request onenote DELETE \
    "https://graph.microsoft.com/v1.0/me/drive/items/{driveItemId}" -m "Delete notebook"
  ```
  (You can also resolve the folder by path: `GET /me/drive/root:/Documents/{Notebook Name}` → use the returned `id`.) A 204 No Content (empty body, shows as `binary size:0`) = success.
- **Sections / pages:** deletion needs `Notes.ReadWrite` — blocked by the same scope gap above.
- The legacy `www.onenote.com` API is **domain-blocked by the proxy** ("Domain … is not allowed for this app") — don't try it.

## Direct API (`numa integrations request onenote`)

Uses the same token as the actions (so the page-scope gap applies equally). Notebook/section listing works:

```bash
numa integrations request onenote GET "https://graph.microsoft.com/v1.0/me/onenote/notebooks" -m "List notebooks"
numa integrations request onenote GET "https://graph.microsoft.com/v1.0/me/onenote/sections" -m "List sections"
```
