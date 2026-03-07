#!/bin/bash
# Cross-platform timestamp for reproducible builds
# Returns format: YYYYMMDDhhmm.SS (for touch -t on macOS/Linux)

LAMBDA_DIR="${1:-.}"

# Try to get the last commit date for this directory
TIMESTAMP=$(git log -1 --format=%cd --date=format:"%Y%m%d%H%M.%S" "${LAMBDA_DIR}" 2>/dev/null)

# If no git history, use current date
if [ -z "${TIMESTAMP}" ]; then
    TIMESTAMP=$(date -u +"%Y%m%d%H%M.%S")
fi

echo "${TIMESTAMP}"
