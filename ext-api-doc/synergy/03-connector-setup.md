# 12d Synergy — Connector Setup

> Data Connector integration guide for Numa.
> Auth type: Token (PAT). Per-client instance URLs.
> Adapt code examples to match current Numa connector patterns.

---

## Integration Path

| Property          | Value                                         |
| ----------------- | --------------------------------------------- |
| Integration type  | **Data Connector** (token auth)               |
| Auth mechanism    | Personal Access Token (PAT) via Bearer header |
| Token lifetime    | Max 180 days, no refresh                      |
| Per-client config | Instance URL + PAT                            |
| Pipedream?        | **No.** Direct API integration.               |

---

## Connector Configuration

### Required Credentials (Two-Secret Model)

Each client needs two values stored in Numa's connector secret system:

| Secret        | Description                           | Example                       |
| ------------- | ------------------------------------- | ----------------------------- |
| `instanceUrl` | The client's 12d Synergy instance URL | `https://acme.12dsynergy.com` |
| `accessToken` | Personal Access Token (PAT)           | `eyJ0eXAiOiJKV1QiLCJhb...`    |

### Instance URL Format

The instance URL is the base hostname. Do NOT include `/api/v1/` — the connector appends that.

- Correct: `https://acme.12dsynergy.com`
- Wrong: `https://acme.12dsynergy.com/api/v1/`
- Wrong: `https://acme.12dsynergy.com/s12d/api/v1/`

### PAT Generation

Users generate PATs in 12d Synergy:

1. Navigate to User Settings > API Access (or similar)
2. Create new Personal Access Token
3. Set expiry (max 180 days)
4. Copy the token immediately (shown only once)
5. Store in Numa connector configuration

### Token Rotation

PATs expire after a maximum of 180 days. The connector should:

1. Track the token creation date
2. Warn the user 14 days before expiry
3. On 401 response, prompt for a new PAT
4. There is no refresh token mechanism

---

## Test Connection Flow

Two-step verification: first check server reachability (no auth), then verify the PAT.

### Step 1: Health Check (No Auth)

```
GET https://{instanceUrl}/health
```

- **No** `Authorization` header
- **No** `/api/v1/` prefix
- Verifies the instance URL is correct and the server is reachable

Expected: HTTP 200

If this fails:

- Check the instance URL is correct
- Check network connectivity / firewall rules
- The server may be down

### Step 2: Authenticated Endpoint

```
GET https://{instanceUrl}/api/v1/auth/getPersonalAccessTokens
Authorization: Bearer {accessToken}
```

- Uses a lightweight paginated endpoint (attributes, page 1, size 1)
- Verifies the PAT is valid and has API access

Expected: HTTP 200 with a `PagedResultModel` response

If this fails:

- 401: PAT is invalid or expired
- 403: PAT lacks API access permissions
- Other: Check server logs

### Alternative Auth Check

```
GET https://{instanceUrl}/api/v1/users/current
Authorization: Bearer {accessToken}
```

Returns the current authenticated user. Good for confirming identity.

---

## Connector Registry Entry

```typescript
// connectorRegistry entry
{
  id: '12d-synergy',
  name: '12d Synergy',
  description: 'Construction project collaboration platform',
  category: 'project-management',
  authType: 'token',
  iconKey: '12d-synergy', // or appropriate icon
  fields: [
    {
      key: 'instanceUrl',
      label: 'Instance URL',
      type: 'url',
      placeholder: 'https://your-company.12dsynergy.com',
      required: true,
      helpText: 'Your 12d Synergy server URL (without /api/v1/)',
    },
    {
      key: 'accessToken',
      label: 'Personal Access Token',
      type: 'password',
      required: true,
      helpText: 'Generate a PAT in 12d Synergy under User Settings > API Access. Max 180 day lifetime.',
    },
  ],
  testConnection: {
    // Step 1: health check (no auth)
    healthEndpoint: '/health',
    // Step 2: auth check
    authEndpoint: '/api/v1/auth/getPersonalAccessTokens',
  },
}
```

---

## Backend Provider

```python
# Provider for 12d Synergy API calls
# Location: lambdas/python/{connector-lambda}/providers/twelve_d_synergy.py

import httpx
from typing import Any

class TwelveDSynergyProvider:
    """12d Synergy API provider for Numa data connector."""

    def __init__(self, instance_url: str, access_token: str):
        # Strip trailing slash from instance URL
        self.base_url = instance_url.rstrip('/')
        self.access_token = access_token
        self.headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        }

    async def health_check(self) -> bool:
        """Check server health (no auth required)."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/health',
                timeout=10.0,
            )
            return response.status_code == 200

    async def test_connection(self) -> dict[str, Any]:
        """Two-step connection test."""
        # Step 1: Health check
        health_ok = await self.health_check()
        if not health_ok:
            return {
                'success': False,
                'error': 'Server health check failed. Check instance URL.',
            }

        # Step 2: Authenticated endpoint
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/auth/getPersonalAccessTokens',
                headers=self.headers,
                timeout=10.0,
            )

            if response.status_code == 200:
                return {'success': True}
            elif response.status_code == 401:
                return {
                    'success': False,
                    'error': 'Authentication failed. PAT may be expired or invalid.',
                }
            elif response.status_code == 403:
                return {
                    'success': False,
                    'error': 'Access denied. PAT may lack API permissions.',
                }
            else:
                return {
                    'success': False,
                    'error': f'Unexpected response: HTTP {response.status_code}',
                }

    async def list_jobs(self, page: int = 1, page_size: int = 50) -> dict:
        """List jobs (projects) — pagination goes in the body."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{self.base_url}/api/v1/jobs/search',
                headers=self.headers,
                json={
                    'Page': page,
                    'PageSize': page_size,
                    'QuickSearchTerm': '',
                    'Name': '',
                    'Attributes': [{
                        'Attribute': {'Name': 'TopLevel', 'DisplayName': 'Restrict to top level?'},
                        'Type': 'SynergyServerWeb.API.Models.SelectableProgrammaticAttribute',
                        'Value': False,   # False = return all jobs, True = top-level only
                        'SearchQueryType': 4, 'Operation': 0,
                        'Name': 'Restrict to top level?', 'OperationName': '=',
                    }],
                },
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def search_jobs(self, criteria: dict, page: int = 1, page_size: int = 50) -> dict:
        """Search jobs — POST with body pagination."""
        criteria = {**criteria, 'Page': page, 'PageSize': page_size}
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{self.base_url}/api/v1/jobs/search',
                headers=self.headers,
                json=criteria,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_job_attributes(self, job_id: str, retrieve_attributes: bool = True) -> dict:
        """Get a job's attributes. retrieve_attributes is a required path param."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/jobs/{job_id}/{str(retrieve_attributes).lower()}',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_job_items(self, job_id: str) -> dict:
        """Get folders + child jobs inside a job. Returns JobItemsModel."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/jobs/{job_id}/items',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def search_files(self, criteria: dict, page: int = 1, page_size: int = 50) -> dict:
        """Search files — supports content search via the 'Contents' field."""
        criteria = {**criteria, 'Page': page, 'PageSize': page_size}
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{self.base_url}/api/v1/files/search',
                headers=self.headers,
                json=criteria,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_file_metadata(self, file_id: str, retrieve_attributes: bool = True) -> dict:
        """Get file metadata. retrieve_attributes is a required path param."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/files/{file_id}/{str(retrieve_attributes).lower()}',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def download_file(self, file_id: str, version: int, with_references: bool = False) -> bytes:
        """Download file content. version and with_references are path params."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{self.base_url}/api/v1/files/{file_id}/download/{version}/{str(with_references).lower()}',
                headers={**self.headers, 'Content-Type': 'application/octet-stream'},
                content=b'',
                timeout=120.0,
            )
            response.raise_for_status()
            return response.content

    async def get_folder_items(self, folder_id: str) -> dict:
        """Get a folder's subfolders + first page of files. Returns FolderItemsModel."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/folders/{folder_id}/items',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_folder_files(self, folder_id: str, page: int = 1, page_size: int = 50,
                               retrieve_attributes: bool = True, filter: str = '*',
                               show_deleted: bool = False) -> dict:
        """Get paginated files in a folder. 6 path params."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/folders/{folder_id}/files/'
                f'{str(retrieve_attributes).lower()}/{page}/{page_size}/{filter}/{str(show_deleted).lower()}',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def list_tasks_for_job(self, job_id: str) -> dict:
        """List tasks for a specific job. No cross-job list endpoint exists."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/tasks/getTaskList/{job_id}',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def create_task(self, task_data: dict) -> dict:
        """Create task. NOTE: Uses /api/Tasks (no /v1/ prefix)."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{self.base_url}/api/Tasks',  # NO /v1/ prefix!
                headers=self.headers,
                json=task_data,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_standard_job_attributes(self) -> list:
        """Get standard (required + default) attributes for job creation.

        There is no generic /api/v1/attributes/required/{entity_type} endpoint.
        Use the resource-specific helpers instead.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/jobs/getStandardAttributes',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_default_job_attributes(self) -> list:
        """Get tenant-specific default attribute values for job creation."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f'{self.base_url}/api/v1/jobs/getDefaultAttributes',
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def paginate_all(self, path: str, page_size: int = 50) -> list:
        """
        Helper: Paginate through all pages and collect all results.

        Args:
            path: API path WITHOUT page/page_size (e.g., '/api/v1/jobs')
            page_size: Items per page
        """
        all_results = []
        page = 1

        async with httpx.AsyncClient() as client:
            while True:
                response = await client.get(
                    f'{self.base_url}{path}/{page}/{page_size}',
                    headers=self.headers,
                    timeout=30.0,
                )
                response.raise_for_status()
                data = response.json()

                all_results.extend(data.get('Result', []))

                if page >= data.get('TotalPages', 0):
                    break
                page += 1

        return all_results
```

---

## Workspace Agent Integration

When the workspace agent detects a 12d Synergy connector is configured, it should use these prompt rules:

```
You have access to a 12d Synergy instance. Key rules:
- Base URL: {instanceUrl}/api/v1/
- Pagination is path-based: /{page}/{page_size} (not query params)
- Job search uses POST, not GET
- Task create/update: POST /api/Tasks (no /v1/ prefix)
- Delete task: DELETE /api/v1/tasks/{id}/{description} (description in path, URL-encoded)
- EntityIDs are composite objects with IDString for URL paths
- Must fetch required attributes before creating jobs
- No webhooks — poll for changes
```

---

## Deployment Checklist

1. **Connector registry** — Add `12d-synergy` entry with token auth fields
2. **Secrets storage** — Store `instanceUrl` and `accessToken` per client
3. **Backend provider** — Implement API call methods with path-based pagination
4. **Test connection** — Two-step: health check (no auth) + authenticated attributes call
5. **Files Remote** — Wire up folder/file browsing and download
6. **Workspace agent prompt** — Include 12d Synergy API rules when connector is active
7. **Token rotation alert** — Track PAT creation date, warn at 166 days (14 before expiry)

---

## Common Integration Scenarios

### Scenario 1: Browse Project Files

1. `POST /api/v1/jobs/search` with `{Page:1, PageSize:50, TopLevel=false}` — list all projects
2. User selects a project
3. `GET /api/v1/jobs/{id}/folders/1/50` — Get project folder tree
4. User navigates folders — `GET /api/v1/folders/{id}/items` returns subfolders + page 1 of files
5. More file pages: `GET /api/v1/folders/{id}/files/true/{page}/{page_size}/*/false` (6 path params)
6. `GET /api/v1/files/{id}/true` — file metadata to discover LatestVersion
7. `POST /api/v1/files/{id}/download/{version}/false` — download selected version

### Scenario 2: Sync Tasks

1. For each job the user cares about: `GET /api/v1/tasks/getTaskList/{job_id}` — list tasks in that job. There is no cross-job task list endpoint.
2. Alternatively: `POST /api/v1/tasks/search` with `{JobId, AssigneeId, IncludeClosedTasks}` body.
3. Track `due_date_utc` and `is_closed` for status.
4. Poll periodically (e.g., every 15 minutes).
5. Detect new/changed/closed tasks by comparing against previous poll.

### Scenario 3: Job Search and Report

1. `POST /api/v1/jobs/search` with `{Page:1, PageSize:50, Name, ...}` body — find matching jobs
2. For each job: `GET /api/v1/jobs/{id}/true` — get JobModel with attributes (`true` = retrieve_attributes)
3. `GET /api/v1/jobs/{id}/items` — get subfolders + child jobs
4. For each folder: `GET /api/v1/folders/{folder_id}/items` — files at page 1, subfolders
5. Compile results for user

---

## Troubleshooting

| Symptom                        | Likely Cause                                  | Fix                                                              |
| ------------------------------ | --------------------------------------------- | ---------------------------------------------------------------- |
| Health check fails             | Wrong instance URL or server down             | Verify URL, check with client                                    |
| 401 on all requests            | PAT expired or invalid                        | Generate new PAT                                                 |
| 403 on specific endpoints      | Insufficient permissions                      | Check user role in 12d Synergy                                   |
| Empty results but server works | Pagination params wrong                       | Check path-based pagination format                               |
| Create task fails              | Using `/api/v1/tasks` instead of `/api/Tasks` | Remove version prefix for task create/update                     |
| Create job fails               | Missing required attributes                   | Fetch and include required attributes first                      |
| Mixed casing errors            | Assuming wrong field casing                   | Check model spec — JobModel=PascalCase, TaskItemModel=snake_case |
| Delete task fails              | Missing description in path                   | Include URL-encoded description as path parameter                |
| 404 on entity fetch            | Wrong ID format                               | Use `IDString` from EntityID, not raw `_id`                      |
