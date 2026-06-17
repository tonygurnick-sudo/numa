---
name: pptx-handling
description: "Use this skill any time a .pptx file is involved — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from .pptx files; editing or modifying existing presentations. Trigger whenever the user mentions 'deck', 'slides', 'presentation', or references a .pptx filename."
---

# PPTX Skill

## Quick Reference

| Task                   | Approach                                                |
| ---------------------- | ------------------------------------------------------- |
| Read/extract text      | `python -m markitdown presentation.pptx`                |
| Create from scratch    | PptxGenJS (Node.js) — read [pptxgenjs.md](pptxgenjs.md) |
| Edit existing/template | python-pptx — read [editing.md](editing.md)             |

**Decision matrix:**

| Scenario                | Best Tool           | Why                                                      |
| ----------------------- | ------------------- | -------------------------------------------------------- |
| New deck, no template   | PptxGenJS (Node.js) | Icons, shadows, charSpacing, charts, full design control |
| Edit existing PPTX      | python-pptx         | Preserves formatting, layouts, and branding              |
| Fill template with data | python-pptx         | Works with existing placeholders and structure           |
| Quick text extraction   | markitdown          | Fast CLI, no code needed                                 |

> **Tool preference:** For deck creation/iteration, Write the Node script to `/workdir/tmp/create_deck.js` and run with `Bash("node /workdir/tmp/create_deck.js")`. Edit the file in place for revisions — patch-style edits are dramatically cheaper than re-emitting the full script. Reserve `/workdir/outputs/` for the final `.pptx` you want the user to see; keep working scripts in `/workdir/tmp/`.

---

## Saving or uploading the deck — save the `.pptx`, never the QA PDF

The deliverable the user keeps is the **`.pptx`** — the editable source. When the user asks you to
**save, store, upload, or put the presentation in Numa Files / a folder**, upload the **source
`.pptx`**, **never** a PDF rendition of it.

The PDF you produce during Visual QA (below) is a **throwaway** for your own visual inspection — it is
_not_ the deliverable, so don't upload it as the saved file. Only save/upload a PDF when the user
**explicitly** asks for a PDF copy (and keep the `.pptx` too unless told otherwise).

After saving, report the **actual** filename and extension you uploaded — never tell the user you saved
a `.pptx` when you in fact uploaded a `.pdf`. (This silent `.pptx → .pdf` swap on save was a real
customer bug: the agent converted the deck for QA, then uploaded the PDF while reporting the `.pptx`.)

---

## Reading Content

```bash
# Text extraction (fast, no code needed)
python -m markitdown presentation.pptx
```

> **For richer extraction** and for legacy/template formats (`.ppt`, `.pot`, `.potx`) where markitdown often returns empty or truncated content, prefer `numa docs extract /path -m "..."` — it routes through the extract-content Lambda and consistently produces fuller output.

For visual overview, convert to PDF then render as images:

```bash
# Step 1: Convert PPTX to PDF
numa docs convert /workdir/uploads/presentation.pptx --format pdf -m "Converting PPTX to PDF for visual overview"

# Step 2: Render PDF pages as images
pdftoppm -jpeg -r 120 /workdir/outputs/converted_presentation.pdf /workdir/tmp/slide
```

This creates `slide-01.jpg`, `slide-02.jpg`, etc. in `/workdir/tmp/` so they don't clutter the user's outputs view.

---

## Creating from Scratch (PptxGenJS)

**Read [pptxgenjs.md](pptxgenjs.md) for the full tutorial.**

Write the script to `/workdir/tmp/`, then run with Bash. To iterate, Edit the file in place rather than rewriting it:

```
Write(file_path="/workdir/tmp/create_deck.js", content="""
const pptxgen = require("pptxgenjs");
let pres = new pptxgen();
// LAYOUT_WIDE = 13.333 x 7.5 in (modern 16:9 — the standard). Do NOT use
// LAYOUT_16x9: that's the old 10 x 5.625 in canvas, which leaves content
// cramped and prone to falling off the bottom of the slide.
pres.layout = "LAYOUT_WIDE";

let slide = pres.addSlide();
slide.addText("Hello World!", { x: 0.5, y: 0.5, fontSize: 36, color: "363636" });

pres.writeFile({ fileName: "/workdir/outputs/presentation.pptx" });
""")
Bash(command="node /workdir/tmp/create_deck.js")
```

Subsequent revisions (change a colour, fix a number, adjust a layout): use `Edit` to patch the existing script rather than re-emitting the whole thing.

---

## Editing Existing Presentations (python-pptx)

**Read [editing.md](editing.md) for the full guide.**

```python
from pptx import Presentation

prs = Presentation("/workdir/uploads/template.pptx")
slide = prs.slides[0]

# Iterate shapes and modify text
for shape in slide.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            for run in para.runs:
                if "PLACEHOLDER" in run.text:
                    run.text = run.text.replace("PLACEHOLDER", "Actual Content")

prs.save("/workdir/outputs/filled_presentation.pptx")
```

---

## Design Guidelines

**Don't create boring slides.** Plain bullets on a white background won't impress anyone.

> **Load the `visual-design` skill first** for the brand colour/font tokens (or to match a user's own brand — it resolves whose brand applies). Pull slide accents and chart colours from its `numa_theme` so embedded charts match the deck. For a Numa-branded deck, its tokens are the default; the palette guidance below is for a distinctive topic-specific look when no brand applies.

### Before Starting

- **Pick a bold, content-informed colour palette**: The palette should feel designed for THIS topic.
- **Dominance over equality**: One colour should dominate (60-70% visual weight), with 1-2 supporting tones and one sharp accent.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it across every slide.

### Colour Palettes

| Theme                  | Primary               | Secondary            | Accent              |
| ---------------------- | --------------------- | -------------------- | ------------------- |
| **Midnight Executive** | `1E2761` (navy)       | `CADCFC` (ice blue)  | `FFFFFF` (white)    |
| **Forest & Moss**      | `2C5F2D` (forest)     | `97BC62` (moss)      | `F5F5F5` (cream)    |
| **Coral Energy**       | `F96167` (coral)      | `F9E795` (gold)      | `2F3C7E` (navy)     |
| **Warm Terracotta**    | `B85042` (terracotta) | `E7E8D1` (sand)      | `A7BEAE` (sage)     |
| **Ocean Gradient**     | `065A82` (deep blue)  | `1C7293` (teal)      | `21295C` (midnight) |
| **Charcoal Minimal**   | `36454F` (charcoal)   | `F2F2F2` (off-white) | `212121` (black)    |
| **Teal Trust**         | `028090` (teal)       | `00A896` (seafoam)   | `02C39A` (mint)     |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**

- Two-column (text left, illustration right)
- Icon + text rows (icon in coloured circle, bold header, description)
- 2x2 or 2x3 grid of content blocks
- Half-bleed image with content overlay
- Large stat callouts (big numbers 60-72pt with small labels)
- Timeline or process flow (numbered steps, arrows)

### Typography

| Header Font  | Body Font |
| ------------ | --------- |
| Georgia      | Calibri   |
| Arial Black  | Arial     |
| Cambria      | Calibri   |
| Trebuchet MS | Calibri   |

| Element        | Size          |
| -------------- | ------------- |
| Slide title    | 36-44pt bold  |
| Section header | 20-24pt bold  |
| Body text      | 14-16pt       |
| Captions       | 10-12pt muted |

### Spacing

- 0.5" minimum margins from slide edges
- 0.3-0.5" between content blocks
- Leave breathing room — don't fill every inch
- **Footers and bottom shapes need a safe zone.** A shape's `top + height` must stay above the slide's bottom edge. On a 7.5" slide put a footer at `y ≈ 6.9"`, `height ≤ 0.4"`. Never place a shape whose bottom (or right) runs past the slide — that's the #1 cause of "text falling off screen".
- **Fit embedded images to the available area.** A full dashboard/chart PNG is often taller than the slide. Compute the available height (`slideH − top − bottom margin`) and scale the image to it, preserving aspect ratio — don't drop a 5.5"-tall image onto a slide at `y=1"`. In PptxGenJS use `sizing: { type: "contain", w, h }`.
- **Don't over-stuff a slide.** If a title + cards + a table won't fit with ≥0.5" margins, split across slides or cut content. Six panels plus a table on one slide will overflow.

### Avoid (Common Mistakes)

- Don't repeat the same layout across slides — vary columns, cards, callouts
- Don't center body text — left-align paragraphs and lists; center only titles
- Don't default to blue — pick colours that reflect the specific topic
- Don't create text-only slides — add images, icons, charts, or shapes
- NEVER use accent lines under titles — hallmark of AI-generated slides

---

## Visual QA Pipeline (Required)

Your first render is almost never correct. Always verify output visually.

### Step 0: Programmatic bounds check (always — works without the converter)

Before rendering images, validate geometry with the helper. It flags every shape that falls off the slide and any sub-12pt text, and it runs **in-container**, so it catches overflow even when the PPTX→PDF convert below is unavailable:

```bash
python3 /app/plugins/numa/skills/pptx-handling/helpers/slide_check.py /workdir/outputs/presentation.pptx
```

Fix every OFF-SLIDE finding (scale images to fit, move shapes into the safe area, split over-stuffed slides) and bump fonts to ≥12pt, then re-run until it exits 0. This deterministically catches the "compressed / falling off screen" failures a human-eyeball pass misses.

### Convert to Images

```bash
# Step 1: Convert PPTX to PDF
numa docs convert /workdir/outputs/presentation.pptx --format pdf -m "Converting PPTX to PDF for visual QA"

# Step 2: Render PDF pages as images (in /workdir/tmp/ — they're not for the user)
pdftoppm -jpeg -r 120 /workdir/outputs/converted_presentation.pdf /workdir/tmp/slide
```

> `numa docs convert` **auto-detects** the conversion mode from the file type — for any Office/PDF file just pass `--format pdf`, no `--mode` needed (binary formats are routed to direct LibreOffice conversion automatically). It accepts legacy PowerPoint binary formats (`.ppt`, `.pot`) and the modern template variant (`.potx`) in addition to `.pptx`.

> ⚠️ **The `converted_*.pdf` this produces is a QA throwaway, not a deliverable.** If the user later asks you to save/upload the deck, upload the source `.pptx` — not this PDF. See "Saving or uploading the deck" above.

### Content QA

```bash
python3 -m markitdown /workdir/outputs/presentation.pptx
```

Check for missing content, typos, wrong order, leftover placeholder text.

### Visual Inspection

After converting to images, read each slide image and check for:

- Overlapping elements (text through shapes, stacked elements)
- Text overflow or cut off at edges
- Elements too close (< 0.3" gaps)
- Insufficient margin from slide edges (< 0.5")
- Low-contrast text or icons
- Leftover placeholder content

### Verification Loop

1. Generate slides -> Convert to images -> Inspect
2. List issues found
3. Fix **critical issues only** (overlapping text, corrupted layout, missing content, text cut off)
4. Re-verify the affected slides ONE time to confirm the fix worked
5. **Stop here.** Do NOT loop more than once. Present the result to the user and say something like "Here's your presentation — let me know if you'd like me to adjust anything." Minor cosmetic issues (spacing tweaks, colour preferences, font size adjustments) should be mentioned to the user rather than auto-fixed in another loop.

### Don't chase render artifacts — verify against source first

The PPTX→PDF step can introduce artifacts that aren't in your deck — LibreOffice has been seen to turn `<` into `·`, garble a glyph, or nudge a box. Before you "fix" an apparent visual issue, confirm it exists in the **source**: check the markitdown text or the python-pptx run/shape. If the text is correct in the `.pptx` and only wrong in the rendered image, it's a preview artifact — leave the deck alone. (One bench burned a third of a turn chasing a `<`→`·` non-bug.)

### Verify brand/spec colours actually landed

When the user specified brand or spec colours, don't claim you applied them on faith — confirm. Inspect the shape fills with python-pptx, or `numa vision view` the rendered slide and check navy actually appears where navy was specified. A "brand colours applied" claim over a deck that has none is a silent, embarrassing failure. (The `helpers/verify_artifact.py` script checks fills/colours for you — see Helper Scripts.)

---

## Icons (SVG + sharp)

For icons in presentations, write inline SVGs and rasterise with `sharp`:

```javascript
const sharp = require('sharp');

async function svgToBase64(svgString, size = 256) {
  const buf = await sharp(Buffer.from(svgString)).resize(size, size).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

// Example: checkmark icon
const checkSvg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="11" fill="#4472C4"/>
  <path d="M7 12l3 3 7-7" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>`;

// Must wrap in async function (top-level await not supported in CommonJS)
async function main() {
  const iconData = await svgToBase64(checkSvg);
  slide.addImage({ data: iconData, x: 1, y: 1, w: 0.5, h: 0.5 });
}
main();
```

Common icon patterns (simple inline SVGs):

- **Checkmark**: Circle + checkmark path
- **Arrow**: Triangle or chevron path
- **Chart**: Bar chart rectangles
- **Person**: Circle head + body arc
- **Star**: Star polygon path
- **Lightbulb**: Bulb outline path

---

## Dependencies

All pre-installed in the workspace:

- `markitdown[pptx]` — text extraction
- `python-pptx` — editing existing PPTX
- `pptxgenjs` (Node.js) — creating from scratch
- `sharp` (Node.js) — SVG-to-PNG rasterisation for icons
- `convert_document` tool — PPTX-to-PDF conversion (via Lambda)
- `pdftoppm` (Poppler) — PDF-to-image conversion for QA

## File Paths

- **Input presentations**: `/workdir/uploads/`
- **Output presentations**: `/workdir/outputs/`
- **Working files**: `/workdir/outputs/`

---

## Helper Scripts

Read-only at `/app/plugins/numa/skills/pptx-handling/helpers/`. Generic — adapt via `/workdir/chat-workflows/` for a bespoke look.

- **`constants.js`** — the valid PptxGenJS shape names (stop guessing `ROUNDED_RECT` — it's `roundRect`), the Numa palette, and a `shape()` normaliser. `require()` it from your generator script.
- **`starter_deck.js`** — build a branded deck from a JSON spec: title / section / content / chart / table / stat masters in the Numa palette. The fast path for a standard deck — it uses the correct 13.333×7.5" wide canvas, fits images to the slide (`sizing: contain`), and keeps content in-bounds, so it sidesteps the off-slide / overflow failures entirely. **Prefer it; only hand-roll for genuinely custom layouts** (and then run `slide_check.py`).
  ```bash
  NODE_PATH=/app/node_packages/node_modules node \
    /app/plugins/numa/skills/pptx-handling/helpers/starter_deck.js --spec @/workdir/tmp/deck.json
  ```
- **`slide_check.py`** — validate a finished deck: flags any shape that falls off the slide and any sub-12pt text, exits 1 if so. Runs in-container (no converter needed), so it's the always-on first step of Visual QA. `python3 /app/plugins/numa/skills/pptx-handling/helpers/slide_check.py /workdir/outputs/deck.pptx`
- Charts go in as pre-rendered PNGs: **`make_chart.py`** (`/app/plugins/numa/skills/data-analysis/helpers/make_chart.py`) → reference the PNG in a `"chart"` slide. Verify the deck embedded them with **`verify_artifact.py`** (`/app/plugins/numa/skills/pdf-handling/helpers/verify_artifact.py --expect-images N`).
