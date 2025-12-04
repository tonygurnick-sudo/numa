"""
Post-processing utilities for MCP tool results.

Handles summarisation for verbose payloads and normalises file-based outputs by
persisting them to S3 and (optionally) triggering downstream extraction.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from importlib import import_module
from typing import Any, Dict, List, Optional

import requests
import structlog

import s3_helpers  # type: ignore

from ..config import (
    EXTRACT_CONTENT_LAMBDA_NAME,
    OUTPUTS_BUCKET_NAME,
    REGION,
    get_lambda_client,
)
from ..summarization import call_fast_model_summarizer

# Prefer the shared Bedrock wrapper used by the router; resolve at runtime safely
BEDROCK_CLAUDE3_MODEL = None
try:  # pragma: no cover - optional dependency
    _bedrock_mod = import_module("bedrock")
    BEDROCK_CLAUDE3_MODEL = getattr(_bedrock_mod, "BedrockClaude3Model", None)
except Exception:
    BEDROCK_CLAUDE3_MODEL = None

logger = structlog.get_logger(__name__)

SUMMARY_CHAR_THRESHOLD = int(os.getenv("MCP_TOOL_SUMMARY_CHAR_THRESHOLD", "3000"))
RAW_PREVIEW_CHAR_LIMIT = int(os.getenv("MCP_TOOL_RAW_PREVIEW_CHAR_LIMIT", "1000"))
SUMMARY_MAX_JSON_LENGTH = int(os.getenv("MCP_TOOL_SUMMARY_MAX_JSON_LENGTH", "100000"))
SUMMARY_MAX_TOKENS = int(os.getenv("MCP_TOOL_SUMMARY_MAX_TOKENS", "1500"))
INTEGRATION_DOWNLOAD_PREFIX = os.getenv(
    "TOOL_DOWNLOADS_PREFIX", "numa-chat/downloads"
).rstrip("/")
EXTRACTED_TEXT_CHAR_LIMIT = int(
    os.getenv("MCP_TOOL_EXTRACTED_TEXT_CHAR_LIMIT", "400000")
)
# Max characters of extracted text to include inline as a preview in chat/history
DOWNLOAD_TEXT_PREVIEW_CHAR_LIMIT = int(
    os.getenv("MCP_TOOL_DOWNLOAD_TEXT_PREVIEW_CHAR_LIMIT", "500")
)


@dataclass
class FileCandidate:
    file_name: str
    download_url: str
    mime_type: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None


def postprocess_tool_result(
    *,
    result: Any,
    instruction: str,
    integration_name: str,
    tool_name: str,
    external_user_id: Optional[str],
    full_payload: bool = False,
) -> Any:
    """
    Post-process the raw MCP tool result.

    Args:
        result: Raw MCP result from the integration.
        instruction: User instruction passed to the tool.
        integration_name: Friendly integration identifier.
        tool_name: The specific tool/action name that was invoked.
        external_user_id: Formatted as ``{client}_{cognito_sub}``.
        full_payload: When True the raw result is returned without summarisation.
    """
    if full_payload or not isinstance(result, (dict, list, str, int, float, bool)):
        return result

    file_candidates = _build_candidates_from_filestash(result)
    if file_candidates:
        logger.info(
            "Detected filestash file candidates",
            integration=integration_name,
            tool=tool_name,
            candidate_count=len(file_candidates),
        )
        try:
            return _handle_filestash_candidates(
                file_candidates=file_candidates,
                integration_name=integration_name,
                tool_name=tool_name,
                external_user_id=external_user_id,
                original_result=result,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.error(
                "Failed to post-process file payload",
                integration=integration_name,
                tool=tool_name,
                error=str(exc),
                exc_info=True,
            )
            # Fall back to raw payload if file processing fails
            return result

    serialised = _stringify_for_analysis(result)
    if full_payload or len(serialised) <= SUMMARY_CHAR_THRESHOLD:
        return result

    summary = _summarise_payload(
        serialised,
        instruction=instruction,
        integration_name=integration_name,
        tool_name=tool_name,
    )

    if not summary:
        return {
            "status": "success",
            "content": [
                {
                    "json": {
                        "integration": integration_name,
                        "tool": tool_name,
                        "summary_generated": False,
                        "raw_preview": _truncate(serialised, RAW_PREVIEW_CHAR_LIMIT),
                        "note": "Summary generation failed; consider recalling the tool with full_payload=true for the complete response.",
                    }
                }
            ],
        }

    logger.info(
        "Generated summary for tool result",
        integration=integration_name,
        tool=tool_name,
        summary=_truncate(summary, 400),
    )

    return {
        "status": "success",
        "content": [
            {
                "json": {
                    "integration": integration_name,
                    "tool": tool_name,
                    "summary_generated": True,
                    "summary": summary,
                    "raw_preview": _truncate(serialised, RAW_PREVIEW_CHAR_LIMIT),
                    "note": "This payload was summarised automatically. Re-run the tool with additional or more specific instructions to get a different result.",
                }
            }
        ],
    }


def _handle_filestash_candidates(
    *,
    file_candidates: List[FileCandidate],
    integration_name: str,
    tool_name: str,
    external_user_id: Optional[str],
    original_result: Any,
) -> Dict[str, Any]:
    if not OUTPUTS_BUCKET_NAME:
        raise RuntimeError("Outputs bucket is not configured for the chat agent")

    client_id, user_sub = _split_external_user_id(external_user_id)
    timestamp = int(time.time())
    processed_files: List[Dict[str, Any]] = []
    extraction_errors: List[str] = []

    for candidate in file_candidates:
        file_name = candidate.file_name.strip() or f"{tool_name}-{uuid.uuid4().hex}"
        safe_file_name = _sanitise_filename(file_name)
        unique_segment = f"{timestamp}-{uuid.uuid4().hex}"
        user_segment = user_sub or "shared"
        object_key = (
            f"{INTEGRATION_DOWNLOAD_PREFIX}/{user_segment}/{unique_segment}/"
            f"{safe_file_name}"
        )

        file_bytes = _resolve_file_bytes(candidate)
        if file_bytes is None:
            logger.warning(
                "No bytes extracted for file candidate",
                integration=integration_name,
                tool=tool_name,
                file_name=file_name,
            )
            continue

        logger.info(
            "Fetched file bytes from filestash",
            integration=integration_name,
            tool=tool_name,
            file_name=file_name,
            download_url=candidate.download_url,
        )

        content_type = candidate.mime_type or "application/octet-stream"
        s3_helpers.write(
            object_key,
            file_bytes,
            content_type=content_type,
            bucket=OUTPUTS_BUCKET_NAME,
        )
        logger.info(
            "Uploaded tool-generated file",
            integration=integration_name,
            tool=tool_name,
            s3_bucket=OUTPUTS_BUCKET_NAME,
            s3_key=object_key,
            content_type=content_type,
        )

        logger.info(
            "Invoking extract-content lambda",
            integration=integration_name,
            tool=tool_name,
            lambda_name=EXTRACT_CONTENT_LAMBDA_NAME,
            bucket=OUTPUTS_BUCKET_NAME,
            key=object_key,
        )
        extract_result = _invoke_extract_content_lambda(
            bucket=OUTPUTS_BUCKET_NAME,
            key=object_key,
            file_name=safe_file_name,
        )
        if isinstance(extract_result, dict):
            if extract_result.get("error"):
                error_message = str(extract_result.get("error"))
                logger.warning(
                    "Extract-content lambda reported error",
                    integration=integration_name,
                    tool=tool_name,
                    file_name=file_name,
                    error=error_message,
                )
                extraction_errors.append(error_message)
                extraction_output_key = None
                extraction_bucket = OUTPUTS_BUCKET_NAME
                extraction_status_key = None
            else:
                extraction_output_key = extract_result.get("output_key")
                extraction_bucket = extract_result.get(
                    "output_bucket", OUTPUTS_BUCKET_NAME
                )
                extraction_status_key = extract_result.get("status_key")
        else:
            extraction_output_key = None
            extraction_bucket = OUTPUTS_BUCKET_NAME
            extraction_status_key = None
            if extract_result:
                extraction_errors.append(str(extract_result))

        extracted_text = None
        if extraction_output_key:
            extracted_text = _load_extracted_text(
                extraction_bucket, extraction_output_key
            )

        processed_files.append(
            {
                "file_name": safe_file_name,
                "content_type": content_type,
                "s3_bucket": OUTPUTS_BUCKET_NAME,
                "s3_key": object_key,
                "extracted_content_s3_key": extraction_output_key,
                "extracted_content_bucket": extraction_bucket,
                "extraction_status_key": extraction_status_key,
                "extracted_text": extracted_text,
            }
        )

    if not processed_files:
        logger.warning(
            "File detection triggered but no files were processed",
            integration=integration_name,
            tool=tool_name,
        )
        return original_result

    return _build_integrations_download_response(
        processed_files=processed_files,
        integration_name=integration_name,
        tool_name=tool_name,
        client_id=client_id,
        user_sub=user_sub,
        extraction_errors=extraction_errors,
    )


def _build_integrations_download_response(
    *,
    processed_files: List[Dict[str, Any]],
    integration_name: str,
    tool_name: str,
    client_id: Optional[str],
    user_sub: Optional[str],
    extraction_errors: List[str],
) -> Dict[str, Any]:
    # Keep arguments referenced to satisfy linters without altering response format
    _ = (client_id, user_sub)
    files_payload: List[Dict[str, Any]] = []

    for entry in processed_files:
        # Only include a short preview of any extracted content to avoid ballooning context
        extracted_text_full = entry.get("extracted_text")
        extracted_preview = (
            _truncate(extracted_text_full, DOWNLOAD_TEXT_PREVIEW_CHAR_LIMIT)
            if extracted_text_full
            else None
        )
        file_payload: Dict[str, Any] = {
            "filename": entry["file_name"],
            "filetype": entry["content_type"],
            "s3Bucket": entry["s3_bucket"],
            "s3Key": entry["s3_key"],
            "extractedContentS3Key": entry["extracted_content_s3_key"],
            "extractedContentBucket": entry["extracted_content_bucket"],
            "extractionStatusKey": entry["extraction_status_key"],
        }
        if extracted_preview:
            file_payload["extractedTextPreview"] = extracted_preview

        files_payload.append(file_payload)

    response_json: Dict[str, Any] = {
        "integration": integration_name,
        "tool": tool_name,
        "type": "integrations-file-download",
        "files": files_payload,
    }
    # Add guidance for using full content in the UI
    response_json["note"] = (
        "The user needs to click the 'Use in chat' action in the UI to insert the full content."
    )
    if extraction_errors:
        response_json["extraction_warnings"] = extraction_errors

    content_blocks: List[Dict[str, Any]] = [{"json": response_json}]
    return {"status": "success", "content": content_blocks}


# (Removed) previously emitted a separate text block duplicating preview and guidance.


def _invoke_extract_content_lambda(
    *,
    bucket: str,
    key: str,
    file_name: str,
) -> Optional[Dict[str, Any]]:
    lambda_name = EXTRACT_CONTENT_LAMBDA_NAME
    if not lambda_name:
        logger.debug("Extract content lambda name not configured; skipping extraction")
        return None

    try:
        client = get_lambda_client(region_name=REGION)
        payload = {
            "input_bucket": bucket,
            "input_key": key,
            "output_bucket": bucket,
            "output_key": f"{key}.json",
            "file_name": file_name,
        }
        response = client.invoke(
            FunctionName=lambda_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode("utf-8"),
        )
        raw_payload = response.get("Payload")
        if raw_payload is None:
            return None
        body = raw_payload.read().decode("utf-8")
        if not body:
            return None
        data = json.loads(body)
        if isinstance(data, dict) and data.get("error"):
            return {"error": data.get("error")}
        return {
            "output_key": data.get("output_key"),
            "output_bucket": data.get("output_bucket", bucket),
            "status_key": data.get("status_key"),
        }
    except Exception as exc:  # pragma: no cover - depends on infra
        logger.warning(
            "Failed to invoke extract-content lambda",
            error=str(exc),
            lambda_name=lambda_name,
            key=key,
        )
        return {"error": str(exc)}


def _load_extracted_text(bucket: str, key: str) -> Optional[str]:
    try:
        raw_bytes = s3_helpers.read(key, bucket)
    except Exception as exc:  # pragma: no cover - depends on AWS creds
        logger.warning(
            "Failed to load extracted content from S3",
            bucket=bucket,
            key=key,
            error=str(exc),
        )
        return None

    decoded = raw_bytes.decode("utf-8", errors="replace")
    return _truncate(decoded, EXTRACTED_TEXT_CHAR_LIMIT)


def _stringify_for_analysis(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=_json_default)[
            :SUMMARY_MAX_JSON_LENGTH
        ]
    except Exception:
        return str(value)[:SUMMARY_MAX_JSON_LENGTH]


def _summarise_payload(
    serialised_payload: str,
    *,
    instruction: str,
    integration_name: str,
    tool_name: str,
) -> str:
    prompt = f"""You are an expert at relaying key and relevant information from large tool outputs to help an AI agent named Numa complete its task.

Context:
- Integration: {integration_name}
- Tool: {tool_name}
- Numa's instruction (what Numa needs):
{instruction}

Your job:
1) Provide a concise but complete general summary of the payload so Numa understands the overall result returned.
2) Directly help Numa fulfil the instruction by extracting exactly the information it needs from the payload. Be specific and actionable.

Guidelines for direct help:
- Strictly preserve exact identifiers, names, types, URLs and other critical fields from the payload (do not invent values).
- If the instruction asks for examples or a shortlist, return 3–10 of the best candidates with the key fields Numa needs.
- Prefer field names used in the payload (e.g. id, name, mimeType, webViewLink, webContentLink, downloadURL, type).
- If the payload is clearly a list (e.g. keys like ret, items, files, results, data), extract items from it.
- If required fields are missing, state what's missing and what next step or filter to apply.
- Keep it compact but sufficient for Numa to act without the full payload.
- If you are unsure, provide more information then less.

Output format (Markdown):
## Concise General Summary
- High-level bullets covering scope, counts, types, key entities and statuses

## Direct Help for Numa
- A targeted answer fulfilling the instruction using concrete values from the payload
- If listing items, include a concise bullet list or a small table showing id, name, type and any relevant link field (webViewLink/webContentLink/downloadURL) when present

Raw payload for reference (JSON):
```json
{serialised_payload}
```
"""

    # Use the same Bedrock wrapper as the router for consistency and fallback handling
    if BEDROCK_CLAUDE3_MODEL is not None:
        try:
            name_for_logging = f"pipedream_postprocess:{integration_name}:{tool_name}"[
                :120
            ]
            llm = BEDROCK_CLAUDE3_MODEL(
                enable_fallback=True,
                claude_only=True,
                model_args={
                    "max_tokens": SUMMARY_MAX_TOKENS,
                    "temperature": 0.1,
                },
            )
            resp = llm.run_with_messages(
                [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": prompt}],
                    }
                ],
                name_for_logging=name_for_logging,
            )
            combined = _collect_text_from_response(resp)
            if combined:
                return combined
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Bedrock wrapper summarisation failed; falling back to fast model",
                integration=integration_name,
                tool=tool_name,
                error=str(exc),
            )

    # Fallback to fast model summarizer if the shared wrapper isn't available
    summary = call_fast_model_summarizer(prompt, max_tokens=SUMMARY_MAX_TOKENS)
    return summary.strip() if summary else ""


def _collect_text_from_response(resp: Any) -> str:
    """Extract and join text content pieces from a Bedrock wrapper response."""
    parts: List[str] = []
    for item in getattr(resp, "response", []):
        try:
            if isinstance(item, dict) and item.get("type") == "text":
                text_val = item.get("text")
                if isinstance(text_val, str) and text_val.strip():
                    parts.append(text_val)
        except Exception:  # pragma: no cover - defensive
            continue
    return "\n\n".join(parts).strip()


def _build_candidates_from_filestash(result: Any) -> List[FileCandidate]:
    uploads = _extract_filestash_uploads(result)
    if not uploads:
        return []

    metadata = _extract_file_metadata(result)
    candidates: List[FileCandidate] = []
    seen: set[tuple[str, str]] = set()

    for upload in uploads:
        download_url = _extract_download_url(upload)
        if not download_url:
            continue

        raw_name = (
            upload.get("path")
            or upload.get("fileName")
            or metadata.get("name")
            or f"tool-output-{uuid.uuid4().hex}"
        )
        file_name = str(raw_name)
        signature = (file_name, download_url)
        if signature in seen:
            continue
        seen.add(signature)

        mime_type = (
            upload.get("contentType")
            or upload.get("mimeType")
            or metadata.get("mimeType")
        )
        source_metadata: Dict[str, Any] = {"filestash_upload": upload}
        if metadata:
            source_metadata["fileMetadata"] = metadata

        candidates.append(
            FileCandidate(
                file_name=file_name,
                download_url=download_url,
                mime_type=str(mime_type) if mime_type else None,
                source_metadata=source_metadata,
            )
        )

    return candidates


def _extract_download_url(upload: Dict[str, Any]) -> Optional[str]:
    for key in ("get_url", "downloadUrl", "downloadURL"):
        value = upload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _extract_filestash_uploads(value: Any) -> List[Dict[str, Any]]:
    uploads: List[Dict[str, Any]] = []
    stack: List[Any] = [value]
    visited: set[int] = set()

    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            obj_id = id(current)
            if obj_id in visited:
                continue
            visited.add(obj_id)

            maybe_uploads = current.get("$filestash_uploads")
            if isinstance(maybe_uploads, list):
                uploads.extend(
                    [item for item in maybe_uploads if isinstance(item, dict)]
                )

            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
        elif isinstance(current, str):
            stripped = current.strip()
            if not stripped:
                continue
            if stripped.startswith("{") or stripped.startswith("["):
                try:
                    parsed = json.loads(stripped)
                except ValueError:
                    continue
                stack.append(parsed)

    return uploads


def _extract_file_metadata(value: Any) -> Dict[str, Any]:
    stack: List[Any] = [value]
    visited: set[int] = set()

    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            obj_id = id(current)
            if obj_id in visited:
                continue
            visited.add(obj_id)

            metadata = current.get("fileMetadata")
            if isinstance(metadata, dict):
                return metadata

            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return {}


def _resolve_file_bytes(candidate: FileCandidate) -> Optional[bytes]:
    if not candidate.download_url:
        return None

    try:
        response = requests.get(candidate.download_url, timeout=30)
        response.raise_for_status()
        return response.content
    except Exception as exc:
        logger.warning(
            "Failed to download file from remote URL",
            url=candidate.download_url,
            error=str(exc),
        )
    return None


def _split_external_user_id(
    external_user_id: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    if not external_user_id or "_" not in external_user_id:
        return None, None
    client, user = external_user_id.split("_", 1)
    return client, user


def _truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 3] + "..."


def _sanitise_filename(name: str) -> str:
    safe = name.replace("..", "").replace("\\", "/").split("/")[-1]
    return safe or f"tool-output-{uuid.uuid4().hex}"


def _json_default(obj: Any) -> Any:
    if hasattr(obj, "__dict__"):
        return {
            key: value for key, value in obj.__dict__.items() if not key.startswith("_")
        }
    return str(obj)
