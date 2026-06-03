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
# ext-api-doc/ holds the per-connector knowledge packs that numa-client-stack.ts syncs
# to each client's S3 bucket (and the workspace agent loads at runtime). It is a
# repo-root SIBLING of infra/, so it must be copied explicitly — without this line,
# container deploys (CI build-deployment-container + Customer Success Portal) shipped
# zero docs while host `make deploy` worked, which read as "docs deploy inconsistently".
COPY ext-api-doc ext-api-doc
# Fail the IMAGE BUILD if the docs dir is missing or suspiciously empty, instead of
# letting a deploy from this image silently sync zero docs and let Terraform prune a
# client's ext-api-doc bucket. Catches a dropped COPY / bad context one stage earlier
# than the deploy-time throw guard in numa-client-stack.ts. Threshold is a low floor
# (real set is ~254 .md across ~30 connectors); bump if the corpus ever shrinks.
RUN count=$(find ext-api-doc -name '*.md' -not -path 'ext-api-doc/_templates/*' | wc -l) && \
    if [ "$count" -lt 50 ]; then \
      echo "FATAL: ext-api-doc has only $count shippable .md files (expected >=50). Refusing to build a deploy image that would empty client connector-doc buckets." >&2; \
      exit 1; \
    fi && echo "ext-api-doc OK: $count shippable .md files"
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

# Copy the browser-lambda container image tar (if present from CI packaging)
COPY --chown=node:node --exclude=.gitkeep infra/assets/artifacts/browser-lambda/ infra/assets/artifacts/browser-lambda/
RUN bash -c 'set -euo pipefail \
  && ART_DIR=/workspace/infra/assets/artifacts/browser-lambda \
  && ART_TAR="$ART_DIR/image.tar" \
  && if [ -f "$ART_TAR" ]; then \
       echo "Browser lambda artifact present: $ART_TAR"; \
       ls -lh "$ART_TAR"; \
     else \
       echo "Browser lambda artifact not present (optional)"; \
       mkdir -p "$ART_DIR"; \
     fi'

USER node

ENV GIT_HASH=${GIT_HASH:-unknown}
ENV GIT_BRANCH=${GIT_BRANCH:-unknown}
ENV CI_PROJECT_PATH=$CI_PROJECT_PATH

# TODO: Flatten?
ENTRYPOINT ["yarn", "workspace", "@arcanumai/q-apps-deployer-infra", "run", "cdktf"]

FROM build
