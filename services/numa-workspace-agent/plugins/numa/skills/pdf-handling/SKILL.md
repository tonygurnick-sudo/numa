---
name: pdf-handling
description: Create, read, and manipulate PDF files. Use when asked to generate PDFs, create reports, extract text from PDFs, merge PDF documents, read PDF content, convert to/from PDF, extract images from PDFs, or convert data to PDF format.
---

# PDF Handling Skill

Create, read, manipulate, and convert PDF files.

## Available Libraries

| Library            | Purpose                                                            | Import                                               |
| ------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- |
| **pdfplumber**     | Advanced text/table extraction with layout                         | `import pdfplumber`                                  |
| **PyMuPDF (fitz)** | Visual extraction, render pages as images, extract embedded images | `import fitz`                                        |
| **pdf2image**      | PDF pages to PIL images (uses poppler)                             | `from pdf2image import convert_from_path`            |
| **weasyprint**     | HTML-to-PDF conversion (styled reports, letters)                   | `from weasyprint import HTML`                        |
| **reportlab**      | Professional PDF creation with precise layout                      | `from reportlab.lib.pagesizes import A4`             |
| **fpdf2**          | Quick & simple PDF creation                                        | `from fpdf import FPDF`                              |
| **PyPDF2**         | Merge, split, rotate, watermark (PDF manipulation)                 | `from PyPDF2 import PdfReader, PdfWriter, PdfMerger` |

## Decision Matrix

| Need                               | Best Tool                                    | Why                                 |
| ---------------------------------- | -------------------------------------------- | ----------------------------------- |
| Styled reports, letters, documents | **WeasyPrint** (HTML→PDF)                    | Write HTML+CSS, professional output |
| Precise layout control, subscripts | **reportlab**                                | Pixel-perfect positioning           |
| Quick data tables, simple PDFs     | **fpdf2**                                    | Lightweight, fast                   |
| Read text/tables from PDFs         | **pdfplumber**                               | Best layout-aware text extraction   |
| Merge, split, rotate PDFs          | **PyPDF2**                                   | Best for manipulation operations    |
| Extract images from PDFs           | **PyMuPDF (fitz)**                           | Access embedded images directly     |
| Render pages as images             | **pdf2image** or **PyMuPDF**                 | Page-to-image conversion            |
| Scanned/complex documents          | `extract_content` tool (via `numa_tool` MCP) | Vision AI — better than local OCR   |
| Convert DOCX/PPTX → PDF            | `soffice --headless`                         | Local LibreOffice conversion        |

---

## Reading PDFs

### Primary: pdfplumber (text and tables with layout)

pdfplumber is the best tool for extracting text and tables from PDFs. It preserves layout information and provides word-level bounding boxes.

```python
import pdfplumber

with pdfplumber.open("/workdir/uploads/document.pdf") as pdf:
    # Basic text extraction
    for page in pdf.pages:
        text = page.extract_text()
        print(f"--- Page {page.page_number} ---")
        print(text)

    # Table extraction (returns list of lists)
    page = pdf.pages[0]
    tables = page.extract_tables()
    for table in tables:
        for row in table:
            print(row)

    # Word-level extraction with bounding boxes
    words = page.extract_words()
    for word in words[:10]:
        print(f"'{word['text']}' at ({word['x0']:.1f}, {word['top']:.1f})")
```

### Simple extraction: PyPDF2

PyPDF2 is simpler but less accurate for complex layouts. Use it when you just need basic text or metadata.

```python
from PyPDF2 import PdfReader

reader = PdfReader("/workdir/uploads/document.pdf")
num_pages = len(reader.pages)
print(f"PDF has {num_pages} pages")

# Extract text from all pages
for i, page in enumerate(reader.pages):
    text = page.extract_text()
    print(f"\n--- Page {i + 1} ---\n{text}")

# Get metadata
metadata = reader.metadata
if metadata:
    print(f"Title: {metadata.get('/Title', 'N/A')}")
    print(f"Author: {metadata.get('/Author', 'N/A')}")
```

---

## Visual Extraction with PyMuPDF (fitz)

PyMuPDF can render PDF pages as images and extract embedded images — essential for visual analysis.

### Render Pages as Images

```python
import fitz  # PyMuPDF

doc = fitz.open("/workdir/uploads/document.pdf")

for page_num in range(len(doc)):
    page = doc[page_num]
    # Render at 150 DPI
    pix = page.get_pixmap(dpi=150)
    pix.save(f"/workdir/outputs/page_{page_num + 1}.png")
    print(f"Saved page {page_num + 1}: {pix.width}x{pix.height}")

doc.close()
```

### Extract Embedded Images

```python
import fitz

doc = fitz.open("/workdir/uploads/document.pdf")

for page_num in range(len(doc)):
    page = doc[page_num]
    images = page.get_images(full=True)

    for img_idx, img in enumerate(images):
        xref = img[0]
        base_image = doc.extract_image(xref)
        image_bytes = base_image["image"]
        image_ext = base_image["ext"]

        output_path = f"/workdir/outputs/page{page_num + 1}_img{img_idx + 1}.{image_ext}"
        with open(output_path, "wb") as f:
            f.write(image_bytes)
        print(f"Extracted: {output_path} ({len(image_bytes)} bytes)")

doc.close()
```

### Extract Text with Layout (PyMuPDF)

```python
import fitz

doc = fitz.open("/workdir/uploads/document.pdf")
page = doc[0]

# Get text with position information
blocks = page.get_text("dict")["blocks"]
for block in blocks:
    if block["type"] == 0:  # Text block
        for line in block["lines"]:
            text = "".join(span["text"] for span in line["spans"])
            print(f"  ({line['bbox'][0]:.0f},{line['bbox'][1]:.0f}): {text}")

doc.close()
```

---

## PDF-to-Image with pdf2image

Batch convert PDF pages to images using poppler (pdftoppm).

```python
from pdf2image import convert_from_path

# Convert all pages
images = convert_from_path("/workdir/uploads/document.pdf", dpi=150)

for i, img in enumerate(images):
    output_path = f"/workdir/outputs/page_{i + 1}.png"
    img.save(output_path, "PNG")
    print(f"Saved: {output_path} ({img.width}x{img.height})")

# Convert specific pages only
images = convert_from_path(
    "/workdir/uploads/document.pdf",
    dpi=200,
    first_page=1,
    last_page=3
)
```

Or use the CLI directly:

```bash
pdftoppm -jpeg -r 150 /workdir/uploads/document.pdf /workdir/outputs/page
# Creates page-01.jpg, page-02.jpg, etc.
```

---

## Creating PDFs

### Primary: WeasyPrint (HTML-to-PDF)

WeasyPrint converts HTML+CSS to PDF with excellent results. Best for styled reports, letters, and documents.

```python
from weasyprint import HTML

# Simple HTML string
html_content = """
<html>
<head>
<style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1E2761; border-bottom: 2px solid #1E2761; padding-bottom: 10px; }
    h2 { color: #4472C4; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background-color: #4472C4; color: white; padding: 12px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid #ddd; }
    tr:nth-child(even) { background-color: #f8f9fa; }
    .highlight { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
    @page { size: A4; margin: 2cm; }
</style>
</head>
<body>
    <h1>Quarterly Report</h1>
    <p>Prepared for Acme Corp — February 2026</p>

    <div class="highlight">
        <strong>Key Finding:</strong> Revenue increased 23% year-over-year.
    </div>

    <h2>Sales Summary</h2>
    <table>
        <tr><th>Quarter</th><th>Revenue</th><th>Growth</th></tr>
        <tr><td>Q1</td><td>$1.2M</td><td>+15%</td></tr>
        <tr><td>Q2</td><td>$1.4M</td><td>+17%</td></tr>
        <tr><td>Q3</td><td>$1.5M</td><td>+7%</td></tr>
        <tr><td>Q4</td><td>$1.8M</td><td>+20%</td></tr>
    </table>
</body>
</html>
"""

HTML(string=html_content).write_pdf("/workdir/outputs/report.pdf")
print("PDF created: /workdir/outputs/report.pdf")
```

```python
# From an HTML file
HTML(filename="/workdir/outputs/report.html").write_pdf("/workdir/outputs/report.pdf")
```

**Why WeasyPrint over fpdf2:**

- Full CSS support (flexbox excluded, but floats, tables, margins, colours all work)
- Automatic page breaks
- Professional typography
- Easy to style with CSS
- Great for multi-page documents

### Multi-Page Layout Best Practices

These patterns prevent common layout bugs (content spilling to extra pages, broken footers, dead space):

**1. Use `@page` margin boxes for headers/footers** — never regular `<div>` elements in the document flow:

```css
@page {
  size: A4;
  margin: 25mm;
  @bottom-left {
    content: 'Company Name';
    font-size: 9pt;
    color: #666;
    white-space: nowrap; /* Prevents text stacking vertically */
  }
  @bottom-right {
    content: 'Page ' counter(page) ' of ' counter(pages);
    font-size: 9pt;
    color: #666;
  }
}
/* Suppress header/footer on title page */
@page :first {
  @bottom-left {
    content: none;
  }
  @bottom-right {
    content: none;
  }
}
```

**2. Avoid forced page breaks** — prefer natural flow:

- Use `page-break-inside: avoid` on atomic elements (cards, tables, callouts, stat boxes)
- Only use `page-break-before: always` for deliberate section starts (e.g., title page → body)
- Do NOT use `page-break-before: always` between content sections — it creates dead space

**3. Professional document pattern** (most reliable for multi-page):

- Generous margins: `25-30mm` all sides
- Serif fonts (Georgia, Times) for body text
- `text-align: justify` with `hyphens: auto`
- Thin horizontal rules under section headings (`border-bottom: 1px solid #ccc`)
- This style works more reliably than marketing layouts with gradients, cards, and flex rows

**4. Common pitfalls:**

- Footer text too long for margin box → add `white-space: nowrap`
- Content slightly too tall for one page → cascading overflow pushes everything to extra pages
- Tables splitting without repeated headers → keep small tables together with `page-break-inside: avoid`

### Professional Layouts: reportlab

For pixel-perfect PDF creation with precise positioning, subscripts, superscripts, and complex layouts.

```python
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

doc = SimpleDocTemplate("/workdir/outputs/professional.pdf", pagesize=A4)
styles = getSampleStyleSheet()

# Custom styles
title_style = ParagraphStyle(
    "CustomTitle",
    parent=styles["Title"],
    fontSize=24,
    textColor=HexColor("#1E2761"),
    spaceAfter=20,
)

body_style = ParagraphStyle(
    "CustomBody",
    parent=styles["Normal"],
    fontSize=11,
    leading=16,
    spaceAfter=12,
)

# Build content
story = []
story.append(Paragraph("Annual Report 2026", title_style))
story.append(Spacer(1, 12))
story.append(Paragraph("This report covers the fiscal year ending December 2025.", body_style))

# Table
data = [
    ["Department", "Budget", "Spent", "Variance"],
    ["Engineering", "$500K", "$480K", "+$20K"],
    ["Marketing", "$300K", "$310K", "-$10K"],
    ["Sales", "$200K", "$190K", "+$10K"],
]

table = Table(data, colWidths=[2*inch, 1.5*inch, 1.5*inch, 1.5*inch])
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), HexColor("#4472C4")),
    ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#FFFFFF")),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("ALIGN", (1, 0), (-1, -1), "CENTER"),
    ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CCCCCC")),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#FFFFFF"), HexColor("#F8F9FA")]),
]))

story.append(table)

# Subscripts/superscripts (reportlab strength)
story.append(Spacer(1, 20))
story.append(Paragraph('H<sub>2</sub>O and E=mc<sup>2</sup>', body_style))

doc.build(story)
print("PDF created: /workdir/outputs/professional.pdf")
```

### Quick & Simple: fpdf2

fpdf2 is still useful for quick, simple PDFs — basic tables, text, and images without complex styling.

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=16)
pdf.cell(0, 10, text="Document Title", align="C", new_x="LMARGIN", new_y="NEXT")

pdf.set_font("Helvetica", size=12)
pdf.ln(10)
pdf.multi_cell(0, 7, text="Your paragraph text goes here.")

pdf.output("/workdir/outputs/document.pdf")
print("PDF created: /workdir/outputs/document.pdf")
```

#### Tables with fpdf2

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()

headers = ["Name", "Department", "Salary"]
data = [
    ["Alice Smith", "Engineering", "$95,000"],
    ["Bob Jones", "Marketing", "$78,000"],
]

col_widths = [60, 50, 40]

# Header row
pdf.set_font("Helvetica", "B", 10)
pdf.set_fill_color(200, 200, 200)
for i, header in enumerate(headers):
    pdf.cell(col_widths[i], 10, header, border=1, fill=True, align="C")
pdf.ln()

# Data rows
pdf.set_font("Helvetica", size=10)
for row in data:
    for i, cell in enumerate(row):
        pdf.cell(col_widths[i], 10, cell, border=1, align="C")
    pdf.ln()

pdf.output("/workdir/outputs/table.pdf")
```

#### Multi-Page with Headers/Footers

```python
from fpdf import FPDF

class ReportPDF(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 12)
        self.cell(0, 10, "Company Report", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

pdf = ReportPDF()
pdf.alias_nb_pages()
for i in range(3):
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.multi_cell(0, 10, f"Content for page {i + 1}...\n" * 10)

pdf.output("/workdir/outputs/report.pdf")
```

---

## Creating PDFs from Markdown

For reports where you want professional formatting from markdown:

### Local Pandoc (preferred — fast, no Lambda call)

> **Note:** `pandoc file.md -o file.pdf` requires a LaTeX engine which is **not installed**
> (too large for the Docker image). Use the `--pdf-engine=weasyprint` flag instead.
>
> If the source document contains embedded images, add `--extract-media=/workdir/outputs/`
> to extract them so pandoc can reference them during conversion.

```bash
# Markdown → PDF via Pandoc + WeasyPrint engine
pandoc /workdir/outputs/report.md --pdf-engine=weasyprint -o /workdir/outputs/report.pdf

# With embedded images (e.g. DOCX with images → PDF)
pandoc /workdir/uploads/document.docx --pdf-engine=weasyprint --extract-media=/workdir/outputs/ -o /workdir/outputs/document.pdf

# Markdown → DOCX (works natively, no extra engine needed)
pandoc /workdir/outputs/report.md -o /workdir/outputs/report.docx
```

### MCP Tool Fallback

```
mcp__numa__numa_tool(name="convert_document", description="Converting markdown report to PDF", params={"file_path": "/workdir/outputs/report.md", "format": "pdf", "mode": "markdown"})
```

---

## Visual QA for Generated PDFs

For multi-page PDFs, always inspect at least 1-2 pages visually before delivering.

### Render to Images

```python
import fitz
doc = fitz.open("/workdir/outputs/report.pdf")
for i, page in enumerate(doc):
    page.get_pixmap(dpi=150).save(f"/workdir/outputs/page_{i+1}.png")
doc.close()
```

Or via CLI:

```bash
pdftoppm -jpeg -r 150 /workdir/outputs/report.pdf /workdir/outputs/page
```

### Visual Inspection Checklist

After rendering, read the page images and check for:

- Content spilling to unexpected extra pages
- Footer/header text wrapping or stacking vertically
- Massive dead space (half-empty pages)
- Elements cut off at page boundaries
- Tables splitting awkwardly (header on one page, rows on next)
- Text overflow outside containers

### Fix-and-Verify Loop

1. Generate PDF → Render pages to images → Inspect
2. List issues found
3. Fix CSS/layout
4. Re-render and confirm fixes
5. Repeat until clean

---

## Manipulating PDFs with PyPDF2

### Merge Multiple PDFs

```python
from PyPDF2 import PdfMerger

merger = PdfMerger()
merger.append("/workdir/uploads/document1.pdf")
merger.append("/workdir/uploads/document2.pdf")
merger.write("/workdir/outputs/merged.pdf")
merger.close()
```

### Split PDF / Extract Pages

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/uploads/document.pdf")
writer = PdfWriter()

# Extract pages 2-5 (0-indexed)
for i in range(1, min(5, len(reader.pages))):
    writer.add_page(reader.pages[i])

with open("/workdir/outputs/extracted.pdf", "wb") as f:
    writer.write(f)
```

### Rotate Pages

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/uploads/document.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.rotate(90)
    writer.add_page(page)

with open("/workdir/outputs/rotated.pdf", "wb") as f:
    writer.write(f)
```

### Add Watermark

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/uploads/document.pdf")
watermark = PdfReader("/workdir/uploads/watermark.pdf")
watermark_page = watermark.pages[0]

writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark_page)
    writer.add_page(page)

with open("/workdir/outputs/watermarked.pdf", "wb") as f:
    writer.write(f)
```

---

## Populating PDF Templates

### Fillable Forms (AcroForms)

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/uploads/form.pdf")

# Check for fillable fields
fields = reader.get_fields()
if fields:
    for name, field in fields.items():
        print(f"  {name}: {field.get('/FT', 'unknown')}")

# Fill form
writer = PdfWriter()
writer.append(reader)
writer.update_page_form_field_values(
    writer.pages[0],
    {"client_name": "Acme Corp", "invoice_number": "INV-2026-001"}
)
with open("/workdir/outputs/filled_form.pdf", "wb") as f:
    writer.write(f)
```

### Visual Overlay (Non-Fillable Templates)

```python
from fpdf import FPDF
from PyPDF2 import PdfReader, PdfWriter
import io

# Create overlay
overlay = FPDF()
overlay.add_page()
overlay.set_font("Helvetica", size=12)
overlay.set_xy(100, 150)
overlay.cell(0, 0, "Acme Corporation")

overlay_bytes = io.BytesIO()
overlay.output(overlay_bytes)
overlay_bytes.seek(0)

# Merge onto template
template = PdfReader("/workdir/uploads/template.pdf")
overlay_reader = PdfReader(overlay_bytes)
writer = PdfWriter()
page = template.pages[0]
page.merge_page(overlay_reader.pages[0])
writer.add_page(page)

with open("/workdir/outputs/filled.pdf", "wb") as f:
    writer.write(f)
```

---

## Local Conversion via LibreOffice

Convert DOCX, PPTX, XLSX to PDF locally. Both `execute_script` and the Bash tool work for `soffice` and `pandoc`. Prefer `execute_script` for inline code per system prompt convention.

```python
# DOCX → PDF (via execute_script with interpreter="bash")
import subprocess
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", "/workdir/outputs/", "/workdir/uploads/document.docx"], check=True)
```

Or as bash commands (via execute_script with interpreter="bash"):

```bash
# DOCX → PDF
soffice --headless --convert-to pdf --outdir /workdir/outputs/ /workdir/uploads/document.docx

# PPTX → PDF (useful for visual QA of presentations)
soffice --headless --convert-to pdf --outdir /workdir/outputs/ /workdir/uploads/presentation.pptx
```

---

## When to Use the extract_content Tool vs Local Tools

| Scenario                      | Recommended Tool                                              |
| ----------------------------- | ------------------------------------------------------------- |
| Text-based PDFs, simple text  | **pdfplumber** (local, fast, layout-aware)                    |
| Tables in PDFs                | **pdfplumber** (local, `extract_tables()`)                    |
| Scanned PDFs, images of text  | `extract_content` tool via `numa_tool` MCP (uses vision AI)   |
| Handwritten text, forms       | `extract_content` tool via `numa_tool` MCP                    |
| Complex layouts, multi-column | Try pdfplumber first, fall back to `extract_content` tool     |
| Large documents (>50 pages)   | `extract_content` tool via `numa_tool` MCP (handles chunking) |
| Extract embedded images       | **PyMuPDF (fitz)**                                            |
| Render pages as images        | **pdf2image** or **PyMuPDF**                                  |
| Merge/split/rotate            | **PyPDF2**                                                    |
| Create from HTML+CSS          | **WeasyPrint**                                                |
| Create with precise layout    | **reportlab**                                                 |
| Quick simple PDFs             | **fpdf2**                                                     |

**Example — Extract from scanned PDF:**

```
mcp__numa__numa_tool(name="extract_content", description="Extracting content from scanned invoice", params={"file_path": "/workdir/uploads/scanned_invoice.pdf"})
```

**When pdfplumber or PyPDF2 return empty or garbled text**, it's usually because:

- The PDF is scanned (images of text, not actual text)
- The PDF uses custom fonts without proper encoding
- The text is embedded in graphics

In these cases, switch to the `extract_content` tool (via `numa_tool` MCP) which uses vision AI to "read" the document visually.

---

## Document Conversion (PDF ↔ DOCX)

### Local Conversion (preferred)

```bash
# DOCX → PDF (local, fast)
soffice --headless --convert-to pdf --outdir /workdir/outputs/ /workdir/uploads/document.docx

# PDF → DOCX (local, variable quality)
soffice --headless --convert-to docx --outdir /workdir/outputs/ /workdir/uploads/document.pdf
```

### MCP Tool Fallback

```
# PDF → DOCX
mcp__numa__numa_tool(name="convert_document", description="Converting PDF to DOCX", params={"file_path": "/workdir/uploads/document.pdf", "format": "docx", "mode": "file"})

# DOCX → PDF
mcp__numa__numa_tool(name="convert_document", description="Converting DOCX to PDF", params={"file_path": "/workdir/uploads/document.docx", "format": "pdf", "mode": "file"})
```

---

## Best Practices

1. **Always use `/workdir/outputs/` for generated PDFs** — ensures files are synced to S3
2. **Check file exists before reading** — use `Path(path).exists()` (from `pathlib`) before opening PDFs
3. **Handle encryption** — some PDFs are password-protected; check `reader.is_encrypted`
4. **Use meaningful filenames** — include dates or identifiers in output names
5. **Close resources** — use context managers (`with`) or call `.close()` on writers/mergers
6. **Choose the right tool** — WeasyPrint for styled docs, pdfplumber for reading, PyPDF2 for manipulation

## Common Issues

| Issue                             | Solution                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Empty text extraction             | PDF may be scanned — use the `extract_content` tool (via `numa_tool` MCP) instead |
| Font not found (fpdf2)            | Use built-in fonts: Helvetica, Times, Courier                                     |
| Large file size                   | Compress images before embedding; use JPEG over PNG                               |
| WeasyPrint missing fonts          | System fonts are available; use common font families                              |
| pdfplumber table extraction fails | Try `page.extract_tables(table_settings={...})` with custom settings              |

---

## File Paths

- **Input files**: `/workdir/uploads/`
- **Output files**: `/workdir/outputs/`
- **Working files**: `/workdir/outputs/`
