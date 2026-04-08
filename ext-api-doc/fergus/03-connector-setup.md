---
api_name: 'Fergus'
connector_id: 'fergus'
auth_type: 'token'
tier: 'standard'
category: 'project-management'
integration_path: 'hybrid'
updated_date: '2026-04-04'
update_source: 'live API testing'
---

# Fergus -- Connector & Integration Setup

> Build instructions for integrating Fergus into Numa. This document provides
> code scaffolding, registry configuration, and a deployment checklist.
> **Updated 2026-04-04 with corrections from live API testing.**
>
> **Prerequisites:** Read the completed investigation questionnaire and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first.

---

## Integration Type

**Selected path:** Hybrid (Data Connector + Direct API)

| Component                | Required? | Notes                                    |
| ------------------------ | --------- | ---------------------------------------- |
| Connector Registry entry | Yes       | For Files Remote browsing                |
| Admin setup wizard       | Yes       | PAT token entry                          |
| Backend provider class   | Yes       | Python provider for list/search/download |
| Workspace agent prompt   | Yes       | 01-llm-api-rules.md and companions       |
| Feature flag             | Yes       | `FERGUS_CONNECTOR`                       |
| i18n keys                | Yes       | Display name, description, setup strings |

---

## 1. Connector Registry Entry [TEMPLATE]

> File: `numa-frontend/src/Config/connectorRegistry.ts`

```typescript
{
  id: 'fergus',
  displayName: 'Fergus',
  icon: '/icons/connectors/fergus.svg',
  description: 'Job management for trade businesses',
  category: 'project-management',
  authType: 'token',
  credentialFields: [
    {
      name: 'apiToken',
      label: 'Personal Access Token',
      type: 'password',
      required: true,
      helpText: 'Generate a PAT from your Fergus account settings under Integrations.',
      helpUrl: 'https://help.fergus.com/en/articles/4278695-fergus-integration-centre',
    },
  ],
  cachingPolicy: {
    enabled: true,
    ttlMinutes: 5,
    cacheableOperations: ['list', 'search', 'metadata'],
  },
  apiReference: {
    capabilities: [
      'browse',
      'search',
      'download',
    ],
    specialCapabilities: [
      { name: 'jobs', description: 'Browse and search jobs, view financial summaries' },
      { name: 'customers', description: 'Browse and search customers' },
      { name: 'sites', description: 'Browse and search sites' },
      { name: 'invoices', description: 'Browse invoices, filter by customer/job/date' },
      { name: 'timeEntries', description: 'Browse time entries with date filtering' },
      { name: 'calendar', description: 'Browse scheduled events by date range' },
      { name: 'notes', description: 'Browse notes attached to entities' },
      { name: 'company', description: 'View company settings, tax config' },
    ],
  },
  tier: 'standard',
}
```

---

## 2. Backend Provider Class [TEMPLATE]

> File: `lib/oauth-providers/fergus_provider.py`

```python
"""Fergus connector provider implementation."""

from typing import Any

from .base_provider import OAuthProvider, FileMetadata, FileListResult


class FergusProvider(OAuthProvider):
    """Fergus data connector.

    Auth type: token (Personal Access Token)
    Base URL: https://api.fergus.com
    Rate limit: 100 req/min per company [CONFIRMED -- live API test 2026-04-04]

    Key gotchas from live testing:
    - Response envelope: {"result": "success", "data": ..., "paging": ...}
    - Pagination: pageCursor (integer, 0-based), paging.links.next is null on last page
    - Field casing: camelCase throughout
    - ID format: integer (e.g., 9778208, 20909314)
    - HATEOAS links in every resource
    - /quotes and /stockOnHand standalone endpoints do NOT exist (404)
    - Notes sort field uses snake_case: sortField=created_at
    - DELETE requests must NOT include Content-Type header
    """

    PROVIDER_ID = "fergus"
    BASE_URL = "https://api.fergus.com"

    # Top-level navigable resource types
    # NOTE: /quotes and /stockOnHand are NOT available as standalone endpoints
    RESOURCE_TYPES = {
        "jobs": {"endpoint": "/jobs", "label": "Jobs", "searchable": True},
        "customers": {"endpoint": "/customers", "label": "Customers", "searchable": True},
        "sites": {"endpoint": "/sites", "label": "Sites", "searchable": True},
        "quotes": {"endpoint": "/jobs/quotes", "label": "Quotes", "searchable": False},
        "invoices": {"endpoint": "/customerInvoices", "label": "Invoices", "searchable": False},
        "timeEntries": {"endpoint": "/timeEntries", "label": "Time Entries", "searchable": True},
        "enquiries": {"endpoint": "/enquiries", "label": "Enquiries", "searchable": True},
        "notes": {"endpoint": "/notes", "label": "Notes", "searchable": False},
        "users": {"endpoint": "/users", "label": "Users", "searchable": False},
        "calendarEvents": {"endpoint": "/calendarEvents", "label": "Calendar Events", "searchable": False},
        "pricingTiers": {"endpoint": "/pricingTiers", "label": "Pricing Tiers", "searchable": False},
        "favourites": {"endpoint": "/favourites", "label": "Favourites", "searchable": False},
    }

    def __init__(self, credentials: dict[str, Any]):
        super().__init__(credentials)
        self._token = credentials.get("apiToken", "")
        self._headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    async def list_files(
        self,
        path: str = "/",
        page_size: int = 20,
        cursor: str | None = None,
    ) -> FileListResult:
        """List Fergus resources at the given path.

        Path mapping:
          "/" -> list resource types (jobs, customers, sites, etc.)
          "/jobs" -> GET /jobs?pageSize=20&pageCursor={cursor}
          "/jobs/{id}" -> GET /jobs/{id} (single resource detail)
          "/customers" -> GET /customers?pageSize=20&pageCursor={cursor}
          etc.

        Maps to: GET /{resource}?pageSize={page_size}&pageCursor={cursor}

        Response envelope: {"result": "success", "data": [...], "paging": {"perPage": N, "pageCount": N, "links": {"self": "...", "previous": null, "next": null}}}
        Last page: paging.links.next is null
        """
        # TODO: Implement - parse path, route to correct endpoint
        # Handle root path "/" by returning list of resource type folders
        # Handle resource path "/jobs" by calling GET /jobs with pagination
        # Handle detail path "/jobs/123" by calling GET /jobs/123
        # pageCursor is 0-based integer, NOT string
        raise NotImplementedError

    async def download_file(self, file_id: str) -> bytes:
        """Download a Fergus resource as JSON.

        file_id format: "{resourceType}/{id}" e.g. "jobs/20909314"

        Maps to: GET /{resourceType}/{id}
        Response: {"result": "success", "data": {...}}
        """
        # TODO: Implement - parse file_id, call GET endpoint, return JSON bytes
        raise NotImplementedError

    async def search_files(
        self,
        query: str,
        page_size: int = 20,
        cursor: str | None = None,
    ) -> FileListResult:
        """Search Fergus resources.

        Searches across jobs, customers, and sites using filterSearchText.

        Maps to: GET /jobs?filterSearchText={query}, GET /customers?filterSearchText={query}, etc.
        """
        # TODO: Implement - search across multiple resource types
        # Combine results from jobs, customers, sites searches
        # Use filterSearchText parameter for substring matching
        raise NotImplementedError

    async def get_file_metadata(self, file_id: str) -> FileMetadata:
        """Get metadata for a Fergus resource.

        file_id format: "{resourceType}/{id}" e.g. "customers/9778208"

        Maps to: GET /{resourceType}/{id}
        """
        # TODO: Implement - parse file_id, call GET endpoint, extract metadata
        raise NotImplementedError
```

---

## 3. Registration in **init**.py [TEMPLATE]

> File: `lib/oauth-providers/__init__.py`

Add to the provider imports and registry:

```python
from .fergus_provider import FergusProvider

PROVIDER_REGISTRY = {
    # ... existing providers ...
    "fergus": FergusProvider,
}
```

---

## 4. Integration Prompt Deployment

> The workspace agent prompt file (`01-llm-api-rules.md` and companions) must be
> deployed so the workspace agent can access it when the connector is active.

**Prompt files to deploy:**

- `01-llm-api-rules.md` (main rules, <300 lines)
- `01a-domain-model-reference.md` (entity reference)
- `01b-query-patterns.md` (read operations)
- `01c-mutation-patterns.md` (write operations)
- `01d-event-and-error-handling.md` (events & errors)

**All files updated 2026-04-04 with live API test corrections.**

**Deployment location:** These files are loaded into workspace agent context based on
the active connector configuration. The exact mechanism depends on the current
workspace agent skill/plugin system.

---

## 5. i18n Keys [TEMPLATE]

> File: `numa-frontend/src/i18n/en.json` (and other locale files)

```json
{
  "connectors.fergus.displayName": "Fergus",
  "connectors.fergus.description": "Job management for trade businesses (NZ/AU/UK)",
  "connectors.fergus.setupTitle": "Connect Fergus",
  "connectors.fergus.setupDescription": "Connect your Fergus account to browse jobs, customers, quotes, and more. You'll need a Personal Access Token from your Fergus settings.",
  "connectors.fergus.fields.apiToken.label": "Personal Access Token",
  "connectors.fergus.fields.apiToken.help": "Generate a PAT from your Fergus account settings under Integrations > API.",
  "connectors.fergus.connected": "Connected to Fergus",
  "connectors.fergus.disconnected": "Disconnected from Fergus"
}
```

---

## 6. Deployment Checklist

> Complete this checklist before considering the integration done.
> Reference: [Connector Framework Documentation](../../documentation/connectors/README.md)

### Code

- [ ] Registry entry added to `connectorRegistry.ts`
- [ ] Connector icon added (SVG, Fergus logo or trades icon)
- [ ] Admin wizard component created or extended for token entry
- [ ] Backend provider class implemented with all required methods
- [ ] Provider registered in `__init__.py`
- [ ] Vault integration patterns added (`connector-fergus-{companyId}`)
- [ ] Provider listed in `handleListProviders`
- [ ] Provider config lookup added to `getProviderConfig`
- [ ] i18n keys added for all locales

### Auth Flows

- [ ] Admin setup wizard saves PAT to vault
- [ ] User connect flow works (token entry validates against GET /version)
- [ ] User disconnect flow deletes user secret only
- [ ] Admin disconnect flow deletes company secret correctly
- [ ] Token validation: test GET /version on save, show error if 401/403

### Functionality

- [ ] Files Remote shows Fergus connector with correct icon
- [ ] Browse root shows resource types (Jobs, Customers, Sites, etc.)
- [ ] Browse resource type lists items with pagination
- [ ] Browse item shows detail view
- [ ] Search works across jobs, customers, sites
- [ ] Download returns JSON representation of resource
- [ ] Caching works (5-minute TTL for list/search operations)
- [ ] Rate limit headers are respected (pause if x-ratelimit-remaining < 5)

### Workspace Agent

- [ ] Integration prompt files deployed (01 series)
- [ ] Agent can list jobs/customers/sites via files tool
- [ ] Agent can search via files tool
- [ ] Agent can view job/customer/quote details
- [ ] Agent can create jobs (with valid jobType: Quote/Estimate/Charge Up)
- [ ] Agent can create customers (customerFullName + mainContact required)
- [ ] Agent can create sites (defaultContact + siteAddress required)
- [ ] Agent handles 303 redirect on duplicate customer/site gracefully
- [ ] Agent respects rate limits (monitors x-ratelimit-remaining)
- [ ] Agent does NOT use /quotes or /stockOnHand standalone endpoints
- [ ] Agent omits Content-Type header on DELETE requests

### CI/CD

- [ ] Lambda added to CI matrix in `.gitlab-ci.yml`
- [ ] Lambda added to `package-all.sh`
- [ ] Build succeeds in pipeline

---

## 7. Testing Plan

### Manual Testing Sequence

1. **Admin setup:** Enter Fergus PAT via admin wizard, verify connection with GET /version
2. **Browse root:** Open Files Remote, verify Fergus connector shows resource type folders
3. **Browse jobs:** Navigate into Jobs folder, verify job listing with pagination
4. **Browse customer:** Navigate to a specific customer, verify detail view
5. **Search:** Search for a known customer name, verify results from multiple resource types
6. **Download:** Download a job as JSON, verify complete data
7. **Workspace list:** Ask agent "List my active jobs in Fergus"
8. **Workspace search:** Ask agent "Find customer Smith in Fergus"
9. **Workspace create customer:** Ask agent "Create a new customer in Fergus called Test Corp"
10. **Workspace create site:** Verify agent includes defaultContact + siteAddress
11. **Workspace create job:** Verify agent uses valid jobType (Quote/Estimate/Charge Up)
12. **Rate limit:** Make rapid requests, verify 429 handling and retry behavior
13. **Disconnect:** Remove connector, verify vault cleanup

### Edge Cases

- [ ] Empty result sets (no jobs, no customers)
- [ ] Pagination boundary (exactly pageSize items)
- [ ] paging.links.next is null on last page
- [ ] 303 redirect on duplicate customer/site create
- [ ] Expired PAT handling (401 -> clear error message)
- [ ] 403 response (minimal format: just `{"message": "Forbidden"}`)
- [ ] Rate limit handling (429 -> wait and retry)
- [ ] Network timeout handling
- [ ] Invalid job ID (404)
- [ ] Invalid jobType (expect error: "must be one of Quote, Estimate, or Charge Up")
- [ ] Missing defaultContact on site create (expect 400)
- [ ] Missing siteAddress on site PATCH (expect 400)
- [ ] DELETE with Content-Type header (expect error)
- [ ] Calendar event with recurrence
- [ ] Quote with multiple sections and line items
- [ ] Special characters in customer names / descriptions
- [ ] Large pricebook search results

### Fergus-Specific Test Scenarios

- [ ] Create full workflow: customer -> site -> job (verify status: Draft then To Price)
- [ ] Put a job on hold and resume it
- [ ] Search pricebook items and add stock to a job phase
- [ ] Create a calendar event linked to a job phase
- [ ] Add notes to different entity types (job, customer, quote)
- [ ] View financial summary for a job
- [ ] List overdue invoices
- [ ] View time entries for a date range
- [ ] View company info (verify tax: rate 15, type GST for NZ)
- [ ] Sort notes (use sortField=created_at, NOT createdAt)

---

## 8. OAuth Alternative (Future)

If OAuth 2.0 integration is needed (for multi-user SSO rather than shared PAT), the registry entry would change to:

```typescript
{
  // ... same base config ...
  authType: 'oauth2',
  oauthConfig: {
    authorizationUrl: 'https://auth.fergus.com/oauth2/authorize',
    tokenUrl: 'https://auth.fergus.com/oauth2/token',
    scopes: [],  // None documented
    pkce: false,  // Not confirmed
  },
}
```

This would require:

- Client ID and client secret from Fergus developer registration
- Redirect URI configuration
- Token refresh handling using the same token URL
- Contact `integrations@fergus.com` for OAuth client credentials

---

_Generated from the investigation questionnaire. Updated 2026-04-04 with live API test corrections._
_See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _Investigation questionnaire for detailed API research_
