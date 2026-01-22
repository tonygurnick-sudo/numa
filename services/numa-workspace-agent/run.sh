#!/bin/bash
# Entrypoint for the Numa Workspace Agent container

set -e

# Disable OTLP trace export to X-Ray - requires CloudWatch Logs as trace destination
# which isn't configured. We keep metrics/logs but disable trace export.
export OTEL_TRACES_EXPORTER="none"

# Start uvicorn with OpenTelemetry auto-instrumentation
# This enables AgentCore observability (metrics, logs, session correlation)
exec opentelemetry-instrument uvicorn numa_workspace_agent.main:app \
    --host 0.0.0.0 \
    --port 8080 \
    --log-level info
