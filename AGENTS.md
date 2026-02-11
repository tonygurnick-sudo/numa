# Who i am

I am a new developer. I am intrested in what you do so please explaing what you are doing and why

# Guiding Primciples

These 9 principles guide the high-performance, functional architecture:

1. Pure Functional Programming - No Classes: Business logic as pure functions, classes only
   for infrastructure
2. Pipeline Architecture - Linear Data Flow: Data flows through sequence of transformations
3. Explicit Contracts - Type-Safe Schemas: Full type hints, dataclasses for schemas
4. Async-First - Non-Blocking I/O: All I/O operations async to prevent event loop blocking
5. Encapsulation - One Module = One Responsibility: Clear separation of concerns
6. Testability - Pure Functions = Easy Tests: No mocking required for business logic
7. No Magic - Explicit > Implicit: Clear, documented behavior, no hidden transformations
8. Performance-Aware - Optimize for Throughput: Target 1,000+ requests/second
9. Debuggability - Logs + Metrics at Boundaries: Observability at key decision points
10. Idempotent systems - Safe, repeatable, well thought out, Idempotent and logical side effects.


# context 7

Always use context7 when I need code generation, setup or configuration steps, or
library/API documentation. This means you should automatically use the Context7 MCP
tools to resolve library id and get library docs without me having to explicitly ask.

# AWS Profile

When running AWS CLI commands for this project, use `AWS_PROFILE=q-demo`. For example:
```bash
AWS_PROFILE=q-demo aws iot list-targets-for-policy --policy-name "some-policy"
```

# Numa — High‑Level Overview

This document orients AI agents and contributors to the Numa platform at a glance. It focuses on the frontend, Lambda backends, and infrastructure stacks that deploy per‑client environments.

## What Numa Is

Numa is a multi‑tenant, serverless enterprise AI platform on AWS. Each client has an isolated AWS account, with a dedicated frontend, AI Lambdas, knowledge bases, and orchestration. Key pillars:

- Chat: Real‑time AI chat via the core `numa-chat-agent` Lambda, integrated with Bedrock models and optional knowledge bases (Amazon Q Business or Bedrock KB). Supports web search and external integrations.
- Apps: Repeatable “input → process → output” flows implemented with Step Functions and specialized Lambdas (document analysis, policy generation, candidate screening, financial analysis, and more).
- Integrations: Optional Pipedream Connect integrations (via a secure, Arcanum‑owned proxy account) to safely expose SaaS tools to chat.

## Architecture at a Glance

- Frontend: React 19 + Vite + Bootstrap 5 (`/numa-frontend`)
  - Primary chat UI is `NumaChatAgents` (legacy `NumaChat` remains for backup).
  - Calls the chat agent over HTTP streaming (NDJSON) via CloudFront.
- Lambdas: 30+ specialized functions (Python primary; some Node for system tasks) under `/lambdas`.
- Infrastructure: CDK for Terraform (CDKTF, TypeScript) in `/infra`, with stacks that create per‑client environments.
- State & Data:
  - DynamoDB: configuration, chat history, job status (by app), admin integration policies.
  - S3: per‑client “outputs” bucket (chat uploads, app run artifacts) and “data” bucket (knowledge base files).
  - Step Functions: orchestrate multi‑step application workflows.

---

## Frontend (numa-frontend)

- Tech stack: React 19 + Vite; Bootstrap 5 styling.
- Entry points:
  - Main chat: `src/Pages/NumaChatAgents.tsx` (canonical chat page going forward).
  - Knowledge base management, app launchers, settings, user management, etc. are organized under `src/Pages` and `src/Components`.
- Configuration: `public/config.json` injected at runtime (Cognito IDs, region, buckets, API base, feature flags like `PIPEDREAM_INTEGRATIONS`, relay Lambda ARN, preferred knowledge base, etc.).
- Chat transport: Uses HTTP streaming to `/api/numa-chat-agent/stream` with NDJSON frames. CloudFront injects an `x-arcanum-cloudfront-secret` header; the frontend attaches a Cognito bearer token.
- Integrations UX: When enabled and configured, the chat UI can query connected integrations (via a cross‑account proxy relay). Admins can also set default allow/deny policies for tool usage.

Dev commands:
- `yarn install`, `yarn run dev`, `yarn build`, `yarn test`
- Lint all workspaces (excluding infra): `yarn workspaces foreach --parallel --all --exclude infra run lint --fix`

### Internationalization (i18n)

**IMPORTANT:** All user-facing text in the frontend MUST use i18n translations. Do not hardcode strings.

The frontend uses `react-i18next` for internationalization:

- **Translation files:** `public/locales/en/*.json` (organized by namespace)
- **Hook:** `useTranslation('namespace')` returns a `t()` function
- **Lint enforcement:** ESLint rule `i18next/no-literal-string` will error on hardcoded UI strings

**Common namespaces:**
- `common` - Shared UI elements (buttons, labels, navigation, tool renderers)
- `apps` - Apps pages and components
- `agents` - Agent builder and management
- `chat` - Chat interface
- `auth` - Authentication pages
- `integrations` - Integrations and data connectors
- `knowledgeBase` - Knowledge base management
- `errors` - Error messages

**Usage example:**
```tsx
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation('common');

  return (
    <Button>{t('common.save')}</Button>
    <Alert>{t('errors.loadFailed', { message: error })}</Alert>
  );
};
```

**Adding new translations:**
1. Add keys to the appropriate namespace in `public/locales/en/<namespace>.json`
2. Use the `t()` function with the key path (e.g., `t('section.subsection.key')`)
3. For interpolation, use `{{variable}}` in JSON: `"greeting": "Hello, {{name}}!"`
4. Run `yarn lint` to verify no hardcoded strings remain

### Language Picker + LLM Language (single source of truth)

To add a new language option for users and ensure it reaches the LLM prompts, update all of the following:

1. **Picker options (UI):** `numa-frontend/src/Pages/UserProfile.tsx`
   Add a new `<option value="xx">` entry.
2. **Picker label text (i18n):** `numa-frontend/public/locales/en/settings.json`
   Add a new `userProfile.defaults.language.<key>` label for the option.
3. **Supported UI languages:** `numa-frontend/src/i18n/index.ts`
   Add the language code to `supportedLngs` so i18n does not overwrite the user's choice.
4. **LLM language preference storage:** `numa-frontend/src/utils/languagePreference.ts`
   The chosen language is persisted under `numaLanguagePreference` and passed to chat/apps via `getEffectiveLanguage()`.
   Do not add fallback logic here beyond `browser` default behavior.
5. **LLM prompt wording + language names:** `lib/bedrock/bedrock/language.py`
   Add the language code to `LANGUAGE_NAMES`. This file is the single source of truth for the system prompt wording used by both chat and apps.

---

## Core Chat Agent (lambdas/python/numa-chat-agent)

The `numa-chat-agent` Python Lambda powers Numa Chat:

- Runtime & transport:
  - FastAPI app served via AWS Lambda Web Adapter (LWA) in ZIP mode.
  - Exposed through a Lambda Function URL placed behind CloudFront.
  - Streams NDJSON events (start, event, ping, completion) to the frontend.
- Models & agents:
  - Uses AWS Bedrock models and “Strands Agents” style event shapes for tool use.
  - Tools include `query_knowledge_base` (Amazon Q Business or Bedrock KB) and `web_search`.
  - Optional MCP/MCP‑style tools via the Pipedream proxy (see Integrations below).
- Auth & safety:
  - Validates Cognito tokens; CloudFront shared secret required on all requests.
  - Reads conversation history from DynamoDB to maintain continuity.
- Configuration (via environment): preferred knowledge base, Bedrock KB ID or Q app/retriever IDs, outputs/data bucket ARNs, supported integrations, optional global integration settings table, and CloudFront secret.

Frontend integration: The chat page `NumaChatAgents` calls `Services/chatAgentService.ts` for request/stream handling, including tool event frames and chunk assembly.

---

## Numa Apps (Step Functions + Lambdas)

Numa’s “Apps” are standard input/output flows defined in infra constructs and implemented by Lambdas. Patterns:

- App construct: Each app extends a base construct that wires API routes, S3 prefixes, and logging.
- Start/status endpoints:
  - `step-function-start` Lambda starts the app’s state machine.
  - `step-function-status` Lambda provides run status and artifacts.
- Typical steps include:
  - File ingest to S3 outputs bucket under an app‑specific prefix.
  - Content extraction (`extract-content-from-file`), LLM prompts, domain logic.
  - Results written to S3 outputs and/or a DynamoDB jobs table (when enabled).
- Step Functions have retry/catch policies and write intermediate/final statuses (S3 or DynamoDB) consumed by the frontend.

This pattern powers apps like Document Summariser, Policy Builder, Candidate Screening, Financial Analysis, and others under `/infra/constructs/apps` and `/lambdas/python/*`.

---

## Integrations (Pipedream Connect)

Numa integrates with external SaaS tools through a secure proxy model:

- Dedicated proxy account: A separate Arcanum‑owned AWS account hosts the Pipedream proxy so OAuth credentials are centralized and never deployed into client accounts.
- Cross‑account access: Client accounts call a relay Lambda that forwards to the proxy Lambda (which validates caller account against an allowlist). User‑to‑integration mapping is maintained in DynamoDB.
- Frontend flow:
  - If `PIPEDREAM_INTEGRATIONS` is enabled in `config.json`, the chat page initializes a cross‑account `LambdaClient` (via Web Identity) and uses `PipedreamProxyService` to list connected apps, generate connect tokens, and call MCP‑style tools.
  - Admins can set global allow/deny tool policies per integration; chat enforces these.
- Infra stacks involved: see “Infrastructure Stacks” below (`pipedream-proxy-stack`, relay packaging, account sync of allowed accounts).

---

## Infrastructure Stacks (CDKTF /infra)

Numa uses multiple stacks to support multi‑tenant deployment and secure integrations:

- numa-client-stack.ts — core per‑client stack
  - Provisions the client’s Cognito, API Gateway + authorizer, CloudFront, S3 buckets (outputs, data, frontend), chat DynamoDB tables, Step Functions, Lambdas for apps, the `numa-chat-agent` function URL, and knowledge base(s).
  - Configurable preferred knowledge base: Amazon Q Business or Bedrock KB.
  - Can enable Pipedream integrations by wiring the cross‑account relay Lambda ARN.

- nextgen-root-stack.ts — NextGen org/account bootstrap
  - Used to create and organize AWS accounts (Nextgen) that will host client deployments.
  - Creates roles and Step Functions to automate account creation, SSO access, and initial config.

- pipedream-proxy-stack.ts — integrations in a dedicated Arcanum account
  - Hosts the cross‑account proxy Lambda, user‑mapping and allowed‑accounts tables, secrets for OAuth, and an hourly account‑sync Lambda that reads the deployer’s client config table.

- q-apps-deployer-stack.ts — deployer account resources
  - Deploys shared resources to the deployer account, including the `numa-client-config` DynamoDB table and Honeycomb keys in SSM, domain/Route53 scaffolding, and optional Customer Success Portal infra.

CloudFront routing: The frontend distribution forwards `/api/*` to API Gateway and `/api/numa-chat-agent/*` directly to the chat agent Function URL, adding the CloudFront shared secret header.

---

## Data, Storage, and Knowledge Bases

- Buckets per client:
  - `outputs` bucket: app artifacts, chat uploads, and run status files.
  - `data` bucket: knowledge base documents (also a separate `company` bucket for company data where relevant).
- Knowledge bases:
  - Amazon Q Business: enterprise search with web experience integration and optional index units; WebExperience callback is wired to Cognito.
  - Bedrock Knowledge Base: S3‑backed vector store with periodic indexing (typically ~30‑minute cadence) and retrieval via `bedrock:Retrieve` during chat.
- Chat history: DynamoDB `numa-<client>-chat-history` tracks conversation turns, tool use, and results frames for accurate message reconstruction.

---

## Configuration and Multi‑Tenant Model

- Client config: A per‑client JSON record (in DynamoDB for prod; dev examples in `clientConfigProd.json`) determines region, preferred knowledge base, Q vs Bedrock enablement, whether to deploy all apps, Pipedream integration flag, budgets, etc.
- Per‑client isolation: Each client deploys into its own AWS account. The deployer account assumes into the client account to deploy infra. Integrations use a separate proxy account.
- Feature flags & FE config: `public/config.json` and session storage carry resolved values (client name, region, bucket names, Pipedream relay ARN, `PIPEDREAM_INTEGRATIONS`, preferred KB, etc.).

---

## Security Model

- Authentication: Amazon Cognito User Pool + User Pool Client; frontend obtains JWTs for API calls.
- API protection: API Gateway custom authorizer verifies Cognito tokens and CloudFront secret. Chat Function URL sits behind CloudFront; all requests must include the shared secret header.
- Cross‑account access: Deployer assumes roles into client accounts; client chat agent can assume web identity roles as needed; integrations validate caller account identity.
- Secrets: OAuth credentials for integrations are stored in Secrets Manager in the dedicated proxy account.
- Partner Revenue Measurement: All AWS SDK calls should carry our AWS Marketplace product code (cl23v3vsno0k35czlg7e3ld9p). Use the shared helpers to append the PRM user agent: Python Lambdas `from prm import client, resource`, Node Lambdas/tools `withPRM` from `lib/prm-node/prm`, and frontend `withPRM` from `src/utils/prmUtils`. This keeps AWS attribution enabled across infra, Lambdas, frontend, and tools.

---

## Development & Deployment

- Frontend
  - Dev: `yarn install`, `yarn run dev`
  - Build before infra deploy: `yarn build`
  - Tests: `yarn test`

- Lambdas (Python)
  - Use Poetry for deps, lint, and tests.
  - Package a single Lambda (preferred): `bash package-python-lambda.sh lambdas/python/<lambda_name>`
  - Package all (slow): `bash package-all.sh`

- Infrastructure (CDKTF)
  - Ensure frontend is built and Lambdas are packaged before `cdktf deploy`.
  - Deploy to a target client (example env vars + stack name) using `yarn cdktf deploy --auto-approve <stack>`.

---

## Folder Guide

- `/numa-frontend/` – React app (Pages, Components, Services), including `NumaChatAgents` and integrations UI.
- `/lambdas/python/` – Python Lambdas (e.g., `numa-chat-agent`, `extract-content-from-file`, app‑specific steps, Pipedream proxy/relay, web search proxy, etc.).
- `/lambdas/node/` – Node Lambdas for infrastructure/system tasks (authorizers, cleanup, shims, vector init, etc.).
- `/infra/` – CDKTF stacks and constructs for client, deployer, NextGen (account creation), Pipedream proxy, knowledge bases, and frontend infra.
- `/lib/` – Shared libraries and helpers (Bedrock, S3, utilities).
- `/tools/` – Operational tools (create users, write/retrieve config, check index progress, reports, etc.).

---

## Mental Model for Agents

1) If deploying to clients, it runs out of the numa-client-stack where we assume an ArcanumAIAccess role from the deployer accounts creds to be able to create all the resources in the client account. This is also useful for local dev to access/see resources in the client account.
2) For chat tasks, the `numa-chat-agent` Lambda is the hub: it streams tokens, invokes Bedrock, queries the selected knowledge base, and optionally calls MCP tools through the Pipedream proxy.
3) For app tasks, follow the app construct → Step Function → Lambda chain, with S3 prefixes in the outputs bucket and optional job status in DynamoDB.
4) For integrations, treat Pipedream access as cross‑account and centrally secured; rely on the relay/proxy pattern.
