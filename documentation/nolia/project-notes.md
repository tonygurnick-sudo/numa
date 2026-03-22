# Nolia — Project Notes

## Current Status (March 2026)

### What's Built

- V2 App architecture: orchestrator, all phases, prompts migrated from V1
- TER/CER assessment pipeline (5 phases, sequential execution)
- Automatic rules generation pipeline
- Nolia whitelabel frontend (Next.js + Express proxy)
- Jakarta region support (cross-region AgentCore, `global.*` models)
- KB management with wizard-based creation
- Additional Cognito client IDs for whitelabel auth
- Nolia-branded Cognito emails (welcome, password reset) — `lambdas/node/nolia-cognito-email-handler/`. Originally hotfixed by Tony directly in AWS (`moh-platform-cognito-custom-message`), now tracked in repo and deployed via CDKTF. Conditionally wired for clients with a `getnolia.io` email domain.

### Current Scope

**Phase 1 launch:** Document validation (TER/CER) using Global + Procurement Activity KBs. This is the only pairing actively being built.

**Not yet in scope:**

- ToR validation (Global + Project)
- Vendor assessment (Global + Procurement Activity)
- ToR/RFP creation (Global + Project)
- Analytics & dashboards

### Known Issues

**KB S3 Structure Mismatch:** The new KB wizard creates a different S3 folder structure than the legacy manually-created KBs. `workspace_setup.py` has been updated to support both, but there are still edge cases:

| Component        | Old KBs                       | New KBs (wizard)                        |
| ---------------- | ----------------------------- | --------------------------------------- |
| Document folder  | `global-knowledge-base/`      | `documents/`                            |
| Procurement docs | `procurement-knowledge-base/` | `pre-rfx/`, `rfx/`, `supporting/`       |
| Output template  | `output-template.md` at root  | `templates/{any-filename}` in subfolder |

See `workspace_setup.py` in the Nolia agent types for the current download logic.

**STS Token Expiry:** Local testing with Docker uses STS session tokens that expire after ~15 minutes. The Nolia pipeline takes 20-30+ minutes with real documents, causing `ExpiredToken` errors mid-pipeline. In production (AgentCore), this isn't an issue because the container has IAM role-based credentials.

**PDF Extraction in Jakarta:** The extraction Lambda (`extract-content-from-file`) uses vision models to extract text from PDF pages. In the Nolia account (Jakarta), direct Bedrock access is not available — the Lambda must use cross-account credentials via the `BEDROCK_ACCOUNT` env var to assume the `bedrock-quota-sharing` role in the shared account (q-demo). The vision model is `global.amazon.nova-2-lite-v1:0` (set via `visionModelType: "nova-pro"` in client config). Claude 3 Haiku is not available in this account.

## Deployment

### Environments

| Environment        | Client Name         | Account         | Region         | AgentCore Region | Notes                               |
| ------------------ | ------------------- | --------------- | -------------- | ---------------- | ----------------------------------- |
| Dev (e.g. nd-labs) | `{your-dev-client}` | (dev account)   | us-east-1      | us-east-1        | Each dev has their own client stack |
| Nolia Production   | `nolia-id-gov-moh`  | (Nolia account) | ap-southeast-3 | ap-southeast-2   | Jakarta data, Sydney compute        |

**Client name matters:** All Numa resource names are prefixed with the client name. For Nolia production, the client name is `nolia-id-gov-moh`. Examples:

- S3 buckets: `numa-{clientName}-outputs`, `numa-{clientName}-data`
- DynamoDB tables: `numa-{clientName}-chat-history`, `{clientName}-v2-app-runs`
- Log groups: `/numa/{clientName}/workspace-chat-agent`
- Lambdas: `{clientName}-workspace-chat-agent-proxy`, etc.

### Log Groups

**Dev (replace `{clientName}` with your dev client, e.g. `nd-labs`):**

```bash
AWS_PROFILE=q-demo aws logs tail "/numa/{clientName}/workspace-chat-agent" --follow
```

**Nolia production:**

```bash
AWS_PROFILE=nolia-moh aws logs tail "/numa/nolia-id-gov-moh/workspace-chat-agent" --follow --region ap-southeast-3
```

**Other useful log groups:**

- V2 Apps API: `/numa/{clientName}-v2-apps`
- Workspace Proxy: `/aws/lambda/{clientName}-workspace-chat-agent-proxy`
- Vendedlogs: `/aws/vendedlogs/bedrock-agentcore/numa-{clientName}-workspace-chat`

### Looking Up Test KBs

Each dev client has its own KBs. Look them up with:

```bash
AWS_PROFILE=q-demo aws dynamodb scan --table-name numa-{clientName}-knowledge-bases --region us-east-1
```

### Deployment Process

**Frontend (Nolia whitelabel):** Commits to `main` auto-deploy via CI/CD → Docker build → ECR → ECS update.

**Backend (Numa):** Package workspace agent → deploy via CDKTF:

```bash
cd services && ./package-service.sh numa-workspace-agent
# Then deploy via CDKTF to target client
```

## Prompt Generalisation (TER vs CER)

Per discussion with Matt:

- **Document type detection:** EDA phase auto-detects TER vs CER from content (financial evaluation sections → CER)
- **Generalised compliance:** Analysis phases handle both types — TER focuses on technical evaluation, CER adds financial evaluation coverage
- **Report adapts:** Output template from Global KB drives report structure — TER KB produces TER-shaped reports, CER KB produces CER-shaped reports
- **No extra dropdown needed:** User selection of Global KB implicitly indicates document type

## Architecture Decisions

### V1 → V2 Migration

Migrated from Step Functions + claude-code-agent Lambda (V1) to workspace agent on AgentCore MicroVMs (V2). Key benefits:

- **Shared workspace:** Phases share filesystem directly (no S3 upload/download between phases)
- **Sequential execution:** Phases 2+3 run one after the other (see below)
- **Persistent MicroVM:** Same container for all phases (no cold starts between phases)
- **Custom orchestrator:** Python-level control over pipeline flow

### Why Phases 2+3 Run Sequentially (Not in Parallel)

Phases 2 (Global Rules) and 3 (Domain Rules) originally ran in parallel via `asyncio.gather()`. This caused intermittent silent failures on large documents — the pipeline would hang with no error logged.

**Root cause:** AgentCore MicroVMs have hard limits of **2 vCPU / 8 GB RAM**. Each `query()` call spawns a full Node.js CLI subprocess (~500MB-1.5GB), and each phase's agent spawns up to 5 subagents (each another subprocess). Running two phases in parallel meant 2 parent processes + up to 10 subagent processes competing for 2 vCPU and 8 GB RAM. The Linux OOM killer would SIGKILL the process — which can't be caught or logged, causing the silent death.

Running sequentially ensures only one phase's subprocesses are active at a time. A single phase with 5 subagents fits comfortably in 8 GB. Adds ~10-15 minutes to total pipeline time but eliminates the silent OOM kills.

**Subagent cap:** Each phase is capped at a maximum of 5 subagents (set in prompts). All work must be divided across these 5 — no batching (run 5, wait, run more).

**Memory logging:** The orchestrator logs `NOLIA_MEMORY` events at each phase boundary using Python's `resource` module, tracking `max_rss_mb` for the parent process.

### Cross-Account Bedrock for Extraction

The Nolia account (Jakarta, `ap-southeast-3`) does not have direct Bedrock model access enabled. Two services need cross-account Bedrock calls via the `bedrock-quota-sharing` role in the shared account (`905418183804`):

1. **Workspace agent** — handled by AgentCore/Claude SDK using `BEDROCK_ACCOUNT` env var
2. **Extraction Lambda** (`extract-content-from-file`) — uses `BEDROCK_ACCOUNT` env var to assume the cross-account role and create a Bedrock client with temporary credentials

The extraction model is `global.amazon.nova-2-lite-v1:0` (Nova 2 Lite with global cross-region prefix). Set via `visionModelType: "nova-pro"` in client config. The Nova format detection in `fm_vision_extraction.py` uses `"amazon.nova" in model_id` to handle the `global.` prefix.

### Why S3 Folder KBs (Not Bedrock KBs)

Bedrock Knowledge Bases aren't available in Jakarta (ap-southeast-3). Nolia uses S3 folder-based KBs where the agent reads documents directly from the filesystem after downloading from S3.

### Cross-Region AgentCore

AgentCore runs in Sydney (ap-southeast-2) because it's unavailable in Jakarta. Data stays in Jakarta. The workspace agent proxy Lambda in Jakarta makes cross-region calls to AgentCore in Sydney. Bedrock uses `global.*` inference profiles for cross-region model access.

## Run Results & Cost Reporting

### S3 Result Location

Each completed run writes `_result.json` to the outputs bucket:

```
s3://numa-{clientName}-outputs/v2-apps/nolia/{user_sub}/{runId}/_result.json
```

For Nolia production: `numa-nolia-id-gov-moh-outputs`

The two UUIDs in the path are:

1. `{user_sub}` — Cognito user sub (identifies the user)
2. `{runId}` — conversation/run ID (unique per assessment run)

### Result Schema

```json
{
  "status": "completed",
  "text": "...",
  "artifacts": [
    { "type": "file", "path": "outputs/Final_Evaluation_Report_...md" },
    { "type": "file", "path": "outputs/global_rules_compliance.csv" }
  ],
  "usage": {
    "num_turns": 83,
    "total_cost_usd": 33.58,
    "duration_ms": 4220644
  },
  "steps": [
    {
      "step": "nolia-eda",
      "step_number": 1,
      "status": "completed",
      "text": "...",
      "usage": {
        "num_turns": 13,
        "total_cost_usd": 9.11,
        "duration_ms": 865924,
        "is_error": false,
        "input_tokens": 2629,
        "output_tokens": 17169,
        "cache_read_tokens": 138400,
        "cache_creation_tokens": 123725
      }
    }
  ]
}
```

Key fields:

- `usage.duration_ms` — total pipeline wall-clock time (divide by 60000 for minutes)
- `usage.total_cost_usd` — sum of all Bedrock API costs across all phases
- `steps[]` — per-phase breakdown with cost, duration, token usage, and turn count
- `artifacts[]` — list of files written to `/workdir/outputs/` (may contain duplicates from multiple phases)

### Listing All Runs

```bash
# List all user_sub folders
AWS_PROFILE=nolia-moh aws s3 ls s3://numa-nolia-id-gov-moh-outputs/v2-apps/nolia/ \
  --region ap-southeast-3

# List runs for a specific user
AWS_PROFILE=nolia-moh aws s3 ls s3://numa-nolia-id-gov-moh-outputs/v2-apps/nolia/{user_sub}/ \
  --region ap-southeast-3

# Download a specific result
AWS_PROFILE=nolia-moh aws s3 cp \
  s3://numa-nolia-id-gov-moh-outputs/v2-apps/nolia/{user_sub}/{runId}/_result.json - \
  --region ap-southeast-3 | python3 -m json.tool
```

### Other Files Per Run

```
v2-apps/nolia/{user_sub}/{runId}/
├── _result.json              # Final pipeline result (success/failure)
├── _progress.json            # Phase progress events (for frontend polling)
├── extracted_document.json   # Vision-extracted PDF content
├── output-template.md        # Resolved output template from KB
├── uploads/                  # User-uploaded PDF
├── tmp/                      # Intermediate phase outputs (CSVs, manifests, phase notes)
└── outputs/                  # Final report + compliance CSVs
```

## Related Resources

- **Developer skill:** `.claude/skills/nolia-developer-guide/` — full dev context, key files, testing, log tracing
- **Local testing skill:** `.claude/skills/workspace-agent-local-test/` — Docker testing guide + Nolia-specific notes
- **Backend code:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`
- **Nolia frontend:** `numa-whitelabel-investigation/` (separate repo)
