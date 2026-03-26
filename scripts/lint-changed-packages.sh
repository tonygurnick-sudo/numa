#!/usr/bin/env bash
# Pre-commit hook: lint + typecheck only the packages with staged changes
# under a given base directory (e.g. lambdas/node, lib).
#
# Usage: lint-changed-packages.sh <base_dir>
#   base_dir – path relative to repo root, e.g. "lambdas/node" or "lib"

set -euo pipefail

BASE_DIR="${1:?Usage: lint-changed-packages.sh <base_dir>}"

command -v yarn >/dev/null 2>&1 || {
  echo "Yarn not available, skipping $BASE_DIR checks (will be checked in CI)"
  exit 0
}

# Extract unique package directory names from staged files
dirs=$(git diff --cached --name-only -- "$BASE_DIR/" \
  | sed "s|${BASE_DIR}/\([^/]*\)/.*|\1|" \
  | sort -u)

[ -z "$dirs" ] && exit 0

for d in $dirs; do
  pkg="$BASE_DIR/$d"
  [ -f "$pkg/package.json" ] || continue

  echo "→ $pkg"

  # ESLint --fix (only if the package has eslint as a dependency)
  if grep -q '"eslint"' "$pkg/package.json" 2>/dev/null; then
    (cd "$pkg" && yarn eslint --fix .) || exit 1
  fi

  # TypeScript check
  (cd "$pkg" && yarn tsc --noEmit) || exit 1
done
