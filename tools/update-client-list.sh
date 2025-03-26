#!/bin/bash

set -o errexit -o nounset -o pipefail -o xtrace

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE:-$0}" | xargs realpath)
declare -r SCRIPT_DIRECTORY

echo "$SCRIPT_DIRECTORY"

jq 'keys[] | select(. != "arcanum-demo" and . != "arcanum-prod-numa-demo" and . != "arcanum-prod-trial")' clientConfigProd.json \
    | jq --slurp '{".clients": {"matrix": [{"CLIENT_NAME": .}]}}' \
    | yq -P \
    > "$SCRIPT_DIRECTORY/../.gitlab-ci-clients.yml"
