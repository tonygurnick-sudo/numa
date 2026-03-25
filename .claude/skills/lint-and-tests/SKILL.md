---
name: lint-and-tests
description: Run linting and tests for modified code. Use when code has been modified and needs linting, type checking, or tests run. Covers Python lambdas, Python libs, services, frontend, infra, tools, Node lambdas, customer success portal, and shared libraries.
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

**Important:** Always activate the correct Python environment first (for any Python work):

```bash
eval "$(/Users/nathandouglas/miniforge3-arm64/bin/conda shell.bash hook)" && conda activate arcanum_3-13
```

**Important:** All commands below assume you `cd` into the relevant directory first. Use absolute paths.

---

## Pre-commit Hooks

The repo uses pre-commit hooks (`.pre-commit-config.yaml`) that run automatically on `git commit`. They enforce:

- **Prettier** on `*.ts, *.tsx, *.js, *.jsx, *.json, *.css, *.scss, *.md` files
- **Black** (Python formatter)
- **isort** (Python import sorter)
- **ESLint** on `numa-frontend/` files
- **TypeScript check** on `numa-frontend/` files
- **Conventional commits** on commit messages

If a commit fails due to pre-commit hooks, fix the issues and re-commit. You can run Prettier manually on changed files:

```bash
npx prettier --write <changed-files>
```

---

## Python Lambda Functions (lambdas/python/\*)

All Python lambdas use **Poetry** for dependency management. Each has its own `pyproject.toml`. Navigate to the specific lambda directory first.

Most lambdas include `pylint`, `mypy`, and `pyright` as dev dependencies. Some simpler ones may omit one or more. Check before running.

1. **Linting** (pylint):

   ```bash
   poetry run pylint . --verbose --recursive yes --ignore .venv,.poetry
   ```

2. **Type checking** (check which are available, then run):

   ```bash
   if poetry show mypy 2>/dev/null; then poetry run mypy .; fi
   if poetry show pyright 2>/dev/null; then poetry run pyright .; fi
   ```

3. **Tests** (most lambdas have a `tests/` directory with pytest or unittest tests):

   ```bash
   if [ -d tests ] && poetry show pytest 2>/dev/null; then
     poetry run pytest tests/ -v
   elif [ -d tests ]; then
     poetry run python -m unittest discover -s tests -v
   fi
   ```

---

## Python Shared Libraries (lib/bedrock, lib/helpers, lib/s3_helpers, lib/prm, lib/oauth-providers, lib/aws-transcribe, lib/markdown-to-pdf)

Same pattern as Python lambdas — Poetry-managed, with `pylint`, `pyright`, and/or `mypy` as dev dependencies. Navigate to the specific lib directory.

1. **Linting**:

   ```bash
   poetry run pylint . --verbose --recursive yes --ignore .venv,.poetry
   ```

2. **Type checking**:

   ```bash
   if poetry show mypy 2>/dev/null; then poetry run mypy .; fi
   if poetry show pyright 2>/dev/null; then poetry run pyright .; fi
   ```

3. **Tests** (if the lib has tests):

   ```bash
   if [ -d tests ] && poetry show pytest 2>/dev/null; then
     poetry run pytest tests/ -v
   fi
   ```

---

## Services (services/numa-workspace-agent)

Uses **Poetry** with `pytest` and `pytest-asyncio` (asyncio_mode = "auto").

1. **Tests**:

   ```bash
   cd /Users/nathandouglas/arcanum/numa/services/numa-workspace-agent
   poetry run pytest tests/ -v
   ```

Note: This service does not have pylint/mypy/pyright in its dev dependencies — only pytest. If linting is needed, rely on the pre-commit Black + isort hooks.

---

## Frontend (numa-frontend/)

React 19 + Vite + TypeScript. Uses ESLint v9 flat config and Vitest.

1. **Linting** (ESLint — no `--max-workers` flag, it runs single-threaded):

   ```bash
   cd /Users/nathandouglas/arcanum/numa/numa-frontend
   yarn lint
   ```

2. **TypeScript check** (non-blocking — reports errors but does not fail the build):

   ```bash
   yarn typecheck
   ```

3. **Formatting check** (Prettier):

   ```bash
   yarn format:check
   ```

4. **Tests** (Vitest — cap workers to avoid OOM on many-core machines):

   ```bash
   yarn test --pool=threads --poolOptions.threads.maxThreads=2
   ```

---

## Node Lambda Functions (lambdas/node/\*)

All Node lambdas are part of the Yarn workspace. Each has its own `package.json` with `lint` and `test` scripts. Navigate to the specific lambda directory.

1. **Linting** (ESLint + TypeScript noEmit — the standard `lint` script):

   ```bash
   yarn lint
   ```

2. **Tests** — Node lambdas use one of two test runners depending on the lambda:
   - **Node built-in test runner** (most common): `yarn test` runs `node --test`
   - **Vitest** (some, e.g. `agents`, `user-files`): `yarn test` runs `vitest run`
   - **No tests**: some lambdas have `"test": "echo 'no tests'"`

   Just run whatever the package.json defines:

   ```bash
   yarn test
   ```

---

## Infrastructure (infra/)

CDKTF TypeScript project. Part of the Yarn workspace.

1. **Linting** (ESLint + TypeScript noEmit):

   ```bash
   cd /Users/nathandouglas/arcanum/numa/infra
   yarn lint
   ```

2. **Tests** (Node built-in test runner):

   ```bash
   yarn test
   ```

---

## Tools (tools/)

TypeScript operational tools. Part of the Yarn workspace.

1. **Linting** (ESLint + TypeScript noEmit):

   ```bash
   cd /Users/nathandouglas/arcanum/numa/tools
   yarn lint
   ```

2. **Tests** (Node built-in test runner):

   ```bash
   yarn test
   ```

---

## Customer Success Portal (numa-customer-success-portal/)

React 19 + Vite + TypeScript. Part of the Yarn workspace.

1. **Linting**:

   ```bash
   cd /Users/nathandouglas/arcanum/numa/numa-customer-success-portal
   yarn lint
   ```

2. **Tests** (Vitest):

   ```bash
   yarn test
   ```

---

## Shared Node Libraries (lib/client-config-node, lib/prm-node, lib/usage-analytics-schemas)

Part of the Yarn workspace. Each has `lint` and `test` scripts.

```bash
cd /Users/nathandouglas/arcanum/numa/lib/<library-name>
yarn lint
yarn test
```

---

## Numa CLI (numa-cli/)

TypeScript CLI tool. Part of the Yarn workspace.

1. **Linting** (TypeScript noEmit only — no ESLint):

   ```bash
   cd /Users/nathandouglas/arcanum/numa/numa-cli
   yarn lint
   ```

---

## Monorepo-Wide Commands

From the repo root (`/Users/nathandouglas/arcanum/numa`):

- **Lint all Yarn workspaces** (frontend, infra, tools, Node lambdas, shared libs, portal):

  ```bash
  yarn lint
  ```

  This runs `yarn workspaces foreach --parallel --all run lint`.

- **Format check all files**:

  ```bash
  yarn format:check
  ```

- **Format (fix) all files**:

  ```bash
  yarn format
  ```
