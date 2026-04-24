"""Prompt addendum for Nolia Funding Global rules second review (Phase 3).

Global-KB variant of the Phase 3 audit. Narrower than the Funding-KB
Phase 3 because Global rules have fewer mandatory components:

- Two closing sections (Strategic Framework where applicable, Critical
  Rules Summary) — no Decision Framework at Global level.
- No supporting-data manifest (Global KBs don't carry lookup files).
- Same structural integrity checks: G-IDs resolve, every rule has
  Source / Priority / body, change log and gap appendix present.
"""

_CONTEXT = """\
## Context

Phase 2 produced the final Global rulebook at \
**`/workdir/outputs/global-rules.md`**. The source documents are in \
`/workdir/knowledge-bases/documents/`.

You are running Phase 3 (Second Review) — a structural and completeness \
audit of the Phase 2 output. Phase 2 owns source-citation correctness; \
you are auditing structure, completeness, and internal consistency. Fix \
defects in place by editing `/workdir/outputs/global-rules.md` directly.
"""


_AUDIT_CHECKLIST = """\
## Audit Checklist

Work through each item in order. Record PASS/FAIL with a one-line \
rationale. Fix FAIL items before finalising.

### 1. Mandatory Closing Sections

- **Critical Rules Summary** section present at the end of the file \
(before any Gap appendix), containing **5–10 entries**, each prefixed \
with ✋ and ending with a G-ID cross-reference. **FAIL** if missing, \
fewer than 5, more than 10 without justification, or any entry missing \
the ✋ prefix or G-ID reference.
- **Strategic Framework** section — present **if and only if** a \
strategy, values, or guiding-principles document exists in \
`/workdir/knowledge-bases/documents/`. Check by listing the folder: if \
any file looks like a values/strategy/Tikanga doc, the section must \
exist (before the atomic rule sections). If none exists, the section \
must NOT be present. **FAIL** either way if the presence doesn't match.

Note: Global rules do NOT include a Decision Framework section. If one \
is present, remove it — it doesn't belong at Global level.

If any check FAILs, open `/workdir/outputs/global-rules.md` and add or \
correct the section(s).

### 2. Cross-Reference Integrity

- Scan the rules file for all `G-` references. For each, confirm the \
referenced G-ID actually exists as a rule heading. Broken cross-\
references are FAIL — fix in place.
- Check G-IDs are sequential (no gaps unless intentional).
- Check the Phase 2 Change Log references G-IDs that exist.

### 3. Per-Rule Structural Integrity

For each rule, verify it has:
- G-ID and title on the same heading line
- `**Priority:**` line with Critical / Major / Minor
- `**Source:**` line with at least one citation (doc + location)
- Rule body of at least one full sentence

Spot-check (first 10 rules, plus a sample of 20% of the remainder). \
**FAIL** and fix any rule missing a component.

### 4. Scope Audit — No Fund-Specific Rules at Global Level

Global rules apply to **every** Fund / Grant / Scholarship. If any rule \
is fund-specific (e.g. "applicants must be enrolled in NZ Primary or \
Secondary school" — that's LSF-specific, not Global), **FAIL** and \
remove it from the file. Log removals in the Phase 3 Audit block so \
Phase 2 can be improved.

### 5. Phase 2 Corrections Log and Gap Appendix

- **Phase 2 Corrections** block must be present near the top. **FAIL** \
if missing.
- **Appendix / Gaps** section must be present at the end. An empty gap \
section is almost always wrong. **FAIL** if missing.
"""


_FIX_GUIDANCE = """\
## How to Fix

- **Small in-place edits** — use the Edit tool. Do not rewrite the file.
- **Adding a missing Critical Rules Summary** — derive from the \
existing atomic rules (pick 5–10 Critical-priority rules with the \
broadest applicability); no new source research needed.
- **Adding a missing Strategic Framework** — open the relevant \
strategy/values doc in `/workdir/knowledge-bases/documents/` and quote \
its guiding principles verbatim. Do not assign G-IDs to items in this \
section.
- **Removing a fund-specific rule** — delete it with Edit and log the \
removal.
- **Large rewrites are out of scope.** If the Phase 2 output is \
fundamentally broken (no atomic rules at all, no source citations \
anywhere), log the defect and leave the file largely as-is.

Preserve the G-ID numbering, the header block, the Phase 2 Corrections \
log, and existing Gap appendix items.
"""


_OUTPUT_FORMAT = """\
## Output

1. Edit `/workdir/outputs/global-rules.md` in place to fix defects.
2. Append or update a **Phase 3 Audit** block at the top (right after \
the Phase 2 Corrections block):

```
## Phase 3 Audit (Second Review — Global)

| Check | Result | Notes |
|---|---|---|
| 1. Mandatory Closing Sections | PASS / FAIL — fixed | one-line |
| 2. Cross-Reference Integrity | PASS / FAIL — fixed | one-line |
| 3. Per-Rule Structural Integrity | PASS (sampled N of M) | one-line |
| 4. Scope — No Fund-Specific Rules | PASS / FAIL — removed X | one-line |
| 5. Phase 2 Log and Gap Appendix | PASS / FAIL — fixed | one-line |

**Fixes applied:** <bulleted list>

**Defects not fixable in Phase 3:** <list or "none">
```

3. Print a one-paragraph summary of what you checked, what you fixed, \
and what remains as a known issue.

Then STOP.
"""


_OPERATING_MODE = """\
## Operating Mode

- Audit, not rewrite. Small targeted edits only.
- Automated pipeline agent — no interactive behaviour, no TodoWrite, no \
clarification questions.
- Expected budget: 3–5 turns if clean, 10–15 if fixes needed. Over 25 \
turns signals Phase 2 output is broken enough to warrant a rerun — \
summarise and stop.
- **Do not re-read every source document.** Phase 2 owns source-citation \
correctness. Open source docs only where audit items explicitly require \
it (Strategic Framework content, rare broken citation restoration).
"""


RULES_SECOND_REVIEW_GLOBAL_ADDENDUM = (
    _CONTEXT + _AUDIT_CHECKLIST + _FIX_GUIDANCE + _OUTPUT_FORMAT + _OPERATING_MODE
)
