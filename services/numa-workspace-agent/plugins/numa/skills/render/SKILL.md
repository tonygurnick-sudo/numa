---
name: render
description: Render HTML content, SVG diagrams, or images visually in the chat. Use when the user should SEE rendered output rather than raw code -- diagrams, previews, charts, styled content, interactive explainers.
---

# Render Skill

Display HTML, SVG diagrams, visualisations, or images directly in the chat conversation.

## Quick Reference

Call via the `numa render` CLI (through the `Bash` tool). Every call needs a
short `-m` caption — it's what the user sees in chat while the visual loads.

```python
# Render inline HTML (pass the markup via --content)
Bash("""numa render --type html --title 'Bucket Strategy' -m 'Showing bucket strategy diagram' \\
  --content "<div style='text-align:center'><h2>Strategy Overview</h2>...</div>" """)

# Render an SVG diagram (rendered directly, no iframe)
Bash("""numa render --type html --title 'System Architecture' -m 'Architecture diagram' \\
  --content "<svg width='100%' viewBox='0 0 680 400'>...</svg>" """)

# Render an HTML file from workspace (--type inferred from the .html extension)
Bash("numa render --file-path /workdir/outputs/dashboard.html --title 'Dashboard' -m 'Previewing dashboard'")

# Render an image (--type inferred from the .png extension; base64-encoded for you)
Bash("numa render --file-path /workdir/outputs/chart.png --title 'Sales Chart' -m 'Showing chart'")
```

For larger or quote-heavy HTML, write it to a workspace file first, then render
with `--file-path` — that sidesteps shell-escaping the markup on the command line.

## Flags

| Flag                   | Required | Default | Description                                                                 |
| ---------------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `--type`               | No†      | -       | `html` or `image`. Inferred from the `--file-path` extension when omitted.  |
| `--content`            | No\*     | -       | Inline HTML/SVG string (html only)                                          |
| `--file-path`          | No\*     | -       | Path to a file under `/workdir/` to render (images are base64-encoded here) |
| `--title`              | No       | -       | Title shown above the rendered content                                      |
| `--height`             | No       | 400     | Iframe height in pixels (html only, ignored for pure SVG)                   |
| `-m`, `--user-message` | Yes      | -       | Short caption shown to the user in chat while the visual loads              |

\*Provide exactly one of `--content` or `--file-path`.
†Required only when it can't be inferred — i.e. inline `--content` always
needs nothing (defaults to html), but a `--file-path` with an unusual extension
needs an explicit `--type`. Recognised extensions: `.html` / `.htm` / `.svg` →
html; `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` → image.

`numa render` only works inside an active workspace chat stream — it pushes the
visual onto the live SSE rail. Files passed via `--file-path` must live under
`/workdir/` and be under 2MB.

## When to Use

Proactively use render when the conversation naturally calls for a visual:

- **Educational explainers**: "Explain how X works" / "How does X relate to Y" -- where the concept has spatial, sequential, or systemic relationships
- **Data presentation**: "Show me the data" / "Compare X vs Y" -- charts, comparison cards, metric summaries
- **Architecture & systems**: "Help me architect X" / "Design a system for Y" -- diagrams, flowcharts, system maps
- **Structured information**: Comparisons, decision matrices, timelines, org charts
- **Agent/workflow previews**: Persona cards, configuration summaries, styled previews

**Multi-render responses**: Call render multiple times in a single response, interleaved with prose. Write a paragraph of explanation, then render a diagram, then more text, then a chart. Each visual should feel like it belongs exactly where it appears.

**Defaults to get right:**

- **"Show me" / "preview" / "let me see" means render — not a markdown table.** When the user asks to _see_ data or a comparison, produce an actual rendered visual (chart, comparison cards, a table component). A markdown table in your text is the fallback for when a visual genuinely doesn't fit, not the default.
- **Re-render after you edit the visual.** If you change an HTML/SVG file the user has already seen, call render again on the updated file in the same turn. Editing the file does NOT refresh what's on screen — without a re-render the user is still looking at the old visual and thinks nothing happened.
- **Charts include every requested category — even empty ones.** If the user asks for a breakdown across six buckets and four are zero, render all six; the zeros are information. Never silently drop categories. For series spanning very different magnitudes (counts vs revenue), use a secondary axis or normalise — otherwise the small series renders as invisible flat bars.

## When NOT to Use

- Simple text output (just write it as a message)
- The user hasn't asked for a visual and the content doesn't benefit from one
- Creating a file for download (Write the file to `/workdir/outputs/`, then reference it)
- Full-page applications or complex multi-page dashboards (create as a file instead)

## Render vs Create: Two Different Things

- **Render** (this tool): Inline visual in the conversation. Designed for the chat viewport. Think: a diagram, a card, a chart, a preview. Compact and self-contained.
- **Create file** (Write to `/workdir/outputs/` or run a generator script in `/workdir/tmp/`): A standalone HTML document the user can download. Full dashboards, multi-page layouts, complex apps.

If you want to both create AND preview, create the file first, then render it with `--file-path`.

**Don't build a standalone HTML document unless the user asked for one.** For an inline preview, render is enough — reaching for a full self-contained `.html` file (page chrome, multiple sections, interactive handlers) when the user only wanted to "see" something is wasted effort and usually ships dead, unwired controls. Match the artifact to the request.

---

## sendPrompt()

A global `sendPrompt(text)` function is available inside rendered HTML content. It sends a message to the chat as if the user typed it. Use it when the user's next step benefits from the agent thinking -- clicking a node to ask about it, "tell me more" buttons, drill-down interactions.

```html
<button onclick="sendPrompt('Tell me more about the authentication layer')">Learn more</button>
```

Handle filtering, sorting, toggling, and calculations in JS instead -- only use `sendPrompt()` when the action benefits from agent reasoning.

An `openLink(url)` function is also available for opening external URLs safely.

---

## Design System

### Philosophy

- **Seamless**: The visual should feel like a natural extension of the chat, not a separate webpage
- **Flat**: No gradients, mesh backgrounds, noise textures, or decorative effects. Clean flat surfaces
- **Compact**: Show the essential inline. Explain the rest in your text response
- **Text goes in your response, visuals go in the tool**: All explanatory text, descriptions, introductions, and summaries should be written as normal response text OUTSIDE the render call. The rendered content should contain ONLY the visual element

### Core Rules

- Body margin: `body { margin: 0; padding: 12px; }` so content sits flush
- Font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- No background colour on outer containers (transparent -- host provides the bg)
- No font-size below 11px
- No emoji -- use CSS shapes or SVG paths
- No gradients, drop shadows, blur, glow, or neon effects
- Sentence case always. Never Title Case, never ALL CAPS
- Keep content under 2MB
- For charts: use a CDN-hosted library (e.g. Chart.js via `<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js">`)
- Include all CSS inline or in a `<style>` tag (no external stylesheets in sandboxed iframe)
- Rounded corners: `border-radius: 8px` for most elements, `12px` for cards
- When placing text on a coloured background, use the darkest shade from that colour family -- never plain black or generic grey

### Sizing

Rendered content appears inside the chat column (~600-800px wide):

- **Width**: Always use `width: 100%` or `max-width: 100%`. Never set fixed pixel widths wider than 700px
- **Height**: Aim for 400-600px. Set the `height` parameter accordingly
- **Think "component, not page"**: The render output should feel like a visual element within the conversation

---

## SVG Diagrams

For diagrams, flowcharts, and structural visuals, **use inline SVG** -- it renders directly in the chat without an iframe, producing crisper results. SVGs without `<script>` tags are rendered natively.

### SVG Setup

```xml
<svg width="100%" viewBox="0 0 680 H">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  <!-- content here -->
</svg>
```

- 680px viewBox width, flexible height. Set H to fit content tightly
- Safe area: x=40 to x=640, y=40 to y=(H-40)
- Background transparent
- Always include the arrow marker `<defs>` block

### SVG Text Classes

Use inline styles matching these patterns consistently:

| Style    | Font | Size | Weight | Use for                    |
| -------- | ---- | ---- | ------ | -------------------------- |
| Title    | sans | 14px | 500    | Node/region labels         |
| Subtitle | sans | 12px | 400    | Descriptions, arrow labels |
| Heading  | sans | 14px | 500    | Section headings           |

### SVG Diagram Rules

- Size boxes to fit text. At 14px sans-serif, each char is roughly 8px wide
- 60px minimum gap between boxes, 24px padding inside boxes
- Prefer single-direction flows (top-down or left-right)
- Max 4-5 nodes per diagram for clarity
- Arrows must not cross other boxes. Route around with L-bends if needed
- Use 0.5px strokes for borders and edges
- Connector paths need `fill="none"` (SVG defaults to `fill: black`)
- No decorative step numbers or oversized headings

### ViewBox Safety Checklist

Before finalising any SVG:

1. Find lowest element: max(y + height) across all rects
2. Set viewBox height = that value + 40px buffer
3. Find rightmost element: max(x + width). All content must stay within x=0 to x=680
4. Never use negative x or y coordinates

---

## Colour Palette

9 colour ramps, each with 7 stops from lightest to darkest. Use these consistently across all renders.

| Name   | 50 (lightest) | 100     | 200     | 400     | 600     | 800     | 900 (darkest) |
| ------ | ------------- | ------- | ------- | ------- | ------- | ------- | ------------- |
| Purple | #EEEDFE       | #CECBF6 | #AFA9EC | #7F77DD | #534AB7 | #3C3489 | #26215C       |
| Teal   | #E1F5EE       | #9FE1CB | #5DCAA5 | #1D9E75 | #0F6E56 | #085041 | #04342C       |
| Coral  | #FAECE7       | #F5C4B3 | #F0997B | #D85A30 | #993C1D | #712B13 | #4A1B0C       |
| Pink   | #FBEAF0       | #F4C0D1 | #ED93B1 | #D4537E | #993556 | #72243E | #4B1528       |
| Grey   | #F1EFE8       | #D3D1C7 | #B4B2A9 | #888780 | #5F5E5A | #444441 | #2C2C2A       |
| Blue   | #E6F1FB       | #B5D4F4 | #85B7EB | #378ADD | #185FA5 | #0C447C | #042C53       |
| Green  | #EAF3DE       | #C0DD97 | #97C459 | #639922 | #3B6D11 | #27500A | #173404       |
| Amber  | #FAEEDA       | #FAC775 | #EF9F27 | #BA7517 | #854F0B | #633806 | #412402       |
| Red    | #FCEBEB       | #F7C1C1 | #F09595 | #E24B4A | #A32D2D | #791F1F | #501313       |

### How to Use Colours

- **Colour encodes meaning, not sequence.** Don't cycle through colours like a rainbow
- Group nodes by **category** -- all nodes of the same type share one colour
- Use **grey for neutral/structural** nodes (start, end, generic steps)
- Use **2-3 colours per diagram**, not 6+
- **Prefer purple, teal, coral, pink** for general categories. Reserve blue, green, amber, red for informational, success, warning, error concepts
- **Fill + stroke + text pattern**: 50-stop fill + 600-stop stroke + 800-stop text
- **Title vs subtitle on coloured backgrounds**: title uses 800-stop, subtitle uses 600-stop

---

## Diagram Types

### Picking the Right Type

Route on the verb, not the noun:

| User says                     | Type             | What to draw                                 |
| ----------------------------- | ---------------- | -------------------------------------------- |
| "how do LLMs work"            | Illustrative     | Token row, stacked layers, attention threads |
| "transformer architecture"    | Structural       | Labelled boxes: embedding, attention, FFN    |
| "what are the training steps" | Flowchart        | Forward -> loss -> backward -> update        |
| "explain the Krebs cycle"     | Interactive HTML | Click through stages                         |

### Flowchart

Sequential processes, cause-and-effect, decision trees. Top-down or left-right. Max 4-5 nodes.

### Structural Diagram

Containment -- things inside other things. Outermost container uses lightest fill (50-stop), inner regions use next shade (100-200 stop). Max 2-3 nesting levels.

### Illustrative Diagram

Building intuition. Freeform shapes, layout follows the subject's geometry. Colour encodes intensity. Layering and overlap encouraged for shapes.

---

## HTML Interactive Widgets

For interactive content (calculators, steppers, explorable explanations), use full HTML with scripts. These render in a sandboxed iframe.

### Structure

```html
<style>
  body {
    margin: 0;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  /* keep styles short and inline-first */
</style>
<div>
  <!-- content -->
</div>
<script>
  // JS logic -- executes after content loads
</script>
```

### Rules

- Style block first (keep under ~15 lines), then content HTML, then scripts last
- Prefer inline `style="..."` over `<style>` blocks for simple elements
- No `<!-- comments -->` or `/* comments */` (waste tokens)
- No `position: fixed` -- the iframe sizes to content flow
- Scripts can load libraries via CDN: `<script src="https://cdnjs.cloudflare.com/ajax/libs/..."></script>`
- For Chart.js: wrap `<canvas>` in a `<div>` with explicit height and `position: relative`. Set height ONLY on the wrapper, never on canvas. Always set `responsive: true, maintainAspectRatio: false`

---

## Embedding Dynamic Data Safely

When rendering data that contains user-entered strings (company names, ticket titles, comments, notes), do not string-interpolate or template the data directly into `<script>` or inline HTML. Characters common in real data -- `&`, `<`, `>`, `/` -- will silently break HTML/JS parsing. The chart at the top renders, the section below renders blank, and there's no console error.

**Never sanitize the source data.** Escape on output, never on input. "Chandler Glass & Packaging" must round-trip exactly.

### Safe pattern: JSON in a typed script tag

```html
<script type="application/json" id="page-data">
  {payload}
</script>
<script>
  const data = JSON.parse(document.getElementById('page-data').textContent);
  // build the page from data
</script>
```

Inside `<script type="application/json">`, the only sequence that can close the tag early is `</`. Escape it once when serialising:

```python
import json
payload = json.dumps(data).replace("</", "<\\/")
```

### Inserting strings into HTML element text or attributes

Use `html.escape()`, not f-strings:

```python
import html
row = f"<tr><td>{html.escape(name)}</td><td>{html.escape(notes)}</td></tr>"
```

`html.escape()` defaults to `quote=True`, which also escapes `"` for attribute values.

### Don't trust "this field looks safe"

`&` shows up in company names, `<` `>` in templates, `/` in product codes, smart quotes everywhere. If a string came from a person, escape it.

---

## Component Patterns

### Metric Cards

Summary numbers: muted 13px label above, 24px/500-weight number below. Light background, no border.

```html
<div style="display:flex;gap:12px;">
  <div style="flex:1;background:#F1EFE8;border-radius:12px;padding:16px;text-align:center;">
    <div style="font-size:13px;color:#5F5E5A;">Total</div>
    <div style="font-size:24px;font-weight:500;color:#2C2C2A;">1,247</div>
  </div>
</div>
```

### Cards

White background, 0.5px border, 12px radius, 16px padding.

```html
<div style="background:#fff;border:0.5px solid rgba(0,0,0,0.12);border-radius:12px;padding:16px 20px;">
  <!-- content -->
</div>
```

### Buttons (with sendPrompt)

```html
<button
  onclick="sendPrompt('Explain the auth layer in detail')"
  style="background:transparent;border:0.5px solid rgba(0,0,0,0.2);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;"
>
  Learn more
</button>
```

---

## Tips

- Use inline SVG for diagrams and flowcharts -- renders directly without iframe, crisper and lighter
- For complex dashboards: Write the HTML file to `/workdir/tmp/<name>.html` (or `/workdir/outputs/<name>.html` if it's the deliverable), then render with `--file-path`. To iterate on the dashboard, use `Edit` to patch the HTML in place — much cheaper than re-Writing the whole file.
- Use colour to convey meaning -- status indicators, priority levels, category groupings
- Rounded corners and subtle borders make rendered content feel native to the chat
- Multiple renders per response is encouraged -- interleave visuals with explanation text
- **Design once for open-ended work.** For a free-form dashboard, a classifier, or a rule-set, plan the full spec and edge cases up front, then build in one pass. Iterating shape-by-shape on an underspecified target churns turns (one bench took 40) — settle the structure first, then execute.

## Helper Scripts

- **`numa-palette.css`** — the Numa brand palette as drop-in CSS (`:root` variables + `.numa-card` / `.numa-btn` / `.numa-stat` / `.numa-table` recipes). Read it and inline the parts you need into your render HTML for an on-brand look without reinventing colours and type. Read-only at `/app/plugins/numa/skills/render/helpers/`.
  ```bash
  cat /app/plugins/numa/skills/render/helpers/numa-palette.css
  ```
