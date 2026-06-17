#!/usr/bin/env sh

# Launch the ASGI app for Lambda Web Adapter (LWA), response-streaming mode.
# AWS_LWA_INVOKE_MODE=response_stream is set on the function env by the construct.
export PORT="${AWS_LWA_PORT:-8080}"
exec python -m uvicorn lambda_function:app --host 127.0.0.1 --port "$PORT" --no-server-header
