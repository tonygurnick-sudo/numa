# Services

Containerized agents deployed on AWS Bedrock AgentCore MicroVMs. Unlike the Lambda-based functions in `/lambdas/`, services run as long-lived Docker containers with persistent state.

## Directory Structure

```
services/
  numa-workspace-agent/     # Workspace chat agent (Claude Agent SDK)
  test-ui/                  # Browser-based local test interface
  package-service.sh        # Build ARM64 Docker image for deployment
  test-workspace-agent.sh   # Run workspace agent locally with test UI
```

## numa-workspace-agent

The workspace chat agent powering Numa Chat V2. Runs the Claude Agent SDK in a sandboxed MicroVM with persistent workspace, code execution, skills/plugins, and integration support. See `numa-workspace-agent/README.md` for full documentation.

## Packaging

```bash
./package-service.sh numa-workspace-agent
```

Builds an ARM64 Docker image and saves it to `infra/assets/artifacts/numa-workspace-agent/image.tar` for CDKTF deployment to ECR. Requires Docker Desktop running.

## Local Testing

```bash
./test-workspace-agent.sh
```

Starts the workspace agent container on `:8080` and a test UI on `:3000`, then opens your browser. Test all agent types (numa-chat, research-agent, document-summariser) interactively with streaming responses, tool call rendering, and real-time event logging.

**Prerequisites:**
- Docker Desktop running
- AWS CLI configured with `q-demo` profile
- Image built first (`./package-service.sh numa-workspace-agent`)
- `.env` file at repo root with workspace testing variables (see `.claude/skills/workspace-agent-local-test/skill.md`)

Press `Ctrl+C` to stop everything and clean up.
