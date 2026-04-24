"""Prompt addendum for Nolia Funding rules second review (Phase 3).

Phase 3 is a targeted structural and completeness audit of the Phase 2
output. It does NOT re-read every source document for correctness — Phase
2 owns that. Phase 3 verifies that the rules file is well-formed,
self-consistent, and includes all mandatory components:

- All closing sections present (Decision Framework, Critical Rules
  Summary, and Strategic Framework when applicable).
- 100% manifest coverage (one rule per supporting-data file, verbatim
  description, cross-refs).
- All F-ID cross-references resolve.
- No rule missing a Source, Priority, or body.
- Phase 2 change log and Gap appendix present.

Where a defect is found, Phase 3 edits the rules file in place to fix it.
Where a fix requires new source research (e.g. a missed rule that needs
a fresh citation), Phase 3 may consult the source docs — but prefer
lightweight edits over large rewrites. This phase is shorter and cheaper
than Phase 2 by design.
"""

_CONTEXT = """\
## Context

Phase 2 produced the final rulebook at \
**`/workdir/outputs/funding-rules.md`**. The source documents used to \
build it are still present in `/workdir/knowledge-bases/`, including the \
`supporting-data-manifest.json` that enumerates lookup files.

You are running Phase 3 (Second Review). Your job is a **structural and \
completeness audit** of the Phase 2 output. Phase 2 has already done the \
source-document citation work; do NOT re-read every source from scratch. \
Focus on the audit below and fix defects in place by editing \
`/workdir/outputs/funding-rules.md` directly.
"""


_AUDIT_CHECKLIST = """\
## Audit Checklist

Work through each item in order. For each, record a short PASS/FAIL plus \
a one-line rationale. Fix FAIL items before finalising.

### 1. Mandatory Closing Sections

- **Decision Framework** section present at or near the end of the \
atomic rule sections, before the Critical Rules Summary. \
**PASS** if a `## Decision Framework` (or equivalent heading) exists with \
`### APPROVE`, `### DECLINE`, `### REQUEST MORE INFO`, `### ESCALATE` \
subsections as applicable to the fund. **FAIL** if missing, empty, or \
consists of one flat list with no buckets.
- **Critical Rules Summary** section present near the end, containing \
**5–10 entries**, each prefixed with ✋ and ending with an F-ID cross-\
reference. **FAIL** if missing, fewer than 5 entries, more than 10 \
entries without justification, or any entry missing the ✋ prefix or \
F-ID reference.
- **Strategic Framework** section — present **if and only if** a \
strategy, values, or guiding-principles document exists in \
`selection-criteria/`. Check by listing `selection-criteria/`: if any \
file looks like a strategy/values doc, the section must be present \
(before the atomic rule sections). If no such doc exists, the section \
must NOT be present. **FAIL** either way if the presence doesn't match \
the inputs.

If any of the three checks FAIL, open `/workdir/outputs/funding-rules.md` \
and add or correct the section(s). For the Decision Framework and \
Critical Rules Summary, derive the content from the existing atomic \
rules in the file — you should not need to re-read source docs. For the \
Strategic Framework, you may need to open the relevant doc in \
`selection-criteria/` to quote its guiding principles.

### 2. Manifest Coverage

- Open `/workdir/knowledge-bases/supporting-data-manifest.json` if \
present. If absent, skip this section (this is a Global KB or a Funding \
KB with no supporting data).
- For each entry in the manifest's `files` array, verify:
  - A dedicated rule exists naming the file (by `display_name`).
  - The rule body **quotes the manifest `description` verbatim** — if \
the rule paraphrases instead, restore the verbatim quote.
  - The rule cross-references the rule IDs whose checks depend on this \
file (e.g. "Used by F-XXX …").
  - The rule states what the assessor does on missing/inaccessible \
lookup data (default: escalate for manual review).
- Record coverage as "N of M manifest entries have rules." **FAIL** if \
coverage is less than 100%.

If any manifest entry is missing a rule, add one in the appropriate \
section (usually a "Data Sources Reference" or equivalent section). If a \
rule paraphrases the manifest description instead of quoting it, restore \
the verbatim quote.

### 3. Cross-Reference Integrity

- Scan the rules file for all `F-` references (e.g. F-012, F-043). For \
each, confirm the referenced F-ID actually exists in the file as a rule \
heading. Broken cross-references ("see F-099" when there is no F-099) \
are FAIL.
- Check that F-IDs are sequential within each section (F-001, F-002, \
F-003, …). If there's a gap (F-001 then F-003), decide: is F-002 \
missing and should be restored, or should the numbering be compacted? \
Either fix in place.
- Check the Phase 2 Change Log at the top of the file references F-IDs \
that exist. Outdated log entries pointing at renamed/removed rules are \
FAIL — correct or remove them.

Fix any broken references in place.

### 4. Per-Rule Structural Integrity

- For each rule in the file, verify it has all of:
  - An F-ID and title on the same heading line
  - A `**Priority:**` line with value Critical / Major / Minor
  - A `**Source:**` line with at least one citation (doc + location)
  - A rule body of at least one full sentence
- **FAIL** and fix any rule missing any of these.

Spot-check rather than exhaustively re-read — if the first 10 rules \
pass, you can sample the remainder unless a previous step indicated \
bulk-editing happened. If every rule was rewritten by an earlier phase, \
spot-check 20% minimum.

### 5. Phase 2 Corrections Log and Gap Appendix

- The file must include a **Phase 2 Corrections** block near the top \
(typically right after the header). **FAIL** if missing.
- The file must include an **Appendix / Gaps** section at the end \
documenting manual-review items, unresolved ambiguities, and source \
conflicts. **FAIL** if missing or empty (an empty gap appendix is almost \
always wrong — there are usually *some* gaps).

### 6. Internal Consistency Between Decision Framework and Atomic Rules

Pick three randomly-selected decline reasons from the Decision \
Framework's DECLINE bucket. For each, confirm:

- The cited F-ID exists and is a Critical-priority rule.
- The rule body states the condition that would trigger the decline.
- The decline-reason wording matches (verbatim where the source \
provides it) the output template's IF DECLINED checklist entry.

**FAIL** if the Decision Framework's triggers disagree with the atomic \
rules they cite.

Pick two APPROVE conditions and do the same check: the cited F-IDs \
exist and collectively match the approval gates for the fund's tier.
"""


_FIX_GUIDANCE = """\
## How to Fix

- **Small in-place edits** (adding a missing Critical Rules Summary \
entry, fixing a broken F-reference, restoring a verbatim quote from the \
manifest) — use the Edit tool. Do not rewrite the whole file.
- **Adding a missing section** (e.g. Decision Framework wasn't present) \
— read the existing atomic rules, compose the new section, insert at \
the right location with Edit.
- **Fixing a broken rule** (missing Priority, no Source) — if the \
source citation can be inferred from nearby context, add it. If not, \
open the source document briefly to confirm — but keep it targeted.
- **Large rewrites are out of scope for Phase 3.** If the Phase 2 output \
is fundamentally broken (e.g. no atomic rules at all, or no source \
citations anywhere), do NOT try to rewrite it — log the defect in your \
summary and leave the file largely as-is. Phase 2 would need to be \
rerun to fix that class of problem.

Preserve the F-ID numbering, the header block, the Phase 2 Corrections \
log, and any Gap appendix items that were already there. Do not delete \
content unless it's demonstrably wrong (e.g. a duplicate rule or a \
broken cross-reference pointing at nothing).
"""


_OUTPUT_FORMAT = """\
## Output

1. Edit `/workdir/outputs/funding-rules.md` in place to fix any defects \
identified.
2. Append or update a **Phase 3 Audit** block at the top of the file \
(right after the Phase 2 Corrections block). Format:

```
## Phase 3 Audit (Second Review)

| Check | Result | Notes |
|---|---|---|
| 1. Mandatory Closing Sections | PASS / FAIL — fixed | one-line |
| 2. Manifest Coverage | N/M (100% after fix) | one-line |
| 3. Cross-Reference Integrity | PASS / FAIL — fixed | one-line |
| 4. Per-Rule Structural Integrity | PASS (sampled N of M) | one-line |
| 5. Phase 2 Log and Gap Appendix | PASS / FAIL — fixed | one-line |
| 6. Decision Framework Consistency | PASS / FAIL — fixed | one-line |

**Fixes applied:** <bulleted list of in-place edits>

**Defects not fixable in Phase 3:** <anything that requires a Phase 2 \
rerun — expect this to be empty in most cases>
```

3. Print a one-paragraph summary of what you checked, what you fixed, \
and what (if anything) remains as a known issue.

Then STOP.
"""


_OPERATING_MODE = """\
## Operating Mode

- This is an **audit**, not a rewrite. Small, targeted edits only.
- You are an automated pipeline agent — NOT an interactive assistant. \
Execute the audit, write your edits and Audit block, and STOP. No \
conversational output, no clarification questions, no TodoWrite.
- Budget: this phase should complete in **significantly fewer turns than \
Phase 2**. If the checklist passes cleanly, you may finish in 3–5 turns. \
If fixes are needed, 10–15 turns is typical. A Phase 3 run that exceeds \
30 turns indicates Phase 2 output is defective enough to warrant a \
rerun — summarise and stop rather than trying to fix everything.
- **Do not re-read every source document.** Phase 2 owns source-\
citation correctness. Open source docs only where step-specific audit \
items require it (Strategic Framework content, broken citation \
restoration, manifest verbatim quotes).
"""


RULES_SECOND_REVIEW_ADDENDUM = (
    _CONTEXT + _AUDIT_CHECKLIST + _FIX_GUIDANCE + _OUTPUT_FORMAT + _OPERATING_MODE
)
