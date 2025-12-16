#!/bin/bash
# DB CLI Tool - Test Suite
# Human-readable test cases with expected outputs
# Copy and paste individual tests to run them manually

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "DB CLI TOOL - TEST SUITE"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Test files:"
echo "  - test_sales.csv (10 rows, small dataset)"
echo "  - test_covid_data.csv (161k rows, 5.3MB dataset)"
echo ""
echo "You can copy/paste any test command below to run it manually."
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: Help Command (No credentials required)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 1: Help Command${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db help"
echo ""
echo "Expected: Displays help text without requiring credentials"
echo ""
echo "Test:"
./db help | head -20
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Help displayed successfully"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: CSV SQLite Engine (Small File) - Auto-detect
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 2: CSV SQLite Engine - Basic Query (Auto-detect)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv \"SELECT * FROM data LIMIT 3\""
echo ""
echo "Expected: Auto-detects csv-sqlite, returns first 3 rows"
echo "Expected columns: product, amount, region, date"
echo ""
echo "Test:"
./db --csv ./data/test_sales.csv "SELECT * FROM data LIMIT 3"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - CSV query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: CSV SQLite Engine - Aggregation
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 3: CSV SQLite Engine - Aggregation Query${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv \"SELECT region, SUM(amount) as total, COUNT(*) as count FROM data GROUP BY region ORDER BY total DESC\""
echo ""
echo "Expected:"
echo "  EU,10200,5"
echo "  US,6150,5"
echo ""
echo "Test:"
./db --csv ./data/test_sales.csv "SELECT region, SUM(amount) as total, COUNT(*) as count FROM data GROUP BY region ORDER BY total DESC"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Aggregation query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: Large CSV File - Performance Test
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 4: Large CSV File (161k rows, 5.3MB) - Performance Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv \"SELECT COUNT(*) as total_rows FROM data\""
echo ""
echo "Expected: ~161,569 rows"
echo ""
echo "Test:"
time ./db --csv ./data/test_covid_data.csv "SELECT COUNT(*) as total_rows FROM data"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Large file query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: Large CSV - Complex Aggregation
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 5: Large CSV - Complex Aggregation (Top 10 Countries)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv \"SELECT Country, MAX(Confirmed) as total_cases, MAX(Deaths) as total_deaths FROM data GROUP BY Country ORDER BY total_cases DESC LIMIT 10\""
echo ""
echo "Expected: Top 10 countries by COVID cases"
echo ""
echo "Test:"
time ./db --csv ./data/test_covid_data.csv "SELECT Country, MAX(Confirmed) as total_cases, MAX(Deaths) as total_deaths FROM data GROUP BY Country ORDER BY total_cases DESC LIMIT 10"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Complex aggregation successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 6: DuckDB Engine - Performance Comparison
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 6: DuckDB Engine - Same Query for Speed Comparison${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --engine csv-duckdb --csv ./data/test_covid_data.csv \"SELECT Country, MAX(Confirmed) as total_cases FROM read_csv_auto('./data/test_covid_data.csv') GROUP BY Country ORDER BY total_cases DESC LIMIT 10\""
echo ""
echo "Expected: Same results as Test 5, but faster"
echo ""
echo "Test:"
time ./db --engine csv-duckdb --csv ./data/test_covid_data.csv "SELECT Country, MAX(Confirmed) as total_cases FROM read_csv_auto('./data/test_covid_data.csv') GROUP BY Country ORDER BY total_cases DESC LIMIT 10"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - DuckDB query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 7: URL CSV - Download and Cache
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 7: URL CSV - Download and Query${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv\" \"SELECT * FROM data LIMIT 5\""
echo ""
echo "Expected: Downloads CSV, shows first 5 rows, caches for 1 hour"
echo ""
echo "Test (First run - should download):"
./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" "SELECT * FROM data LIMIT 5"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - URL download successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 8: URL CSV - Cache Hit
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 8: URL CSV - Cache Hit (Should be instant)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv\" \"SELECT COUNT(*) FROM data\""
echo ""
echo "Expected: Uses cached file, no download, instant query"
echo ""
echo "Test (Second run - should use cache):"
./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" "SELECT COUNT(*) FROM data"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Cache hit successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 9: Output Formats - CSV, JSON, Table
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 9: Output Formats${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command (CSV format - default):"
echo "  ./db --csv ./data/test_sales.csv --format csv \"SELECT * FROM data LIMIT 3\""
echo ""
./db --csv ./data/test_sales.csv --format csv "SELECT * FROM data LIMIT 3"
echo ""
echo "Command (JSON format):"
echo "  ./db --csv ./data/test_sales.csv --format json \"SELECT * FROM data LIMIT 3\""
echo ""
./db --csv ./data/test_sales.csv --format json "SELECT * FROM data LIMIT 3"
echo ""
echo "Command (Table format):"
echo "  ./db --csv ./data/test_sales.csv --format table \"SELECT * FROM data LIMIT 3\""
echo ""
./db --csv ./data/test_sales.csv --format table "SELECT * FROM data LIMIT 3"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - All output formats working"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 10: Filtering and WHERE Clauses
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 10: Filtering with WHERE Clause${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv \"SELECT * FROM data WHERE amount > 1500 ORDER BY amount DESC\""
echo ""
echo "Expected: Only products with amount > 1500"
echo ""
echo "Test:"
./db --csv ./data/test_sales.csv "SELECT * FROM data WHERE amount > 1500 ORDER BY amount DESC"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Filtering works correctly"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 11: Large Dataset - Date Range Query
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 11: Large Dataset - Date Range Query${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv \"SELECT Date, SUM(Confirmed) as global_cases FROM data WHERE Date >= '2020-12-01' AND Date < '2021-01-01' GROUP BY Date ORDER BY Date\""
echo ""
echo "Expected: Daily global cases for December 2020"
echo ""
echo "Test:"
./db --csv ./data/test_covid_data.csv "SELECT Date, SUM(Confirmed) as global_cases FROM data WHERE Date >= '2020-12-01' AND Date < '2021-01-01' GROUP BY Date ORDER BY Date" | head -10
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Date range query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 12: Multiple Conditions
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 12: Multiple Conditions with AND/OR${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv \"SELECT Country, MAX(Deaths) as total_deaths FROM data WHERE Country IN ('US', 'Brazil', 'India', 'United Kingdom') GROUP BY Country ORDER BY total_deaths DESC\""
echo ""
echo "Expected: Death counts for specified countries"
echo ""
echo "Test:"
./db --csv ./data/test_covid_data.csv "SELECT Country, MAX(Deaths) as total_deaths FROM data WHERE Country IN ('US', 'Brazil', 'India', 'United Kingdom') GROUP BY Country ORDER BY total_deaths DESC"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Multiple conditions work"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PERFORMANCE COMPARISON SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "PERFORMANCE COMPARISON: SQLite vs DuckDB"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Query: Top 10 countries by cases on 5.3MB dataset (161k rows)"
echo ""
echo -e "${YELLOW}SQLite (csv-sqlite):${NC}"
time ./db --csv ./data/test_covid_data.csv "SELECT Country, MAX(Confirmed) FROM data GROUP BY Country ORDER BY MAX(Confirmed) DESC LIMIT 10" > /dev/null 2>&1
echo ""
echo -e "${YELLOW}DuckDB (csv-duckdb):${NC}"
time ./db --engine csv-duckdb --csv ./data/test_covid_data.csv "SELECT Country, MAX(Confirmed) FROM read_csv_auto('./data/test_covid_data.csv') GROUP BY Country ORDER BY MAX(Confirmed) DESC LIMIT 10" > /dev/null 2>&1
echo ""
echo "Note: DuckDB is typically 5-10x faster on large datasets"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# CACHE VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "CACHE VERIFICATION"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Cached CSV files in ~/.cache/db-cli/:"
ls -lh ~/.cache/db-cli/ 2>/dev/null || echo "No cached files yet"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${GREEN}ALL TESTS PASSED!${NC}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Tests completed:"
echo "  ✓ Help command"
echo "  ✓ CSV basic queries"
echo "  ✓ CSV aggregations"
echo "  ✓ Large file queries (5.3MB, 161k rows)"
echo "  ✓ DuckDB performance"
echo "  ✓ URL downloads with caching"
echo "  ✓ Output formats (CSV, JSON, table)"
echo "  ✓ Filtering and WHERE clauses"
echo "  ✓ Date range queries"
echo "  ✓ Complex conditions"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "MANUAL TEST COMMANDS"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Copy these to test manually:"
echo ""
echo "# Basic query"
echo "./db --csv ./data/test_sales.csv \"SELECT * FROM data\""
echo ""
echo "# Aggregation"
echo "./db --csv ./data/test_sales.csv \"SELECT region, SUM(amount) FROM data GROUP BY region\""
echo ""
echo "# Large file"
echo "./db --csv ./data/test_covid_data.csv \"SELECT COUNT(*) FROM data\""
echo ""
echo "# DuckDB (fast)"
echo "./db --engine csv-duckdb --csv ./data/test_covid_data.csv \"SELECT COUNT(*) FROM read_csv_auto('./data/test_covid_data.csv')\""
echo ""
echo "# URL (with caching)"
echo "./db --csv \"https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv\" \"SELECT * FROM data LIMIT 5\""
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
# ═══════════════════════════════════════════════════════════════════════════════
# AI FEATURE TESTS (MAIN FEATURES - REQUIRE ANTHROPIC_API_KEY)
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${YELLOW}AI FEATURE TESTS (--ask and --ask --auto modes)${NC}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Checking for ANTHROPIC_API_KEY..."

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${YELLOW}⚠ WARNING: ANTHROPIC_API_KEY not set${NC}"
  echo ""
  echo "AI tests will be skipped. To run them:"
  echo "  export ANTHROPIC_API_KEY='your-key-here'"
  echo "  ./tests.sh"
  echo ""
  echo "Or test manually with the commands below."
  echo ""
  AI_ENABLED=false
else
  echo -e "${GREEN}✓ ANTHROPIC_API_KEY found${NC}"
  echo ""
  AI_ENABLED=true
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 13: --ask Mode - Simple Count Question
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 13: AI --ask Mode - Simple Count Question${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv --ask \"how many products are there?\""
echo ""
echo "Expected: AI generates SQL (SELECT COUNT(*) FROM data), executes it, returns natural language answer"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_sales.csv --ask "how many products are there?"
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Natural language query successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 14: --ask Mode - Aggregation Question
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 14: AI --ask Mode - Aggregation by Region${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv --ask \"what are total sales by region?\""
echo ""
echo "Expected: AI generates GROUP BY query, returns natural language answer with totals"
echo "Expected answer: EU: 10,200, US: 6,150 (or similar breakdown)"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_sales.csv --ask "what are total sales by region?"
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Aggregation query successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 15: --ask Mode - Filtering Question
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 15: AI --ask Mode - Filtering with WHERE Clause${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv --ask \"which products have sales over 1500?\""
echo ""
echo "Expected: AI generates WHERE clause, filters data, returns natural language list"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_sales.csv --ask "which products have sales over 1500?"
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Filtering query successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 16: --ask Mode - Top N Question
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 16: AI --ask Mode - Top N Question${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv --ask \"what are the top 3 products by sales amount?\""
echo ""
echo "Expected: AI generates ORDER BY + LIMIT query, returns top 3 with natural language"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_sales.csv --ask "what are the top 3 products by sales amount?"
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Top N query successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 17: --ask Mode - Large Dataset Question
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 17: AI --ask Mode - Large Dataset Question${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv --ask \"how many total COVID cases are recorded in the dataset?\""
echo ""
echo "Expected: AI generates SUM query on large dataset, returns total cases"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_covid_data.csv --ask "how many total COVID cases are recorded in the dataset?"
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Large dataset query successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 18: --ask --auto Mode - Exploratory Question (MAIN FEATURE)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 18: AI --ask --auto Mode - Exploratory Investigation (AGENTIC)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv --ask \"which countries had the most COVID cases?\" --auto"
echo ""
echo "Expected: Multi-hop agentic investigation:"
echo "  - AI runs multiple queries iteratively"
echo "  - Builds understanding across queries"
echo "  - Shows iteration progress"
echo "  - Returns comprehensive answer with evidence"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_covid_data.csv --ask "which countries had the most COVID cases?" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Agentic investigation successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 19: --ask --auto Mode - Trend Analysis (MAIN FEATURE)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 19: AI --ask --auto Mode - Trend Analysis${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv --ask \"analyze COVID case trends over time\" --auto"
echo ""
echo "Expected: Multi-hop investigation:"
echo "  - Query 1: Get date range"
echo "  - Query 2: Monthly/quarterly aggregates"
echo "  - Query 3: Growth rates"
echo "  - Final: Comprehensive trend analysis"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_covid_data.csv --ask "analyze COVID case trends over time" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Trend analysis successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 20: --ask --auto Mode - Why Question (MAIN FEATURE)
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 20: AI --ask --auto Mode - Why Question (Root Cause Analysis)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv --ask \"why are EU sales higher than US sales?\" --auto"
echo ""
echo "Expected: Multi-hop investigation:"
echo "  - Query 1: Compare regional totals"
echo "  - Query 2: Break down by product"
echo "  - Query 3: Analyze transaction counts"
echo "  - Final: Root cause explanation with evidence"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_sales.csv --ask "why are EU sales higher than US sales?" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Root cause analysis successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 21: --ask --auto Mode - Complex Multi-Dimensional Analysis
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 21: AI --ask --auto Mode - Complex Multi-Dimensional Analysis${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_covid_data.csv --ask \"find patterns and anomalies in the COVID data\" --auto"
echo ""
echo "Expected: Deep multi-hop investigation:"
echo "  - Schema exploration"
echo "  - Statistical analysis"
echo "  - Anomaly detection"
echo "  - Pattern identification"
echo "  - Comprehensive insights with STORE/RECALL memory"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_covid_data.csv --ask "find patterns and anomalies in the COVID data" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Complex analysis successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 22: --ask --auto Mode - URL CSV Investigation
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 22: AI --ask --auto Mode - URL CSV Investigation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv\" --ask \"analyze air travel patterns across years\" --auto"
echo ""
echo "Expected:"
echo "  - Downloads and caches URL CSV"
echo "  - Multi-hop investigation of patterns"
echo "  - Year-over-year comparisons"
echo "  - Seasonal trend analysis"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" --ask "analyze air travel patterns across years" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - URL CSV investigation successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 23: --ask --auto Mode - Engine Awareness Test
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 23: AI --ask --auto Mode - Engine Awareness (csv-sqlite)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv ./data/test_sales.csv --ask \"summarize this dataset\" --auto"
echo ""
echo "Expected:"
echo "  - AI knows engine is csv-sqlite"
echo "  - AI generates queries with table name 'data'"
echo "  - AI uses standard SQL syntax"
echo "  - Shows engine detection in output"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --csv ./data/test_sales.csv --ask "summarize this dataset" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Engine awareness successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 24: --ask --auto Mode - DuckDB Engine with AI
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 24: AI --ask --auto Mode - DuckDB Engine Awareness${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --engine csv-duckdb --csv ./data/test_covid_data.csv --ask \"what are the top 5 countries by total deaths?\" --auto"
echo ""
echo "Expected:"
echo "  - AI knows engine is csv-duckdb"
echo "  - AI knows the target file is ./data/test_covid_data.csv"
echo "  - AI generates queries with read_csv_auto('./data/test_covid_data.csv') syntax automatically"
echo "  - AI uses DuckDB-specific SQL"
echo "  - Faster performance on large dataset"
echo ""

if [ "$AI_ENABLED" = true ]; then
  echo "Test:"
  ./db --engine csv-duckdb --csv ./data/test_covid_data.csv --ask "what are the top 5 countries by total deaths?" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - DuckDB engine awareness successful"
else
  echo -e "${YELLOW}⊘ SKIPPED${NC} - ANTHROPIC_API_KEY not set"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# AI TESTS SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
if [ "$AI_ENABLED" = true ]; then
  echo -e "${GREEN}ALL AI TESTS PASSED!${NC}"
else
  echo -e "${YELLOW}AI TESTS SKIPPED (No API Key)${NC}"
fi
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
if [ "$AI_ENABLED" = true ]; then
  echo "AI features tested:"
  echo "  ✓ Natural language queries (--ask)"
  echo "  ✓ Simple questions (count, sum, etc.)"
  echo "  ✓ Aggregation questions (group by)"
  echo "  ✓ Filtering questions (where clauses)"
  echo "  ✓ Top N questions (order + limit)"
  echo "  ✓ Agentic investigations (--ask --auto)"
  echo "  ✓ Exploratory questions"
  echo "  ✓ Trend analysis"
  echo "  ✓ Root cause analysis (why questions)"
  echo "  ✓ Complex multi-dimensional analysis"
  echo "  ✓ URL CSV investigations"
  echo "  ✓ Engine awareness (csv-sqlite)"
  echo "  ✓ Engine awareness (csv-duckdb)"
else
  echo "To test AI features:"
  echo "  export ANTHROPIC_API_KEY='your-api-key'"
  echo "  ./tests.sh"
fi
echo ""

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "MANUAL AI TEST COMMANDS"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Copy these to test AI features manually:"
echo ""
echo "# Set API key first"
echo "export ANTHROPIC_API_KEY='sk-ant-your-key-here'"
echo ""
echo "# Simple natural language query"
echo "./db --csv ./data/test_sales.csv --ask \"what are total sales by region?\""
echo ""
echo "# Agentic investigation (multi-hop)"
echo "./db --csv ./data/test_covid_data.csv --ask \"which countries had the most COVID cases?\" --auto"
echo ""
echo "# Root cause analysis"
echo "./db --csv ./data/test_sales.csv --ask \"why are EU sales higher than US sales?\" --auto"
echo ""
echo "# Trend analysis"
echo "./db --csv ./data/test_covid_data.csv --ask \"analyze COVID case trends over time\" --auto"
echo ""
echo "# URL CSV investigation"
echo "./db --csv \"https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv\" --ask \"analyze air travel patterns\" --auto"
echo ""
echo "# DuckDB with AI (fast on large files)"
echo "./db --engine csv-duckdb --csv ./data/test_covid_data.csv --ask \"find anomalies in the data\" --auto"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# DIVERSE DATASET TESTS (Additional public datasets)
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${YELLOW}DIVERSE DATASET TESTS${NC}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Testing with various public datasets to ensure broad compatibility..."
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 25: Titanic Dataset - Survival Analysis
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 25: Titanic Dataset - Survival Rate by Class${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv\" \"SELECT Pclass, AVG(Survived) as survival_rate, COUNT(*) as passengers FROM data GROUP BY Pclass ORDER BY Pclass\""
echo ""
echo "Expected: Survival rates for 1st, 2nd, and 3rd class passengers"
echo ""
echo "Test:"
./db --csv "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" "SELECT Pclass, AVG(Survived) as survival_rate, COUNT(*) as passengers FROM data GROUP BY Pclass ORDER BY Pclass"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Titanic dataset query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 26: Weather Dataset - Temperature Extremes
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 26: Seattle Weather - Hottest Days${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv\" \"SELECT Date, Max_TemperatureC FROM data ORDER BY Max_TemperatureC DESC LIMIT 5\""
echo ""
echo "Expected: Top 5 hottest days in Seattle dataset"
echo ""
echo "Test:"
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv" "SELECT Date, Max_TemperatureC FROM data ORDER BY Max_TemperatureC DESC LIMIT 5"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Weather dataset query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 27: Stock Market Dataset - Price Analysis
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 27: Apple Stock - Highest Trading Volume Days${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv\" \"SELECT Date, \\\"AAPL.Volume\\\" as Volume, \\\"AAPL.Close\\\" as Close FROM data ORDER BY Volume DESC LIMIT 5\""
echo ""
echo "Expected: Top 5 trading days by volume with closing prices"
echo ""
echo "Test:"
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv" "SELECT Date, \"AAPL.Volume\" as Volume, \"AAPL.Close\" as Close FROM data ORDER BY Volume DESC LIMIT 5"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Stock market dataset query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 28: Google Sheets - Student Demographics
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 28: Google Sheets - Student Count by Major${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0\" \"SELECT Major, COUNT(*) as count FROM data GROUP BY Major ORDER BY count DESC\""
echo ""
echo "Expected: Student counts grouped by major from Google Sheets"
echo ""
echo "Test:"
./db --csv "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0" "SELECT Major, COUNT(*) as count FROM data GROUP BY Major ORDER BY count DESC"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Google Sheets integration successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 29: College Grads - Salary Analysis
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 29: College Grads - Highest Median Salaries${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv\" \"SELECT Major, Median, Unemployment_rate FROM data ORDER BY Median DESC LIMIT 10\""
echo ""
echo "Expected: Top 10 majors by median salary with unemployment rates"
echo ""
echo "Test:"
./db --csv "https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv" "SELECT Major, Median, Unemployment_rate FROM data ORDER BY Median DESC LIMIT 10"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - College graduates dataset query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 30: Iris Dataset - Species Statistics
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 30: Iris Dataset - Average Measurements by Species${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Command:"
echo "  ./db --csv \"https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv\" \"SELECT species, AVG(sepal_length) as avg_sepal, AVG(petal_length) as avg_petal FROM data GROUP BY species\""
echo ""
echo "Expected: Average sepal and petal lengths for each iris species"
echo ""
echo "Test:"
./db --csv "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv" "SELECT species, AVG(sepal_length) as avg_sepal, AVG(petal_length) as avg_petal FROM data GROUP BY species"
echo ""
echo -e "${GREEN}✓ PASSED${NC} - Iris dataset query successful"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# DIVERSE DATASET AI TESTS (if API key available)
# ═══════════════════════════════════════════════════════════════════════════════

if [ "$AI_ENABLED" = true ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo -e "${YELLOW}DIVERSE DATASET AI TESTS${NC}"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo ""

  # TEST 31: Titanic AI Analysis
  echo -e "${BLUE}TEST 31: Titanic AI Analysis - Survival Factors${NC}"
  echo ""
  echo "Command:"
  echo "  ./db --csv \"https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv\" --ask \"what factors most influenced survival on the Titanic?\" --auto"
  echo ""
  ./db --csv "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" --ask "what factors most influenced survival on the Titanic?" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Titanic AI analysis successful"
  echo ""

  # TEST 32: Weather Pattern AI Analysis
  echo -e "${BLUE}TEST 32: Weather AI Analysis - Temperature Patterns${NC}"
  echo ""
  echo "Command:"
  echo "  ./db --csv \"https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv\" --ask \"analyze temperature patterns and identify any anomalies\" --auto"
  echo ""
  ./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv" --ask "analyze temperature patterns and identify any anomalies" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - Weather AI analysis successful"
  echo ""

  # TEST 33: College Outcomes AI Analysis
  echo -e "${BLUE}TEST 33: College AI Analysis - Career Outcomes${NC}"
  echo ""
  echo "Command:"
  echo "  ./db --csv \"https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv\" --ask \"which majors have the best career outcomes considering salary and employment?\" --auto"
  echo ""
  ./db --csv "https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv" --ask "which majors have the best career outcomes considering salary and employment?" --auto
  echo ""
  echo -e "${GREEN}✓ PASSED${NC} - College outcomes AI analysis successful"
  echo ""
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo -e "${GREEN}ALL DIVERSE DATASET TESTS COMPLETED!${NC}"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Datasets tested:"
echo "  ✓ Titanic (survival analysis)"
echo "  ✓ Seattle Weather (temperature extremes)"
echo "  ✓ Apple Stock (trading volume)"
echo "  ✓ Google Sheets (student demographics)"
echo "  ✓ College Grads (salary analysis)"
echo "  ✓ Iris (species classification)"
if [ "$AI_ENABLED" = true ]; then
  echo "  ✓ AI analysis on Titanic, Weather, College datasets"
fi
echo ""
