# Nolia V2 App — Technical Architecture

## Request Flow (End-to-End)

The full API call chain from the Nolia frontend through to result delivery:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. NOLIA FRONTEND (Next.js + Express proxy)                                │
│    User uploads PDF, selects KBs, clicks "Run Analysis"                    │
│    Express proxy forwards to Numa API with Cognito auth + CloudFront secret│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ POST /api/v2-apps/runs
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. V2 APPS API LAMBDA (lambdas/node/v2-apps-api)                          │
│    - Creates run record in DynamoDB ({clientName}-v2-app-runs)             │
│    - Stores: runId, appId, agentType, status=PENDING, metadata            │
│    - Invokes workspace-chat-agent-proxy Lambda (RequestResponse)           │
│    - Passes: agentType, conversationId, metadata, uploadPrefixes           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ Lambda invoke (sync)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. WORKSPACE CHAT AGENT PROXY (lambdas/python/workspace-chat-agent-proxy)  │
│    - Routes request to AgentCore MicroVM by conversationId                 │
│    - Creates new session if none exists: conv-{conversationId}             │
│    - For fire-and-forget: returns immediately after session creation       │
│    - Cross-region: proxy in Jakarta → AgentCore in Sydney                  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ AgentCore SDK invoke
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. AGENTCORE MICROVM (services/numa-workspace-agent)                       │
│    - Per-conversation isolated MicroVM (1hr idle, 8hr max)                 │
│    - FastAPI /invocations endpoint receives request                        │
│    - Resolves agent type → "nolia-compliance" → custom orchestrator        │
│    - Calls run_nolia_pipeline() with request_metadata                      │
│                                                                            │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │ PIPELINE ORCHESTRATOR (orchestrator.py)                          │     │
│    │                                                                  │     │
│    │  1. workspace_setup() — download KBs, extract PDF, copy template│     │
│    │  2. Phase 1 (EDA) — document structure mapping                  │     │
│    │  3. Phase 2 (Global)   — global rules compliance                 │     │
│    │  4. Phase 3 (Domain)  — domain rules compliance (sequential)    │     │
│    │  5. Phase 4a (Report generate)                                   │     │
│    │  6. Phase 4b (Report review)                                     │     │
│    │  7. Phase 5 (Translate) — conditional, if non-English            │     │
│    └──────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│    - Writes _result.json to S3 on completion (success or failure)          │
│    - Writes _progress.json to S3 throughout for frontend polling           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ S3 write
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. RESULT DELIVERY                                                          │
│    S3 key: v2-apps/nolia/{user_sub}/{runId}/_result.json                   │
│    Frontend polls: GET /api/v2-apps/runs/{runId}                           │
│    V2 Apps API reads DynamoDB status + S3 result                           │
│    Final report at: .../outputs/Final_Evaluation_Report_*.md               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## How the V2 Apps Architecture Works

Nolia runs on Numa's V2 Apps platform — workspace agents on AgentCore MicroVMs. This replaces the V1 architecture (Step Functions + claude-code-agent Lambda).

### Key Concepts

**AgentCore MicroVM:** Each conversation gets its own isolated MicroVM running the `numa-workspace-agent` Docker container. The container runs a FastAPI app that receives requests at `/invocations` and orchestrates Claude Agent SDK calls.

**Agent Type Registry:** The workspace agent has a registry of agent types. `nolia-compliance` is registered as a type with a custom `pipeline_orchestrator` that replaces the default sequential pipeline.

**Fire-and-Forget:** Nolia uses `fire-and-forget` response mode — the proxy returns immediately, the container runs the pipeline in the background, writes results to S3, and the frontend polls for completion.

**Shared Workspace:** All phases run in the same MicroVM and share the `/workdir/` filesystem. No S3 upload/download between phases (unlike V1). This is faster and simpler.

### Metadata Passthrough

The Nolia-specific configuration (KBs, assessment type, language) flows through the system as `metadata`:

```
Frontend form values
    ↓ POST body
Express proxy → Numa API
    ↓ request body
V2 Apps API → DynamoDB (stored in run record) + proxy payload
    ↓ metadata field
Workspace Agent Proxy → AgentCore
    ↓ body.metadata
Main.py → orchestrator(request_metadata=metadata)
    ↓ extracted fields
Orchestrator reads: assessment_type, output_language, global_kb, procurement_kb, project_kb
```

## Workspace Setup

Before any phase runs, `workspace_setup.py` prepares the environment:

1. **Create directories:** `/workdir/tmp/`, `/workdir/outputs/`, `/workdir/knowledge-bases/`
2. **Download KB documents** from the DATA bucket (`s3://{data-bucket}/documents/kb-{uuid}/`)
   - Supports both new structure (`documents/`, `pre-rfx/`, `rfx/`, `supporting/`) and legacy (`global-knowledge-base/`)
3. **Download rules files** (`global-rules.md`, `procurement-rules.md`, etc.) to `/workdir/knowledge-bases/`
4. **Resolve output template** (priority: domain KB → global KB → bundled default)
5. **Extract document** (if PDF → invoke `extract-content-from-file` Lambda for parallel chunk extraction)

## Phase Execution Pattern

Each phase is an `AgentTypeConfig` registered in the agent type registry. The orchestrator runs phases by calling `run_claude_sdk()` with each phase's config:

```python
async def _run_step(step_type_id, prompt, conversation_id, step_suffix, **kwargs):
    step_config = get_agent_type(step_type_id)
    step_conversation_id = f"{conversation_id}-step-{step_suffix}"

    # Setup MCP tools for this step
    tools = await setup_agent_tools(step_config, ...)

    # Run Claude Agent SDK
    result = await run_claude_sdk(
        prompt=prompt,
        system_prompt=step_config.system_prompt_builder(**kwargs),
        tools=tools,
        model_id=step_config.default_model or kwargs.get("model_id"),
        max_turns=step_config.max_turns,
        conversation_id=step_conversation_id,
        ...
    )
    return result
```

**Sequential execution:** Phases 2 and 3 run one after the other. They were previously parallel (`asyncio.gather()`) but this caused OOM kills on AgentCore's 2 vCPU / 8 GB RAM limit — see project-notes.md for details.

```python
global_result = await _run_step("nolia-global", ...)
# check error, then:
domain_result = await _run_step(phase3_type, ...)  # "nolia-procurement" or "nolia-project"
```

## S3 Data Layout

### Outputs Bucket (per-run artifacts)

```
numa-{clientName}-outputs/
└── v2-apps/nolia/{user_sub}/{runId}/
    ├── uploads/                          # User-uploaded PDF
    │   └── document.pdf
    ├── _result.json                      # Final pipeline result (success/failure)
    ├── _progress.json                    # Progress tracking for frontend polling
    ├── outputs/                          # Final deliverables
    │   └── Final_Evaluation_Report_*.md
    └── (workspace files remain in MicroVM, not uploaded per-phase like V1)
```

### Data Bucket (knowledge bases)

```
numa-{clientName}-data/
└── documents/kb-{uuid}/
    ├── documents/                # KB documents (policies, guidelines)
    ├── pre-rfx/                  # Pre-RFx context (procurement KBs)
    ├── rfx/                      # RFx document (procurement KBs)
    ├── supporting/               # Supporting documents (procurement KBs)
    ├── templates/                # Output template
    ├── global-rules.md           # Generated rules (or procurement-rules.md / project-rules.md)
    └── .metadata.json            # KB metadata
```

## Workspace Directory (inside MicroVM)

```
/workdir/
├── uploads/                              # Uploaded document + extracted JSON
│   ├── document.pdf
│   └── extracted_document.json
├── knowledge-bases/
│   ├── global-knowledge-base/            # Global KB docs
│   ├── procurement-knowledge-base/       # Procurement KB docs (or project-)
│   ├── global-rules.md                   # Rules files
│   └── procurement-rules.md
├── output-template.md                    # Resolved output template
├── tmp/                                  # Shared intermediate outputs
│   ├── document_manifest.json            # Phase 1
│   ├── document_summary.md               # Phase 1
│   ├── page_index.csv                    # Phase 1
│   ├── global_rules_compliance.csv       # Phase 2
│   ├── global_rules_summary.md           # Phase 2
│   ├── global-phase-notes.md             # Phase 2
│   ├── procurement_rules_compliance.csv  # Phase 3
│   ├── procurement_rules_summary.md      # Phase 3
│   ├── procurement-phase-notes.md        # Phase 3
│   ├── technical_scoring_analysis.json   # Phase 3
│   └── recurring_issues.csv              # Phase 3
└── outputs/                              # Final deliverables
    └── Final_Evaluation_Report_*.md      # Phase 4
```

## Model Configuration

| Phase                         | Model                  | Max Turns | Thinking Tokens |
| ----------------------------- | ---------------------- | --------- | --------------- |
| EDA (Phase 1)                 | Sonnet 4.6 (inherited) | 40        | 10,000          |
| Global (Phase 2)              | Sonnet 4.6             | 40        | 10,000          |
| Procurement/Project (Phase 3) | Sonnet 4.6             | 40        | 10,000          |
| Report Generate (Phase 4a)    | Sonnet 4.6             | 50        | 10,000          |
| Report Review (Phase 4b)      | Sonnet 4.6             | varies    | 10,000          |
| Translate (Phase 5)           | Haiku 4.5              | 25        | 10,000          |

In Jakarta, all models use `global.*` prefixed inference profiles (e.g., `global.anthropic.claude-sonnet-4-6`) routed via cross-region inference.

## Key Backend Files

| File                                                                                       | Purpose                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/orchestrator.py`     | Pipeline orchestration — phase sequencing, progress tracking, memory logging |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/workspace_setup.py`  | Pre-pipeline setup — KB download, extraction, template resolution            |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/nolia_compliance.py` | Parent agent type config (`nolia-compliance`)                                |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/phase_*.py`          | Individual phase configs                                                     |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/prompts/`            | All phase prompts (base + addendums)                                         |
| `lambdas/node/v2-apps-api/index.ts`                                                        | V2 Apps API — run CRUD, proxy to workspace agent                             |
| `infra/constructs/workspace-chat-agent-construct.ts`                                       | AgentCore infra (ECR, IAM, env vars)                                         |
| `infra/constructs/workspace-chat-agent-proxy-construct.ts`                                 | Proxy Lambda infra                                                           |

## Key Frontend Files (Nolia Whitelabel)

| File (in numa-whitelabel-investigation/)      | Purpose                       |
| --------------------------------------------- | ----------------------------- |
| `frontend/src/app/assess/*/page.tsx`          | Assessment upload pages       |
| `frontend/src/services/v2-apps-service.ts`    | V2 Apps API client            |
| `backend/src/controllers/NoliaController.ts`  | Proxy to Numa nolia endpoints |
| `backend/src/controllers/V2AppsController.ts` | V2 Apps proxy controller      |

## Performance Benchmarks

From a 1-page test document:

| Phase             | Duration    | Cost       | Turns   |
| ----------------- | ----------- | ---------- | ------- |
| EDA               | ~2 min      | $0.29      | ~8      |
| Global Rules      | ~15 min     | $0.89      | ~20     |
| Procurement Rules | ~4 min      | $0.50      | ~15     |
| Report Generate   | ~3 min      | $0.32      | ~5      |
| Report Review     | ~4 min      | $0.86      | ~10     |
| **Total**         | **~26 min** | **~$2.86** | **~72** |

Larger documents (100+ pages) use sub-agents for parallel analysis within each phase, increasing cost but keeping duration manageable.
