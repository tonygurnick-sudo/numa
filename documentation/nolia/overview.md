# Nolia — Overview

## What Is Nolia?

Nolia is an AI-powered document compliance and assessment platform, delivered as **two product lines** from separate frontend repos:

- **Nolia (MDB Procurement)** — `arcanum/nolia/nolia-app/`. For Implementing Agencies working with Multilateral Development Banks (World Bank, ADB, IsDB, AIIB). Validates procurement documents (TER, CER, ToR, RFP) against MDB policy. **Anchor client:** Indonesia Ministry of Health, managing the $4B Indonesia Health System Strengthening Project (largest World Bank health project ever).
- **Nolia Funding** — `arcanum/nolia/nolia-funding-app/`. For funding bodies distributing Funds/Grants/Scholarships. Upload an application, get a criteria-based assessment plus (optionally) a side-by-side comparison of 2–3 applications. **Anchor client:** Te Rūnanga o Ngāi Tahu (NZ).

Both product lines reduce multi-day/multi-week manual reviews to ~30 minutes or less.

**Business relationship:** Nolia is a partner company (Arcanum holds a shareholding). Arcanum builds and operates the platform; Nolia sells to client organisations.

## How Nolia Connects to Numa

Both Nolia products are built on top of the Numa platform. They each have their own frontend but use Numa's backend infrastructure for all AI processing.

```
          Nolia Frontend (one of:)                       Numa Backend
         - arcanum/nolia/nolia-app                      (arcanum/numa)
         - arcanum/nolia/nolia-funding-app
            ┌──────────────────────────┐          ┌──────────────────────────┐
            │  Next.js 15 + Express    │          │                          │
            │  (ECS Fargate, Docker)   │          │  Cognito (auth)          │
            │                          │          │  API Gateway             │
            │  Express backend is a    │──────────│  V2 Apps API Lambda      │
            │  proxy — forwards to     │  HTTPS   │  Workspace Agent Proxy   │
            │  Numa APIs with auth     │          │  AgentCore MicroVMs      │
            │                          │          │  S3 (data, outputs)      │
            │  *.getnolia.io           │          │  DynamoDB                │
            └──────────────────────────┘          └──────────────────────────┘
```

**Key principle:** The Nolia frontends are thin proxy layers. All AI logic, document analysis, compliance checking, and assessment runs in the Numa backend.

## Two Main Actions

### 1. Document Validation (TER/CER Assessment)

Upload a procurement document, select knowledge bases, get a compliance report. Runs a 5-phase AI pipeline on AgentCore MicroVMs.

- **Current scope:** TER/CER validation using Global + Procurement Activity KBs
- **Future scope:** ToR validation, vendor assessment, document creation

See [ter-cer-assessment.md](ter-cer-assessment.md) for the full pipeline.

### 2. Automatic Rules Generation

When a knowledge base is created, an AI agent reads all uploaded documents and generates a structured compliance rules file. This replaces a manual process.

See [automatic-rules-generation.md](automatic-rules-generation.md) for details.

## Knowledge Base System

Three types of KBs, stored as S3 folders (NOT Bedrock KBs — unavailable in Jakarta):

| KB Type                  | Contains                                            | Paired With            | Used For                              |
| ------------------------ | --------------------------------------------------- | ---------------------- | ------------------------------------- |
| **Global**               | MDB policies, regulations, output templates         | Procurement or Project | All operations                        |
| **Procurement Activity** | RFx docs, amendments, scoring rubrics               | Global                 | TER/CER validation, vendor assessment |
| **Project**              | Project-specific docs (appraisal, procurement plan) | Global                 | ToR validation, ToR/RFP creation      |

**Priority:** When conflicts exist, domain-specific KBs (Procurement/Project) take priority over Global.

**Storage:** `s3://{data-bucket}/documents/kb-{uuid}/` — each KB folder contains documents, optional templates, and a generated rules file (`global-rules.md`, `procurement-rules.md`, or `project-rules.md`).

## Deployment Region — Jakarta (ap-southeast-3)

Nolia deploys to Jakarta for Indonesian data sovereignty. Key constraints:

| Constraint                            | Workaround                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| No Bedrock KBs                        | S3 folder-based KBs instead                                                    |
| No AgentCore                          | Cross-region: AgentCore runs in Sydney (ap-southeast-2), data stays in Jakarta |
| Bedrock models need `global.*` prefix | `REGIONAL_MODEL_MAP` handles this automatically                                |
| No published LibreOffice Lambda layer | Self-published to Jakarta                                                      |

## Key Document Types

| Acronym | Full Name                   | Description                              |
| ------- | --------------------------- | ---------------------------------------- |
| TER     | Technical Evaluation Report | Assesses vendor technical proposals      |
| CER     | Combined Evaluation Report  | Assesses technical + financial proposals |
| ToR     | Terms of Reference          | Defines scope of work for procurement    |
| RFP/RFB | Request for Proposal/Bid    | Issued to market for vendor responses    |

## User Roles

| Role        | KB Management | Validate Docs | User Management |
| ----------- | ------------- | ------------- | --------------- |
| Super Admin | Yes           | Yes           | Yes             |
| Admin       | Yes           | Yes           | Yes             |
| Operator    | No            | Yes           | No              |

## Key Contacts

| Person         | Role               | Relevant To                                   |
| -------------- | ------------------ | --------------------------------------------- |
| Matt           | Nolia stakeholder  | Product requirements, document types, UX      |
| Tony Gurnick   | Engineering Lead   | Frontend, KB management, architecture         |
| Nathan Douglas | Senior AI Engineer | Backend pipeline, V2 architecture, deployment |
| Asa Cox        | CEO                | Business relationship, strategy               |
