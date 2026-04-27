"""Prompt addendum for Nolia Funding rules review (Phase 2).

Takes the draft rules file produced by Phase 1 (extraction), re-reads the
source documents, adds or corrects citations, deduplicates any repeats,
assembles the three mandatory closing sections (Strategic Framework,
Decision Framework, Critical Rules Summary), and writes the final
``funding-rules.md``.

A targeted Phase 3 Second Review runs after this phase to audit structural
completeness (closing sections present, manifest coverage 100%, all cross-
references resolve). Phase 2 does the heavy reading; Phase 3 does the audit.
"""

# CLIENT-SPECIFIC: Ngāi Tahu framing in examples. Move client-specific
# language to a client overlay when client #2 funding arrives.


_CONTEXT = """\
## Context

Phase 1 (extraction) produced a draft rules file at \
**`/workdir/tmp/extracted_rules.md`**.

Your job is to review it against the original source documents in \
`/workdir/knowledge-bases/`, improve it where needed, and write the final \
version.
"""


_REVIEW_CHECKS = """\
## What to Review

For every rule in the draft file:

1. **Citation accuracy.** Does the **Source** line actually point to the \
claimed location in the source document? Open the cited document and verify. \
If the citation is wrong or missing, fix it.

2. **Self-containment.** Can an assessor make a definitive determination \
using only the rule text? If the rule says "meet the minimum age" without \
stating what the minimum is, that's a failure — correct it with the \
specific value.

3. **Completeness.** Are there rules in the source documents that didn't \
make it into the draft? Common misses:
   - Conditions buried inside "Important Notes" callout boxes
   - Exceptions listed after the main rule ("Exception to Vetting \
Requirements:", "Alternative Overseas Providers:")
   - Bracketed instructions in the output template that imply rules
   - Dropdown options in the application form that imply categorical rules
   - Scoring rubric columns (each scored criterion = one rule with \
point values)
   - Entries in `supporting-data-manifest.json` that didn't receive a \
dedicated rule (see "Supporting-Data Manifest Coverage" below)

   Add missing rules with appropriate IDs (continuing the F-001, F-002 \
sequence).

4. **Duplication.** If two rules say essentially the same thing, merge \
them and cite both original locations.

5. **Verbatim preservation.** Formulas, mathematical expressions, and \
precise policy wording should be quoted exactly from source. If Phase 1 \
paraphrased a formula or rule wording that should be verbatim, restore \
the original.

6. **Amendments.** If the source documents include addenda / updates / \
later versions, verify the rule reflects the **final amended state** — \
not the original. Cite both the original clause and the amendment.

7. **Supporting-Data Manifest Coverage.** If \
`/workdir/knowledge-bases/supporting-data-manifest.json` is present, open \
it. Every entry in its `files` array must be represented by a dedicated \
rule in the draft. For each manifest entry, verify:

   - A rule exists that names the file (by `display_name`).
   - The rule body quotes the manifest `description` verbatim (the \
description is curator-authored — do not paraphrase).
   - The rule cross-references the rule IDs whose checks depend on this \
file (e.g. "Used by F-010 provider-vetting check").
   - The rule states what the assessor does on missing/inaccessible lookup \
data (default: escalate for manual review unless the output template or \
selection-criteria says otherwise).
   - Priority reflects impact: gating files are **Critical**, informing-\
only files are **Major**.

   If a manifest entry has no corresponding rule, add one. If a rule \
paraphrases the manifest description instead of quoting it verbatim, \
restore the verbatim quote. If the selection-criteria or output template \
references a lookup file that isn't in the manifest, flag it as a manifest \
omission in the Gaps section — do NOT invent a rule from nothing.
"""


_SECTION_ORDERING = """\
## Section Ordering

The draft rules file sections the rules by natural grouping from the source \
policy. Keep that structure — do NOT re-group to a different scheme. \
However, check that:

- The order of sections roughly follows the lifecycle of an assessment \
(Eligibility → Funding Determination → Documentation → Evaluation → \
Approval → Post-Award).
- Within a section, rules are grouped by sub-topic (e.g. all eligibility \
rules together, then all disqualifying-factor rules together).

Reorder within a section if it improves readability, but don't reorganise \
sections wholesale.
"""


_MANDATORY_CLOSING_SECTIONS = """\
## Mandatory Closing Sections

After the atomic rule sections, the rules file **must** include the three \
sections below. Skipping any of them is a quality failure — Phase 3 will \
flag it and reject the review output.

### Strategic Framework (Context, Not Rules) — conditional

Include this section **only if** a strategy, guiding-principles, or \
KPI document is present in `selection-criteria/` (e.g. a Grants Team \
Strategy doc). If no such document is present, omit the section entirely \
— do not invent content.

When present:

- Place the section **before** the atomic rule sections (right after the \
header block) so it orients the assessor.
- Mark it clearly as context, not rules: open with an italicised note \
such as *"This section is provided as operational context to inform \
assessor judgment. Nothing in this section is itself a rule — no rule \
elsewhere in the file should trigger on the content of this section."*
- Include (verbatim from the source): guiding principles; strategic pou \
or outcomes; KPIs or targets. Keep it tight — one-line bullets where \
possible.
- Do **not** assign F-IDs to items in this section.

### Decision Framework (aggregation) — required

At the **end** of the atomic rule sections (but before the Critical Rules \
Summary), include a "Decision Framework" section that aggregates the \
atomic rules into the distinct decision outcomes an assessor can reach. \
The exact buckets depend on the fund's mechanics — include only those \
that apply:

- **APPROVE (standard tier)** — all gating conditions met, no \
disqualifying factors, funding at the base tier
- **APPROVE (enhanced tier)** — base conditions plus the tier-\
elevator conditions (e.g. remedial threshold met; NCEA multi-subject); \
funding at the higher tier
- **APPROVE (scored)** — for competitive scholarships: score above \
the approval threshold on the scoring criteria
- **DECLINE** — any disqualifying condition is present; includes \
verbatim decline-reason wording from the output template's IF DECLINED \
checklist where available
- **REQUEST MORE INFO** — missing mandatory documentation or \
unresolved ambiguity
- **ESCALATE** — cases that explicitly require human/LS Administrator \
review (out-of-curriculum support, alternative overseas provider, policy \
interpretation questions, etc.)

For each applicable bucket:

- Use a `### ` heading.
- List the triggering conditions as bullets, each citing the F-ID(s) of \
the atomic rule(s) that drive it. Do NOT restate rules in full — this is \
a roll-up.
- For APPROVE buckets, state the approved funding amount with a citation \
back to the atomic rule.
- For DECLINE, quote the decline-reason text verbatim from the output \
template's IF DECLINED checklist where possible (so the assessor can \
copy-paste it into the output).
- Omit buckets that don't apply to the fund (e.g. a scored scholarship \
has no tiered APPROVE; a flat-tier fund has no APPROVE (scored)).

### Critical Rules Summary — required

Immediately after the Decision Framework, include a "Critical Rules \
Summary" section listing **5–10 absolute rules** that apply without \
exception. These are the policies an experienced assessor checks first \
when triaging an application.

- Each entry is a single line prefixed with ✋.
- Each entry quotes the governing policy text verbatim (in quotes), or \
condenses it to a single imperative sentence if verbatim is too long.
- Each entry ends with a parenthetical F-ID cross-reference.
- Limit to 5–10. If you have more than 10, pick the ones with the \
highest priority (Critical) and broadest applicability.

Example formatting (for illustration only — use the source's real wording):

> ✋ Te Rūnanga does NOT pay individual parents/guardians to provide \
educational support to their own tamariki. (F-011, LSF Policy V2, \
Important Notes)
> ✋ Providers must be approved by Te Rūnanga before payment towards \
educational support can be approved. (F-012, LSF Policy V2, §5.5.1)
"""


_OUTPUT_FORMAT = """\
## Output

Write the final file to: **`/workdir/outputs/funding-rules.md`**

File structure, in order:

1. **Header block** (Fund name, description, primary sources, version, date).
2. **Phase 2 Corrections log** (what you fixed in the draft).
3. **Strategic Framework** section (if applicable — see Mandatory Closing \
Sections above).
4. **Atomic rule sections** — each rule has: `**F-XXX: Title**`, \
Priority line, Source line, Rule body.
5. **Decision Framework** section (required — see Mandatory Closing \
Sections).
6. **Critical Rules Summary** section (required — see Mandatory Closing \
Sections).
7. **Data Sources Reference** section or inline data-source rules (one \
rule per manifest entry).
8. **Appendix / Gaps** (manual-review items, source conflicts, unresolved \
ambiguities).

Each rule:
- **F-XXX: Rule title** (ID and title on same line, bolded)
- **Priority:** Critical / Major / Minor
- **Source:** specific document + section/page citation
- Rule body (self-contained, specific, verbatim where required)

After writing the file, output a brief one-paragraph summary of:
- Total number of rules in the final file
- Which mandatory closing sections you included (Strategic Framework \
yes/no and why, Decision Framework buckets used, Critical Rules Summary \
count)
- Any significant changes you made during review (added rules, fixed \
citations, merged duplicates, restored verbatim wording)
- Any remaining gaps or ambiguities that couldn't be resolved from the \
source (these become manual-review items, documented in the rules file)

Then STOP.
"""


_OPERATING_MODE = """\
## Operating Mode

- **Read the sources before making changes.** If you're uncertain whether \
a citation is correct, open the cited document and check.
- **Don't soften rules to avoid being wrong.** If a policy says "must", \
your rule says "must". Downstream assessors rely on precise language.
- **Completeness over brevity.** Adding three more lines to make a rule \
self-contained is worth it.
- **No conversational output.** Write the file, produce the summary, \
stop.
"""


RULES_REVIEW_ADDENDUM = (
    _CONTEXT
    + _REVIEW_CHECKS
    + _SECTION_ORDERING
    + _MANDATORY_CLOSING_SECTIONS
    + _OUTPUT_FORMAT
    + _OPERATING_MODE
)
