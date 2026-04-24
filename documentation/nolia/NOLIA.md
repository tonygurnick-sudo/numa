# Nolia — Project Context Document

> **Last Updated:** 2026-04-18 | **Maintainer:** Nathan Douglas (nathan@arcanum.ai)
> **Purpose:** Backend-centric context for Nolia work in the Numa repo. For the product-level view of each frontend app, see `arcanum/nolia/CLAUDE.md` (umbrella) and the per-repo `CLAUDE.md` files under `arcanum/nolia/nolia-app/` and `arcanum/nolia/nolia-funding-app/`.

---

## 1. What Is Nolia?

Nolia is an AI-powered document compliance and assessment platform. It is delivered as **two product lines** with separate frontend repos, both powered by this Numa backend:

| Product Line            | Frontend Repo                      | Use Case                                                | Anchor Client                             |
| ----------------------- | ---------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| **Nolia (Procurement)** | `arcanum/nolia/nolia-app/`         | Bank / MDB procurement compliance (TER/CER/ToR/RFP)     | Indonesia Ministry of Health (World Bank) |
| **Nolia Funding**       | `arcanum/nolia/nolia-funding-app/` | Funding application assessment (Fund/Grant/Scholarship) | Te Rūnanga o Ngāi Tahu (NZ)               |

**The procurement product** serves Implementing Agencies (typically government departments) working with Multilateral Development Banks — World Bank, ADB, IsDB, AIIB. These agencies manage infrastructure/health/development projects funded by MDBs and must validate procurement documents against MDB policy. This process historically takes weeks of manual review; Nolia reduces it to ~30 minutes.

**The funding product** serves organisations that distribute money to applicants — iwi trusts, philanthropics, scholarship programs. Assessors upload applications and receive a criteria-based assessment plus (optionally) a neutral side-by-side comparison of 2–3 applications.

**Business relationship:** Nolia is a partner company in which Arcanum AI holds a shareholding. Arcanum builds and operates the platform; Nolia sells it to client organisations.

### Core Capabilities by Product

| Capability                     | Procurement (`nolia-app`)                                      | Funding (`nolia-funding-app`)                         |
| ------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------- |
| **Document Validation**        | TER/CER/ToR/RFP against MDB policy — Phase 1 launching         | —                                                     |
| **Application Assessment**     | —                                                              | Single-phase upload → criteria-based report (current) |
| **Application Comparison**     | —                                                              | 2–3 side-by-side (neutral, fact-based) — current      |
| **Knowledge Base Management**  | Global + Project + Procurement Activity (auto-generated rules) | Global + Funding (auto-generated rules)               |
| **Vendor Response Assessment** | Phase 2                                                        | —                                                     |
| **Document Creation**          | Phase 2 (AI-generate ToRs, RFPs, TERs, CERs)                   | —                                                     |
| **Analytics & Insights**       | Future                                                         | Future                                                |

### Key Document Types (Procurement)

- **TER** (Technical Evaluation Report) — assesses vendor technical proposals
- **CER** (Combined Evaluation Report) — assesses technical + financial proposals
- **ToR** (Terms of Reference) — defines scope of work for procurement
- **RFP/RFB** (Request for Proposal/Bid) — issued to market for vendor responses

### Key Document Types (Funding)

- **Application Form** (Funding KB) — the blank template applicants fill in
- **Selection Criteria** (Funding KB) — the rubric assessments score against
- **Good Examples** (Funding KB) — calibration anchors
- **Output Template** (Funding KB) — defines the shape of the generated assessment report
- **Assessment** — the generated, template-driven report for one application
- **Comparison** — the generated side-by-side document for 2–3 applications

---

## 2. Architecture Overview

Nolia has two major components per product: a frontend (separate repo per product) and this Numa backend.

### 2a. Nolia Frontends (separate repos under `arcanum/nolia/`)

Custom whitelabel frontends that replace Numa's standard frontend with Nolia-branded UI.

- `arcanum/nolia/nolia-app/` — bank / MDB procurement (MoH Indonesia in production).
- `arcanum/nolia/nolia-funding-app/` — funding applications (Ngāi Tahu). Variant-aware codebase (`NEXT_PUBLIC_NOLIA_VARIANT = funding | procurement`); only the `funding` variant is deployed today.

```
User Browser (worldbank.getnolia.io)
        |
    Nginx (port 80) — reverse proxy
        |
   +----+----+
   |         |
Backend   Frontend
(Express   (Next.js 15
 :8080)     :3000)
   |
   v
Numa Backend (CloudFront)
```

**Tech stack:**

- **Frontend:** Next.js 15, React 19, Tailwind CSS 4, React Aria Components, TypeScript 5.9, Zod
- **Backend:** Express.js 4.21, TSOA (auto-generated OpenAPI), AWS SDK v3
- **Shared:** `@whitelabel/shared` — Zod schemas for type safety across frontend/backend
- **Deployment:** Docker containers on ECS Fargate via Terraform. Commits to `main` auto-deploy.

**The Express backend is a proxy layer** — it forwards requests to Numa's APIs with proper auth headers. It does NOT contain AI/ML logic.

### 2b. Numa Backend (This Repo — `arcanum/numa`)

The AI engine that powers both Nolia products. Key components:

- **Nolia V2 App** — Runs on Numa's V2 Apps architecture (AgentCore MicroVMs with Claude Agent SDK)
- **Procurement pipeline (5-phase):** EDA → Global Rules → Domain Rules (sequential) → Report Generation → Translation
- **Funding pipeline:** single-phase upload → assess → report (plus a comparison orchestrator). Funding-specific prompts and orchestration are planned; the current `nolia/` agent type is procurement-shaped.
- **Knowledge Bases** — S3-backed document stores (NOT Bedrock KBs — these are folder-based). Rules auto-generated per KB on creation.
- **Document Extraction** — PDF → JSON via parallel Lambda chunk extraction (handles 1500+ page scanned PDFs)

**Backend source:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`
**Backend docs:** `documentation/nolia/`

**Client awareness:** Each Nolia client has its own AWS account and its own workspace agent deployment, with `CLIENT_NAME` in the environment. Client-specific prompt sets will be layered on top of the shared orchestrator (planned work).

---

## 3. Deployment Regions

Each Nolia client picks the AWS region appropriate for their data residency / latency needs. Today:

| Client                 | Product     | Region           | AgentCore Region | Notes                                              |
| ---------------------- | ----------- | ---------------- | ---------------- | -------------------------------------------------- |
| MoH Indonesia (prod)   | Procurement | `ap-southeast-3` | `ap-southeast-2` | Jakarta — see constraints below                    |
| Nolia staging          | Procurement | `us-east-1`      | `us-east-1`      | Native Bedrock + AgentCore                         |
| Te Rūnanga o Ngāi Tahu | Funding     | `ap-southeast-2` | `ap-southeast-2` | Sydney — closest to NZ, native Bedrock + AgentCore |

### Jakarta (`ap-southeast-3`) constraints — applies to MoH only

Jakarta deployment is needed for Indonesian data sovereignty. This introduces several constraints:

| Issue                                  | Workaround                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Bedrock KBs not available              | KB deployment type `"none"` — Nolia uses S3 folder-based KBs instead               |
| AgentCore not available                | Cross-region: AgentCore runs in **Sydney** (ap-southeast-2), data stays in Jakarta |
| LibreOffice Lambda layer not published | Self-published to Jakarta via `tools/publish-libreoffice-layer.sh`                 |
| Bedrock models need `global.*` prefix  | `REGIONAL_MODEL_MAP` maps Jakarta to `global.anthropic.claude-sonnet-4-6` etc.     |

**Model IDs for Jakarta:**

| Model             | ID                                                | Use                         |
| ----------------- | ------------------------------------------------- | --------------------------- |
| Claude Sonnet 4.6 | `global.anthropic.claude-sonnet-4-6`              | Default for analysis phases |
| Claude Opus 4.6   | `global.anthropic.claude-opus-4-6-v1`             | Report generation           |
| Claude Haiku 4.5  | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Translation, sub-agents     |

---

## 4. User Roles & Access

| Role        | Dashboard | Knowledge Bases | Validate Docs | Assess/Compare | User Mgmt | Profile |
| ----------- | --------- | --------------- | ------------- | -------------- | --------- | ------- |
| Super Admin | Yes       | Yes             | Yes           | Yes (Phase 2)  | Yes       | Yes     |
| Admin       | Yes       | Yes             | Yes           | Yes (Phase 2)  | Yes       | Yes     |
| Operator    | Yes       | No              | Yes           | Yes (Phase 2)  | No        | Yes     |

- **Super Admin** is the first account created. Cannot be deleted. Can do everything Admin can.
- **Admin** can be deleted by Super Admin or other Admins.
- **Operator** is a standard user with restricted access.

---

## 5. Knowledge Base System

KB shape depends on the product. Same S3 storage convention; different categories and wizard structures.

### Procurement (`nolia-app`)

Three KB types, paired by operation:

| KB Type                  | Contents                                                 | Steps to Create                              | Used For                                            |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| **Global**               | MDB policies, regulations, templates                     | 2 steps: info+docs, then output templates    | All operations (paired with Project or Procurement) |
| **Project**              | Project-specific docs (appraisal, procurement plan, ESC) | 1 step: info+docs                            | ToR/RFP creation and validation                     |
| **Procurement Activity** | Activity-specific docs (RFx, amendments, rubrics)        | 3 steps: pre-docs, RFx docs, supporting docs | TER/CER validation, vendor assessment               |

**Pairing logic:**

- TER/CER validation: Global + Procurement Activity
- ToR validation: Global + Project
- Vendor assessment: Global + Procurement Activity
- ToR/RFP creation: Global + Project

**Priority rule:** When conflicts exist, the more specific KB (Procurement Activity or Project) takes priority over Global.

### Funding (`nolia-funding-app`)

Two KB types, always paired:

| KB Type     | Contents                                                                                                  | Steps to Create                                                                  | Used For                |
| ----------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| **Global**  | Org-wide policies, values, disqualification rules, applicant guidance                                     | 1 step: documents                                                                | Paired with Funding     |
| **Funding** | Per Fund/Grant/Scholarship: application form template, selection criteria, good examples, output template | 4 steps: Application Form → Selection Criteria → Good Examples → Output Template | Assessment + Comparison |

Funding KBs carry a `fundingType` field (Fund / Grant / Scholarship) used as filter tabs.

**Priority rule:** Funding KB takes priority over Global on conflicts.

### Storage (both products)

KBs are stored as S3 folders under `documents/kb-{uuid}/` in the data bucket. Each KB folder contains the uploaded documents and a generated rules file (`global-rules.md`, `procurement-rules.md`, `project-rules.md`, or — once funding-specific generation lands — `funding-rules.md`). The frontend sends raw KB UUIDs; the backend prepends `kb-` to construct S3 paths.

**States:** Processing → Complete → Active (auto-activates on completion). Only Active KBs appear in dropdowns outside the KB management section.

---

## 6. Document Validation Flow (Procurement, Phase 1 Feature)

This is the procurement product flow. The funding product has a much simpler single-phase flow (upload → assess → report); see `arcanum/nolia/nolia-funding-app/CLAUDE.md`.

1. User navigates to Validate Documents
2. Selects Global KB (determines document type: TER or CER)
3. Selects Procurement Activity KB
4. Selects output language (English or Bahasa Indonesia)
5. Uploads document (PDF/Word/Excel, up to 10MB)
6. System runs 5-phase AI pipeline (~20-30 minutes):
   - **Phase 0:** Document extraction (PDF → JSON, parallel Lambda chunks)
   - **Phase 1 (EDA):** Document structure analysis, manifest, summary, page index
   - **Phase 2 (Global):** Check against Global KB rules (190 rules)
   - **Phase 3 (Domain):** Check against Procurement/Project rules (140 rules) — runs after Phase 2
   - **Phase 4 (Report):** Generate compliance report (4a: generate, 4b: review/refine)
   - **Phase 5 (Translate):** Translate to Bahasa Indonesia (conditional, only if non-English)
7. User sees progress updates during processing
8. Result: comprehensive compliance report with findings, recommendations, policy citations

---

## 7. Nolia V2 Backend Architecture

The Nolia app runs on Numa's V2 Apps platform — workspace agent on AgentCore MicroVMs (not Step Functions).

```
Frontend form → v2-apps-api Lambda → workspace-chat-agent-proxy Lambda → AgentCore MicroVM
                                                                              |
                                                                    orchestrator.py
                                                                              |
                                                    Setup → EDA → Global → Domain → Report → Translate
                                                                              |
                                                                    _result.json → S3
                                                                              |
                                                                    Frontend polls for result
```

**Key files in Numa repo:**

| Path                                                                                      | Purpose                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`                   | All Nolia agent types and orchestrator                      |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/orchestrator.py`    | Pipeline orchestration (replaces Step Functions)            |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/workspace_setup.py` | KB download, template resolution, PDF extraction            |
| `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/prompts/`           | All phase prompts                                           |
| `lambdas/node/v2-apps-api/index.ts`                                                       | API Lambda for V2 apps (run CRUD, proxy to workspace agent) |
| `numa-frontend/src/Components/V2Apps/`                                                    | V2 Apps frontend components (reference implementation)      |

**Performance benchmarks (1-page test doc):**

| Metric            | Value                   |
| ----------------- | ----------------------- |
| Total duration    | ~26 minutes             |
| Total cost        | ~$2.86                  |
| Total turns       | 72                      |
| EDA               | 2 min, $0.29            |
| Global rules      | 15 min, $0.89           |
| Procurement rules | 4 min, $0.50            |
| Report generate   | 3 min, $0.32 (Opus 4.6) |
| Report review     | 4 min, $0.86            |

---

## 8. Open Backend Work

### Funding-specific prompts and orchestration

The current `nolia/` agent type is procurement-shaped. The funding product (Ngāi Tahu) needs its own:

- **Rules generation prompts** — the funding KB structure (Application Form + Selection Criteria + Good Examples + Output Template) is fundamentally different from procurement docs. Existing `phase_rules_extract.py` / `phase_rules_review.py` need a funding variant.
- **Assessment orchestration** — single-phase upload → assess → template-driven report (vs the procurement 5-phase pipeline).
- **Comparison orchestrator** — neutral, fact-based, structured-JSON output for 2–3 applications under the same Funding KB. Frontend renders the comparison; backend produces it.

### Client awareness

Each client has its own AWS account and `CLIENT_NAME` in the environment. The plan is to layer client-specific prompt sets on top of the shared orchestrator (folder layout TBD by Nathan). No need to pass `client_id` in request metadata — the env var is the natural lookup key.

### Frontend repos

For frontend dev (local setup, routes, deployment), see the per-repo NOLIA.md:

- `arcanum/nolia/nolia-app/CLAUDE.md` — bank / MDB procurement (MoH)
- `arcanum/nolia/nolia-funding-app/CLAUDE.md` — funding (Ngāi Tahu)
- `arcanum/nolia/CLAUDE.md` — umbrella context across both

---

## 10. Key Contacts

| Person         | Role               | Relevant To                                                  |
| -------------- | ------------------ | ------------------------------------------------------------ |
| Matt           | Nolia stakeholder  | Product requirements, UX decisions, client liaison           |
| Tony Gurnick   | Engineering Lead   | Frontend designs, KB management system, overall architecture |
| Nathan Douglas | Senior AI Engineer | Backend AI pipeline, V2 app architecture, deployment         |
| Asa Cox        | CEO                | Business relationship, strategic decisions                   |

---

## 11. Terminology Quick Reference

### Procurement-product terms

| Term                | Meaning                                                              |
| ------------------- | -------------------------------------------------------------------- |
| MDB                 | Multilateral Development Bank (World Bank, ADB, IsDB, AIIB, AIF)     |
| Implementing Agency | Government department responsible for delivering MDB-funded projects |
| Borrower            | Country receiving MDB financing                                      |
| IPF                 | Investment Project Financing (World Bank lending instrument)         |
| TER                 | Technical Evaluation Report                                          |
| CER                 | Combined Evaluation Report (technical + financial)                   |
| ToR                 | Terms of Reference                                                   |
| RFP/RFB             | Request for Proposal / Request for Bid                               |

### Funding-product terms

| Term                       | Meaning                                                         |
| -------------------------- | --------------------------------------------------------------- |
| Fund / Grant / Scholarship | The three sub-types of a Funding KB (filter tabs)               |
| Application                | Documents submitted by an applicant to a Fund/Grant/Scholarship |
| Applicant                  | Individual or organisation applying for funding                 |
| Selection Criteria         | Rubric the application is assessed against                      |
| Good Examples              | Reference applications used to calibrate judgement              |
| Assessment                 | Generated, template-driven report for one application           |
| Comparison                 | Generated side-by-side document for 2–3 applications            |

### Shared / platform terms

| Term          | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| KB            | Knowledge Base                                                                     |
| AgentCore     | AWS Bedrock AgentCore — MicroVM service for running AI agents                      |
| V2 Apps       | Numa's new app architecture using workspace agents instead of Step Functions       |
| `CLIENT_NAME` | Per-client identifier in workspace agent env (e.g. `nolia-id-gov-moh`, `ngaitahu`) |

---

## 12. For AI Agents — Mental Model

1. **There are two Nolia products with separate frontend repos** under `arcanum/nolia/`. Always check whether the task is procurement (`nolia-app`) or funding (`nolia-funding-app`).
2. **Both frontends are thin Express proxies.** All AI logic lives here in `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`. Don't add AI logic to the Express backends.
3. **KBs are S3 folders, not Bedrock KBs.** They live under `documents/kb-{uuid}/` in the data bucket. Same convention for both products.
4. **Region constraints depend on the client.** MoH (Jakarta `ap-southeast-3`): no Bedrock KBs, no AgentCore — cross-region to Sydney, `global.*` model prefixes. Ngāi Tahu (Sydney `ap-southeast-2`): native everything.
5. **The Nolia V2 pipeline runs on AgentCore MicroVMs** via the workspace agent, not Step Functions. The orchestrator is Python, not a state machine.
6. **Procurement Phase 1 = document validation + KB management.** Funding Phase 1 = application assessment + comparison + KB management.
7. **Procurement Activity KB takes priority** over Global KB when conflicts arise (procurement). Funding KB takes priority over Global (funding).
8. **Procurement assessment types:** `evaluation-report` (TER/CER, uses Procurement KB) and `terms-of-reference` (ToR, uses Project KB). Funding has its own assessment type — funding-specific orchestration is open work.
9. **The funding pipeline is open work.** Today the `nolia/` agent type is procurement-shaped. Funding-specific prompts and orchestration are planned.
10. **Commits to `main` auto-deploy** in both frontend repos. Be careful — push to main = live in production.
