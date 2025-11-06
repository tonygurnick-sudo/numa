# syntax=docker/dockerfile:1.7-labs
FROM node:22-slim as build
ARG GIT_HASH
ARG GIT_BRANCH
ARG CI_PROJECT_PATH
ARG TERRAFORM_VERSION=1.12.2
ARG CLAUDE_LAYER_URL
ARG CLAUDE_CLI_VERSION=1.0.100

WORKDIR /workspace

# Install Terraform as root
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

# Bake the Claude CLI layer into the image for Portal/ECS deploys
# so CDKTF can publish from infra/assets/layers/claude-cli/claude-x86_64.zip
# without relying on CI artifacts or local builds.
USER root
RUN set -euo pipefail \
  && mkdir -p /workspace/infra/assets/layers/claude-cli \
  && if [ -n "${CLAUDE_LAYER_URL}" ]; then \
       echo "Downloading Claude layer from presigned URL" \
       && curl -fSL "${CLAUDE_LAYER_URL}" -o /workspace/infra/assets/layers/claude-cli/claude-x86_64.zip; \
     else \
       echo "No CLAUDE_LAYER_URL provided; building from installer (version: ${CLAUDE_CLI_VERSION})" \
       && curl -fsSL https://claude.ai/install.sh | bash -s ${CLAUDE_CLI_VERSION} \
       && CLAUDE_BIN=$(command -v claude) \
       && mkdir -p /workspace/infra/assets/layers/claude-cli/bin \
       && cp "$CLAUDE_BIN" /workspace/infra/assets/layers/claude-cli/bin/claude \
       && chmod +x /workspace/infra/assets/layers/claude-cli/bin/claude \
       && (cd /workspace/infra/assets/layers/claude-cli && zip -r claude-x86_64.zip bin); \
     fi \
  && ls -lh /workspace/infra/assets/layers/claude-cli/claude-x86_64.zip
USER node

ENV GIT_HASH=${GIT_HASH:-unknown}
ENV GIT_BRANCH=${GIT_BRANCH:-unknown}
ENV CI_PROJECT_PATH=$CI_PROJECT_PATH

# TODO: Flatten?
ENTRYPOINT ["yarn", "workspace", "@arcanumai/q-apps-deployer-infra", "run", "cdktf"]

FROM build
