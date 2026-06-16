# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed

# Synergy KB crawler worker
# ARM64 container image with document text extractors (pdfplumber, python-docx,
# openpyxl, python-pptx). Container (not zip) because pdfminer/Pillow/lxml carry
# native wheels and the corpus crawl is a long-running, memory-heavy workload.
#
# Build context must be the repo root (numa/) so we can access lib/prm.

# --- Builder stage: export Python dependencies ---
FROM --platform=linux/arm64 python:3.13-slim AS builder

RUN pip install --no-cache-dir poetry==1.8.3

WORKDIR /build

# Copy dependency files and local libs (cache layer)
COPY lambdas/python/synergy-text-crawler/pyproject.toml lambdas/python/synergy-text-crawler/poetry.lock* ./lambda/
COPY lib/prm /build/lib/prm

# Export production dependencies to requirements.txt, excluding local path deps (prm)
WORKDIR /build/lambda
RUN (poetry export -f requirements.txt --without-hashes --only main || \
    (poetry lock && poetry export -f requirements.txt --without-hashes --only main)) \
    | grep -v 'file://' > /build/requirements.txt

# --- Runtime stage: AWS Lambda base image (ARM64) ---
FROM --platform=linux/arm64 public.ecr.aws/lambda/python:3.13

# Install Python dependencies (pdfminer/Pillow/lxml ship aarch64 wheels)
COPY --from=builder /build/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Install prm lib (simple pure-Python package)
COPY lib/prm/prm ${LAMBDA_TASK_ROOT}/prm

# Copy Lambda function code (worker + ported client + extractors)
COPY lambdas/python/synergy-text-crawler/lambda_function.py ${LAMBDA_TASK_ROOT}/
COPY lambdas/python/synergy-text-crawler/synergy_client.py ${LAMBDA_TASK_ROOT}/
COPY lambdas/python/synergy-text-crawler/extract.py ${LAMBDA_TASK_ROOT}/

CMD ["lambda_function.handler"]
