"""
Tests for DB class initialization and configuration.
"""

import os
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest
from db_sdk import DB, Config


class TestDBInit:
    """Test DB initialization."""

    def test_init_with_defaults(self, temp_config_file):
        """Test initializing DB with default parameters."""
        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB()

            assert db.db_path is not None
            assert db.datasource == "production"

    def test_init_with_custom_db_path(self, temp_config_file):
        """Test initializing DB with custom db CLI path."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_path="/custom/path/to/db")
            assert db.db_path == "/custom/path/to/db"

    def test_init_with_datasource(self, temp_config_file):
        """Test initializing DB with specific datasource."""
        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB(datasource="staging")
            assert db.datasource == "staging"

    def test_init_uses_active_datasource_when_none_specified(self, temp_config_file):
        """Test that DB uses active datasource from config when none specified."""
        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB()
            assert db.datasource == "production"

    def test_init_with_custom_config_path(self, temp_config_file):
        """Test initializing DB with custom config path."""
        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB(config_path="/custom/config.yaml")
            MockConfig.assert_called_once_with("/custom/config.yaml")


class TestDBEnvironmentVariables:
    """Test DB environment variable handling."""

    def test_init_with_env_dict(self):
        """Test initializing DB with custom environment dict."""
        with patch("db_sdk.db_sdk.Config"):
            custom_env = {"CUSTOM_VAR": "value"}
            db = DB(env=custom_env)

            assert "CUSTOM_VAR" in db.env
            assert db.env["CUSTOM_VAR"] == "value"

    def test_init_inherits_os_environ_by_default(self):
        """Test that DB inherits os.environ by default."""
        with patch("db_sdk.db_sdk.Config"):
            with patch.dict(os.environ, {"TEST_VAR": "test_value"}):
                db = DB()
                assert "TEST_VAR" in db.env
                assert db.env["TEST_VAR"] == "test_value"

    def test_db_host_override(self):
        """Test DB_HOST environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_host="custom-host.com")
            assert db.env["DB_HOST"] == "custom-host.com"

    def test_db_port_override(self):
        """Test DB_PORT environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_port=6543)
            assert db.env["DB_PORT"] == "6543"

    def test_db_port_string_conversion(self):
        """Test that db_port int is converted to string."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_port=5432)
            assert isinstance(db.env["DB_PORT"], str)
            assert db.env["DB_PORT"] == "5432"

    def test_db_name_override(self):
        """Test DB_NAME environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_name="my_database")
            assert db.env["DB_NAME"] == "my_database"

    def test_db_user_override(self):
        """Test DB_USER environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_user="admin")
            assert db.env["DB_USER"] == "admin"

    def test_db_password_override(self):
        """Test DB_PASSWORD environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_password="secret123")
            assert db.env["DB_PASSWORD"] == "secret123"

    def test_anthropic_api_key_override(self):
        """Test ANTHROPIC_API_KEY environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(anthropic_api_key="sk-ant-test")
            assert db.env["ANTHROPIC_API_KEY"] == "sk-ant-test"

    def test_aws_region_override(self):
        """Test AWS_REGION environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(aws_region="us-west-2")
            assert db.env["AWS_REGION"] == "us-west-2"

    def test_aws_profile_override(self):
        """Test AWS_PROFILE environment variable override."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(aws_profile="production")
            assert db.env["AWS_PROFILE"] == "production"

    def test_multiple_overrides(self):
        """Test multiple environment variable overrides at once."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB(
                db_host="host.com",
                db_port=5432,
                db_name="testdb",
                db_user="user",
                db_password="pass",
                anthropic_api_key="sk-ant-123",
            )

            assert db.env["DB_HOST"] == "host.com"
            assert db.env["DB_PORT"] == "5432"
            assert db.env["DB_NAME"] == "testdb"
            assert db.env["DB_USER"] == "user"
            assert db.env["DB_PASSWORD"] == "pass"
            assert db.env["ANTHROPIC_API_KEY"] == "sk-ant-123"

    def test_none_values_not_set(self):
        """Test that None values don't override environment variables."""
        with patch("db_sdk.db_sdk.Config"):
            with patch.dict(os.environ, {"DB_HOST": "existing-host"}):
                db = DB(db_host=None)
                # Should keep existing value from os.environ
                assert db.env.get("DB_HOST") == "existing-host"


class TestDBConfigAttribute:
    """Test DB config attribute."""

    def test_config_attribute_exists(self, temp_config_file):
        """Test that DB instance has config attribute."""
        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB()
            assert hasattr(db, "config")
            assert db.config is mock_config

    def test_config_loads_from_custom_path(self, temp_config_file):
        """Test that config loads from custom path."""
        with patch("db_sdk.db_sdk.Config") as MockConfig:
            mock_config = Mock()
            mock_config.get_active_datasource.return_value = "production"
            MockConfig.return_value = mock_config

            db = DB(config_path="/custom/path.yaml")
            MockConfig.assert_called_once_with("/custom/path.yaml")


class TestDBRunMethod:
    """Test internal _run method."""

    @patch("subprocess.run")
    def test_run_executes_command(self, mock_run):
        """Test that _run executes db CLI command."""
        mock_run.return_value = Mock(stdout="output", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_path="/path/to/db")
            result = db._run(["--help"])

            mock_run.assert_called_once()
            args = mock_run.call_args[0][0]
            assert args[0] == "/path/to/db"
            assert "--help" in args

    @patch("subprocess.run")
    def test_run_passes_environment(self, mock_run):
        """Test that _run passes environment variables."""
        mock_run.return_value = Mock(stdout="", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(db_host="custom-host")
            db._run(["SELECT 1"])

            kwargs = mock_run.call_args[1]
            assert "env" in kwargs
            assert kwargs["env"]["DB_HOST"] == "custom-host"

    @patch("subprocess.run")
    def test_run_captures_output(self, mock_run):
        """Test that _run captures stdout and stderr."""
        mock_run.return_value = Mock(stdout="output", stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db._run(["SELECT 1"])

            kwargs = mock_run.call_args[1]
            assert kwargs["capture_output"] is True
            assert kwargs["text"] is True

    @patch("subprocess.run")
    def test_run_raises_on_error_by_default(self, mock_run):
        """Test that _run raises DBError on non-zero exit by default."""
        from db_sdk import DBError

        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            with pytest.raises(DBError, match="Command failed"):
                db._run(["SELECT 1"])

    @patch("subprocess.run")
    def test_run_no_check_returns_error_result(self, mock_run):
        """Test that _run with check=False returns error result."""
        mock_run.return_value = Mock(stdout="", stderr="Error message", returncode=1)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db._run(["SELECT 1"], check=False)

            assert result.returncode == 1
            assert "Error message" in result.stderr


class TestDBDefaultPath:
    """Test default db CLI path resolution."""

    def test_default_path_resolves_to_parent_dir(self):
        """Test that default db_path resolves to ../db from SDK."""
        with patch("db_sdk.db_sdk.Config"):
            db = DB()

            # Should be sdk/../db (i.e., /path/to/scripts/db_clean/db)
            assert "db" in db.db_path
            assert Path(db.db_path).name == "db"
