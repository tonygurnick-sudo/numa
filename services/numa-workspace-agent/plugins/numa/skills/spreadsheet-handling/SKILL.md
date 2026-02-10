---
name: spreadsheet-handling
description: "Read, write, and analyze spreadsheet files (Excel, CSV, TSV). Use when working with .xlsx, .xls, .xlsm, .csv, .tsv files, data analysis, pivot tables, or format conversion."
---

# Spreadsheet Handling Skill

Read, write, and analyze spreadsheet files using pandas, openpyxl, and XlsxWriter.

## Available Libraries

| Library | Purpose | Import |
|---------|---------|--------|
| **pandas** | Read/write Excel, CSV, TSV; data analysis | `import pandas as pd` |
| **openpyxl** | Read/write .xlsx files; cell formatting | `from openpyxl import load_workbook, Workbook` |
| **xlrd** | Read legacy .xls files | `engine='xlrd'` in pandas |
| **XlsxWriter** | Create Excel files with advanced formatting | `import xlsxwriter` |

---

## Reading Spreadsheets with pandas

### Read Excel Files

```python
import pandas as pd

# Read the first sheet
df = pd.read_excel('/workdir/uploads/data.xlsx')

# Read a specific sheet by name
df = pd.read_excel('/workdir/uploads/data.xlsx', sheet_name='Sales')

# Read a specific sheet by index (0-based)
df = pd.read_excel('/workdir/uploads/data.xlsx', sheet_name=0)

# Read all sheets into a dictionary
all_sheets = pd.read_excel('/workdir/uploads/data.xlsx', sheet_name=None)
for name, sheet_df in all_sheets.items():
    print(f"Sheet: {name}, Rows: {len(sheet_df)}")

# Read with specific columns
df = pd.read_excel('/workdir/uploads/data.xlsx', usecols=['Name', 'Amount', 'Date'])

# Skip header rows
df = pd.read_excel('/workdir/uploads/data.xlsx', skiprows=2)

# Read specific rows
df = pd.read_excel('/workdir/uploads/data.xlsx', nrows=100)  # First 100 rows

# Read legacy .xls files (requires xlrd engine)
df = pd.read_excel('/workdir/uploads/legacy.xls', engine='xlrd')
```

### Read CSV Files

```python
import pandas as pd

# Basic CSV read
df = pd.read_csv('/workdir/uploads/data.csv')

# With specific encoding
df = pd.read_csv('/workdir/uploads/data.csv', encoding='utf-8')
df = pd.read_csv('/workdir/uploads/data.csv', encoding='latin-1')

# With different delimiter
df = pd.read_csv('/workdir/uploads/data.csv', delimiter=';')

# Handle dates
df = pd.read_csv('/workdir/uploads/data.csv', parse_dates=['date_column'])

# Handle missing values
df = pd.read_csv('/workdir/uploads/data.csv', na_values=['N/A', 'NA', ''])
```

### Read TSV Files

```python
import pandas as pd

# TSV (tab-separated)
df = pd.read_csv('/workdir/uploads/data.tsv', sep='\t')

# Or use read_table
df = pd.read_table('/workdir/uploads/data.tsv')
```

### Inspect Data

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/data.xlsx')

# Basic info
print(f"Shape: {df.shape}")  # (rows, columns)
print(f"Columns: {list(df.columns)}")
print(f"Data types:\n{df.dtypes}")

# Preview data
print(df.head())  # First 5 rows
print(df.tail())  # Last 5 rows
print(df.sample(5))  # Random 5 rows

# Statistics
print(df.describe())  # Numeric column stats
print(df.info())  # Memory usage and dtypes
```

---

## Writing Spreadsheets with pandas

### Write Excel Files

```python
import pandas as pd

df = pd.DataFrame({
    'Name': ['Alice', 'Bob', 'Carol'],
    'Department': ['Engineering', 'Marketing', 'Sales'],
    'Salary': [95000, 78000, 82000]
})

# Basic write
df.to_excel('/workdir/output/report.xlsx', index=False)

# With sheet name
df.to_excel('/workdir/output/report.xlsx', sheet_name='Employees', index=False)

# Multiple sheets
with pd.ExcelWriter('/workdir/output/report.xlsx') as writer:
    df.to_excel(writer, sheet_name='Employees', index=False)
    summary_df.to_excel(writer, sheet_name='Summary', index=False)

print("Excel file created: /workdir/output/report.xlsx")
```

### Write CSV Files

```python
import pandas as pd

df = pd.DataFrame({
    'Name': ['Alice', 'Bob', 'Carol'],
    'Amount': [1500.50, 2300.75, 1800.00]
})

# Basic CSV
df.to_csv('/workdir/output/data.csv', index=False)

# With specific encoding
df.to_csv('/workdir/output/data.csv', index=False, encoding='utf-8-sig')

# TSV output
df.to_csv('/workdir/output/data.tsv', index=False, sep='\t')

print("CSV file created: /workdir/output/data.csv")
```

---

## Data Analysis with pandas

### Filtering and Selection

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/sales.xlsx')

# Filter rows
high_sales = df[df['Amount'] > 1000]
engineering = df[df['Department'] == 'Engineering']

# Multiple conditions
filtered = df[(df['Amount'] > 1000) & (df['Status'] == 'Complete')]

# Select columns
subset = df[['Name', 'Amount', 'Date']]

# Query syntax (more readable)
result = df.query('Amount > 1000 and Status == "Complete"')
```

### Grouping and Aggregation

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/sales.xlsx')

# Group by single column
by_dept = df.groupby('Department')['Amount'].sum()
print(by_dept)

# Group by multiple columns
by_dept_month = df.groupby(['Department', 'Month'])['Amount'].agg(['sum', 'mean', 'count'])
print(by_dept_month)

# Multiple aggregations
summary = df.groupby('Department').agg({
    'Amount': ['sum', 'mean', 'max'],
    'Quantity': 'sum',
    'Order_ID': 'count'
})
```

### Pivot Tables

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/sales.xlsx')

# Basic pivot table
pivot = pd.pivot_table(
    df,
    values='Amount',
    index='Department',
    columns='Quarter',
    aggfunc='sum',
    fill_value=0
)

# Multiple values and aggregations
pivot = pd.pivot_table(
    df,
    values=['Amount', 'Quantity'],
    index=['Region', 'Department'],
    columns='Quarter',
    aggfunc={'Amount': 'sum', 'Quantity': 'mean'},
    margins=True  # Add totals
)

# Save pivot table
pivot.to_excel('/workdir/output/pivot_report.xlsx')
```

### Sorting and Ranking

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/data.xlsx')

# Sort by single column
df_sorted = df.sort_values('Amount', ascending=False)

# Sort by multiple columns
df_sorted = df.sort_values(['Department', 'Amount'], ascending=[True, False])

# Add rank column
df['Rank'] = df['Amount'].rank(ascending=False)

# Top N
top_10 = df.nlargest(10, 'Amount')
```

---

## Advanced Excel with openpyxl

### Read with Formatting Info

```python
from openpyxl import load_workbook

wb = load_workbook('/workdir/uploads/report.xlsx')
ws = wb.active

# Access cell values
print(ws['A1'].value)
print(ws.cell(row=1, column=1).value)

# Iterate rows
for row in ws.iter_rows(min_row=2, max_row=10, values_only=True):
    print(row)

# Get sheet names
print(wb.sheetnames)

# Access specific sheet
sheet = wb['Sales Data']
```

### Create Formatted Excel

```python
from openpyxl import Workbook
from openpyxl.styles import Font, Fill, PatternFill, Border, Side, Alignment
from openpyxl.utils.dataframe import dataframe_to_rows
import pandas as pd

wb = Workbook()
ws = wb.active
ws.title = "Report"

# Add header with styling
headers = ['Name', 'Department', 'Salary']
header_font = Font(bold=True, color='FFFFFF')
header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')

for col, header in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal='center')

# Add data
data = [
    ['Alice', 'Engineering', 95000],
    ['Bob', 'Marketing', 78000],
    ['Carol', 'Sales', 82000],
]

for row_idx, row_data in enumerate(data, 2):
    for col_idx, value in enumerate(row_data, 1):
        ws.cell(row=row_idx, column=col_idx, value=value)

# Adjust column widths
ws.column_dimensions['A'].width = 15
ws.column_dimensions['B'].width = 15
ws.column_dimensions['C'].width = 12

# Format currency column
for row in range(2, len(data) + 2):
    ws.cell(row=row, column=3).number_format = '$#,##0'

wb.save('/workdir/output/formatted_report.xlsx')
print("Formatted Excel created: /workdir/output/formatted_report.xlsx")
```

### Modify Existing Excel

```python
from openpyxl import load_workbook

wb = load_workbook('/workdir/uploads/template.xlsx')
ws = wb.active

# Update specific cells
ws['B2'] = 'New Value'
ws['C5'] = 1500.50

# Add a new row
ws.append(['New Item', 'Category', 250])

# Insert row
ws.insert_rows(5)

# Delete row
ws.delete_rows(10)

wb.save('/workdir/output/modified.xlsx')
print("Modified Excel saved: /workdir/output/modified.xlsx")
```

---

## Professional Reports with XlsxWriter

### Create Report with Charts

```python
import xlsxwriter
import pandas as pd

# Create workbook
workbook = xlsxwriter.Workbook('/workdir/output/sales_report.xlsx')
worksheet = workbook.add_worksheet('Sales Data')

# Define formats
header_format = workbook.add_format({
    'bold': True,
    'font_color': 'white',
    'bg_color': '#4472C4',
    'border': 1,
    'align': 'center'
})

currency_format = workbook.add_format({
    'num_format': '$#,##0.00',
    'border': 1
})

# Data
headers = ['Product', 'Q1', 'Q2', 'Q3', 'Q4']
data = [
    ['Widget A', 1200, 1400, 1100, 1300],
    ['Widget B', 1500, 1300, 1600, 1450],
    ['Widget C', 800, 950, 1100, 1200],
]

# Write headers
for col, header in enumerate(headers):
    worksheet.write(0, col, header, header_format)

# Write data
for row_idx, row_data in enumerate(data, 1):
    worksheet.write(row_idx, 0, row_data[0])
    for col_idx, value in enumerate(row_data[1:], 1):
        worksheet.write(row_idx, col_idx, value, currency_format)

# Add chart
chart = workbook.add_chart({'type': 'column'})

for row in range(1, len(data) + 1):
    chart.add_series({
        'name': ['Sales Data', row, 0],
        'categories': ['Sales Data', 0, 1, 0, 4],
        'values': ['Sales Data', row, 1, row, 4],
    })

chart.set_title({'name': 'Quarterly Sales'})
chart.set_x_axis({'name': 'Quarter'})
chart.set_y_axis({'name': 'Revenue ($)'})

worksheet.insert_chart('G2', chart, {'x_scale': 1.5, 'y_scale': 1.5})

# Set column widths
worksheet.set_column('A:A', 12)
worksheet.set_column('B:E', 10)

workbook.close()
print("Sales report with chart created: /workdir/output/sales_report.xlsx")
```

### Conditional Formatting

```python
import xlsxwriter

workbook = xlsxwriter.Workbook('/workdir/output/conditional.xlsx')
worksheet = workbook.add_worksheet()

# Sample data
data = [85, 92, 78, 65, 95, 88, 72, 90, 68, 82]

# Write data
for row, value in enumerate(data):
    worksheet.write(row, 0, value)

# Conditional formatting: highlight values > 85
worksheet.conditional_format('A1:A10', {
    'type': 'cell',
    'criteria': '>',
    'value': 85,
    'format': workbook.add_format({'bg_color': '#C6EFCE', 'font_color': '#006100'})
})

# Conditional formatting: highlight values < 70
worksheet.conditional_format('A1:A10', {
    'type': 'cell',
    'criteria': '<',
    'value': 70,
    'format': workbook.add_format({'bg_color': '#FFC7CE', 'font_color': '#9C0006'})
})

# Data bars
worksheet.conditional_format('A1:A10', {
    'type': 'data_bar',
    'bar_color': '#4472C4'
})

workbook.close()
print("Conditional formatting example: /workdir/output/conditional.xlsx")
```

### Data Validation (Dropdowns)

```python
import xlsxwriter

workbook = xlsxwriter.Workbook('/workdir/output/with_validation.xlsx')
worksheet = workbook.add_worksheet()

# Add dropdown list validation
worksheet.data_validation('B2:B100', {
    'validate': 'list',
    'source': ['Yes', 'No', 'Maybe']
})

# Add header
worksheet.write('A1', 'Item')
worksheet.write('B1', 'Approved')

workbook.close()
print("Created with dropdown: /workdir/output/with_validation.xlsx")
```

---

## Format Conversion

### Excel to CSV

```python
import pandas as pd

# Read Excel
df = pd.read_excel('/workdir/uploads/data.xlsx')

# Write CSV
df.to_csv('/workdir/output/data.csv', index=False)

print("Converted to CSV: /workdir/output/data.csv")
```

### CSV to Excel

```python
import pandas as pd

# Read CSV
df = pd.read_csv('/workdir/uploads/data.csv')

# Write Excel
df.to_excel('/workdir/output/data.xlsx', index=False)

print("Converted to Excel: /workdir/output/data.xlsx")
```

### Multiple CSVs to Single Excel

```python
import pandas as pd
import glob

# Find all CSV files
csv_files = glob.glob('/workdir/uploads/*.csv')

with pd.ExcelWriter('/workdir/output/combined.xlsx') as writer:
    for csv_file in csv_files:
        df = pd.read_csv(csv_file)
        # Use filename (without extension) as sheet name
        sheet_name = csv_file.split('/')[-1].replace('.csv', '')[:31]  # Excel limit: 31 chars
        df.to_excel(writer, sheet_name=sheet_name, index=False)

print(f"Combined {len(csv_files)} CSV files into: /workdir/output/combined.xlsx")
```

### Excel Sheets to Separate CSVs

```python
import pandas as pd

# Read all sheets
sheets = pd.read_excel('/workdir/uploads/workbook.xlsx', sheet_name=None)

for sheet_name, df in sheets.items():
    output_path = f'/workdir/output/{sheet_name}.csv'
    df.to_csv(output_path, index=False)
    print(f"Created: {output_path}")
```

---

## Working with Large Files

### Decision Tree

```
Is your file > 50MB?
├── YES → Convert to SQLite first (100-180x faster queries)
└── NO  → Use pandas directly (examples above)
```

**Key insight:** For large spreadsheets, converting to SQLite provides **100-180x query speedups** (0.3s vs 45-60s per query). This should be your default approach for any file over 50MB.

### SQLite Conversion (Recommended for Large Files)

```python
import pandas as pd
import sqlite3
import os

# 1. Sample first to understand the data
df_sample = pd.read_csv('/workdir/uploads/large_data.csv', nrows=1000)
print(f"Columns: {list(df_sample.columns)}")
print(f"Data types:\n{df_sample.dtypes}")
print(f"Sample:\n{df_sample.head()}")

# 2. Load and convert to SQLite
df = pd.read_csv('/workdir/uploads/large_data.csv')
print(f"Loaded {len(df):,} rows, {len(df.columns)} columns")

db_path = '/workdir/session/analysis.db'
conn = sqlite3.connect(db_path)
df.to_sql('data', conn, index=False, if_exists='replace')
print(f"Converted to SQLite: {os.path.getsize(db_path) / 1024 / 1024:.1f} MB")

# 3. Create indexes on columns you'll filter/group by (makes queries fast)
conn.execute('CREATE INDEX IF NOT EXISTS idx_category ON data(category)')
conn.execute('CREATE INDEX IF NOT EXISTS idx_date ON data(date)')
conn.commit()

# 4. Query with SQL — runs in 0.3s instead of 45s
result = pd.read_sql_query('''
    SELECT category,
           COUNT(*) as count,
           SUM(amount) as total,
           AVG(amount) as average
    FROM data
    GROUP BY category
    ORDER BY total DESC
''', conn)
print(result)

conn.close()
```

For more advanced SQL patterns (date analysis, window functions, percentiles, joins, charting from SQLite), load the **data-analysis** skill.

### Read in Chunks

When SQLite is overkill (single pass, simple filter):

```python
import pandas as pd

# Read large CSV in chunks
chunks = []
for chunk in pd.read_csv('/workdir/uploads/large_data.csv', chunksize=10000):
    # Process each chunk
    processed = chunk[chunk['Amount'] > 1000]
    chunks.append(processed)

df = pd.concat(chunks, ignore_index=True)
print(f"Processed {len(df)} rows")
```

### Memory-Efficient Reading

```python
import pandas as pd

# Specify dtypes to reduce memory
dtypes = {
    'ID': 'int32',
    'Category': 'category',
    'Amount': 'float32',
    'Status': 'category'
}

df = pd.read_csv('/workdir/uploads/large_data.csv', dtype=dtypes)
print(f"Memory usage: {df.memory_usage(deep=True).sum() / 1024**2:.2f} MB")
```

### Write Large Files Efficiently

```python
import pandas as pd

# For very large Excel files, use XlsxWriter engine
df.to_excel(
    '/workdir/output/large_report.xlsx',
    index=False,
    engine='xlsxwriter'
)
```

---

## Common Tasks

### Merge/Join DataFrames

```python
import pandas as pd

df1 = pd.read_excel('/workdir/uploads/employees.xlsx')
df2 = pd.read_excel('/workdir/uploads/departments.xlsx')

# Inner join
merged = pd.merge(df1, df2, on='Department_ID')

# Left join
merged = pd.merge(df1, df2, on='Department_ID', how='left')

# Join on different column names
merged = pd.merge(df1, df2, left_on='dept_id', right_on='DepartmentID')
```

### Handle Missing Data

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/data.xlsx')

# Check for missing values
print(df.isnull().sum())

# Fill missing values
df['Amount'] = df['Amount'].fillna(0)
df['Category'] = df['Category'].fillna('Unknown')

# Forward fill
df['Date'] = df['Date'].ffill()

# Drop rows with missing values
df_clean = df.dropna()

# Drop rows missing specific columns
df_clean = df.dropna(subset=['Amount', 'Date'])
```

### Date Handling

```python
import pandas as pd

df = pd.read_excel('/workdir/uploads/data.xlsx')

# Convert to datetime
df['Date'] = pd.to_datetime(df['Date'])

# Extract components
df['Year'] = df['Date'].dt.year
df['Month'] = df['Date'].dt.month
df['Quarter'] = df['Date'].dt.quarter
df['DayOfWeek'] = df['Date'].dt.day_name()

# Filter by date range
mask = (df['Date'] >= '2024-01-01') & (df['Date'] < '2025-01-01')
df_2024 = df[mask]
```

---

## Best Practices

1. **Always use `/workdir/output/` for generated files** - Ensures files are synced to S3
2. **Check file exists before reading** - Use `os.path.exists()` before opening files
3. **Specify dtypes for large files** - Reduces memory usage significantly
4. **Use `index=False` when writing** - Avoid adding unnecessary index columns
5. **Handle encoding for CSV** - Use `encoding='utf-8-sig'` for Excel compatibility
6. **Close workbooks** - Use context managers (`with`) or explicit `.close()`
7. **Password-protected files not supported** - openpyxl/pandas cannot open encrypted Excel files

## Common Issues

| Issue | Solution |
|-------|----------|
| "File not found" | Check path; use `/workdir/uploads/` for input files |
| Encoding errors in CSV | Try `encoding='latin-1'` or `encoding='utf-8-sig'` |
| Excel dates as numbers | Use `pd.to_datetime()` to convert |
| Memory error on large file | Read in chunks or use `dtype` parameter |
| Sheet name too long | Excel limits sheet names to 31 characters |
| Formulas not preserved | openpyxl reads values by default; use `data_only=False` |
| "Command contains ${}" error | Write Python to a file first, then run it (see below) |

### Dollar Sign in Python (Currency Formatting)

The Bash tool blocks `${...}` patterns for security, which affects inline Python with dollar signs like `python3 -c "print(f'${total:.2f}')"`.

**Solution:** Write your analysis script to a file, then execute it:
```python
# 1. Write the script (using Write tool)
# /workdir/session/analysis.py

# 2. Run it
python3 /workdir/session/analysis.py
```

This is actually better practice for any non-trivial analysis anyway.

---

## When to Use Each Library

| Task | Best Library |
|------|--------------|
| Quick data analysis | pandas |
| Read/write simple Excel/CSV | pandas |
| Pivot tables and aggregations | pandas |
| Preserve Excel formatting | openpyxl |
| Modify existing Excel files | openpyxl |
| Create charts and graphs | XlsxWriter |
| Conditional formatting | XlsxWriter |
| Very large files | pandas with chunks |

---

## File Paths

- **Input files**: `/workdir/uploads/`
- **Output files**: `/workdir/output/`
- **Working files**: `/workdir/session/`

Always use full paths and verify files exist before processing.
