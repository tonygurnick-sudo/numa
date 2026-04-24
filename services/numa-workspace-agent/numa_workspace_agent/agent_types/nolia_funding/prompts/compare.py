"""Prompt addendum for Nolia Funding application comparison (single phase).

Generates a neutral, fact-based side-by-side comparison of 2–3 prior
assessments. Operates on the structured findings from already-evaluated
applications — does NOT re-read the original applicant documents.

Two outputs:
- ``Comparison_<date>.json`` — structured payload for nice frontend rendering
- ``Comparison_<date>.md`` — human-readable Markdown for download / archive

Post-phase, the orchestrator converts the MD to PDF + DOCX.
"""

_CONTEXT = """\
## Context

A user has selected 2 or 3 prior assessments for the same Fund/Grant/\
Scholarship and asked for a side-by-side comparison. Inputs available in \
the workspace:

- `/workdir/prior-assessments/run-1/`, `run-2/`, (`run-3/`) — for each \
selected run, you have:
  - `_result.json` — the run-level result with applicant info + status
  - `outputs/Assessment_*.md` (and .pdf, .docx) — the rendered assessment
  - `tmp/findings.md` — the structured per-rule findings (this is the \
richest source for comparison). Document header block with applicant \
name + ID + rulebook + summary counts, then one `## <rule_id> — <rule_title>` \
section per rule, each containing a ```yaml fenced block with structured \
fields (`verdict`, `evidence_sources`, optional `score`, optional \
`notes`) and a prose body with the evidence narrative and verbatim \
numerics.
  - `tmp/applicant.json` — applicant identity record

- `/workdir/knowledge-bases/templates/` — the Funding KB's output template, \
used for context on which criteria groupings make sense.

Your job is to produce a comparison that lets a human assessor see, \
side-by-side, how each applicant performed against the same criteria — \
without ranking them or making recommendations.
"""


_COMPARISON_PRINCIPLES = """\
## Comparison Principles

1. **Neutral and fact-based.** No "Applicant A is better than Applicant B" \
language. No funding recommendations. No suggested action. Just facts.
2. **Per-criterion symmetric.** Every applicant's row covers the same set \
of criteria; if one applicant didn't have a finding for a rule (e.g. \
because Phase 2 marked it `not_applicable`), show that explicitly with \
`status: "not_applicable"` — don't omit the row. **If ALL applicants \
have `not_applicable` for a criterion, still include the row** so the \
assessor can see which checks were skipped.
3. **Preserve original verdicts and evidence.** Don't re-evaluate. Use \
each assessment's `findings.md` verdicts (from the per-rule YAML fenced \
blocks) directly. If two applicants have conflicting verdicts on the \
same rule, that's exactly what the comparison should surface — don't \
try to reconcile.
4. **Group criteria sensibly.** Look at the rule headings in \
`/workdir/prior-assessments/run-1/tmp/findings.md` — the `## <rule_id> \
— <rule_title>` headings hint at natural groupings. Mirror the section \
structure of the output template in `/workdir/knowledge-bases/templates/` \
if it gives clearer groupings (Eligibility / Documentation / Funding \
Determination / Approval / etc.).
5. **Keep narrative neutral.** A short narrative paragraph summarising \
factual differences is welcome ("Applicant A meets all eligibility \
criteria; Applicant B has a documentation gap"). No comparative \
judgements ("better", "stronger", "more deserving").
"""


_JSON_OUTPUT_SHAPE = """\
## JSON Output Shape

Write **`/workdir/outputs/Comparison_<YYYY-MM-DD-HHMM>.json`** with this \
structure (this is the contract — frontend renders directly from it):

```json
{
  "version": "1.0",
  "generated_at": "2026-04-19T10:34:12Z",
  "fund": {
    "name": "Learner Support Fund",
    "type": "Grant"
  },
  "applicants": [
    {
      "id": "APP-A1B2C3",
      "name": "Ella Jackson",
      "assessment_run_id": "run-1",
      "status": "APPROVED",
      "summary": "Application approved for $470 standard funding."
    }
  ],
  "criteria_groups": [
    {
      "group": "Eligibility",
      "criteria": [
        {
          "id": "F-001",
          "label": "Whakapapa Registration",
          "priority": "Critical",
          "results": [
            {
              "applicant_id": "APP-A1B2C3",
              "status": "manual_review",
              "notes": "Unable to connect to required database"
            },
            {
              "applicant_id": "APP-D4E5F6",
              "status": "manual_review",
              "notes": "Unable to connect to required database"
            }
          ]
        },
        {
          "id": "F-004",
          "label": "Educational enrollment — NZ Primary or Secondary school",
          "priority": "Critical",
          "results": [
            {
              "applicant_id": "APP-A1B2C3",
              "status": "met",
              "notes": "Verified in directory.csv (X High School)"
            },
            {
              "applicant_id": "APP-D4E5F6",
              "status": "met",
              "notes": "Verified in directory.csv (Y Primary School)"
            }
          ]
        },
        {
          "id": "F-042",
          "label": "Iwi Involvement — scored 1–5",
          "priority": "Major",
          "results": [
            {
              "applicant_id": "APP-A1B2C3",
              "status": "met",
              "score": {"value": 4, "max": 5},
              "notes": "Strong tangible contribution (Q7)"
            },
            {
              "applicant_id": "APP-D4E5F6",
              "status": "met",
              "score": {"value": 3, "max": 5},
              "notes": "Adequate contribution (Q7)"
            }
          ]
        }
      ]
    },
    {
      "group": "Funding Determination",
      "criteria": [ ... ]
    }
  ],
  "narrative": "Both applicants meet all verifiable eligibility criteria. Whakapapa registration requires manual review for both. Ella requests $470 standard funding; Estelle requests $940 enhanced funding for multi-subject NCEA support."
}
```

### Status values

Allowed `status` values for each result:
- `"met"` — applicant satisfies this criterion
- `"not_met"` — applicant does NOT satisfy this criterion
- `"partial"` — some conditions met, others not
- `"manual_review"` — requires data the pipeline can't access
- `"unclear"` — evidence ambiguous or missing
- `"not_applicable"` — rule doesn't apply to this applicant

These mirror the `verdict` values in each assessment's `findings.md` \
YAML blocks.

### Optional `score` field

If a criterion in a prior assessment's `findings.md` YAML block has a \
`score:` field (with `value:` and `max:` sub-keys, for scorecard-style \
rules like scholarship rubrics), **propagate it onto the matching \
result** in the compare JSON. Keep the original `value` and `max` \
exactly as they were. If one applicant has a score for a criterion and \
another doesn't, include the score on the applicant that has it and \
omit the `score` key from the other. Do NOT fabricate scores.

### Top-level applicant `status`

Use the status from each prior assessment's `_result.json`. Common values: \
`APPROVED`, `DECLINED`, `AWAITING MORE INFO`. If an assessment doesn't \
include a top-level status, derive a short summary from its rendered MD.
"""


_MD_OUTPUT_FORMAT = """\
## Markdown Output

Write **`/workdir/outputs/Comparison_<YYYY-MM-DD-HHMM>.md`** with the same \
date stamp as the JSON file. Use a side-by-side table format:

```markdown
# Application Comparison — Learner Support Fund

**Generated:** 19 April 2026
**Applications compared:** 2

## Applicants

| | Ella Jackson (APP-A1B2C3) | Estelle Brewster (APP-D4E5F6) |
|---|---|---|
| Status | APPROVED | APPROVED |
| Summary | Standard funding $470 | Enhanced funding $940 |

## Eligibility

| Criterion | Ella Jackson | Estelle Brewster |
|---|---|---|
| Whakapapa Registration (Critical) | ⚪ Manual review | ⚪ Manual review |
| Educational enrollment (Critical) | 🟢 Met | 🟢 Met |
| Curriculum subject (Critical) | 🟢 Met | 🟢 Met |

## Funding Determination

| Criterion | Ella Jackson | Estelle Brewster |
|---|---|---|
| Standard ($470) eligibility | 🟢 Recommended | ⚪ N/A |
| Enhanced ($940) eligibility | ⚪ N/A | 🟢 Recommended |

## Narrative

Both applicants meet all verifiable eligibility criteria. Whakapapa \
registration requires manual review for both. Ella requests standard \
$470 funding; Estelle qualifies for the enhanced $940 tier on \
multi-subject NCEA support.
```

### Status glyphs (use consistently — one glyph per status)

- 🟢 = met
- 🔴 = not_met
- 🟠 = partial
- ⚪ = manual_review
- ⚫ = not_applicable
- ❔ = unclear

These glyphs are one-to-one with the JSON `status` enum — each status \
has its own glyph. In particular, `manual_review` (⚪) and \
`not_applicable` (⚫) are visually distinct so the assessor can tell \
"we couldn't check this" apart from "this rule doesn't apply".

If only 2 applicants are compared, omit the third column. Do NOT pad \
with "N/A" placeholders for a missing third applicant.
"""


_FILE_NAMING = """\
## File Naming

Compute the `<YYYY-MM-DD-HHMM>` date stamp from today's date (UTC) and \
the current time. Both files use the same stamp:

```python
from datetime import datetime, timezone
stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M')
json_filename = f'Comparison_{stamp}.json'
md_filename = f'Comparison_{stamp}.md'
```
"""


_OPERATING_MODE = """\
## Operating Mode

- Read `findings.md` for each prior run — that's where the verdicts \
live (in the YAML fenced block under each `## <rule_id> — <rule_title>` \
heading), along with the prose evidence narrative.
- Don't re-read the applicants' original documents. Trust the prior \
assessments' findings.
- Don't make funding decisions. Don't recommend. Don't rank.
- Write BOTH outputs (JSON and MD) before stopping. The orchestrator \
converts the MD to PDF/DOCX after you finish.
- After writing both files, output a short summary (1–2 sentences: \
applicants compared, key factual differences) and STOP.

### Rule IDs are INTERNAL — handle them carefully

The ``rule_id`` values in each finding (``F-001``, ``G-003``, etc.) are \
**pipeline-internal tracking identifiers**. The assessor viewing this \
comparison has no concept of them.

- **JSON output:** the top-level ``criteria.id`` field IS allowed to \
carry the internal rule ID — the frontend uses it as a stable React key, \
not a user-facing label. The ``criteria.label`` is what the UI renders, \
so it must be the human-readable rule title (e.g. *"Educational \
enrollment — NZ Primary or Secondary school"*), not *"F-004 Educational \
enrollment"*.
- **MD output:** the rendered table uses only the human-readable label \
in the "Criterion" column. Never prefix with F-### / G-### — just *"Whakapapa \
Registration"*, not *"F-001 Whakapapa Registration"*.
- **Narrative section:** never reference rule IDs. Cite criteria by their \
human-readable label only, and (where helpful) by the source document + \
section from the findings' evidence (e.g. *"per LSF Policy V2 §5.1"*), \
never *"per rule F-042"*.
- **The ``notes`` strings in JSON results** should be the neutral evidence \
paraphrase (e.g. *"Verified in directory.csv"*) — not the internal ID.

The comparison must read as if the criteria were lifted directly from the \
organisation's policy documents.
"""


COMPARE_ADDENDUM = (
    _CONTEXT
    + _COMPARISON_PRINCIPLES
    + _JSON_OUTPUT_SHAPE
    + _MD_OUTPUT_FORMAT
    + _FILE_NAMING
    + _OPERATING_MODE
)
