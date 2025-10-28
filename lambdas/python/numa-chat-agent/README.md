# Numa Chat Agent Lambda (HTTP streaming via LWA)

A Python Lambda that provides real-time chat streaming over HTTP using AWS Lambda Web Adapter (LWA) in ZIP mode and a FastAPI app.

## Overview

- Real-time HTTP streaming via Lambda Function URL (NDJSON)
- LWA (Lambda Web Adapter) ZIP mode; no Docker/ECR required
- FastAPI/ASGI app with two routes:
  - `POST /api/numa-chat-agent/stream` – streaming NDJSON response
  - `POST /api/numa-chat-agent/invoke` – non-streaming JSON response
- Knowledge sources: Amazon Q Business and Bedrock KB
- Cognito auth (JWT verification) and CloudFront shared secret enforced

## Key Features

- Real-time streaming over HTTP (NDJSON) with heartbeat pings (<60s)
- Non‑streaming invoke endpoint for single‑shot responses
- Cognito authentication (ID/access token validation against your User Pool)
- CloudFront shared‑secret enforcement for traffic from your FE domain
- Conversation history reconstruction from DynamoDB chat history table
- Knowledge sources: Amazon Q Business and Bedrock Knowledge Base
- Tooling: query_knowledge_base and web_search; optional MCP/Pipedream integrations

### Event Shape (WS‑era compatible)

Streaming frames are passed through in the same style we used over WebSockets. Each frame is emitted as one NDJSON object with a top‑level `type: "event"` plus the original Strands/Bedrock fields. We do not flatten nested Bedrock structures and we do not synthesize `contentBlockDelta` from other fields — the frontend handles both nested and flat shapes.

Key points:
- Start: `{ "type": "start" }`
- Events: `{ "type": "event", ...original event... }` (may include nested `event.contentBlockDelta`, top‑level `delta`, tool events, etc.)
- Heartbeats: `{ "type": "ping", "ts": 1730000000 }` (periodic to keep CloudFront alive)
- Completion: `{ "type": "completion", "status": "completed" }`

Large/noisy keys such as `messages`, `agent`, or internal traces are dropped from each frame before emitting.

## Structure

```
lambdas/python/numa-chat-agent/
├── run.sh                          # LWA startup script (handler)
├── numa_chat_agent/                # Core package
│   ├── app.py                      # FastAPI app with streaming + invoke routes
│   ├── __init__.py
│   ├── auth.py                     # Cognito verification helpers
│   ├── config.py                   # Env + model config
│   ├── dynamodb_utils.py           # Conversation history helpers
│   ├── mcp/                        # MCP orchestration + providers
│   ├── tools/                      # Built-in tool implementations
│   ├── utils.py                    # Utilities
│   └── (websocket.py removed)      # Legacy WS support removed after HTTP cutover
├── pyproject.toml                  # Poetry dependencies
└── README.md
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MODEL_ID` | Claude model to use | `us.anthropic.claude-sonnet-4-20250514-v1:0` |
| `Q_APPLICATION_ID` | Q Business application ID | - |
| `Q_RETRIEVER_ID` | Q Business retriever ID | - |
| `BEDROCK_KNOWLEDGE_BASE_ID` | Bedrock knowledge base ID | - |
| `PREFERRED_KNOWLEDGE_BASE` | `'q'` or `'bedrock'` | `'q'` |
| `CLOUDFRONT_SHARED_SECRET` | Shared secret from CloudFront custom header | required |
| `AWS_LAMBDA_EXEC_WRAPPER` | Must be `/opt/bootstrap` (LWA ZIP) | set by infra |
| `AWS_LWA_INVOKE_MODE` | Must be `response_stream` | set by infra |

## Input Format

Endpoints (behind CloudFront):
- `POST /api/numa-chat-agent/stream` – streaming NDJSON response
- `POST /api/numa-chat-agent/invoke` – non‑streaming JSON response

Required headers:
- `Authorization: Bearer <cognito-id-token>`
- `x-arcanum-cloudfront-secret: <secret>` is injected by CloudFront. If calling the Function URL directly for testing, you must supply this header and value (matches `CLOUDFRONT_SHARED_SECRET`).

Request body (JSON):
```json
{
  "prompt": "User's question",                      // required
  "conversationId": "abc123",                      // optional, loads history
  "enabledTools": ["query_knowledge_base", "web_search"],
  "enabledConnections": ["notion", "slack"],       // optional MCP connections
  "systemPrompt": "Custom system instructions",    // optional
  "modelId": "us.anthropic.claude-sonnet-4-20250514-v1:0", // optional override
  "userAuth": {                                      // optional context override
    "email": "user@example.com",
    "groups": ["admin"]
  }
}
```

Streaming response (NDJSON): one JSON object per line. Example first/last frames:
```
{"type":"start"}
{"type":"event", "delta":{"text":"Hello"}}
...
{"type":"completion","status":"completed"}
```

Non‑streaming response (JSON):
```json
{ "type": "result", "content": "Hello ...", "stop_reason": "complete" }
```

## Packaging

```bash
# From project root or lambdas/
bash lambdas/package-python-lambda.sh lambdas/python/numa-chat-agent
```

## Local Testing

Run the FastAPI app locally (bypasses LWA):

```bash
poetry run uvicorn numa_chat_agent.app:app --host 127.0.0.1 --port 8081
```

Test with httpie:

```bash
http :8081/api/numa-chat-agent/invoke Authorization:"Bearer <id-token>" prompt="Hello"
```

## Notes

- CloudFront routes `/api/numa-chat-agent/stream` to the Function URL. To expose `/api/numa-chat-agent/invoke` via CloudFront, add that path to the same origin behavior in `infra/constructs/numa-frontend-infra-construct.ts` (e.g., widen to `/api/numa-chat-agent/*`).
- The legacy WebSocket artifacts remain temporarily and will be removed after full cutover.

## MCP/Pipedream Integrations (Overview)

This Lambda can attach optional MCP/Pipedream integrations that expose SaaS actions as Strands tools. Highlights:

- Single Strands tool per integration (e.g., `google_calendar_integration`) with an action name and a natural‑language instruction.
- Tools‑only path: the router uses a prompt to build a JSON payload per action schema, validates it, and executes the MCP action.
- Dynamic props handling: if schemas indicate dynamic fields (`reloadProps`/`remoteOptions`) or the tools‑only result contains validation‑style errors (e.g., time/date field issues), the router automatically retries once via the instruction‑only sub‑agent.
- Header routing: provider constructs two transports per integration — tools‑only requests send `x-pd-tool-mode: tools-only`; sub‑agent requests omit that header.
- Static per‑tool overrides in code: force a specific action to the sub‑agent or tools‑only path in `numa_chat_agent/mcp/providers/pipedream/config.py`.
- Normalized error payloads for the frontend when not retryable:
  `{ integration, tool, type: "integration-error", error_message, error_details? }`.

See `numa_chat_agent/mcp/providers/pipedream/README.md` for architecture and details.
