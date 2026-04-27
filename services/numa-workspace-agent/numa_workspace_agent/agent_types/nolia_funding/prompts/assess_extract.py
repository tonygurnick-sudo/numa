"""Prompt addendum for Nolia Funding assessment — Phase 1 (Extract Applicant Info).

Reads the applicant's uploaded documents, unifies them into a single
structured applicant record for downstream phases. Lightweight — no
assessment judgments, no rule checking.

Addendum structure (concatenated in order):
    _CONTEXT          — what the uploaded/extracted files look like in /workdir/
    _WHAT_TO_EXTRACT  — which facts to pull + ambiguity-handling rules
    _OUTPUT_FORMAT    — exact JSON shape of /workdir/tmp/applicant.json
    _OPERATING_MODE   — terminal behaviour (write, summarise, stop)
"""

# ROLE: Tell the agent what's already in /workdir/uploads/ at Phase 1 start.
# The pre-pipeline (extract_funding_application) has already normalised each
# uploaded file into an `extracted_{stem}.json` — this stanza sets that as
# a given so the agent doesn't try to re-extract or read raw PDFs/DOCXs.
_CONTEXT = """\
## Context

A user has uploaded an application package for a funding product \
(Fund / Grant / Scholarship). The package may contain:

- The filled application form (usually DOCX / PDF)
- Supporting documents (references, transcripts, quotes, plans, essays, etc.)

All files have been pre-extracted into `/workdir/uploads/` as JSON files:

- Each PDF / DOCX that was uploaded becomes `extracted_{stem}.json`
- Any file that was uploaded as `.json` directly is passed through

Your job is to read these extracted JSONs and produce a unified, structured \
applicant record for the downstream evaluation phase.
"""


# ROLE: The extraction checklist. Fields are deliberately broad — some
# Funds need DoB + age (scholarships), some need provider + quote (LSF/SLA),
# some need none of those. The agent emits `null` for missing values so
# downstream phases know what the applicant package did/didn't carry.
# The "preserve diacritics" rule is load-bearing for Ngāi Tahu — dropping
# macrons mis-renders applicant names in the final assessment.
_WHAT_TO_EXTRACT = """\
## What to Extract

Read EVERY extracted JSON in `/workdir/uploads/`. Don't skip files — \
supporting documents often carry the most reliable version of key facts \
(e.g. date of birth, school name, requested amount).

Pull out the following, where present:

- **Applicant name** — exact spelling, preserve diacritics (Ngāi, Rūnanga, \
tamariki etc.). Prefer the application form; cross-check against supporting \
docs. If the name differs across documents, record the primary spelling \
and note the variants.
- **Applicant identity details** — date of birth, age if stated, contact \
email, phone, postal address.
- **Parent / guardian / supporter info** — for grants involving minors or \
scholarships with reference letters: name, relationship, contact.
- **Institution** — school, university, course of study. Preserve exact \
spelling ("University of Canterbury", not "UC").
- **Requested amount** — dollar amount, with currency and GST handling \
noted (e.g. "$470 + GST" vs "$470 incl GST").
- **Fund/Grant/Scholarship selected** — from the application form, exactly \
as the applicant indicated.
- **Provider/supplier** — for grants involving third parties (tutors, \
assessment providers): name and contact.
- **Application summary** — a 2–4 sentence neutral description of what the \
applicant is asking for and why. No judgments about eligibility or quality.
- **Supporting document inventory** — for each uploaded file, a one-line \
description of what it is ("pre-tuition report for Term 3 2025", \
"academic transcript for semester 1 2025").

## Ambiguity handling

If information is missing or inconsistent, record it as missing — do NOT \
guess. Downstream phases need to know what was and wasn't in the \
application.

If applicant name extraction is uncertain (e.g. the form is blank, or \
names don't match across documents), flag `requires_manual_review: true` \
with a reason. The pipeline will surface this on the assessment row.
"""


# ROLE: Defines the exact shape of applicant.json. Phase 2 and Phase 3
# both read this file; Phase 3 later extends it in-place with a `decision`
# block. The schema is also used by _read_applicant_summary() in the
# orchestrator to build _result.json + the mid-run _applicant.json preview.
# If any field name changes here, update _read_applicant_summary() too.
_OUTPUT_FORMAT = """\
## Output

Write **`/workdir/tmp/applicant.json`** with exactly this shape:

```json
{
  "version": "1.0",
  "applicant_id": "APP-A1B2C3",
  "applicant": {
    "name": "Ella Jackson",
    "name_variants": [],
    "date_of_birth": "2012-03-15",
    "age": 13,
    "contact": {
      "email": "...",
      "phone": "...",
      "postal_address": "..."
    },
    "parent_or_guardian": {
      "name": "...",
      "relationship": "parent",
      "contact": "..."
    },
    "institution": {
      "name": "...",
      "type": "primary school"
    },
    "selected_fund": "Learner Support Fund",
    "requested_amount": {
      "raw": "$470 + GST",
      "numeric": 470,
      "currency": "NZD",
      "gst_included": false
    },
    "provider": {
      "name": "...",
      "contact": "..."
    },
    "summary": "..."
  },
  "documents": [
    {
      "filename": "Learner Support Grant - Ella Jackson.docx",
      "role": "application_form",
      "description": "Filled application form for Learner Support Grant"
    },
    {
      "filename": "LSG-Pre-tuition-report-JACKSON E FILLED BY ERR.pdf",
      "role": "supporting_document",
      "description": "Pre-tuition report for Term 3 2025 completed by an ERR teacher"
    }
  ],
  "requires_manual_review": false,
  "review_reason": null,
  "missing_fields": []
}
```

Rules:

- Every field is optional — write `null` if missing, don't omit keys.
- **`applicant_id`** (top-level) — the canonical handle for this applicant. \
If the assessor's user message supplied an applicant ID, use it verbatim. \
Otherwise set `applicant_id` equal to `applicant.name` (i.e. the full \
name you extracted from the documents). Never invent a synthetic ID.
- `missing_fields` lists any field name where the data wasn't found.
- `name_variants` is empty `[]` unless the name genuinely differed across \
documents.
- `requires_manual_review` is `false` unless name extraction failed or \
applicant identity is genuinely ambiguous.
- Put the filename (not path) in `documents[].filename`; pair with the \
original upload, not the extracted JSON filename.
- `role` values: `application_form` | `supporting_document` | `other`.

After writing the file, output a short summary (2–3 sentences: applicant \
name, fund selected, requested amount, number of supporting docs) and STOP.
"""


# ROLE: Terminal behaviour — "write, summarise briefly, stop". Phase 1 is
# the lightest of the three phases (~30s, ~10 turns typical), so this is
# mostly about preventing conversational drift or re-reading files.
_OPERATING_MODE = """\
## Operating Mode

- Read every extracted JSON in `/workdir/uploads/`. Don't stop at the first.
- Preserve spellings and diacritics literally.
- Don't make judgments — Phase 2 does that.
- Don't fill fields with guesses — missing is better than wrong.
- No conversational output. Write the file, produce the summary, stop.
"""


ASSESS_EXTRACT_ADDENDUM = _CONTEXT + _WHAT_TO_EXTRACT + _OUTPUT_FORMAT + _OPERATING_MODE
