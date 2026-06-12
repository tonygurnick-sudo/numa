# Numa Frontend

React 19 + Vite 6 + Bootstrap 5 + TypeScript 5.9. Styled with React Bootstrap 2 + Bootstrap Icons + Lucide React.

---

## Architecture

### Routing

Routes are defined in `src/utils/routeConfig.tsx` and rendered in `src/Routes.tsx`. All pages are lazy-loaded and auth-protected via `ProtectedRoute`.

Key routes:

| Route              | Page                      | Notes                                                                                   |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------------- |
| `/chat`            | `NumaWorkspaceChatAgents` | Primary chat (workspace agent)                                                          |
| `/dash`            | `Dash`                    | App marketplace/launcher                                                                |
| `/agents`          | `AgentsManagement`        | Agent builder & management                                                              |
| `/ops`             | `OpsPage`                 | Numa Ops (tickets/projects/teams)                                                       |
| `/files`           | `Files`                   | File manager (remote + workspace)                                                       |
| `/knowledge-bases` | `CompanyKnowledgeBase`    | KB admin                                                                                |
| `/integrations`    | `UnifiedIntegrationsPage` | Unified Integrations surface — Pipedream + native connectors, deep-linkable via `#slug` |
| `/data-connectors` | _redirect_                | 301-style `Navigate` to `/integrations` (FEAT-143)                                      |
| `/scheduling`      | `SchedulingPage`          | Agent scheduling                                                                        |
| `/settings`        | `Settings`                | Admin settings                                                                          |
| `/shared/:uuid`    | Shared doc Q&A            | **No auth required**                                                                    |

Routes are gated by feature flags (`featureFlag`) and required features (`requiredFeature`) from config.

### Directory Structure

```
src/
├── Pages/              # 32+ lazy-loaded pages
├── Components/         # 67+ component folders (feature-grouped)
├── Providers/          # 17 context providers
├── Services/           # 34 API client services
├── hooks/              # 25+ custom React hooks
├── utils/              # 40+ utility modules
├── types/              # 13 TypeScript domain type files
├── Layouts/            # AppLayout, LayoutDashboard, LayoutForm
├── Modules/            # 10 reusable input/output modules
├── ToolRenderers/      # Chat tool output renderers
├── Config/             # Integrations, quick actions, icons
├── locales/            # i18n translations (en, he)
├── Assets/             # CSS, SCSS, images
└── __tests__/          # Vitest tests
```

Components are organized **by feature** (e.g., `Components/Ops/`, `Components/WorkspaceChat/`, `Components/Agents/`), not by type.

### State Management (Providers)

Provider hierarchy (from `AppProviders.tsx`):

```
AuthProvider
  └─ NumaRequestProvider
      └─ AdminCapabilityGateLoader
          └─ KnowledgeBaseProvider
              └─ NumaAppProvider
                  └─ JobStatusProvider
```

| Provider                  | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| **AuthProvider**          | Cognito auth, token refresh (10-min), AWS SDK clients         |
| **NumaRequestProvider**   | HTTP helpers (numaGet/Post/Put/Delete) with auto auth headers |
| **KnowledgeBaseProvider** | KB document cache, indexing status                            |
| **NumaAppProvider**       | App catalog, favorites                                        |
| **JobStatusProvider**     | App run status polling (DynamoDB)                             |
| **BrandingProvider**      | Client branding (logo, colors, name)                          |
| **ToastProvider**         | Toast notification queue                                      |

### Path Aliases

```
@/*            → src/
@/components/* → src/Components/
@/pages/*      → src/Pages/
@/utils/*      → src/utils/
@/services/*   → src/Services/
@/providers/*  → src/Providers/
@/hooks/*      → src/hooks/
@/modules/*    → src/Modules/
@/layouts/*    → src/Layouts/
```

---

## Critical Patterns & Gotchas

These patterns exist because we've been burned by real bugs. Follow them exactly.

### Token Access (AuthProvider)

**Never read tokens directly from `user.tokens` or `user.decoded_tokens` for API calls or AWS credential creation.** User state is intentionally NOT updated on token refresh (to prevent cascading re-renders across all `useAuth()` consumers). Tokens in `user.tokens` may be stale/expired.

**Correct:**

- `await getAccessToken()` — for access tokens (API Authorization headers)
- `await getIdToken()` — for ID tokens (STS `webIdentityToken`, chat agent requests)
- `user.decoded_tokens.idToken.sub`, `.email`, `.cognito:groups` — identity claims are safe (don't change during a session)

**Why:** `refreshTokens()` updates `tokensRef`, `decodedTokensRef`, and `localStorage` every 10 minutes, but only calls `setUser()` when groups/features actually change. `getAccessToken()`/`getIdToken()` read from refs (always fresh) and handle expiry checks automatically.

**Key files:** `src/Providers/AuthProvider.tsx`, `src/Providers/RequestProvider.tsx`

### API Requests (RequestProvider)

**Always use `useNumaRequest()` hooks for API calls to protected `/api/` endpoints.** Never use raw `fetch()` or `axios` directly — they won't include the Authorization header and will 401.

```tsx
const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();

const data = await numaGet('/api/settings/agents');
await numaPut('/api/settings/agents', { mode: 'full' });
```

**Service methods:** Many admin services (e.g., `AdminAgentsService`, `AdminMfaSettingsService`) accept optional `numaGet`/`numaPut` parameters. When not passed, they silently fall back to raw `fetch()` without auth. **Always pass the auth helper:**

```tsx
// Correct — authenticated
const res = await AdminAgentsService.get(numaGet);

// Wrong — silently unauthenticated, returns 401
const res = await AdminAgentsService.get();
```

**Key file:** `src/Providers/RequestProvider.tsx`

### AWS SDK Clients (AuthProvider)

**Never create AWS SDK clients locally in page components.** All AWS SDK clients are centralized in AuthProvider and accessed via `useAuth()`.

```tsx
const { lambdaClient, dynamoDBClient, bedrockRuntimeClient } = useAuth();
```

**Why:** AuthProvider creates clients with a function-based credential provider that reads fresh tokens from `tokensRef` on every SDK call. Page-local clients capture the token once at init time, so after background refresh the credentials go stale (401/403 errors after ~15min).

**Adding a new client:** Follow the existing pattern in AuthProvider: state + `useCallback` initializer + add to the central `useEffect` + `value` useMemo + logout cleanup. See `initializeLambdaClient` or `initializeQBusinessClient` as templates.

**Key file:** `src/Providers/AuthProvider.tsx`

### Markdown → DOCX/PDF Downloads (document-converter)

**When a feature produces markdown and users need DOCX/PDF, convert on demand through the document-converter Lambda.** Do not pre-render binaries per feature and do not convert client-side.

```tsx
import { downloadDocx, downloadPdf } from '../Services/documentConverterService';

await downloadDocx(numaPost, markdownString, title); // POST /api/document-converter → presigned URL → download
await downloadPdf(numaPost, markdownString, title);
```

The Lambda converts server-side (consistent quality, fonts, page layout) and returns a presigned download URL. Used by chat's `ResultActions` and `PolicyDesignerDetail`.

**Legacy paths — do not use for new code:**

- `createDocxBlob` (`Services/fileConverter.ts`) — client-side DOCX assembly, V1 policy-builder era.
- jsPDF styled-blob rendering in `ResultActions` — legacy client-side PDF fallback.

**Gotchas when fetching the source markdown from S3:**

- `RunRecord.s3Prefix` (V2 apps API) is an **unformatted template** — substitute `{user_sub}` → `run.userId` and `{conversation_id}` → `run.conversationId || run.runId` before building keys. Using it verbatim requests a non-existent key, which S3 reports as a misleading `AccessDenied ... s3:ListBucket` 403.
- `downloadFileWithSignedUrl` (`utils/s3Utils.ts`) does not check `response.ok` — a failed presigned fetch saves the S3 error XML as the requested file (corrupt "PDF"/"DOCX"). Check keys carefully or guard the response.

---

## Internationalization (i18n)

**All user-facing text MUST use i18n translations.** Do not hardcode strings. ESLint rule `i18next/no-literal-string` will error on hardcoded UI strings.

Uses `react-i18next`. Translation files: `src/locales/en/*.json`.

**Namespaces:** common, chat, agents, apps, auth, settings, integrations, knowledgeBase, files, ops, userManagement, automations, vault, shared, errors, support.

```tsx
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('common');
return <Button>{t('common.save')}</Button>;
```

For interpolation: `{{variable}}` in JSON, e.g. `"greeting": "Hello, {{name}}!"`.

### Adding a New UI Language

Update all of the following:

1. **Picker options:** `src/Pages/UserProfile.tsx` — add `<option value="xx">`
2. **Picker label (i18n):** `src/locales/en/settings.json` — add `userProfile.defaults.language.<key>`
3. **Supported languages:** `src/i18n/index.ts` — add to `supportedLngs`
4. **LLM language storage:** `src/utils/languagePreference.ts` — persisted under `numaLanguagePreference`, passed to chat/apps via `getEffectiveLanguage()`
5. **LLM prompt wording:** `lib/bedrock/bedrock/language.py` — add to `LANGUAGE_NAMES` (single source of truth for system prompt wording)

---

## Configuration & Feature Flags

`public/config.json` is **auto-generated during deployment** from the `numa-client-config` DynamoDB table. **Never edit it directly** — it will be overwritten on deploy.

`clientConfigProd.json` is a **local dev override only**. If a client exists in this file, its config is used entirely and DynamoDB is skipped — missing flags default to `false`.

Feature flags are accessed via `getFlag(flagName)` from `src/utils/featureFlags.ts`. Key flags:

| Flag                      | Controls                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIPEDREAM_INTEGRATIONS`  | Pipedream SaaS integrations                                                                                                                                                                               |
| `NUMA_WORKSPACE_CHAT`     | Workspace chat agent                                                                                                                                                                                      |
| `SCHEDULING`              | The /automations route + scheduling/triggers wizard (master switch)                                                                                                                                       |
| `EVENT_TRIGGERS`          | Event-triggered automations (the "When something happens" path). Off → only cron schedules are offerable. Independent of `PIPEDREAM_INTEGRATIONS` (which gates Pipedream-backed sources within triggers). |
| `DATA_CONNECTORS_ENABLED` | Data connectors (SharePoint, Teams, Box, etc.) — also gates the Secrets Vault (lives in Settings > My Secrets / Company Secrets)                                                                          |
| `NUMA_OPS`                | Numa Ops (tickets/projects)                                                                                                                                                                               |
| `V2_APPS`                 | V2 Apps (experimental)                                                                                                                                                                                    |
| `AGENTS`                  | Agent builder                                                                                                                                                                                             |

---

## Dev Commands

```bash
yarn install              # Install dependencies
yarn dev                  # Start dev server
yarn build                # Production build (8GB Node heap)
yarn test                 # Vitest unit tests with coverage
yarn test:e2e             # Playwright E2E tests
yarn lint                 # ESLint check
yarn format               # Prettier format
yarn typecheck            # TypeScript check
```

Lint all workspaces (excluding infra): `yarn workspaces foreach --parallel --all --exclude infra run lint --fix`

---

## Testing

**Framework:** Vitest + React Testing Library. E2E: Playwright.

- Test files: `src/__tests__/` (mirrors src structure)
- Setup: `src/__tests__/testSetup.ts` (localStorage mock, i18n init)
- Environment: jsdom

---

## Chat Transport

Workspace chat uses HTTP streaming to the workspace agent proxy with NDJSON frames. CloudFront injects `x-arcanum-cloudfront-secret`; frontend attaches Cognito bearer token.

**Key files:**

- Page: `src/Pages/NumaWorkspaceChatAgents.tsx`
- Service: `src/Services/workspaceChatAgentService.ts`
- Types: `src/types/workspaceChatTypes.ts`
- Components: `src/Components/WorkspaceChat/`
- Streaming hook: `src/hooks/useWorkspaceChatStreaming.ts`

### Tool Rendering Pipeline

Tool results flow through segments. Each tool_use creates a segment (`inline_tool` or `tool_card`), and the renderer displays it based on segment kind and tool name.

**IMPORTANT: There are TWO segment renderers -- both must be updated when adding tool rendering:**

| Renderer                         | File                                                            | Used by                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ChatMessages** (primary)       | `src/Components/Chat/ChatMessages.tsx`                          | The actual chat message component. Contains its own `tool_card` rendering with special cases for Ops, numa_tool, etc. **This is the one users see.** |
| **WorkspaceChatSegmentRenderer** | `src/Components/WorkspaceChat/WorkspaceChatSegmentRenderer.tsx` | Exported but not directly imported by any page component. May be used as a secondary/alternative renderer.                                           |

When adding a new tool renderer or special-casing a tool's display, update `ChatMessages.tsx` first -- that's where the rendering actually happens.

**Tool result format gotcha:** Results from `tool_card` segments arrive as the raw content array (`[{type: "text", text: "..."}]`), NOT wrapped in `{content: [...]}`. Payload parsers must handle both formats. Follow the pattern in `opsHelpers.ts` `extractText()`:

```ts
const contentOrResult = Array.isArray(result) ? result : result?.content;
```

**Key rendering files:**

- `src/ToolRenderers/` -- Renderer components (OpsToolRenderer, RenderToolRenderer, WebSearchRenderer, etc.)
- `src/ToolRenderers/helpers.ts` -- Shared types, payload parsers, `useS3FileResult` hook
- `src/utils/ToolConfig.ts` -- Tool descriptor/renderer mapping, visual config
- `src/utils/workspaceChatEventHandlers.ts` -- Segment creation, tool categorisation, `INLINE_TOOLS` set

---

## Partner Revenue Measurement (PRM)

All AWS SDK calls must carry the Marketplace product code (`cl23v3vsno0k35czlg7e3ld9p`). Use `withPRM` from `src/utils/prmUtils.ts` when creating AWS SDK clients in the frontend.
