import datetime
import json
import os
import re
import urllib.parse
import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import email_html
import helpers
import report_html
import s3_helpers
import timezone_utils
from prm import client as prm_client
from prompts import ERROR_SUMMARY_PROMPT
from tools import ERROR_SUMMARY_TOOLS

logger = structlog.get_logger()

# Maximum allowed characters for log message fields to prevent token limit issues
MAX_MESSAGE_LENGTH = 2000
MAX_TASK_DESCRIPTION_LENGTH = 1000
# Maximum number of logs to include in summary generation
MAX_RESULTS_FOR_SUMMARY = 200
# Bedrock model configuration
MODEL_CONFIG = {
    "tools": ERROR_SUMMARY_TOOLS,
    "tool_choice": {"type": "tool", "name": "generate_structured_summary"},
    "max_tokens": 16000,
    "temperature": 0.1,
}


def truncate_log_entry(log_entry: Dict[str, Any]) -> Dict[str, Any]:
    """Truncate long text fields in log entries to prevent exceeding token limits

    Args:
        log_entry: The original log entry dictionary

    Returns:
        The log entry with truncated text fields
    """
    truncated_entry = log_entry.copy()

    # Truncate the Message field if it exists and is too long
    if "Message" in truncated_entry and isinstance(truncated_entry["Message"], str):
        message = truncated_entry["Message"]
        if len(message) > MAX_MESSAGE_LENGTH:
            truncated_entry["Message"] = (
                message[:MAX_MESSAGE_LENGTH] + "... [TRUNCATED]"
            )
            logger.debug(
                "Truncated log message",
                original_length=len(message),
                truncated_length=len(truncated_entry["Message"]),
            )

    # Truncate the TaskDescription field if it exists and is too long
    if "TaskDescription" in truncated_entry and isinstance(
        truncated_entry["TaskDescription"], str
    ):
        task_desc = truncated_entry["TaskDescription"]
        if len(task_desc) > MAX_TASK_DESCRIPTION_LENGTH:
            truncated_entry["TaskDescription"] = (
                task_desc[:MAX_TASK_DESCRIPTION_LENGTH] + "... [TRUNCATED]"
            )
            logger.debug(
                "Truncated task description",
                original_length=len(task_desc),
                truncated_length=len(truncated_entry["TaskDescription"]),
            )

    return truncated_entry


def load_analyzed_logs(
    date_str: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], datetime.datetime, datetime.datetime]:
    """Load pre-analyzed error logs from S3 bucket for the specified date

    Args:
        date_str: Date string in 'YYYY-MM-DD' format. If None, uses current date.

    Returns:
        Tuple containing:
        - List of analyzed error log dictionaries
        - Start time (calculated from logs)
        - End time (calculated from logs)
    """
    # Use current date if not specified
    if not date_str:
        date_str = timezone_utils.format_nz_date(timezone_utils.get_current_nz_time())

    logger.info("Loading analyzed logs", date=date_str)

    # List all analyzed log files in the folder
    logs_prefix = f"beyond-expectations/logs_analysed/{date_str}/"
    objects = s3_helpers.list_objects(logs_prefix)
    all_analyzed_logs = []

    # Keep track of earliest and latest timestamps for start/end times
    earliest_timestamp = None
    latest_timestamp = None

    # pylint: disable=too-many-nested-blocks
    for obj in objects:
        try:
            # Skip if directory
            if obj.endswith("/"):
                continue

            # Get the file content
            log_data_bytes = s3_helpers.read(obj)
            log_data = json.loads(log_data_bytes.decode("utf-8"))

            # Add to our collection
            all_analyzed_logs.append(log_data)

            logger.info("Loaded analyzed log file", key=obj)

            # Update timestamps from the logs
            for notification in log_data.get(
                "notifications_required", []
            ) + log_data.get("notifications_not_required", []):
                log_entry = notification.get("log_entry", {})
                timestamp_str = log_entry.get("DateTimeUtc")

                if timestamp_str:
                    try:
                        # Parse timestamp
                        timestamp = datetime.datetime.fromisoformat(
                            timestamp_str.replace("Z", "+00:00")
                        )

                        # Update earliest/latest
                        if earliest_timestamp is None or timestamp < earliest_timestamp:
                            earliest_timestamp = timestamp
                        if latest_timestamp is None or timestamp > latest_timestamp:
                            latest_timestamp = timestamp
                    except (ValueError, TypeError):
                        # Skip invalid timestamps
                        continue

        except (ValueError, json.JSONDecodeError):
            logger.exception(f"Error processing key {obj}")
            continue

    logger.info("Loaded analyzed logs", file_count=len(all_analyzed_logs))

    # Set default time range if no timestamps were found
    if earliest_timestamp is None:
        current_utc = datetime.datetime.utcnow()
        earliest_timestamp = current_utc - datetime.timedelta(hours=24)
    if latest_timestamp is None:
        latest_timestamp = datetime.datetime.utcnow()

    return all_analyzed_logs, earliest_timestamp, latest_timestamp


def aggregate_analyzed_logs(analyzed_logs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate multiple analyzed log files into a single structure

    Args:
        analyzed_logs: List of analyzed log dictionaries

    Returns:
        Dictionary with combined analysis results
    """
    # Initialize the aggregated structure
    aggregated_results: Dict[str, Any] = {
        "notifications_required": [],
        "notifications_not_required": [],
        "error_categories": {},
        "all_results": [],
    }

    if not analyzed_logs:
        logger.info("No analyzed logs found for aggregation")
        return {
            "summary": "No error logs found in the analyzed time period.",
            "summary_sections": {
                "summary": "No error logs found in the analyzed time period.",
                "trends_and_patterns": "N/A",
                "critical_issues": "N/A",
                "business_impact": "N/A",
                "recommendations": "N/A",
            },
            "notifications_required": [],
            "notifications_not_required": [],
            "error_categories": {},
            "all_results": [],
        }

    # Combine the logs
    for log_file in analyzed_logs:
        # Combine notifications_required
        aggregated_results["notifications_required"].extend(
            log_file.get("notifications_required", [])
        )

        # Combine notifications_not_required
        aggregated_results["notifications_not_required"].extend(
            log_file.get("notifications_not_required", [])
        )

        # Combine all_results
        aggregated_results["all_results"].extend(log_file.get("all_results", []))

        # Combine error_categories (merging counts)
        for error_type, count in log_file.get("error_categories", {}).items():
            if error_type not in aggregated_results["error_categories"]:
                aggregated_results["error_categories"][error_type] = 0
            aggregated_results["error_categories"][error_type] += count

    # Sort error categories by count (descending)
    aggregated_results["error_categories"] = dict(
        sorted(
            aggregated_results["error_categories"].items(),
            key=lambda x: x[1],
            reverse=True,
        )
    )

    logger.info(
        "Aggregated analyzed logs",
        notifications_required_count=len(aggregated_results["notifications_required"]),
        notifications_not_required_count=len(
            aggregated_results["notifications_not_required"]
        ),
        all_results_count=len(aggregated_results["all_results"]),
        error_categories_count=len(aggregated_results["error_categories"]),
    )

    return aggregated_results


def generate_summary_with_bedrock(aggregated_results: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a summary of the aggregated analysis results using Bedrock

    Args:
        aggregated_results: Dictionary with combined analysis results

    Returns:
        Dictionary with analysis results including summary
    """
    # Create Bedrock client for summary generation
    summary_model = bedrock.BedrockClaude3Model(
        model_args=MODEL_CONFIG,
        claude_only=True,
    )

    # Filter out recurring logs before summary generation
    all_results = aggregated_results.get("all_results", [])
    new_logs_only = [
        result for result in all_results if not result.get("recurring", False)
    ]

    # Log counts for monitoring
    total_logs = len(all_results)
    new_logs_count = len(new_logs_only)
    recurring_logs_count = total_logs - new_logs_count

    logger.info(
        "Filtering logs for summary analysis",
        total_logs=total_logs,
        new_logs_count=new_logs_count,
        recurring_logs_count=recurring_logs_count,
    )

    # If we have no new logs, but have recurring logs, include a note about this
    if new_logs_count == 0 and recurring_logs_count > 0:
        logger.info("No new logs found for summary, only recurring issues")
        # Create a simplified summary noting that only recurring issues were found
        aggregated_results["summary"] = (
            "No new error logs found in the analyzed time period. Only recurring issues detected."
        )
        aggregated_results["summary_sections"] = {
            "summary": "No new error logs found in the analyzed time period. Only recurring issues detected.",
            "trends_and_patterns": "All issues detected are recurring issues that have been previously analyzed.",
            "critical_issues": "No new critical issues identified.",
            "business_impact": "Impact is limited to previously identified recurring issues.",
            "recommendations": "Continue monitoring recurring issues to ensure they don't worsen.",
        }
        return aggregated_results

    # If we have no logs at all, return early
    if new_logs_count == 0 and recurring_logs_count == 0:
        logger.info("No logs found for summary")
        aggregated_results["summary"] = (
            "No error logs found in the analyzed time period."
        )
        aggregated_results["summary_sections"] = {
            "summary": "No error logs found in the analyzed time period.",
            "trends_and_patterns": "N/A",
            "critical_issues": "N/A",
            "business_impact": "N/A",
            "recommendations": "N/A",
        }
        return aggregated_results

    # Ensure the input to the summary model isn't too large
    # Limit the number of results if there are too many
    max_results = min(new_logs_count, MAX_RESULTS_FOR_SUMMARY)

    # Create a streamlined version of the results with only essential information
    streamlined_results = []
    for result in new_logs_only[:max_results]:
        # Extract the full log entry
        full_log_entry = result.get("log_entry", {})

        # Create a simplified log entry with only essential fields
        simplified_log_entry = create_simplified_log_entry(full_log_entry)

        # Create a streamlined result with all top-level fields but simplified log_entry
        streamlined_result = {
            "error_type": result.get("error_type", "Unknown Error"),
            "severity": result.get("severity", "Medium"),
            "internal_notification": result.get("internal_notification", "No"),
            "client_notification": result.get("client_notification", "No"),
            "recommended_action": result.get("recommended_action", ""),
            "explanation": result.get("explanation", ""),
            "log_entry": simplified_log_entry,
            "previous_analysis_date": result.get("previous_analysis_date", ""),
        }

        streamlined_results.append(streamlined_result)

    if new_logs_count > MAX_RESULTS_FOR_SUMMARY:
        logger.info(
            f"Limiting summary input to {MAX_RESULTS_FOR_SUMMARY} new logs out of {new_logs_count} total new logs"
        )

    summary_prompt = ERROR_SUMMARY_PROMPT.format(
        log_count=new_logs_count,
        log_entry_results=json.dumps(streamlined_results, indent=2),
    )

    # Get structured summary with sections
    summary_response = summary_model.run(
        query=summary_prompt, name_for_logging="error_summary_analysis"
    )

    # Extract the structured summary from the tool response
    summary_sections = summary_response.response[0]["input"]

    # Process each section to fix formatting issues:
    # 1. Trim whitespace from each section
    # 2. Fix excessive line spacing by normalizing HTML
    for key in summary_sections:
        if isinstance(summary_sections[key], str):
            summary_sections[key] = clean_html_content(summary_sections[key])

    # If we have recurring logs, add a note to the summary sections
    if recurring_logs_count > 0:
        # Add information about recurring issues to the summary
        recurring_note = f'<p style="margin-bottom: 10px; line-height: 1.4;">Additionally, {recurring_logs_count} recurring issues were detected but not included in this summary analysis.</p>'

        # Append the note to each relevant section
        summary_sections["summary"] = (
            summary_sections.get("summary", "") + recurring_note
        )

        # Add a note to the recommendations section if it exists
        if "recommendations" in summary_sections:
            recurring_recommendation = f'<p style="margin-bottom: 10px; line-height: 1.4;">Continue monitoring the {recurring_logs_count} recurring issues to ensure they are properly addressed.</p>'
            summary_sections["recommendations"] = (
                summary_sections.get("recommendations", "") + recurring_recommendation
            )

    # For backward compatibility, join all sections for the legacy summary field
    combined_summary = "\n\n".join(
        [
            summary_sections.get("summary", ""),
            "## Trends and Patterns\n"
            + summary_sections.get("trends_and_patterns", ""),
            "## Critical Issues\n" + summary_sections.get("critical_issues", ""),
            "## Business Impact\n" + summary_sections.get("business_impact", ""),
            "## Recommendations\n" + summary_sections.get("recommendations", ""),
        ]
    )

    # Update the aggregated results with the summary
    aggregated_results["summary"] = combined_summary
    aggregated_results["summary_sections"] = summary_sections

    return aggregated_results


def generate_mail_to_links(notifications: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate mail-to links for client notification

    Args:
        notifications: List of notifications requiring client attention

    Returns:
        List of mail-to link data for each notification
    """
    mail_to_links = []

    for notification in notifications:
        if notification.get("client_notification") == "Yes":
            # Extract relevant data
            error_type = notification.get("error_type", "Unknown Error")
            severity = notification.get("severity", "Medium")
            explanation = notification.get("explanation", "No explanation available")
            action = notification.get("recommended_action", "Please review the error")

            # Create email subject and body
            subject = f"API Integration Alert: {error_type} ({severity})"
            body = f"""
Hello,

We've detected an issue with your API integration that requires your attention:

Error Type: {error_type}
Severity: {severity}

Description: {explanation}

Recommended Action: {action}

Please contact our support team if you need assistance resolving this issue.

Best regards,
The Beyond Expectations Team
            """

            # Create mailto link (url-encoded)
            mail_to = f"mailto:?subject={urllib.parse.quote(subject)}&body={urllib.parse.quote(body)}"

            mail_to_links.append(
                {"error_type": error_type, "severity": severity, "mail_to": mail_to}
            )

    return mail_to_links


def save_report_to_s3(
    bucket: str,
    analysis_result: Dict[str, Any],
    mail_to_links: List[Dict[str, Any]],
    start_time: datetime.datetime,
    end_time: datetime.datetime,
) -> Dict[str, Any]:
    """Save analysis report (HTML + JSON) to S3 and return info."""

    # ── 1. human-readable period strings ──────────────────────────────
    start_time_str = timezone_utils.format_nz_datetime(start_time)
    end_time_str = timezone_utils.format_nz_datetime(end_time)

    # ── 2. unique timestamp for filenames ─────────────────────────────
    unique_id = str(uuid.uuid4())[:8]
    current_nz_time = timezone_utils.get_current_nz_time()
    report_time = current_nz_time.strftime("%Y-%m-%d-%H-%M-%S-%f") + f"-{unique_id}"

    # ── 3. build the 2-level notification structure ──────────────────
    notif_sets: Dict[str, Dict[str, List[Dict[str, Any]]]] = {
        "new": {"both": [], "client_only": [], "internal": [], "none": []},
        "recurring": {"both": [], "client_only": [], "internal": [], "none": []},
    }

    # helper to decide which leaf list to append to
    def bucket_for(n: Dict[str, Any]) -> List[Dict[str, Any]]:
        top = "recurring" if n.get("recurring") else "new"
        client_yes = n.get("client_notification") == "Yes"
        internal_yes = n.get("internal_notification") == "Yes"
        if client_yes and internal_yes:
            leaf = "both"
        elif client_yes:
            leaf = "client_only"
        elif internal_yes:
            leaf = "internal"
        else:
            leaf = "none"
        return notif_sets[top][leaf]

    # notifications that *do* require action
    for n in analysis_result.get("notifications_required", []):
        bucket_for(n).append(n)

    # notifications that require none
    for n in analysis_result.get("notifications_not_required", []):
        bucket_for(n).append(n)

    # ── 4. generate HTML for both reports using updated report_html module ────────
    report_html_dict = report_html.generate_report_html(
        start_time_str,
        end_time_str,
        analysis_result,
        notif_sets,
        mail_to_links,
    )

    summary_html_content = report_html_dict["summary"]
    notifications_html_content = report_html_dict["notifications"]

    # ── 5. S3 locations ───────────────────────────────────────────────
    summary_report_key = (
        f"beyond-expectations/reports/error_analysis_summary_{report_time}.html"
    )
    notifications_report_key = (
        f"beyond-expectations/reports/error_analysis_notifications_{report_time}.html"
    )
    json_key = f"beyond-expectations/reports/error_analysis_{report_time}.json"

    # Save Summary HTML to S3
    s3_helpers.write(
        summary_report_key,
        summary_html_content.encode("utf-8"),
        content_type="text/html",
    )

    # Save Notifications HTML to S3
    s3_helpers.write(
        notifications_report_key,
        notifications_html_content.encode("utf-8"),
        content_type="text/html",
    )

    # Save raw JSON for traceability
    s3_helpers.write(
        json_key,
        json.dumps(
            {
                "analysis_result": analysis_result,
                "mail_to_links": mail_to_links,
                "analysis_period": {"start": start_time_str, "end": end_time_str},
            },
            indent=2,
        ).encode("utf-8"),
        content_type="application/json",
    )

    return {
        "report_bucket": bucket,
        "summary_report_key": summary_report_key,
        "notifications_report_key": notifications_report_key,
        "json_data_key": json_key,
        "report_time": report_time,
    }


def generate_email_notification(
    email_addresses: List[str],
    report_info: Dict[str, Any],
    report_data: Dict[str, Any],
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    sender_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Send email notification with report results

    Args:
        email_addresses: Email addresses to send notification to
        report_info: Information about the saved report
        report_data: Analysis report data
        start_time: Start time of analysis period
        end_time: End time of analysis period

    Returns:
        Dictionary with information about the saved email data
    """
    if not email_addresses:
        logger.info("No email address provided, skipping notification")
        return {"status": "skipped", "reason": "No email address provided"}

    from_email = sender_email or os.environ.get("DEFAULT_SENDER_EMAIL")

    # Count notification types by severity
    severity_counts = {"High": 0, "Medium": 0, "Low": 0}
    new_severity_counts = {"High": 0, "Medium": 0, "Low": 0}
    recurring_severity_counts = {"High": 0, "Medium": 0, "Low": 0}

    # Notification counters
    client_notification_count = 0
    internal_notification_count = 0
    both_notification_count = 0

    # New vs recurring counters
    new_error_count = 0
    recurring_error_count = 0
    new_notification_count = 0
    recurring_notification_count = 0

    # Notification types split by new vs recurring
    new_client_count = 0
    new_internal_count = 0
    new_both_count = 0
    recurring_client_count = 0
    recurring_internal_count = 0
    recurring_both_count = 0

    # Create a set of unique client IDs
    unique_client_ids = set()

    # First count severity for notifications requiring action
    for notification in report_data.get("notifications_required", []):
        severity = notification.get("severity", "Medium")
        is_recurring = notification.get("recurring", False)

        if severity in severity_counts:
            severity_counts[severity] += 1

            # Also track by new vs recurring
            if is_recurring:
                recurring_severity_counts[severity] += 1
            else:
                new_severity_counts[severity] += 1

        # Get client ID
        log_entry = notification.get("log_entry", {})
        client_id = log_entry.get("client_id", log_entry.get("ClientId", ""))
        if client_id:
            unique_client_ids.add(client_id)

        # Count by notification type
        client_notif = notification.get("client_notification") == "Yes"
        internal_notif = notification.get("internal_notification") == "Yes"

        if client_notif and internal_notif:
            both_notification_count += 1
            if is_recurring:
                recurring_both_count += 1
            else:
                new_both_count += 1
        elif client_notif:
            client_notification_count += 1
            if is_recurring:
                recurring_client_count += 1
            else:
                new_client_count += 1
        elif internal_notif:
            internal_notification_count += 1
            if is_recurring:
                recurring_internal_count += 1
            else:
                new_internal_count += 1

        # Count as notification requiring action
        if client_notif or internal_notif:
            if is_recurring:
                recurring_notification_count += 1
            else:
                new_notification_count += 1

        # Count new vs recurring regardless of notification status
        if is_recurring:
            recurring_error_count += 1
        else:
            new_error_count += 1

    # Also count severity for notifications not requiring action
    # This ensures total_errors includes all errors, not just those requiring notification
    for notification in report_data.get("notifications_not_required", []):
        severity = notification.get("severity", "Medium")
        is_recurring = notification.get("recurring", False)

        if severity in severity_counts:
            severity_counts[severity] += 1

            # Also track by new vs recurring
            if is_recurring:
                recurring_severity_counts[severity] += 1
            else:
                new_severity_counts[severity] += 1

        # Count new vs recurring regardless of notification status
        if is_recurring:
            recurring_error_count += 1
        else:
            new_error_count += 1

        # Also track client IDs from non-notification errors
        log_entry = notification.get("log_entry", {})
        client_id = log_entry.get("client_id", log_entry.get("ClientId", ""))
        if client_id:
            unique_client_ids.add(client_id)

    # Get total unique clients affected
    client_count = len(unique_client_ids)

    # Format timestamps for the report
    start_time_str = timezone_utils.format_nz_datetime(start_time)
    end_time_str = timezone_utils.format_nz_datetime(end_time)

    # Get the summary sections from the report data
    summary_sections = report_data.get("summary_sections", {})

    # Create email content with the structured summary data and additional parameters
    email_html_content = email_html.generate_email_notification_html(
        start_time_str,
        end_time_str,
        summary_sections,
        severity_counts,
        new_severity_counts,
        recurring_severity_counts,
        new_notification_count,
        recurring_notification_count,
        new_client_count,
        new_internal_count,
        new_both_count,
        recurring_client_count,
        recurring_internal_count,
        recurring_both_count,
        new_error_count,
        recurring_error_count,
        client_count,
    )

    # Read both HTML reports from S3 to attach them
    s3_client = prm_client("s3")

    # Read summary report
    summary_report_object = s3_client.get_object(
        Bucket=report_info["report_bucket"], Key=report_info["summary_report_key"]
    )
    summary_html_content = summary_report_object["Body"].read().decode("utf-8")

    # Read notifications report
    notifications_report_object = s3_client.get_object(
        Bucket=report_info["report_bucket"], Key=report_info["notifications_report_key"]
    )
    notifications_html_content = (
        notifications_report_object["Body"].read().decode("utf-8")
    )

    # Generate filenames for the attachments with the current date
    end_time_nz_date = timezone_utils.format_nz_date(end_time)
    summary_filename = f"Error_Analysis_Summary_{end_time_nz_date}.html"
    notifications_filename = f"Error_Analysis_Notifications_{end_time_nz_date}.html"

    # Prepare email payload with both reports as attachments
    email_payload = {
        "to": email_addresses,
        "from": from_email,
        "subject": f"Error Log Analysis Report - {end_time_nz_date}",
        "body_html": email_html_content,
        "configuration_set": os.environ.get("SES_CONFIGURATION_SET"),
        "attachments": [
            {
                "content_type": "text/html",
                "filename": summary_filename,
                "content": summary_html_content,
            },
            {
                "content_type": "text/html",
                "filename": notifications_filename,
                "content": notifications_html_content,
            },
        ],
    }

    # Log the configuration set being used
    logger.info(
        "Email payload prepared",
        configuration_set=email_payload.get("configuration_set"),
        to=email_payload.get("to"),
        from_email=email_payload.get("from"),
    )

    # Use the same unique report_time from report_info, or generate a new one with same format
    report_time = report_info.get("report_time")
    if not report_time:
        # Create a unique timestamp with microseconds and random component like in save_report_to_s3
        unique_id = str(uuid.uuid4())[:8]
        current_nz_time = timezone_utils.get_current_nz_time()
        report_time = current_nz_time.strftime("%Y-%m-%d-%H-%M-%S-%f") + f"-{unique_id}"

    # Save the email payload to S3 for later use
    email_key = f"beyond-expectations/emails/email_{report_time}.json"
    s3_helpers.write(
        email_key,
        json.dumps(email_payload, indent=2).encode("utf-8"),
        content_type="application/json",
    )

    # For Step Function compatibility, return email key instead of full payload
    step_function_payload = {
        "statusCode": 200,
        "email_data_key": email_key,
        "reportGenerated": True,
    }

    return step_function_payload


def clean_html_content(content: str) -> str:
    """Cleans and normalizes HTML content to fix formatting issues.

    Args:
        content: Raw HTML content string

    Returns:
        Cleaned HTML content with normalized spacing and formatting
    """
    if not isinstance(content, str):
        return content

    # Trim whitespace
    content = content.strip()

    # Fix excessive line spacing by normalizing HTML
    content = re.sub(r"<br\s*/?>\s*<br\s*/?>", "<br>", content)
    content = re.sub(r"<p>\s*</p>", "", content)
    content = re.sub(r"<p>\s*<p>", "<p>", content)
    content = re.sub(r"</p>\s*</p>", "</p>", content)
    content = re.sub(r"</p>\s*<p>", "</p><p>", content)

    # Set line-height to control spacing in paragraphs
    content = content.replace(
        "<p>", '<p style="margin-bottom: 10px; line-height: 1.4;">'
    )

    return content


def create_simplified_log_entry(full_log_entry: Dict[str, Any]) -> Dict[str, Any]:
    """Creates a simplified log entry with only essential fields to reduce token usage.

    Args:
        full_log_entry: The complete log entry dictionary

    Returns:
        A simplified log entry with only essential fields
    """
    return {
        "client_name": full_log_entry.get("client_name", "Unknown Client"),
        "parent_client_name": full_log_entry.get("parent_client_name", "null"),
        "task_description": full_log_entry.get("task_description", "null"),
        "occurrences": full_log_entry.get("occurrences", 1),
        "first_occurrence": full_log_entry.get("first_occurrence", ""),
        "last_occurrence": full_log_entry.get("last_occurrence", ""),
    }


def handler(event: dict, context: LambdaContext) -> Dict[str, Any]:
    """Lambda handler for summarizing and reporting on analyzed error logs

    Args:
        event: Lambda event object containing optional parameters
        context: Lambda context object

    Returns:
        Dictionary with summary results and status information

    Raises:
        Exception: If any critical error occurs during reporting
    """
    helpers.setup_step_function_lambda_logging(event, context)

    # Get email configuration from event
    notification_emails = event.get("notificationEmails", [])
    sender_email = event.get("senderEmail")  # Get sender email from event

    # If sender email is "null" string, treat as None
    if sender_email == "null":
        sender_email = None

    # Get configuration from environment or event
    output_bucket = os.environ["BUCKET"]
    chunk_prefix: str = event.get("chunkPrefix", "")

    # Remove any trailing "/", then split, and take the last segment.
    date_str: Optional[str] = (
        chunk_prefix.rstrip("/").split("/")[-1] if chunk_prefix else None
    )

    logger.info(
        "Starting error log summary and reporting",
        date=date_str,
        notification_emails=notification_emails,
    )

    # Load pre-analyzed logs from S3
    analyzed_logs, start_time, end_time = load_analyzed_logs(date_str)

    if not analyzed_logs:
        logger.info("No analyzed logs found for the specified date")
        report_data = {
            "summary": f"No error logs found for {date_str or 'today'}",
            "summary_sections": {
                "summary": f"No error logs found for {date_str or 'today'}",
                "trends_and_patterns": "N/A",
                "critical_issues": "N/A",
                "business_impact": "N/A",
                "recommendations": "N/A",
            },
            "notifications_required": [],
            "error_categories": {},
        }
        mail_to_links = []
    else:
        # Aggregate the analyzed logs
        aggregated_results = aggregate_analyzed_logs(analyzed_logs)

        # Generate summary using Bedrock
        report_data = generate_summary_with_bedrock(aggregated_results)

        # Generate mail-to links
        mail_to_links = generate_mail_to_links(
            report_data.get("notifications_required", [])  # type: ignore
        )

    # Save report to S3
    report_info = save_report_to_s3(
        output_bucket, report_data, mail_to_links, start_time, end_time
    )

    # Send email notification to internal team if email is provided
    email_result = None
    if notification_emails:
        email_result = generate_email_notification(
            notification_emails,
            report_info,
            report_data,
            start_time,
            end_time,
            sender_email,
        )

    response: Dict[str, Any] = {
        "statusCode": 200,
        "body": {
            "message": "Successfully summarized and reported on error logs",
            "report_info": report_info,
            "notification_emails": notification_emails,
            "notification_count": len(report_data.get("notifications_required", [])),
        },
    }

    # Include email data key in the response if available and successful
    if email_result and email_result.get("email_data_key"):
        response["body"]["email_data_key"] = email_result["email_data_key"]

    return response
