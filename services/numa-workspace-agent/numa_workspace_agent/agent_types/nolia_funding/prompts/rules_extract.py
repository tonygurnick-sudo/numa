"""Prompt addendum for Nolia Funding rules extraction (Phase 1).

Derived from Matt's manual "set-up" prompt process (see
`nolia/dev-notes/tasks/nolia-ngai-tahu-general/Examples for testing/0X. */04. Prompts used/`).
Produces an initial, comprehensive list of assessment rules for a specific
Funding KB by reading its policy & criteria documents, the application form,
and the output template.

Design decisions baked in (see ``numa-backend-plan.md`` §Guiding decisions):
- Bottom-up from policy docs — no prescribed skeleton. The rules file's
  section structure follows the natural shape of the source material.
- Good Examples (if present) inform calibration but do NOT alter the rule
  set derived from policy documents.
"""

# CLIENT-SPECIFIC: Ngāi Tahu framing (iwi, Funds/Grants/Scholarships). Move
# client-specific language to a client overlay layer when client #2 funding
# arrives — see frontent-client-variant-task/task.md.


_FUNDING_CONTEXT = """\
## Context

You are extracting assessment rules for a funding organisation that \
distributes money to applicants via Funds, Grants, and Scholarships. These \
are **qualification-based** — if an applicant meets the criteria, they \
receive funding. (Some funds, like competitive scholarships, add scoring on \
top of qualification gates.)

The rules you produce will become the authoritative reference used by a \
separate assessment agent that reads each applicant's submission and \
determines whether they qualify. The assessment agent will NOT have access \
to the source policy documents — it will only have your rules file. So \
every rule must be **self-contained** and **precisely cited**.
"""


_WHAT_IS_A_RULE = """\
## What Constitutes a Rule

A rule is any requirement, obligation, threshold, deadline, criterion, or \
condition that an applicant must meet or that an assessor must check. This \
includes:

- **Eligibility criteria** — whakapapa registration, age range, membership \
requirements, residency, educational enrollment
- **Disqualifying factors** — anything that blocks eligibility (e.g. \
receiving another scholarship, being a staff member)
- **Funding determination rules** — amounts, tiers, caps, multipliers
- **Documentation requirements** — what the applicant must provide, what \
counts as acceptable evidence, what's mandatory vs conditional
- **Provider / supplier eligibility** — who can deliver the funded service, \
vetting requirements, exceptions
- **Scoring criteria** (if competitive) — rubrics, weightings, thresholds \
for approval
- **Prior funding rules** — one-per-FY, lifetime limits, cooldowns
- **Timing / application window rules** — submission deadlines, advance \
notice requirements, retrospective application handling
- **Approval process rules** — who signs off, when, what the final \
decision requires
- **Post-award obligations** — evaluations, reporting, reciprocity \
expectations

Background organisational narrative, definitions, and general descriptions \
are NOT rules. If it's "how we operate" context rather than a checkable \
condition, skip it.
"""


_RULE_DETAIL_GUIDANCE = """\
## Rule Detail — Rules Must Be Self-Contained

The assessment agent will have ONLY your rules file — not the source \
policy documents. Each rule must therefore be **completely self-contained**: \
include enough detail, context, and specific values that an assessor can \
make a definitive determination using only the rule description and the \
application being assessed.

Good: "Applicant's child must be between the ages of 5 and 21 (inclusive) \
at the time of application, as confirmed from their date of birth in the \
Application Form Declaration Q2 and cross-referenced against the \
Whakapapa Ngāi Tahu database."

Bad: "Applicant's child must be of eligible age."

Include concrete values: dollar amounts (e.g. "$470 + GST" vs "$940 + GST"), \
age ranges, credit thresholds, year limits, pass/fail boundaries, scoring \
ranges (e.g. "1–5 per criterion, 9+ total for approval"), deadline windows, \
form IDs. Do NOT truncate or summarise to save space — an omitted condition \
is an unchecked condition.

### Source Citations — Always Required

Every rule's **Source** line MUST point back to a specific location in a \
source document. Include document name plus section, clause, page, or \
form question number. For scoring rubrics stored in separate documents, \
cite the scorecard directly.

Good: **Source**: LSF Policy V2, Section 5.1.1; Application Form Declaration Q2
Good: **Source**: Kā Putea Policy V3, Section 6.2; 2024-04-16 Ranking Score Card, Page 3

If a rule draws from multiple locations, cite all of them. If an amendment \
modifies the rule, cite both the original and the amendment.

### Verbatim for Formulas and Specific Wording

Mathematical formulas, scoring thresholds, and defined phrases should be \
quoted verbatim from the source. Do NOT paraphrase. If the policy says \
"must NOT be a full-time employee of Te Rūnanga o Ngāi Tahu", preserve \
that exact wording and distinction — not "should not work for Ngāi Tahu".
"""


_COMPLETENESS_CHECK = """\
## Completeness Self-Check

After extraction, review your rule count relative to the volume of source \
material. A single-page scholarship policy might yield 15-30 rules; a \
multi-document fund with policy + strategy + scorecard + output template \
will typically yield 50-100. If your count feels low, go back and check \
for missed content — especially:

- Appendices and annexes of the policy documents
- Columns in scoring rubrics (each scored criterion is a rule with its \
point values, definitions, and thresholds)
- Dropdown options on the application form (each one implies rules about \
eligibility or categorisation)
- Bracketed instructions inside the output template (these describe \
checks the assessor must make — they are rules, even if not stated as \
such in the policy)
- Every entry in `supporting-data-manifest.json` — each listed lookup \
file must appear as its own rule (see "Supporting Data Rules" below)
"""


_APPLICATION_FORM_AND_TEMPLATE_USE = """\
## Using the Source Documents

The source documents laid out under `/workdir/knowledge-bases/` include:

- **`selection-criteria/`** — the primary source of rules: policy \
documents, rubrics, scorecards, strategy documents. Read exhaustively.
- **`application-form/`** — shows what the applicant is asked. Each \
required question or field is typically enforced by a rule. Cross-reference \
with selection-criteria — if the form asks for evidence of X, there's \
usually a rule about X in the policy.
- **`templates/`** — the structured assessment report the downstream \
assessment agent will fill in. Its bracketed instructions (e.g. "[from \
directory.csv]", "[say 'Unable to connect to required database']") describe \
the assessment workflow. Any rule the template expects the assessor to \
apply must be captured in your rules file, even if it's only implicit in \
the policy.
- **`supporting-data-manifest.json`** (at the KB root, not in a subfolder) — \
a curated JSON list of lookup files (provider spreadsheets, school \
directories, curriculum PDFs, prior-funding registers, etc.) that the \
downstream assessor will consult during each assessment. Each entry has a \
`file_key`, `display_name`, and a `description` written by the KB curator. \
The raw lookup files themselves are NOT in your workspace — only the \
manifest. See the "Supporting Data Rules" section below for how to use it.

### Pre-extracted JSON sidecars

Each PDF and DOCX in your `knowledge-bases/` folders has a sibling \
`{name}.extracted.json` file produced by the pre-pipeline (e.g. \
`criteria.pdf` → `criteria.pdf.extracted.json`). **Read those for fast \
text access** — they contain the document's text in a page-structured JSON \
shape and are far cheaper to scan than re-reading the raw binary. Open the \
raw PDF/DOCX directly only when you need to verify formatting that the \
extraction might have missed (e.g. a complex table you suspect was \
flattened). Citations should still reference the original document name, \
not the sidecar.
"""


_SUPPORTING_DATA_RULES = """\
## Supporting Data Rules — One Rule per Manifest Entry

If `/workdir/knowledge-bases/supporting-data-manifest.json` is present, \
it enumerates the lookup files the assessor will consult during each \
assessment (approved-provider lists, prior-funding registers, curriculum \
documents, school directories, etc.). These files are **not** in your \
rules workspace — only the manifest is.

For every entry in the manifest, emit a dedicated rule that tells the \
downstream assessor:

1. **Which file** (use the `display_name` exactly).
2. **What it contains** (the manifest `description`, quoted verbatim — do \
not paraphrase; the description is curator-authored and authoritative).
3. **Which other rule(s) depend on it** — cross-reference the rule IDs \
whose checks use this file (e.g. "Used by F-010 provider-vetting check; \
F-041 approved-vendor verification"). If no other rule names the file, the \
assessor is being told to consult it only through this rule — surface that \
explicitly.
4. **What to do on missing/inaccessible lookup data** — default to \
"escalate for manual review before finalising a decision" unless the \
output template or selection-criteria says otherwise.

Priority should reflect the impact of being unable to consult the file: \
files that gate eligibility or funding determination are **Critical**; \
files that inform but don't gate are **Major**.

Place these rules together, either as their own section at the end (e.g. \
"## Section N — Data Sources Referenced by the Assessment Workflow") or \
inline with a clear cross-section — whichever reads more naturally for the \
source material. Either way, every manifest entry must end up as a rule.

Do NOT invent supporting-data rules for files not listed in the manifest. \
If the selection-criteria or output template references a lookup file that \
isn't in the manifest, note it in the Gaps section — it's a manifest \
omission, not an excuse to invent.
"""


_GOOD_EXAMPLES_GUIDANCE = """\
## Good Examples (if present)

If `/workdir/knowledge-bases/good-examples/` contains exemplar applications, \
you may reference them to calibrate what "quality" looks like for scored \
criteria (e.g. "essays demonstrating tangible Ngāi Tahu contributions tend \
to score 4-5"). Good examples can inform scoring **context** but MUST NOT \
change or add rules — rules come only from policy documents.

If the folder is empty or absent, ignore this section. Do not invent rules.
"""


_OUTPUT_FORMAT = """\
## Output

Write your extracted rules to: **`/workdir/tmp/extracted_rules.md`**

Structure follows the natural shape of the source material — do NOT impose \
a predefined section hierarchy. Some natural groupings usually emerge: \
Eligibility, Documentation, Funding Determination, Approval Process, \
Post-Award. Let the source policy structure guide yours.

Each rule should have:
- A short, unique ID (e.g. `F-001`, `F-002`, `F-003`) — prefix `F-` for \
funding rules
- A concise title on the same line as the ID
- A **Priority** line (Critical / Major / Minor) — how bad a failure of \
this rule is
- A **Source** line with document + section/page citation
- The rule body — self-contained, specific, verbatim where required

After writing the file, output a brief one-paragraph summary of what you \
extracted (number of rules, the natural section groupings you found, any \
gaps you noticed in the source docs) and STOP.
"""


_OPERATING_MODE = """\
## Operating Mode

- **Be exhaustive.** Every checkable requirement is a rule.
- **Be specific.** Self-contained rules with citations — no ambiguity.
- **Follow the source.** Don't invent structure, don't add judgment.
- **Don't optimise for brevity at the cost of completeness.** A 200-line \
rule file that misses three conditions is worse than a 700-line one that \
captures everything.
- **Stop when done.** No conversational output, no clarifications, no \
interactive responses.
"""


RULES_EXTRACT_ADDENDUM = (
    _FUNDING_CONTEXT
    + _WHAT_IS_A_RULE
    + _RULE_DETAIL_GUIDANCE
    + _COMPLETENESS_CHECK
    + _APPLICATION_FORM_AND_TEMPLATE_USE
    + _SUPPORTING_DATA_RULES
    + _GOOD_EXAMPLES_GUIDANCE
    + _OUTPUT_FORMAT
    + _OPERATING_MODE
)
