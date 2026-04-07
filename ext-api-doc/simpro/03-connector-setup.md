---
api_name: 'simPRO'
connector_id: 'simpro'
auth_type: 'oauth2'
tier: 'premium'
category: 'field-service-management'
integration_path: 'hybrid'
---

# simPRO -- Connector & Integration Setup

> Build instructions for integrating simPRO into Numa. This document provides
> code scaffolding, registry configuration, and a deployment checklist.
>
> **Prerequisites:** Read the completed investigation questionnaire and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first.
>
> **All code in this file is [TEMPLATE -- verify against current Numa codebase].**

---

## Integration Type

**Selected path:** Hybrid (Data Connector for browsing jobs/quotes/customers + Direct API for mutations)

| Component                | Required? | Notes                                        |
| ------------------------ | --------- | -------------------------------------------- |
| Connector Registry entry | Yes       | OAuth2 connector for browse/read access      |
| Admin setup wizard       | Yes       | Requires build URL + OAuth app credentials   |
| Backend provider class   | Yes       | Maps simPRO resources to connector interface |
| Workspace agent prompt   | Yes       | 01-llm-api-rules.md + companion files        |
| Feature flag             | Yes       | `SIMPRO_CONNECTOR`                           |
| i18n keys                | Yes       | Display name, description, setup labels      |

---

## 1. Connector Registry Entry

> File: `numa-frontend/src/Config/connectorRegistry.ts`
> [TEMPLATE -- verify against current Numa codebase]

```typescript
{
  id: 'simpro',
  displayName: 'simPRO',
  icon: '/icons/connectors/simpro.svg',
  description: 'Field service management for trade businesses',
  category: 'field-service-management',
  authType: 'oauth2',
  oauthConfig: {
    authorizationUrl: 'https://auth.simpro.co/oauth/authorize',
    tokenUrl: 'https://auth.simpro.co/oauth/token',
    scopes: [],  // [UNKNOWN -- scopes not publicly enumerated; discover during testing]
    pkce: false,  // [UNKNOWN -- PKCE requirement not confirmed]
  },
  credentialFields: [
    {
      name: 'buildUrl',
      label: 'simPRO Build URL',
      type: 'text',
      required: true,
      helpText: 'Your simPRO URL (e.g., yourcompany.simprosuite.com)',
      helpUrl: 'https://helpguide.simprogroup.com/Content/Service-and-Enterprise/API-FAQs.htm',
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
  },
  tier: 'premium',
}
```

**Notes:**

- The `buildUrl` credential field is needed because simPRO's API is per-tenant (`{build}.simprosuite.com`) [DOCUMENTED]
- OAuth scopes are [UNKNOWN] -- test with the simPRO developer portal to determine required scopes
- Auth URLs use `auth.simpro.co` (centralized) [CONFIRMED -- SDK code]
- Access token lifetime: 1 hour; refresh token: 14 days, single-use [CONFIRMED -- forum]

---

## 2. Backend Provider Class

> File: `lib/oauth-providers/simpro_provider.py`
> [TEMPLATE -- verify against current Numa codebase]

```python
"""simPRO connector provider implementation."""

from typing import Any

from .base_provider import OAuthProvider, FileMetadata, FileListResult


class SimproProvider(OAuthProvider):
    """simPRO data connector.

    Auth type: OAuth 2.0
    Base URL: https://{build}.simprosuite.com/api/v1.0/

    Note: Base URL is per-tenant. The build URL is stored in company credentials
    as 'buildUrl'. Token lifetime: 1hr access, 14-day single-use refresh.
    """

    PROVIDER_ID = "simpro"
    API_VERSION = "v1.0"

    # simPRO rate limit: 10 req/sec per build, shared across all consumers
    RATE_LIMIT_PER_SECOND = 10
    RATE_LIMIT_THRESHOLD = 0.8  # Pause at 80% (8 req/sec) per Laravel package

    def __init__(self, credentials: dict[str, Any]):
        super().__init__(credentials)
        build_url = credentials.get("buildUrl", "").rstrip("/")
        if not build_url.startswith("https://"):
            build_url = f"https://{build_url}"
        self.base_url = f"{build_url}/api/{self.API_VERSION}"
        # Default companyID=0 for single-company builds [DOCUMENTED]
        self.company_id = credentials.get("companyId", 0)

    def _resource_url(self, resource: str) -> str:
        """Build a full resource URL."""
        return f"{self.base_url}/companies/{self.company_id}/{resource}/"

    async def list_files(
        self,
        path: str = "/",
        page_size: int = 100,
        cursor: str | None = None,
    ) -> FileListResult:
        """List simPRO resources at the given path.

        Path mapping:
          /           -> list of resource types (jobs, quotes, customers, etc.)
          /jobs       -> GET /companies/{cid}/jobs/?pageSize={page_size}&page={cursor}
          /quotes     -> GET /companies/{cid}/quotes/?pageSize={page_size}&page={cursor}
          /customers  -> GET /companies/{cid}/customers/companies/?pageSize={page_size}&page={cursor}
          /individuals -> GET /companies/{cid}/customers/individuals/?pageSize={page_size}&page={cursor}
          /schedules  -> GET /companies/{cid}/schedules/?pageSize={page_size}&page={cursor}
          /invoices   -> GET /companies/{cid}/customerInvoices/?pageSize={page_size}&page={cursor}
          /employees  -> GET /companies/{cid}/employees/?pageSize={page_size}&page={cursor}
          /contacts   -> GET /companies/{cid}/contacts/?pageSize={page_size}&page={cursor}
          /leads      -> GET /companies/{cid}/leads/?pageSize={page_size}&page={cursor}
          /catalogs   -> GET /companies/{cid}/catalogs/?pageSize={page_size}&page={cursor}

        Pagination: page-number based. Cursor = page number as string.
        Response body is a JSON array. Pagination in headers:
          Result-Total, Result-Pages, Result-Count, Link
        Max pageSize = 250. Default = 30.
        """
        # TODO: Implement -- map path segments to API resource endpoints
        # Use page_size (max 250) and cursor (page number, default "1")
        # Read Result-Total, Result-Pages, Result-Count from response headers
        # Parse Link header for next page URL; no "rel=next" means last page
        raise NotImplementedError

    async def download_file(self, file_id: str) -> bytes:
        """Download a simPRO resource record as JSON.

        file_id format: "{resource_type}/{id}" (e.g., "jobs/123")
        Maps to: GET /companies/{cid}/{resource_type}/{id}
        """
        # TODO: Implement -- parse resource type and ID from file_id
        # Return JSON bytes of the full record
        raise NotImplementedError

    async def search_files(
        self,
        query: str,
        page_size: int = 100,
        cursor: str | None = None,
    ) -> FileListResult:
        """Search simPRO resources.

        simPRO supports field-value filters with comparison operators:
          gt(), lt(), ge(), le(), ne(), between(), % wildcard
        Example: ?GivenName=Rose%&FamilyName=A%
        Example: ?DateIssued=gt(2026-01-01)

        No global search endpoint exists. Search per-resource with field filters.
        Consider searching across jobs, quotes, and customers.
        """
        # TODO: Implement -- parse query to field/value filters
        # Map to columns/orderby/field-value query parameters
        # Note: No global search endpoint; must search per-resource
        raise NotImplementedError

    async def get_file_metadata(self, file_id: str) -> FileMetadata:
        """Get metadata for a simPRO resource record.

        file_id format: "{resource_type}/{id}" (e.g., "jobs/123")
        Maps to: GET /companies/{cid}/{resource_type}/{id}?columns=ID,Status,DateIssued,Customer
        """
        # TODO: Implement -- fetch record with minimal columns
        # Map to FileMetadata (name, type, modified_at, size, etc.)
        raise NotImplementedError
```

---

## 3. Registration in **init**.py

> File: `lib/oauth-providers/__init__.py`
> [TEMPLATE -- verify against current Numa codebase]

Add to the provider imports and registry:

```python
from .simpro_provider import SimproProvider

PROVIDER_REGISTRY = {
    # ... existing providers ...
    "simpro": SimproProvider,
}
```

---

## 4. Integration Prompt Deployment

> The workspace agent prompt files must be deployed so the workspace agent can access
> them when the connector is active.

**Prompt files to deploy:**

- `01-llm-api-rules.md` (main rules, 234 lines)
- `01a-domain-model-reference.md` (entity reference with SyncHub-confirmed fields)
- `01b-query-patterns.md` (read operations with filter operators)
- `01c-mutation-patterns.md` (write operations with PATCH behavior)
- `01d-event-and-error-handling.md` (events, webhook payloads, error format)

**Deployment location:** These files are loaded into workspace agent context based on
the active connector configuration. The exact mechanism depends on the current
workspace agent skill/plugin system.

---

## 5. i18n Keys

> File: `numa-frontend/src/i18n/en.json` (and other locale files)
> [TEMPLATE -- verify against current Numa codebase]

```json
{
  "connectors.simpro.displayName": "simPRO",
  "connectors.simpro.description": "Connect to your simPRO field service management platform",
  "connectors.simpro.setupTitle": "Connect simPRO",
  "connectors.simpro.setupDescription": "Enter your simPRO build URL and authorize access via OAuth",
  "connectors.simpro.fields.buildUrl.label": "simPRO Build URL",
  "connectors.simpro.fields.buildUrl.help": "Your simPRO URL, e.g., yourcompany.simprosuite.com. Found in your browser address bar when logged into simPRO.",
  "connectors.simpro.connected": "Connected to simPRO",
  "connectors.simpro.disconnected": "Disconnected from simPRO"
}
```

---

## 6. Deployment Checklist

> Complete this checklist before considering the integration done.

### Code

- [ ] Registry entry added to `connectorRegistry.ts`
- [ ] Connector icon added (SVG, simPRO brand colors: blue #0065BD)
- [ ] Admin wizard component handles buildUrl + OAuth flow
- [ ] Backend provider class implemented with all required methods
- [ ] Provider registered in `__init__.py`
- [ ] Vault integration patterns added (`oauth-client-simpro` and/or `connector-simpro`)
- [ ] Provider listed in `handleListProviders`
- [ ] Provider config lookup added to `getProviderConfig`
- [ ] i18n keys added for all locales

### Auth Flows

- [ ] Admin setup wizard saves build URL and OAuth client credentials to vault
- [ ] User connect flow works (OAuth redirect to auth.simpro.co/oauth/authorize)
- [ ] Token refresh works (`grant_type=refresh_token`; remember: refresh tokens are single-use, 14-day lifetime)
- [ ] User disconnect flow deletes user secret only
- [ ] Admin disconnect flow deletes company secret correctly
- [ ] Handle per-tenant API base URL (build URL from credentials)

### Functionality

- [ ] Files Remote shows simPRO connector with correct icon
- [ ] Browse: can list jobs, quotes, customers, schedules, invoices, leads, contacts
- [ ] Search: field-value filters work (including `gt()`, `lt()`, `between()`, `%` wildcard)
- [ ] Download: can fetch single record as JSON
- [ ] File metadata displays correctly (job status, dates, customer name)
- [ ] Caching works (5-minute TTL for list queries)
- [ ] Pagination handles all pages (follow Link header or increment page param)
- [ ] Rate limiting: respects 10 req/sec budget (use 80% threshold)

### Workspace Agent

- [ ] Integration prompt deployed (01-llm-api-rules.md + companions)
- [ ] Agent can list/browse resources via connector
- [ ] Agent can search with filter parameters and comparison operators
- [ ] Agent can retrieve individual record details
- [ ] Agent handles rate limits gracefully (10 req/sec)
- [ ] Agent correctly uses companyID=0 for single-company builds
- [ ] Agent verifies PATCH operations with subsequent GET (due to 204 silent rejection bug)

### CI/CD

- [ ] Lambda added to CI matrix in `.gitlab-ci.yml`
- [ ] Lambda added to `package-all.sh`
- [ ] Build succeeds in pipeline

---

## 7. Testing Plan

### Manual Testing Sequence

1. **Admin setup:** Create simPRO connector via admin wizard (provide build URL + OAuth credentials)
2. **User connect:** Connect as a regular user via OAuth flow
3. **Browse:** Open Files Remote, verify simPRO connector appears, browse jobs/quotes/customers
4. **Filter:** Test field-value filters (`?CompanyName=Acme%`), comparison operators (`?DateIssued=gt(2026-01-01)`), orderby
5. **Download:** View a single job's full detail
6. **Workspace chat:** Ask the agent "List my recent simPRO jobs"
7. **Workspace search:** Ask the agent "Show me all jobs in Progress stage"
8. **Workspace filter:** Ask the agent "Show invoices from this quarter" (test between() operator)
9. **Workspace create:** Ask the agent "Create a new service job for customer ID 45"
10. **Status update verification:** Ask agent to update a job status, verify it performs GET after PATCH
11. **User disconnect:** Disconnect, verify access is revoked
12. **Admin disconnect:** Remove connector config, verify cleanup

### Edge Cases

- [ ] Empty job list (new simPRO build with no data)
- [ ] Multi-company build (companyID != 0; verify GET /companies/ returns multiple)
- [ ] Expired access token handling (test refresh flow; remember single-use refresh tokens)
- [ ] Rate limit handling (rapid sequential requests hitting 10 req/sec)
- [ ] Large datasets (800+ jobs requiring multiple pages)
- [ ] Special characters in job references and customer names
- [ ] Network timeout handling
- [ ] Concurrent access by multiple users on same build (shared rate limit)
- [ ] Status hierarchy enforcement (attempt invalid status transition; verify 204 silent rejection)
- [ ] Custom field PATCH on new job (apply separately after POST)
- [ ] Filter gotchas: ID not searchable on some endpoints; CompanyName vs Name

### simPRO-Specific Validation

- [ ] Verify companyID=0 works for test build
- [ ] Verify pagination headers (Result-Total, Result-Pages, Result-Count, Link) are correctly parsed
- [ ] Verify If-Modified-Since filtering returns only changed records
- [ ] Verify columns parameter returns only specified fields
- [ ] Verify comparison operators work (`gt()`, `lt()`, `between()`, `ne()`, `%`)
- [ ] Confirm error response format matches: `{status, url, header, data: {errors: [{path, message, value}]}}`
- [ ] Confirm webhook registration works via API
- [ ] Test webhook delivery; verify payload matches confirmed format (ID, build, name, action, reference, date_triggered, description)

---

## 8. Key Integration Risks

| Risk                              | Impact                                                             | Mitigation                                                                  |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| OAuth scopes unknown              | May get insufficient permissions                                   | Test with simPRO developer portal; start with broadest available scope      |
| PATCH 204 silent rejection        | Status updates may appear to succeed but do nothing                | Always verify PATCH with subsequent GET; document in agent rules            |
| Daily rate limit unknown          | May exhaust limit with heavy usage                                 | Implement request budgeting (80% threshold); cache aggressively             |
| Per-tenant base URL               | Must handle variable base URLs                                     | Store build URL in credentials; construct base URL dynamically              |
| Single-use refresh tokens         | Token refresh failure loses access                                 | Store new refresh token immediately on each refresh; handle race conditions |
| Webhook fires on silent rejection | Quote status webhook triggers even when PATCH is silently rejected | Cross-reference webhook data with GET to confirm actual state               |

---

_Generated from the investigation questionnaire. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _Investigation questionnaire for detailed API research_
