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

Consolidated pipeline with a single `check` stage for all validation. Lint + test + build merged into one job per module.

| Stage           | Key Jobs                                                                                                                                    | Description                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **setup**       | `install-common-dependencies`                                                                                                               | Installs yarn deps, caches node_modules (dev/main) |
| **check**       | `node-lambdas-check`, `python-lambdas-check`, `python-libraries-check`, `frontend-check`, `infra-check`, `tools-check`, `node-shared-check` | Lint + test + build per module (change-detected)   |
| **package**     | `python-lambdas-package`, `node-package`, `claude-cli-artifact-build`, `workspace-agent-package`                                            | Package artifacts (dev/main only)                  |
| **image-build** | `build-deployment-container`                                                                                                                | Docker build + ECR push (main only)                |
| **deploy**      | `deploy-to-arcanum-demo`, `deploy-to-median`                                                                                                | Deploy to environments (main only)                 |

MR pipelines only run the `check` stage. Dev pipelines are gated (manual approval before anything runs).

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
glab ci trace node-lambdas-check
glab ci trace infra-check

# Specific job by ID
glab ci trace 12345678
```

### Retry Failed Jobs

```bash
# Retry by job name
glab ci retry python-lambdas-check

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

### 1. AWS SDK Type Errors

**Symptom:** `@smithy/types` has no exported member errors in `node-lambdas-check` or `infra-check`
**Fix:** Get yarn.lock from main and reinstall:

```bash
git checkout main -- yarn.lock
yarn install
```

### 2. Prettier Formatting Errors

**Symptom:** `Replace`, `Delete`, `Insert` errors from prettier/prettier
**Fix:** Run prettier on affected files or `make format`:

```bash
npx prettier --write <file-path>
```

### 3. Python pyright Errors

**Symptom:** Type errors in `python-lambdas-check` or `python-libraries-check`
**Fix:** Fix the type issue locally, or add a `# type: ignore` comment if it's a false positive.

### 4. Cannot find module 'typescript'

**Symptom:** `Cannot find module 'typescript/bin/tsc'` in `infra-check`
**Fix:** Usually a CI cache issue. Try:

```bash
# Locally verify it works
cd infra && yarn lint

# If local works, retry the CI job
glab ci retry infra-check
```

## Local Testing Before Push

### Run All Checks (matches CI)

```bash
# Full lint (parallel)
make lint -j

# Or individual targets:
make lint-frontend          # ESLint + TypeScript
make lint-infra             # ESLint + TypeScript
make lint-node-lambdas      # ESLint + TypeScript per lambda
make lint-python-lambdas    # pyright per lambda
make lint-python-libs       # pyright per library
```

### Test Specific Python Lambda

```bash
cd lambdas/python/<lambda-name>
poetry run pyright .
poetry run python -m unittest discover -s tests -v
```

### Test Specific Node Lambda

```bash
cd lambdas/node/<lambda-name>
yarn lint && yarn test && yarn build
```

## Lambda Locations

- **Python lambdas:** `lambdas/python/<name>/`
- **Node lambdas:** `lambdas/node/<name>/`
- **CI config:** `.gitlab-ci.yml`
- **Lambda matrices:** Search for `.python-lambdas-matrix` and `.node-matrix` in `.gitlab-ci.yml`

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

1. **Pipeline stuck on "created"**: Check stage probably failed. Check `glab ci status` for failed jobs.

2. **Jobs skipped**: On MR pipelines, jobs only run if relevant files changed (change detection). On dev, the manual gate must be clicked first.

3. **Can't find job in trace**: Make sure you're on the right branch. Use `-b <branch>` flag.

4. **glab auth issues**: Run `glab auth login` to re-authenticate.

5. **Python test fails with "Start directory is not importable"**: The module has no `tests/` directory. This is handled gracefully in CI (skips tests), but check if tests should exist.
