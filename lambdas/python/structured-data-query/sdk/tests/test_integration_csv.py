"""
Integration tests for CSV query operations - REAL CLI EXECUTION.

These tests actually execute the db CLI tool and verify real behavior.
They are slower than unit tests but catch real bugs.

Run with: pytest -m integration
"""

import json
import sys
from pathlib import Path

import pytest

# Add parent directory to path to import db_sdk
sys.path.insert(0, str(Path(__file__).parent.parent))

from db_sdk import DB, DBError


@pytest.mark.integration
class TestRealCSVQueries:
    """Test real CSV queries that execute the CLI."""

    def test_csv_query_select_all(self, check_db_cli_exists, real_test_csv):
        """Test basic SELECT * query on real CSV file."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data")

        # Verify real results
        assert isinstance(result, list)
        assert len(result) == 5
        assert result[0]["name"] == "Alice"
        assert result[0]["amount"] == 1500

    def test_csv_query_with_where_clause(self, check_db_cli_exists, real_test_csv):
        """Test WHERE clause filtering."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data WHERE amount > 1500")

        assert isinstance(result, list)
        assert len(result) == 3  # Bob (2000), Diana (1800), Eve (2500)
        assert all(row["amount"] > 1500 for row in result)

    def test_csv_query_aggregation(self, check_db_cli_exists, real_test_csv):
        """Test SUM aggregation."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT SUM(amount) as total FROM data")

        assert isinstance(result, list)
        assert len(result) == 1
        # 1500 + 2000 + 1200 + 1800 + 2500 = 9000
        assert result[0]["total"] == 9000

    def test_csv_query_count(self, check_db_cli_exists, real_test_csv):
        """Test COUNT query."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT COUNT(*) as count FROM data")

        assert result[0]["count"] == 5

    def test_csv_query_group_by(self, check_db_cli_exists, real_sales_csv):
        """Test GROUP BY with aggregation."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_sales_csv,
            "SELECT region, SUM(amount) as total FROM data GROUP BY region ORDER BY region",
        )

        assert len(result) == 2
        # Find US and EU totals
        us_row = next(r for r in result if r["region"] == "US")
        eu_row = next(r for r in result if r["region"] == "EU")

        # US: 1500 + 1800 + 1600 + 1700 = 6600
        # EU: 1200 + 2000 + 1100 + 2100 = 6400
        assert us_row["total"] == 6600
        assert eu_row["total"] == 6400

    def test_csv_query_order_by(self, check_db_cli_exists, real_test_csv):
        """Test ORDER BY clause."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_test_csv, "SELECT name, amount FROM data ORDER BY amount DESC LIMIT 3"
        )

        assert len(result) == 3
        assert result[0]["name"] == "Eve"  # 2500
        assert result[1]["name"] == "Bob"  # 2000
        assert result[2]["name"] == "Diana"  # 1800

    def test_csv_query_limit(self, check_db_cli_exists, real_test_csv):
        """Test LIMIT clause."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data LIMIT 2")

        assert len(result) == 2

    def test_csv_query_distinct(self, check_db_cli_exists, real_test_csv):
        """Test DISTINCT query."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_test_csv, "SELECT DISTINCT category FROM data ORDER BY category"
        )

        assert len(result) == 2
        assert result[0]["category"] == "electronics"
        assert result[1]["category"] == "furniture"


@pytest.mark.integration
class TestRealCSVFormats:
    """Test different output formats with real CLI."""

    def test_csv_output_json_format(self, check_db_cli_exists, real_test_csv):
        """Test JSON output format (default)."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data LIMIT 2", format="json")

        assert isinstance(result, list)
        assert len(result) == 2
        assert "name" in result[0]

    def test_csv_output_csv_format(self, check_db_cli_exists, real_test_csv):
        """Test CSV output format."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data LIMIT 2", format="csv")

        assert isinstance(result, str)
        assert "id,name,amount" in result or "name" in result
        assert "Alice" in result

    def test_csv_output_table_format(self, check_db_cli_exists, real_test_csv):
        """Test table output format."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data LIMIT 2", format="table")

        assert isinstance(result, str)
        # Table format should have box drawing characters or pipes
        assert "|" in result or "+" in result or "─" in result


@pytest.mark.integration
class TestRealCSVEngines:
    """Test different CSV engines with real CLI."""

    def test_csv_sqlite_engine(self, check_db_cli_exists, real_test_csv):
        """Test csv-sqlite engine (default)."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_test_csv,
            "SELECT * FROM data WHERE category = 'electronics'",
            engine="csv-sqlite",
        )

        assert len(result) == 3  # Alice, Charlie, Eve
        assert all(row["category"] == "electronics" for row in result)

    @pytest.mark.slow
    def test_csv_duckdb_engine(self, check_db_cli_exists, real_large_csv):
        """Test csv-duckdb engine with larger file."""
        db = DB(db_path=check_db_cli_exists)

        # DuckDB uses read_csv_auto() syntax
        result = db.csv(
            real_large_csv,
            f"SELECT COUNT(*) as count FROM read_csv_auto('{real_large_csv}')",
            engine="csv-duckdb",
        )

        assert result[0]["count"] == 1000


@pytest.mark.integration
class TestRealCSVEdgeCases:
    """Test edge cases with real CLI execution."""

    def test_csv_empty_result(self, check_db_cli_exists, real_test_csv):
        """Test query that returns no rows."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(real_test_csv, "SELECT * FROM data WHERE amount > 10000")

        assert result == []

    def test_csv_syntax_error_raises_exception(
        self, check_db_cli_exists, real_test_csv
    ):
        """Test that SQL syntax error raises DBError."""
        db = DB(db_path=check_db_cli_exists)

        with pytest.raises(DBError):
            db.csv(real_test_csv, "SELECT * FORM data")  # Typo: FORM instead of FROM

    def test_csv_nonexistent_file_raises_exception(self, check_db_cli_exists):
        """Test that nonexistent file raises DBError."""
        db = DB(db_path=check_db_cli_exists)

        with pytest.raises(DBError):
            db.csv("/nonexistent/file.csv", "SELECT * FROM data")

    def test_csv_nonexistent_column_raises_exception(
        self, check_db_cli_exists, real_test_csv
    ):
        """Test that querying nonexistent column raises DBError."""
        db = DB(db_path=check_db_cli_exists)

        with pytest.raises(DBError):
            db.csv(real_test_csv, "SELECT nonexistent_column FROM data")


@pytest.mark.integration
class TestRealCSVComplexQueries:
    """Test complex real-world queries."""

    def test_csv_multiple_aggregations(self, check_db_cli_exists, real_sales_csv):
        """Test multiple aggregations in one query."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_sales_csv,
            """
            SELECT
                product,
                COUNT(*) as num_sales,
                SUM(amount) as total_amount,
                AVG(amount) as avg_amount,
                SUM(quantity) as total_quantity
            FROM data
            GROUP BY product
            ORDER BY product
            """,
        )

        assert len(result) == 2  # Widget and Gadget
        widget = next(r for r in result if r["product"] == "Widget")
        gadget = next(r for r in result if r["product"] == "Gadget")

        assert widget["num_sales"] == 4
        assert gadget["num_sales"] == 4

    def test_csv_having_clause(self, check_db_cli_exists, real_sales_csv):
        """Test HAVING clause with GROUP BY."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_sales_csv,
            """
            SELECT region, SUM(amount) as total
            FROM data
            GROUP BY region
            HAVING SUM(amount) > 6500
            """,
        )

        # Only US should have total > 6500
        assert len(result) == 1
        assert result[0]["region"] == "US"

    def test_csv_case_statement(self, check_db_cli_exists, real_test_csv):
        """Test CASE statement."""
        db = DB(db_path=check_db_cli_exists)
        result = db.csv(
            real_test_csv,
            """
            SELECT
                name,
                amount,
                CASE
                    WHEN amount >= 2000 THEN 'high'
                    WHEN amount >= 1500 THEN 'medium'
                    ELSE 'low'
                END as price_tier
            FROM data
            ORDER BY amount DESC
            """,
        )

        assert result[0]["name"] == "Eve"
        assert result[0]["price_tier"] == "high"


@pytest.mark.integration
class TestRealConvenienceFunctions:
    """Test module-level convenience functions with real CLI."""

    def test_convenience_csv_function(self, check_db_cli_exists, real_test_csv):
        """Test module-level csv() function."""
        from db_sdk import csv

        # Need to temporarily set db_path - in real usage, it would use default
        result = csv(real_test_csv, "SELECT COUNT(*) as count FROM data")

        assert isinstance(result, list)
        assert result[0]["count"] == 5


@pytest.mark.integration
@pytest.mark.slow
class TestRealPerformance:
    """Test performance with real CLI execution."""

    def test_large_csv_performance(self, check_db_cli_exists, real_large_csv):
        """Test querying 1000 rows completes in reasonable time."""
        import time

        db = DB(db_path=check_db_cli_exists)

        start = time.time()
        result = db.csv(real_large_csv, "SELECT COUNT(*) as count FROM data")
        elapsed = time.time() - start

        assert result[0]["count"] == 1000
        # Should complete in under 5 seconds
        assert elapsed < 5.0

    def test_large_csv_with_aggregations(self, check_db_cli_exists, real_large_csv):
        """Test complex aggregation on 1000 rows."""
        db = DB(db_path=check_db_cli_exists)

        result = db.csv(
            real_large_csv,
            """
            SELECT
                category,
                COUNT(*) as count,
                SUM(value) as total_value,
                AVG(value) as avg_value
            FROM data
            GROUP BY category
            ORDER BY category
            """,
        )

        assert len(result) == 4  # A, B, C, D
        # Each category should have 250 rows (1000 / 4)
        assert all(row["count"] == 250 for row in result)
