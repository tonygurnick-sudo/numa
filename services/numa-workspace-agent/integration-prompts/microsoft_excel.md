# Microsoft Excel Integration Tips

All Excel calls go through the `numa integrations` CLI. Action keys follow
`microsoft_excel-<name>` (`numa integrations pipedream-actions microsoft_excel`
lists them). It's the Microsoft Graph **workbook API** under the hood. Auth prop:
pass `"microsoftExcel": {"authProvisionId": "auto"}` — it works across the action
set (a schema or two name it differently, e.g. `list-folder-id-options`, but the
proxy normalises the key; verified).

## Account / drive requirement

Works on **personal OneDrive** and on **work/school (M365) accounts that have a
SharePoint Online licence**. A tenant **without an SPO licence** authenticates
fine but fails _every_ file operation with `Tenant does not have a SPO license`.
If file ops error that way, check the drive:

```bash
numa integrations request microsoft_excel GET "https://graph.microsoft.com/v1.0/me/drive" -m "Check drive"
```

`driveType` of `personal` or `business` (with SPO) = good.

## Identifying the file & sheet

- **`folderId`** — pass **`"root"`** for the OneDrive root (the common case). Its props-options does resolve (returns root + folders) but `"root"` is simplest.
- **`sheetId`** is actually the **OneDrive item ID** (e.g. `8E…!s28…`), not a worksheet id — the prop label is misleading. props-options for it tends to return empty, so get the id from a Graph search:
  ```bash
  numa integrations request microsoft_excel GET \
    "https://graph.microsoft.com/v1.0/me/drive/search(q='.xlsx')?\$select=id,name,parentReference&\$top=50" -m "Find Excel files"
  ```
- **`worksheet`** — the tab **name** string (e.g. `"Sheet1"`). List them: `GET .../items/<id>/workbook/worksheets`.

## Reading

- **`get-spreadsheet`** — no `range` = the used range; returns `values`, `text`, `formulas`, `valueTypes`, and a `csv` string.
- **`get-columns`** → columns keyed by letter (`{"A":[…],"B":[…]}`).
- **`find-row`** returns the **first match only** (scans the column, lowest-index hit) — there's no find-all. For all matches, `get-spreadsheet` and filter client-side.
- **`get-table-rows`** needs a formal Excel **Table** object (Insert → Table), not a plain range; returns `[]` for a header-only table.

## Writing rows / cells

- **`add-row`** — `values` is a **`string[]`** (one row, positional), appended to the used range.
- **`update-cell`** — single cell.
- **`add-a-worksheet-tablerow`** — `values` is a **stringified 2D array** (`"[[\"Alice\",95,\"Pass\"]]"` — the outer array is required, even for one row). It also needs an explicit **`tableId`**: the schema injects `tableId` via `reloadProps` on `sheetId` (UI-only), so a CLI caller must pass it or get a 404. Get table ids from `GET .../worksheets/<sheet>/tables` and pass the `id` (e.g. `{A4B6…}`).
- **`update-worksheet-tablerow`** — `rowId` is the **zero-based index** within the table, as a string (`"0"` = first data row; headers don't count). Its schema says "work/school only" but it works on personal accounts too (stale caveat).

**Date gotcha:** an ISO string like `"2026-06-22"` in a `values` array is stored as an Excel **date serial** (`46195`) with a date format applied — not as text. Pass it deliberately, or store in a non-date column / pre-format if you need the literal string.

## Direct Graph API (`numa integrations request`) — capable, with one hard limit

Any **JSON-body** Graph workbook/drive operation works through the proxy. Verified:

| Operation                                | Verb            | Endpoint                                                                                    |
| ---------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| Read / update a range (multi-cell)       | GET / **PATCH** | `.../worksheets/Sheet1/range(address='A1:C1')`                                              |
| Create a worksheet                       | POST            | `.../workbook/worksheets`                                                                   |
| **Create a new workbook** (0-byte entry) | POST            | `.../drive/root/children` body `{"name":"x.xlsx","file":{}}`                                |
| Download a workbook                      | GET             | `.../items/<id>/content` → lands in `/workdir/tmp/integrations-results/` as a valid `.xlsx` |
| Delete file / table                      | DELETE          | `.../drive/items/<id>` · `.../workbook/tables/<id>`                                         |
| Delete a row range                       | **POST**        | `.../range(address='A29:M29')/delete` body `{"shift":"Up"}`                                 |

- **PATCH a range** is a great multi-cell alternative to `update-cell` (one call, returns the range object): `--body '{"values":[["H1","H2"]]}'`.
- **Range delete is POST to the `/delete` sub-resource** (`{"shift":"Up"}`) — the `DELETE` verb on a range returns **405**.
- 204-No-Content successes (deletes) show up as a `binary, size:0` "download" — that's success, not an error.
- URL-encode table-id braces: `{` → `%7B`, `}` → `%7D`.

**The one hard limit — binary upload is blocked by design.** The Numa proxy refuses media/binary uploads (`PUT/PATCH …/content` with a file body, or `createUploadSession`) — it's a deliberate guard (it would otherwise send a JSON-wrapped body that corrupts the file). So you **can't push an existing `.xlsx` binary up to OneDrive** through this integration. **Downloading works fine.**

**To create a new workbook anyway:** don't try to upload one — `POST .../drive/root/children` with `{"name":"My Sheet.xlsx","file":{}}` makes an empty `.xlsx` entry, then populate it with the actions (`add-row`, `update-cell`) or `PATCH` ranges. No binary upload needed.
