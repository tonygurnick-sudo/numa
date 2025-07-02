import datetime
import json
from typing import Any, Dict, List, Optional

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import config_utils
import helpers
import s3_helpers
from prompts import ERROR_ANALYSIS_PROMPT
from tools import ERROR_ANALYSIS_TOOLS

logger = structlog.get_logger()

# Maximum allowed characters for log message fields to prevent token limit issues
MAX_MESSAGE_LENGTH = 2000
MAX_TASK_DESCRIPTION_LENGTH = 1000
# Number of days to look back for cached analyses
CACHE_LOOKBACK_DAYS = 30


def should_ignore_log(log_entry: Dict[str, Any], config: Dict[str, Any]) -> bool:
    """Determine if a log entry should be ignored based on configuration.

    Args:
        log_entry: The log entry to check
        config: The configuration dictionary

    Returns:
        True if the log should be ignored, False otherwise
    """
    logs_to_ignore = config.get("logsToIgnore", {})

    # Check if the log matches any client/task combinations to ignore
    client_tasks = logs_to_ignore.get("byClientTask", [])
    client_id = log_entry.get("ClientId")
    task_description = log_entry.get("TaskDescription", "")

    for ignore_rule in client_tasks:
        if client_id == ignore_rule.get(
            "ClientId"
        ) and task_description == ignore_rule.get("TaskDescription"):
            logger.debug(
                "Ignoring log based on client/task rule",
                client_id=client_id,
                task_description=task_description,
            )
            return True

    # Check if the log message contains any strings to ignore
    message_patterns = logs_to_ignore.get("byMessageContains", [])
    message = log_entry.get("Message", "")

    for pattern in message_patterns:
        if pattern in message:
            logger.debug(
                "Ignoring log based on message content rule",
                pattern=pattern,
                message_preview=(
                    message[:100] + "..." if len(message) > 100 else message
                ),
            )
            return True

    return False


def check_for_cached_analysis(log_entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Check if this log entry has been analyzed before in the last 30 days

    Args:
        log_entry: The log entry to check for cached analysis

    Returns:
        The cached analysis result if found, otherwise None
    """
    # Create cache key from client, task description and message
    client_id = log_entry.get("ClientId", "")
    task_description = log_entry.get("TaskDescription", "")
    message = log_entry.get("Message", "")

    # Extract first part of message for better matching (often errors have timestamps or other
    # variable parts at the end but the beginning is more consistent)
    message_start = message.split("\r\n")[0] if "\r\n" in message else message[:1000]

    # Create a composite key for cache lookup
    cache_key = f"{client_id}:{task_description}:{message_start}"

    # Get the current date and the date 30 days ago
    now = datetime.datetime.utcnow()

    # Use yesterday as the upper bound (exclude today)
    yesterday = now - datetime.timedelta(days=1)
    thirty_days_ago = now - datetime.timedelta(days=CACHE_LOOKBACK_DAYS)

    # Format dates for S3 key filtering
    yesterday_str = yesterday.strftime("%Y-%m-%d")
    thirty_days_ago_str = thirty_days_ago.strftime("%Y-%m-%d")

    # List objects in the logs_analysed directory for the last 30 days
    logs_analysed_prefix = "beyond-expectations/logs_analysed/"
    objects = s3_helpers.list_objects(logs_analysed_prefix)

    # Filter objects to only include those from the previous 30 days (excluding today)
    recent_objects = []
    for obj in objects:
        # Extract date from the key
        # Format: beyond-expectations/logs_analysed/YYYY-MM-DD/chunk-X.json
        try:
            if obj.endswith(".json"):
                date_part = obj.split("/")[-2]  # e.g., "2025-05-09"
                # Only include dates up to yesterday (exclude today)
                if thirty_days_ago_str <= date_part <= yesterday_str:
                    recent_objects.append(obj)
        except (IndexError, ValueError):
            continue

    logger.info(
        "Checking for cached analysis",
        cache_key=cache_key,
        recent_objects_count=len(recent_objects),
        date_range=f"{thirty_days_ago_str} to {yesterday_str}",
    )

    # Look for cached analysis in each file
    for obj_key in recent_objects:
        try:
            # Load the analysis result
            analysis_bytes = s3_helpers.read(obj_key)
            analysis_data = json.loads(analysis_bytes.decode("utf-8"))

            # Check all results in this analysis file
            for result in analysis_data.get("all_results", []):
                # Get the log entry from the result
                cached_log_entry = result.get("log_entry", {})

                # Create the same cache key for this cached log entry
                cached_client_id = cached_log_entry.get("ClientId", "")
                cached_task_description = cached_log_entry.get("TaskDescription", "")
                cached_message = cached_log_entry.get("Message", "")

                # Extract first part of cached message
                cached_message_start = (
                    cached_message.split("\r\n")[0]
                    if "\r\n" in cached_message
                    else cached_message[:1000]
                )

                # Create cache key from the cached log entry
                cached_key = f"{cached_client_id}:{cached_task_description}:{cached_message_start}"

                # If the cache keys match, we've found a cached analysis
                if cache_key == cached_key:
                    # Return a copy of the result with updated fields
                    cached_result = result.copy()
                    # Update with latest log entry but keep original analysis
                    cached_result["log_entry"] = {
                        "id": log_entry.get("Id"),
                        "timestamp": log_entry.get("DateTimeUtc"),
                        "client_id": log_entry.get("ClientId"),
                        "client_name": log_entry.get("ClientName"),
                        "parent_client_id": log_entry.get("ParentClientId"),
                        "parent_client_name": log_entry.get("ParentClientName"),
                        "task_id": log_entry.get("TaskId"),
                        "task_description": log_entry.get("TaskDescription"),
                        "admin_only": log_entry.get("AdminOnly"),
                        "message": log_entry.get("Message"),
                        "occurrences": log_entry.get("occurrences", 1),
                        "first_occurrence": log_entry.get("first_occurrence"),
                        "last_occurrence": log_entry.get("last_occurrence"),
                    }
                    # Mark as recurring
                    cached_result["recurring"] = True
                    cached_result["previous_analysis_date"] = obj_key.split("/")[
                        -2
                    ]  # Date from key

                    logger.info(
                        "Found cached analysis",
                        cache_key=cache_key,
                        analysis_file=obj_key,
                        error_type=cached_result.get("error_type"),
                    )

                    return cached_result
        except Exception as e:
            logger.warning("Error loading cached analysis", error=str(e), file=obj_key)
            continue

    # No cached analysis found
    return None


def analyze_logs_with_bedrock(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze logs using Bedrock to identify patterns and notification requirements

    Args:
        logs: List of error log data dictionaries

    Returns:
        Dictionary with analysis results
    """
    # Load configuration
    config = config_utils.load_config()

    # Create Bedrock client
    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": ERROR_ANALYSIS_TOOLS,
            "tool_choice": {"type": "tool", "name": "categorise_errors"},
            "max_tokens": 4096,
            "temperature": 0.1,
        },
        claude_only=True,
    )

    if len(logs) == 0:
        logger.info("No error logs found for analysis")
        return {
            "notifications_required": [],
            "notifications_not_required": [],
            "error_categories": {},
            "all_results": [],
        }

    # Process logs in batches of 5
    all_results = []
    batch_size = 5

    # Track cache hits and filtering for reporting
    cache_hits = 0
    cache_misses = 0
    filtered_logs = 0

    # Process each log individually first to filter and check for cache hits
    logs_to_analyze = []

    for log in logs:
        # First check if this log should be ignored based on config
        if should_ignore_log(log, config):
            filtered_logs += 1
            logger.debug(
                "Filtering log based on configuration rules",
                log_id=log.get("Id"),
                client_id=log.get("ClientId"),
                task_description=log.get("TaskDescription"),
            )
            continue

        # Then check if there's a cached analysis for this log
        cached_result = check_for_cached_analysis(log)

        if cached_result:
            # Use the cached result
            all_results.append(cached_result)
            cache_hits += 1
            logger.debug(
                "Using cached analysis",
                log_id=log.get("Id"),
                error_type=cached_result.get("error_type"),
                recurring=True,
            )
        else:
            # Mark as not recurring and add to logs needing analysis
            logs_to_analyze.append(log)
            cache_misses += 1

    logger.info(
        "Cache statistics",
        cache_hits=cache_hits,
        cache_misses=cache_misses,
        filtered_logs=filtered_logs,
        cache_hit_rate=(
            f"{cache_hits/(cache_hits+cache_misses)*100:.1f}%"
            if (cache_hits + cache_misses) > 0
            else "N/A"
        ),
    )

    # Process logs that need analysis in batches
    for i in range(0, len(logs_to_analyze), batch_size):
        batch = logs_to_analyze[i : i + batch_size]

        # Format log entries for the batch
        formatted_batch = []
        for log in batch:
            formatted_log = {
                "id": log.get("Id"),
                "timestamp": log.get("DateTimeUtc"),
                "client_id": log.get("ClientId"),
                "client_name": log.get("ClientName"),
                "parent_client_id": log.get("ParentClientId"),
                "parent_client_name": log.get("ParentClientName"),
                "task_id": log.get("TaskId"),
                "task_description": log.get("TaskDescription"),
                "admin_only": log.get("AdminOnly"),
                "message": log.get("Message"),
                "occurrences": log.get("occurrences", 1),
                "first_occurrence": log.get("first_occurrence"),
                "last_occurrence": log.get("last_occurrence"),
            }
            formatted_batch.append(formatted_log)

        formatted_logs = json.dumps(formatted_batch, indent=2)
        # Update the prompt with notification requirements from config
        updated_prompt = config_utils.update_prompt_with_config(
            ERROR_ANALYSIS_PROMPT, config
        )
        formatted_prompt = updated_prompt.format(log_entries=formatted_logs)

        # Call Bedrock to analyze the batch
        batch_response = model.run(
            query=formatted_prompt, name_for_logging="error_log_analysis"
        )

        # Extract the results from the response
        batch_results = batch_response.response[0]["input"]["data"]

        # Link each result back to its original log entry
        for j, result in enumerate(batch_results):
            if j < len(batch):  # Safety check
                result["log_entry"] = batch[j]
                # Mark as not recurring since we had to analyze it
                result["recurring"] = False

        all_results.extend(batch_results)

        logger.info(
            "Analyzed batch of log entries",
            batch_size=len(batch),
            results_count=len(batch_results),
            batch_number=i // batch_size + 1,
        )

    # Extract errors requiring notification and those not requiring notification
    notifications_required = []
    notifications_not_required = []

    for result in all_results:
        if (
            result.get("client_notification") == "Yes"
            or result.get("internal_notification") == "Yes"
        ):
            notifications_required.append(result)
        else:
            notifications_not_required.append(result)

    # Get a count of all error types
    error_categories = {}
    for result in all_results:
        error_type = result.get("error_type", "Unknown Error")
        if error_type not in error_categories:
            error_categories[error_type] = 0
        error_categories[error_type] += 1

    # Sort error categories by count, descending
    error_categories = dict(
        sorted(error_categories.items(), key=lambda x: x[1], reverse=True)
    )

    # Get count of recurring vs. new errors
    recurring_count = sum(1 for r in all_results if r.get("recurring", False))
    new_count = len(all_results) - recurring_count

    logger.info(
        "Analysis complete",
        total_logs=len(all_results),
        recurring_errors=recurring_count,
        new_errors=new_count,
        notifications_required=len(notifications_required),
    )

    return {
        "notifications_required": notifications_required,
        "notifications_not_required": notifications_not_required,
        "error_categories": error_categories,
        "all_results": all_results,
        "cache_stats": {
            "hits": cache_hits,
            "misses": cache_misses,
            "recurring_errors": recurring_count,
            "new_errors": new_count,
            "filtered_logs": filtered_logs,
        },
    }


def handler(event: dict, context: LambdaContext) -> Dict[str, Any]:
    """Lambda handler for analyzing a single chunk of error logs

    Args:
        event: Lambda event object containing chunk path
        context: Lambda context object

    Returns:
        Dictionary with analysis results and status information
    """
    helpers.setup_step_function_lambda_logging(event, context)

    # Get the input file path from the event
    input_path = event.get("chunkPath")
    if not input_path:
        error_msg = "No chunkPath provided in event"
        logger.exception(error_msg)
        return {
            "statusCode": 400,
            "error": error_msg,
        }

    logger.info("Starting log chunk analysis", input_path=input_path)

    try:
        # Read the chunk file from S3
        chunk_data_bytes = s3_helpers.read(input_path)
        chunk_data = json.loads(chunk_data_bytes.decode("utf-8"))

        # Extract the logs from the chunk data
        logs = chunk_data.get("logs", [])

        logger.info("Loaded log chunk", log_count=len(logs))

        # Analyze the logs
        analysis_result = analyze_logs_with_bedrock(logs)

        # Determine the output path by replacing "logs_to_analyse" with "logs_analysed"
        output_path = input_path.replace("logs_to_analyse", "logs_analysed")

        # Save the analysis result to S3
        s3_helpers.write(
            output_path,
            json.dumps(analysis_result, indent=2).encode("utf-8"),
            content_type="application/json",
        )

        # Extract recurring vs. new counts from analysis result
        cache_stats = analysis_result.get("cache_stats", {})
        recurring_errors = cache_stats.get("recurring_errors", 0)
        new_errors = cache_stats.get("new_errors", 0)
        filtered_logs = cache_stats.get("filtered_logs", 0)

        logger.info(
            "Analysis complete and saved",
            input_path=input_path,
            output_path=output_path,
            notification_count=len(analysis_result.get("notifications_required", [])),
            error_types=len(analysis_result.get("error_categories", {})),
            recurring_errors=recurring_errors,
            new_errors=new_errors,
            filtered_logs=filtered_logs,
        )

        return {
            "statusCode": 200,
            "body": {
                "message": "Successfully analyzed log chunk",
                "input_path": input_path,
                "output_path": output_path,
                "notification_count": len(
                    analysis_result.get("notifications_required", [])
                ),
                "error_types": len(analysis_result.get("error_categories", {})),
                "recurring_errors": recurring_errors,
                "new_errors": new_errors,
                "filtered_logs": filtered_logs,
                "cache_hit_rate": (
                    f"{cache_stats.get('hits', 0)/(cache_stats.get('hits', 0) + cache_stats.get('misses', 0))*100:.1f}%"
                    if (cache_stats.get("hits", 0) + cache_stats.get("misses", 0)) > 0
                    else "N/A"
                ),
            },
        }

    except Exception as e:
        logger.exception("Error analysing log chunk")
        return {
            "statusCode": 500,
            "error": str(e),
        }
