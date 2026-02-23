"""
Pytest configuration and shared fixtures.
"""

import os
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, Mock

import pytest
import yaml


@pytest.fixture
def temp_config_file():
    """Create a temporary config.engines.yaml file."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        config = {
            "active_datasource": "production",
            "ai": {
                "provider": "anthropic",
                "api_key_env": "ANTHROPIC_API_KEY",
                "agentic_model": "claude-3-5-haiku-20241022",
                "single_query_model": "claude-sonnet-4-6",
            },
            "output": {
                "default_format": "csv",
                "max_bytes": 20480,
                "head_lines": 200,
                "tail_lines": 200,
                "threshold": 400,
            },
            "datasources": {
                "production": {
                    "type": "postgres",
                    "description": "Production database",
                    "connection": {
                        "host_env": "DB_HOST",
                        "port_env": "DB_PORT",
                        "database_env": "DB_NAME",
                        "user_env": "DB_USER",
                        "password_env": "DB_PASSWORD",
                    },
                },
                "staging": {
                    "type": "postgres",
                    "description": "Staging database",
                    "connection": {
                        "host_env": "STAGING_DB_HOST",
                        "port_env": "STAGING_DB_PORT",
                        "database_env": "STAGING_DB_NAME",
                        "user_env": "STAGING_DB_USER",
                        "password_env": "STAGING_DB_PASSWORD",
                    },
                },
            },
            "engines": {
                "csv-sqlite": {
                    "description": "SQLite CSV engine",
                    "table_name": "data",
                },
                "csv-duckdb": {
                    "description": "DuckDB CSV engine",
                    "function": "read_csv_auto",
                },
            },
        }
        yaml.dump(config, f, default_flow_style=False)
        temp_path = f.name

    yield temp_path

    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


@pytest.fixture
def temp_csv_file():
    """Create a temporary CSV file for testing."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        f.write("product,region,amount\n")
        f.write("Widget,US,1500\n")
        f.write("Gadget,EU,2000\n")
        f.write("Widget,EU,1200\n")
        f.write("Gadget,US,1800\n")
        temp_path = f.name

    yield temp_path

    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


@pytest.fixture
def mock_subprocess_run():
    """Mock subprocess.run for CLI command testing."""

    def _create_mock(stdout="", stderr="", returncode=0):
        mock = Mock()
        result = Mock()
        result.stdout = stdout
        result.stderr = stderr
        result.returncode = returncode
        mock.return_value = result
        return mock

    return _create_mock


@pytest.fixture
def mock_db_cli_success():
    """Mock successful db CLI response."""

    def _create_result(output):
        result = Mock(spec=subprocess.CompletedProcess)
        result.stdout = output
        result.stderr = ""
        result.returncode = 0
        return result

    return _create_result


@pytest.fixture
def mock_db_cli_error():
    """Mock failed db CLI response."""

    def _create_result(error_msg):
        result = Mock(spec=subprocess.CompletedProcess)
        result.stdout = ""
        result.stderr = error_msg
        result.returncode = 1
        return result

    return _create_result


@pytest.fixture
def sample_json_output():
    """Sample JSON output from db CLI."""
    return '[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]'


@pytest.fixture
def sample_csv_output():
    """Sample CSV output from db CLI."""
    return "id,name\n1,Alice\n2,Bob\n"


@pytest.fixture
def sample_ask_output():
    """Sample --ask mode output."""
    return """
╔══════════════════════════════════════════════════════════════════════════════╗
║                                   ANSWER                                      ║
╠══════════════════════════════════════════════════════════════════════════════╣

Total sales by region: EU: $3,200 (2 products), US: $3,300 (2 products)

╚══════════════════════════════════════════════════════════════════════════════╝
"""


@pytest.fixture
def sample_investigate_output():
    """Sample --ask --auto mode output."""
    return """
╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 1                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Running query to understand data structure...

╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 2                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Analyzing sales trends...

╔══════════════════════════════════════════════════════════════════════════════╗
║                       INVESTIGATION COMPLETE                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣

Sales dropped in Q3 due to seasonal factors and increased competition.
Q3 saw a 15% decline compared to Q2, primarily in the EU region.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AGENT MEMORY: 2 iterations completed
"""


@pytest.fixture
def mock_env_vars():
    """Sample environment variables."""
    return {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "testdb",
        "DB_USER": "testuser",
        "DB_PASSWORD": "testpass",
        "ANTHROPIC_API_KEY": "sk-ant-test123",
    }


# ============================================================================
# Integration Test Fixtures (Real CLI execution)
# ============================================================================


@pytest.fixture
def real_test_csv():
    """Create a real CSV file for integration tests."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        f.write("id,name,amount,category,date\n")
        f.write("1,Alice,1500,electronics,2024-01-15\n")
        f.write("2,Bob,2000,furniture,2024-01-20\n")
        f.write("3,Charlie,1200,electronics,2024-02-10\n")
        f.write("4,Diana,1800,furniture,2024-02-15\n")
        f.write("5,Eve,2500,electronics,2024-03-01\n")
        temp_path = f.name

    yield temp_path

    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


@pytest.fixture
def real_sales_csv():
    """Create a sales CSV file for integration tests."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        f.write("product,region,amount,quantity,month\n")
        f.write("Widget,US,1500,10,2024-01\n")
        f.write("Widget,EU,1200,8,2024-01\n")
        f.write("Gadget,US,1800,12,2024-01\n")
        f.write("Gadget,EU,2000,15,2024-01\n")
        f.write("Widget,US,1600,11,2024-02\n")
        f.write("Widget,EU,1100,7,2024-02\n")
        f.write("Gadget,US,1700,11,2024-02\n")
        f.write("Gadget,EU,2100,16,2024-02\n")
        temp_path = f.name

    yield temp_path

    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


@pytest.fixture
def real_large_csv():
    """Create a larger CSV file for performance tests."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        f.write("id,value,category,timestamp\n")
        for i in range(1000):
            category = ["A", "B", "C", "D"][i % 4]
            f.write(f"{i},{i * 10},{category},2024-01-{(i % 28) + 1:02d}\n")
        temp_path = f.name

    yield temp_path

    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


@pytest.fixture
def check_anthropic_api_key():
    """Check if ANTHROPIC_API_KEY is set, skip test if not."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or api_key.startswith("sk-ant-test"):
        pytest.skip("ANTHROPIC_API_KEY not set (required for --ask/--auto tests)")
    return api_key


@pytest.fixture
def check_db_cli_exists():
    """Check if db CLI executable exists."""
    sdk_dir = Path(__file__).parent.parent
    db_path = sdk_dir.parent / "db"

    if not db_path.exists():
        pytest.skip(f"db CLI not found at {db_path}")

    if not os.access(db_path, os.X_OK):
        pytest.skip(f"db CLI at {db_path} is not executable")

    return str(db_path)
