# Numa Data Connectors

Data connectors integrate external data sources (SharePoint, Google Drive, Gmail, Box, etc.) into Numa's file system and workspace chat. Each connector follows the same framework pattern regardless of auth type (OAuth, token, API-key).

## Architecture

```
Admin configures connector (wizard)
    ↓
Company secret saved to vault (connector config)
    ↓
User connects (OAuth redirect or PAT entry)
    ↓
User secret saved to vault (connection token)
    ↓
Files Remote shows connector with browse/search/download
    ↓
Workspace agent accesses connector via `files` tool
```

### Two-Secret Model

- **Company secret** = connector config. Created by admin via the setup wizard. Only admin modifies/deletes. User connect/disconnect **never** touches it.
- **User secret** = user's connection token. Exists = connected. Absent = not connected. Created on connect, deleted on disconnect.

This separation means admins configure once, users connect/disconnect freely, and revoking a user's access is just deleting their secret.

## Complete Connector Checklist

A connector is not done until ALL of the following are implemented:

| #   | Component                  | Location                                        | Purpose                                                                                         |
| --- | -------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | **Registry entry**         | `numa-frontend/src/Config/connectorRegistry.ts` | id, displayName, icon, description, category, authType, credentialFields, cachingPolicy         |
| 2   | **Admin wizard**           | `numa-frontend/src/Components/DataConnectors/`  | Walks admin through setup, saves company vault secret                                           |
| 3   | **Caching config**         | Wizard advanced section                         | Visible in wizard, saved to vault, applied at runtime                                           |
| 4   | **Backend provider**       | `lib/oauth-providers/`                          | Implements OAuthProvider interface (list_files, download_file, search_files, get_file_metadata) |
| 5   | **Backend listing**        | `handleListProviders`                           | Returns the connector so it appears in Files Remote                                             |
| 6   | **Backend config lookup**  | `getProviderConfig` + `vault_integration.py`    | Finds the connector's vault secret (both `oauth-client-*` and `connector-*` patterns)           |
| 7   | **User connection flow**   | Frontend                                        | OAuth redirect for OAuth connectors, PAT entry modal for token connectors                       |
| 8   | **User disconnect flow**   | Frontend                                        | Deletes user secret only, never touches company secret                                          |
| 9   | **Admin disconnect flow**  | Frontend                                        | Deletes or updates the correct company secret (platform-aware for shared secrets)               |
| 10  | **Files Remote rendering** | `numa-frontend/src/Components/Files/`           | Connector shows with correct icon, Connect/Disconnect based on user secret existence            |
| 11  | **Context menu**           | Frontend                                        | Appropriate actions for the content type (email actions for email, file actions for files)      |
| 12  | **CI/CD**                  | `.gitlab-ci.yml` + `package-all.sh`             | Lambda in CI matrix, packaged by build scripts                                                  |

## Framework Rules

These rules are foundational to the connector framework. Do not change without team discussion.

- **All connectors are the same** from the framework perspective. OAuth, token, API-key — the details differ but the pattern is identical.
- **Scopes come from the frontend** during authorize, not from the company vault. The backend must not require scopes in the company secret.
- **Never ship a button that does nothing.** If a feature needs backend + frontend + infra, implement all three before committing.

## Workspace Agent Integration

Every connector must be accessible from the Numa workspace chat agent.

- There is already a `files` tool — use it as the **single entry point**. Connector-specific operations (browse, search, download, send email, etc.) are parameters of that tool, not separate tools. Do not crowd the workspace with one tool per connector.
- The files tool has a consistent base vocabulary (list, search, download, browse) that works for all connectors.
- Each connector can declare **special capabilities** (e.g. Gmail: compose/send email, Google Drive: share file) via its registry entry (`apiReference.capabilities`).
- The workspace agent queries capabilities at runtime and exposes them as additional parameters — the user never needs to know which connector supports what.

## Key Files

| Component               | Location                                              |
| ----------------------- | ----------------------------------------------------- |
| Connector Registry      | `numa-frontend/src/Config/connectorRegistry.ts`       |
| Admin Wizards           | `numa-frontend/src/Components/DataConnectors/`        |
| Data Connectors Page    | `numa-frontend/src/Pages/DataConnectorsPage.tsx`      |
| Data Connectors Service | `numa-frontend/src/Services/DataConnectorsService.ts` |
| Backend Providers       | `lib/oauth-providers/`                                |
| Vault Integration       | `lambdas/python/*/vault_integration.py`               |
| Files Remote Components | `numa-frontend/src/Components/Files/`                 |

## Adding a New Connector

1. Add the registry entry in `connectorRegistry.ts` with all required fields
2. Create the admin wizard component (can often extend an existing wizard pattern)
3. Implement the backend provider in `lib/oauth-providers/`
4. Register it in `handleListProviders` so it appears in Files Remote
5. Add vault lookup patterns in `getProviderConfig`
6. Implement the frontend connection/disconnection flows
7. Add the Lambda to the CI/CD matrix in `.gitlab-ci.yml`
8. Test: admin setup -> user connect -> browse files -> workspace chat access -> user disconnect -> admin disconnect
