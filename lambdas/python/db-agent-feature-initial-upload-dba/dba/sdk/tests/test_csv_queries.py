"""
Tests for CSV query operations - PRIMARY FEATURE.
"""

import json
from unittest.mock import Mock, patch

import pytest
from db_sdk import DB


class TestCSVBasicQueries:
    """Test basic CSV query operations."""

    @patch("subprocess.run")
    def test_csv_query_with_local_file(self, mock_run, sample_json_output):
        """Test querying a local CSV file."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data")

            # Verify command construction
            args = mock_run.call_args[0][0]
            assert "--csv" in args
            assert "./data.csv" in args
            assert "SELECT * FROM data" in args

            # Verify result
            assert isinstance(result, list)
            assert len(result) == 2
            assert result[0]["name"] == "Alice"

    @patch("subprocess.run")
    def test_csv_query_with_url(self, mock_run, sample_json_output):
        """Test querying a CSV from URL."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            url = "https://example.com/data.csv"
            result = db.csv(url, "SELECT * FROM data")

            args = mock_run.call_args[0][0]
            assert "--csv" in args
            assert url in args

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_csv_query_with_google_sheets(self, mock_run, sample_json_output):
        """Test querying Google Sheets CSV export."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            sheet_url = (
                "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=0"
            )
            result = db.csv(sheet_url, "SELECT * FROM data")

            args = mock_run.call_args[0][0]
            assert sheet_url in args
            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_csv_query_default_format_json(self, mock_run, sample_json_output):
        """Test that CSV queries default to JSON format."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data")

            args = mock_run.call_args[0][0]
            assert "--format" in args
            assert "json" in args
            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_csv_query_csv_format(self, mock_run, sample_csv_output):
        """Test CSV query with CSV output format."""
        mock_run.return_value = Mock(stdout=sample_csv_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data", format="csv")

            args = mock_run.call_args[0][0]
            assert "--format" in args
            assert "csv" in args
            assert isinstance(result, str)
            assert "id,name" in result

    @patch("subprocess.run")
    def test_csv_query_table_format(self, mock_run):
        """Test CSV query with table output format."""
        table_output = """
+----+-------+
| id | name  |
+----+-------+
|  1 | Alice |
|  2 | Bob   |
+----+-------+
"""
        mock_run.return_value = Mock(stdout=table_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data", format="table")

            args = mock_run.call_args[0][0]
            assert "--format" in args
            assert "table" in args
            assert isinstance(result, str)
            assert "+----+-------+" in result


class TestCSVEngines:
    """Test CSV query engines (sqlite vs duckdb)."""

    @patch("subprocess.run")
    def test_csv_sqlite_engine_default(self, mock_run, sample_json_output):
        """Test that csv-sqlite is used by default."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.csv("./data.csv", "SELECT * FROM data")

            args = mock_run.call_args[0][0]
            # Default engine should NOT add --engine flag
            assert "--engine" not in args

    @patch("subprocess.run")
    def test_csv_sqlite_engine_explicit(self, mock_run, sample_json_output):
        """Test explicitly specifying csv-sqlite engine."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.csv("./data.csv", "SELECT * FROM data", engine="csv-sqlite")

            args = mock_run.call_args[0][0]
            # Explicit csv-sqlite should not add flag (it's default)
            assert "--engine" not in args

    @patch("subprocess.run")
    def test_csv_duckdb_engine(self, mock_run, sample_json_output):
        """Test using csv-duckdb engine."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.csv(
                "./data.csv",
                "SELECT * FROM read_csv_auto('./data.csv')",
                engine="csv-duckdb",
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args
            assert "csv-duckdb" in args

    @patch("subprocess.run")
    def test_csv_s3_engine(self, mock_run, sample_json_output):
        """Test using s3-csv-sqlite engine."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.csv("s3://bucket/data.csv", "SELECT * FROM data", engine="s3-csv-sqlite")

            args = mock_run.call_args[0][0]
            assert "--engine" in args
            assert "s3-csv-sqlite" in args


class TestCSVComplexQueries:
    """Test complex CSV queries."""

    @patch("subprocess.run")
    def test_csv_aggregation_query(self, mock_run):
        """Test CSV query with aggregation."""
        result_json = (
            '[{"region": "US", "total": 3300}, {"region": "EU", "total": 3200}]'
        )
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv(
                "./sales.csv",
                "SELECT region, SUM(amount) as total FROM data GROUP BY region",
            )

            assert isinstance(result, list)
            assert len(result) == 2
            assert result[0]["region"] == "US"
            assert result[0]["total"] == 3300

    @patch("subprocess.run")
    def test_csv_where_clause(self, mock_run):
        """Test CSV query with WHERE clause."""
        result_json = '[{"product": "Widget", "amount": 1500}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv(
                "./sales.csv",
                "SELECT * FROM data WHERE amount > 1000 AND product = 'Widget'",
            )

            assert len(result) == 1
            assert result[0]["product"] == "Widget"

    @patch("subprocess.run")
    def test_csv_join_query(self, mock_run):
        """Test CSV query with self-join."""
        result_json = '[{"col1": "value1", "col2": "value2"}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv(
                "./data.csv",
                "SELECT a.*, b.* FROM data a JOIN data b ON a.id = b.parent_id",
            )

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_csv_order_by_limit(self, mock_run):
        """Test CSV query with ORDER BY and LIMIT."""
        result_json = '[{"amount": 2000}, {"amount": 1800}, {"amount": 1500}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv(
                "./sales.csv", "SELECT amount FROM data ORDER BY amount DESC LIMIT 3"
            )

            assert len(result) == 3
            assert result[0]["amount"] == 2000


class TestCSVAdditionalArguments:
    """Test CSV queries with additional CLI arguments."""

    @patch("subprocess.run")
    def test_csv_with_additional_kwargs(self, mock_run, sample_json_output):
        """Test passing additional kwargs to CSV query."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.csv(
                "./data.csv", "SELECT * FROM data", some_flag=True, some_value="test"
            )

            args = mock_run.call_args[0][0]
            assert "--some-flag" in args
            assert "--some-value" in args
            assert "test" in args

    @patch("subprocess.run")
    def test_csv_boolean_kwargs(self, mock_run, sample_json_output):
        """Test passing boolean kwargs."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.csv("./data.csv", "SELECT * FROM data", verbose=True, quiet=False)

            args = mock_run.call_args[0][0]
            # True boolean should add flag
            assert "--verbose" in args
            # False boolean should not add flag
            assert "--quiet" not in args


class TestCSVJSONParsing:
    """Test JSON parsing edge cases for CSV queries."""

    @patch("subprocess.run")
    def test_csv_empty_result(self, mock_run):
        """Test CSV query with empty result."""
        mock_run.return_value = Mock(stdout="[]", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data WHERE 1=0")

            assert result == []

    @patch("subprocess.run")
    def test_csv_null_values(self, mock_run):
        """Test CSV query with NULL values."""
        result_json = '[{"id": 1, "value": null}, {"id": 2, "value": "test"}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data")

            assert result[0]["value"] is None
            assert result[1]["value"] == "test"

    @patch("subprocess.run")
    def test_csv_special_characters(self, mock_run):
        """Test CSV query with special characters in data."""
        result_json = '[{"name": "O\'Brien", "description": "Test \\"quoted\\" value"}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data")

            assert "O'Brien" in result[0]["name"]

    @patch("subprocess.run")
    def test_csv_invalid_json_returns_raw(self, mock_run):
        """Test that invalid JSON returns raw output."""
        mock_run.return_value = Mock(stdout="Invalid JSON {[}", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./data.csv", "SELECT * FROM data")

            # Should return raw string on JSON parse failure
            assert isinstance(result, str)
            assert "Invalid JSON" in result


class TestCSVLargeFiles:
    """Test CSV queries with large files."""

    @patch("subprocess.run")
    def test_csv_large_file_with_duckdb(self, mock_run, sample_json_output):
        """Test querying large CSV with DuckDB for performance."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv(
                "./large_file.csv",
                "SELECT COUNT(*) FROM read_csv_auto('./large_file.csv')",
                engine="csv-duckdb",
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args
            assert "csv-duckdb" in args
            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_csv_streaming_with_limit(self, mock_run, sample_json_output):
        """Test streaming large CSV with LIMIT clause."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.csv("./large_file.csv", "SELECT * FROM data LIMIT 100")

            assert isinstance(result, list)
