# DB CLI Python SDK

A comprehensive Python wrapper for the `db` CLI tool with YAML configuration management, natural language queries, and agentic AI investigations.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
  - [YAML Config (config.engines.yaml)](#yaml-config)
  - [Environment Variables (.env)](#environment-variables)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
  - [CSV Queries (Primary Focus)](#csv-queries-primary-focus)
  - [Natural Language Queries (--ask)](#natural-language-queries---ask)
  - [Agentic Investigations (--ask --auto)](#agentic-investigations---ask---auto)
  - [PostgreSQL Queries](#postgresql-queries)
  - [Configuration Management](#configuration-management)
- [API Reference](#api-reference)
- [Advanced Topics](#advanced-topics)

---

## Features

✨ **Primary Features** (Main Focus):
- 🤖 **AI Natural Language Queries** (`--ask`) - Ask questions in plain English
- 🔬 **Agentic Investigations** (`--ask --auto`) - Multi-hop AI reasoning for complex analysis
- 📊 **CSV Data Analysis** - Query local files, URLs, and Google Sheets with SQL

📦 **Additional Features**:
- 🐘 **PostgreSQL Support** - Direct database queries with datasource management
- ⚙️ **YAML Configuration** - Manage datasources and engines via `config.engines.yaml`
- 🚀 **Multiple Engines** - SQLite (simple), DuckDB (fast), AWS Athena (serverless)
- 🌐 **URL Caching** - Automatic 1-hour caching for remote CSV files
- ☁️ **Cloud Integration** - S3 and AWS Athena support

---

## Installation

### Prerequisites

1. **Python 3.7+** with pip
2. **db CLI tool** (parent directory)
3. **Dependencies**:
   ```bash
   pip install pyyaml
   ```

### Optional Dependencies

For different features:
- **PostgreSQL**: `psql` command-line tool
- **CSV (SQLite)**: `sqlite3` (usually pre-installed)
- **CSV (DuckDB)**: `duckdb` binary
- **AI Features**: Anthropic API key
- **AWS**: AWS CLI configured

### Directory Structure

```
db_clean/
├── db                    # Main CLI executable
├── config.engines.yaml   # Configuration file
├── .env                  # Environment variables (create from .env.example)
└── sdk/
    ├── __init__.py
    ├── db_sdk.py        # Main SDK
    └── README.md        # This file
```

---

## Configuration

### YAML Config (config.engines.yaml)

The SDK uses `config.engines.yaml` for datasource and engine configuration:

```yaml
# Active datasource (used by default)
active_datasource: production

# AI Configuration
ai:
  provider: anthropic
  api_key_env: ANTHROPIC_API_KEY
  agentic_model: claude-3-5-haiku-20241022
  single_query_model: claude-sonnet-4-6

# Named Datasources
datasources:
  production:
    type: postgres
    description: "Production database"
    connection:
      host_env: DB_HOST
      port_env: DB_PORT
      database_env: DB_NAME
      user_env: DB_USER
      password_env: DB_PASSWORD

  staging:
    type: postgres
    description: "Staging database"
    connection:
      host_env: STAGING_DB_HOST
      port_env: STAGING_DB_PORT
      database_env: STAGING_DB_NAME
      user_env: STAGING_DB_USER
      password_env: STAGING_DB_PASSWORD

# Engines for ad-hoc queries
engines:
  csv-sqlite:
    description: "Query CSV files using SQLite"
    # ... (defined in config.engines.yaml)
```

### Environment Variables (.env)

Create `.env` file from `.env.example`:

```bash
# PostgreSQL (Production)
DB_HOST=your-host.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres.xxxxx
DB_PASSWORD=your-password-here

# PostgreSQL (Staging - optional)
STAGING_DB_HOST=staging-host.supabase.com
STAGING_DB_PORT=6543
STAGING_DB_NAME=postgres
STAGING_DB_USER=postgres.staging
STAGING_DB_PASSWORD=staging-password

# AI Features (REQUIRED for --ask and --auto)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# AWS (optional, for S3/Athena)
AWS_REGION=us-east-1
AWS_PROFILE=default
```

---

## Quick Start

```python
from db_sdk import DB, Config

# 1. CSV Query (Most Common Use Case)
db = DB()
results = db.csv("./sales.csv", "SELECT * FROM data WHERE amount > 1000")
print(results)

# 2. Natural Language Query on CSV
answer = db.ask("what are total sales by region?", csv_file="./sales.csv")
print(answer)
# "Total sales by region: EU: $10,200, US: $6,150"

# 3. Agentic Investigation on CSV
result = db.investigate("why did sales drop in Q3?", csv_file="./sales.csv")
print(result['answer'])
print(f"Completed in {result['iterations']} iterations")

# 4. PostgreSQL Query (if configured)
results = db.query("SELECT * FROM users LIMIT 5")

# 5. Manage Configuration
config = Config()
print(f"Active datasource: {config.get_active_datasource()}")
print(f"Available datasources: {config.list_datasources()}")
```

---

## Tested Examples (Copy-Paste Ready)

These examples use the test datasets included in `../data/` and are fully tested.

### Setup

```bash
# Install SDK
cd sdk
python3 -m venv venv
source venv/bin/activate
pip install -e .

# Set API key for AI features
export ANTHROPIC_API_KEY='sk-ant-your-key-here'
```

### Example 1: Basic CSV Query with JSON Format

```python
from db_sdk import DB

db = DB()

# Query iris dataset with JSON format
results = db.csv(
    "../data/iris.csv",
    """SELECT
        species,
        COUNT(*) as count,
        ROUND(AVG(sepal_length), 2) as avg_sepal
    FROM data
    GROUP BY species""",
    format="json"
)

# Results are Python list of dicts
for row in results:
    print(f"{row['species']:12} | Count: {row['count']:>3} | Avg Sepal: {row['avg_sepal']}")

# Output:
# setosa       | Count:  50 | Avg Sepal: 5.01
# versicolor   | Count:  50 | Avg Sepal: 5.94
# virginica    | Count:  50 | Avg Sepal: 6.59
```

### Example 2: Titanic Survival Analysis

```python
from db_sdk import DB

db = DB()

# Analyze survival rates by class
results = db.csv(
    "../data/titanic.csv",
    """SELECT
        Pclass as class,
        COUNT(*) as total,
        SUM(Survived) as survived,
        ROUND(AVG(Survived) * 100, 1) as survival_rate
    FROM data
    GROUP BY Pclass
    ORDER BY Pclass""",
    format="json"
)

print("Titanic Survival by Class:")
for row in results:
    rate = float(row['survival_rate'])
    bar = "█" * int(rate / 5)
    print(f"  Class {row['class']}: {row['survived']:>3}/{row['total']:>3} survived ({rate:>4.1f}%) {bar}")

# Output:
# Titanic Survival by Class:
#   Class 1: 136/216 survived (63.0%) ████████████
#   Class 2:  87/184 survived (47.3%) █████████
#   Class 3: 119/491 survived (24.2%) ████
```

### Example 3: Natural Language Query (--ask)

```python
from db_sdk import DB

db = DB()

# Ask a natural language question about Titanic data
answer = db.ask(
    "What was the survival rate for men vs women?",
    csv_file="../data/titanic.csv"
)

print(answer)

# Output:
# Women had a dramatically higher survival rate at 74.2% (233 out of 314 survived)
# compared to men at only 18.89% (109 out of 577 survived). This means women were
# roughly 4 times more likely to survive than men, with nearly 3 out of 4 women
# surviving while fewer than 1 in 5 men survived.
```

### Example 4: Natural Language Query on Iris Dataset

```python
from db_sdk import DB

db = DB()

# Ask about iris flowers
answer = db.ask(
    "Which species has the largest petals on average?",
    csv_file="../data/iris.csv"
)

print(answer)

# Output:
# Virginica has the largest petals on average, with a mean petal length of
# 5.552 units and petal width of 2.026 units. This makes it the species with
# the most substantial petals in both dimensions compared to the other iris
# species in the dataset.
```

### Example 5: Agentic Investigation (--auto)

```python
from db_sdk import DB

db = DB()

# Conduct multi-hop investigation on Titanic data
result = db.investigate(
    "What factors most influenced survival on the Titanic?",
    csv_file="../data/titanic.csv"
)

print(f"Investigation completed in {result['iterations']} iterations")
print(f"\nAnswer:\n{result['answer']}")

# Output:
# Investigation completed in 5 iterations
#
# Answer:
# 1. Social Class (Strongest Factor)
#    - Passenger class was the most critical determinant of survival
#    - First-class passengers had dramatically higher survival rates (63.0%)
#      compared to third-class passengers (24.2%)
#    - Social status and proximity to lifeboats significantly increased survival chances
#
# 2. Gender (Second Most Important Factor)
#    - Being female was the second most crucial survival factor
#    - Females in every class had substantially higher survival rates than males
#    - Women: 74.2% survival, Men: 18.89% survival
#    - Social norms of "women and children first" were strongly reflected
#
# 3. Age (Third Important Factor)
#    - Children had higher survival rates compared to adults
#    - Youngest passengers (0-11) had 57.35% survival rate
#    - Likely due to priority rescue and smaller size enabling easier evacuation
#
# Confidence Level: 95%
```

### Example 6: Air Travel Time Series Analysis

```python
from db_sdk import DB

db = DB()

# Analyze air travel data
results = db.csv(
    "../data/airtravel.csv",
    """SELECT
        Month,
        CAST("1958" AS INTEGER) as passengers_1958,
        CAST("1959" AS INTEGER) as passengers_1959,
        CAST("1960" AS INTEGER) as passengers_1960
    FROM data
    LIMIT 5""",
    format="json"
)

print("Air Travel Passengers by Month:")
print(f"{'Month':12} | {'1958':>8} | {'1959':>8} | {'1960':>8}")
print(f"{'-'*12}-+-{'-'*8}-+-{'-'*8}-+-{'-'*8}")
for row in results:
    print(f"{row['Month']:12} | {row['passengers_1958']:>8} | {row['passengers_1959']:>8} | {row['passengers_1960']:>8}")
```

### Example 7: Car Sales Statistics

```python
from db_sdk import DB

db = DB()

# Calculate statistics from car sales data
results = db.csv(
    "../data/monthly-car-sales.csv",
    """SELECT
        AVG(Sales) as avg_sales,
        MIN(Sales) as min_sales,
        MAX(Sales) as max_sales,
        COUNT(*) as months
    FROM data""",
    format="json"
)

stats = results[0]
print(f"Car Sales Statistics:")
print(f"  Average Sales: {float(stats['avg_sales']):,.0f}")
print(f"  Minimum Sales: {float(stats['min_sales']):,.0f}")
print(f"  Maximum Sales: {float(stats['max_sales']):,.0f}")
print(f"  Total Months:  {stats['months']}")

# Output:
# Car Sales Statistics:
#   Average Sales: 14,595
#   Minimum Sales: 10,015
#   Maximum Sales: 19,545
#   Total Months:  108
```

### Example 8: Complex Multi-Dataset Analysis

```python
from db_sdk import DB

db = DB()

# Process multiple datasets
datasets = [
    ("../data/iris.csv", "SELECT COUNT(DISTINCT species) as species FROM data"),
    ("../data/titanic.csv", "SELECT COUNT(*) as passengers FROM data"),
    ("../data/airtravel.csv", "SELECT COUNT(*) as months FROM data"),
]

print("Dataset Summary:")
for csv_file, query in datasets:
    result = db.csv(csv_file, query, format="json")
    print(f"  {csv_file.split('/')[-1]:20} → {result[0]}")

# Output:
# Dataset Summary:
#   iris.csv             → {'species': 3}
#   titanic.csv          → {'passengers': 891}
#   airtravel.csv        → {'months': 144}
```

---

## Usage Examples

### CSV Queries (Primary Focus)

CSV analysis is the **primary use case** for this SDK.

#### Local CSV Files

```python
from db_sdk import DB

db = DB()

# Basic query
results = db.csv("./sales.csv", "SELECT * FROM data LIMIT 10")

# Aggregation
results = db.csv(
    "./sales.csv",
    "SELECT region, SUM(amount) as total FROM data GROUP BY region ORDER BY total DESC"
)

# Filtering
results = db.csv(
    "./sales.csv",
    "SELECT product, amount FROM data WHERE amount > 1000 AND region = 'US'"
)

# Date ranges
results = db.csv(
    "./logs.csv",
    "SELECT date, COUNT(*) as count FROM data WHERE date >= '2024-01-01' GROUP BY date"
)
```

#### URL CSV Files (with Auto-Caching)

URLs are downloaded once and cached for 1 hour:

```python
# COVID-19 data
url = "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv"
results = db.csv(url, "SELECT Country, MAX(Confirmed) as cases FROM data GROUP BY Country LIMIT 10")

# Weather data
url = "https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv"
results = db.csv(url, "SELECT Date, Max_TemperatureC FROM data ORDER BY Max_TemperatureC DESC LIMIT 5")

# Stock market data
url = "https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv"
results = db.csv(url, 'SELECT Date, "AAPL.Close" FROM data ORDER BY Date DESC LIMIT 10')

# Titanic dataset
url = "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv"
results = db.csv(url, "SELECT Pclass, AVG(Survived) as survival_rate FROM data GROUP BY Pclass")
```

#### Google Sheets

```python
# Google Sheets export URL format
sheet_id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid=0"

results = db.csv(sheet_url, "SELECT * FROM data LIMIT 10")

# Multiple sheets (change gid parameter)
sheet_url_2 = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid=1"
results = db.csv(sheet_url_2, "SELECT * FROM data")
```

#### Large CSV Files (DuckDB Engine)

For files > 10MB, use DuckDB for 10-100x faster performance:

```python
# DuckDB requires different SQL syntax
results = db.csv(
    "./large_file.csv",
    "SELECT * FROM read_csv_auto('./large_file.csv') LIMIT 100",
    engine="csv-duckdb"
)

# DuckDB aggregation
results = db.csv(
    "./covid_data.csv",
    """
    SELECT Country, MAX(Confirmed) as total_cases
    FROM read_csv_auto('./covid_data.csv')
    GROUP BY Country
    ORDER BY total_cases DESC
    LIMIT 10
    """,
    engine="csv-duckdb"
)
```

### Natural Language Queries (--ask)

**Most Important Feature** - Ask questions in plain English!

#### CSV Natural Language Queries

```python
from db_sdk import DB

db = DB(anthropic_api_key="sk-ant-...")  # Or use .env

# Simple questions
answer = db.ask("how many products are there?", csv_file="./sales.csv")
# "There are 10 products in the dataset."

answer = db.ask("what are total sales by region?", csv_file="./sales.csv")
# "Total sales by region: EU: $10,200 (5 products), US: $6,150 (5 products)"

# Top N questions
answer = db.ask("what are the top 3 products by sales amount?", csv_file="./sales.csv")
# "The top 3 products are: Widget ($2,500), Gadget ($2,100), Doohickey ($1,800)"

# Filtering questions
answer = db.ask("which products have sales over 1500?", csv_file="./sales.csv")
# "5 products have sales over $1,500: Widget ($2,500), Gadget ($2,100)..."

# Date-based questions
answer = db.ask("what month had the highest sales?", csv_file="./sales.csv")
# "March had the highest sales with $4,200"

# With URL CSV
url = "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv"
answer = db.ask("which country had the most COVID cases?", csv_file=url)
# "The United States had the most COVID cases with 103,802,702 confirmed cases"

# With Google Sheets
sheet_url = "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=0"
answer = db.ask("how many students are in each class level?", csv_file=sheet_url)
# "Class distribution: Freshman (8), Sophomore (7), Junior (6), Senior (9)"
```

#### PostgreSQL Natural Language Queries

```python
# Query PostgreSQL database (no csv_file parameter)
answer = db.ask("how many active users are there?")
# "There are 1,543 active users in the database."

answer = db.ask("what are the top 5 most common user roles?")
# "The top 5 user roles are: viewer (432 users), editor (234 users)..."

answer = db.ask("how many orders were placed last month?")
# "1,287 orders were placed in October 2024"
```

### Agentic Investigations (--ask --auto)

**Most Powerful Feature** - Multi-hop AI reasoning for complex analysis!

#### CSV Agentic Investigations

```python
from db_sdk import DB

db = DB(anthropic_api_key="sk-ant-...")

# WHY questions (root cause analysis)
result = db.investigate("why did sales drop in Q3?", csv_file="./sales.csv")
print(result['answer'])
# "Q3 sales dropped 40% ($31K vs $52K in Q2) primarily due to Widget sales
#  declining from $25K to $8K. This correlates with a supplier shortage
#  affecting Widget inventory in July-August."
print(f"Investigation used {result['iterations']} queries")
# "Investigation used 5 queries"

# Pattern detection
result = db.investigate(
    "find patterns and anomalies in the COVID data",
    csv_file="./covid_data.csv"
)
print(result['answer'])
# Multi-paragraph analysis with specific findings

# Trend analysis
result = db.investigate(
    "analyze air travel growth patterns across years",
    csv_file="https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv"
)
print(result['answer'])
# Detailed trend analysis with year-over-year comparisons

# Exploratory questions
result = db.investigate(
    "what factors influenced survival on the Titanic?",
    csv_file="https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv"
)
print(result['answer'])
# "Three primary factors influenced survival: passenger class (1st class: 63% survival,
#  3rd class: 24%), gender (females: 74% survival, males: 19%), and age (children
#  under 10 had higher survival rates)..."

# Weather analysis
result = db.investigate(
    "analyze Seattle temperature patterns and identify extreme weather events",
    csv_file="https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv"
)
print(result['answer'])

# Access full investigation transcript
print(result['raw_output'])  # Complete multi-query investigation process
```

#### PostgreSQL Agentic Investigations

```python
# Complex database analysis (no csv_file parameter)
result = db.investigate("analyze user growth trends over the past 6 months")
print(result['answer'])
# Multi-hop analysis with specific metrics

result = db.investigate("why is error rate increasing in the logs table?")
print(result['answer'])
# Root cause analysis with evidence

result = db.investigate("find anomalies in the sales data for Q4")
print(result['answer'])
# Pattern detection and anomaly identification
```

### PostgreSQL Queries

#### Using Default Datasource

```python
from db_sdk import DB

# Uses active_datasource from config.engines.yaml
db = DB()

# Basic query
results = db.query("SELECT * FROM users LIMIT 5")
print(results)
# [{'id': 1, 'name': 'Alice', 'email': '...'}, ...]

# Aggregation
results = db.query("""
    SELECT
        role,
        COUNT(*) as count,
        AVG(created_at) as avg_signup_date
    FROM users
    GROUP BY role
    ORDER BY count DESC
""")

# Joins
results = db.query("""
    SELECT u.name, COUNT(o.id) as order_count
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.name
    ORDER BY order_count DESC
    LIMIT 10
""")
```

#### Using Specific Datasource

```python
# Override datasource for specific queries
db = DB(datasource="staging")
results = db.query("SELECT * FROM users LIMIT 5")

# Or specify per query
db = DB()
results = db.query("SELECT * FROM orders", datasource="analytics")
```

#### Direct Credentials (Bypass Config)

```python
# Pass credentials directly
db = DB(
    db_host="localhost",
    db_port=5432,
    db_name="mydb",
    db_user="myuser",
    db_password="secret"
)
results = db.query("SELECT * FROM users")
```

### Configuration Management

Programmatically manage `config.engines.yaml`:

```python
from db_sdk import Config, ConfigError

# Load configuration
config = Config()

# View current configuration
print(f"Active datasource: {config.get_active_datasource()}")
print(f"Datasources: {config.list_datasources()}")
print(f"Engines: {config.list_engines()}")

# Add a new datasource
config.add_datasource("staging", {
    "type": "postgres",
    "description": "Staging environment",
    "connection": {
        "host_env": "STAGING_DB_HOST",
        "port_env": "STAGING_DB_PORT",
        "database_env": "STAGING_DB_NAME",
        "user_env": "STAGING_DB_USER",
        "password_env": "STAGING_DB_PASSWORD"
    }
})
config.save()

# Change active datasource
config.set_active_datasource("staging")
config.save()

# Get datasource configuration
ds_config = config.get_datasource("production")
print(ds_config)

# Remove datasource
config.remove_datasource("old_datasource")
config.save()

# Manage engines
config.add_engine("my-custom-engine", {
    "description": "Custom data processing",
    "parameters": [...],
    "query_command": "..."
})
config.save()

# Update AI configuration
ai_config = config.get_ai_config()
ai_config['agentic_model'] = 'claude-3-5-sonnet-20241022'
config.set_ai_config(ai_config)
config.save()

# Get full config as dict
full_config = config.to_dict()
```

### S3 and Athena

#### S3 CSV Files

```python
from db_sdk import DB

db = DB(aws_region="us-east-1")

# Downloads S3 CSV then queries with SQLite
results = db.s3(
    "s3://my-bucket/data/sales.csv",
    "SELECT * FROM data WHERE date > '2024-01-01' LIMIT 100"
)
```

#### AWS Athena (Serverless S3 SQL)

```python
# Query S3 data without downloading
results = db.athena(
    sql="SELECT * FROM my_table WHERE year = 2024",
    database="analytics",
    output_location="s3://my-bucket/athena-results/",
    region="us-east-1"
)

# Complex Athena query
results = db.athena(
    sql="""
        SELECT
            date_trunc('month', event_date) as month,
            COUNT(*) as event_count
        FROM events
        WHERE year = 2024
        GROUP BY 1
        ORDER BY 1
    """,
    database="logs",
    output_location="s3://results/",
    workgroup="primary"
)
```

---

## API Reference

### DB Class

#### Constructor

```python
DB(
    db_path: Optional[str] = None,
    datasource: Optional[str] = None,
    config_path: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    db_host: Optional[str] = None,
    db_port: Optional[Union[str, int]] = None,
    db_name: Optional[str] = None,
    db_user: Optional[str] = None,
    db_password: Optional[str] = None,
    anthropic_api_key: Optional[str] = None,
    aws_region: Optional[str] = None,
    aws_profile: Optional[str] = None
)
```

#### Methods

**`csv(csv_file, sql, engine="csv-sqlite", format="json", **kwargs)`**

Query CSV file (local, URL, or Google Sheets).

- **Parameters:**
  - `csv_file`: File path, URL, or Google Sheets export URL
  - `sql`: SQL query (table name "data" for csv-sqlite)
  - `engine`: "csv-sqlite" (default, standard SQL) or "csv-duckdb" (fast)
  - `format`: "json" (default), "csv", or "table"
- **Returns:** List of dicts (JSON) or string (CSV/table)

**`ask(question, csv_file=None, datasource=None, engine="csv-sqlite", **kwargs)`**

Natural language query - single-shot AI.

- **Parameters:**
  - `question`: Natural language question
  - `csv_file`: CSV file/URL (if None, queries datasource)
  - `datasource`: Override datasource
  - `engine`: Engine for CSV files
- **Returns:** Natural language answer string

**`investigate(question, csv_file=None, datasource=None, engine="csv-sqlite", **kwargs)`**

Agentic investigation - multi-hop AI reasoning.

- **Parameters:**
  - `question`: Complex/exploratory question
  - `csv_file`: CSV file/URL (if None, queries datasource)
  - `datasource`: Override datasource
  - `engine`: Engine for CSV files
- **Returns:** Dict with `{'answer': str, 'iterations': int, 'raw_output': str}`

**`query(sql, datasource=None, format="json", **kwargs)`**

Execute SQL against configured datasource.

- **Parameters:**
  - `sql`: SQL query
  - `datasource`: Override datasource
  - `format`: Output format
- **Returns:** List of dicts (JSON) or string

**`s3(s3_path, sql, region="us-east-1", format="json", **kwargs)`**

Query S3 CSV file (downloads then queries).

**`athena(sql, database, output_location, region="us-east-1", **kwargs)`**

Query AWS Athena (serverless S3 SQL).

**`help()`**

Get help text from CLI.

### Config Class

```python
Config(config_path: Optional[str] = None)
```

**Methods:**
- `get_active_datasource()` → str
- `set_active_datasource(name: str)`
- `list_datasources()` → List[str]
- `get_datasource(name: str)` → Dict
- `add_datasource(name: str, config: Dict)`
- `remove_datasource(name: str)`
- `list_engines()` → List[str]
- `get_engine(name: str)` → Dict
- `add_engine(name: str, config: Dict)`
- `remove_engine(name: str)`
- `get_ai_config()` → Dict
- `set_ai_config(config: Dict)`
- `get_output_config()` → Dict
- `set_output_config(config: Dict)`
- `to_dict()` → Dict
- `save()` - Save changes to YAML
- `load()` - Reload from YAML

### Convenience Functions

```python
from db_sdk import query, csv, ask, investigate

# Quick one-liners
results = csv("./data.csv", "SELECT * FROM data")
answer = ask("how many records?", csv_file="./data.csv")
result = investigate("why did X happen?", csv_file="./data.csv")
```

### Exceptions

- `DBError` - Raised when CLI command fails
- `ConfigError` - Raised for configuration errors

---

## Advanced Topics

### Custom Environment

```python
import os

env = os.environ.copy()
env['DB_PASSWORD'] = 'override-password'
env['ANTHROPIC_API_KEY'] = 'sk-ant-...'

db = DB(env=env)
```

### Output Formats

```python
# JSON (default) - returns list of dicts
results = db.csv("./data.csv", "SELECT * FROM data", format="json")
# [{'col1': 'val1', 'col2': 'val2'}, ...]

# CSV - returns CSV string
results = db.csv("./data.csv", "SELECT * FROM data", format="csv")
# "col1,col2\nval1,val2\n..."

# Table - returns formatted table
results = db.csv("./data.csv", "SELECT * FROM data", format="table")
# Pretty printed ASCII table
```

### Error Handling

```python
from db_sdk import DB, DBError, ConfigError

db = DB()

try:
    results = db.csv("./nonexistent.csv", "SELECT * FROM data")
except DBError as e:
    print(f"Query failed: {e}")

try:
    config = Config()
    config.set_active_datasource("nonexistent")
except ConfigError as e:
    print(f"Config error: {e}")
```

### Performance Tips

1. **Use DuckDB for large files (>10MB)**:
   ```python
   db.csv("./large.csv", "SELECT * FROM read_csv_auto('./large.csv')", engine="csv-duckdb")
   ```

2. **URL caching is automatic** - queries within 1 hour use cache

3. **Limit result sets during development**:
   ```python
   db.query("SELECT * FROM users LIMIT 100")
   ```

4. **Use JSON format for programmatic access**:
   ```python
   results = db.csv("./data.csv", "SELECT * FROM data", format="json")
   for row in results:
       print(row['column_name'])
   ```

### Working with Investigation Results

```python
result = db.investigate("analyze sales trends", csv_file="./sales.csv")

# Access structured data
print(result['answer'])           # Final answer
print(result['iterations'])       # Number of queries executed
print(result['raw_output'])       # Full investigation transcript

# Save investigation
with open('investigation_results.txt', 'w') as f:
    f.write(result['raw_output'])
```

---

## Examples

See `TEST_DATASETS.md` for more datasets and examples:
- Air travel analysis
- COVID-19 trends
- Weather patterns
- Stock market analysis
- Titanic survival factors
- College major outcomes

---

## Troubleshooting

**"db executable not found"**
- Ensure `db` script is in parent directory
- Or: `DB(db_path="/path/to/db")`

**"ANTHROPIC_API_KEY not set"**
- Set in `.env` or: `DB(anthropic_api_key="sk-ant-...")`

**"Datasource not found"**
- Check `config.engines.yaml` has the datasource defined
- Verify active_datasource setting

**"Cannot connect to PostgreSQL"**
- Verify DB_* environment variables in `.env`
- Test with CLI: `./db "SELECT 1"`

**CSV file not found**
- Use absolute paths or paths relative to execution directory

---

## License

Same as parent db CLI tool.

## Contributing

See main project contributing guidelines.
