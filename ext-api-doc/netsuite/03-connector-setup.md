---
api_name: 'NetSuite AI Connector Service (MCP)'
connector_id: 'netsuite'
auth_type: 'oauth2'
tier: 'premium'
category: 'erp'
integration_path: 'data-connector'
---

# NetSuite MCP -- Connector & Integration Setup

> **[TEMPLATE -- verify against current Numa codebase before implementation]**
> **Auth type:** OAuth 2.0 Authorization Code with PKCE (public client)
> **Integration path:** Data Connector (OAuth2) + Direct MCP API
>
> **Prerequisites:** Read the completed investigation questionnaire and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first.

---

## Overview

NetSuite MCP uses per-account OAuth 2.0 with PKCE. Unlike standard SaaS connectors, each NetSuite account has its own OAuth endpoints and MCP URL. The account ID is embedded in the hostname.

This means the connector must:

1. Store the account ID as part of the company/admin configuration
2. Dynamically construct OAuth URLs and MCP endpoint URLs using the account ID
3. Handle PKCE (public client -- no client secret)
4. Make JSON-RPC 2.0 calls instead of standard REST calls
5. Handle the `data` parameter as stringified JSON for create/update operations

---

## Prerequisites

Before configuring the Numa connector, the customer must:

- [ ] Have an active NetSuite account with a known Account ID (e.g., `5721181`)
- [ ] Have OAuth 2.0, Server SuiteScript, and REST Web Services features enabled
- [ ] Create a **custom role** (NOT Administrator) with these permissions:
  - MCP Server Connection
  - OAuth 2.0 Access Tokens
  - Any additional permissions required for the data they want to expose
- [ ] Have the **MCP Standard Tools SuiteApp** installed (usually bundled by default)
- [ ] Create an **Integration Record** with:
  - "NetSuite AI Connector Service" scope enabled
  - "Public Client" checked (no client secret)
  - Redirect URI set to Numa's OAuth callback URL
- [ ] Assign the custom role to the user who will authorize the connection

---

## Integration Type

**Selected path:** Data Connector (OAuth2) -- custom MCP protocol

| Component                | Required? | Notes                                               |
| ------------------------ | --------- | --------------------------------------------------- |
| Connector Registry entry | Yes       | Custom ERP category, per-account URL config         |
| Admin setup wizard       | Yes       | Must collect Account ID and Client ID               |
| Backend provider class   | Yes       | Custom MCP client (JSON-RPC 2.0), not standard REST |
| Workspace agent prompt   | Yes       | 01-llm-api-rules.md and companions                  |
| Feature flag             | Yes       | `NETSUITE_CONNECTOR` or similar                     |
| i18n keys                | Yes       | Standard connector translations                     |

---

## 1. Connector Registry Entry

**[TEMPLATE -- verify field names against current `connectorRegistry.ts`]**

```typescript
// In numa-frontend/src/Config/connectorRegistry.ts

{
  id: 'netsuite',
  displayName: 'NetSuite',
  description: 'Connect to Oracle NetSuite ERP for customers, orders, invoices, inventory, and financial reports',
  icon: 'netsuite', // requires icon asset -- use NetSuite/Oracle N logo
  category: 'erp',
  authType: 'oauth2',
  credentialFields: [
    {
      key: 'accountId',
      label: 'NetSuite Account ID',
      type: 'text',
      placeholder: '5721181',
      required: true,
      helpText: 'Your NetSuite account ID. Found in Setup > Company > Company Information, or in your NetSuite URL.',
    },
    {
      key: 'clientId',
      label: 'Integration Client ID',
      type: 'text',
      placeholder: '',
      required: true,
      helpText: 'The Client ID from the Integration Record in NetSuite (Setup > Integration > Manage Integrations).',
    },
  ],
  oauthConfig: {
    // URLs are dynamically constructed from accountId
    authorizationUrl: 'https://{accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/authorize',
    tokenUrl: 'https://{accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token',
    scopes: ['mcp'],
    pkce: true,
    publicClient: true, // no client_secret
  },
  cachingPolicy: {
    enabled: true,
    ttlMinutes: 60,
    cacheableOperations: ['metadata'], // Cache ns_getRecordTypeMetadata and ns_getSuiteQLMetadata
  },
  apiReference: {
    capabilities: [
      'query',     // SuiteQL queries
      'read',      // Get records by ID
      'create',    // Create records
      'update',    // Update records
      'search',    // Saved searches
      'report',    // Financial reports
    ],
    specialCapabilities: [
      { name: 'suiteql', description: 'Oracle-dialect SQL queries against all NetSuite data' },
      { name: 'savedSearch', description: 'Execute pre-built NetSuite saved searches' },
      { name: 'reports', description: 'Run financial and operational reports' },
    ],
  },
  tier: 'premium',
}
```

**Key difference from standard connectors:** The OAuth URLs contain a dynamic `{accountId}` placeholder. The admin wizard must collect the Account ID first, then construct the OAuth URLs at runtime.

---

## 2. Backend Provider Class

**[TEMPLATE -- verify base class interface against current codebase]**

> File: `lib/oauth-providers/netsuite_provider.py`

```python
"""NetSuite AI Connector Service (MCP) provider implementation."""

import json
from typing import Any

from .base_provider import OAuthProvider


class NetSuiteProvider(OAuthProvider):
    """NetSuite MCP data connector.

    Auth type: OAuth 2.0 Authorization Code + PKCE (public client)
    Protocol: MCP (JSON-RPC 2.0) over HTTPS
    Base URL: https://{account_id}.suitetalk.api.netsuite.com
    """

    PROVIDER_ID = "netsuite"
    MCP_PATH = "/services/mcp/v1/suiteapp/com.netsuite.mcpstandardtools"

    def __init__(self, credentials: dict[str, Any]):
        super().__init__(credentials)
        self.account_id = credentials.get("accountId", "")
        self.base_url = f"https://{self.account_id}.suitetalk.api.netsuite.com"
        self.mcp_url = f"{self.base_url}{self.MCP_PATH}"

    def _build_auth_url(self) -> str:
        """Construct the per-account authorization URL."""
        return f"{self.base_url}/services/rest/auth/oauth2/v1/authorize"

    def _build_token_url(self) -> str:
        """Construct the per-account token URL."""
        return f"{self.base_url}/services/rest/auth/oauth2/v1/token"

    async def _mcp_call(self, tool_name: str, arguments: dict[str, Any]) -> dict:
        """Execute an MCP tool call via JSON-RPC 2.0.

        All MCP calls go through this method.
        """
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }
        # TODO: Implement HTTP POST to self.mcp_url with Bearer token
        # Headers: Authorization: Bearer {access_token}, Content-Type: application/json
        raise NotImplementedError

    async def get_record_type_metadata(self, record_type: str | None = None) -> dict:
        """Get metadata for record types.

        Maps to: ns_getRecordTypeMetadata
        """
        args: dict[str, Any] = {}
        if record_type:
            args["recordType"] = record_type
        return await self._mcp_call("ns_getRecordTypeMetadata", args)

    async def get_record(
        self, record_type: str, record_id: str, fields: str | None = None
    ) -> dict:
        """Get a single record by type and ID.

        Maps to: ns_getRecord
        """
        args: dict[str, Any] = {"recordType": record_type, "recordId": record_id}
        if fields:
            args["fields"] = fields
        return await self._mcp_call("ns_getRecord", args)

    async def create_record(self, record_type: str, data: dict[str, Any]) -> dict:
        """Create a new record.

        Maps to: ns_createRecord
        Note: data is automatically stringified.
        """
        return await self._mcp_call("ns_createRecord", {
            "recordType": record_type,
            "data": json.dumps(data),
        })

    async def update_record(
        self, record_type: str, record_id: str, data: dict[str, Any]
    ) -> dict:
        """Update an existing record.

        Maps to: ns_updateRecord
        Note: data is automatically stringified.
        """
        return await self._mcp_call("ns_updateRecord", {
            "recordType": record_type,
            "recordId": record_id,
            "data": json.dumps(data),
        })

    async def run_suiteql(
        self, query: str, description: str, page_size: int | None = None
    ) -> dict:
        """Execute a SuiteQL query.

        Maps to: ns_runCustomSuiteQL
        """
        args: dict[str, Any] = {"sqlQuery": query, "description": description}
        if page_size:
            args["pageSize"] = page_size
        return await self._mcp_call("ns_runCustomSuiteQL", args)

    async def get_suiteql_metadata(self, record_type: str | None = None) -> dict:
        """Get SuiteQL table/field metadata.

        Maps to: ns_getSuiteQLMetadata
        """
        args: dict[str, Any] = {}
        if record_type:
            args["recordType"] = record_type
        return await self._mcp_call("ns_getSuiteQLMetadata", args)

    async def list_saved_searches(self, query: str | None = None) -> dict:
        """List saved searches.

        Maps to: ns_listSavedSearches
        """
        args: dict[str, Any] = {}
        if query:
            args["query"] = query
        return await self._mcp_call("ns_listSavedSearches", args)

    async def run_saved_search(
        self,
        search_id: str,
        search_type: str | None = None,
        range_start: int | None = None,
        range_end: int | None = None,
    ) -> dict:
        """Run a saved search.

        Maps to: ns_runSavedSearch
        """
        args: dict[str, Any] = {"searchId": search_id}
        if search_type:
            args["type"] = search_type
        if range_start is not None:
            args["range_start"] = range_start
        if range_end is not None:
            args["range_end"] = range_end
        return await self._mcp_call("ns_runSavedSearch", args)

    async def list_reports(self) -> dict:
        """List all available reports.

        Maps to: ns_listAllReports
        """
        return await self._mcp_call("ns_listAllReports", {})

    async def run_report(
        self,
        report_id: int,
        date_to: str,
        date_from: str | None = None,
        subsidiary_id: int | None = None,
    ) -> dict:
        """Run a report.

        Maps to: ns_runReport
        Prerequisite: Call list_reports first to get valid report IDs.
        """
        args: dict[str, Any] = {"reportId": report_id, "dateTo": date_to}
        if date_from:
            args["dateFrom"] = date_from
        if subsidiary_id is not None:
            args["subsidiaryId"] = subsidiary_id
        return await self._mcp_call("ns_runReport", args)

    async def get_subsidiaries(self) -> dict:
        """Get subsidiaries for report filtering.

        Maps to: ns_getSubsidiaries
        """
        return await self._mcp_call("ns_getSubsidiaries", {})
```

---

## 3. Registration in **init**.py

> File: `lib/oauth-providers/__init__.py`

```python
from .netsuite_provider import NetSuiteProvider

PROVIDER_REGISTRY = {
    # ... existing providers ...
    "netsuite": NetSuiteProvider,
}
```

---

## 4. Dynamic OAuth URL Construction

**This is the key architectural difference from standard connectors.**

The admin wizard must:

1. Collect the Account ID from the admin
2. Construct OAuth URLs at runtime: `https://{accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/authorize`
3. Store the Account ID in the company secret alongside the OAuth tokens
4. Use PKCE flow (no client secret needed)

**Frontend OAuth flow modification:**

```typescript
// When initiating OAuth for NetSuite, construct the auth URL dynamically:
const accountId = companyConfig.accountId; // From admin wizard input
const authUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/authorize`;
const tokenUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

// PKCE flow: generate code_verifier and code_challenge
// scope: 'mcp'
// client_id: from Integration Record
// No client_secret (public client)
```

---

## 5. Integration Prompt Deployment

**Prompt files to deploy:**

- `01-llm-api-rules.md` (main rules, under 300 lines)
- `01a-domain-model-reference.md` (entity reference)
- `01b-query-patterns.md` (SuiteQL, saved searches, reports)
- `01c-mutation-patterns.md` (create/update patterns)
- `01d-event-and-error-handling.md` (errors, rate limits, polling)

**Deployment location:** Workspace agent skill/plugin system. The `01-llm-api-rules.md` is loaded into context when the NetSuite connector is active for a user.

---

## 6. i18n Keys

> File: `numa-frontend/src/i18n/en.json` (and other locale files)

```json
{
  "connectors.netsuite.displayName": "NetSuite",
  "connectors.netsuite.description": "Connect to Oracle NetSuite ERP for customers, orders, invoices, inventory, and financial reports",
  "connectors.netsuite.setupTitle": "Connect NetSuite",
  "connectors.netsuite.setupDescription": "Connect your NetSuite account to query customers, orders, invoices, items, and run financial reports via the AI Connector Service.",
  "connectors.netsuite.fields.accountId.label": "NetSuite Account ID",
  "connectors.netsuite.fields.accountId.help": "Your NetSuite account ID. Found in Setup > Company > Company Information.",
  "connectors.netsuite.fields.clientId.label": "Integration Client ID",
  "connectors.netsuite.fields.clientId.help": "The Client ID from the Integration Record (Setup > Integration > Manage Integrations).",
  "connectors.netsuite.connected": "Connected to NetSuite",
  "connectors.netsuite.disconnected": "Disconnected from NetSuite"
}
```

---

## 7. Deployment Checklist

> Complete this checklist before considering the integration done.

### Code

- [ ] Registry entry added to `connectorRegistry.ts` with dynamic OAuth URL support
- [ ] NetSuite icon asset added (SVG)
- [ ] Admin wizard collects Account ID and Client ID
- [ ] Backend provider class implemented (`netsuite_provider.py`)
- [ ] `_mcp_call` method implemented with HTTP POST, JSON-RPC 2.0, Bearer auth
- [ ] PKCE flow implemented (code_verifier + code_challenge generation)
- [ ] Provider registered in `__init__.py`
- [ ] Vault integration for OAuth tokens (access_token, refresh_token, account_id)
- [ ] Token refresh logic handles per-account token URL
- [ ] i18n keys added for all locales
- [ ] Metadata caching implemented (1hr TTL for record type and SuiteQL metadata)

### Auth Flows

- [ ] Admin setup wizard saves company config (account_id, client_id) to vault
- [ ] OAuth flow constructs per-account authorization URL
- [ ] PKCE challenge is generated and verified
- [ ] Token endpoint uses per-account URL
- [ ] Token refresh works (auto-refreshes before expiry)
- [ ] User disconnect deletes user tokens only
- [ ] Admin disconnect deletes company configuration correctly

### Functionality

- [ ] `ns_getRecordTypeMetadata` returns field schemas
- [ ] `ns_getRecord` retrieves single records
- [ ] `ns_createRecord` creates records with stringified JSON data
- [ ] `ns_updateRecord` updates records with stringified JSON data
- [ ] `ns_runCustomSuiteQL` executes SuiteQL queries
- [ ] `ns_listSavedSearches` and `ns_runSavedSearch` work with pagination
- [ ] `ns_listAllReports` and `ns_runReport` work (including subsidiary filter flow)
- [ ] `ns_getSuiteQLMetadata` returns table schemas
- [ ] `ns_getSubsidiaries` returns subsidiary list
- [ ] Error handling covers 400, 401, 403, 404, 429, 500
- [ ] Rate limiting with exponential backoff on 429

### Workspace Agent

- [ ] Integration prompt (`01-llm-api-rules.md`) deployed to workspace agent
- [ ] Companion files (01a-01d) available as reference
- [ ] Agent can query records via SuiteQL
- [ ] Agent can retrieve individual records
- [ ] Agent can create records (with metadata preflight)
- [ ] Agent can update records
- [ ] Agent can run saved searches
- [ ] Agent can run financial reports

### CI/CD

- [ ] Lambda added to CI matrix in `.gitlab-ci.yml`
- [ ] Lambda added to `package-all.sh`
- [ ] Build succeeds in pipeline

---

## 8. Testing Plan

### Manual Testing Sequence

1. **Admin setup:** Enter Account ID and Client ID in admin wizard
2. **OAuth flow:** Initiate OAuth, verify PKCE flow completes, token stored
3. **Metadata:** Call `ns_getRecordTypeMetadata` -- verify field schemas returned
4. **Read:** Call `ns_getRecord` for a known customer ID
5. **Query:** Run a basic SuiteQL query (`SELECT id, companyname FROM customer WHERE ROWNUM <= 5`)
6. **Saved search:** List saved searches, run one with pagination
7. **Report:** List reports, run one with date range
8. **Create:** Create a test customer record (use sandbox/test account)
9. **Update:** Update the test customer's email
10. **Agent query:** Ask the workspace agent "List the top 5 customers by balance"
11. **Agent create:** Ask the workspace agent to create a customer (confirm with user first)
12. **Token refresh:** Wait for token expiry, verify auto-refresh works
13. **Disconnect:** Disconnect, verify tokens are cleared

### Edge Cases

- [ ] Invalid Account ID (produces DNS/connection error)
- [ ] Expired OAuth token (auto-refresh)
- [ ] Revoked OAuth token (re-auth required)
- [ ] Rate limit / 429 handling (exponential backoff)
- [ ] Invalid SuiteQL query (graceful error message)
- [ ] Non-existent record ID (404 handling)
- [ ] Permission denied for record type (403 handling)
- [ ] Large SuiteQL result set (>5000 rows, pagination)
- [ ] OneWorld account without subsidiary param (missing mandatory field)
- [ ] Custom record types (customrecord\_{id})
- [ ] Concurrent requests from multiple users sharing same account

---

## Architecture Notes

### Why MCP Instead of Direct REST?

NetSuite's AI Connector Service wraps the SuiteTalk REST API in MCP (JSON-RPC 2.0). The MCP layer provides:

1. Pre-built tools with input validation
2. Mandatory workflows (metadata before create/update)
3. Unified access to records, SuiteQL, saved searches, AND reports through one endpoint
4. Role-based permission enforcement at the tool level

The alternative (direct SuiteTalk REST) would require:

- Multiple endpoint patterns (`/record/v1/`, `/query/v1/suiteql`)
- Manual schema discovery
- Separate auth scopes (`restlets rest_webservices` vs `mcp`)

MCP is the recommended path for AI integrations by Oracle/NetSuite.

### Per-Account URL Pattern

Every NetSuite URL uses the pattern `https://{accountid}.suitetalk.api.netsuite.com/...`. This means:

- The Account ID must be collected during admin setup
- All OAuth and API URLs are constructed dynamically
- There is no single "NetSuite API" endpoint -- each customer has their own

### Public Client (No Secret)

NetSuite MCP uses OAuth 2.0 public client with PKCE. This means:

- No `client_secret` is stored or transmitted
- PKCE `code_verifier` and `code_challenge` are required on every auth flow
- The `client_id` comes from the customer's Integration Record in NetSuite

---

_Generated from the investigation questionnaire. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _Investigation questionnaire for detailed API research_
