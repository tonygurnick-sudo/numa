---
name: racetech-data
description: 'Query Racetech Moneyworks and e-commerce data. Use when the user asks about Racetech customers, sales, invoices, products, orders, stock levels, or any operational business data from Racetech Manufacturing.'
---

# Racetech Data Skill

Racetech Manufacturing's operational data is available as daily-refreshed SQLite databases in Company Files. This skill covers how to load, query, and present that data.

---

## Step 1: Download the Database

Download the Racetech database using the workspace environment credentials:

```python
import boto3, os

s3_key = "documents/company/racetech-data/server1_daily.sqlite"
dest   = "/workdir/uploads/files/server1_daily.sqlite"

os.makedirs(os.path.dirname(dest), exist_ok=True)
boto3.client("s3").download_file(os.environ["DATA_BUCKET_NAME"], s3_key, dest)
print(f"Downloaded → {dest}")
```

Run via `execute_script`. File lands at `/workdir/uploads/files/server1_daily.sqlite`.

If you get `NoSuchKey`, tell the user: "The Racetech data file is not yet available — Glenn needs to upload it. Contact Tony."

---

## Step 2: Open and Query

The database is already structured and indexed. Open it and run queries immediately — no conversion needed.

```python
import sqlite3
import pandas as pd

db = '/workdir/uploads/files/server1_daily.sqlite'
conn = sqlite3.connect(db)

# Verify the database is accessible
tables = pd.read_sql_query("SELECT name FROM sqlite_master WHERE type='table'", conn)
print("Tables:", tables['name'].tolist())
```

---

## Database Schema

### `name` — Customers and Suppliers (19,462 records)

The core entity. Every customer and supplier is a record in `name`.

| Key Field        | Type     | Description                                                              |
| ---------------- | -------- | ------------------------------------------------------------------------ |
| `code`           | varchar  | **Primary key** — unique customer/supplier code                          |
| `sequencenumber` | integer  | Numeric ID — used as FK in `contact` and `transactions` (via `namecode`) |
| `name`           | varchar  | Full customer/supplier name                                              |
| `email`          | varchar  | Primary email                                                            |
| `phone`          | varchar  | Primary phone                                                            |
| `mobile`         | varchar  | Mobile phone                                                             |
| `address1`–`4`   | varchar  | Postal address lines                                                     |
| `postcode`       | varchar  | Postcode                                                                 |
| `state`          | varchar  | State/region                                                             |
| `addresscountry` | varchar  | Country                                                                  |
| `currency`       | varchar  | Default currency code (NZD, AUD, USD, GBP, EUR)                          |
| `category1`–`4`  | varchar  | Analysis categories for segmentation                                     |
| `salesperson`    | varchar  | Assigned salesperson initials                                            |
| `creditlimit`    | numeric  | Credit limit                                                             |
| `dbalance`       | numeric  | Current debtor balance                                                   |
| `dateoflastsale` | datetime | Date of most recent sale                                                 |
| `hold`           | boolean  | True if account is on hold                                               |
| `kind`           | integer  | 1=Debtor (customer), 2=Creditor (supplier), 3=Both                       |
| `taxnumber`      | varchar  | GST/VAT registration number                                              |

### `contact` — Contact People (347 records)

Child records of `name` for individual contacts at a company.

| Key Field        | Type    | Description                    |
| ---------------- | ------- | ------------------------------ |
| `sequencenumber` | integer | Primary key                    |
| `parentseq`      | integer | **FK → `name.sequencenumber`** |
| `contact`        | varchar | Contact person's name          |
| `email`          | varchar | Contact's email                |
| `mobile`         | varchar | Contact's mobile               |
| `ddi`            | varchar | Direct dial number             |
| `position`       | varchar | Job title                      |

### `products` — Stock Items (3,328 records)

All products/parts Racetech sells or purchases.

| Key Field        | Type    | Description                                 |
| ---------------- | ------- | ------------------------------------------- |
| `sequencenumber` | integer | Primary key                                 |
| `code`           | varchar | **Unique product code** (e.g. RTTBNETGUIDE) |
| `description`    | varchar | Product name/description                    |
| `type`           | varchar | P=Product, R=Resource, S=Service            |
| `category1`–`4`  | varchar | Analysis categories                         |
| `sellprice`      | numeric | Standard sell price (GST exclusive)         |
| `costprice`      | numeric | Standard cost price                         |
| `stockonhand`    | numeric | Current stock quantity (sell units)         |
| `stockvalue`     | numeric | Total value of stock on hand                |
| `sellunit`       | varchar | Selling unit (ea, kg, etc.)                 |
| `supplier`       | varchar | Default supplier code (→ `name.code`)       |
| `reorderlevel`   | numeric | Reorder warning threshold                   |
| `barcode`        | varchar | Barcode                                     |
| `comment`        | text    | Extended product notes                      |

### `transactions` — All Transactions (22,558 records, since Jan 2023)

Every financial transaction: invoices, sales orders, credits, journals, quotes.

| Key Field         | Type     | Description                                            |
| ----------------- | -------- | ------------------------------------------------------ |
| `sequencenumber`  | integer  | **Primary key**                                        |
| `namecode`        | varchar  | **FK → `name.code`** — the customer/supplier           |
| `type`            | varchar  | Transaction type (see below)                           |
| `ourref`          | varchar  | Racetech's reference number (e.g. RT69057, SRT32595)   |
| `theirref`        | varchar  | Customer's PO number                                   |
| `transdate`       | datetime | Transaction date                                       |
| `enterdate`       | datetime | Date entered into system (use for ordering)            |
| `status`          | varchar  | U=Unposted (draft), P=Posted (finalised), blank=posted |
| `gross`           | numeric  | Total gross amount (inc. tax)                          |
| `taxamount`       | numeric  | GST/VAT amount                                         |
| `amtpaid`         | numeric  | Amount paid to date                                    |
| `duedate`         | datetime | Payment due date                                       |
| `description`     | varchar  | Transaction description/notes                          |
| `salesperson`     | varchar  | Salesperson initials                                   |
| `currency`        | varchar  | Transaction currency                                   |
| `deliveryaddress` | varchar  | Delivery address for this transaction                  |

### Transaction Types

| Code  | Meaning                  | Count  | Notes                                            |
| ----- | ------------------------ | ------ | ------------------------------------------------ |
| `DIC` | Debtor Invoice (Credit)  | 11,137 | **Main sales invoices** — money owed to Racetech |
| `SOC` | Sales Order (Credit)     | 7,229  | Sales orders (not yet invoiced)                  |
| `JNS` | Journal (Standard)       | 2,993  | Accounting journals                              |
| `QU`  | Quote                    | 895    | Customer quotes                                  |
| `DII` | Debtor Invoice (Invoice) | 273    | Internal invoice references                      |
| `SOI` | Sales Order (Invoice)    | 31     | Invoiced sales orders                            |

**For revenue/sales analysis, filter on `type IN ('DIC', 'SOI')` (posted invoices).**

### `details` — Transaction Line Items (211,447 records)

Every line on every transaction.

| Key Field        | Type    | Description                            |
| ---------------- | ------- | -------------------------------------- |
| `sequencenumber` | integer | Primary key                            |
| `parentseq`      | integer | **FK → `transactions.sequencenumber`** |
| `stockcode`      | varchar | **FK → `products.code`**               |
| `description`    | text    | Line description                       |
| `stockqty`       | numeric | Quantity                               |
| `unitprice`      | numeric | Price per unit (GST exclusive)         |
| `gross`          | numeric | Line gross value                       |
| `tax`            | numeric | Tax on this line                       |
| `discount`       | numeric | Discount percentage                    |
| `taxcode`        | varchar | Tax code (E=exempt, S=standard, etc.)  |
| `account`        | varchar | GL account code                        |
| `dept`           | varchar | Department code                        |
| `sort`           | integer | Line order within transaction          |

---

## Key Relationships

```
name.code ──────────────────── transactions.namecode     (customer on a transaction)
name.sequencenumber ─────────── contact.parentseq        (contacts at a company)
transactions.sequencenumber ─── details.parentseq         (line items on a transaction)
products.code ───────────────── details.stockcode         (product on a line item)
```

---

## Common Query Patterns

### Customer lookup and summary

```python
import sqlite3
import pandas as pd

conn = sqlite3.connect('/workdir/uploads/files/server1_daily.sqlite')

# Find a customer by name or code
customer = pd.read_sql_query("""
    SELECT code, name, email, phone, mobile, address1, address2, postcode,
           addresscountry, currency, dbalance, dateoflastsale, salesperson
    FROM name
    WHERE name LIKE '%search_term%' OR code LIKE '%search_term%'
    ORDER BY name
""", conn)
print(customer)
```

### Sales invoices for a customer

```python
invoices = pd.read_sql_query("""
    SELECT t.ourref, t.transdate, t.gross, t.taxamount, t.amtpaid,
           t.duedate, t.status, t.description, t.currency
    FROM transactions t
    WHERE t.namecode = 'CUSTOMER_CODE'
      AND t.type IN ('DIC', 'SOI')
    ORDER BY t.transdate DESC
""", conn)
print(invoices)
```

### Revenue by customer (this year or date range)

```python
revenue = pd.read_sql_query("""
    SELECT t.namecode, n.name, n.addresscountry,
           COUNT(*) as invoice_count,
           SUM(t.gross) as total_gross,
           SUM(t.taxamount) as total_tax,
           SUM(t.amtpaid) as total_paid
    FROM transactions t
    JOIN name n ON t.namecode = n.code
    WHERE t.type IN ('DIC', 'SOI')
      AND t.transdate >= '2025-01-01'
    GROUP BY t.namecode, n.name, n.addresscountry
    ORDER BY total_gross DESC
    LIMIT 20
""", conn)
print(revenue)
```

### Monthly revenue trend

```python
monthly = pd.read_sql_query("""
    SELECT strftime('%Y-%m', transdate) as month,
           COUNT(*) as invoice_count,
           SUM(gross) as total_gross,
           SUM(taxamount) as total_tax
    FROM transactions
    WHERE type IN ('DIC', 'SOI')
      AND transdate >= '2023-01-01'
    GROUP BY strftime('%Y-%m', transdate)
    ORDER BY month
""", conn)
print(monthly)
```

### Top selling products

```python
top_products = pd.read_sql_query("""
    SELECT d.stockcode, p.description,
           SUM(d.stockqty) as total_qty,
           SUM(d.gross) as total_revenue,
           COUNT(DISTINCT d.parentseq) as order_count
    FROM details d
    JOIN transactions t ON d.parentseq = t.sequencenumber
    LEFT JOIN products p ON d.stockcode = p.code
    WHERE t.type IN ('DIC', 'SOI')
      AND t.transdate >= '2025-01-01'
      AND d.stockcode != 'FREIGHT'
    GROUP BY d.stockcode, p.description
    ORDER BY total_revenue DESC
    LIMIT 20
""", conn)
print(top_products)
```

### Stock on hand (low stock / reorder alerts)

```python
stock = pd.read_sql_query("""
    SELECT code, description, stockonhand, reorderlevel, sellunit,
           costprice, sellprice, supplier
    FROM products
    WHERE type = 'P'
      AND stockonhand <= reorderlevel
      AND reorderlevel > 0
    ORDER BY (stockonhand - reorderlevel) ASC
""", conn)
print(stock)
```

### What did a customer buy? (with product details)

```python
customer_purchases = pd.read_sql_query("""
    SELECT t.ourref, t.transdate, t.type,
           d.stockcode, d.description, d.stockqty, d.unitprice, d.gross
    FROM transactions t
    JOIN details d ON d.parentseq = t.sequencenumber
    WHERE t.namecode = 'CUSTOMER_CODE'
      AND t.type IN ('DIC', 'SOI', 'SOC')
    ORDER BY t.transdate DESC, d.sort
""", conn)
print(customer_purchases)
```

### Outstanding invoices (unpaid)

```python
outstanding = pd.read_sql_query("""
    SELECT t.ourref, t.namecode, n.name,
           t.transdate, t.duedate,
           t.gross, t.amtpaid, (t.gross - t.amtpaid) as outstanding,
           t.currency
    FROM transactions t
    JOIN name n ON t.namecode = n.code
    WHERE t.type = 'DIC'
      AND t.gross > t.amtpaid
      AND t.status != 'U'
    ORDER BY t.duedate ASC
""", conn)
print(outstanding)
```

### Sales by country / region

```python
by_country = pd.read_sql_query("""
    SELECT n.addresscountry as country,
           COUNT(DISTINCT t.namecode) as customer_count,
           COUNT(t.sequencenumber) as invoice_count,
           SUM(t.gross) as total_revenue
    FROM transactions t
    JOIN name n ON t.namecode = n.code
    WHERE t.type IN ('DIC', 'SOI')
      AND t.transdate >= '2025-01-01'
    GROUP BY n.addresscountry
    ORDER BY total_revenue DESC
""", conn)
print(by_country)
```

---

## Multiple Databases (Opencart / CMS)

Additional databases will be added to `documents/company/racetech-data/` as they become available:

| File                   | Contents                               |
| ---------------------- | -------------------------------------- |
| `server1_daily.sqlite` | Moneyworks: customers, invoices, stock |
| `nz-opencart.sqlite`   | New Zealand online store orders        |
| `usa-opencart.sqlite`  | USA online store orders                |
| `au-opencart.sqlite`   | Australia online store orders          |
| `eu-opencart.sqlite`   | Europe online store orders             |
| `cms.sqlite`           | CMS hub: logs, cross-site data         |

Download additional files the same way:

```python
import boto3, os

s3_key = "documents/company/racetech-data/nz-opencart.sqlite"
dest   = f"/workdir/uploads/files/{os.path.basename(s3_key)}"

os.makedirs(os.path.dirname(dest), exist_ok=True)
boto3.client("s3").download_file(os.environ["DATA_BUCKET_NAME"], s3_key, dest)
print(f"Downloaded → {dest}")
```

---

## Presenting Results

### For conversational answers (simple queries)

Return data as a clean markdown table using pandas `.to_markdown()` or a concise summary.

```python
print(result.to_markdown(index=False))
```

### For reports and dashboards (use HTML)

```python
html = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Racetech Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 24px; }
  .header { background: #8e50a7; color: white; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; font-weight: 600; }
  .header p { opacity: 0.85; margin-top: 4px; font-size: 14px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .metric-card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .metric-value { font-size: 28px; font-weight: 700; color: #8e50a7; }
  .metric-label { font-size: 13px; color: #666; margin-top: 4px; }
  .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 16px; }
  .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 14px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 13px; }
  th { background: #f9f5fb; color: #6a3a7d; font-weight: 600; }
  td.number { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <div class="header">
    <h1>Racetech Sales Report</h1>
    <p>Data as of {date}</p>
  </div>
  <!-- Add metrics and tables here -->
</body>
</html>'''

with open('/workdir/outputs/racetech_report.html', 'w') as f:
    f.write(html)
print("Report saved: /workdir/outputs/racetech_report.html")
```

---

## Tips

- **Currency**: Racetech trades in NZD, AUD, USD, GBP, EUR. The `gross` field is in the transaction's currency. Join `name.currency` or check `transactions.currency` for multi-currency analysis.
- **Tax**: `taxamount` is GST/VAT. `gross` is the tax-inclusive total. For ex-GST: `gross - taxamount`.
- **Unposted transactions**: `status = 'U'` means draft/unposted. Exclude with `AND status != 'U'` for confirmed figures.
- **FREIGHT lines**: Details often include a `FREIGHT` stockcode line — exclude from product analysis with `AND d.stockcode != 'FREIGHT'`.
- **Date format**: All dates are stored as `YYYY-MM-DD HH:MM:SS`. Filter with `>= '2025-01-01'` style comparisons.
- **Always close the connection**: Add `conn.close()` at the end of your script.
