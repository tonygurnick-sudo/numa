"""
Cognito CustomEmailSender trigger (BUG-188).

Replaces Cognito's built-in email delivery (COGNITO_DEFAULT —
no-reply@verificationemail.com) for a client-account user pool. When any user
event requires an email, Cognito invokes this Lambda instead of sending the
message itself, passing the verification code / temporary password encrypted
with a KMS key. We decrypt the code, choose the right template, and send via the
centralized `numa-email-sender` Lambda in the deployer account (cross-account,
authenticated with an STS presigned-URL proof). The message goes out from the
DKIM/SPF/DMARC-aligned `notifications.numa.arcanum.ai` domain, which delivers
reliably to Microsoft 365 / Google tenants that silently drop verificationemail.com.

Why CustomEmailSender rather than Cognito's native SES `emailConfiguration`:
Cognito's SES integration is same-account only and would require requesting SES
production access (sandbox exit) in every client account, per region. This
trigger reuses the single, already-warmed central sender and is region/account
agnostic.

IMPORTANT: a CustomEmailSender trigger fully replaces Cognito's own sending, so
this function is responsible for *every* email the pool would emit. Any trigger
source we don't handle results in no email being sent — hence the catch-all
mapping below.
"""

import base64
import json
import os
from typing import Any, Dict, Optional, Tuple

import aws_encryption_sdk
import structlog
from aws_encryption_sdk import CommitmentPolicy
from botocore.session import Session

from prm import client as prm_client

logger = structlog.get_logger()

KMS_KEY_ARN = os.environ.get("KMS_KEY_ARN", "")
EMAIL_SENDER_LAMBDA_ARN = os.environ.get("EMAIL_SENDER_LAMBDA_ARN", "")
# numa-email-sender lives in the deployer account in us-east-1.
EMAIL_SENDER_REGION = os.environ.get("EMAIL_SENDER_REGION", "us-east-1")
# STS endpoint region for the cross-account proof. Must be one the email-sender
# validator allow-lists (us-east-1 or ap-southeast-2). us-east-1 works from any
# client region.
STS_REGION = os.environ.get("STS_REGION", "us-east-1")
DEFAULT_DOMAIN = os.environ.get("DEFAULT_DOMAIN", "app.numa.ai")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "unknown")
APP_NAME = os.environ.get("APP_NAME", "Numa")
REPLY_TO_EMAIL = os.environ.get("REPLY_TO_EMAIL", "")

# Module-level so the encryption client + KMS key provider are reused across
# warm invocations.
_esdk_client = aws_encryption_sdk.EncryptionSDKClient(
    commitment_policy=CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT
)
_key_provider = (
    aws_encryption_sdk.StrictAwsKmsMasterKeyProvider(key_ids=[KMS_KEY_ARN])
    if KMS_KEY_ARN
    else None
)

# Trigger sources whose code is a verification/OTP code that the user enters.
_VERIFY_CODE_TRIGGERS = {
    "CustomEmailSender_SignUp",
    "CustomEmailSender_ResendCode",
    "CustomEmailSender_VerifyUserAttribute",
    "CustomEmailSender_UpdateUserAttribute",
    "CustomEmailSender_Authentication",
}


def _decrypt_code(encrypted_code: Optional[str]) -> Optional[str]:
    """Decrypt the KMS-wrapped code Cognito provides. Returns None when absent
    (e.g. account-takeover notifications carry no code)."""
    if not encrypted_code:
        return None
    if _key_provider is None:
        raise RuntimeError("KMS_KEY_ARN is not configured")
    ciphertext = base64.b64decode(encrypted_code)
    plaintext, _header = _esdk_client.decrypt(
        source=ciphertext, key_provider=_key_provider
    )
    return plaintext.decode("utf-8")


def _select_template(
    trigger: str, client_metadata: Dict[str, str]
) -> Optional[Tuple[str, Dict[str, str]]]:
    """Map a Cognito trigger source to a numa-email-sender template name.

    Returns (template_name, extra_template_data) or None when no email should
    be sent for this trigger.
    """
    if trigger == "CustomEmailSender_ForgotPassword":
        # The frontend forwards clientMetadata.mode ("create" for new-user
        # activation, "reset" for password resets) on ForgotPassword. Cognito
        # passes clientMetadata through for this trigger source.
        mode = (client_metadata.get("mode") or "reset").lower()
        if mode == "create":
            return ("auth_create_password", {})
        return ("auth_reset_password", {})

    if trigger in _VERIFY_CODE_TRIGGERS:
        return ("auth_verify_code", {})

    if trigger == "CustomEmailSender_AdminCreateUser":
        # Our user-creation flow suppresses the Cognito invite (MessageAction
        # SUPPRESS) and drives activation through ForgotPassword(mode=create),
        # so this normally never fires. If it does, the code is a temporary
        # password — surface it via the generic verify-code template and warn.
        logger.warning(
            "Unexpected AdminCreateUser email trigger",
            _name="CUSTOM_EMAIL_SENDER_UNEXPECTED",
            trigger=trigger,
        )
        return ("auth_verify_code", {})

    # CustomEmailSender_AccountTakeOverNotification carries no code and has no
    # template (advanced security is AUDIT-only, so it shouldn't fire). Skip.
    logger.info("No template mapped for trigger; skipping", trigger=trigger)
    return None


def _generate_sts_proof_url(expires: int = 60) -> str:
    """Generate an STS presigned GetCallerIdentity URL proving this Lambda's
    role identity to the cross-account email-sender. The validator rejects
    X-Amz-Expires > 60s, so keep it at 60."""
    session = Session()
    sts_client = session.create_client("sts", region_name=STS_REGION)
    # generate_presigned_url exists on the STS client at runtime; boto3-stubs
    # only types it per-client, so pyright can't see it on the generic
    # botocore BaseClient (mirrors pipedream-relay's STS proof URL).
    return sts_client.generate_presigned_url(  # type: ignore
        "get_caller_identity", Params={}, ExpiresIn=expires, HttpMethod="GET"
    )


def _send_via_central_sender(
    email: str, template_name: str, template_data: Dict[str, str]
) -> None:
    """Invoke numa-email-sender (deployer account) to deliver the email."""
    if not EMAIL_SENDER_LAMBDA_ARN:
        raise RuntimeError("EMAIL_SENDER_LAMBDA_ARN is not configured")

    payload: Dict[str, Any] = {
        "to": [email],
        "template": template_name,
        "template_data": template_data,
        "client_name": CLIENT_NAME,
        "sts_proof_url": _generate_sts_proof_url(),
    }
    if REPLY_TO_EMAIL:
        payload["reply_to"] = [REPLY_TO_EMAIL]

    lambda_client = prm_client("lambda", region=EMAIL_SENDER_REGION)
    response = lambda_client.invoke(
        FunctionName=EMAIL_SENDER_LAMBDA_ARN,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )

    raw = response["Payload"].read()
    result = json.loads(raw or b"{}")
    body = result.get("body", {})
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except (json.JSONDecodeError, TypeError):
            body = {}

    if result.get("statusCode") != 200 or not body.get("success"):
        logger.error(
            "Central email send failed",
            _name="CUSTOM_EMAIL_SENDER_FAILED",
            template=template_name,
            status=result.get("statusCode"),
            error=body.get("error"),
        )
        raise RuntimeError(
            f"Email send failed: {body.get('error') or result.get('statusCode')}"
        )

    logger.info(
        "Email sent via central sender",
        _name="CUSTOM_EMAIL_SENDER_SENT",
        template=template_name,
        message_id=body.get("messageId"),
    )


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    trigger = event.get("triggerSource", "")
    request = event.get("request", {}) or {}
    user_attributes = request.get("userAttributes", {}) or {}
    client_metadata = request.get("clientMetadata") or {}
    email = user_attributes.get("email", "")

    logger.info(
        "CustomEmailSender invoked",
        _name="CUSTOM_EMAIL_SENDER",
        trigger=trigger,
        has_email=bool(email),
    )

    mapping = _select_template(trigger, client_metadata)
    if mapping is None:
        return event

    if not email:
        logger.error(
            "No recipient email on user attributes; cannot send",
            _name="CUSTOM_EMAIL_SENDER_NO_EMAIL",
            trigger=trigger,
        )
        return event

    code = _decrypt_code(request.get("code"))
    template_name, extra = mapping
    domain = client_metadata.get("domain") or DEFAULT_DOMAIN

    template_data: Dict[str, str] = {
        "code": code or "",
        "email": email,
        "domain": domain,
        "app_name": APP_NAME,
        "logo_url": f"https://{domain}/numa-logo-email.png",
    }
    template_data.update(extra)

    _send_via_central_sender(email, template_name, template_data)
    return event
