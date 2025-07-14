#!/usr/bin/env bash

set -o errexit -o nounset -o pipefail -o xtrace

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE:-$0}" | xargs realpath)
declare -r SCRIPT_DIRECTORY
GIT_DIR="${SCRIPT_DIRECTORY}"/../.git

if ! test -d "${GIT_DIR}"; then
    echo ".git directory is not accessible"
    exit 1
fi

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
    # Use --no-compile to exclude pyc files which contain random data making
    # the zip non-deterministic which forces a deploy for every build.
    # Use poetry show to use the versions from the lock file (grep to exclude local
    # dependencies, sed to remove "not installed" marker) - no quoting around
    # subshell to keep requirements separated, hence the following shellcheck
    # disable:
    # shellcheck disable=SC2046
    # Pillow is very sensitive to the Python version provided, a typical mismatch error is:
    # ImportError: cannot import name '_imaging' from 'PIL'
    ${PIP} install \
        --disable-pip-version-check \
        --platform manylinux2014_x86_64 \
        --target="${BUILD_DIR}" \
        --python-version 3.13 \
        --only-binary=:all: \
        --no-cache-dir \
        --no-compile \
        --find-links "${WHEEL_DIR}" \
        . $(poetry show --without dev | sed 's|(!)|   |'| grep -v "../" | awk '{print $1 "==" $2}')
popd

# remove files that aren't required and contain paths that can differ based on clone location
rm -r "${BUILD_DIR:?}/bin"
find "${BUILD_DIR}" -type d -name "*.dist-info" -not -name '*opentelemetry*' -exec rm -r "{}" +

# make sure full history is available to make git log reliable
if test -f "${GIT_DIR}/shallow"; then
    git fetch --unshallow
fi

# Use the last modification date of the lambda for all files in the ZIP to make
# it deterministic
LAST_MODIFIED=$(git log -1 --format=%cd --date format:"%FT%T" "${LAMBDA_DIRECTORY}")
find "${BUILD_DIR}" -exec touch -d "${LAST_MODIFIED}" {} +

pushd "${BUILD_DIR}";
    # use -X (--no-extra, which isn't supported on Mac) to not save attributes
    # that would make the zip file non-deterministic
    # use find with sort to ensure order
    # shellcheck disable=SC2046
    zip --quiet -X ../lambda_function.zip $(find . | sort)
popd
