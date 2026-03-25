---
name: numa-connectors
description: Build and modify Numa data connectors (OAuth, token, API-key). Use when creating a new connector, modifying connector auth flows, working with connectorRegistry, Files Remote, connector wizards, or connector backend providers.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Numa Connector Development

When building or modifying a data connector, **deliver the entire end-to-end journey in one go**. Do not ship partial work that requires multiple follow-up iterations to become functional.

## Complete Connector Checklist

A connector is not done until ALL of the following are implemented:

1. **Registry entry** (`connectorRegistry.ts`) — id, displayName, icon, description, category, authType, credentialFields, cachingPolicy
2. **Admin wizard** — walks admin through setup, saves company vault secret with sensible defaults pre-filled
3. **Caching config** — visible in wizard advanced section, saved to vault, applied at runtime
4. **Backend provider** (`lib/oauth-providers/`) — implements OAuthProvider interface (list_files, download_file, search_files, get_file_metadata)
5. **Backend listing** — `handleListProviders` returns the connector so it appears in Files Remote
6. **Backend config lookup** — `getProviderConfig` and `vault_integration.py` find the connector's vault secret (both `oauth-client-*` and `connector-*` patterns)
7. **User connection flow** — OAuth redirect for OAuth connectors, PAT entry modal for token connectors
8. **User disconnect flow** — deletes user secret only, never touches company secret
9. **Admin disconnect flow** — deletes or updates the correct company secret (platform-aware for shared secrets)
10. **Files Remote rendering** — connector shows with correct icon, Connect/Disconnect based on user secret existence
11. **Context menu** — appropriate actions for the content type (email actions for email, file actions for files)
12. **CI/CD** — Lambda in `.gitlab-ci.yml` matrix, packaged by `package-all.sh`

## Framework Rules (DO NOT CHANGE without asking)

- **Company secret** = connector config. Created by admin. Only admin modifies/deletes. Connect/disconnect NEVER touches it.
- **User secret** = user connection. Exists = connected. Absent = not connected. Created on connect, deleted on disconnect.
- **All connectors are the same** from the framework perspective. OAuth, token, API-key — the details differ but the pattern is identical.
- **Scopes come from the frontend** during authorize, not from the company vault. The backend must not require scopes in the company secret.
- **Never ship a button that does nothing.** If a feature needs backend + frontend + infra, implement all three before committing.
- **Workspace agent integration is required.** Every connector must be accessible from the Numa workspace chat agent. There is already a `files` tool — use it as the single entry point. Connector-specific operations (browse, search, download, send email, etc.) are parameters of that tool, not separate tools. Do not crowd the workspace with one tool per connector.
- **Connector capability discovery.** The files tool must have a consistent base vocabulary (list, search, download, browse) that works for all connectors. Beyond that, each connector can declare special capabilities (e.g. Gmail: compose/send email, Google Drive: share file). These capabilities come from the connector's registry entry (`apiReference.capabilities`) and optionally from MCP server references or API docs URLs stored in the vault. The workspace agent queries the connector's capabilities at runtime and exposes them as additional parameters — the user never needs to know which connector supports what, the agent figures it out.

## Key Files

| Component                   | Location                                              |
| --------------------------- | ----------------------------------------------------- |
| **Connector Registry**      | `numa-frontend/src/Config/connectorRegistry.ts`       |
| **Admin Wizards**           | `numa-frontend/src/Components/DataConnectors/`        |
| **Backend Providers**       | `lib/oauth-providers/`                                |
| **Files Remote**            | `numa-frontend/src/Components/Files/`                 |
| **Vault Integration**       | `lambdas/python/*/vault_integration.py`               |
| **Data Connectors Page**    | `numa-frontend/src/Pages/DataConnectorsPage.tsx`      |
| **Data Connectors Service** | `numa-frontend/src/Services/DataConnectorsService.ts` |
