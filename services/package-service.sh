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

# Build the Docker image using buildx for cross-platform support
# AgentCore requires ARM64 (Graviton) architecture
# The docker-container driver properly integrates with QEMU emulation
# when building ARM64 images on x86_64 hosts (CI registers binfmt handlers)
echo ""
echo "=== Setting up Docker buildx for ARM64 ==="

# Create docker context first (fixes TLS issues on GitLab.com SaaS)
docker context create buildctx 2>/dev/null || true

# Create a buildx builder with docker-container driver
# This driver has built-in QEMU support when binfmt is registered
docker buildx create --name arm64builder --driver docker-container --use 2>/dev/null || docker buildx use arm64builder

# Bootstrap the builder (ensures QEMU is available)
docker buildx inspect --bootstrap

echo ""
echo "=== Building Docker image (ARM64) ==="
# --load imports the image to local docker daemon for subsequent docker save
# --no-cache ensures code changes are always included
docker buildx build \
    --platform linux/arm64 \
    --no-cache \
    --load \
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
