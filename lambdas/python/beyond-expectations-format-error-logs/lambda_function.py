import datetime
import json
import os
from typing import Any, Dict, List

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers

logger = structlog.get_logger()

# Maximum allowed characters for log message fields to prevent token limit issues
MAX_MESSAGE_LENGTH = 2000
MAX_TASK_DESCRIPTION_LENGTH = 1000
# Default chunk size for log processing
DEFAULT_CHUNK_SIZE = 50
# Default time window for collecting logs (in hours)
DEFAULT_TIME_WINDOW = "24h"


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


def group_logs_by_content(logs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group log entries by content, adding an occurrences counter for duplicates.

    Args:
        logs: List of log entries

    Returns:
        List of deduplicated log entries with occurrence counts
    """
    # Sort log entries by timestamp (DateTimeUtc) to ensure chronological processing
    sorted_log_entries = sorted(
        logs,
        key=lambda x: x.get(
            "DateTimeUtc", ""
        ),  # Default to empty string if no timestamp
    )

    logger.debug(f"Sorted {len(sorted_log_entries)} log entries chronologically")

    # Group logs by content (excluding timestamp)
    grouped_logs = {}

    for log_entry in sorted_log_entries:

        # Extract timestamp for tracking first/last occurrence
        timestamp = log_entry.get("DateTimeUtc", "")

        # Skip entries without a timestamp
        if not timestamp:
            logger.warning("Log entry missing DateTimeUtc field", log_entry=log_entry)
            continue

        # Create deduplication key from Message field and TaskDescription
        # These fields contain the core error information
        task = log_entry.get("TaskDescription", "")
        message = log_entry.get("Message", "")
        client_id = log_entry.get("ClientId", "")

        # Create a composite key for deduplication
        log_key = f"{client_id}:{task}:{message}"

        if log_key not in grouped_logs:
            # First occurrence - store the original log with timestamp
            grouped_logs[log_key] = log_entry.copy()
            grouped_logs[log_key]["occurrences"] = 1
            grouped_logs[log_key]["first_occurrence"] = timestamp
            grouped_logs[log_key]["last_occurrence"] = timestamp
            logger.debug(
                f"New unique log: {log_key[:50]}..., first_occurrence={timestamp}"
            )
        else:
            # Increment occurrences count
            grouped_logs[log_key]["occurrences"] += 1

            # Since entries are already sorted, we only need to update the last_occurrence
            # The first one we encountered is already the earliest due to sorting
            grouped_logs[log_key]["last_occurrence"] = timestamp

            logger.debug(
                f"Duplicate log: {log_key[:50]}..., occurrences={grouped_logs[log_key]['occurrences']}, "
                f"last_occurrence updated to {timestamp}"
            )

    # Convert back to a list
    deduplicated_logs = list(grouped_logs.values())

    logger.info(
        "Deduplicated logs",
        original_count=len(logs),
        deduplicated_count=len(deduplicated_logs),
    )

    return deduplicated_logs


def parse_time_window(time_window: str) -> int:
    """Convert a time window string like '24h' into hours as int."""
    if not time_window.endswith("h"):
        raise ValueError(
            f"Invalid timeWindow format (expected hours, e.g. '24h'): {time_window}"
        )
    try:
        return int(time_window[:-1])
    except ValueError as exc:
        raise ValueError(f"Could not parse hours in timeWindow: {time_window}") from exc


def extract_timestamp_from_filename(filename: str) -> str:
    """Extract and parse timestamp from new apical log filename format.

    Converts from "2025_05_27_04_27_07 - 2025_05_27_04_49_27.json" format
    to "2025-05-27-04-27-07" format for comparison purposes.

    Args:
        filename: The filename to parse

    Returns:
        Formatted timestamp string for comparison, or empty string if parsing fails
    """
    try:
        # Remove the .json extension
        base_name = filename.rsplit(".", 1)[0]

        # Split on " - " to get the start timestamp
        start_part = base_name.split(" - ")[0]

        # Convert underscores to hyphens to match our comparison format
        formatted_timestamp = start_part.replace("_", "-")

        return formatted_timestamp
    except (IndexError, ValueError):
        logger.warning("Could not parse timestamp from filename", filename=filename)
        return ""


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    FormatErrorLogs Lambda:
    - Lists error-log files from the last `timeWindow` hours
    - Aggregates and deduplicates logs, adding occurrence counts
    - Chunks deduplicated logs into files of `chunkSize`
    - Writes chunk files under `{outputPrefix}/{date}/chunk-*.json`

    Expects event:
      {
        "timeWindow": "24h",                   # lookback window
        "bucket": "output_bucket",             # S3 bucket name for outputs
        "errorBucket": "apical-log-data",      # S3 bucket name for error logs
        "errorPrefix": "error-logs/",          # prefix for error log files
        "outputPrefix": "beyond-expectations/logs_to_analyse/",   # base for chunk files
        "chunkSize": 10                        # optional, default 10
      }

    Returns:
      { "chunkPrefix": "logs_to_analyse/YYYY-MM-DD/" }
    """
    # Initialize logging for Step Functions
    helpers.setup_step_function_lambda_logging(event, context)

    time_window = event.get("timeWindow", DEFAULT_TIME_WINDOW)
    bucket = event["bucket"]  # Output bucket
    error_bucket = event["errorBucket"]  # Error logs bucket
    error_prefix = event["errorPrefix"]
    output_prefix = event["outputPrefix"]
    chunk_size = event.get("chunkSize", DEFAULT_CHUNK_SIZE)

    # Compute cutoff timestamp
    hours = parse_time_window(time_window)
    end_time = datetime.datetime.utcnow()
    start_time = end_time - datetime.timedelta(hours=hours)
    start_str = start_time.strftime("%Y-%m-%d-%H-%M-%S")

    logger.info(
        "Formatting error logs",
        start=start_str,
        end=end_time.strftime("%Y-%m-%d-%H-%M-%S"),
        chunk_size=chunk_size,
        error_bucket=error_bucket,
        error_prefix=error_prefix,
        output_bucket=bucket,
    )

    # List all error-log keys from the error bucket
    all_keys = s3_helpers.list_objects(prefix=error_prefix, bucket=error_bucket)
    selected_logs: List[Dict[str, Any]] = []

    for key in all_keys:
        # skip folders
        if key.endswith("/"):
            continue
        filename = os.path.basename(key)

        # Extract timestamp from the new filename format
        timestamp = extract_timestamp_from_filename(filename)

        # include if within window (lexical compare works for fixed-width)
        if timestamp and timestamp >= start_str:
            try:
                raw = s3_helpers.read(key, bucket=error_bucket)
                logs = json.loads(raw.decode("utf-8"))

                # Truncate log entries to prevent exceeding token limits
                logs = [truncate_log_entry(log) for log in logs]
                selected_logs.extend(logs)
                logger.info("Loaded log file", key=key, count=len(logs))
            except Exception:
                logger.exception("Error loading log file", key=key)

    total_logs = len(selected_logs)
    logger.info("Total logs collected", total_logs=total_logs)

    # Deduplicate logs and add occurrence counts
    # Pass the selected_logs directly, not wrapped in another structure
    deduplicated_logs = group_logs_by_content(selected_logs)

    logger.info(
        "Deduplication complete",
        original_count=total_logs,
        deduplicated_count=len(deduplicated_logs),
    )

    # Chunk the deduplicated logs
    chunks: List[List[Dict[str, Any]]] = []
    for i in range(0, len(deduplicated_logs), chunk_size):
        chunks.append(deduplicated_logs[i : i + chunk_size])

    # Prepare output path
    date_str = end_time.strftime("%Y-%m-%d")
    chunk_prefix = f"{output_prefix}{date_str}/"

    # Write chunks to S3 (output bucket)
    for idx, chunk in enumerate(chunks):
        chunk_key = f"{chunk_prefix}chunk-{idx}.json"
        body = json.dumps({"logs": chunk}, indent=2)
        try:
            s3_helpers.write(
                key=chunk_key,
                content=body.encode("utf-8"),
                content_type="application/json",
                bucket=bucket,  # Use output bucket for writing
            )
            logger.info("Wrote chunk", key=chunk_key, entries=len(chunk))
        except Exception:
            logger.exception("Error writing chunk", key=chunk_key)

    logger.info(
        "Formatting complete",
        chunkPrefix=chunk_prefix,
        chunkCount=len(chunks),
        total_deduplicated_logs=len(deduplicated_logs),
    )
    return {"chunkPrefix": chunk_prefix}
