---
name: numa-gitlab
description: Interact with Numa GitLab repo using glab CLI. Use when checking CI/CD pipeline status, viewing failed jobs, debugging pipeline failures, retrying jobs, viewing MR details, or understanding the Numa pipeline structure.
allowed-tools: Bash, Read, Grep, Glob
---

# Numa GitLab CI/CD Skill

## Purpose

This skill helps interact with the Numa GitLab repository using the `glab` CLI tool. It provides knowledge of Numa's CI/CD pipeline structure, common failure patterns, and how to debug and fix issues.

## Prerequisites

- `glab` CLI installed and authenticated (`glab auth login`)
- Must be in the numa repo directory or a subdirectory

## Pipeline Structure

Numa's CI/CD pipeline has these stages in order:

| Stage | Key Jobs | Description |
|-------|----------|-------------|
| **setup** | `install-common-dependencies` | Installs yarn dependencies, caches node_modules |
| **lint** | `node-lint`, `infra-lint`, `client-list-lint`, `pre-commit` | Linting for all workspaces |
| **test** | `frontend-test`, `node-test`, `python-lambdas-test`, `python-lambdas-lint`, `infra-test` | Tests and Python linting |
| **build** | `frontend-build`, `node-build`, `infra-build`, `tools-build` | Build artifacts |
| **package** | `claude-cli-artifact-build` | Package final artifacts |

## Common glab Commands

### Check Pipeline Status
```bash
# Current branch pipeline status
glab ci status

# Live updating view
glab ci status --live

# Compact view
glab ci status --compact

# Specific branch
glab ci status -b main
```

### View Job Logs
```bash
# Interactive job selection
glab ci trace

# Specific job by name
glab ci trace node-lint
glab ci trace infra-lint

# Specific job by ID
glab ci trace 12345678
```

### Retry Failed Jobs
```bash
# Retry by job name
glab ci retry node-lint

# Retry by job ID
glab ci retry 12345678
```

### View Merge Request
```bash
# Current branch MR
glab mr view

# List your MRs
glab mr list --mine

# Open MR in browser
glab mr view --web
```

### Interactive Pipeline View
```bash
# Interactive job browser with keyboard navigation
glab ci view
```

## Common Failure Patterns & Fixes

### 1. node-lint / infra-lint: AWS SDK Type Errors
**Symptom:** `@smithy/types` has no exported member errors
**Fix:** Get yarn.lock from main and reinstall:
```bash
git checkout main -- yarn.lock
yarn install
```

### 2. Prettier Formatting Errors
**Symptom:** `Replace`, `Delete`, `Insert` errors from prettier/prettier
**Fix:** Run prettier on affected files:
```bash
npx prettier --write <file-path>
```

### 3. Python Lambda Lint: Score Below 10/10
**Symptom:** pylint score like 9.69/10
**Fix:**
- Add missing disables to `.pylintrc` in the lambda directory
- Or fix the actual lint issues (unused imports, etc.)

### 4. infra-lint: Cannot find module 'typescript'
**Symptom:** `Cannot find module 'typescript/bin/tsc'`
**Fix:** Usually a CI cache issue. Try:
```bash
# Locally verify it works
cd infra && yarn lint

# If local works, retry the CI job
glab ci retry infra-lint
```

### 5. client-list-lint: Pre-existing Failure
**Note:** This job often fails on main too - check if it's a pre-existing issue before debugging.

## Local Testing Before Push

### Run All Lints
```bash
# Node workspaces (excluding infra)
yarn workspaces foreach --parallel --all --exclude infra run lint

# Infra
cd infra && yarn lint

# Python lambda (from lambda directory)
poetry run pylint . --verbose --recursive yes --ignore .venv,.poetry
poetry run mypy .
poetry run pyright .
```

### Run Tests
```bash
# Node workspaces
yarn workspaces foreach --parallel --all --exclude infra run test

# Infra
cd infra && yarn test

# Python lambda
poetry run pytest
```

### Test Specific Python Lambda
```bash
cd lambdas/python/<lambda-name>
poetry run pytest
poetry run pylint . --verbose --recursive yes --ignore .venv,.poetry
poetry run mypy .
poetry run pyright .
```

## Lambda Locations

- **Python lambdas:** `lambdas/python/<name>/`
- **Node lambdas:** `lambdas/node/<name>/`
- **CI config:** `.gitlab-ci.yml`
- **Lambda matrices:** Search for `.python-lambdas-matrix` and `.node-lambdas-matrix` in `.gitlab-ci.yml`

## Adding New Lambdas to CI

If a new lambda isn't in the pipeline, add it to `.gitlab-ci.yml`:

```yaml
# For Python lambdas, find .python-lambdas-matrix and add:
        - lambdas/python/<new-lambda-name>

# For Node lambdas, find .node-lambdas-matrix and add:
        - lambdas/node/<new-lambda-name>
```

## Checking if Lambdas are in CI

```bash
# List Python lambdas in codebase
ls -d lambdas/python/*/ | xargs -n1 basename | sort

# List Python lambdas in CI
grep -E "^\s+- lambdas/python/" .gitlab-ci.yml | sed 's/.*lambdas\/python\///' | tr -d '"]' | sort | uniq

# Find missing (compare the two outputs)
comm -23 <(ls -d lambdas/python/*/ | xargs -n1 basename | sort) <(grep -E "^\s+- lambdas/python/" .gitlab-ci.yml | sed 's/.*lambdas\/python\///' | tr -d '"]' | sort | uniq)
```

## Troubleshooting

1. **Pipeline stuck on "created"**: Lint stage probably failed. Check `glab ci status` for failed jobs.

2. **Jobs skipped**: Jobs only run if their dependencies (previous stage) passed.

3. **Can't find job in trace**: Make sure you're on the right branch. Use `-b <branch>` flag.

4. **glab auth issues**: Run `glab auth login` to re-authenticate.
