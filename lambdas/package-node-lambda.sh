#!/usr/bin/env bash

set -o errexit -o nounset -o pipefail -o xtrace

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE:-$0}" | xargs realpath)
declare -r SCRIPT_DIRECTORY
REPO_ROOT="${SCRIPT_DIRECTORY}"/..
# Resolve the real git common dir so this works in both normal clones and
# git worktrees (where the worktree's own `.git` is a file, not a directory).
GIT_DIR=$(git -C "${SCRIPT_DIRECTORY}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)

if ! test -d "${GIT_DIR}"; then
    echo ".git directory is not accessible"
    exit 1
fi

LAMBDA_DIRECTORY=$(realpath "${1:-.}")

if ! test -f "${LAMBDA_DIRECTORY}/package.json"; then
    echo "No package.json found in ${LAMBDA_DIRECTORY}"
    exit 1
fi

# Install workspace dependencies from the repo root
pushd "${REPO_ROOT}"
    yarn install
popd

# Bundle the lambda
pushd "${LAMBDA_DIRECTORY}"
    yarn bundle
popd

echo "Packaged: ${LAMBDA_DIRECTORY}/lambda_function.zip"
