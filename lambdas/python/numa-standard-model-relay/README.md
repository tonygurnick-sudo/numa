# numa-standard-model-relay

Deployer-account streaming relay for the **Numa Standard Model** (opaque id
`numa-standard-model`). This is the **single audited egress chokepoint** and the
**only** place in the codebase that knows the real upstream behind that id.

## Why it exists

Workspace chat can run a cheap non-Anthropic model surfaced to client accounts
under the opaque id `numa-standard-model`. The real upstream
(`xiaomi/mimo-v2.5-pro` via OpenRouter → Novita) and the OpenRouter API
key must **never** touch a client account. So the per-tenant AgentCore container
reaches this relay cross-account (validated via STS proof, exactly like
`numa-email-sender`), and the relay holds the secret mapping + key.

The strings `xiaomi` / `mimo` / `novita` and the OpenRouter key appear nowhere else in
the repo — only here (contracts.md §1).

## Flow

```
SDK → in-container proxy (Anthropic→OpenAI) → THIS relay → OpenRouter → Novita
        (127.0.0.1:4100, mints fresh STS proof)   │
                                                    ├─ validate STS proof FIRST
                                                    ├─ numa-standard-model → real id
                                                    ├─ pin provider {order:[novita],
                                                    │     allow_fallbacks:true,
                                                    │     data_collection:deny}
                                                    ├─ inject Bearer <OPENROUTER key>
                                                    └─ stream SSE back + usage{…,cost}
```

## Auth

- Caller: the AgentCore runtime role `numa-{clientName}-workspace-chat-agentcore`.
- The relay validates the `x-numa-sts-proof` header **before** opening the
  upstream stream: SSRF allowlist (`sts.{region}.amazonaws.com`) → server-side
  fetch → parse `Account`+`Arn` → role regex
  `numa-.*-workspace-chat-agentcore` → account ∈ `numa-client-config`.
- Function URL is `authorizationType: NONE` + `invokeMode: RESPONSE_STREAM`; the
  in-handler STS validation is the gate. An optional `x-numa-relay-secret`
  header is supported as defence-in-depth.

## Error handling

Every upstream failure (provider down, OpenRouter 5xx, auth) is mapped to an
**opaque** SSE error: _"The Standard model is temporarily unavailable — switch
to Premium or try again shortly."_ Provider names never reach the client; the
real cause is logged here (deployer account) only.

## Env vars

| Var                                  | Purpose                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `OPENROUTER_API_KEY`                 | Bearer token (from deployer Secrets Manager).                      |
| `CLIENT_CONFIG_TABLE_NAME`           | `numa-client-config` (account allowlist scan).                     |
| `NUMA_STANDARD_MODEL_ID`             | Opaque id the proxy sends (default `numa-standard-model`).         |
| `NUMA_STANDARD_MODEL_UPSTREAM`       | Real upstream id (default `xiaomi/mimo-v2.5-pro`).                 |
| `NUMA_STANDARD_MODEL_PROVIDER_ORDER` | Comma-separated provider pin (default `novita`).                   |
| `NUMA_STANDARD_MODEL_RELAY_SECRET`   | Optional shared-secret gate (defence in depth).                    |
| `OPENROUTER_BASE_URL`                | Override OpenRouter base (default `https://openrouter.ai/api/v1`). |

## Packaging

ZIP Lambda with the Lambda Web Adapter layer (LWA), `run.sh` launches uvicorn:

```bash
cd lambdas && bash package-python-lambda.sh python/numa-standard-model-relay
```

> Deployer-account Lambda — **not** part of the per-client Numa deploy, so it is
> **not** in the `.gitlab-ci.yml` per-client matrices (per CLAUDE.md). Infra
> build/deploy is Nathan's.
