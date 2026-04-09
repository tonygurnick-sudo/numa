# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed

# Browser Lambda
# ARM64 container image with Playwright + Chromium for JS-rendered page fetching.
# Used by the web crawler Step Function and web search tool.
#
# Uses the AWS Lambda base image (required for Chromium to run in Lambda's sandbox).
# httpx uses ssl.create_default_context() to bypass certifi's stale CA bundle.
#
# Build context must be the repo root (numa/) so we can access lib/prm.

# --- Builder stage: export Python dependencies ---
FROM --platform=linux/arm64 python:3.13-slim AS builder

RUN pip install --no-cache-dir poetry==1.8.3

WORKDIR /build

# Copy dependency files and local libs (cache layer)
COPY lambdas/python/browser-lambda/pyproject.toml lambdas/python/browser-lambda/poetry.lock* ./lambda/
COPY lib/prm /build/lib/prm

# Export production dependencies to requirements.txt, excluding local path deps (prm)
WORKDIR /build/lambda
RUN (poetry export -f requirements.txt --without-hashes --only main || \
    (poetry lock && poetry export -f requirements.txt --without-hashes --only main)) \
    | grep -v 'file://' > /build/requirements.txt

# --- Runtime stage: AWS Lambda base image (ARM64) ---
FROM --platform=linux/arm64 public.ecr.aws/lambda/python:3.13

# Install system dependencies required by Playwright Chromium
RUN dnf install -y \
    nss \
    atk \
    at-spi2-atk \
    cups-libs \
    libdrm \
    libxkbcommon \
    libXcomposite \
    libXdamage \
    libXrandr \
    libgbm \
    pango \
    cairo \
    alsa-lib \
    libXtst \
    libXfixes \
    && dnf clean all

# Install Python dependencies
COPY --from=builder /build/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Install prm lib (simple pure-Python package)
COPY lib/prm/prm ${LAMBDA_TASK_ROOT}/prm

# Install Playwright Chromium headless shell only
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN python -m playwright install chromium --only-shell

# Copy Lambda function code
COPY lambdas/python/browser-lambda/lambda_function.py ${LAMBDA_TASK_ROOT}/

CMD ["lambda_function.handler"]
