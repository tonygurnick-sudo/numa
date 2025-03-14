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

# This fails immediately when there is an error and running jobs aren't cleaned
# up, so all build directories might still be there. `now` could be changed to
# `soon` to make the cleanup happen, but then errors would not appear last in
# the output.
parallel --halt now,fail=1 --color-failed "${SCRIPT_DIRECTORY}"/package-python-lambda.sh ::: "${SCRIPT_DIRECTORY}"/python/*/;
