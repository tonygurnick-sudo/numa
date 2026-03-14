# syntax=docker/dockerfile:1
FROM --platform=linux/arm64 python:3.13-slim AS builder

WORKDIR /app
RUN pip install --no-cache-dir poetry==1.8.3
COPY pyproject.toml ./
RUN poetry lock --no-update 2>/dev/null || true
RUN poetry export -f requirements.txt --without-hashes --only main > requirements.txt

FROM --platform=linux/arm64 python:3.13-slim

# System dependencies for document/media processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    # LibreOffice (headless, for DOCX/PPTX/XLS conversion)
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    libreoffice-impress-nogui \
    # PDF tools
    poppler-utils \
    # DjVu support
    djvulibre-bin \
    # Cairo for SVG rendering
    libcairo2 libcairo2-dev \
    libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    # General
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY --from=builder /app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY main.py ./
COPY handlers/ ./handlers/

# Non-root user
RUN useradd --uid 1000 --create-home --shell /bin/bash worker
USER worker

ARG GIT_HASH=unknown
ENV GIT_HASH=${GIT_HASH}
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
