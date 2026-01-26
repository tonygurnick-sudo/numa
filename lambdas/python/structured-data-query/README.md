# DB CLI - Intelligent Database Query Tool

A powerful, AI-enhanced command-line tool for querying databases using SQL or natural language. Supports PostgreSQL, SQLite, S3 CSV files, AWS Athena, DuckDB, and more.

## Features

### 🎯 Core Capabilities
- **Direct SQL Queries**: Execute SQL against any configured datasource
- **Natural Language Mode** (`--ask`): Convert English questions to SQL automatically
- **Agentic Investigation** (`--auto`): AI conducts multi-hop investigations autonomously
- **Multiple Datasources**: PostgreSQL, SQLite, S3, CSV, Parquet, and more
- **Token-Optimized Output**: Automatic truncation and pagination for large results
- **Multiple Output Formats**: CSV, JSON, or pretty tables

### 🤖 AI-Powered Features

#### Single Query Mode (`--ask`)
Convert natural language to SQL and get instant answers:
```bash
db --ask "how many users registered this month?"
```

**How it works:**
1. Claude AI converts your question to SQL
2. Query executes against your database
3. Results are analyzed and explained in natural language
4. Both the answer AND raw data are shown

**Model**: Claude Sonnet 4.5 (high quality)
**Cost**: ~$0.02 per query

#### Agentic Investigation Mode (`--ask --auto`)
AI conducts full database investigations autonomously:
```bash
db --ask "why are our API response times slow?" --auto
```

**How it works:**
1. AI breaks down your question into investigation phases
2. Executes multiple queries iteratively (up to 20)
3. Builds understanding across queries using memory store
4. Adapts strategy based on findings
5. Synthesizes comprehensive answer with evidence

**Model**: Claude Haiku 3.5 (cost-optimized)
**Cost**: ~$0.001-$0.008 per iteration
**Phases**: Reconnaissance → Exploration → Investigation → Analysis → Validation → Synthesis

## Installation

### Requirements
- Bash 4.0+ (for associative arrays)
- `psql` (for PostgreSQL datasources)
- `sqlite3` (for SQLite datasources)
- `jq` (for JSON processing)
- `curl` (for API calls)
- **Optional**: AWS CLI (for S3/Athena), Python + pandas (for CSV), DuckDB

```
sudo apt-get update && sudo apt-get install -y sqlite3

wget https://github.com/duckdb/duckdb/releases/download/v1.1.3/duckdb_cli-linux-amd64.zip && unzip duckdb_cli-linux-amd64.zip && sudo mv duckdb /usr/local/bin/ && rm duckdb_cli-linux-amd64.zip && duckdb --version
```

### Quick Start

1. **Clone or download** this tool

2. **Copy the example config:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env`** and add your credentials:
   ```bash
   # Required for AI features
   ANTHROPIC_API_KEY=sk-ant-your-key-here

   # PostgreSQL example
   DB_HOST=your-database.com
   DB_PORT=5432
   DB_NAME=mydb
   DB_USER=myuser
   DB_PASSWORD=your-password
   ```

4. **Load environment variables:**
   ```bash
   source .env
   export PGPASSWORD="$DB_PASSWORD"  # For PostgreSQL
   ```

5. **Edit `config.yaml`** to configure your datasources
   - Set `active_datasource` to your default datasource
   - Configure connection settings for each datasource
   - Add custom datasources as needed

6. **Make executable and create symlink** (optional):
   ```bash
   chmod +x db
   ln -sf $(pwd)/db ~/.local/bin/db
   ```

7. **Test it:**
   ```bash
   db "SELECT version();"
   ```

## Configuration

### Config File Structure

The `config.yaml` file uses a simple, declarative format. Each datasource defines:

1. **Connection settings** - How to connect
2. **Query command** - How to execute queries (use `{{QUERY}}` placeholder)
3. **Schema command** - How to get database schema
4. **Format options** - How to format output (CSV, JSON, table)

### Example: PostgreSQL Datasource

```yaml
datasources:
  production:
    type: postgres
    description: "Production database"

    connection:
      host_env: DB_HOST          # Load from environment variable
      port_env: DB_PORT
      database_env: DB_NAME
      user_env: DB_USER
      password_env: DB_PASSWORD

    query_command: |
      psql -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -U "$DB_USER" --csv -c "{{QUERY}}"

    schema_command: |
      psql -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -U "$DB_USER" -c "\dt"
```

### Example: SQLite Datasource

```yaml
datasources:
  local_sqlite:
    type: sqlite
    description: "Local SQLite database"

    connection:
      database_path: ./data.db

    query_command: |
      sqlite3 -csv "$SQLITE_DB_PATH" "{{QUERY}}"

    schema_command: |
      sqlite3 "$SQLITE_DB_PATH" ".schema"
```

### Example: S3 CSV Datasource

```yaml
datasources:
  s3_csv_data:
    type: s3-csv-sqlite
    description: "CSV in S3, queried via SQLite"

    connection:
      bucket: my-data-bucket
      csv_path: data/sales.csv

    download_command: |
      aws s3 cp s3://my-data-bucket/data/sales.csv /tmp/db_cli_temp.csv

    import_command: |
      sqlite3 /tmp/db_cli_temp.db ".mode csv" ".import /tmp/db_cli_temp.csv data"

    query_command: |
      sqlite3 -csv /tmp/db_cli_temp.db "{{QUERY}}"

    cleanup_command: |
      rm -f /tmp/db_cli_temp.csv /tmp/db_cli_temp.db
```

## Usage

### Basic SQL Queries

```bash
# Execute SQL directly
db "SELECT * FROM users LIMIT 10;"

# Get database schema
db schema

# With specific datasource
db --datasource production "SELECT COUNT(*) FROM orders;"

# Different output format
db --format json "SELECT * FROM products LIMIT 5;"
```

### Natural Language Queries

```bash
# Simple question
db --ask "how many users do we have?"

# Complex question with single query
db --ask "show me the top 10 products by sales this month"

# With specific datasource
db --datasource production --ask "what's the average order value?"
```

### Agentic Investigation Mode

```bash
# Let AI investigate autonomously
db --ask "why are threads failing?" --auto

# Complex multi-table investigation
db --ask "what patterns exist in our error logs?" --auto

# Performance analysis
db --ask "which queries are slowing down the system?" --auto
```

### Output Control

```bash
# Verbose mode (no truncation)
db --verbose "SELECT * FROM large_table;"

# Paginate through cached results
db --id a1b2c3d4 --start 201 --offset 100

# Change output format
db --format csv "SELECT * FROM data;"
db --format json "SELECT * FROM data;"
db --format table "SELECT * FROM data;"
```

## AI Modes Explained

### Single Query Mode (`--ask`)

**Use when**: You have a specific question that can be answered with one query

**Process**:
1. Your question → Claude generates SQL
2. SQL executes → Returns results
3. Claude analyzes results → Generates natural language answer
4. Shows both answer and raw data

**Example**:
```bash
$ db --ask "how many active users do we have?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUESTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
how many active users do we have?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERATED SQL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT COUNT(*) FROM users WHERE status = 'active';

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANSWER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
There are 1,543 active users in the database.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RAW QUERY RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
count
1543
```

### Agentic Investigation Mode (`--ask --auto`)

**Use when**: You need deep investigation across multiple queries

**Process**:
1. AI conducts 6-phase investigation
2. Executes multiple queries iteratively
3. Maintains context using STORE/RECALL memory
4. Adapts strategy based on findings
5. Synthesizes comprehensive answer

**Investigation Phases**:
- **Phase 1**: Reconnaissance & Schema Discovery
- **Phase 2**: Initial Exploration (Hop 1)
- **Phase 3**: Targeted Investigation (Hop 2)
- **Phase 4**: Deep Analysis (Hop 3+)
- **Phase 5**: Refinement & Validation
- **Phase 6**: Synthesis & Reporting

**Example**:
```bash
$ db --ask "why are orders failing?" --auto

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENTIC INVESTIGATION MODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Question: why are orders failing?
Max iterations: 20
Model: claude-3-5-haiku-20241022

┌─────────────────────────────────────────────┐
│ ITERATION 1/20
└─────────────────────────────────────────────┘

Decision: CONTINUE
Phase: Phase 1
Reasoning: Starting reconnaissance. Need to understand order table structure and failure patterns...

SQL Query:
SELECT status, COUNT(*) FROM orders GROUP BY status;

Executing...
Results (preview):
status,count
completed,8543
failed,234
pending,67

┌─────────────────────────────────────────────┐
│ ITERATION 2/20
└─────────────────────────────────────────────┘

Decision: CONTINUE
Phase: Phase 2
Reasoning: Found 234 failed orders (2.7%). Now investigating failure reasons...

[... continues with more iterations ...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INVESTIGATION COMPLETE (5 iterations)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Orders are failing primarily due to payment processor timeouts (67% of failures).
The issue is concentrated in orders above $500, which trigger additional fraud
checks. Peak failure times align with high-traffic hours (2-4 PM UTC).
Recommendation: Increase timeout threshold for large orders and implement retry logic.

AGENT MEMORY:
─────────────────────────────────────────────
  total_orders = 8844
  failed_orders = 234
  failure_rate = 2.7%
  primary_cause = payment_timeout
  affected_range = orders > $500
─────────────────────────────────────────────
```

## Advanced Features

### Multi-Datasource Support

Switch between datasources easily:

```bash
# Use production database
db --datasource production "SELECT * FROM users;"

# Query local SQLite
db --datasource local_sqlite "SELECT * FROM cache;"

# Query S3 CSV files
db --datasource s3_csv_data "SELECT * FROM data WHERE year = 2024;"
```

### Output Truncation & Pagination

Large results are automatically truncated to save tokens:

```bash
# Output too large - gets truncated
$ db "SELECT * FROM huge_table;"

... [1,234 lines omitted] ...
Output ID: a1b2c3d4
TIP: Use --verbose to see all lines
     Or: db --id a1b2c3d4 --start 201 --offset 100

# View full output
$ db --verbose "SELECT * FROM huge_table;"

# Or paginate through cached results
$ db --id a1b2c3d4 --start 1 --offset 100
$ db --id a1b2c3d4 --start 101 --offset 100
```

### Custom Datasources

Add your own datasources to `config.yaml`:

```yaml
datasources:
  my_custom_db:
    type: custom
    description: "My custom database"

    connection:
      host: mydb.example.com
      custom_env: MY_DB_TOKEN

    query_command: |
      mycli --host mydb.example.com --token "$MY_DB_TOKEN" --query "{{QUERY}}"

    schema_command: |
      mycli --host mydb.example.com --token "$MY_DB_TOKEN" --command "SHOW TABLES"
```

## Security Best Practices

1. **Never commit credentials**
   - Keep `.env` out of git (add to `.gitignore`)
   - Use environment variables for all secrets
   - Rotate credentials regularly

2. **Use read-only database users** for queries
   ```sql
   -- PostgreSQL example
   CREATE USER readonly_user WITH PASSWORD 'secure_password';
   GRANT CONNECT ON DATABASE mydb TO readonly_user;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
   ```

3. **Limit API key permissions**
   - Use restricted API keys when possible
   - Monitor API usage and costs

4. **Be cautious with `--auto` mode**
   - AI generates queries autonomously
   - Review generated SQL in investigation trail
   - Use with read-only credentials

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
```bash
export ANTHROPIC_API_KEY='sk-ant-your-key-here'
```

### "Connection refused" (PostgreSQL)
- Check `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- Verify network access to database
- Check firewall rules

### "sqlite3: command not found"
```bash
# macOS
brew install sqlite3

# Ubuntu/Debian
sudo apt-get install sqlite3

# Fedora
sudo dnf install sqlite
```

### Large output causing issues
Use `--verbose` flag or pagination:
```bash
db --id <output_id> --start 1 --offset 100
```

## Supported Datasources

### Currently Implemented
- ✅ **PostgreSQL** (via `psql`)
- ✅ **SQLite** (via `sqlite3`)

### Planned/Example Configs Provided
- 📝 **S3 CSV → SQLite** (download and query)
- 📝 **AWS Athena** (serverless S3 SQL)
- 📝 **DuckDB** (fast analytical queries on CSV/Parquet)
- 📝 **Pandas** (Python-based CSV querying)

### Adding Your Own
Simply edit `config.yaml` and define:
1. Connection instructions
2. Query command template
3. Schema command
4. Optional: cleanup, import, download commands

## Cost Estimates

### AI Features Pricing

**Single Query Mode** (`--ask`):
- Model: Claude Sonnet 4.5
- Cost: ~$0.02 per query
- Queries: 2 API calls (SQL generation + answer generation)

**Agentic Mode** (`--ask --auto`):
- Model: Claude Haiku 3.5
- Cost: ~$0.001-$0.008 per iteration
- Max iterations: 20 (configurable)
- Total cost: $0.02-$0.16 per investigation
- Most investigations complete in 3-7 iterations

### Database Costs
- Depends on your database provider
- Use connection pooling for production
- Consider read replicas for analytics queries

## Performance Tips

1. **Use specific columns** instead of `SELECT *`
2. **Add LIMIT clauses** for exploratory queries
3. **Create indexes** on frequently queried columns
4. **Use connection pooling** for production databases
5. **Cache schema** if querying repeatedly
6. **Use read replicas** for analytics workloads

## Contributing

Contributions welcome! To add a new datasource:

1. Add configuration to `config.yaml`
2. Test query command with various SQL patterns
3. Test schema command
4. Document any required dependencies
5. Add example usage to README

## License

[Your License Here - MIT/Apache 2.0 recommended]

## Support

- **Issues**: [Your Issue Tracker]
- **Documentation**: This README
- **Security Issues**: See SECURITY.md

## Changelog

### Version 4.0 (Current)
- ✨ Agentic investigation mode with multi-hop reasoning
- ✨ STORE/RECALL memory system for AI agents
- ✨ Configuration file support for multiple datasources
- ✨ Removed hardcoded credentials (security fix)
- ✨ Support for S3, SQLite, and custom datasources

### Version 2.0
- ✨ Natural language SQL generation (`--ask`)
- ✨ Automatic answer generation from results
- ✨ Schema-aware query generation

### Version 1.0
- ✨ Direct SQL query execution
- ✨ Output truncation and pagination
- ✨ Multiple output formats (CSV, JSON, table)
- ✨ Token-optimized formatting

## Examples

### Quick Reference

```bash
# Basic SQL
db "SELECT * FROM users LIMIT 10;"

# Natural language (single query)
db --ask "show me recent orders"

# Agentic investigation
db --ask "what's causing the spike in errors?" --auto

# Different datasource
db --datasource local_sqlite "SELECT * FROM cache;"

# JSON output
db --format json "SELECT * FROM products;"

# Verbose (no truncation)
db --verbose "SELECT * FROM large_table;"

# Get schema
db schema

# Switch default datasource
# Edit config.yaml: active_datasource: production
```

---

**Built with ❤️ for database productivity**
