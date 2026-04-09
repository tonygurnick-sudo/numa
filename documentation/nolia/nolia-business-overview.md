Nolia Platform - Comprehensive Overview

What is Nolia?

Nolia is an AI-powered procurement management platform for Implementing Agencies (IAs) working with Multilateral Development Banks (MDBs) like the World Bank and Asian Development Bank. It helps IAs create compliant procurement documents, assess vendor responses, and produce the formal evaluation reports that MDBs require for sign-off.

---

The Three Pillars

Nolia has three core capability areas. They map roughly to the lifecycle of a procurement activity:

| #   | Pillar                         | What it does                                                      | Uses KBs?                                         | Build status (your context)     |
| --- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| 1   | Document Creation              | AI generates procurement docs (ToR, RFQ, RFP, EoI) via guided Q&A | Yes - Global KB + Project KB                      | Not yet in your stories         |
| 2   | Document Validation            | Checks uploaded docs against compliance rules                     | Yes - Global KB + Project/Procurement Activity KB | Your current stories cover this |
| 3   | Vendor Assessment & Comparison | Evaluates and compares vendor bid responses                       | Yes - Global KB + Procurement Activity KB         | Your current stories cover this |

---

Pillar 1: Document Creation

What it does

The AI guides users through a structured Q&A to generate MDB-compliant procurement documents from scratch.

Document types it can create

    • Terms of Reference (ToR) - for Goods, Works, Consulting Services, and Individual Contractors (e.g. Project Coordinator, Procurement Officer, Project Accountant)
    • Requests for Quotation (RFQ)
    • Requests for Bid/Proposal (RFB/RFP)
    • Expression of Interest (EoI)

How it works

1. User selects document type (e.g. "ToR for Individual Contractor")
2. Nolia asks clarifying questions to scope the document (e.g. "What type of role?", "Which project?")
3. Progressive refinement through follow-up questions based on answers
4. Behind the scenes, pairs Global KB (MDB policies/templates) with Project KB (project-specific context)
5. User can either copy/paste sections or let Nolia auto-generate a full draft
6. Review, edit, download

KB usage

    • Global KB: MDB policies, guidelines, document-type-specific templates
    • Project KB: Project objectives, timeline, budget, implementing agency details
    • Procurement Activity KB: NOT used during creation (only used later in validation/assessment)

Key detail

Output quality depends on two things: how complete the user's answers are, and how comprehensive the KBs are. The generated docs follow MDB-mandated structures automatically.

Update: The earlier search result said doc creation does NOT use KBs, but the more detailed document creation query confirms it does pair Global KB + Project KB during generation. So yes, document creation does use KBs, just a different pairing than validation.

---

Pillar 2: Document Validation

What it does

Takes user-uploaded documents and checks them for compliance against the relevant Knowledge Bases. Returns a detailed validation report with issues, recommendations, and compliance gaps.

Documents it can validate

    • TER (Technical Evaluation Report)
    • CER (Combined Evaluation Report)
    • ToR (Terms of Reference)
    • RFx documents (RFQ, RFP, RFB, EoI)

KB pairings for validation

| Document      | KB Combination                                                       |
| ------------- | -------------------------------------------------------------------- |
| TER / CER     | Global KB + Procurement Activity KB                                  |
| ToR           | Global KB + Project KB                                               |
| RFx documents | Global KB + Project KB / Procurement Activity KB (context-dependent) |

Process

1. User uploads a document (PDF, DOC, DOCX, XLS, XLSX - max 10MB)
2. Nolia runs an automated validation (~30 min processing)
3. User accesses results via Verify Documents section
4. Validation report shows compliance gaps, issues, and recommendations

Priority rule

When KBs conflict, the more specific KB wins: Procurement Activity KB > Project KB > Global KB.

---

Pillar 3: Vendor Assessment & Comparison

What it does

Evaluates vendor bid responses against procurement criteria across two independent phases, then lets users compare vendors side-by-side.

Two evaluation phases

Phase 1 - Technical Evaluation
• Assesses vendors on technical qualifications, capabilities, and compliance ONLY
• Financial information is explicitly excluded
• Output: Individual assessment reports + scores
• The IA then writes a TER (Technical Evaluation Report) summarising decisions
• TER goes to the MDB for sign-off before proceeding

Phase 2 - Combined Evaluation
• Integrates technical scores WITH financial data (pricing, life cycle costs, financial proposals)
• Output: Individual assessment reports + scores including financial analysis
• The IA then writes a CER (Combined Evaluation Report) for final recommendation
• CER goes to the MDB for sign-off before the IA can notify vendors of the result

Important: phases are independent in the system

    • Responses uploaded to Technical phase do NOT automatically appear in Combined phase
    • Each phase can be assessed independently
    • But in the real world, MDB process requires TER sign-off before moving to CER

Vendor comparison

    • Compare up to 3 vendor responses side-by-side
    • User can manually select 3 vendors OR leave unchecked and Nolia auto-selects top 3 by score
    • Comparison report includes:
    • Side-by-side scoring
    • Pros and cons per vendor
    • Criteria-based comparison (technical specs, quality, experience, delivery timelines)
    • Pricing and life cycle costs (Combined phase only)
    • Key differentiators
    • Nolia provides factual, objective comparisons only - it does not recommend a vendor
    • Report can be downloaded as PDF

KB usage

Uses Global KB + Procurement Activity KB for compliance checks during assessment.

---

The Knowledge Base System

Three KB types

| KB Type                 | Scope                                                                      | Contains                                                                 | Used in                              |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Global KB               | Per document type (one for TER, one for CER, one for ToR-Goods, etc.)      | MDB policies, guidelines, compliance rules, standard templates           | Creation, Validation, Assessment     |
| Project KB              | Per project (e.g. "Indonesia Health Systems Strengthening")                | Project appraisal docs, procurement plans, ESC plans, timelines, budgets | Creation (ToR/RFx), Validation (ToR) |
| Procurement Activity KB | Per procurement action within a project (e.g. "Procure Cathlab equipment") | Business case, requirements, budget, RFx documents, evaluation rubrics   | Validation (TER/CER), Assessment     |

KB lifecycle

    • Upload docs (PDF, DOC, DOCX, XLS, XLSX - max 10MB per file)
    • Processing takes 20-30 minutes
    • Status goes: Processing -> Complete -> Active
    • Only Active KBs appear in dropdowns and can be used

---

How TER and CER Fit In

TER and CER are not things Nolia generates automatically. They are formal documents that the Implementing Agency writes after using Nolia's assessment tools. Here's how they fit:

`
Vendor responses come in
| | |
|-----|-----|

        v

[Technical Assessment in Nolia]
• AI scores each vendor on technical merit
• Users review individual reports
• Users compare vendors side-by-side

|     |     |
| --- | --- |

        v

[IA writes TER manually]
• Summarises technical evaluation decisions
• Can be validated in Nolia against Global KB + Procurement Activity KB

|     |     |
| --- | --- |

        v

[MDB reviews and signs off TER]
• This can take months

|     |     |
| --- | --- |

        v

[Combined Assessment in Nolia]
• Adds financial data to technical scores
• Users review and compare again

|     |     |
| --- | --- |

        v

[IA writes CER manually]
• Summarises combined evaluation and final recommendation
• Can be validated in Nolia against Global KB + Procurement Activity KB

|     |     |
| --- | --- |

        v

[MDB reviews and signs off CER]
• Only then can IA notify vendors of selection

`

The total sign-off cycle for ToRs, TERs, and CERs typically runs 5-9 months.

---

User Roles

| Role        | Access                                                               |
| ----------- | -------------------------------------------------------------------- |
| Super Admin | Full access to everything. First account created. Cannot be deleted. |
| Admin       | Same privileges as Super Admin. Can be deleted.                      |
| Operator    | Dashboard and user profiles only. Cannot manage KBs or users.        |

Assess/Compare features are available to Super Admin and Admin in the Combined Phase.

---

What's Next After Your Current Stories

Based on the docs, your current stories cover Pillar 2 (Validation) and Pillar 3 (Assessment/Comparison). That includes:
• RFx and ToR validation
• Vendor assessment (Technical + Combined phases)
• Vendor comparison

Pillar 1 (Document Creation) is the remaining major feature area. It involves:
• The guided Q&A workflow for generating ToR, RFQ, RFP, and EoI documents
• Integration with Global KB + Project KB during generation
• The review/edit/download flow for generated documents

This is a distinct, self-contained feature set that builds on the KB infrastructure you're already working with but introduces a conversational AI generation flow rather than an upload-and-check flow.

---

Analytics (already partially in place)

Section 7.3.4 of the user docs describes a donut chart in the analytics dashboard that tracks assessment effort by document type:
• Bid Responses
• Terms of Reference
• Other Documents

Largest segments show where most assessment effort is concentrated, which helps with KB maintenance prioritisation and demonstrating platform value.
