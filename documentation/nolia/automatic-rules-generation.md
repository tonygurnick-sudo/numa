# Automatic Rules Generation

## What This Does

When a knowledge base is created in the Nolia whitelabel, the system automatically generates a compliance rules file (e.g., `global-rules.md`) by running an AI agent that reads all uploaded KB documents. This replaces Matt's manual two-prompt process in Claude Projects.

The generated rules file is used by the assessment pipeline (Phases 2 and 3) to check documents against compliance rules.

## How It Maps to Matt's Manual Process

Matt manually uses two prompts in a Claude Project:

| Matt's Step                                                         | Our Implementation                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Upload docs to Claude Project knowledge                             | `_setup_rules_workspace()` downloads all KB docs from S3              |
| Prompt 1: "Read all docs, determine rules, order by importance"     | Phase 1 (Extract): category-specific agent extracts prioritised rules |
| Prompt 2: "Review your work, check every tab/sheet, cite each rule" | Phase 2 (Review): review agent verifies completeness, adds citations  |

## End-to-End Flow

### 1. Trigger (from Nolia whitelabel)

```
User creates KB in wizard → uploads files to S3
    ↓
Wizard calls:
  1. PATCH /api/kb/{kbId}/processing → { status: "processing" }
  2. POST /api/v2-apps/rules-generation → { kbId, kbCategory, kbName }
    ↓
Whitelabel backend creates V2 Apps run:
  - agentType: "nolia-rules-generator"
  - metadata: { kb_id, kb_category, kb_name }
  - Returns runId immediately
```

### 2. Pipeline Execution

```
V2 Apps API → workspace-chat-agent-proxy → AgentCore MicroVM
    ↓
nolia-rules-generator config (fire-and-forget)
    → routes to rules_orchestrator.run_nolia_rules_pipeline()
```

**Pipeline steps:**

1. **Download KB documents** from `s3://{data-bucket}/documents/kb-{kb_id}/`
   - Downloads everything: `documents/`, `templates/`, `pre-rfx/`, `rfx/`, `supporting/`
   - Skips existing `*-rules.md` files (we're generating those)
   - Destination: `/workdir/knowledge-bases/documents/`

2. **Phase 1: Extract Rules** (agent type: `nolia-rules-extract-{category}`)
   - Category-specific persona (global/procurement/project)
   - Reads ALL documents in workspace
   - Outputs: `/workdir/tmp/extracted_rules.md`

3. **Phase 2: Review Rules** (agent type: `nolia-rules-review`)
   - Re-reads ALL original documents
   - Verifies completeness (every sheet/tab checked)
   - Adds source citations (document name, section, page, tab)
   - Deduplicates
   - Outputs: `/workdir/outputs/{category}-rules.md`

4. **Upload to S3**
   - Uploads final rules file to `s3://{data-bucket}/documents/kb-{kb_id}/{category}-rules.md`
   - This is the same location the assessment pipeline reads from

5. **Progress tracking** via `_progress.json` throughout

### 3. Frontend Status

```
Frontend polls V2 Apps run status
    ↓
ProcessingChecklist shows progress:
  - Documents uploaded to secure storage (0%)
  - Reading and analyzing all documents (25%)
  - Extracting compliance rules with citations (50%)
  - Reviewing and deduplicating rules (75%)
  - Finalizing rules file (90%)
    ↓
On COMPLETED: KB processingStatus → "completed" → appears in assessment dropdowns
On FAILED: KB processingStatus → "failed" → hidden from assessment dropdowns
```

## Rules File Naming

| KB Category | Rules Filename         | S3 Key                                     |
| ----------- | ---------------------- | ------------------------------------------ |
| Global      | `global-rules.md`      | `documents/kb-{uuid}/global-rules.md`      |
| Procurement | `procurement-rules.md` | `documents/kb-{uuid}/procurement-rules.md` |
| Project     | `project-rules.md`     | `documents/kb-{uuid}/project-rules.md`     |

## Key Backend Files

| File                                            | Purpose                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ | ----------- | --------- |
| `agent_types/nolia/nolia_rules_generator.py`    | Parent config: `type_id: "nolia-rules-generator"`, fire-and-forget |
| `agent_types/nolia/rules_orchestrator.py`       | Pipeline: download → extract → review → upload                     |
| `agent_types/nolia/phase_rules_extract.py`      | Three configs: `nolia-rules-extract-{global                        | procurement | project}` |
| `agent_types/nolia/phase_rules_review.py`       | Config: `nolia-rules-review`                                       |
| `agent_types/nolia/prompts/rules_generation.py` | All prompt addendums based on Matt's process                       |

## Key Frontend Files (Nolia Whitelabel)

| File                                          | Purpose                                       |
| --------------------------------------------- | --------------------------------------------- |
| `frontend/.../CreateKnowledgeBaseWizard.tsx`  | Triggers rules generation after KB creation   |
| `frontend/.../ProcessingChecklist.tsx`        | Shows progress steps                          |
| `frontend/src/services/v2-apps-service.ts`    | `triggerRulesGeneration()` method             |
| `backend/src/controllers/V2AppsController.ts` | `POST /api/v2-apps/rules-generation` endpoint |

## Configuration

- All phases use **Sonnet 4.6** (regionalized via `REGIONAL_MODEL_MAP`)
- Max **30 turns** per phase
- Fire-and-forget response mode
- V2 Apps API is fully generic — no Nolia-specific changes needed there

## Future Work

- Retry mechanism: "Regenerate Rules" button on KB detail page
- Rules preview: Show generated rules on KB detail page before running assessments
- Cost tracking per KB
