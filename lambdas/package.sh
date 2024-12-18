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

    BUILD_DIR="${SCRIPT_DIRECTORY}"/build_venv
    WHEEL_DIR="${SCRIPT_DIRECTORY}"/wheels

    rm -rf "${BUILD_DIR}"
    rm -rf "${WHEEL_DIR}"
    python3.12 -m venv "${BUILD_DIR}"

    # shellcheck source=/dev/null
    source "${BUILD_DIR}"/bin/activate

    # some packages don't provide wheels, so have to build them manually to be compatible to --only-binary=:all:
    mkdir "${WHEEL_DIR}"
    pushd "${WHEEL_DIR}"
    pip wheel --no-cache-dir --no-deps svglib
    popd "${WHEEL_DIR}"

    for directory in "${SCRIPT_DIRECTORY}"/python/*/; do
        pushd "${directory}";
            rm -rf lambda_function.build;
            rm -f lambda_function.zip;
            # Pillow is very sensitive to the Python version provided, a typical mismatch error is:
            # ImportError: cannot import name '_imaging' from 'PIL'
            pip install \
                --disable-pip-version-check \
                --platform manylinux2014_x86_64 \
                --target=lambda_function.build \
                --python-version 3.13 \
                --only-binary=:all: \
                --no-cache-dir \
                --find-links "${WHEEL_DIR}" \
                .
            pushd lambda_function.build;
                zip --quiet --recurse-paths ../lambda_function.zip ./*
            popd
            rm -rf lambda_function.build;
        popd;
    done;

    deactivate
    rm -rf "${WHEEL_DIR}"
    rm -rf "${BUILD_DIR}"
fi
