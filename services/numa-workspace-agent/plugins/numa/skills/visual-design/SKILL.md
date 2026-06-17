---
name: visual-design
description: Numa's visual design system — brand colours, fonts, spacing tokens, and layout recipes for dashboards, slide decks, reports, charts, and styled HTML. Load this BEFORE styling any visual artifact so it looks polished and on-brand — or matches the user's OWN brand if they already have one. Pairs with render / pptx-handling / pdf-handling / docx-handling / data-analysis, which own the mechanics.
---

# Visual Design Skill (Numa brand system)

Make visual artifacts look **designed, not defaulted**. Load this before you style anything a person will look at: a dashboard, a slide deck, a chart, a PDF/HTML report, a styled page. This skill gives you a ready-made design system so you assemble from known-good parts instead of improvising colours, fonts, and layout from scratch.

This skill owns the **look** (tokens + layout recipes). The format skills own the **mechanics** — load the matching one too:

| Building…                          | Also load                                    |
| ---------------------------------- | -------------------------------------------- |
| In-chat visual / inline HTML / SVG | `render`                                     |
| Slide deck (.pptx)                 | `pptx-handling`                              |
| PDF report                         | `pdf-handling`                               |
| Word doc (.docx)                   | `docx-handling`                              |
| Chart / data viz                   | `data-analysis` (the `make_chart.py` helper) |

---

## Whose design system? (resolve this FIRST)

The Numa palette below is the **default**, not a mandate. Before you apply any colour or font, work out whose brand applies. **Most-specific wins:**

1. **Stated in this chat** — the user gave colours/fonts, named a brand, or said "match our style / make it like X". Use that. Highest priority.
2. **An artifact in scope** — you're editing/extending an existing deck, doc, or page, OR the user uploaded a brand guide / reference file. **Inherit its look** — don't re-skin their work in Numa purple. Detect it concretely:
   - `.pptx` → read theme colours/fonts via `python-pptx` (`prs.slide_masters[0]` theme, existing run fonts).
   - `.docx` → read `doc.styles['Normal'].font` + heading styles.
   - HTML/CSS → reuse the existing `:root` / inline colours.
   - A brand guide as a **document** → extract the hex codes / font names (`numa docs extract`).
   - A brand that only exists as an **image** (logo, screenshot of their site) → you can't see it natively; pull the colours with `numa vision view --prompt 'list the main hex colours and fonts'`, or just ask.
3. **Saved in memory** — run `numa memory list` and look for a brand/design/colour/font memory (this is the "retrieve before you produce" rule from the `memories` skill). Use it if present.
4. **Numa default** — only when 1–3 are all absent: use the tokens below.

**Two rules around this:**

- **When it's ambiguous, ask — don't guess.** "I can match the brand from the deck you uploaded, or use Numa's default style — which would you prefer?" One question beats silently picking wrong.
- **When the user establishes a brand that isn't saved, offer to remember it** (ask first, per the `memories` skill): "Want me to save these brand colours so I use them automatically next time?" Save it as a `general` memory like `Brand: primary #0A2540, accent #00B894, font Inter`. Turns a one-off into a durable default.

Everything below is "the default you apply **once you've confirmed no other brand applies**" — or the shape you fill with the user's tokens when one does.

---

## Numa design tokens (the default)

Full, copy-paste values live in the helpers — **don't retype hex codes from memory**:

- HTML → `helpers/tokens.css` (a `:root` block + `.numa-card` / `.numa-btn` starters).
- Python (matplotlib / any script) → `helpers/numa_theme.py` (`COLORS`, `CHART_COLORS`, `apply_matplotlib()`).
- To see them: `python3 /app/plugins/numa/skills/visual-design/helpers/numa_theme.py` (add `--json` or `--emit-css`).

### Colours

| Token           | Hex                   | Use for                                                           |
| --------------- | --------------------- | ----------------------------------------------------------------- |
| Numa purple     | `#9949AC`             | Headings, primary buttons, active states, the one dominant accent |
| Soft lavender   | `#DFBDE7`             | Hover tints, badges, pill backgrounds                             |
| Deep teal       | `#1F4B5E`             | Secondary accent, dark sections, info banners                     |
| Charcoal        | `#1F1F1F`             | Dark backgrounds, footers, sidebars                               |
| Body text       | `#323232`             | Paragraph text — **never pure black**                             |
| Warm off-white  | `#F7F5F1`             | Section / card backgrounds, alternating rows                      |
| White           | `#FFFFFF`             | Page background, cards                                            |
| Success / Error | `#22C55E` / `#EF4444` | Reserve strictly for those meanings                               |

**Purple is the personality — use it with intent, not everywhere.** One dominant accent + charcoal text + warm/white surfaces beats a timid rainbow.

### Type scale

| Role            | Font    | Size    | Weight | Colour    |
| --------------- | ------- | ------- | ------ | --------- |
| H1 / hero       | Figtree | 48–60px | 600    | `#9949AC` |
| H2 section      | Figtree | 32–40px | 600    | `#9949AC` |
| H3 card title   | Inter   | 18–20px | 600    | `#000000` |
| Body            | Inter   | 14–16px | 400    | `#323232` |
| Caption / label | Inter   | 12–13px | 500    | `#323232` |

### Spacing, radii, shadows

- Spacing scale (px): `4 · 8 · 16 · 24 · 40 · 64 · 96`. **Let it breathe** — generous padding is core to the Numa look.
- Radii: `8px` most elements, `16px` cards, `999px` pill buttons.
- Shadows: soft only — `0 2px 12px rgba(0,0,0,0.08)`. No hard or neon shadows.

---

## Fonts per medium (this trips people up)

- **HTML** (dashboards, reports, render): load **Figtree + Inter from Google Fonts** in `<head>` (snippet at the top of `tokens.css`). Render reliably.
- **matplotlib charts & WeasyPrint PDF** (rendered in-container): Figtree + Inter are **bundled in the container**, so they render directly — `numa_theme.apply_matplotlib()` uses them, with `DejaVu Sans` as the ultimate glyph fallback. No Google Fonts needed.
- **PPTX & DOCX**: the font renders on the **viewer's** machine, not ours — they may not have Figtree/Inter, so a deck/doc still needs a safe fallback. `build_styled_doc.py` uses `Calibri` (near-universal, full macron coverage) for this reason; for decks prefer Calibri/Arial, or embed the font.

---

## Recipes (the layout depends on the artifact)

There is no single layout. Pick the recipe for what you're building; each is a starting structure, not a straitjacket.

### Dashboard (HTML)

A KPI row + a chart/table grid. Load `render` (in-chat) or write an HTML file (download).

```
[ Title ]                                   ← H2, purple
[ KPI card ][ KPI card ][ KPI card ]        ← 3–4 metric cards, big number + label
[ chart .......... ][ table ............ ]  ← 2-col grid, var(--space-lg) gap
```

- Metric card: white `.numa-card`, label in `#323232` 13px, value 28–32px 600 charcoal, optional delta in success/error.
- Max-width ~1100px centred; responsive 1→2→3 columns. Charts get their colours from `numa_theme` so they match the cards.
- In-chat (`render`) → keep it compact and flat per the render skill; a full downloadable dashboard → richer, full-width.

### Slide deck (.pptx) — load `pptx-handling`

- Title slide: purple H1 on white or a charcoal/teal fill; generous margins.
- Content slides: one idea per slide, big heading, ≤6 bullets, lots of whitespace. Pull slide accent + chart colours from `numa_theme` so embedded charts match the deck.
- Run `pptx-handling`'s visual-QA pass after building.

### Report (PDF / DOCX) — load `pdf-handling` or `docx-handling`

- For a branded PDF, build **HTML with `tokens.css` then WeasyPrint** (best styling control) — see `pdf-handling`.
- Purple H1/H2 (Figtree in HTML, Calibri server-side), `#323232` body, warm-white callout boxes, a thin purple rule under section headings. `docx-handling`'s `build_styled_doc.py` already encodes this for Word.

### Chart / data viz — load `data-analysis`

- Use `make_chart.py` (it already uses the Numa palette) or, in your own matplotlib script, call `numa_theme.apply_matplotlib()` first.
- **Colour encodes meaning, not sequence** — group by category, 2–3 colours, not a rainbow. Label axes and units. One chart = one idea.

---

## Design judgment (the few rules that lift weak output most)

1. **Hierarchy** — one clear focal point per view. Size, weight, and colour should rank importance; don't make everything bold.
2. **Whitespace is not wasted** — crowding reads as unfinished. Use the spacing scale; give sections room.
3. **One dominant accent** — purple (or the user's primary) leads; everything else is charcoal/neutral. Timid even-spread palettes look generic.
4. **Colour = meaning** — never decorate with colour for its own sake. Same category → same colour; reserve green/red for success/error.
5. **Restraint** — no gradients-on-white, no five fonts, no drop-shadow soup. Flat, clean, generous. Sentence case, not Title Case or ALL CAPS.
6. **Contrast & legibility** — body text `#323232` on white/warm-bg; never grey-on-grey. Nothing below 11px. On a coloured fill, use the darkest shade of that family or white.

---

## Applying a user's brand instead

When the precedence gate says "use theirs", you don't fight the defaults — you swap them:

- **HTML** → change the `:root` values (or regenerate: `python3 numa_theme.py --palette /workdir/tmp/brand.json --emit-css`). Everything keyed off the variables re-themes for free.
- **Charts** → `numa_theme.apply_matplotlib(numa_theme.load_palette("/workdir/tmp/brand.json"))`, or pass `make_chart.py --palette @/workdir/tmp/brand.json`.
- Build the `brand.json` from what you found (chat / file / memory):
  ```json
  {
    "colors": { "primary": "#0A2540", "charcoal_light": "#222" },
    "chart_colors": ["#0A2540", "#00B894", "#F39C12"],
    "fonts": { "display": "Georgia", "body": "Georgia" }
  }
  ```
  Keep their **layout/recipe** the same — it's the colours, fonts, and logo that carry a brand, not the grid.

---

## Helper Scripts

- **`numa_theme.py`** — the brand tokens in Python: `COLORS`, `CHART_COLORS`, `apply_matplotlib(palette=None)`, `load_palette(path)`, `emit_css(palette=None)`. Single source of truth — import it instead of hardcoding hex.
  ```bash
  python3 /app/plugins/numa/skills/visual-design/helpers/numa_theme.py --emit-css
  ```
- **`tokens.css`** — copy-paste `:root` variables + `.numa-card` / `.numa-btn` starters + the Google Fonts `<link>` for HTML artifacts.

Read-only at `/app/plugins/numa/skills/visual-design/helpers/`. Copy into `/workdir/chat-workflows/` and adapt if a user needs a persistent custom theme.
