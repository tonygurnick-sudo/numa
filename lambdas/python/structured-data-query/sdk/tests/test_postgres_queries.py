"""
Tests for PostgreSQL query operations.
"""

import json
from unittest.mock import Mock, patch

import pytest
from db_sdk import DB


class TestPostgreSQLBasicQueries:
    """Test basic PostgreSQL query operations."""

    @patch("subprocess.run")
    def test_query_basic_select(self, mock_run, sample_json_output):
        """Test basic SELECT query."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users LIMIT 5")

            # Verify command construction
            args = mock_run.call_args[0][0]
            assert "SELECT * FROM users LIMIT 5" in args
            assert "--format" in args
            assert "json" in args

            # Verify result
            assert isinstance(result, list)
            assert len(result) == 2

    @patch("subprocess.run")
    def test_query_with_where_clause(self, mock_run):
        """Test query with WHERE clause."""
        result_json = '[{"id": 1, "name": "Alice", "active": true}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users WHERE active = true")

            assert len(result) == 1
            assert result[0]["active"] is True

    @patch("subprocess.run")
    def test_query_with_join(self, mock_run):
        """Test query with JOIN."""
        result_json = '[{"user_id": 1, "order_id": 100, "total": 500}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query(
                """
                SELECT u.id as user_id, o.id as order_id, o.total
                FROM users u
                JOIN orders o ON u.id = o.user_id
            """
            )

            assert len(result) == 1
            assert result[0]["order_id"] == 100

    @patch("subprocess.run")
    def test_query_aggregation(self, mock_run):
        """Test aggregation query."""
        result_json = '[{"count": 42, "avg_amount": 1250.50}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query(
                "SELECT COUNT(*) as count, AVG(amount) as avg_amount FROM orders"
            )

            assert result[0]["count"] == 42
            assert result[0]["avg_amount"] == 1250.50

    @patch("subprocess.run")
    def test_query_group_by(self, mock_run):
        """Test GROUP BY query."""
        result_json = (
            '[{"category": "A", "total": 1000}, {"category": "B", "total": 2000}]'
        )
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query(
                "SELECT category, SUM(amount) as total FROM products GROUP BY category"
            )

            assert len(result) == 2
            assert result[1]["total"] == 2000


class TestPostgreSQLFormats:
    """Test different output formats for PostgreSQL queries."""

    @patch("subprocess.run")
    def test_query_json_format(self, mock_run, sample_json_output):
        """Test query with JSON format (default)."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users", format="json")

            assert isinstance(result, list)
            assert len(result) == 2

    @patch("subprocess.run")
    def test_query_csv_format(self, mock_run, sample_csv_output):
        """Test query with CSV format."""
        mock_run.return_value = Mock(stdout=sample_csv_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users", format="csv")

            assert isinstance(result, str)
            assert "id,name" in result
            assert "Alice" in result

    @patch("subprocess.run")
    def test_query_table_format(self, mock_run):
        """Test query with table format."""
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
            result = db.query("SELECT * FROM users", format="table")

            assert isinstance(result, str)
            assert "+----+-------+" in result


class TestPostgreSQLDatasource:
    """Test datasource parameter for PostgreSQL queries."""

    @patch("subprocess.run")
    def test_query_with_default_datasource(self, mock_run, sample_json_output):
        """Test query uses default datasource from DB instance."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users")

            # Should NOT add --datasource flag (using default)
            args = mock_run.call_args[0][0]
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_query_with_override_datasource(self, mock_run, sample_json_output):
        """Test query with datasource override."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users", datasource="staging")

            # Should add --datasource flag
            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging" in args


class TestPostgreSQLKwargs:
    """Test additional kwargs for PostgreSQL queries."""

    @patch("subprocess.run")
    def test_query_with_boolean_kwargs(self, mock_run, sample_json_output):
        """Test query with boolean kwargs."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.query("SELECT * FROM users", verbose=True, quiet=False)

            args = mock_run.call_args[0][0]
            assert "--verbose" in args
            assert "--quiet" not in args  # False boolean shouldn't add flag

    @patch("subprocess.run")
    def test_query_with_string_kwargs(self, mock_run, sample_json_output):
        """Test query with string value kwargs."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.query("SELECT * FROM users", some_option="value", another_flag="test")

            args = mock_run.call_args[0][0]
            assert "--some-option" in args
            assert "value" in args
            assert "--another-flag" in args
            assert "test" in args


class TestPostgreSQLEdgeCases:
    """Test edge cases for PostgreSQL queries."""

    @patch("subprocess.run")
    def test_query_empty_result(self, mock_run):
        """Test query with empty result set."""
        mock_run.return_value = Mock(stdout="[]", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users WHERE 1=0")

            assert result == []

    @patch("subprocess.run")
    def test_query_null_values(self, mock_run):
        """Test query with NULL values."""
        result_json = '[{"id": 1, "name": "Alice", "email": null}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users")

            assert result[0]["email"] is None

    @patch("subprocess.run")
    def test_query_special_characters(self, mock_run):
        """Test query with special characters in results."""
        result_json = '[{"name": "O\'Brien", "bio": "Test \\"quoted\\" text"}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users")

            assert "O'Brien" in result[0]["name"]

    @patch("subprocess.run")
    def test_query_multiline_sql(self, mock_run, sample_json_output):
        """Test query with multiline SQL."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            sql = """
                SELECT u.id, u.name, COUNT(o.id) as order_count
                FROM users u
                LEFT JOIN orders o ON u.id = o.user_id
                GROUP BY u.id, u.name
                ORDER BY order_count DESC
            """
            result = db.query(sql)

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_query_with_parameters_in_sql(self, mock_run, sample_json_output):
        """Test query with SQL containing special syntax."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            # Note: Parameter substitution would be handled by the CLI
            result = db.query("SELECT * FROM users WHERE id = 1")

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_query_invalid_json_returns_raw(self, mock_run):
        """Test that invalid JSON returns raw output."""
        mock_run.return_value = Mock(stdout="Invalid JSON {[}", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users")

            # Should return raw string on JSON parse failure
            assert isinstance(result, str)
            assert "Invalid JSON" in result


class TestPostgreSQLTransactions:
    """Test transaction-related queries."""

    @patch("subprocess.run")
    def test_query_begin_transaction(self, mock_run):
        """Test BEGIN TRANSACTION query."""
        mock_run.return_value = Mock(stdout="[]", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("BEGIN TRANSACTION")

            assert result == [] or isinstance(result, str)

    @patch("subprocess.run")
    def test_query_commit(self, mock_run):
        """Test COMMIT query."""
        mock_run.return_value = Mock(stdout="[]", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("COMMIT")

            assert result == [] or isinstance(result, str)


class TestPostgreSQLMetaQueries:
    """Test PostgreSQL meta queries (schema inspection, etc.)."""

    @patch("subprocess.run")
    def test_query_list_tables(self, mock_run):
        """Test listing tables."""
        result_json = '[{"tablename": "users"}, {"tablename": "orders"}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query(
                """
                SELECT tablename
                FROM pg_catalog.pg_tables
                WHERE schemaname = 'public'
            """
            )

            assert len(result) == 2
            assert result[0]["tablename"] == "users"

    @patch("subprocess.run")
    def test_query_table_schema(self, mock_run):
        """Test getting table schema."""
        result_json = '[{"column_name": "id", "data_type": "integer"}]'
        mock_run.return_value = Mock(stdout=result_json, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'users'
            """
            )

            assert result[0]["column_name"] == "id"
            assert result[0]["data_type"] == "integer"
