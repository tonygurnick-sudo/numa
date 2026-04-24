"""Prompt addendum for Nolia Funding assessment — Phase 3 (Render).

Reads the output template + the structured findings produced by Phase 2,
and produces a filled assessment document as Markdown. Post-phase
conversion (handled by the orchestrator, not the agent) produces PDF and
DOCX alongside.

The template is the contract. Respect its bracketed instructions verbatim.

The stanzas below follow a "template-first, fallback-second" design: the
template author's intent wins; the rules here only fire where the template
is silent or ambiguous. Every template is different — some will specify
behaviour this prompt would otherwise dictate, and in those cases the
template's directive takes precedence.

Addendum structure (concatenated in order):
    _CONTEXT          — what's in /workdir/ at Phase 3 start
    _TEMPLATE_HANDLING — how to read the template + handle placeholder brackets
    _FILLING_FIELDS    — fallbacks for behaviours the template can't express
    _DECISION_OUTPUT   — emit structured decision back to applicant.json
    _OUTPUT_FORMAT     — filename convention + final file layout
    _OPERATING_MODE    — terminal behaviour + "rule IDs are internal"
"""

# ROLE: Tell the agent what inputs it has from the earlier phases and the KB.
# The template is named as "the contract" here because every downstream rule
# in this prompt is framed around "template says it, or prompt falls back".
_CONTEXT = """\
## Context

Phases 1 and 2 have run. You have:

- `/workdir/knowledge-bases/templates/` — the output template from the \
Funding KB. Usually DOCX or MD. **This is the contract.** Its structure, \
section headings, and bracketed instructions drive your output.
- `/workdir/tmp/applicant.json` — applicant identity and document inventory.
- `/workdir/tmp/findings.md` — structured findings. Document header block \
with applicant name + ID + rulebook + summary counts, then one section \
per rule. Each rule section is a `## <rule_id> — <rule_title>` heading, \
a ```yaml fenced block with structured fields (`rule_id`, `rule_title`, \
`rule_priority`, `applicability`, `verdict`, `evidence_sources`, optional \
`score`, optional `notes`), and a prose body containing the evidence \
narrative with verbatim numeric values (scores, percentages, dollar \
amounts, dates, line numbers). Rule sections separated by `---`.
- `/workdir/knowledge-bases/funding-rules.md` — the rulebook (rarely need \
to re-read; `findings.md` is the source of truth).
- `/workdir/uploads/extracted_*.json` — the original applicant documents \
(rarely need to re-read; applicant.json summarises).

Your job: fill the template into Markdown at \
**`/workdir/outputs/Assessment_{applicant_name_with_underscores}.md`**. \
For example: `Assessment_Ella_Jackson.md`.
"""


# ROLE: Teach the agent how to read the template and distinguish the two
# bracket conventions authors use — (i) instructions to look up or say
# something, and (ii) placeholder/format hints where the value needs to be
# derived and the bracketed text is an example, not a directive. Without
# this distinction the model ships `[APP-XXXXXX]` or `[DD/MM/YYYY]` literal.
_TEMPLATE_HANDLING = """\
## Template Handling

The template is usually a DOCX with assessor instructions at the top (e.g. \
"---BEGIN ASSESSOR INSTRUCTIONS---..."). These instructions are for you. \
They typically say things like "Output ONLY sections 1-5", "Keep ALL \
answers to 1-3 sentences", "For tables: tick ONE checkbox per row". \
**Follow them exactly.**

### Bracketed text comes in two flavours

The template uses `[ ]` brackets for two different purposes. You must \
recognise which is which:

**(a) Instructions — tell you what to do or say.** These are resolved by \
acting on them:

- `[from Application Form Template Q1]` → look up the answer to Q1 in \
applicant.json / extracted uploads.
- `[from <some supporting-data filename>]` → use the finding from Phase 2 \
that referenced this file. If the named file isn't in \
`supporting-data-manifest.json`, **fall back to "Not provided in \
application"** (see Fallback Catch-alls below) — never fabricate a lookup.
- `[say "..."]` → output the quoted string literal, verbatim.
- `[Refer to <doc> for how to score]` → apply the scoring guidance from \
the named KB document (already reflected in `findings.md`).

**(b) Placeholders — example values that must be replaced.** These look \
like format hints or literal example data:

- `[APP-XXXXXX]` — an Application Number in that shape.
- `[DD/MM/YYYY]` — a date in that format.
- `[Amount]`, `[Name]`, `[Date]` — a field to derive a real value for.

Placeholder-shaped brackets must never ship literally. Derive the real \
value from the most specific source available; if the pipeline has no \
value to fill in, emit the literal text `Not available` (no brackets, no \
placeholder text, no guess).

**Common placeholder resolutions** (apply when the template doesn't \
specify differently):

- **Application Number** → `Applicant ID:` from `findings.md` document \
header if real; otherwise `Not available`. Do NOT substitute the \
applicant's name, DoB, or any other identifier — this field is reserved \
for an external tracking number.
- **Assessment Date** → today's date formatted `DD/MM/YYYY`.
- **Assessor** → use the template's own boilerplate value if it carries \
one (e.g. `Nolia Platform`); otherwise `Nolia Platform`.

**The bracketed instructions always win.** If an instruction-style bracket \
says "say X" or "from <file>", follow it even if you think a different \
answer would be better.

### DOCX-specific handling

If the template is a DOCX file:
- Use `mcp__scripts__execute_script` with Python (`python-docx`) to read \
it, or `Read` it (the workspace agent can handle DOCX text extraction).
- Treat the DOCX's structure as a Markdown blueprint:
  - Heading 1 → `#`, Heading 2 → `##`, etc.
  - Bulleted / numbered lists → MD equivalents
  - Tables → GitHub-flavoured Markdown tables
  - Checkboxes `☐` → preserve as `☐` (unchecked) or `☑` (checked). These \
render in MD → PDF / DOCX conversion.
- Preserve all section numbering exactly (e.g. "2. DECISION SUMMARY" stays \
"2. DECISION SUMMARY" — not "Section 2" or "2: Decision").

If the template is Markdown, use it directly as your skeleton.
"""


# ROLE: Fallbacks for behaviours the template structure can't express.
# Every rule here is shaped as "if the template doesn't specify X, do Y" —
# template directives always win over these defaults. These rules exist
# because the template can tell the agent *what* to put in each cell, but
# can't always tell it *how* to translate a structured finding into a
# tick-box, *which* numerics to preserve, or *how* to resolve ambiguity
# across conditional rows. Specific-template guidance takes precedence.
_FILLING_FIELDS = """\
## Filling Fields

For each field in the template:

1. Look at the bracketed instruction. It tells you the source (an \
instruction-style bracket — see Template Handling above) or the shape of \
the value (a placeholder-style bracket).
2. If the source is the applicant's application form or a supporting \
document, pull the fact from `applicant.json` or the extracted documents.
3. If the source is a supporting-data file, look up the rule's section \
in `findings.md` — Phase 2 already did the lookup. The rule's verdict \
and structured fields are in the YAML fenced block; the prose body \
underneath contains the evidence narrative (including verbatim numerics \
you should cite directly in the rendered assessment).
4. If the bracketed instruction is a literal "say X" directive, write \
exactly X.

### Fallback: verdict → checkbox mapping (when the template is silent)

**If the template tells you how to render each verdict, follow the \
template.** If it doesn't — most don't — apply this default map to the \
relevant finding's `verdict`:

- `met` → ☑ (the "meets" / "verified" / "passed" option)
- `not_met` → ☑ the "does not meet" option
- `partial` → **default to ☑ the "does not meet" option**, UNLESS the \
template's bracketed instruction defines how to render partial (e.g. \
"if partial, tick both X and Y and add a note"). Rationale: tick-box \
templates model binary conditions — "partially met" is safer to surface \
as "not met" + an evidence note than to imply the applicant cleared the \
bar. Always add a note describing which conditions held and which didn't.
- `manual_review` → ☑ "Not Verified" or leave unchecked; write the \
manual-review-needed phrasing if the template directs it.
- `unclear` → leave unchecked; add a one-line note.

**Scored rules.** If the finding's YAML block carries a `score:` field \
with `value:` and `max:` sub-keys, fill the template's score column / \
input with the numeric value. If the template also has a tick-box \
alongside the score, apply the verdict mapping above to the tick-box.

### Fallback: cite numerics verbatim (when the template says "be brief")

The finding's prose body in `findings.md` contains specific evidence \
Phase 2 gathered — numeric values cited verbatim from supporting \
documents. **Preserve every numeric value when you render the field that \
uses that finding.** Examples:

- SDQ subscale scores (Emotional 7, Conduct 4, Hyperactivity 10, Peer 4) \
— render all four, not "scores in the Abnormal range".
- Sensory percentile values (vestibular hyposensitivity 72.73%, \
proprioceptive 58.82%, emotional regulation 58.33%) — render the \
percentages, not "elevated across multiple domains".
- Dollar amounts, date stamps, line numbers, document IDs — carry \
through verbatim from the finding's prose body to the rendered cell.

**Length discipline — completeness over brevity.** Templates sometimes \
say "Keep ALL answers to 1–3 sentences maximum". **Override that cap** \
in favour of completeness and evidence fidelity. A cell that runs to \
4–6 sentences and cites all relevant numerics is better than a \
2-sentence cell that paraphrases them away. Don't fabricate length — \
only be as long as the available evidence demands — but never compress \
at the cost of specific numeric evidence.

### Fallback: decision status (when the template has a status cell but \
no selection logic)

Many templates have a "Status: APPROVED / DECLINED / AWAITING MORE INFO" \
cell and leave the choice to the assessor. Derive the status from the \
findings using the following logic, **unless the template specifies \
different criteria**:

- If any `Critical` priority rule has `verdict: not_met` → status is \
likely `DECLINED`.
- If multiple Critical rules are `manual_review` → status is \
`AWAITING MORE INFO` unless the template instructs otherwise.
- If all Critical rules are `met` or `manual_review` with acceptable \
fallback → status is `APPROVED`.

**Conservative fallback ordering** — when findings are ambiguous or \
contradictory, default to the more cautious status in this order:

```
AWAITING MORE INFO   >   DECLINED   >   APPROVED
```

Pick the leftmost status that's compatible with the findings. Surface \
the ambiguity — never resolve it by assuming.

Always base the decision on findings, never on your own judgement of the \
applicant's quality. The rulebook is authoritative.

### Fallback: decision-summary row handling (when the template mixes \
status-conditional and always-rendered rows)

Templates typically prescribe a Decision Summary section (often \
numbered §2) with rows like `Status`, `If Approved - Amount`, \
`If Approved - Provider`, `If Declined - Reason`, \
`If Awaiting Info - Key Item`, `Next Action`, `Action By`.

**Render every row the template lists, regardless of the current \
status.** The "If Approved..." rows are not conditional on status being \
`APPROVED` — they describe what approval would look like for this \
specific application. Same for "If Declined..." and "If Awaiting \
Info..." rows.

How to fill each row when it doesn't directly match the status \
(applies only where the template doesn't specify):

- **`If Approved - Amount`** — fill with the amount that WOULD be \
approved if pending items resolved favourably. Only use \
`N/A — application not being recommended for approval` when the findings \
make approval clearly implausible.
- **`If Approved - Provider`** — fill with provider name plus any \
vetting/approval state. Only `N/A` when there's genuinely no provider \
involved.
- **`If Declined - Reason`** — one-line reason when status is \
`DECLINED`, otherwise `N/A — application not declined`.
- **`If Awaiting Info - Key Item`** — summary of the missing items when \
status is `AWAITING MORE INFO`, otherwise `N/A`.
- **`Next Action`** and **`Action By`** — always fill. Every assessment \
has a next step and someone who drives it.

For any trailing boilerplate rows (e.g. "If declined, explanation for \
Parent/Guardian", "Policy Reference", "Next Steps"): render all of \
them. When the row doesn't apply, fill with `N/A — <brief reason>` \
rather than omitting it.

### Fallback Catch-alls: data we don't have

Apply only when the template isn't more specific.

- **Instruction-style bracket names a file not in `supporting-data-\
manifest.json`** (e.g. `[from some_missing_file.csv]`) → output \
`Not provided in application`. Don't invent a lookup result, don't pick \
a different file, don't paraphrase.
- **Bracketed instruction asks for data that isn't in `findings.md` / \
`applicant.json` / the extracted uploads** → output \
`Not provided in application` (or whatever the template's bracketed \
instruction says to write when data is missing).
- **Field has no bracketed instruction and no obvious source** → output \
`Not provided in application`.

Do NOT fabricate data. Do NOT substitute a similar value from a \
different source.
"""


# ROLE: Secondary structured outputs — the frontend renders decision state
# and the rubric score straight from applicant.json without parsing the
# rendered MD. Keeps the contract between pipeline and UI template-
# independent: any future Fund template (with or without a Status cell)
# still emits a usable `decision` block here. `score` is a top-level
# sibling of `decision` because it's an input to the decision, not part
# of it — and the frontend's existing Score column (`V2RunResult.score`)
# reads from the top level.
_DECISION_OUTPUT = """\
## Structured Decision & Score Output (applicant.json)

In addition to the rendered MD, **extend `/workdir/tmp/applicant.json`** \
with two new top-level fields: `decision` and, when applicable, `score`. \
Phase 1 wrote the applicant section of this file; your job is to read it, \
add these fields alongside, and write it back. Do NOT remove or alter \
Phase 1's fields.

These structured outputs capture the same top-level decision you just \
rendered into the template, in a template-agnostic shape. The frontend \
activity table reads them directly — it does not parse the rendered MD.

### Shape

```json
{
  "version": "1.0",
  "applicant": { ... Phase 1 fields, unchanged ... },
  "documents": [ ... Phase 1 fields, unchanged ... ],
  "requires_manual_review": ...,
  "review_reason": ...,
  "missing_fields": [ ... ],
  "decision": {
    "status": "APPROVED" | "DECLINED" | "AWAITING_MORE_INFO",
    "summary": "One-sentence human-readable summary suitable for the \
activity-row preview.",
    "recommended_amount": {
      "raw": "Up to $940 + GST",
      "numeric": 940,
      "currency": "NZD",
      "gst_included": false
    },
    "blocking_reasons": [
      { "rule_title": "Whakapapa Registration", "verdict": "manual_review" },
      { "rule_title": "Age (5-21)", "verdict": "manual_review" }
    ],
    "next_action": "Manual verification of whakapapa registration and age.",
    "action_by": "Ngāi Tahu Grants Team"
  },
  "score": { "value": 12, "max": 15 }
}
```

### Rules — `decision` block

- **`status`** — use the literal strings `APPROVED`, `DECLINED`, or \
`AWAITING_MORE_INFO` (underscores, not spaces — this is a machine \
contract, not the rendered template value).
- **`summary`** — one sentence, plain English. Mirrors the essence of \
the `If Declined - Reason` / `If Awaiting Info - Key Item` / `If \
Approved - Amount` cell as applicable. Safe to display on a dashboard \
row.
- **`recommended_amount`** — same shape as Phase 1's \
`applicant.requested_amount`. Emit `null` when the status is `DECLINED` \
or when no amount is being recommended.
- **`blocking_reasons`** — findings (from `findings.md`) that prevent an \
unconditional `APPROVED`. List every Critical / Major rule whose \
`verdict` is `not_met`, `manual_review`, `partial`, or `unclear` and \
which meaningfully affects the decision. Use `rule_title` (the \
human-readable title), never the internal `rule_id`. Empty list `[]` \
when status is `APPROVED` with no conditions.
- **`next_action`** / **`action_by`** — mirror the template's Next Action \
/ Action By cells. Always fill both; every assessment has a next step.

The decision values must be consistent with the rendered template — if \
the template's Status cell says "AWAITING MORE INFO", `decision.status` \
is `AWAITING_MORE_INFO`. Drift between the two is a bug.

### Rules — top-level `score` field

- **OPTIONAL.** Emit `score` **only when the Fund uses a numeric \
aggregate scoring rubric** — e.g. a scholarship that sums three sub-\
scores out of 15. Omit the key entirely (or emit `null`) when the Fund \
is qualification-based (e.g. LSF, SLA — tick-box decisions with no \
rubric sum).
- **Heuristic for "is this Fund scored?"** — the Fund IS scored when \
`findings.md` contains multiple scored rules (YAML blocks with a \
`score:` field) AND the rulebook / template defines an aggregate concept \
(e.g. "Overall Score = sum of the three scores", "if total ≥ 9/15, \
recommend approval"). One-off numeric fields that aren't aggregated \
(e.g. a dollar amount, a credits count) are NOT a rubric score — skip \
them.
- **Shape** — `{"value": <int or float>, "max": <int>}`. `value` is the \
sum / aggregate score; `max` is the rubric's upper bound.
- Never fabricate a score. If you're unsure whether the Fund has an \
aggregate rubric, omit the field — the frontend renders "—" for absent \
scores and that's the correct neutral display.

### How to write

Use `Read` to load `/workdir/tmp/applicant.json`, add the `decision` \
block (and `score` when applicable) alongside the existing fields, and \
`Write` it back. Do NOT write a new file — this is an in-place extension \
of the Phase 1 artifact.
"""


# ROLE: Filename sanitisation + final-output contract. The filename
# transformation is specified inline because the model tends to produce
# inconsistent results if left to its own devices (Unicode, spaces,
# hyphens vs underscores). Downstream orchestrator glob depends on the
# `Assessment_*.md` prefix.
_OUTPUT_FORMAT = """\
## Output

Write **`/workdir/outputs/Assessment_<filename_safe_name>.md`**.

Derive `<filename_safe_name>` from `applicant.json`'s `applicant.name` \
using this exact transformation (use \
`mcp__scripts__execute_script` with python3 to compute it):

```python
import unicodedata, re
name = applicant_name  # e.g. "Ngā Rangi-Waka"
# Strip diacritics
ascii_name = ''.join(
    c for c in unicodedata.normalize('NFKD', name)
    if unicodedata.category(c) != 'Mn'
)
# Replace any non-alphanumeric/hyphen char with underscore, collapse repeats
cleaned = re.sub(r'[^A-Za-z0-9-]+', '_', ascii_name).strip('_')
filename = f'Assessment_{cleaned}.md'
# Example: "Ngā Rangi-Waka" → "Assessment_Nga_Rangi-Waka.md"
# Example: "Ella Jackson"   → "Assessment_Ella_Jackson.md"
```

The filename preserves only ASCII letters, digits, hyphens, and \
underscores. The MD content itself preserves the original diacritics — \
only the filename is sanitised.

If `applicant.name` is missing or empty, use `Assessment_UNKNOWN.md`.

The MD file must:

- Follow the template's structure and section order exactly.
- Fill every field (with "Not provided in application" when data is \
missing, or the template's specific manual-review phrasing).
- Use Markdown syntax compatible with downstream PDF and DOCX conversion \
(standard tables, checkboxes as unicode `☐ ☑`, headings `#` `##`, etc.).

After writing the file, output a brief summary (one paragraph: applicant \
name, status decision, key rationale) and STOP.
"""


# ROLE: Terminal behaviour + the "rule IDs are internal" guardrail. The
# rule-ID guardrail is the single most important user-facing rule in the
# whole assess pipeline — internal tracking IDs (`F-042`, `G-007`) must
# never leak into the rendered assessment. Cite the original policy
# source via evidence_sources instead.
_OPERATING_MODE = """\
## Operating Mode

- Template is the contract. Follow it literally.
- Findings are the source. Don't re-evaluate rules.
- Bracketed instructions win — "say X" means output X verbatim.
- No additional sections, no cover letter, no commentary beyond what the \
template asks for.
- No conversational output beyond the final summary. Write the file, \
produce the summary, stop.

### Rule IDs are INTERNAL — never show them in the rendered output

The rule IDs you see in `findings.md` (`F-001`, `F-042`, `G-003`, etc.) \
and in the underlying rulebook files (`funding-rules.md`, \
`global-rules.md`) are **pipeline-internal tracking identifiers**. The \
assessor reading this report has no concept of them — from their \
perspective, rules come from the organisation's original policy documents.

- **Never** write "per rule F-042", "as per F-###", "rule G-001 states", \
or any similar phrasing in the rendered assessment output.
- **When you need to cite evidence for a finding,** cite the original \
source document — use the ``evidence_sources`` array on the finding, \
not the ``rule_id`` field. Preferred shape: *"Applicant Form Q1; LSF \
Policy V2 Section 5.1.1"*. Never *"rule F-042 (LSF Policy V2 Section \
5.1.1)"*.
- **If the template has a field literally asking for a rule or criterion \
label**, use the human-readable rule title (from ``rule_title`` in the \
finding) — never the ID. For example: *"Educational enrollment"*, not \
*"F-004 Educational enrollment"*.
- **If the bracketed template instruction asks for a policy reference**, \
produce the source doc citation from ``evidence_sources``, not the \
internal ID.

The rendered assessment must read as if generated from a policy-document \
review, not from a derived rules file. The derived rules file exists only \
so the pipeline can evaluate consistently; it is invisible to the user.
"""


ASSESS_RENDER_ADDENDUM = (
    _CONTEXT
    + _TEMPLATE_HANDLING
    + _FILLING_FIELDS
    + _DECISION_OUTPUT
    + _OUTPUT_FORMAT
    + _OPERATING_MODE
)
