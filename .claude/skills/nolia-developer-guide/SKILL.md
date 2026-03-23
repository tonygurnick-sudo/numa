---
name: nolia-developer-guide
description: Full context for developing the Nolia backend (compliance pipeline, rules generation) and understanding the Nolia frontend. Covers architecture, key files, testing, log tracing, and debugging. Use when working on Nolia agent types, prompts, orchestrator, workspace setup, KB integration, or any Nolia-related task.
---

# Nolia Developer Guide

## What Is Nolia

Nolia is an AI-powered procurement compliance platform built on Numa's V2 Apps architecture. It validates World Bank procurement documents (TER/CER) against compliance rules. The backend runs on AgentCore MicroVMs using the `numa-workspace-agent` service with a custom pipeline orchestrator.

For full documentation, see `documentation/nolia/` (overview, v2-app-architecture, ter-cer-assessment, automatic-rules-generation, project-notes, NOLIA.md).

---

## Architecture Summary

```
Nolia Frontend (Next.js + Express proxy, separate repo: numa-whitelabel-investigation)
    ↓ POST /api/v2-apps/runs (or /api/v2-apps/rules-generation)
V2 Apps API Lambda (lambdas/node/v2-apps-api)
    ↓ Lambda invoke
Workspace Agent Proxy Lambda
    ↓ AgentCore SDK
AgentCore MicroVM (services/numa-workspace-agent)
    ↓ resolves agent type
Pipeline Orchestrator (orchestrator.py or rules_orchestrator.py)
    ↓ runs phases sequentially
Claude Agent SDK calls per phase
    ↓ results
S3 (_result.json) → frontend polls
```

**Two main actions:**

1. **Document Assessment** (`nolia-compliance`): 5-phase pipeline — EDA → Global → Domain → Report → Translate
2. **Rules Generation** (`nolia-rules-generator`): 2-phase pipeline — Extract → Review → upload rules to S3

---

## Key Backend Files

### Nolia Agent Types (`services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`)

| File                       | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `__init__.py`              | Imports all modules, triggers registration                                        |
| `orchestrator.py`          | Assessment pipeline: workspace setup → EDA → Global → Domain → Report → Translate |
| `rules_orchestrator.py`    | Rules generation pipeline: download KB → extract rules → review → upload to S3    |
| `workspace_setup.py`       | Pre-pipeline: download KBs from DATA bucket, extract PDF, resolve output template |
| `nolia_compliance.py`      | Parent config for `nolia-compliance` agent type                                   |
| `nolia_rules_generator.py` | Parent config for `nolia-rules-generator` agent type                              |
| `phase_eda.py`             | Phase 1: Document structure analysis                                              |
| `phase_global.py`          | Phase 2: Global rules compliance                                                  |
| `phase_procurement.py`     | Phase 3a: Procurement rules (for evaluation-report)                               |
| `phase_project.py`         | Phase 3b: Project rules (for terms-of-reference)                                  |
| `phase_report_generate.py` | Phase 4a: Report generation                                                       |
| `phase_report_review.py`   | Phase 4b: Report review and refinement                                            |
| `phase_translate.py`       | Phase 5: Translation (conditional)                                                |
| `phase_rules_extract.py`   | Rules gen Phase 1: Extract rules (3 category-specific configs)                    |
| `phase_rules_review.py`    | Rules gen Phase 2: Review and cite rules                                          |
| `prompts/`                 | All phase prompt addendums                                                        |

### Prompts (`prompts/` directory)

| File                   | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `base.py`              | Shared Nolia identity, workspace instructions, tool usage guidance             |
| `eda.py`               | Phase 1 prompt — document mapping, structure analysis                          |
| `global_rules.py`      | Phase 2 prompt — global compliance checking                                    |
| `procurement_rules.py` | Phase 3a prompt — procurement deep-dive                                        |
| `project_rules.py`     | Phase 3b prompt — ToR/project analysis                                         |
| `report.py`            | Phase 4 prompts — generation + review (4 variants: eval/tor x generate/review) |
| `translate.py`         | Phase 5 prompt — translation with formatting preservation                      |
| `rules_generation.py`  | Rules gen prompts — extract + review addendums                                 |

### Infrastructure

| File                                                       | Purpose                                      |
| ---------------------------------------------------------- | -------------------------------------------- |
| `infra/constructs/workspace-chat-agent-construct.ts`       | AgentCore container config, env vars, IAM    |
| `infra/constructs/workspace-chat-agent-proxy-construct.ts` | Proxy Lambda                                 |
| `lambdas/node/v2-apps-api/index.ts`                        | V2 Apps API — run CRUD, metadata passthrough |

### Nolia Frontend (numa-whitelabel-investigation/, separate repo)

| File                                                 | Purpose                 |
| ---------------------------------------------------- | ----------------------- |
| `frontend/src/app/assess/*/page.tsx`                 | Assessment upload pages |
| `frontend/src/services/v2-apps-service.ts`           | V2 Apps API client      |
| `frontend/src/services/knowledge-base-service.ts`    | KB management           |
| `backend/src/controllers/NoliaController.ts`         | Nolia proxy endpoints   |
| `backend/src/controllers/V2AppsController.ts`        | V2 Apps proxy           |
| `backend/src/controllers/KnowledgeBaseController.ts` | KB CRUD                 |

---

## Request Metadata (Frontend → Backend)

The Nolia frontend sends these fields in the `metadata` object:

```json
{
  "assessment_type": "evaluation-report", // or "terms-of-reference"
  "output_language": "english", // or "bahasa-indonesia"
  "global_kb": "9df246a7-925f-4cfc-a964-...", // KB UUID
  "procurement_kb": "d3788c3d-7e85-...", // KB UUID (for eval reports)
  "project_kb": "" // KB UUID (for ToR)
}
```

For rules generation:

```json
{
  "kb_id": "9df246a7-...",
  "kb_category": "global", // or "procurement" or "project"
  "kb_name": "My Global KB"
}
```

---

## Testing Locally

**Use the workspace-agent-local-test skill** (`.claude/skills/workspace-agent-local-test/`) for full Docker container testing instructions.

**Quick summary:**

1. Build: `cd services && ./package-service.sh numa-workspace-agent`
2. Load: `docker load -i infra/assets/artifacts/numa-workspace-agent/image.tar`
3. Get creds: `eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"`
4. Run container with env vars (see `NOLIA-TEST-NOTES.md` in the local test skill)
5. Test: `curl -s -X POST http://localhost:8080/invocations ...`

**Important env vars for Nolia testing:**

- `DATA_BUCKET_NAME` (NOT `DATA_BUCKET`) — KB document storage
- `EXTRACT_CONTENT_LAMBDA_ARN` — for PDF extraction
- `OUTPUTS_BUCKET_NAME` — for result storage

**Example test KBs (nd-labs dev stack — yours may differ):**

- Global: `9df246a7-925f-4cfc-a964-a6da9788ce68`
- Procurement: `d3788c3d-7e85-4de3-805a-b8c73f6ddaf3`
- Project: `5a8fc87f-6c8d-45d3-896e-82ffd2ba367b`

**Example assessment test request:**

```bash
curl -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "x-user-sub: nathan-local-test" \
  -d '{
    "action": "chat",
    "prompt": "Review this evaluation report for compliance.",
    "conversationId": "nathan-local-test-nolia-001",
    "type": "nolia-compliance",
    "metadata": {
      "assessment_type": "evaluation-report",
      "global_kb": "9df246a7-925f-4cfc-a964-a6da9788ce68",
      "procurement_kb": "d3788c3d-7e85-4de3-805a-b8c73f6ddaf3",
      "project_kb": "",
      "output_language": "english"
    }
  }'
```

---

## Log Tracing

### Environments and Client Names

| Environment        | Client Name         | AWS Profile | Region         |
| ------------------ | ------------------- | ----------- | -------------- |
| Dev (e.g. nd-labs) | `{your-dev-client}` | `q-demo`    | us-east-1      |
| Nolia Production   | `nolia-id-gov-moh`  | `nolia-moh` | ap-southeast-3 |

**Client name drives all resource naming:** S3 buckets (`numa-{clientName}-outputs`), DynamoDB tables (`numa-{clientName}-chat-history`, `{clientName}-v2-app-runs`), log groups (`/numa/{clientName}/workspace-chat-agent`), Lambdas (`{clientName}-workspace-chat-agent-proxy`).

### IMPORTANT: Timestamps are UTC

All Nolia log timestamps and DynamoDB `createdAt`/`completedAt` fields \
are in **UTC**. When querying CloudWatch with `--start-time` / \
`--end-time` (epoch milliseconds), always use UTC-aware datetimes:

```python
# CORRECT — UTC-aware
from datetime import datetime, timezone
start = int(datetime(2026, 3, 23, 8, 30, tzinfo=timezone.utc).timestamp() * 1000)

# WRONG — uses local time (NZ is UTC+13, will be 13 hours off)
start = int(datetime(2026, 3, 23, 8, 30).timestamp() * 1000)
```

### Where to find logs

**Local (Docker):**

```bash
docker logs workspace-test 2>&1 | grep "NOLIA_"
```

**Deployed (dev — replace `{clientName}` with your dev client, e.g. nd-labs):**

```bash
AWS_PROFILE=q-demo aws logs tail "/numa/{clientName}/workspace-chat-agent" --follow
```

**Deployed (Nolia production — client name: `nolia-id-gov-moh`):**

```bash
AWS_PROFILE=nolia-moh aws logs tail "/numa/nolia-id-gov-moh/workspace-chat-agent" --follow --region ap-southeast-3
```

### Log name patterns

All Nolia logs use structured logging with `_name` field:

| Log Name                         | When                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NOLIA_WORKSPACE_SETUP`          | Workspace setup starting                                                                       |
| `NOLIA_KB_DOWNLOAD`              | KB files downloaded                                                                            |
| `NOLIA_RULES_DOWNLOAD`           | Rules file downloaded                                                                          |
| `NOLIA_CUSTOM_TEMPLATE`          | Output template resolved                                                                       |
| `NOLIA_EXTRACT_START/COMPLETE`   | PDF extraction                                                                                 |
| `NOLIA_WORKSPACE_SETUP_COMPLETE` | Setup done                                                                                     |
| `NOLIA_PHASE_START`              | Phase starting                                                                                 |
| `NOLIA_STEP_COMPLETE`            | Phase finished                                                                                 |
| `NOLIA_SEQUENTIAL_START`         | Phases 2+3 starting sequentially                                                               |
| `NOLIA_MEMORY`                   | Memory usage at phase boundary                                                                 |
| `NOLIA_PIPELINE_COMPLETE`        | Full pipeline done                                                                             |
| `NOLIA_STEP_PROMPTS`             | User prompts sent to each step                                                                 |
| `SDK_COMPACTION`                 | Context window compaction occurred (warning level — indicates a phase is hitting token limits) |

### Tracing a full run

```bash
# Pipeline progress only
grep -i "NOLIA_STEP\|NOLIA_PHASE\|NOLIA_PIPELINE\|NOLIA_SEQUENTIAL\|NOLIA_MEMORY"

# Workspace setup
grep -i "NOLIA_KB\|NOLIA_RULES\|NOLIA_TEMPLATE\|NOLIA_CUSTOM\|NOLIA_WORKSPACE_SETUP\|NOLIA_EXTRACT"

# Cost per step
grep '"_name": "COST"'

# Full summary (per-step breakdown)
grep "STREAM_COMPLETE" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        conv = d.get('conversation_id', '')
        label = conv.split('step-')[-1] if 'step-' in conv else conv
        cost = d.get('total_cost_usd', 0)
        turns = d.get('num_turns', '')
        dur = d.get('total_duration_ms', 0)
        print(f'{label:20s} | \${cost:.2f} | turns={turns:>3} | {dur/1000:.0f}s')
    except: pass
"
```

### Additional log groups (deployed)

| Log Group                                                            | Contents                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `/numa/{clientName}/workspace-chat-agent`                            | Container logs (richest — all NOLIA\_ events, SDK output) |
| `/aws/lambda/{clientName}-workspace-chat-agent-proxy`                | Proxy Lambda (request routing, session management)        |
| `/numa/{clientName}-v2-apps`                                         | V2 Apps API (run creation, status queries)                |
| `/aws/vendedlogs/bedrock-agentcore/numa-{clientName}-workspace-chat` | AgentCore platform logs                                   |

### Debug logging (local only)

Add `-e LOG_LEVEL=DEBUG` to Docker run for live LLM activity:

```bash
docker logs -f workspace-test 2>&1 | grep "SDK_LIVE"
```

---

## Workspace Directory Structure (inside MicroVM)

```
/workdir/
├── uploads/                              # Uploaded PDF + extracted JSON
├── knowledge-bases/
│   ├── global-knowledge-base/            # Downloaded from DATA bucket
│   ├── procurement-knowledge-base/       # (or project-)
│   ├── global-rules.md                   # Rules files
│   └── procurement-rules.md
├── output-template.md                    # Resolved template
├── tmp/                                  # Intermediate phase outputs (shared between phases)
│   ├── document_manifest.json            # Phase 1
│   ├── document_summary.md               # Phase 1
│   ├── page_index.csv                    # Phase 1
│   ├── global_rules_compliance.csv       # Phase 2
│   ├── procurement_rules_compliance.csv  # Phase 3
│   └── *-phase-notes.md                  # Phase narrative notes
└── outputs/                              # Final deliverables
    └── Final_Evaluation_Report_*.md      # Phase 4
```

---

## S3 Data Layout

**Outputs bucket:** `numa-{clientName}-outputs/`

```
v2-apps/nolia/{user_sub}/{runId}/
  ├── uploads/                  # User-uploaded file
  ├── _result.json              # Pipeline result (success/failure)
  ├── _progress.json            # Progress for frontend polling
  └── outputs/                  # Final report
```

**Data bucket:** `numa-{clientName}-data/`

```
documents/kb-{uuid}/
  ├── documents/                # KB documents
  ├── pre-rfx/ rfx/ supporting/ # Procurement KB subfolders
  ├── templates/                # Output template
  ├── global-rules.md           # Generated rules file
  └── .metadata.json            # KB metadata
```

---

## Common Development Tasks

### Modifying a phase prompt

1. Edit the relevant file in `agent_types/nolia/prompts/`
2. Rebuild container: `cd services && ./package-service.sh numa-workspace-agent`
3. Test locally or deploy

### Adding a new phase

1. Create `phase_new.py` with `AgentTypeConfig` + `register_agent_type()`
2. Create prompt addendum in `prompts/`
3. Import in `__init__.py`
4. Add to orchestrator flow in `orchestrator.py`

### Debugging a failed run

1. Check container logs for `NOLIA_` events
2. Look for `NOLIA_STEP_COMPLETE` with error details
3. Check `_result.json` in S3 for the full error
4. For phase-specific issues, look at the step's conversation_id in logs

### KB issues

1. Check KB exists: `AWS_PROFILE=q-demo aws dynamodb scan --table-name numa-{client}-knowledge-bases --region {region}`
2. Check S3 structure: `AWS_PROFILE=q-demo aws s3 ls s3://numa-{client}-data/documents/kb-{uuid}/`
3. Verify rules file exists at KB root level

---

## Model Configuration

| Phase                            | Model      | Max Turns |
| -------------------------------- | ---------- | --------- |
| EDA, Global, Procurement/Project | Sonnet 4.6 | 40        |
| Report Generate                  | Sonnet 4.6 | 50        |
| Translate                        | Haiku 4.5  | 25        |
| Rules Extract/Review             | Sonnet 4.6 | 30        |

In Jakarta (ap-southeast-3), all models use `global.*` prefixed inference profiles. The `REGIONAL_MODEL_MAP` in `sdk_config.py` handles this automatically.

---

## Related Documentation

All committed documentation lives in `documentation/nolia/`:

| File                                                | Contents                                                       |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `documentation/nolia/NOLIA.md`                      | Full project context doc (single source of truth)              |
| `documentation/nolia/overview.md`                   | High-level — what Nolia is, how it connects to Numa            |
| `documentation/nolia/v2-app-architecture.md`        | V2 app architecture — API call chain, orchestration, S3 layout |
| `documentation/nolia/ter-cer-assessment.md`         | TER/CER pipeline — 5 phases, KB pairing, outputs               |
| `documentation/nolia/automatic-rules-generation.md` | Rules generation — trigger flow, 2-phase pipeline              |
| `documentation/nolia/project-notes.md`              | Current scope, known issues, deployment, contacts              |

**Skills:**

- Local testing: `.claude/skills/workspace-agent-local-test/` (full Docker testing guide + Nolia-specific notes)
