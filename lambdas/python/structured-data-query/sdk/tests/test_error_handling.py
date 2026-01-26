"""
Tests for error handling across all SDK methods.
"""

from unittest.mock import Mock, patch

import pytest
from db_sdk import DB, ConfigError, DBError


class TestDBErrorHandling:
    """Test DBError exceptions."""

    @patch("subprocess.run")
    def test_query_raises_dberror_on_cli_failure(self, mock_run):
        """Test that query raises DBError when CLI command fails."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: connection failed", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_csv_raises_dberror_on_cli_failure(self, mock_run):
        """Test that csv() raises DBError when CLI command fails."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: file not found", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db.csv("./nonexistent.csv", "SELECT * FROM data")

    @patch("subprocess.run")
    def test_ask_raises_dberror_on_cli_failure(self, mock_run):
        """Test that ask() raises DBError when CLI command fails."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: ANTHROPIC_API_KEY not set", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db.ask("what is the total?", csv_file="./data.csv")

    @patch("subprocess.run")
    def test_investigate_raises_dberror_on_cli_failure(self, mock_run):
        """Test that investigate() raises DBError when CLI command fails."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: investigation failed", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db.investigate("why did sales drop?", csv_file="./data.csv")

    @patch("subprocess.run")
    def test_s3_raises_dberror_on_cli_failure(self, mock_run):
        """Test that s3() raises DBError when CLI command fails."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: AWS credentials not found", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db.s3("s3://bucket/data.csv", "SELECT * FROM data")

    @patch("subprocess.run")
    def test_athena_raises_dberror_on_cli_failure(self, mock_run):
        """Test that athena() raises DBError when CLI command fails."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: Athena query failed", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db.athena(
                    "SELECT * FROM table", database="db", output_location="s3://bucket/"
                )

    @patch("subprocess.run")
    def test_dberror_includes_stderr_message(self, mock_run):
        """Test that DBError includes stderr message."""
        error_msg = "connection refused: could not connect to server"
        mock_run.return_value = Mock(stdout="", stderr=error_msg, returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError) as exc_info:
                db.query("SELECT * FROM users")

            assert error_msg in str(exc_info.value)

    @patch("subprocess.run")
    def test_help_does_not_raise_on_error(self, mock_run):
        """Test that help() doesn't raise exception (uses check=False)."""
        mock_run.return_value = Mock(stdout="Help text", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.help()

            assert "Help text" in result


class TestConfigErrorHandling:
    """Test ConfigError exceptions."""

    def test_config_set_nonexistent_datasource_raises_error(self, temp_config_file):
        """Test setting nonexistent datasource raises ConfigError."""
        from db_sdk import Config

        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.set_active_datasource("nonexistent")

    def test_config_get_nonexistent_datasource_raises_error(self, temp_config_file):
        """Test getting nonexistent datasource raises ConfigError."""
        from db_sdk import Config

        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.get_datasource("nonexistent")

    def test_config_remove_nonexistent_datasource_raises_error(self, temp_config_file):
        """Test removing nonexistent datasource raises ConfigError."""
        from db_sdk import Config

        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.remove_datasource("nonexistent")

    def test_config_get_nonexistent_engine_raises_error(self, temp_config_file):
        """Test getting nonexistent engine raises ConfigError."""
        from db_sdk import Config

        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.get_engine("nonexistent")

    def test_config_remove_nonexistent_engine_raises_error(self, temp_config_file):
        """Test removing nonexistent engine raises ConfigError."""
        from db_sdk import Config

        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.remove_engine("nonexistent")


class TestCLIErrors:
    """Test handling of various CLI error scenarios."""

    @patch("subprocess.run")
    def test_syntax_error_in_sql(self, mock_run):
        """Test handling SQL syntax errors."""
        mock_run.return_value = Mock(
            stdout="", stderr='ERROR: syntax error at or near "FORM"', returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="syntax error"):
                db.query("SELECT * FORM users")

    @patch("subprocess.run")
    def test_table_not_found_error(self, mock_run):
        """Test handling table not found errors."""
        mock_run.return_value = Mock(
            stdout="",
            stderr='ERROR: relation "nonexistent" does not exist',
            returncode=1,
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="does not exist"):
                db.query("SELECT * FROM nonexistent")

    @patch("subprocess.run")
    def test_permission_denied_error(self, mock_run):
        """Test handling permission denied errors."""
        mock_run.return_value = Mock(
            stdout="", stderr="ERROR: permission denied for table users", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="permission denied"):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_connection_refused_error(self, mock_run):
        """Test handling connection refused errors."""
        mock_run.return_value = Mock(
            stdout="",
            stderr="could not connect to server: Connection refused",
            returncode=1,
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Connection refused"):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_authentication_failed_error(self, mock_run):
        """Test handling authentication failures."""
        mock_run.return_value = Mock(
            stdout="", stderr="FATAL: password authentication failed", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="authentication failed"):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_csv_file_not_found_error(self, mock_run):
        """Test handling CSV file not found."""
        mock_run.return_value = Mock(
            stdout="",
            stderr="Error: CSV file not found: ./nonexistent.csv",
            returncode=1,
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="not found"):
                db.csv("./nonexistent.csv", "SELECT * FROM data")

    @patch("subprocess.run")
    def test_url_download_failed_error(self, mock_run):
        """Test handling URL download failures."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error downloading URL: 404 Not Found", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="404"):
                db.csv("https://example.com/nonexistent.csv", "SELECT * FROM data")

    @patch("subprocess.run")
    def test_api_key_missing_error(self, mock_run):
        """Test handling missing API key errors."""
        mock_run.return_value = Mock(
            stdout="",
            stderr="Error: ANTHROPIC_API_KEY environment variable not set",
            returncode=1,
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="ANTHROPIC_API_KEY"):
                db.ask("what is the total?", csv_file="./data.csv")

    @patch("subprocess.run")
    def test_aws_credentials_missing_error(self, mock_run):
        """Test handling missing AWS credentials."""
        mock_run.return_value = Mock(
            stdout="", stderr="Error: AWS credentials not found", returncode=1
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="AWS credentials"):
                db.s3("s3://bucket/data.csv", "SELECT * FROM data")


class TestSubprocessErrors:
    """Test subprocess-level error handling."""

    @patch("subprocess.run")
    def test_cli_executable_not_found(self, mock_run):
        """Test handling when db CLI executable is not found."""
        mock_run.side_effect = FileNotFoundError("db command not found")

        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_path="/nonexistent/db")
            with pytest.raises(FileNotFoundError):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_cli_timeout(self, mock_run):
        """Test handling CLI timeout."""
        import subprocess

        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["db"], timeout=30)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(subprocess.TimeoutExpired):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_cli_permission_error(self, mock_run):
        """Test handling permission error on CLI execution."""
        mock_run.side_effect = PermissionError("Permission denied")

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(PermissionError):
                db.query("SELECT * FROM users")


class TestReturnCodeHandling:
    """Test handling of different return codes."""

    @patch("subprocess.run")
    def test_return_code_0_success(self, mock_run, sample_json_output):
        """Test that return code 0 is success."""
        mock_run.return_value = Mock(stdout=sample_json_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users")

            assert isinstance(result, list)

    @patch("subprocess.run")
    def test_return_code_1_raises_error(self, mock_run):
        """Test that return code 1 raises DBError."""
        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_return_code_2_raises_error(self, mock_run):
        """Test that return code 2 raises DBError."""
        mock_run.return_value = Mock(stdout="", stderr="Invalid argument", returncode=2)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError):
                db.query("SELECT * FROM users")

    @patch("subprocess.run")
    def test_return_code_with_stderr_but_success(self, mock_run, sample_json_output):
        """Test that stderr with return code 0 is still success."""
        mock_run.return_value = Mock(
            stdout=sample_json_output, stderr="Warning: deprecated syntax", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.query("SELECT * FROM users")

            # Should succeed despite stderr (returncode is 0)
            assert isinstance(result, list)


class TestPartialFailures:
    """Test handling of partial failures."""

    @patch("subprocess.run")
    def test_investigation_partial_success(self, mock_run):
        """Test investigation that completes with some errors."""
        output = """
ITERATION 1
Some data

ERROR in query: syntax error

INVESTIGATION COMPLETE

Partial results based on available data.
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate("test question", csv_file="./data.csv")

            # Should still return result structure
            assert "answer" in result
            assert "iterations" in result

    @patch("subprocess.run")
    def test_malformed_output_graceful_handling(self, mock_run):
        """Test graceful handling of malformed output."""
        mock_run.return_value = Mock(
            stdout="Unexpected output format", stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            # Should not raise, but return raw output or empty
            result = db.ask("test", csv_file="./data.csv")

            assert isinstance(result, str)
