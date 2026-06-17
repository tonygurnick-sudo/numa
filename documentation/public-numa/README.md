# Public Numa Demo

A public-facing, unauthenticated demo chat page that showcases Numa's AI chat capabilities. Designed for embedding on the Arcanum website and live demos -- no login required.

**URL:** `https://<client>.numa.arcanum.ai/demo`
**Current stack:** `numa-public-demo` at `https://numa-public-demo.numa.arcanum.ai/demo`

## What It Does

The demo page provides a stripped-down version of Numa workspace chat with the same rich message rendering:

- Chat with Claude (Haiku 4.5, forced server-side)
- Web search
- File creation (HTML, markdown, code, documents)
- File upload (direct S3 upload via scoped browser credentials, up to 200MB)
- Split-view file preview (same as workspace chat, including DOCX-to-PDF conversion)
- Inline file references with clickable links (e.g. `/workdir/outputs/example.html`)
- Thinking indicators, tool cards, inline tool segments ("Working..."), subagent display
- Workspace initializing banner on first message
- Quick action tiles on the welcome screen (2 featured + 4 middle + 3 bottom)
- Same PageHeader and layout as regular Numa workspace chat V2

### What's Excluded

- No knowledge bases, integrations, data connectors, or Numa Ops
- No conversation history persistence (state lives in browser, lost on refresh)
- No agent builder or agent selection
- No model selection (Haiku 4.5 only)
- No settings panel, history sidebar, or agents sidebar
- Not linked anywhere in the UI -- you must know the URL

## Architecture

```
Browser (/demo)
  |  (no auth headers)
  v
CloudFront  /api/public-demo/*  (no CloudFront secret -- public origin)
  |
  v
public-demo-proxy Lambda  (Function URL, RESPONSE_STREAM, no JWT)
  |  1. Check per-IP rate limit (10 req/min)
  |  2. Check daily cost limit in DynamoDB
  |  3. Force Haiku 4.5 model, strip enterprise features
  |  4. Invoke AgentCore with synthetic user identity
  |  5. Stream SSE response, extract cost from result event
  |  6. Record cost to DynamoDB (fire-and-forget)
  v
Existing AgentCore Runtime  (reused, session prefix: public-{uuid})
```

### Proxy Endpoints

| Method | Path                                       | Purpose                                                      |
| ------ | ------------------------------------------ | ------------------------------------------------------------ |
| GET    | `/api/public-demo/ping`                    | Health check                                                 |
| GET    | `/api/public-demo/credentials`             | Vend scoped S3 credentials (15-min TTL)                      |
| POST   | `/api/public-demo/invocations`             | Chat streaming + file upload                                 |
| GET    | `/api/public-demo/files/{conversation_id}` | List conversation files                                      |
| POST   | `/api/public-demo/convert-preview`         | DOCX-to-PDF conversion (invokes workspace-chat-tools Lambda) |
| POST   | `/api/public-demo/upload-complete`         | Notify after direct S3 upload                                |

### Browser Credentials (File Preview + Upload)

The demo page needs to display files the agent creates and support file uploads. Since there's no authenticated user, the proxy Lambda vends temporary, scoped AWS credentials via the `/credentials` endpoint:

```
Browser                          Proxy Lambda
  |                                |
  | GET /api/public-demo/credentials
  |------------------------------->|
  |                                | STS AssumeRole(PublicDemoRole)
  |                                |   -> S3 GetObject + PutObject
  |                                |   -> public-* prefix only
  |                                |   -> 15-minute TTL
  |  { accessKeyId, secretKey,     |
  |    sessionToken, expiration,   |
  |    bucket, region }            |
  |<-------------------------------|
  |                                |
  | Use creds for S3 file preview  |
  | and direct file upload         |
  v                                |
```

The `PublicDemoRole` IAM role permits `s3:GetObject` and `s3:PutObject` on `{outputs-bucket}/numa-chat/workspace/public-*`. These credentials cannot:

- Access authenticated Numa APIs (API Gateway requires Cognito JWT)
- Read real users' workspace files (scoped to `public-*` prefix)
- Access DynamoDB, Lambda, Bedrock, or any other AWS service
- Log in or impersonate any user

## Feature Flag

Controlled by the `PUBLIC_DEMO` feature flag. When `publicDemo: false` in the client config:

- No Lambda, no Function URL, no CloudFront route, no IAM role are created
- The `/demo` frontend route does not render
- Zero attack surface

Dependencies: requires `NUMA_WORKSPACE_CHAT` to be enabled (reuses the same AgentCore runtime).

## Agent Type: `numa-chat-demo`

The demo uses a dedicated agent type (`numa-chat-demo`) registered in the workspace agent's agent type system. This is forced server-side by the proxy -- the frontend cannot override it.

**What it configures:**

- Custom identity that understands it's on a demo page and actively showcases Numa's value
- Naturally suggests capabilities when relevant (document creation, data analysis, web search)
- Explains unavailable features (KB, integrations, Ops) and directs to Arcanum for the full platform
- Same SDK tools as `numa-chat` (Read, Write, Bash, code execution, file creation)
- numa CLI restricted to: `numa web` (search) and `numa docs` (extract/convert) only
- No integrations, connectors, vault, or Ops tools
- KBs and integrations forcefully restricted (empty lists, `restrict_kbs=True`)
- Lower turn limit (50 vs 200) for cost control

**Key file:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/numa_chat_demo.py`

## Frontend Rendering

The demo page (`PublicDemoChat.tsx`) reuses the same components as regular Numa workspace chat V2:

- **ChatMessages** -- full message rendering (markdown, tool cards, inline tools, thinking blocks, file references, subagents). Uses `useAuthOptional()` instead of `useAuth()` to work outside AuthProvider.
- **ChatInput** (V2 variant) -- text input, send button, file upload button
- **WorkspaceChatMarkdown** -- renders file paths as clickable inline references (requires `sub`, `outputsBucket`, `region` props)
- **WorkspaceChatFileUpload** -- drag-and-drop file upload modal (uses demo-specific `uploadFn` that notifies the demo proxy instead of the authenticated workspace proxy)
- **FilePreviewPanel** -- split-view file preview (uses demo-specific `convertDocxFn` for DOCX-to-PDF conversion via the demo proxy)
- **ResizableSplitView** -- split view for file preview
- **PageHeader** -- same header as workspace chat with "+ New Chat" button

### Streaming Architecture

The demo page handles SSE streaming directly (no `useWorkspaceChatStreaming` hook) to avoid auth dependencies. Key behaviors that match regular chat:

- **Thinking blocks**: `content_block_start` with `type: 'thinking'` adds an `inline_thinking` segment showing "Thinking..." with spinner. Removed when text or tool content starts.
- **Tool use**: `content_block_start` with `type: 'tool_use'` immediately creates a tool segment with "Working..." text. Updated with parsed input on `content_block_stop`. `toolUseMap` is populated so `processSDKEvent` can match tool results.
- **Status transitions**: `'thinking'` -> `'streaming'` (when text arrives), `'processing'`/`'thinking'` -> `'streaming'` (when tool starts). Status must not be `'processing'` or `'thinking'` when segments exist, or ChatMessages hides them behind an ephemeral spinner.
- **Credentials**: Fetched on mount (not lazily) so `outputsBucket`/`region` are available when the first response renders. Without these, `WorkspaceChatMarkdown` falls back to plain `MarkdownContent` and file references don't render as clickable links.

## Cost Controls

### Daily Limit

Configurable per client via `publicDemoDailyLimitUsd` in the client config (default: $50).

- Checked before every `/invocations` request
- Cost extracted from the `result` SSE event's `total_cost_usd` field (computed by the workspace agent)
- Accumulated in the existing `{clientName}-usage-analytics-counters` DynamoDB table under `PK=PUBLIC_DEMO, SK=COST#DATE#{YYYY-MM-DD}`
- Records have a 90-day TTL for automatic cleanup
- Returns HTTP 429 with a friendly message when exceeded

### Rate Limiting

Simple per-IP sliding window (10 requests per 60 seconds). In-memory on the Lambda -- resets on cold start. Sufficient for demo abuse prevention, not a security boundary.

### Forced Model

The proxy overrides any `modelId` in the request body with Haiku 4.5 (`anthropic.claude-haiku-4-5-20251001-v1:0`). The workspace agent regionalizes this to the correct inference profile for the deployment region. The frontend has no control over model selection.

## Client Config

```json
{
  "publicDemo": true,
  "publicDemoDailyLimitUsd": 100
}
```

The `numa-public-demo` stack is configured with:

- Region: `ap-southeast-2`
- Daily limit: $100
- Workspace chat enabled (required dependency)
- Agents, Numa Ops enabled (but not exposed in demo UI)

## Infrastructure Resources

When `publicDemo: true`, the following resources are created:

| Resource                              | Purpose                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `{client}-public-demo-proxy` Lambda   | FastAPI + LWA streaming proxy (512MB, 900s timeout)                              |
| Lambda Function URL                   | Public HTTPS endpoint (auth: NONE, RESPONSE_STREAM)                              |
| `{client}-public-demo-s3` IAM Role    | Scoped role for browser S3 credentials (GetObject + PutObject on public-\* only) |
| CloudFront origin `public-demo-proxy` | Routes `/api/public-demo/*` (no CloudFront secret, no compression)               |
| CloudFront cache behavior             | `/api/public-demo/*` with caching disabled                                       |

All resources are conditional -- they only exist when the feature flag is on.

## Key Files

### Infrastructure

- `infra/constructs/public-demo-proxy-construct.ts` -- Lambda + Function URL + IAM role construct
- `infra/stacks/numa-client-stack.ts` -- Conditional creation, config.json generation
- `infra/constructs/numa-frontend-infra-construct.ts` -- CloudFront origin + cache behavior
- `infra/capabilities-metadata.ts` -- `PUBLIC_DEMO` capability flag definition

### Backend

- `lambdas/python/public-demo-proxy/lambda_function.py` -- Proxy Lambda (FastAPI, ~500 lines)
- `services/numa-workspace-agent/numa_workspace_agent/agent_types/numa_chat_demo.py` -- Demo agent type config

### Frontend

- `numa-frontend/src/Pages/PublicDemoChat.tsx` -- Demo page component (~700 lines)
- `numa-frontend/src/Services/publicDemoChatService.ts` -- Streaming service, credential fetching, file upload, document conversion
- `numa-frontend/src/Routes.tsx` -- `/demo` route (feature-flag gated)
- `numa-frontend/src/locales/en/chat.json` -- `demo.*` translation keys
- `numa-frontend/src/assets/styles/components/_demo_chat.scss` -- Demo-specific tile layout styles

## Deployment

Standard Numa deploy process. The public demo proxy Lambda is packaged like any other Python Lambda:

```bash
# Package the Lambda
cd lambdas && bash package-python-lambda.sh python/public-demo-proxy

# Build frontend
cd numa-frontend && yarn build

# Deploy
cd infra
export TF_ENVIRONMENT=prod
export AWS_REGION=ap-southeast-2
export CLIENT_OVERRIDE=numa-public-demo
yarn cdktf deploy --auto-approve numa-numa-public-demo
```

## Future Considerations

- **Embedding:** The page is designed to be embeddable in an iframe on the Arcanum website. The layout is responsive with no sidebar or navigation.
- **Branding:** Uses default Numa branding from the `BrandingProvider`. Custom branding could be applied via the existing branding system.
- **Separate stack:** The end goal is a dedicated `numa-public-demo` stack. This is already set up -- just needs to be deployed.
