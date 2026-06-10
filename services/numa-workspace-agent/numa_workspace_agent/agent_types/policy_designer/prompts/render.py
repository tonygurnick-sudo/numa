"""Phase 3 (Format Rendering) addendum for the Policy Designer pipeline."""

RENDER_ADDENDUM = """
## Phase 3 — Format Rendering

`/workdir/outputs/final_policy.md` is the finished, reviewed policy document. \
Your task: produce `/workdir/outputs/final_policy.docx` and \
`/workdir/outputs/final_policy.pdf` from it.

**This phase is pure rendering. Make ZERO content edits to the markdown.** \
If you notice a content problem, mention it in your final summary — do not fix it.

### DOCX

```
pandoc /workdir/outputs/final_policy.md -f markdown -t docx \\
  -o /workdir/outputs/final_policy.docx
```

The markdown already contains its own Table of Contents section — do NOT pass \
`--toc` (it would duplicate it).

### PDF (via styled HTML + WeasyPrint)

1. Write a print stylesheet to `/workdir/tmp/policy_print.css`. Design for an \
A4 board governance document:
   - `@page { size: A4; margin: 2.2cm 2cm; }` with a footer page counter.
   - Body font 'DejaVu Sans' (installed in this environment and required for \
te reo Māori macrons: ā ē ī ō ū), ~10.5pt, line-height ~1.45.
   - Clear heading hierarchy: h1 (section dividers) large with generous \
spacing; `h1 { page-break-before: always; }` so each policy area starts on a \
new page (the title page h1 excepted — use `h1:first-of-type { \
page-break-before: avoid; }`).
   - Avoid page breaks immediately after headings \
(`h1, h2, h3, h4 { page-break-after: avoid; }`) and inside list items.
2. Convert markdown to standalone HTML with the stylesheet:
   ```
   pandoc -s /workdir/outputs/final_policy.md -f markdown -t html \\
     -c /workdir/tmp/policy_print.css --metadata title="Policy Suite" \\
     -o /workdir/tmp/final_policy.html
   ```
3. Render the PDF:
   ```
   weasyprint /workdir/tmp/final_policy.html /workdir/outputs/final_policy.pdf
   ```

### Quality checks

- `ls -l /workdir/outputs/` — confirm all three files exist and the DOCX and \
PDF are non-trivial in size (a policy suite of this length should be well \
over 50 KB each).
- Spot-check the PDF rendered correctly: \
`pdftotext /workdir/outputs/final_policy.pdf - | head -40` — confirm the \
title, introduction, and macronised words (e.g. Māori) survived rendering.
- If a command fails, read the error, adjust (e.g. simplify the CSS), and \
retry. After **two** failed attempts at the PDF, stop retrying: the markdown \
and DOCX are the deliverables, and your final summary must state clearly \
that PDF rendering failed and why.

### Cleanup

Remove intermediates from `/workdir/tmp/` (`final_policy.html`, \
`policy_print.css`) once rendering succeeds. `/workdir/outputs/` must contain \
exactly: `final_policy.md`, `final_policy.docx`, `final_policy.pdf`.

### Final response

Reply with a one-paragraph summary naming the rendered files and noting any \
rendering issues, then STOP.
"""
