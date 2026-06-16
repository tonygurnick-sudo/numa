---
name: view-image
description: Look at an image you cannot see natively — describe charts, screenshots, slides, scanned pages, photos, diagrams. Use whenever you need to know what is INSIDE an image file in the workspace (.png/.jpg/.jpeg/.gif/.webp) and you cannot read pixels directly. The `numa vision view` CLI runs the image through a vision model and returns a text description.
---

# View Image Skill

You cannot see images. `numa vision view` is your eyes: it reads an image file
from the workspace, runs it through a vision model, and hands you back a text
description you can reason over.

Reach for it any time the answer lives in pixels you cannot read — a chart's
values, a screenshot's UI, a slide's layout, a scanned page, a photo, a diagram.

## Quick Reference

Call via the `numa vision view` CLI (through the `Bash` tool). Every call needs
a short `-m` caption — it's what the user sees in chat while the image is read.

```python
# Describe an image (no specific question → full description)
Bash("numa vision view --file-path /workdir/uploads/slide.png -m 'Looking at the slide'")

# Ask a specific question about the image
Bash("""numa vision view --file-path /workdir/uploads/chart.png \\
  --prompt 'What are the exact values for each bar, and what is the Y-axis unit?' \\
  -m 'Reading the chart values'""")

# Inspect a screenshot to understand a UI / error
Bash("""numa vision view --file-path /workdir/uploads/screenshot.jpg \\
  --prompt 'Transcribe every visible label, field, and error message verbatim.' \\
  -m 'Reading the screenshot'""")
```

## Flags

| Flag                   | Required | Default          | Description                                                                       |
| ---------------------- | -------- | ---------------- | --------------------------------------------------------------------------------- |
| `--file-path`          | Yes      | -                | Path to an image under `/workdir/` (`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`) |
| `--prompt`             | No       | full description | What to look for / the question to answer about the image                         |
| `-m`, `--user-message` | Yes      | -                | Short caption shown to the user in chat while the image is read                   |

The file must live under `/workdir/` and be a supported image type. The result
is `{ "description": "..." }` — the model's answer or description as text.

## When to Use

- **A chart, graph, or plot** and you need the actual values, trends, axes, or legend
- **A screenshot** — a UI, an error dialog, a console, a settings panel
- **A slide / presentation image** and you need its layout, headings, or content
- **A scanned document page** delivered as an image (not extractable text)
- **A photo or diagram** whose content matters to the task
- **Any image the user references** ("look at this", "what does this show", "is this right")

Give `--prompt` a specific question when you need a specific fact (exact numbers,
a particular label). Omit it for a general "tell me everything in this image."

## When NOT to Use

- **PDFs, DOCX, PPTX, spreadsheets, audio/video** — use `numa docs extract` (it
  routes scanned/complex documents through vision AI and audio/video through
  transcription). `numa vision view` is for standalone IMAGE files only.
- **You only need to show the user an image** (not understand it) — use
  `numa render --file-path ... --type image` to display it inline.
- **The text is already available** as an extractable text layer — extract it.

## Important Habits (you can't see, so verify)

- **Never invent what's in an image.** If you haven't run `numa vision view` on
  it, you do not know its contents — do not guess values, labels, or layout.
- **Re-check after you change an image.** If you generate or convert a file to an
  image (a chart, a rendered page screenshot) and need to confirm it looks right,
  run `numa vision view` on the OUTPUT before claiming it's correct. You cannot
  confirm a visual by looking at the code that produced it.
- **Quote, don't paraphrase, when transcribing.** When the user needs the text
  inside an image, ask the prompt for it verbatim and pass it through as-is.

## Notes

- Read-only and non-destructive — no approval prompt; it just looks.
- Works on the laptop CLI and inside workspace chat alike (it's a normal data
  call, not tied to the live stream the way `numa render` is).
- One image per call. To compare several, call it once per file and reason over
  the descriptions together.
