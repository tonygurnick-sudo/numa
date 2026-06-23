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

# ────────────────────────────────────────────────────────────────────
# numa-cli prep (workspace-agent only)
# Build the @numa/cli package, npm-pack it, and stage the tgz into the
# service dir so the Dockerfile's COPY numa-cli.tgz step finds it.
# Only @numa/cli is packed — @numa/cli-dev (which carries --d-hum/--yes
# bypass flags) MUST NEVER ship into a workspace MicroVM. Hermetic by
# physical absence of the dev addon from the image.
# Cleanup of the staged tgz is registered via trap so it runs even if
# docker buildx fails.
# ────────────────────────────────────────────────────────────────────
CLI_TGZ_STAGED=""
cleanup_cli_tgz() {
    if [ -n "$CLI_TGZ_STAGED" ] && [ -f "$CLI_TGZ_STAGED" ]; then
        echo "Cleaning up staged numa-cli tarball: $CLI_TGZ_STAGED"
        rm -f "$CLI_TGZ_STAGED"
    fi
}
trap cleanup_cli_tgz EXIT

if [ "$SERVICE_NAME" = "numa-workspace-agent" ]; then
    # Dockerfile references the file as numa-cli.tgz (version-agnostic) so the
    # COPY directive doesn't need to track @numa/cli's version bumps.
    CLI_TGZ="$SERVICE_DIR/numa-cli.tgz"
    if [ -f "$CLI_TGZ" ]; then
        # ── CI path ──────────────────────────────────────────────────────
        # numa-cli.tgz is built once by the `numa-cli-package` pipeline job
        # (node:lts, with the yarn workspace installed) and pulled in here as
        # an artifact. The image-build host (docker:24) has NO Node toolchain,
        # so we must never build the CLI here — we just consume the tarball.
        # No cleanup trap: leave the artifact in place (it's gitignored).
        echo ""
        echo "=== Using prebuilt numa-cli.tgz (CI artifact) ==="
        echo "Found: $CLI_TGZ ($(ls -lh "$CLI_TGZ" | awk '{print $5}'))"
    else
        # ── Local-dev path ───────────────────────────────────────────────
        # Build @numa/cli from source and pack it. Requires a Node toolchain
        # and an installed numa-cli workspace on the host.
        echo ""
        echo "=== Building @numa/cli for MicroVM install ==="
        CLI_WORKSPACE_DIR="$REPO_ROOT/numa-cli"
        CLI_PROD_DIR="$REPO_ROOT/numa-cli/packages/cli"
        if [ ! -d "$CLI_PROD_DIR" ]; then
            echo "Error: $CLI_PROD_DIR not found — was numa-cli moved?"
            exit 1
        fi
        # Build the prod CLI (and its workspace deps) deterministically.
        # Uses yarn (workspace-aware) at numa-cli/ root, which builds @numa/cli
        # and any local deps it has. @numa/cli-dev is built too but we don't
        # pack it — the tgz only carries @numa/cli's `files` glob (dist/).
        ( cd "$CLI_WORKSPACE_DIR" && yarn build )
        # `npm pack` honours the package.json `files` field, so only `dist/`
        # plus the manifest ship in the tarball (no src/, no tests, no
        # cli-dev). Output filename: numa-cli-<version>.tgz (npm drops the @
        # scope from filenames).
        ( cd "$CLI_PROD_DIR" && npm pack --pack-destination "$SERVICE_DIR" >/dev/null )
        # The tgz name embeds @numa/cli's version. Resolve it via package.json
        # rather than wildcard-globbing so we fail loudly if the version
        # encoding ever changes.
        CLI_VERSION=$(node -p "require('$CLI_PROD_DIR/package.json').version")
        CLI_TGZ_BUILT="$SERVICE_DIR/numa-cli-${CLI_VERSION}.tgz"
        if [ ! -f "$CLI_TGZ_BUILT" ]; then
            echo "Error: expected $CLI_TGZ_BUILT to exist after npm pack"
            exit 1
        fi
        mv "$CLI_TGZ_BUILT" "$CLI_TGZ"
        # Only register cleanup for a tgz WE built, so a locally-built tarball
        # doesn't linger in the working tree after the build.
        CLI_TGZ_STAGED="$CLI_TGZ"
        echo "Staged: $CLI_TGZ ($(ls -lh "$CLI_TGZ" | awk '{print $5}'))"
    fi
fi

# Build the Docker image using buildx for cross-platform support
# AgentCore requires ARM64 (Graviton) architecture
# The docker-container driver properly integrates with QEMU emulation
# when building ARM64 images on x86_64 hosts (CI registers binfmt handlers)
echo ""
echo "=== Setting up Docker buildx for ARM64 ==="

# Unique builder name per worktree/checkout so concurrent builds in other
# worktrees don't rm/recreate a shared 'arm64builder' and kill each other's
# in-flight build. Also removes any existing one (avoids CI state ambiguity).
BUILDER_NAME="arm64builder-$(basename "$REPO_ROOT")"
docker buildx rm "$BUILDER_NAME" 2>/dev/null || true

# Check if we're in a DinD environment with TLS (GitLab CI)
if [ -d "/certs/client" ]; then
    echo "Detected TLS-enabled Docker-in-Docker environment"

    # Create a docker context with explicit TLS configuration for DinD
    docker context rm dind-context 2>/dev/null || true
    docker context create dind-context \
        --docker "host=tcp://docker:2376,ca=/certs/client/ca.pem,cert=/certs/client/cert.pem,key=/certs/client/key.pem"

    # Create buildx builder using the TLS-configured context
    docker buildx create --name "$BUILDER_NAME" --driver docker-container dind-context --use
else
    echo "Using default Docker context"

    # Create buildx builder with default context (local development)
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --use
fi

# Bootstrap the builder (ensures QEMU is available)
docker buildx inspect --bootstrap

echo ""
echo "=== Building Docker image (ARM64) ==="
# --load imports the image to local docker daemon for subsequent docker save
# Layer caching is enabled by default — Docker only rebuilds layers after a
# changed COPY/RUN step, so code changes are always picked up while system
# packages, Node.js, Pandoc, and Python deps are cached across builds.
# Pass --no-cache to this script's environment (DOCKER_BUILD_OPTS="--no-cache")
# to force a full rebuild when needed.
docker buildx build \
    --platform linux/arm64 \
    ${DOCKER_BUILD_OPTS:-} \
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
