# Google Sheets Integration Tips

All Google Sheets calls go through the `numa integrations` CLI. Action keys follow
`google_sheets-<name>` (`numa integrations pipedream-actions google_sheets` lists
them). Auth prop: pass `"googleSheets": {"authProvisionId": "auto"}` — it works
across the action set (a few schemas name the auth prop `app` —
`insert-comment`/`insert-anchored-note`/`insert-dimension`/`move-dimension` — but
the proxy normalises the key, so `googleSheets` is accepted everywhere; verified).

## ⚠️ Two schema families — know which one an action uses

This is the biggest source of confusion. Actions identify the spreadsheet/worksheet two different ways:

| Family                 | Spreadsheet prop         | Worksheet prop                                                  | Example actions                                                                                                                                                                 |
| ---------------------- | ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New-style** (prefer) | `spreadsheetId` (string) | `sheetName` (tab name string)                                   | `read-rows`, `find-rows`, `add-rows`, `add-worksheet`, `get-spreadsheet-info`, `new-spreadsheet`, `list-spreadsheets`                                                           |
| **Legacy**             | `sheetId` (string)       | `worksheetId` (**integer** numeric sheet id — NOT the tab name) | `get-cell`, `update-cell`, `update-multiple-rows`, `upsert-row`, `add-single-row`, `add-multiple-rows`, `delete-rows`, `clear-rows`, `delete-worksheet`, `copy-worksheet`, etc. |

Mixing them (e.g. passing a tab name where an integer `worksheetId` is expected) silently breaks the call.

**Always start with `get-spreadsheet-info`** (new-style, takes `spreadsheetId`) — it returns, per worksheet, **both** the `sheetName` (for new-style) and the numeric `sheetId` (use as `worksheetId` for legacy actions):

```json
{ "worksheets": [{ "sheetName": "Sheet1", "sheetId": 2133131621, "rowCount": 1003, "headers": ["Name", "Email"] }] }
```

(`list-worksheets` also works but nests the id under `ret[n].properties.sheetId`.)

## `insert-comment` uses `fileId` (not `sheetId`)

Beyond the auth-key normalisation above, one real prop quirk: `insert-comment`'s
spreadsheet prop is **`fileId`** (it's a Drive comment), not `sheetId`/`spreadsheetId`.
The other Drive-ish actions (`insert-anchored-note`, `insert-dimension`,
`move-dimension`) keep `sheetId`.

## Reading

- **`read-rows`** (new-style) → `{headers, rows, rowCount}`; each row carries `_rowNumber`. `range` (A1) optional.
- **`find-rows`** (new-style, prefer) — `column` accepts a header name _or_ letter; `searchValue`; `matchType` = `exact` (case-insensitive) / `contains` (default) / `starts_with`. Returns matches with `_rowNumber`.
- **`get-cell`** / **`get-values-in-range`** (legacy) — `cell` / `range` in A1 notation.

## Adding rows

`rows` is a **JSON string** (stringify it), on `add-rows` / `add-multiple-rows` / `update-multiple-rows`.

- **`add-rows`** (new-style, prefer) — `rows` is a stringified array of objects keyed by header (**case-sensitive** — get exact headers from `get-spreadsheet-info`) or an array-of-arrays (positional):
  ```bash
  numa integrations pipedream-call google_sheets google_sheets-add-rows \
    --props '{"googleSheets":{"authProvisionId":"auto"},"spreadsheetId":"ID","sheetName":"Sheet1","rows":"[{\"Name\":\"Alice\",\"Email\":\"a@x.com\"}]"}' \
    -m "Add a row"
  ```
- **`add-single-row`** (legacy) — `myColumnData` is a positional `string[]`.
- **`add-multiple-rows`** (legacy) — `rows` is a stringified array-of-arrays.

## Updating

- **`update-cell`** (legacy) — `cell` (A1) + `newCell` (value). The reliable single-value update.
- **`update-multiple-rows`** (legacy) — `range` must be **bare A1** (`"A2:D5"`), **NOT** `"Sheet1!A2:D5"`: the action prepends the sheet name itself, so a prefixed range double-prefixes → `Unable to parse range: Sheet1!Sheet1!A2:D5`. `rows` is a stringified array-of-arrays.
- **`upsert-row`** (legacy) — `insert` (positional `string[]` = the full row), `column` (a **letter**, e.g. `"A"`, not a header), `value` (the key to match), optional `updates` (object `{columnLetter: newValue}`).
- **⚠️ `update-row` does NOT work via the CLI.** It uses `reloadProps: true` — after you set `worksheetId`/`hasHeaders`/`row`, Pipedream injects one prop _per column header_ at runtime from the live sheet. Those props aren't in the static schema, so there's nothing to pass, and the call errors with `undefined is not an array or an array-like`. (This is different from `remoteOptions`, which resolves _values_ for a known prop — here the props themselves don't exist until runtime.) Use **`update-cell`** (one value), **`update-multiple-rows`** (a range), or a direct `request` PUT instead:
  ```bash
  numa integrations request google_sheets PUT \
    "https://sheets.googleapis.com/v4/spreadsheets/{id}/values/Sheet1!A2:D2?valueInputOption=USER_ENTERED" \
    --body '{"values":[["Alice","a@x.com","90","Active"]]}' -m "Update a row"
  ```

## Deleting / clearing rows — mind the index base

- **`delete-rows`** (removes rows, shifts up) and **`clear-rows`** (blanks cells, leaves empty rows) use **1-based** row indices with an **exclusive** `endIndex`: row 3 only → `startIndex: 3, endIndex: 4`; rows 2–5 → `startIndex: 2, endIndex: 6`.
- **`insert-dimension` / `move-dimension`** use **0-based** indices (also exclusive `endIndex`) — the opposite base from delete/clear. Don't assume they match.

## Creating spreadsheets

- **`new-spreadsheet`** (prefer) — `title`, `sheetName`, `headers` (`string[]`) → concise `{spreadsheetId, title, url, worksheetName}`.
- **`create-spreadsheet`** (legacy) — verbose full API response; the only one that takes `folderId` (Drive placement) or duplicates an existing sheet via `sheetId`.

## Formatting (brief)

- **`update-formatting`** — RGB colours are floats in `[0,1]` passed as strings (`backgroundColorRedValue: "0.8"`).
- **`add-conditional-format-rule`** — `rgbColor` is an **object** `{red, green, blue}` (not separate channel props); `index` (zero-based) is required. `delete-conditional-format-rule` also takes a zero-based `index`.

## Direct API + deleting a spreadsheet

The token covers the full Sheets **and Drive** API (verified). Use `request` for batch reads, formula-preserving writes, and — since there's no delete-spreadsheet action — **deleting** a spreadsheet via the Drive API:

```bash
# Read a range
numa integrations request google_sheets GET \
  "https://sheets.googleapis.com/v4/spreadsheets/{id}/values/Sheet1!A1:D10" -m "Read range"
# Delete (trash) a spreadsheet — Drive API works through the Sheets token
numa integrations request google_sheets DELETE \
  "https://www.googleapis.com/drive/v3/files/{spreadsheetId}" -m "Delete spreadsheet"
```
