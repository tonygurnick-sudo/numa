---
api_name: ''
connector_id: '' # e.g., "hubspot", "monday", "xero"
auth_type: '' # oauth2 | token | api-key
tier: '' # standard | premium
category: '' # crm | project-management | accounting | cloud-storage | email | other
integration_path: '' # data-connector | data-connector-files | direct-api | hybrid
---

# {{api_name}} -- Connector & Integration Setup

> Build instructions for integrating {{api_name}} into Numa. This document provides
> code scaffolding, registry configuration, and a deployment checklist.
>
> **Prerequisites:** Read the completed investigation questionnaire and the
> [Numa Connectors documentation](../../documentation/connectors/README.md) first.

---

## Integration Type

**Selected path:** {{integration_path}}

| Component                | Required?  | Notes         |
| ------------------------ | ---------- | ------------- |
| Connector Registry entry | {{yes/no}} | {{notes}}     |
| Admin setup wizard       | {{yes/no}} | {{notes}}     |
| Backend provider class   | {{yes/no}} | {{notes}}     |
| Workspace agent prompt   | Yes        | Always needed |
| Feature flag             | {{yes/no}} | {{notes}}     |
| i18n keys                | {{yes/no}} | {{notes}}     |

---

## 1. Connector Registry Entry

> File: `numa-frontend/src/Config/connectorRegistry.ts`

```typescript
{
  id: '{{connector_id}}',
  displayName: '{{display_name}}',
  icon: '{{icon_path}}',  // e.g., '/icons/connectors/{{connector_id}}.svg'
  description: '{{short_description}}',
  category: '{{category}}',
  authType: '{{auth_type}}',  // 'oauth2' | 'token' | 'api-key'
  {{#if oauth2}}
  oauthConfig: {
    authorizationUrl: '{{auth_url}}',
    tokenUrl: '{{token_url}}',
    scopes: [{{scopes_array}}],
    pkce: {{pkce_required}},
  },
  {{/if}}
  {{#if token_or_apikey}}
  credentialFields: [
    {
      name: '{{field_name}}',
      label: '{{field_label}}',
      type: '{{text / password}}',
      required: true,
      helpText: '{{help_text}}',
      helpUrl: '{{url_to_get_token}}',
    },
  ],
  {{/if}}
  cachingPolicy: {
    enabled: {{true/false}},
    ttlMinutes: {{ttl}},
    cacheableOperations: ['list', 'search', 'metadata'],
  },
  apiReference: {
    capabilities: [
      {{#each capabilities}}
      '{{capability}}',  // e.g., 'browse', 'search', 'download', 'upload'
      {{/each}}
    ],
    {{#if special_capabilities}}
    specialCapabilities: [
      {{#each special}}
      { name: '{{name}}', description: '{{desc}}' },
      {{/each}}
    ],
    {{/if}}
  },
  tier: '{{tier}}',
}
```

---

## 2. Backend Provider Class

> File: `lib/oauth-providers/{{connector_id}}_provider.py`

```python
"""{{api_name}} connector provider implementation."""

from typing import Any

from .base_provider import OAuthProvider, FileMetadata, FileListResult


class {{ClassName}}Provider(OAuthProvider):
    """{{api_name}} data connector.

    Auth type: {{auth_type}}
    Base URL: {{base_url}}
    """

    PROVIDER_ID = "{{connector_id}}"
    BASE_URL = "{{base_url}}"

    def __init__(self, credentials: dict[str, Any]):
        super().__init__(credentials)
        # {{auth_setup_notes}}

    async def list_files(
        self,
        path: str = "/",
        page_size: int = {{default_page_size}},
        cursor: str | None = None,
    ) -> FileListResult:
        """List {{resource_plural}} at the given path.

        Maps to: GET {{list_endpoint}}
        """
        # TODO: Implement
        raise NotImplementedError

    async def download_file(self, file_id: str) -> bytes:
        """Download a {{resource_singular}} by ID.

        Maps to: GET {{download_endpoint}}
        """
        # TODO: Implement
        raise NotImplementedError

    async def search_files(
        self,
        query: str,
        page_size: int = {{default_page_size}},
        cursor: str | None = None,
    ) -> FileListResult:
        """Search {{resource_plural}}.

        Maps to: GET {{search_endpoint}}
        """
        # TODO: Implement
        raise NotImplementedError

    async def get_file_metadata(self, file_id: str) -> FileMetadata:
        """Get metadata for a {{resource_singular}}.

        Maps to: GET {{metadata_endpoint}}
        """
        # TODO: Implement
        raise NotImplementedError
```

---

## 3. Registration in **init**.py

> File: `lib/oauth-providers/__init__.py`

Add to the provider imports and registry:

```python
from .{{connector_id}}_provider import {{ClassName}}Provider

PROVIDER_REGISTRY = {
    # ... existing providers ...
    "{{connector_id}}": {{ClassName}}Provider,
}
```

---

## 4. Integration Prompt Deployment

> The workspace agent prompt file (`01-llm-api-rules.md` and companions) must be
> deployed so the workspace agent can access it when the connector is active.

**Prompt files to deploy:**

- `01-llm-api-rules.md` (main rules, < 300 lines)
- `01a-domain-model-reference.md` (entity reference)
- `01b-query-patterns.md` (read operations)
- `01c-mutation-patterns.md` (write operations)
- `01d-event-and-error-handling.md` (events & errors)

**Deployment location:** These files are loaded into workspace agent context based on
the active connector configuration. The exact mechanism depends on the current
workspace agent skill/plugin system.

---

## 5. i18n Keys

> File: `numa-frontend/src/i18n/en.json` (and other locale files)

```json
{
  "connectors.{{connector_id}}.displayName": "{{display_name}}",
  "connectors.{{connector_id}}.description": "{{short_description}}",
  "connectors.{{connector_id}}.setupTitle": "Connect {{display_name}}",
  "connectors.{{connector_id}}.setupDescription": "{{setup_wizard_description}}",
  {{#if token_or_apikey}}
  "connectors.{{connector_id}}.fields.{{field_name}}.label": "{{field_label}}",
  "connectors.{{connector_id}}.fields.{{field_name}}.help": "{{help_text}}",
  {{/if}}
  "connectors.{{connector_id}}.connected": "Connected to {{display_name}}",
  "connectors.{{connector_id}}.disconnected": "Disconnected from {{display_name}}"
}
```

---

## 6. Deployment Checklist

> Complete this checklist before considering the integration done.
> Reference: [Connector Checklist](../../documentation/connectors/README.md)

### Code

- [ ] Registry entry added to `connectorRegistry.ts`
- [ ] Connector icon added (SVG, appropriate size)
- [ ] Admin wizard component created or extended
- [ ] Backend provider class implemented with all required methods
- [ ] Provider registered in `__init__.py`
- [ ] Vault integration patterns added (`oauth-client-*` and/or `connector-*`)
- [ ] Provider listed in `handleListProviders`
- [ ] Provider config lookup added to `getProviderConfig`
- [ ] i18n keys added for all locales

### Auth Flows

- [ ] Admin setup wizard saves company secret to vault
- [ ] User connect flow works (OAuth redirect or token entry)
- [ ] User disconnect flow deletes user secret only
- [ ] Admin disconnect flow deletes company secret correctly
- [ ] Token refresh works (if OAuth)

### Functionality

- [ ] Files Remote shows connector with correct icon
- [ ] Browse / list files works
- [ ] Search works
- [ ] Download works
- [ ] File metadata displays correctly
- [ ] Caching works as configured

### Workspace Agent

- [ ] Integration prompt deployed
- [ ] Agent can list/browse via files tool
- [ ] Agent can search via files tool
- [ ] Agent can download via files tool
- [ ] Special capabilities work (if any)

### CI/CD

- [ ] Lambda added to CI matrix in `.gitlab-ci.yml`
- [ ] Lambda added to `package-all.sh`
- [ ] Build succeeds in pipeline

---

## 7. Testing Plan

### Manual Testing Sequence

1. **Admin setup:** Create connector via admin wizard
2. **User connect:** Connect as a regular user
3. **Browse:** Open Files Remote, verify connector appears, browse content
4. **Search:** Search for known content
5. **Download:** Download a file, verify contents
6. **Workspace chat:** Ask the agent to list files from the connector
7. **Workspace search:** Ask the agent to search the connector
8. **Workspace download:** Ask the agent to download and analyze a file
9. **User disconnect:** Disconnect, verify access is revoked
10. **Admin disconnect:** Remove connector config, verify cleanup

### Edge Cases

- [ ] Empty folders / no results
- [ ] Large file download
- [ ] Special characters in file names
- [ ] Expired token handling
- [ ] Rate limit handling
- [ ] Network timeout handling
- [ ] Concurrent access by multiple users

---

_Generated from the investigation questionnaire. See also:_

- _[Connector Framework Documentation](../../documentation/connectors/README.md)_
- _Investigation questionnaire for detailed API research_
