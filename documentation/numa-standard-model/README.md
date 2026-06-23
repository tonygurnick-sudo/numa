# Numa Standard Model (MiMo-V2.5-Pro)

The **Numa Standard Model** is a cheap, non-Anthropic chat model offered as a selectable tier in the
workspace chat alongside the Anthropic models. The real model is **MiMo-V2.5-Pro** (Xiaomi), served by
**Novita** through an **Arcanum-owned OpenRouter account**. Everything outside the deployer-account
relay only ever sees the opaque id **`numa-standard-model`** — the real model name, the provider pin,
and the API key live in one place and never touch a client account, a trace, or the frontend.

> **Model history:** launched on DeepSeek V4 Flash; switched to **MiMo-V2.5-Pro** on 2026-06-23 after a
> 20-scenario internal benchmark showed it ~30% cheaper than DeepSeek at equal quality (4–4.5/5), with
> a longer-lived cache (full hit after ≥45 min idle) and stronger anti-fabrication/honesty. The switch
> was a one-line relay change (`upstreamModelId`) — the opaque id and everything downstream
> (container, trace, credits, frontend) were unchanged.

> Status: **feature-flag tested on HQ** (`WORKSPACE_CHAT_MODEL_SELECTION`). Not on by default for
> customers.

---

## The three tiers

Selectable in the chat input **and** per-agent (in the agent builder), gated by the per-client
`WORKSPACE_CHAT_MODEL_SELECTION` flag:

| Tier                    | Curated id                                     | Real model             | Credits          |
| ----------------------- | ---------------------------------------------- | ---------------------- | ---------------- |
| **Standard**            | `numa-standard-model`                          | MiMo-V2.5-Pro (Novita) | **¼** of Premium |
| **Premium** _(default)_ | `anthropic.claude-sonnet-4-6@medium-thinking`  | Sonnet 4.6             | baseline (1×)    |
| **Expert**              | `anthropic.claude-opus-4-6-v1@medium-thinking` | Opus 4.6               | **3×**           |

Curated list + tier constants: `numa-frontend/src/types/workspaceChatTypes.ts`
(`WORKSPACE_MODEL_OPTIONS_CURATED`, `STANDARD/PREMIUM/EXPERT_WORKSPACE_MODEL`).

---

## Architecture (Architecture Y + Option A)

```
Claude Agent SDK / CLI  ──Anthropic Messages API──▶  in-container proxy (localhost:4100)
                                                       │  translate Anthropic → OpenAI
                                                       │  mint a fresh STS GetCallerIdentity proof
                                                       ▼
                                            deployer-account RELAY (LWA Function URL)
                                                       │  validate STS proof (AgentCore role only)
                                                       │  map numa-standard-model → xiaomi/mimo-v2.5-pro
                                                       │  pin provider = novita, inject OpenRouter key
                                                       ▼
                                            OpenRouter  ──▶  Novita  ──▶  MiMo-V2.5-Pro
```

### Why an in-container proxy (not a static base URL)

The relay authenticates each request with a **freshly minted STS `GetCallerIdentity` presigned URL**
(120–300 s expiry). A static `ANTHROPIC_BASE_URL` header can't refresh that proof; the loopback proxy
mints a fresh one per upstream call. It's also where we capture the relay's true per-request
`usage.cost` (Option A — see Credits).

### Why the relay (the secrecy boundary)

- The **opaque id** `numa-standard-model` is all the container, trace, credits, and frontend ever see.
- The **real model name**, the **provider pin** (Novita), and the **OpenRouter key** live ONLY in the
  relay (deployer account). They are never injected into a client account.
- The relay only accepts the AgentCore runtime role: `ALLOWED_ROLE_REGEX =
^numa-[a-zA-Z0-9-]+-workspace-chat-agentcore$`, and the caller account must exist in
  `numa-client-config`. (Trust policy on that role is `bedrock-agentcore.amazonaws.com` only — which
  is why a local container **cannot** reach the relay; see Local-dev.)

### Key files

| Concern                                                  | Path                                                                                                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-container proxy                                       | `services/numa-workspace-agent/numa_workspace_agent/bedrock_mantle_proxy.py`                                                                                                                             |
| Standard-model SDK branch                                | `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py` (`NUMA_STANDARD_MODEL_ID`, the `if effective_model == NUMA_STANDARD_MODEL_ID:` branch in `create_agent_options`, `validate_model_id`) |
| Cost override → trace                                    | `services/numa-workspace-agent/numa_workspace_agent/sdk_runner.py` (`override_result_cost`)                                                                                                              |
| Deployer relay                                           | `lambdas/python/numa-standard-model-relay/lambda_function.py` (`UPSTREAM_MODEL_ID`, `PROVIDER_ORDER`, `_build_upstream_payload`, `_upstream_headers`) + `security_validator.py`                          |
| Relay infra                                              | `infra/constructs/numa-standard-model-relay-construct.ts`, `infra/stacks/q-apps-deployer-stack.ts`                                                                                                       |
| Client wiring (relay URL constant, flag-gated injection) | `infra/stacks/numa-client-stack.ts`, `infra/constructs/workspace-chat-agent-construct.ts`                                                                                                                |

---

## Model selection (chat + per-agent)

**Ad-hoc chat:** the chat-input selector sets the conversation's model. Premium is the default; the
selector **locks once the conversation starts** (the existing per-conversation lock). Files:
`numa-frontend/src/Components/Chat/ChatInput.tsx`, `Pages/NumaWorkspaceChatAgents.tsx`.

**Per-agent (FEAT — per-agent model selection):** an agent author picks the model in the agent
builder; it flows through wherever the agent runs:

- Stored as `model_id` on the agent record (`{client}-agents` / `{client}-user-agents`), persisted/
  returned by the agents Lambda (`lambdas/node/agents/index.ts`, validated against the curated set).
  Builder UI: `numa-frontend/src/Components/Agents/AgentCreateModal.tsx`.
- **Default = Premium** (Sonnet 4.6) for new agents and any legacy agent with no `model_id` — so
  existing agents are unchanged (defaulting to Standard would have silently moved every agent to
  MiMo).
- **Ad-hoc agent chat:** selecting an agent seeds the conversation's model from the agent and persists
  it (survives reload); the per-conversation lock then applies.
- **Scheduled runs:** the runner reads the agent's **live** `model_id` from the refreshed snapshot
  each run, so an existing schedule inherits the agent's current model from the next run onward
  (`lambdas/node/agent-schedule-runner/index.ts`).
- **Runtime precedence** in the workspace agent (`agent_config.py` `AgentConfig.model_id`, applied in
  `main.py`): `request modelId → agent's model_id → platform default (Sonnet 4.6)`.

---

## Credits

Lives in `lib/credit-pricing/` (shared by the live debit Lambda and the backfill tool).

- **Per-model value multiplier** (`credits.py` `MODEL_VALUE_MULTIPLIER`): Standard bills **0.25×** the
  value-tier credits, Expert (Opus) bills **3×**, everything else 1×. Applied per-conversation by the
  **dominant-model-by-work** function (`processing.conversation_value_multiplier`) — cost-weighted, so
  a `<synthetic>` failed turn ($0/0-tok) can't cancel the discount.
- **Cost-recovery floor** (`credits.py` `floor_credits`): rounds up to the nearest **0.1 credit**
  (`FLOOR_STEPS_PER_CREDIT = 10`). The charge is `max(value × multiplier, floor)`. Note a Standard
  agent-low run lands on 0.5 × 0.25 = **0.125** credits — the value, not the floor; charges land on a
  0.025 grid (¼ of the 0.1-multiple tiers).
- **Cost basis = the real relay cost.** `pricing.recalculate_anthropic_cost` returns `None` for
  `numa-standard-model` (it's not in the Anthropic pricing table), so `build_conversation_rows` falls
  back to the trace's `result.total_cost_usd` — the relay-reported true cost. **Credits are correct
  for Standard.**

See `documentation/credits/` for the full credit system.

---

## Cost observability — `total_cost_usd` is the source of truth

A Standard trace has a **completely different token shape** from Anthropic (large `input_tokens`, no
`cache_creation`, Novita auto-cache as `cache_read`). The real cost is written by Option A into the
trace's `result.total_cost_usd`.

> **Rule: for `numa-standard-model`, read `total_cost_usd`. Never recompute cost from tokens.** A
> naive token recompute at Anthropic/Sonnet rates overstates Standard cost **~19×** (measured: real
> $0.0048 vs $0.092, measured on the DeepSeek-era model). A correct provider-rate recompute still
> misses the model's reasoning tokens, which the relay's `usage.cost` captures.

Consumer status:
| Consumer | Cost method | Standard |
| --- | --- | --- |
| Credits (customer billing) | `total_cost_usd` fallback | ✅ correct |
| Fleet-analytics rollup (internal margin dashboard) | `total_cost_usd` for relay-priced models, token recompute for Anthropic | ✅ correct (`gather/chat.py` `_is_relay_priced` / `RELAY_PRICED_MODELS`) |
| Anthropic models everywhere | token recompute (corrects SDK cost bugs) | unchanged |

The fleet rollup re-prices historical traces on every run, so a Standard pricing fix auto-corrects
past runs once deployed.

---

## Local dev / benchmarking (local-direct mode)

The relay only trusts the real AgentCore role, so a **local container cannot reach it**. For local
testing and benchmarking, the proxy has a **dev-only direct mode** that calls OpenRouter straight
(replicating the relay's model-map + Novita pin + usage accounting), skipping the relay:

```bash
docker run ... \
  -e NUMA_STANDARD_LOCAL_DIRECT=1 \
  -e OPEN_ROUTER_TEST_KEY=sk-or-v1-... \
  numa-workspace-agent:latest
```

**Triple-gated** (the flag **and** the key **and** absence of a relay URL / client account), so it is
inert in production — the relay path is untouched. A loud `STANDARD_PROXY_LOCAL_DIRECT` warning logs
when it engages. Implementation: `bedrock_mantle_proxy.py` (`_resolve_local_direct`,
`_local_direct_payload`, `_local_direct_headers`, the branch in `_relay_stream_chunks`). See the
`workspace-agent-local-test` skill for the full run recipe.

---

## Context window (current limitation)

Novita's `mimo-v2.5-pro` endpoint supports a **1M-token context window** and **131K max output**.
But the Claude Code CLI (which the Agent SDK runs) only knows the opaque `numa-standard-model` id as a
generic **200K** model, so it auto-compacts at ~168K — throwing away most of the real window.

Findings (proven locally via the local-direct harness):

- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is **capped at the model's assumed window** → clamps to 200K for
  the opaque id. **Does not lift the window.**
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS` _does_ override the assumed window (it's the documented mechanism
  for `ANTHROPIC_BASE_URL`-proxied models) **but only with `DISABLE_COMPACT`** — i.e. no
  auto-summarisation, so the window becomes a hard ceiling.

Extending the Standard window therefore needs **manual / custom compaction** (big window + our own
summarisation pass). Tracked as **FEAT-237** (backlog).

---

## Env vars, flags, secrets

| Name                                                  | Where                           | Purpose                                                                      |
| ----------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `WORKSPACE_CHAT_MODEL_SELECTION`                      | per-client flag                 | Gates the chat + agent model selectors                                       |
| `NUMA_STANDARD_MODEL_RELAY_URL`                       | client container env            | Relay Function URL (flag-gated injection)                                    |
| `NUMA_STANDARD_MODEL_PROXY_TOKEN`                     | client container env            | Loopback placeholder API key for the proxy                                   |
| `numa-standard-model-relay/openrouter-api-key`        | Secrets Manager (deployer acct) | The OpenRouter key — runtime-fetched by the relay; never in a client account |
| `NUMA_STANDARD_MODEL_UPSTREAM`                        | relay env                       | Real model id (default `xiaomi/mimo-v2.5-pro`)                               |
| `NUMA_STANDARD_MODEL_PROVIDER_ORDER`                  | relay env                       | Provider pin (default `novita`)                                              |
| `NUMA_STANDARD_LOCAL_DIRECT` + `OPEN_ROUTER_TEST_KEY` | local dev only                  | Enable local-direct mode                                                     |

**Rotate the OpenRouter key:** `aws secretsmanager put-secret-value --secret-id
numa-standard-model-relay/openrouter-api-key --secret-string '<key>' --profile arcanum-q-deployer-prod
--region us-east-1` (runtime fetch, no redeploy; takes effect as relay containers recycle).

---

## Operations / debugging

- **Container logs** (`/numa/{client}/workspace-chat-agent`, profile `q-demo`): filter
  `STANDARD_MODEL_ROUTE`, `STANDARD_PROXY_*`, `COST`, `STREAM_COMPLETE`.
- **Relay logs** (`/aws/lambda/numa-standard-model-relay`, profile `arcanum-q-deployer-prod`): filter
  `STANDARD_MODEL_RELAY` — logs the resolved `client_name` for OpenRouter attribution (`Numa - {client}`).
- **Verify cost from a trace** (`s3://numa-{client}-outputs/numa-chat/workspace/<sub>/conversations/<id>/_system/trace.jsonl`):
  the `result` event's `model = numa-standard-model` and `total_cost_usd` is the real charge; the
  MiMo token shape (large `input_tokens`, `cache_creation = 0`) is the tell.
- **Deploy split:** the relay lives in the **deployer account** (`q-apps-deployer-stack`); the proxy,
  credit lib, agents, and frontend ship with the **per-client** deploy.
