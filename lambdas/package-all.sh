#!/bin/bash

set -o errexit -o nounset -o pipefail -o xtrace

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE:-$0}" | xargs realpath)
declare -r SCRIPT_DIRECTORY

pushd "${SCRIPT_DIRECTORY}/.."
yarn  # Install workspace dependencies
popd

# Handle Node.js Lambda packages independently (no longer in workspace)
NODE_LAMBDA_DIRS=$(find "${SCRIPT_DIRECTORY}/node" -maxdepth 1 -type d -name "*-scheduler")
for dir in $NODE_LAMBDA_DIRS; do
  if [ -f "$dir/package.json" ]; then
    echo "Installing and bundling Node.js Lambda: $dir"
    pushd "$dir"
    yarn install  # Install dependencies independently (no longer in workspace)
    yarn bundle  # Create ZIP file
    popd
  fi
done

# Handle Python Lambda packages (existing logic)
# can't double quote so disable the shellcheck
# shellcheck disable=SC2086
PYTHON_DIRS=$(find ${SCRIPT_DIRECTORY}/python -maxdepth 2 -type f -name pyproject.toml -print0 | xargs -0 realpath | xargs dirname)

# This fails immediately when there is an error and running jobs aren't cleaned
# up, so all build directories might still be there. `now` could be changed to
# `soon` to make the cleanup happen, but then errors would not appear last in
# the output.
PARALLEL_OPTIONS=$(parallel --minversion 20220722 1>/dev/null && echo --color-failed || echo "")
# can't double quote ${PARALLEL_OPTIONS}, so disable the shellcheck
# shellcheck disable=SC2086
parallel --halt now,fail=1 ${PARALLEL_OPTIONS} "${SCRIPT_DIRECTORY}"/package-python-lambda.sh ::: ${PYTHON_DIRS};
