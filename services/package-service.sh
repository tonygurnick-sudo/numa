#!/bin/bash
# Package a service as a Docker image tar for deployment
#
# Usage: ./package-service.sh <service-directory>
# Example: ./package-service.sh numa-workspace-agent
#
# Output: infra/assets/artifacts/<service-name>/image.tar

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Get service name from argument or current directory
if [ $# -ge 1 ]; then
    SERVICE_NAME="$1"
    SERVICE_DIR="$SCRIPT_DIR/$SERVICE_NAME"
else
    SERVICE_DIR="$(pwd)"
    SERVICE_NAME="$(basename "$SERVICE_DIR")"
fi

# Validate service directory exists
if [ ! -f "$SERVICE_DIR/Dockerfile" ]; then
    echo "Error: No Dockerfile found in $SERVICE_DIR"
    exit 1
fi

# Output directory (follows claude-cli pattern)
OUTPUT_DIR="$REPO_ROOT/infra/assets/artifacts/$SERVICE_NAME"
mkdir -p "$OUTPUT_DIR"

# Get git hash for tagging (deterministic versioning)
GIT_HASH=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "dev")

echo "=== Packaging service: $SERVICE_NAME ==="
echo "Service directory: $SERVICE_DIR"
echo "Output directory: $OUTPUT_DIR"
echo "Git hash: $GIT_HASH"

# Build the Docker image
# AgentCore requires ARM64 (Graviton) architecture
# Requires QEMU emulation when building on x86_64 (CI registers binfmt handlers)
# --no-cache ensures code changes are always included (Docker caching can be aggressive)
echo ""
echo "=== Building Docker image (ARM64) ==="
docker build \
    --no-cache \
    --platform linux/arm64 \
    --build-arg GIT_HASH="$GIT_HASH" \
    -t "$SERVICE_NAME:$GIT_HASH" \
    -t "$SERVICE_NAME:latest" \
    "$SERVICE_DIR"

# Save image as tar (compressed)
echo ""
echo "=== Saving image as tar ==="
docker save "$SERVICE_NAME:latest" -o "$OUTPUT_DIR/image.tar"

# Get image size for reporting
IMAGE_SIZE=$(ls -lh "$OUTPUT_DIR/image.tar" | awk '{print $5}')
echo ""
echo "=== Package complete ==="
echo "Output: $OUTPUT_DIR/image.tar ($IMAGE_SIZE)"
