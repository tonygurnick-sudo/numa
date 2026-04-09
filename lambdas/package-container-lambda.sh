#!/bin/bash
# Package a container-based Lambda as a Docker image tar for deployment
#
# Usage: ./package-container-lambda.sh <lambda-directory>
# Example: ./package-container-lambda.sh python/crawl-page
#
# Output: infra/assets/artifacts/<lambda-name>/image.tar
#
# The Dockerfile must exist in the lambda directory. The build context is set
# to the repo root so Dockerfiles can access shared libs (e.g., lib/prm).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <lambda-directory>"
    echo "Example: $0 python/crawl-page"
    exit 1
fi

LAMBDA_DIR="$1"
LAMBDA_PATH="$SCRIPT_DIR/$LAMBDA_DIR"
LAMBDA_NAME="$(basename "$LAMBDA_DIR")"
DOCKERFILE="$LAMBDA_PATH/Dockerfile"

if [ ! -f "$DOCKERFILE" ]; then
    echo "Error: No Dockerfile found at $DOCKERFILE"
    exit 1
fi

OUTPUT_DIR="$REPO_ROOT/infra/assets/artifacts/$LAMBDA_NAME"
mkdir -p "$OUTPUT_DIR"

GIT_HASH=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "dev")

echo "=== Packaging container Lambda: $LAMBDA_NAME ==="
echo "Lambda directory: $LAMBDA_PATH"
echo "Dockerfile: $DOCKERFILE"
echo "Build context: $REPO_ROOT"
echo "Output directory: $OUTPUT_DIR"
echo "Git hash: $GIT_HASH"

# Set up Docker buildx for ARM64 cross-compilation
echo ""
echo "=== Setting up Docker buildx for ARM64 ==="

docker buildx rm arm64builder 2>/dev/null || true

if [ -d "/certs/client" ]; then
    echo "Detected TLS-enabled Docker-in-Docker environment"
    docker context rm dind-context 2>/dev/null || true
    docker context create dind-context \
        --docker "host=tcp://docker:2376,ca=/certs/client/ca.pem,cert=/certs/client/cert.pem,key=/certs/client/key.pem"
    docker buildx create --name arm64builder --driver docker-container dind-context --use
else
    echo "Using default Docker context"
    docker buildx create --name arm64builder --driver docker-container --use
fi

docker buildx inspect --bootstrap

echo ""
echo "=== Building Docker image (ARM64) ==="
docker buildx build \
    --platform ${BUILD_PLATFORM:-linux/arm64} \
    --no-cache \
    ${DOCKER_BUILD_OPTS:-} \
    --load \
    --build-arg GIT_HASH="$GIT_HASH" \
    -f "$DOCKERFILE" \
    -t "$LAMBDA_NAME:$GIT_HASH" \
    -t "$LAMBDA_NAME:latest" \
    "$REPO_ROOT"

echo ""
echo "=== Saving image as tar ==="
docker save "$LAMBDA_NAME:latest" -o "$OUTPUT_DIR/image.tar"

IMAGE_SIZE=$(ls -lh "$OUTPUT_DIR/image.tar" | awk '{print $5}')
echo ""
echo "=== Package complete ==="
echo "Output: $OUTPUT_DIR/image.tar ($IMAGE_SIZE)"
