---
name: data-analysis
description: "Optimize performance for large dataset analysis. Use when working with files over 50MB, running multiple queries, or when pandas operations are slow. Covers SQLite conversion for 100x+ speedups and basic matplotlib charts."
---

# Data Analysis Optimization Skill

Performance optimization techniques for analyzing large datasets. Key insight: converting large CSV/Excel files to SQLite provides **100-180x query speedups** (0.33s vs 60s).

---

## Quick Decision Tree

```
Is your file > 50MB?
├── YES → Will you run multiple queries?
│   ├── YES → Convert to SQLite (this skill)
│   └── NO  → Use pandas with memory optimization
└── NO  → Use pandas directly (spreadsheet-handling skill)
```

---

## Performance Comparison

| Approach | Query Time (1M rows) | Memory Usage | Best For |
|----------|---------------------|--------------|----------|
| pandas (naive) | 45-60s/query | High (full dataset in RAM) | Small files, single queries |
| pandas (optimized) | 15-30s/query | Medium | Medium files, few queries |
| **SQLite** | **0.3-0.5s/query** | Low (disk-based) | Large files, multiple queries |

---

## SQLite Conversion Pattern (Core Workflow)

### Step 1: Load and Convert to SQLite

```python
import pandas as pd
import sqlite3
from pathlib import Path

# Read the source file
input_path = '/workdir/uploads/large_data.csv'
df = pd.read_csv(input_path)

print(f"Loaded {len(df):,} rows, {len(df.columns)} columns")
print(f"Columns: {list(df.columns)}")

# Create SQLite database
db_path = '/workdir/outputs/analysis.db'
conn = sqlite3.connect(db_path)

# Write DataFrame to SQLite
df.to_sql('data', conn, index=False, if_exists='replace')

print(f"Converted to SQLite: {db_path}")
print(f"Database size: {Path(db_path).stat().st_size / 1024 / 1024:.1f} MB")
```

### Step 2: Create Indexes for Performance

```python
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# Create indexes on columns you'll filter/group by
# This is what makes queries 100x faster
conn.execute('CREATE INDEX IF NOT EXISTS idx_category ON data(category)')
conn.execute('CREATE INDEX IF NOT EXISTS idx_date ON data(date)')
conn.execute('CREATE INDEX IF NOT EXISTS idx_status ON data(status)')
conn.commit()

print("Indexes created - queries will now be fast!")
```

### Step 3: Query with SQL (Fast!)

```python
import pandas as pd
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# This runs in 0.3s instead of 45s
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
```

---

## Common SQL Query Patterns

### Aggregation and Grouping

```python
import pandas as pd
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# Group by with multiple aggregations
result = pd.read_sql_query('''
    SELECT
        category,
        region,
        COUNT(*) as transaction_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount
    FROM data
    GROUP BY category, region
    ORDER BY total_amount DESC
''', conn)

print(result)
```

### Filtering with WHERE

```python
# Filter by multiple conditions
result = pd.read_sql_query('''
    SELECT *
    FROM data
    WHERE amount > 1000
      AND status = 'completed'
      AND date >= '2024-01-01'
    LIMIT 1000
''', conn)
```

### Date-Based Analysis

```python
# Monthly aggregation
result = pd.read_sql_query('''
    SELECT
        strftime('%Y-%m', date) as month,
        COUNT(*) as count,
        SUM(amount) as total
    FROM data
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month
''', conn)
```

### Top N by Category

```python
# Top 5 in each category using window function
result = pd.read_sql_query('''
    WITH ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY category ORDER BY amount DESC) as rn
        FROM data
    )
    SELECT * FROM ranked WHERE rn <= 5
''', conn)
```

### Percentiles and Distribution

```python
# Distribution analysis
result = pd.read_sql_query('''
    SELECT
        category,
        COUNT(*) as n,
        AVG(amount) as mean,
        -- Approximate median using percentile
        (SELECT amount FROM data d2
         WHERE d2.category = data.category
         ORDER BY amount
         LIMIT 1
         OFFSET (SELECT COUNT(*)/2 FROM data d3 WHERE d3.category = data.category)
        ) as approx_median
    FROM data
    GROUP BY category
''', conn)
```

### Joining Multiple Tables

```python
# If you have multiple DataFrames, load them all to SQLite
df_orders = pd.read_csv('/workdir/uploads/orders.csv')
df_customers = pd.read_csv('/workdir/uploads/customers.csv')

df_orders.to_sql('orders', conn, index=False, if_exists='replace')
df_customers.to_sql('customers', conn, index=False, if_exists='replace')

# Then join efficiently
result = pd.read_sql_query('''
    SELECT
        c.customer_name,
        c.region,
        COUNT(o.order_id) as order_count,
        SUM(o.amount) as total_spent
    FROM customers c
    LEFT JOIN orders o ON c.customer_id = o.customer_id
    GROUP BY c.customer_id, c.customer_name, c.region
    ORDER BY total_spent DESC
''', conn)
```

---

## Memory-Efficient Pandas Patterns

When SQLite is overkill but you need to optimize pandas:

### Read Only Needed Columns

```python
import pandas as pd

# Only load columns you need
df = pd.read_csv('/workdir/uploads/large_data.csv',
                 usecols=['id', 'category', 'amount', 'date'])
```

### Specify Data Types

```python
import pandas as pd

# Reduce memory by specifying efficient types
dtypes = {
    'id': 'int32',           # Instead of int64
    'category': 'category',   # Huge savings for low-cardinality strings
    'amount': 'float32',      # Instead of float64
    'status': 'category',
    'region': 'category'
}

df = pd.read_csv('/workdir/uploads/large_data.csv', dtype=dtypes)

# Check memory savings
print(f"Memory usage: {df.memory_usage(deep=True).sum() / 1024**2:.1f} MB")
```

### Process in Chunks

```python
import pandas as pd

# Process large file in chunks
results = []
for chunk in pd.read_csv('/workdir/uploads/huge_file.csv', chunksize=100000):
    # Filter or aggregate each chunk
    chunk_result = chunk.groupby('category')['amount'].sum()
    results.append(chunk_result)

# Combine results
final = pd.concat(results).groupby(level=0).sum()
print(final)
```

---

## Sampling for Exploratory Analysis

When exploring data, sample first to understand patterns:

```python
import pandas as pd

# Quick sample to understand data structure
df_sample = pd.read_csv('/workdir/uploads/large_data.csv', nrows=1000)

print("Columns:", list(df_sample.columns))
print("\nData types:")
print(df_sample.dtypes)
print("\nSample values:")
print(df_sample.head(10))
print("\nBasic stats:")
print(df_sample.describe())

# If data looks good, load full dataset for SQLite conversion
```

---

## Choosing the Right Visualization Format

**Default to HTML** unless the user specifically asks for a chart/graph or the data is best represented as one.

### Use HTML (`.html`) when:
- Dashboards, boards, status views (e.g., sprint boards, kanban, project overviews)
- Reports with mixed content (tables, metrics, cards, progress bars)
- Layouts with interactive elements (clickable items, hover tooltips, expandable sections)
- Any visualization where the structure/layout matters more than plotting numeric data
- The user says "visualize" or "represent" something that isn't inherently a chart

### Use matplotlib/PNG (`.png`) when:
- The user explicitly asks for a "chart", "graph", or "plot"
- The data is best shown as a bar chart, line chart, pie chart, scatter plot, histogram, etc.
- Comparing numeric values across categories or over time
- Statistical distributions, correlations, or trends

**Rule of thumb:** If you'd draw it on a whiteboard as boxes/cards/layouts → HTML. If you'd draw it as axes with data points → PNG chart.

### HTML Visualization Template

```python
html = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard Title</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 24px; }
  .header { background: #8e50a7; color: white; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; font-weight: 600; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .metric-card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .metric-value { font-size: 28px; font-weight: 700; color: #8e50a7; }
  .metric-label { font-size: 13px; color: #666; margin-top: 4px; }
  .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f9f5fb; color: #6a3a7d; font-weight: 600; font-size: 13px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
  .badge-purple { background: #f3e8f9; color: #8e50a7; }
  .badge-green { background: #e8f5e9; color: #2e7d32; }
  .badge-amber { background: #fff8e1; color: #f57f17; }
  .badge-red { background: #fce4ec; color: #c62828; }
</style>
</head>
<body>
  <!-- Build your dashboard here -->
</body>
</html>'''

with open('/workdir/outputs/dashboard.html', 'w') as f:
    f.write(html)
print("Dashboard saved: /workdir/outputs/dashboard.html")
```

Use Numa's purple (`#8e50a7`) as the primary color. HTML dashboards are responsive, interactive, and more professional for non-chart visualizations.

---

## Basic Chart Visualization with matplotlib

Create charts using Numa's purple color scheme. **Only use this for actual data charts** — see format selection guidance above.

### Setup and Colors

```python
import matplotlib.pyplot as plt

# Numa color scheme
NUMA_PURPLE = '#8e50a7'
NUMA_COLORS = ['#8e50a7', '#b07cc6', '#6a3a7d', '#d4a5e8', '#4a2a5a']

# Set clean style
plt.style.use('seaborn-v0_8-whitegrid')
```

### Bar Chart

```python
import matplotlib.pyplot as plt
import pandas as pd
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# Get data
result = pd.read_sql_query('''
    SELECT category, SUM(amount) as total
    FROM data
    GROUP BY category
    ORDER BY total DESC
    LIMIT 10
''', conn)

# Create bar chart
fig, ax = plt.subplots(figsize=(10, 6))
bars = ax.bar(result['category'], result['total'], color='#8e50a7')

ax.set_title('Total Amount by Category', fontsize=14, fontweight='bold')
ax.set_xlabel('Category')
ax.set_ylabel('Total Amount')
ax.tick_params(axis='x', rotation=45)

# Add value labels on bars
for bar, val in zip(bars, result['total']):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01 * max(result['total']),
            f'{val:,.0f}', ha='center', va='bottom', fontsize=9)

plt.tight_layout()
plt.savefig('/workdir/outputs/category_chart.png', dpi=150, bbox_inches='tight')
plt.close()

print("Chart saved: /workdir/outputs/category_chart.png")
```

### Line Chart (Time Series)

```python
import matplotlib.pyplot as plt
import pandas as pd
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# Get monthly data
result = pd.read_sql_query('''
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
    FROM data
    GROUP BY month
    ORDER BY month
''', conn)

# Create line chart
fig, ax = plt.subplots(figsize=(12, 6))
ax.plot(result['month'], result['total'], color='#8e50a7', linewidth=2, marker='o', markersize=4)

ax.set_title('Monthly Trend', fontsize=14, fontweight='bold')
ax.set_xlabel('Month')
ax.set_ylabel('Total Amount')
ax.tick_params(axis='x', rotation=45)

# Add grid
ax.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('/workdir/outputs/trend_chart.png', dpi=150, bbox_inches='tight')
plt.close()

print("Chart saved: /workdir/outputs/trend_chart.png")
```

### Pie Chart

```python
import matplotlib.pyplot as plt
import pandas as pd
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# Get distribution data
result = pd.read_sql_query('''
    SELECT category, SUM(amount) as total
    FROM data
    GROUP BY category
    ORDER BY total DESC
    LIMIT 5
''', conn)

# Create pie chart
fig, ax = plt.subplots(figsize=(8, 8))
colors = ['#8e50a7', '#b07cc6', '#6a3a7d', '#d4a5e8', '#4a2a5a']

wedges, texts, autotexts = ax.pie(
    result['total'],
    labels=result['category'],
    colors=colors[:len(result)],
    autopct='%1.1f%%',
    startangle=90
)

ax.set_title('Distribution by Category', fontsize=14, fontweight='bold')

plt.tight_layout()
plt.savefig('/workdir/outputs/pie_chart.png', dpi=150, bbox_inches='tight')
plt.close()

print("Chart saved: /workdir/outputs/pie_chart.png")
```

### Multiple Series Comparison

```python
import matplotlib.pyplot as plt
import pandas as pd
import sqlite3

conn = sqlite3.connect('/workdir/outputs/analysis.db')

# Get data by category over time
result = pd.read_sql_query('''
    SELECT
        strftime('%Y-%m', date) as month,
        category,
        SUM(amount) as total
    FROM data
    WHERE category IN ('Category A', 'Category B', 'Category C')
    GROUP BY month, category
    ORDER BY month
''', conn)

# Pivot for plotting
pivot = result.pivot(index='month', columns='category', values='total').fillna(0)

# Create multi-line chart
fig, ax = plt.subplots(figsize=(12, 6))
colors = ['#8e50a7', '#b07cc6', '#6a3a7d']

for i, col in enumerate(pivot.columns):
    ax.plot(pivot.index, pivot[col], label=col, color=colors[i % len(colors)], linewidth=2)

ax.set_title('Trends by Category', fontsize=14, fontweight='bold')
ax.set_xlabel('Month')
ax.set_ylabel('Amount')
ax.legend()
ax.tick_params(axis='x', rotation=45)
ax.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('/workdir/outputs/comparison_chart.png', dpi=150, bbox_inches='tight')
plt.close()

print("Chart saved: /workdir/outputs/comparison_chart.png")
```

---

## When NOT to Use SQLite

Stick with pandas when:

- **File < 50MB** - Conversion overhead isn't worth it
- **Single query needed** - Just use pandas directly
- **Need pandas-specific features** - Rolling windows, resampling, etc.
- **Working with time series** - pandas has better datetime support
- **Need to modify data frequently** - pandas is more flexible

---

## Complete Example Workflow

```python
import pandas as pd
import sqlite3
import matplotlib.pyplot as plt
from pathlib import Path

# 1. Load data to SQLite
print("Loading data...")
df = pd.read_csv('/workdir/uploads/sales_data.csv')
print(f"Loaded {len(df):,} rows")

db_path = '/workdir/outputs/analysis.db'
conn = sqlite3.connect(db_path)
df.to_sql('sales', conn, index=False, if_exists='replace')

# 2. Create indexes
conn.execute('CREATE INDEX IF NOT EXISTS idx_category ON sales(category)')
conn.execute('CREATE INDEX IF NOT EXISTS idx_date ON sales(date)')
conn.commit()
print("SQLite database ready!")

# 3. Run fast queries
print("\n--- Sales by Category ---")
by_category = pd.read_sql_query('''
    SELECT category,
           COUNT(*) as transactions,
           SUM(amount) as total,
           AVG(amount) as average
    FROM sales
    GROUP BY category
    ORDER BY total DESC
''', conn)
print(by_category)

print("\n--- Monthly Trends ---")
monthly = pd.read_sql_query('''
    SELECT strftime('%Y-%m', date) as month,
           SUM(amount) as total
    FROM sales
    GROUP BY month
    ORDER BY month
''', conn)
print(monthly)

# 4. Create visualization
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

# Bar chart
ax1.bar(by_category['category'], by_category['total'], color='#8e50a7')
ax1.set_title('Sales by Category')
ax1.tick_params(axis='x', rotation=45)

# Line chart
ax2.plot(monthly['month'], monthly['total'], color='#8e50a7', linewidth=2, marker='o')
ax2.set_title('Monthly Sales Trend')
ax2.tick_params(axis='x', rotation=45)

plt.tight_layout()
plt.savefig('/workdir/outputs/analysis_summary.png', dpi=150, bbox_inches='tight')
plt.close()

# 5. Export results
by_category.to_csv('/workdir/outputs/sales_by_category.csv', index=False)
monthly.to_csv('/workdir/outputs/monthly_trends.csv', index=False)

print("\nAnalysis complete!")
print("Files created:")
print("  - /workdir/outputs/analysis_summary.png")
print("  - /workdir/outputs/sales_by_category.csv")
print("  - /workdir/outputs/monthly_trends.csv")

conn.close()
```

---

## Best Practices

1. **Always sample first** - Understand your data with 1000 rows before loading millions
2. **Create indexes on filter/group columns** - This is what makes SQLite fast
3. **Use `/workdir/outputs/` for the database** - Ephemeral, cleaned up after session
4. **Use `/workdir/outputs/` for results** - These sync to S3 for the user
5. **Close connections** - Use `conn.close()` or context managers
6. **Show progress for large operations** - Users appreciate knowing things are working

## Common Issues

| Issue | Solution |
|-------|----------|
| "SQLite query still slow" | Create an INDEX on the columns you're filtering/grouping by |
| "Memory error loading CSV" | Use `chunksize` parameter or read directly to SQLite |
| "Matplotlib figure not showing" | Use `plt.savefig()` then close with `plt.close()` |
| "Database locked" | Close other connections, use single connection |
| "Date comparisons not working" | Ensure dates are in 'YYYY-MM-DD' format |

---

## File Paths

- **Input files**: `/workdir/uploads/`
- **Database**: `/workdir/outputs/analysis.db`
- **Charts/exports**: `/workdir/outputs/`
