#!/bin/bash

#
# run_all.sh - Run all pytest tests for the DB CLI SDK
#
# Usage:
#   ./run_all.sh                 # Run unit tests only (default, fast)
#   ./run_all.sh --unit          # Run unit tests only
#   ./run_all.sh --integration   # Run integration tests (real CLI execution)
#   ./run_all.sh --all           # Run both unit and integration tests
#   ./run_all.sh -v              # Run with verbose output
#   ./run_all.sh -k pattern      # Run tests matching pattern
#   ./run_all.sh --cov           # Run with coverage report
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                        DB CLI SDK Test Suite                                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo -e "${RED}Error: pytest is not installed${NC}"
    echo ""
    echo "Install pytest with:"
    echo "  pip install pytest pytest-cov pyyaml"
    echo ""
    exit 1
fi

# Check if PyYAML is installed (required for Config tests)
if ! python3 -c "import yaml" 2>/dev/null; then
    echo -e "${YELLOW}Warning: PyYAML is not installed (required for Config tests)${NC}"
    echo "Install with: pip install pyyaml"
    echo ""
fi

# Display test structure
echo -e "${BLUE}Test Structure:${NC}"
echo "  tests/"
echo "    ${YELLOW}UNIT TESTS (mocked, fast):${NC}"
echo "    ├── test_config.py               (Config class - YAML management)"
echo "    ├── test_db_init.py              (DB initialization)"
echo "    ├── test_csv_queries.py          (CSV queries - PRIMARY FEATURE)"
echo "    ├── test_natural_language.py     (--ask & --auto - MOST IMPORTANT)"
echo "    ├── test_postgres_queries.py     (PostgreSQL queries)"
echo "    ├── test_datasource.py           (Datasource parameters)"
echo "    ├── test_error_handling.py       (Error cases)"
echo "    ├── test_convenience_functions.py (Module-level functions)"
echo ""
echo "    ${GREEN}INTEGRATION TESTS (real CLI execution):${NC}"
echo "    ├── test_integration_csv.py              (Real CSV queries)"
echo "    └── test_integration_natural_language.py (Real --ask & --auto)"
echo ""

# Parse command line arguments
PYTEST_ARGS=()
COVERAGE=false
VERBOSE=false
TEST_MODE="unit"  # Default to unit tests only

while [[ $# -gt 0 ]]; do
    case $1 in
        --unit)
            TEST_MODE="unit"
            shift
            ;;
        --integration)
            TEST_MODE="integration"
            shift
            ;;
        --all)
            TEST_MODE="all"
            shift
            ;;
        --cov|--coverage)
            COVERAGE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            PYTEST_ARGS+=("-v")
            shift
            ;;
        -vv)
            VERBOSE=true
            PYTEST_ARGS+=("-vv")
            shift
            ;;
        -k)
            PYTEST_ARGS+=("-k" "$2")
            shift 2
            ;;
        -x|--exitfirst)
            PYTEST_ARGS+=("-x")
            shift
            ;;
        --lf|--last-failed)
            PYTEST_ARGS+=("--lf")
            shift
            ;;
        --ff|--failed-first)
            PYTEST_ARGS+=("--ff")
            shift
            ;;
        -h|--help)
            echo "Usage: ./run_all.sh [OPTIONS]"
            echo ""
            echo "Test Modes:"
            echo "  --unit               Run unit tests only (default, fast, no deps)"
            echo "  --integration        Run integration tests (real CLI execution)"
            echo "  --all                Run both unit and integration tests"
            echo ""
            echo "Options:"
            echo "  -v, --verbose        Verbose output"
            echo "  -vv                  Very verbose output"
            echo "  -k PATTERN           Run tests matching pattern"
            echo "  -x, --exitfirst      Exit on first failure"
            echo "  --lf, --last-failed  Run only tests that failed last time"
            echo "  --ff, --failed-first Run failed tests first, then others"
            echo "  --cov, --coverage    Generate coverage report"
            echo "  -h, --help           Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./run_all.sh                    # Run unit tests (fast)"
            echo "  ./run_all.sh --unit             # Run unit tests explicitly"
            echo "  ./run_all.sh --integration      # Run integration tests (slower)"
            echo "  ./run_all.sh --all              # Run all tests"
            echo "  ./run_all.sh --integration -v   # Integration tests with verbose"
            echo "  ./run_all.sh -k test_csv        # Run only CSV tests (unit)"
            echo "  ./run_all.sh --all --cov        # All tests with coverage"
            echo ""
            exit 0
            ;;
        *)
            PYTEST_ARGS+=("$1")
            shift
            ;;
    esac
done

# Add marker based on test mode
case "$TEST_MODE" in
    unit)
        PYTEST_ARGS+=("-m" "not integration")
        echo -e "${YELLOW}Running: UNIT TESTS ONLY (fast, mocked)${NC}"
        ;;
    integration)
        PYTEST_ARGS+=("-m" "integration")
        echo -e "${GREEN}Running: INTEGRATION TESTS (real CLI execution)${NC}"
        echo -e "${YELLOW}Note: Integration tests require db CLI and may need ANTHROPIC_API_KEY${NC}"
        ;;
    all)
        echo -e "${BLUE}Running: ALL TESTS (unit + integration)${NC}"
        # No marker filter - run all tests
        ;;
esac
echo ""

# Add default pytest arguments
if [ "$COVERAGE" = true ]; then
    PYTEST_ARGS+=("--cov=." "--cov-report=term-missing" "--cov-report=html")
fi

# Add tests directory
PYTEST_ARGS+=("tests/")

# Display command being run
echo -e "${BLUE}Running Command:${NC}"
echo "  pytest ${PYTEST_ARGS[*]}"
echo ""

# Run tests
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

if pytest "${PYTEST_ARGS[@]}"; then
    EXIT_CODE=0
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ All tests passed!${NC}"
else
    EXIT_CODE=1
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}✗ Some tests failed${NC}"
fi

echo ""

# Display coverage report location if generated
if [ "$COVERAGE" = true ] && [ -d "htmlcov" ]; then
    echo -e "${BLUE}Coverage Report:${NC}"
    echo "  HTML report generated at: htmlcov/index.html"
    echo "  Open with: open htmlcov/index.html (macOS) or xdg-open htmlcov/index.html (Linux)"
    echo ""
fi

# Display test summary
if [ "$EXIT_CODE" -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                           TEST SUITE PASSED                                  ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                           TEST SUITE FAILED                                  ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
fi

exit $EXIT_CODE
