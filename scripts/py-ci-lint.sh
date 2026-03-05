#!/usr/bin/env bash
# Run the full Python CI lint suite (pylint + mypy + pyright) for a lambda.
# Matches exactly what the GitLab python-lambdas-lint job runs.
#
# Usage:
#   ./scripts/py-ci-lint.sh lambdas/python/workspace-chat-tools
#   yarn py:ci lambdas/python/workspace-chat-tools

set -euo pipefail

dir="${1:-}"
if [ -z "$dir" ]; then
  echo "Usage: $0 <lambda-directory>"
  echo "Example: $0 lambdas/python/workspace-chat-tools"
  exit 1
fi

if [ ! -f "$dir/pyproject.toml" ]; then
  echo "Error: $dir/pyproject.toml not found"
  exit 1
fi

cd "$dir"

echo "=== Installing dependencies ==="
poetry install --quiet

echo "=== Running pylint ==="
poetry run pylint . --verbose --recursive yes

echo "=== Running mypy ==="
poetry run mypy .

echo "=== Running pyright ==="
poetry run pyright .

echo ""
echo "All checks passed."
