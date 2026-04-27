"""Prompt addendum for Nolia Funding Global rules review (Phase 2).

Takes the draft Global rules file produced by Phase 1 (extraction),
re-reads the source documents in ``/workdir/knowledge-bases/documents/``,
adds or corrects citations, deduplicates, and writes the final
``global-rules.md`` to ``/workdir/outputs/``.

Single review pass. Global KB source material is typically smaller than
a Funding KB (no application form, no output template, no good
examples), so one review is sufficient. Mirror of ``rules_review.py``
with Global-specific wording.
"""

# CLIENT-SPECIFIC: Ngāi Tahu framing in examples.


_CONTEXT = """\
## Context

Phase 1 (extraction) produced a draft **Global rules** file at \
**`/workdir/tmp/extracted_global_rules.md`**.

Your job is to review it against the original source documents in \
`/workdir/knowledge-bases/documents/`, improve it where needed, and \
write the final version.

Global rules are organisation-wide — they apply across EVERY Fund, \
Grant, and Scholarship. They are NOT fund-specific. If the draft \
contains any rules that look fund-specific (e.g. "applicants must be \
enrolled in a NZ primary school"), flag them — they probably don't \
belong in the Global rules file.
"""


_REVIEW_CHECKS = """\
## What to Review

For every rule in the draft file:

1. **Citation accuracy.** Does the **Source** line actually point to \
the claimed location? Open the cited document and verify. Fix wrong or \
missing citations.

2. **Self-containment.** Can an assessor make a definitive \
determination using only the rule text? If a rule says "must comply \
with the values" without stating what the values are, that's a \
failure — correct it with the specific values listed.

3. **Scope.** Is this rule truly org-wide? If it only applies to a \
specific Fund (e.g. a specific age range for a scholarship), it does \
NOT belong here — note it and remove it. The assumption is that Global \
rules apply to EVERY application.

4. **Completeness.** Are there rules in the source documents that \
didn't make it into the draft? Common misses:
   - Conditions buried inside "Important Notes" or callout boxes
   - Exceptions listed after the main rule
   - Values / guiding-principle statements that imply checkable rules
   - Privacy / data-handling requirements
   - Reporting obligations that apply to all recipients

   Add missing rules with appropriate IDs (continuing the G-001, G-002 \
sequence).

5. **Duplication.** If two rules say essentially the same thing, merge \
them and cite both original locations.

6. **Verbatim preservation.** Values statements, defined terms, and \
precise policy wording should be quoted exactly from source. Preserve \
te reo Māori terms and diacritics exactly as they appear in the \
original.
"""


_SECTION_ORDERING = """\
## Section Ordering

The draft sections Global rules by natural grouping from the source \
policy. Keep that structure — do NOT re-group to a different scheme. \
However, check that:

- The order of sections follows a sensible assessment lifecycle \
(Values / Principles → Universal Eligibility → Disqualifying Factors → \
Identity Verification → Conflict of Interest → Data & Privacy → \
Reporting).
- Within a section, rules are grouped by sub-topic.

Reorder within a section if it improves readability, but don't \
reorganise sections wholesale.
"""


_MANDATORY_CLOSING_SECTIONS = """\
## Mandatory Closing Sections

After the atomic rule sections, the Global rules file **must** include \
the two sections below. Skipping either is a quality failure — Phase 3 \
will flag it and reject the review output.

Note: Global rules do **not** include a Decision Framework section \
(APPROVE / DECLINE aggregation). Global rules inform fund-level \
assessments but never adjudicate an application on their own — the \
fund-level rulebook owns the final decision framework. That's why only \
two closing sections apply at Global level.

### Strategic Framework (Context, Not Rules) — conditional

Include this section **only if** a strategy, values, or guiding-\
principles document is present in `/workdir/knowledge-bases/documents/` \
(e.g. an org-wide values document; a Grants Team Strategy; a \
Tikanga/Kawa statement). If no such document is present, omit the \
section entirely — do not invent content.

When present:

- Place the section **before** the atomic rule sections (right after the \
header block).
- Mark it as context, not rules: open with an italicised note such as \
*"This section is provided as organisation-wide context. Nothing in this \
section is itself a Global rule — no rule elsewhere in the file should \
trigger on the content of this section."*
- Include (verbatim from source): guiding principles / values; strategic \
pou or outcomes; KPIs or targets.
- Do **not** assign G-IDs to items in this section.

### Critical Rules Summary — required

At the end of the file (after the atomic rule sections and before any \
Gap appendix), include a "Critical Rules Summary" section listing **5–10 \
absolute Global rules** that apply without exception to every \
application. These are the universal rules an assessor should hold in \
their head regardless of which fund they're assessing.

- Each entry is a single line prefixed with ✋.
- Each entry quotes the governing policy text verbatim (in quotes), or \
condenses it to a single imperative sentence.
- Each entry ends with a parenthetical G-ID cross-reference.
- Limit to 5–10. Pick the Critical-priority rules with the broadest \
applicability.
"""


_OUTPUT_FORMAT = """\
## Output

Write the final file to: **`/workdir/outputs/global-rules.md`**

File structure, in order:

1. **Header block** (title, description, primary sources, version, date).
2. **Phase 2 Corrections log** (what you fixed in the draft).
3. **Strategic Framework** section (if applicable — see Mandatory Closing \
Sections above).
4. **Atomic rule sections** — each rule has: `**G-XXX: Title**`, \
Priority line, Source line, Rule body.
5. **Critical Rules Summary** section (required — see Mandatory Closing \
Sections).
6. **Appendix / Gaps** (manual-review items, source conflicts, unresolved \
ambiguities).

Each rule:

- **G-XXX: Rule title** (ID and title on same line, bolded)
- **Priority:** Critical / Major / Minor
- **Source:** specific document + section/page citation
- Rule body (self-contained, specific, verbatim where required)

After writing the file, output a brief one-paragraph summary of:

- Total number of rules in the final file
- Which mandatory closing sections you included (Strategic Framework \
yes/no and why, Critical Rules Summary count)
- Any significant changes (added rules, fixed citations, merged \
duplicates, removed fund-specific rules that didn't belong)
- Any remaining gaps or ambiguities that couldn't be resolved from \
source

Then STOP.
"""


_OPERATING_MODE = """\
## Operating Mode

- **Read the sources before making changes.** If uncertain whether a \
citation is correct, open the cited document and check.
- **Don't soften rules.** If a policy says "must", your rule says \
"must". Downstream assessors rely on precise language.
- **Completeness over brevity.** Three more lines to make a rule \
self-contained is worth it.
- **No conversational output.** Write the file, produce the summary, \
stop.
"""


RULES_REVIEW_GLOBAL_ADDENDUM = (
    _CONTEXT
    + _REVIEW_CHECKS
    + _SECTION_ORDERING
    + _MANDATORY_CLOSING_SECTIONS
    + _OUTPUT_FORMAT
    + _OPERATING_MODE
)
