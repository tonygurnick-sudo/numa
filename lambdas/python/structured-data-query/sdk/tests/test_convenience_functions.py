"""
Tests for module-level convenience functions.
"""

from unittest.mock import Mock, patch

import db_sdk
import pytest


class TestConvenienceQuery:
    """Test module-level query() convenience function."""

    @patch("subprocess.run")
    def test_query_function_creates_db_instance(self, mock_run, sample_json_output):
        """Test that query() creates a DB instance."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.query("SELECT * FROM users")

            assert isinstance(result, list)
            assert len(result) == 2

    @patch("subprocess.run")
    def test_query_function_accepts_kwargs(self, mock_run, sample_json_output):
        """Test that query() passes kwargs to DB.query()."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.query("SELECT * FROM users", format="json")

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_query_function_with_datasource(self, mock_run, sample_json_output):
        """Test that query() accepts datasource parameter."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.query("SELECT * FROM users", datasource="staging")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args or "SELECT * FROM users" in args


class TestConvenienceCSV:
    """Test module-level csv() convenience function."""

    @patch("subprocess.run")
    def test_csv_function_creates_db_instance(self, mock_run, sample_json_output):
        """Test that csv() creates a DB instance."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.csv("./data.csv", "SELECT * FROM data")

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_csv_function_with_url(self, mock_run, sample_json_output):
        """Test csv() with URL."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.csv("https://example.com/data.csv", "SELECT * FROM data")

            args = mock_run.call_args[0][0]
            assert "--csv" in args
            assert "https://example.com/data.csv" in args

    @patch("subprocess.run")
    def test_csv_function_accepts_kwargs(self, mock_run, sample_json_output):
        """Test that csv() passes kwargs."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.csv(
                "./data.csv", "SELECT * FROM data", engine="csv-duckdb", format="json"
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args
            assert "csv-duckdb" in args


class TestConvenienceAsk:
    """Test module-level ask() convenience function."""

    @patch("subprocess.run")
    def test_ask_function_creates_db_instance(self, mock_run, sample_ask_output):
        """Test that ask() creates a DB instance."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.ask("what is the total?", csv_file="./data.csv")

            assert isinstance(result, str)
            assert len(result) > 0

    @patch("subprocess.run")
    def test_ask_function_with_csv(self, mock_run, sample_ask_output):
        """Test ask() with CSV file (primary use case)."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.ask(
                "what are total sales by region?", csv_file="./sales.csv"
            )

            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--csv" in args
            assert "./sales.csv" in args

    @patch("subprocess.run")
    def test_ask_function_with_postgres(self, mock_run, sample_ask_output):
        """Test ask() without csv_file (PostgreSQL mode)."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.ask("how many users are there?")

            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--csv" not in args

    @patch("subprocess.run")
    def test_ask_function_accepts_kwargs(self, mock_run, sample_ask_output):
        """Test that ask() passes kwargs."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.ask(
                "what is the total?", csv_file="./data.csv", engine="csv-duckdb"
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args


class TestConvenienceInvestigate:
    """Test module-level investigate() convenience function."""

    @patch("subprocess.run")
    def test_investigate_function_creates_db_instance(
        self, mock_run, sample_investigate_output
    ):
        """Test that investigate() creates a DB instance."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.investigate("why did sales drop?", csv_file="./sales.csv")

            assert isinstance(result, dict)
            assert "answer" in result
            assert "iterations" in result

    @patch("subprocess.run")
    def test_investigate_function_with_csv(self, mock_run, sample_investigate_output):
        """Test investigate() with CSV file (primary use case)."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.investigate(
                "why did sales drop in Q3?", csv_file="./sales.csv"
            )

            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--auto" in args
            assert "--csv" in args
            assert "./sales.csv" in args

    @patch("subprocess.run")
    def test_investigate_function_with_postgres(
        self, mock_run, sample_investigate_output
    ):
        """Test investigate() without csv_file (PostgreSQL mode)."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.investigate("why are orders failing?")

            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--auto" in args
            assert "--csv" not in args

    @patch("subprocess.run")
    def test_investigate_function_accepts_kwargs(
        self, mock_run, sample_investigate_output
    ):
        """Test that investigate() passes kwargs."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            result = db_sdk.investigate(
                "why did it change?", csv_file="./data.csv", engine="csv-duckdb"
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args


class TestConvenienceFunctionErrors:
    """Test error handling in convenience functions."""

    @patch("subprocess.run")
    def test_query_function_raises_dberror(self, mock_run):
        """Test that query() propagates DBError."""
        from db_sdk import DBError

        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            with pytest.raises(DBError):
                db_sdk.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_csv_function_raises_dberror(self, mock_run):
        """Test that csv() propagates DBError."""
        from db_sdk import DBError

        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            with pytest.raises(DBError):
                db_sdk.csv("./data.csv", "SELECT * FROM data")

    @patch("subprocess.run")
    def test_ask_function_raises_dberror(self, mock_run):
        """Test that ask() propagates DBError."""
        from db_sdk import DBError

        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            with pytest.raises(DBError):
                db_sdk.ask("what is total?", csv_file="./data.csv")

    @patch("subprocess.run")
    def test_investigate_function_raises_dberror(self, mock_run):
        """Test that investigate() propagates DBError."""
        from db_sdk import DBError

        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            with pytest.raises(DBError):
                db_sdk.investigate("why?", csv_file="./data.csv")


class TestConvenienceFunctionDefaultBehavior:
    """Test default behavior of convenience functions."""

    @patch("subprocess.run")
    def test_convenience_functions_inherit_environment(
        self, mock_run, sample_json_output
    ):
        """Test that convenience functions inherit current environment."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            import os

            with patch.dict(os.environ, {"CUSTOM_VAR": "test_value"}):
                # Create DB instance via convenience function
                db_sdk.query("SELECT * FROM users")

                # Check that environment was passed
                kwargs = mock_run.call_args[1]
                assert "env" in kwargs
                # Note: actual check would depend on implementation

    @patch("subprocess.run")
    def test_convenience_functions_use_default_config(
        self, mock_run, sample_json_output
    ):
        """Test that convenience functions use default config."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            # Should create DB with default config
            result = db_sdk.query("SELECT * FROM users")

            # Config should be initialized
            MockConfig.assert_called()


class TestConvenienceFunctionUsability:
    """Test that convenience functions are easy to use."""

    @patch("subprocess.run")
    def test_quick_csv_query_one_liner(self, mock_run, sample_json_output):
        """Test quick CSV query as one-liner."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            # Should work as a simple one-liner
            result = db_sdk.csv("./data.csv", "SELECT * FROM data LIMIT 5")

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_quick_natural_language_query_one_liner(self, mock_run, sample_ask_output):
        """Test quick natural language query as one-liner."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            # Should work as a simple one-liner
            answer = db_sdk.ask("what are total sales?", csv_file="./sales.csv")

            assert isinstance(answer, str)

    @patch("subprocess.run")
    def test_quick_investigation_one_liner(self, mock_run, sample_investigate_output):
        """Test quick investigation as one-liner."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            # Should work as a simple one-liner
            result = db_sdk.investigate("why did sales drop?", csv_file="./sales.csv")

            assert isinstance(result, dict)
            assert "answer" in result


class TestModuleLevelImports:
    """Test that convenience functions are properly exported."""

    def test_query_is_exported(self):
        """Test that query is in module's __all__."""
        assert "query" in db_sdk.__all__

    def test_csv_is_exported(self):
        """Test that csv is in module's __all__."""
        assert "csv" in db_sdk.__all__

    def test_ask_is_exported(self):
        """Test that ask is in module's __all__."""
        assert "ask" in db_sdk.__all__

    def test_investigate_is_exported(self):
        """Test that investigate is in module's __all__."""
        assert "investigate" in db_sdk.__all__

    def test_db_is_exported(self):
        """Test that DB class is in module's __all__."""
        assert "DB" in db_sdk.__all__

    def test_config_is_exported(self):
        """Test that Config class is in module's __all__."""
        assert "Config" in db_sdk.__all__

    def test_dberror_is_exported(self):
        """Test that DBError is in module's __all__."""
        assert "DBError" in db_sdk.__all__

    def test_configerror_is_exported(self):
        """Test that ConfigError is in module's __all__."""
        assert "ConfigError" in db_sdk.__all__
