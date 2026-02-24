---
name: lint-and-tests
description: Run linting and tests for modified code. Use when code has been modified and needs linting, type checking, or tests run. Covers Python lambdas, services, frontend, infra, and tools.
allowed-tools: Bash, Read, Glob, Grep
---

# Lint and Tests

## Purpose

Run the appropriate linting and testing commands based on the files that were modified in this session. Identify which parts of the codebase were changed and run all applicable checks.

## Instructions

1. Identify which parts of the codebase were modified
2. Run all applicable linting and testing commands for those areas
3. Fix any errors or warnings that are found
4. Report a summary of results
5. If there are failures, prioritize fixing them before considering the task complete

**Important:** Always activate the correct Python environment first:
```bash
eval "$(/Users/nathandouglas/miniforge3-arm64/bin/conda shell.bash hook)" && conda activate arcanum_3-13
```

## Python Lambda Functions (lambdas/python/*)

For any modified Python Lambda functions, navigate to the Lambda directory and run:

1. **Type checking** (if available):
   ```bash
   if poetry show mypy 2>/dev/null; then poetry run mypy .; fi
   if poetry show pyright 2>/dev/null; then poetry run pyright .; fi
   ```

2. **Linting**:
   ```bash
   poetry run pylint . --verbose --recursive yes --ignore .venv,.poetry
   ```

3. **Tests**:
   ```bash
   poetry run python -m unittest
   ```

## Services (services/*)

For any modified service code (e.g., `services/numa-workspace-agent`):

1. **Linting**:
   ```bash
   poetry run pylint . --verbose --recursive yes --ignore .venv,.poetry
   ```

2. **Tests**:
   ```bash
   poetry run pytest tests/ -v
   ```

## Frontend (numa-frontend/)

For any modified frontend code:

1. **Linting**:
   ```bash
   yarn lint
   ```

2. **Tests**:
   ```bash
   yarn test
   ```

## Infrastructure (infra/)

For any modified infrastructure code:

1. **Linting**:
   ```bash
   yarn lint
   ```

## Tools (tools/)

For any modified tools code:

1. **Linting**:
   ```bash
   yarn lint
   ```
