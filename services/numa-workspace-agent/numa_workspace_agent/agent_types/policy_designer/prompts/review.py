"""Phase 2 (Review & Assemble) addendum for the Policy Designer pipeline."""

REVIEW_ADDENDUM = """
## Phase 2 — Review and Assemble

Phase 1 has written the four policy area files to `/workdir/tmp/`. Your task: \
verify them against the exemplar, make focused corrections, write the front \
and back matter, and assemble the complete `/workdir/outputs/final_policy.md`.

### Step 1 — Review the four area files

Read `/workdir/exemplar.md`, `/workdir/school_context.md`, \
`/workdir/additional_instructions.md`, and all four files in `/workdir/tmp/`. \
Check each area file against this list:

- Structure matches the exemplar section exactly — same sub-policies, same \
numbering, same heading hierarchy, no invented sub-sections.
- The area's global policy is verbatim from the exemplar.
- Each element of the school's context appears exactly once across the whole \
suite — if a goal or value is repeated in multiple areas, keep the most \
natural occurrence and revert the others to the exemplar wording.
- No targets, percentages, dates, or rollout milestones from the school \
context appear anywhere (Annual Implementation Plan content, not policy content).
- No legislation, Act sections, or compliance citations beyond what the \
exemplar itself contains.
- Australian English spelling; "the school" and "the school board" terminology.
- Carver's Policy Governance® attribution retained wherever the exemplar has it.

Fix problems with **focused Edit operations in place**. Do not rewrite a \
section that is structurally sound — surgical corrections only.

### Step 2 — Write the front and back matter

Write these to `/workdir/tmp/front_matter.md` (or assemble directly in the \
final document), following the exemplar's tone:

- **Title** — the policy suite title for the school (e.g. "<School Name> \
Policy Suite").
- **Introduction** (titled "Introduction") — an overview of the policy \
document and its purpose, adapted from the exemplar's introduction for this \
school. It MUST include this framing of the document's purpose: the policies \
describe *"how the school is governed, how the principal is supported and \
directed, and how the school board is accountable for school performance."* \
Retain the reference to John Carver's Policy Governance® model as in the \
exemplar.
- **Definitions** (titled "Definitions") — each definition on its own line \
with the term in bold. When defining Te Tiriti o Waitangi, the definition is \
'The Māori text of the Treaty of Waitangi'.
- **Table of Contents** (titled "Table of Contents") — bold subheadings, \
reflecting the actual structure of the assembled document.
- **Conclusion** (titled "Conclusion") — summarises the key points and \
emphasises the importance of the policy suite for the school.

### Step 3 — Assemble

Concatenate into `/workdir/outputs/final_policy.md` in this order:

1. Title
2. Introduction
3. Definitions
4. Table of Contents
5. Section One — Impact Policies
6. Section Two — Operational Expectation Policies
7. Section Three — Board-Management Relationship Policies
8. Section Four — Governance Culture Policies
9. Conclusion

Verify the assembled file: read it back, confirm the section order, confirm \
the Table of Contents matches the actual headings, and confirm nothing was \
truncated in assembly.

### Do NOT in this phase

- Do NOT write any file to `/workdir/outputs/` other than `final_policy.md`.
- Do NOT render DOCX or PDF — those are generated outside the pipeline from \
this markdown.

### Final response

Reply with a one-paragraph summary of the corrections you made and \
confirmation that `/workdir/outputs/final_policy.md` is assembled, then STOP.
"""
