---
api_name: 12d Synergy
api_slug: synergy
doc: complete verified endpoint reference — auto-generated from the live Swagger (v1). GROUND TRUTH: if 01-llm-api-rules.md disagrees, this file wins.
source: synergy.12dsynergycloud.com/api-docs/api/v1 — Title "12d Synergy RESTful API V1", Host synergy.12dsynergycloud.com, base path /api/v1. 359 paths / 369 operations.
regenerate: curl -sL 'https://synergy.12dsynergycloud.com/api-docs/api/v1' -o playwright-runs/synergy-swagger-verify/swagger.json && python3 tools/regen-synergy-spec-doc.py
pagination: body (`{Page,PageSize}` in body — /search endpoints) | path (`{page}/{page_size}` + extra params — content listings, e.g. /folders/{id}/files/.../{page}/{page_size}/...) | composite (`/items` — single-shot blob, non-paginated). Never query string.
id_format: every path {id} is an IDString "N_N" (underscore). Models expose EntityID {_id,_server_id,_server_guid,IDString}.
version_prefix: /api/v1 on all paths EXCEPT POST /api/Tasks and GET /health.
response_shapes: list/search → PagedResultModel[T] {PageNumber,PageSize,TotalPages,TotalRows,Result}. /items → composite (JobItemsModel, FolderItemsModel). Errors → plain string, NOT JSON (Swagger documents only 200 responses).
---

# 12d Synergy — Verified Endpoint Reference (359 paths / 369 ops)

Format below: `METHOD path — summary`.

## 12d Projects (19)

- POST /api/v1/12dProjects/findByName — Find 12d project by name
- POST /api/v1/12dProjects/{folder_id}/cancel-checkout — Cancel a checkout of a Project folder
- POST /api/v1/12dProjects/{folder_id}/checkout/{version} — Checkout a 12d Project folder
- GET /api/v1/12dProjects/{id}/associations — Get 12d project associations
- GET /api/v1/12dProjects/{id}/changed-elements/{version} — Get 12d Project changed elements
- GET /api/v1/12dProjects/{id}/changelog/{page}/{page_size} — Get 12d project history
- POST /api/v1/12dProjects/{id}/checkIn — Check-in a 12d Project folder
- POST /api/v1/12dProjects/{id}/copy — Copy a 12d Project folder
- GET /api/v1/12dProjects/{id}/description — Get 12d project description
- GET /api/v1/12dProjects/{id}/details — Get 12d project details
- GET /api/v1/12dProjects/{id}/fileInfo/{file_name}/{is_folder}/{retrieve_attributes} — Get 12d project file info
- GET /api/v1/12dProjects/{id}/folders/{retrieve_attributes} — Get 12d project sub folders
- GET /api/v1/12dProjects/{id}/latest-change — Get latest change id for a td project
- POST /api/v1/12dProjects/{id}/move — Move a 12d Project folder
- GET /api/v1/12dProjects/{id}/notes — Get 12d project notes
- GET /api/v1/12dProjects/{id}/permission — Get user permission
- GET /api/v1/12dProjects/{id}/preview/{version} — Get 12d project preview image
- GET /api/v1/12dProjects/{id}/{folder_id}/history/{page}/{page_size} — Get 12d project full change history
- GET /api/v1/12dProjects/{id}/{retrieve_attributes} — Get 12d project by id

## Administration (17)

- GET /api/v1/admin/company-logo — Get base64 image of the client/company logo
- GET /api/v1/admin/findAttributes — Find attributes
- GET /api/v1/admin/findEntityByItsPath/{path} — Find the entity id and type for the given path
- POST /api/v1/admin/generatePassword — Generate new password
- GET /api/v1/admin/getAdminContactEmail — Get admin email address
- GET /api/v1/admin/getAllGroups — Get all Groups
- GET /api/v1/admin/getChangeDescriptionMode — Get change description mode
- GET /api/v1/admin/getPreDefinedChangeDescriptions — Get pre-defined change descriptions
- GET /api/v1/admin/getServerSetting — Get server setting-value of a given setting-name
- POST /api/v1/admin/getServerSettings — Get server setting-values of given setting-names
- GET /api/v1/admin/getTimezones — Get timezones available on the server machine
- GET /api/v1/admin/getWebLink/{entity_id}/{entity_type} — Get full web link for an entity
- POST /api/v1/admin/getWebServerPages — Get list of Web Server Pages by types
- GET /api/v1/admin/getWebServerPages/{type} — Get list of Web Server Pages by type
- GET /api/v1/admin/isMicrosoft365Enabled — Check if Microsoft 365 integration is enabled
- GET /api/v1/admin/microsoft365-app-details — Get Microsoft 365 App Details
- POST /api/v1/admin/parseSynergyLink — Parse a full synergy path; return id + details of the entity

## Associations (4)

- GET /api/v1/Associations/GetAssociatedEntities/{id}/{type}/{expected_type} — Get all entities associated with another, or of a specific type
- GET /api/v1/Associations/GetNumberOfAssociatedEntities/{id}/{type} — Get the number of associations for a given EntityID
- POST /api/v1/Associations/add — Add an association to an entity
- POST /api/v1/Associations/delete — Delete an association

## Attributes (11)

- POST /api/v1/Attributes/calculateConstraints — Calculate and process attribute constraints
- GET /api/v1/Attributes/findAttributeByNameAndContext/{name}/{search_context} — Find attribute by name and context
- GET /api/v1/Attributes/getDefaultJobSearchAttributes — Get default Job search attributes
- GET /api/v1/Attributes/getStandardContactSearchAttributes — Get standard Contact search attributes
- GET /api/v1/Attributes/getStandardFileSearchAttributes — Get standard File search attributes
- GET /api/v1/Attributes/getStandardJobSearchAttributes — Get standard Job search attributes
- GET /api/v1/Attributes/getSystemContactAttributes/{get_initial} — Get system Contact attributes
- GET /api/v1/Attributes/getSystemFileAttributes/{extension} — Get system-wide file attributes for a given extension
- GET /api/v1/Attributes/getSystemJobAttributes/{get_initial} — Get system Job attributes
- POST /api/v1/Attributes/updateAttributes — Update attributes
- POST /api/v1/Attributes/validAttributeChoices — Validate enum items in attributes (when there is a workflow)

## Authorisation (17)

- POST /api/v1/auth/delete-pat — Delete a PAT (requires body; POST not DELETE)
- POST /api/v1/auth/forgotPassword — Forgot password
- POST /api/v1/auth/generate-auth-code — Generate a new auth token for a logged-in user
- POST /api/v1/auth/generate-pat — Create a new Personal Access Token for an app
- POST /api/v1/auth/get-onboarding-details — Get the onboarding details for a user
- GET /api/v1/auth/getAllSsoConfigs — Get all available SSO Configs
- GET /api/v1/auth/getMFADeviceRegistrationData/{username} — Get MFA device registration data
- GET /api/v1/auth/getPasswordRequirements — Get password requirements
- GET /api/v1/auth/getPersonalAccessTokens — List PATs (200+list authed; 401 unauth = liveness check)
- GET /api/v1/auth/getSsoConfigForUserIdentity/{identity} — Fetch SSO details for a provided email
- GET /api/v1/auth/getUserMfaStatus/{user_id}/{machine_key} — Get user's MFA status
- POST /api/v1/auth/onboard-user — Onboard a user (accept terms + set password)
- POST /api/v1/auth/remove-auth-code — Remove an auth token
- POST /api/v1/auth/resetPassword — Reset a user's password
- POST /api/v1/auth/send-mfa-code — Re-send 2-factor code to email
- POST /api/v1/auth/signout — Logout user (clear refresh token)
- POST /api/v1/auth/validatePassword — Validate a password

## Categories (1)

- GET /api/v1/categories — Get all categories

## ClashDetection (6)

- GET /api/v1/clash-detection/canUserAccess — Get user permission
- GET /api/v1/clash-detection/clashes/{clash_id}/items — Get the clash detection items
- GET /api/v1/clash-detection/getDetails/{folder_id} — Get clash detections for a federated model (Queued + Completed)
- GET /api/v1/clash-detection/getReport/{clash_id}/{format}/{delimiter} — Get a clash detection report file
- POST /api/v1/clash-detection/start — Start a clash detection
- DELETE /api/v1/clash-detection/{clash_id} — Delete a clash detection

## Companies (8)

- GET /api/v1/Companies — Get all companies
- GET /api/v1/Companies/canEdit — Whether the user can edit companies
- GET /api/v1/Companies/getSystemCompanyAttributes/{get_initial} — Get system Company attributes
- POST /api/v1/Companies/save — Save a company
- GET /api/v1/Companies/{id}/companyImage — Get company image (base64)
- GET /api/v1/Companies/{id}/jobs — Get all jobs of a given company
- GET /api/v1/Companies/{id}/staff/{retrieve_attributes} — Get company staff (contacts)
- GET /api/v1/Companies/{id}/{retrieve_attributes} — Get a Company by id

## Contacts (21) — capital C; ContactModel snake_case

- GET /api/v1/Contacts/canEdit — Whether the user can edit contacts
- GET /api/v1/Contacts/canEditList — Whether the user can edit Contact List
- DELETE /api/v1/Contacts/deleteContactList/{list_id} — Delete a contact list
- POST /api/v1/Contacts/findMentionItems — Find mention items
- GET /api/v1/Contacts/getContactListContacts/{list_id} — Get contacts for a given contact-list
- GET /api/v1/Contacts/getGlobalContactLists — Get global contact list
- GET /api/v1/Contacts/getJobContactLists/{job_id} — Get a contact-list for a given job
- GET /api/v1/Contacts/getStandardAttributes — Get standard contact search attributes
- GET /api/v1/Contacts/getSystemContactAttributes/{get_initial} — Get system contact attributes
- GET /api/v1/Contacts/list/{page_no}/{page_size}/{get_attributes}/{sort_column}/{sort_direction}/{filter} — Get all contacts
- POST /api/v1/Contacts/saveContact — Save a contact (create or update)
- POST /api/v1/Contacts/saveContactList — Save a contact-list
- POST /api/v1/Contacts/saveContactSignature — Save contact signature
- POST /api/v1/Contacts/search — Search contacts
- GET /api/v1/Contacts/searchAttributes/{name} — Get contact custom search attributes
- POST /api/v1/Contacts/setContactListContacts — Set contacts of a contact-list
- GET /api/v1/Contacts/simpleSearch/{term}/{users_only} — Simple text search; returns first 20 results
- GET /api/v1/Contacts/{id}/isSignatureSet — Check if the user has a signature set (only sys admin can check for others)
- GET /api/v1/Contacts/{id}/signature — Get contact signature
- GET /api/v1/Contacts/{id}/thumbnail/{image_date_modified} — Get contact thumbnail
- GET /api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies} — Get a contact by id

## Documents (3)

- POST /api/v1/documents/extractStandardAttributes — Extract attached standard attributes from a given document
- GET /api/v1/documents/hasStandardAttributes — Whether a file has standard attributes
- POST /api/v1/documents/hasStandardAttributes — Whether a file has standard attributes

## Files (70)

- GET /api/v1/files/SearchAttributes/{context}/{name} — Get custom file search attributes
- POST /api/v1/files/add-contacts-to-microsoft-365-session — Add contacts to a Microsoft 365 session
- POST /api/v1/files/attributeOnlyCheckIn — Attribute-only file check-in
- POST /api/v1/files/batch-copy — Copy multiple files to a folder
- POST /api/v1/files/batch-move — Move multiple files to a folder
- POST /api/v1/files/cancel-microsoft-365-session — Cancel a Microsoft 365 session for a file
- POST /api/v1/files/copy — Copy a file to a folder
- POST /api/v1/files/createFile — Create a new file (record)
- POST /api/v1/files/delete — Delete a file (mark file as deleted)
- POST /api/v1/files/download-temp-file — Download a temp file (Microsoft 365 temp files)
- GET /api/v1/files/download-vsfx-file/{type}/{id}/{version} — Retrieve vsfx file for a given IFC file
- POST /api/v1/files/end-microsoft-365-session — End a Microsoft 365 session for a file
- POST /api/v1/files/fetchLatestVersions — Get latest version for a given files list
- POST /api/v1/files/finalizeChunkUpload/{session_id} — Finalize a chunk upload (expects chunk-upload session id + file upload data)
- POST /api/v1/files/findAndResolveFilePlaceHolders — Find and resolve file placeholders
- GET /api/v1/files/findConverters/{search_term} — Find converters
- POST /api/v1/files/generateFileNameFromRule — Generate filename from a naming rule
- GET /api/v1/files/getChangedFiles — Get changed files since the given date
- GET /api/v1/files/getChunkUploadStatus/{session_id} — Get chunk upload status
- GET /api/v1/files/getFileChangeVersion/{file_change_id} — Get file version by file change id
- GET /api/v1/files/getFileIDByChangeId/{file_change_id} — Get the file id by file change id
- GET /api/v1/files/getFileInfoByName/{file_name}/{folder_id}/{retrieve_attributes}/{retrieve_flatten_parent_attributes} — Get file info by name
- GET /api/v1/files/getFileVersionCheckDetails/{code} — Get details to check the file version associated with the QR code (authorized users)
- GET /api/v1/files/getFileVersionCheckDetailsForPublic/{code} — Get details to check the file version associated with the QR code (anonymous)
- GET /api/v1/files/getIcon/{file_name} — Get file icon
- POST /api/v1/files/getIcons — Get file icons for given file names
- GET /api/v1/files/getPreDefinedChangeDescriptions — Get pre-defined change descriptions
- GET /api/v1/files/getStandardAttributes — Get standard file search attributes
- POST /api/v1/files/initiateChunkUpload — Initiate a file upload in chunks
- GET /api/v1/files/isFileVersionCheckCodePublic/{code} — Check if the file version check code is public
- POST /api/v1/files/move — Move a file to a folder
- POST /api/v1/files/processNamingRules — Process file naming rules (new method)
- POST /api/v1/files/rename — Rename a file
- POST /api/v1/files/restore — Restore a deleted file
- POST /api/v1/files/search — Search files (Files_Search; supports content search via Contents)
- POST /api/v1/files/start-microsoft-365-session — Start a Microsoft 365 session for a file
- POST /api/v1/files/unlink — Unlink more than one linked file
- POST /api/v1/files/upload — Upload or add a new file (multipart/form-data only)
- POST /api/v1/files/uploadChunk/{session_id}/{chunk_number} — Upload a file chunk (multipart/form-data)
- GET /api/v1/files/{file_id}/{version}/microsoft-365-session — Get Microsoft 365 session
- GET /api/v1/files/{id}/adjacenthistory/{version}/{range} — Get the previous and preceding versions from the provided version
- GET /api/v1/files/{id}/associations — Get associated entities of a file
- POST /api/v1/files/{id}/cancelCheckout — Cancel a checked-out file
- POST /api/v1/files/{id}/checkout — Check-out a file
- GET /api/v1/files/{id}/converters — Get file converters of a file
- GET /api/v1/files/{id}/download/{version}/{with_references} — Download (stream) a file by id + version, with/without references (may be slow)
- POST /api/v1/files/{id}/download/{version}/{with_references} — Download (stream) a file by id + version, with/without references (may be slow)
- POST /api/v1/files/{id}/getCodeForFileVersionCheck/{is_public} — Return a code representing file id + version, to generate a QR code
- GET /api/v1/files/{id}/getFileChangeId/{version} — Get file info by file change id
- GET /api/v1/files/{id}/getFileWithAllAttributes/{file_change_type} — Get a file with all attributes (to prompt for the given file change type)
- POST /api/v1/files/{id}/getFileWithAllAttributes/{file_change_type} — Get a file with all attributes (to prompt for the given file change type)
- GET /api/v1/files/{id}/getReferenceGraph/{version}/{show_referencing_files} — Get file reference data
- GET /api/v1/files/{id}/groups — Get group access of a file
- GET /api/v1/files/{id}/history/{retrieve_attributes}/{page}/{page_size} — Get file history
- POST /api/v1/files/{id}/makeLatestVersion/{rollback_version}/{rollback_attributes_mode} — Rollback a file to an older version, save as a new version
- GET /api/v1/files/{id}/notes — Get file notes
- GET /api/v1/files/{id}/permission — Get user file permission
- GET /api/v1/files/{id}/preview/{version} — Get file preview
- POST /api/v1/files/{id}/purge — Purge a file (delete permanently)
- GET /api/v1/files/{id}/thumbnail — Get file thumbnail
- POST /api/v1/files/{id}/unlink/{allow_unlink_when_referenced}/{replace_refs_with_link_source} — Unlink a linked file
- GET /api/v1/files/{id}/users — Get user access of a file
- GET /api/v1/files/{id}/versions/{version}/{retrieve_attributes} — Get a file by id + version
- POST /api/v1/files/{id}/versions/{version}/{retrieve_attributes} — Get a file by id + version
- GET /api/v1/files/{id}/weblink/{include_web_root_path} — Get a link to a file
- POST /api/v1/files/{id}/weblink/{include_web_root_path} — Get a link to a file
- GET /api/v1/files/{id}/{retrieve_attributes} — Get a file by id
- POST /api/v1/files/{id}/{retrieve_attributes} — Get a file by id
- GET /api/v1/files/{id}/{type}/ifc-object-tree/{handle}/properties — Get the properties of an IFC object by its handle
- GET /api/v1/files/{id}/{type}/{version}/ifc-object-tree — Get the IFC object tree for a given IFC file

## Folders (20)

- POST /api/v1/folders/copy — Copy folder to another
- POST /api/v1/folders/create — Create a folder
- POST /api/v1/folders/createFromTemplate — Create folder from template
- GET /api/v1/folders/folder-change-id/{folder_id}/{version} — Get folder change id
- GET /api/v1/folders/get-root-model-folder/{folder_id} — Get the root model folder id for a given folder id
- POST /api/v1/folders/move — Move folder(s) to another
- POST /api/v1/folders/rename — Rename a folder
- GET /api/v1/folders/{id}/changelog/{page}/{page_size} — Get folder change log/history
- GET /api/v1/folders/{id}/download — Download a folder (option to include all sub-folders)
- POST /api/v1/folders/{id}/download — Download a folder (option to include all sub-folders)
- GET /api/v1/folders/{id}/files/{retrieve_attributes}/{page}/{page_size}/{filter}/{show_deleted_files} — Get folder files ({filter} = SQL LIKE; use %25 not \*)
- GET /api/v1/folders/{id}/folder-view-profile — Get folder profile
- GET /api/v1/folders/{id}/getAllowedExtensions — Get allowed file extensions
- GET /api/v1/folders/{id}/getFileNamingRuleSets/{include_inherited} — Get file naming rule-set
- GET /api/v1/folders/{id}/getWebPath/{job_id} — Get web path
- GET /api/v1/folders/{id}/isDataFlowIngressFolder — Does this folder have any ingress DataFlow configurations
- GET /api/v1/folders/{id}/items — Get folder items (FolderItemsModel)
- GET /api/v1/folders/{id}/notes — Get folder notes
- GET /api/v1/folders/{id}/permission — Get user folder permission
- GET /api/v1/folders/{id}/{retrieve_attributes} — Get a folder by id

## Forums (13)

- POST /api/v1/Forums/createForumCategory — Create new forum category
- POST /api/v1/Forums/createForumPost — Create a forum post
- POST /api/v1/Forums/createForumTopic — Create new forum topic
- DELETE /api/v1/Forums/deleteForumItem/{item_type}/{id} — Delete a forum item
- GET /api/v1/Forums/getAll/{job_id} — Get all forums of a job
- GET /api/v1/Forums/getForumCategoryTopic/{topic_id} — Get forum topic by topic_id
- GET /api/v1/Forums/getForumCategoryTopics/{category_id}/{page}/{page_size} — Get forum category topics
- GET /api/v1/Forums/getForumTopicPosts/{topic_id}/{page}/{page_size} — Get forum topic posts
- GET /api/v1/Forums/getPermission/{id} — Get forum permission
- POST /api/v1/Forums/updateForumPost — Update a forum post
- GET /api/v1/Forums/{id} — Get a forum by id
- GET /api/v1/Forums/{id}/categories — Get forum categories by forum id
- GET /api/v1/Forums/{id}/categories/{category_id} — Get a forum category

## Gadgets (1)

- GET /api/v1/gadgets/getGadget/{job_id}/{gadget_id}/{inputs} — Get a gadget

## HealthCheck (1)

- GET /health — Health check (no auth, no /api/v1/ prefix)

## Issue-tracking (18)

- POST /api/v1/issue-tracking/add-watchers — Add issue ticket watchers
- POST /api/v1/issue-tracking/delete-issue — Delete an issue
- GET /api/v1/issue-tracking/get-issue/{issue_ticket_id}/{retrieve_details} — Get issue ticket by id
- GET /api/v1/issue-tracking/get-job-id/{issue_ticket_id} — Get job id for a given issue ticket
- GET /api/v1/issue-tracking/get-preview/{issue_ticket_id} — Get issue preview (of model) for issue
- GET /api/v1/issue-tracking/issue-count/{entity_id}/{entity_type} — Get issue ticket count for entity
- GET /api/v1/issue-tracking/issue-statuses/get — Get issue statuses
- GET /api/v1/issue-tracking/issue-type/get/{type_id}/{issue_id} — Retrieve the issue statuses for an issue type
- GET /api/v1/issue-tracking/issue-types/get/{retrieve_info} — Get issue types
- GET /api/v1/issue-tracking/issue/get-changes/{issue_id} — Get issue changes in a structured format
- GET /api/v1/issue-tracking/issue/get-comments/{issue_id} — Get issue comments
- POST /api/v1/issue-tracking/issue/set-comment — Set issue comment
- POST /api/v1/issue-tracking/issues/export — Export issues
- POST /api/v1/issue-tracking/issues/get — Get issue list
- GET /api/v1/issue-tracking/permission/get/{job_id} — Get user permission
- POST /api/v1/issue-tracking/remove-watchers — Remove issue ticket watchers
- POST /api/v1/issue-tracking/set-issue — Create or update an issue ticket
- POST /api/v1/issue-tracking/set-preview — Set the preview for an issue ticket

## Issued Files (21)

- POST /api/v1/issued-files/createIssuedFileSet — Create Issued FileSet
- DELETE /api/v1/issued-files/deletePublish/{publish_id} — Delete a published file
- GET /api/v1/issued-files/downloadIssuedFiles/{issue_id}/{set_id}/{include_transmittal} — Download a zip of all files issued (may be slow)
- POST /api/v1/issued-files/downloadIssuedFiles/{issue_id}/{set_id}/{include_transmittal} — Download a zip of all files issued (may be slow)
- GET /api/v1/issued-files/downloadTransmittalFile/{issue_id}/{set_id}/{file_name} — Download (stream) a transmittal file (may be slow)
- POST /api/v1/issued-files/downloadTransmittalFile/{issue_id}/{set_id}/{file_name} — Download (stream) a transmittal file (may be slow)
- GET /api/v1/issued-files/getIssueDetails/{issue_id} — Get issue details
- GET /api/v1/issued-files/getIssuedFileIssueSetPublishedFileDetails/{issue_id} — Get issued file issue-set published file details
- GET /api/v1/issued-files/getIssuedFilePublishingInfo/{issue_id} — Get issued file publishing info
- GET /api/v1/issued-files/getIssuedFileSet/{set_id}/{get_issues} — Get issued file-set by set_id (slower; prefer ...ForDisplay)
- GET /api/v1/issued-files/getIssuedFileSetForDisplay/{set_id}/{get_issues} — Get issued file-set for display
- GET /api/v1/issued-files/getIssuedFileSetType/{type_id} — Get issued file-set type by id
- GET /api/v1/issued-files/getIssuedFileSetVersionFiles/{set_id}/{version} — Get issued file-set version files
- GET /api/v1/issued-files/getIssuedFileSets/{job_id}/{type_id} — Get issued file-set by job and type
- GET /api/v1/issued-files/getJobFileSetTypes/{job_id} — Get file-set types of a job
- GET /api/v1/issued-files/getPublishingInfo/{issue_id} — Get publishing info by issue_id
- GET /api/v1/issued-files/getRequiredIssueAttributes — Get required issue attributes
- GET /api/v1/issued-files/hasStoredTransmittalFile/{issue_id} — Whether issue has a transmittal file
- POST /api/v1/issued-files/issueFileSet — Issue a File Set
- POST /api/v1/issued-files/updateIssuedFileSet — Update Issued FileSet
- POST /api/v1/issued-files/updatePublishNotifications — Add/remove publish notifications

## Jobs (27)

- POST /api/v1/jobs/calculateJobName — Generate Job name by replacing naming-rule components with attribute values + timestamp
- POST /api/v1/jobs/create — Create a new job (root/sub)
- POST /api/v1/jobs/findMatchedTemplate — Find matched job templates
- GET /api/v1/jobs/getAllCategories — Get all categories
- GET /api/v1/jobs/getDefaultAttributes — Get default job search attributes
- GET /api/v1/jobs/getDefinedSearchAttributes — Get defined job search attributes
- GET /api/v1/jobs/getJobDisplayAttributes — Get job display attributes
- GET /api/v1/jobs/getJobNamingRule — Get naming rule for jobs
- GET /api/v1/jobs/getStandardAttributes — Get standard job search attributes
- POST /api/v1/jobs/search — Job search (body-paginated)
- GET /api/v1/jobs/searchAttributes/{name}/{context} — Search job search attributes
- POST /api/v1/jobs/searchFromMap — Search job from Map
- POST /api/v1/jobs/updateAttributes — Update job attributes
- POST /api/v1/jobs/{id}/announceJobChange — Announce job change for the current user
- GET /api/v1/jobs/{id}/categories — Get job categories
- GET /api/v1/jobs/{id}/coverImage — Get job cover image
- GET /api/v1/jobs/{id}/dashboard — Get job dashboard header
- GET /api/v1/jobs/{id}/getForums — Get job forums
- GET /api/v1/jobs/{id}/getIssuedFileSetTypes — Get issued file-set type of a job
- GET /api/v1/jobs/{id}/items — Get job items (JobItemsModel)
- GET /api/v1/jobs/{id}/jobFileAttributes — Get all File Attributes of a given Job
- GET /api/v1/jobs/{id}/map — Get map data of a job
- GET /api/v1/jobs/{id}/notes — Get job notes
- GET /api/v1/jobs/{id}/permission — Get user permission of a job
- GET /api/v1/jobs/{id}/roles/{users_only} — Get job roles
- GET /api/v1/jobs/{id}/{retrieve_attributes} — Get a Job
- GET /api/v1/jobs/{name}/{page}/{page_size} — Perform a quick job search

## Maps (9)

- GET /api/v1/maps/countries — Get countries
- POST /api/v1/maps/deleteManualGeocodes — Delete manually picked geocode for an address
- POST /api/v1/maps/findGeocodes — Return geocodes for an address (geocodes the address if not already)
- GET /api/v1/maps/getActiveMapLayers/{job_id} — Get the list of valid active map layers for the map
- GET /api/v1/maps/getGlobalMapLayers/{active_only} — Get global map layers
- GET /api/v1/maps/getJobMapLayers/{job_id}/{active_only} — Get job map layers
- GET /api/v1/maps/getLatLonFromAddress — Get lat/lon from a street address (not implemented)
- POST /api/v1/maps/manuallyGeocodeAddress — Set manually picked geocode for an address
- POST /api/v1/maps/validateAddress — Validate address

## Notes (5)

- POST /api/v1/notes/addNote — Add a new note
- GET /api/v1/notes/getCount/{target_type}/{note_id} — Get note count
- GET /api/v1/notes/getHeaders/{target_type}/{target_id} — Get note headers
- GET /api/v1/notes/getMessage/{target_type}/{note_id} — Get note message
- DELETE /api/v1/notes/{target_type}/{note_id} — Delete a note

## Reports (6)

- GET /api/v1/reports/entityTypeReports — Return only Entity Type Reports
- POST /api/v1/reports/generateReport — Generate a report
- GET /api/v1/reports/{entity_id}/{type} — Retrieve all server reports for a specified entity + entity type
- GET /api/v1/reports/{report_id}/get — Get Report by ID (Guid)
- GET /api/v1/reports/{report_id}/inputs — Get report inputs
- GET /api/v1/reports/{type} — Return all reports unless type is specified

## Server (2)

- GET /api/server/getServerId — Get Server Id
- GET /api/server/getVersion — Get Server Version

## Tasks (12) — POST /api/Tasks has NO /v1/ prefix; TaskItemModel snake_case

- POST /api/Tasks — Create or Update Task (one endpoint for both; no PUT variant)
- GET /api/v1/tasks/getInitialTaskStates/{task_type_id} — Get initial task states
- GET /api/v1/tasks/getPermission/{job_id} — Get user permission
- POST /api/v1/tasks/getPermissionForJobs — Get user permission for multiple jobs
- GET /api/v1/tasks/getTask/{task_id}/{get_children}/{get_history}/{get_reminders}/{get_cc} — Get a task item
- GET /api/v1/tasks/getTaskList/{job_id} — Get task list for a job (only list path; per-job)
- GET /api/v1/tasks/getTaskStates/{task_type_id} — Get task states of a task type
- GET /api/v1/tasks/getTaskType/{task_type_id}/{get_attributes} — Get a task type by type_id
- GET /api/v1/tasks/getTaskTypes/{get_attributes} — Get task types
- POST /api/v1/tasks/search — Search tasks (body: JobId, AssigneeId, IncludeClosedTasks; no Page/PageSize)
- GET /api/v1/tasks/{task_id}/getNextTaskStates/{state_id} — Get next task states
- DELETE /api/v1/tasks/{task_id}/{description} — Delete a task (description required in path, URL-encoded)

## Teams (3)

- GET /api/v1/teams/getAllRoleDefinitions — Get all roles
- GET /api/v1/teams/getJobTeam — Get job team
- POST /api/v1/teams/updateJobTeam — Update a job team

## Types (8)

- GET /api/v1/types — Get a list of available options from a given enum type_name
- GET /api/v1/types/attributeMatchOperations — Get attribute match operation types
- GET /api/v1/types/attributeTypes — Get attribute types
- GET /api/v1/types/entityTypes — Get entity type list
- GET /api/v1/types/fileTypes — Get file types enum
- GET /api/v1/types/folderStates — Get folder state enum
- GET /api/v1/types/folderTypes — Get folder types enum
- GET /api/v1/types/noteTargetTypes — Get note target types enum

## Users (6) — no "who am I" endpoint

- GET /api/v1/users/HasAccessToModule/{license_module} — Whether the current user has access to the module (per license)
- GET /api/v1/users/activeCheckouts/{job_id} — Get active job checkouts of the current user
- GET /api/v1/users/getEmailDigestModeForUser/{user_id} — Get the email digest mode for a user
- POST /api/v1/users/setEmailDigestModeForUser — Set the email digest mode for a user
- POST /api/v1/users/updateTimezone — Set the current user's timezone
- GET /api/v1/users/{id}/{retrieve_attributes} — Get a user by id

## WebForms (30)

- GET /api/v1/web-forms/form-definitions/by-job/{job_id} — Get web form definitions for a job
- GET /api/v1/web-forms/form-definitions/by-task-type/{task_type_id} — Get web form definitions for a task type
- GET /api/v1/web-forms/form-definitions/by-task/{task_id} — Get web form definitions for a task
- GET /api/v1/web-forms/form-definitions/{definition_change_id}/{for_view} — Get form definition by id
- POST /api/v1/web-forms/form-fill/email-form-fill-link — Send form fill link in email
- GET /api/v1/web-forms/form-fills/by-file/{file_id}/{page}/{page_size} — Get web form fills for a file
- GET /api/v1/web-forms/form-fills/by-job/{job_id}/{page}/{page_size}/{user_id} — Get web form fills for a job
- GET /api/v1/web-forms/form-fills/by-task/{task_id}/{page}/{page_size}/{user_id} — Get web form fills for a task
- POST /api/v1/web-forms/form-fills/complete-form-fill — Complete form fill
- POST /api/v1/web-forms/form-fills/delete-form-fill/{form_fill_id} — Delete form fill
- POST /api/v1/web-forms/form-fills/duplicate-form-fill — Duplicate form fill
- POST /api/v1/web-forms/form-fills/files/{session_id}/add/{question_id}/{file_name}/{form_fill_id} — Upload a FormFill file attachment to the temp directory
- POST /api/v1/web-forms/form-fills/files/{session_id}/clear/{question_id}/{form_fill_id} — Clear all attachments for this form fill
- DELETE /api/v1/web-forms/form-fills/files/{session_id}/remove/{question_id}/{file_name}/{form_fill_id} — Remove an attached file from the FormFill (uses form_fill_id if present)
- GET /api/v1/web-forms/form-fills/files/{session_id}/{question_id}/{file_name}/{form_fill_id} — Get a file attachment for a form fill
- GET /api/v1/web-forms/form-fills/new-form-fill/{form_definition_history_id}/{entity_id}/{entity_type}/{capture_id} — Get a new form fill with pre-filled attribute values / user signature
- POST /api/v1/web-forms/form-fills/resubmit/{form_fill_id}/{job_id} — Resubmit a form fill
- POST /api/v1/web-forms/form-fills/save-form-fill — Save form fill
- POST /api/v1/web-forms/form-fills/search — Search form fills
- GET /api/v1/web-forms/form-fills/{form_fill_id}/output-file-list — Get FormFill output file list
- GET /api/v1/web-forms/form-fills/{id} — Get a form fill by id
- POST /api/v1/web-forms/form-qr-code/create — Create QR code
- GET /api/v1/web-forms/forms-enabled — Get if webforms are enabled
- GET /api/v1/web-forms/public/form-definitions/by-code/{qr_code} — Get form information for an anonymous QR code
- POST /api/v1/web-forms/public/form-fills/files/{session_id}/add/{question_id}/{file_name}/{form_fill_id} — Upload a file attachment for an anonymous form fill
- POST /api/v1/web-forms/public/form-fills/files/{session_id}/clear/{question_id}/{form_fill_id} — Clear all attachments for this form fill
- DELETE /api/v1/web-forms/public/form-fills/files/{session_id}/remove/{question_id}/{file_name}/{form_fill_id} — Remove an attached file from the FormFill (uses form_fill_id if present)
- POST /api/v1/web-forms/public/form-fills/files/{session_id}/remove/{question_id}/{file_name}/{form_fill_id} — Remove an attached file from the FormFill (uses form_fill_id if present)
- GET /api/v1/web-forms/public/form-fills/files/{session_id}/{question_id}/{file_name}/{form_fill_id} — Get a file attachment for a form fill
- POST /api/v1/web-forms/public/form-fills/submit-form-fill — Save anonymous form fill

## Workflows (10)

- GET /api/v1/workflows/all — Get all workflows
- GET /api/v1/workflows/getDataCaptureForIssueStatus/{issue_id}/{next_status_id}/{job_id} — Get required data capture for issue-status workflow transition
- GET /api/v1/workflows/getProperties/{instance_id} — Get workflow properties
- GET /api/v1/workflows/getRequiredDataCaptureForAttributeWorkflowTransition/{target_type}/{target_id}/{owner_job_id}/{attribute_id}/{next_value_id} — Get required data capture for attribute workflow transition
- GET /api/v1/workflows/getRequiredWorkflowDataCaptureForTaskStateWorkflowTransition/{task_id}/{next_state_id}/{job_id} — Get required data capture for task-type workflow transition
- GET /api/v1/workflows/getTransitionLog/{instance_id} — Get workflow history (transition log)
- GET /api/v1/workflows/getWorkflowInstance/{workflow_id}/{entity_id}/{entity_type} — Get workflow instance info
- POST /api/v1/workflows/processValidWorkflowAttributeChoices — Get valid workflow attribute choices
- GET /api/v1/workflows/{workflow_id}/diagram/{current_state_id} — Get workflow diagram image
- GET /api/v1/workflows/{workflow_id}/{return_all} — Get a workflow by id

---

# Key Models (response shapes)

Format: `field: type — description` (description omitted when empty).

## PagedResultModel[JobModel] / PagedResultModel[FileModel]

`PageNumber:int, PageSize:int, TotalRows:int, TotalPages:int, Result:array<JobModel|FileModel>`

## JobModel

Encapsulates data from different contract classes for the Web API.

- ID: EntityID — Job ID
- Name: string — job name (for querying/referencing)
- Description: string — job description
- JobCreatorName: string — job creator name
- CreatedDate: string — job created date
- NoOfChildren: int — number of children in the job
- NoOfFolders: int — number of folders in the job
- NoOfTDJobs: int — number of 12d Projects in the job
- InheritPermissions: bool — inherit permission?
- InheritFileNamingRules: bool — inherit naming rules?
- AlwaysDisplayParent: bool — always display parent?
- DeleteLocked: bool — delete-lock so the job can't be purged
- Type: int — project type
- CreatorID: EntityID — creator ID
- ParentJobID: EntityID — parent project ID
- Attributes: array<AttributeInfo>
- JobItems: JobItemsModel — sub-jobs, folders, forums, etc.
- NoOfNotes: int — number of notes in a project
- Path: string — job path
- EntityObject: ProjectInfo

## FolderModel

- ID: EntityID — the folder id
- Name: string — the folder name
- ParentFolderID: EntityID — the parent folder id
- JobID: EntityID — the job this folder is in
- Attributes: array<AttributeInfo>
- FileAttributes: array<AttributeInfo> — common file attributes for this folder
- FileChangeAttributes: array<AttributeInfo> — common file-change attributes for this folder
- CreatedByID: EntityID — id of the user who created the folder
- CreatedOn: string — when the folder was created
- InheritsPermissions: bool
- UpdatedOn: string — date this was updated
- FolderType: int — the folder type
- FederatedModelStatus: int — federated model status
- ActiveCheckout: CheckOutInfo — checkout information
- HasSubFolders: bool
- Has12dProjects: bool — any td projects?
- IsManagedFolder: bool
- NoOfSubFolders: int
- NumberOf12dProjects: int — number of 12d model projects in folders
- FolderState: int — state of the folder (only meaningful for managed td-model folders)
- InheritsFileAttributes: bool
- InheritsFileNamingRules: bool — inherits naming rules from the parent folder
- LockInfo: LockInfo — lock info (mostly for managed folders)
- Type: int — entity type
- Path: string — folder path
- EntityObject: ProjectFolder

## FileModel

- ID: EntityID
- FileName: string
- DisplayName: string
- FolderID: EntityID
- State: string
- LastChangeType: int
- LastChangedBy: string
- LastChangedTime: string
- IsCheckedOut: bool
- LastModified: string
- CreatedOn: string
- Path: string
- LatestVersion: int
- SizeReadable: string
- Size: int
- ActiveCheckout: CheckOutInfo
- ActiveFolderCheckout: CheckOutInfo
- FileType: string
- FileIcon: string
- HasReferences: bool
- IsReferenced: bool
- IsLinked: bool
- LinkedPath: string
- Attributes: array<AttributeInfo>
- ChangeAttributes: array<AttributeInfo> — any required change attributes
- EntityObject: FileInfo
- HasModelData: bool
- HasModelProperties: bool
- ActiveMs365Session: Microsoft365Session — active Microsoft 365 session

## TaskItemModel (snake_case)

- due_date_mode: int
- start_date_mode: int
- id: EntityID
- item_id: EntityID
- project_id: EntityID — id of the containing project
- parent_item_id: EntityID — parent item id (may be null)
- name: string — task name
- description: string — task description
- progress: int — progress indication
- AllProgress: int
- priority: int — task priority
- task_state: TaskState — task state
- task_state_name: string — name of the state
- is_closed: bool — whether the task is closed
- assigned_entity: AssignedEntityModel — assigned entity (may be null)
- assigned_by: EntityID
- item_owner: ContactInfoModel — contact that owns the task
- history: array<TaskHistory> — history (may not be set)
- due_date_utc: string — due date
- relative_due_date_days: int — days to offset the due date (per due_date_mode)
- start_date_utc: string — start date
- relative_start_date_days: int — days to offset the start date (per start_date_mode)
- children: array<TaskItemModel> — child to-dos
- user_task_id: string — user-supplied id for the item
- depends_on_ids: array<EntityID> — id of a task this task depends on
- version: int — current server version of the item
- attributes: array<AttributeInfoModel> — attached attributes
- task_type_id: EntityID — type of task
- task_type: TaskTypeModel
- task_path: string — path to the task (inside a project)
- project_path: string — path to the containing project
- dependent_task_action: TaskAction — action when a dependent task is closed
- start_task_action: TaskAction — action when a task is meant to start
- order: int — task ordering
- colour: string — name colour in ARGB (System.Drawing.Color.FromArgb)
- AssociatedEntities: array<AssociatedEntityModel> — only used when adding/updating associations
- FormDefinitions: array<FormDefinition> — forms definitions attached to the task
- workflow_capture_data: array<object> — workflow capture data
- DueDays: object
- StartDays: object
- AssignedContacts: array<ContactInfoModel> — all assigned contacts
- Dependencies: array<EntityListItem> — dependency ids with task names
- Reminders: array<TaskItemReminder>
- CCs: array<TaskCCItem>
- Type: int
- change_message: string

## JobItemsModel (API-returned)

`HasTeam:bool, HasIssuedFilesRegistry:bool, HasForms:bool, HasIssues:bool, SubJobs:array<JobModel>, SubFolders:array<FolderModel>, Sub12dProjects:array<TDProjectModel>, Forums:array<ForumModel>`

## FolderItemsModel

`FolderID:EntityID, ParentFolderID:EntityID, JobID:EntityID, SubFolders:array<FolderModel>, TDJobs:array<TDProjectModel>, Files:PagedResultModel[FileModel]`

## EntityID

`_id:int, _server_id:int, _server_guid:string, IDString:string`

## JobSearchModel / FileSearchModel / ContactSearchModel

Shared tail: `Page:int, PageSize:int, Attributes:array<SearchableAttributeItem>, ClientTimeZone:object, RequiresPreparation:bool (flag to avoid behaviour change everywhere)`.

- JobSearchModel head: `QuickSearchTerm:string, Name:string`
- FileSearchModel head: `LimitSearchTo:int, LimitID:EntityID, FileName:string, Contents:string, ShowDeletedFiles:bool, RetrieveAttributes:bool`
- ContactSearchModel head: `FirstName:string, LastName:string, Email:string, UsersOnly:bool`

## TaskSearchModel

`JobId:EntityID, AssigneeId:EntityID, IncludeClosedTasks:bool`

## AttributeInfo

`auto_increment_start:int, enum_items:array<AttributeEnumItem>, input_mask:string, is_auto_increment:bool, is_visible:bool, optional:bool, order:int, read_only:bool, reprompt_on_change:bool, value:AttributeValue, visibility_constraint:AttributeConstraint, workflow_id:EntityID, description:string, type:int, attribute_id:EntityID, name:string, display_name:string, id:EntityID`
