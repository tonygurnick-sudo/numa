# syntax=docker/dockerfile:1.7-labs
FROM node:22-slim as build
ARG GIT_HASH
ARG GIT_BRANCH
ARG CI_PROJECT_PATH
ARG TERRAFORM_VERSION=1.12.2

WORKDIR /workspace

# Install Terraform as root
USER root
RUN apt-get update && apt-get install -y \
  bash-completion \
  curl \
  git \
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

ENV GIT_HASH=${GIT_HASH:-unknown}
ENV GIT_BRANCH=${GIT_BRANCH:-unknown}
ENV CI_PROJECT_PATH=$CI_PROJECT_PATH

# TODO: Flatten?
ENTRYPOINT ["yarn", "workspace", "@arcanumai/q-apps-deployer-infra", "run", "cdktf"]

FROM build
