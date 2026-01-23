# syntax=docker/dockerfile:1.7-labs
FROM node:22-slim as build
ARG GIT_HASH
ARG GIT_BRANCH
ARG CI_PROJECT_PATH
ARG TERRAFORM_VERSION=1.12.2
ARG CLAUDE_ARTIFACT_URL
ARG CLAUDE_CLI_VERSION=2.0.37

WORKDIR /workspace

# Install Terraform and skopeo as root
USER root
RUN apt-get update && apt-get install -y \
  bash-completion \
  curl \
  git \
  zip \
  unzip \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip -o /tmp/terraform.zip \
  && unzip /tmp/terraform.zip -d /tmp \
  && mv /tmp/terraform /usr/local/bin/ \
  && rm -rf /tmp/* \
  && terraform version

# Install skopeo for pushing container images to client ECR without Docker daemon
RUN curl -fsSL https://github.com/lework/skopeo-binary/releases/download/v1.16.1/skopeo-linux-amd64 \
  -o /usr/local/bin/skopeo && chmod +x /usr/local/bin/skopeo \
  && skopeo --version

# Install AWS CLI v2 for provisioner scripts that interact with ECR
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
  && unzip -q /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /tmp/aws /tmp/awscliv2.zip \
  && aws --version

# Install jq for parsing JSON in provisioner scripts
RUN apt-get update && apt-get install -y jq \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && jq --version

USER node

# Copy in dependencies
COPY lib/client-config-node lib/client-config-node
COPY style style
COPY --parents lambdas/*/*/lambda_function.zip .
# This is not necessarily ideal
COPY node_modules node_modules
COPY package.json .
COPY yarn.lock .
COPY --chown=node:node .yarn/install-state.gz .yarn/

# Copy in code
COPY infra infra
COPY clientConfigProd.json .

# Install yarn.
USER root
RUN corepack enable
USER node
RUN yes | yarn --version

USER root
RUN mkdir infra/cdktf.out
RUN chown -R node:node infra/cdktf.out
USER node

# Bake the Claude CLI artifact into the image for Portal/ECS deploys so CDKTF
# can publish from infra/assets/artifacts/claude-cli/claude-x86_64.zip.
# Artifacts-first: if the ZIP is present in the build context, use it; otherwise
# optionally fall back to CLAUDE_ARTIFACT_URL if provided.
USER root
RUN bash -c 'set -euo pipefail \
  && ART_DIR=/workspace/infra/assets/artifacts/claude-cli \
  && ART_ZIP="$ART_DIR/claude-x86_64.zip" \
  && mkdir -p "$ART_DIR" \
  && if [ -f "$ART_ZIP" ]; then \
       echo "Using existing Claude artifact from build context: $ART_ZIP"; \
     elif [ -n "${CLAUDE_ARTIFACT_URL:-}" ]; then \
       echo "Downloading Claude artifact from presigned URL"; \
       curl -fSL "${CLAUDE_ARTIFACT_URL}" -o "$ART_ZIP"; \
     else \
       echo "Claude artifact missing and CLAUDE_ARTIFACT_URL not provided." >&2; \
       echo "Ensure claude-cli-artifact-build job runs and is a pipeline dependency," >&2; \
       echo "or pass --build-arg CLAUDE_ARTIFACT_URL=..." >&2; \
       exit 1; \
     fi \
  && ACT="$ART_ZIP" \
  && echo "Verifying artifact size..." \
  && SZ=$(stat -c%s "$ACT" 2>/dev/null || stat -f%z "$ACT") \
  && echo "Artifact size: $SZ bytes" \
  && [ "$SZ" -gt 1048576 ] \
  && ls -lh "$ACT"'

# Copy the workspace-agent container image tar (if present from CI packaging)
# Uses --exclude to make the COPY optional (won't fail if file doesn't exist)
# The tar is created by: services/package-service.sh numa-workspace-agent
# --chown=node:node ensures the node user can read the file for Terraform's filesha256()
COPY --chown=node:node --exclude=.gitkeep infra/assets/artifacts/numa-workspace-agent/ infra/assets/artifacts/numa-workspace-agent/
RUN bash -c 'set -euo pipefail \
  && ART_DIR=/workspace/infra/assets/artifacts/numa-workspace-agent \
  && ART_TAR="$ART_DIR/image.tar" \
  && if [ -f "$ART_TAR" ]; then \
       echo "Workspace agent artifact present: $ART_TAR"; \
       ls -lh "$ART_TAR"; \
     else \
       echo "Workspace agent artifact not present (optional for now)"; \
       mkdir -p "$ART_DIR"; \
     fi'
USER node

ENV GIT_HASH=${GIT_HASH:-unknown}
ENV GIT_BRANCH=${GIT_BRANCH:-unknown}
ENV CI_PROJECT_PATH=$CI_PROJECT_PATH

# TODO: Flatten?
ENTRYPOINT ["yarn", "workspace", "@arcanumai/q-apps-deployer-infra", "run", "cdktf"]

FROM build
