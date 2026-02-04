# Numa Workspace Agent - AgentCore Service
# Based on Python 3.13 slim for minimal image size
# ARM64 required for AWS Bedrock AgentCore
# AgentCore HTTP contract: GET /ping, POST /invocations

FROM --platform=linux/arm64 python:3.13-slim AS builder

# Install poetry
RUN pip install --no-cache-dir poetry==1.8.3

WORKDIR /app

# Copy dependency files first (cache layer)
COPY pyproject.toml poetry.lock* ./

# Export dependencies to requirements.txt (no dev deps)
RUN poetry export -f requirements.txt --without-hashes --only main > requirements.txt || \
    poetry lock && poetry export -f requirements.txt --without-hashes --only main > requirements.txt

# Production image - ARM64 for AgentCore
FROM --platform=linux/arm64 python:3.13-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with UID 1000
# Note: AgentCore uses ephemeral storage, no EFS access point needed
RUN useradd --uid 1000 --create-home --shell /bin/bash agent

# Create workspace directories under /workdir (ephemeral, synced to S3)
# AgentCore sets LOCAL_WORKSPACE_ROOT=/workdir, so all paths are relative to /workdir
# Structure: /workdir/.system/.claude/, /workdir/chat-workflows/, /workdir/tools/, etc.
# Tools are now inside /workdir to respect workspace boundary
RUN mkdir -p /workdir/.system/.claude && \
    mkdir -p /workdir/chat-workflows && \
    mkdir -p /workdir/uploads && \
    mkdir -p /workdir/session && \
    mkdir -p /workdir/tools/numa && \
    chown -R agent:agent /workdir && \
    # Create plugin directory outside /workdir (AI cannot modify plugins)
    mkdir -p /app/plugins/numa && \
    # Symlink .claude to .system/.claude for SDK session storage
    ln -s /workdir/.system/.claude /workdir/.claude

# Copy plugins (skills and agents) to /app/plugins/numa/
# This is outside the workspace for security - AI cannot modify its own plugins
# The SDK discovers these via the plugins option in ClaudeAgentOptions
COPY --chown=agent:agent plugins/numa/ /app/plugins/numa/

# Download and install Claude CLI from official distribution
# The Claude Agent SDK uses the CLI under the hood for execution
# Uses ARM64 binary for AgentCore Graviton-based runtime
ARG CLAUDE_CLI_VERSION=2.0.37
RUN set -eux && \
    mkdir -p /opt/bin && \
    GCS_BUCKET="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases" && \
    # Force ARM64 for AgentCore
    PLATFORM="linux-arm64" && \
    if [ "${CLAUDE_CLI_VERSION}" = "stable" ] || [ "${CLAUDE_CLI_VERSION}" = "latest" ]; then \
      VERSION=$(curl -fsSL "$GCS_BUCKET/stable"); \
    else \
      VERSION="${CLAUDE_CLI_VERSION}"; \
    fi && \
    echo "Downloading Claude CLI version: $VERSION for $PLATFORM" && \
    MANIFEST=$(curl -fsSL "$GCS_BUCKET/$VERSION/manifest.json") && \
    CHECKSUM=$(echo "$MANIFEST" | jq -r --arg p "$PLATFORM" '.platforms[$p].checksum') && \
    test -n "$CHECKSUM" && \
    curl -fsSL -o /opt/bin/claude "$GCS_BUCKET/$VERSION/$PLATFORM/claude" && \
    echo "$CHECKSUM  /opt/bin/claude" | sha256sum -c - && \
    chmod +x /opt/bin/claude && \
    /opt/bin/claude --version

ENV PATH="/opt/bin:${PATH}"
ENV CLAUDE_BIN="/opt/bin/claude"

WORKDIR /app

# Install Python dependencies
COPY --from=builder /app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY numa_workspace_agent/ ./numa_workspace_agent/
COPY integration-prompts/ ./integration-prompts/
COPY run.sh ./

# Copy tools directory inside /workdir (read+execute only)
# Tools are now within workspace boundary for security
COPY --chown=agent:agent --chmod=555 tools/ /workdir/tools/

# Make all application files readable by all (required for non-root user)
RUN chmod -R 755 /app

# Switch to non-root user
USER agent

# Set HOME to /workdir/.system so ~/.claude resolves to /workdir/.system/.claude
ENV HOME="/workdir/.system"

# Local workspace root is /workdir - AgentCore sets this at runtime anyway
ENV LOCAL_WORKSPACE_ROOT="/workdir"

# Expose port (AgentCore expects 8080)
EXPOSE 8080

# Health check - AgentCore uses /ping endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/ping || exit 1

# Run the application
CMD ["./run.sh"]
