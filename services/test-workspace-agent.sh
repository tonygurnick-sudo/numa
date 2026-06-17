#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# test-workspace-agent.sh
#
# Starts the numa-workspace-agent Docker container locally with a browser-based
# test UI. One command to load the image, get AWS creds, start the container,
# serve the UI, and open your browser.
#
# Usage:  ./test-workspace-agent.sh
# Stop:   Ctrl+C (cleans up container, HTTP server, and tmp directory)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_TAR="$REPO_ROOT/infra/assets/artifacts/numa-workspace-agent/image.tar"
CONTAINER_NAME="numa-workspace-agent-test"
HTTP_SERVER_PID=""
TMP_DIR=""

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No color

info()  { echo -e "${CYAN}==> ${NC}$1"; }
warn()  { echo -e "${YELLOW}==> ${NC}$1"; }
error() { echo -e "${RED}==> ${NC}$1"; }
ok()    { echo -e "${GREEN}==> ${NC}$1"; }

# ── Cleanup trap ─────────────────────────────────────────────────────────────
cleanup() {
    echo ""
    info "Cleaning up..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    if [ -n "$HTTP_SERVER_PID" ]; then
        kill "$HTTP_SERVER_PID" 2>/dev/null || true
        wait "$HTTP_SERVER_PID" 2>/dev/null || true
    fi
    if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
        rm -rf "$TMP_DIR"
        info "Removed tmp workspace: $TMP_DIR"
    fi
    ok "Done"
}
trap cleanup EXIT INT TERM

# ── Preflight checks ────────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
    error "Docker is not running. Start Docker Desktop first."
    exit 1
fi

if [ ! -f "$IMAGE_TAR" ]; then
    error "Image not found at $IMAGE_TAR"
    echo "  Build it first:  cd services && ./package-service.sh numa-workspace-agent"
    exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
    error "AWS CLI not found. Install it first."
    exit 1
fi

# Warn on Intel Mac (ARM64 image will be emulated)
if [ "$(uname -m)" != "arm64" ]; then
    warn "Running ARM64 image on $(uname -m) — expect slower performance via QEMU emulation."
fi

# Check for port conflicts
if lsof -i :8080 >/dev/null 2>&1; then
    error "Port 8080 is already in use. Stop the existing service first."
    exit 1
fi
if lsof -i :3000 >/dev/null 2>&1; then
    error "Port 3000 is already in use. Stop the existing service first."
    exit 1
fi

# ── Load Docker image ───────────────────────────────────────────────────────
info "Loading Docker image..."
docker load -i "$IMAGE_TAR"
ok "Image loaded"

# ── Parse .env file (BEFORE AWS creds so .env keys don't overwrite them) ────
ENV_FILE="$REPO_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
    error ".env file not found at $ENV_FILE"
    echo "  Create it with workspace testing variables. See .claude/skills/workspace-agent-local-test/skill.md"
    exit 1
fi

info "Reading workspace config from .env..."

# Parse .env handling "KEY = VALUE" format with spaces around =, and
# `export KEY=VALUE` shell-style lines (sourceable form is convenient).
while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Strip inline comments
    line="${line%%#*}"
    # Strip leading whitespace + optional `export ` prefix so the key matcher
    # below sees the bare name (`X`, not `export X`) — otherwise the
    # AWS-credential skip-check misses and we end up doing
    # `export "export AWS_ACCESS_KEY_ID=..."` which fails on the prefix.
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#export }"
    # Extract key and value, trimming whitespace
    key="$(echo "$line" | cut -d'=' -f1 | xargs)"
    value="$(echo "$line" | cut -d'=' -f2- | xargs)"
    # Skip AWS credential keys — these come from fresh STS creds, not .env
    [[ "$key" == "AWS_ACCESS_KEY_ID" || "$key" == "AWS_SECRET_ACCESS_KEY" || "$key" == "AWS_SESSION_TOKEN" || "$key" == "AWS_PROFILE" ]] && continue
    [ -n "$key" ] && export "$key=$value"
done < "$ENV_FILE"

# Map AWS_REGION_WORKSPACE -> AWS_REGION (container expects AWS_REGION)
export AWS_REGION="${AWS_REGION_WORKSPACE:-us-east-1}"
info "Using AWS_REGION=$AWS_REGION (from AWS_REGION_WORKSPACE)"

# ── Export AWS credentials (AFTER .env so fresh STS creds override stale keys) ─
info "Exporting AWS credentials from q-demo profile..."
eval "$(AWS_PROFILE=q-demo aws configure export-credentials --format env)"
ok "Credentials exported (note: these expire after ~1 hour)"

# ── Create tmp workspace ────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
chmod 777 "$TMP_DIR"
info "Workspace tmp dir: $TMP_DIR"

# ── Clean up any existing container ─────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# ── Start container ──────────────────────────────────────────────────────────
info "Starting workspace agent container on :8080..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p 8080:8080 \
    -v "$TMP_DIR:/workdir" \
    -e LOCAL_DEV=1 \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_SESSION_TOKEN \
    -e AWS_REGION \
    -e CLIENT_NAME="${CLIENT_NAME:-nd-labs}" \
    -e CLAUDE_CODE_USE_BEDROCK="${CLAUDE_CODE_USE_BEDROCK:-1}" \
    -e OUTPUTS_BUCKET_NAME="${OUTPUTS_BUCKET_NAME:-}" \
    -e DATA_BUCKET="${DATA_BUCKET:-}" \
    -e DYNAMODB_TABLE_NAME="${DYNAMODB_TABLE_NAME:-}" \
    -e WORKSPACE_AGENTS_TABLE="${WORKSPACE_AGENTS_TABLE:-}" \
    -e USER_AGENTS_TABLE="${USER_AGENTS_TABLE:-}" \
    -e CHAT_SETTINGS_TABLE_NAME="${CHAT_SETTINGS_TABLE_NAME:-}" \
    -e INTEGRATIONS_APPROVAL_TABLE_NAME="${INTEGRATIONS_APPROVAL_TABLE_NAME:-}" \
    -e WORKSPACE_TOOLS_LAMBDA_NAME="${WORKSPACE_TOOLS_LAMBDA_NAME:-}" \
    -e PIPEDREAM_RELAY_LAMBDA_ARN="${PIPEDREAM_RELAY_LAMBDA_ARN:-}" \
    numa-workspace-agent:latest

# ── Wait for health ──────────────────────────────────────────────────────────
info "Waiting for container health check..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8080/ping >/dev/null 2>&1; then
        ok "Container is healthy"
        break
    fi
    if [ "$i" -eq 30 ]; then
        error "Container failed to become healthy after 30s"
        echo "  Check logs: docker logs $CONTAINER_NAME"
        exit 1
    fi
    sleep 1
done

# ── Start test UI server ─────────────────────────────────────────────────────
info "Starting test UI on http://localhost:3000..."
cd "$SCRIPT_DIR/test-ui"
python3 -m http.server 3000 --bind 127.0.0.1 >/dev/null 2>&1 &
HTTP_SERVER_PID=$!
sleep 1

# ── Open browser ─────────────────────────────────────────────────────────────
ok "Opening browser..."
if command -v open >/dev/null 2>&1; then
    open http://localhost:3000
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000
else
    info "Open http://localhost:3000 in your browser"
fi

echo ""
ok "Workspace agent test environment is running!"
echo ""
echo "  Agent:     http://localhost:8080"
echo "  Test UI:   http://localhost:3000"
echo "  Logs:      docker logs -f $CONTAINER_NAME"
echo "  Workspace: $TMP_DIR"
echo ""
echo "  Press Ctrl+C to stop everything."
echo ""

# ── Wait for Ctrl+C ──────────────────────────────────────────────────────────
# Monitor the container — if it exits unexpectedly, we exit too
while docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; do
    sleep 2
done

warn "Container exited unexpectedly. Cleaning up..."
