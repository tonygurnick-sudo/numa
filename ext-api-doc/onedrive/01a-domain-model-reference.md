---
api_name: OneDrive (Microsoft Graph)
api_slug: onedrive
companion_of: 01-llm-api-rules.md
scope: domain model — entities, facets, relationships, business rules
base_url: https://graph.microsoft.com/v1.0
path_scope: /me/drive only (read-only)
confidence: confirmed against docs + shipped provider unless tagged [DOCUMENTED] (docs only) / [INFERRED] / [UNKNOWN]
---

# OneDrive — Domain Model Reference

Whole model = two entities: a **`drive`** (file container) and a **`driveItem`** (file/folder/other). Everything you browse, search, or download is a `driveItem`. Item behavior is determined by **facets** — small objects (`folder`, `file`, `remoteItem`, `deleted`, `root`) whose **presence** tells you what the item is. There is no `type` field.

## drive

Path: `/me/drive` (this connector), also `/drives/{id}`, `/users/{id}/drive`, `/sites/{id}/drive`. A user's OneDrive or a SharePoint document library. Read-only here.

| Field     | Type        | Description                                 |
| --------- | ----------- | ------------------------------------------- |
| id        | string      | Drive id (opaque, e.g. `b!xyz`)             |
| driveType | string      | `personal` / `business` / `documentLibrary` |
| owner     | identitySet | Owning user/group                           |
| quota     | quota       | `{total,used,remaining,deleted}` bytes      |
| root      | driveItem   | The root folder driveItem                   |

`driveType` decides the **hash algorithm** (`quickXorHash` for business/SP, `sha1Hash` for personal) and whether `cTag` is present. [DOCUMENTED]

## driveItem (central entity)

Path: `/me/drive/items/{id}` (by id) OR `/me/drive/root:/path/to/file` (by path — unused by connector). A file, folder, or other item; facets define behavior. Read here; create/update/delete exist in Graph but are out of scope under `Files.Read.All`.

Fields (the connector's `$select` set + key extras). All read-only for this connector:

| Field                          | Type           | Description                                        | Example                       |
| ------------------------------ | -------------- | -------------------------------------------------- | ----------------------------- |
| id                             | string         | Unique item id within drive (opaque)               | `01ABC...123`                 |
| name                           | string         | Filename + extension                               | `Budget.xlsx`                 |
| size                           | Int64          | Bytes (0 for folders)                              | `84213`                       |
| folder                         | folder facet   | **Present ⇒ folder**; has `childCount`             | `{"childCount":8}`            |
| file                           | file facet     | **Present ⇒ file**; has `mimeType`, `hashes`       | `{"mimeType":"..."}`          |
| createdDateTime                | DateTimeOffset | Creation ts (ISO 8601 UTC)                         | `2026-03-01T16:40:00Z`        |
| lastModifiedDateTime           | DateTimeOffset | Last-modified ts                                   | `2026-05-28T08:22:10Z`        |
| parentReference                | itemReference  | `{driveId,id,path}` of parent                      | `{"id":"01ROOT..."}`          |
| webUrl                         | string         | Browser URL to view item                           | `https://...sharepoint.com/…` |
| eTag                           | string         | eTag for whole item (metadata + content)           | `"aRDQ...0"`                  |
| cTag                           | string         | eTag for content only; **omitted for folders**     | `"aYzp...256"`                |
| file.hashes                    | hashes         | `quickXorHash` (business) or `sha1Hash` (personal) | `{"quickXorHash":"..."}`      |
| `@microsoft.graph.downloadUrl` | string         | Short-lived (~1 hr) preauth URL; must `$select` it | `https://...1drv.com/...`     |
| remoteItem                     | remoteItem     | **Present ⇒ item lives in another drive** (shared) | `{"id":"...",...}`            |
| deleted                        | deleted facet  | **Present in delta ⇒ item removed**                | `{}`                          |
| root                           | root facet     | **Present ⇒ drive root** (no parent)               | `{}`                          |

### Relationships

| Related              | Relationship                 | Expressed via             | Notes                                 |
| -------------------- | ---------------------------- | ------------------------- | ------------------------------------- |
| drive                | item belongs to drive        | `parentReference.driveId` | every item lives in exactly one drive |
| driveItem (children) | folder → many items          | `/items/{id}/children`    | only folder-facet items have children |
| driveItem (parent)   | item → one parent            | `parentReference.id`      | root item has `root` facet, no parent |
| driveItem (shared)   | item → item in another drive | `remoteItem` facet        | surfaced by `/me/drive/search`        |
| driveItemVersion     | item → many versions         | `/items/{id}/versions`    | out of scope                          |
| permission           | item → many permissions      | `/items/{id}/permissions` | out of scope                          |

```
drive ──1:N──▶ driveItem(root facet)
                  │ 1:N children (folder-facet items only)
                  ▼
              driveItem(file OR folder) ◀── parentReference.id (N:1 → parent)
                  │ remoteItem facet
                  ▼
              driveItem in ANOTHER drive (shared with the user)
```

## State machine

driveItems are not stateful workflow objects. Only lifecycle: **live → deleted (recycle bin) → permanently deleted**, surfaced via the `deleted` facet in **delta** responses. No transitions driven by this read-only connector. [DOCUMENTED]

```
[live] ──delete──▶ [deleted facet appears in delta] ──purge──▶ [gone]
```

## Business rules

**Type / facet:**

- Facet presence defines type: folder = `folder` facet, file = `file` facet. No `type` field. Provider branches on `"folder" in item`.
- `cTag` omitted for folders — don't rely on it for directory items. [DOCUMENTED]
- `root` facet ⇒ no parent (drive root has no `parentReference.id`). [DOCUMENTED]
- `remoteItem` facet ⇒ item physically lives in another drive (shared). Its own `id` is local; the real item is `remoteItem.id` in `remoteItem.parentReference.driveId`. [DOCUMENTED]

**Download / hash:**

- `@microsoft.graph.downloadUrl` is short-lived (~1 hr) and preauthenticated — fetch per-download, never cache. [DOCUMENTED]
- `/content` returns a `302` to `*.1drv.com` / SharePoint. Token must **not** be forwarded to the redirect target — provider uses `follow_redirects=False`, then re-requests `Location` with no `Authorization` header.
- Hash algo by account type: `quickXorHash` (Business/SharePoint), `sha1Hash` (personal). Provider prefers `sha1Hash`, falls back to `quickXorHash`.

**Safety:**

- Item IDs are opaque — never parse. Provider rejects ids containing `/`, `\`, or `..` (regex `[/\\\.]{2,}|[/\\]`) before interpolating into URLs (path-traversal guard).
- Size guard: downloads > 100 MB (`MAX_DOWNLOAD_SIZE`) rejected, checked via `Content-Length` on both the 302 redirect and the final response.

## Field formats

| Format    | Pattern                         | Example                                  | Notes                                     |
| --------- | ------------------------------- | ---------------------------------------- | ----------------------------------------- |
| DateTime  | ISO 8601 UTC `DateTimeOffset`   | `2026-05-28T08:22:10Z`                   | `createdDateTime`, `lastModifiedDateTime` |
| ID        | Opaque (alphanumeric + `!`/`.`) | `01ABCDEF!123`, `D4648F06C91D9D3D!54927` | treat as opaque; never parse              |
| Size      | Int64 bytes                     | `84213`                                  | `0` for folders                           |
| Path      | Colon-escaped relative path     | `/me/drive/root:/Reports/Q1:`            | `:` brackets the path segment             |
| eTag/cTag | Quoted opaque string            | `"aRDQ...0"`                             | use for `if-none-match` / `if-match`      |
| Hash      | Base64-ish opaque string        | `quickXorHash: "AbC123..."`              | algorithm depends on `driveType`          |

## Enums

| Entity      | Field     | Values                                                             | Notes                                  |
| ----------- | --------- | ------------------------------------------------------------------ | -------------------------------------- |
| drive       | driveType | `personal`, `business`, `documentLibrary`                          | determines hash algo + `cTag` behavior |
| delta token | token     | `latest`, ISO timestamp (Business/SP only), or a prior delta token | controls change enumeration            |
| file.hashes | algorithm | `quickXorHash` (business/SP), `sha1Hash` (personal)                | provider prefers sha1, then quickXor   |
