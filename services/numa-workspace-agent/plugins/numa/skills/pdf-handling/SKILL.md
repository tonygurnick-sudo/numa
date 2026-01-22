---
name: pdf-handling
description: Create, read, and manipulate PDF files. Use when asked to generate PDFs, create reports, extract text from PDFs, merge PDF documents, read PDF content, or convert data to PDF format.
---

# PDF Handling Skill

Create, read, and manipulate PDF files using the fpdf2 and PyPDF2 libraries.

## Available Libraries

| Library | Purpose | Import |
|---------|---------|--------|
| **fpdf2** | Create PDFs from scratch | `from fpdf import FPDF` |
| **PyPDF2** | Read and manipulate existing PDFs | `from PyPDF2 import PdfReader, PdfWriter, PdfMerger` |

---

## Creating PDFs with fpdf2

### Basic PDF Creation

```python
from fpdf import FPDF

# Create PDF instance
pdf = FPDF()
pdf.add_page()

# Set font (built-in fonts: Helvetica, Times, Courier)
pdf.set_font("Helvetica", size=16)

# Add title
pdf.cell(0, 10, text="Document Title", align="C", new_x="LMARGIN", new_y="NEXT")

# Add body text
pdf.set_font("Helvetica", size=12)
pdf.ln(10)  # Line break
pdf.multi_cell(0, 7, text="Your paragraph text goes here. This will automatically wrap to multiple lines when it reaches the page margin.")

# Save the PDF
pdf.output("/workdir/output/document.pdf")
print("PDF created: /workdir/output/document.pdf")
```

### Adding Tables

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=10)

# Table data
headers = ["Name", "Department", "Salary"]
data = [
    ["Alice Smith", "Engineering", "$95,000"],
    ["Bob Jones", "Marketing", "$78,000"],
    ["Carol White", "Sales", "$82,000"],
]

# Column widths
col_widths = [60, 50, 40]

# Header row (bold)
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

pdf.output("/workdir/output/table.pdf")
print("Table PDF created: /workdir/output/table.pdf")
```

### Adding Images

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()

# Add image (supports PNG, JPEG, GIF)
# Parameters: file, x, y, width (height auto-calculated to maintain aspect ratio)
pdf.image("/workdir/input/logo.png", x=10, y=10, w=50)

# Add text below image
pdf.set_y(70)  # Move cursor below image
pdf.set_font("Helvetica", size=12)
pdf.cell(0, 10, text="Caption for the image above", align="C")

pdf.output("/workdir/output/with_image.pdf")
print("PDF with image created: /workdir/output/with_image.pdf")
```

### Multi-Page Document with Headers/Footers

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
pdf.alias_nb_pages()  # Enable {nb} placeholder for total pages

# Add multiple pages
for i in range(3):
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.multi_cell(0, 10, f"Content for page {i + 1}...\n" * 10)

pdf.output("/workdir/output/report.pdf")
print("Multi-page report created: /workdir/output/report.pdf")
```

### Styled Text (Bold, Italic, Colors)

```python
from fpdf import FPDF

pdf = FPDF()
pdf.add_page()

# Bold text
pdf.set_font("Helvetica", "B", 14)
pdf.cell(0, 10, "Bold Title", new_x="LMARGIN", new_y="NEXT")

# Italic text
pdf.set_font("Helvetica", "I", 12)
pdf.cell(0, 10, "Italic subtitle", new_x="LMARGIN", new_y="NEXT")

# Colored text
pdf.set_text_color(255, 0, 0)  # Red
pdf.set_font("Helvetica", size=12)
pdf.cell(0, 10, "Red warning text", new_x="LMARGIN", new_y="NEXT")

# Reset to black
pdf.set_text_color(0, 0, 0)
pdf.cell(0, 10, "Back to normal black text", new_x="LMARGIN", new_y="NEXT")

# Background fill
pdf.set_fill_color(255, 255, 0)  # Yellow background
pdf.cell(0, 10, "Highlighted text", fill=True, new_x="LMARGIN", new_y="NEXT")

pdf.output("/workdir/output/styled.pdf")
print("Styled PDF created: /workdir/output/styled.pdf")
```

---

## Reading PDFs with PyPDF2

### Extract All Text

```python
from PyPDF2 import PdfReader

reader = PdfReader("/workdir/input/document.pdf")

# Get number of pages
num_pages = len(reader.pages)
print(f"PDF has {num_pages} pages")

# Extract text from all pages
full_text = ""
for i, page in enumerate(reader.pages):
    text = page.extract_text()
    full_text += f"\n--- Page {i + 1} ---\n{text}"

print(full_text)
```

### Extract Text from Specific Pages

```python
from PyPDF2 import PdfReader

reader = PdfReader("/workdir/input/document.pdf")

# Extract from page 1 only (0-indexed)
page_text = reader.pages[0].extract_text()
print(page_text)

# Extract from pages 2-5
for i in range(1, 5):
    if i < len(reader.pages):
        print(f"\n--- Page {i + 1} ---")
        print(reader.pages[i].extract_text())
```

### Get PDF Metadata

```python
from PyPDF2 import PdfReader

reader = PdfReader("/workdir/input/document.pdf")

metadata = reader.metadata
if metadata:
    print(f"Title: {metadata.get('/Title', 'N/A')}")
    print(f"Author: {metadata.get('/Author', 'N/A')}")
    print(f"Subject: {metadata.get('/Subject', 'N/A')}")
    print(f"Creator: {metadata.get('/Creator', 'N/A')}")
    print(f"Producer: {metadata.get('/Producer', 'N/A')}")
    print(f"Creation Date: {metadata.get('/CreationDate', 'N/A')}")

print(f"Number of pages: {len(reader.pages)}")
print(f"Is encrypted: {reader.is_encrypted}")
```

---

## Manipulating PDFs with PyPDF2

### Merge Multiple PDFs

```python
from PyPDF2 import PdfMerger

merger = PdfMerger()

# Add PDFs in order
merger.append("/workdir/input/document1.pdf")
merger.append("/workdir/input/document2.pdf")
merger.append("/workdir/input/document3.pdf")

# Write merged PDF
merger.write("/workdir/output/merged.pdf")
merger.close()

print("PDFs merged: /workdir/output/merged.pdf")
```

### Merge Specific Pages

```python
from PyPDF2 import PdfMerger

merger = PdfMerger()

# Add all pages from first PDF
merger.append("/workdir/input/document1.pdf")

# Add only pages 1-3 from second PDF (0-indexed)
merger.append("/workdir/input/document2.pdf", pages=(0, 3))

# Add only page 5 from third PDF
merger.append("/workdir/input/document3.pdf", pages=(4, 5))

merger.write("/workdir/output/selective_merge.pdf")
merger.close()

print("Selective merge complete: /workdir/output/selective_merge.pdf")
```

### Split PDF into Individual Pages

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/input/document.pdf")

for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)

    output_path = f"/workdir/output/page_{i + 1}.pdf"
    with open(output_path, "wb") as output_file:
        writer.write(output_file)

    print(f"Created: {output_path}")

print(f"Split into {len(reader.pages)} files")
```

### Extract Page Range

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/input/document.pdf")
writer = PdfWriter()

# Extract pages 2-5 (0-indexed: 1-4)
start_page = 1
end_page = 5

for i in range(start_page, min(end_page, len(reader.pages))):
    writer.add_page(reader.pages[i])

with open("/workdir/output/extracted_pages.pdf", "wb") as output_file:
    writer.write(output_file)

print("Extracted pages 2-5: /workdir/output/extracted_pages.pdf")
```

### Rotate Pages

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/input/document.pdf")
writer = PdfWriter()

for page in reader.pages:
    # Rotate 90 degrees clockwise
    page.rotate(90)
    writer.add_page(page)

with open("/workdir/output/rotated.pdf", "wb") as output_file:
    writer.write(output_file)

print("Rotated PDF created: /workdir/output/rotated.pdf")
```

### Add Watermark

```python
from PyPDF2 import PdfReader, PdfWriter

# Read the main document
reader = PdfReader("/workdir/input/document.pdf")

# Read the watermark (single page PDF with transparent background)
watermark = PdfReader("/workdir/input/watermark.pdf")
watermark_page = watermark.pages[0]

writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark_page)
    writer.add_page(page)

with open("/workdir/output/watermarked.pdf", "wb") as output_file:
    writer.write(output_file)

print("Watermarked PDF created: /workdir/output/watermarked.pdf")
```

---

## Creating Data Reports

### DataFrame to PDF Table

```python
import pandas as pd
from fpdf import FPDF

# Sample DataFrame
df = pd.DataFrame({
    "Product": ["Widget A", "Widget B", "Widget C"],
    "Q1 Sales": [1200, 1500, 800],
    "Q2 Sales": [1400, 1300, 950],
    "Q3 Sales": [1100, 1600, 1100],
})

pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", "B", 16)
pdf.cell(0, 10, "Sales Report", align="C", new_x="LMARGIN", new_y="NEXT")
pdf.ln(10)

# Table header
pdf.set_font("Helvetica", "B", 10)
pdf.set_fill_color(66, 133, 244)
pdf.set_text_color(255, 255, 255)

col_width = 45
for col in df.columns:
    pdf.cell(col_width, 10, col, border=1, fill=True, align="C")
pdf.ln()

# Table data
pdf.set_font("Helvetica", size=10)
pdf.set_text_color(0, 0, 0)

for _, row in df.iterrows():
    for value in row:
        pdf.cell(col_width, 10, str(value), border=1, align="C")
    pdf.ln()

pdf.output("/workdir/output/sales_report.pdf")
print("Sales report created: /workdir/output/sales_report.pdf")
```

---

## Populating PDF Templates

### Method 1: Fillable Forms (AcroForms)

Check if the PDF has fillable fields:

```python
from PyPDF2 import PdfReader

reader = PdfReader("/workdir/uploads/template.pdf")
fields = reader.get_fields()

if fields:
    print("Fillable fields found:")
    for name, field in fields.items():
        field_type = field.get('/FT', 'unknown')
        print(f"  {name}: {field_type}")
else:
    print("No fillable fields - use visual overlay method")
```

Fill the form:

```python
from PyPDF2 import PdfReader, PdfWriter

reader = PdfReader("/workdir/uploads/form.pdf")
writer = PdfWriter()
writer.append(reader)

writer.update_page_form_field_values(
    writer.pages[0],
    {"client_name": "Acme Corp", "invoice_number": "INV-2026-001", "total_amount": "$5,250.00"}
)

with open("/workdir/output/filled_form.pdf", "wb") as f:
    writer.write(f)
```

### Method 2: Visual Overlay (Non-Fillable Templates)

For templates without form fields, create an overlay with fpdf2 and merge it onto the template:

```python
from fpdf import FPDF
from PyPDF2 import PdfReader, PdfWriter
import io

# Step 1: Create overlay with fpdf2
overlay = FPDF()
overlay.add_page()
overlay.set_font("Helvetica", size=12)

# Add text at specific positions (x, y in mm from top-left)
overlay.set_xy(100, 150)  # Adjust coordinates to match template
overlay.cell(0, 0, "Acme Corporation")

overlay.set_xy(100, 170)
overlay.cell(0, 0, "INV-2026-001")

# Convert to bytes
overlay_bytes = io.BytesIO()
overlay.output(overlay_bytes)
overlay_bytes.seek(0)

# Step 2: Merge onto template
template = PdfReader("/workdir/uploads/invoice_template.pdf")
overlay_reader = PdfReader(overlay_bytes)

writer = PdfWriter()
page = template.pages[0]
page.merge_page(overlay_reader.pages[0])
writer.add_page(page)

with open("/workdir/output/filled_invoice.pdf", "wb") as f:
    writer.write(f)
```

**Tip:** Use `extract_content.py` with vision AI to analyze the template and determine exact coordinates for text placement.

---

## Creating High-Quality PDFs from Markdown

For reports, documents, or any content where you want **professional formatting**, consider writing markdown first and then converting to PDF:

```bash
# Write your content as markdown (manually or have the agent generate it)
# Then convert to PDF with excellent formatting:
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/session/report.md" \
    --format pdf \
    --mode markdown
```

**Why this approach works well:**
- Pandoc + LibreOffice produce professional typography
- Markdown is easier to write and review than fpdf2 code
- Supports headings, lists, tables, code blocks automatically
- Great for reports, memos, documentation

**When to use each approach:**

| Need | Best Approach |
|------|---------------|
| Quick report with text/tables | Write markdown → `convert_document.py` |
| Pixel-perfect positioning | fpdf2 (manual coordinates) |
| Fill existing PDF template | PyPDF2 form fields or overlay |
| Programmatic data tables | fpdf2 or pandas → markdown |

---

## Best Practices

1. **Always use `/workdir/output/` for generated PDFs** - This ensures files are synced to S3
2. **Check file exists before reading** - Use `os.path.exists()` before opening PDFs
3. **Handle encryption** - Some PDFs are password-protected; check `reader.is_encrypted`
4. **Use meaningful filenames** - Include dates or identifiers in output names
5. **Close resources** - Use context managers (`with`) or call `.close()` on writers/mergers

## Common Issues

| Issue | Solution |
|-------|----------|
| "No /workdir/input/file.pdf" | Check the file path; list files with `ls /workdir/input/` |
| Empty text extraction | PDF may contain scanned images, not text - use `extract_content.py` instead |
| Font not found | Use built-in fonts: Helvetica, Times, Courier |
| Large file size | Compress images before embedding; use JPEG over PNG |

---

## When to Use extract_content.py vs PyPDF2

The `extract_content.py` Numa tool uses advanced OCR and vision AI to extract text from complex documents. Use it when PyPDF2 can't extract text properly.

| Scenario | Recommended Tool |
|----------|-----------------|
| Text-based PDFs, simple extraction | PyPDF2 (faster, local) |
| Scanned PDFs, images of documents | extract_content.py (uses vision AI) |
| Handwritten text, forms | extract_content.py |
| Complex layouts, tables in images | extract_content.py |
| Large documents (>50 pages) | extract_content.py (handles chunking) |
| Merging, splitting, rotating PDFs | PyPDF2 (manipulation operations) |
| Creating new PDFs from scratch | fpdf2 |

**Example - Extract from scanned PDF:**
```bash
python3 /workdir/tools/numa/extract_content.py \
    --file-path "/workdir/uploads/scanned_invoice.pdf"
```

The extracted content is saved to `/workdir/session/extracted_scanned_invoice.txt`.

**When PyPDF2 returns empty or garbled text**, it's usually because:
- The PDF is scanned (images of text, not actual text)
- The PDF uses custom fonts without proper encoding
- The text is embedded in graphics or forms

In these cases, switch to `extract_content.py` which uses vision AI to "read" the document visually.

---

## Document Conversion (PDF ↔ DOCX)

The `convert_document.py` tool supports **direct file conversion** between PDF and DOCX using LibreOffice.

### Direct Conversion (Recommended)

Use `--mode file` for direct PDF ↔ DOCX conversion:

```bash
# PDF → DOCX (direct conversion)
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.pdf" \
    --format docx \
    --mode file
# → /workdir/session/converted_document.docx

# DOCX → PDF (direct conversion)
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.docx" \
    --format pdf \
    --mode file
# → /workdir/session/converted_document.pdf
```

### convert_document.py Usage

```
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/uploads/document.pdf" \
    --format pdf|docx \
    --mode file|markdown \
    [--title "Optional Document Title"]
```

**Parameters:**
- `--file-path, -f` - Path to input file (required)
- `--format, -o` - Output format: `pdf` or `docx` (required)
- `--mode, -m` - Conversion mode (optional, default: `markdown`)
  - `file` - Direct DOCX ↔ PDF conversion using LibreOffice
  - `markdown` - Convert markdown/text to PDF/DOCX using Pandoc
- `--title, -t` - Optional document title (used for filename)

### Conversion Quality

| Conversion | Quality | Notes |
|------------|---------|-------|
| DOCX → PDF | ✅ Excellent | LibreOffice handles this very well |
| PDF → DOCX | ⚠️ Variable | PDFs are presentation format; complex layouts may not convert cleanly |
| Markdown → PDF/DOCX | ✅ Good | Works well for properly formatted markdown |

### PDF → DOCX Limitations

PDF is a **presentation format** (designed for viewing, not editing). When converting PDF → DOCX:

**Works well:**
- Simple text-based PDFs
- Basic formatting (bold, italic, headings)
- Single-column layouts

**May not work well:**
- Complex multi-column layouts
- Embedded images and graphics
- Scanned PDFs (need OCR first - use `extract_content.py`)
- Forms with fillable fields
- Documents with precise positioning

### Alternative: Extract + Convert (for complex PDFs)

For complex or scanned PDFs, use the two-step approach:

```bash
# Step 1: Extract content using vision AI
python3 /workdir/tools/numa/extract_content.py \
    --file-path "/workdir/uploads/scanned_document.pdf"
# → /workdir/session/extracted_scanned_document.txt

# Step 2: Convert extracted markdown to DOCX
python3 /workdir/tools/numa/convert_document.py \
    --file-path "/workdir/session/extracted_scanned_document.txt" \
    --format docx \
    --mode markdown
# → /workdir/session/converted_scanned_document.docx
```

This approach uses vision AI to "read" the document, which works better for:
- Scanned documents
- PDFs with images of text
- Complex layouts where direct conversion fails
