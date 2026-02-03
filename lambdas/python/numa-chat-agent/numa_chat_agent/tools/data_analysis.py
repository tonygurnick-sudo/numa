import json
import os
import time
import uuid
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import structlog
from boto3.dynamodb.types import TypeDeserializer

from prm import client as prm_client

from ..auth import get_request_scoped_user_auth
from ..dynamodb_utils import NumaChatDynamoUtils

logger = structlog.get_logger(__name__)

_deserializer = TypeDeserializer()


def _deserialize_item(item: Dict[str, Any]) -> Dict[str, Any]:
    return {k: _deserializer.deserialize(v) for k, v in item.items()}


def _looks_like_data_file(file_info: Dict[str, Any]) -> bool:
    file_name = str(file_info.get("fileName") or "").lower()
    file_type = str(file_info.get("fileType") or "").lower()
    if file_name.endswith((".csv", ".xlsx", ".xls", ".json")):
        return True
    if file_type in {
        "text/csv",
        "application/csv",
        "application/json",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }:
        return True
    return False


def _looks_like_csv_file(file_info: Dict[str, Any]) -> bool:
    file_name = str(file_info.get("fileName") or "").lower()
    file_type = str(file_info.get("fileType") or "").lower()
    if file_name.endswith(".csv"):
        return True
    return file_type in {"text/csv", "application/csv"}


@lru_cache(maxsize=1)
def _get_step_function_arn() -> str:
    client_name = os.environ.get("CLIENT_NAME", "")
    param_name = os.environ.get(
        "DATA_ANALYSIS_STEP_FUNCTION_PARAM_NAME",
        f"/numa/{client_name}/apps/data-analysis/step-function-arn",
    )

    ssm = prm_client("ssm")
    response = ssm.get_parameter(Name=param_name)
    arn = response.get("Parameter", {}).get("Value")
    if not arn:
        raise RuntimeError("Missing data analysis step function ARN parameter value")
    return arn


def _load_recent_files(conversation_id: str, user_id: str) -> List[Dict[str, Any]]:
    utils = NumaChatDynamoUtils()
    items = utils.query_conversations(conversation_id, user_id, limit=500)
    files: List[Dict[str, Any]] = []
    for item in items:
        if item.get("message_type") != "file":
            continue
        file_info = item.get("fileInfo")
        if isinstance(file_info, dict) and _looks_like_data_file(file_info):
            files.append(file_info)
    return files


def _filter_files(
    files: List[Dict[str, Any]],
    file_names: Optional[List[str]],
    file_keys: Optional[List[str]],
) -> List[Dict[str, Any]]:
    if not file_names and not file_keys:
        if not files:
            return []
        for info in reversed(files):
            if _looks_like_csv_file(info):
                return [info]
        return files[-1:]

    filtered: List[Dict[str, Any]] = []
    name_set = {n.lower() for n in (file_names or []) if isinstance(n, str)}
    key_set = {k for k in (file_keys or []) if isinstance(k, str)}

    for info in files:
        name = str(info.get("fileName") or "")
        key = str(info.get("s3Key") or "")
        if name and name.lower() in name_set:
            filtered.append(info)
        elif key and key in key_set:
            filtered.append(info)
    return filtered


def _parse_s3_uri(uri: str) -> Optional[Tuple[str, str]]:
    if not isinstance(uri, str):
        return None
    trimmed = uri.strip()
    if not trimmed:
        return None

    if trimmed.startswith("s3://"):
        parts = trimmed[5:].split("/", 1)
        if len(parts) != 2 or not parts[0] or not parts[1]:
            return None
        return parts[0], parts[1]

    parsed = urlparse(trimmed)
    if parsed.scheme not in {"http", "https"}:
        return None
    host = parsed.netloc or ""
    path = parsed.path.lstrip("/")
    if not host or not path:
        return None

    # Virtual-hosted-style: bucket.s3[.region].amazonaws.com/key
    if ".amazonaws.com" in host and ".s3" in host:
        bucket = host.split(".s3", 1)[0]
        return (bucket, path) if bucket else None

    # Path-style: s3[.region].amazonaws.com/bucket/key
    if host.startswith("s3") and ".amazonaws.com" in host:
        parts = path.split("/", 1)
        if len(parts) != 2:
            return None
        bucket, key = parts[0], parts[1]
        return (bucket, key) if bucket and key else None

    return None


def _build_file_entries_from_uris(
    file_uris: Optional[List[str]],
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for uri in file_uris or []:
        parsed = _parse_s3_uri(uri)
        if not parsed:
            continue
        bucket, key = parsed
        entries.append({"s3_key": key, "s3_bucket": bucket, "source_uri": uri})
    return entries


def _wait_for_job_result(
    table_name: str, job_id: str, timeout_seconds: int = 840, poll_seconds: int = 4
) -> Dict[str, Any]:
    ddb = prm_client("dynamodb")
    deadline = time.time() + timeout_seconds
    poll_count = 0

    while time.time() < deadline:
        poll_count += 1
        try:
            response = ddb.get_item(TableName=table_name, Key={"jobId": {"S": job_id}})
        except Exception as e:
            logger.error(
                "DynamoDB get_item failed",
                table_name=table_name,
                job_id=job_id,
                error=str(e),
                exc_info=True,
            )
            raise

        item = response.get("Item")
        if item:
            parsed = _deserialize_item(item)
            status = str(parsed.get("status") or "").upper()
            logger.info(
                "Job status update",
                job_id=job_id,
                status=status,
                poll_count=poll_count,
            )
            if status == "SUCCESS":
                results_raw = parsed.get("results")
                if isinstance(results_raw, str):
                    try:
                        return json.loads(results_raw)
                    except json.JSONDecodeError:
                        return {"results": results_raw}
                if isinstance(results_raw, dict):
                    return results_raw
                return {"results": results_raw}
            if status == "FAILURE":
                message = parsed.get("message")
                logger.error(
                    "Data analysis job failed",
                    job_id=job_id,
                    message=message,
                    full_item=parsed,
                )
                raise RuntimeError(
                    f"Data analysis failed: {message}"
                    if message
                    else "Data analysis failed"
                )
        elif poll_count == 1:
            logger.info(
                "Job not yet in DynamoDB, waiting for step function to create record",
                table_name=table_name,
                job_id=job_id,
            )
        time.sleep(poll_seconds)

    logger.error(
        "Data analysis timed out",
        job_id=job_id,
        timeout_seconds=timeout_seconds,
        poll_count=poll_count,
    )
    raise TimeoutError("Data analysis timed out before results were available")


def run_data_analysis(
    prompt: Optional[str] = None,
    file_names: Optional[List[str]] = None,
    file_keys: Optional[List[str]] = None,
    file_uris: Optional[List[str]] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    auth = get_request_scoped_user_auth() or {}
    conversation_id = auth.get("conversation_id") or auth.get("conversationId")
    user_id = auth.get("sub")

    if not conversation_id or not user_id:
        logger.error(
            "Missing conversation context",
            conversation_id=conversation_id,
            user_id=user_id,
        )
        raise RuntimeError("Missing conversation context for data analysis")

    logger.info(
        "Loading files for data analysis",
        conversation_id=conversation_id,
        user_id=user_id,
        file_names=file_names,
        file_keys=file_keys,
        file_uris=file_uris,
    )

    uploaded_files = _build_file_entries_from_uris(file_uris)

    files = _load_recent_files(conversation_id, user_id)
    logger.info(
        "Found data files in conversation",
        file_count=len(files),
        file_names=[f.get("fileName") for f in files],
    )

    selected = _filter_files(files, file_names, file_keys)
    logger.info(
        "Selected files for analysis",
        selected_count=len(selected),
        selected_names=[f.get("fileName") for f in selected],
    )

    if not selected and not uploaded_files:
        raise ValueError(
            "No CSV, Excel, or JSON files found in this conversation. Ask the user to upload a file."
        )

    for info in selected:
        s3_key = info.get("s3Key")
        s3_bucket = info.get("s3Bucket")
        if isinstance(s3_key, str) and s3_key:
            file_entry: Dict[str, Any] = {"s3_key": s3_key}
            if s3_bucket:
                file_entry["s3_bucket"] = s3_bucket
            uploaded_files.append(file_entry)
            logger.info(
                "Adding file to analysis",
                file_name=info.get("fileName"),
                s3_key=s3_key,
                s3_bucket=s3_bucket,
            )

    if not uploaded_files:
        raise ValueError("Uploaded files are missing S3 keys")

    # Deduplicate in case URIs and conversation files overlap
    deduped: Dict[str, Dict[str, Any]] = {}
    for entry in uploaded_files:
        s3_key = entry.get("s3_key")
        if isinstance(s3_key, str) and s3_key:
            deduped[s3_key] = entry
    uploaded_files = list(deduped.values())

    user_timezone = "UTC"
    time_info = auth.get("timeInfo")
    if isinstance(time_info, dict):
        user_timezone = str(time_info.get("timezone") or user_timezone)

    job_id = (
        str(job_id).strip()
        if isinstance(job_id, str) and job_id.strip()
        else str(uuid.uuid4())
    )
    input_payload = {
        "app_id": "data-analysis",
        "job_id": job_id,
        "user_id": user_id,
        "analysis_mode": "simple",
        "prompt": (prompt or "").strip()
        or "Analyze the uploaded data and summarize key insights.",
        "uploaded_files": uploaded_files,
        "user_timezone": user_timezone,
    }

    step_function_arn = _get_step_function_arn()
    logger.info("Retrieved step function ARN", arn=step_function_arn)

    sfn = prm_client("stepfunctions")
    execution_name = f"{job_id}-{int(time.time() * 1000)}"
    logger.info(
        "Starting data analysis execution",
        job_id=job_id,
        execution_name=execution_name,
        file_count=len(uploaded_files),
        uploaded_files=uploaded_files,
        prompt=input_payload.get("prompt"),
    )

    try:
        sfn.start_execution(
            stateMachineArn=step_function_arn,
            name=execution_name,
            input=json.dumps(input_payload),
        )
        logger.info("Step function execution started successfully", job_id=job_id)
    except Exception as e:
        logger.error(
            "Failed to start step function execution",
            job_id=job_id,
            error=str(e),
            exc_info=True,
        )
        raise

    client_name = os.environ.get("CLIENT_NAME", "")
    table_name = f"{client_name}-data-analysis-recent-jobs"
    logger.info(
        "Polling for job results",
        table_name=table_name,
        job_id=job_id,
    )
    return _wait_for_job_result(table_name, job_id)
