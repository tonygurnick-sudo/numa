# Nolia — Project Context Document

> **Last Updated:** 2026-03-06 | **Maintainer:** Nathan Douglas (nathan@arcanum.ai)
> **Purpose:** Single source of truth for AI agents and developers working on Nolia. Read this before starting any Nolia task.

---

## 1. What Is Nolia?

Nolia is an AI-powered procurement compliance platform built for **Implementing Agencies** (typically government departments) working with **Multilateral Development Banks** (MDBs) — World Bank, Asian Development Bank, Islamic Development Bank, AIIB, and others.

These agencies manage massive infrastructure/health/development projects funded by MDBs. As part of their obligations, they must create, validate, and compare procurement documents that comply with MDB policies. This process currently takes months of manual review. Nolia automates it.

**Business relationship:** Nolia is a partner company in which Arcanum AI holds a shareholding. Arcanum builds and operates the platform; Nolia sells it to implementing agencies.

**First client:** Indonesia Ministry of Health — managing the $4 billion Indonesia Health System Strengthening Project (the largest World Bank health project ever).

### Core Capabilities

| Capability                     | What It Does                                                                   | Status              |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------- |
| **Document Validation**        | Upload a TER/CER/ToR/RFP, validate against MDB policies, get compliance report | Phase 1 (launching) |
| **Knowledge Base Management**  | Organize Global, Project, and Procurement Activity KBs                         | Phase 1 (launching) |
| **Vendor Response Assessment** | Assess and compare vendor bid responses (Technical + Combined phases)          | Phase 2             |
| **Document Creation**          | AI-generate compliant ToRs, RFPs, TERs, CERs                                   | Phase 2             |
| **Analytics & Insights**       | Dashboards + natural language queries over procurement data                    | Future              |

### Key Document Types

- **TER** (Technical Evaluation Report) — assesses vendor technical proposals
- **CER** (Combined Evaluation Report) — assesses technical + financial proposals
- **ToR** (Terms of Reference) — defines scope of work for procurement
- **RFP/RFB** (Request for Proposal/Bid) — issued to market for vendor responses

---

## 2. Architecture Overview

Nolia has two major components:

### 2a. Nolia Frontend (This Repo — `numa-whitelabel-investigation`)

A custom whitelabel frontend that replaces Numa's standard frontend with Nolia-branded UI.

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

### 2b. Numa Backend (Separate Repo — `arcanum/numa`)

The AI engine that powers Nolia's document analysis. Key components:

- **Nolia V2 App** — Runs on Numa's V2 Apps architecture (AgentCore MicroVMs with Claude Agent SDK)
- **5-Phase Pipeline:** EDA → Global Rules → Domain Rules (sequential) → Report Generation → Translation
- **Knowledge Bases** — S3-backed document stores (NOT Bedrock KBs — these are folder-based)
- **Document Extraction** — PDF → JSON via parallel Lambda chunk extraction (handles 1500+ page scanned PDFs)

**Backend source:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`
**Backend docs:** `documentation/nolia/`

---

## 3. Deployment Region — Jakarta (ap-southeast-3)

Nolia deploys to **ap-southeast-3 (Jakarta)** for data sovereignty (Indonesian government requirement). This introduces several constraints:

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

Three types of KBs, often paired for different operations:

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

**Storage:** KBs are stored as S3 folders under `documents/kb-{uuid}/` in the data bucket. Each KB folder contains a knowledge-base subfolder (documents) and a rules file (`global-rules.md`, `procurement-rules.md`, etc.). The frontend sends raw KB UUIDs; the backend prepends `kb-` to construct S3 paths.

**States:** Processing → Complete → Active (auto-activates on completion). Only Active KBs appear in dropdowns outside the KB management section.

---

## 6. Document Validation Flow (Phase 1 Feature)

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

## 8. March Release TODO

### Infrastructure & Backend

- [x] Add ap-southeast-3 support to Numa (model mapping, region configs)
- [x] Add `"none"` KB deployment type (Bedrock KBs unavailable in Jakarta)
- [x] Cross-region AgentCore (Sydney runs MicroVMs, Jakarta stores data)
- [x] Implement Nolia V2 app on workspace agent architecture
- [ ] Deploy updated Numa to Nolia's Jakarta environment
- [ ] Test existing app functionality still works

### Frontend (This Repo)

- [ ] Tony to finish FE designs per discussion with Matt
- [ ] Tony to create new KB management system (different from current Numa KB UI)
- [ ] Wire up Nolia V2 app endpoints (replace old Step Function-based calls)
- [ ] Get user management working via Numa
- [ ] Setup app components: run history, viewing generated docs, running different doc types
- [ ] Add new functionality for second document type

### AI/ML

- [ ] Add new functionality for second document type (beyond TER/CER)
- [ ] R&D for automatic rules generation from KB documents
- [ ] Implement rules generation as an action in V2 Nolia app
- [ ] Wire rules generation into KB creation flow (block runs for KBs without rules)
- [ ] Fine-tune model IDs, cost optimizations, prompts, output templates

### Operations

- [ ] Install into Jakarta (deploy to MoH infrastructure)
- [ ] Liaise with Matt to iron out remaining details

---

## 9. Frontend Development (This Repo)

### Local Development

```bash
make clean clobber up    # Clean everything and rebuild containers from scratch
docker compose logs      # View container logs
make validate            # Type checking and linting
```

### Key Frontend Paths

| Path                   | Purpose                       |
| ---------------------- | ----------------------------- |
| `/login`               | Cognito SRP authentication    |
| `/dashboard`           | Main landing page             |
| `/assess/*`            | Document validation workflows |
| `/admin/global/*`      | Global KB management          |
| `/admin/procurement/*` | Procurement KB management     |
| `/admin/project/*`     | Project KB management         |

### Backend Proxy Endpoints

| Endpoint                              | Proxies To                  |
| ------------------------------------- | --------------------------- |
| `POST /api/nolia/main`                | Start Nolia analysis job    |
| `GET /api/nolia/main/:jobId`          | Get job status              |
| `GET /api/nolia/jobs`                 | List all jobs               |
| `GET /api/kb`                         | List knowledge bases        |
| `POST /api/kb`                        | Create knowledge base       |
| `POST /api/files/generate-upload-url` | Get S3 presigned upload URL |

### Deployment

Commits to `main` trigger automatic deployment. No manual steps needed — CI/CD builds Docker images, pushes to ECR, and updates the ECS service.

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

| Term                | Meaning                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| MDB                 | Multilateral Development Bank (World Bank, ADB, IsDB, AIIB, AIF)             |
| Implementing Agency | Government department responsible for delivering MDB-funded projects         |
| Borrower            | Country receiving MDB financing                                              |
| IPF                 | Investment Project Financing (World Bank lending instrument)                 |
| TER                 | Technical Evaluation Report                                                  |
| CER                 | Combined Evaluation Report (technical + financial)                           |
| ToR                 | Terms of Reference                                                           |
| RFP/RFB             | Request for Proposal / Request for Bid                                       |
| KB                  | Knowledge Base                                                               |
| AgentCore           | AWS Bedrock AgentCore — MicroVM service for running AI agents                |
| V2 Apps             | Numa's new app architecture using workspace agents instead of Step Functions |

---

## 12. For AI Agents — Mental Model

1. **This repo is the frontend only.** All AI logic lives in the Numa backend (`arcanum/numa`).
2. **The Express backend is a proxy.** It forwards requests to Numa's CloudFront with auth headers. Don't add AI logic here.
3. **KBs are S3 folders, not Bedrock KBs.** They live under `documents/kb-{uuid}/` in the data bucket.
4. **Jakarta region has constraints.** Always use `global.*` model prefixes. No Bedrock KBs. AgentCore runs in Sydney.
5. **The Nolia V2 pipeline runs on AgentCore MicroVMs** via the workspace agent, not Step Functions. The orchestrator is Python, not a state machine.
6. **Phase 1 launch = document validation + KB management.** Vendor assessment and document creation are Phase 2.
7. **Procurement Activity KB takes priority** over Global KB when conflicts arise.
8. **Two assessment types exist:** `evaluation-report` (TER/CER, uses Procurement KB) and `terms-of-reference` (ToR, uses Project KB).
9. **Commits to main auto-deploy.** Be careful — push to main = live in production.
