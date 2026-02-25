---
name: docx-handling
description: Create, read, fill Word document templates, and add images. Use when asked to generate DOCX files, fill templates, add images/logos/letterheads, populate forms, extract text from Word documents, or modify existing DOCX files.
---

# DOCX Handling Skill

Create, read, and manipulate Word documents using the `python-docx` library.

## Quick Reference

```python
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

# Load existing document
doc = Document('/workdir/uploads/template.docx')

# Create new document
doc = Document()

# Save document
doc.save('/workdir/output/result.docx')
```

---

## Understanding Word Document Structure

Before working with DOCX files, understand their architecture:

| Component | What It Is | How to Access |
|-----------|------------|---------------|
| **Document** | The entire file | `doc = Document(path)` |
| **Paragraphs** | Text blocks | `doc.paragraphs` |
| **Tables** | Grid layouts | `doc.tables` |
| **Rows/Cells** | Table contents | `table.rows[i].cells[j]` |
| **Runs** | Formatted text spans | `paragraph.runs` |
| **Sections** | Page layout areas | `doc.sections` |

**Key insight**: Word documents are ZIP archives containing XML. Tables are often the primary layout mechanism for structured content like invoices, forms, and reports.

---

## Creating DOCX Files

### Basic Document Creation

```python
from docx import Document
from docx.shared import Pt, Inches

doc = Document()

# Add heading
doc.add_heading('Document Title', level=0)

# Add paragraph
doc.add_paragraph('This is a paragraph of text.')

# Add paragraph with styling
p = doc.add_paragraph()
run = p.add_run('Bold text')
run.bold = True
p.add_run(' followed by normal text.')

# Save
doc.save('/workdir/output/new_document.docx')
print("Created: /workdir/output/new_document.docx")
```

### Adding Tables

```python
from docx import Document

doc = Document()

# Create table with 3 rows and 4 columns
table = doc.add_table(rows=3, cols=4)
table.style = 'Table Grid'

# Fill header row
headers = ['Name', 'Department', 'Role', 'Salary']
for i, header in enumerate(headers):
    table.rows[0].cells[i].text = header

# Fill data rows
data = [
    ['Alice', 'Engineering', 'Developer', '$95,000'],
    ['Bob', 'Marketing', 'Manager', '$85,000'],
]
for row_idx, row_data in enumerate(data, start=1):
    for col_idx, value in enumerate(row_data):
        table.rows[row_idx].cells[col_idx].text = value

doc.save('/workdir/output/with_table.docx')
```

### Text Styling

```python
from docx import Document
from docx.shared import Pt, RGBColor

doc = Document()
p = doc.add_paragraph()

# Bold
run = p.add_run('Bold ')
run.bold = True

# Italic
run = p.add_run('Italic ')
run.italic = True

# Font size
run = p.add_run('Large ')
run.font.size = Pt(18)

# Font color
run = p.add_run('Colored')
run.font.color.rgb = RGBColor(255, 0, 0)  # Red

doc.save('/workdir/output/styled.docx')
```

### Adding Images

Insert images into documents using `add_picture()`. Images can be placed directly in the document, in table cells (useful for letterheads/logos), or within paragraphs.

```python
from docx import Document
from docx.shared import Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

# Basic image insertion
doc.add_picture('/workdir/uploads/image.png', width=Inches(4))

# Add image with size constraints
# Width-constrained (height scales proportionally)
doc.add_picture('/workdir/uploads/chart.png', width=Inches(6))
# Height-constrained
doc.add_picture('/workdir/uploads/logo.png', height=Cm(3))

# Centered image
paragraph = doc.add_paragraph()
paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = paragraph.add_run()
run.add_picture('/workdir/uploads/banner.png', width=Inches(5))

# Image in table cell (letterheads, logos)
table = doc.add_table(rows=1, cols=2)
cell = table.rows[0].cells[0]
paragraph = cell.paragraphs[0]
run = paragraph.add_run()
run.add_picture('/workdir/uploads/logo.png', width=Inches(1.5))

doc.save('/workdir/output/with_images.docx')
```

**Common image use cases:**

| Use Case | Technique |
|----------|-----------|
| Company letterhead | Image in table cell at document start |
| Report charts | `doc.add_picture()` after relevant section |
| Signature images | Small image in table cell |
| Centered banners | Paragraph alignment + `run.add_picture()` |

---

## Reading DOCX Files

### Quick Text Extraction with markitdown

The fastest way to extract text content from a DOCX file:

```bash
python -m markitdown /workdir/uploads/document.docx
```

This outputs the document content as markdown — great for quick review or processing.

### Extract All Text with python-docx

```python
from docx import Document

doc = Document('/workdir/uploads/document.docx')

# Get all paragraph text
for para in doc.paragraphs:
    print(para.text)

# Get all table content
for table in doc.tables:
    for row in table.rows:
        row_text = [cell.text for cell in row.cells]
        print(' | '.join(row_text))
```

### Analyse Document Structure

```python
from docx import Document

doc = Document('/workdir/uploads/document.docx')

print(f"Paragraphs: {len(doc.paragraphs)}")
print(f"Tables: {len(doc.tables)}")

for i, table in enumerate(doc.tables):
    print(f"Table {i}: {len(table.rows)} rows x {len(table.columns)} cols")
```

---

## Filling Templates (Main Focus)

This is where most DOCX work happens. The goal is to take an existing template and populate it with data while preserving formatting and layout.

### Philosophy

Templates indicate "fill here" in many different ways. Don't assume a specific syntax. Instead:
1. **Analyze the template** to understand its structure
2. **Identify where content goes** by looking at the template's cues
3. **Choose the right technique** for each type of content
4. **Preserve what matters** (formatting, layout, branding)
5. **Handle pagination** when adding substantial content
6. **Validate the result** before delivering

### Step 1: Analyze the Template First

Before modifying anything, understand what you're working with:

```python
from docx import Document

def analyze_template(doc_path):
    """Understand the template before filling it."""
    doc = Document(doc_path)

    analysis = {
        'paragraphs': len(doc.paragraphs),
        'tables': len(doc.tables),
        'table_structure': [],
        'potential_placeholders': [],
        'empty_cells': 0
    }

    # Analyze tables
    for i, table in enumerate(doc.tables):
        analysis['table_structure'].append({
            'index': i,
            'rows': len(table.rows),
            'cols': len(table.columns)
        })

        # Look for content insertion points
        for row_idx, row in enumerate(table.rows):
            for col_idx, cell in enumerate(row.cells):
                text = cell.text.strip()

                # Empty cells might be data slots
                if not text:
                    analysis['empty_cells'] += 1

                # Look for placeholder patterns (various styles)
                if any(c in text for c in '<>[]{}'):
                    analysis['potential_placeholders'].append({
                        'table': i, 'row': row_idx, 'col': col_idx, 'text': text
                    })

    return analysis

# Use it
analysis = analyze_template('/workdir/uploads/template.docx')
print(f"Tables: {analysis['tables']}")
print(f"Empty cells (potential data slots): {analysis['empty_cells']}")
print(f"Potential placeholders: {len(analysis['potential_placeholders'])}")
```

**Questions to answer during analysis:**
- What type of document is this? (invoice, contract, letter, form, report)
- Is it table-heavy or paragraph-heavy?
- Where does content need to go?
- What's the capacity? (how many line items, how much text fits)
- Where are critical sections that must stay intact? (signatures, totals, legal text)

### Step 2: Identify Content Insertion Points

Templates signal "fill here" in various ways:

| Signal Type | Examples | How to Detect |
|-------------|----------|---------------|
| Placeholder text | `<Name>`, `[Company]`, `{{date}}`, `ENTER NAME HERE` | Look for brackets, braces, or ALL CAPS instructions |
| Empty cells/rows | Blank table cells | Check `cell.text.strip() == ''` |
| Instructions | "Add paragraph here", "Insert below" | Search for instructional text |
| Formatting cues | Underlined blanks, highlighted areas | Check run formatting properties |
| Structural patterns | Repeated row structures | Identify repeating table row patterns |

**Key principle**: Look for what the template is telling you. Don't assume a specific syntax.

### Step 3: Choose the Right Technique

| Content Type | Best Technique | Example Use |
|--------------|----------------|-------------|
| Simple field replacement | Text replace in cell/paragraph | Name, date, invoice number |
| Repeated/list items | Iterate through rows, fill cells | Line items, table entries |
| Long text blocks | Add paragraphs or set cell text | Descriptions, notes, contract clauses |
| Calculated values | Compute then insert | Totals, taxes, percentages |

### Step 4: Filling Techniques

#### Simple Text Replacement

```python
from docx import Document

doc = Document('/workdir/uploads/template.docx')

# Define replacements (flexible - works with any placeholder style)
replacements = {
    '<Company Name>': 'Arcanum Solutions',
    '[DATE]': '2025-01-15',
    '{{client}}': 'TechCorp Industries',
    'ENTER_NAME': 'John Smith',
}

# Replace in paragraphs
for para in doc.paragraphs:
    for old_text, new_text in replacements.items():
        if old_text in para.text:
            # Simple replacement (may lose some formatting)
            para.text = para.text.replace(old_text, new_text)

# Replace in table cells
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            for old_text, new_text in replacements.items():
                if old_text in cell.text:
                    cell.text = cell.text.replace(old_text, new_text)

doc.save('/workdir/output/filled.docx')
```

#### Preserving Formatting During Replacement

When formatting matters, work at the run level:

```python
from docx import Document

def replace_preserving_format(doc, old_text, new_text):
    """Replace text while keeping the original formatting."""

    # In paragraphs
    for para in doc.paragraphs:
        for run in para.runs:
            if old_text in run.text:
                run.text = run.text.replace(old_text, new_text)

    # In table cells
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for run in para.runs:
                        if old_text in run.text:
                            run.text = run.text.replace(old_text, new_text)

doc = Document('/workdir/uploads/template.docx')
replace_preserving_format(doc, '<Name>', 'Jane Doe')
doc.save('/workdir/output/formatted.docx')
```

#### Filling Table Rows with Data

```python
from docx import Document

doc = Document('/workdir/uploads/invoice_template.docx')

# Line item data
line_items = [
    {'description': 'Consulting Services', 'qty': 10, 'rate': 150, 'total': 1500},
    {'description': 'Software License', 'qty': 1, 'rate': 500, 'total': 500},
    {'description': 'Training Session', 'qty': 2, 'rate': 200, 'total': 400},
]

# Find the line items table (adjust index based on your template)
table = doc.tables[0]

# Determine where line items start (by analyzing the template)
# This is template-specific - you need to identify the right rows
item_start_row = 5  # Example: items start at row 5

for i, item in enumerate(line_items):
    row_idx = item_start_row + i

    # Safety check - don't exceed table bounds
    if row_idx >= len(table.rows):
        print(f"Warning: Not enough rows for all items")
        break

    row = table.rows[row_idx]

    # Fill cells (column indices depend on your template layout)
    row.cells[0].text = item['description']
    row.cells[1].text = str(item['qty'])
    row.cells[2].text = f"${item['rate']:.2f}"
    row.cells[3].text = f"${item['total']:.2f}"

doc.save('/workdir/output/invoice_filled.docx')
```

#### Adding Paragraphs at Specific Locations

```python
from docx import Document

doc = Document('/workdir/uploads/template.docx')

# Add paragraph at end of document
doc.add_paragraph('New paragraph at the end.')

# Add paragraph to a specific table cell
table = doc.tables[0]
cell = table.rows[2].cells[1]
cell.add_paragraph('Additional content in this cell.')

# Insert paragraph with specific styling
from docx.shared import Pt
p = doc.add_paragraph()
run = p.add_run('Important note: ')
run.bold = True
p.add_run('This is additional context.')

doc.save('/workdir/output/with_paragraphs.docx')
```

### Step 5: Handle Pagination

Adding content increases document height and can cause page breaks in unwanted places.

**Critical sections that must stay together:**
- Signature blocks
- Totals and summaries
- Legal disclaimers
- Headers with their associated content

**Strategies when content exceeds template capacity:**

| Strategy | When to Use | How to Implement |
|----------|-------------|------------------|
| **Reduce** | Too many items to fit | Summarize or truncate; show top items + "and X more" |
| **Compress** | Slightly over capacity | Reduce font sizes or row heights slightly |
| **Split** | Much more content than fits | Add intentional page breaks before critical sections |

```python
from docx.shared import Pt
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

def keep_table_on_page(table):
    """Attempt to keep a table from splitting across pages."""
    tblPr = table._tbl.tblPr
    if tblPr is None:
        tblPr = OxmlElement('w:tblPr')
        table._tbl.insert(0, tblPr)

    # Add keep-with-next equivalent for tables
    cantSplit = OxmlElement('w:cantSplit')
    tblPr.append(cantSplit)

def control_row_height(row, height_pt=20):
    """Control row height to prevent excessive expansion."""
    tr = row._tr
    trPr = tr.get_or_add_trPr()
    trHeight = OxmlElement('w:trHeight')
    trHeight.set(qn('w:val'), str(int(height_pt * 20)))  # Twips
    trHeight.set(qn('w:hRule'), 'exact')
    trPr.append(trHeight)
```

### Step 6: Validate Results

Always verify the output before delivering:

```python
from docx import Document

def validate_filled_document(doc_path, expected_values):
    """Check that the document was filled correctly."""
    doc = Document(doc_path)

    results = {
        'readable': True,
        'values_found': [],
        'values_missing': [],
    }

    # Collect all text
    all_text = ''
    for para in doc.paragraphs:
        all_text += para.text + '\n'
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                all_text += cell.text + '\n'

    # Check for expected values
    for value in expected_values:
        if value in all_text:
            results['values_found'].append(value)
        else:
            results['values_missing'].append(value)

    return results

# Example usage
result = validate_filled_document(
    '/workdir/output/invoice.docx',
    ['Arcanum Solutions', '$1,500.00', 'John Smith']
)
print(f"Found: {result['values_found']}")
print(f"Missing: {result['values_missing']}")
```

---

## Creating High-Quality DOCX from Markdown

For reports and documents where you want **clean formatting without manual python-docx code**, write markdown and convert with Pandoc.

### Local Pandoc (preferred — fast, no Lambda call)

```bash
# Markdown → DOCX (local, instant)
pandoc /workdir/session/report.md -o /workdir/output/report.docx

# With a reference doc for styling
pandoc /workdir/session/report.md -o /workdir/output/report.docx --reference-doc=/workdir/uploads/template.docx
```

### Lambda Fallback

```bash
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/session/report.md" \
    --format docx \
    --mode markdown
```

**Why this approach works well:**
- Pandoc produces clean, well-structured DOCX files
- Markdown is easier to write and review than python-docx code
- Supports headings, lists, tables, code blocks automatically
- Great for reports, memos, documentation

**When to use each approach:**

| Need | Best Approach |
|------|---------------|
| Quick report with text/tables | Write markdown → `pandoc` (local) |
| Fill existing DOCX template | python-docx (this skill) |
| Complex formatting/styling | python-docx (this skill) |
| Programmatic data insertion | python-docx (this skill) |

---

## Best Practices

1. **Analyze first** - Always examine the template structure before modifying
2. **Work incrementally** - Fill one section, verify, then continue
3. **Respect capacity** - Templates have limits; don't overfill
4. **Preserve formatting** - Use run-level replacement when styling matters
5. **Handle edge cases** - Plan for empty data, missing fields, overflow
6. **Validate outputs** - Always check the result can be opened and looks correct
7. **Save to new files** - Don't overwrite the original template

---

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Text replacement didn't work | Placeholder split across runs (e.g., Word formatted `<pla` and `ceholder>` separately) | Use run-level iteration and join text, or rebuild the paragraph |
| Lost formatting after replacement | Used `cell.text =` which clears formatting | Use run-level replacement to preserve styles |
| Content split across pages | Added too much content | Use pagination strategies: reduce, compress, or add page breaks |
| Signature block on wrong page | Content pushed it to page 2 | Reduce earlier content or add explicit page break before signature |
| Table cells overflow | Text too long for column | Truncate text or allow cell to wrap (default behavior) |
| Document won't open | Corrupted XML during manipulation | Save to new file; check for invalid characters |
| Wrong data in wrong cells | Hardcoded row/column indices that don't match template | Re-analyze template structure; use content-based detection |

---

## Document Conversion (PDF ↔ DOCX)

### Local Conversion (preferred — fast, no Lambda call)

```bash
# DOCX → PDF (local, excellent quality)
soffice --headless --convert-to pdf --outdir /workdir/output/ /workdir/uploads/document.docx

# PDF → DOCX (local, variable quality)
soffice --headless --convert-to docx --outdir /workdir/output/ /workdir/uploads/document.pdf

# Markdown → DOCX (local, instant)
pandoc /workdir/session/report.md -o /workdir/output/report.docx
```

### Lambda Fallback

Use `convert_document.py` when local tools aren't sufficient:

```bash
# DOCX → PDF
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.docx" \
    --format pdf --mode file

# PDF → DOCX
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.pdf" \
    --format docx --mode file

# Markdown → DOCX
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/session/report.md" \
    --format docx --mode markdown
```

### Conversion Quality

| Conversion | Quality | Notes |
|------------|---------|-------|
| DOCX → PDF | Excellent | LibreOffice handles this very well |
| PDF → DOCX | Variable | PDFs are presentation format; complex layouts may not convert cleanly |
| Markdown → DOCX | Good | Works well for properly formatted markdown |

### When to Use python-docx vs. Conversion Tools

| Scenario | Recommended Approach |
|----------|---------------------|
| Creating new DOCX from scratch | python-docx (this skill) |
| Filling DOCX templates | python-docx (this skill) |
| Modifying existing DOCX | python-docx (this skill) |
| Converting DOCX → PDF | `soffice --headless` (local) |
| Converting Markdown → DOCX | `pandoc` (local) |
| Complex/scanned PDFs | `extract_content.py` + `pandoc` |

### Alternative: Extract + Convert (for complex PDFs)

For scanned or complex PDFs where direct conversion fails:

```bash
# Step 1: Extract content using vision AI
python3 /workdir/tools/numa/extract_content.py \
    --file-path "/workdir/uploads/scanned_document.pdf"

# Step 2: Convert extracted text to DOCX (local pandoc)
pandoc /workdir/session/extracted_scanned_document.txt -o /workdir/output/document.docx
```

---

## File Paths

- **Input templates**: `/workdir/uploads/`
- **Output documents**: `/workdir/output/`
- **Working files**: `/workdir/session/`

Always use full paths and verify files exist before processing.
