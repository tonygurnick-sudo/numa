# DB CLI SDK Test Suite

Comprehensive pytest test suite for the DB CLI Python SDK.

## Overview

This test suite provides extensive coverage of all SDK features:

- **Config Management**: YAML configuration, datasources, engines
- **DB Initialization**: Environment variables, datasource handling
- **CSV Queries**: Local files, URLs, Google Sheets, engines (PRIMARY FEATURE)
- **Natural Language**: --ask and --auto modes (MOST IMPORTANT FEATURES)
- **PostgreSQL Queries**: Standard SQL queries, formats, datasources
- **Datasource Handling**: Parameter passing, overrides, consistency
- **Error Handling**: DBError, ConfigError, CLI errors, edge cases
- **Convenience Functions**: Module-level query(), csv(), ask(), investigate()

## Quick Start

### Install Dependencies

```bash
pip install pytest pytest-cov pyyaml
```

### Run All Tests

```bash
cd sdk
./run_all.sh
```

### Run Specific Tests

```bash
# Run only CSV tests
./run_all.sh -k test_csv

# Run only natural language tests (--ask and --auto)
./run_all.sh -k "ask or auto"

# Run only Config tests
./run_all.sh -k test_config

# Run with verbose output
./run_all.sh -v

# Run with coverage report
./run_all.sh --cov
```

## Test Files

### test_config.py (Config Class)

- **90+ tests** for YAML configuration management
- Datasource CRUD operations
- Engine management
- AI and output configuration
- Persistence and error handling

**Key test classes:**

- `TestConfigInit`: Initialization and defaults
- `TestDatasourceOperations`: Add, remove, get, set datasources
- `TestEngineOperations`: Engine CRUD operations
- `TestAIConfig`: AI configuration management
- `TestOutputConfig`: Output settings
- `TestConfigPersistence`: Save/load operations

### test_db_init.py (DB Initialization)

- **60+ tests** for DB class initialization
- Environment variable handling
- Datasource configuration
- Custom paths and overrides

**Key test classes:**

- `TestDBInit`: Basic initialization
- `TestDBEnvironmentVariables`: Env var overrides (DB_HOST, DB_PORT, etc.)
- `TestDBConfigAttribute`: Config integration
- `TestDBRunMethod`: Internal \_run() method
- `TestDBDefaultPath`: Default path resolution

### test_csv_queries.py (CSV Queries - PRIMARY FEATURE)

- **70+ tests** for CSV query operations
- Local files, URLs, Google Sheets
- Engines: csv-sqlite, csv-duckdb, s3-csv-sqlite
- Complex queries and edge cases

**Key test classes:**

- `TestCSVBasicQueries`: SELECT, WHERE, aggregations
- `TestCSVEngines`: sqlite vs duckdb
- `TestCSVComplexQueries`: JOINs, GROUP BY, ORDER BY
- `TestCSVAdditionalArguments`: Kwargs handling
- `TestCSVJSONParsing`: Empty results, NULL, special chars
- `TestCSVLargeFiles`: Performance with DuckDB

### test_natural_language.py (--ask & --auto - MOST IMPORTANT)

- **80+ tests** for natural language queries and agentic investigations
- CSV and PostgreSQL modes
- Answer extraction and parsing

**Key test classes:**

- `TestAskCSV`: Natural language queries on CSV (PRIMARY USE CASE)
- `TestAskPostgreSQL`: Natural language queries on PostgreSQL
- `TestInvestigateCSV`: Agentic investigations on CSV (PRIMARY USE CASE)
- `TestInvestigatePostgreSQL`: Agentic investigations on PostgreSQL
- `TestAnswerExtraction`: Parsing CLI output
- `TestNaturalLanguageKwargs`: Additional arguments

### test_postgres_queries.py (PostgreSQL Queries)

- **55+ tests** for PostgreSQL operations
- Standard SQL queries
- Output formats (json, csv, table)
- Transactions and meta queries

**Key test classes:**

- `TestPostgreSQLBasicQueries`: SELECT, WHERE, JOIN, GROUP BY
- `TestPostgreSQLFormats`: json, csv, table outputs
- `TestPostgreSQLDatasource`: Datasource parameter
- `TestPostgreSQLKwargs`: Additional arguments
- `TestPostgreSQLEdgeCases`: NULL, special chars, multiline
- `TestPostgreSQLTransactions`: BEGIN, COMMIT
- `TestPostgreSQLMetaQueries`: Schema inspection

### test_datasource.py (Datasource Parameters)

- **50+ tests** for datasource handling across all methods
- Instance vs override datasources
- CSV vs PostgreSQL mode behavior

**Key test classes:**

- `TestDatasourceInQuery`: query() datasource handling
- `TestDatasourceInAsk`: ask() datasource handling
- `TestDatasourceInInvestigate`: investigate() datasource handling
- `TestDatasourceWithConfig`: Config integration
- `TestDatasourceEdgeCases`: None, empty string, special chars
- `TestDatasourceConsistency`: Behavior across methods

### test_error_handling.py (Error Cases)

- **60+ tests** for error scenarios
- DBError and ConfigError exceptions
- CLI errors, subprocess errors
- Return code handling

**Key test classes:**

- `TestDBErrorHandling`: DBError exceptions
- `TestConfigErrorHandling`: ConfigError exceptions
- `TestCLIErrors`: SQL syntax, permissions, connections
- `TestSubprocessErrors`: Executable not found, timeouts
- `TestReturnCodeHandling`: Exit codes
- `TestPartialFailures`: Graceful degradation

### test_convenience_functions.py (Module-Level Functions)

- **45+ tests** for convenience functions
- query(), csv(), ask(), investigate()
- Module exports and usability

**Key test classes:**

- `TestConvenienceQuery`: Module-level query()
- `TestConvenienceCSV`: Module-level csv()
- `TestConvenienceAsk`: Module-level ask()
- `TestConvenienceInvestigate`: Module-level investigate()
- `TestConvenienceFunctionErrors`: Error propagation
- `TestConvenienceFunctionDefaultBehavior`: Environment, config
- `TestConvenienceFunctionUsability`: One-liner usage
- `TestModuleLevelImports`: **all** exports

## Test Fixtures

All tests use mocked subprocess calls - **no actual database or CLI required**.

**Shared fixtures** (from `conftest.py`):

- `temp_config_file`: Temporary YAML config
- `temp_csv_file`: Temporary CSV for testing
- `mock_subprocess_run`: Mock subprocess.run
- `mock_db_cli_success`: Mock successful CLI response
- `mock_db_cli_error`: Mock failed CLI response
- `sample_json_output`: Sample JSON response
- `sample_csv_output`: Sample CSV response
- `sample_ask_output`: Sample --ask response
- `sample_investigate_output`: Sample --ask --auto response
- `mock_env_vars`: Sample environment variables

## Running Tests

### Basic Usage

```bash
# Run all tests
./run_all.sh

# Verbose mode
./run_all.sh -v

# Very verbose
./run_all.sh -vv

# Exit on first failure
./run_all.sh -x
```

### Pattern Matching

```bash
# Run tests by file
./run_all.sh -k test_csv_queries
./run_all.sh -k test_natural_language

# Run tests by class
./run_all.sh -k TestAskCSV
./run_all.sh -k TestInvestigateCSV

# Run tests by method name
./run_all.sh -k "test_ask_csv_basic"
./run_all.sh -k "test_investigate"

# Run multiple patterns
./run_all.sh -k "ask or auto"        # Natural language tests
./run_all.sh -k "csv and not error"  # CSV tests excluding errors
```

### Coverage Reports

```bash
# Generate coverage report
./run_all.sh --cov

# View HTML coverage report
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

### Advanced Usage

```bash
# Run only failed tests from last run
./run_all.sh --lf

# Run failed tests first, then others
./run_all.sh --ff

# Combination
./run_all.sh -v --cov -k test_natural_language
```

## Direct Pytest Usage

You can also run pytest directly:

```bash
cd sdk

# Run all tests
pytest tests/

# Run specific file
pytest tests/test_config.py

# Run specific class
pytest tests/test_natural_language.py::TestAskCSV

# Run specific test
pytest tests/test_csv_queries.py::TestCSVBasicQueries::test_csv_query_with_local_file

# With markers
pytest tests/ -v -s --tb=short
```

## Test Coverage

**Total: 500+ tests** covering:

- ✅ Config class (90+ tests)
- ✅ DB initialization (60+ tests)
- ✅ CSV queries (70+ tests) - PRIMARY FEATURE
- ✅ Natural language (80+ tests) - MOST IMPORTANT
- ✅ PostgreSQL queries (55+ tests)
- ✅ Datasource handling (50+ tests)
- ✅ Error handling (60+ tests)
- ✅ Convenience functions (45+ tests)

## Writing New Tests

### Test Structure

```python
import pytest
from unittest.mock import patch, Mock
from db_sdk import DB

class TestNewFeature:
    """Test description."""

    @patch('subprocess.run')
    def test_new_functionality(self, mock_run, sample_json_output):
        """Test that new feature works correctly."""
        mock_run.return_value = Mock(
            stdout=sample_json_output,
            stderr="",
            returncode=0
        )

        with patch('db_sdk.db_sdk.Config'):
            db = DB()
            result = db.new_method()

            assert result is not None
```

### Best Practices

1. **Use fixtures**: Leverage shared fixtures from conftest.py
2. **Mock subprocess**: All tests should mock subprocess.run
3. **Descriptive names**: Test names should clearly describe what they test
4. **Docstrings**: Add docstrings explaining test purpose
5. **Test classes**: Group related tests in classes
6. **Assertions**: Use clear, specific assertions

## CI/CD Integration

The test suite is designed for CI/CD:

```yaml
# Example GitHub Actions
- name: Run tests
  run: |
    cd sdk
    pip install pytest pytest-cov pyyaml
    ./run_all.sh --cov
```

## Troubleshooting

### pytest not found

```bash
pip install pytest pytest-cov
```

### PyYAML not installed

```bash
pip install pyyaml
```

### Permission denied on run_all.sh

```bash
chmod +x run_all.sh
```

### Import errors

```bash
# Add parent directory to PYTHONPATH
export PYTHONPATH="$PYTHONPATH:$(pwd)/.."
```

## Resources

- [pytest documentation](https://docs.pytest.org/)
- [unittest.mock guide](https://docs.python.org/3/library/unittest.mock.html)
- [pytest-cov plugin](https://pytest-cov.readthedocs.io/)

## Summary

This test suite provides:

- ✅ **Comprehensive coverage** (500+ tests)
- ✅ **Fast execution** (all mocked, no external dependencies)
- ✅ **Easy to run** (./run_all.sh)
- ✅ **Well organized** (8 test files, clear structure)
- ✅ **Detailed tests** (robust edge case coverage)
- ✅ **Diverse scenarios** (CSV, PostgreSQL, natural language, errors)
- ✅ **CI/CD ready** (automated, reliable)

Run the tests with confidence! 🚀
