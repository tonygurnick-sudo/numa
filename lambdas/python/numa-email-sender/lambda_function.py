"""
Centralized email sender Lambda for Numa.

Deployed in the deployer account (207567759910). Accepts cross-account invocations
from client-account Lambdas, validates caller identity via STS proof URL, renders
Jinja2 email templates, and sends via SES.

Invocation payload:
{
    "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
    "client_name": "nd-labs",
    "to": ["user@example.com"],
    "template": "schedule_completed",
    "template_data": {"schedule_name": "Daily Report", "summary": "..."},
    "cc": [],         # optional
    "reply_to": []    # optional
}
"""

import os
import re
from typing import Any, Dict, List, Optional

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

from email_templates import EMAIL_TEMPLATES, render_template
from prm import client as prm_client
from security_validator import EmailSecurityValidator, SecurityValidationError

logger = structlog.get_logger()

# Lazy-initialized validator (created on first invocation)
_validator: Optional[EmailSecurityValidator] = None

MAX_RECIPIENTS = 50
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

VALID_TEMPLATES = set(EMAIL_TEMPLATES.keys())


def _get_validator() -> EmailSecurityValidator:
    global _validator
    if _validator is None:
        _validator = EmailSecurityValidator()
    return _validator


def _validate_email(email: str) -> bool:
    return bool(EMAIL_REGEX.match(email))


def _validate_inputs(event: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and extract inputs from the invocation payload."""
    errors: List[str] = []

    sts_proof_url = event.get("sts_proof_url")
    if not sts_proof_url or not isinstance(sts_proof_url, str):
        errors.append("sts_proof_url is required")

    to_addresses = event.get("to", [])
    if not to_addresses or not isinstance(to_addresses, list):
        errors.append("to must be a non-empty list of email addresses")
    elif len(to_addresses) > MAX_RECIPIENTS:
        errors.append(f"Maximum {MAX_RECIPIENTS} recipients per request")
    else:
        for addr in to_addresses:
            if not _validate_email(addr):
                errors.append(f"Invalid email address: {addr}")

    template = event.get("template")
    if not template or template not in VALID_TEMPLATES:
        errors.append(f"template must be one of: {', '.join(sorted(VALID_TEMPLATES))}")

    template_data = event.get("template_data", {})
    if not isinstance(template_data, dict):
        errors.append("template_data must be a dictionary")

    cc = event.get("cc", [])
    if cc:
        for addr in cc:
            if not _validate_email(addr):
                errors.append(f"Invalid CC email address: {addr}")

    reply_to = event.get("reply_to", [])
    if reply_to:
        for addr in reply_to:
            if not _validate_email(addr):
                errors.append(f"Invalid reply_to email address: {addr}")

    if errors:
        raise ValueError("; ".join(errors))

    return {
        "sts_proof_url": sts_proof_url,
        "to": to_addresses,
        "template": template,
        "template_data": template_data,
        "client_name": event.get("client_name", "unknown"),
        "cc": cc,
        "reply_to": reply_to,
    }


def _send_email(
    to_addresses: List[str],
    subject: str,
    body_html: str,
    body_text: str,
    cc_addresses: Optional[List[str]] = None,
    reply_to_addresses: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Send an email via SES."""
    ses = prm_client("ses")

    from_address = os.environ.get("SES_FROM_ADDRESS", "")
    config_set = os.environ.get("SES_CONFIGURATION_SET", "")

    params: Dict[str, Any] = {
        "Source": from_address,
        "Destination": {"ToAddresses": to_addresses},
        "Message": {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {},
        },
    }

    if body_html:
        params["Message"]["Body"]["Html"] = {"Data": body_html, "Charset": "UTF-8"}
    if body_text:
        params["Message"]["Body"]["Text"] = {"Data": body_text, "Charset": "UTF-8"}

    if cc_addresses:
        params["Destination"]["CcAddresses"] = cc_addresses
    if reply_to_addresses:
        params["ReplyToAddresses"] = reply_to_addresses
    if config_set:
        params["ConfigurationSetName"] = config_set

    response = ses.send_email(**params)
    return {"messageId": response["MessageId"]}


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """Lambda handler for the centralized email sender."""
    structlog.contextvars.bind_contextvars(
        function_name=context.function_name,
        _name="EMAIL_SENDER",
    )

    try:
        inputs = _validate_inputs(event)
    except ValueError as e:
        logger.warning("Input validation failed", error=str(e))
        return {
            "statusCode": 400,
            "body": {"success": False, "error": str(e)},
        }

    structlog.contextvars.bind_contextvars(
        client_name=inputs["client_name"],
        template=inputs["template"],
        recipient_count=len(inputs["to"]),
    )

    # Security validation
    try:
        validator = _get_validator()
        validation = validator.validate_request(inputs["sts_proof_url"])
        structlog.contextvars.bind_contextvars(
            caller_account=validation["caller_account_id"],
        )
    except SecurityValidationError as e:
        logger.warning("Security validation failed", error=str(e))
        return {
            "statusCode": 403,
            "body": {"success": False, "error": "Access denied"},
        }

    # Render template
    ses_domain = os.environ.get("SES_DOMAIN", "notifications.numa.arcanum.ai")
    # Use the main domain for the logo (not the notifications subdomain)
    logo_domain = ses_domain.replace("notifications.", "")

    rendered = render_template(
        inputs["template"],
        inputs["template_data"],
        domain=logo_domain,
    )

    if not rendered:
        logger.error("Template rendering failed", template=inputs["template"])
        return {
            "statusCode": 500,
            "body": {"success": False, "error": "Template rendering failed"},
        }

    # Send email
    try:
        result = _send_email(
            to_addresses=inputs["to"],
            subject=rendered["subject"],
            body_html=rendered["html"],
            body_text=rendered["text"],
            cc_addresses=inputs["cc"] or None,
            reply_to_addresses=inputs["reply_to"] or None,
        )

        logger.info(
            "Email sent successfully",
            message_id=result["messageId"],
            template=inputs["template"],
            recipient_count=len(inputs["to"]),
        )

        return {
            "statusCode": 200,
            "body": {"success": True, "messageId": result["messageId"]},
        }

    except ClientError as e:
        error_msg = e.response.get("Error", {}).get("Message", str(e))
        logger.error("SES send failed", error=error_msg)
        return {
            "statusCode": 500,
            "body": {"success": False, "error": f"Email send failed: {error_msg}"},
        }
    except Exception as e:
        logger.exception("Unexpected error sending email")
        return {
            "statusCode": 500,
            "body": {"success": False, "error": "Internal error"},
        }
