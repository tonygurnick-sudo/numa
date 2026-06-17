---
api_name: GitLab
api_slug: gitlab
doc: connector-setup (build instructions)
integration_path: Direct API (spec-driven, chat-only)
---

# GitLab — Connector Setup

GitLab is a **chat-only, spec-driven** connector (like `gohighlevel`, `rentman`, `actionstep`). It needs **no Python provider** and **no new wizard** — the generic `ApiKeyWizard` + the generic `numa integrations request` path do all the work. The connector is fully described by its registry entry plus the catalog/slug wiring and this docs pack.

## What was implemented

1. **Registry entry** — `numa-frontend/src/Components/DataConnectors/connectorRegistry.ts`

```ts
{
  id: 'gitlab',
  displayName: 'GitLab',
  icon: 'bi-git',
  description: 'Source code, merge requests, issues, pipelines and releases on GitLab',
  category: 'Developer Tools',
  authType: 'token',
  baseUrl: 'https://gitlab.com/api/v4',     // self-managed: admin overrides via wizard Instance URL
  surfaces: ['chat'],
  rateLimitRpm: 2000,
  cachingPolicy: CACHING_PRESETS.projectManagement,
  credentialFields: [
    { key: 'api_key', label: 'dataConnectors.fields.pat', type: 'password',
      placeholder: 'glpat-…', required: true, helpText: 'dataConnectors.fields.gitlabTokenHint' },
  ],
}
```

2. **Catalog** — `infra/config/connectors.ts` → added `'gitlab'` to `NATIVE_CONNECTORS`.
3. **Python slug mirror** — `lambdas/python/workspace-chat-tools/tools/user_profile.py` → added `'gitlab'` to `_NATIVE_CONNECTOR_SLUGS`.
4. **Agent discovery** — `services/numa-workspace-agent/numa_workspace_agent/assistant.py` → added `gitlab` to the integration-detection regex (skill activation nudge).
5. **i18n** — `numa-frontend/src/locales/en/integrations.json` → added `dataConnectors.fields.gitlabTokenHint`.
6. **Docs pack** — this `ext-api-doc/gitlab/` directory (synced to S3 at deploy; the agent loads `01*`/`02`/`03`/`04` at runtime for connected users).

## What was intentionally NOT done

- **No Files Remote surface.** GitLab repos are browsable, but the connector matches the other API connectors (chat-only). The agent reads repo content via `/repository/files/.../raw`. Adding Files browsing later means a `lib/oauth-providers/oauth_providers/gitlab_provider.py` (list_files/download_file/search_files/get_file_metadata mapping project→ref→tree→blob) + `handleListProviders` + `getProviderConfig` + `surfaces: ['files','chat']`.
- **No Pipedream pairing.** GitLab is not a supported Pipedream integration in Numa, so no `PIPEDREAM_TO_CONNECTOR` entry.
- **No CI matrix change.** No new Lambda — the generic request path handles it.

## Auth runtime behaviour

- Admin runs the generic API-key wizard → writes the `connector-config-gitlab` company secret (metadata, `base_url`, `credential_fields` schema, optional `instance_url` for self-managed).
- Each user is prompted in chat for their PAT on first use → stored in their personal vault.
- The request path injects `Authorization: Bearer <api_key>` and resolves the base from vault `instance_url` (self-managed) else registry `base_url`.

## Test plan (end-to-end)

1. Admin: Integrations → GitLab → configure (leave Instance URL blank for gitlab.com). Confirm `connector-config-gitlab` secret created.
2. Chat: ask "list my GitLab projects" → credential card prompts for PAT → store it.
3. Verify reads: `GET /projects?membership=true`, then read a file via `/repository/files/README.md/raw?ref=main`.
4. Verify a 404 path-encoding case is handled (unencoded `group/project` should be corrected to `%2F`).
5. Verify a write (create an issue) and that the returned `iid`/`web_url` is surfaced.
6. Self-managed: set Instance URL to a test instance API root; confirm requests hit it.
7. Disconnect: user disconnect removes only the user PAT secret; admin disconnect removes `connector-config-gitlab`.

## Deploy note

`ext-api-doc/gitlab/` is auto-synced to the per-client `{client}-ext-api-doc` S3 bucket on deploy (`numa-client-stack.ts`). The add-integration picker greys out native connectors whose docs folder is absent in that bucket — so GitLab only appears "available" after a deploy that ships this folder.
