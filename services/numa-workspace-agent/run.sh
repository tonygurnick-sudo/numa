#!/bin/bash
# Entrypoint for the Numa Workspace Agent container

set -e

# Disable OTLP trace and metrics export - no collector runs in the container.
# We keep OTel auto-instrumentation for logs/session correlation only.
export OTEL_TRACES_EXPORTER="none"
export OTEL_METRICS_EXPORTER="none"

# Start uvicorn with OpenTelemetry auto-instrumentation
# This enables AgentCore observability (metrics, logs, session correlation)
exec opentelemetry-instrument uvicorn numa_workspace_agent.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level info
