"""Phase 1 (Generation) addendum for the Policy Designer pipeline."""

GENERATION_ADDENDUM = """
## Phase 1 — Generation

Your task: write the four customised policy area files to `/workdir/tmp/`.

### Workflow

1. Read `/workdir/exemplar.md` in full. This is the document you are replicating.
2. Read `/workdir/school_context.md` and `/workdir/additional_instructions.md`.
3. Decide, before writing, where each element of the school's context belongs — \
each element is woven in exactly once, in the single most natural section.
4. Write the four area files to `/workdir/tmp/`, in the exemplar's order:
   - `/workdir/tmp/impact.md` — Section One (Impact Policies)
   - `/workdir/tmp/operational.md` — Section Two (Operational Expectation Policies)
   - `/workdir/tmp/board-management.md` — Section Three (Board-Management \
Relationship Policies)
   - `/workdir/tmp/governance-culture.md` — Section Four (Governance Culture Policies)
5. When writing a later area, re-read the earlier area files if you need to \
check where a piece of school context has already been used — the same \
customisation must not appear twice.

### Per-File Contract

Each file mirrors the corresponding exemplar section exactly:

- Open with the section heading and the section's introductory text as in the \
exemplar (lightly customised with the school's name where natural).
- Include the area's **global policy verbatim** from the exemplar.
- Reproduce every sub-policy, with the exemplar's numbering and heading \
hierarchy. Do not add, remove, renumber, or reorder sub-policies.
- Match the exemplar's level of detail. Where the exemplar uses a bullet \
list, use a bullet list of the same scope — no new bullets.
- Keep the exemplar's `$xxxx` placeholder amounts as-is unless the school \
context explicitly supplies values.

### Customisation Guidance

- The school's character, community, and values shape *wording and emphasis* \
within the exemplar's structure — typically the section introductions, the \
Impact Policies' outcome statements, and culturally specific commitments \
(e.g. Te Tiriti o Waitangi sections referencing the school's local iwi).
- Strategic goals from the school context inform which outcomes get emphasis, \
but remember the hard rule: the policy may acknowledge that the school sets \
measurable goals; the specific targets, percentages, and dates stay out.
- If the school context is thin in an area, follow the exemplar as-is. An \
uncustomised exemplar section is correct; an invented one is not.

### Do NOT in this phase

- Do NOT write the introduction, definitions, table of contents, or \
conclusion — Phase 2 produces those.
- Do NOT write anything to `/workdir/outputs/`.
- Do NOT edit `/workdir/exemplar.md`, `/workdir/school_context.md`, or \
`/workdir/additional_instructions.md`.

### Final response

When all four files are written, reply with a one-paragraph summary naming \
the four files and where the school's context was applied, then STOP.
"""
