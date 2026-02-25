# Editing Existing Presentations

Use python-pptx to edit existing PPTX files or fill templates with data.

## Template-Based Workflow

1. **Analyse the template** — understand structure before modifying:
   ```python
   from pptx import Presentation

   prs = Presentation("/workdir/uploads/template.pptx")
   for i, slide in enumerate(prs.slides):
       print(f"\n--- Slide {i+1} ---")
       for shape in slide.shapes:
           print(f"  Shape: {shape.shape_type}, Name: {shape.name}")
           if shape.has_text_frame:
               for para in shape.text_frame.paragraphs:
                   print(f"    Text: {para.text[:80]}")
           if shape.has_table:
               print(f"    Table: {shape.table.rows.__len__()} rows x {len(shape.table.columns)} cols")
   ```

2. **Extract text for review**:
   ```bash
   python -m markitdown /workdir/uploads/template.pptx
   ```

3. **Visual overview** (convert to images):
   ```bash
   soffice --headless --convert-to pdf --outdir /workdir/session/ /workdir/uploads/template.pptx
   pdftoppm -jpeg -r 150 /workdir/session/template.pdf /workdir/session/slide
   ```

4. **Plan slide mapping**: For each content section, choose a template slide. Use varied layouts — don't default to title + bullets for every slide.

5. **Edit content**: Modify text, add shapes, update tables.

6. **Save**: Always save to a new file, never overwrite the template.

---

## Analysing Template Structure

### Slide Layouts and Placeholders

```python
from pptx import Presentation

prs = Presentation("/workdir/uploads/template.pptx")

# List available slide layouts
for i, layout in enumerate(prs.slide_layouts):
    print(f"Layout {i}: {layout.name}")
    for ph in layout.placeholders:
        print(f"  Placeholder {ph.placeholder_format.idx}: {ph.name} ({ph.placeholder_format.type})")
```

### Shape Types

```python
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

prs = Presentation("/workdir/uploads/template.pptx")
slide = prs.slides[0]

for shape in slide.shapes:
    print(f"Name: {shape.name}")
    print(f"  Type: {shape.shape_type}")
    print(f"  Position: left={shape.left}, top={shape.top}")
    print(f"  Size: width={shape.width}, height={shape.height}")
    if shape.has_text_frame:
        print(f"  Text: {shape.text_frame.text[:60]}")
    if shape.has_table:
        t = shape.table
        print(f"  Table: {len(t.rows)}x{len(t.columns)}")
```

---

## Modifying Text

### Simple Text Replacement

```python
from pptx import Presentation

prs = Presentation("/workdir/uploads/template.pptx")

replacements = {
    "{{company}}": "Arcanum AI",
    "{{date}}": "February 2026",
    "{{title}}": "Quarterly Report",
}

for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    for old, new in replacements.items():
                        if old in run.text:
                            run.text = run.text.replace(old, new)

prs.save("/workdir/session/filled_presentation.pptx")
```

### Preserving Formatting

When replacing text, work at the run level to preserve fonts, sizes, and colours:

```python
from pptx import Presentation

def replace_in_runs(paragraph, old_text, new_text):
    """Replace text while preserving run formatting."""
    for run in paragraph.runs:
        if old_text in run.text:
            run.text = run.text.replace(old_text, new_text)

prs = Presentation("/workdir/uploads/template.pptx")
for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                replace_in_runs(para, "PLACEHOLDER", "Actual Content")

prs.save("/workdir/session/result.pptx")
```

### Setting Text with Formatting

```python
from pptx import Presentation
from pptx.util import Pt, Emu
from pptx.dml.color import RGBColor

prs = Presentation("/workdir/uploads/template.pptx")
slide = prs.slides[0]

# Find a shape by name
for shape in slide.shapes:
    if shape.name == "Title 1":
        tf = shape.text_frame
        tf.clear()
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = "New Title"
        run.font.size = Pt(36)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0x1E, 0x27, 0x61)

prs.save("/workdir/session/styled.pptx")
```

---

## Working with Tables

```python
from pptx import Presentation
from pptx.util import Pt

prs = Presentation("/workdir/uploads/template.pptx")
slide = prs.slides[0]

# Find tables
for shape in slide.shapes:
    if shape.has_table:
        table = shape.table

        # Read table
        for row_idx, row in enumerate(table.rows):
            for col_idx, cell in enumerate(row.cells):
                print(f"[{row_idx},{col_idx}]: {cell.text}")

        # Write to cells
        table.cell(1, 0).text = "New Value"
        table.cell(1, 1).text = "$1,500"

        # Style a cell
        cell = table.cell(0, 0)
        for para in cell.text_frame.paragraphs:
            for run in para.runs:
                run.font.bold = True
                run.font.size = Pt(12)

prs.save("/workdir/session/table_filled.pptx")
```

---

## Adding New Slides

```python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation("/workdir/uploads/template.pptx")

# Add slide using a layout from the template
layout = prs.slide_layouts[1]  # Choose layout by index
slide = prs.slides.add_slide(layout)

# Fill placeholders
for ph in slide.placeholders:
    print(f"Placeholder {ph.placeholder_format.idx}: {ph.name}")
    if ph.placeholder_format.idx == 0:  # Title
        ph.text = "New Slide Title"
    elif ph.placeholder_format.idx == 1:  # Body/Content
        ph.text = "Content goes here"

prs.save("/workdir/session/with_new_slide.pptx")
```

---

## Adding Images to Slides

```python
from pptx import Presentation
from pptx.util import Inches

prs = Presentation("/workdir/uploads/template.pptx")
slide = prs.slides[0]

# Add image at specific position
slide.shapes.add_picture(
    "/workdir/uploads/logo.png",
    left=Inches(1), top=Inches(1),
    width=Inches(3)  # Height auto-calculated from aspect ratio
)

prs.save("/workdir/session/with_image.pptx")
```

---

## Deleting Slides

```python
from pptx import Presentation
import copy

prs = Presentation("/workdir/uploads/template.pptx")

# Delete slide by index (0-based)
def delete_slide(prs, index):
    rId = prs.slides._sldIdLst[index].attrib['r:id']
    prs.part.drop_rel(rId)
    del prs.slides._sldIdLst[index]

# Delete the last slide
delete_slide(prs, len(prs.slides) - 1)

prs.save("/workdir/session/fewer_slides.pptx")
```

---

## Duplicating Slides

```python
from pptx import Presentation
from copy import deepcopy
from lxml import etree

def duplicate_slide(prs, slide_index):
    """Duplicate a slide and append it to the end."""
    source = prs.slides[slide_index]
    # Create a copy of the slide XML
    new_slide_xml = deepcopy(source._element)
    # Add to presentation
    new_slide_layout = source.slide_layout
    new_slide = prs.slides.add_slide(new_slide_layout)
    # Replace the new slide's XML with the copy
    for child in list(new_slide._element):
        new_slide._element.remove(child)
    for child in new_slide_xml:
        new_slide._element.append(child)
    return new_slide

prs = Presentation("/workdir/uploads/template.pptx")
duplicate_slide(prs, 0)  # Duplicate first slide
prs.save("/workdir/session/duplicated.pptx")
```

---

## Speaker Notes

```python
from pptx import Presentation

prs = Presentation("/workdir/uploads/template.pptx")
slide = prs.slides[0]

# Read notes
if slide.has_notes_slide:
    notes = slide.notes_slide.notes_text_frame.text
    print(f"Notes: {notes}")

# Add/update notes
notes_slide = slide.notes_slide
notes_slide.notes_text_frame.text = "Speaker notes for this slide"

prs.save("/workdir/session/with_notes.pptx")
```

---

## Common Pitfalls

### Template Adaptation

When source content has fewer items than the template:
- **Remove excess elements entirely** (images, shapes, text boxes), don't just clear text
- Check for orphaned visuals after clearing text content
- Run visual QA to catch mismatched counts

When replacing text with different length content:
- **Shorter replacements**: Usually safe
- **Longer replacements**: May overflow or wrap unexpectedly
- Test with visual QA after text changes

### Placeholder Text Split Across Runs

Word/PowerPoint sometimes splits placeholder text across multiple runs (e.g., `{{com` in one run and `pany}}` in another). If simple run-level replacement doesn't work:

```python
def replace_across_runs(paragraph, old_text, new_text):
    """Handle placeholders split across runs."""
    full_text = "".join(run.text for run in paragraph.runs)
    if old_text not in full_text:
        return False
    # Rebuild: put all text in first run, clear others
    new_full = full_text.replace(old_text, new_text)
    for i, run in enumerate(paragraph.runs):
        if i == 0:
            run.text = new_full
        else:
            run.text = ""
    return True
```

### Formatting Rules

- **Bold all headers and labels**: Slide titles, section headers, inline labels
- **Never use unicode bullets** (`"•"`) — use proper PowerPoint bullet formatting
- **Don't mix spacing randomly** — choose consistent gaps

---

## File Paths

- **Input templates**: `/workdir/uploads/`
- **Output files**: `/workdir/session/`
- **Working files**: `/workdir/session/`
