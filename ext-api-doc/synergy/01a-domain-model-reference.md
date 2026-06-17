---
api_name: 12d Synergy
api_slug: synergy
doc: domain-model reference (on-demand companion to 01-llm-api-rules.md)
source: derived from Swagger spec (~274 models [INFERRED]); full dump in 02-api-spec-investigation.md
casing_rule: NEVER assume casing — check the specific model in the spec. JobModel/FileModel/FolderModel/PagedResultModel/AttributeValue = PascalCase; TaskItemModel/ContactModel = snake_case; EntityID uses underscore-prefixed keys.
id_rule: EntityID is a composite OBJECT, not a scalar. Use IDString ("N_N", underscore) in URL paths.
confidence: shapes verified against live API where tagged "confirmed"; others [INFERRED] from Swagger.
---

# 12d Synergy — Domain Model Reference

## Entity-Relationship

```
Companies ──has many──► Users
Users ──► Teams (many:many), Contacts; owns/assigned ──► Tasks, Jobs, Issues
Jobs ──contain──► Folders, Files, 12d Projects
Folders ──contain──► Files (and nested Folders)
Files ──► IssuedFiles (transmittals), Versions
Cross-cutting (attach to many entity types): Attributes, Workflows, Associations (link any two entities), WebForms, Forums (threads), Notes, Maps (GIS on Jobs), Categories (taxonomy)
```

## EntityID (universal identifier)

Composite object — NOT a plain int or UUID.
`{"_id":12345,"_server_id":1,"_server_guid":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","IDString":"12345_1"}`

| Field          | Type        | Description                                  |
| -------------- | ----------- | -------------------------------------------- |
| `_id`          | int64       | numeric id within the server                 |
| `_server_id`   | int32       | server instance id                           |
| `_server_guid` | uuid string | globally unique server id                    |
| `IDString`     | string      | `{_id}_{_server_id}` — use this in URL paths |

## PagedResultModel[T] (every paginated list; PascalCase)

`{"PageNumber":1,"PageSize":50,"TotalPages":3,"TotalRows":142,"Result":[]}`
`PageNumber` 1-based; `Result` = T[] for this page.

## JobModel (PascalCase)

Jobs = the primary org unit = "projects".
`{"ID":{"_id":100,"_server_id":1,"_server_guid":"...","IDString":"100_1"},"Name":"Highway Upgrade Stage 2","Description":"Major infrastructure upgrade project","Path":"/Projects/Infrastructure","ParentJobID":{"IDString":"50_1"},"Attributes":[{"Name":"ProjectManager","Value":"Jane Smith"}],"CreatedDate":"2026-01-15T00:00:00Z","Type":0}`

| Field         | Type             | Description                       |
| ------------- | ---------------- | --------------------------------- |
| `ID`          | EntityID         | composite id                      |
| `Name`        | string           | job name                          |
| `Description` | string           | job description                   |
| `Path`        | string           | hierarchical path in job tree     |
| `ParentJobID` | EntityID\|null   | parent job (hierarchical nesting) |
| `Attributes`  | AttributeValue[] | custom key-value pairs            |
| `CreatedDate` | datetime         | creation timestamp                |
| `Type`        | int32            | `0`=Job, `1`=Template             |

Business rules: jobs nest via `ParentJobID`; fetch `GET /api/v1/jobs/getStandardAttributes` + `getDefaultAttributes` before create (no `/attributes/required/jobs`); include all required attrs in the create payload; jobs contain folders, files, 12d projects, workflows.

## TaskItemModel (snake_case — unlike most models)

`{"id":{"IDString":"500_1"},"name":"Review drainage design","description":"Check drainage calculations against AS3500","due_date_utc":"2026-04-01T00:00:00Z","is_closed":false,"item_owner":{"IDString":"10_1"},"children":[{"id":{"IDString":"501_1"},"name":"Sub-task: Check pipe sizing","is_closed":false}]}`

| Field          | Type            | Description              |
| -------------- | --------------- | ------------------------ |
| `id`           | EntityID        | composite id             |
| `name`         | string          | task name                |
| `description`  | string          | task description         |
| `due_date_utc` | datetime        | due date UTC (ISO 8601)  |
| `is_closed`    | boolean         | completed?               |
| `item_owner`   | EntityID        | assigned user/owner      |
| `children`     | TaskItemModel[] | sub-tasks (hierarchical) |

State machine: Open (`is_closed:false`) ⇄ Closed (`is_closed:true`) via close/reopen.
Business rules: create/update = `POST /api/Tasks` (NO `/v1/`), one endpoint for both (`id` set = update); no `PUT` variant. Delete = `DELETE /api/v1/tasks/{task_id}/{description}` (description URL-encoded in path). Hierarchy via `children`. All fields snake_case.

## FileModel (PascalCase)

`{"ID":{"IDString":"2000_1"},"FileName":"drainage-plan-v3.dwg","Path":"/Projects/Infrastructure/Drawings","FolderID":{"IDString":"300_1"},"LatestVersion":3,"LastModified":"2026-03-28T14:30:00Z","IsCheckedOut":false}`

| Field           | Type     | Description                |
| --------------- | -------- | -------------------------- |
| `ID`            | EntityID | composite id               |
| `FileName`      | string   | filename with extension    |
| `Path`          | string   | full folder-hierarchy path |
| `FolderID`      | EntityID | parent folder              |
| `LatestVersion` | int32    | current version number     |
| `LastModified`  | datetime | last modification          |
| `IsCheckedOut`  | boolean  | locked for editing?        |

State machine: Available (`IsCheckedOut:false`) ──checkout──► Checked Out ──checkin──► Available (`LatestVersion`+1).
Business rules: check out before modifying; check-in increments `LatestVersion`; a file belongs to exactly one folder (`FolderID`); search is `POST /api/v1/files/search` (body pagination, `{FileName,Contents,Page,PageSize,LimitSearchTo,LimitID}`); download `POST /api/v1/files/{id}/download/{version}/{with_references}` (3 path params, empty body — get `LatestVersion` first via `GET /api/v1/files/{id}/{retrieve_attributes}`); version history `GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}`.

## FolderModel (PascalCase)

`{"ID":{"IDString":"300_1"},"Name":"Drawings","Path":"/Projects/Infrastructure/Drawings","ParentFolderID":{"IDString":"200_1"}}`

| Field            | Type           | Description             |
| ---------------- | -------------- | ----------------------- |
| `ID`             | EntityID       | composite id            |
| `Name`           | string         | folder name             |
| `Path`           | string         | full hierarchical path  |
| `ParentFolderID` | EntityID\|null | parent folder (nesting) |

Business rules: folders form a tree and belong to jobs; folder items (subfolders + page 1 files) `GET /api/v1/folders/{id}/items` → FolderItemsModel; paginated files `GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}` (6 segments).

## ContactModel (snake_case — confirmed from live API)

`{"id":{"IDString":"1_1"},"is_user":true,"companies":[],"first_name":"Test","last_name":"User","email":"Test.User@test.com","active":true,"create_date":"2024-12-10T01:48:00.25","attributes":[],"image_modified_date_time":"2024-12-10T01:48:03.23"}`

| Field                      | Type        | Description                 |
| -------------------------- | ----------- | --------------------------- |
| `id`                       | EntityID    | composite id                |
| `is_user`                  | boolean     | also a system user?         |
| `companies`                | Company[]   | associated companies        |
| `first_name` / `last_name` | string      | name                        |
| `email`                    | string      | email                       |
| `active`                   | boolean     | active?                     |
| `create_date`              | datetime    | creation                    |
| `attributes`               | Attribute[] | custom attrs                |
| `image_modified_date_time` | datetime    | profile image last modified |

Full details: `GET /api/v1/Contacts/{id}/true/true` (retrieve_attributes=true, retrieve_companies=true). Spec exposes 21 contact endpoints (lists, signatures, thumbnails, mentions, system attributes).

## Supporting models

- AttributeValue: `{"Name":"ProjectManager","Value":"Jane Smith"}`
- AttributeDefinition: `{"Name":"ProjectManager","Type":"string","Required":true,"EntityType":"Job"}`
- WorkflowModel [INFERRED Pascal]: `{"ID":{"IDString":"400_1"},"Name":"Document Review Workflow","Status":"Active","Steps":[]}`
- IssueModel [INFERRED Pascal]: `{"ID":{"IDString":"600_1"},"Title":"Clash detected at chainage 1450","Status":"Open","Priority":"High","AssignedTo":{"IDString":"10_1"}}`
- IssuedFileModel: a file transmitted/issued to external parties.
- WebFormModel: structured data-capture forms (field defs + submissions).
- ForumModel: discussion threads on entities. NoteModel: annotations on entities. MapModel: GIS features on jobs. ClashDetectionModel: 3D model clash results. 12dProjectModel: 12d Model software project integration.

## Enums

Job Type: `0`=Job, `1`=Template. Other enums are integer-based; exact values for Issue-tracking/Workflow statuses & priorities vary by entity — verify against the live spec.

## Cross-entity relationships

Job→Folders 1:many · Job→Files 1:many (via folders) · Job→Tasks 1:many · Job→12d Projects 1:many · Job→Attributes 1:many · Job→Workflows 1:many · Folder→Files 1:many · Folder→Folders 1:many · File→Versions 1:many · File→IssuedFiles 1:many · Task→Tasks 1:many · User→Teams many:many · User→Company many:1 · Contact→Company many:1 · Entity→Entity many:many (Associations) · Entity→Notes 1:many · Entity→Forums 1:many.
