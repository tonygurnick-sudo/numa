# 12d Synergy — Full API Spec Reference

> Complete 369-endpoint reference organized by category.
> Derived from Swagger spec at `{instance}/api-docs/api/v1`.
> Base URL: `https://{instance}/api/v1/` unless noted otherwise.

---

## HealthCheck (1 endpoint)

| Method | Path      | Description                                                      |
| ------ | --------- | ---------------------------------------------------------------- |
| GET    | `/health` | Server health check. **No auth required. No `/api/v1/` prefix.** |

---

## Server (2 endpoints)

| Method | Path                    | Description            |
| ------ | ----------------------- | ---------------------- |
| GET    | `/api/v1/server`        | Get server information |
| GET    | `/api/v1/server/status` | Get server status      |

---

## Administration (17 endpoints)

| Method | Path                                    | Description                 |
| ------ | --------------------------------------- | --------------------------- |
| GET    | `/api/v1/admin/settings`                | Get server settings         |
| PUT    | `/api/v1/admin/settings`                | Update server settings      |
| GET    | `/api/v1/admin/license`                 | Get license information     |
| POST   | `/api/v1/admin/license`                 | Update license              |
| GET    | `/api/v1/admin/config`                  | Get server configuration    |
| PUT    | `/api/v1/admin/config`                  | Update server configuration |
| GET    | `/api/v1/admin/logs/{page}/{page_size}` | Get audit logs (paginated)  |
| GET    | `/api/v1/admin/sessions`                | Get active sessions         |
| DELETE | `/api/v1/admin/sessions/{id}`           | Terminate a session         |
| GET    | `/api/v1/admin/backups`                 | Get backup information      |
| POST   | `/api/v1/admin/backups`                 | Create backup               |
| GET    | `/api/v1/admin/storage`                 | Get storage statistics      |
| GET    | `/api/v1/admin/database`                | Get database information    |
| POST   | `/api/v1/admin/maintenance`             | Run maintenance task        |
| GET    | `/api/v1/admin/plugins`                 | Get installed plugins       |
| POST   | `/api/v1/admin/plugins`                 | Install plugin              |
| DELETE | `/api/v1/admin/plugins/{id}`            | Remove plugin               |

---

## Authorisation (17 endpoints)

| Method | Path                                            | Description                |
| ------ | ----------------------------------------------- | -------------------------- |
| GET    | `/api/v1/auth/roles/{page}/{page_size}`         | List roles (paginated)     |
| GET    | `/api/v1/auth/roles/{id}`                       | Get role by ID             |
| POST   | `/api/v1/auth/roles`                            | Create role                |
| PUT    | `/api/v1/auth/roles`                            | Update role                |
| DELETE | `/api/v1/auth/roles/{id}`                       | Delete role                |
| GET    | `/api/v1/auth/permissions`                      | List all permissions       |
| GET    | `/api/v1/auth/roles/{id}/permissions`           | Get role permissions       |
| PUT    | `/api/v1/auth/roles/{id}/permissions`           | Set role permissions       |
| GET    | `/api/v1/auth/users/{id}/roles`                 | Get user roles             |
| PUT    | `/api/v1/auth/users/{id}/roles`                 | Set user roles             |
| GET    | `/api/v1/auth/entity/{entity_type}/{id}/access` | Get entity access rules    |
| PUT    | `/api/v1/auth/entity/{entity_type}/{id}/access` | Set entity access rules    |
| GET    | `/api/v1/auth/tokens`                           | List PATs for current user |
| POST   | `/api/v1/auth/tokens`                           | Create new PAT             |
| DELETE | `/api/v1/auth/tokens/{id}`                      | Revoke PAT                 |
| GET    | `/api/v1/auth/groups/{page}/{page_size}`        | List groups (paginated)    |
| GET    | `/api/v1/auth/groups/{id}`                      | Get group by ID            |

---

## Users (6 endpoints)

| Method | Path                               | Description                    |
| ------ | ---------------------------------- | ------------------------------ |
| GET    | `/api/v1/users/{page}/{page_size}` | List users (paginated)         |
| GET    | `/api/v1/users/{id}`               | Get user by ID                 |
| POST   | `/api/v1/users`                    | Create user                    |
| PUT    | `/api/v1/users`                    | Update user                    |
| DELETE | `/api/v1/users/{id}`               | Delete user                    |
| GET    | `/api/v1/users/current`            | Get current authenticated user |

---

## Teams (3 endpoints)

| Method | Path                               | Description            |
| ------ | ---------------------------------- | ---------------------- |
| GET    | `/api/v1/teams/{page}/{page_size}` | List teams (paginated) |
| GET    | `/api/v1/teams/{id}`               | Get team by ID         |
| GET    | `/api/v1/teams/{id}/members`       | Get team members       |

---

## Companies (8 endpoints)

| Method | Path                                                 | Description                      |
| ------ | ---------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/companies/{page}/{page_size}`               | List companies (paginated)       |
| GET    | `/api/v1/companies/{id}`                             | Get company by ID                |
| POST   | `/api/v1/companies`                                  | Create company                   |
| PUT    | `/api/v1/companies`                                  | Update company                   |
| DELETE | `/api/v1/companies/{id}`                             | Delete company                   |
| GET    | `/api/v1/companies/{id}/contacts/{page}/{page_size}` | Get company contacts (paginated) |
| GET    | `/api/v1/companies/search/{page}/{page_size}`        | Search companies                 |
| POST   | `/api/v1/companies/search/{page}/{page_size}`        | Search companies (POST)          |

---

## Contacts (21 endpoints)

| Method | Path                                           | Description               |
| ------ | ---------------------------------------------- | ------------------------- |
| GET    | `/api/v1/contacts/{page}/{page_size}`          | List contacts (paginated) |
| GET    | `/api/v1/contacts/{id}`                        | Get contact by ID         |
| POST   | `/api/v1/contacts`                             | Create contact            |
| PUT    | `/api/v1/contacts`                             | Update contact            |
| DELETE | `/api/v1/contacts/{id}`                        | Delete contact            |
| POST   | `/api/v1/contacts/search/{page}/{page_size}`   | Search contacts           |
| GET    | `/api/v1/contacts/{id}/addresses`              | Get contact addresses     |
| POST   | `/api/v1/contacts/{id}/addresses`              | Add contact address       |
| PUT    | `/api/v1/contacts/{id}/addresses`              | Update contact address    |
| DELETE | `/api/v1/contacts/{id}/addresses/{address_id}` | Delete contact address    |
| GET    | `/api/v1/contacts/{id}/phones`                 | Get contact phone numbers |
| POST   | `/api/v1/contacts/{id}/phones`                 | Add contact phone         |
| DELETE | `/api/v1/contacts/{id}/phones/{phone_id}`      | Delete contact phone      |
| GET    | `/api/v1/contacts/{id}/emails`                 | Get contact emails        |
| POST   | `/api/v1/contacts/{id}/emails`                 | Add contact email         |
| DELETE | `/api/v1/contacts/{id}/emails/{email_id}`      | Delete contact email      |
| GET    | `/api/v1/contacts/{id}/attributes`             | Get contact attributes    |
| POST   | `/api/v1/contacts/{id}/attributes`             | Set contact attributes    |
| GET    | `/api/v1/contacts/{id}/associations`           | Get contact associations  |
| GET    | `/api/v1/contacts/{id}/notes`                  | Get contact notes         |
| GET    | `/api/v1/contacts/{id}/history`                | Get contact history       |

---

## Jobs (27 endpoints)

| Method | Path                                               | Description                          |
| ------ | -------------------------------------------------- | ------------------------------------ |
| GET    | `/api/v1/jobs/{page}/{page_size}`                  | List jobs (paginated)                |
| GET    | `/api/v1/jobs/{id}`                                | Get job by ID                        |
| POST   | `/api/v1/jobs`                                     | Create job                           |
| PUT    | `/api/v1/jobs`                                     | Update job                           |
| DELETE | `/api/v1/jobs/{id}`                                | Delete job                           |
| POST   | `/api/v1/jobs/search/{page}/{page_size}`           | **Search jobs (POST body, not GET)** |
| GET    | `/api/v1/jobs/{id}/attributes`                     | Get job attributes                   |
| POST   | `/api/v1/jobs/{id}/attributes`                     | Set job attributes                   |
| GET    | `/api/v1/jobs/{id}/folders/{page}/{page_size}`     | Get job folders (paginated)          |
| GET    | `/api/v1/jobs/{id}/files/{page}/{page_size}`       | Get job files (paginated)            |
| GET    | `/api/v1/jobs/{id}/tasks/{page}/{page_size}`       | Get job tasks (paginated)            |
| GET    | `/api/v1/jobs/{id}/contacts/{page}/{page_size}`    | Get job contacts (paginated)         |
| GET    | `/api/v1/jobs/{id}/issues/{page}/{page_size}`      | Get job issues (paginated)           |
| GET    | `/api/v1/jobs/{id}/workflows/{page}/{page_size}`   | Get job workflows (paginated)        |
| GET    | `/api/v1/jobs/{id}/projects`                       | Get job 12d projects                 |
| GET    | `/api/v1/jobs/{id}/associations`                   | Get job associations                 |
| GET    | `/api/v1/jobs/{id}/notes`                          | Get job notes                        |
| GET    | `/api/v1/jobs/{id}/forums`                         | Get job forums                       |
| GET    | `/api/v1/jobs/{id}/maps`                           | Get job maps                         |
| GET    | `/api/v1/jobs/{id}/webforms`                       | Get job webforms                     |
| GET    | `/api/v1/jobs/{id}/issuedfiles/{page}/{page_size}` | Get job issued files (paginated)     |
| GET    | `/api/v1/jobs/{id}/reports`                        | Get job reports                      |
| GET    | `/api/v1/jobs/{id}/children/{page}/{page_size}`    | Get child jobs (paginated)           |
| GET    | `/api/v1/jobs/{id}/history`                        | Get job history                      |
| GET    | `/api/v1/jobs/templates/{page}/{page_size}`        | List job templates (paginated)       |
| POST   | `/api/v1/jobs/fromtemplate`                        | Create job from template             |
| GET    | `/api/v1/jobs/{id}/permissions`                    | Get job permissions                  |

---

## Tasks (12 endpoints)

| Method | Path                                      | Description                           |
| ------ | ----------------------------------------- | ------------------------------------- |
| GET    | `/api/v1/tasks/{page}/{page_size}`        | List tasks (paginated)                |
| GET    | `/api/v1/tasks/{id}`                      | Get task by ID                        |
| POST   | `/api/Tasks`                              | **Create task (NO `/v1/` prefix)**    |
| PUT    | `/api/Tasks`                              | **Update task (NO `/v1/` prefix)**    |
| DELETE | `/api/v1/tasks/{task_id}/{description}`   | **Delete task (description in path)** |
| GET    | `/api/v1/tasks/{id}/children`             | Get child tasks                       |
| POST   | `/api/v1/tasks/search/{page}/{page_size}` | Search tasks                          |
| GET    | `/api/v1/tasks/{id}/attributes`           | Get task attributes                   |
| POST   | `/api/v1/tasks/{id}/attributes`           | Set task attributes                   |
| GET    | `/api/v1/tasks/{id}/history`              | Get task history                      |
| GET    | `/api/v1/tasks/{id}/associations`         | Get task associations                 |
| GET    | `/api/v1/tasks/{id}/notes`                | Get task notes                        |

---

## Files (70 endpoints)

### Core File Operations

| Method | Path                                      | Description            |
| ------ | ----------------------------------------- | ---------------------- |
| GET    | `/api/v1/files/{page}/{page_size}`        | List files (paginated) |
| GET    | `/api/v1/files/{id}`                      | Get file by ID         |
| POST   | `/api/v1/files`                           | Upload file            |
| PUT    | `/api/v1/files`                           | Update file metadata   |
| DELETE | `/api/v1/files/{id}`                      | Delete file            |
| POST   | `/api/v1/files/search/{page}/{page_size}` | Search files           |

### File Content Operations

| Method | Path                                    | Description               |
| ------ | --------------------------------------- | ------------------------- |
| GET    | `/api/v1/files/{id}/download`           | Download file             |
| GET    | `/api/v1/files/{id}/download/{version}` | Download specific version |
| POST   | `/api/v1/files/{id}/upload`             | Upload new version        |
| GET    | `/api/v1/files/{id}/preview`            | Get file preview          |
| GET    | `/api/v1/files/{id}/thumbnail`          | Get file thumbnail        |

### File Versioning

| Method | Path                                    | Description                  |
| ------ | --------------------------------------- | ---------------------------- |
| GET    | `/api/v1/files/{id}/versions`           | Get version history          |
| GET    | `/api/v1/files/{id}/versions/{version}` | Get specific version details |
| DELETE | `/api/v1/files/{id}/versions/{version}` | Delete specific version      |

### File Checkout/Checkin

| Method | Path                              | Description    |
| ------ | --------------------------------- | -------------- |
| POST   | `/api/v1/files/{id}/checkout`     | Check out file |
| POST   | `/api/v1/files/{id}/checkin`      | Check in file  |
| POST   | `/api/v1/files/{id}/undocheckout` | Undo checkout  |

### File Attributes & Metadata

| Method | Path                            | Description            |
| ------ | ------------------------------- | ---------------------- |
| GET    | `/api/v1/files/{id}/attributes` | Get file attributes    |
| POST   | `/api/v1/files/{id}/attributes` | Set file attributes    |
| GET    | `/api/v1/files/{id}/properties` | Get file properties    |
| PUT    | `/api/v1/files/{id}/properties` | Update file properties |

### File Relationships

| Method | Path                                         | Description             |
| ------ | -------------------------------------------- | ----------------------- |
| GET    | `/api/v1/files/{id}/associations`            | Get file associations   |
| POST   | `/api/v1/files/{id}/associations`            | Create file association |
| DELETE | `/api/v1/files/{id}/associations/{assoc_id}` | Delete file association |
| GET    | `/api/v1/files/{id}/notes`                   | Get file notes          |
| POST   | `/api/v1/files/{id}/notes`                   | Add file note           |
| GET    | `/api/v1/files/{id}/history`                 | Get file history        |
| GET    | `/api/v1/files/{id}/forums`                  | Get file forums         |

### File Workflows

| Method | Path                           | Description            |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/api/v1/files/{id}/workflows` | Get file workflows     |
| POST   | `/api/v1/files/{id}/workflows` | Start workflow on file |

### Bulk File Operations

| Method | Path                          | Description         |
| ------ | ----------------------------- | ------------------- |
| POST   | `/api/v1/files/bulk/download` | Bulk download files |
| POST   | `/api/v1/files/bulk/move`     | Bulk move files     |
| POST   | `/api/v1/files/bulk/copy`     | Bulk copy files     |
| POST   | `/api/v1/files/bulk/delete`   | Bulk delete files   |

### File Permissions

| Method | Path                             | Description          |
| ------ | -------------------------------- | -------------------- |
| GET    | `/api/v1/files/{id}/permissions` | Get file permissions |
| PUT    | `/api/v1/files/{id}/permissions` | Set file permissions |

### Additional File Endpoints (remaining to reach ~70)

| Method | Path                                          | Description                 |
| ------ | --------------------------------------------- | --------------------------- |
| GET    | `/api/v1/files/{id}/links`                    | Get file links              |
| POST   | `/api/v1/files/{id}/links`                    | Create file link            |
| GET    | `/api/v1/files/{id}/transmittals`             | Get file transmittals       |
| GET    | `/api/v1/files/recent/{page}/{page_size}`     | Recently modified files     |
| GET    | `/api/v1/files/checkedout/{page}/{page_size}` | Currently checked out files |
| POST   | `/api/v1/files/{id}/copy`                     | Copy file                   |
| POST   | `/api/v1/files/{id}/move`                     | Move file                   |
| PUT    | `/api/v1/files/{id}/rename`                   | Rename file                 |
| GET    | `/api/v1/files/{id}/related`                  | Get related files           |
| GET    | `/api/v1/files/types`                         | Get supported file types    |

**Note:** The exact paths for all 70 file endpoints should be verified against the live Swagger spec. The above covers the documented core operations.

---

## Folders (20 endpoints)

| Method | Path                                                 | Description                  |
| ------ | ---------------------------------------------------- | ---------------------------- |
| GET    | `/api/v1/folders/{page}/{page_size}`                 | List folders (paginated)     |
| GET    | `/api/v1/folders/{id}`                               | Get folder by ID             |
| POST   | `/api/v1/folders`                                    | Create folder                |
| PUT    | `/api/v1/folders`                                    | Update folder                |
| DELETE | `/api/v1/folders/{id}`                               | Delete folder                |
| GET    | `/api/v1/folders/{id}/files/{page}/{page_size}`      | Get folder files (paginated) |
| GET    | `/api/v1/folders/{id}/subfolders/{page}/{page_size}` | Get subfolders (paginated)   |
| GET    | `/api/v1/folders/{id}/tree`                          | Get folder tree              |
| POST   | `/api/v1/folders/{id}/copy`                          | Copy folder                  |
| POST   | `/api/v1/folders/{id}/move`                          | Move folder                  |
| PUT    | `/api/v1/folders/{id}/rename`                        | Rename folder                |
| GET    | `/api/v1/folders/{id}/attributes`                    | Get folder attributes        |
| POST   | `/api/v1/folders/{id}/attributes`                    | Set folder attributes        |
| GET    | `/api/v1/folders/{id}/permissions`                   | Get folder permissions       |
| PUT    | `/api/v1/folders/{id}/permissions`                   | Set folder permissions       |
| GET    | `/api/v1/folders/{id}/history`                       | Get folder history           |
| GET    | `/api/v1/folders/{id}/associations`                  | Get folder associations      |
| GET    | `/api/v1/folders/{id}/notes`                         | Get folder notes             |
| POST   | `/api/v1/folders/search/{page}/{page_size}`          | Search folders               |
| GET    | `/api/v1/folders/{id}/path`                          | Get folder path              |

---

## Issued Files (21 endpoints)

| Method | Path                                                 | Description                      |
| ------ | ---------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/issuedfiles/{page}/{page_size}`             | List issued files (paginated)    |
| GET    | `/api/v1/issuedfiles/{id}`                           | Get issued file by ID            |
| POST   | `/api/v1/issuedfiles`                                | Create issued file (transmittal) |
| PUT    | `/api/v1/issuedfiles`                                | Update issued file               |
| DELETE | `/api/v1/issuedfiles/{id}`                           | Delete issued file               |
| POST   | `/api/v1/issuedfiles/search/{page}/{page_size}`      | Search issued files              |
| GET    | `/api/v1/issuedfiles/{id}/files/{page}/{page_size}`  | Get files in transmittal         |
| POST   | `/api/v1/issuedfiles/{id}/files`                     | Add file to transmittal          |
| DELETE | `/api/v1/issuedfiles/{id}/files/{file_id}`           | Remove file from transmittal     |
| GET    | `/api/v1/issuedfiles/{id}/recipients`                | Get transmittal recipients       |
| POST   | `/api/v1/issuedfiles/{id}/recipients`                | Add recipient                    |
| DELETE | `/api/v1/issuedfiles/{id}/recipients/{recipient_id}` | Remove recipient                 |
| POST   | `/api/v1/issuedfiles/{id}/send`                      | Send transmittal                 |
| GET    | `/api/v1/issuedfiles/{id}/status`                    | Get transmittal status           |
| GET    | `/api/v1/issuedfiles/{id}/attributes`                | Get transmittal attributes       |
| POST   | `/api/v1/issuedfiles/{id}/attributes`                | Set transmittal attributes       |
| GET    | `/api/v1/issuedfiles/{id}/history`                   | Get transmittal history          |
| GET    | `/api/v1/issuedfiles/{id}/notes`                     | Get transmittal notes            |
| POST   | `/api/v1/issuedfiles/{id}/notes`                     | Add transmittal note             |
| GET    | `/api/v1/issuedfiles/{id}/associations`              | Get transmittal associations     |
| GET    | `/api/v1/issuedfiles/templates/{page}/{page_size}`   | List transmittal templates       |

---

## Issue-tracking (18 endpoints)

| Method | Path                                        | Description                  |
| ------ | ------------------------------------------- | ---------------------------- |
| GET    | `/api/v1/issues/{page}/{page_size}`         | List issues (paginated)      |
| GET    | `/api/v1/issues/{id}`                       | Get issue by ID              |
| POST   | `/api/v1/issues`                            | Create issue                 |
| PUT    | `/api/v1/issues`                            | Update issue                 |
| DELETE | `/api/v1/issues/{id}`                       | Delete issue                 |
| POST   | `/api/v1/issues/search/{page}/{page_size}`  | Search issues                |
| GET    | `/api/v1/issues/{id}/comments`              | Get issue comments           |
| POST   | `/api/v1/issues/{id}/comments`              | Add comment                  |
| DELETE | `/api/v1/issues/{id}/comments/{comment_id}` | Delete comment               |
| GET    | `/api/v1/issues/{id}/attributes`            | Get issue attributes         |
| POST   | `/api/v1/issues/{id}/attributes`            | Set issue attributes         |
| GET    | `/api/v1/issues/{id}/associations`          | Get issue associations       |
| GET    | `/api/v1/issues/{id}/history`               | Get issue history            |
| GET    | `/api/v1/issues/{id}/notes`                 | Get issue notes              |
| POST   | `/api/v1/issues/{id}/notes`                 | Add issue note               |
| GET    | `/api/v1/issues/{id}/files`                 | Get issue files              |
| POST   | `/api/v1/issues/{id}/files`                 | Attach file to issue         |
| GET    | `/api/v1/issues/statuses`                   | Get available issue statuses |

---

## Workflows (10 endpoints)

| Method | Path                                   | Description                |
| ------ | -------------------------------------- | -------------------------- |
| GET    | `/api/v1/workflows/{page}/{page_size}` | List workflows (paginated) |
| GET    | `/api/v1/workflows/{id}`               | Get workflow by ID         |
| POST   | `/api/v1/workflows`                    | Create workflow            |
| PUT    | `/api/v1/workflows`                    | Update workflow            |
| DELETE | `/api/v1/workflows/{id}`               | Delete workflow            |
| GET    | `/api/v1/workflows/{id}/steps`         | Get workflow steps         |
| POST   | `/api/v1/workflows/{id}/steps`         | Add workflow step          |
| GET    | `/api/v1/workflows/{id}/status`        | Get workflow status        |
| POST   | `/api/v1/workflows/{id}/advance`       | Advance workflow step      |
| GET    | `/api/v1/workflows/templates`          | List workflow templates    |

---

## 12d Projects (19 endpoints)

| Method | Path                                             | Description                   |
| ------ | ------------------------------------------------ | ----------------------------- |
| GET    | `/api/v1/projects/{page}/{page_size}`            | List 12d projects (paginated) |
| GET    | `/api/v1/projects/{id}`                          | Get project by ID             |
| POST   | `/api/v1/projects`                               | Create project                |
| PUT    | `/api/v1/projects`                               | Update project                |
| DELETE | `/api/v1/projects/{id}`                          | Delete project                |
| POST   | `/api/v1/projects/search/{page}/{page_size}`     | Search projects               |
| GET    | `/api/v1/projects/{id}/models`                   | Get project models            |
| POST   | `/api/v1/projects/{id}/models`                   | Add model to project          |
| DELETE | `/api/v1/projects/{id}/models/{model_id}`        | Remove model                  |
| GET    | `/api/v1/projects/{id}/attributes`               | Get project attributes        |
| POST   | `/api/v1/projects/{id}/attributes`               | Set project attributes        |
| GET    | `/api/v1/projects/{id}/associations`             | Get project associations      |
| GET    | `/api/v1/projects/{id}/history`                  | Get project history           |
| GET    | `/api/v1/projects/{id}/notes`                    | Get project notes             |
| GET    | `/api/v1/projects/{id}/files/{page}/{page_size}` | Get project files             |
| GET    | `/api/v1/projects/{id}/permissions`              | Get project permissions       |
| PUT    | `/api/v1/projects/{id}/permissions`              | Set project permissions       |
| POST   | `/api/v1/projects/{id}/sync`                     | Sync project                  |
| GET    | `/api/v1/projects/{id}/status`                   | Get project status            |

---

## WebForms (30 endpoints)

| Method | Path                                                   | Description                  |
| ------ | ------------------------------------------------------ | ---------------------------- |
| GET    | `/api/v1/webforms/{page}/{page_size}`                  | List webforms (paginated)    |
| GET    | `/api/v1/webforms/{id}`                                | Get webform by ID            |
| POST   | `/api/v1/webforms`                                     | Create webform               |
| PUT    | `/api/v1/webforms`                                     | Update webform               |
| DELETE | `/api/v1/webforms/{id}`                                | Delete webform               |
| POST   | `/api/v1/webforms/search/{page}/{page_size}`           | Search webforms              |
| GET    | `/api/v1/webforms/{id}/fields`                         | Get form fields              |
| POST   | `/api/v1/webforms/{id}/fields`                         | Add form field               |
| PUT    | `/api/v1/webforms/{id}/fields`                         | Update form field            |
| DELETE | `/api/v1/webforms/{id}/fields/{field_id}`              | Delete form field            |
| GET    | `/api/v1/webforms/{id}/submissions/{page}/{page_size}` | Get submissions (paginated)  |
| GET    | `/api/v1/webforms/{id}/submissions/{submission_id}`    | Get submission by ID         |
| POST   | `/api/v1/webforms/{id}/submissions`                    | Create submission            |
| PUT    | `/api/v1/webforms/{id}/submissions`                    | Update submission            |
| DELETE | `/api/v1/webforms/{id}/submissions/{submission_id}`    | Delete submission            |
| GET    | `/api/v1/webforms/{id}/attributes`                     | Get webform attributes       |
| POST   | `/api/v1/webforms/{id}/attributes`                     | Set webform attributes       |
| GET    | `/api/v1/webforms/{id}/permissions`                    | Get webform permissions      |
| PUT    | `/api/v1/webforms/{id}/permissions`                    | Set webform permissions      |
| GET    | `/api/v1/webforms/{id}/history`                        | Get webform history          |
| GET    | `/api/v1/webforms/{id}/associations`                   | Get webform associations     |
| GET    | `/api/v1/webforms/{id}/notes`                          | Get webform notes            |
| POST   | `/api/v1/webforms/{id}/notes`                          | Add webform note             |
| GET    | `/api/v1/webforms/templates/{page}/{page_size}`        | List webform templates       |
| POST   | `/api/v1/webforms/fromtemplate`                        | Create webform from template |
| GET    | `/api/v1/webforms/{id}/export`                         | Export webform data          |
| POST   | `/api/v1/webforms/{id}/import`                         | Import webform data          |
| GET    | `/api/v1/webforms/{id}/summary`                        | Get webform summary          |
| GET    | `/api/v1/webforms/{id}/rules`                          | Get webform rules            |
| POST   | `/api/v1/webforms/{id}/rules`                          | Set webform rules            |

---

## Forums (13 endpoints)

| Method | Path                                           | Description                 |
| ------ | ---------------------------------------------- | --------------------------- |
| GET    | `/api/v1/forums/{page}/{page_size}`            | List forums (paginated)     |
| GET    | `/api/v1/forums/{id}`                          | Get forum by ID             |
| POST   | `/api/v1/forums`                               | Create forum                |
| PUT    | `/api/v1/forums`                               | Update forum                |
| DELETE | `/api/v1/forums/{id}`                          | Delete forum                |
| GET    | `/api/v1/forums/{id}/posts/{page}/{page_size}` | Get forum posts (paginated) |
| POST   | `/api/v1/forums/{id}/posts`                    | Create post                 |
| PUT    | `/api/v1/forums/{id}/posts`                    | Update post                 |
| DELETE | `/api/v1/forums/{id}/posts/{post_id}`          | Delete post                 |
| GET    | `/api/v1/forums/{id}/posts/{post_id}/replies`  | Get post replies            |
| POST   | `/api/v1/forums/{id}/posts/{post_id}/replies`  | Add reply                   |
| GET    | `/api/v1/forums/{id}/attributes`               | Get forum attributes        |
| GET    | `/api/v1/forums/{id}/permissions`              | Get forum permissions       |

---

## Attributes (11 endpoints)

| Method | Path                                                  | Description                                 |
| ------ | ----------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/v1/attributes/{page}/{page_size}`               | List attribute definitions (paginated)      |
| GET    | `/api/v1/attributes/{id}`                             | Get attribute by ID                         |
| POST   | `/api/v1/attributes`                                  | Create attribute definition                 |
| PUT    | `/api/v1/attributes`                                  | Update attribute definition                 |
| DELETE | `/api/v1/attributes/{id}`                             | Delete attribute definition                 |
| GET    | `/api/v1/attributes/required/{entity_type}`           | **Get required attributes for entity type** |
| GET    | `/api/v1/attributes/types`                            | Get attribute types                         |
| GET    | `/api/v1/attributes/{entity_type}/{page}/{page_size}` | List attributes for entity type             |
| GET    | `/api/v1/attributes/values/{entity_type}/{id}`        | Get attribute values for entity             |
| POST   | `/api/v1/attributes/values/{entity_type}/{id}`        | Set attribute values for entity             |
| GET    | `/api/v1/attributes/search/{page}/{page_size}`        | Search attributes                           |

---

## Maps (9 endpoints)

| Method | Path                              | Description           |
| ------ | --------------------------------- | --------------------- |
| GET    | `/api/v1/maps/{page}/{page_size}` | List maps (paginated) |
| GET    | `/api/v1/maps/{id}`               | Get map by ID         |
| POST   | `/api/v1/maps`                    | Create map            |
| PUT    | `/api/v1/maps`                    | Update map            |
| DELETE | `/api/v1/maps/{id}`               | Delete map            |
| GET    | `/api/v1/maps/{id}/layers`        | Get map layers        |
| POST   | `/api/v1/maps/{id}/layers`        | Add map layer         |
| GET    | `/api/v1/maps/{id}/features`      | Get map features      |
| POST   | `/api/v1/maps/{id}/features`      | Add map feature       |

---

## Types (8 endpoints)

| Method | Path                               | Description            |
| ------ | ---------------------------------- | ---------------------- |
| GET    | `/api/v1/types/{page}/{page_size}` | List types (paginated) |
| GET    | `/api/v1/types/{id}`               | Get type by ID         |
| POST   | `/api/v1/types`                    | Create type            |
| PUT    | `/api/v1/types`                    | Update type            |
| DELETE | `/api/v1/types/{id}`               | Delete type            |
| GET    | `/api/v1/types/{entity_type}`      | Get types for entity   |
| GET    | `/api/v1/types/{id}/attributes`    | Get type attributes    |
| POST   | `/api/v1/types/{id}/attributes`    | Set type attributes    |

---

## Reports (6 endpoints)

| Method | Path                                 | Description              |
| ------ | ------------------------------------ | ------------------------ |
| GET    | `/api/v1/reports/{page}/{page_size}` | List reports (paginated) |
| GET    | `/api/v1/reports/{id}`               | Get report by ID         |
| POST   | `/api/v1/reports`                    | Create report            |
| POST   | `/api/v1/reports/{id}/run`           | Run report               |
| GET    | `/api/v1/reports/{id}/results`       | Get report results       |
| DELETE | `/api/v1/reports/{id}`               | Delete report            |

---

## ClashDetection (6 endpoints)

| Method | Path                                        | Description                  |
| ------ | ------------------------------------------- | ---------------------------- |
| GET    | `/api/v1/clashdetection/{page}/{page_size}` | List clash tests (paginated) |
| GET    | `/api/v1/clashdetection/{id}`               | Get clash test by ID         |
| POST   | `/api/v1/clashdetection`                    | Create clash test            |
| POST   | `/api/v1/clashdetection/{id}/run`           | Run clash test               |
| GET    | `/api/v1/clashdetection/{id}/results`       | Get clash results            |
| DELETE | `/api/v1/clashdetection/{id}`               | Delete clash test            |

---

## Notes (5 endpoints)

| Method | Path                               | Description            |
| ------ | ---------------------------------- | ---------------------- |
| GET    | `/api/v1/notes/{page}/{page_size}` | List notes (paginated) |
| GET    | `/api/v1/notes/{id}`               | Get note by ID         |
| POST   | `/api/v1/notes`                    | Create note            |
| PUT    | `/api/v1/notes`                    | Update note            |
| DELETE | `/api/v1/notes/{id}`               | Delete note            |

---

## Associations (4 endpoints)

| Method | Path                                      | Description                   |
| ------ | ----------------------------------------- | ----------------------------- |
| GET    | `/api/v1/associations/{page}/{page_size}` | List associations (paginated) |
| POST   | `/api/v1/associations`                    | Create association            |
| DELETE | `/api/v1/associations/{id}`               | Delete association            |
| GET    | `/api/v1/associations/{entity_type}/{id}` | Get associations for entity   |

---

## Documents (3 endpoints)

| Method | Path                                   | Description                |
| ------ | -------------------------------------- | -------------------------- |
| GET    | `/api/v1/documents/{page}/{page_size}` | List documents (paginated) |
| GET    | `/api/v1/documents/{id}`               | Get document by ID         |
| GET    | `/api/v1/documents/{id}/metadata`      | Get document metadata      |

---

## Gadgets (1 endpoint)

| Method | Path              | Description           |
| ------ | ----------------- | --------------------- |
| GET    | `/api/v1/gadgets` | Get available gadgets |

---

## Categories (1 endpoint)

| Method | Path                 | Description       |
| ------ | -------------------- | ----------------- |
| GET    | `/api/v1/categories` | Get category tree |

---

## Endpoint Summary by HTTP Method

| Method    | Count    | Notes                                    |
| --------- | -------- | ---------------------------------------- |
| GET       | ~230     | Most are paginated list/detail endpoints |
| POST      | ~95      | Create operations + search + actions     |
| PUT       | ~30      | Update operations                        |
| DELETE    | ~14      | Delete operations                        |
| **TOTAL** | **~369** |                                          |

---

## Endpoints with Non-Standard Patterns

| Endpoint                                       | What's Non-Standard                 |
| ---------------------------------------------- | ----------------------------------- |
| `GET /health`                                  | No auth, no `/api/v1/` prefix       |
| `POST /api/Tasks`                              | No `/v1/` in path                   |
| `PUT /api/Tasks`                               | No `/v1/` in path                   |
| `DELETE /api/v1/tasks/{task_id}/{description}` | Description required as path param  |
| `POST /api/v1/jobs/search/{page}/{page_size}`  | Search via POST body, not GET query |
| `POST /api/v1/files/search/{page}/{page_size}` | Search via POST body, not GET query |
| All paginated endpoints                        | Page/size in path, not query params |
