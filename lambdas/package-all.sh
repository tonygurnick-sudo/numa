#!/bin/bash

set -o errexit -o nounset -o pipefail -o xtrace

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE:-$0}" | xargs realpath)
declare -r SCRIPT_DIRECTORY

for directory in "${SCRIPT_DIRECTORY}"/node/*/; do
    pushd "${directory}";
        yarn;
        yarn bundle;
    popd;
done;

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
