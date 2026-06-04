"""
Numa Voice config write-back Lambda (deployer account, 207567759910).

FEAT-169: persists Amazon Connect / Numa Voice values back into the single
source of truth — the deployer-account `numa-client-config` DynamoDB table — so
the recordings bucket, DID numbers, and Connect instance URL are discoverable in
tenant config rather than only recomputed by convention or read live from Connect.

Security model (mirrors numa-email-sender): client-account callers cannot touch
the table directly. The per-client `{client}_voice-admin` Lambda invokes THIS
Lambda cross-account with an STS GetCallerIdentity presigned-URL proof; this
handler validates the proof, resolves the caller's clientName SERVER-SIDE from
its account (never from the request body), and writes ONLY that tenant's record.

Invocation payload:
{
    "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",   # required
    "recordings_bucket": "numa-acme-connect-recordings",          # optional
    "did_numbers": ["+6421234567", ...],                          # optional
    "connect_instance_url": "https://acme.my.connect.aws"         # optional
}

The write is a scoped nested UpdateItem on the `config` map — it sets only the
provided fields and leaves every other config attribute untouched. connect_instance_url
is written with if_not_exists so a Phase-1 admin-configured value is never clobbered.
"""

import os
import re
from typing import Any, Dict, List, Optional

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

from prm import resource as prm_resource
from security_validator import SecurityValidationError, VoiceConfigSecurityValidator

logger = structlog.get_logger()

_validator: Optional[VoiceConfigSecurityValidator] = None

# E.164: leading +, country code (no leading 0), up to 15 digits total.
E164_REGEX = re.compile(r"^\+[1-9]\d{1,14}$")
MAX_DID_NUMBERS = 100


def _get_validator() -> VoiceConfigSecurityValidator:
    global _validator
    if _validator is None:
        _validator = VoiceConfigSecurityValidator()
    return _validator


def _clean_did_numbers(raw: Any) -> Optional[List[str]]:
    """Coerce to a de-duplicated list of valid E.164 numbers, or None."""
    if not isinstance(raw, list):
        return None
    seen: Dict[str, None] = {}
    for item in raw:
        if isinstance(item, str):
            num = item.strip()
            if E164_REGEX.match(num):
                seen[num] = None
    cleaned = list(seen.keys())[:MAX_DID_NUMBERS]
    return cleaned if cleaned else None


def _clean_str(raw: Any) -> Optional[str]:
    if isinstance(raw, str):
        s = raw.strip()
        if s:
            return s
    return None


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        function_name=context.function_name,
        _name="VOICE_CONFIG_WRITER",
    )

    sts_proof_url = event.get("sts_proof_url")
    if not sts_proof_url or not isinstance(sts_proof_url, str):
        logger.warning("Missing sts_proof_url")
        return {
            "statusCode": 400,
            "body": {"success": False, "error": "sts_proof_url is required"},
        }

    client_name = event.get("client_name")
    if not client_name or not isinstance(client_name, str):
        logger.warning("Missing client_name")
        return {
            "statusCode": 400,
            "body": {"success": False, "error": "client_name is required"},
        }
    structlog.contextvars.bind_contextvars(client_name=client_name)

    # Security: validate the STS proof, then confirm the caller ACCOUNT owns the
    # client record it is asking to write (1:1 in prod, N:1 for shared dev accounts).
    try:
        validator = _get_validator()
        validation = validator.validate_request(sts_proof_url)
        caller_account = validation["caller_account_id"]
        structlog.contextvars.bind_contextvars(caller_account=caller_account)
        validator.authorize_client_write(client_name, caller_account)
    except SecurityValidationError as e:
        logger.warning("Security validation failed", error=str(e))
        return {"statusCode": 403, "body": {"success": False, "error": "Access denied"}}

    # Build the scoped set of config fields to write.
    recordings_bucket = _clean_str(event.get("recordings_bucket"))
    connect_instance_url = _clean_str(event.get("connect_instance_url"))
    did_numbers = _clean_did_numbers(event.get("did_numbers"))

    set_clauses: List[str] = []
    expr_names: Dict[str, str] = {}
    expr_values: Dict[str, Any] = {}

    if recordings_bucket is not None:
        set_clauses.append("config.#rb = :rb")
        expr_names["#rb"] = "recordingsBucket"
        expr_values[":rb"] = recordings_bucket
    if did_numbers is not None:
        set_clauses.append("config.#dn = :dn")
        expr_names["#dn"] = "didNumbers"
        expr_values[":dn"] = did_numbers
    if connect_instance_url is not None:
        # Never clobber an existing (Phase-1 admin-set) value.
        set_clauses.append("config.#ciu = if_not_exists(config.#ciu, :ciu)")
        expr_names["#ciu"] = "connectInstanceUrl"
        expr_values[":ciu"] = connect_instance_url

    if not set_clauses:
        logger.info("No voice config fields to write")
        return {"statusCode": 200, "body": {"success": True, "written": []}}

    table_name = os.environ.get("CLIENT_CONFIG_TABLE_NAME")
    if not table_name:
        logger.error("CLIENT_CONFIG_TABLE_NAME not set")
        return {"statusCode": 500, "body": {"success": False, "error": "Misconfigured"}}

    table = prm_resource("dynamodb").Table(table_name)

    try:
        table.update_item(
            Key={"clientName": client_name},
            UpdateExpression="SET " + ", ".join(set_clauses),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            # Only write an EXISTING record — never create a stub for an unknown
            # client (the scan already proved it exists; this guards a race).
            ConditionExpression="attribute_exists(clientName)",
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            logger.warning("Client config record missing", client_name=client_name)
            return {
                "statusCode": 404,
                "body": {"success": False, "error": "Client config not found"},
            }
        if code == "ValidationException":
            # Most likely the `config` map does not exist on the record yet.
            logger.error("Update validation failed (config map missing?)", error=str(e))
            return {
                "statusCode": 409,
                "body": {"success": False, "error": "Config not writable"},
            }
        logger.exception("UpdateItem failed")
        return {"statusCode": 500, "body": {"success": False, "error": "Write failed"}}
    except Exception:
        logger.exception("Unexpected error writing voice config")
        return {
            "statusCode": 500,
            "body": {"success": False, "error": "Internal error"},
        }

    written = sorted(
        name
        for name in ("recordingsBucket", "didNumbers", "connectInstanceUrl")
        if name in expr_names.values()
    )
    logger.info(
        "Voice config written", written=written, did_count=len(did_numbers or [])
    )
    return {"statusCode": 200, "body": {"success": True, "written": written}}
