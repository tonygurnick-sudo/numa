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
pres.layout = "LAYOUT_16x9";

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

### Avoid (Common Mistakes)

- Don't repeat the same layout across slides — vary columns, cards, callouts
- Don't center body text — left-align paragraphs and lists; center only titles
- Don't default to blue — pick colours that reflect the specific topic
- Don't create text-only slides — add images, icons, charts, or shapes
- NEVER use accent lines under titles — hallmark of AI-generated slides

---

## Visual QA Pipeline (Required)

Your first render is almost never correct. Always verify output visually.

### Convert to Images

```bash
# Step 1: Convert PPTX to PDF
numa docs convert /workdir/outputs/presentation.pptx --format pdf -m "Converting PPTX to PDF for visual QA"

# Step 2: Render PDF pages as images (in /workdir/tmp/ — they're not for the user)
pdftoppm -jpeg -r 120 /workdir/outputs/converted_presentation.pdf /workdir/tmp/slide
```

> `convert_document` accepts legacy PowerPoint binary formats (`.ppt`, `.pot`) and the modern template variant (`.potx`) in addition to `.pptx` — same `mode="file"` call.

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
- **`starter_deck.js`** — build a branded deck from a JSON spec: title / section / content / chart / table / stat masters in the Numa palette. The fast path for a standard deck — skips the shape-constant and layout churn.
  ```bash
  NODE_PATH=/app/node_packages/node_modules node \
    /app/plugins/numa/skills/pptx-handling/helpers/starter_deck.js --spec @/workdir/tmp/deck.json
  ```
- Charts go in as pre-rendered PNGs: **`make_chart.py`** (`/app/plugins/numa/skills/data-analysis/helpers/make_chart.py`) → reference the PNG in a `"chart"` slide. Verify the deck embedded them with **`verify_artifact.py`** (`/app/plugins/numa/skills/pdf-handling/helpers/verify_artifact.py --expect-images N`).
