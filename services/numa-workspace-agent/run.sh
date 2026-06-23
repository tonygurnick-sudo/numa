#!/bin/bash
# Entrypoint for the Numa Workspace Agent container.
#
# Two-stage start:
#   1. As ROOT: install the TASK-151 sandbox firewall (drop egress to the
#      instance-metadata + ECS-credential endpoints), then drop privileges.
#   2. As `agent` (UID 1000, via setpriv): exec the uvicorn app exactly as
#      before. The app and every agent Bash subprocess run non-root.

set -e

# ── TASK-151: IMDS / ECS-credential firewall ─────────────────────────────────
# Block outbound traffic from in-sandbox code to the AWS instance-metadata
# service (169.254.169.254) and the ECS task-role credential endpoint
# (169.254.170.2). The container receives its AWS credentials via environment
# variables (set by AgentCore / sdk_config.py), NOT via IMDS — so dropping these
# does not affect boto3 or the Bedrock CLI. It does stop a prompt-injected agent
# from harvesting role credentials off the metadata endpoint inside the MicroVM.
#
# FAIL-OPEN by design: AgentCore MicroVMs may not grant NET_ADMIN, in which case
# iptables can't modify the netfilter tables. We log loudly and continue rather
# than refuse to boot — the security_hook denylist (curl/wget/nc blocked) and
# the env scrub remain in force regardless. Whether NET_ADMIN is granted can
# only be confirmed by a deploy (see the BLOCKED/ACTIVE log line below).
apply_imds_firewall() {
    local meta_ip="169.254.169.254/32"
    local ecs_ip="169.254.170.2/32"

    if [ "$(id -u)" != "0" ]; then
        echo "{\"_name\":\"IMDS_FIREWALL\",\"phase\":\"init\",\"status\":\"skipped\",\"reason\":\"not running as root\"}"
        return 0
    fi
    if ! command -v iptables >/dev/null 2>&1; then
        echo "{\"_name\":\"IMDS_FIREWALL\",\"phase\":\"init\",\"status\":\"skipped\",\"reason\":\"iptables not installed\"}"
        return 0
    fi

    # -I OUTPUT inserts at the top so the DROP precedes any ACCEPT. Idempotent:
    # -C checks for an existing identical rule before inserting (so a warm
    # re-exec doesn't stack duplicates). Each rule is best-effort; a failure on
    # one IP (e.g. NET_ADMIN denied) logs and falls through.
    local ok=1
    for ip in "$meta_ip" "$ecs_ip"; do
        if iptables -C OUTPUT -d "$ip" -j DROP 2>/dev/null; then
            continue  # already present
        fi
        if ! iptables -I OUTPUT -d "$ip" -j DROP 2>/dev/null; then
            ok=0
        fi
    done

    if [ "$ok" = "1" ]; then
        echo "{\"_name\":\"IMDS_FIREWALL\",\"phase\":\"init\",\"status\":\"active\",\"blocked\":[\"$meta_ip\",\"$ecs_ip\"]}"
    else
        echo "{\"_name\":\"IMDS_FIREWALL\",\"phase\":\"init\",\"status\":\"degraded\",\"reason\":\"iptables rule insert failed (NET_ADMIN likely not granted) — failing open\"}"
    fi
    return 0
}

apply_imds_firewall || true

# Disable OTLP trace and metrics export - no collector runs in the container.
# We keep OTel auto-instrumentation for logs/session correlation only.
export OTEL_TRACES_EXPORTER="none"
export OTEL_METRICS_EXPORTER="none"

# uvicorn launch command (shared by both the root and non-root branches).
start_app() {
    exec opentelemetry-instrument uvicorn numa_workspace_agent.main:app \
        --host 0.0.0.0 \
        --port 8080 \
        --log-level info
}

# ── Drop privileges to the non-root `agent` user ─────────────────────────────
# When started as root (to apply the firewall above) we MUST drop to UID 1000
# before exec'ing the app, so the app and every agent Bash subprocess remain
# non-root — the workspace-isolation guarantee. When already non-root (e.g. a
# local-dev run that started as `agent`, or NET_ADMIN-less environments where
# the platform forced a non-root start), just exec directly.
if [ "$(id -u)" = "0" ]; then
    if command -v setpriv >/dev/null 2>&1; then
        # --init-groups recomputes the supplementary group list for `agent`.
        # HOME is already exported via the Dockerfile ENV; setpriv preserves env.
        exec setpriv --reuid=agent --regid=agent --init-groups \
            opentelemetry-instrument uvicorn numa_workspace_agent.main:app \
            --host 0.0.0.0 \
            --port 8080 \
            --log-level info
    else
        # setpriv missing (should not happen — util-linux is installed). Fall
        # back to su so we never run the app as root.
        echo "{\"_name\":\"PRIV_DROP\",\"phase\":\"init\",\"status\":\"setpriv missing — falling back to su\"}"
        exec su agent -c 'exec opentelemetry-instrument uvicorn numa_workspace_agent.main:app --host 0.0.0.0 --port 8080 --log-level info'
    fi
else
    start_app
fi
