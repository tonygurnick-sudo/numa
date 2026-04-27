"""Prompt addendum for Nolia Funding Global rules extraction (Phase 1).

Global KBs are org-wide — they contain policies, values, disqualification
rules, and general funding principles that apply across multiple
Funds/Grants/Scholarships. The inputs are simpler than a Funding KB:
just a single flat ``documents/`` folder, no application form, no
output template, no good examples.

This prompt is deliberately thinner than ``rules_extract.py``. The
pipeline shape is the same (extract → review), but the source material
and rule scope differ.

Design decisions baked in (mirrors the funding-variant decisions):
- Bottom-up from policy docs — no prescribed skeleton. Structure follows
  the natural shape of the source material.
- Rule IDs use a ``G-###`` prefix to disambiguate from per-Fund rules
  (``F-###``).
"""

# CLIENT-SPECIFIC: Ngāi Tahu framing (iwi, Te Rūnanga). Move client-specific
# language to a client overlay when client #2 funding arrives.


_GLOBAL_CONTEXT = """\
## Context

You are extracting **organisation-wide** assessment rules for a funding \
organisation. These rules apply across EVERY Fund, Grant, and Scholarship \
the organisation administers — they are not fund-specific.

Typical content of a Global KB:

- Organisation-wide **values** and guiding principles (e.g. alignment \
with Ngāi Tahu values: whakapapa, manaakitanga, rangatiratanga).
- **Disqualification rules** that apply universally (e.g. applicant must \
not be a current staff member of the organisation).
- **Applicant-identity verification standards** (e.g. whakapapa \
registration requirements, proof-of-identity expectations).
- **Anti-conflict-of-interest** rules.
- **General grant-administration policies** (reporting requirements, \
privacy, data handling).

The rules you produce become the authoritative **organisation-level** \
reference. A downstream assessment agent evaluates each application \
against BOTH these global rules AND the specific Fund's rules, with \
**Funding rules winning on conflict**. Global rules are the baseline \
that every application must satisfy regardless of which Fund they're \
applying to.

Like the funding rules file, this file will be the assessment agent's \
ONLY reference for Global rules — so every rule must be \
**self-contained** and **precisely cited** back to the source document.
"""


_WHAT_IS_A_GLOBAL_RULE = """\
## What Constitutes a Global Rule

A Global rule is any organisation-wide requirement, obligation, \
principle, or disqualifying factor that applies regardless of which \
specific Fund/Grant/Scholarship an applicant is applying to. This \
includes:

- **Universal eligibility** — registration / membership / residency / \
affiliation requirements that apply to all applications
- **Universal disqualifying factors** — conditions that make someone \
ineligible for ANY funding (e.g. current staff, active conflicts of \
interest)
- **Values alignment** — requirements that applications reflect the \
organisation's stated values or priorities
- **Identity verification standards** — evidence expectations that \
apply to every applicant
- **Data / privacy policies** — how applicant data is handled, consent \
requirements
- **Anti-fraud / anti-conflict-of-interest rules**
- **Reporting and post-award expectations** that apply to all grant \
recipients
- **Exceptions and escalation paths** — organisation-level processes for \
special cases

**NOT a Global rule (skip these):**

- Fund-specific criteria (age ranges, funding amounts, specific subject \
requirements) — those belong in the Funding KB's rules.
- Background organisational narrative / history / definitions.
- Procedural descriptions of "how we run assessments" that aren't \
checkable conditions.
"""


_RULE_DETAIL_GUIDANCE = """\
## Rule Detail — Rules Must Be Self-Contained

The assessment agent will have ONLY your rules file — not the source \
policy documents. Each rule must therefore be **completely \
self-contained**: include enough detail, context, and specific values \
that an assessor can make a definitive determination using only the \
rule description and the application being assessed.

Good: "Applicant must not be a current full-time or part-time employee \
of Te Rūnanga o Ngāi Tahu. Verify from the applicant's self-declaration \
in the application form and cross-reference against the staff directory \
if available; where not available, mark for manual review."

Bad: "Applicant must not be a current staff member."

Include concrete values and specific conditions. Do NOT truncate or \
summarise to save space.

### Source Citations — Always Required

Every rule's **Source** line MUST point back to a specific location in a \
source document. Include document name plus section, clause, page, or \
paragraph number.

Good: **Source**: Ngāi Tahu Grants Administration Policy V3, Section 2.4 \
(Conflicts of Interest)

If a rule draws from multiple documents, cite all of them.

### Pre-extracted JSON sidecars

Each PDF and DOCX in `/workdir/knowledge-bases/documents/` has a sibling \
`{name}.extracted.json` file produced by the pre-pipeline. **Read those \
for fast text access** — they contain the document's text in a \
page-structured JSON shape and are far cheaper to scan than re-reading \
the raw binary. Open the raw PDF/DOCX directly only when you need to \
verify formatting that the extraction might have missed. Citations should \
still reference the original document name, not the sidecar.

### Verbatim for Defined Terms

Defined organisational terms, values, and precise policy wording should \
be quoted verbatim from the source. Do NOT paraphrase where exact \
phrasing matters (e.g. preserve "tamariki" vs "children", preserve \
diacritics in te reo Māori terms).
"""


_COMPLETENESS_CHECK = """\
## Completeness Self-Check

After extraction, review your rule count. A typical Global KB for a \
funding organisation yields 10-50 rules — fewer than a Funding KB \
(which has all the fund-specific criteria too). If your count is \
unusually low, check for:

- Appendices and annexes
- "Important Notes" callout boxes
- Policy statements that imply rules even if not stated as such
- Values / guiding-principle sections — each distinct principle is \
usually a checkable rule
- Compliance / privacy statements

If there are genuinely few checkable rules in the source material \
(e.g. the Global KB is mostly narrative), that's fine — don't invent \
rules to hit a target.
"""


_OUTPUT_FORMAT = """\
## Output

Write your extracted rules to: **`/workdir/tmp/extracted_global_rules.md`**

Structure follows the natural shape of the source material — do NOT \
impose a predefined section hierarchy. Natural groupings usually \
emerge: Values, Universal Eligibility, Disqualifying Factors, \
Identity Verification, Conflict of Interest, Data & Privacy, Reporting.

Each rule should have:

- A short, unique ID (e.g. `G-001`, `G-002`, `G-003`) — prefix `G-` for \
Global rules (to distinguish from fund-specific `F-###` rules)
- A concise title on the same line as the ID
- A **Priority** line (Critical / Major / Minor) — how bad a failure is
- A **Source** line with document + section/page citation
- The rule body — self-contained, specific, verbatim where required

After writing the file, output a brief one-paragraph summary of what \
you extracted (number of rules, natural section groupings, any gaps in \
source coverage) and STOP.
"""


_OPERATING_MODE = """\
## Operating Mode

- **Be exhaustive.** Every checkable org-wide requirement is a rule.
- **Be specific.** Self-contained rules with citations — no ambiguity.
- **Follow the source.** Don't invent structure, don't add judgment.
- **Remember the scope.** If a rule is specific to one Fund, it doesn't \
belong here — leave it for the Funding KB's rules generation.
- **Stop when done.** No conversational output, no clarifications, no \
interactive responses.
"""


RULES_EXTRACT_GLOBAL_ADDENDUM = (
    _GLOBAL_CONTEXT
    + _WHAT_IS_A_GLOBAL_RULE
    + _RULE_DETAIL_GUIDANCE
    + _COMPLETENESS_CHECK
    + _OUTPUT_FORMAT
    + _OPERATING_MODE
)
