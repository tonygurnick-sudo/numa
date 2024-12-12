#!/bin/bash

set -o errexit -o nounset -o pipefail -o xtrace

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE:-$0}" | xargs realpath)
declare -r SCRIPT_DIRECTORY

case "$(uname -s)" in
    Linux*)     OS=linux;;
    *)          OS=mac
esac

if [ "$OS" = linux ]
then
    for directory in "${SCRIPT_DIRECTORY}"/node/*/; do
        pushd "${directory}";
            yarn;
            yarn bundle;
        popd;
    done;
    for directory in "${SCRIPT_DIRECTORY}"/python/*/; do
        pushd "${directory}";
            poetry build-lambda;
        popd;
    done;
fi

if [ "$OS" = mac ]
then
    for directory in "${SCRIPT_DIRECTORY}"/node/*/; do
        pushd "${directory}";
            yarn;
            yarn bundle;
        popd;
    done;

    rm -rf "${SCRIPT_DIRECTORY}"/build_venv
    python3.12 -m venv "${SCRIPT_DIRECTORY}"/build_venv

    # shellcheck source=/dev/null
    source "${SCRIPT_DIRECTORY}"/build_venv/bin/activate

    for directory in "${SCRIPT_DIRECTORY}"/python/*/; do
        pushd "${directory}";
            rm -rf lambda_function.build;
            rm -f lambda_function.zip;
            pip install \
                --quiet \
                --disable-pip-version-check \
                --platform manylinux2014_x86_64 \
                --target=lambda_function.build \
                --python-version 3.12 \
                --only-binary=:all: \
                .
            pushd lambda_function.build;
                zip --quiet --recurse-paths ../lambda_function.zip ./*
            popd
            rm -rf lambda_function.build;
        popd;
    done;

    deactivate
    rm -rf "${SCRIPT_DIRECTORY}"/build_venv
fi
