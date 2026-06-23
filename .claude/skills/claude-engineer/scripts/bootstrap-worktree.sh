#!/usr/bin/env bash
# claude-engineer / bootstrap-worktree.sh
#
# ONE-TIME setup for a FRESH claude-engineer worktree, before its first deploy.
# A cold worktree has two gaps the normal `make deploy` does not fill:
#   #3  container-lambda images (browser-lambda) are NOT built by make deploy —
#       a fresh tree lacks image.tar and `cdktf deploy` dies at filesha256().
#   #6  by default it would share ~/.terraform.d/plugin-cache with the human's
#       deploys; concurrent writes corrupt the provider binary. Isolate it.
#
# Run once after `git worktree add`. Idempotent — safe to re-run.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT" || exit 1

echo "==> isolated terraform plugin cache (finding #6)"
mkdir -p "$REPO_ROOT/.tf-plugin-cache"
echo "    export TF_PLUGIN_CACHE_DIR=$REPO_ROOT/.tf-plugin-cache   (deploy.sh sets this automatically)"

echo "==> dev-stack container images (finding #3)"
if ! docker info >/dev/null 2>&1; then
  echo "    ❌ Docker daemon not running — start Docker Desktop, then re-run bootstrap."
  exit 1
fi
if [ -f "infra/assets/artifacts/browser-lambda/image.tar" ]; then
  echo "    browser-lambda image already present — skipping."
else
  echo "    building browser-lambda (ARM64, ~5-15 min)..."
  ( cd lambdas && bash package-container-lambda.sh python/browser-lambda ) || exit 1
fi

echo "✅ worktree bootstrap complete — ready for first deploy."
