# Workspace Agent Proxy

Thin Lambda proxy that bridges HTTP requests from CloudFront to AgentCore SDK.

## Purpose

AgentCore requires AWS SigV4-signed SDK calls and has no public HTTP endpoint.
This Lambda receives HTTP requests and translates them to `invoke_agent_runtime` calls.

## Architecture

```
Browser ──HTTP──▶ CloudFront ──▶ Lambda Function URL ──SDK──▶ AgentCore Runtime
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_RUNTIME_ARN` | ARN of the AgentCore runtime to invoke |
| `CLOUDFRONT_SHARED_SECRET` | Secret header for CloudFront auth |
| `CLIENT_NAME` | Client name for logging |

## Endpoints

- `GET /ping` - Health check
- `POST /invocations` - Proxy to AgentCore (streams response)
