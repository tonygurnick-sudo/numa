#!/bin/bash

set -o errexit -o nounset -o pipefail -o xtrace

LAMBDA_DIRECTORY=$(realpath "${1:-.}")

BUILD_DIR="${LAMBDA_DIRECTORY}"/lambda_function.build;
VENV_DIR="${LAMBDA_DIRECTORY}"/build_venv
WHEEL_DIR="${LAMBDA_DIRECTORY}"/wheels

function cleanup() {
    rm -rf "${BUILD_DIR}";
    rm -rf "${WHEEL_DIR}"
    rm -rf "${VENV_DIR}"
}

cleanup
trap cleanup EXIT

python3.13 -m venv "${VENV_DIR}"

PIP="${VENV_DIR}"/bin/pip

# some packages don't provide wheels, so have to build them manually to be compatible to --only-binary=:all:
mkdir "${WHEEL_DIR}"
pushd "${WHEEL_DIR}"
    ${PIP} wheel --no-cache-dir --no-deps svglib
popd

pushd "${LAMBDA_DIRECTORY}"
    rm -f lambda_function.zip;
    # Pillow is very sensitive to the Python version provided, a typical mismatch error is:
    # ImportError: cannot import name '_imaging' from 'PIL'
    ${PIP} install \
        --disable-pip-version-check \
        --platform manylinux2014_x86_64 \
        --target="${BUILD_DIR}" \
        --python-version 3.13 \
        --only-binary=:all: \
        --no-cache-dir \
        --find-links "${WHEEL_DIR}" \
        .
popd

pushd "${BUILD_DIR}";
    zip --quiet --recurse-paths ../lambda_function.zip ./*
popd
