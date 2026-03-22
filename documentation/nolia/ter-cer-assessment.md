# TER/CER Document Validation

## Current Scope

Phase 1 launch focuses on TER/CER validation using the **Global + Procurement Activity** KB pairing. This is the first of four planned pairings:

- **TER/CER validation: Global + Procurement Activity** <-- current focus
- ToR validation: Global + Project (future)
- Vendor assessment: Global + Procurement Activity (future)
- ToR/RFP creation: Global + Project (future)

## Document Types

**TER (Technical Evaluation Report):** Assesses vendor technical proposals only. Focuses on technical evaluation methodology, scoring criteria, qualification checks, and form completeness.

**CER (Combined Evaluation Report):** Assesses both technical AND financial proposals. Covers everything in a TER plus financial evaluation sections — price comparison, combined scoring, financial responsiveness, and the transition from technical shortlisting (stage 1) to final selection (stage 2).

**Auto-detection:** The EDA phase identifies whether the uploaded document is a TER or CER by looking for financial evaluation content. The user doesn't need a document type dropdown — they've already indicated the type by selecting their Global KB (e.g., "Evaluation Report TER" vs "Evaluation Report CER"), and the EDA confirms from actual content. Mismatches are flagged as findings.

## The 5-Phase Pipeline

### Phase 0: Document Extraction (Infrastructure)

Not an AI phase — pure infrastructure. Converts uploaded PDF into structured JSON for AI analysis.

**Process:**

1. Check file type — if already JSON, skip extraction
2. Split PDF into chunks (100 pages each)
3. Extract chunks in parallel (up to 10 concurrent Lambda invocations using `extract-content-from-file`)
4. Merge extracted chunks into single `.extracted.json`

**Output format:**

```json
[
  { "page_number": 1, "num_words": 342, "text": "# Page Title\n\nMarkdown content..." },
  { "page_number": 2, "num_words": 518, "text": "..." }
]
```

Note: `page_number` is the PDF page index, NOT the printed page number (they differ due to cover pages, roman numerals, etc.).

### Phase 1: EDA (Exploratory Data Analysis)

**Agent type:** `nolia-eda`
**Purpose:** Create a comprehensive map of the document's structure. READ-ONLY analysis — no compliance judgments.

**What it does:**

1. Assess document size and plan sub-agent strategy (>100 pages → parallel chunk analysis)
2. Extract metadata (title, type, project, country, borrower)
3. Discover structure (lots, forms, major sections, ToC)
4. Inventory participants (bidders, evaluation committee)
5. Preview key findings (zero-responsive lots, scoring imbalances)
6. Document quality assessment (extraction errors, missing pages)
7. Timeline extraction (advertisement, submission, opening dates)
8. Procurement-specific details

**Outputs (to `/workdir/tmp/`):**

| File                     | Description                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `document_manifest.json` | Structured metadata — lots, forms, bidders, timeline, statistics                              |
| `document_summary.md`    | Human-readable summary with tables                                                            |
| `page_index.csv`         | Per-page index: page_number, content, form_id, lot_numbers, bidders_mentioned, quality_issues |

### Phase 2: Global Rules Compliance

**Agent type:** `nolia-global`
**Runs after:** Phase 1 (EDA). **Runs before:** Phase 3.

**Purpose:** Check against World Bank global procurement rules (apply to ALL procurements regardless of type).

**Process:**

1. Load rules from `global-rules.md` (each with ID like G-001)
2. For each rule: determine applicability → check compliance → record evidence
3. Assign compliance status: COMPLIANT / NON-COMPLIANT / PARTIAL / UNABLE TO VERIFY
4. Assign severity: CRITICAL / MAJOR / MINOR

**Severity definitions:**

- **CRITICAL:** Would result in misprocurement or contract cancellation
- **MAJOR:** Significant deviation requiring correction
- **MINOR:** Administrative issue

**Outputs (to `/workdir/tmp/`):**

| File                                  | Description                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `global_rules_compliance.csv`         | rule_id, category, rule_summary, compliance_status, severity, evidence_pages, finding_detail, recommendation |
| `global_rules_summary.md`             | Compliance statistics, critical/major/minor findings                                                         |
| `global_step_verification_needed.csv` | Rules requiring external verification (e.g., STEP system)                                                    |
| `global-phase-notes.md`               | Key narrative findings                                                                                       |

### Phase 3: Procurement Rules (Domain-Specific)

**Agent type:** `nolia-procurement` (for evaluation-report) or `nolia-project` (for terms-of-reference)
**Runs after:** Phase 2 (Global Rules).

**Purpose:** Deep-dive analysis of procurement-specific compliance — technical evaluation forms, qualification criteria, scoring.

**What it does (procurement path):**

1. Load procurement rules from `procurement-rules.md`
2. Technical Evaluation Deep Dive (Forms 12/13/14) — extract criteria, create scoring matrix, spot-check decisions
3. Qualification Criteria Deep Dive (Form 11) — check each criterion, flag anomalous rejections
4. Recurring Issue Detection — patterns across bidders and lots
5. Lot-Specific Compliance — special attention to lots with zero responsive bidders
6. Rule-by-Rule compliance check

**Outputs (to `/workdir/tmp/`):**

| File                               | Description                                            |
| ---------------------------------- | ------------------------------------------------------ |
| `procurement_rules_compliance.csv` | Same schema as global CSV                              |
| `procurement_rules_summary.md`     | Compliance statistics, technical evaluation analysis   |
| `technical_scoring_analysis.json`  | Criteria inventory, scoring by lot, spot-check results |
| `recurring_issues.csv`             | Systemic patterns across bidders/lots                  |
| `failed_lots_analysis.md`          | Analysis of lots with zero responsive bidders          |
| `procurement-phase-notes.md`       | Key findings                                           |

### Phase 4: Report Generation (Two Passes)

**Agent type:** `nolia-report-generate` then `nolia-report-review`

**Purpose:** Synthesize ALL prior findings into a professional World Bank peer review report.

**Pass 1 (Generate):** Reads all phase notes, compliance CSVs, summaries, and the output template. Produces initial report.

**Pass 2 (Review):** Cross-references generated report against original data:

- Replaces internal rule IDs (G-001, P-003) with actual policy citations
- Verifies all sections present and properly structured
- Makes annexes detailed with specific data
- Ensures all findings from Phases 2/3 included

**Report structure (default template):**

| Section                       | Content                                          |
| ----------------------------- | ------------------------------------------------ |
| Header                        | Procurement details, RFB number, project, dates  |
| 1. Executive Summary          | Overall compliance, issue counts, recommendation |
| 2. Preliminary Examination    | Form 10A findings                                |
| 3. Detailed Evaluation        | 3.1 Qualification, 3.2 Technical Specs           |
| 4. WB Regulation Compliance   | Priority findings from global rules              |
| 5. Document Quality Issues    | Formatting, dates, cross-references              |
| 6. Summary and Recommendation | Overall assessment, final recommendation         |

**Output:** `outputs/Final_Evaluation_Report_{PROCUREMENT_NAME}.md`

### Phase 5: Translation (Conditional)

**Agent type:** `nolia-translate`
**Runs only if:** `output_language != "english"`

**Purpose:** Translate the final report while preserving structure, formatting, proper nouns, acronyms, and policy citations.

**Supported languages:** English (skip), Bahasa Indonesia

## KB Pairing Logic

The system determines which KBs and rules to use based on assessment type:

| Assessment Type      | KBs Used             | Rules Applied                              | Phase 3 Agent       | Report Template          |
| -------------------- | -------------------- | ------------------------------------------ | ------------------- | ------------------------ |
| `evaluation-report`  | Global + Procurement | `global-rules.md` + `procurement-rules.md` | `nolia-procurement` | Evaluation report format |
| `terms-of-reference` | Global + Project     | `global-rules.md` + `project-rules.md`     | `nolia-project`     | ToR assessment format    |

## Rules File Format

Rules files (`*-rules.md`) are structured markdown with rule definitions:

```markdown
## Category: Bid Submission Requirements

### G-001: Bid Submission Deadline Compliance

**Priority:** Critical
**Source:** ITB 22.1, PR2025 Section 5.4
**Applicable Forms:** Form 10A

Rule: All bids must be received before the deadline stated in the BDS...
```

Each rule has: unique ID, category, priority, source citation, applicable forms/sections, and the rule text. The compliance phases check each rule systematically.

## Output Templates

The report template defines the structure of the final compliance report. Resolution priority:

1. Custom template from domain KB (`documents/kb-{id}/templates/`)
2. Custom template from global KB
3. Bundled default template

Templates can be in `.md`, `.docx`, or other formats. They define sections, subsection structure, and what content each section should contain.
