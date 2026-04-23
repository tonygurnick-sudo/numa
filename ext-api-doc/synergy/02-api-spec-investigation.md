# 12d Synergy API — Verified Endpoint Reference

> **Auto-generated from `synergy.12dsynergycloud.com/api-docs/api/v1`** (Swagger spec, v1).
> This file is the ground truth. If `01-llm-api-rules.md` disagrees,
> this file wins. Regenerate with `python3 tools/regen-synergy-spec-doc.py`.

- **Title:** 12d Synergy RESTful API V1
- **Version:** v1
- **Host:** synergy.12dsynergycloud.com
- **Base path:** `/api/v1`
- **Total paths:** 359
- **Total operations:** 369

---

## Critical Patterns (derived from Swagger)

### Pagination styles

- **Body-paginated (`/search` endpoints):** `{Page, PageSize}` in request body.
  Examples: `POST /api/v1/jobs/search`, `POST /api/v1/files/search`, `POST /api/v1/Contacts/search`, `POST /api/v1/tasks/search`.
- **Path-paginated (content listings):** `{page}/{page_size}` as path segments, often with other path params (filter, flags).
  Examples: `GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}`.
- **Non-paginated composite (`/items`):** single-shot response returning multiple collections in one blob.
  Examples: `GET /api/v1/jobs/{id}/items` → `JobItemsModel`; `GET /api/v1/folders/{id}/items` → `FolderItemsModel`.

### ID format

Every ID in a URL path is an `IDString` — format `"N_N"` (underscore separator, e.g. `"1_1"`).
Models expose `EntityID` with `{_id, _server_id, _server_guid, IDString}`.

### Version prefix exceptions

All endpoints use `/api/v1/` except:

- `POST /api/Tasks` — task create/update
- `GET /health` — health check

### Response shape conventions

- List/search endpoints → `PagedResultModel[T]` with `{PageNumber, PageSize, TotalPages, TotalRows, Result}`
- `/items` endpoints → composite model (see `JobItemsModel`, `FolderItemsModel`)
- Errors → **plain string**, NOT JSON. Swagger documents only 200 responses.

---

## Endpoints by Tag

### 12d Projects (19 endpoints)

| Method | Path                                                                              | Summary                                |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| POST   | `/api/v1/12dProjects/findByName`                                                  | Find 12d project by name               |
| POST   | `/api/v1/12dProjects/{folder_id}/cancel-checkout`                                 | Cancels a Checkout of a Project folder |
| POST   | `/api/v1/12dProjects/{folder_id}/checkout/{version}`                              | Checkout a 12 Project folder           |
| GET    | `/api/v1/12dProjects/{id}/associations`                                           | Get 12d project associations           |
| GET    | `/api/v1/12dProjects/{id}/changed-elements/{version}`                             | Get 12d Project changed elements       |
| GET    | `/api/v1/12dProjects/{id}/changelog/{page}/{page_size}`                           | Get 12d project history                |
| POST   | `/api/v1/12dProjects/{id}/checkIn`                                                | Check-in a 12 Project folder           |
| POST   | `/api/v1/12dProjects/{id}/copy`                                                   | Copy a 12 Project folder               |
| GET    | `/api/v1/12dProjects/{id}/description`                                            | Get 12d project description            |
| GET    | `/api/v1/12dProjects/{id}/details`                                                | Get 12d project details                |
| GET    | `/api/v1/12dProjects/{id}/fileInfo/{file_name}/{is_folder}/{retrieve_attributes}` | Get 12d project file info              |
| GET    | `/api/v1/12dProjects/{id}/folders/{retrieve_attributes}`                          | Get 12d project sub folders            |
| GET    | `/api/v1/12dProjects/{id}/latest-change`                                          | get latest change id for a td project  |
| POST   | `/api/v1/12dProjects/{id}/move`                                                   | Move a 12 Project folder               |
| GET    | `/api/v1/12dProjects/{id}/notes`                                                  | Get 12d project notes                  |
| GET    | `/api/v1/12dProjects/{id}/permission`                                             | Get user permission                    |
| GET    | `/api/v1/12dProjects/{id}/preview/{version}`                                      | Get 12d project preview image          |
| GET    | `/api/v1/12dProjects/{id}/{folder_id}/history/{page}/{page_size}`                 | Get 12d project full change history    |
| GET    | `/api/v1/12dProjects/{id}/{retrieve_attributes}`                                  | Get 12d project by id                  |

### Administration (17 endpoints)

| Method | Path                                                 | Summary                                                                                   |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/v1/admin/company-logo`                         | Get the base64 image of the client/company logo                                           |
| GET    | `/api/v1/admin/findAttributes`                       | Find attributes                                                                           |
| GET    | `/api/v1/admin/findEntityByItsPath/{path}`           | Finds the entity id and type for the given path                                           |
| POST   | `/api/v1/admin/generatePassword`                     | Generate new password                                                                     |
| GET    | `/api/v1/admin/getAdminContactEmail`                 | Get admin email address                                                                   |
| GET    | `/api/v1/admin/getAllGroups`                         | Get all Groups                                                                            |
| GET    | `/api/v1/admin/getChangeDescriptionMode`             | Get change description mode                                                               |
| GET    | `/api/v1/admin/getPreDefinedChangeDescriptions`      | Get Pre-defined Change Descriptions                                                       |
| GET    | `/api/v1/admin/getServerSetting`                     | Get server setting-value of a given setting-name                                          |
| POST   | `/api/v1/admin/getServerSettings`                    | Get server setting-values of given setting-names                                          |
| GET    | `/api/v1/admin/getTimezones`                         | Gets the timezones available on the server machine.                                       |
| GET    | `/api/v1/admin/getWebLink/{entity_id}/{entity_type}` | Get full web link for an entity                                                           |
| POST   | `/api/v1/admin/getWebServerPages`                    | Get list of Web Server Pages by types                                                     |
| GET    | `/api/v1/admin/getWebServerPages/{type}`             | Get list of Web Server Pages by type                                                      |
| GET    | `/api/v1/admin/isMicrosoft365Enabled`                | Check if microsoft 365 integration is enabled on the server                               |
| GET    | `/api/v1/admin/microsoft365-app-details`             | Get Microsoft 365 App Details                                                             |
| POST   | `/api/v1/admin/parseSynergyLink`                     | Parses a full synergy path and returns the id and details of the entity represented by it |

### Associations (4 endpoints)

| Method | Path                                                                     | Summary                                                        |
| ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| GET    | `/api/v1/Associations/GetAssociatedEntities/{id}/{type}/{expected_type}` | Get all entities associated with another or of a specific type |
| GET    | `/api/v1/Associations/GetNumberOfAssociatedEntities/{id}/{type}`         | Get the number of associations for a given EntityID            |
| POST   | `/api/v1/Associations/add`                                               | Add an association to an entity                                |
| POST   | `/api/v1/Associations/delete`                                            | Delete an association                                          |

### Attributes (11 endpoints)

| Method | Path                                                                       | Summary                                                      |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| POST   | `/api/v1/Attributes/calculateConstraints`                                  | Calculate and process attribute constraints                  |
| GET    | `/api/v1/Attributes/findAttributeByNameAndContext/{name}/{search_context}` | Find attribute by Name and Context                           |
| GET    | `/api/v1/Attributes/getDefaultJobSearchAttributes`                         | Get default Job search attributes                            |
| GET    | `/api/v1/Attributes/getStandardContactSearchAttributes`                    | Get standard Contact search attributes                       |
| GET    | `/api/v1/Attributes/getStandardFileSearchAttributes`                       | Get standard File search attributes                          |
| GET    | `/api/v1/Attributes/getStandardJobSearchAttributes`                        | Get standard Job search attributes                           |
| GET    | `/api/v1/Attributes/getSystemContactAttributes/{get_initial}`              | Get system Contact attributes                                |
| GET    | `/api/v1/Attributes/getSystemFileAttributes/{extension}`                   | Get system-wide file attributes for a given extension        |
| GET    | `/api/v1/Attributes/getSystemJobAttributes/{get_initial}`                  | Get system Job attributes                                    |
| POST   | `/api/v1/Attributes/updateAttributes`                                      | Update attributes                                            |
| POST   | `/api/v1/Attributes/validAttributeChoices`                                 | Validate enum items in attributes (when there is a workflow) |

### Authorisation (17 endpoints)

| Method | Path                                                    | Summary                                                             |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| POST   | `/api/v1/auth/delete-pat`                               | Delete a PAT                                                        |
| POST   | `/api/v1/auth/forgotPassword`                           | Forgot password                                                     |
| POST   | `/api/v1/auth/generate-auth-code`                       | Generate a new auth token for a logged in in user                   |
| POST   | `/api/v1/auth/generate-pat`                             | Create a new Personal Access Token for an app                       |
| POST   | `/api/v1/auth/get-onboarding-details`                   | Gets the onboarding details for a user                              |
| GET    | `/api/v1/auth/getAllSsoConfigs`                         | Get all available SSO Configs                                       |
| GET    | `/api/v1/auth/getMFADeviceRegistrationData/{username}`  | Get our MFA Device registration data                                |
| GET    | `/api/v1/auth/getPasswordRequirements`                  | Get password requirements                                           |
| GET    | `/api/v1/auth/getPersonalAccessTokens`                  | Authorisation_GetPersonalAccessTokens                               |
| GET    | `/api/v1/auth/getSsoConfigForUserIdentity/{identity}`   | Allows the client to fetch any SSO details for their provided email |
| GET    | `/api/v1/auth/getUserMfaStatus/{user_id}/{machine_key}` | Get user's MFA status                                               |
| POST   | `/api/v1/auth/onboard-user`                             | Onboard a user by accepting the terms and setting a password        |
| POST   | `/api/v1/auth/remove-auth-code`                         | Remove an auth token                                                |
| POST   | `/api/v1/auth/resetPassword`                            | Reset a password of a user                                          |
| POST   | `/api/v1/auth/send-mfa-code`                            | Re-send 2-factor code to email                                      |
| POST   | `/api/v1/auth/signout`                                  | Logout user (clear refresh token)                                   |
| POST   | `/api/v1/auth/validatePassword`                         | Validate a password                                                 |

### Categories (1 endpoints)

| Method | Path                 | Summary            |
| ------ | -------------------- | ------------------ |
| GET    | `/api/v1/categories` | Get all categories |

### ClashDetection (6 endpoints)

| Method | Path                                                                | Summary                                                              |
| ------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/v1/clash-detection/canUserAccess`                             | Get user permission                                                  |
| GET    | `/api/v1/clash-detection/clashes/{clash_id}/items`                  | Get the clash detection items                                        |
| GET    | `/api/v1/clash-detection/getDetails/{folder_id}`                    | Get the clash detections for a federated model. Queued and Completed |
| GET    | `/api/v1/clash-detection/getReport/{clash_id}/{format}/{delimiter}` | get a clash detection report file                                    |
| POST   | `/api/v1/clash-detection/start`                                     | Start a clash detection                                              |
| DELETE | `/api/v1/clash-detection/{clash_id}`                                | Delete a clash detection                                             |

### Companies (8 endpoints)

| Method | Path                                                         | Summary                                    |
| ------ | ------------------------------------------------------------ | ------------------------------------------ |
| GET    | `/api/v1/Companies`                                          | Get all companies                          |
| GET    | `/api/v1/Companies/canEdit`                                  | Whether or not the user can edit companies |
| GET    | `/api/v1/Companies/getSystemCompanyAttributes/{get_initial}` | Get system Company attributes              |
| POST   | `/api/v1/Companies/save`                                     | Save a company                             |
| GET    | `/api/v1/Companies/{id}/companyImage`                        | Get company image (base64)                 |
| GET    | `/api/v1/Companies/{id}/jobs`                                | Get all jobs of a given company            |
| GET    | `/api/v1/Companies/{id}/staff/{retrieve_attributes}`         | Get company staff (contacts)               |
| GET    | `/api/v1/Companies/{id}/{retrieve_attributes}`               | Get a Company by Id                        |

### Contacts (21 endpoints)

| Method                                                | Path                                                                                                   | Summary                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| GET                                                   | `/api/v1/Contacts/canEdit`                                                                             | Whether or not the user can edit contacts                  |
| GET                                                   | `/api/v1/Contacts/canEditList`                                                                         | Whether or not user can edit Contact List                  |
| DELETE                                                | `/api/v1/Contacts/deleteContactList/{list_id}`                                                         | Delete a contact                                           |
| POST                                                  | `/api/v1/Contacts/findMentionItems`                                                                    | Find mention items                                         |
| GET                                                   | `/api/v1/Contacts/getContactListContacts/{list_id}`                                                    | Get contacts for a given contact-list                      |
| GET                                                   | `/api/v1/Contacts/getGlobalContactLists`                                                               | Get global contact list                                    |
| GET                                                   | `/api/v1/Contacts/getJobContactLists/{job_id}`                                                         | Get a contact-list for a given job                         |
| GET                                                   | `/api/v1/Contacts/getStandardAttributes`                                                               | Get standard contact search attributes                     |
| GET                                                   | `/api/v1/Contacts/getSystemContactAttributes/{get_initial}`                                            | Get system contact attributes                              |
| GET                                                   | `/api/v1/Contacts/list/{page_no}/{page_size}/{get_attributes}/{sort_column}/{sort_direction}/{filter}` | Get all contacts                                           |
| POST                                                  | `/api/v1/Contacts/saveContact`                                                                         | Save a contact                                             |
| POST                                                  | `/api/v1/Contacts/saveContactList`                                                                     | Save a contact-list                                        |
| POST                                                  | `/api/v1/Contacts/saveContactSignature`                                                                | Save contact signature                                     |
| POST                                                  | `/api/v1/Contacts/search`                                                                              | Search contacts                                            |
| GET                                                   | `/api/v1/Contacts/searchAttributes/{name}`                                                             | Get contact custom search attributes                       |
| POST                                                  | `/api/v1/Contacts/setContactListContacts`                                                              | Set contacts of a contact-list                             |
| GET                                                   | `/api/v1/Contacts/simpleSearch/{term}/{users_only}`                                                    | Simple contact search (text). Returns the first 20 results |
| GET                                                   | `/api/v1/Contacts/{id}/isSignatureSet`                                                                 | Check if the given user has the signature set              |
| Only sys admin can see if the signature is set for ot |
| GET                                                   | `/api/v1/Contacts/{id}/signature`                                                                      | Get contact signature                                      |
| GET                                                   | `/api/v1/Contacts/{id}/thumbnail/{image_date_modified}`                                                | Get contact thumbnail                                      |
| GET                                                   | `/api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}`                                     | Get a contact by Id                                        |

### Documents (3 endpoints)

| Method | Path                                          | Summary                                                    |
| ------ | --------------------------------------------- | ---------------------------------------------------------- |
| POST   | `/api/v1/documents/extractStandardAttributes` | Extract attached standard attributes form a given document |
| GET    | `/api/v1/documents/hasStandardAttributes`     | Whether or not a file has standard attributes              |
| POST   | `/api/v1/documents/hasStandardAttributes`     | Whether or not a file has standard attributes              |

### Files (70 endpoints)

| Method                                                                      | Path                                                                                                                 | Summary                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET                                                                         | `/api/v1/files/SearchAttributes/{context}/{name}`                                                                    | Get custom file search attributes                                                                    |
| POST                                                                        | `/api/v1/files/add-contacts-to-microsoft-365-session`                                                                | add contacts to a microsoft 365 session                                                              |
| POST                                                                        | `/api/v1/files/attributeOnlyCheckIn`                                                                                 | Attribute-only file check out                                                                        |
| POST                                                                        | `/api/v1/files/batch-copy`                                                                                           | Copy multiple files to a folder                                                                      |
| POST                                                                        | `/api/v1/files/batch-move`                                                                                           | move multiple files to a folder                                                                      |
| POST                                                                        | `/api/v1/files/cancel-microsoft-365-session`                                                                         | Cancel a microsoft session for a file                                                                |
| POST                                                                        | `/api/v1/files/copy`                                                                                                 | Copy a file to a folder                                                                              |
| POST                                                                        | `/api/v1/files/createFile`                                                                                           | Create a new file                                                                                    |
| POST                                                                        | `/api/v1/files/delete`                                                                                               | Delete a file (mark file as deleted)                                                                 |
| POST                                                                        | `/api/v1/files/download-temp-file`                                                                                   | Download a temp file - currently supports for Microsoft 365 temp files                               |
| GET                                                                         | `/api/v1/files/download-vsfx-file/{type}/{id}/{version}`                                                             | Retrieve vsfx file for a given IFC file                                                              |
| POST                                                                        | `/api/v1/files/end-microsoft-365-session`                                                                            | End a microsoft session for a file                                                                   |
| POST                                                                        | `/api/v1/files/fetchLatestVersions`                                                                                  | Get latest version for a given files list                                                            |
| POST                                                                        | `/api/v1/files/finalizeChunkUpload/{session_id}`                                                                     | Finalize a chunk upload                                                                              |
| This method expects the chunk upload session id and file upload data includ |
| POST                                                                        | `/api/v1/files/findAndResolveFilePlaceHolders`                                                                       | Find and resolve file placeholders                                                                   |
| GET                                                                         | `/api/v1/files/findConverters/{search_term}`                                                                         | Find converts                                                                                        |
| POST                                                                        | `/api/v1/files/generateFileNameFromRule`                                                                             | Generate filename from a naming rule                                                                 |
| GET                                                                         | `/api/v1/files/getChangedFiles`                                                                                      | Get changed files since the given date                                                               |
| GET                                                                         | `/api/v1/files/getChunkUploadStatus/{session_id}`                                                                    | Files_GetChunkUploadStatus                                                                           |
| GET                                                                         | `/api/v1/files/getFileChangeVersion/{file_change_id}`                                                                | Get File version by file change id                                                                   |
| GET                                                                         | `/api/v1/files/getFileIDByChangeId/{file_change_id}`                                                                 | Get the file id by file change id                                                                    |
| GET                                                                         | `/api/v1/files/getFileInfoByName/{file_name}/{folder_id}/{retrieve_attributes}/{retrieve_flatten_parent_attributes}` | Get File info by name                                                                                |
| GET                                                                         | `/api/v1/files/getFileVersionCheckDetails/{code}`                                                                    | Allows authorized users to get the details to check if the file version associated with the qr code  |
| GET                                                                         | `/api/v1/files/getFileVersionCheckDetailsForPublic/{code}`                                                           | Allows anonymous users to get the details to check if the file version associated with the qr code i |
| GET                                                                         | `/api/v1/files/getIcon/{file_name}`                                                                                  | Get file icon                                                                                        |
| POST                                                                        | `/api/v1/files/getIcons`                                                                                             | Get file icons for a given file names                                                                |
| GET                                                                         | `/api/v1/files/getPreDefinedChangeDescriptions`                                                                      | Get pre-defined change descriptions                                                                  |
| GET                                                                         | `/api/v1/files/getStandardAttributes`                                                                                | Get standard file search attributes                                                                  |
| POST                                                                        | `/api/v1/files/initiateChunkUpload`                                                                                  | Initiates a file upload in chunks                                                                    |
| GET                                                                         | `/api/v1/files/isFileVersionCheckCodePublic/{code}`                                                                  | Checks if the file version check code is public                                                      |
| POST                                                                        | `/api/v1/files/move`                                                                                                 | Move a file to a folder                                                                              |
| POST                                                                        | `/api/v1/files/processNamingRules`                                                                                   | Process file naming rules (New method)                                                               |
| POST                                                                        | `/api/v1/files/rename`                                                                                               | Rename a file                                                                                        |
| POST                                                                        | `/api/v1/files/restore`                                                                                              | Restore a deleted file                                                                               |
| POST                                                                        | `/api/v1/files/search`                                                                                               | Files_Search                                                                                         |
| POST                                                                        | `/api/v1/files/start-microsoft-365-session`                                                                          | Start a microsoft session for a file                                                                 |
| POST                                                                        | `/api/v1/files/unlink`                                                                                               | Unlink more than one linked files                                                                    |
| POST                                                                        | `/api/v1/files/upload`                                                                                               | Use this method to Upload or add a new file                                                          |

This upload method only supports multi-part form data
|
| POST | `/api/v1/files/uploadChunk/{session_id}/{chunk_number}` | Uploads a file chunk
This method expects file chunk as multi-part form data
This method expects ch |
| GET | `/api/v1/files/{file_id}/{version}/microsoft-365-session` | Get Microsoft 365 session |
| GET | `/api/v1/files/{id}/adjacenthistory/{version}/{range}` | Gets the previous and preceding versions from the provided version |
| GET | `/api/v1/files/{id}/associations` | Get associated entities of a file |
| POST | `/api/v1/files/{id}/cancelCheckout` | Cancel a file which is checked-out |
| POST | `/api/v1/files/{id}/checkout` | Check-out a file |
| GET | `/api/v1/files/{id}/converters` | Get file converters of a file |
| GET | `/api/v1/files/{id}/download/{version}/{with_references}` | Download (stream) a file by ID and version (with or without references).
This action could take lon |
| POST | `/api/v1/files/{id}/download/{version}/{with_references}` | Download (stream) a file by ID and version (with or without references).
This action could take lon |
| POST | `/api/v1/files/{id}/getCodeForFileVersionCheck/{is_public}` | Returns a code that represents file id and version information to generate a QR code
This QR code w |
| GET | `/api/v1/files/{id}/getFileChangeId/{version}` | Get File info by file change id |
| GET | `/api/v1/files/{id}/getFileWithAllAttributes/{file_change_type}` | Get a file with all attributes
This is used to get the attributes to be prompted for the given file |
| POST | `/api/v1/files/{id}/getFileWithAllAttributes/{file_change_type}` | Get a file with all attributes
This is used to get the attributes to be prompted for the given file |
| GET | `/api/v1/files/{id}/getReferenceGraph/{version}/{show_referencing_files}` | Get File reference data |
| GET | `/api/v1/files/{id}/groups` | Get group access of a file |
| GET | `/api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size}` | Get file history |
| POST | `/api/v1/files/{id}/makeLatestVersion/{rollback_version}/{rollback_attributes_mode}` | This operation rollbacks a file to an older version and save it as a new version |
| GET | `/api/v1/files/{id}/notes` | Get file notes |
| GET | `/api/v1/files/{id}/permission` | Get user file permission |
| GET | `/api/v1/files/{id}/preview/{version}` | Get file preview |
| POST | `/api/v1/files/{id}/purge` | Purge a file (delete a file permanently) |
| GET | `/api/v1/files/{id}/thumbnail` | Get file thumbnail |
| POST | `/api/v1/files/{id}/unlink/{allow_unlink_when_referenced}/{replace_refs_with_link_source}` | Unlink a linked file |
| GET | `/api/v1/files/{id}/users` | Get user access of a file |
| GET | `/api/v1/files/{id}/versions/{version}/{retrieve_attributes}` | Get a file by Id and version |
| POST | `/api/v1/files/{id}/versions/{version}/{retrieve_attributes}` | Get a file by Id and version |
| GET | `/api/v1/files/{id}/weblink/{include_web_root_path}` | Get a link to a file |
| POST | `/api/v1/files/{id}/weblink/{include_web_root_path}` | Get a link to a file |
| GET | `/api/v1/files/{id}/{retrieve_attributes}` | Get a file by Id |
| POST | `/api/v1/files/{id}/{retrieve_attributes}` | Get a file by Id |
| GET | `/api/v1/files/{id}/{type}/ifc-object-tree/{handle}/properties` | Get the properties of an IFC object by its handle |
| GET | `/api/v1/files/{id}/{type}/{version}/ifc-object-tree` | Get the IFC object tree for a given IFC file |

### Folders (20 endpoints)

| Method | Path                                                                                                | Summary                                                   |
| ------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| POST   | `/api/v1/folders/copy`                                                                              | Copy folder to another                                    |
| POST   | `/api/v1/folders/create`                                                                            | Create a folder                                           |
| POST   | `/api/v1/folders/createFromTemplate`                                                                | Create folder from template                               |
| GET    | `/api/v1/folders/folder-change-id/{folder_id}/{version}`                                            | get folder change id                                      |
| GET    | `/api/v1/folders/get-root-model-folder/{folder_id}`                                                 | Get the root model folder id for a given folder id        |
| POST   | `/api/v1/folders/move`                                                                              | Move folder(s) to another                                 |
| POST   | `/api/v1/folders/rename`                                                                            | Rename a folder                                           |
| GET    | `/api/v1/folders/{id}/changelog/{page}/{page_size}`                                                 | Get folder change log/history                             |
| GET    | `/api/v1/folders/{id}/download`                                                                     | Download a folder (with option to get all sub-folders)    |
| POST   | `/api/v1/folders/{id}/download`                                                                     | Download a folder (with option to get all sub-folders)    |
| GET    | `/api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files}` | Get folder files                                          |
| GET    | `/api/v1/folders/{id}/folder-view-profile`                                                          | Get folder profile                                        |
| GET    | `/api/v1/folders/{id}/getAllowedExtensions`                                                         | Get allowed file extensions                               |
| GET    | `/api/v1/folders/{id}/getFileNamingRuleSets/{include_inherited}`                                    | Get file naming rule-set                                  |
| GET    | `/api/v1/folders/{id}/getWebPath/{job_id}`                                                          | Get web path                                              |
| GET    | `/api/v1/folders/{id}/isDataFlowIngressFolder`                                                      | Does this folder have any ingress DataFlow configurations |
| GET    | `/api/v1/folders/{id}/items`                                                                        | Get folder items                                          |
| GET    | `/api/v1/folders/{id}/notes`                                                                        | Get folder notes                                          |
| GET    | `/api/v1/folders/{id}/permission`                                                                   | Get user folder permission                                |
| GET    | `/api/v1/folders/{id}/{retrieve_attributes}`                                                        | Get a folder by Id                                        |

### Forums (13 endpoints)

| Method | Path                                                                     | Summary                          |
| ------ | ------------------------------------------------------------------------ | -------------------------------- |
| POST   | `/api/v1/Forums/createForumCategory`                                     | Create new forum category        |
| POST   | `/api/v1/Forums/createForumPost`                                         | Create a forum post              |
| POST   | `/api/v1/Forums/createForumTopic`                                        | Create new forum topic           |
| DELETE | `/api/v1/Forums/deleteForumItem/{item_type}/{id}`                        | Delete a forum item              |
| GET    | `/api/v1/Forums/getAll/{job_id}`                                         | Get all forums of a job          |
| GET    | `/api/v1/Forums/getForumCategoryTopic/{topic_id}`                        | Get forum topic by topic_id      |
| GET    | `/api/v1/Forums/getForumCategoryTopics/{category_id}/{page}/{page_size}` | Get forum category topics        |
| GET    | `/api/v1/Forums/getForumTopicPosts/{topic_id}/{page}/{page_size}`        | Get forum topic posts            |
| GET    | `/api/v1/Forums/getPermission/{id}`                                      | Forums_GetForumPermission        |
| POST   | `/api/v1/Forums/updateForumPost`                                         | Update a forum post              |
| GET    | `/api/v1/Forums/{id}`                                                    | Get a forum by Id                |
| GET    | `/api/v1/Forums/{id}/categories`                                         | Get forum categories by forum Id |
| GET    | `/api/v1/Forums/{id}/categories/{category_id}`                           | Get a forum category             |

### Gadgets (1 endpoints)

| Method | Path                                                      | Summary      |
| ------ | --------------------------------------------------------- | ------------ |
| GET    | `/api/v1/gadgets/getGadget/{job_id}/{gadget_id}/{inputs}` | Get a gadget |

### HealthCheck (1 endpoints)

| Method | Path      | Summary                |
| ------ | --------- | ---------------------- |
| GET    | `/health` | Health check endpoint. |

### Issue-tracking (18 endpoints)

| Method | Path                                                                    | Summary                                                     |
| ------ | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/v1/issue-tracking/add-watchers`                                   | Add issue ticket watchers                                   |
| POST   | `/api/v1/issue-tracking/delete-issue`                                   | Delete an issue                                             |
| GET    | `/api/v1/issue-tracking/get-issue/{issue_ticket_id}/{retrieve_details}` | Get issue ticket by issue ticket id                         |
| GET    | `/api/v1/issue-tracking/get-job-id/{issue_ticket_id}`                   | Get job id for a given issue ticket                         |
| GET    | `/api/v1/issue-tracking/get-preview/{issue_ticket_id}`                  | Get Issue Preview (of model) for issue                      |
| GET    | `/api/v1/issue-tracking/issue-count/{entity_id}/{entity_type}`          | Get issue ticket count for entity                           |
| GET    | `/api/v1/issue-tracking/issue-statuses/get`                             | get issue types                                             |
| GET    | `/api/v1/issue-tracking/issue-type/get/{type_id}/{issue_id}`            | Retrieve the issue statuses for an issue type               |
| GET    | `/api/v1/issue-tracking/issue-types/get/{retrieve_info}`                | get issue types                                             |
| GET    | `/api/v1/issue-tracking/issue/get-changes/{issue_id}`                   | Gets the issue changes in a structured format for the issue |
| GET    | `/api/v1/issue-tracking/issue/get-comments/{issue_id}`                  | Get an Issue                                                |
| POST   | `/api/v1/issue-tracking/issue/set-comment`                              | set issue comment                                           |
| POST   | `/api/v1/issue-tracking/issues/export`                                  | set issue comment                                           |
| POST   | `/api/v1/issue-tracking/issues/get`                                     | Issue-tracking_GetIssueList                                 |
| GET    | `/api/v1/issue-tracking/permission/get/{job_id}`                        | Get user permission                                         |
| POST   | `/api/v1/issue-tracking/remove-watchers`                                | Remove issue ticket watchers                                |
| POST   | `/api/v1/issue-tracking/set-issue`                                      | Creates or updates an issue ticket                          |
| POST   | `/api/v1/issue-tracking/set-preview`                                    | Set the preview for an issue ticket                         |

### Issued Files (21 endpoints)

| Method                                                                | Path                                                                                 | Summary                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| POST                                                                  | `/api/v1/issued-files/createIssuedFileSet`                                           | Create Issued FileSet                            |
| DELETE                                                                | `/api/v1/issued-files/deletePublish/{publish_id}`                                    | Delete a published file                          |
| GET                                                                   | `/api/v1/issued-files/downloadIssuedFiles/{issue_id}/{set_id}/{include_transmittal}` | Download a zip file containing all files issued  |
| This action could take longer to complete depending                   |
| POST                                                                  | `/api/v1/issued-files/downloadIssuedFiles/{issue_id}/{set_id}/{include_transmittal}` | Download a zip file containing all files issued  |
| This action could take longer to complete depending                   |
| GET                                                                   | `/api/v1/issued-files/downloadTransmittalFile/{issue_id}/{set_id}/{file_name}`       | Download (stream) a file by ID and version.      |
| This action could take longer to complete depending on                |
| POST                                                                  | `/api/v1/issued-files/downloadTransmittalFile/{issue_id}/{set_id}/{file_name}`       | Download (stream) a file by ID and version.      |
| This action could take longer to complete depending on                |
| GET                                                                   | `/api/v1/issued-files/getIssueDetails/{issue_id}`                                    | Get issue details                                |
| GET                                                                   | `/api/v1/issued-files/getIssuedFileIssueSetPublishedFileDetails/{issue_id}`          | Get issued file issue-set published file details |
| GET                                                                   | `/api/v1/issued-files/getIssuedFilePublishingInfo/{issue_id}`                        | Get issued file publishing info                  |
| GET                                                                   | `/api/v1/issued-files/getIssuedFileSet/{set_id}/{get_issues}`                        | Get issued file-set by set_id                    |
| This method could be more demanding and slow. Please use GetIssuedFil |
| GET                                                                   | `/api/v1/issued-files/getIssuedFileSetForDisplay/{set_id}/{get_issues}`              | Get issued file-set for display                  |
| GET                                                                   | `/api/v1/issued-files/getIssuedFileSetType/{type_id}`                                | Get issued file-set type by id                   |
| GET                                                                   | `/api/v1/issued-files/getIssuedFileSetVersionFiles/{set_id}/{version}`               | Get issued file-set version files                |
| GET                                                                   | `/api/v1/issued-files/getIssuedFileSets/{job_id}/{type_id}`                          | Get issued file-set by job and type              |
| GET                                                                   | `/api/v1/issued-files/getJobFileSetTypes/{job_id}`                                   | Get file-set types of a job                      |
| GET                                                                   | `/api/v1/issued-files/getPublishingInfo/{issue_id}`                                  | Get publishing info by issue_id                  |
| GET                                                                   | `/api/v1/issued-files/getRequiredIssueAttributes`                                    | Get required issue attributes                    |
| GET                                                                   | `/api/v1/issued-files/hasStoredTransmittalFile/{issue_id}`                           | Whether or not issue has a transmittal file      |
| POST                                                                  | `/api/v1/issued-files/issueFileSet`                                                  | Issue a File Set                                 |
| POST                                                                  | `/api/v1/issued-files/updateIssuedFileSet`                                           | Create Issued FileSet                            |
| POST                                                                  | `/api/v1/issued-files/updatePublishNotifications`                                    | add/remove Publish notifications                 |

### Jobs (27 endpoints)

| Method | Path                                             | Summary                                                                                              |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/jobs/calculateJobName`                  | Generates Job name by replacing the naming rule components with provided attribute values and timest |
| POST   | `/api/v1/jobs/create`                            | Create a new job (root/sub)                                                                          |
| POST   | `/api/v1/jobs/findMatchedTemplate`               | Find matched job templates                                                                           |
| GET    | `/api/v1/jobs/getAllCategories`                  | Get all categories                                                                                   |
| GET    | `/api/v1/jobs/getDefaultAttributes`              | Get default job search attributes                                                                    |
| GET    | `/api/v1/jobs/getDefinedSearchAttributes`        | Get defined job search attributes                                                                    |
| GET    | `/api/v1/jobs/getJobDisplayAttributes`           | Get job display attributes                                                                           |
| GET    | `/api/v1/jobs/getJobNamingRule`                  | Get naming rule for jobs                                                                             |
| GET    | `/api/v1/jobs/getStandardAttributes`             | Get standard job search attributes                                                                   |
| POST   | `/api/v1/jobs/search`                            | Job search                                                                                           |
| GET    | `/api/v1/jobs/searchAttributes/{name}/{context}` | Search job search attributes                                                                         |
| POST   | `/api/v1/jobs/searchFromMap`                     | Search job from Map                                                                                  |
| POST   | `/api/v1/jobs/updateAttributes`                  | Update job attributes                                                                                |
| POST   | `/api/v1/jobs/{id}/announceJobChange`            | Announce job change for the current user                                                             |
| GET    | `/api/v1/jobs/{id}/categories`                   | Get job categories                                                                                   |
| GET    | `/api/v1/jobs/{id}/coverImage`                   | Get job cover image                                                                                  |
| GET    | `/api/v1/jobs/{id}/dashboard`                    | Get job dashboard header                                                                             |
| GET    | `/api/v1/jobs/{id}/getForums`                    | Get job forums                                                                                       |
| GET    | `/api/v1/jobs/{id}/getIssuedFileSetTypes`        | Get issued file-set type of a job                                                                    |
| GET    | `/api/v1/jobs/{id}/items`                        | Get job items                                                                                        |
| GET    | `/api/v1/jobs/{id}/jobFileAttributes`            | Get all File Attributes of a given Job.                                                              |
| GET    | `/api/v1/jobs/{id}/map`                          | Get map data of a job                                                                                |
| GET    | `/api/v1/jobs/{id}/notes`                        | Get job notes                                                                                        |
| GET    | `/api/v1/jobs/{id}/permission`                   | Get user permission of a job                                                                         |
| GET    | `/api/v1/jobs/{id}/roles/{users_only}`           | Get job roles                                                                                        |
| GET    | `/api/v1/jobs/{id}/{retrieve_attributes}`        | Get a Job                                                                                            |
| GET    | `/api/v1/jobs/{name}/{page}/{page_size}`         | Perform a quick job search                                                                           |

### Maps (9 endpoints)

| Method                                                            | Path                                                  | Summary                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| GET                                                               | `/api/v1/maps/countries`                              | Get countries                                                      |
| POST                                                              | `/api/v1/maps/deleteManualGeocodes`                   | Delete manually picked geocode for an address                      |
| POST                                                              | `/api/v1/maps/findGeocodes`                           | Returns geocodes for an address.                                   |
| If the address is not already geocoded, the address gets geocoded |
| GET                                                               | `/api/v1/maps/getActiveMapLayers/{job_id}`            | Get the list of valid active map layers to be added to the map     |
| If there is any active map layers co                              |
| GET                                                               | `/api/v1/maps/getGlobalMapLayers/{active_only}`       | Get global map layers                                              |
| GET                                                               | `/api/v1/maps/getJobMapLayers/{job_id}/{active_only}` | Get job map layer                                                  |
| GET                                                               | `/api/v1/maps/getLatLonFromAddress`                   | Get latitude and longitude from a street address (not implemented) |
| POST                                                              | `/api/v1/maps/manuallyGeocodeAddress`                 | Set manually picked geocode for an address                         |
| POST                                                              | `/api/v1/maps/validateAddress`                        | Maps_ValidateAddress                                               |

### Notes (5 endpoints)

| Method | Path                                                 | Summary          |
| ------ | ---------------------------------------------------- | ---------------- |
| POST   | `/api/v1/notes/addNote`                              | Add a new note   |
| GET    | `/api/v1/notes/getCount/{target_type}/{note_id}`     | Get note count   |
| GET    | `/api/v1/notes/getHeaders/{target_type}/{target_id}` | Get note headers |
| GET    | `/api/v1/notes/getMessage/{target_type}/{note_id}`   | Get note message |
| DELETE | `/api/v1/notes/{target_type}/{note_id}`              | Delete a note    |

### Reports (6 endpoints)

| Method                                                | Path                                 | Summary                                                              |
| ----------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| GET                                                   | `/api/v1/reports/entityTypeReports`  | Returns only Entity Type Reports                                     |
| POST                                                  | `/api/v1/reports/generateReport`     | Generate a report                                                    |
| GET                                                   | `/api/v1/reports/{entity_id}/{type}` | Retrieves all server reports for a specified entity and entity type. |
| GET                                                   | `/api/v1/reports/{report_id}/get`    | Get Report by ID (Guid)                                              |
| GET                                                   | `/api/v1/reports/{report_id}/inputs` | Get report inputs                                                    |
| GET                                                   | `/api/v1/reports/{type}`             | Returns all reports unless type is specified.                        |
| If the type not provided then it will return all repo |

### Server (2 endpoints)

| Method | Path                      | Summary            |
| ------ | ------------------------- | ------------------ |
| GET    | `/api/server/getServerId` | Get Server Id      |
| GET    | `/api/server/getVersion`  | Get Server Version |

### Tasks (12 endpoints)

| Method | Path                                                                                    | Summary                               |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------- |
| POST   | `/api/Tasks`                                                                            | Create or Update Task                 |
| GET    | `/api/v1/tasks/getInitialTaskStates/{task_type_id}`                                     | Get initial task states               |
| GET    | `/api/v1/tasks/getPermission/{job_id}`                                                  | Get user permission                   |
| POST   | `/api/v1/tasks/getPermissionForJobs`                                                    | Get user permission for multiple jobs |
| GET    | `/api/v1/tasks/getTask/{task_id}/{get_children}/{get_history}/{get_reminders}/{get_cc}` | Get a task item                       |
| GET    | `/api/v1/tasks/getTaskList/{job_id}`                                                    | Get task list for a job               |
| GET    | `/api/v1/tasks/getTaskStates/{task_type_id}`                                            | Get task states of a task type        |
| GET    | `/api/v1/tasks/getTaskType/{task_type_id}/{get_attributes}`                             | Get a task type by type_id            |
| GET    | `/api/v1/tasks/getTaskTypes/{get_attributes}`                                           | Get task types                        |
| POST   | `/api/v1/tasks/search`                                                                  | Searches tasks                        |
| GET    | `/api/v1/tasks/{task_id}/getNextTaskStates/{state_id}`                                  | Get next task states                  |
| DELETE | `/api/v1/tasks/{task_id}/{description}`                                                 | Delete a task                         |

### Teams (3 endpoints)

| Method | Path                                  | Summary           |
| ------ | ------------------------------------- | ----------------- |
| GET    | `/api/v1/teams/getAllRoleDefinitions` | Get all roles     |
| GET    | `/api/v1/teams/getJobTeam`            | Get job team      |
| POST   | `/api/v1/teams/updateJobTeam`         | Update a job team |

### Types (8 endpoints)

| Method | Path                                     | Summary                                                   |
| ------ | ---------------------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/types`                          | Get a list of available options from given enum type_name |
| GET    | `/api/v1/types/attributeMatchOperations` | Get attribute match operation types                       |
| GET    | `/api/v1/types/attributeTypes`           | Get attribute types                                       |
| GET    | `/api/v1/types/entityTypes`              | Get entity type list                                      |
| GET    | `/api/v1/types/fileTypes`                | Get file types enum                                       |
| GET    | `/api/v1/types/folderStates`             | Get folder state enum                                     |
| GET    | `/api/v1/types/folderTypes`              | Get folder types enum                                     |
| GET    | `/api/v1/types/noteTargetTypes`          | Get note target types enum                                |

### Users (6 endpoints)

| Method | Path                                                | Summary                                                                                        |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/users/HasAccessToModule/{license_module}`  | Determines whether the current user has access to the specified module based on their license. |
| GET    | `/api/v1/users/activeCheckouts/{job_id}`            | Get active job checkouts of the current logged in user                                         |
| GET    | `/api/v1/users/getEmailDigestModeForUser/{user_id}` | Get the email digest mode for a user                                                           |
| POST   | `/api/v1/users/setEmailDigestModeForUser`           | Set the email digest mode for a user                                                           |
| POST   | `/api/v1/users/updateTimezone`                      | Set the current User's timezone                                                                |
| GET    | `/api/v1/users/{id}/{retrieve_attributes}`          | Get current                                                                                    |

### WebForms (30 endpoints)

| Method                                                   | Path                                                                                                             | Summary                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET                                                      | `/api/v1/web-forms/form-definitions/by-job/{job_id}`                                                             | get web form definitions for a job                                            |
| GET                                                      | `/api/v1/web-forms/form-definitions/by-task-type/{task_type_id}`                                                 | Get web form definitions for a task type                                      |
| GET                                                      | `/api/v1/web-forms/form-definitions/by-task/{task_id}`                                                           | get web form definitions for a task                                           |
| GET                                                      | `/api/v1/web-forms/form-definitions/{definition_change_id}/{for_view}`                                           | Get form definition by id                                                     |
| POST                                                     | `/api/v1/web-forms/form-fill/email-form-fill-link`                                                               | send form fill link in email                                                  |
| GET                                                      | `/api/v1/web-forms/form-fills/by-file/{file_id}/{page}/{page_size}`                                              | get web form fills for file                                                   |
| GET                                                      | `/api/v1/web-forms/form-fills/by-job/{job_id}/{page}/{page_size}/{user_id}`                                      | get web form fills for job                                                    |
| GET                                                      | `/api/v1/web-forms/form-fills/by-task/{task_id}/{page}/{page_size}/{user_id}`                                    | get web form fills for task                                                   |
| POST                                                     | `/api/v1/web-forms/form-fills/complete-form-fill`                                                                | Complete form fill                                                            |
| POST                                                     | `/api/v1/web-forms/form-fills/delete-form-fill/{form_fill_id}`                                                   | delete form fill                                                              |
| POST                                                     | `/api/v1/web-forms/form-fills/duplicate-form-fill`                                                               | duplicate form fill                                                           |
| POST                                                     | `/api/v1/web-forms/form-fills/files/{session_id}/add/{question_id}/{file_name}/{form_fill_id}`                   | Upload a FormFill file attachment to the temp directory                       |
| POST                                                     | `/api/v1/web-forms/form-fills/files/{session_id}/clear/{question_id}/{form_fill_id}`                             | clear all attachments associated with this form fill.                         |
| DELETE                                                   | `/api/v1/web-forms/form-fills/files/{session_id}/remove/{question_id}/{file_name}/{form_fill_id}`                | Remove an attached file from the FormFill.                                    |
| If the form_fill_id is present, we will look for the fil |
| GET                                                      | `/api/v1/web-forms/form-fills/files/{session_id}/{question_id}/{file_name}/{form_fill_id}`                       | Get a file attachment for a form fill.                                        |
| GET                                                      | `/api/v1/web-forms/form-fills/new-form-fill/{form_definition_history_id}/{entity_id}/{entity_type}/{capture_id}` | Gets a new form fill with pre filled attribute values / signature of the user |
| POST                                                     | `/api/v1/web-forms/form-fills/resubmit/{form_fill_id}/{job_id}`                                                  | Resubmit a form fill                                                          |
| POST                                                     | `/api/v1/web-forms/form-fills/save-form-fill`                                                                    | Save form fill                                                                |
| POST                                                     | `/api/v1/web-forms/form-fills/search`                                                                            | Search form fills                                                             |
| GET                                                      | `/api/v1/web-forms/form-fills/{form_fill_id}/output-file-list`                                                   | Get FormFill output file list                                                 |
| GET                                                      | `/api/v1/web-forms/form-fills/{id}`                                                                              | get a form fill by id                                                         |
| POST                                                     | `/api/v1/web-forms/form-qr-code/create`                                                                          | Create QR code                                                                |
| GET                                                      | `/api/v1/web-forms/forms-enabled`                                                                                | Gets if webforms are enabled                                                  |
| GET                                                      | `/api/v1/web-forms/public/form-definitions/by-code/{qr_code}`                                                    | Get Form information for an anonymous qr code                                 |
| POST                                                     | `/api/v1/web-forms/public/form-fills/files/{session_id}/add/{question_id}/{file_name}/{form_fill_id}`            | Upload a file attachment to the temp directory for an anonymous form fill.    |
| POST                                                     | `/api/v1/web-forms/public/form-fills/files/{session_id}/clear/{question_id}/{form_fill_id}`                      | clear all attachments associated with this form fill.                         |
| DELETE                                                   | `/api/v1/web-forms/public/form-fills/files/{session_id}/remove/{question_id}/{file_name}/{form_fill_id}`         | Remove an attached file from the FormFill.                                    |
| If the form_fill_id is present, we will look for the fil |
| POST                                                     | `/api/v1/web-forms/public/form-fills/files/{session_id}/remove/{question_id}/{file_name}/{form_fill_id}`         | Remove an attached file from the FormFill.                                    |
| If the form_fill_id is present, we will look for the fil |
| GET                                                      | `/api/v1/web-forms/public/form-fills/files/{session_id}/{question_id}/{file_name}/{form_fill_id}`                | Get a file attachment for a form fill.                                        |
| POST                                                     | `/api/v1/web-forms/public/form-fills/submit-form-fill`                                                           | Save anonymous form fill                                                      |

### Workflows (10 endpoints)

| Method | Path                                                                                                                                             | Summary                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| GET    | `/api/v1/workflows/all`                                                                                                                          | Get all workflows                                              |
| GET    | `/api/v1/workflows/getDataCaptureForIssueStatus/{issue_id}/{next_status_id}/{job_id}`                                                            | get required data capture for issue status workflow transition |
| GET    | `/api/v1/workflows/getProperties/{instance_id}`                                                                                                  | Get workflow properties                                        |
| GET    | `/api/v1/workflows/getRequiredDataCaptureForAttributeWorkflowTransition/{target_type}/{target_id}/{owner_job_id}/{attribute_id}/{next_value_id}` | Get required data capture for attribute workflow transition    |
| GET    | `/api/v1/workflows/getRequiredWorkflowDataCaptureForTaskStateWorkflowTransition/{task_id}/{next_state_id}/{job_id}`                              | Get required data capture for task type workflow transition    |
| GET    | `/api/v1/workflows/getTransitionLog/{instance_id}`                                                                                               | Get workflow history (transition log)                          |
| GET    | `/api/v1/workflows/getWorkflowInstance/{workflow_id}/{entity_id}/{entity_type}`                                                                  | Get workflow instance info                                     |
| POST   | `/api/v1/workflows/processValidWorkflowAttributeChoices`                                                                                         | Get valid workflow attribute choices                           |
| GET    | `/api/v1/workflows/{workflow_id}/diagram/{current_state_id}`                                                                                     | Get workflow diagram image                                     |
| GET    | `/api/v1/workflows/{workflow_id}/{return_all}`                                                                                                   | Get a workflow by Id                                           |

---

## Key Models

The LLM should understand these response shapes before making calls.

### PagedResultModel[JobModel]

| Field        | Type              | Description |
| ------------ | ----------------- | ----------- |
| `PageNumber` | `integer`         |             |
| `PageSize`   | `integer`         |             |
| `TotalRows`  | `integer`         |             |
| `TotalPages` | `integer`         |             |
| `Result`     | `array<JobModel>` |             |

### PagedResultModel[FileModel]

| Field        | Type               | Description |
| ------------ | ------------------ | ----------- |
| `PageNumber` | `integer`          |             |
| `PageSize`   | `integer`          |             |
| `TotalRows`  | `integer`          |             |
| `TotalPages` | `integer`          |             |
| `Result`     | `array<FileModel>` |             |

### JobModel

This class encapsulates data from Different Cotract classes for the Web API

| Field                    | Type                   | Description                                                      |
| ------------------------ | ---------------------- | ---------------------------------------------------------------- |
| `ID`                     | `EntityID`             | Job ID                                                           |
| `Name`                   | `string`               | Job Name (for querying/referencing)                              |
| `Description`            | `string`               | Job description                                                  |
| `JobCreatorName`         | `string`               | Job creator name                                                 |
| `CreatedDate`            | `string`               | Job created date                                                 |
| `NoOfChildren`           | `integer`              | Number of children in the job                                    |
| `NoOfFolders`            | `integer`              | Number of folders in the job                                     |
| `NoOfTDJobs`             | `integer`              | Number of 12d Projects in the job                                |
| `InheritPermissions`     | `boolean`              | Whether or not it should inherit permission                      |
| `InheritFileNamingRules` | `boolean`              | Whether or not it should inherit naming rules                    |
| `AlwaysDisplayParent`    | `boolean`              | Whether or not to always display parent                          |
| `DeleteLocked`           | `boolean`              | Whether we should delete lock, so that the job can not be purged |
| `Type`                   | `integer`              | Project type                                                     |
| `CreatorID`              | `EntityID`             | Creater ID                                                       |
| `ParentJobID`            | `EntityID`             | Parent Project ID                                                |
| `Attributes`             | `array<AttributeInfo>` | Attributes                                                       |
| `JobItems`               | `JobItemsModel`        | Job Items such as Sub jobs, Folders, Forumns ...etc.             |
| `NoOfNotes`              | `integer`              | Number of Notes in a project                                     |
| `Path`                   | `string`               | Job path                                                         |
| `EntityObject`           | `ProjectInfo`          |                                                                  |

### FolderModel

| Field                     | Type                   | Description                                                              |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `ID`                      | `EntityID`             | The folder id                                                            |
| `Name`                    | `string`               | The folder name                                                          |
| `ParentFolderID`          | `EntityID`             | The parent folder id                                                     |
| `JobID`                   | `EntityID`             | the id this project is in                                                |
| `Attributes`              | `array<AttributeInfo>` | Any attributes                                                           |
| `FileAttributes`          | `array<AttributeInfo>` | Any common File Attributes for this folder                               |
| `FileChangeAttributes`    | `array<AttributeInfo>` | Any common File change Attributes for this folder                        |
| `CreatedByID`             | `EntityID`             | The id of the user who created the folder                                |
| `CreatedOn`               | `string`               | When the folder was created                                              |
| `InheritsPermissions`     | `boolean`              | Are we inheriting permissions?                                           |
| `UpdatedOn`               | `string`               | The date this was updated                                                |
| `FolderType`              | `integer`              | The folder type                                                          |
| `FederatedModelStatus`    | `integer`              | Federated Model Status                                                   |
| `ActiveCheckout`          | `CheckOutInfo`         | Some checkout information                                                |
| `HasSubFolders`           | `boolean`              | Are there any sub folders?                                               |
| `Has12dProjects`          | `boolean`              | Do we have any td projects?                                              |
| `IsManagedFolder`         | `boolean`              | Whether or not the folder is a managed folder                            |
| `NoOfSubFolders`          | `integer`              | The number of sub folders                                                |
| `NumberOf12dProjects`     | `integer`              | the number of 12d model projects in folders                              |
| `FolderState`             | `integer`              | The state of the folder - only makes sense for managed, td model folders |
| `InheritsFileAttributes`  | `boolean`              | Whether or not this inherits file attributes                             |
| `InheritsFileNamingRules` | `boolean`              | Whether or not this inherits file naming rules from the parent folder    |
| `LockInfo`                | `LockInfo`             | Info about locks - right now, this is really only for managed folders    |
| `Type`                    | `integer`              | Get the entity type                                                      |
| `Path`                    | `string`               | Folder path                                                              |
| `EntityObject`            | `ProjectFolder`        |                                                                          |

### FileModel

File Model

| Field                  | Type                   | Description                    |
| ---------------------- | ---------------------- | ------------------------------ |
| `ID`                   | `EntityID`             |                                |
| `FileName`             | `string`               |                                |
| `DisplayName`          | `string`               |                                |
| `FolderID`             | `EntityID`             |                                |
| `State`                | `string`               |                                |
| `LastChangeType`       | `integer`              |                                |
| `LastChangedBy`        | `string`               |                                |
| `LastChangedTime`      | `string`               |                                |
| `IsCheckedOut`         | `boolean`              |                                |
| `LastModified`         | `string`               |                                |
| `CreatedOn`            | `string`               |                                |
| `Path`                 | `string`               |                                |
| `LatestVersion`        | `integer`              |                                |
| `SizeReadable`         | `string`               |                                |
| `Size`                 | `integer`              |                                |
| `ActiveCheckout`       | `CheckOutInfo`         |                                |
| `ActiveFolderCheckout` | `CheckOutInfo`         |                                |
| `FileType`             | `string`               |                                |
| `FileIcon`             | `string`               |                                |
| `HasReferences`        | `boolean`              |                                |
| `IsReferenced`         | `boolean`              |                                |
| `IsLinked`             | `boolean`              |                                |
| `LinkedPath`           | `string`               |                                |
| `Attributes`           | `array<AttributeInfo>` |                                |
| `ChangeAttributes`     | `array<AttributeInfo>` | Any required change attributes |
| `EntityObject`         | `FileInfo`             |                                |
| `HasModelData`         | `boolean`              |                                |
| `HasModelProperties`   | `boolean`              |                                |
| `ActiveMs365Session`   | `Microsoft365Session`  | Active Microsoft 365 session   |

### TaskItemModel

| Field                      | Type                           | Description                                                                      |
| -------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `due_date_mode`            | `integer`                      |                                                                                  |
| `start_date_mode`          | `integer`                      |                                                                                  |
| `id`                       | `EntityID`                     |                                                                                  |
| `item_id`                  | `EntityID`                     |                                                                                  |
| `project_id`               | `EntityID`                     | The id of the project that contains it                                           |
| `parent_item_id`           | `EntityID`                     | A parent item id - may be null                                                   |
| `name`                     | `string`                       | The name of the task                                                             |
| `description`              | `string`                       | The task description                                                             |
| `progress`                 | `integer`                      | A progress indication                                                            |
| `AllProgress`              | `integer`                      |                                                                                  |
| `priority`                 | `integer`                      | The task priority                                                                |
| `task_state`               | `TaskState`                    | The task state                                                                   |
| `task_state_name`          | `string`                       | The name of the state                                                            |
| `is_closed`                | `boolean`                      | Whether or not the task is open                                                  |
| `assigned_entity`          | `AssignedEntityModel`          | The assigned entity - could be null                                              |
| `assigned_by`              | `EntityID`                     |                                                                                  |
| `item_owner`               | `ContactInfoModel`             | The contact that owns the task                                                   |
| `history`                  | `array<TaskHistory>`           | A string describing the history - may not be set!                                |
| `due_date_utc`             | `string`                       | The due date of the item                                                         |
| `relative_due_date_days`   | `integer`                      | The number of days to offset the due date, based on the due date mode            |
| `start_date_utc`           | `string`                       | The start date of the item                                                       |
| `relative_start_date_days` | `integer`                      | The number of days to offset the start date, based on the start date mode        |
| `children`                 | `array<TaskItemModel>`         | Any children to dos                                                              |
| `user_task_id`             | `string`                       | The user supplied id for the item                                                |
| `depends_on_ids`           | `array<EntityID>`              | The id of a task this task depends on                                            |
| `version`                  | `integer`                      | The current server version of the item                                           |
| `attributes`               | `array<AttributeInfoModel>`    | Any attached attributes                                                          |
| `task_type_id`             | `EntityID`                     | The type of task                                                                 |
| `task_type`                | `TaskTypeModel`                |                                                                                  |
| `task_path`                | `string`                       | The path to the task (inside a project)                                          |
| `project_path`             | `string`                       | The path to the project containing the task                                      |
| `dependent_task_action`    | `TaskAction`                   | An action to take when a dependent task is closed                                |
| `start_task_action`        | `TaskAction`                   | An action to take when a task is meant to start                                  |
| `order`                    | `integer`                      | The ordering of the task                                                         |
| `colour`                   | `string`                       | The colour of the name in ARGB, use System.Drawing.Colour.FromARGB to get colour |
| `AssociatedEntities`       | `array<AssociatedEntityModel>` | This member is used only when adding/updating associations                       |
| `FormDefinitions`          | `array<FormDefinition>`        | forms definitions attached to the task                                           |
| `workflow_capture_data`    | `array<object>`                | Any workflow capture data                                                        |
| `DueDays`                  | `object`                       |                                                                                  |
| `StartDays`                | `object`                       |                                                                                  |
| `AssignedContacts`         | `array<ContactInfoModel>`      | Helper function to get all assigned contacts                                     |
| `Dependencies`             | `array<EntityListItem>`        | List of Dependency ids with task names                                           |
| `Reminders`                | `array<TaskItemReminder>`      | API helper to get reminders                                                      |
| `CCs`                      | `array<TaskCCItem>`            | API helper to get CCs                                                            |
| `Type`                     | `integer`                      |                                                                                  |
| `change_message`           | `string`                       |                                                                                  |

### JobItemsModel

Job Items Model. This model is an API returned model

| Field                    | Type                    | Description |
| ------------------------ | ----------------------- | ----------- |
| `HasTeam`                | `boolean`               |             |
| `HasIssuedFilesRegistry` | `boolean`               |             |
| `HasForms`               | `boolean`               |             |
| `HasIssues`              | `boolean`               |             |
| `SubJobs`                | `array<JobModel>`       |             |
| `SubFolders`             | `array<FolderModel>`    |             |
| `Sub12dProjects`         | `array<TDProjectModel>` |             |
| `Forums`                 | `array<ForumModel>`     |             |

### FolderItemsModel

| Field            | Type                          | Description |
| ---------------- | ----------------------------- | ----------- |
| `FolderID`       | `EntityID`                    |             |
| `ParentFolderID` | `EntityID`                    |             |
| `JobID`          | `EntityID`                    |             |
| `SubFolders`     | `array<FolderModel>`          |             |
| `TDJobs`         | `array<TDProjectModel>`       |             |
| `Files`          | `PagedResultModel[FileModel]` |             |

### EntityID

| Field          | Type      | Description |
| -------------- | --------- | ----------- |
| `_id`          | `integer` |             |
| `_server_id`   | `integer` |             |
| `_server_guid` | `string`  |             |
| `IDString`     | `string`  |             |

### JobSearchModel

| Field                 | Type                             | Description                                                                      |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `QuickSearchTerm`     | `string`                         |                                                                                  |
| `Name`                | `string`                         |                                                                                  |
| `Page`                | `integer`                        |                                                                                  |
| `PageSize`            | `integer`                        |                                                                                  |
| `Attributes`          | `array<SearchableAttributeItem>` |                                                                                  |
| `ClientTimeZone`      | `object`                         |                                                                                  |
| `RequiresPreparation` | `boolean`                        | Introduced a new flag to avoid changing the behaviour in all the places where 'A |

### FileSearchModel

| Field                 | Type                             | Description                                                                      |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `LimitSearchTo`       | `integer`                        |                                                                                  |
| `LimitID`             | `EntityID`                       |                                                                                  |
| `FileName`            | `string`                         |                                                                                  |
| `Contents`            | `string`                         |                                                                                  |
| `ShowDeletedFiles`    | `boolean`                        |                                                                                  |
| `RetrieveAttributes`  | `boolean`                        |                                                                                  |
| `Page`                | `integer`                        |                                                                                  |
| `PageSize`            | `integer`                        |                                                                                  |
| `Attributes`          | `array<SearchableAttributeItem>` |                                                                                  |
| `ClientTimeZone`      | `object`                         |                                                                                  |
| `RequiresPreparation` | `boolean`                        | Introduced a new flag to avoid changing the behaviour in all the places where 'A |

### ContactSearchModel

| Field                 | Type                             | Description                                                                      |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `FirstName`           | `string`                         |                                                                                  |
| `LastName`            | `string`                         |                                                                                  |
| `Email`               | `string`                         |                                                                                  |
| `UsersOnly`           | `boolean`                        |                                                                                  |
| `Page`                | `integer`                        |                                                                                  |
| `PageSize`            | `integer`                        |                                                                                  |
| `Attributes`          | `array<SearchableAttributeItem>` |                                                                                  |
| `ClientTimeZone`      | `object`                         |                                                                                  |
| `RequiresPreparation` | `boolean`                        | Introduced a new flag to avoid changing the behaviour in all the places where 'A |

### TaskSearchModel

| Field                | Type       | Description |
| -------------------- | ---------- | ----------- |
| `JobId`              | `EntityID` |             |
| `AssigneeId`         | `EntityID` |             |
| `IncludeClosedTasks` | `boolean`  |             |

### AttributeInfo

| Field                   | Type                       | Description |
| ----------------------- | -------------------------- | ----------- |
| `auto_increment_start`  | `integer`                  |             |
| `enum_items`            | `array<AttributeEnumItem>` |             |
| `input_mask`            | `string`                   |             |
| `is_auto_increment`     | `boolean`                  |             |
| `is_visible`            | `boolean`                  |             |
| `optional`              | `boolean`                  |             |
| `order`                 | `integer`                  |             |
| `read_only`             | `boolean`                  |             |
| `reprompt_on_change`    | `boolean`                  |             |
| `value`                 | `AttributeValue`           |             |
| `visibility_constraint` | `AttributeConstraint`      |             |
| `workflow_id`           | `EntityID`                 |             |
| `description`           | `string`                   |             |
| `type`                  | `integer`                  |             |
| `attribute_id`          | `EntityID`                 |             |
| `name`                  | `string`                   |             |
| `display_name`          | `string`                   |             |
| `id`                    | `EntityID`                 |             |

---

## Regeneration

```bash
# 1. Fetch the Swagger JSON
curl -sL 'https://synergy.12dsynergycloud.com/api-docs/api/v1' \
  -o playwright-runs/synergy-swagger-verify/swagger.json

# 2. Re-run the generator
python3 tools/regen-synergy-spec-doc.py
```
