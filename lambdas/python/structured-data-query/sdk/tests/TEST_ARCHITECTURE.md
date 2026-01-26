# Test Architecture: Unit vs Integration Tests

## Philosophy

This SDK uses a **dual testing strategy** combining both unit and integration tests:

1. **Unit Tests** (mocked): Fast, test SDK logic/API, no external dependencies
2. **Integration Tests** (real): Slower, test actual CLI execution, catch real bugs

This follows industry best practices and gives maximum confidence in the SDK.

---

## Test Structure

```
tests/
├── conftest.py                           # Shared fixtures
├── pytest.ini                            # Pytest configuration & markers
│
├── UNIT TESTS (mocked, ~500 tests)
├── test_config.py                        # Config class (90+ tests)
├── test_db_init.py                       # DB initialization (60+ tests)
├── test_csv_queries.py                   # CSV queries (70+ tests)
├── test_natural_language.py              # --ask/--auto (80+ tests)
├── test_postgres_queries.py              # PostgreSQL (55+ tests)
├── test_datasource.py                    # Datasource handling (50+ tests)
├── test_error_handling.py                # Error cases (60+ tests)
├── test_convenience_functions.py         # Module functions (45+ tests)
│
└── INTEGRATION TESTS (real CLI, ~50 tests)
    ├── test_integration_csv.py           # Real CSV queries (30+ tests)
    └── test_integration_natural_language.py  # Real --ask/--auto (20+ tests)
```

---

## Unit Tests (Mocked)

### What They Test
- SDK command construction logic
- Parameter passing and validation
- Environment variable handling
- Configuration management
- Error handling and exceptions
- API surface and method signatures

### Characteristics
- ⚡ **Fast**: Run in seconds (no CLI execution)
- 🚫 **No Dependencies**: Don't need CLI, DB, or API keys
- 🎯 **Isolated**: Each test is independent
- 🔄 **TDD-Friendly**: Great for rapid development

### Example Test

```python
@patch('subprocess.run')
def test_csv_query_with_local_file(self, mock_run, sample_json_output):
    """Test querying a local CSV file."""
    mock_run.return_value = Mock(
        stdout=sample_json_output,
        stderr="",
        returncode=0
    )

    db = DB()
    result = db.csv("./data.csv", "SELECT * FROM data")

    # Verify command construction
    args = mock_run.call_args[0][0]
    assert "--csv" in args
    assert "./data.csv" in args

    # Verify result parsing
    assert isinstance(result, list)
    assert len(result) == 2
```

**What it verifies:**
- SDK builds correct command (`--csv ./data.csv`)
- SDK parses JSON output correctly
- SDK returns expected data structure

**What it doesn't verify:**
- Whether the CLI actually works
- Whether the CSV file can be read
- Whether SQLite processes the query correctly

---

## Integration Tests (Real CLI)

### What They Test
- **Actual CLI execution** end-to-end
- Real CSV parsing and SQL processing
- Real AI API calls (--ask/--auto)
- File I/O and permissions
- Error messages from real failures

### Characteristics
- 🐢 **Slower**: Each test executes real CLI (seconds per test)
- 📦 **Dependencies**: Need db CLI, may need ANTHROPIC_API_KEY
- 🔍 **Thorough**: Catch real-world bugs
- 🎯 **E2E**: Test complete workflows

### Example Test

```python
@pytest.mark.integration
def test_csv_query_select_all(self, check_db_cli_exists, real_test_csv):
    """Test basic SELECT * query on real CSV file."""
    db = DB(db_path=check_db_cli_exists)
    result = db.csv(real_test_csv, "SELECT * FROM data")

    # Verify REAL results from REAL CSV
    assert isinstance(result, list)
    assert len(result) == 5
    assert result[0]['name'] == 'Alice'
    assert result[0]['amount'] == 1500
```

**What it verifies:**
- CLI executable exists and is executable
- CLI can actually read CSV files
- SQLite processes queries correctly
- SDK parses real CLI output
- Data round-trips correctly
- **Everything works end-to-end**

---

## Pytest Markers

Tests are marked to indicate their type and requirements:

### Available Markers

```python
@pytest.mark.unit            # Unit test (mocked, fast)
@pytest.mark.integration     # Integration test (real CLI)
@pytest.mark.slow            # Takes >1 second
@pytest.mark.requires_api_key    # Needs ANTHROPIC_API_KEY
@pytest.mark.requires_db     # Needs PostgreSQL database
@pytest.mark.requires_aws    # Needs AWS credentials
```

### How They Work

```bash
# Run only unit tests
pytest -m "not integration"

# Run only integration tests
pytest -m "integration"

# Run all tests
pytest

# Skip slow tests
pytest -m "not slow"

# Run only tests that don't need API key
pytest -m "integration and not requires_api_key"
```

---

## Running Tests

### Quick Reference

```bash
cd sdk

# DEFAULT: Unit tests only (fast, no deps)
./run_all.sh

# Explicit unit tests
./run_all.sh --unit

# Integration tests (needs CLI)
./run_all.sh --integration

# Everything
./run_all.sh --all

# With coverage
./run_all.sh --all --cov
```

### Test Modes Explained

#### 1. Unit Tests (Default)
```bash
./run_all.sh
# OR
./run_all.sh --unit
```

- Runs ~500 mocked tests
- Completes in ~5 seconds
- No external dependencies
- **Use for**: Development, TDD, pre-commit hooks

#### 2. Integration Tests
```bash
./run_all.sh --integration
```

- Runs ~50 real CLI tests
- Completes in ~30 seconds (or longer with --ask/--auto)
- Requires db CLI executable
- Some tests need ANTHROPIC_API_KEY
- **Use for**: Pre-release validation, CI/CD

#### 3. All Tests
```bash
./run_all.sh --all
```

- Runs everything (~550 tests)
- Completes in ~35 seconds
- Full confidence before release
- **Use for**: Final verification, releases

---

## Test Fixtures

### Unit Test Fixtures (conftest.py)

**Mocked fixtures:**
- `mock_subprocess_run`: Mock subprocess.run
- `mock_db_cli_success`: Mock successful CLI response
- `mock_db_cli_error`: Mock failed CLI response
- `sample_json_output`: Sample JSON response
- `sample_csv_output`: Sample CSV response
- `sample_ask_output`: Sample --ask response
- `sample_investigate_output`: Sample --ask --auto response
- `temp_config_file`: Temporary YAML config
- `mock_env_vars`: Sample environment variables

### Integration Test Fixtures (conftest.py)

**Real fixtures:**
- `real_test_csv`: Real CSV with 5 rows (mixed data)
- `real_sales_csv`: Real CSV with 8 rows (sales data)
- `real_large_csv`: Real CSV with 1000 rows (performance testing)
- `check_anthropic_api_key`: Verify API key is set (skips if not)
- `check_db_cli_exists`: Verify CLI executable exists

---

## Writing New Tests

### Adding a Unit Test

```python
@patch('subprocess.run')
def test_my_feature(self, mock_run, sample_json_output):
    """Test my new feature."""
    mock_run.return_value = Mock(
        stdout=sample_json_output,
        stderr="",
        returncode=0
    )

    with patch('db_sdk.db_sdk.Config'):
        db = DB()
        result = db.my_new_method()

        # Assert command construction
        args = mock_run.call_args[0][0]
        assert "--my-flag" in args

        # Assert result
        assert result is not None
```

### Adding an Integration Test

```python
@pytest.mark.integration
def test_my_feature_real(self, check_db_cli_exists, real_test_csv):
    """Test my new feature with real CLI."""
    db = DB(db_path=check_db_cli_exists)
    result = db.my_new_method(real_test_csv)

    # Assert REAL results
    assert len(result) == 5
    assert result[0]['actual_data'] == 'expected_value'
```

### Adding an Integration Test with AI

```python
@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
def test_ai_feature(self, check_db_cli_exists, check_anthropic_api_key, real_test_csv):
    """Test AI feature with real API calls."""
    db = DB(db_path=check_db_cli_exists)
    answer = db.ask("my question", csv_file=real_test_csv)

    assert isinstance(answer, str)
    assert len(answer) > 0
```

---

## Best Practices

### Do's ✅

1. **Write unit tests first** - Fast feedback during development
2. **Add integration tests for critical paths** - Ensure it actually works
3. **Use descriptive test names** - Explain what's being tested
4. **Test one thing per test** - Easier to debug failures
5. **Use fixtures** - DRY principle for test setup
6. **Mark tests appropriately** - `@pytest.mark.integration`, `@pytest.mark.slow`
7. **Skip gracefully** - Use fixtures like `check_anthropic_api_key`

### Don'ts ❌

1. **Don't mock in integration tests** - Defeats the purpose
2. **Don't make integration tests too slow** - Keep under 5 seconds each
3. **Don't test implementation details** - Test behavior, not code
4. **Don't skip assertions** - Every test should assert something
5. **Don't duplicate coverage** - If unit test covers it, integration test might not need to
6. **Don't hard-code paths** - Use fixtures and temp files

---

## CI/CD Integration

### Recommended CI Pipeline

```yaml
# Example GitHub Actions
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: pip install pytest pytest-cov pyyaml
      - name: Run unit tests
        run: cd sdk && ./run_all.sh --unit --cov

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: pip install pytest pyyaml
      - name: Make CLI executable
        run: chmod +x backend/scripts/db_clean/db
      - name: Run integration tests (without API key)
        run: cd sdk && ./run_all.sh --integration -m "not requires_api_key"
```

### Test Strategy by Environment

| Environment | Tests to Run | Why |
|------------|--------------|-----|
| **Local Dev** | Unit only (`./run_all.sh`) | Fast feedback |
| **Pre-commit** | Unit only | Fast, no deps |
| **PR Checks** | Unit + Integration (no API) | Verify CLI works |
| **Pre-release** | All tests | Full validation |
| **Production Deploy** | All tests | Maximum confidence |

---

## Coverage Goals

### Unit Tests
- **Target**: >90% code coverage
- **Focus**: SDK logic, error handling, parameter passing
- **Current**: ~95% coverage

### Integration Tests
- **Target**: Cover critical user paths
- **Focus**: E2E workflows, real CLI execution
- **Current**: All major features covered

### Combined
- **500+ unit tests**: Fast, comprehensive SDK coverage
- **50+ integration tests**: Real-world validation
- **Total: 550+ tests**: High confidence in releases

---

## Troubleshooting

### "db CLI not found"
Integration tests need the CLI at `../db` relative to SDK.

```bash
# Make sure CLI is executable
chmod +x backend/scripts/db_clean/db

# OR specify path
pytest --db-path=/path/to/db
```

### "ANTHROPIC_API_KEY not set"
Some integration tests need the API key. Either:

```bash
# Set the key
export ANTHROPIC_API_KEY=sk-ant-...

# OR skip those tests
./run_all.sh --integration -m "not requires_api_key"
```

### "Tests are slow"
If integration tests are too slow:

```bash
# Run only fast integration tests
./run_all.sh --integration -m "not slow"

# OR stick to unit tests for dev
./run_all.sh --unit
```

---

## Summary

**Unit Tests** (mocked):
- ✅ Fast (seconds)
- ✅ No dependencies
- ✅ Test SDK logic
- ❌ Don't catch CLI bugs

**Integration Tests** (real):
- ✅ Test actual CLI
- ✅ Catch real bugs
- ✅ Full confidence
- ❌ Slower (but worth it)

**Together**: Best of both worlds! 🚀

Use `./run_all.sh` for daily development (unit tests only).
Use `./run_all.sh --all` before releases (full validation).
