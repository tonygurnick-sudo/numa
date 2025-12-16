"""
Tests for Config class - YAML configuration management.
"""

from pathlib import Path

import pytest
import yaml
from db_sdk import Config, ConfigError


class TestConfigInit:
    """Test Config initialization."""

    def test_init_with_custom_path(self, temp_config_file):
        """Test initializing Config with custom path."""
        config = Config(temp_config_file)
        assert config.config_path == Path(temp_config_file)
        assert config._config is not None

    def test_init_creates_default_config_if_missing(self, tmp_path):
        """Test that Config creates default config if file doesn't exist."""
        config_path = tmp_path / "new_config.yaml"
        config = Config(str(config_path))

        assert config_path.exists()
        assert config.get_active_datasource() == "production"

    def test_default_config_structure(self, tmp_path):
        """Test default config has all required sections."""
        config_path = tmp_path / "config.yaml"
        config = Config(str(config_path))

        assert "active_datasource" in config._config
        assert "ai" in config._config
        assert "output" in config._config
        assert "datasources" in config._config
        assert "engines" in config._config


class TestDatasourceOperations:
    """Test datasource CRUD operations."""

    def test_get_active_datasource(self, temp_config_file):
        """Test getting active datasource."""
        config = Config(temp_config_file)
        assert config.get_active_datasource() == "production"

    def test_set_active_datasource(self, temp_config_file):
        """Test setting active datasource."""
        config = Config(temp_config_file)
        config.set_active_datasource("staging")
        assert config.get_active_datasource() == "staging"

    def test_set_active_datasource_nonexistent_raises_error(self, temp_config_file):
        """Test setting nonexistent datasource raises ConfigError."""
        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.set_active_datasource("nonexistent")

    def test_list_datasources(self, temp_config_file):
        """Test listing all datasources."""
        config = Config(temp_config_file)
        datasources = config.list_datasources()
        assert "production" in datasources
        assert "staging" in datasources
        assert len(datasources) == 2

    def test_get_datasource(self, temp_config_file):
        """Test getting datasource configuration."""
        config = Config(temp_config_file)
        ds = config.get_datasource("production")

        assert ds["type"] == "postgres"
        assert "connection" in ds
        assert ds["connection"]["host_env"] == "DB_HOST"

    def test_get_datasource_nonexistent_raises_error(self, temp_config_file):
        """Test getting nonexistent datasource raises ConfigError."""
        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.get_datasource("nonexistent")

    def test_add_datasource(self, temp_config_file):
        """Test adding a new datasource."""
        config = Config(temp_config_file)
        new_ds = {
            "type": "postgres",
            "description": "Dev database",
            "connection": {"host_env": "DEV_DB_HOST"},
        }

        config.add_datasource("dev", new_ds)
        assert "dev" in config.list_datasources()
        assert config.get_datasource("dev")["type"] == "postgres"

    def test_add_datasource_overwrites_existing(self, temp_config_file):
        """Test adding datasource with existing name overwrites it."""
        config = Config(temp_config_file)
        original = config.get_datasource("production")

        new_ds = {"type": "mysql", "description": "Updated"}
        config.add_datasource("production", new_ds)

        updated = config.get_datasource("production")
        assert updated["type"] == "mysql"
        assert updated["type"] != original["type"]

    def test_remove_datasource(self, temp_config_file):
        """Test removing a datasource."""
        config = Config(temp_config_file)
        config.remove_datasource("staging")

        assert "staging" not in config.list_datasources()
        assert "production" in config.list_datasources()

    def test_remove_datasource_nonexistent_raises_error(self, temp_config_file):
        """Test removing nonexistent datasource raises ConfigError."""
        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.remove_datasource("nonexistent")

    def test_remove_active_datasource_switches_to_remaining(self, temp_config_file):
        """Test removing active datasource switches to another one."""
        config = Config(temp_config_file)
        config.set_active_datasource("production")
        config.remove_datasource("production")

        # Should switch to remaining datasource
        assert config.get_active_datasource() == "staging"


class TestEngineOperations:
    """Test engine CRUD operations."""

    def test_list_engines(self, temp_config_file):
        """Test listing all engines."""
        config = Config(temp_config_file)
        engines = config.list_engines()

        assert "csv-sqlite" in engines
        assert "csv-duckdb" in engines

    def test_get_engine(self, temp_config_file):
        """Test getting engine configuration."""
        config = Config(temp_config_file)
        engine = config.get_engine("csv-sqlite")

        assert engine["description"] == "SQLite CSV engine"
        assert engine["table_name"] == "data"

    def test_get_engine_nonexistent_raises_error(self, temp_config_file):
        """Test getting nonexistent engine raises ConfigError."""
        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.get_engine("nonexistent")

    def test_add_engine(self, temp_config_file):
        """Test adding a new engine."""
        config = Config(temp_config_file)
        new_engine = {"description": "Athena engine", "type": "athena"}

        config.add_engine("athena", new_engine)
        assert "athena" in config.list_engines()
        assert config.get_engine("athena")["type"] == "athena"

    def test_remove_engine(self, temp_config_file):
        """Test removing an engine."""
        config = Config(temp_config_file)
        config.remove_engine("csv-duckdb")

        assert "csv-duckdb" not in config.list_engines()
        assert "csv-sqlite" in config.list_engines()

    def test_remove_engine_nonexistent_raises_error(self, temp_config_file):
        """Test removing nonexistent engine raises ConfigError."""
        config = Config(temp_config_file)
        with pytest.raises(ConfigError, match="not found"):
            config.remove_engine("nonexistent")


class TestAIConfig:
    """Test AI configuration management."""

    def test_get_ai_config(self, temp_config_file):
        """Test getting AI configuration."""
        config = Config(temp_config_file)
        ai_config = config.get_ai_config()

        assert ai_config["provider"] == "anthropic"
        assert ai_config["api_key_env"] == "ANTHROPIC_API_KEY"
        assert "agentic_model" in ai_config
        assert "single_query_model" in ai_config

    def test_set_ai_config(self, temp_config_file):
        """Test updating AI configuration."""
        config = Config(temp_config_file)
        new_ai_config = {
            "provider": "openai",
            "api_key_env": "OPENAI_API_KEY",
            "model": "gpt-4",
        }

        config.set_ai_config(new_ai_config)
        updated = config.get_ai_config()

        assert updated["provider"] == "openai"
        assert updated["model"] == "gpt-4"


class TestOutputConfig:
    """Test output configuration management."""

    def test_get_output_config(self, temp_config_file):
        """Test getting output configuration."""
        config = Config(temp_config_file)
        output_config = config.get_output_config()

        assert output_config["default_format"] == "csv"
        assert output_config["max_bytes"] == 20480
        assert "head_lines" in output_config
        assert "tail_lines" in output_config

    def test_set_output_config(self, temp_config_file):
        """Test updating output configuration."""
        config = Config(temp_config_file)
        new_output_config = {"default_format": "json", "max_bytes": 10240}

        config.set_output_config(new_output_config)
        updated = config.get_output_config()

        assert updated["default_format"] == "json"
        assert updated["max_bytes"] == 10240


class TestConfigPersistence:
    """Test config save and load operations."""

    def test_save_and_load(self, tmp_path):
        """Test saving and loading configuration."""
        config_path = tmp_path / "test_config.yaml"
        config1 = Config(str(config_path))

        # Add a datasource
        config1.add_datasource("test", {"type": "postgres"})
        config1.save()

        # Load in new Config instance
        config2 = Config(str(config_path))
        assert "test" in config2.list_datasources()

    def test_to_dict(self, temp_config_file):
        """Test converting config to dictionary."""
        config = Config(temp_config_file)
        config_dict = config.to_dict()

        assert isinstance(config_dict, dict)
        assert "active_datasource" in config_dict
        assert "datasources" in config_dict
        assert "engines" in config_dict

    def test_to_dict_returns_deep_copy(self, temp_config_file):
        """Test that to_dict returns a deep copy, not reference."""
        config = Config(temp_config_file)
        config_dict = config.to_dict()

        # Modify the returned dict
        config_dict["active_datasource"] = "modified"

        # Original should be unchanged
        assert config.get_active_datasource() != "modified"


class TestConfigErrorHandling:
    """Test config error handling."""

    def test_invalid_yaml_raises_error(self, tmp_path):
        """Test that invalid YAML raises ConfigError."""
        config_path = tmp_path / "invalid.yaml"
        with open(config_path, "w") as f:
            f.write("invalid: yaml: content: [\n")

        with pytest.raises(ConfigError, match="Failed to parse"):
            Config(str(config_path))

    def test_load_after_manual_file_deletion(self, temp_config_file):
        """Test loading config after file is manually deleted."""
        config = Config(temp_config_file)
        Path(temp_config_file).unlink()

        # Should recreate default config
        config.load()
        assert config._config is not None
