"""
Tests for datasource parameter handling across all methods.
"""

from unittest.mock import Mock, patch

import pytest
from db_sdk import DB


class TestDatasourceInQuery:
    """Test datasource parameter in query() method."""

    @patch("subprocess.run")
    def test_query_uses_instance_datasource_by_default(
        self, mock_run, sample_json_output
    ):
        """Test that query uses DB instance datasource by default."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users")

            args = mock_run.call_args[0][0]
            # Should NOT add --datasource flag when using instance default
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_query_can_override_datasource(self, mock_run, sample_json_output):
        """Test that query can override instance datasource."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users", datasource="staging")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging" in args

    @patch("subprocess.run")
    def test_query_same_datasource_no_flag(self, mock_run, sample_json_output):
        """Test that explicitly passing same datasource doesn't add flag."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users", datasource="production")

            args = mock_run.call_args[0][0]
            # Same as instance default, so no flag needed
            assert "--datasource" not in args


class TestDatasourceInAsk:
    """Test datasource parameter in ask() method."""

    @patch("subprocess.run")
    def test_ask_postgres_uses_instance_datasource(self, mock_run, sample_ask_output):
        """Test that ask() uses instance datasource for PostgreSQL."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.ask("how many users?")

            args = mock_run.call_args[0][0]
            assert "--ask" in args
            # No --datasource flag (using instance default)
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_ask_postgres_can_override_datasource(self, mock_run, sample_ask_output):
        """Test that ask() can override datasource for PostgreSQL."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.ask("how many users?", datasource="staging")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging" in args

    @patch("subprocess.run")
    def test_ask_csv_ignores_datasource(self, mock_run, sample_ask_output):
        """Test that ask() ignores datasource when csv_file is specified."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.ask(
                "what are total sales?", csv_file="./sales.csv", datasource="staging"
            )

            args = mock_run.call_args[0][0]
            assert "--csv" in args
            # Datasource should be ignored for CSV mode
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_ask_csv_no_datasource_flag_added(self, mock_run, sample_ask_output):
        """Test that CSV mode never adds datasource flag."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.ask("what are total sales?", csv_file="./sales.csv")

            args = mock_run.call_args[0][0]
            assert "--csv" in args
            assert "--datasource" not in args


class TestDatasourceInInvestigate:
    """Test datasource parameter in investigate() method."""

    @patch("subprocess.run")
    def test_investigate_postgres_uses_instance_datasource(
        self, mock_run, sample_investigate_output
    ):
        """Test that investigate() uses instance datasource for PostgreSQL."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.investigate("why are orders failing?")

            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--auto" in args
            # No --datasource flag (using instance default)
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_investigate_postgres_can_override_datasource(
        self, mock_run, sample_investigate_output
    ):
        """Test that investigate() can override datasource for PostgreSQL."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.investigate("why are orders failing?", datasource="staging")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging" in args

    @patch("subprocess.run")
    def test_investigate_csv_ignores_datasource(
        self, mock_run, sample_investigate_output
    ):
        """Test that investigate() ignores datasource when csv_file is specified."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.investigate(
                "why did sales drop?", csv_file="./sales.csv", datasource="staging"
            )

            args = mock_run.call_args[0][0]
            assert "--csv" in args
            # Datasource should be ignored for CSV mode
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_investigate_csv_no_datasource_flag_added(
        self, mock_run, sample_investigate_output
    ):
        """Test that CSV investigation never adds datasource flag."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.investigate("why did sales drop?", csv_file="./sales.csv")

            args = mock_run.call_args[0][0]
            assert "--csv" in args
            assert "--datasource" not in args


class TestDatasourceWithConfig:
    """Test datasource integration with Config."""

    @patch("subprocess.run")
    def test_db_loads_active_datasource_from_config(self, mock_run, temp_config_file):
        """Test that DB loads active datasource from config."""
        mock_run.return_value = Mock(stdout="[]", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "staging"
            MockConfig.return_value = mock_config

            db = DB()
            assert db.datasource == "staging"

    @patch("subprocess.run")
    def test_db_datasource_parameter_overrides_config(self, mock_run, temp_config_file):
        """Test that datasource parameter overrides config active datasource."""
        mock_run.return_value = Mock(stdout="[]", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB(datasource="custom")
            assert db.datasource == "custom"

    @patch("subprocess.run")
    def test_multiple_db_instances_different_datasources(
        self, mock_run, sample_json_output
    ):
        """Test multiple DB instances with different datasources."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db_prod = DB(datasource="production")
            db_staging = DB(datasource="staging")

            assert db_prod.datasource == "production"
            assert db_staging.datasource == "staging"

            # Each should use their own datasource
            db_prod.query("SELECT * FROM users")
            args_prod = mock_run.call_args[0][0]
            assert "--datasource" not in args_prod  # Using instance default

            db_staging.query("SELECT * FROM users")
            args_staging = mock_run.call_args[0][0]
            assert "--datasource" not in args_staging  # Using instance default


class TestDatasourceEdgeCases:
    """Test edge cases for datasource handling."""

    @patch("subprocess.run")
    def test_datasource_none_uses_instance_default(self, mock_run, sample_json_output):
        """Test that datasource=None uses instance default."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users", datasource=None)

            args = mock_run.call_args[0][0]
            # None means use instance default, no flag added
            assert "--datasource" not in args

    @patch("subprocess.run")
    def test_datasource_empty_string(self, mock_run, sample_json_output):
        """Test handling empty string datasource."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users", datasource="")

            args = mock_run.call_args[0][0]
            # Empty string is different from instance default
            assert "--datasource" in args

    @patch("subprocess.run")
    def test_datasource_with_special_characters(self, mock_run, sample_json_output):
        """Test datasource name with special characters."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            db.query("SELECT * FROM users", datasource="staging-v2")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging-v2" in args


class TestDatasourceConsistency:
    """Test datasource behavior consistency across methods."""

    @patch("subprocess.run")
    def test_all_postgres_methods_respect_datasource(
        self, mock_run, sample_json_output, sample_ask_output, sample_investigate_output
    ):
        """Test that all PostgreSQL methods respect datasource parameter."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")

            # Test query()
            mock_run.return_value = Mock(
                stdout=sample_json_output, stderr="", returncode=0
            )
            db.query("SELECT * FROM users", datasource="staging")
            assert "--datasource" in mock_run.call_args[0][0]
            assert "staging" in mock_run.call_args[0][0]

            # Test ask()
            mock_run.return_value = Mock(
                stdout=sample_ask_output, stderr="", returncode=0
            )
            db.ask("how many users?", datasource="staging")
            assert "--datasource" in mock_run.call_args[0][0]
            assert "staging" in mock_run.call_args[0][0]

            # Test investigate()
            mock_run.return_value = Mock(
                stdout=sample_investigate_output, stderr="", returncode=0
            )
            db.investigate("why are orders failing?", datasource="staging")
            assert "--datasource" in mock_run.call_args[0][0]
            assert "staging" in mock_run.call_args[0][0]

    @patch("subprocess.run")
    def test_all_csv_methods_ignore_datasource(
        self, mock_run, sample_json_output, sample_ask_output, sample_investigate_output
    ):
        """Test that all CSV methods ignore datasource parameter."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")

            # Test csv()
            mock_run.return_value = Mock(
                stdout=sample_json_output, stderr="", returncode=0
            )
            db.csv("./data.csv", "SELECT * FROM data")
            assert "--datasource" not in mock_run.call_args[0][0]

            # Test ask() with CSV
            mock_run.return_value = Mock(
                stdout=sample_ask_output, stderr="", returncode=0
            )
            db.ask("what is the total?", csv_file="./data.csv", datasource="staging")
            assert "--datasource" not in mock_run.call_args[0][0]

            # Test investigate() with CSV
            mock_run.return_value = Mock(
                stdout=sample_investigate_output, stderr="", returncode=0
            )
            db.investigate(
                "why did it change?", csv_file="./data.csv", datasource="staging"
            )
            assert "--datasource" not in mock_run.call_args[0][0]
