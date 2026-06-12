# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed

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

# ───────────────────────────────────────────────────────────────────
# tcp_keepalive shim builder
# Compiles an LD_PRELOAD-able .so that forces SO_KEEPALIVE + tuned timing
# on every outbound TCP socket. Loaded into the Claude Agent SDK Node
# subprocess via the LD_PRELOAD env var in sdk_config.py. See
# scripts/tcp_keepalive/tcp_keepalive.c for rationale.
# ───────────────────────────────────────────────────────────────────
FROM --platform=linux/arm64 python:3.13-slim AS keepalive-builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/tcp_keepalive/tcp_keepalive.c /tmp/tcp_keepalive.c
RUN gcc -O2 -fPIC -shared -Wall -o /tmp/tcp_keepalive.so /tmp/tcp_keepalive.c -ldl

# Production image - ARM64 for AgentCore
FROM --platform=linux/arm64 python:3.13-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates jq \
    # PDF-to-image, text extraction (pdftoppm, pdftotext, pdfimages)
    poppler-utils \
    # WeasyPrint system dependencies (HTML→PDF)
    libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
    libgdk-pixbuf-2.0-0 libffi-dev libxml2 libxslt1.1 \
    # Fonts for PDF rendering — DejaVu covers Latin Extended-A (te reo Māori
    # macrons ā ē ī ō ū) required by policy-designer document rendering
    fonts-dejavu-core \
    # PDF manipulation CLI
    qpdf \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 LTS for PptxGenJS presentation creation
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Pandoc for Markdown-to-DOCX/PDF conversion
ARG PANDOC_VERSION=3.6.1
RUN curl -fsSL -o /tmp/pandoc.deb \
    "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-arm64.deb" \
    && dpkg -i /tmp/pandoc.deb && rm /tmp/pandoc.deb

# PptxGenJS + sharp for presentation creation with icon rasterization
RUN mkdir -p /app/node_packages && cd /app/node_packages \
    && npm init -y && npm install --production pptxgenjs@3.12.0 sharp@0.33.0 \
    && npm cache clean --force
ENV NODE_PATH="/app/node_packages/node_modules"

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
    mkdir -p /workdir/outputs && \
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
# The Claude Agent SDK uses the CLI under the hood for execution.
# Uses ARM64 binary for AgentCore Graviton-based runtime.
#
# Pinned to 2.1.142 — the prior pin (2.0.37) predated the addition of
# Claude Haiku 4.5 to the CLI's pricing table, which caused the CLI to
# silently fall back to billing Haiku requests at the default model's rate
# (Sonnet). Always pin a specific version rather than `stable`/`latest` to
# avoid surprise upgrades that could introduce breaking changes or
# pricing-table shifts.
ARG CLAUDE_CLI_VERSION=2.1.142
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

# Install the tcp_keepalive LD_PRELOAD shim. Loaded into the Claude Agent SDK
# Node subprocess at runtime via the LD_PRELOAD env var in sdk_config.py.
# See scripts/tcp_keepalive/tcp_keepalive.c for rationale.
COPY --from=keepalive-builder /tmp/tcp_keepalive.so /usr/local/lib/tcp_keepalive.so
RUN chmod 0755 /usr/local/lib/tcp_keepalive.so

# Copy application code
COPY numa_workspace_agent/ ./numa_workspace_agent/
COPY integration-prompts/ ./integration-prompts/
COPY run.sh ./

# Copy tools to /app/tools/ as read-only source (for selective copy at startup)
# The agent type system copies only enabled tools from here to /workdir/tools/
COPY --chown=agent:agent --chmod=555 tools/ /app/tools/
# Also copy to /workdir/tools/ as default (backwards compatible, overwritten at startup)
COPY --chown=agent:agent tools/ /workdir/tools/

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
