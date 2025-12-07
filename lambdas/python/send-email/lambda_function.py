import json
import os
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional, Union

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError

import helpers
import s3_helpers
from prm import client as prm_client

logger = structlog.get_logger()


def process_s3_attachment(message: MIMEMultipart, attachment: Dict[str, Any]) -> None:
    """Process an S3 attachment and add it to the MIME message.

    Args:
        message: The MIME message to attach to
        attachment: Dictionary with bucket, key, and optional filename
    """
    bucket = attachment.get("bucket")
    key = attachment.get("key")

    if not bucket or not key:
        logger.warning("Skipping attachment with missing bucket or key")
        return

    filename = attachment.get("filename", key.split("/")[-1] if key else "attachment")

    # Get the file content
    file_content = s3_helpers.read(key)

    # Add attachment
    part = MIMEApplication(file_content)
    part.add_header("Content-Disposition", "attachment", filename=filename)
    message.attach(part)


def process_direct_content_attachment(
    message: MIMEMultipart, attachment: Dict[str, Any]
) -> None:
    """Process a direct content attachment and add it to the MIME message.

    Args:
        message: The MIME message to attach to
        attachment: Dictionary with content, filename, and optional content_type
    """
    content = attachment.get("content")
    filename = attachment.get("filename")
    content_type = attachment.get("content_type", "application/octet-stream")

    # Create the appropriate MIME part based on content type
    part: Union[MIMEText, MIMEApplication]
    if content_type.startswith("text/"):
        part = create_text_mime_part(content, content_type)
    else:
        part = create_binary_mime_part(content)

    part.add_header("Content-Disposition", "attachment", filename=filename)
    message.attach(part)


def create_text_mime_part(content: Any, content_type: str) -> MIMEText:
    """Create a MIMEText part for text content.

    Args:
        content: The text content (str or bytes)
        content_type: The MIME content type

    Returns:
        A MIMEText part with the content
    """
    if isinstance(content, str):
        return MIMEText(content, content_type.split("/")[1], "utf-8")

    # If it's bytes or None, convert appropriately
    if content is None:
        content = b""
    return MIMEText(content.decode("utf-8"), content_type.split("/")[1], "utf-8")


def create_binary_mime_part(content: Any) -> MIMEApplication:
    """Create a MIMEApplication part for binary content.

    Args:
        content: The binary content (str, bytes, or None)

    Returns:
        A MIMEApplication part with the content
    """
    if isinstance(content, str):
        return MIMEApplication(content.encode("utf-8"))

    # If bytes or None
    content_bytes = b"" if content is None else content
    return MIMEApplication(content_bytes)


def process_attachments(
    message: MIMEMultipart, attachments: List[Dict[str, Any]]
) -> None:
    """Process all attachments and add them to the MIME message.

    Args:
        message: The MIME message to attach to
        attachments: List of attachment dictionaries
    """
    for attachment in attachments:
        try:
            # Check attachment type and process accordingly
            if "bucket" in attachment and "key" in attachment:
                process_s3_attachment(message, attachment)
            elif "content" in attachment and "filename" in attachment:
                process_direct_content_attachment(message, attachment)
            else:
                logger.warning("Skipping attachment with invalid format")
        except Exception:
            logger.exception("Error processing attachment")


def prepare_mime_message(
    to_addresses: List[str],
    subject: str,
    body_html: Optional[str] = None,
    body_text: Optional[str] = None,
    from_address: Optional[str] = None,
    cc_addresses: Optional[List[str]] = None,
    reply_to_addresses: Optional[List[str]] = None,
    attachments: Optional[List[Dict[str, str]]] = None,
) -> MIMEMultipart:
    """Create a MIME message for email with optional attachments

    Args:
        to_addresses: List of recipient email addresses
        subject: Email subject line
        body_html: HTML content for the email body
        body_text: Plain text content for the email body
        from_address: Sender email address
        cc_addresses: List of CC recipient email addresses
        bcc_addresses: List of BCC recipient email addresses
        reply_to_addresses: List of reply-to email addresses
        attachments: List of attachments with either:
                     - S3 location (bucket, key, filename)
                     - Direct content (content_type, filename, content)

    Returns:
        MIMEMultipart message object
    """
    # Create multipart message
    message = MIMEMultipart("mixed")

    # Set headers
    message["Subject"] = subject
    if from_address:
        message["From"] = from_address
    message["To"] = ", ".join(to_addresses)

    if cc_addresses:
        message["Cc"] = ", ".join(cc_addresses)

    if reply_to_addresses:
        message["Reply-To"] = ", ".join(reply_to_addresses)

    # Create a multipart/alternative part for the email body
    msg_body = MIMEMultipart("alternative")

    # Always include at least one body part
    if body_text:
        msg_body.attach(MIMEText(body_text, "plain", "utf-8"))

    if body_html:
        msg_body.attach(MIMEText(body_html, "html", "utf-8"))
    elif not body_text:
        # If neither body_text nor body_html are provided, add an empty text part
        msg_body.attach(MIMEText("", "plain", "utf-8"))

    message.attach(msg_body)

    # Process attachments if provided
    if attachments:
        process_attachments(message, attachments)

    return message


def send_raw_email(
    to_addresses: List[str],
    message: Union[MIMEMultipart, str],
    from_address: str,
    cc_addresses: Optional[List[str]] = None,
    bcc_addresses: Optional[List[str]] = None,
    configuration_set: Optional[str] = None,
) -> Dict[str, Any]:
    """Send a raw email using Amazon SES

    Args:
        to_addresses: List of recipient email addresses
        message: MIMEMultipart message or raw message string
        from_address: Sender email address
        cc_addresses: List of CC recipient email addresses
        bcc_addresses: List of BCC recipient email addresses
        configuration_set: SES configuration set name

    Returns:
        Dictionary with information about the sent message
    """
    ses_client = prm_client("ses")

    # Convert message to string if it's a MIMEMultipart
    if isinstance(message, MIMEMultipart):
        raw_message = message.as_string()
    else:
        raw_message = message

    # Combine all recipients for the destination
    all_recipients = to_addresses.copy()
    if cc_addresses:
        all_recipients.extend(cc_addresses)
    if bcc_addresses:
        all_recipients.extend(bcc_addresses)

    # Prepare parameters for SES
    params = {
        "Source": from_address,
        "Destinations": all_recipients,
        "RawMessage": {"Data": raw_message},
    }

    # Add configuration set if provided
    if configuration_set:
        params["ConfigurationSetName"] = configuration_set

    # Send the email
    try:
        response = ses_client.send_raw_email(**params)

        return {
            "status": "sent",
            "messageId": response["MessageId"],
            "recipients": {
                "to": to_addresses,
                "cc": cc_addresses or [],
                "bcc": bcc_addresses or [],
            },
        }

    except ClientError as e:
        error_message = e.response.get("Error", {}).get("Message", str(e))
        logger.exception("Failed to send raw email", error=error_message)
        return {
            "statusCode": 400,
            "body": {"status": "error", "error": error_message},
        }

    except Exception as e:
        logger.exception("Unexpected error sending email")
        return {"status": "error", "error": str(e)}


def send_simple_email(
    to_addresses: List[str],
    subject: str,
    body_html: Optional[str] = None,
    body_text: Optional[str] = None,
    from_address: Optional[str] = None,
    cc_addresses: Optional[List[str]] = None,
    bcc_addresses: Optional[List[str]] = None,
    reply_to_addresses: Optional[List[str]] = None,
    configuration_set: Optional[str] = None,
) -> Dict[str, Any]:
    """Send a simple email using Amazon SES

    Args:
        to_addresses: List of recipient email addresses
        subject: Email subject line
        body_html: HTML content for the email body
        body_text: Plain text content for the email body
        from_address: Sender email address
        cc_addresses: List of CC recipient email addresses
        bcc_addresses: List of BCC recipient email addresses
        reply_to_addresses: List of reply-to email addresses
        configuration_set: SES configuration set name

    Returns:
        Dictionary with information about the sent message
    """
    ses_client = prm_client("ses")

    # Check required sender address
    if not from_address:
        return {
            "status": "error",
            "error": "No sender email address provided. 'from' field is required",
        }

    # Create message content
    message: Dict[str, Any] = {
        "Subject": {"Data": subject, "Charset": "UTF-8"},
        "Body": {},
    }

    # Add text body if provided
    if body_text:
        message["Body"]["Text"] = {"Data": body_text, "Charset": "UTF-8"}

    # Add HTML body if provided
    if body_html:
        message["Body"]["Html"] = {"Data": body_html, "Charset": "UTF-8"}

    destination: Dict[str, List[str]] = {"ToAddresses": to_addresses}

    # Prepare parameters for SES
    params: Dict[str, Any] = {
        "Source": from_address,
        "Destination": destination,
        "Message": message,
    }

    # Add CC recipients if provided
    if cc_addresses:
        params["Destination"]["CcAddresses"] = cc_addresses

    # Add BCC recipients if provided
    if bcc_addresses:
        params["Destination"]["BccAddresses"] = bcc_addresses

    # Add reply-to addresses if provided
    if reply_to_addresses:
        params["ReplyToAddresses"] = reply_to_addresses

    # Add configuration set if provided
    if configuration_set:
        params["ConfigurationSetName"] = configuration_set

    # Send the email
    try:
        response = ses_client.send_email(**params)

        return {
            "status": "sent",
            "messageId": response["MessageId"],
            "recipients": {
                "to": to_addresses,
                "cc": cc_addresses or [],
                "bcc": bcc_addresses or [],
            },
        }

    except ClientError as e:
        error_message = e.response.get("Error", {}).get("Message", str(e))
        logger.exception("Failed to send simple email", error=error_message)
        return {
            "statusCode": 400,
            "body": {"status": "error", "error": error_message},
        }

    except Exception as e:
        logger.exception("Unexpected error sending email")
        return {"status": "error", "error": str(e)}


def load_email_data_from_s3(s3_key: str) -> Dict[str, Any]:
    """Load email data from an S3 object

    Args:
        s3_key: S3 key where the email data is stored as JSON

    Returns:
        Dictionary with email parameters loaded from S3
    """
    try:
        logger.info("Loading email data from S3", s3_key=s3_key)

        # Read the email data from S3
        email_data_bytes = s3_helpers.read(s3_key)
        email_data = json.loads(email_data_bytes.decode("utf-8"))

        logger.info("Successfully loaded email data from S3", s3_key=s3_key)
        return email_data

    except Exception as exc:
        logger.exception("Failed to load email data from S3", s3_key=s3_key)
        raise Exception("Failed to load email data from S3") from exc


def handler(event: dict, context: LambdaContext) -> Dict[str, Any]:
    """Lambda handler for sending emails via SES

    Supported event formats:
    1. Simple email:
    {
        "to": ["recipient@example.com"],
        "subject": "Email Subject",
        "body_html": "<p>HTML body</p>",
        "body_text": "Plain text body",
        "from": "sender@example.com",  # Required
        "cc": ["cc@example.com"],  # Optional
        "bcc": ["bcc@example.com"],  # Optional
        "reply_to": ["reply@example.com"],  # Optional
        "configuration_set": "ses-config-set"  # Optional
    }

    2. Email with attachments:
    {
        "to": ["recipient@example.com"],
        "subject": "Email Subject",
        "body_html": "<p>HTML body</p>",
        "body_text": "Plain text body",
        "from": "sender@example.com",  # Required
        "cc": ["cc@example.com"],  # Optional
        "bcc": ["bcc@example.com"],  # Optional
        "reply_to": ["reply@example.com"],  # Optional
        "configuration_set": "ses-config-set",  # Optional
        "attachments": [
            {
                "bucket": "my-bucket",
                "key": "path/to/attachment.pdf",
                "filename": "report.pdf"  # Optional, defaults to the file name in the key
            }
        ]
    }

    3. Email with S3 key reference:
    {
        "email_data_s3_key": "path/to/email/data.json"  # S3 key containing complete email configuration
    }

    Args:
        event: Lambda event with email parameters
        context: Lambda context

    Returns:
        Dictionary with results of the email sending operation
    """
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        # Check if email data should be loaded from S3
        email_data_s3_key = event.get("email_data_s3_key")

        if email_data_s3_key:
            logger.info(
                "Email data S3 key provided, loading from S3", s3_key=email_data_s3_key
            )
            # Load the email configuration from S3
            email_params = load_email_data_from_s3(email_data_s3_key)
            # Use the loaded parameters as our event
            event = email_params

        # Extract parameters from the event
        to_addresses = event.get("to")
        if not to_addresses:
            return {
                "statusCode": 400,
                "body": {
                    "status": "error",
                    "error": "No recipient email addresses provided",
                },
            }

        subject = event.get("subject")
        if not subject:
            return {
                "statusCode": 400,
                "body": {"status": "error", "error": "No email subject provided"},
            }

        # Get body content
        body_html = event.get("body_html")
        body_text = event.get("body_text")

        if not body_html and not body_text:
            return {
                "statusCode": 400,
                "body": {
                    "status": "error",
                    "error": "No email body content provided (either body_html or body_text is required)",
                },
            }

        # Get the required sender email
        from_address = event.get("from")
        if not from_address:
            return {
                "statusCode": 400,
                "body": {
                    "status": "error",
                    "error": "No sender email address provided. 'from' field is required",
                },
            }

        cc_addresses = event.get("cc")
        bcc_addresses = event.get("bcc")
        reply_to_addresses = event.get("reply_to")

        # Use the configuration set from environment variables if not provided in the event
        configuration_set = event.get("configuration_set")
        if not configuration_set:
            configuration_set = os.environ.get("SES_CONFIGURATION_SET")
            if configuration_set:
                logger.info(
                    "Using configuration set from environment",
                    configuration_set=configuration_set,
                )
            else:
                logger.warning(
                    "No configuration set specified in event or environment variables"
                )

        attachments = event.get("attachments")

        # Log the email request
        logger.info(
            "Processing email request",
            to=to_addresses,
            subject=subject,
            has_html=bool(body_html),
            has_text=bool(body_text),
            has_attachments=bool(attachments),
            s3_source=bool(email_data_s3_key),
        )

        # Determine whether to use send_raw_email (for attachments) or send_simple_email
        result = None
        if attachments:
            # Create MIME message with attachments
            message = prepare_mime_message(
                to_addresses=to_addresses,
                subject=subject,
                body_html=body_html,
                body_text=body_text,
                from_address=from_address,
                cc_addresses=cc_addresses,
                reply_to_addresses=reply_to_addresses,
                attachments=attachments,
            )

            # Send the raw email with attachments
            result = send_raw_email(
                to_addresses=to_addresses,
                message=message,
                from_address=from_address,
                cc_addresses=cc_addresses,
                bcc_addresses=bcc_addresses,
                configuration_set=configuration_set,
            )

        else:
            # Send a simple email without attachments
            result = send_simple_email(
                to_addresses=to_addresses,
                subject=subject,
                body_html=body_html,
                body_text=body_text,
                from_address=from_address,
                cc_addresses=cc_addresses,
                bcc_addresses=bcc_addresses,
                reply_to_addresses=reply_to_addresses,
                configuration_set=configuration_set,
            )

        # Return the result
        status_code = 200 if result.get("status") == "sent" else 400
        response = {"statusCode": status_code, "body": result}

        # Include the S3 source key if it was provided
        if email_data_s3_key:
            response["email_data_s3_key"] = email_data_s3_key

        return response

    except Exception as e:
        logger.exception("Unexpected error in email lambda")
        return {
            "statusCode": 500,
            "body": {"status": "error", "error": f"Unexpected error: {str(e)}"},
        }
