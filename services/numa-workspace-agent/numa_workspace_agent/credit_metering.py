"""Live credit metering — fire-and-forget signal to the credit-debit Lambda after a chat turn.

Gated by ``CREDIT_METERING_ENABLED`` (default OFF — inert until explicitly turned on). After the
turn's trace is synced to S3, the agent async-invokes the credit-debit Lambda with
``{conversation_id, user_sub, agent_id?}``; that Lambda reads the trace and writes the credit ledger.
``agent_id`` (present when the conversation is running an agent — ad-hoc OR scheduled) tells the
debit Lambda to price on the AGENT value tier rather than chat. The balance the admin panel shows
then ticks down live.

Best-effort by design: any failure is logged and swallowed — metering must NEVER affect a chat
request. The invoke itself is ``InvocationType='Event'`` (returns 202 immediately), so it doesn't
add latency to the response.
"""

import json
import os

import structlog

# Shared exact-match filter key across all credit logs (see credit-debit). The meter emit lands in
# the workspace-agent container log group; `domain="credits"` lets one filter span it + the lambdas.
logger = structlog.get_logger().bind(domain="credits")


def _enabled() -> bool:
    return os.environ.get("CREDIT_METERING_ENABLED", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def maybe_emit_credit_event(
    user_sub: str, conversation_id: str, agent_id: str | None = None
) -> None:
    """Async-invoke the credit-debit Lambda for this conversation. No-op unless metering is on.

    ``agent_id`` is set when this conversation is running an agent (ad-hoc agent chat OR scheduled
    run) — passed through so the debit Lambda prices on the agent value tier.
    """
    if not _enabled():
        return
    lambda_name = os.environ.get("CREDIT_DEBIT_LAMBDA_NAME", "")
    if not lambda_name or not user_sub or not conversation_id:
        return
    try:
        import boto3

        # Prefer the captured local-account credentials (the process may hold cross-account
        # Bedrock creds in AWS_*); fall back to the default task-role session.
        creds: dict[str, str] = {}
        if os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"):
            creds = {
                "aws_access_key_id": os.environ["NUMA_LOCAL_AWS_ACCESS_KEY_ID"],
                "aws_secret_access_key": os.environ.get(
                    "NUMA_LOCAL_AWS_SECRET_ACCESS_KEY", ""
                ),
            }
            if os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"):
                creds["aws_session_token"] = os.environ["NUMA_LOCAL_AWS_SESSION_TOKEN"]
        session = boto3.Session(
            region_name=os.environ.get("AWS_REGION", "us-east-1"), **creds
        )
        payload: dict[str, str] = {
            "conversation_id": conversation_id,
            "user_sub": user_sub,
        }
        if agent_id:
            payload["agent_id"] = agent_id
        session.client("lambda").invoke(
            FunctionName=lambda_name,
            InvocationType="Event",  # fire-and-forget; returns 202 immediately
            Payload=json.dumps(payload),
        )
        logger.info(
            "emitted credit usage event",
            _name="CREDIT_METER_EMIT",
            phase="cleanup",
            conversation_id=conversation_id,
            user_sub=user_sub,
        )
    except Exception as exc:  # noqa: BLE001 — metering must never break the request
        logger.warning(
            "credit usage emit failed",
            _name="CREDIT_METER_EMIT_FAIL",
            phase="cleanup",
            conversation_id=conversation_id,
            error=str(exc),
        )
